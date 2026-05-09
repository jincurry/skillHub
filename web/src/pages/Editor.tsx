import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MonacoEditor from '@monaco-editor/react';
import {
  IconCode, IconCheckCircle, IconRocket, IconChevronDown, IconChevronRight,
  IconAlertTriangle, IconXCircle,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { ValidationReport } from '../api/types';

// Build a YAML draft from the live skill record so the editor opens with the
// real metadata instead of a hardcoded sample.
function yamlFromSkill(s: { ns?: string; name?: string; version?: string; classification?: string; desc?: string; tags?: string[] } | null | undefined, ns: string, name: string): string {
  const ver = s?.version ?? '1.0.0';
  const cls = s?.classification ?? 'L2';
  const desc = (s?.desc ?? '').trim();
  const tags = (s?.tags ?? []).map((t) => `  - ${t}`).join('\n') || '  []';
  return `name: ${name}\nversion: "${ver}"\nnamespace: ${ns}\nclassification: ${cls}\n# Skill metadata — every field is required before submitting for review.\ndescription: |\n  ${desc.replace(/\n/g, '\n  ') || 'TODO: write a clear one-paragraph description.'}\n\nruntime:\n  image: "alpine:3.19"\n  timeout: 60s\n  memory: "512Mi"\n\ntags:\n${tags}\n\ninputs: []\n`;
}

// Compute the next semver bump from the current version. Falls back to 0.1.0.
function bumpVersion(current?: string): string {
  if (!current) return '0.1.0';
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return current;
  const [, maj, min, patch] = m;
  return `${maj}.${parseInt(min, 10) + 1}.${patch}`;
}

export function Editor() {
  const { ns = 'platform-team', name = 'go-code-review' } = useParams();
  const navigate = useNavigate();
  const [openFile, setOpenFile] = useState('skill.yaml');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitVersion, setSubmitVersion] = useState('');
  const [submitNote, setSubmitNote] = useState('');
  const validation = useAsync<ValidationReport>(() => api.validate(ns, name), [ns, name]);
  const skill = useAsync(() => api.getSkill(ns, name), [ns, name]);
  const policy = useAsync(
    () => api.namespacePolicy(ns, (skill.data?.classification ?? 'L2') as 'L1' | 'L2' | 'L3'),
    [ns, skill.data?.classification],
  );

  const currentVersion = skill.data?.version ?? '0.1.0';
  const nextVersion = bumpVersion(currentVersion);

  // Pre-fill the submit dialog when it opens.
  useEffect(() => {
    if (showSubmit) {
      setSubmitVersion((v) => v || nextVersion);
    }
  }, [showSubmit, nextVersion]);

  const runValidate = async () => {
    setMsg('验证中...');
    try {
      const r = await api.validate(ns, name);
      validation.reload();
      setMsg(`验证完成 · 得分 ${r.score}/100 · ${r.summary}`);
    } catch (e) {
      setMsg(`验证失败: ${(e as Error).message}`);
    }
  };

  const submitForReview = async () => {
    if (!submitVersion.trim()) {
      setMsg('请填写新版本号');
      return;
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
      // surface validation blockers in the side panel
      if (m.includes('validation failed') || m.startsWith('422')) {
        validation.reload();
        setMsg('提交被拦截:存在 validation 错误,请查看右侧面板修复后再提交。');
      } else {
        setMsg(`提交失败: ${m}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const initialYaml = useMemo(
    () => yamlFromSkill(skill.data, ns, name),
    [skill.data, ns, name],
  );
  const [draft, setDraft] = useState<string>(initialYaml);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(initialYaml);
  }, [initialYaml, dirty]);

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{ns} /</span>
            {name}
            <span className="tag indigo mono">v{currentVersion}</span>
            <span className="status-pill draft"><span className="swatch"></span>Draft</span>
          </h1>
          <p className="page-subtitle">
            当前版本 <span className="mono">v{currentVersion}</span>
            {dirty && <span style={{ color: 'var(--amber-text)', marginLeft: 8 }}>· 未保存的更改</span>}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconCode size={14} /> 预览渲染</button>
          <button className="btn" onClick={runValidate}><IconCheckCircle size={14} /> Validate</button>
          <button className="btn primary" disabled={submitting} onClick={() => setShowSubmit(true)}>
            <IconRocket size={14} /> {submitting ? '提交中...' : '提交审批'}
          </button>
        </div>
      </div>

      {showSubmit && (
        <div
          onClick={() => !submitting && setShowSubmit(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg)', borderRadius: 10, width: 480, maxWidth: '92vw',
              boxShadow: '0 20px 50px rgba(15,23,42,0.25)', border: '1px solid var(--border)',
            }}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>提交审批</h3>
              <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 4 }}>
                当前版本 <span className="mono">v{currentVersion}</span> · 默认 bump 到 <span className="mono">v{nextVersion}</span>
              </div>
            </div>
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ display: 'block' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>新版本号</div>
                <input
                  className="input"
                  value={submitVersion}
                  onChange={(e) => setSubmitVersion(e.target.value)}
                  placeholder={nextVersion}
                  style={{ width: '100%', fontFamily: "'JetBrains Mono', monospace" }}
                />
              </label>
              <label style={{ display: 'block' }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 4 }}>提交说明（可选）</div>
                <textarea
                  className="input"
                  rows={4}
                  value={submitNote}
                  onChange={(e) => setSubmitNote(e.target.value)}
                  placeholder="本次变更的关键点,会显示给审批人..."
                  style={{ width: '100%', resize: 'vertical' }}
                />
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

      {msg && (
        <div className="card" style={{ marginBottom: 'var(--gap)', borderLeft: '3px solid var(--primary)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13 }}>{msg}</span>
            <button className="btn sm ghost" onClick={() => setMsg(null)}>关闭</button>
          </div>
        </div>
      )}

      <div className="editor-grid">
        <div className="editor-files">
          <div className="file-row dir"><IconChevronDown size={12} /> {name}</div>
          <div className={`file-row ${openFile === 'skill.yaml' ? 'active' : ''}`} onClick={() => setOpenFile('skill.yaml')}>
            <span style={{ color: '#dc2626' }}>📄</span> skill.yaml <span className="file-status M">M</span>
          </div>
          <div className="file-row"><span>📄</span> README.md <span className="file-status M">M</span></div>
          <div className="file-row"><span>📄</span> CHANGELOG.md <span className="file-status A">A</span></div>
          <div className="file-row dir" style={{ marginTop: 4 }}><IconChevronDown size={12} /> rules/</div>
          <div className="file-row" style={{ paddingLeft: 32 }}><span>🔧</span> error-wrap.go</div>
          <div className="file-row" style={{ paddingLeft: 32 }}><span>🔧</span> nil-deref.go</div>
          <div className="file-row" style={{ paddingLeft: 32 }}><span>🔧</span> generics-bounds.go <span className="file-status A">A</span></div>
          <div className="file-row" style={{ paddingLeft: 32 }}><span>🔧</span> context-leak.go</div>
          <div className="file-row dir" style={{ marginTop: 4 }}><IconChevronRight size={12} /> tests/</div>
          <div className="file-row dir"><IconChevronRight size={12} /> docs/</div>
          <div className="file-row"><span>📄</span> .skillhub/config.yaml</div>
          <div className="file-row"><span>📄</span> Dockerfile</div>
        </div>

        <div className="editor-main">
          <div className="editor-tabs">
            <div className="editor-tab active">
              <span style={{ color: '#dc2626' }}>📄</span> skill.yaml
              <span style={{ marginLeft: 6, opacity: 0.5 }}>×</span>
            </div>
            <div className="editor-tab">
              <span>🔧</span> generics-bounds.go
              <span style={{ marginLeft: 6, opacity: 0.5 }}>×</span>
            </div>
          </div>
          <div className="editor-code" style={{ display: 'block', padding: 0, height: 520 }}>
            <MonacoEditor
              height="520px"
              language="yaml"
              theme="vs-dark"
              value={draft}
              onChange={(v) => { setDraft(v ?? ''); setDirty(true); }}
              options={{
                minimap: { enabled: false },
                fontSize: 12.5,
                tabSize: 2,
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                automaticLayout: true,
                renderWhitespace: 'selection',
              }}
            />
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
            <div className="editor-side-title">问题 (3)</div>
            {[
              { sev: 'warn', file: 'skill.yaml', line: 12, msg: 'timeout 60s 超过推荐值 30s' },
              { sev: 'warn', file: 'rules/generics-bounds.go', line: 48, msg: '未使用的导入 fmt' },
              { sev: 'info', file: 'README.md', line: 1, msg: '缺少 Examples 章节' },
            ].map((p, i) => (
              <div key={i} style={{ padding: '8px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 2 }}>
                  {p.sev === 'warn'
                    ? <IconAlertTriangle size={12} style={{ color: 'var(--amber)' }} />
                    : <IconCheckCircle size={12} style={{ color: 'var(--blue, #3b82f6)' }} />}
                  <span className="mono" style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.file}:{p.line}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45, paddingLeft: 18 }}>{p.msg}</div>
              </div>
            ))}
          </div>

          <div className="editor-side-section">
            <div className="editor-side-title">变更预览</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
              <span style={{ color: 'var(--text-subtle)' }}>从 v1.2.3</span>
              <span className="mono">→ v1.3.0</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              <div><span style={{ color: 'var(--green-text)' }}>+ 4 个新文件</span></div>
              <div><span style={{ color: 'var(--amber-text)' }}>~ 3 个修改</span></div>
              <div><span style={{ color: 'var(--text-faint)' }}>- 0 个删除</span></div>
              <div style={{ marginTop: 6 }}>影响范围: <strong style={{ color: 'var(--text)' }}>非破坏性</strong></div>
            </div>
            <button className="btn sm" style={{ width: '100%', marginTop: 10 }}><IconCode size={12} /> 查看完整 Diff</button>
          </div>
        </div>
      </div>
    </div>
  );
}
