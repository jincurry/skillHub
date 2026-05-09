// Skill detail page
const SKILL_PROFILES = {
  "go-code-review": {
    icon: "Go", iconClass: "blue", level: "L2", hot: true,
    desc: "Review Go code for bugs, idiomatic patterns, error handling, and Go 1.21+ generics usage. PR review 前置自动检查。",
    rating: "4.3", reviews: 24, weekly: "1,234", users: 87,
    maintainer: "alice", updated: "2 天前", version: "1.2.3", versions: 12,
  },
  "sql-explain": {
    icon: "SQ", iconClass: "green", level: "L1", hot: false,
    desc: "解析 SQL 执行计划,标记慢查询和缺失索引,并给出改写建议。支持 PostgreSQL / MySQL / Snowflake。",
    rating: "4.6", reviews: 38, weekly: "1,502", users: 142,
    maintainer: "diana", updated: "5 天前", version: "1.1.0", versions: 8,
  },
  "incident-postmortem": {
    icon: "📋", iconClass: "amber", level: "L2", hot: false,
    desc: "事故复盘自动化:从 PagerDuty / Slack 抽取时间线,生成结构化 RCA 报告草稿。",
    rating: "4.1", reviews: 12, weekly: "284", users: 23,
    maintainer: "frank", updated: "2 周前", version: "0.9.2", versions: 5,
  },
};

