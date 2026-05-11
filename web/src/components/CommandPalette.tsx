import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconSearch, IconBox, IconUsers, IconCheck } from './Icons';
import { api } from '../api/client';
import type { SearchResult } from '../api/types';

const EVENT = 'skillhub:command-palette';

/** Open the global command palette from anywhere in the app. */
export function openCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(EVENT));
}

interface FlatItem {
  key: string;
  bucket: 'skill' | 'namespace' | 'user';
  label: string;
  detail: string;
  to: string;
  icon: React.ReactNode;
}

function flatten(r: SearchResult): FlatItem[] {
  const out: FlatItem[] = [];
  for (const s of r.skills) {
    out.push({
      key: `s:${s.id}`,
      bucket: 'skill',
      label: `${s.ns} / ${s.name}`,
      detail: s.desc,
      to: `/skills/${s.ns}/${s.name}`,
      icon: <span className={`skill-icon ${s.iconClass}`} style={{ width: 20, height: 20, fontSize: 9, borderRadius: 4 }}>{s.icon}</span>,
    });
  }
  for (const n of r.namespaces) {
    out.push({
      key: `n:${n.id}`,
      bucket: 'namespace',
      label: n.id,
      detail: `owner @${n.owner} · ${n.count} skills`,
      to: `/skills?ns=${encodeURIComponent(n.id)}`,
      icon: <IconBox size={16} />,
    });
  }
  for (const u of r.users) {
    out.push({
      key: `u:${u.username}`,
      bucket: 'user',
      label: `@${u.username}`,
      detail: `${u.display}${u.team ? ' · ' + u.team : ''}`,
      // We don't have a public-profile route, so the most useful place to
      // land is the Browse page filtered by this user's authored skills.
      // (Clicking "我的主页" in the sidebar always shows the logged-in user.)
      to: `/skills?author=${encodeURIComponent(u.username)}`,
      icon: <IconUsers size={16} />,
    });
  }
  return out;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [data, setData] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // External event hook + Ctrl/Cmd+K shortcut.
  useEffect(() => {
    const onEvent = () => setOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // Slash opens search when not in another input.
      if (e.key === '/' && !open) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener(EVENT, onEvent);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(EVENT, onEvent);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset state on close. Focus input on open.
  useEffect(() => {
    if (open) {
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQ(''); setDebounced(''); setData(null);
    }
  }, [open]);

  // Debounce the search query.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 180);
    return () => window.clearTimeout(t);
  }, [q]);

  // Fire the search.
  useEffect(() => {
    if (!open) return;
    if (!debounced) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    api.search(debounced)
      .then((r) => { if (!cancelled) { setData(r); setActive(0); } })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced, open]);

  const flat = useMemo(() => (data ? flatten(data) : []), [data]);

  function pick(i: number) {
    const item = flat[i];
    if (!item) return;
    setOpen(false);
    navigate(item.to);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(flat.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    }
  }

  if (!open) return null;

  // Group hits visually by bucket.
  const groups: { label: string; bucket: FlatItem['bucket']; items: FlatItem[] }[] = [
    { label: 'Skills', bucket: 'skill' as const, items: flat.filter((f) => f.bucket === 'skill') },
    { label: 'Namespaces', bucket: 'namespace' as const, items: flat.filter((f) => f.bucket === 'namespace') },
    { label: 'Users', bucket: 'user' as const, items: flat.filter((f) => f.bucket === 'user') },
  ].filter((g) => g.items.length > 0);

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh', zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 12, width: 640, maxWidth: '92vw',
          maxHeight: '70vh', display: 'flex', flexDirection: 'column',
          boxShadow: '0 25px 60px rgba(15,23,42,0.35)', border: '1px solid var(--border)', overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <IconSearch size={16} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索 skill / namespace / 用户..."
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 14, color: 'var(--text)',
            }}
          />
          <span className="kbd">Esc</span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
          {!debounced && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
              开始输入查找 skill、namespace 或用户。
              <div style={{ marginTop: 6, fontSize: 11.5 }}>
                <span className="kbd">↑</span> <span className="kbd">↓</span> 选择 ·{' '}
                <span className="kbd">Enter</span> 打开 ·{' '}
                <span className="kbd">Esc</span> 关闭
              </div>
            </div>
          )}
          {debounced && loading && (
            <div style={{ padding: 16, color: 'var(--text-subtle)', fontSize: 13 }}>搜索中...</div>
          )}
          {debounced && !loading && flat.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
              没有匹配 <strong>{debounced}</strong> 的结果
            </div>
          )}
          {(() => {
            // Render each group with a header. Track running index across groups
            // so keyboard navigation lines up with the flat list.
            let idx = 0;
            return groups.map((g) => (
              <div key={g.bucket}>
                <div style={{
                  padding: '8px 16px 4px', fontSize: 10.5, fontWeight: 600,
                  color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>{g.label}</div>
                {g.items.map((item) => {
                  const myIndex = idx++;
                  const isActive = myIndex === active;
                  return (
                    <div
                      key={item.key}
                      onMouseEnter={() => setActive(myIndex)}
                      onClick={() => pick(myIndex)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '8px 16px', cursor: 'pointer',
                        background: isActive ? 'var(--primary-50, rgba(79,70,229,0.08))' : 'transparent',
                      }}
                    >
                      <span style={{ width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.label}
                        </div>
                        {item.detail && (
                          <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.detail}
                          </div>
                        )}
                      </div>
                      {isActive && <IconCheck size={14} stroke={2} />}
                    </div>
                  );
                })}
              </div>
            ));
          })()}
        </div>

        {flat.length > 0 && (
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 12 }}>
            <span><span className="kbd">↑↓</span> 选择</span>
            <span><span className="kbd">Enter</span> 打开</span>
            <span style={{ marginLeft: 'auto' }}>共 {flat.length} 条</span>
          </div>
        )}
      </div>
    </div>
  );
}
