import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { SkillFile } from '../../api/types';
import { iconFor } from './helpers';

function FilePickerImpl({
  files,
  onPick,
  onClose,
}: {
  files: SkillFile[];
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    if (!query) return files.slice(0, 20);
    const q = query.toLowerCase();
    return files
      .map((f) => ({ f, score: f.path.toLowerCase().indexOf(q) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.f)
      .slice(0, 20);
  }, [files, query]);

  useEffect(() => { setSel(0); }, [query]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, filtered.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const f = filtered[sel];
        if (f) { onPick(f.path); onClose(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, sel, onPick, onClose]);

  function pick(path: string) { onPick(path); onClose(); }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      zIndex: 200, paddingTop: '12vh',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg)', borderRadius: 10, width: 480, maxWidth: '92vw',
        boxShadow: '0 20px 50px rgba(15,23,42,0.28)', border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入文件名快速跳转…"
          style={{
            width: '100%', padding: '12px 16px', fontSize: 14, border: 'none',
            borderBottom: '1px solid var(--border)', background: 'var(--bg)',
            color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
          }}
        />
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-faint)' }}>没有匹配文件</div>
          )}
          {filtered.map((f, i) => (
            <div
              key={f.path}
              onClick={() => pick(f.path)}
              onMouseEnter={() => setSel(i)}
              style={{
                padding: '8px 16px', fontSize: 13, cursor: 'pointer',
                background: i === sel ? 'var(--bg-hover)' : 'transparent',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span>{iconFor(f.path)}</span>
              <span style={{ flex: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: 12.5 }}>{f.path}</span>
              {f.size != null && (
                <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{f.size}B</span>
              )}
            </div>
          ))}
        </div>
        <div style={{
          padding: '7px 16px', borderTop: '1px solid var(--border)',
          fontSize: 11, color: 'var(--text-faint)', display: 'flex', gap: 14,
        }}>
          <span>↑↓ 移动</span><span>↵ 打开</span><span>Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}

export const FilePicker = memo(FilePickerImpl);
