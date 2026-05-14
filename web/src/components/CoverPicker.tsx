import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { COVER_PRESETS, isHexColor, resolveCover } from '../lib/profile';
import { IconX } from './Icons';

interface Props {
  open: boolean;
  me: Me;
  onClose: () => void;
  onUpdated: (me: Me) => void;
}

type Mode = 'preset' | 'custom';

export function CoverPicker({ open, me, onClose, onUpdated }: Props) {
  const initialMode: Mode = me.coverFrom && me.coverTo ? 'custom' : 'preset';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [presetId, setPresetId] = useState<string>(me.coverPreset || 'sunset');
  const initial = resolveCover(me);
  const [from, setFrom] = useState<string>(me.coverFrom || initial.from);
  const [to, setTo] = useState<string>(me.coverTo || initial.to);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Reseed from `me` whenever we (re)open the modal so the picker reflects
    // the latest server state.
    setMode(me.coverFrom && me.coverTo ? 'custom' : 'preset');
    setPresetId(me.coverPreset || 'sunset');
    const r = resolveCover(me);
    setFrom(me.coverFrom || r.from);
    setTo(me.coverTo || r.to);
    setErr(null);
    setBusy(false);
  }, [open, me]);

  if (!open) return null;

  // Preview gradient is whatever the user is currently composing.
  const previewFrom = mode === 'preset'
    ? (COVER_PRESETS.find((p) => p.id === presetId)?.from ?? from)
    : from;
  const previewTo = mode === 'preset'
    ? (COVER_PRESETS.find((p) => p.id === presetId)?.to ?? to)
    : to;

  async function submit() {
    setErr(null);
    if (mode === 'custom') {
      if (!isHexColor(from) || !isHexColor(to)) {
        setErr('颜色必须是合法的 hex（例：#4f46e5）');
        return;
      }
    }
    setBusy(true);
    try {
      const next = await api.updateMe(
        mode === 'preset'
          ? { coverPreset: presetId, coverFrom: '', coverTo: '' }
          : { coverPreset: '', coverFrom: from, coverTo: to },
      );
      onUpdated(next);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div onClick={busy ? undefined : onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg)', borderRadius: 10, width: 540, maxWidth: '94vw',
        boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>修改封面</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={busy} title="关闭"><IconX size={14} /></button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Live preview */}
          <div style={{
            height: 96, borderRadius: 8,
            background: `linear-gradient(135deg, ${previewFrom} 0%, ${previewTo} 100%)`,
            border: '1px solid var(--border)',
          }} />

          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={mode === 'preset' ? 'btn primary sm' : 'btn sm'}
              onClick={() => setMode('preset')}
            >预设</button>
            <button
              type="button"
              className={mode === 'custom' ? 'btn primary sm' : 'btn sm'}
              onClick={() => setMode('custom')}
            >自定义</button>
          </div>

          {mode === 'preset' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {COVER_PRESETS.map((p) => {
                const isActive = p.id === presetId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPresetId(p.id)}
                    style={{
                      padding: 0, border: '2px solid ' + (isActive ? 'var(--primary)' : 'var(--border)'),
                      borderRadius: 8, cursor: 'pointer', overflow: 'hidden',
                      background: 'transparent',
                      transition: 'all 0.12s', position: 'relative',
                    }}
                    title={p.label}
                  >
                    <div style={{
                      height: 56, background: `linear-gradient(135deg, ${p.from} 0%, ${p.to} 100%)`,
                    }} />
                    <div style={{
                      padding: '4px 6px', fontSize: 11, fontWeight: 500,
                      background: 'var(--bg)', color: isActive ? 'var(--primary)' : 'var(--text-subtle)',
                    }}>
                      {p.label}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {mode === 'custom' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <ColorField label="起始色" value={from} onChange={setFrom} />
              <ColorField label="结束色" value={to} onChange={setTo} />
            </div>
          )}

          {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const ok = isHexColor(value);
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="color"
          value={ok ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 36, height: 32, border: '1px solid var(--border)', borderRadius: 4, padding: 0, background: 'transparent', cursor: 'pointer' }}
        />
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#4f46e5"
          style={{ flex: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
        />
      </div>
      {!ok && value && <div style={{ fontSize: 11, color: 'var(--red-text)', marginTop: 4 }}>需要 hex 格式（如 #4f46e5）</div>}
    </label>
  );
}
