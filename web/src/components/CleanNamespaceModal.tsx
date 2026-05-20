import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { IconXCircle, IconAlertTriangle } from './Icons';
import { ClassificationTag, StatusPill } from './Tags';

interface Props {
  ns: string;
  onClose: () => void;
  /** Called after the namespace is successfully deleted so the parent can reload. */
  onDeleted: () => void;
}

type Row = {
  ns: string;
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  error?: string;
};

/**
 * CleanNamespaceModal is the admin escape hatch for removing a non-empty
 * namespace. The UX is deliberately slow and verbose:
 *
 * 1. Fetch the skill list for the namespace up-front and show each row.
 * 2. Require the admin to tick "全选" (which flips every row to checked).
 * 3. Require a typed confirmation that matches the namespace id, so there
 *    is no way to yeet the wrong namespace by clicking through too fast.
 * 4. On submit: delete each checked skill serially, updating per-row status
 *    as we go; only after all are done do we delete the namespace itself.
 *
 * Errors on individual skills are shown inline and don't abort the loop —
 * the admin can retry by reopening the modal after a refresh.
 */
export function CleanNamespaceModal({ ns, onClose, onDeleted }: Props) {
  const { i18n } = useTranslation();
  const isEnglish = (i18n.resolvedLanguage ?? i18n.language ?? '').startsWith('en');
  const text = (en: string, zh: string) => (isEnglish ? en : zh);
  const skills = useAsync(
    () => api.listSkills({ ns }),
    [ns],
  );
  const list = skills.data ?? [];

  // selection state: skill name → checked
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // per-skill delete state (populated when we start the submit loop)
  const [rowStatus, setRowStatus] = useState<Record<string, Row>>({});
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);

  // Default every skill to checked when the list arrives. We intentionally
  // depend on `list.length` rather than `list` itself to avoid re-seeding
  // after the user changes their selection.
  useEffect(() => {
    if (list.length > 0 && Object.keys(checked).length === 0) {
      const next: Record<string, boolean> = {};
      list.forEach((s) => { next[s.name] = true; });
      setChecked(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  const selected = useMemo(() => list.filter((s) => checked[s.name]), [list, checked]);
  const allChecked = list.length > 0 && selected.length === list.length;
  const confirmValid = confirmInput.trim() === ns;
  const canSubmit = !busy && list.length > 0 && allChecked && confirmValid;

  async function submit() {
    setBusy(true);
    setGlobalError(null);
    setAllDone(false);

    // Initialise per-row status so every row renders with "pending".
    const initial: Record<string, Row> = {};
    selected.forEach((s) => { initial[s.name] = { ns: s.ns, name: s.name, status: 'pending' }; });
    setRowStatus(initial);

    // Serial loop so the server sees a predictable order and we can halt on
    // the first catastrophic error.
    let anyFailed = false;
    for (const s of selected) {
      setRowStatus((r) => ({ ...r, [s.name]: { ...r[s.name], status: 'running' } }));
      try {
        await api.adminDeleteSkill(s.ns, s.name);
        setRowStatus((r) => ({ ...r, [s.name]: { ...r[s.name], status: 'done' } }));
      } catch (e) {
        anyFailed = true;
        setRowStatus((r) => ({
          ...r,
          [s.name]: { ...r[s.name], status: 'failed', error: (e as Error).message },
        }));
      }
    }

    if (anyFailed) {
      setGlobalError(text('Some skills could not be deleted. Please investigate and retry.', '部分 Skill 删除失败，请排查后重试。'));
      setBusy(false);
      return;
    }

    // All skills gone — now drop the namespace itself.
    try {
      await api.adminDeleteNamespace(ns);
      setAllDone(true);
      setBusy(false);
      // Close after a short delay so the admin sees the success state.
      window.setTimeout(onDeleted, 900);
    } catch (e) {
      setGlobalError(text('Namespace delete failed: ', '命名空间删除失败：') + (e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 10, width: 640, maxWidth: '94vw',
          maxHeight: '88vh', display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(15,23,42,0.3)',
        }}
      >
        {/* Header ----------------------------------------------------- */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            {text('Clean and delete namespace', '清空并删除命名空间')} <span className="mono" style={{ marginLeft: 6, color: 'var(--red-text)' }}>{ns}</span>
          </h3>
          <button className="btn sm ghost" onClick={onClose} disabled={busy}>
            <IconXCircle size={14} />
          </button>
        </div>

        {/* Warning banner -------------------------------------------- */}
        <div style={{ padding: '12px 18px', background: 'var(--red-bg)', color: 'var(--red-text)', display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.55 }}>
          <IconAlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            {isEnglish ? (
              <>This will <b>permanently delete</b> the selected skills and all versions, files, ratings, review requests, comments, review snapshots, daily metrics, and related notifications. audit_logs are kept for later investigation.</>
            ) : (
              <>此操作将 <b>永久删除</b> 选中的 Skill 及其所有版本、文件、评分、审批请求、评论、审批文件快照、每日指标、相关通知。audit_logs 会保留，以便事后追查。</>
            )}
          </div>
        </div>

        {/* Skill list ------------------------------------------------ */}
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 18px' }}>
          {skills.loading && (
            <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{text('Loading skill list...', '加载 Skill 列表...')}</div>
          )}
          {skills.error && (
            <div style={{ color: 'var(--red-text)', fontSize: 13 }}>{skills.error.message}</div>
          )}
          {!skills.loading && list.length === 0 && (
            <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>
              {text('This namespace is already empty. You can confirm below to delete it.', '命名空间已经空了，可以直接执行下方"确认"即可删除它。')}
            </div>
          )}
          {list.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.checked;
                      const next: Record<string, boolean> = {};
                      list.forEach((s) => { next[s.name] = v; });
                      setChecked(next);
                    }}
                  />
                  <span>{text('Select all', '全选')} <span className="num" style={{ color: 'var(--text-subtle)' }}>({selected.length}/{list.length})</span></span>
                </label>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                {list.map((s) => {
                  const row = rowStatus[s.name];
                  return (
                    <label
                      key={s.name}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 12px', borderBottom: '1px solid var(--border)',
                        cursor: busy ? 'default' : 'pointer',
                        background: row?.status === 'done' ? 'var(--green-bg)'
                          : row?.status === 'failed' ? 'var(--red-bg)'
                          : row?.status === 'running' ? 'var(--amber-bg)'
                          : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!checked[s.name]}
                        disabled={busy}
                        onChange={(e) => setChecked((c) => ({ ...c, [s.name]: e.target.checked }))}
                      />
                      <ClassificationTag level={s.classification} />
                      <span className="mono" style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{s.name}</span>
                      <StatusPill status={s.status} />
                      <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 70, textAlign: 'right' }}>
                        {statusLabel(row?.status, isEnglish)}
                      </span>
                    </label>
                  );
                })}
              </div>
              {/* Surface per-row errors below the list in one place */}
              {Object.values(rowStatus).filter((r) => r.status === 'failed').map((r) => (
                <div key={r.name} style={{ marginTop: 6, fontSize: 11.5, color: 'var(--red-text)' }}>
                  <span className="mono">{r.name}</span>: {r.error}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Confirm footer ------------------------------------------- */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--text-subtle)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>
              {text('Before continuing, enter namespace id', '继续前，请输入命名空间 id')}
              <span className="mono" style={{ margin: '0 4px', color: 'var(--red-text)' }}>{ns}</span>
              {text('to confirm:', '以确认：')}
            </span>
            <input
              className="input"
              value={confirmInput}
              disabled={busy || allDone}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={ns}
              style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }}
              autoFocus
            />
          </label>
          {globalError && (
            <div style={{ fontSize: 12.5, color: 'var(--red-text)' }}>{globalError}</div>
          )}
          {allDone && (
            <div style={{ fontSize: 12.5, color: 'var(--green-text)' }}>
              {text('✓ Namespace cleaned and deleted. Closing soon...', '✓ 命名空间已清空并删除。即将关闭...')}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={onClose} disabled={busy}>{text('Cancel', '取消')}</button>
            <button
              className="btn"
              disabled={!canSubmit}
              style={canSubmit ? { background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' } : undefined}
              onClick={submit}
            >
              {busy
                ? text('Processing...', '处理中...')
                : list.length === 0
                  ? text('Delete Namespace', '删除命名空间')
                  : text(`Delete ${selected.length} skills and remove namespace`, `删除 ${selected.length} 个 Skill 并移除命名空间`)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function statusLabel(s: Row['status'] | undefined, isEnglish: boolean): string {
  switch (s) {
    case 'running': return isEnglish ? 'Deleting...' : '删除中...';
    case 'done': return isEnglish ? '✓ Deleted' : '✓ 已删除';
    case 'failed': return isEnglish ? '✗ Failed' : '✗ 失败';
    default: return '';
  }
}
