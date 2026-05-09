// Audit log page
function Audit() {
  const events = [];
  const actions = ["publish","yank","approve_review","reject_review","submit_review","create_draft","add_maintainer","remove_maintainer","activate","update_settings","rotate_key"];
  const users = ["alice","bob","charlie","diana","eve","frank","george","henry","ivan","judy","system"];
  const skills = ["platform-team/go-code-review","data-team/csv-import","sre-team/incident-postmortem","platform-team/k8s-debug","finance-team/expense-validate","security-team/auth-audit","frontend-team/react-component-review","data-team/sql-explain"];
  const dates = ["10:23","09:48","09:12","08:55","07:31","昨天 22:14","昨天 18:02","昨天 14:30","昨天 11:09","昨天 09:45","2 天前 16:00","2 天前 11:42","2 天前 10:05","3 天前 18:21","3 天前 14:09","3 天前 09:33","4 天前 16:48","4 天前 09:12","5 天前 17:55","6 天前 10:00"];
  for (let i = 0; i < 20; i++) {
    events.push({
      ts: dates[i],
      who: users[i % users.length],
      action: actions[i % actions.length],
      target: skills[i % skills.length],
      version: `v${1 + (i%3)}.${i%10}.${i%5}`,
      ip: `10.4.${(i*7)%256}.${(i*13)%256}`,
    });
  }

  const actionColor = {
    publish: "green", yank: "red", approve_review: "green", reject_review: "red",
    submit_review: "blue", create_draft: "blue", add_maintainer: "indigo",
    remove_maintainer: "amber", activate: "", update_settings: "amber", rotate_key: "amber",
  };

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">审计日志</h1>
          <p className="page-subtitle">所有 skill 操作的不可变记录,默认保留 90 天,合规事件保留 7 年。</p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconDownload size={14}/> 导出 CSV</button>
          <button className="btn primary"><IconExternal size={14}/> SIEM 接入</button>
        </div>
      </div>

      <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        <div className="input-wrap" style={{maxWidth:320}}>
          <span className="icon-left"><IconSearch size={15}/></span>
          <input className="input" placeholder="搜索 skill / 用户 / 动作..."/>
        </div>
        <button className="dropdown" style={{height:36}}>动作: <strong style={{color:"var(--text)"}}>全部</strong> <IconChevronDown size={12}/></button>
        <button className="dropdown" style={{height:36}}>用户: <strong style={{color:"var(--text)"}}>全部</strong> <IconChevronDown size={12}/></button>
        <button className="dropdown" style={{height:36}}>命名空间: <strong style={{color:"var(--text)"}}>全部</strong> <IconChevronDown size={12}/></button>
        <button className="dropdown" style={{height:36}}>时间: <strong style={{color:"var(--text)"}}>近 7 天</strong> <IconChevronDown size={12}/></button>
        <span style={{marginLeft:"auto",fontSize:12.5,color:"var(--text-subtle)"}}>
          <IconClock size={12}/> 实时 · {events.length} 条
        </span>
      </div>

      <div className="card">
        <div style={{display:"grid",gridTemplateColumns:"140px 90px 110px 1fr 120px",gap:14,padding:"10px 16px",fontSize:11,color:"var(--text-subtle)",textTransform:"uppercase",letterSpacing:"0.04em",borderBottom:"1px solid var(--border)",background:"var(--bg-soft)",fontWeight:500}}>
          <span>时间</span>
          <span>用户</span>
          <span>动作</span>
          <span>对象</span>
          <span style={{textAlign:"right"}}>来源 IP</span>
        </div>
        <div className="card-body flush">
          {events.map((e, i) => (
            <div key={i} className="log-row">
              <span className="ts">{e.ts}</span>
              <span><span className="mono" style={{fontSize:11.5,color: e.who === "system" ? "var(--text-faint)" : "var(--primary)"}}>@{e.who}</span></span>
              <span><span className={`tag ${actionColor[e.action] || ""}`}>{e.action}</span></span>
              <span><span className="target">{e.target}</span> <span className="mono" style={{color:"var(--text-faint)",fontSize:11}}>{e.version}</span></span>
              <span className="ip">{e.ip}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pagination">
        <button className="page-btn">‹</button>
        <button className="page-btn active">1</button>
        <button className="page-btn">2</button>
        <button className="page-btn">3</button>
        <span style={{color:"var(--text-faint)",padding:"0 4px"}}>…</span>
        <button className="page-btn">42</button>
        <button className="page-btn">›</button>
      </div>
    </div>
  );
}
window.Audit = Audit;
