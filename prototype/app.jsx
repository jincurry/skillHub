// Main app — routing + tweaks

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "primaryColor": "#4f46e5",
  "theme": "light",
  "density": "default",
  "language": "zh"
}/*EDITMODE-END*/;

function App() {
  const [page, setPage] = useState("workspace");
  const [reviewItem, setReviewItem] = useState(null);
  const [detailSkill, setDetailSkill] = useState({ name: "go-code-review", ns: "platform-team" });
  const [editorSkill, setEditorSkill] = useState({ name: "go-code-review", ns: "platform-team" });
  const tweaks = useTweaks ? useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const [t, setT] = tweaks;

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", t.theme || "light");
    document.documentElement.setAttribute("data-density", t.density || "default");
    if (t.primaryColor) {
      const root = document.documentElement.style;
      root.setProperty("--primary", t.primaryColor);
      root.setProperty("--primary-600", t.primaryColor);
      root.setProperty("--primary-700", `color-mix(in oklab, ${t.primaryColor}, black 12%)`);
      root.setProperty("--primary-800", `color-mix(in oklab, ${t.primaryColor}, black 25%)`);
      root.setProperty("--primary-50", `color-mix(in oklab, ${t.primaryColor}, white 88%)`);
      root.setProperty("--primary-100", `color-mix(in oklab, ${t.primaryColor}, white 78%)`);
      root.setProperty("--primary-200", `color-mix(in oklab, ${t.primaryColor}, white 65%)`);
    }
  }, [t]);

  const crumbsMap = {
    workspace: ["Home", "工作台"],
    browse: ["Home", "Skills", "浏览"],
    detail: ["Home", "Skills", `${detailSkill.ns} / ${detailSkill.name}`],
    reviews: ["Home", "审批中心"],
    "review-detail": ["Home", "审批中心", reviewItem ? `${reviewItem.ns}/${reviewItem.name}` : "审批"],
    audit: ["Home", "审计日志"],
    admin: ["Home", "管理后台"],
    editor: ["Home", "编辑器", `${editorSkill.ns} / ${editorSkill.name}`],
    profile: ["Home", "@alice"],
  };

  const navigate = (p, payload) => {
    if (p === "detail" && payload) setDetailSkill(payload);
    if (p === "editor" && payload) setEditorSkill(payload);
    setPage(p);
  };
  const openReview = (r) => { setReviewItem(r); setPage("review-detail"); };

  return (
    <div className="app">
      <Sidebar activePage={page === "review-detail" ? "reviews" : (page === "detail" ? "browse" : page)} onNav={navigate}/>
      <div className="main">
        <Topbar crumbs={crumbsMap[page] || ["Home"]}/>
        <div className="content">
          {page === "workspace" && <Workspace onNav={navigate}/>}
          {page === "browse" && <Browse onNav={navigate}/>}
          {page === "detail" && window.SkillDetail && <SkillDetail skill={detailSkill} onNav={navigate}/>}
          {page === "reviews" && <Reviews onOpen={openReview}/>}
          {page === "review-detail" && reviewItem && <ReviewDetail review={reviewItem} onBack={() => setPage("reviews")}/>}
          {page === "audit" && window.Audit && <Audit/>}
          {page === "admin" && window.Admin && <Admin/>}
          {page === "editor" && window.Editor && <Editor skill={editorSkill} onNav={navigate}/>}
          {page === "profile" && window.Profile && <Profile/>}
        </div>
      </div>

      {window.TweaksPanel && (
        <TweaksPanel title="Tweaks">
          <TweakSection label="页面">
            <TweakSelect value={page} options={[
              {value:"workspace",label:"工作台"},
              {value:"browse",label:"Skill 浏览"},
              {value:"detail",label:"Skill 详情"},
              {value:"reviews",label:"审批中心"},
              {value:"audit",label:"审计日志"},
              {value:"admin",label:"管理后台"},
              {value:"editor",label:"编辑器"},
              {value:"profile",label:"我的主页"},
            ]} onChange={navigate}/>
          </TweakSection>
          <TweakSection label="主题">
            <TweakRadio value={t.theme} options={[
              {value:"light",label:"浅色"},
              {value:"dark",label:"深色"},
            ]} onChange={v => setT({theme: v})}/>
          </TweakSection>
          <TweakSection label="主色">
            <TweakColor value={t.primaryColor} onChange={v => setT({primaryColor: v})}/>
            <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
              {["#4f46e5","#2563eb","#0d9488","#7c3aed","#db2777","#ea580c"].map(c => (
                <button key={c}
                  onClick={() => setT({primaryColor: c})}
                  style={{
                    width:24,height:24,borderRadius:6,
                    border: t.primaryColor === c ? "2px solid white" : "1px solid var(--border)",
                    boxShadow: t.primaryColor === c ? `0 0 0 2px ${c}` : "none",
                    background: c, cursor:"pointer", padding:0
                  }}/>
              ))}
            </div>
          </TweakSection>
          <TweakSection label="信息密度">
            <TweakRadio value={t.density} options={[
              {value:"compact",label:"紧凑"},
              {value:"default",label:"中等"},
              {value:"comfortable",label:"宽松"},
            ]} onChange={v => setT({density: v})}/>
          </TweakSection>
        </TweaksPanel>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
