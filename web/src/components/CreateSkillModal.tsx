import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { Namespace } from '../api/types';
import { IconXCircle, IconRocket } from './Icons';

const EVENT = 'skillhub:create-skill';

export function openCreateSkill() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function CreateSkillModal() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [ns, setNs] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [classification, setClassification] = useState<'L1' | 'L2' | 'L3'>('L2');
  const [tags, setTags] = useState('');
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener(EVENT, h);
    return () => window.removeEventListener(EVENT, h);
  }, []);

  useEffect(() => {
    if (open && namespaces.length === 0) {
      api.namespaces().then((list) => {
        setNamespaces(list);
        if (list.length && !ns) setNs(list[0].id);
      }).catch(() => { /* ignore */ });
    }
  }, [open, namespaces.length, ns]);

  if (!open) return null;

  const close = () => {
    setOpen(false); setErr(null); setName(''); setDesc(''); setTags('');
  };

  const submit = async () => {
    setErr(null);
    if (!ns || !name) { setErr('命名空间和名称必填'); return; }
    setBusy(true);
    try {
      const s = await api.createSkill({
        ns, name, desc,
        classification,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      close();
      navigate(`/skills/${s.ns}/${s.name}/edit`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={close} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg)', borderRadius: 10, width: 480, maxWidth: '92vw',
        boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>创建新 Skill</h3>
          <button className="btn sm ghost" onClick={close}><IconXCircle size={14} /></button>
        </div>

        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="命名空间">
            <select className="input" value={ns} onChange={(e) => setNs(e.target.value)} style={{ width: '100%' }}>
              {namespaces.length === 0 && <option value="">加载中...</option>}
              {namespaces.map((n) => <option key={n.id} value={n.id}>{n.id}</option>)}
            </select>
          </Field>
          <Field label="Skill 名称">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-new-skill" style={{ width: '100%' }} />
          </Field>
          <Field label="描述">
            <textarea className="input" value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} placeholder="一句话说明这个 skill 的用途..." style={{ width: '100%', resize: 'vertical' }} />
          </Field>
          <Field label="密级">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['L1', 'L2', 'L3'] as const).map((lvl) => (
                <button key={lvl} type="button" onClick={() => setClassification(lvl)}
                  className={classification === lvl ? 'btn primary' : 'btn'} style={{ flex: 1 }}>
                  {lvl} {lvl === 'L1' ? '公开' : lvl === 'L2' ? '内部' : '敏感'}
                </button>
              ))}
            </div>
          </Field>
          <Field label="标签 (逗号分隔)">
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="data, sql, review" style={{ width: '100%' }} />
          </Field>
          {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={close}>取消</button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            <IconRocket size={13} /> {busy ? '创建中...' : '创建草稿'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}
