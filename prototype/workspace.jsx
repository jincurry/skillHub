// Workspace page

function Sparkline({ data, color = "var(--primary)", width = 80, height = 28 }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ");
  const areaPts = `0,${height} ${pts} ${width},${height}`;
  const id = "spk-" + Math.random().toString(36).slice(2, 7);
  return (
    <svg className="stat-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{width: "100%", height}}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={areaPts} fill={`url(#${id})`}/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function StatusPill({ status }) {
  const map = {
    published: { cls: "published", label: "Published" },
    draft: { cls: "draft", label: "Draft" },
    review: { cls: "review", label: "审批中" },
    yanked: { cls: "yanked", label: "Yanked" },
    deprecated: { cls: "deprecated", label: "Deprecated" },
  };
  const it = map[status] || map.draft;
  return <span className={`status-pill ${it.cls}`}><span className="swatch"></span>{it.label}</span>;
}

function ClassificationTag({ level }) {
  const map = {
    L1: { cls: "blue", text: "L1 公开" },
    L2: { cls: "indigo", text: "L2 内部" },
    L3: { cls: "orange", text: "L3 敏感" },
  };
  const it = map[level] || map.L2;
  return <span className={`tag ${it.cls}`}>{it.text}</span>;
}

function DraftCard({ d }) {
  return (
    <div className="draft-card">
      <div className="draft-card-head">
        <div className="draft-card-name">
          <div className={`skill-icon ${d.iconClass}`}>{d.icon}</div>
          <div>
            <div><span className="ns">{d.namespace} /</span> {d.name}</div>
            <div className="draft-card-meta" style={{margin:0,marginTop:2}}>
              <span className="mono">v{d.version}</span>
              <span className="sep">·</span>
              <span>{d.updated}</span>
              <span className="sep">·</span>
              <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                <span className="status-pill draft"><span className="swatch"></span>Draft</span>
              </span>
            </div>
          </div>
        </div>
        <button className="icon-btn" style={{width:28,height:28}}><IconMore size={16}/></button>
      </div>
      <div style={{fontSize:13,color:"var(--text-muted)",margin:"4px 0 12px",lineHeight:1.5}}>{d.summary}</div>
      <div className="draft-checks">
        {d.checks.map((c, i) => (
          <span key={i} className={`check-chip ${c.kind}`}>
            {c.kind === "ok" && <IconCheckCircle size={12}/>}
            {c.kind === "warn" && <IconAlertTriangle size={12}/>}
            {c.kind === "err" && <IconXCircle size={12}/>}
            {c.label}
          </span>
        ))}
      </div>
      <div className="draft-actions">
        <button className="btn sm"><IconCode size={13}/> 继续编辑</button>
        <button className="btn sm"><IconCheckCircle size={13}/> Validate</button>
        <button className={`btn sm primary ${!d.canSubmit ? "" : ""}`} disabled={!d.canSubmit}
          style={!d.canSubmit ? {opacity: 0.5, cursor: "not-allowed"} : {}}>
          <IconRocket size={13}/> 提交审批
        </button>
      </div>
    </div>
  );
}

function NotificationItem({ n }) {
  const iconMap = {
    review: { bg: "var(--primary-50)", color: "var(--primary)", el: <IconCheckCircle size={14}/> },
    comment: { bg: "var(--blue-bg)", color: "var(--blue-text)", el: <IconChat size={14}/> },
    publish: { bg: "var(--green-bg)", color: "var(--green-text)", el: <IconRocket size={14}/> },
    warn: { bg: "var(--amber-bg)", color: "var(--amber-text)", el: <IconAlertTriangle size={14}/> },
  };
  const ic = iconMap[n.icon] || iconMap.comment;
  return (
    <div className={`feed-item ${n.unread ? "unread" : ""}`}>
      <div className="feed-icon" style={{background: ic.bg, color: ic.color}}>{ic.el}</div>
      <div className="feed-content">
        <div>{n.text}</div>
        <div className="feed-time">{n.time}</div>
      </div>
    </div>
  );
}

function PendingReviewItem({ r }) {
  const ucol = { overdue: {bg:"var(--red-bg)",color:"var(--red-text)",dot:"var(--red)"},
                 soon: {bg:"var(--amber-bg)",color:"var(--amber-text)",dot:"var(--amber)"},
                 ok: {bg:"var(--green-bg)",color:"var(--green-text)",dot:"var(--green)"}}[r.urgency];
  return (
    <div style={{padding:"12px 16px",borderBottom:"1px solid var(--border)",display:"flex",gap:10,alignItems:"flex-start",cursor:"pointer"}}>
      <div style={{width:6,alignSelf:"stretch",borderRadius:3,background:ucol.dot,flexShrink:0,minHeight:36}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,fontWeight:600,marginBottom:2}}>
          <span style={{color:"var(--text-subtle)",fontWeight:500}}>{r.ns}/</span>
          <span>{r.name}</span>
          <span className="mono" style={{fontSize:11.5,color:"var(--text-faint)"}}>v{r.version}</span>
          <ClassificationTag level={r.classification}/>
        </div>
        <div style={{fontSize:12,color:"var(--text-subtle)"}}>
          by <span className="mono">@{r.author}</span> · <span style={{color:ucol.color,fontWeight:500}}>{r.note}</span>
        </div>
      </div>
      <IconChevronRight size={14}/>
    </div>
  );
}

