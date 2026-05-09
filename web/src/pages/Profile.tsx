import { useState, type ReactNode } from 'react';
import {
  IconChat, IconBell, IconSettings, IconRocket, IconCheckCircle,
  IconStar, IconCode, IconAlertTriangle, IconUsers, IconBookmark,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';

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

function ContribGraph() {
  const weeks = 16, days = 7;
  const cells: number[][] = [];
  let seed = 17;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let w = 0; w < weeks; w++) {
    const col: number[] = [];
    for (let d = 0; d < days; d++) {
      const r = rand();
      let lvl = 0;
      if (r > 0.3) lvl = 1;
      if (r > 0.55) lvl = 2;
      if (r > 0.75) lvl = 3;
      if (r > 0.9) lvl = 4;
      col.push(lvl);
    }
    cells.push(col);
  }
  const colors = [
    'var(--bg-muted)',
    'color-mix(in oklab, var(--primary), white 70%)',
    'color-mix(in oklab, var(--primary), white 45%)',
    'color-mix(in oklab, var(--primary), white 20%)',
    'var(--primary)',
  ];
  return (
    <div>
      <div style={{ display: 'flex', gap: 32, fontSize: 11, color: 'var(--text-faint)', marginBottom: 6, paddingLeft: 24 }}>
        {['12月', '1月', '2月', '3月'].map((m) => <span key={m}>{m}</span>)}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, color: 'var(--text-faint)', justifyContent: 'space-between', paddingTop: 2, paddingBottom: 2 }}>
          <span>一</span><span></span><span>三</span><span></span><span>五</span><span></span><span></span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {cells.map((col, w) => (
            <div key={w} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {col.map((lvl, d) => (
                <div key={d} title={`${lvl} 次贡献`} style={{
                  width: 12, height: 12, borderRadius: 2.5, background: colors[lvl],
                  border: '1px solid color-mix(in oklab, var(--border), transparent 50%)',
                }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
        <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>过去 16 周共 <strong style={{ color: 'var(--text)' }}>247</strong> 次贡献</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-faint)' }}>
          <span>少</span>
          {colors.map((c, i) => <div key={i} style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '1px solid color-mix(in oklab, var(--border), transparent 50%)' }} />)}
          <span>多</span>
        </div>
      </div>
    </div>
  );
}

function ActivityRow({ icon, color, title, time, meta }: {
  icon: ReactNode; color: string; title: ReactNode; time: string; meta?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: `var(--${color}-bg)`, color: `var(--${color}-text)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, lineHeight: 1.45 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 3, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{time}</span>
          {meta && <><span>·</span><span>{meta}</span></>}
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

export function Profile() {
  const [tab, setTab] = useState<'overview' | 'skills' | 'activity' | 'achievements' | 'settings'>('overview');
  const [editing, setEditing] = useState(false);

  const me = useAsync(() => api.me(), []);
  const stats = useAsync(() => api.meStats(), []);
  const allSkills = useAsync(() => api.listSkills(), []);
  const achievements = useAsync(() => api.meAchievements(), []);

  // Skills authored by the current user.
  const mySkills = (allSkills.data ?? []).filter((s) => s.author === me.data?.username);

  const teams = [
    { id: 'platform-team', role: 'Maintainer', members: 12, skills: 12 as number | null },
    { id: 'data-team', role: 'Reviewer', members: 8, skills: 8 as number | null },
    { id: '@core-reviewers', role: 'Member', members: 24, skills: null as number | null },
  ];

  const display = me.data?.display ?? '...';
  const username = me.data?.username ?? '...';
  const role = me.data?.role ?? '';
  const team = me.data?.team ?? '';
  const email = me.data?.email ?? '';
  const bio = me.data?.bio ?? '';
  const location = me.data?.location ?? '';
  const joinedAt = me.data?.joinedAt ?? '';
  const initial = display.trim().charAt(0).toUpperCase() || '?';

  function handleSaved(updated: import('../api/types').Me) {
    me.reload();
    void updated; // updated returned by api.updateMe; me.reload() refreshes the cached row
    setEditing(false);
  }

  return (
    <div className="content-inner">
      <div style={{
        height: 140, borderRadius: 'var(--radius-lg)',
        background: 'linear-gradient(135deg, var(--primary) 0%, color-mix(in oklab, var(--primary), #ec4899 40%) 60%, color-mix(in oklab, var(--primary), #f59e0b 30%) 100%)',
        position: 'relative', marginBottom: 16, overflow: 'hidden',
      }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.25 }} viewBox="0 0 800 140" preserveAspectRatio="none">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="800" height="140" fill="url(#grid)" />
        </svg>
        <button className="btn sm" style={{ position: 'absolute', top: 12, right: 12, background: 'rgb(255 255 255 / 0.2)', color: 'white', border: '1px solid rgb(255 255 255 / 0.3)', backdropFilter: 'blur(4px)' }}>
          编辑封面
        </button>
      </div>

      <div style={{ position: 'relative', marginBottom: 20, padding: '0 8px' }}>
        <div style={{
          width: 104, height: 104, borderRadius: '50%',
          background: 'linear-gradient(135deg, #f59e0b, #ec4899)',
          color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 42, fontWeight: 700,
          border: '4px solid var(--bg-soft)', boxShadow: 'var(--shadow-lg)', marginTop: -72,
        }}>{initial}</div>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, marginTop: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{display}</h1>
              {role && <span className="tag indigo">{role}</span>}
              <span className="tag green">在线</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span className="mono">@{username}</span>
              {team && (
                <>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                  <span>{team}</span>
                </>
              )}
              {location && (
                <>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                  <span>📍 {location}</span>
                </>
              )}
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
            <button className="btn"><IconChat size={14} /> 私信</button>
            <button className="btn"><IconBell size={14} /> 关注</button>
            <button className="btn primary" onClick={() => setEditing(true)}><IconSettings size={14} /> 编辑资料</button>
          </div>
        </div>
      </div>

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

      <div style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--border)', marginBottom: 'var(--gap)' }}>
        {([
          { id: 'overview', label: '概览' },
          { id: 'skills', label: 'Skills', count: 12 },
          { id: 'activity', label: '动态' },
          { id: 'achievements', label: '成就', count: 14 },
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
            {'count' in it && it.count !== undefined && <span className="tag outline" style={{ fontSize: 10.5, padding: '0 5px', height: 17 }}>{it.count}</span>}
          </div>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 320px', gap: 'var(--gap)' }}>
          <div>
            <div className="card" style={{ marginBottom: 'var(--gap)' }}>
              <div className="card-header">
                <h3 className="card-title">📈 贡献热力图</h3>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>包括发布、审批、评论</span>
              </div>
              <div className="card-body" style={{ padding: 20 }}><ContribGraph /></div>
            </div>

            <div className="card" style={{ marginBottom: 'var(--gap)' }}>
              <div className="card-header">
                <h3 className="card-title">📌 置顶 Skills</h3>
                <a style={{ fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }}>编辑置顶</a>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--border)' }}>
                {mySkills.length === 0 && (
                  <div style={{ padding: 18, background: 'var(--bg-elevated)', gridColumn: '1 / -1', fontSize: 12, color: 'var(--text-subtle)' }}>
                    暂无可置顶的 skill。
                  </div>
                )}
                {mySkills.slice(0, 4).map((s) => (
                  <div key={s.id} style={{ padding: 14, background: 'var(--bg-elevated)', cursor: 'pointer' }}>
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
                <a style={{ fontSize: 12, color: 'var(--primary)', cursor: 'pointer' }} onClick={() => setTab('activity')}>查看全部 →</a>
              </div>
              <div className="card-body flush">
                <ActivityRow icon={<IconRocket size={14} />} color="green" title={<>发布了 <strong>platform-team/go-code-review</strong> <span className="mono">v1.2.3</span></>} time="2 天前" meta="审批人 @bob, @charlie" />
                <ActivityRow icon={<IconCheckCircle size={14} />} color="blue" title={<>审批通过了 <strong>data-team/csv-import</strong> <span className="mono">v2.0.1</span></>} time="3 天前" meta="平均响应 1.2h" />
                <ActivityRow icon={<IconChat size={14} />} color="amber" title={<>在 <strong>finance-team/expense-validate</strong> 留下了 4 条评论</>} time="3 天前" />
                <ActivityRow icon={<IconStar size={14} />} color="orange" title={<>收到了 <strong>@frank</strong> 的 ⭐ 评价 (5星)</>} time="5 天前" />
              </div>
            </div>
          </div>

          <div>
            <div className="card" style={{ marginBottom: 'var(--gap)' }}>
              <div className="card-header" style={{ padding: '12px 16px' }}>
                <h3 className="card-title"><IconUsers size={14} /> 所属团队</h3>
              </div>
              <div className="card-body flush">
                {teams.map((t) => (
                  <div key={t.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 6, background: 'var(--primary-50)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>
                      {t.id.startsWith('@') ? '👥' : t.id[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{t.id}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-subtle)' }}>
                        {t.role} · {t.members} 成员{t.skills !== null ? ` · ${t.skills} skills` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ marginBottom: 'var(--gap)' }}>
              <div className="card-header" style={{ padding: '12px 16px' }}><h3 className="card-title">🎯 技术领域</h3></div>
              <div className="card-body" style={{ padding: 14 }}>
                {[
                  { label: 'Go / Backend', value: 92, color: 'var(--primary)' },
                  { label: 'Kubernetes / SRE', value: 84, color: '#10b981' },
                  { label: '开发者工具', value: 78, color: '#f59e0b' },
                  { label: '代码评审', value: 88, color: '#dc2626' },
                  { label: '文档写作', value: 65, color: '#8b5cf6' },
                ].map((s) => (
                  <div key={s.label} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                      <span>{s.label}</span>
                      <span className="num" style={{ color: 'var(--text-subtle)' }}>{s.value}</span>
                    </div>
                    <div style={{ height: 5, background: 'var(--bg-muted)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${s.value}%`, background: s.color, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header" style={{ padding: '12px 16px' }}><h3 className="card-title">🔗 经常协作</h3></div>
              <div className="card-body" style={{ padding: 14 }}>
                {[
                  { name: '@bob', role: 'Reviewer', bg: 'bg-2', initial: 'B', count: 34 },
                  { name: '@charlie', role: 'Maintainer', bg: 'bg-3', initial: 'C', count: 28 },
                  { name: '@diana', role: 'Contributor', bg: 'bg-4', initial: 'D', count: 19 },
                  { name: '@frank', role: 'Maintainer', bg: 'bg-5', initial: 'F', count: 15 },
                ].map((p) => (
                  <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                    <div className={`avatar ${p.bg}`} style={{ width: 28, height: 28, fontSize: 11 }}>{p.initial}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{p.role}</div>
                    </div>
                    <div className="num" style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>{p.count} 次协作</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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
                    <tr key={s.id}>
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

      {tab === 'activity' && (
        <div className="card">
          <div className="card-body flush">
            <ActivityRow icon={<IconRocket size={14} />} color="green" title={<>发布了 <strong>platform-team/go-code-review</strong> <span className="mono">v1.2.3</span></>} time="2 天前" meta="审批人 @bob, @charlie" />
            <ActivityRow icon={<IconCheckCircle size={14} />} color="blue" title={<>审批通过了 <strong>data-team/csv-import</strong> <span className="mono">v2.0.1</span></>} time="3 天前" meta="响应 1.2h" />
            <ActivityRow icon={<IconChat size={14} />} color="amber" title={<>在 <strong>finance-team/expense-validate</strong> 留下了 4 条评论</>} time="3 天前" />
            <ActivityRow icon={<IconStar size={14} />} color="orange" title={<>收到了 <strong>@frank</strong> 的 ⭐ 评价 (5星)</>} time="5 天前" meta="拯救了我的 PR review 时间" />
            <ActivityRow icon={<IconCode size={14} />} color="blue" title={<>创建了新的 draft <strong>deploy-helper</strong> <span className="mono">v0.1.0</span></>} time="6 天前" />
            <ActivityRow icon={<IconAlertTriangle size={14} />} color="red" title={<>将 <strong>old-deploy-flow</strong> 标记为 deprecated</>} time="1 周前" meta="迁移到 deploy-helper" />
            <ActivityRow icon={<IconUsers size={14} />} color="green" title={<>加入了 <strong>@core-reviewers</strong> 团队</>} time="2 周前" />
            <ActivityRow icon={<IconBookmark size={14} />} color="blue" title={<>收藏了 <strong>data-team/sql-explain</strong></>} time="3 周前" />
          </div>
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            <a style={{ fontSize: 12.5, color: 'var(--primary)', cursor: 'pointer', fontWeight: 500 }}>加载更多 →</a>
          </div>
        </div>
      )}

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

      {tab === 'settings' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gap)' }}>
          <div className="card">
            <div className="card-header"><h3 className="card-title">基本信息</h3></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { label: '显示名', value: display },
                { label: '用户名', value: `@${username}` },
                { label: '邮箱', value: email || '—' },
                { label: '主要团队', value: team || '—' },
                { label: '所在地', value: location || '—' },
              ].map((f) => (
                <div key={f.label}>
                  <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{f.label}</div>
                  <div style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', fontSize: 13 }}>{f.value}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3 className="card-title">通知偏好</h3></div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column' }}>
              {[
                { label: '审批请求', desc: '有人请求你审批时通知', on: true },
                { label: '评论提及', desc: '有人 @ 我时通知', on: true },
                { label: 'Skill 发布成功', desc: '我的 skill 发布完成时通知', on: true },
                { label: '依赖更新', desc: '我使用的 skill 有新版本时通知', on: false },
                { label: '周报摘要', desc: '每周一发送活动摘要邮件', on: true },
                { label: '社区动态', desc: '团队内新 skill 发布时通知', on: false },
              ].map((s) => (
                <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.label}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-subtle)', marginTop: 2 }}>{s.desc}</div>
                  </div>
                  <div style={{
                    width: 32, height: 18, borderRadius: 9,
                    background: s.on ? 'var(--primary)' : 'var(--border-strong)',
                    position: 'relative', cursor: 'pointer', flexShrink: 0,
                  }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%', background: 'white',
                      position: 'absolute', top: 2, left: s.on ? 16 : 2,
                      boxShadow: '0 1px 2px rgb(0 0 0 / 0.2)',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EditProfileModal
          initial={{ display, email, bio, location }}
          username={username}
          onClose={() => setEditing(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

function EditProfileModal({
  initial, username, onClose, onSaved,
}: {
  initial: { display: string; email: string; bio: string; location: string };
  username: string;
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
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(135deg,#f59e0b,#ec4899)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 700 }}>{initialChar}</div>
            <div style={{ flex: 1, fontSize: 12, color: 'var(--text-subtle)' }}>
              用户名 <span className="mono" style={{ color: 'var(--text)' }}>@{username}</span> 不可修改。
            </div>
          </div>
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
