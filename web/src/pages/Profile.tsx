import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconSettings, IconRocket, IconCheckCircle,
  IconStar, IconCode, IconAlertTriangle, IconUsers,
  IconCamera, IconImage,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import type { AuditLog, Me } from '../api/types';
import { AvatarUploadModal } from '../components/AvatarUploadModal';
import { CoverPicker } from '../components/CoverPicker';
import { coverBackground, avatarFallbackGradient } from '../lib/profile';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ProfileStat({ label, value, sub, color = 'var(--primary)' }: {
  label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{ padding: '14px 18px', borderRight: '1px solid var(--border)', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="num" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, color }}>{value}</span>
        {sub && <span style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>{sub}</span>}
      </div>
    </div>
  );
}

// Map audit-log action codes to a renderable activity entry. Keep this list in
// sync with server/internal/model/model.go (see ACTION_COLOR in Audit.tsx).
const ACTIVITY_META: Record<string, { icon: ReactNode; color: string; verb: string }> = {
  publish:           { icon: <IconRocket size={14} />,         color: 'green',  verb: '发布了' },
  yank:              { icon: <IconAlertTriangle size={14} />,  color: 'red',    verb: '撤回了' },
  deprecated:        { icon: <IconAlertTriangle size={14} />,  color: 'amber',  verb: '弃用了' },
  approve_review:    { icon: <IconCheckCircle size={14} />,    color: 'green',  verb: '批准了审批' },
  reject_review:     { icon: <IconAlertTriangle size={14} />,  color: 'red',    verb: '驳回了审批' },
  request_changes:   { icon: <IconAlertTriangle size={14} />,  color: 'amber',  verb: '要求修改' },
  submit_review:     { icon: <IconCode size={14} />,           color: 'blue',   verb: '提交了审批' },
  create_draft:      { icon: <IconCode size={14} />,           color: 'blue',   verb: '创建了草稿' },
  create_namespace:  { icon: <IconUsers size={14} />,          color: 'green',  verb: '创建了命名空间' },
  add_maintainer:    { icon: <IconUsers size={14} />,          color: 'green',  verb: '添加了维护者于' },
  remove_maintainer: { icon: <IconUsers size={14} />,          color: 'amber',  verb: '移除了维护者于' },
  activate:          { icon: <IconRocket size={14} />,         color: 'blue',   verb: '激活了' },
  update_settings:   { icon: <IconSettings size={14} />,       color: 'amber',  verb: '更新了设置' },
  rotate_key:        { icon: <IconSettings size={14} />,       color: 'amber',  verb: '轮换了密钥' },
  update_profile:    { icon: <IconUsers size={14} />,          color: 'blue',   verb: '更新了个人资料' },
  rate:              { icon: <IconStar size={14} />,           color: 'amber',  verb: '评分了' },
};

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString();
}

