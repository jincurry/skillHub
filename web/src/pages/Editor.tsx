import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import {
  IconCode, IconCheckCircle, IconRocket, IconChevronDown, IconChevronRight,
  IconAlertTriangle, IconXCircle, IconPlus, IconSparkles, IconPencil,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { AIAssistAction, SkillFile, ValidationReport } from '../api/types';
import { AIAssistDrawer, type EditorBridge } from '../components/AIAssistDrawer';
import { runAssist, type AssistHandle } from '../lib/aiAssist';
import { languageFor } from '../lib/files';

// --------- helpers --------------------------------------------------------

type SemverBump = 'patch' | 'minor' | 'major';

// Parse a semver-ish version into its three numeric components plus an
// optional pre-release tail (so `1.2.3-beta.4` survives intact). We don't
// try to be a full semver parser — just "good enough" to bump correctly.
function parseSemver(v: string): { maj: number; min: number; patch: number; tail: string } | null {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) return null;
  return { maj: +m[1], min: +m[2], patch: +m[3], tail: m[4] || '' };
}

function bumpVersion(current?: string, kind: SemverBump = 'patch'): string {
  if (!current) return '0.1.0';
  const p = parseSemver(current);
  if (!p) return current;
  // We deliberately drop the pre-release tail on a bump — semver says a
  // pre-release is "less than" the release, so 1.2.3-beta + patch must
  // become 1.2.4, not 1.2.4-beta.
  switch (kind) {
    case 'major': return `${p.maj + 1}.0.0`;
    case 'minor': return `${p.maj}.${p.min + 1}.0`;
    default:      return `${p.maj}.${p.min}.${p.patch + 1}`;
  }
}

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const REQUIRED_FILES = new Set(['skill.yaml', 'SKILL.md', 'README.md']);

// Draft backup keys live under one namespace so we can sweep them later
// (e.g. on logout) without hitting unrelated keys.
function draftKeyFor(ns: string, name: string, path: string): string {
  return `skillHub:draft:${ns}/${name}/${path}`;
}

