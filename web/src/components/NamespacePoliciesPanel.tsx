import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Namespace, NamespacePolicy, PolicySlot } from '../api/types';
import { IconPlus, IconXCircle } from './Icons';

// Roles a slot can require. Mirrors the validation list in
// server/internal/api/policies.go::upsertNamespacePolicy.
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'owner',      label: 'Owner' },
  { value: 'maintainer', label: 'Maintainer' },
  { value: 'reviewer',   label: 'Reviewer' },
  { value: 'member',     label: 'Member' },
];

const CLS_HINT: Record<string, string> = {
  L1: '通用 / 公开能力，最低门槛。',
  L2: '业务团队内部能力，标准审批。',
  L3: '高敏感 / 跨域能力，建议串行三审。',
};

const CLS_COLOR: Record<string, string> = {
  L1: 'var(--green-text)',
  L2: 'var(--amber-text)',
  L3: 'var(--red-text)',
};

interface Props {
  ns: string;
  namespaces: Namespace[];
  onChangeNs: (next: string) => void;
}

export function NamespacePoliciesPanel({ ns, namespaces, onChangeNs }: Props) {
  // Single source of truth for the loaded policies. We lift it into state so
  // each PolicyCard can swap in fresh data after a save without re-fetching.
  const [policies, setPolicies] = useState<NamespacePolicy[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ns) {
      setPolicies(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api.listNamespacePolicies(ns)
      .then((res) => { if (!cancelled) setPolicies(res.policies); })
      .catch((e) => { if (!cancelled) setErr((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ns]);

  if (!ns) {
    return (
      <div className="card">
        <div className="card-body" style={{ padding: '40px 28px', textAlign: 'center', color: 'var(--text-subtle)' }}>
          请先创建命名空间
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 'var(--gap)' }}>
        <div className="card-header" style={{ alignItems: 'center', gap: 10 }}>
          <h3 className="card-title">命名空间审批策略</h3>
          <select
            value={ns}
            onChange={(e) => onChangeNs(e.target.value)}
            style={{ marginLeft: 'auto', padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}
          >
            {namespaces.map((n) => (
              <option key={n.id} value={n.id}>{n.id}</option>
            ))}
          </select>
        </div>
        <div className="card-body" style={{ fontSize: 13, color: 'var(--text-subtle)', lineHeight: 1.6 }}>
          每个密级（L1 / L2 / L3）独立配置审批人槽位、SLA 和顺序。未保存覆盖时使用全局默认值。
          修改不会影响已经在审批中的请求。
        </div>
      </div>

      {loading && (
        <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>加载中...</div></div>
      )}
      {err && (
        <div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>{err}</div></div>
      )}

      {policies && policies.map((p) => (
        <PolicyCard
          key={p.classification}
          ns={ns}
          policy={p}
          onChange={(updated) => setPolicies(updated)}
        />
      ))}
    </>
  );
}

interface PolicyCardProps {
  ns: string;
  policy: NamespacePolicy;
  onChange: (allPolicies: NamespacePolicy[]) => void;
}

// PolicyCard owns its own draft state, so the user can edit freely without
// each keystroke firing a network request. Save / Reset commit the change.
function PolicyCard({ ns, policy, onChange }: PolicyCardProps) {
  // Track the loaded server values so we can detect "no changes" and disable Save.
  const [draftMode, setDraftMode] = useState(policy.mode);
  const [draftSLA, setDraftSLA] = useState(String(policy.slaHours));
  const [draftSlots, setDraftSlots] = useState<PolicySlot[]>(policy.slots);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Re-sync local state when the parent receives a new server snapshot
  // (e.g. after Reset wipes the override).
  useEffect(() => {
    setDraftMode(policy.mode);
    setDraftSLA(String(policy.slaHours));
    setDraftSlots(policy.slots);
    setErrMsg(null);
  }, [policy]);

  const slaNum = parseInt(draftSLA, 10);
  const slaInvalid = isNaN(slaNum) || slaNum < 1 || slaNum > 720;
  const slotsInvalid = draftSlots.length === 0 || draftSlots.some((s) => s.Count < 1 || s.Roles.length === 0);
  const dirty =
    draftMode !== policy.mode ||
    slaNum !== policy.slaHours ||
    JSON.stringify(draftSlots) !== JSON.stringify(policy.slots);
  const canSave = dirty && !slaInvalid && !slotsInvalid && !busy;

  const totalReviewers = draftSlots.reduce((acc, s) => acc + (s.Count || 0), 0);

  async function save() {
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await api.upsertNamespacePolicy(ns, policy.classification, {
        mode: draftMode,
        slaHours: slaNum,
        slots: draftSlots,
      });
      onChange(res.policies);
    } catch (e) {
      setErrMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!confirm(`确定要把 ${policy.classification} 重置为全局默认吗？`)) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const res = await api.deleteNamespacePolicy(ns, policy.classification);
      onChange(res.policies);
    } catch (e) {
      setErrMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 'var(--gap)' }}>
      <div className="card-header" style={{ alignItems: 'center', gap: 10 }}>
        <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
            width: 28, height: 22, borderRadius: 4,
            background: 'var(--bg-muted)', color: CLS_COLOR[policy.classification],
            fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
          }}>{policy.classification}</span>
          <span>{CLS_HINT[policy.classification]}</span>
        </h3>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {policy.isOverride ? (
            <span className="tag amber" style={{ fontSize: 11 }}><span className="dot"></span>已自定义</span>
          ) : (
            <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>使用全局默认</span>
          )}
        </div>
      </div>
      <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 240px) minmax(0, 1fr)', gap: 18 }}>
        {/* Left: SLA + mode */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>
              SLA（小时）
            </div>
            <input
              className="input"
              type="number"
              min={1}
              max={720}
              value={draftSLA}
              onChange={(e) => setDraftSLA(e.target.value)}
              style={{ width: '100%' }}
            />
            {slaInvalid && (
              <div style={{ fontSize: 11, color: 'var(--red-text)', marginTop: 4 }}>1 ~ 720 小时</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>
              审批模式
            </div>
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['parallel', 'serial'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraftMode(m)}
                  style={{
                    flex: 1, padding: '7px 0', border: 'none',
                    background: draftMode === m ? 'var(--primary)' : 'transparent',
                    color: draftMode === m ? '#fff' : 'var(--text-muted)',
                    fontSize: 12.5, cursor: 'pointer',
                    borderLeft: m === 'serial' ? '1px solid var(--border)' : 'none',
                  }}
                >
                  {m === 'parallel' ? '并行' : '串行'}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 5, lineHeight: 1.5 }}>
              {draftMode === 'parallel' ? '所有 reviewer 可同时审批，凑够即可。' : '按 slot 顺序逐个审批。'}
            </div>
          </div>
          <div style={{
            padding: 10, background: 'var(--bg-soft)', borderRadius: 6,
            fontSize: 12, color: 'var(--text-subtle)',
          }}>
            <div>共需 <span style={{ fontWeight: 600, color: 'var(--text)' }}>{totalReviewers}</span> 位 reviewer</div>
            <div style={{ marginTop: 2, fontSize: 11 }}>{draftSlots.length} 个 slot</div>
          </div>
        </div>

        {/* Right: slots editor */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
              Reviewer 槽位
              <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}>
                按优先级匹配第一个可填的角色
              </span>
            </div>
            <button
              type="button"
              className="btn sm"
              onClick={() => setDraftSlots([...draftSlots, { Roles: ['reviewer'], Count: 1 }])}
              disabled={draftSlots.length >= 8}
            >
              <IconPlus size={11} /> 新增 slot
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draftSlots.map((slot, i) => (
              <SlotRow
                key={i}
                index={i}
                slot={slot}
                canDelete={draftSlots.length > 1}
                onChange={(next) => {
                  const copy = [...draftSlots];
                  copy[i] = next;
                  setDraftSlots(copy);
                }}
                onDelete={() => setDraftSlots(draftSlots.filter((_, idx) => idx !== i))}
              />
            ))}
            {draftSlots.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--red-text)', padding: '8px 0' }}>
                至少需要 1 个 slot
              </div>
            )}
          </div>
        </div>
      </div>

      {errMsg && (
        <div style={{
          padding: '10px 16px', borderTop: '1px solid var(--border)',
          fontSize: 12, color: 'var(--red-text)', background: 'var(--red-bg)',
        }}>{errMsg}</div>
      )}

      <div style={{
        padding: '10px 16px', borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end',
      }}>
        {policy.isOverride && (
          <button
            type="button"
            className="btn sm"
            onClick={reset}
            disabled={busy}
            style={{ marginRight: 'auto', color: 'var(--text-muted)' }}
          >
            重置为默认
          </button>
        )}
        <button
          type="button"
          className="btn sm primary"
          onClick={save}
          disabled={!canSave}
          style={!canSave ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          {busy ? '保存中...' : (dirty ? '保存' : '已是最新')}
        </button>
      </div>
    </div>
  );
}

