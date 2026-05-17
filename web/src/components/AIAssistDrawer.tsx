import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AIAssistAction, AIAssistTurn, AIProviderRef } from '../api/types';
import { runAssist, type AssistHandle } from '../lib/aiAssist';
import { renderMarkdown } from '../lib/markdown';
import { estimateTokens, fmtTokens } from '../lib/tokens';
import {
  IconSparkles, IconSend, IconStop, IconRefresh, IconCopy,
  IconCheck, IconX, IconChevronDown,
} from './Icons';

// What the user sees on the preset action grid. Keep ids in sync with
// server/internal/api/ai.go::actionTemplate.
const PRESETS: { id: AIAssistAction; label: string; hint: string }[] = [
  { id: 'outline',    label: '生成大纲',  hint: '从零生成 SKILL.md 完整大纲' },
  { id: 'expand',     label: '补充细节',  hint: '保持结构，扩充内容和示例' },
  { id: 'polish',     label: '润色文笔',  hint: '更清晰更专业，不增删信息' },
  { id: 'examples',   label: '加示例',    hint: '在合适位置补充使用示例' },
  { id: 'summary',    label: '加 TL;DR',  hint: '在文档顶部加 3 行摘要' },
  { id: 'translate',  label: '翻译为英文', hint: '保留代码块和结构' },
  { id: 'review',     label: '体检',       hint: '不改文档，给改进清单' },
];

export interface EditorBridge {
  /** Returns the entire current file body. */
  getValue: () => string;
  /** Returns the user's selected text, or '' if nothing is selected. */
  getSelection: () => string;
  /** Inserts text at the current cursor position (or replaces selection). */
  insertAtCursor: (text: string) => void;
  /** Overwrites the user's current selection (no-op if no selection). */
  replaceSelection: (text: string) => void;
  /** Replaces the entire file body. */
  replaceAll: (text: string) => void;
}

interface Props {
  open: boolean;
  ns: string;
  name: string;
  /**
   * Path of the currently active editor tab (e.g. SKILL.md). Sent to the
   * backend as context for the prompt.
   */
  filePath: string;
  /** The drawer reads from / writes to the editor through this bridge. */
  bridge: EditorBridge;
  onClose: () => void;
  /** All file buffers (path → content) for cross-file context. */
  allFiles?: Record<string, string>;
  /** Validation errors to attach when running fix-validation. */
  validationErrors?: string[];
  /** Imperative trigger: parent can set this to auto-start an action. */
  triggerAction?: { action: AIAssistAction; instruction?: string } | null;
  onTriggerConsumed?: () => void;
}

