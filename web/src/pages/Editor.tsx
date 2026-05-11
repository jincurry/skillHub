import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import {
  IconCode, IconCheckCircle, IconRocket, IconChevronDown, IconChevronRight,
  IconAlertTriangle, IconXCircle, IconPlus, IconSparkles,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { SkillFile, ValidationReport } from '../api/types';
import { AIAssistDrawer, type EditorBridge } from '../components/AIAssistDrawer';
import { languageFor } from '../lib/files';

// --------- helpers --------------------------------------------------------

function bumpVersion(current?: string): string {
  if (!current) return '0.1.0';
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return current;
  const [, maj, min, patch] = m;
  return `${maj}.${parseInt(min, 10) + 1}.${patch}`;
}

const REQUIRED_FILES = new Set(['skill.yaml', 'SKILL.md', 'README.md']);

function iconFor(path: string): string {
  const ext = path.toLowerCase().split('.').pop() || '';
  if (ext === 'yaml' || ext === 'yml') return '⚙️';
  if (ext === 'md') return '📝';
  if (ext === 'go' || ext === 'py' || ext === 'ts' || ext === 'js' || ext === 'sh') return '🔧';
  if (ext === 'json' || ext === 'toml') return '🧾';
  return '📄';
}

// --------- file tree ------------------------------------------------------

interface TreeNode {
  name: string;
  path: string;             // full path for files; directory prefix for dirs
  isDir: boolean;
  children: TreeNode[];
  size?: number;
}

function buildTree(files: SkillFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const isLeaf = i === parts.length - 1;
      acc = acc ? acc + '/' + seg : seg;
      let child = node.children.find((c) => c.name === seg && c.isDir === !isLeaf);
      if (!child) {
        child = { name: seg, path: acc, isDir: !isLeaf, children: [] };
        node.children.push(child);
      }
      if (isLeaf) child.size = f.size;
      node = child;
    }
  }
  // Sort: dirs first, alpha
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