interface SlotRowProps {
  index: number;
  slot: PolicySlot;
  canDelete: boolean;
  onChange: (s: PolicySlot) => void;
  onDelete: () => void;
}

// SlotRow renders a single (roles[], count) row. The roles list is a chip
// toggle group — clicking a role flips it in/out of slot.Roles, preserving
// the rest of the array. Order matters because the auto-pick logic walks
// roles in priority order.
function SlotRow({ index, slot, canDelete, onChange, onDelete }: SlotRowProps) {
  function toggleRole(role: string) {
    const has = slot.Roles.includes(role);
    const nextRoles = has ? slot.Roles.filter((r) => r !== role) : [...slot.Roles, role];
    onChange({ ...slot, Roles: nextRoles });
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6,
      background: 'var(--bg)',
    }}>
      <span style={{
        width: 22, height: 22, fontSize: 11, fontWeight: 700,
        display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
        background: 'var(--bg-muted)', borderRadius: 11,
        color: 'var(--text-muted)',
      }}>{index + 1}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {ROLE_OPTIONS.map((r) => {
          const on = slot.Roles.includes(r.value);
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => toggleRole(r.value)}
              style={{
                padding: '3px 8px', fontSize: 11.5,
                border: '1px solid ' + (on ? 'var(--primary)' : 'var(--border)'),
                borderRadius: 4,
                background: on ? 'var(--primary)' : 'transparent',
                color: on ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >{r.label}</button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>×</span>
        <input
          type="number"
          min={1}
          max={16}
          value={slot.Count}
          onChange={(e) => onChange({ ...slot, Count: parseInt(e.target.value, 10) || 1 })}
          style={{
            width: 50, padding: '3px 6px', fontSize: 12,
            border: '1px solid var(--border)', borderRadius: 4,
            textAlign: 'center', fontFamily: "'JetBrains Mono', monospace",
          }}
        />
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={!canDelete}
        title={canDelete ? '删除此 slot' : '至少保留 1 个 slot'}
        style={{
          padding: 4, border: 'none', background: 'transparent',
          color: canDelete ? 'var(--text-faint)' : 'var(--text-faint)',
          cursor: canDelete ? 'pointer' : 'not-allowed',
          opacity: canDelete ? 1 : 0.3,
          display: 'inline-flex',
        }}
      >
        <IconXCircle size={14} />
      </button>
    </div>
  );
}