export function AIAssistDrawer({ open, ns, name, filePath, bridge, onClose, allFiles, validationErrors, triggerAction, onTriggerConsumed }: Props) {
  const [providers, setProviders] = useState<AIProviderRef[] | null>(null);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [providersErr, setProvidersErr] = useState<string | null>(null);

  const [instruction, setInstruction] = useState('');
  const [useSelection, setUseSelection] = useState(false);
  // We pin the action that started the current/most-recent run. Re-clicking
  // the same preset re-runs with current document state (handy if the user
  // edited mid-stream).
  const [activeAction, setActiveAction] = useState<AIAssistAction | null>(null);
  // Buffered output text. Each delta concatenates into here.
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Output viewer mode. Default to rendered markdown for readability;
  // power users can flip to raw to inspect what they'll be inserting.
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');
  // Multi-turn mode: when ON, every completed exchange (user prompt +
  // assistant reply) is appended to chatHistory and sent on the next call so
  // the LLM sees the conversation. OFF means each call is independent.
  const [multiTurn, setMultiTurn] = useState(false);
  const [chatHistory, setChatHistory] = useState<AIAssistTurn[]>([]);
  const [includeAllFiles, setIncludeAllFiles] = useState(false);

  const handleRef = useRef<AssistHandle | null>(null);
  const lastRunRef = useRef<{
    action: AIAssistAction;
    instruction: string;
    selection: string;
    filePath: string;
  } | null>(null);

  // Lazy-load providers the first time the drawer opens.
  useEffect(() => {
    if (!open || providers !== null) return;
    api.listAIProviderRefs()
      .then((list) => {
        setProviders(list);
        const def = list.find((p) => p.isDefault) ?? list[0];
        if (def) setProviderId(def.id);
      })
      .catch((e) => setProvidersErr((e as Error).message));
  }, [open, providers]);

  // Cancel any in-flight stream when the drawer is closed or unmounted.
  useEffect(() => {
    if (!open && handleRef.current) {
      handleRef.current.abort();
      handleRef.current = null;
      setRunning(false);
    }
    return () => {
      handleRef.current?.abort();
    };
  }, [open]);

  // Estimated input tokens for the *next* run, recomputed cheaply on every
  // render. We don't try to model the prompt-template overhead exactly;
  // this is meant to give the user a relative sense of "too big?".
  const inputTokens = useMemo(() => {
    const base = bridge.getValue();
    const sel = useSelection ? bridge.getSelection() : '';
    return estimateTokens(base) + estimateTokens(sel) + estimateTokens(instruction);
    // bridge identity is stable per active file; we explicitly want this to
    // recompute when the user toggles useSelection or edits the instruction.
  }, [bridge, useSelection, instruction]);

  const outputTokens = useMemo(() => estimateTokens(output), [output]);

  function start(action: AIAssistAction, freshInstruction?: string) {
    if (!providerId) return;
    if (running) return;
    const inst = freshInstruction !== undefined ? freshInstruction : instruction;
    if (action === 'freeform' && !inst.trim()) {
      setStreamErr('自由指令不能为空');
      return;
    }
    const sel = useSelection ? bridge.getSelection() : '';
    const ctx = bridge.getValue();
    setActiveAction(action);
    setOutput('');
    setStreamErr(null);
    setCopied(false);
    setRunning(true);
    lastRunRef.current = {
      action, instruction: inst, selection: sel, filePath,
    };
    // Snapshot the user's prompt for this turn — we re-use it on completion
    // to record the (user, assistant) pair into chatHistory.
    const userPromptSummary = inst.trim() ||
      (PRESETS.find((p) => p.id === action)?.label ?? action);
    handleRef.current = runAssist(ns, name, {
      providerId,
      action,
      instruction: inst,
      selection: sel,
      currentContent: ctx,
      filePath,
      history: multiTurn && chatHistory.length > 0 ? chatHistory : undefined,
      additionalFiles: includeAllFiles && allFiles ? allFiles : undefined,
      validationErrors: action === 'fix-validation' && validationErrors?.length ? validationErrors : undefined,
    }, {
      onDelta: (chunk) => setOutput((prev) => prev + chunk),
      onDone: () => {
        setRunning(false);
        handleRef.current = null;
        // Snapshot output via the functional setter so we don't race the
        // last delta. Only record turns when multi-turn is on.
        if (multiTurn) {
          setOutput((finalOut) => {
            if (finalOut.trim()) {
              setChatHistory((prev) => [
                ...prev,
                { role: 'user', content: userPromptSummary },
                { role: 'assistant', content: finalOut },
              ]);
            }
            return finalOut;
          });
        }
      },
      onError: (msg) => {
        setStreamErr(msg);
        setRunning(false);
        handleRef.current = null;
      },
    });
  }

  function stop() {
    handleRef.current?.abort();
    handleRef.current = null;
    setRunning(false);
  }

  function regenerate() {
    const r = lastRunRef.current;
    if (!r) return;
    // Re-run uses the *current* document state, not the snapshot. This is
    // intentional: the user may have applied an earlier output already.
    start(r.action, r.instruction);
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setStreamErr('复制失败，请手动选中后 Ctrl+C');
    }
  }

  // Reset chat history whenever the drawer closes — new authoring session
  // shouldn't inherit stale context from a previous file.
  useEffect(() => {
    if (!open) {
      setChatHistory([]);
    }
  }, [open]);

  // Imperative trigger from parent (e.g. "AI 修复" button or "AI 起草" button).
  useEffect(() => {
    if (triggerAction && open && providerId && !running) {
      start(triggerAction.action, triggerAction.instruction);
      onTriggerConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerAction, open, providerId]);

  if (!open) return null;

  const hasOutput = output.length > 0;
  const hasProvider = !!providerId;

  return (
    <aside style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 440, maxWidth: '92vw',
      background: 'var(--bg)', borderLeft: '1px solid var(--border)',
      boxShadow: '-12px 0 30px rgba(15,23,42,0.12)',
      zIndex: 80,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'linear-gradient(135deg, color-mix(in oklab, var(--primary), transparent 90%) 0%, transparent 100%)',
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'linear-gradient(135deg, var(--primary), color-mix(in oklab, var(--primary), #ec4899 40%))',
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <IconSparkles size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>AI 助手</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>
            {ns}/{name} · {filePath}
          </div>
        </div>
        <button className="btn sm ghost" onClick={onClose} title="关闭"><IconX size={14} /></button>
      </div>

      {/* Multi-turn toggle row — collapses to a single line so it doesn't
          crowd the drawer when most users won't touch it. */}
      <div style={{
        padding: '6px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5,
        color: 'var(--text-muted)', background: 'var(--bg-soft)',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={multiTurn}
            onChange={(e) => {
              setMultiTurn(e.target.checked);
              // Toggling off discards memory; otherwise an old turn could
              // confuse a fresh question.
              if (!e.target.checked) setChatHistory([]);
            }}
            style={{ margin: 0 }}
          />
          多轮上下文
        </label>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includeAllFiles}
            onChange={(e) => setIncludeAllFiles(e.target.checked)}
            style={{ margin: 0 }}
          />
          含全部文件
        </label>
        {multiTurn && (
          <>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span>已记 {chatHistory.length / 2} 轮</span>
            {chatHistory.length > 0 && (
              <button
                type="button"
                onClick={() => setChatHistory([])}
                style={{
                  marginLeft: 'auto', padding: '0 6px', height: 18,
                  fontSize: 10.5, border: '1px solid var(--border)',
                  borderRadius: 3, background: 'transparent',
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}
              >清空</button>
            )}
          </>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Provider selector */}
        <div>
          <Label>模型</Label>
          {providersErr && <div style={{ fontSize: 11, color: 'var(--red-text)' }}>{providersErr}</div>}
          {!providersErr && providers === null && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>
          )}
          {providers !== null && providers.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.55 }}>
              管理员还没有配置 AI 模型。请联系管理员，或前往
              <a href="/admin" style={{ marginLeft: 4 }}>管理后台 → AI 模型</a> 添加。
            </div>
          )}
          {providers && providers.length > 0 && (
            <div style={{ position: 'relative' }}>
              <select
                value={providerId ?? ''}
                onChange={(e) => setProviderId(Number(e.target.value))}
                style={{
                  width: '100%', appearance: 'none',
                  padding: '8px 30px 8px 10px',
                  border: '1px solid var(--border)', borderRadius: 6,
                  background: 'var(--bg)', fontSize: 12.5,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.model}{p.isDefault ? ' (默认)' : ''}
                  </option>
                ))}
              </select>
              <IconChevronDown
                size={14}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-subtle)' } as React.CSSProperties}
              />
            </div>
          )}
        </div>

        {/* Preset actions */}
        <div>
          <Label>快捷动作</Label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {PRESETS.map((preset) => {
              const active = activeAction === preset.id && running;
              return (
                <button
                  key={preset.id}
                  type="button"
                  disabled={!hasProvider || running}
                  onClick={() => start(preset.id)}
                  title={preset.hint}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 6,
                    border: '1px solid ' + (active ? 'var(--primary)' : 'var(--border)'),
                    background: active ? 'color-mix(in oklab, var(--primary), transparent 88%)' : 'var(--bg)',
                    cursor: hasProvider && !running ? 'pointer' : 'not-allowed',
                    opacity: hasProvider ? 1 : 0.5,
                    fontSize: 12.5, fontWeight: 500, color: 'var(--text)',
                    transition: 'background 0.12s',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{preset.label}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-subtle)', marginTop: 2 }}>{preset.hint}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Free-form instruction */}
        <div>
          <Label>自由指令</Label>
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="例如：在 ## 用法 之后加一段 Python 调用示例"
            rows={3}
            disabled={running}
            style={{
              width: '100%', padding: 8, fontSize: 12.5,
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg)', color: 'var(--text)',
              fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5,
            }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginTop: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={useSelection}
              onChange={(e) => setUseSelection(e.target.checked)}
            />
            只针对编辑器中选中的内容
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <div style={{ fontSize: 10.5, color: 'var(--text-faint)' }}>
              预计发送 ~{fmtTokens(inputTokens)} tok
            </div>
            <div style={{ flex: 1 }} />
            {!running ? (
              <button
                className="btn sm primary"
                disabled={!hasProvider || !instruction.trim()}
                onClick={() => start('freeform')}
              >
                <IconSend size={12} /> 运行
              </button>
            ) : (
              <button
                className="btn sm"
                onClick={stop}
                style={{ color: 'var(--red-text)' }}
              >
                <IconStop size={12} /> 停止
              </button>
            )}
          </div>
        </div>

        {/* Output area */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Label>
              输出
              {running && <span style={{ color: 'var(--primary)', fontSize: 10.5, marginLeft: 6 }}>● 流式生成中</span>}
              {hasOutput && (
                <span style={{ color: 'var(--text-faint)', fontSize: 10.5, marginLeft: 6, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                  ~{fmtTokens(outputTokens)} tok
                </span>
              )}
            </Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {hasOutput && (
                <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', marginRight: 4 }}>
                  <button
                    type="button"
                    onClick={() => setViewMode('rendered')}
                    style={{
                      fontSize: 10.5, padding: '2px 8px', border: 'none',
                      background: viewMode === 'rendered' ? 'var(--primary)' : 'transparent',
                      color: viewMode === 'rendered' ? '#fff' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >预览</button>
                  <button
                    type="button"
                    onClick={() => setViewMode('raw')}
                    style={{
                      fontSize: 10.5, padding: '2px 8px', border: 'none',
                      borderLeft: '1px solid var(--border)',
                      background: viewMode === 'raw' ? 'var(--primary)' : 'transparent',
                      color: viewMode === 'raw' ? '#fff' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >原文</button>
                </div>
              )}
              {hasOutput && (
                <>
                  <button
                    className="btn sm ghost"
                    onClick={copyOutput}
                    title="复制全部"
                  >
                    {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  </button>
                  <button
                    className="btn sm ghost"
                    onClick={() => { setOutput(''); setStreamErr(null); }}
                    disabled={running}
                    title="清空"
                  >
                    <IconX size={12} />
                  </button>
                </>
              )}
            </div>
          </div>

          {hasOutput && viewMode === 'rendered' ? (
            <div
              className="ai-output-rendered"
              style={{
                flex: 1, minHeight: 200, maxHeight: 360,
                padding: 12, fontSize: 13,
                border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg-soft)', color: 'var(--text)',
                lineHeight: 1.6,
                overflow: 'auto',
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(output) }}
            />
          ) : (
            <div
              style={{
                flex: 1, minHeight: 200, maxHeight: 360,
                padding: 10, fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg-soft)', color: 'var(--text)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                overflow: 'auto',
              }}
            >
              {hasOutput ? output : (
                <span style={{ color: 'var(--text-faint)' }}>
                  {running ? '...' : '点击上方动作按钮，或填写自由指令后运行。'}
                </span>
              )}
            </div>
          )}

          {streamErr && (
            <div style={{ fontSize: 11.5, color: 'var(--red-text)', background: 'var(--red-bg)', padding: '6px 10px', borderRadius: 6, lineHeight: 1.5 }}>
              {streamErr}
            </div>
          )}
        </div>

        {/* Apply / regenerate row — only meaningful once we have output */}
        {hasOutput && !running && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button className="btn sm" onClick={() => bridge.insertAtCursor(output)}>插入光标</button>
            <button className="btn sm" onClick={() => bridge.replaceSelection(output)}>替换选中</button>
            <button className="btn sm" onClick={() => bridge.replaceAll(output)}>替换全文</button>
            <div style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={regenerate} title="用相同指令重新生成">
              <IconRefresh size={12} /> 重新生成
            </button>
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '8px 16px', borderTop: '1px solid var(--border)',
        fontSize: 10.5, color: 'var(--text-faint)',
      }}>
        AI 输出仅作为草稿。建议在保存前阅读并自行调整。
      </div>
    </aside>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
      {children}
    </div>
  );
}