// Debounce window for the network autosave. The localStorage backup is
// written eagerly on every buffer change since it's cheap.
const AUTOSAVE_MS = 1500;

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
  onRename,
  canEdit,
}: {
  root: TreeNode;
  activePath: string | null;
  dirtyPaths: Set<string>;
  onPick: (p: string) => void;
  onDelete: (p: string) => void;
  /** Called with (oldPath, newPath). Should return true on success so the
      inline editor can close itself. */
  onRename: (oldPath: string, newPath: string) => Promise<boolean>;
  canEdit: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Path currently being inline-renamed (null = none).
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  const toggle = (p: string) => {
    const next = new Set(collapsed);
    next.has(p) ? next.delete(p) : next.add(p);
    setCollapsed(next);
  };
  const startRename = (p: string) => {
    setRenaming(p);
    setRenameValue(p);
    setRenameErr(null);
  };
  const cancelRename = () => {
    if (renameBusy) return;
    setRenaming(null);
    setRenameValue('');
    setRenameErr(null);
  };
  const commitRename = async () => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === renaming) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    setRenameErr(null);
    try {
      const ok = await onRename(renaming, next);
      if (ok) {
        setRenaming(null);
        setRenameValue('');
      }
    } catch (e) {
      setRenameErr((e as Error).message);
    } finally {
      setRenameBusy(false);
    }
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
    const isRenaming = renaming === n.path;
    if (isRenaming) {
      // While renaming we replace the row with an inline form. We keep the
      // same paddingLeft so the user's eye doesn't jump.
      return (
        <div key={n.path} style={{ paddingLeft: 8 + depth * 16, padding: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{iconFor(n.path)}</span>
            <input
              autoFocus
              value={renameValue}
              disabled={renameBusy}
              onChange={(e) => { setRenameValue(e.target.value); if (renameErr) setRenameErr(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1, minWidth: 0,
                fontSize: 12, fontFamily: 'var(--font-mono, monospace)',
                padding: '2px 6px', height: 22,
                border: '1px solid var(--primary, #4f46e5)', borderRadius: 4,
                background: 'var(--bg)', color: 'var(--text)',
              }}
            />
            <button
              className="btn sm primary"
              style={{ height: 22, padding: '0 6px', fontSize: 11 }}
              disabled={renameBusy}
              onClick={(e) => { e.stopPropagation(); commitRename(); }}
            >{renameBusy ? '...' : 'OK'}</button>
            <button
              className="btn sm ghost"
              style={{ height: 22, padding: '0 6px', fontSize: 11 }}
              disabled={renameBusy}
              onClick={(e) => { e.stopPropagation(); cancelRename(); }}
            >取消</button>
          </div>
          {renameErr && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--red-text, #b91c1c)' }}>{renameErr}</div>
          )}
        </div>
      );
    }
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
          <>
            <button
              className="btn sm ghost"
              style={{ padding: '0 4px', height: 18, minWidth: 0, opacity: 0.5 }}
              title={`重命名 ${n.path}`}
              onClick={(e) => { e.stopPropagation(); startRename(n.path); }}
            ><IconPencil size={11} /></button>
            <button
              className="btn sm ghost"
              style={{ padding: '0 4px', height: 18, minWidth: 0, fontSize: 11, opacity: 0.5 }}
              title={`删除 ${n.path}`}
              onClick={(e) => { e.stopPropagation(); onDelete(n.path); }}
            >×</button>
          </>
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
      // Prefer the neighbour to the right (same idx in the filtered list);
      // otherwise the one to the left; otherwise we drop to "no active".
      const nextActive = nextOpen[idx] ?? nextOpen[idx - 1] ?? null;
      setActivePath(nextActive);
    }
    // Keep clean buffers cached — switching back to a closed tab should be
    // instant. Only dirty buffers were already gated by the confirm above.
    if (buf?.dirty) {
      setBuffers((b) => {
        const { [path]: _gone, ...rest } = b;
        return rest;
      });
    }
  }

  const [submitting, setSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitVersion, setSubmitVersion] = useState('');
  const [submitNote, setSubmitNote] = useState('');
  // Hotfix channel: requires owner/maintainer + a written reason. The submit
  // call below sends both fields; backend re-validates the role gate.
  const [submitHotfix, setSubmitHotfix] = useState(false);
  const [submitHotfixReason, setSubmitHotfixReason] = useState('');

  // New-file dialog state.
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileBusy, setNewFileBusy] = useState(false);
  const [newFileErr, setNewFileErr] = useState<string | null>(null);

  // AI assistant drawer. We hold the Monaco instance so the drawer can read
  // the current selection and apply edits through the editor's own command
  // pipeline (which keeps undo/redo intact).
  const [aiOpen, setAIOpen] = useState(false);
  const [aiTrigger, setAiTrigger] = useState<{ action: AIAssistAction; instruction?: string } | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  // Monaco namespace handle captured at mount time. We need this to create
  // and look up models by URI, dispose them on cleanup, and access view
  // states. It's null until the editor has mounted.
  const monacoNsRef = useRef<Parameters<OnMount>[1] | null>(null);
  // Set of paths we've materialised as Monaco models. Lets the cleanup
  // pass dispose orphaned models without scanning every URI.
  const modelsRef = useRef<Set<string>>(new Set());
  // Saved view state (scroll + cursor + selection + folding) keyed by path.
  // We snapshot on tab-switch-out and restore on tab-switch-in so the user
  // never loses their place.
  type ViewState = ReturnType<NonNullable<Parameters<OnMount>[0]['saveViewState']>>;
  const viewStatesRef = useRef<Map<string, ViewState>>(new Map());
  // Guard so external rewrites (save normalization, AI replaceAll) don't
  // re-enter as user edits and stamp the buffer dirty after we just made
  // it clean.
  const externalWriteRef = useRef(false);
  // Force the model-sync effect to re-run once the editor finishes mounting.
  const [editorMountTick, setEditorMountTick] = useState(0);

  // Autosave: debounce per-path. localStorage backup runs alongside so
  // crashed browsers / closed tabs can recover unsaved work even when
  // autosave is disabled or the network is down.
  const [autosaveOn, setAutosaveOn] = useState<boolean>(() => {
    try { return localStorage.getItem('skillHub.editor.autosave') !== '0'; }
    catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('skillHub.editor.autosave', autosaveOn ? '1' : '0'); }
    catch { /* private mode etc. — ignore */ }
  }, [autosaveOn]);
  const autosaveTimers = useRef<Map<string, number>>(new Map());
  // Latest buffers reachable from inside the (delayed) autosave callback
  // without going stale. We update this on every render below.
  const buffersRef = useRef(buffers);
  // Per-path drafts the user hasn't responded to yet. When a file is
  // loaded from the server and the local backup disagrees, we surface a
  // banner instead of silently overwriting either side.
  const [pendingRestore, setPendingRestore] = useState<Record<string, { content: string; ts: number }>>({});

  // AI 起草提交说明：直接流式写入 submitNote，不走抽屉。
  const [draftingNote, setDraftingNote] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const draftHandleRef = useRef<AssistHandle | null>(null);
  // Buffer for streamed deltas; we flush to React state on rAF so a fast
  // token stream doesn't block the main thread (otherwise the stop / submit
  // buttons feel frozen because click events can't get scheduled).
  const draftBufRef = useRef('');
  const draftRafRef = useRef<number | null>(null);

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

  // Lazy-load file content on first activation. After the server responds
  // we also peek at the localStorage backup for the same path; if the
  // backup disagrees with what the server has, we queue a restore prompt
  // instead of silently overwriting either side.
  useEffect(() => {
    if (!activePath) return;
    if (buffers[activePath]) return;
    if (inflight.current.has(activePath)) return;
    inflight.current.add(activePath);
    api.getFile(ns, name, activePath)
      .then((f) => {
        const server = f.content ?? '';
        setBuffers((b) => ({ ...b, [activePath]: { content: server, dirty: false } }));
        // Check for a local draft backup the user might want to restore.
        try {
          const raw = localStorage.getItem(draftKeyFor(ns, name, activePath));
          if (!raw) return;
          const parsed = JSON.parse(raw) as { content: string; ts: number };
          if (parsed && typeof parsed.content === 'string' && parsed.content !== server) {
            setPendingRestore((p) => ({ ...p, [activePath]: parsed }));
          } else {
            // Backup matches the server (or is corrupt) — clean it up.
            localStorage.removeItem(draftKeyFor(ns, name, activePath));
          }
        } catch { /* private mode / quota — ignore */ }
      })
      .catch((e: Error) => setMsg(`加载 ${activePath} 失败: ${e.message}`))
      .finally(() => { inflight.current.delete(activePath); });
  }, [activePath, ns, name, buffers]);

  const currentVersion = skill.data?.version ?? '0.1.0';
  // The submit modal lets the user pick patch/minor/major; we keep the
  // selected kind in state so the displayed default reacts to the chips.
  const [bumpKind, setBumpKind] = useState<SemverBump>('patch');
  const nextVersion = bumpVersion(currentVersion, bumpKind);

  const dirtyPaths = useMemo(() => {
    const s = new Set<string>();
    for (const [p, b] of Object.entries(buffers)) {
      if (b.dirty) s.add(p);
    }
    return s;
  }, [buffers]);
  const anyDirty = dirtyPaths.size > 0;

  // Warn users before leaving the page with unsaved edits.
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

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

  // ---- Monaco model management -----------------------------------------
  //
  // The previous implementation passed `key={activePath}` and `value` to
  // <MonacoEditor/>, which remounted the whole editor on every tab switch.
  // That blew away the undo stack, scroll position, and the syntax-highlight
  // worker each time. Instead we now keep one editor instance alive and
  // swap models per path. Each model owns its own undo history, and we
  // snapshot the editor's view state on tab-switch-out / restore it on
  // tab-switch-in so scroll + cursor + folding stays put.

  // Trampoline so the keybindings registered in onMount always call the
  // latest version of these handlers (otherwise they'd freeze the closure
  // captured at mount time).
  const handlersRef = useRef({ saveActive: () => {}, saveAll: () => {} });

  const modelUriFor = (m: Parameters<OnMount>[1], path: string) =>
    m.Uri.parse(`inmemory:///${encodeURIComponent(path)}`);
  const pathFromUri = (uri: { path: string }) =>
    decodeURIComponent(uri.path.replace(/^\//, ''));

  // Keep model content + active-tab in sync with React state. Re-runs on
  // editor mount (via editorMountTick), tab switch, and external content
  // changes (save normalization, AI replaceAll).
  useEffect(() => {
    const ed = editorRef.current;
    const m = monacoNsRef.current;
    if (!ed || !m || !activePath || !activeBuf) return;

    // Snapshot the outgoing tab's scroll/cursor before we swap.
    const prevModel = ed.getModel();
    if (prevModel) {
      const prevPath = pathFromUri(prevModel.uri);
      if (prevPath && prevPath !== activePath) {
        const vs = ed.saveViewState();
        if (vs) viewStatesRef.current.set(prevPath, vs);
      }
    }

    const uri = modelUriFor(m, activePath);
    let model = m.editor.getModel(uri);
    if (!model) {
      model = m.editor.createModel(activeBuf.content, languageFor(activePath), uri);
      modelsRef.current.add(activePath);
      // Word-wrap is ergonomic for prose, distracting for code. Switch
      // per-model so .md tabs wrap and .yaml/.go tabs don't.
      const wrapY = ['markdown', 'plaintext'].includes(languageFor(activePath));
      // Editor-level option (we'll override it again on each setModel).
      ed.updateOptions({ wordWrap: wrapY ? 'on' : 'off' });
      model.onDidChangeContent(() => {
        if (externalWriteRef.current) return;
        const content = model!.getValue();
        const p = pathFromUri(model!.uri);
        setBuffers((b) => {
          const existing = b[p];
          if (existing && existing.content === content) return b;
          return { ...b, [p]: { content, dirty: true } };
        });
      });
    } else if (model.getValue() !== activeBuf.content) {
      // External rewrite (e.g. server-normalized save). Use setValue
      // instead of executeEdits because the change is whole-file. The
      // guard prevents the change listener from re-marking dirty.
      externalWriteRef.current = true;
      try { model.setValue(activeBuf.content); }
      finally { externalWriteRef.current = false; }
    }

    if (ed.getModel() !== model) {
      ed.setModel(model);
      const wrapY = ['markdown', 'plaintext'].includes(languageFor(activePath));
      ed.updateOptions({ wordWrap: wrapY ? 'on' : 'off' });
      const saved = viewStatesRef.current.get(activePath);
      if (saved) ed.restoreViewState(saved);
      ed.focus();
    }
  }, [activePath, activeBuf, editorMountTick]);

  // Keep readOnly in sync without remounting. canEdit can flip after the
  // members.data load completes.
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !canEdit });
  }, [canEdit]);

  // Dispose models for files that have been deleted/renamed away. Called
  // whenever the file listing changes; the rename flow re-keys buffers and
  // openPaths, so the freshly-named file will materialise on next activate.
  useEffect(() => {
    const m = monacoNsRef.current;
    if (!m || !files.data) return;
    const alive = new Set(files.data.map((f) => f.path));
    for (const p of Array.from(modelsRef.current)) {
      if (alive.has(p)) continue;
      m.editor.getModel(modelUriFor(m, p))?.dispose();
      modelsRef.current.delete(p);
      viewStatesRef.current.delete(p);
    }
  }, [files.data]);

  // Final cleanup on unmount: drop every model we created so nothing leaks
  // into the global Monaco registry.
  useEffect(() => {
    return () => {
      const m = monacoNsRef.current;
      if (!m) return;
      for (const p of Array.from(modelsRef.current)) {
        m.editor.getModel(modelUriFor(m, p))?.dispose();
      }
      modelsRef.current.clear();
      viewStatesRef.current.clear();
    };
  }, []);

  // Build a map of all file contents for cross-file AI context.
  const allFilesMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const [p, b] of Object.entries(buffers)) {
      if (p !== activePath) m[p] = b.content;
    }
    return m;
  }, [buffers, activePath]);

  // Stream a commit-summary directly into the submitNote textarea, bypassing
  // the AI drawer entirely. The drawer's z-index sits below the modal, and
  // its output goes into its own buffer — neither is useful here.
  function stopDraft() {
    draftHandleRef.current?.abort();
    draftHandleRef.current = null;
    if (draftRafRef.current != null) {
      cancelAnimationFrame(draftRafRef.current);
      draftRafRef.current = null;
    }
    // Flush any buffered tail so the user keeps what was already streamed.
    if (draftBufRef.current) {
      const tail = draftBufRef.current;
      draftBufRef.current = '';
      setSubmitNote((prev) => prev + tail);
    }
    setDraftingNote(false);
  }

  async function draftSubmitNote() {
    if (draftingNote) {
      stopDraft();
      return;
    }
    setDraftErr(null);
    let providerId: number | null = null;
    try {
      const list = await api.listAIProviderRefs();
      const def = list.find((p) => p.isDefault) ?? list[0];
      if (!def) {
        setDraftErr('未配置 AI 模型，请联系管理员');
        return;
      }
      providerId = def.id;
    } catch (e) {
      setDraftErr((e as Error).message);
      return;
    }
    // Use SKILL.md if present in buffers, otherwise the active buffer.
    const skillMd = buffers['SKILL.md']?.content;
    const content = skillMd ?? (activePath ? buffers[activePath]?.content ?? '' : '');
    const filePath = skillMd ? 'SKILL.md' : (activePath ?? 'SKILL.md');
    setSubmitNote('');
    draftBufRef.current = '';
    setDraftingNote(true);
    const flush = () => {
      draftRafRef.current = null;
      if (!draftBufRef.current) return;
      const chunk = draftBufRef.current;
      draftBufRef.current = '';
      setSubmitNote((prev) => prev + chunk);
    };
    draftHandleRef.current = runAssist(ns, name, {
      providerId,
      action: 'commit-summary',
      currentContent: content,
      filePath,
    }, {
      onDelta: (chunk) => {
        draftBufRef.current += chunk;
        if (draftRafRef.current == null) {
          draftRafRef.current = requestAnimationFrame(flush);
        }
      },
      onDone: () => {
        flush();
        setDraftingNote(false);
        draftHandleRef.current = null;
      },
      onError: (m) => {
        flush();
        setDraftErr(m);
        setDraftingNote(false);
        draftHandleRef.current = null;
      },
    });
  }

  // Cancel any in-flight draft when the modal closes.
  useEffect(() => {
    if (!showSubmit && draftHandleRef.current) {
      stopDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSubmit]);

  // Collect validation error strings for the AI fix-validation action.
  const validationErrors = useMemo(() => {
    if (!validation.data) return [];
    return validation.data.checks
      .filter((c) => c.severity === 'err' || c.severity === 'warn')
      .map((c) => `[${c.severity}] ${c.label}: ${c.detail}`);
  }, [validation.data]);

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
      // Re-run validation in the background so the side panel doesn't
      // lie about the state of the file the user just saved.
      validation.reload();
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
    validation.reload();
    setSaving(false);
    setMsg(lastErr ? `保存了 ${saved} 个,失败: ${lastErr.message}` : `已保存 ${saved} 个文件`);
  }

  // Keep the handler trampoline pointed at the latest closure on every
  // render. Monaco's addCommand snapshots the function passed to it; without
  // this, Cmd+S would keep firing the closure captured at editor mount and
  // miss every state change since.
  useEffect(() => {
    handlersRef.current = { saveActive, saveAll };
  });

  // Keep buffersRef synced so debounced timers always see fresh state.
  useEffect(() => { buffersRef.current = buffers; });

  // Autosave + localStorage backup. We re-schedule on every buffer mutation
  // so the timer effectively "stretches" while the user keeps typing. The
  // localStorage write fires on a tighter debounce so a crashed browser
  // still recovers the user's most recent keystrokes.
  useEffect(() => {
    for (const [p, b] of Object.entries(buffers)) {
      const prev = autosaveTimers.current.get(p);
      if (!b.dirty) {
        // Going clean — cancel any pending save and clear the local backup.
        if (prev) { clearTimeout(prev); autosaveTimers.current.delete(p); }
        try { localStorage.removeItem(draftKeyFor(ns, name, p)); } catch { /* ignore */ }
        continue;
      }
      // Local backup: cheap, do it eagerly so even non-autosave users get
      // crash recovery.
      try {
        localStorage.setItem(
          draftKeyFor(ns, name, p),
          JSON.stringify({ content: b.content, ts: Date.now() }),
        );
      } catch { /* quota / private mode — non-fatal */ }
      // Network autosave: opt-out via toggle, gated on edit permission.
      if (!autosaveOn || !canEdit) {
        if (prev) { clearTimeout(prev); autosaveTimers.current.delete(p); }
        continue;
      }
      if (prev) clearTimeout(prev);
      const timer = window.setTimeout(async () => {
        autosaveTimers.current.delete(p);
        const cur = buffersRef.current[p];
        if (!cur || !cur.dirty) return;
        try {
          const updated = await api.putFile(ns, name, p, cur.content);
          setBuffers((bs) => {
            const exist = bs[p];
            // If the user kept typing during the round-trip the buffer is
            // already past `cur.content`; leave it dirty so the next tick
            // schedules another save.
            if (!exist || exist.content !== cur.content) return bs;
            return { ...bs, [p]: { content: updated.content ?? cur.content, dirty: false } };
          });
          try { localStorage.removeItem(draftKeyFor(ns, name, p)); } catch { /* ignore */ }
          // Don't trample an existing toast on every silent save.
          validation.reload();
        } catch (e) {
          setMsg(`自动保存 ${p} 失败: ${(e as Error).message}`);
        }
      }, AUTOSAVE_MS);
      autosaveTimers.current.set(p, timer);
    }
    // We deliberately omit ns/name from deps — they're stable for the
    // life of the page and adding them only adds noise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buffers, autosaveOn, canEdit]);

  // Apply / discard a localStorage draft surfaced by pendingRestore. We
  // mark the buffer dirty after restore so the next autosave tick (or the
  // user's first Cmd+S) flushes the restored content to the server.
  function applyRestore(path: string) {
    const draft = pendingRestore[path];
    if (!draft) return;
    setBuffers((b) => ({ ...b, [path]: { content: draft.content, dirty: true } }));
    setPendingRestore((p) => { const { [path]: _, ...rest } = p; return rest; });
  }
  function discardRestore(path: string) {
    setPendingRestore((p) => { const { [path]: _, ...rest } = p; return rest; });
    try { localStorage.removeItem(draftKeyFor(ns, name, path)); } catch { /* ignore */ }
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

  /**
   * Rename / move a file in the bundle. We keep the in-memory buffer (with
   * dirty state preserved) and rekey tabs so the user doesn't lose work.
   * Returns true on success so the inline rename input can close itself.
   */
  async function renameFile(oldPath: string, newPath: string): Promise<boolean> {
    if (REQUIRED_FILES.has(oldPath)) {
      throw new Error(`${oldPath} 不可重命名`);
    }
    if ((files.data ?? []).some((f) => f.path === newPath)) {
      throw new Error(`${newPath} 已存在`);
    }
    const buf = buffers[oldPath];
    // If the user has unsaved edits we'd lose them after the server
    // re-reads the file (since rename returns the on-disk content). Flush
    // them upstream first.
    if (buf?.dirty) {
      try {
        await api.putFile(ns, name, oldPath, buf.content);
      } catch (e) {
        throw new Error(`保存原文件失败: ${(e as Error).message}`);
      }
    }
    await api.renameFile(ns, name, oldPath, newPath);
    setBuffers((b) => {
      const { [oldPath]: prev, ...rest } = b;
      if (!prev) return rest;
      return { ...rest, [newPath]: { content: prev.content, dirty: false } };
    });
    setOpenPaths((prev) => prev.map((x) => (x === oldPath ? newPath : x)));
    setActivePath((cur) => (cur === oldPath ? newPath : cur));
    files.reload();
    setMsg(`已重命名 ${oldPath} → ${newPath}`);
    return true;
  }

  async function submitForReview() {
    const ver = submitVersion.trim();
    if (!ver) { setMsg('请填写新版本号'); return; }
    if (!SEMVER_RE.test(ver)) { setMsg('版本号需符合 semver(如 1.2.3 / 1.2.3-beta.1)'); return; }
    if (ver === currentVersion) { setMsg('新版本号与当前一致,请 bump'); return; }
    if (submitHotfix && !submitHotfixReason.trim()) {
      setMsg('启用 Hotfix 通道时必须填写紧急原因'); return;
    }
    // If a draft is still streaming, stop it first so we submit what we have.
    if (draftingNote) stopDraft();
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
        version: ver,
        note: submitNote.trim() || '请审批',
        isHotfix: submitHotfix,
        hotfixReason: submitHotfix ? submitHotfixReason.trim() : undefined,
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
            <button className="btn" onClick={runValidate} title="重新校验所有文件"><IconCheckCircle size={14} /> Validate</button>
          <button
            className={`btn ${autosaveOn ? '' : 'ghost'}`}
            onClick={() => setAutosaveOn((v) => !v)}
            title={autosaveOn ? '自动保存已开启 · 1.5 秒无输入后落盘' : '自动保存已关闭 · 仍会备份到本地以防丢失'}
            style={autosaveOn ? { color: 'var(--green-text)', borderColor: 'var(--green)' } : { color: 'var(--text-faint)' }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: autosaveOn ? 'var(--green)' : 'var(--text-faint)', display: 'inline-block', marginRight: 4 }} />
            自动保存 {autosaveOn ? 'ON' : 'OFF'}
          </button>
          <button
            className="btn"
            onClick={() => setAIOpen((v) => !v)}
            disabled={!activePath}
            title="AI 助手"
            style={aiOpen ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}
          >
            <IconSparkles size={14} /> AI 助手
          </button>
          {/* Split save: the primary half saves the active file, the right
              half flushes every dirty buffer. Only shows the count badge
              when there is more than one dirty file so it doesn't shout. */}
          <div style={{ display: 'inline-flex', gap: 0 }}>
            <button
              className="btn"
              onClick={saveActive}
              disabled={!canEdit || saving || !activeBuf?.dirty}
              title="保存当前文件 (Ctrl/Cmd+S)"
              style={dirtyPaths.size > 1 ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : undefined}
            >
              <IconCode size={14} /> {saving ? '保存中...' : '保存'}
            </button>
            {dirtyPaths.size > 1 && (
              <button
                className="btn"
                onClick={saveAll}
                disabled={!canEdit || saving}
                title="保存所有未保存的文件 (Ctrl/Cmd+Shift+S)"
                style={{ borderLeft: 'none', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '0 8px' }}
              >
                全部 ({dirtyPaths.size})
              </button>
            )}
          </div>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>新版本号</span>
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    {(['patch', 'minor', 'major'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={`btn sm ${bumpKind === k ? 'primary' : 'ghost'}`}
                        style={{ padding: '2px 8px', fontSize: 11 }}
                        onClick={() => {
                          setBumpKind(k);
                          // Auto-update the input only if the user hasn't
                          // overridden it manually away from a known bump.
                          const candidates: SemverBump[] = ['patch', 'minor', 'major'];
                          const known = candidates.map((c) => bumpVersion(currentVersion, c));
                          if (!submitVersion || known.includes(submitVersion)) {
                            setSubmitVersion(bumpVersion(currentVersion, k));
                          }
                        }}
                      >{k}</button>
                    ))}
                  </div>
                </div>
                <input className="input" value={submitVersion} onChange={(e) => setSubmitVersion(e.target.value)} placeholder={nextVersion} style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }} />
                {submitVersion && !SEMVER_RE.test(submitVersion) && (
                  <div style={{ fontSize: 11, color: 'var(--red-text)', marginTop: 4 }}>不是合法 semver 格式</div>
                )}
              </label>
              <label style={{ display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>提交说明（可选）</span>
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ fontSize: 10.5, padding: '2px 8px', gap: 4 }}
                    onClick={draftSubmitNote}
                    disabled={submitting}
                    title={draftingNote ? '点击停止生成' : '让 AI 根据文档内容起草提交说明'}
                  >
                    <IconSparkles size={11} /> {draftingNote ? '生成中... 点击停止' : 'AI 起草'}
                  </button>
                </div>
                <textarea className="input" rows={4} value={submitNote} onChange={(e) => setSubmitNote(e.target.value)} placeholder={draftingNote ? 'AI 正在生成...' : '本次变更的关键点,会显示给审批人...'} style={{ width: '100%', resize: 'vertical' }} />
                {draftErr && (
                  <div style={{ fontSize: 11.5, color: 'var(--red-text)', marginTop: 4 }}>{draftErr}</div>
                )}
              </label>
              {/* Hotfix channel: relaxes policy to 1 approver / 4h SLA. Backend
                  rejects this if the user isn't ns owner/maintainer. */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={submitHotfix}
                    onChange={(e) => setSubmitHotfix(e.target.checked)}
                    style={{ accentColor: 'var(--red)' }}
                  />
                  <span style={{ fontWeight: 600, color: submitHotfix ? 'var(--red-text)' : 'var(--text)' }}>
                    Hotfix 紧急通道
                  </span>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>
                    1 审批人 · SLA 4h · 仅生产事故
                  </span>
                </label>
                {submitHotfix && (
                  <div style={{ marginTop: 8 }}>
                    <textarea
                      className="input"
                      rows={2}
                      value={submitHotfixReason}
                      onChange={(e) => setSubmitHotfixReason(e.target.value)}
                      placeholder="必填:简要说明紧急原因(将进入审计日志)"
                      style={{ width: '100%', resize: 'vertical', borderColor: 'var(--red)' }}
                    />
                  </div>
                )}
              </div>
              {/* Policy summary — switches between the namespace policy and
                  the hotfix policy preview so the user always knows what
                  rule set their submission will be evaluated against. */}
              {submitHotfix ? (
                <div style={{ fontSize: 12, color: 'var(--red-text)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  Hotfix 策略: <span className="mono">1 审批人</span> · SLA <span className="mono">4h</span> · 自动绕过分类升级
                  <div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 2 }}>
                    将进入紧急审批通道,后续会进入审计日志。
                  </div>
                </div>
              ) : policy.data && (
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  策略: <span className="tag indigo">{policy.data.classification}</span>{' '}
                  {policy.data.mode} · SLA <span className="mono">{policy.data.slaHours}h</span>
                  {(policy.data.suggested ?? []).length > 0 && (
                    <> · 建议审批人 {(policy.data.suggested ?? []).map((u) => `@${u}`).join(', ')}</>
                  )}
                </div>
              )}
              {/* Dirty file preview — saves the reviewer (and the author!)
                  from "what's in this submission again?" anxiety. */}
              {dirtyPaths.size > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ marginBottom: 4 }}>
                    <span style={{ color: 'var(--amber-text)', fontWeight: 600 }}>{dirtyPaths.size}</span>{' '}
                    个未保存文件,提交前会先保存:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {Array.from(dirtyPaths).map((p) => (
                      <span key={p} className="tag" style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{p}</span>
                    ))}
                  </div>
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
              onRename={renameFile}
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
          {activePath && pendingRestore[activePath] && (
            <div style={{
              padding: '8px 12px', borderBottom: '1px solid var(--border)',
              background: 'var(--amber-bg)', color: 'var(--amber-text)',
              fontSize: 12, display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{ flex: 1 }}>
                发现 <span className="mono">{activePath}</span> 的本地未提交草稿
                (保存于 {new Date(pendingRestore[activePath].ts).toLocaleString()})
                ,与服务器版本不一致。
              </span>
              <button
                className="btn sm primary"
                style={{ padding: '2px 10px', fontSize: 11 }}
                onClick={() => applyRestore(activePath)}
              >恢复草稿</button>
              <button
                className="btn sm ghost"
                style={{ padding: '2px 10px', fontSize: 11 }}
                onClick={() => discardRestore(activePath)}
              >丢弃</button>
            </div>
          )}
          <div className="editor-code" style={{ display: 'block', padding: 0, flex: 1, minHeight: 0, background: '#1e1e1e', position: 'relative' }}>
            {/* The Monaco instance is mounted exactly once and stays alive
                for the lifetime of this page. Tab switches just call
                editor.setModel(); see the model-management effect above. */}
            <MonacoEditor
              height="100%"
              theme="vs-dark"
              defaultLanguage="plaintext"
              onMount={(ed, m) => {
                editorRef.current = ed;
                monacoNsRef.current = m;
                // The wrapper auto-creates a default model; we own the
                // lifecycle ourselves, so detach + dispose it.
                const def = ed.getModel();
                ed.setModel(null);
                def?.dispose();
                // Both shortcuts go through handlersRef so they always pick
                // up the latest closures (state-dependent saves work).
                ed.addCommand(
                  m.KeyMod.CtrlCmd | m.KeyCode.KeyS,
                  () => { handlersRef.current.saveActive(); },
                );
                ed.addCommand(
                  m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.KeyS,
                  () => { handlersRef.current.saveAll(); },
                );
                // Kick the model-sync effect now that we have refs.
                setEditorMountTick((n) => n + 1);
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
            {(!activePath || !activeBuf) && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-faint)', background: '#1e1e1e',
              }}>
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
                  {v.severity !== 'ok' && (
                    <button
                      type="button"
                      className="btn sm ghost"
                      style={{ padding: '0 4px', height: 18, fontSize: 10, flexShrink: 0 }}
                      title="让 AI 自动修复此问题"
                      onClick={() => {
                        setAIOpen(true);
                        setAiTrigger({ action: 'fix-validation', instruction: `${v.label}: ${v.detail}` });
                      }}
                    ><IconSparkles size={10} /></button>
                  )}
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
        allFiles={allFilesMap}
        validationErrors={validationErrors}
        triggerAction={aiTrigger}
        onTriggerConsumed={() => setAiTrigger(null)}
      />
    </div>
  );
}
