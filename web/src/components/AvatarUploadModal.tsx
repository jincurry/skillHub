import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { IconX, IconUpload, IconTrash } from './Icons';
import { avatarFallbackGradient } from '../lib/profile';
import { useLocaleText } from '../i18n/useLocaleText';
import { useConfirm } from './useConfirm';

interface Props {
  open: boolean;
  me: Me;
  onClose: () => void;
  onUpdated: (me: Me) => void;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const MAX_BYTES = 2 * 1024 * 1024;

export function AvatarUploadModal({ open, me, onClose, onUpdated }: Props) {
  const { isEnglish, text } = useLocaleText();
  const [confirm, confirmEl] = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset transient state every time the modal is reopened.
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setChosen(null);
      setErr(null);
      setBusy(false);
    }
  }, [open]);

  // Revoke object URLs to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (preview && preview.startsWith('blob:')) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  if (!open) return null;

  const initial = me.display?.[0]?.toUpperCase() || me.username[0]?.toUpperCase() || '?';

  function pickFile(f: File | null) {
    setErr(null);
    if (!f) return;
    if (!ACCEPT.split(',').includes(f.type)) {
      setErr(text('Unsupported format. Choose JPG / PNG / WebP / GIF.', '不支持的格式，请选 JPG / PNG / WebP / GIF'));
      return;
    }
    if (f.size > MAX_BYTES) {
      setErr(text(`File too large (${(f.size / 1024 / 1024).toFixed(2)}MB). Limit is 2MB.`, `文件过大（${(f.size / 1024 / 1024).toFixed(2)}MB），上限 2MB`));
      return;
    }
    setChosen(f);
    if (preview && preview.startsWith('blob:')) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
  }

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await api.uploadAvatar(chosen);
      onUpdated(next);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    if (!me.avatarUrl) return;
    const ok = await confirm({
      title: text('Remove avatar', '移除头像'),
      message: text(
        'Remove the current avatar and restore the default gradient?',
        '确定要清除当前头像、恢复默认渐变？',
      ),
      confirmLabel: text('Remove', '移除'),
      cancelLabel: text('Cancel', '取消'),
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      const next = await api.deleteAvatar();
      onUpdated(next);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Resolve which preview source to render: chosen file > current avatar > gradient
  const currentSrc = preview ?? (me.avatarUrl || '');

  return (
    <div onClick={busy ? undefined : onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg)', borderRadius: 10, width: 440, maxWidth: '92vw',
        boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)',
      }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{text('Change Avatar', '修改头像')}</h3>
          <button className="btn sm ghost" onClick={onClose} disabled={busy} title={text('Close', '关闭')}><IconX size={14} /></button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 128, height: 128, borderRadius: '50%', overflow: 'hidden',
            border: '4px solid var(--bg-soft)', boxShadow: 'var(--shadow-lg)',
            background: avatarFallbackGradient(me.username),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 56, fontWeight: 700, position: 'relative',
          }}>
            {currentSrc ? (
              <img src={currentSrc} alt="avatar preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : initial}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-subtle)', textAlign: 'center', lineHeight: 1.5 }}>
            {text('Supports JPG / PNG / WebP / GIF, max ', '支持 JPG / PNG / WebP / GIF，最大 ')}<strong>2MB</strong>{isEnglish ? '.' : '。'}<br />
            {text('Square images are recommended. Wide images will be cropped.', '建议正方形图，过宽会被裁剪显示。')}
          </div>

          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            style={{ display: 'none' }}
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />

          <div style={{ display: 'flex', gap: 8, width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
              <IconUpload size={13} /> {text('Choose Image', '选择图片')}
            </button>
            {me.avatarUrl && (
              <button className="btn" onClick={removeAvatar} disabled={busy} style={{ color: 'var(--red-text)' }}>
                <IconTrash size={13} /> {text('Remove Current Avatar', '移除当前头像')}
              </button>
            )}
          </div>

          {chosen && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>
              {text('Selected: ', '已选择：')}<span className="mono">{chosen.name}</span> · {(chosen.size / 1024).toFixed(0)}KB
            </div>
          )}

          {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>{text('Cancel', '取消')}</button>
          <button className="btn primary" disabled={!chosen || busy} onClick={submit}>
            {busy ? text('Uploading...', '上传中...') : text('Save', '保存')}
          </button>
        </div>
      </div>
      {confirmEl}
    </div>
  );
}
