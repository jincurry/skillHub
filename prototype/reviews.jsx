// Reviews list + detail page

const REVIEWS_DATA = [
  {id:1,name:"db-migration",ns:"platform-team",version:"2.0.0",classification:"L3",author:"charlie",submitted:"4 天前",sla:"已超时 16h",urgency:"overdue",reviewers:["alice","bob"],status:"pending"},
  {id:2,name:"expense-validate",ns:"finance-team",version:"1.0.0",classification:"L3",author:"diana",submitted:"1 天前",sla:"12h 内到期",urgency:"soon",reviewers:["alice"],status:"pending"},
  {id:3,name:"csv-import",ns:"data-team",version:"1.5.2",classification:"L2",author:"eve",submitted:"6 小时前",sla:"46h 内到期",urgency:"ok",reviewers:["alice","frank"],status:"pending"},
  {id:4,name:"log-pii-scan",ns:"security-team",version:"0.5.0",classification:"L3",author:"judy",submitted:"3 小时前",sla:"96h 内到期",urgency:"ok",reviewers:["alice"],status:"pending"},
  {id:5,name:"react-component-review",ns:"frontend-team",version:"0.9.0",classification:"L1",author:"ivan",submitted:"昨天",sla:"24h 内到期",urgency:"soon",reviewers:["alice"],status:"pending"},
  {id:6,name:"k8s-debug",ns:"platform-team",version:"1.5.1",classification:"L2",author:"alice",submitted:"5 天前",sla:"已批准",urgency:"done",reviewers:["bob","charlie"],status:"approved"},
  {id:7,name:"old-deploy-flow",ns:"platform-team",version:"0.9.5",classification:"L2",author:"alice",submitted:"1 周前",sla:"已驳回",urgency:"rejected",reviewers:["bob"],status:"rejected"},
];

