import { useEffect, useRef, useState } from 'react';
import { IconDownload, IconChevronDown, IconCopy, IconCheck } from './Icons';
import { api } from '../api/client';
import { useLocaleText } from '../i18n/useLocaleText';
import { toast } from '../lib/toast';

interface Props {
  ns: string;
  name: string;
  version?: string;
}

/**
 * Split button: clicking the main label downloads the .tar.gz bundle;
 * clicking the chevron opens a popover with the CLI commands so users
 * who installed `skillhub` can pull / activate from the terminal.
 */
export function DownloadMenu({ ns, name, version }: Props) {
  const { text } = useLocaleText();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function doDownload() {
    try {
      await api.downloadBundle(ns, name);
    } catch (e) {
      toast.error(text('Download failed: ', '下载失败: ') + (e as Error).message);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
    }
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
  }

  const ref = `${ns}/${name}`;
  const pullCmd = `skillhub skill pull ${ref}`;
  const activateCmd = `skillhub skill activate ${ref}`;
  const getCmd = `skillhub skill get ${ref}`;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="btn"
        onClick={doDownload}
        title={text(`Download the file bundle for ${ref}${version ? ` v${version}` : ''} (.tar.gz)`, `下载 ${ref}${version ? ` v${version}` : ''} 的文件 bundle (.tar.gz)`)}
        style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, borderRight: 'none' }}
      ><IconDownload size={14} /> {text('Download', '下载')}</button>
      <button
        className="btn"
        onClick={() => setOpen((o) => !o)}
        title={text('More download options', '更多下载方式')}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '0 6px' }}
      ><IconChevronDown size={14} /></button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 30,
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
            minWidth: 360, padding: 12, fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>{text('Download Bundle', '下载 Bundle')}</div>
          <button
            className="btn sm"
            onClick={() => { setOpen(false); void doDownload(); }}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <IconDownload size={13} /> {text('Download .tar.gz in browser', '浏览器下载 .tar.gz')}
          </button>

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0 10px' }} />

          <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text)' }}>{text('Use CLI', '使用 CLI')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
            {text('After installing the ', '已安装 ')}<code style={{ background: 'var(--bg-soft)', padding: '1px 4px', borderRadius: 3 }}>skillhub</code>{text(' CLI, copy a command below and run it in your terminal:', ' CLI 后，复制以下命令到终端运行：')}
          </div>

          <CmdRow label={text('Pull to current directory', '拉取到当前目录')} cmd={pullCmd} copied={copied === 'pull'} onCopy={() => copy(pullCmd, 'pull')} />
          <CmdRow label={text('View skill details', '查看 skill 详情')} cmd={getCmd} copied={copied === 'get'} onCopy={() => copy(getCmd, 'get')} />
          <CmdRow label={text('Record an activation', '记录一次激活')} cmd={activateCmd} copied={copied === 'activate'} onCopy={() => copy(activateCmd, 'activate')} />

          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 10, lineHeight: 1.5 }}>
            {text('No CLI installed? See the "CLI" section in ', '未安装 CLI？参考 ')}<code style={{ background: 'var(--bg-soft)', padding: '1px 4px', borderRadius: 3 }}>README</code>{text('.', ' 中的「CLI」章节。')}
          </div>
        </div>
      )}
    </div>
  );
}

function CmdRow({
  label, cmd, copied, onCopy,
}: { label: string; cmd: string; copied: boolean; onCopy: () => void }) {
  const { text } = useLocaleText();
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-subtle)', marginBottom: 3 }}>{label}</div>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg-muted)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '6px 8px 6px 10px',
        }}
      >
        <span className="mono" style={{ flex: 1, fontSize: 12, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--text-faint)' }}>$ </span>{cmd}
        </span>
        <button
          onClick={onCopy}
          className="icon-btn"
          title={copied ? text('Copied', '已复制') : text('Copy command', '复制命令')}
          style={{ width: 24, height: 24, color: copied ? 'var(--green-text)' : undefined }}
        >
          {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
        </button>
      </div>
    </div>
  );
}