function ActivityRow({ entry }: { entry: AuditLog }) {
  const meta = ACTIVITY_META[entry.action] ?? {
    icon: <IconCode size={14} />, color: 'blue', verb: entry.action,
  };
  const target = entry.target || '—';
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: `var(--${meta.color}-bg)`, color: `var(--${meta.color}-text)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>{meta.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: 1.45 }}>
          {meta.verb} <strong>{target}</strong>
          {entry.version && <> <span className="mono" style={{ color: 'var(--text-subtle)' }}>v{entry.version}</span></>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 3 }}>
          {fmtRelative(entry.createdAt)}
        </div>
      </div>
    </div>
  );
}

function Achievement({ icon, name, desc, earned, rare, progress, hint }: {
  icon: string; name: string; desc: string; earned?: boolean; rare?: boolean;
  progress?: number; hint?: string;
}) {
  const pct = Math.max(0, Math.min(1, progress ?? (earned ? 1 : 0)));
  return (
    <div
      title={hint && !earned ? hint : undefined}
      style={{
        display: 'flex', gap: 12, padding: 14,
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        background: earned ? 'var(--bg-elevated)' : 'var(--bg-muted)',
        opacity: earned ? 1 : 0.7,
      }}
    >
      <div style={{
        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
        background: earned
          ? `linear-gradient(135deg, ${rare ? '#f59e0b' : 'var(--primary)'}, ${rare ? '#dc2626' : 'color-mix(in oklab, var(--primary), #ec4899 30%)'})`
          : 'var(--bg)',
        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
        boxShadow: earned ? `0 2px 8px ${rare ? 'rgb(245 158 11 / 0.3)' : 'rgb(79 70 229 / 0.25)'}` : 'none',
        filter: earned ? 'none' : 'grayscale(1)',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {name}
          {rare && earned && <span className="tag amber" style={{ fontSize: 10 }}>稀有</span>}
          {!earned && pct > 0 && (
            <span className="num" style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 500, marginLeft: 'auto' }}>
              {Math.round(pct * 100)}%
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', lineHeight: 1.4, marginTop: 2 }}>{desc}</div>
        {!earned && (
          <div style={{ marginTop: 6, height: 4, background: 'var(--bg)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct * 100}%`,
              background: rare ? 'linear-gradient(90deg,#f59e0b,#dc2626)' : 'var(--primary)',
              transition: 'width 0.3s',
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export function Profile() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'overview' | 'skills' | 'activity' | 'achievements' | 'settings'>('overview');
  const [editing, setEditing] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);

  const me = useAsync(() => api.me(), []);
  const stats = useAsync(() => api.meStats(), []);
  const allSkills = useAsync(() => api.listSkills(), []);
  const achievements = useAsync(() => api.meAchievements(), []);

  // Audit log filtered by the current user. Backend already supports actor=...
  const username = me.data?.username;
  const activity = useAsync<AuditLog[]>(
    () => username ? api.listAuditLogs({ actor: username, limit: 50 }) : Promise.resolve([]),
    [username],
  );

  // Surface backend errors prominently — without this the page silently shows
  // empty values and users wonder why nothing matches their account.
  if (me.error) {
    return (
      <div className="content-inner">
        <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
          <div className="card-body" style={{ padding: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red-text)', marginBottom: 8 }}>
              载入个人信息失败
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
              <code className="mono" style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>{me.error.message}</code>
            </div>
            <button className="btn sm" onClick={() => me.reload()}>重试</button>
          </div>
        </div>
      </div>
    );
  }

  const mySkills = (allSkills.data ?? []).filter((s) => s.author === username);

  const display = me.data?.display ?? '...';
  const role = me.data?.role ?? '';
  const team = me.data?.team ?? '';
  const email = me.data?.email ?? '';
  const bio = me.data?.bio ?? '';
  const location = me.data?.location ?? '';
  const joinedAt = me.data?.joinedAt ?? '';
  const initial = display.trim().charAt(0).toUpperCase() || '?';

  function handleSaved() {
    me.reload();
    setEditing(false);
  }

  return (
    <div className="content-inner">
      {/* banner --------------------------------------------------------- */}
      <div style={{
        height: 120, borderRadius: 'var(--radius-lg)',
        background: coverBackground(me.data),
        position: 'relative', marginBottom: 16, overflow: 'hidden',
      }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.25 }} viewBox="0 0 800 120" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="800" height="120" fill="url(#grid)" />
        </svg>
        {me.data && (
          <button
            onClick={() => setCoverOpen(true)}
            title="修改封面"
            style={{
              position: 'absolute', top: 10, right: 10,
              padding: '6px 10px', fontSize: 12, fontWeight: 500,
              background: 'rgba(0,0,0,0.35)', color: 'white',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: 6,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              backdropFilter: 'blur(4px)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.55)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.35)'; }}
          >
            <IconImage size={13} /> 修改封面
          </button>
        )}
      </div>

      {/* avatar + meta -------------------------------------------------- */}
      <div style={{ position: 'relative', marginBottom: 20, padding: '0 8px' }}>
        <div style={{ position: 'relative', width: 104, height: 104, marginTop: -72 }}>
          <div style={{
            width: 104, height: 104, borderRadius: '50%', overflow: 'hidden',
            background: avatarFallbackGradient(username || 'guest'),
            color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 42, fontWeight: 700,
            border: '4px solid var(--bg-soft)', boxShadow: 'var(--shadow-lg)',
          }}>
            {me.data?.avatarUrl
              ? <img src={me.data.avatarUrl} alt={display} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initial}
          </div>
          {me.data && (
            <button
              onClick={() => setAvatarOpen(true)}
              title="修改头像"
              style={{
                position: 'absolute', bottom: 2, right: 2,
                width: 30, height: 30, borderRadius: '50%',
                background: 'var(--primary)', color: 'white',
                border: '3px solid var(--bg-soft)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: 'var(--shadow-sm)', transition: 'transform 0.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              <IconCamera size={14} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginTop: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{display}</h1>
              {role && <span className="tag indigo">{role}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span className="mono">@{username ?? '...'}</span>
              {team && (<><span style={{ color: 'var(--text-faint)' }}>·</span><span>{team}</span></>)}
              {location && (<><span style={{ color: 'var(--text-faint)' }}>·</span><span>📍 {location}</span></>)}
              {joinedAt && (
                <>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                  <span>加入于 {new Date(joinedAt).toLocaleDateString()}</span>
                </>
              )}
            </div>
            {bio && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10, maxWidth: 680, lineHeight: 1.55 }}>
                {bio}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn primary" onClick={() => setEditing(true)}><IconSettings size={14} /> 编辑资料</button>
          </div>
        </div>
      </div>

      {/* stat strip ----------------------------------------------------- */}
      <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 'var(--gap)' }}>
        <ProfileStat
          label="发布的 Skills"
          value={String(stats.data?.published ?? '—')}
          sub={stats.data?.drafts ? `${stats.data.drafts} 个 draft` : undefined}
        />
        <ProfileStat
          label="累计激活"
          value={(stats.data?.activations ?? 0).toLocaleString()}
          color="#10b981"
        />
        <ProfileStat
          label="完成审批"
          value={String(stats.data?.reviewsCompleted ?? '—')}
          sub={stats.data?.pendingReviews ? `${stats.data.pendingReviews} 个待我审` : undefined}
          color="#f59e0b"
        />
        <ProfileStat
          label="收到的 ⭐"
          value={String(stats.data?.ratingsReceived ?? '—')}
          sub={stats.data && stats.data.avgRating > 0 ? `平均 ${stats.data.avgRating.toFixed(1)}` : undefined}
        />
        <ProfileStat
          label="待我审批"
          value={String(stats.data?.pendingReviews ?? '—')}
          color="#dc2626"
        />
      </div>

      {/* tabs ----------------------------------------------------------- */}
      <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 'var(--gap)' }}>
        {([
          { id: 'overview', label: '概览' },
          { id: 'skills', label: 'Skills', count: mySkills.length },
          { id: 'activity', label: '动态', count: activity.data?.length ?? 0 },
          { id: 'achievements', label: '成就', count: achievements.data?.length ?? 0 },
          { id: 'settings', label: '设置' },
        ] as const).map((it) => (
          <div key={it.id} onClick={() => setTab(it.id)} style={{
            padding: '10px 0', cursor: 'pointer', fontSize: 13.5,
            fontWeight: tab === it.id ? 600 : 500,
            color: tab === it.id ? 'var(--text)' : 'var(--text-subtle)',
            borderBottom: tab === it.id ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {it.label}
            {'count' in it && it.count !== undefined && it.count > 0 && (
              <span className="count-pill">{it.count}</span>
            )}
          </div>
        ))}
      </div>

      {/* overview tab --------------------------------------------------- */}
      {tab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">📌 我的 Skills</h3>
              {mySkills.length > 4 && (
                <span style={{ fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }} onClick={() => setTab('skills')}>查看全部 →</span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>
              {allSkills.loading && (
                <div style={{ padding: 18, background: 'var(--bg-elevated)', gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-subtle)' }}>
                  加载中...
                </div>
              )}
              {!allSkills.loading && mySkills.length === 0 && (
                <div style={{ padding: 18, background: 'var(--bg-elevated)', gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-subtle)' }}>
                  你还没有作为作者发布的 skill。
                </div>
              )}
              {mySkills.slice(0, 4).map((s) => (
                <div
                  key={s.id}
                  style={{ padding: 14, background: 'var(--bg-elevated)', cursor: 'pointer' }}
                  onClick={() => navigate(`/skills/${s.ns}/${s.name}`)}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div className={`skill-icon ${s.iconClass}`} style={{ width: 32, height: 32, fontSize: 13 }}>{s.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                        <span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{s.ns}/</span>{s.name}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2, display: 'flex', gap: 8 }}>
                        <span className="mono">v{s.version}</span>
                        {s.activations > 0 && (
                          <>
                            <span>·</span>
                            <span>{s.activations.toLocaleString()} 激活/周</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="card-title">🕒 最近动态</h3>
              {(activity.data?.length ?? 0) > 4 && (
                <span style={{ fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }} onClick={() => setTab('activity')}>查看全部 →</span>
              )}
            </div>
            <div className="card-body flush">
              {activity.loading && (
                <div style={{ padding: 14, fontSize: 13, color: 'var(--text-subtle)' }}>加载中...</div>
              )}
              {activity.error && (
                <div style={{ padding: 14, fontSize: 13, color: 'var(--red-text)' }}>{activity.error.message}</div>
              )}
              {!activity.loading && !activity.error && (activity.data?.length ?? 0) === 0 && (
                <div style={{ padding: 14, fontSize: 13, color: 'var(--text-subtle)' }}>暂无动态</div>
              )}
              {(activity.data ?? []).slice(0, 4).map((a) => <ActivityRow key={a.id} entry={a} />)}
            </div>
          </div>
        </div>
      )}

      {/* skills tab ----------------------------------------------------- */}
      {tab === 'skills' && (
        <div className="card">
          <div className="card-body flush table-wrap">
            {allSkills.loading && (
              <div style={{ padding: 16, fontSize: 12, color: 'var(--text-subtle)' }}>加载中...</div>
            )}
            {!allSkills.loading && mySkills.length === 0 && (
              <div style={{ padding: 16, fontSize: 13, color: 'var(--text-subtle)' }}>
                你还没有作为作者发布的 skill。
              </div>
            )}
            {mySkills.length > 0 && (
              <table className="tbl">
                <thead><tr><th>Skill</th><th>状态</th><th style={{ textAlign: 'right' }}>当前版本</th><th style={{ textAlign: 'right' }}>激活/周</th></tr></thead>
                <tbody>
                  {mySkills.map((s) => (
                    <tr key={s.id} onClick={() => navigate(`/skills/${s.ns}/${s.name}`)}>
                      <td>
                        <div className="tbl-name">
                          <div className={`skill-icon ${s.iconClass}`}>{s.icon}</div>
                          <div className="skill-name-text"><span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{s.ns}/</span>{s.name}</div>
                        </div>
                      </td>
                      <td><span className={`tag ${s.status === 'published' ? 'green' : s.status === 'review' ? 'amber' : s.status === 'yanked' ? 'red' : 'outline'}`}>{s.status}</span></td>
                      <td style={{ textAlign: 'right' }}><span className="mono num">v{s.version}</span></td>
                      <td className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{s.activations > 0 ? s.activations.toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* activity tab --------------------------------------------------- */}
      {tab === 'activity' && (
        <div className="card">
          <div className="card-body flush">
            {activity.loading && (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--text-subtle)' }}>加载中...</div>
            )}
            {activity.error && (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--red-text)' }}>{activity.error.message}</div>
            )}
            {!activity.loading && !activity.error && (activity.data?.length ?? 0) === 0 && (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--text-subtle)' }}>暂无动态</div>
            )}
            {(activity.data ?? []).map((a) => <ActivityRow key={a.id} entry={a} />)}
          </div>
        </div>
      )}

      {/* achievements tab ---------------------------------------------- */}
      {tab === 'achievements' && (
        <div>
          {achievements.loading && <div style={{ color: 'var(--text-subtle)' }}>加载中...</div>}
          {achievements.error && <div style={{ color: 'var(--red-text)' }}>{achievements.error.message}</div>}
          {achievements.data && (
            <>
              {(() => {
                const earned = achievements.data.filter((a) => a.earned).length;
                const total = achievements.data.length;
                const pct = total > 0 ? Math.round((earned / total) * 100) : 0;
                return (
                  <div style={{ fontSize: 13, color: 'var(--text-subtle)', marginBottom: 14 }}>
                    已解锁 <strong style={{ color: 'var(--text)' }}>{earned}</strong> / {total} 个成就 · 完成度 {pct}%
                  </div>
                );
              })()}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {achievements.data.map((a) => (
                  <Achievement
                    key={a.id}
                    icon={a.icon}
                    name={a.name}
                    desc={a.desc}
                    earned={a.earned}
                    rare={a.rare}
                    progress={a.progress}
                    hint={a.hint}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* settings tab --------------------------------------------------- */}
      {tab === 'settings' && (
        <div style={{ maxWidth: 560 }}>
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">基本信息</h3>
              <button className="btn sm" onClick={() => setEditing(true)}>
                <IconSettings size={12} /> 编辑
              </button>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: '显示名', value: display },
                { label: '用户名', value: `@${username ?? ''}` },
                { label: '邮箱', value: email || '—' },
                { label: '主要团队', value: team || '—' },
                { label: '所在地', value: location || '—' },
                { label: '简介', value: bio || '—' },
              ].map((f) => (
                <div key={f.label}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{f.label}</div>
                  <div style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', fontSize: 13, whiteSpace: 'pre-wrap' }}>{f.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EditProfileModal
          initial={{ display, email, bio, location }}
          readonly={{ username: username ?? '', role, team, joinedAt }}
          onClose={() => setEditing(false)}
          onSaved={handleSaved}
        />
      )}

      {me.data && (
        <AvatarUploadModal
          open={avatarOpen}
          me={me.data}
          onClose={() => setAvatarOpen(false)}
          onUpdated={(next: Me) => me.set(next)}
        />
      )}
      {me.data && (
        <CoverPicker
          open={coverOpen}
          me={me.data}
          onClose={() => setCoverOpen(false)}
          onUpdated={(next: Me) => me.set(next)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// edit modal
// ---------------------------------------------------------------------------

function EditProfileModal({
  initial, readonly, onClose, onSaved,
}: {
  initial: { display: string; email: string; bio: string; location: string };
  readonly: { username: string; role: string; team: string; joinedAt: string };
  onClose: () => void;
  onSaved: (m: import('../api/types').Me) => void;
}) {
  const [display, setDisplay] = useState(initial.display);
  const [email, setEmail] = useState(initial.email);
  const [bio, setBio] = useState(initial.bio);
  const [location, setLocation] = useState(initial.location);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const updated = await api.updateMe({
        display: display.trim(),
        email: email.trim(),
        bio,
        location: location.trim(),
      });
      onSaved(updated);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const initialChar = display.trim().charAt(0).toUpperCase() || '?';
  const joinedDate = readonly.joinedAt ? new Date(readonly.joinedAt).toLocaleDateString() : '—';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgb(15 23 42 / 0.55)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lg)', width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>编辑资料</div>
            <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 2 }}>保存后会立即对所有人可见</div>
          </div>
          <button className="btn sm ghost" onClick={onClose} style={{ fontSize: 18, padding: '2px 10px' }}>×</button>
        </div>
        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,#f59e0b,#ec4899)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700, flexShrink: 0 }}>{initialChar}</div>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--text-subtle)', lineHeight: 1.5 }}>
              下方 4 项可以随时修改。用户名、角色、主要团队、加入时间由管理员维护，不能在这里修改。
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 4 }}>可修改字段</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>显示名称</div>
            <input className="input" value={display} onChange={(e) => setDisplay(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>邮箱</div>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>所在地</div>
            <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Shanghai · UTC+8" style={{ width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>个人简介</div>
            <textarea className="input" rows={4} value={bio} onChange={(e) => setBio(e.target.value)} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>纯文本 · 最多 500 字符</div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 8 }}>管理员维护 · 仅可读</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: '用户名', value: `@${readonly.username}`, mono: true },
              { label: '角色', value: readonly.role || '—' },
              { label: '主要团队', value: readonly.team || '—' },
              { label: '加入时间', value: joinedDate },
            ].map((f) => (
              <div key={f.label}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginBottom: 5 }}>{f.label}</div>
                <div className={f.mono ? 'mono' : ''} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', fontSize: 13, color: 'var(--text-subtle)' }}>{f.value}</div>
              </div>
            ))}
          </div>
          {err && <div style={{ color: 'var(--red-text)', fontSize: 12.5 }}>{err}</div>}
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 8, background: 'var(--bg-soft)' }}>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