function Reviews({ onOpen }) {
  const [filter, setFilter] = useState("pending");
  const filtered = REVIEWS_DATA.filter(r => filter === "all" || r.status === filter);
  const counts = {
    pending: REVIEWS_DATA.filter(r => r.status === "pending").length,
    approved: REVIEWS_DATA.filter(r => r.status === "approved").length,
    rejected: REVIEWS_DATA.filter(r => r.status === "rejected").length,
    all: REVIEWS_DATA.length,
  };

  const urgencyMap = {
    overdue: {bg:"var(--red-bg)",color:"var(--red-text)"},
    soon: {bg:"var(--amber-bg)",color:"var(--amber-text)"},
    ok: {bg:"var(--green-bg)",color:"var(--green-text)"},
    done: {bg:"var(--green-bg)",color:"var(--green-text)"},
    rejected: {bg:"var(--slate-bg)",color:"var(--slate-text)"},
  };

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">审批中心</h1>
          <p className="page-subtitle">作为 maintainer,你需要审核即将发布或撤回的 Skill 版本。SLA 默认 72 小时。</p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconDownload size={14}/> 导出报表</button>
          <button className="btn primary"><IconCheckCircle size={14}/> 批量批准</button>
        </div>
      </div>

      <div className="stat-strip" style={{marginBottom:"var(--gap)"}}>
        <div className="stat"><div className="stat-label">本月审批数</div><div><span className="stat-value num">42</span></div></div>
        <div className="stat"><div className="stat-label">平均审批耗时</div><div><span className="stat-value num">8.4h</span><span className="stat-delta up"><IconArrowDown size={11}/>2.1h</span></div></div>
        <div className="stat"><div className="stat-label">SLA 达成率</div><div><span className="stat-value num">94%</span></div></div>
        <div className="stat"><div className="stat-label">超时件数</div><div><span className="stat-value num" style={{color:"var(--red)"}}>1</span></div></div>
      </div>

      {/* Tab pills */}
      <div style={{display:"flex",gap:6,marginBottom:16}}>
        {[
          {id:"pending",label:"待审批",c:counts.pending},
          {id:"approved",label:"已批准",c:counts.approved},
          {id:"rejected",label:"已驳回",c:counts.rejected},
          {id:"all",label:"全部",c:counts.all},
        ].map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)}
            style={{
              padding:"6px 14px",height:32,
              border:"1px solid",
              borderColor: filter === t.id ? "var(--primary)" : "var(--border)",
              borderRadius:6,
              background: filter === t.id ? "var(--primary-50)" : "var(--bg)",
              color: filter === t.id ? "var(--primary-700)" : "var(--text-muted)",
              fontSize:13,fontWeight:500,
              cursor:"pointer",display:"inline-flex",alignItems:"center",gap:8,
            }}>
            {t.label}
            <span style={{
              padding:"0 6px",height:18,fontSize:11,fontWeight:600,
              background: filter === t.id ? "var(--primary)" : "var(--bg-muted)",
              color: filter === t.id ? "white" : "var(--text-subtle)",
              borderRadius:9,minWidth:20,textAlign:"center",lineHeight:"18px"
            }} className="num">{t.c}</span>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-body flush table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Skill</th><th>密级</th><th>作者</th><th>Reviewers</th>
              <th>提交时间</th><th>SLA</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} onClick={() => onOpen(r)}>
                  <td>
                    <div className="tbl-name">
                      <div className="skill-icon blue" style={{width:24,height:24,fontSize:11}}>{r.name.slice(0,2).toUpperCase()}</div>
                      <div>
                        <div className="skill-name-text"><span style={{color:"var(--text-subtle)",fontWeight:500}}>{r.ns}/</span>{r.name}</div>
                        <div className="skill-name-desc"><span className="mono">v{r.version}</span></div>
                      </div>
                    </div>
                  </td>
                  <td><ClassificationTag level={r.classification}/></td>
                  <td><span className="mono" style={{fontSize:12.5}}>@{r.author}</span></td>
                  <td>
                    <div className="avatar-stack">
                      {r.reviewers.map((u,i) => <div key={u} className={`avatar sm bg-${i+1}`} title={u}>{u[0].toUpperCase()}</div>)}
                    </div>
                  </td>
                  <td style={{color:"var(--text-subtle)",fontSize:12.5}}>{r.submitted}</td>
                  <td><span className="tag" style={{background:urgencyMap[r.urgency].bg,color:urgencyMap[r.urgency].color}}>{r.sla}</span></td>
                  <td><IconChevronRight size={14}/></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReviewDetail({ review, onBack }) {
  return (
    <div className="content-inner">
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:"var(--text-subtle)",marginBottom:14,cursor:"pointer"}} onClick={onBack}>
        <IconChevronRight size={14} style={{transform:"rotate(180deg)"}}/>
        <span>返回审批中心</span>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title" style={{display:"flex",alignItems:"center",gap:10}}>
            审批 #{review.id}
            <span className="tag amber"><span className="dot"></span>待审批</span>
          </h1>
          <p className="page-subtitle">
            <span className="mono">{review.ns}/{review.name}</span> v{review.version} · 由 <span className="mono">@{review.author}</span> 提交于 {review.submitted}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconChat size={14}/> 留言</button>
          <button className="btn" style={{color:"var(--red-text)",borderColor:"var(--red-bg)"}}><IconXCircle size={14}/> 驳回</button>
          <button className="btn primary"><IconCheckCircle size={14}/> 批准并发布</button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 320px",gap:"var(--gap)"}}>
        <div>
          {/* Validation summary */}
          <div className="card" style={{marginBottom:"var(--gap)",borderLeft:"3px solid var(--green)"}}>
            <div className="card-body" style={{display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:40,height:40,borderRadius:"50%",background:"var(--green-bg)",color:"var(--green-text)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <IconCheckCircle size={20}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:2}}>所有自动检查已通过</div>
                <div style={{fontSize:12.5,color:"var(--text-subtle)"}}>4/4 项检查 ✓ · 1 项警告 (非阻塞)</div>
              </div>
              <button className="btn sm">查看完整报告</button>
            </div>
          </div>

          {/* Diff */}
          <div className="card" style={{marginBottom:"var(--gap)"}}>
            <div className="card-header">
              <h3 className="card-title">变更对比 <span className="mono" style={{color:"var(--text-faint)",fontWeight:400,fontSize:12,marginLeft:6}}>v1.5.1 → v{review.version}</span></h3>
              <div className="seg" style={{height:30}}><button className="active">Unified</button><button>Split</button></div>
            </div>
            <div className="card-body flush">
              <div style={{padding:"8px 14px",background:"var(--bg-muted)",fontSize:11.5,color:"var(--text-subtle)",borderBottom:"1px solid var(--border)",fontFamily:"'JetBrains Mono', monospace"}}>
                @@ skill.yaml · 4 additions, 2 deletions
              </div>
              <pre style={{margin:0,padding:"12px 16px",fontSize:12.5,fontFamily:"'JetBrains Mono', monospace",lineHeight:1.6,overflow:"auto"}}>
<span style={{color:"var(--text-faint)"}}>name: {review.name}</span>{"\n"}
<span style={{background:"color-mix(in oklab, var(--red-bg) 60%, transparent)",color:"var(--red-text)",display:"block",padding:"0 6px"}}>- version: 1.5.1</span>
<span style={{background:"color-mix(in oklab, var(--red-bg) 60%, transparent)",color:"var(--red-text)",display:"block",padding:"0 6px"}}>- timeout: 30s</span>
<span style={{background:"color-mix(in oklab, var(--green-bg) 60%, transparent)",color:"var(--green-text)",display:"block",padding:"0 6px"}}>+ version: {review.version}</span>
<span style={{background:"color-mix(in oklab, var(--green-bg) 60%, transparent)",color:"var(--green-text)",display:"block",padding:"0 6px"}}>+ timeout: 60s</span>
<span style={{background:"color-mix(in oklab, var(--green-bg) 60%, transparent)",color:"var(--green-text)",display:"block",padding:"0 6px"}}>+ retry_count: 3</span>
<span style={{background:"color-mix(in oklab, var(--green-bg) 60%, transparent)",color:"var(--green-text)",display:"block",padding:"0 6px"}}>+ classification: L3</span>{"\n"}
<span style={{color:"var(--text-faint)"}}>permissions:</span>{"\n"}
<span style={{color:"var(--text-faint)"}}>  - read</span>
              </pre>
            </div>
          </div>

          {/* Discussion */}
          <div className="card">
            <div className="card-header"><h3 className="card-title">讨论 <span className="tag outline" style={{marginLeft:6}}>3</span></h3></div>
            <div className="card-body" style={{display:"flex",flexDirection:"column",gap:14}}>
              {[
                {u:"charlie",t:"3 小时前",text:"提升 timeout 到 60s 是因为 PG 大查询经常 30s 不够。retry 是为了 transient 错误。"},
                {u:"alice",t:"1 小时前",text:"@charlie 想确认下 — retry 次数 3 是不是有点多?对幂等性有要求吗?"},
                {u:"charlie",t:"45 分钟前",text:"是的, migration 都是 idempotent 的。3 次基本能 cover 所有 transient 故障。"},
              ].map((c,i) => (
                <div key={i} style={{display:"flex",gap:10}}>
                  <div className={`avatar sm bg-${i+1}`} style={{width:30,height:30,fontSize:13,flexShrink:0}}>{c.u[0].toUpperCase()}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12.5,marginBottom:2}}>
                      <span className="mono" style={{fontWeight:600}}>@{c.u}</span>
                      <span style={{color:"var(--text-faint)",marginLeft:6}}>· {c.t}</span>
                    </div>
                    <div style={{fontSize:13,color:"var(--text-muted)",lineHeight:1.55}}>{c.text}</div>
                  </div>
                </div>
              ))}
              <div style={{borderTop:"1px solid var(--border)",paddingTop:14,display:"flex",gap:10}}>
                <div className="avatar sm bg-1" style={{width:30,height:30,fontSize:13,flexShrink:0}}>A</div>
                <div style={{flex:1}}>
                  <textarea className="input" placeholder="发表评论..." style={{padding:"8px 12px",height:60,resize:"vertical",width:"100%"}}/>
                  <div style={{display:"flex",justifyContent:"flex-end",marginTop:8}}>
                    <button className="btn sm primary">发表</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div>
          <div className="card" style={{marginBottom:"var(--gap)"}}>
            <div className="card-header"><h3 className="card-title">审批清单</h3></div>
            <div className="card-body" style={{display:"flex",flexDirection:"column",gap:8}}>
              {[
                {l:"代码已通过自动 lint",ok:true},
                {l:"无 secret 泄露",ok:true},
                {l:"包大小 < 1MB",ok:true},
                {l:"依赖均为已批准版本",ok:true},
                {l:"密级 L3 — 已通知 security",ok:true},
                {l:"作者已自测",ok:false,note:"需确认"},
              ].map((c,i) => (
                <label key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer"}}>
                  <input type="checkbox" defaultChecked={c.ok}/>
                  <span style={{flex:1,color: c.ok ? "var(--text)" : "var(--text-muted)"}}>{c.l}</span>
                  {c.note && <span style={{fontSize:11,color:"var(--amber-text)"}}>{c.note}</span>}
                </label>
              ))}
            </div>
          </div>

          <div className="card" style={{marginBottom:"var(--gap)"}}>
            <div className="card-header"><h3 className="card-title">SLA</h3></div>
            <div className="card-body" style={{textAlign:"center"}}>
              <div style={{fontSize:24,fontWeight:700,color: review.urgency === "overdue" ? "var(--red)" : "var(--text)"}} className="num">{review.sla}</div>
              <div style={{fontSize:12,color:"var(--text-subtle)",marginTop:4}}>距离截止时间</div>
              <div style={{height:6,background:"var(--bg-muted)",borderRadius:3,overflow:"hidden",marginTop:14}}>
                <div style={{width: review.urgency === "overdue" ? "100%" : review.urgency === "soon" ? "82%" : "30%",height:"100%",background: review.urgency === "overdue" ? "var(--red)" : review.urgency === "soon" ? "var(--amber)" : "var(--green)"}}/>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="card-title">参与者</h3></div>
            <div className="card-body" style={{display:"flex",flexDirection:"column",gap:10}}>
              {[
                {u:review.author,role:"作者"},
                ...review.reviewers.map(u => ({u,role:"Reviewer"})),
              ].map((p,i) => (
                <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                  <div className={`avatar sm bg-${i+1}`} style={{width:28,height:28,fontSize:12}}>{p.u[0].toUpperCase()}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500}} className="mono">@{p.u}</div>
                    <div style={{fontSize:11.5,color:"var(--text-subtle)"}}>{p.role}</div>
                  </div>
                </div>
              ))}
              <button className="btn sm" style={{marginTop:6}}><IconPlus size={12}/> 添加审批人</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Reviews = Reviews;
window.ReviewDetail = ReviewDetail;