function FileTree({
  root,
  activePath,
  dirtyPaths,
  onPick,
  onDelete,
  canEdit,
}: {
  root: TreeNode;
  activePath: string | null;
  dirtyPaths: Set<string>;
  onPick: (p: string) => void;
  onDelete: (p: string) => void;
  canEdit: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (p: string) => {
    const next = new Set(collapsed);
    next.has(p) ? next.delete(p) : next.add(p);
    setCollapsed(next);
  };

  const renderNode = (n: TreeNode, depth: number): React.ReactNode => {
    if (n.isDir) {
      const isOpen = !collapsed.has(n.path);
      return (
        <div key={n.path || '(root)'}>
          {n.path && (
            <div className="file-row dir" style={{ paddingLeft: 8 + depth * 16 }} onClick={() => toggle(n.path)}>
              {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              {n.name}/
            </div>
          )}
          {(n.path === '' || isOpen) && n.children.map((c) => renderNode(c, n.path === '' ? depth : depth + 1))}
        </div>
      );
    }
    const dirty = dirtyPaths.has(n.path);
    const isActive = activePath === n.path;
    const required = REQUIRED_FILES.has(n.path);
    return (
      <div
        key={n.path}
        className={`file-row ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16, display: 'flex', alignItems: 'center', gap: 6 }}
        onClick={() => onPick(n.path)}
        title={n.path}
      >
        <span>{iconFor(n.path)}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {n.name}
        </span>
        {dirty && <span className="file-status M" title="未保存">M</span>}
        {canEdit && !required && (
          <button
            className="btn sm ghost"
            style={{ padding: '0 4px', height: 18, minWidth: 0, fontSize: 11, opacity: 0.5 }}
            title={`删除 ${n.path}`}
            onClick={(e) => { e.stopPropagation(); onDelete(n.path); }}
          >×</button>
        )}
      </div>
    );
  };
  return <>{renderNode(root, 0)}</>;
}

// --------- main page ------------------------------------------------------

export function Editor() {
  const { ns = 'platform-team', name = 'go-code-review' } = useParams();
  const navigate = useNavigate();

  const skill = useAsync(() => api.getSkill(ns, name), [ns, name]);
  const me = useAsync(() => api.me(), []);
  const members = useAsync(() => api.namespaceMembers(ns), [ns]);
  const files = useAsync(() => api.listFiles(ns, name), [ns, name]);
  const validation = useAsync<ValidationReport>(() => api.validate(ns, name), [ns, name]);
  const policy = useAsync(
    () => api.namespacePolicy(ns, (skill.data?.classification ?? 'L2') as 'L1' | 'L2' | 'L3'),
    [ns, skill.data?.classification],
  );

  // Path-keyed map of buffers we have either loaded or edited. Lets the user
  // switch between files without losing in-flight changes.
  const [buffers, setBuffers] = useState<Record<string, { content: string; dirty: boolean }>>({});
  // Tabs the user has open. The first click on a file in the tree opens it
  // here; closing a tab removes it (but keeps the file on disk).
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const inflight = useRef<Set<string>>(new Set());

  function openFile(path: string) {
    setOpenPaths((prev) => prev.includes(path) ? prev : [...prev, path]);
    setActivePath(path);
  }

  function closeFile(path: string) {
    const buf = buffers[path];
    if (buf?.dirty && !window.confirm(`${path} 有未保存修改，关闭将丢失，是否确认?`)) return;
    const idx = openPaths.indexOf(path);
    const nextOpen = openPaths.filter((p) => p !== path);
    setOpenPaths(nextOpen);
    if (activePath === path) {
      const nextActive = nextOpen[idx] ?? nextOpen[idx - 1] ?? null;
      setActivePath(nextActive);
    }
    // Drop the in-memory buffer so re-opening the file re-fetches fresh content.
    setBuffers((b) => {
      const { [path]: _gone, ...rest } = b;
      return rest;
    });
  }

  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitVersion, setSubmitVersion] = useState('');
  const [submitNote, setSubmitNote] = useState('');

  // New-file dialog state.
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileBusy, setNewFileBusy] = useState(false);
  const [newFileErr, setNewFileErr] = useState<string | null>(null);

  // AI assistant drawer. We hold the Monaco instance so the drawer can read
  // the current selection and apply edits through the editor's own command
  // pipeline (which keeps undo/redo intact).
  const [aiOpen, setAIOpen] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);

  // Pick a sensible default file once the listing comes back. SKILL.md is the
  // primary authoring surface so it wins over skill.yaml / README.md.
  useEffect(() => {
    if (!files.data || files.data.length === 0) return;
    if (activePath && files.data.some((f) => f.path === activePath)) return;
    const preferred = ['SKILL.md', 'README.md', 'skill.yaml'];
    const pick = preferred.find((p) => files.data!.some((f) => f.path === p)) ?? files.data[0].path;
    setActivePath(pick);
    setOpenPaths((prev) => prev.includes(pick) ? prev : [...prev, pick]);
  }, [files.data, activePath]);

  // Lazy-load file content on first activation.
  useEffect(() => {
    if (!activePath) return;
    if (buffers[activePath]) return;
    if (inflight.current.has(activePath)) return;
    inflight.current.add(activePath);
    api.getFile(ns, name, activePath)
      .then((f) => {
        setBuffers((b) => ({ ...b, [activePath]: { content: f.content ?? '', dirty: false } }));
      })
      .catch((e: Error) => setMsg(`加载 ${activePath} 失败: ${e.message}`))
      .finally(() => { inflight.current.delete(activePath); });
  }, [activePath, ns, name, buffers]);

  const currentVersion = skill.data?.version ?? '0.1.0';
  const nextVersion = bumpVersion(currentVersion);

  const dirtyPaths = useMemo(() => {
    const s = new Set<string>();
    for (const [p, b] of Object.entries(buffers)) {
      if (b.dirty) s.add(p);
    }
    return s;
  }, [buffers]);
  const anyDirty = dirtyPaths.size > 0;

  // Permission gate: only the author or an owner/maintainer of the namespace
  // is allowed to PUT/DELETE files. This mirrors the backend rule
  // (api.go: canEditSkill) so the editor disables UI ahead of any 403.
  const canEdit = useMemo(() => {
    if (!skill.data || !me.data) return false;
    if (skill.data.author === me.data.username) return true;
    const myRole = (members.data ?? []).find((m) => m.username === me.data!.username)?.role;
    return myRole === 'owner' || myRole === 'maintainer';
  }, [skill.data, me.data, members.data]);

  const tree = useMemo(() => buildTree(files.data ?? []), [files.data]);
  const activeBuf = activePath ? buffers[activePath] : undefined;

  useEffect(() => {
    if (showSubmit) setSubmitVersion((v) => v || nextVersion);
  }, [showSubmit, nextVersion]);

  // ---- actions ----------------------------------------------------------

  async function runValidate() {
    setMsg('验证中...');
    try {
      const r = await api.validate(ns, name);
      validation.reload();
      setMsg(`验证完成 · 得分 ${r.score}/100 · ${r.summary}`);
    } catch (e) {
      setMsg(`验证失败: ${(e as Error).message}`);
    }
  }

  async function saveActive() {
    if (!activePath || !activeBuf) return;
    if (!activeBuf.dirty) return;
    setSaving(true); setMsg(null);
    try {
      const updated = await api.putFile(ns, name, activePath, activeBuf.content);
      setBuffers((b) => ({ ...b, [activePath]: { content: updated.content ?? activeBuf.content, dirty: false } }));
      files.reload();
      setMsg(`已保存 ${activePath} (${updated.size}B)`);
    } catch (e) {
      setMsg(`保存失败: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveAll() {
    setSaving(true); setMsg(null);
    let saved = 0;
    let lastErr: Error | null = null;
    for (const [p, b] of Object.entries(buffers)) {
      if (!b.dirty) continue;
      try {
        const updated = await api.putFile(ns, name, p, b.content);
        setBuffers((bs) => ({ ...bs, [p]: { content: updated.content ?? b.content, dirty: false } }));
        saved++;
      } catch (e) {
        lastErr = e as Error;
      }
    }
    files.reload();
    setSaving(false);
    setMsg(lastErr ? `保存了 ${saved} 个,失败: ${lastErr.message}` : `已保存 ${saved} 个文件`);
  }

  function openNewFileDialog() {
    setNewFilePath('');
    setNewFileErr(null);
    setShowNewFile(true);
  }

  function closeNewFileDialog() {
    if (newFileBusy) return;
    setShowNewFile(false);
    setNewFilePath('');
    setNewFileErr(null);
  }

  async function submitNewFile() {
    const path = newFilePath.trim();
    if (!path) {
      setNewFileErr('路径不能为空');
      return;
    }
    if (path.startsWith('/') || path.includes('..')) {
      setNewFileErr('路径必须是相对路径，且不可包含 ..');
      return;
    }
    if ((files.data ?? []).some((f) => f.path === path)) {
      setNewFileErr(`文件 ${path} 已存在`);
      return;
    }
    setNewFileBusy(true);
    setNewFileErr(null);
    try {
      const f = await api.putFile(ns, name, path, '');
      setBuffers((b) => ({ ...b, [path]: { content: f.content ?? '', dirty: false } }));
      files.reload();
      openFile(path);
      setMsg(`已创建 ${path}`);
      setShowNewFile(false);
      setNewFilePath('');
    } catch (e) {
      setNewFileErr((e as Error).message);
    } finally {
      setNewFileBusy(false);
    }
  }

  async function deleteFile(p: string) {
    if (REQUIRED_FILES.has(p)) {
      setMsg(`${p} 不可删除`);
      return;
    }
    if (!window.confirm(`删除文件 ${p}? 此操作不可撤销。`)) return;
    try {
      await api.deleteFile(ns, name, p);
      setBuffers((b) => {
        const { [p]: _gone, ...rest } = b;
        return rest;
      });
      // Also remove from the tab strip.
      const idx = openPaths.indexOf(p);
      if (idx >= 0) {
        const nextOpen = openPaths.filter((x) => x !== p);
        setOpenPaths(nextOpen);
        if (activePath === p) {
          setActivePath(nextOpen[idx] ?? nextOpen[idx - 1] ?? null);
        }
      }
      files.reload();
      setMsg(`已删除 ${p}`);
    } catch (e) {
      setMsg(`删除失败: ${(e as Error).message}`);
    }
  }

  async function submitForReview() {
    if (!submitVersion.trim()) { setMsg('请填写新版本号'); return; }
    if (anyDirty) {
      if (!window.confirm('还有未保存的修改,要先保存全部再提交吗?')) return;
      await saveAll();
      if (Object.values(buffers).some((b) => b.dirty)) {
        setMsg('部分文件未能保存,提交已取消');
        return;
      }
    }
    setSubmitting(true); setMsg(null);
    try {
      const r = await api.submitForReview(ns, name, {
        version: submitVersion.trim(),
        note: submitNote.trim() || '请审批',
      });
      setShowSubmit(false);
      setMsg(`已提交 审批 #${r.id}`);
      setTimeout(() => navigate(`/reviews/${r.id}`), 600);
    } catch (e) {
      const m = (e as Error).message;
      if (m.includes('validation failed') || m.startsWith('422')) {
        validation.reload();
        setMsg('提交被拦截:存在 validation 错误,请查看右侧面板修复后再提交。');
      } else {
        setMsg(`提交失败: ${m}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // The bridge handed to the AI assistant drawer. Reads happen against the
  // live Monaco instance so we always see the user's most recent edits, and
  // writes go through executeEdits to preserve undo/redo history.
  const aiBridge = useMemo<EditorBridge>(() => ({
    getValue: () => editorRef.current?.getValue() ?? (activePath ? buffers[activePath]?.content ?? '' : ''),
    getSelection: () => {
      const ed = editorRef.current;
      if (!ed) return '';
      const sel = ed.getSelection();
      const model = ed.getModel();
      if (!sel || !model || sel.isEmpty()) return '';
      return model.getValueInRange(sel);
    },
    insertAtCursor: (text) => {
      const ed = editorRef.current;
      if (!ed) return;
      const pos = ed.getPosition();
      if (!pos) return;
      // Zero-width range at the cursor → pure insert.
      ed.executeEdits('ai-assist', [{
        range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column },
        text,
        forceMoveMarkers: true,
      }]);
      ed.focus();
    },
    replaceSelection: (text) => {
      const ed = editorRef.current;
      if (!ed) return;
      const sel = ed.getSelection();
      if (!sel || sel.isEmpty()) {
        // Fallback: nothing selected → behave like insert.
        const pos = ed.getPosition();
        if (!pos) return;
        ed.executeEdits('ai-assist', [{
          range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column },
          text,
          forceMoveMarkers: true,
        }]);
      } else {
        ed.executeEdits('ai-assist', [{ range: sel, text, forceMoveMarkers: true }]);
      }
      ed.focus();
    },
    replaceAll: (text) => {
      const ed = editorRef.current;
      const model = ed?.getModel();
      if (ed && model) {
        // Replace via executeEdits so this stays in the undo stack instead
        // of obliterating it the way setValue does.
        const fullRange = model.getFullModelRange();
        ed.executeEdits('ai-assist', [{ range: fullRange, text, forceMoveMarkers: true }]);
        ed.focus();
      } else if (activePath) {
        // Fallback when the editor isn't mounted yet — write the buffer
        // directly so the file picks up the new content on next render.
        setBuffers((b) => ({ ...b, [activePath]: { content: text, dirty: true } }));
      }
    },
    // Bridge identity changes when the active file changes — that's what we
    // want, because the drawer's `filePath` prop must agree with whatever the
    // bridge writes to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [activePath]);

  // ---- render -----------------------------------------------------------

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{ns} /</span>
            {name}
            <span className="tag indigo mono">v{currentVersion}</span>
            <span className="status-pill draft"><span className="swatch"></span>{skill.data?.status ?? 'Draft'}</span>
          </h1>
          <p className="page-subtitle">
            {files.data ? `${files.data.length} 个文件` : '加载中...'}
            {anyDirty && <span style={{ color: 'var(--amber-text)', marginLeft: 8 }}>· {dirtyPaths.size} 个未保存</span>}
            {!canEdit && skill.data && me.data && (
              <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>· 只读 (你不是作者)</span>
            )}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={runValidate}><IconCheckCircle size={14} /> Validate</button>
          <button
            className="btn"
            onClick={() => setAIOpen((v) => !v)}
            disabled={!activePath}
            title="AI 助手"
            style={aiOpen ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}
          >
            <IconSparkles size={14} /> AI 助手
          </button>
          <button
            className="btn"
            onClick={saveActive}
            disabled={!canEdit || saving || !activeBuf?.dirty}
          >
            <IconCode size={14} /> {saving ? '保存中...' : '保存'}
          </button>
          <button
            className="btn primary"
            disabled={submitting || !canEdit}
            onClick={() => setShowSubmit(true)}
          >
            <IconRocket size={14} /> {submitting ? '提交中...' : '提交审批'}
          </button>
        </div>
      </div>

      {showSubmit && (
        <div
          onClick={() => !submitting && setShowSubmit(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 10, width: 480, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>提交审批</h3>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                当前版本 <span className="mono">v{currentVersion}</span> · 默认 bump 到 <span className="mono">v{nextVersion}</span>
              </div>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'block' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>新版本号</div>
                <input className="input" value={submitVersion} onChange={(e) => setSubmitVersion(e.target.value)} placeholder={nextVersion} style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }} />
              </label>
              <label style={{ display: 'block' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>提交说明（可选）</div>
                <textarea className="input" rows={4} value={submitNote} onChange={(e) => setSubmitNote(e.target.value)} placeholder="本次变更的关键点,会显示给审批人..." style={{ width: '100%', resize: 'vertical' }} />
              </label>
              {policy.data && (
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  策略: <span className="tag indigo">{policy.data.classification}</span>{' '}
                  {policy.data.mode} · SLA <span className="mono">{policy.data.slaHours}h</span>
                  {(policy.data.suggested ?? []).length > 0 && (
                    <> · 建议审批人 {(policy.data.suggested ?? []).map((u) => `@${u}`).join(', ')}</>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowSubmit(false)} disabled={submitting}>取消</button>
              <button className="btn primary" disabled={submitting || !submitVersion.trim()} onClick={submitForReview}>
                <IconRocket size={13} /> {submitting ? '提交中...' : '确认提交'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewFile && (
        <div
          onClick={closeNewFileDialog}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); submitNewFile(); }}
            style={{ background: 'var(--bg)', borderRadius: 10, width: 440, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)' }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>新建文件</h3>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                相对路径，支持子目录（如 <span className="mono">docs/usage.md</span>）
              </div>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>路径</div>
                <input
                  className="input"
                  value={newFilePath}
                  onChange={(e) => { setNewFilePath(e.target.value); if (newFileErr) setNewFileErr(null); }}
                  placeholder="docs/usage.md"
                  autoFocus
                  disabled={newFileBusy}
                  style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }}
                />
              </label>

              <div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>常用模板</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {['README.md', 'docs/usage.md', 'examples/basic.md', 'tests/fixtures.md'].map((s) => {
                    const taken = (files.data ?? []).some((f) => f.path === s);
                    return (
                      <button
                        key={s}
                        type="button"
                        className="btn sm ghost"
                        disabled={taken || newFileBusy}
                        onClick={() => { setNewFilePath(s); setNewFileErr(null); }}
                        style={{ fontSize: 11, padding: '3px 8px', fontFamily: "'JetBrains Mono', monospace" }}
                        title={taken ? '该文件已存在' : '填入路径'}
                      >{s}</button>
                    );
                  })}
                </div>
              </div>

              {newFileErr && (
                <div style={{ fontSize: 12.5, color: 'var(--red-text)', background: 'var(--red-bg)', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--red-border, rgba(239,68,68,0.2))' }}>
                  {newFileErr}
                </div>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={closeNewFileDialog} disabled={newFileBusy}>取消</button>
              <button type="submit" className="btn primary" disabled={newFileBusy || !newFilePath.trim()}>
                <IconPlus size={13} /> {newFileBusy ? '创建中...' : '创建'}
              </button>
            </div>
          </form>
        </div>
      )}

      {msg && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderLeft: '3px solid var(--primary)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>{msg}</span>
            <button className="btn sm ghost" onClick={() => setMsg(null)}>关闭</button>
          </div>
        </div>
      )}

      <div className="editor-grid">
        <div className="editor-files" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="file-row dir" style={{ fontWeight: 600 }}>
            <IconChevronDown size={12} /> {name}
          </div>
          {files.loading && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>}
          {files.error && <div style={{ padding: 12, fontSize: 12, color: 'var(--red-text)' }}>{files.error.message}</div>}
          {files.data && (
            <FileTree
              root={tree}
              activePath={activePath}
              dirtyPaths={dirtyPaths}
              onPick={openFile}
              onDelete={deleteFile}
              canEdit={canEdit}
            />
          )}
          {canEdit && (
            <button
              className="file-tree-new"
              onClick={openNewFileDialog}
              title="新建文件"
            >
              <IconPlus size={12} /> 新建文件
            </button>
          )}
        </div>

        <div className="editor-main">
          <div className="editor-tabs">
            {openPaths.length === 0 ? (
              <div className="editor-tab" style={{ color: 'var(--text-faint)' }}>未选择文件</div>
            ) : (
              openPaths.map((p) => {
                const isActive = p === activePath;
                const dirty = buffers[p]?.dirty;
                return (
                  <div
                    key={p}
                    className={`editor-tab ${isActive ? 'active' : ''}`}
                    onClick={() => setActivePath(p)}
                    title={p}
                    style={{ paddingRight: 6 }}
                  >
                    <span>{iconFor(p)}</span>
                    <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p}</span>
                    {dirty && <span style={{ color: 'var(--amber-text)' }}>•</span>}
                    <button
                      onClick={(e) => { e.stopPropagation(); closeFile(p); }}
                      title="关闭"
                      style={{
                        width: 18, height: 18, marginLeft: 4, border: 'none', background: 'transparent',
                        color: 'var(--text-faint)', cursor: 'pointer', borderRadius: 3, fontSize: 13,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint)'; }}
                    >×</button>
                  </div>
                );
              })
            )}
          </div>
          <div className="editor-code" style={{ display: 'block', padding: 0, flex: 1, minHeight: 0, background: '#1e1e1e' }}>
            {activePath && activeBuf ? (
              <MonacoEditor
                key={activePath}
                height="100%"
                language={languageFor(activePath)}
                theme="vs-dark"
                value={activeBuf.content}
                onMount={(ed, m) => { editorRef.current = ed; monacoRef.current = m; }}
                onChange={(v) => {
                  if (!activePath) return;
                  setBuffers((b) => ({
                    ...b,
                    [activePath]: { content: v ?? '', dirty: true },
                  }));
                }}
                options={{
                  readOnly: !canEdit,
                  minimap: { enabled: false },
                  fontSize: 12.5,
                  tabSize: 2,
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  renderWhitespace: 'selection',
                }}
              />
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', background: '#1e1e1e' }}>
                {activePath ? '加载文件中...' : '请从左侧文件树选择一个文件'}
              </div>
            )}
          </div>
        </div>

        <div className="editor-side">
          <div className="editor-side-section">
            <div className="editor-side-title">审批策略</div>
            {policy.loading && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>}
            {policy.error && <div style={{ fontSize: 12, color: 'var(--red-text)' }}>{policy.error.message}</div>}
            {policy.data && (
              <div style={{ fontSize: 12, lineHeight: 1.55 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-subtle)' }}>分类</span>
                  <span className="tag indigo">{policy.data.classification}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-subtle)' }}>模式</span>
                  <span className="mono">{policy.data.mode}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-subtle)' }}>SLA</span>
                  <span className="mono">{policy.data.slaHours}h</span>
                </div>
                <div style={{ color: 'var(--text-subtle)', marginBottom: 4 }}>建议审批人</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(policy.data.suggested ?? []).map((u) => (
                    <span key={u} className="tag" style={{ fontSize: 11 }}>@{u}</span>
                  ))}
                  {(!policy.data.suggested || policy.data.suggested.length === 0) && (
                    <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>无可用审批人</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="editor-side-section">
            <div className="editor-side-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Validation</span>
              {validation.data && (
                <span className="num" style={{
                  fontSize: 11, fontWeight: 700,
                  color: validation.data.score >= 90 ? 'var(--green-text)' : validation.data.score >= 70 ? 'var(--amber-text)' : 'var(--red-text)',
                }}>{validation.data.score}/100</span>
              )}
            </div>
            {validation.loading && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>}
            {validation.error && <div style={{ fontSize: 12, color: 'var(--red-text)' }}>{validation.error.message}</div>}
            {validation.data?.checks.map((v) => {
              const cls = v.severity === 'ok' ? 'green' : v.severity === 'warn' ? 'amber' : 'red';
              const Icon = v.severity === 'ok' ? IconCheckCircle : v.severity === 'warn' ? IconAlertTriangle : IconXCircle;
              const color = v.severity === 'ok' ? 'var(--green)' : v.severity === 'warn' ? 'var(--amber)' : 'var(--red)';
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12.5 }} title={v.detail}>
                  <Icon size={14} style={{ color, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
                  <span className={`tag ${cls}`}>{v.severity === 'ok' ? '通过' : v.severity === 'warn' ? '警告' : '错误'}</span>
                </div>
              );
            })}
          </div>

          <div className="editor-side-section">
            <div className="editor-side-title">未保存的文件</div>
            {dirtyPaths.size === 0 && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>无</div>}
            {Array.from(dirtyPaths).map((p) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 12 }}>
                <span style={{ color: 'var(--amber-text)' }}>•</span>
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>{p}</span>
                <button className="btn sm ghost" style={{ padding: '0 6px', height: 20, fontSize: 11 }} onClick={() => openFile(p)}>打开</button>
              </div>
            ))}
            {dirtyPaths.size > 1 && (
              <button className="btn sm" style={{ width: '100%', marginTop: 8 }} onClick={saveAll} disabled={saving}>
                <IconCode size={12} /> {saving ? '保存中...' : `全部保存 (${dirtyPaths.size})`}
              </button>
            )}
          </div>
        </div>
      </div>

      <AIAssistDrawer
        open={aiOpen && !!activePath}
        ns={ns}
        name={name}
        filePath={activePath ?? 'SKILL.md'}
        bridge={aiBridge}
        onClose={() => setAIOpen(false)}
      />
    </div>
  );
}
