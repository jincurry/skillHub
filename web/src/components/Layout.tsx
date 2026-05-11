import { Fragment, useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  IconHome, IconBox, IconCheck, IconClipboard, IconSettings, IconUsers,
  IconChevronDown, IconSearch,
} from './Icons';
import { CreateSkillModal } from './CreateSkillModal';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { CommandPalette, openCommandPalette } from './CommandPalette';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { useUnreadCount } from '../lib/notifStore';
import { clearAuth } from '../api/auth';

type NavItem = { id: string; to: string; icon: ReactNode; label: string };

const NAV_ITEMS: NavItem[] = [
  { id: 'workspace', to: '/workspace', icon: <IconHome />, label: '工作台' },
  { id: 'browse', to: '/skills', icon: <IconBox />, label: '浏览 Skills' },
  { id: 'reviews', to: '/reviews', icon: <IconCheck />, label: '审批中心' },
  { id: 'audit', to: '/audit', icon: <IconClipboard />, label: '审计日志' },
  { id: 'admin', to: '/admin', icon: <IconSettings />, label: '管理后台' },
  { id: 'profile', to: '/profile', icon: <IconUsers />, label: '我的主页' },
];

function Sidebar() {
  const { data: me } = useAsync(() => api.me());
  const pendingReviewsState = useAsync(() => api.listReviews('pending'));
  const { data: pendingReviews } = pendingReviewsState;

  // The pending list is mounted-once via useAsync, so a review decided in
  // another tab (or by us via ReviewDetail) wouldn't refresh the sidebar
  // badge until full reload. Two cheap mechanisms keep it fresh:
  //   1. 30s timer — eventual consistency
  //   2. window 'reviews:changed' event — fired by ReviewDetail.decide() so
  //      the badge updates instantly after the user clicks 批准/驳回
  useEffect(() => {
    const t = window.setInterval(() => pendingReviewsState.reload(), 30_000);
    const onChange = () => pendingReviewsState.reload();
    window.addEventListener('reviews:changed', onChange);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('reviews:changed', onChange);
    };
    // pendingReviewsState identity changes every render; the effect itself
    // doesn't depend on it because reload is captured by closure each tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "审批中心" badge should reflect things I can actually act on, not
  // the platform-wide queue. We count reviews where I'm an assigned
  // reviewer; author-only rows are excluded because I can't self-approve.
  const myName = me?.username ?? '';
  const pendingCount = myName === '' ? 0
    : (pendingReviews ?? []).filter((r) => r.reviewers.includes(myName)).length;
  // Unread notifications drive the workspace nav badge. Same shared store
  // backs the topbar bell and the Workspace feed, so all three update in
  // lockstep when the user clicks "mark read" anywhere.
  const unreadNotifs = useUnreadCount();
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
          // Hide /admin from non-admin users — backend rejects them anyway,
          // but keeping the link visible would be a footgun.
          if (item.id === 'admin' && me && !me.isAdmin) return null;
          // Per-item badge resolution. Two surfaces have counters:
          //   workspace → unread notifications
          //   reviews   → pending reviews assigned to me
          // We cap at 99+ so the pill doesn't blow out the layout.
          let badge: number | string | null = null;
          if (item.id === 'workspace' && unreadNotifs > 0) {
            badge = unreadNotifs > 99 ? '99+' : unreadNotifs;
          } else if (item.id === 'reviews' && pendingCount > 0) {
            badge = pendingCount > 99 ? '99+' : pendingCount;
          }
          return (
            <NavLink
              key={item.id}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              {item.icon}
              <span className="label">{item.label}</span>
              {badge !== null && <span className="badge">{badge}</span>}
            </NavLink>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <NavLink to="/profile" className="user-card">
          <div className="avatar bg-1" style={{ overflow: 'hidden' }}>
            {me?.avatarUrl
              ? <img src={me.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : (me?.display ?? me?.username ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="user-info">
            <div className="user-name">@{me?.username ?? '...'}</div>
            <div className="user-role">{me?.role ?? ''}{me?.team ? ` · ${me.team}` : ''}</div>
          </div>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); logout(); }}
            title="登出"
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 11, padding: '4px 6px',
            }}
          >登出</button>
          <IconChevronDown size={14} />
        </NavLink>
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
      <button
        className="search-box"
        onClick={openCommandPalette}
        title="搜索 (Ctrl/Cmd+K)"
        style={{
          border: 'none', background: 'inherit', cursor: 'pointer', font: 'inherit',
          color: 'inherit', textAlign: 'left',
        }}
      >
        <IconSearch size={15} />
        <span>搜索 skill、命名空间、用户...</span>
        <span className="kbd">Ctrl K</span>
      </button>
      <ThemeToggle />
      <NotificationBell />
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
      <CommandPalette />
    </div>
  );
}