function Workspace() {
  const sparkData1 = [12, 18, 15, 22, 28, 24, 32, 38, 45, 42, 51, 49, 58, 67];
  const sparkData2 = [80, 95, 88, 102, 110, 105, 120, 128, 135, 142, 138, 156, 168, 175];
  const sparkData3 = [4, 5, 3, 6, 8, 7, 9, 11, 10, 13, 12, 15, 14, 17];
  const sparkData4 = [99.2, 99.4, 99.1, 99.3, 99.5, 99.2, 99.0, 99.1, 99.4, 99.3, 99.5, 99.2, 99.1, 99.1];

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">早上好,Alice 👋</h1>
          <p className="page-subtitle">你有 <strong style={{color:"var(--text)"}}>3 个 draft</strong> 待处理,<strong style={{color:"var(--primary)"}}>5 项审批</strong> 等你确认。</p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconDownload size={14}/> 从 CLI 拉取</button>
          <button className="btn primary"><IconPlus size={14}/> 创建 Skill</button>
        </div>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-label">本周激活总数</div>
          <div><span className="stat-value num">2,884</span><span className="stat-delta up"><IconArrowUp size={11}/>12.4%</span></div>
          <Sparkline data={sparkData2} color="var(--primary)"/>
        </div>
        <div className="stat">
          <div className="stat-label">活跃 Skills</div>
          <div><span className="stat-value num">38</span><span className="stat-delta up"><IconArrowUp size={11}/>3</span></div>
          <Sparkline data={sparkData1} color="#10b981"/>
        </div>
        <div className="stat">
          <div className="stat-label">独立用户</div>
          <div><span className="stat-value num">142</span><span className="stat-delta up"><IconArrowUp size={11}/>8.1%</span></div>
          <Sparkline data={sparkData3} color="#f59e0b"/>
        </div>
        <div className="stat">
          <div className="stat-label">成功率</div>
          <div><span className="stat-value num">99.1%</span><span className="stat-delta down"><IconArrowDown size={11}/>0.4pp</span></div>
          <Sparkline data={sparkData4} color="#dc2626"/>
        </div>
      </div>

      <div className="workspace-grid">
        <div>
          {/* Drafts section */}
          <div style={{marginBottom: "var(--gap)"}}>
            <div className="sec-title">
              <span>我的 Drafts <span style={{color:"var(--text-faint)",fontWeight:500,marginLeft:4}}>3</span></span>
              <a className="meta" style={{color:"var(--primary)",cursor:"pointer"}}>查看全部 →</a>
            </div>
            {MY_DRAFTS.map(d => <DraftCard key={d.name} d={d}/>)}
          </div>

          {/* My Skills table */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">我发布的 Skills <span className="tag outline" style={{marginLeft:6}}>{MY_SKILLS.length}</span></h3>
              <div style={{display:"flex",gap:6}}>
                <button className="dropdown">
                  全部命名空间 <IconChevronDown size={12}/>
                </button>
                <button className="btn sm ghost"><IconExternal size={13}/></button>
              </div>
            </div>
            <div className="card-body flush table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>状态</th>
                    <th style={{textAlign:"right"}}>当前版本</th>
                    <th style={{textAlign:"right"}}>激活/周</th>
                    <th style={{textAlign:"right"}}>趋势</th>
                    <th style={{textAlign:"right"}}>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {MY_SKILLS.map(s => (
                    <tr key={s.name}>
                      <td>
                        <div className="tbl-name">
                          <div className={`skill-icon ${s.iconClass}`}>{s.icon}</div>
                          <div>
                            <div className="skill-name-text"><span style={{color:"var(--text-subtle)",fontWeight:500}}>{s.ns}/</span>{s.name}</div>
                          </div>
                        </div>
                      </td>
                      <td><StatusPill status={s.status}/></td>
                      <td style={{textAlign:"right"}}><span className="mono num">v{s.version}</span></td>
                      <td className="num" style={{textAlign:"right",fontWeight:500}}>{s.activations.toLocaleString()}</td>
                      <td style={{textAlign:"right"}}>
                        {s.delta !== 0 ? (
                          <span className={s.delta > 0 ? "stat-delta up" : "stat-delta down"}>
                            {s.delta > 0 ? <IconArrowUp size={11}/> : <IconArrowDown size={11}/>}
                            {Math.abs(s.delta)}%
                          </span>
                        ) : <span style={{color:"var(--text-faint)"}}>—</span>}
                      </td>
                      <td style={{textAlign:"right",color:"var(--text-subtle)",fontSize:12.5}}>{s.updated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quick actions */}
          <div className="quick-actions-row">
            <div className="quick-action">
              <div className="qa-icon"><IconPlus size={16}/></div>
              <div className="qa-text">
                <span className="qa-title">创建新 Skill</span>
                <span className="qa-desc">从模板或空白开始</span>
              </div>
            </div>
            <div className="quick-action">
              <div className="qa-icon" style={{background:"var(--green-bg)",color:"var(--green-text)"}}><IconCode size={16}/></div>
              <div className="qa-text">
                <span className="qa-title">从 CLI 拉取</span>
                <span className="qa-desc"><span className="mono">skillhub init</span></span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div>
          {/* Pending reviews */}
          <div className="card" style={{marginBottom:"var(--gap)"}}>
            <div className="card-header" style={{padding:"12px 16px"}}>
              <h3 className="card-title">
                <IconCheck size={14} stroke={2}/>
                待我审批
                <span className="tag indigo" style={{marginLeft:4}}>{PENDING_REVIEWS.length}</span>
              </h3>
              <a style={{fontSize:12,color:"var(--primary)",cursor:"pointer"}}>全部 →</a>
            </div>
            <div className="card-body flush">
              {PENDING_REVIEWS.map(r => <PendingReviewItem key={r.id} r={r}/>)}
            </div>
          </div>

          {/* Notifications */}
          <div className="card">
            <div className="card-header" style={{padding:"12px 16px"}}>
              <h3 className="card-title">
                <IconBell size={14}/>
                需要我关注
                <span className="tag" style={{marginLeft:4}}>3 未读</span>
              </h3>
              <a style={{fontSize:12,color:"var(--text-subtle)",cursor:"pointer"}}>全部已读</a>
            </div>
            <div className="card-body flush feed">
              {NOTIFICATIONS.map(n => <NotificationItem key={n.id} n={n}/>)}
            </div>
            <div style={{padding:"10px 16px",borderTop:"1px solid var(--border)",textAlign:"center"}}>
              <a style={{fontSize:12.5,color:"var(--primary)",cursor:"pointer",fontWeight:500}}>查看全部通知 →</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Workspace = Workspace;
window.StatusPill = StatusPill;
window.ClassificationTag = ClassificationTag;
window.Sparkline = Sparkline;
