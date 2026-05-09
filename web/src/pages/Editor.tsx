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

export function Editor() {
  const { ns = 'platform-team', name = 'go-code-review' } = useParams();
  const navigate = useNavigate();
  const [openFile, setOpenFile] = useState('skill.yaml');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const validation = useAsync<ValidationReport>(() => api.validate(ns, name), [ns, name]);
  const skill = useAsync(() => api.getSkill(ns, name), [ns, name]);
  const policy = useAsync(
    () => api.namespacePolicy(ns, (skill.data?.classification ?? 'L2') as 'L1' | 'L2' | 'L3'),
    [ns, skill.data?.classification],
  );

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
    setSubmitting(true); setMsg(null);
    try {
      const r = await api.submitForReview(ns, name, { version: '1.3.0', note: '请审批' });
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
            <span className="tag indigo mono">v1.3.0</span>
            <span className="status-pill draft"><span className="swatch"></span>Draft</span>
          </h1>
          <p className="page-subtitle">未保存的更改 · 上次自动保存 <span className="mono">2 分钟前</span></p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconCode size={14} /> 预览渲染</button>
          <button className="btn" onClick={runValidate}><IconCheckCircle size={14} /> Validate</button>
          <button className="btn primary" disabled={submitting} onClick={submitForReview}>
            <IconRocket size={14} /> {submitting ? '提交中...' : '提交审批'}
          </button>
        </div>
      </div>

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
