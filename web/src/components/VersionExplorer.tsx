import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DiffEditor } from '@monaco-editor/react';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { renderMarkdown } from '../lib/markdown';
import { languageFor, shouldDisplaySkillFile } from '../lib/files';
import type { SkillVersion } from '../api/types';
import { IconXCircle, IconFile, IconChevronRight } from './Icons';
import { useLocaleText } from '../i18n/useLocaleText';

interface Props {
  ns: string;
  name: string;
  versions: SkillVersion[];
  latestVersion: string;
}

// Status → tag color/label, mirrors the inline mapping that used to live in
// SkillDetail. Keeping a single source of truth here so this component is
// self-contained.
function statusTag(s: string, text: (en: string, zh: string) => string): { cls: string; label: string } {
  switch (s) {
    case 'published':         return { cls: 'green',  label: text('Published', '已发布') };
    case 'review':            return { cls: 'amber',  label: text('In Review', '审批中') };
    case 'changes_requested': return { cls: 'amber',  label: text('Changes Requested', '需修改') };
    case 'rejected':          return { cls: 'red',    label: text('Rejected', '已驳回') };
    case 'approved':          return { cls: 'green',  label: text('Approved', '已通过') };
    default:                  return { cls: 'indigo', label: s };
  }
}

export function VersionExplorer({ ns, name, versions, latestVersion }: Props) {
  const { text, locale } = useLocaleText();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'list' | 'compare'>('list');
  // Compare-mode selection: at most 2 version ids in insertion order.
  const [selected, setSelected] = useState<number[]>([]);
  const [viewing, setViewing] = useState<SkillVersion | null>(null);
  const [diffPair, setDiffPair] = useState<[SkillVersion, SkillVersion] | null>(null);

  // Reset compare selection if the version list shrinks under us.
  useEffect(() => {
    const ids = new Set(versions.map((v) => v.id));
    setSelected((prev) => prev.filter((id) => ids.has(id)));
  }, [versions]);

  function toggleSelect(id: number, on: boolean) {
    setSelected((prev) => {
      if (on) {
        if (prev.includes(id)) return prev;
        if (prev.length >= 2) {
          // Replace the oldest selection so the user can keep clicking.
          return [prev[1], id];
        }
        return [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  }

  function openDiff() {
    if (selected.length !== 2) return;
    const [a, b] = selected.map((id) => versions.find((v) => v.id === id)!).filter(Boolean);
    if (!a || !b) return;
    // Order: older as base, newer as the "modified" side.
    const base = new Date(a.createdAt) < new Date(b.createdAt) ? a : b;
    const next = base === a ? b : a;
    setDiffPair([base, next]);
  }

  if (versions.length === 0) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: 16, color: 'var(--text-subtle)', fontSize: 13 }}>
          {text('No version records yet', '暂无版本记录')}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-body" style={{ padding: '14px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'inline-flex', gap: 4 }}>
              <button
                type="button"
                className={`btn sm ${mode === 'list' ? 'primary' : 'ghost'}`}
                onClick={() => { setMode('list'); setSelected([]); }}
                style={{ fontSize: 12 }}
              >{text('List', '列表')}</button>
              <button
                type="button"
                className={`btn sm ${mode === 'compare' ? 'primary' : 'ghost'}`}
                onClick={() => { setMode('compare'); setSelected([]); }}
                style={{ fontSize: 12 }}
                title={text('Select two versions to compare the diff', '勾选两个版本进行 diff 对比')}
              >{text('Compare', '对比')}</button>
            </div>
            {mode === 'compare' ? (
              <button
                type="button"
                className="btn sm primary"
                disabled={selected.length !== 2}
                onClick={openDiff}
                title={selected.length === 2 ? text('View diff between two versions', '查看两个版本的 diff') : text('Select 2 versions', '请选择 2 个版本')}
              >
                {text('Compare Selected', '对比所选')} ({selected.length}/2)
              </button>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {text(`${versions.length} versions total`, `共 ${versions.length} 个版本`)}
              </div>
            )}
          </div>

          <div className="timeline">
            {versions.map((v) => {
              const isLatest = v.version === latestVersion;
              const t = statusTag(v.status, text);
              const canSnapshot = v.reviewId > 0;
              const isSelected = selected.includes(v.id);
              return (
                <div className="timeline-item" key={v.id}>
                  <div
                    className="timeline-dot"
                    style={isLatest ? { background: 'var(--primary)' } : undefined}
                  />
                  <div className="timeline-content">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                      {mode === 'compare' && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!canSnapshot}
                          onChange={(e) => toggleSelect(v.id, e.target.checked)}
                          title={canSnapshot ? text('Select for comparison', '勾选以加入对比') : text('This version has no file snapshot', '此版本没有文件快照')}
                          style={{ marginRight: 2 }}
                        />
                      )}
                      <span className="mono">v{v.version}</span>
                      <span className={`tag ${t.cls}`}>{t.label}</span>
                      {isLatest && <span className="tag green">Latest</span>}
                      {v.reviewId > 0 && (
                        <span
                          className="mono"
                          style={{ fontSize: 11, color: 'var(--primary)', cursor: 'pointer' }}
                          onClick={() => navigate(`/reviews/${v.reviewId}`)}
                        >→ {text('Review', '审批')} #{v.reviewId}</span>
                      )}
                      <div style={{ flex: 1 }} />
                      {mode === 'list' && (
                        <button
                          type="button"
                          className="btn sm ghost"
                          disabled={!canSnapshot}
                          onClick={() => setViewing(v)}
                          title={canSnapshot ? text('View this version file snapshot', '查看此版本的文件快照') : text('This version has no file snapshot', '此版本没有文件快照')}
                          style={{ fontSize: 11, padding: '2px 10px' }}
                        >{text('View Files', '查看文件')}</button>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>
                      <span className="mono">@{v.author}</span> · {new Date(v.createdAt).toLocaleString(locale)}
                    </div>
                    {v.note && (
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>{v.note}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {viewing && (
        <VersionFilesModal version={viewing} ns={ns} name={name} onClose={() => setViewing(null)} />
      )}
      {diffPair && (
        <VersionDiffModal base={diffPair[0]} next={diffPair[1]} onClose={() => setDiffPair(null)} />
      )}
    </>
  );
}

// --------- single-version file viewer ------------------------------------

function VersionFilesModal({
  version, ns: _ns, name: _name, onClose,
}: {
  version: SkillVersion;
  ns: string;
  name: string;
  onClose: () => void;
}) {
  const { text, locale } = useLocaleText();
  // The review_files snapshot is keyed by reviewId. We show new_content
  // (i.e. the bundle as it existed at that submission). base_content would
  // show the bundle *before* this submission and isn't useful here.
  const files = useAsync(() => api.listReviewFiles(version.reviewId), [version.reviewId]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const displayFiles = useMemo(
    () => (files.data ?? []).filter((f) => shouldDisplaySkillFile(f.path)),
    [files.data],
  );

  // Pick a sensible default file once the listing comes back. SKILL.md is
  // the most useful read; otherwise the first path alphabetically.
  useEffect(() => {
    if (!files.data || displayFiles.length === 0) return;
    if (activePath && displayFiles.some((f) => f.path === activePath)) return;
    const preferred = ['SKILL.md', 'skill.yaml'];
    const pick =
      preferred.find((p) => displayFiles.some((f) => f.path === p)) ??
      displayFiles.find((f) => f.changeKind !== 'deleted')?.path ??
      displayFiles[0].path;
    setActivePath(pick);
  }, [files.data, displayFiles, activePath]);

  const active = activePath ? displayFiles.find((f) => f.path === activePath) ?? null : null;
  const t = statusTag(version.status, text);

  return (
    <ModalShell title={`v${version.version} · ${t.label}`} subtitle={`@${version.author} · ${new Date(version.createdAt).toLocaleString(locale)}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* File list */}
        <div style={{ width: 240, borderRight: '1px solid var(--border)', overflow: 'auto', background: 'var(--bg-soft)' }}>
          {files.loading && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>}
          {files.error && <div style={{ padding: 12, fontSize: 12, color: 'var(--red-text)' }}>{files.error.message}</div>}
          {files.data && displayFiles.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-faint)' }}>{text('This version has no file snapshot', '此版本无文件快照')}</div>
          )}
          {displayFiles
            .filter((f) => f.changeKind !== 'deleted')
            .map((f) => (
              <div
                key={f.path}
                onClick={() => setActivePath(f.path)}
                style={{
                  padding: '6px 12px', fontSize: 12.5, cursor: 'pointer',
                  color: 'var(--text-muted)',
                  background: activePath === f.path ? 'var(--primary-50)' : undefined,
                  fontWeight: activePath === f.path ? 500 : 400,
                  display: 'flex', alignItems: 'center', gap: 6,
                  borderLeft: activePath === f.path ? '2px solid var(--primary)' : '2px solid transparent',
                }}
                title={f.path}
              >
                <IconFile size={12} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
                {f.changeKind === 'added' && <span style={{ fontSize: 10, color: 'var(--green-text)' }}>A</span>}
                {f.changeKind === 'modified' && <span style={{ fontSize: 10, color: 'var(--amber-text)' }}>M</span>}
              </div>
            ))}
        </div>
        {/* Viewer */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 16, background: 'var(--bg)' }}>
          {active ? (
            active.path.toLowerCase().endsWith('.md') ? (
              <div className="readme" dangerouslySetInnerHTML={{ __html: renderMarkdown(active.newContent) }} />
            ) : (
              <pre style={{
                margin: 0, padding: '12px 14px',
                background: 'var(--bg-muted)', border: '1px solid var(--border)', borderRadius: 6,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{active.newContent}</pre>
            )
          ) : (
            <div style={{ color: 'var(--text-faint)', fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
              {text('Select a file from the left to view', '从左侧选择一个文件查看')}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// --------- two-version diff ----------------------------------------------

function VersionDiffModal({
  base, next, onClose,
}: {
  base: SkillVersion;
  next: SkillVersion;
  onClose: () => void;
}) {
  const { text } = useLocaleText();
  // Fetch both versions in parallel. We only care about new_content from each
  // side; base_content (from review_files) is the previous-approved bundle,
  // which doesn't help us compare two arbitrary versions.
  const baseFiles = useAsync(() => api.listReviewFiles(base.reviewId), [base.reviewId]);
  const nextFiles = useAsync(() => api.listReviewFiles(next.reviewId), [next.reviewId]);

  // Build a path → (baseContent?, nextContent?) map so we can render a single
  // tree that includes added/removed/modified paths.
  const merged = useMemo(() => {
    const map = new Map<string, { base: string; next: string; kind: 'added' | 'deleted' | 'modified' | 'unchanged' }>();
    const a = new Map<string, string>();
    const b = new Map<string, string>();
    for (const f of baseFiles.data ?? []) {
      if (f.changeKind !== 'deleted') a.set(f.path, f.newContent);
    }
    for (const f of nextFiles.data ?? []) {
      if (f.changeKind !== 'deleted') b.set(f.path, f.newContent);
    }
    const all = new Set<string>([...a.keys(), ...b.keys()]);
    for (const p of all) {
      const aC = a.get(p);
      const bC = b.get(p);
      let kind: 'added' | 'deleted' | 'modified' | 'unchanged';
      if (aC == null && bC != null) kind = 'added';
      else if (aC != null && bC == null) kind = 'deleted';
      else if (aC === bC) kind = 'unchanged';
      else kind = 'modified';
      map.set(p, { base: aC ?? '', next: bC ?? '', kind });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, info]) => ({ path, ...info }));
  }, [baseFiles.data, nextFiles.data]);

  const changedOnly = useMemo(
    () => merged.filter((m) => m.kind !== 'unchanged' && shouldDisplaySkillFile(m.path)),
    [merged],
  );
  const [activePath, setActivePath] = useState<string | null>(null);

  useEffect(() => {
    if (activePath && changedOnly.some((m) => m.path === activePath)) return;
    if (changedOnly.length === 0) {
      setActivePath(null);
      return;
    }
    const preferred = ['SKILL.md', 'skill.yaml'];
    const pick = preferred.find((p) => changedOnly.some((m) => m.path === p)) ?? changedOnly[0].path;
    setActivePath(pick);
  }, [changedOnly, activePath]);

  const active = activePath ? merged.find((m) => m.path === activePath) ?? null : null;
  const loading = baseFiles.loading || nextFiles.loading;
  const err = baseFiles.error ?? nextFiles.error;

  return (
    <ModalShell
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {text('Compare', '对比')} <span className="mono" style={{ color: 'var(--text-faint)' }}>v{base.version}</span>
          <IconChevronRight size={12} />
          <span className="mono" style={{ color: 'var(--primary)' }}>v{next.version}</span>
        </span>
      }
      subtitle={text(`${changedOnly.length} changed files`, `${changedOnly.length} 个变更文件`)}
      onClose={onClose}
      wide
    >
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ width: 260, borderRight: '1px solid var(--border)', overflow: 'auto', background: 'var(--bg-soft)' }}>
          {loading && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>}
          {err && <div style={{ padding: 12, fontSize: 12, color: 'var(--red-text)' }}>{err.message}</div>}
          {!loading && !err && changedOnly.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-faint)' }}>{text('No differences between these versions', '两版本无差异')}</div>
          )}
          {changedOnly.map((m) => {
            const tag =
              m.kind === 'added'   ? { color: 'var(--green-text)', label: 'A' }
            : m.kind === 'deleted' ? { color: 'var(--red-text)',   label: 'D' }
            :                        { color: 'var(--amber-text)', label: 'M' };
            return (
              <div
                key={m.path}
                onClick={() => setActivePath(m.path)}
                style={{
                  padding: '6px 12px', fontSize: 12.5, cursor: 'pointer',
                  color: 'var(--text-muted)',
                  background: activePath === m.path ? 'var(--primary-50)' : undefined,
                  fontWeight: activePath === m.path ? 500 : 400,
                  display: 'flex', alignItems: 'center', gap: 6,
                  borderLeft: activePath === m.path ? '2px solid var(--primary)' : '2px solid transparent',
                }}
                title={m.path}
              >
                <span style={{ fontSize: 10, fontWeight: 700, color: tag.color, width: 12 }}>{tag.label}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.path}</span>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0, background: '#1e1e1e' }}>
          {active ? (
            <DiffEditor
              key={active.path}
              height="100%"
              language={languageFor(active.path)}
              theme="vs-dark"
              original={active.base}
              modified={active.next}
              options={{
                readOnly: true,
                renderSideBySide: true,
                minimap: { enabled: false },
                fontSize: 12.5,
                automaticLayout: true,
                renderWhitespace: 'selection',
                scrollBeyondLastLine: false,
              }}
            />
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-faint)' }}>
              {loading ? text('Loading...', '加载中...') : text('Select a file on the left to view diff', '选择左侧文件查看 diff')}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// --------- shared modal shell --------------------------------------------

function ModalShell({
  title, subtitle, onClose, children, wide = false,
}: {
  title: React.ReactNode;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const { text } = useLocaleText();
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 110,
        background: 'rgba(15,23,42,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)',
          borderRadius: 10,
          width: wide ? 'min(1100px, 96vw)' : 'min(640px, 96vw)',
          height: 'min(720px, 90vh)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(15,23,42,0.25)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
            {subtitle && (
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>{subtitle}</div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            title={text('Close', '关闭')}
            style={{
              border: 'none', background: 'transparent',
              padding: 4, color: 'var(--text-muted)', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: 4,
            }}
          ><IconXCircle size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
