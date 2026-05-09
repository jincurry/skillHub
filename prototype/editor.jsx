// Editor page — code editor with file tree + validation panel
function Editor({ skill, onNav }) {
  const [openFile, setOpenFile] = useState("skill.yaml");
  const s = skill || { name: "go-code-review", ns: "platform-team" };

  const fileContents = {
    "skill.yaml": [
      {n:1,t:[{c:"kw",v:"name"},{v:`: ${s.name}`}]},
      {n:2,t:[{c:"kw",v:"version"},{v:": "},{c:"str",v:'"1.3.0"'}]},
      {n:3,t:[{c:"kw",v:"namespace"},{v:`: ${s.ns}`}]},
      {n:4,t:[{c:"kw",v:"classification"},{v:": L2"}]},
      {n:5,t:[{c:"com",v:"# Skill 元数据 — 提交审批前所有字段必填"}]},
      {n:6,t:[{c:"kw",v:"description"},{v:": "},{c:"str",v:'|'}]},
      {n:7,t:[{v:"  Review Go code for bugs, idiomatic patterns,"}]},
      {n:8,t:[{v:"  error handling, and Go 1.21+ generics usage."}]},
      {n:9,t:[]},
      {n:10,t:[{c:"kw",v:"runtime"},{v:":"}]},
      {n:11,t:[{v:"  "},{c:"kw",v:"image"},{v:": "},{c:"str",v:'"go:1.22-alpine"'}]},
      {n:12,t:[{v:"  "},{c:"kw",v:"timeout"},{v:": "},{c:"num-lit",v:"60s"}]},
      {n:13,t:[{v:"  "},{c:"kw",v:"memory"},{v:": "},{c:"str",v:'"512Mi"'}]},
      {n:14,t:[]},
      {n:15,t:[{c:"kw",v:"inputs"},{v:":"}]},
      {n:16,t:[{v:"  - "},{c:"kw",v:"name"},{v:": diff"}]},
      {n:17,t:[{v:"    "},{c:"kw",v:"type"},{v:": "},{c:"str",v:"git_ref"}]},
      {n:18,t:[{v:"    "},{c:"kw",v:"default"},{v:": "},{c:"str",v:'"HEAD~1"'}]},
      {n:19,t:[{v:"  - "},{c:"kw",v:"name"},{v:": strictness"}]},
      {n:20,t:[{v:"    "},{c:"kw",v:"type"},{v:": "},{c:"str",v:"enum"}]},
      {n:21,t:[{v:"    "},{c:"kw",v:"values"},{v:": [low, medium, high]"}]},
      {n:22,t:[{v:"    "},{c:"kw",v:"default"},{v:": "},{c:"str",v:"medium"}]},
    ],
  };

  const lines = fileContents[openFile] || fileContents["skill.yaml"];

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{color:"var(--text-subtle)",fontWeight:500}}>{s.ns} /</span>
            {s.name}
            <span className="tag indigo mono">v1.3.0</span>
            <span className="status-pill draft"><span className="swatch"></span>Draft</span>
          </h1>
          <p className="page-subtitle">
            未保存的更改 · 上次自动保存 <span className="mono">2 分钟前</span>
          </p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconCode size={14}/> 预览渲染</button>
          <button className="btn"><IconCheckCircle size={14}/> Validate</button>
          <button className="btn primary"><IconRocket size={14}/> 提交审批</button>
        </div>
      </div>

      <div className="editor-grid">
        {/* File tree */}
        <div className="editor-files">
          <div className="file-row dir"><IconChevronDown size={12}/> {s.name}</div>
          <div className={`file-row ${openFile==="skill.yaml"?"active":""}`} onClick={()=>setOpenFile("skill.yaml")}>
            <span style={{color:"#dc2626"}}>📄</span> skill.yaml <span className="file-status M">M</span>
          </div>
          <div className="file-row">
            <span>📄</span> README.md <span className="file-status M">M</span>
          </div>
          <div className="file-row">
            <span>📄</span> CHANGELOG.md <span className="file-status A">A</span>
          </div>
          <div className="file-row dir" style={{marginTop:4}}><IconChevronDown size={12}/> rules/</div>
          <div className="file-row" style={{paddingLeft:32}}><span>🔧</span> error-wrap.go</div>
          <div className="file-row" style={{paddingLeft:32}}><span>🔧</span> nil-deref.go</div>
          <div className="file-row" style={{paddingLeft:32}}><span>🔧</span> generics-bounds.go <span className="file-status A">A</span></div>
          <div className="file-row" style={{paddingLeft:32}}><span>🔧</span> context-leak.go</div>
          <div className="file-row dir" style={{marginTop:4}}><IconChevronRight size={12}/> tests/</div>
          <div className="file-row dir"><IconChevronRight size={12}/> docs/</div>
          <div className="file-row"><span>📄</span> .skillhub/config.yaml</div>
          <div className="file-row"><span>📄</span> Dockerfile</div>
        </div>

        {/* Main editor */}
        <div className="editor-main">
          <div className="editor-tabs">
            <div className="editor-tab active">
              <span style={{color:"#dc2626"}}>📄</span> skill.yaml
              <span style={{marginLeft:6,opacity:0.5}}>×</span>
            </div>
            <div className="editor-tab">
              <span>🔧</span> generics-bounds.go
              <span style={{marginLeft:6,opacity:0.5}}>×</span>
            </div>
          </div>
          <div className="editor-code">
            <div className="editor-gutter">
              {lines.map(l => <div key={l.n}>{l.n}</div>)}
            </div>
            <div className="editor-content">
              {lines.map(l => (
                <div key={l.n}>
                  {l.t.map((tok, i) => (
                    <span key={i} className={tok.c}>{tok.v}</span>
                  ))}
                  {l.t.length === 0 && <span>&nbsp;</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right side: validation */}
        <div className="editor-side">
          <div className="editor-side-section">
            <div className="editor-side-title">Validation</div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",fontSize:12.5}}>
              <IconCheckCircle size={14} style={{color:"var(--green)"}}/>
              <span style={{flex:1}}>Schema 校验</span>
              <span className="tag green">通过</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",fontSize:12.5}}>
              <IconCheckCircle size={14} style={{color:"var(--green)"}}/>
              <span style={{flex:1}}>Secret 扫描</span>
              <span className="tag green">无</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",fontSize:12.5}}>
              <IconAlertTriangle size={14} style={{color:"var(--amber)"}}/>
              <span style={{flex:1}}>静态分析</span>
              <span className="tag amber">3 警告</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",fontSize:12.5}}>
              <IconCheckCircle size={14} style={{color:"var(--green)"}}/>
              <span style={{flex:1}}>依赖审查</span>
              <span className="tag green">12/12</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",fontSize:12.5}}>
              <IconCheckCircle size={14} style={{color:"var(--green)"}}/>
              <span style={{flex:1}}>包大小</span>
              <span className="tag green">142KB</span>
            </div>
          </div>

          <div className="editor-side-section">
            <div className="editor-side-title">问题 (3)</div>
            {[
              {sev:"warn",file:"skill.yaml",line:12,msg:"timeout 60s 超过推荐值 30s"},
              {sev:"warn",file:"rules/generics-bounds.go",line:48,msg:"未使用的导入 fmt"},
              {sev:"info",file:"README.md",line:1,msg:"缺少 Examples 章节"},
            ].map((p, i) => (
              <div key={i} style={{padding:"8px 0",borderBottom: i<2?"1px solid var(--border)":"none"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,marginBottom:2}}>
                  {p.sev === "warn" ? <IconAlertTriangle size={12} style={{color:"var(--amber)"}}/> :
                    <IconCheckCircle size={12} style={{color:"var(--blue)"}}/>}
                  <span className="mono" style={{fontSize:11,color:"var(--text-subtle)"}}>{p.file}:{p.line}</span>
                </div>
                <div style={{fontSize:12,color:"var(--text-muted)",lineHeight:1.45,paddingLeft:18}}>{p.msg}</div>
              </div>
            ))}
          </div>

          <div className="editor-side-section">
            <div className="editor-side-title">变更预览</div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:6}}>
              <span style={{color:"var(--text-subtle)"}}>从 v1.2.3</span>
              <span className="mono">→ v1.3.0</span>
            </div>
            <div style={{fontSize:11.5,color:"var(--text-muted)",lineHeight:1.6}}>
              <div><span style={{color:"var(--green-text)"}}>+ 4 个新文件</span></div>
              <div><span style={{color:"var(--amber-text)"}}>~ 3 个修改</span></div>
              <div><span style={{color:"var(--text-faint)"}}>- 0 个删除</span></div>
              <div style={{marginTop:6}}>影响范围: <strong style={{color:"var(--text)"}}>非破坏性</strong></div>
            </div>
            <button className="btn sm" style={{width:"100%",marginTop:10}}><IconCode size={12}/> 查看完整 Diff</button>
          </div>
        </div>
      </div>
    </div>
  );
}
window.Editor = Editor;