function SkillDetail({ skill, onNav }) {
  const [tab, setTab] = useState("overview");
  const s = skill || { name: "go-code-review", ns: "platform-team" };
  const p = SKILL_PROFILES[s.name] || SKILL_PROFILES["go-code-review"];

  return (
    <div className="content-inner">
      <div style={{display:"flex",alignItems:"center",gap:6,fontSize:13,color:"var(--text-subtle)",marginBottom:14}}>
        <a style={{color:"var(--primary)",cursor:"pointer"}} onClick={() => onNav && onNav("browse")}>← Skills</a>
        <span style={{color:"var(--text-faint)"}}>/</span>
        <span>{s.ns}</span>
        <span style={{color:"var(--text-faint)"}}>/</span>
        <span style={{color:"var(--text)",fontWeight:500}}>{s.name}</span>
      </div>

      <div className="detail-hero">
        <div className={`skill-icon ${p.iconClass}`}>{p.icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <h1 style={{margin:0,fontSize:22,fontWeight:700,letterSpacing:"-0.02em"}}>
              <span style={{color:"var(--text-subtle)",fontWeight:500}}>{s.ns} / </span>{s.name}
            </h1>
            <ClassificationTag level={p.level}/>
            <StatusPill status="published"/>
            {p.hot && <span className="tag amber"><IconFire size={11}/> HOT</span>}
          </div>
          <div style={{marginTop:8,fontSize:14,color:"var(--text-muted)",lineHeight:1.55,maxWidth:720}}>{p.desc}</div>
          <div className="detail-hero-meta">
            <span><IconStar size={12}/> <strong style={{color:"var(--text)"}}>{p.rating}</strong> ({p.reviews} 评分)</span>
            <span style={{color:"var(--text-faint)"}}>·</span>
            <span><IconFire size={12}/> <strong style={{color:"var(--text)"}}>{p.weekly}</strong> 激活/周</span>
            <span style={{color:"var(--text-faint)"}}>·</span>
            <span><IconUsers size={12}/> {p.users} 用户</span>
            <span style={{color:"var(--text-faint)"}}>·</span>
            <span>由 <span className="mono">@{p.maintainer}</span> 维护 · 更新于 {p.updated}</span>
          </div>
          <div className="install-block">
            <span className="pmt">$</span>
            <span className="cmd">skillhub install {s.ns}/{s.name}@{p.version}</span>
            <button className="copy-btn"><IconCopy size={11}/> 复制</button>
          </div>
        </div>
        <div className="detail-hero-actions">
          <button className="btn"><IconBookmark size={14}/> 收藏</button>
          <button className="btn" onClick={() => onNav && onNav("editor", s)}><IconCode size={14}/> 编辑</button>
          <button className="btn primary"><IconDownload size={14}/> 安装</button>
        </div>
      </div>

      <div className="tabs">
        <div className={`tab ${tab==="overview"?"active":""}`} onClick={()=>setTab("overview")}>概览</div>
        <div className={`tab ${tab==="versions"?"active":""}`} onClick={()=>setTab("versions")}>版本 <span className="count">12</span></div>
        <div className={`tab ${tab==="health"?"active":""}`} onClick={()=>setTab("health")}>健康度</div>
        <div className={`tab ${tab==="audit"?"active":""}`} onClick={()=>setTab("audit")}>审计</div>
      </div>

      <div className="detail-grid">
        <div>
          {tab === "overview" && (
            <div className="card">
              <div className="card-body" style={{padding:"22px 26px"}}>
                <div className="readme">
                  <h2>概述</h2>
                  <p><code>go-code-review</code> 是 platform-team 维护的 Go 代码静态审查 skill,专为 Go 1.21+ 设计。读取 PR diff,识别常见 bug、不规范错误处理,并提供 idiomatic 改写建议。</p>
                  <blockquote>📌 已在 platform / sre / data 三个团队 CI 中默认启用,平均拦截 PR 缺陷 ~14%。</blockquote>
                  <h3>核心能力</h3>
                  <ul>
                    <li>检测未处理的 <code>error</code> 返回值</li>
                    <li>识别不必要的 <code>panic</code> 调用并建议替换</li>
                    <li>对 generic 函数提供类型参数命名建议</li>
                    <li>检测可疑的 goroutine 泄漏模式</li>
                    <li>提供 <code>context.Context</code> 传递路径修复建议</li>
                  </ul>
                  <h3>使用示例</h3>
                  <pre><code>{`# 本地审查当前 branch 的改动
skillhub run go-code-review --diff HEAD~1

# GitHub Action 中调用
skillhub run go-code-review --pr 1234 --report markdown`}</code></pre>
                </div>
              </div>
            </div>
          )}

          {tab === "versions" && (
            <div className="card">
              <div className="card-body" style={{padding:"6px 24px"}}>
                <div className="timeline">
                  {[
                    { v: "1.3.0", time: "2 小时前 (Draft)", author: "alice", body: "新增 generics 检查规则、修复 error handling 误报", tag: "Draft", tagCls: "" },
                    { v: "1.2.3", time: "2 天前", author: "alice", body: "修复在 Go 1.22 上 panic 检测的崩溃。", tag: "Latest", tagCls: "green" },
                    { v: "1.2.2", time: "1 周前", author: "bob", body: "性能改进:大型 PR 处理时间下降 35%。" },
                    { v: "1.2.1", time: "2 周前", author: "alice", body: "Bug fix: typed nil 检查的误报。" },
                    { v: "1.2.0", time: "1 月前", author: "alice", body: "新增 context cancellation 检查;default strictness 提升到 medium。", tag: "Breaking", tagCls: "amber" },
                    { v: "1.1.0", time: "2 月前", author: "bob", body: "支持 GitHub Actions 集成。" },
                  ].map((it, i) => (
                    <div key={i} className="timeline-item">
                      <div className="timeline-dot" style={{background: i===0?"var(--text-faint)":"var(--primary)"}}/>
                      <div className="timeline-content">
                        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:600}}>
                          <span className="mono">v{it.v}</span>
                          {it.tag && <span className={`tag ${it.tagCls || "indigo"}`}>{it.tag}</span>}
                        </div>
                        <div style={{fontSize:12,color:"var(--text-subtle)",marginTop:2}}>
                          <span className="mono">@{it.author}</span> · {it.time}
                        </div>
                        <div style={{fontSize:13,color:"var(--text-muted)",marginTop:6,lineHeight:1.5}}>{it.body}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "health" && (
            <div>
              <div className="stat-strip">
                <div className="stat"><div className="stat-label">激活/周</div><div><span className="stat-value num">1,234</span><span className="stat-delta up"><IconArrowUp size={11}/>12%</span></div><Sparkline data={[820,860,900,950,1010,1080,1120,1180,1234]} color="var(--primary)"/></div>
                <div className="stat"><div className="stat-label">成功率</div><div><span className="stat-value num">98.7%</span><span className="stat-delta flat">±0.1pp</span></div><Sparkline data={[98.5,98.8,98.6,98.9,98.7,98.8,98.6,98.7,98.7]} color="#10b981"/></div>
                <div className="stat"><div className="stat-label">P95 延迟</div><div><span className="stat-value num">2.4s</span><span className="stat-delta down"><IconArrowDown size={11}/>0.3s</span></div><Sparkline data={[2.8,2.7,2.9,2.6,2.5,2.7,2.5,2.4,2.4]} color="#f59e0b"/></div>
                <div className="stat"><div className="stat-label">用户评分</div><div><span className="stat-value num">4.3</span><span className="stat-delta up"><IconArrowUp size={11}/>0.2</span></div><Sparkline data={[4.1,4.1,4.2,4.2,4.1,4.2,4.3,4.3,4.3]} color="#8b5cf6"/></div>
              </div>
              <div className="card">
                <div className="card-header"><h3 className="card-title">最近错误</h3><span className="tag red">3 起 / 24h</span></div>
                <div className="card-body flush">
                  {[
                    { ts: "12:34:56", who: "carol", msg: "context deadline exceeded — diff 过大 (>5MB)", sev: "warn" },
                    { ts: "10:22:11", who: "dave", msg: "rate limit exceeded — github API 429", sev: "warn" },
                    { ts: "09:17:43", who: "system", msg: "panic: runtime error: invalid memory address", sev: "err" },
                  ].map((e, i) => (
                    <div key={i} style={{padding:"12px 16px",borderBottom: i<2?"1px solid var(--border)":"none",display:"flex",gap:10,alignItems:"center"}}>
                      <span className={`tag ${e.sev==="err"?"red":"amber"}`}>{e.sev==="err"?"ERROR":"WARN"}</span>
                      <span className="mono" style={{fontSize:12,color:"var(--text-faint)"}}>{e.ts}</span>
                      <span className="mono" style={{fontSize:12,color:"var(--text-subtle)"}}>@{e.who}</span>
                      <span style={{fontSize:13,color:"var(--text-muted)",flex:1}}>{e.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "audit" && (
            <div className="card">
              <div className="card-body flush">
                {[
                  { ts: "2026-04-26 10:23", who: "alice", action: "submit_review", target: "v1.3.0" },
                  { ts: "2026-04-24 16:01", who: "bob", action: "publish", target: "v1.2.3" },
                  { ts: "2026-04-24 15:48", who: "bob", action: "approve_review", target: "PR #287" },
                  { ts: "2026-04-24 14:12", who: "alice", action: "submit_review", target: "v1.2.3" },
                  { ts: "2026-04-22 11:30", who: "alice", action: "create_draft", target: "v1.2.3" },
                ].map((l, i) => (
                  <div key={i} className="log-row">
                    <span className="ts">{l.ts}</span>
                    <span><span className="mono" style={{fontSize:11.5,color:"var(--primary)"}}>@{l.who}</span></span>
                    <span><span className={`tag ${l.action.includes("approve")||l.action==="publish"?"green":"blue"}`}>{l.action}</span></span>
                    <span className="target">{l.target}</span>
                    <span className="ip">10.4.21.{14 + i*3}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card" style={{marginBottom:"var(--gap)"}}>
            <div className="card-header" style={{padding:"12px 16px"}}><h3 className="card-title">元数据</h3></div>
            <div className="card-body" style={{padding:"14px 16px"}}>
              <div className="meta-list">
                <div className="meta-row"><span className="k">命名空间</span><span className="v mono">platform-team</span></div>
                <div className="meta-row"><span className="k">当前版本</span><span className="v mono">v1.2.3</span></div>
                <div className="meta-row"><span className="k">最新草稿</span><span className="v mono">v1.3.0</span></div>
                <div className="meta-row"><span className="k">密级</span><span className="v"><ClassificationTag level="L2"/></span></div>
                <div className="meta-row"><span className="k">License</span><span className="v">Internal</span></div>
                <div className="meta-row"><span className="k">SBOM</span><span className="v" style={{color:"var(--primary)",cursor:"pointer"}}>查看 →</span></div>
              </div>
            </div>
          </div>

          <div className="card" style={{marginBottom:"var(--gap)"}}>
            <div className="card-header" style={{padding:"12px 16px"}}><h3 className="card-title">维护者</h3></div>
            <div className="card-body flush">
              {[
                { name: "alice", role: "Owner", bg: "bg-1" },
                { name: "bob", role: "Maintainer", bg: "bg-2" },
                { name: "charlie", role: "Maintainer", bg: "bg-3" },
              ].map(m => (
                <div key={m.name} style={{padding:"10px 16px",display:"flex",alignItems:"center",gap:10,borderBottom:m.name!=="charlie"?"1px solid var(--border)":"none"}}>
                  <div className={`avatar sm ${m.bg}`}>{m.name[0].toUpperCase()}</div>
                  <div style={{flex:1,fontSize:13}}>
                    <div style={{fontWeight:500}} className="mono">@{m.name}</div>
                    <div style={{fontSize:11.5,color:"var(--text-subtle)"}}>{m.role}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header" style={{padding:"12px 16px"}}><h3 className="card-title">依赖</h3></div>
            <div className="card-body flush">
              {[
                { ns: "platform-team", name: "go-lint", v: "1.4.2" },
                { ns: "platform-team", name: "github-pr-helper", v: "0.9.1" },
                { ns: "data-team", name: "diff-parser", v: "2.0.0" },
              ].map((d, i) => (
                <div key={i} style={{padding:"10px 16px",display:"flex",alignItems:"center",gap:8,borderBottom: i<2?"1px solid var(--border)":"none",fontSize:12.5}}>
                  <span style={{color:"var(--text-subtle)"}}>{d.ns}/</span>
                  <span style={{fontWeight:500}}>{d.name}</span>
                  <span className="mono" style={{marginLeft:"auto",color:"var(--text-faint)"}}>v{d.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
window.SkillDetail = SkillDetail;
