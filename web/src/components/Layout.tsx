import { Fragment, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  IconHome, IconBox, IconCheck, IconClipboard, IconSettings, IconUsers,
  IconChevronDown, IconSearch,
} from './Icons';
import { CreateSkillModal } from './CreateSkillModal';
import { NotificationBell } from './NotificationBell';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { clearAuth } from '../api/auth';

type NavItem = { id: string; to: string; icon: ReactNode; label: string; kbd?: string };

const NAV_ITEMS: NavItem[] = [
  { id: 'workspace', to: '/workspace', icon: <IconHome />, label: '工作台', kbd: 'G H' },
  { id: 'browse', to: '/skills', icon: <IconBox />, label: '浏览 Skills', kbd: 'G S' },
  { id: 'reviews', to: '/reviews', icon: <IconCheck />, label: '审批中心', kbd: 'G R' },
  { id: 'audit', to: '/audit', icon: <IconClipboard />, label: '审计日志' },
  { id: 'admin', to: '/admin', icon: <IconSettings />, label: '管理后台' },
  { id: 'profile', to: '/profile', icon: <IconUsers />, label: '我的主页' },
];

const FAVORITES = [
  { name: 'go-code-review', ns: 'platform-team' },
  { name: 'sql-explain', ns: 'data-team' },
  { name: 'incident-postmortem', ns: 'sre-team' },
];

function Sidebar() {
  const navigate = useNavigate();
  const { data: me } = useAsync(() => api.me());
  const { data: pendingReviews } = useAsync(() => api.listReviews('pending'));
  const pendingCount = pendingReviews?.length ?? 0;
  function logout() {
    clearAuth();
    window.location.assign('/login');
  }
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-mark">s</div>
        <div className="logo-text">skill<em>Hub</em></div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">导航</div>
        {NAV_ITEMS.map((item) => {
          const badge = item.id === 'reviews' && pendingCount > 0 ? pendingCount : null;
          return (
            <NavLink
              key={item.id}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {item.icon}
              <span className="label">{item.label}</span>
              {badge !== null ? <span className="badge">{badge}</span>
                : item.kbd ? <span className="kbd">{item.kbd}</span> : null}
            </NavLink>
          );
        })}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">收藏</div>
        {FAVORITES.map((s) => (
          <div key={s.name} className="nav-item" onClick={() => navigate(`/skills/${s.ns}/${s.name}`)}>
            <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--primary)' }}>★</span>
            <span className="label">{s.name}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="user-card" onClick={() => navigate('/profile')}>
          <div className="avatar bg-1">{(me?.display ?? me?.username ?? '?').slice(0, 1).toUpperCase()}</div>
          <div className="user-info">
            <div className="user-name">@{me?.username ?? '...'}</div>
            <div className="user-role">{me?.role ?? ''}{me?.team ? ` · ${me.team}` : ''}</div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); logout(); }}
            title="登出"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 11, padding: '4px 6px',
            }}
          >登出</button>
          <IconChevronDown size={14} />
        </div>
      </div>
    </aside>
  );
}

function buildCrumbs(pathname: string, username?: string): string[] {
  const STATIC: Record<string, string[]> = {
    '/workspace': ['Home', '工作台'],
    '/skills': ['Home', 'Skills', '浏览'],
    '/reviews': ['Home', '审批中心'],
    '/audit': ['Home', '审计日志'],
    '/admin': ['Home', '管理后台'],
  };
  if (STATIC[pathname]) return STATIC[pathname];
  if (pathname === '/profile') return ['Home', `@${username ?? '...'}`];
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'skills' && parts.length >= 3) {
    if (parts[3] === 'edit') return ['Home', '编辑器', `${parts[1]} / ${parts[2]}`];
    return ['Home', 'Skills', `${parts[1]} / ${parts[2]}`];
  }
  if (parts[0] === 'reviews' && parts[1]) return ['Home', '审批中心', `审批 #${parts[1]}`];
  return ['Home'];
}

function Topbar() {
  const { pathname } = useLocation();
  const { data: me } = useAsync(() => api.me());
  const crumbs = buildCrumbs(pathname, me?.username);
  return (
    <div className="topbar">
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? 'current' : ''}>{c}</span>
          </Fragment>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div className="search-box">
        <IconSearch size={15} />
        <span>搜索 skill、命名空间、用户...</span>
        <span className="kbd">Ctrl K</span>
      </div>
      <NotificationBell />
      <button className="icon-btn" title="帮助">
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>?</span>
      </button>
    </div>
  );
}

export function Layout() {
  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <div className="content">
          <Outlet />
        </div>
      </div>
      <CreateSkillModal />
    </div>
  );
}
