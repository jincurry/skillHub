// Skills browse page

function FilterCheckbox({ checked, onChange, label, count }) {
  return (
    <div className={`filter-row ${checked ? "checked" : ""}`} onClick={() => onChange(!checked)}>
      <div className={`checkbox ${checked ? "checked" : ""}`}>
        {checked && <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-6"/></svg>}
      </div>
      <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
      {count !== undefined && <span className="count num">{count}</span>}
    </div>
  );
}

function SkillCard({ s, onOpen }) {
  return (
    <div className="skill-card" onClick={() => onOpen && onOpen(s)} style={{cursor:"pointer"}}>
      <div className="skill-card-head">
        <div className={`skill-icon ${s.iconClass}`} style={{width:36,height:36,borderRadius:8,fontSize:14}}>{s.icon}</div>
        <div className="skill-card-title-block">
          <div className="skill-card-name">
            <span className="ns">{s.ns} /</span>
            <strong>{s.name}</strong>
            {s.hot && <span className="tag amber" style={{padding:"0 5px",height:18,fontSize:10.5}}><IconFire size={10}/> HOT</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:3}}>
            <ClassificationTag level={s.classification}/>
            <StatusPill status={s.status}/>
          </div>
        </div>
      </div>

      <div className="skill-card-desc">{s.desc}</div>

      <div className="skill-card-stats">
        {s.rating > 0 ? (
          <span className="stat-mini">
            <IconStar size={13}/> <strong style={{color:"var(--text)"}}>{s.rating}</strong>
            <span style={{color:"var(--text-faint)"}}>({s.ratings})</span>
          </span>
        ) : (
          <span className="stat-mini" style={{color:"var(--text-faint)"}}>
            <IconStar size={13}/> 暂无评分
          </span>
        )}
        {s.activations > 0 ? (
          <span className="stat-mini">
            <IconFire size={13}/> <strong style={{color:"var(--text)"}}>{s.activations.toLocaleString()}</strong>
            <span style={{color:"var(--text-subtle)"}}>/周</span>
          </span>
        ) : (
          <span className="stat-mini" style={{color:"var(--text-faint)"}}>
            <IconFire size={13}/> 暂无激活
          </span>
        )}
      </div>

      <div className="skill-card-meta">
        <span className="mono">v{s.version}</span>
        <span style={{color:"var(--text-faint)"}}>·</span>
        <span>{s.updated}</span>
        <span style={{color:"var(--text-faint)"}}>·</span>
        <span className="mono">@{s.author}</span>
      </div>

      <div className="skill-card-tags">
        {s.tags.slice(0, 3).map(t => <span key={t} className="tag outline">#{t}</span>)}
        {s.tags.length > 3 && <span className="tag outline">+{s.tags.length - 3}</span>}
      </div>

      <div className="skill-card-actions" onClick={e => e.stopPropagation()}>
        <button className="btn sm" onClick={() => onOpen && onOpen(s)}>查看详情</button>
        <button className="btn sm primary"><IconCopy size={12}/> 复制安装命令</button>
      </div>
    </div>
  );
}

function Browse({ onNav }) {
  const openSkill = (s) => onNav && onNav("detail", { name: s.name, ns: s.ns });
  const [view, setView] = useState("grid");
  const [selectedNs, setSelectedNs] = useState(new Set(["platform-team"]));
  const [selectedClass, setSelectedClass] = useState(new Set(["L2"]));
  const [selectedStatus, setSelectedStatus] = useState(new Set(["published"]));
  const [search, setSearch] = useState("");

  const toggleNs = (id) => {
    const ns = new Set(selectedNs);
    ns.has(id) ? ns.delete(id) : ns.add(id);
    setSelectedNs(ns);
  };
  const toggleClass = (id) => {
    const cls = new Set(selectedClass);
    cls.has(id) ? cls.delete(id) : cls.add(id);
    setSelectedClass(cls);
  };
  const toggleStatus = (id) => {
    const st = new Set(selectedStatus);
    st.has(id) ? st.delete(id) : st.add(id);
    setSelectedStatus(st);
  };

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">浏览 Skills</h1>
          <p className="page-subtitle">在公司内部 87 个 skill 中找到你需要的能力 — 按命名空间、密级、标签筛选。</p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconBookmark size={14}/> 我的收藏</button>
          <button className="btn primary"><IconPlus size={14}/> 创建 Skill</button>
        </div>
      </div>

      <div className="browse-grid">
        {/* Filters */}
        <aside>
          <div className="filter-group">
            <h4 className="filter-group-title">命名空间</h4>
            {NAMESPACES.map(ns => (
              <FilterCheckbox key={ns.id}
                checked={selectedNs.has(ns.id)}
                onChange={() => toggleNs(ns.id)}
                label={ns.id}
                count={ns.count}/>
            ))}
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">密级</h4>
            <FilterCheckbox checked={selectedClass.has("L1")} onChange={() => toggleClass("L1")} label={<><span className="tag blue" style={{marginRight:6}}>L1</span>公开</>} count={31}/>
            <FilterCheckbox checked={selectedClass.has("L2")} onChange={() => toggleClass("L2")} label={<><span className="tag indigo" style={{marginRight:6}}>L2</span>内部</>} count={42}/>
            <FilterCheckbox checked={selectedClass.has("L3")} onChange={() => toggleClass("L3")} label={<><span className="tag orange" style={{marginRight:6}}>L3</span>敏感</>} count={14}/>
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">状态</h4>
            <FilterCheckbox checked={selectedStatus.has("published")} onChange={() => toggleStatus("published")} label="Published" count={67}/>
            <FilterCheckbox checked={selectedStatus.has("review")} onChange={() => toggleStatus("review")} label="审批中" count={8}/>
            <FilterCheckbox checked={selectedStatus.has("deprecated")} onChange={() => toggleStatus("deprecated")} label="Deprecated" count={9}/>
            <FilterCheckbox checked={selectedStatus.has("yanked")} onChange={() => toggleStatus("yanked")} label="Yanked" count={3}/>
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">标签</h4>
            {TAGS.map(t => (
              <FilterCheckbox key={t.id} checked={false} onChange={()=>{}} label={`#${t.id}`} count={t.count}/>
            ))}
            <a style={{fontSize:12,color:"var(--primary)",cursor:"pointer",padding:"6px 8px",display:"inline-block"}}>查看全部 87 个 →</a>
          </div>

          <div style={{paddingTop:14,borderTop:"1px solid var(--border)"}}>
            <button className="btn" style={{width:"100%"}}>清空所有过滤</button>
          </div>
        </aside>

        {/* Results */}
        <div>
          <div className="browse-toolbar">
            <div className="input-wrap">
              <span className="icon-left"><IconSearch size={15}/></span>
              <input
                className="input"
                placeholder="搜索 skill 名称、描述、标签..."
                value={search}
                onChange={e => setSearch(e.target.value)}/>
            </div>
            <button className="dropdown" style={{height:36}}>
              排序: <strong style={{color:"var(--text)"}}>相关度</strong> <IconChevronDown size={12}/>
            </button>
            <div className="seg">
              <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>
                <IconGrid size={13}/> 网格
              </button>
              <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
                <IconList size={13}/> 列表
              </button>
            </div>
          </div>

          <div className="browse-meta">
            <span>共 <strong style={{color:"var(--text)"}} className="num">{ALL_SKILLS.length}</strong> 个 skill — 已筛选 <span className="tag indigo">platform-team</span> <span className="tag indigo">L2</span> <span className="tag green">Published</span></span>
            <span><IconClock size={12} stroke={2}/> 最后同步 2 分钟前</span>
          </div>

          {view === "grid" ? (
            <div className="skills-grid">
              {ALL_SKILLS.map(s => <SkillCard key={s.ns + s.name} s={s} onOpen={openSkill}/>)}
            </div>
          ) : (
            <div className="card">
              <div className="card-body flush table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Skill</th>
                      <th>密级</th>
                      <th>状态</th>
                      <th style={{textAlign:"right"}}>评分</th>
                      <th style={{textAlign:"right"}}>激活/周</th>
                      <th style={{textAlign:"right"}}>版本</th>
                      <th>更新</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ALL_SKILLS.map(s => (
                      <tr key={s.ns + s.name} onClick={() => openSkill(s)} style={{cursor:"pointer"}}>
                        <td>
                          <div className="tbl-name">
                            <div className={`skill-icon ${s.iconClass}`}>{s.icon}</div>
                            <div>
                              <div className="skill-name-text"><span style={{color:"var(--text-subtle)",fontWeight:500}}>{s.ns}/</span>{s.name}</div>
                              <div className="skill-name-desc" style={{maxWidth:380,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.desc}</div>
                            </div>
                          </div>
                        </td>
                        <td><ClassificationTag level={s.classification}/></td>
                        <td><StatusPill status={s.status}/></td>
                        <td style={{textAlign:"right"}} className="num">{s.rating > 0 ? <><IconStar size={11}/> {s.rating}</> : <span style={{color:"var(--text-faint)"}}>—</span>}</td>
                        <td className="num" style={{textAlign:"right",fontWeight:500}}>{s.activations.toLocaleString()}</td>
                        <td style={{textAlign:"right"}}><span className="mono">v{s.version}</span></td>
                        <td style={{color:"var(--text-subtle)",fontSize:12.5}}>{s.updated}</td>
                        <td><button className="btn sm ghost"><IconCopy size={12}/></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="pagination">
            <button className="page-btn">‹</button>
            <button className="page-btn active">1</button>
            <button className="page-btn">2</button>
            <button className="page-btn">3</button>
            <button className="page-btn">4</button>
            <span style={{color:"var(--text-faint)",padding:"0 4px"}}>…</span>
            <button className="page-btn">8</button>
            <button className="page-btn">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Browse = Browse;
