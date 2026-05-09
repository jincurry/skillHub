// App frame: sidebar + topbar
const { useState } = React;

function Sidebar({ activePage, onNav }) {
  const navItems = [
    { id: "workspace", icon: <IconHome/>, label: "工作台", kbd: "G H" },
    { id: "browse", icon: <IconBox/>, label: "浏览 Skills", kbd: "G S" },
    { id: "reviews", icon: <IconCheck/>, label: "审批中心", badge: 5, kbd: "G R" },
    { id: "audit", icon: <IconClipboard/>, label: "审计日志" },
    { id: "admin", icon: <IconSettings/>, label: "管理后台" },
    { id: "profile", icon: <IconUsers/>, label: "我的主页" },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo-mark">s</div>
        <div className="logo-text">skill<em>Hub</em></div>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">导航</div>
        {navItems.map(item => (
          <div key={item.id}
            className={`nav-item ${activePage === item.id ? "active" : ""}`}
            onClick={() => onNav(item.id)}>
            {item.icon}
            <span className="label">{item.label}</span>
            {item.badge ? <span className="badge">{item.badge}</span>
              : item.kbd ? <span className="kbd">{item.kbd}</span> : null}
          </div>
        ))}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">收藏</div>
        {[
          { name: "go-code-review", ns: "platform-team" },
          { name: "sql-explain", ns: "data-team" },
          { name: "incident-postmortem", ns: "sre-team" },
        ].map(s => (
          <div key={s.name} className="nav-item" onClick={() => onNav("detail", s)}>
            <span style={{width:18,height:18,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:"var(--primary)"}}>★</span>
            <span className="label">{s.name}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="user-card" onClick={() => onNav("profile")}>
          <div className="avatar bg-1">A</div>
          <div className="user-info">
            <div className="user-name">@alice</div>
            <div className="user-role">Maintainer · platform-team</div>
          </div>
          <IconChevronDown size={14}/>
        </div>
      </div>
    </aside>
  );
}

function Topbar({ crumbs }) {
  return (
    <div className="topbar">
      <div className="breadcrumb">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            <span className={i === crumbs.length - 1 ? "current" : ""}>{c}</span>
          </React.Fragment>
        ))}
      </div>
      <div style={{flex:1}}/>
      <div className="search-box">
        <IconSearch size={15}/>
        <span>搜索 skill、命名空间、用户...</span>
        <span className="kbd">Ctrl K</span>
      </div>
      <button className="icon-btn" title="通知">
        <IconBell size={18}/>
        <span className="dot"></span>
      </button>
      <button className="icon-btn" title="帮助">
        <span style={{fontSize:13,fontWeight:600,color:"var(--text-muted)"}}>?</span>
      </button>
    </div>
  );
}

window.Sidebar = Sidebar;
window.Topbar = Topbar;
