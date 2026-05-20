import { memo, useEffect, useState, type CSSProperties } from 'react';
import { useLocaleText } from '../../i18n/useLocaleText';

/** A single labelled input that holds its own typing buffer and only flushes
 *  to the parent on blur (or Enter). This avoids re-rendering the Monaco
 *  model on every keystroke when the user types in the form. */
function FrontmatterFieldImpl({
  label,
  fieldKey,
  upstream,
  placeholder,
  multiline = false,
  readOnly = false,
  onCommit,
}: {
  label: string;
  fieldKey: string;
  upstream: string;
  placeholder?: string;
  multiline?: boolean;
  readOnly?: boolean;
  onCommit: (key: string, val: string) => void;
}) {
  const [local, setLocal] = useState(upstream);
  const [focused, setFocused] = useState(false);
  // Re-sync from upstream when we're not actively typing. This catches both
  // file switches and any frontmatter edits the user might make in Monaco.
  useEffect(() => {
    if (!focused) setLocal(upstream);
  }, [upstream, focused]);
  const commit = () => {
    if (local !== upstream) onCommit(fieldKey, local);
  };
  const inputStyle: CSSProperties = {
    width: '100%',
    fontSize: 12,
    padding: '4px 8px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text)',
    fontFamily: 'inherit',
    resize: multiline ? 'vertical' : 'none',
  };
  return (
    <label style={{
      display: 'flex', gap: 8,
      alignItems: multiline ? 'flex-start' : 'center',
      fontSize: 12,
    }}>
      <span style={{
        width: 76, flexShrink: 0,
        color: 'var(--text-muted)',
        textAlign: 'right',
        paddingTop: multiline ? 5 : 0,
      }}>{label}</span>
      {multiline ? (
        <textarea
          value={local}
          readOnly={readOnly}
          placeholder={placeholder}
          rows={2}
          onChange={(e) => setLocal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(); }}
          style={inputStyle}
        />
      ) : (
        <input
          value={local}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={(e) => setLocal(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); commit(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
          }}
          style={inputStyle}
        />
      )}
    </label>
  );
}

// React.memo so re-renders of the parent caused by unrelated state (e.g. a
// keystroke in Monaco) don't redraw every form row.
export const FrontmatterField = memo(FrontmatterFieldImpl);

// --------- tags chip field -----------------------------------------------

function TagsFieldImpl({
  upstream,
  readOnly,
  onCommit,
}: {
  upstream: string;
  readOnly: boolean;
  onCommit: (key: string, val: string) => void;
}) {
  const { text } = useLocaleText();
  const [input, setInput] = useState('');
  const tags = upstream ? upstream.split(',').map((t) => t.trim()).filter(Boolean) : [];

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t || tags.includes(t)) { setInput(''); return; }
    onCommit('tags', [...tags, t].join(','));
    setInput('');
  }
  function removeTag(tag: string) {
    onCommit('tags', tags.filter((t) => t !== tag).join(','));
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
      <span style={{ width: 76, flexShrink: 0, color: 'var(--text-muted)', textAlign: 'right', paddingTop: 4 }}>tags</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: tags.length ? 4 : 0 }}>
          {tags.map((t) => (
            <span key={t} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: '1px 6px', borderRadius: 4,
              background: 'rgba(79,70,229,0.08)', color: 'var(--primary)',
              fontSize: 11, fontWeight: 500,
            }}>
              {t}
              {!readOnly && (
                <button type="button" onClick={() => removeTag(t)} style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: 0, lineHeight: 1, color: 'inherit', opacity: 0.7, fontSize: 13,
                }}>×</button>
              )}
            </span>
          ))}
        </div>
        {!readOnly && (
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input); }
              if (e.key === 'Backspace' && !input && tags.length > 0) removeTag(tags[tags.length - 1]);
            }}
            onBlur={() => { if (input.trim()) addTag(input); }}
            placeholder={tags.length ? text('Add more...', '继续添加…') : text('Type and press Enter or comma to add tags', '输入后按 Enter 或逗号添加标签')}
            style={{
              fontSize: 12, padding: '3px 8px', width: '100%',
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 4, color: 'var(--text)',
            }}
          />
        )}
      </div>
    </div>
  );
}

export const TagsField = memo(TagsFieldImpl);
