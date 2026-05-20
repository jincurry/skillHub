import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MonacoEditor, { type OnMount } from '@monaco-editor/react';
import {
  IconCode, IconCheckCircle, IconRocket, IconChevronDown, IconChevronRight,
  IconAlertTriangle, IconXCircle, IconPlus, IconSparkles,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { AIAssistAction, ValidationReport } from '../api/types';
import { AIAssistDrawer, type EditorBridge } from '../components/AIAssistDrawer';
import { runAssist, type AssistHandle } from '../lib/aiAssist';
import { isRootReadme, languageFor, shouldDisplaySkillFile } from '../lib/files';
import { renderMarkdown } from '../lib/markdown';
import { estimateTokens, fmtTokens } from '../lib/tokens';
import {
  AUTOSAVE_MS, REQUIRED_FILES, SEMVER_RE, STD_DIRS, TEMPLATE_GROUPS,
  type StdDirKey,
} from './editor/constants';
import { bumpVersion, draftKeyFor, iconFor, type SemverBump } from './editor/helpers';
import { bodyForPreview, parseFrontmatter, setFrontmatter } from './editor/frontmatter';
import { computeDiff } from './editor/diff';
import { FrontmatterField, TagsField } from './editor/FrontmatterField';
import { FilePicker } from './editor/FilePicker';
import { FileTree, buildTree } from './editor/FileTree';
import { buildSubmitPreflight } from './editor/preflight';
import { useLocaleText } from '../i18n/useLocaleText';


// --------- main page ------------------------------------------------------

export function Editor() {
  const { ns = 'platform-team', name = 'go-code-review' } = useParams();
  const navigate = useNavigate();
  const { text, locale } = useLocaleText();

  const skill = useAsync(() => api.getSkill(ns, name), [ns, name]);
  const me = useAsync(() => api.me(), []);
  const members = useAsync(() => api.namespaceMembers(ns), [ns]);
  const files = useAsync(() => api.listFiles(ns, name), [ns, name]);
  const displayFiles = useMemo(
    () => (files.data ?? []).filter((f) => shouldDisplaySkillFile(f.path)),
    [files.data],
  );
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
    if (buf?.dirty && !window.confirm(text(`${path} has unsaved changes. Closing will discard them. Continue?`, `${path} 有未保存修改，关闭将丢失，是否确认?`))) return;
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

  // New-file dialog state. `newFileContent` is populated when the user picks
  // a template; otherwise we create an empty file and let the editor own the
  // first keystroke.
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
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

  // Markdown view mode — only applies to .md files. We persist the choice so
  // a user who prefers split-view doesn't have to re-toggle each session.
  type EditorMode = 'code' | 'preview' | 'split';
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    try {
      const v = localStorage.getItem('skillHub.editor.mode');
      if (v === 'preview' || v === 'split' || v === 'code') return v;
    } catch { /* ignore */ }
    return 'code';
  });
  useEffect(() => {
    try { localStorage.setItem('skillHub.editor.mode', editorMode); }
    catch { /* ignore */ }
  }, [editorMode]);
  const autosaveTimers = useRef<Map<string, number>>(new Map());
  // Latest buffers reachable from inside the (delayed) autosave callback
  // without going stale. We update this on every render below.
  const buffersRef = useRef(buffers);
  // Per-path drafts the user hasn't responded to yet. When a file is
  // loaded from the server and the local backup disagrees, we surface a
  // banner instead of silently overwriting either side.
  const [pendingRestore, setPendingRestore] = useState<Record<string, { content: string; ts: number }>>({});

  // Quick-open file picker (Cmd+P).
  const [showFilePicker, setShowFilePicker] = useState(false);

  // Per-path content as last fetched from server. Used for diff preview in
  // the submit modal so the user can see exactly what changed.
  const [serverSnapshots, setServerSnapshots] = useState<Record<string, string>>({});
  // Path currently expanded in the submit-modal diff preview. null = all collapsed.
  const [showDiffFor, setShowDiffFor] = useState<string | null>(null);

  // New-file dialog mode: 'template' (text editor) vs 'upload' (local file).
  const [newFileMode, setNewFileMode] = useState<'template' | 'upload'>('template');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

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
  // primary authoring surface so it wins over skill.yaml.
  useEffect(() => {
    if (!files.data || displayFiles.length === 0) return;
    if (activePath && displayFiles.some((f) => f.path === activePath)) return;
    const preferred = ['SKILL.md', 'skill.yaml'];
    const pick = preferred.find((p) => displayFiles.some((f) => f.path === p)) ?? displayFiles[0].path;
    setActivePath(pick);
    setOpenPaths((prev) => prev.includes(pick) ? prev : [...prev, pick]);
  }, [files.data, displayFiles, activePath]);

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
        setServerSnapshots((s) => ({ ...s, [activePath]: server }));
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
      .catch((e: Error) => setMsg(text(`Failed to load ${activePath}: ${e.message}`, `加载 ${activePath} 失败: ${e.message}`)))
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

  // Defer the buffer map for any derived view that doesn't need keystroke
  // freshness. Keeps the side panels (token count, outline, preview, fm form)
  // from blocking Monaco input while the user types in a big file. dirtyPaths
  // and the save buttons stay sync because they gate user actions.
  const deferredBuffers = useDeferredValue(buffers);
  const deferredActiveBuf = activePath ? deferredBuffers[activePath] : undefined;

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

  // Total estimated token count for the whole bundle. Loaded buffers are
  // measured directly; unloaded files fall back to a byte-based estimate.
  // Driven by deferredBuffers so per-keystroke typing doesn't re-walk every
  // file in the bundle on the critical render path.
  const totalTokens = useMemo(() => {
    const counted = new Set<string>();
    let total = 0;
    for (const [p, b] of Object.entries(deferredBuffers)) {
      total += estimateTokens(b.content);
      counted.add(p);
    }
    for (const f of displayFiles) {
      if (!counted.has(f.path)) total += Math.ceil((f.size ?? 0) * 0.25);
    }
    return total;
  }, [deferredBuffers, displayFiles]);

  const tree = useMemo(() => buildTree(displayFiles), [displayFiles]);
  const activeBuf = activePath ? buffers[activePath] : undefined;

  // Whether the recommended layout is satisfied. Drives both the file-tree
  // placeholders and the Bundle Structure side card.
  const bundleStatus = useMemo(() => {
    const paths = displayFiles.map((f) => f.path);
    const hasSkillMD = paths.includes('SKILL.md');
    const dirsPresent = new Set<string>();
    for (const p of paths) {
      const i = p.indexOf('/');
      if (i > 0) dirsPresent.add(p.slice(0, i));
    }
    const missingStdDirs = STD_DIRS
      .filter((d) => !dirsPresent.has(d.key))
      .map((d) => d.key);
    return { hasSkillMD, missingStdDirs, dirsPresent };
  }, [displayFiles]);

  // Markdown outline for the currently-open SKILL.md (or any other .md). Used
  // by the side panel so users can jump to a heading inside long docs. We
  // re-parse on every buffer change but it's just a regex over a few KB so
  // it's effectively free. Driven by the deferred buffer so per-keystroke
  // typing doesn't re-scan headings on the critical path.
  const outline = useMemo(() => {
    if (!activePath || !deferredActiveBuf) return [] as { level: number; text: string; line: number }[];
    if (!activePath.toLowerCase().endsWith('.md')) return [];
    const lines = deferredActiveBuf.content.split('\n');
    const result: { level: number; text: string; line: number }[] = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // Ignore # inside fenced code blocks (otherwise example shell prompts
      // would crowd the outline).
      if (l.startsWith('```')) { inFence = !inFence; continue; }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
      if (!m) continue;
      result.push({ level: m[1].length, text: m[2], line: i + 1 });
    }
    return result;
  }, [activePath, deferredActiveBuf]);

  function jumpToLine(line: number) {
    const ed = editorRef.current;
    if (!ed) return;
    ed.revealLineInCenter(line);
    ed.setPosition({ lineNumber: line, column: 1 });
    ed.focus();
  }

  // Which markdown view to actually render. Non-md files always force `code`.
  const isMdFile = !!activePath && activePath.toLowerCase().endsWith('.md');
  const effectiveMode: EditorMode = isMdFile ? editorMode : 'code';
  const isSkillMd = activePath === 'SKILL.md';

  // Memoise the rendered preview so we only re-run the tiny markdown parser
  // when the buffer changes. The frontmatter block is stripped so it doesn't
  // render as a stray paragraph. Deferred so a fast typist doesn't trigger
  // the markdown parser on every keystroke on the critical path.
  const previewHtml = useMemo(() => {
    if (!isMdFile || !deferredActiveBuf) return '';
    return renderMarkdown(bodyForPreview(deferredActiveBuf.content));
  }, [isMdFile, deferredActiveBuf]);

  // Frontmatter form (B). The form mirrors `parseFrontmatter(activeBuf)` and
  // writes back through writeFrontmatter on field blur. We deliberately only
  // commit on blur so per-keystroke typing in the form doesn't fire a
  // model.setValue on Monaco (which would reset its cursor / scroll position).
  // Deferred so editing in Monaco doesn't re-parse the YAML block on every
  // keystroke; the form fields lag behind by one frame and that's fine because
  // the underlying input components hold their own typing buffer anyway.
  const skillMdFm = useMemo(() => {
    if (!isSkillMd || !deferredActiveBuf) return null;
    return parseFrontmatter(deferredActiveBuf.content);
  }, [isSkillMd, deferredActiveBuf]);

  const [fmCollapsed, setFmCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('skillHub.editor.fmCollapsed') === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('skillHub.editor.fmCollapsed', fmCollapsed ? '1' : '0'); }
    catch { /* ignore */ }
  }, [fmCollapsed]);

  function writeFrontmatter(key: string, val: string) {
    if (!activePath || !activeBuf || !isSkillMd) return;
    const fm = parseFrontmatter(activeBuf.content);
    // No-op when the user blurs without changing anything.
    if ((fm.fields[key] ?? '') === val) return;
    const newFields = { ...fm.fields, [key]: val };
    const newContent = setFrontmatter(activeBuf.content, newFields);
    setBuffers((b) => ({ ...b, [activePath]: { content: newContent, dirty: true } }));
  }

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
    const alive = new Set(displayFiles.map((f) => f.path));
    for (const p of Array.from(modelsRef.current)) {
      if (alive.has(p)) continue;
      m.editor.getModel(modelUriFor(m, p))?.dispose();
      modelsRef.current.delete(p);
      viewStatesRef.current.delete(p);
    }
  }, [files.data, displayFiles]);

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
        setDraftErr(text('No AI model is configured. Contact an admin.', '未配置 AI 模型，请联系管理员'));
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
  }, [showSubmit]);

  // Collect validation error strings for the AI fix-validation action.
  const validationErrors = useMemo(() => {
    if (!validation.data) return [];
    return validation.data.checks
      .filter((c) => c.severity === 'err' || c.severity === 'warn')
      .map((c) => `[${c.severity}] ${c.label}: ${c.detail}`);
  }, [validation.data]);

  // Pre-flight: blockers (err) prevent submission; warnings are advisory.
  // Used both to colour the submit button and to render the checklist at
  // the top of the submit modal.
  const preflight = useMemo(() => {
    return buildSubmitPreflight({
      validation: validation.data,
      policy: policy.data,
      isHotfix: submitHotfix,
      text,
    });
  }, [policy.data, submitHotfix, text, validation.data]);

  useEffect(() => {
    if (showSubmit) setSubmitVersion((v) => v || nextVersion);
  }, [showSubmit, nextVersion]);

  // ---- actions ----------------------------------------------------------

  async function runValidate() {
    setMsg(text('Validating...', '验证中...'));
    try {
      const r = await api.validate(ns, name);
      validation.reload();
      setMsg(text(`Validation complete · score ${r.score}/100 · ${r.summary}`, `验证完成 · 得分 ${r.score}/100 · ${r.summary}`));
    } catch (e) {
      setMsg(text(`Validation failed: ${(e as Error).message}`, `验证失败: ${(e as Error).message}`));
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
      setMsg(text(`Saved ${activePath} (${updated.size}B)`, `已保存 ${activePath} (${updated.size}B)`));
    } catch (e) {
      setMsg(text(`Save failed: ${(e as Error).message}`, `保存失败: ${(e as Error).message}`));
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
    setMsg(lastErr
      ? text(`Saved ${saved}; failed: ${lastErr.message}`, `保存了 ${saved} 个,失败: ${lastErr.message}`)
      : text(`Saved ${saved} files`, `已保存 ${saved} 个文件`));
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
          setMsg(text(`Autosave failed for ${p}: ${(e as Error).message}`, `自动保存 ${p} 失败: ${(e as Error).message}`));
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

  function openNewFileDialog(prefill?: { path?: string; content?: string }) {
    setNewFilePath(prefill?.path ?? '');
    setNewFileContent(prefill?.content ?? '');
    setNewFileErr(null);
    setShowNewFile(true);
  }

  function closeNewFileDialog() {
    if (newFileBusy) return;
    setShowNewFile(false);
    setNewFilePath('');
    setNewFileContent('');
    setNewFileErr(null);
  }

  async function submitNewFile() {
    const path = newFilePath.trim();
    if (!path) {
      setNewFileErr(text('Path is required', '路径不能为空'));
      return;
    }
    if (path.startsWith('/') || path.includes('..')) {
      setNewFileErr(text('Path must be relative and cannot contain ..', '路径必须是相对路径，且不可包含 ..'));
      return;
    }
    if (isRootReadme(path)) {
      setNewFileErr(text('Root README.md is no longer used for skills. Put documentation in SKILL.md instead.', 'Skill 不再使用根目录 README.md，请把说明写在 SKILL.md 中。'));
      return;
    }
    if ((files.data ?? []).some((f) => f.path === path)) {
      setNewFileErr(text(`File ${path} already exists`, `文件 ${path} 已存在`));
      return;
    }
    setNewFileBusy(true);
    setNewFileErr(null);
    try {
      const f = await api.putFile(ns, name, path, newFileContent);
      setBuffers((b) => ({ ...b, [path]: { content: f.content ?? newFileContent, dirty: false } }));
      files.reload();
      openFile(path);
      setMsg(text(`Created ${path}`, `已创建 ${path}`));
      setShowNewFile(false);
      setNewFilePath('');
      setNewFileContent('');
    } catch (e) {
      setNewFileErr((e as Error).message);
    } finally {
      setNewFileBusy(false);
    }
  }

  // Quick-create the first file in a missing recommended dir. The backend has
  // no concept of empty directories, so the dir only "exists" once a file is
  // written under it. We open the New File dialog with the directory prefix
  // prefilled so the user picks the actual file name and extension (.py / .sh
  // / .json / .png / etc.) — we deliberately don't seed a placeholder
  // index.md anymore.
  function createStdDir(dir: StdDirKey) {
    openNewFileDialog({ path: `${dir}/` });
  }

  async function deleteFile(p: string) {
    if (REQUIRED_FILES.has(p)) {
      setMsg(text(`${p} cannot be deleted`, `${p} 不可删除`));
      return;
    }
    if (!window.confirm(text(`Delete file ${p}? This cannot be undone.`, `删除文件 ${p}? 此操作不可撤销。`))) return;
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
      setMsg(text(`Deleted ${p}`, `已删除 ${p}`));
    } catch (e) {
      setMsg(text(`Delete failed: ${(e as Error).message}`, `删除失败: ${(e as Error).message}`));
    }
  }

  async function discardAll() {
    if (dirtyPaths.size === 0) return;
    if (!window.confirm(text(`Discard unsaved changes in ${dirtyPaths.size} files? They will be restored to the last saved state.`, `放弃 ${dirtyPaths.size} 个文件的未保存修改？将恢复为上次保存状态。`))) return;
    const paths = Array.from(dirtyPaths);
    paths.forEach((p) => {
      try { localStorage.removeItem(draftKeyFor(ns, name, p)); } catch { /* ignore */ }
    });
    setBuffers((b) => {
      const next: typeof b = {};
      for (const [p, buf] of Object.entries(b)) {
        if (!buf.dirty) next[p] = buf;
        // dirty paths are dropped; they re-load from server on next activation
      }
      return next;
    });
    // Re-activate the current file so Monaco syncs to the freshly-cleared buffer.
    if (activePath && dirtyPaths.has(activePath)) {
      const cur = activePath;
      setActivePath(null);
      setTimeout(() => setActivePath(cur), 0);
    }
    setMsg(text(`Discarded changes in ${paths.length} files`, `已放弃 ${paths.length} 个文件的修改`));
  }

  async function uploadLocalFiles() {
    if (uploadFiles.length === 0) { setUploadErr(text('Choose files first', '请选择文件')); return; }
    setUploadBusy(true);
    setUploadErr(null);
    let created = 0;
    const errors: string[] = [];
    for (const file of uploadFiles) {
      const path = file.name;
      if (isRootReadme(path)) {
        errors.push(text('Root README.md is no longer used for skills', 'Skill 不再使用根目录 README.md'));
        continue;
      }
      if ((files.data ?? []).some((f) => f.path === path)) {
        errors.push(text(`${path} already exists`, `${path} 已存在`));
        continue;
      }
      try {
        const text = await file.text();
        const f = await api.putFile(ns, name, path, text);
        setBuffers((b) => ({ ...b, [path]: { content: f.content ?? text, dirty: false } }));
        created++;
      } catch (e) {
        errors.push(`${path}: ${(e as Error).message}`);
      }
    }
    await files.reload();
    if (errors.length > 0) setUploadErr(errors.join('\n'));
    else {
      setShowNewFile(false);
      setUploadFiles([]);
      setNewFileMode('template');
    }
    if (created > 0) {
      setMsg(text(`Uploaded ${created} files`, `已上传 ${created} 个文件`));
      if (uploadFiles.length === 1) openFile(uploadFiles[0].name);
    }
    setUploadBusy(false);
  }

  /**
   * Rename / move a file in the bundle. We keep the in-memory buffer (with
   * dirty state preserved) and rekey tabs so the user doesn't lose work.
   * Returns true on success so the inline rename input can close itself.
   */
  async function renameFile(oldPath: string, newPath: string): Promise<boolean> {
    if (REQUIRED_FILES.has(oldPath)) {
      throw new Error(text(`${oldPath} cannot be renamed`, `${oldPath} 不可重命名`));
    }
    if (isRootReadme(newPath)) {
      throw new Error(text('Root README.md is no longer used for skills. Put documentation in SKILL.md instead.', 'Skill 不再使用根目录 README.md，请把说明写在 SKILL.md 中。'));
    }
    if ((files.data ?? []).some((f) => f.path === newPath)) {
      throw new Error(text(`${newPath} already exists`, `${newPath} 已存在`));
    }
    const buf = buffers[oldPath];
    // If the user has unsaved edits we'd lose them after the server
    // re-reads the file (since rename returns the on-disk content). Flush
    // them upstream first.
    if (buf?.dirty) {
      try {
        await api.putFile(ns, name, oldPath, buf.content);
      } catch (e) {
        throw new Error(text(`Failed to save original file: ${(e as Error).message}`, `保存原文件失败: ${(e as Error).message}`));
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
    setMsg(text(`Renamed ${oldPath} -> ${newPath}`, `已重命名 ${oldPath} → ${newPath}`));
    return true;
  }

  async function submitForReview() {
    const ver = submitVersion.trim();
    if (!ver) { setMsg(text('Enter a new version number', '请填写新版本号')); return; }
    if (!SEMVER_RE.test(ver)) { setMsg(text('Version must be valid semver, such as 1.2.3 or 1.2.3-beta.1', '版本号需符合 semver(如 1.2.3 / 1.2.3-beta.1)')); return; }
    if (ver === currentVersion) { setMsg(text('New version matches the current one. Bump it first.', '新版本号与当前一致,请 bump')); return; }
    if (submitHotfix && !submitHotfixReason.trim()) {
      setMsg(text('Hotfix requires an emergency reason', '启用 Hotfix 通道时必须填写紧急原因')); return;
    }
    // If a draft is still streaming, stop it first so we submit what we have.
    if (draftingNote) stopDraft();
    if (anyDirty) {
      if (!window.confirm(text('There are unsaved changes. Save all before submitting?', '还有未保存的修改,要先保存全部再提交吗?'))) return;
      await saveAll();
      if (Object.values(buffers).some((b) => b.dirty)) {
        setMsg(text('Some files could not be saved. Submission canceled.', '部分文件未能保存,提交已取消'));
        return;
      }
    }
    setSubmitting(true); setMsg(null);
    try {
      const r = await api.submitForReview(ns, name, {
        version: ver,
        note: submitNote.trim() || text('Please review', '请审批'),
        isHotfix: submitHotfix,
        hotfixReason: submitHotfix ? submitHotfixReason.trim() : undefined,
      });
      setShowSubmit(false);
      setMsg(text(`Submitted review #${r.id}`, `已提交 审批 #${r.id}`));
      setTimeout(() => navigate(`/reviews/${r.id}`), 600);
    } catch (e) {
      const m = (e as Error).message;
      if (m.includes('validation failed') || m.startsWith('422')) {
        validation.reload();
        setMsg(text('Submission blocked: validation errors exist. Fix them in the right panel and submit again.', '提交被拦截:存在 validation 错误,请查看右侧面板修复后再提交。'));
      } else {
        setMsg(text(`Submit failed: ${m}`, `提交失败: ${m}`));
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
            {files.data ? text(`${files.data.length} files`, `${files.data.length} 个文件`) : text('Loading...', '加载中...')}
            {anyDirty && <span style={{ color: 'var(--amber-text)', marginLeft: 8 }}>· {text(`${dirtyPaths.size} unsaved`, `${dirtyPaths.size} 个未保存`)}</span>}
            {!canEdit && skill.data && me.data && (
              <span style={{ color: 'var(--text-faint)', marginLeft: 8 }}>· {text('Read-only (you are not the author)', '只读 (你不是作者)')}</span>
            )}
            <span
              style={{ marginLeft: 8, color: 'var(--primary)', cursor: 'pointer' }}
              onClick={() => navigate(`/skills/${ns}/${name}`, { state: { tab: 'versions' } })}
              title={text('View all historical versions on the skill detail page', '在 skill 详情页查看所有历史版本')}
            >· {text('Version History ->', '历史版本 →')}</span>
          </p>
        </div>
        <div className="page-actions editor-actions">
          <button className="btn" onClick={runValidate} title={text('Re-validate all files', '重新校验所有文件')}><IconCheckCircle size={14} /> Validate</button>
          <button
            className="btn"
            onClick={() => setAutosaveOn((v) => !v)}
            title={autosaveOn
              ? text('Autosave is on · saved after 1.5 seconds without input', '自动保存已开启 · 1.5 秒无输入后落盘')
              : text('Autosave is off · local backups are still kept to prevent loss', '自动保存已关闭 · 仍会备份到本地以防丢失')}
          >
            <span className={`state-dot ${autosaveOn ? 'on' : 'off'}`} />
            {text('Autosave', '自动保存')} {autosaveOn ? 'ON' : 'OFF'}
          </button>
          <button
            className="btn"
            onClick={() => setAIOpen((v) => !v)}
            disabled={!activePath}
            title={text('AI Assistant', 'AI 助手')}
            data-active={aiOpen ? 'true' : undefined}
          >
            <IconSparkles size={14} /> {text('AI Assistant', 'AI 助手')}
          </button>
          {anyDirty && (
            <button
              className="btn ghost"
              onClick={discardAll}
              title={text('Discard all unsaved changes and restore the last saved state', '放弃所有未保存修改，恢复到上次保存状态')}
              style={{ color: 'var(--red-text)', borderColor: 'var(--red-border, rgba(239,68,68,0.3))' }}
            >
              {text('Discard Changes', '放弃修改')} ({dirtyPaths.size})
            </button>
          )}
          {/* Split save: the primary half saves the active file, the right
              half flushes every dirty buffer. Only shows the count badge
              when there is more than one dirty file so it doesn't shout. */}
          <div style={{ display: 'inline-flex', gap: 0 }}>
            <button
              className="btn"
              onClick={saveActive}
              disabled={!canEdit || saving || !activeBuf?.dirty}
              title={text('Save current file (Ctrl/Cmd+S)', '保存当前文件 (Ctrl/Cmd+S)')}
              style={dirtyPaths.size > 1 ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 } : undefined}
            >
              <IconCode size={14} /> {saving ? text('Saving...', '保存中...') : text('Save', '保存')}
            </button>
            {dirtyPaths.size > 1 && (
              <button
                className="btn"
                onClick={saveAll}
                disabled={!canEdit || saving}
                title={text('Save all unsaved files (Ctrl/Cmd+Shift+S)', '保存所有未保存的文件 (Ctrl/Cmd+Shift+S)')}
                style={{ borderLeft: 'none', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: '0 8px' }}
              >
                {text('All', '全部')} ({dirtyPaths.size})
              </button>
            )}
          </div>
          <button
            className="btn primary"
            disabled={submitting || !canEdit}
            onClick={() => setShowSubmit(true)}
            // Surface the pre-flight state on the button itself: a red dot
            // when there are blockers, an amber dot when there are only
            // warnings. Hovering reveals the count.
            title={
              preflight.blockers.length > 0
                ? text(`${preflight.blockers.length} items must be fixed before submission`, `${preflight.blockers.length} 项必须修复后才能提交`)
                : preflight.warnings.length > 0
                  ? text(`${preflight.warnings.length} warnings (non-blocking)`, `${preflight.warnings.length} 项警告（不阻塞）`)
                  : text('Submit for review', '提交审批')
            }
          >
            <IconRocket size={14} />
            {submitting ? text('Submitting...', '提交中...') : text('Submit Review', '提交审批')}
            {(preflight.blockers.length > 0 || preflight.warnings.length > 0) && (
              <span
                className={`submit-badge ${preflight.blockers.length > 0 ? 'error' : 'warn'}`}
              >{preflight.blockers.length > 0 ? preflight.blockers.length : preflight.warnings.length}</span>
            )}
          </button>
        </div>
      </div>

      {showSubmit && (
        <div
          onClick={() => !submitting && setShowSubmit(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg)', borderRadius: 10, width: 480, maxWidth: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{text('Submit Review', '提交审批')}</h3>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                {text('Current version', '当前版本')} <span className="mono">v{currentVersion}</span> · {text('default bump to', '默认 bump 到')} <span className="mono">v{nextVersion}</span>
              </div>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
              {/* Pre-flight checklist — server re-validates on submit so we
                  treat this as advisory, but blockers also disable the
                  confirm button so the user can't trip the 422 round-trip. */}
              {validation.data && (preflight.blockers.length > 0 || preflight.warnings.length > 0) && (
                <div
                  style={{
                    borderRadius: 6,
                    border: `1px solid ${preflight.blockers.length > 0 ? 'var(--red)' : 'var(--amber)'}`,
                    background: preflight.blockers.length > 0 ? 'var(--red-bg)' : 'var(--amber-bg)',
                    padding: '8px 12px',
                    fontSize: 12.5,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontWeight: 600 }}>
                    {preflight.blockers.length > 0
                      ? <IconXCircle size={14} style={{ color: 'var(--red)' }} />
                      : <IconAlertTriangle size={14} style={{ color: 'var(--amber)' }} />}
                    <span style={{ color: preflight.blockers.length > 0 ? 'var(--red-text)' : 'var(--amber-text)' }}>
                      {text('Pre-submit checks', '提交前检查')} · {preflight.blockers.length} {text('errors', '错误')} · {preflight.warnings.length} {text('warnings', '警告')}
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                    {preflight.blockers.map((c) => (
                      <li key={c.id} style={{ color: 'var(--red-text)' }}>
                        <strong>{c.label}</strong>{c.detail ? ` — ${c.detail}` : ''}
                      </li>
                    ))}
                    {preflight.warnings.map((c) => (
                      <li key={c.id} style={{ color: 'var(--amber-text)' }}>
                        {c.label}{c.detail ? ` — ${c.detail}` : ''}
                      </li>
                    ))}
                  </ul>
                  {preflight.blockers.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--red-text)' }}>
                      {text('Errors exist · fix them before submitting.', '存在错误项 · 修复后再提交。')}
                    </div>
                  )}
                </div>
              )}
              {validation.data && preflight.ready && preflight.warnings.length === 0 && (
                <div
                  style={{
                    borderRadius: 6,
                    border: '1px solid var(--green)',
                    background: 'var(--green-bg, rgba(16,185,129,0.08))',
                    padding: '6px 12px',
                    fontSize: 12.5,
                    color: 'var(--green-text)',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <IconCheckCircle size={14} /> {text('All checks passed · ready to submit', '所有检查通过 · 可放心提交')}
                </div>
              )}
              <label style={{ display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{text('New Version', '新版本号')}</span>
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
                  <div style={{ fontSize: 11, color: 'var(--red-text)', marginTop: 4 }}>{text('Not a valid semver format', '不是合法 semver 格式')}</div>
                )}
              </label>
              <label style={{ display: 'block' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>{text('Submission Note (optional)', '提交说明（可选）')}</span>
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ fontSize: 10.5, padding: '2px 8px', gap: 4 }}
                    onClick={draftSubmitNote}
                    disabled={submitting}
                    title={draftingNote ? text('Click to stop generation', '点击停止生成') : text('Let AI draft a submission note from the document content', '让 AI 根据文档内容起草提交说明')}
                  >
                    <IconSparkles size={11} /> {draftingNote ? text('Generating... Stop', '生成中... 点击停止') : text('AI Draft', 'AI 起草')}
                  </button>
                </div>
                <textarea className="input" rows={4} value={submitNote} onChange={(e) => setSubmitNote(e.target.value)} placeholder={draftingNote ? text('AI is generating...', 'AI 正在生成...') : text('Key points in this change, shown to reviewers...', '本次变更的关键点,会显示给审批人...')} style={{ width: '100%', resize: 'vertical' }} />
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
                    {text('Hotfix Path', 'Hotfix 紧急通道')}
                  </span>
                  <span style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>
                    {text('1 reviewer · SLA 4h · production incidents only', '1 审批人 · SLA 4h · 仅生产事故')}
                  </span>
                </label>
                {submitHotfix && (
                  <div style={{ marginTop: 8 }}>
                    <textarea
                      className="input"
                      rows={2}
                      value={submitHotfixReason}
                      onChange={(e) => setSubmitHotfixReason(e.target.value)}
                      placeholder={text('Required: briefly describe the emergency reason (saved to audit logs)', '必填:简要说明紧急原因(将进入审计日志)')}
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
                  {text('Hotfix policy:', 'Hotfix 策略:')} <span className="mono">{text('1 reviewer', '1 审批人')}</span> · SLA <span className="mono">4h</span> · {text('bypasses classification escalation automatically', '自动绕过分类升级')}
                  <div style={{ color: 'var(--text-faint)', fontSize: 11, marginTop: 2 }}>
                    {text('This enters the emergency review path and will be recorded in audit logs.', '将进入紧急审批通道,后续会进入审计日志。')}
                  </div>
                </div>
              ) : policy.data && (
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  {text('Policy:', '策略:')} <span className="tag indigo">{policy.data.classification}</span>{' '}
                  {policy.data.mode} · SLA <span className="mono">{policy.data.slaHours}h</span>
                  {(policy.data.suggested ?? []).length > 0 && (
                    <> · {text('Suggested reviewers', '建议审批人')} {(policy.data.suggested ?? []).map((u) => `@${u}`).join(', ')}</>
                  )}
                  {(policy.data.suggested ?? []).length === 0 && (
                    <div style={{ color: 'var(--red-text)', fontSize: 11.5, marginTop: 6 }}>
                      {text(
                        'No eligible reviewers are available for this policy.',
                        '当前策略下没有可用审批人。',
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* Dirty file preview — saves the reviewer (and the author!)
                  from "what's in this submission again?" anxiety. */}
              {dirtyPaths.size > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-subtle)', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ marginBottom: 6 }}>
                    <span style={{ color: 'var(--amber-text)', fontWeight: 600 }}>{dirtyPaths.size}</span>{' '}
                    {text('unsaved files will be saved before submission:', '个未保存文件，提交前会先保存：')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {Array.from(dirtyPaths).map((p) => {
                      const hasDiff = serverSnapshots[p] !== undefined;
                      const expanded = showDiffFor === p;
                      const diffLines = expanded && hasDiff
                        ? computeDiff(serverSnapshots[p], buffers[p]?.content ?? '')
                        : [];
                      return (
                        <div key={p}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="tag" style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", flex: 1 }}>{p}</span>
                            {hasDiff && (
                              <button
                                type="button"
                                className="btn sm ghost"
                                style={{ fontSize: 10.5, padding: '1px 7px' }}
                                onClick={() => setShowDiffFor(expanded ? null : p)}
                              >{expanded ? text('Collapse', '收起') : text('View Changes', '查看变更')}</button>
                            )}
                          </div>
                          {expanded && (
                            <div style={{
                              marginTop: 4, borderRadius: 6, overflow: 'auto', maxHeight: 200,
                              border: '1px solid var(--border)', background: '#1e1e1e',
                              fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, lineHeight: 1.5,
                            }}>
                              {diffLines.length === 0
                                ? <div style={{ padding: '6px 10px', color: 'var(--text-faint)' }}>{text('No differences', '无差异')}</div>
                                : diffLines.map((l, i) => (
                                  <div key={i} style={{
                                    padding: '0 10px', whiteSpace: 'pre',
                                    background: l.t === '+' ? 'rgba(16,185,129,0.15)' : l.t === '-' ? 'rgba(239,68,68,0.15)' : l.t === '…' ? 'transparent' : 'transparent',
                                    color: l.t === '+' ? '#6ee7b7' : l.t === '-' ? '#fca5a5' : l.t === '…' ? '#6b7280' : '#d4d4d4',
                                  }}>
                                    <span style={{ userSelect: 'none', opacity: 0.5, marginRight: 8 }}>
                                      {l.t === '…' ? ' ' : l.t}
                                    </span>
                                    {l.s}
                                  </div>
                                ))
                              }
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn" onClick={() => setShowSubmit(false)} disabled={submitting}>{text('Cancel', '取消')}</button>
              <button
                className="btn primary"
                disabled={submitting || !submitVersion.trim() || preflight.blockers.length > 0}
                onClick={submitForReview}
                title={preflight.blockers.length > 0 ? text('Validation errors exist. Fix them first.', '存在 validation 错误，请先修复') : text('Confirm submission', '确认提交审批')}
              >
                <IconRocket size={13} /> {submitting ? text('Submitting...', '提交中...') : text('Confirm Submit', '确认提交')}
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
            style={{ background: 'var(--bg)', borderRadius: 10, width: 560, maxWidth: '92vw', maxHeight: '90vh', boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{text('New File', '新建文件')}</h3>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {(['template', 'upload'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn sm ${newFileMode === m ? 'primary' : 'ghost'}`}
                    onClick={() => { setNewFileMode(m); setNewFileErr(null); setUploadErr(null); setUploadFiles([]); }}
                  >{m === 'template' ? text('From Template', '从模板创建') : text('Upload Local Files', '上传本地文件')}</button>
                ))}
              </div>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
              {newFileMode === 'upload' ? (
                <>
                  <label>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 6 }}>
                      {text('Choose files (multi-select supported; file name becomes the path)', '选择文件（支持多选；文件名即路径）')}
                    </div>
                    <input
                      type="file"
                      multiple
                      disabled={uploadBusy}
                      onChange={(e) => {
                        const chosen = Array.from(e.target.files ?? []);
                        setUploadFiles(chosen);
                        setUploadErr(null);
                      }}
                      style={{ fontSize: 13, color: 'var(--text)' }}
                    />
                  </label>
                  {uploadFiles.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {text(`Selected ${uploadFiles.length} files: `, `已选 ${uploadFiles.length} 个文件：`)}{uploadFiles.map((f) => f.name).join(text(', ', '、'))}
                    </div>
                  )}
                  {uploadErr && (
                    <div style={{ fontSize: 12.5, color: 'var(--red-text)', background: 'var(--red-bg)', padding: '6px 10px', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                      {uploadErr}
                    </div>
                  )}
                </>
              ) : (
              <>
              <label>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>{text('Path', '路径')}</div>
                <input
                  className="input"
                  value={newFilePath}
                  onChange={(e) => { setNewFilePath(e.target.value); if (newFileErr) setNewFileErr(null); }}
                  placeholder="scripts/main.py"
                  autoFocus
                  disabled={newFileBusy}
                  style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }}
                />
                {newFileContent && (
                  <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>
                    {text(`Template selected · ${newFileContent.length} characters of starter content will be written`, `已选模板 · 创建后将写入 ${newFileContent.length} 字符的起始内容`)}
                    <button
                      type="button"
                      onClick={() => setNewFileContent('')}
                      style={{ marginLeft: 8, border: 'none', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: 11, padding: 0 }}
                    >{text('Clear', '清除')}</button>
                  </div>
                )}
              </label>

              <div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>{text('Templates (click to select)', '模板（点击选择）')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {TEMPLATE_GROUPS.map((group) => (
                    <div key={group.title}>
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                        {group.title}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {group.items.map((tpl) => {
                          const taken = (files.data ?? []).some((f) => f.path === tpl.path);
                          const selected = newFilePath === tpl.path;
                          return (
                            <button
                              key={tpl.path}
                              type="button"
                              className={`btn sm ${selected ? 'primary' : 'ghost'}`}
                              disabled={taken || newFileBusy}
                              onClick={() => {
                                setNewFilePath(tpl.path);
                                setNewFileContent(tpl.content ?? '');
                                setNewFileErr(null);
                              }}
                              style={{ fontSize: 11, padding: '3px 8px', fontFamily: "'JetBrains Mono', monospace" }}
                              title={taken ? text('This file already exists', '该文件已存在') : (tpl.desc ?? tpl.path)}
                            >{tpl.path}</button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {newFileErr && (
                <div style={{ fontSize: 12.5, color: 'var(--red-text)', background: 'var(--red-bg)', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--red-border, rgba(239,68,68,0.2))' }}>
                  {newFileErr}
                </div>
              )}
              </>
              )}
            </div>
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={closeNewFileDialog} disabled={newFileBusy || uploadBusy}>{text('Cancel', '取消')}</button>
              {newFileMode === 'upload' ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={uploadBusy || uploadFiles.length === 0}
                  onClick={uploadLocalFiles}
                >
                  <IconPlus size={13} /> {uploadBusy ? text('Uploading...', '上传中...') : text(`Upload ${uploadFiles.length || ''} files`, `上传 ${uploadFiles.length || ''} 个文件`)}
                </button>
              ) : (
                <button type="submit" className="btn primary" disabled={newFileBusy || !newFilePath.trim()}>
                  <IconPlus size={13} /> {newFileBusy ? text('Creating...', '创建中...') : text('Create', '创建')}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {msg && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderLeft: '3px solid var(--primary)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>{msg}</span>
            <button className="btn sm ghost" onClick={() => setMsg(null)}>{text('Close', '关闭')}</button>
          </div>
        </div>
      )}

      <div className="editor-grid">
        <div className="editor-files" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="file-row dir" style={{ fontWeight: 600 }}>
            <IconChevronDown size={12} /> {name}
          </div>
          {files.loading && <div style={{ padding: 12, fontSize: 12, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>}
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
          {/* Placeholder rows for recommended dirs that don't exist yet.
              Clicking "+" opens the New File dialog with the directory prefix
              prefilled so the user picks the actual file name and extension —
              the dir then materialises once that first file is written. */}
          {canEdit && files.data && bundleStatus.missingStdDirs.length > 0 && (
            <div style={{ margin: '6px 4px 0', paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
              <div style={{ fontSize: 10.5, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 8px 4px' }}>
                {text('Recommended Directories', '推荐目录')}
              </div>
              {bundleStatus.missingStdDirs.map((key) => {
                const d = STD_DIRS.find((x) => x.key === key)!;
                return (
                  <div
                    key={key}
                    className="file-row dir"
                    style={{ paddingLeft: 8, opacity: 0.55, fontStyle: 'italic' }}
                    title={d.desc}
                    onClick={() => createStdDir(key)}
                  >
                    <IconPlus size={12} />
                    <span style={{ marginRight: 2 }}>{d.icon}</span>
                    {d.label}/
                  </div>
                );
              })}
            </div>
          )}
          {canEdit && (
            <button
              className="file-tree-new"
              onClick={() => openNewFileDialog()}
              title={text('New File', '新建文件')}
            >
              <IconPlus size={12} /> {text('New File', '新建文件')}
            </button>
          )}
        </div>

        <div className="editor-main">
          <div className="editor-tabs">
            {openPaths.length === 0 ? (
              <div className="editor-tab" style={{ color: 'var(--text-faint)' }}>{text('No file selected', '未选择文件')}</div>
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
                      title={text('Close', '关闭')}
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
                {text('Found an unsubmitted local draft for ', '发现 ')}<span className="mono">{activePath}</span>
                {text(` (saved at ${new Date(pendingRestore[activePath].ts).toLocaleString(locale)}) that differs from the server version.`, ` 的本地未提交草稿(保存于 ${new Date(pendingRestore[activePath].ts).toLocaleString(locale)}),与服务器版本不一致。`)}
              </span>
              <button
                className="btn sm primary"
                style={{ padding: '2px 10px', fontSize: 11 }}
                onClick={() => applyRestore(activePath)}
              >{text('Restore Draft', '恢复草稿')}</button>
              <button
                className="btn sm ghost"
                style={{ padding: '2px 10px', fontSize: 11 }}
                onClick={() => discardRestore(activePath)}
              >{text('Discard', '丢弃')}</button>
            </div>
          )}
          {/* Frontmatter form — SKILL.md only. Lets the user edit the
              YAML metadata without hand-writing YAML. Commits to the buffer
              on field blur so per-keystroke typing doesn't thrash Monaco. */}
          {isSkillMd && skillMdFm && (
            <div style={{
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-soft)',
              fontSize: 12,
            }}>
              <div
                onClick={() => setFmCollapsed((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', cursor: 'pointer',
                  color: 'var(--text-muted)', fontWeight: 500,
                }}
                title={fmCollapsed ? text('Expand frontmatter form', '展开 Frontmatter 表单') : text('Collapse frontmatter form', '折叠 Frontmatter 表单')}
              >
                {fmCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                <span>Frontmatter</span>
                {!skillMdFm.hasFrontmatter && (
                  <span style={{
                    fontSize: 10.5, padding: '1px 6px', borderRadius: 4,
                    background: 'var(--amber-bg)', color: 'var(--amber-text)',
                  }}>{text('Missing', '缺失')}</span>
                )}
                {skillMdFm.hasFrontmatter && skillMdFm.fields.name && (
                  <span style={{ color: 'var(--text-faint)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                    · {skillMdFm.fields.name}
                  </span>
                )}
              </div>
              {!fmCollapsed && (
                <div style={{ padding: '4px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <FrontmatterField
                    label="name"
                    fieldKey="name"
                    upstream={skillMdFm.fields.name ?? ''}
                    placeholder="my-skill"
                    readOnly={!canEdit}
                    onCommit={writeFrontmatter}
                  />
                  <FrontmatterField
                    label="description"
                    fieldKey="description"
                    upstream={skillMdFm.fields.description ?? ''}
                    placeholder={text('One-sentence description of this skill', '一句话描述这个 skill')}
                    multiline
                    readOnly={!canEdit}
                    onCommit={writeFrontmatter}
                  />
                  <FrontmatterField
                    label="license"
                    fieldKey="license"
                    upstream={skillMdFm.fields.license ?? ''}
                    placeholder="Apache-2.0"
                    readOnly={!canEdit}
                    onCommit={writeFrontmatter}
                  />
                  <FrontmatterField
                    label="version"
                    fieldKey="version"
                    upstream={skillMdFm.fields.version ?? ''}
                    placeholder="0.1.0"
                    readOnly={!canEdit}
                    onCommit={writeFrontmatter}
                  />
                  <TagsField
                    upstream={skillMdFm.fields.tags ?? ''}
                    readOnly={!canEdit}
                    onCommit={writeFrontmatter}
                  />
                  {/* Surface any extra keys the doc already has so users
                      know they're preserved even though we don't expose
                      them as named inputs. */}
                  {Object.keys(skillMdFm.fields)
                    .filter((k) => !['name', 'description', 'license', 'version', 'tags'].includes(k))
                    .length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', paddingLeft: 84 }}>
                      {text('Other fields (edit in Monaco): ', '其他字段（在 Monaco 中编辑）: ')}
                      {Object.keys(skillMdFm.fields)
                        .filter((k) => !['name', 'description', 'license', 'version', 'tags'].includes(k))
                        .map((k) => <span key={k} className="mono" style={{ marginRight: 6 }}>{k}</span>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Markdown view toggle — only relevant for .md files. We never
              unmount Monaco; preview mode just hides it via display:none so
              the editor's state (cursor, scroll, undo) survives a toggle. */}
          {isMdFile && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              gap: 4, padding: '4px 10px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--bg-soft)',
              fontSize: 11.5,
            }}>
              <span style={{ color: 'var(--text-faint)', marginRight: 4 }}>{text('View', '视图')}</span>
              {([
                { key: 'code',    label: text('Edit', '编辑'),  title: text('Editor only', '仅编辑器') },
                { key: 'split',   label: text('Split', '并排'),  title: text('Editor on the left, preview on the right', '左编辑右预览') },
                { key: 'preview', label: text('Preview', '预览'),  title: text('Preview only', '仅预览') },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={`btn sm ${editorMode === m.key ? 'primary' : 'ghost'}`}
                  style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => setEditorMode(m.key)}
                  title={m.title}
                >{m.label}</button>
              ))}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
            <div
              className="editor-code"
              style={{
                display: effectiveMode === 'preview' ? 'none' : 'block',
                flex: effectiveMode === 'split' ? '1 1 50%' : 1,
                minWidth: 0,
                padding: 0,
                background: '#1e1e1e',
                position: 'relative',
              }}
            >
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
                  // Cmd+P: open the quick-file-picker instead of Monaco's
                  // built-in command palette (which isn't useful here anyway).
                  ed.addCommand(
                    m.KeyMod.CtrlCmd | m.KeyCode.KeyP,
                    () => { setShowFilePicker(true); },
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
                  {activePath ? text('Loading file...', '加载文件中...') : text('Choose a file from the tree on the left', '请从左侧文件树选择一个文件')}
                </div>
              )}
            </div>
            {(effectiveMode === 'preview' || effectiveMode === 'split') && (
              <div
                className="md-preview"
                style={{
                  flex: 1, minWidth: 0, overflow: 'auto',
                  padding: '20px 24px',
                  background: 'var(--bg)',
                  borderLeft: effectiveMode === 'split' ? '1px solid var(--border)' : undefined,
                }}
              >
                {activeBuf ? (
                  <div className="readme" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                ) : (
                  <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>{text('Loading...', '加载中...')}</div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="editor-side">
          <div className="editor-side-section">
            <div className="editor-side-title">{text('Bundle Structure', 'Bundle 结构')}</div>
            <div style={{ fontSize: 12, lineHeight: 1.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                {bundleStatus.hasSkillMD
                  ? <IconCheckCircle size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
                  : <IconXCircle size={14} style={{ color: 'var(--red)', flexShrink: 0 }} />}
                <span className="mono" style={{ flex: 1 }}>SKILL.md</span>
                {bundleStatus.hasSkillMD ? (
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ padding: '0 6px', height: 20, fontSize: 11 }}
                    onClick={() => openFile('SKILL.md')}
                  >{text('Open', '打开')}</button>
                ) : canEdit && (
                  <button
                    type="button"
                    className="btn sm primary"
                    style={{ padding: '0 6px', height: 20, fontSize: 11 }}
                    onClick={() => {
                      const tpl = TEMPLATE_GROUPS[0].items.find((t) => t.path === 'SKILL.md');
                      openNewFileDialog({ path: 'SKILL.md', content: tpl?.content });
                    }}
                  >{text('Create', '创建')}</button>
                )}
              </div>
              {STD_DIRS.map((d) => {
                const present = bundleStatus.dirsPresent.has(d.key);
                return (
                  <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }} title={d.desc}>
                    {present
                      ? <IconCheckCircle size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
                      : <IconAlertTriangle size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />}
                    <span style={{ flex: 1 }}>
                      <span style={{ marginRight: 4 }}>{d.icon}</span>
                      <span className="mono">{d.label}/</span>
                    </span>
                    {!present && canEdit && (
                      <button
                        type="button"
                        className="btn sm ghost"
                        style={{ padding: '0 6px', height: 20, fontSize: 11 }}
                        onClick={() => createStdDir(d.key)}
                        title={text(`Create the first file under ${d.label}/`, `在 ${d.label}/ 下创建第一个文件`)}
                      >+ {text('Create', '创建')}</button>
                    )}
                  </div>
                );
              })}
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.4 }}>
                {text('Recommended structure: SKILL.md metadata + scripts/ + references/ + assets/.', '推荐结构：SKILL.md 元数据 + scripts/ 脚本 + references/ 参考 + assets/ 资源。')}
              </div>
              {files.data && files.data.length > 0 && (
                <div style={{
                  marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: 11,
                }}>
                  <span style={{ color: 'var(--text-faint)' }}>{text('Token Estimate', 'Token 预估')}</span>
                  <span style={{
                    fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
                    color: totalTokens > 80000 ? 'var(--red-text)' : totalTokens > 32000 ? 'var(--amber-text)' : 'var(--green-text)',
                  }}>~{fmtTokens(totalTokens)}</span>
                </div>
              )}
            </div>
          </div>

          {outline.length > 0 && (
            <div className="editor-side-section">
              <div className="editor-side-title">{text('Outline', '大纲')} · {activePath}</div>
              <div style={{ fontSize: 12, lineHeight: 1.5, maxHeight: 240, overflow: 'auto' }}>
                {outline.map((h, idx) => (
                  <div
                    key={`${h.line}-${idx}`}
                    onClick={() => jumpToLine(h.line)}
                    style={{
                      padding: '3px 0',
                      paddingLeft: (h.level - 1) * 10,
                      cursor: 'pointer',
                      color: h.level === 1 ? 'var(--text)' : 'var(--text-muted)',
                      fontWeight: h.level === 1 ? 600 : 400,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`L${h.line} · ${h.text}`}
                  >
                    <span style={{ color: 'var(--text-faint)', marginRight: 4, fontSize: 10 }}>{'#'.repeat(h.level)}</span>
                    {h.text}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="editor-side-section">
            <div className="editor-side-title">{text('Review Policy', '审批策略')}</div>
            {policy.loading && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>}
            {policy.error && <div style={{ fontSize: 12, color: 'var(--red-text)' }}>{policy.error.message}</div>}
            {policy.data && (
              <div style={{ fontSize: 12, lineHeight: 1.55 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-subtle)' }}>{text('Classification', '分类')}</span>
                  <span className="tag indigo">{policy.data.classification}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-subtle)' }}>{text('Mode', '模式')}</span>
                  <span className="mono">{policy.data.mode}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-subtle)' }}>SLA</span>
                  <span className="mono">{policy.data.slaHours}h</span>
                </div>
                <div style={{ color: 'var(--text-subtle)', marginBottom: 4 }}>{text('Suggested Reviewers', '建议审批人')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {(policy.data.suggested ?? []).map((u) => (
                    <span key={u} className="tag" style={{ fontSize: 11 }}>@{u}</span>
                  ))}
                  {(!policy.data.suggested || policy.data.suggested.length === 0) && (
                    <span style={{ color: 'var(--red-text)', fontSize: 11 }}>
                      {text('No available reviewers. Add another eligible namespace member before submitting.', '无可用审批人。请先添加另一个符合策略的命名空间成员。')}
                    </span>
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
            {validation.loading && <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div>}
            {validation.error && <div style={{ fontSize: 12, color: 'var(--red-text)' }}>{validation.error.message}</div>}
            {validation.data?.checks.map((v) => {
              const cls = v.severity === 'ok' ? 'green' : v.severity === 'warn' ? 'amber' : 'red';
              const Icon = v.severity === 'ok' ? IconCheckCircle : v.severity === 'warn' ? IconAlertTriangle : IconXCircle;
              const color = v.severity === 'ok' ? 'var(--green)' : v.severity === 'warn' ? 'var(--amber)' : 'var(--red)';
              return (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 12.5 }} title={v.detail}>
                  <Icon size={14} style={{ color, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</span>
                  <span className={`tag ${cls}`}>{v.severity === 'ok' ? text('Pass', '通过') : v.severity === 'warn' ? text('Warn', '警告') : text('Error', '错误')}</span>
                  {v.severity !== 'ok' && (
                    <button
                      type="button"
                      className="btn sm ghost"
                      style={{ padding: '0 4px', height: 18, fontSize: 10, flexShrink: 0 }}
                      title={text('Ask AI to fix this issue', '让 AI 自动修复此问题')}
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
            <div className="editor-side-title">{text('Unsaved Files', '未保存的文件')}</div>
            {dirtyPaths.size === 0 && <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{text('None', '无')}</div>}
            {Array.from(dirtyPaths).map((p) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', fontSize: 12 }}>
                <span style={{ color: 'var(--amber-text)' }}>•</span>
                <span className="mono" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>{p}</span>
                <button className="btn sm ghost" style={{ padding: '0 6px', height: 20, fontSize: 11 }} onClick={() => openFile(p)}>{text('Open', '打开')}</button>
              </div>
            ))}
            {dirtyPaths.size > 1 && (
              <button className="btn sm" style={{ width: '100%', marginTop: 8 }} onClick={saveAll} disabled={saving}>
                <IconCode size={12} /> {saving ? text('Saving...', '保存中...') : text(`Save All (${dirtyPaths.size})`, `全部保存 (${dirtyPaths.size})`)}
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

      {showFilePicker && files.data && (
        <FilePicker
          files={displayFiles}
          onPick={openFile}
          onClose={() => setShowFilePicker(false)}
        />
      )}
    </div>
  );
}
