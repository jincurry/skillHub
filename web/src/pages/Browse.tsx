import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClassificationTag, StatusPill } from '../components/Tags';
import {
  IconPlus, IconSearch, IconChevronDown, IconGrid, IconList,
  IconStar, IconFire, IconX,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { openCreateSkill } from '../components/CreateSkillModal';
import type { Skill } from '../api/types';
import { SkillIcon } from '../components/SkillIcon';
import { useLocaleText } from '../i18n/useLocaleText';

type SortKey = 'updated' | 'activations' | 'rating';

function sortLabel(key: SortKey, text: (en: string, zh: string) => string): string {
  switch (key) {
    case 'activations': return text('Activations', '激活量');
    case 'rating': return text('Rating', '评分');
    case 'updated':
    default: return text('Recently Updated', '最近更新');
  }
}

function statusLabel(status: string, text: (en: string, zh: string) => string): string {
  switch (status) {
    case 'published': return text('Published', '已发布');
    case 'review': return text('In Review', '审批中');
    case 'deprecated': return text('Deprecated', '已废弃');
    case 'yanked': return text('Yanked', '已撤回');
    case 'draft': return text('Draft', '草稿');
    default: return status;
  }
}

function FilterCheckbox({ checked, onChange, label, count }: {
  checked: boolean; onChange: (next: boolean) => void; label: ReactNode; count?: number;
}) {
  return (
    <div className={`filter-row ${checked ? 'checked' : ''}`} onClick={() => onChange(!checked)}>
      <div className={`checkbox ${checked ? 'checked' : ''}`}>
        {checked && (
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 6l3 3 5-6" />
          </svg>
        )}
      </div>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {count !== undefined && <span className="count num">{count}</span>}
    </div>
  );
}

function SkillCard({ s, onOpen }: { s: Skill; onOpen: (s: Skill) => void }) {
  const { text, locale } = useLocaleText();
  return (
    <div className="skill-card" onClick={() => onOpen(s)}>
      <div className="skill-card-head">
        <SkillIcon ns={s.ns} name={s.name} icon={s.icon} iconClass={s.iconClass} size={36} borderRadius={8} fontSize={14} />
        <div className="skill-card-title-block">
          <div className="skill-card-name">
            <span className="ns">{s.ns} /</span>
            <strong>{s.name}</strong>
            {s.hot && <span className="tag amber" style={{ padding: '0 5px', height: 18, fontSize: 10.5 }}><IconFire size={10} /> HOT</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <ClassificationTag level={s.classification} />
            <StatusPill status={s.status} />
          </div>
        </div>
      </div>

      <div className="skill-card-desc">{s.desc}</div>

      <div className="skill-card-stats">
        {s.rating > 0 ? (
          <span className="stat-mini">
            <IconStar size={13} /> <strong style={{ color: 'var(--text)' }}>{s.rating}</strong>
            <span style={{ color: 'var(--text-faint)' }}>({s.ratings})</span>
          </span>
        ) : (
          <span className="stat-mini" style={{ color: 'var(--text-faint)' }}><IconStar size={13} /> {text('No ratings yet', '暂无评分')}</span>
        )}
        {s.activations > 0 ? (
          <span className="stat-mini">
            <IconFire size={13} /> <strong style={{ color: 'var(--text)' }}>{s.activations.toLocaleString()}</strong>
            <span style={{ color: 'var(--text-subtle)' }}>{text('/week', '/周')}</span>
          </span>
        ) : (
          <span className="stat-mini" style={{ color: 'var(--text-faint)' }}><IconFire size={13} /> {text('No activations yet', '暂无激活')}</span>
        )}
      </div>

      <div className="skill-card-meta">
        <span className="mono">v{s.version}</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>{new Date(s.updatedAt).toLocaleDateString(locale)}</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span className="mono">@{s.author}</span>
      </div>

      <div className="skill-card-tags">
        {s.tags.slice(0, 3).map((t) => <span key={t} className="tag">#{t}</span>)}
        {s.tags.length > 3 && <span className="tag">+{s.tags.length - 3}</span>}
      </div>

      <div className="skill-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn sm primary" onClick={() => onOpen(s)}>{text('View details', '查看详情')}</button>
      </div>
    </div>
  );
}

export function Browse() {
  const { text, locale } = useLocaleText();
  const navigate = useNavigate();
  // URL is the source of truth for namespace filter so the global search /
  // sidebar quick-jump (/skills?ns=foo) lands on a pre-filtered view.
  // Multiple `ns` params are supported, e.g. /skills?ns=foo&ns=bar.
  const [searchParams, setSearchParams] = useSearchParams();
  const nsFromUrl = useMemo(
    () => new Set(searchParams.getAll('ns')),
    [searchParams],
  );
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedNs, setSelectedNs] = useState<Set<string>>(nsFromUrl);
  const [selectedClass, setSelectedClass] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // External URL → state: when the user clicks a namespace in the command
  // palette while already on /skills, react-router updates the query but not
  // the component state. We diff against the current selection to avoid
  // touching state when the two are already in sync.
  useEffect(() => {
    const current = Array.from(selectedNs).sort().join(',');
    const incoming = Array.from(nsFromUrl).sort().join(',');
    if (current !== incoming) setSelectedNs(nsFromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nsFromUrl]);

  // State → URL: keep the address bar reflecting the active namespace filter
  // so the URL is shareable / bookmarkable. We use replace to avoid filling
  // history with every toggle.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('ns');
    Array.from(selectedNs).sort().forEach((n) => next.append('ns', n));
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNs]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(id);
  }, [searchInput]);
  const [sort, setSort] = useState<SortKey>('updated');
  const [sortOpen, setSortOpen] = useState(false);

  // Single-valued author filter. Driven from URL (?author=foo) only — we don't
  // expose a sidebar selector for it, only the dismissible chip in the main
  // pane. Clearing the chip clears the query param.
  const authorFilter = searchParams.get('author') ?? '';
  const clearAuthor = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('author');
    setSearchParams(next, { replace: true });
  };

  const namespaces = useAsync(() => api.namespaces(), []);
  const skills = useAsync(() => api.listSkills(), []);

  const filtered = useMemo(() => {
    const all = skills.data ?? [];
    const out = all.filter((s) => {
      if (selectedNs.size && !selectedNs.has(s.ns)) return false;
      if (selectedClass.size && !selectedClass.has(s.classification)) return false;
      if (selectedStatus.size && !selectedStatus.has(s.status)) return false;
      if (selectedTags.size && !s.tags.some((t) => selectedTags.has(t))) return false;
      if (authorFilter && s.author !== authorFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(s.name + s.desc + s.tags.join(',')).toLowerCase().includes(q)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      switch (sort) {
        case 'activations': return b.activations - a.activations;
        case 'rating':      return b.rating - a.rating;
        case 'updated':
        default:            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return out;
  }, [skills.data, selectedNs, selectedClass, selectedStatus, selectedTags, authorFilter, search, sort]);

  const PAGE_SIZE = 24;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [selectedNs, selectedClass, selectedStatus, selectedTags, authorFilter, search, sort]);

  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const openSkill = (s: Skill) => navigate(`/skills/${s.ns}/${s.name}`);
  const toggle = (set: Set<string>, setter: (n: Set<string>) => void, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  const counts = useMemo(() => {
    const all = skills.data ?? [];
    const byClass: Record<string, number> = { L1: 0, L2: 0, L3: 0 };
    const byStatus: Record<string, number> = {};
    const byTag: Record<string, number> = {};
    for (const s of all) {
      byClass[s.classification] = (byClass[s.classification] || 0) + 1;
      byStatus[s.status] = (byStatus[s.status] || 0) + 1;
      for (const t of s.tags) {
        byTag[t] = (byTag[t] || 0) + 1;
      }
    }
    const sortedTags = Object.entries(byTag)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([id, count]) => ({ id, count }));
    return { byClass, byStatus, tags: sortedTags };
  }, [skills.data]);

  return (
    <div className="content-inner">
      <div className="page-header">
        <div>
          <h1 className="page-title">{text('Browse Skills', '浏览 Skills')}</h1>
          <p className="page-subtitle">
            {text(
              `Find the capability you need across ${skills.data?.length ?? '...'} internal skills - filter by namespace, classification, and tags.`,
              `在公司内部 ${skills.data?.length ?? '...'} 个 skill 中找到你需要的能力 — 按命名空间、密级、标签筛选。`,
            )}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={openCreateSkill}><IconPlus size={14} /> {text('Create Skill', '创建 Skill')}</button>
        </div>
      </div>

      <div className="browse-grid">
        <aside>
          <div className="filter-group">
            <h4 className="filter-group-title">{text('Namespaces', '命名空间')}</h4>
            {namespaces.data?.map((ns) => (
              <FilterCheckbox key={ns.id} checked={selectedNs.has(ns.id)} onChange={() => toggle(selectedNs, setSelectedNs, ns.id)} label={ns.id} count={ns.count} />
            ))}
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">{text('Classification', '密级')}</h4>
            <FilterCheckbox checked={selectedClass.has('L1')} onChange={() => toggle(selectedClass, setSelectedClass, 'L1')} label={<><span className="tag blue" style={{ marginRight: 6 }}>L1</span>{text('Public', '公开')}</>} count={counts.byClass.L1} />
            <FilterCheckbox checked={selectedClass.has('L2')} onChange={() => toggle(selectedClass, setSelectedClass, 'L2')} label={<><span className="tag indigo" style={{ marginRight: 6 }}>L2</span>{text('Internal', '内部')}</>} count={counts.byClass.L2} />
            <FilterCheckbox checked={selectedClass.has('L3')} onChange={() => toggle(selectedClass, setSelectedClass, 'L3')} label={<><span className="tag orange" style={{ marginRight: 6 }}>L3</span>{text('Sensitive', '敏感')}</>} count={counts.byClass.L3} />
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">{text('Status', '状态')}</h4>
            {(['published', 'review', 'deprecated', 'yanked', 'draft'] as const).map((st) => (
              <FilterCheckbox key={st} checked={selectedStatus.has(st)} onChange={() => toggle(selectedStatus, setSelectedStatus, st)} label={statusLabel(st, text)} count={counts.byStatus[st] || 0} />
            ))}
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">{text('Tags', '标签')}</h4>
            {counts.tags.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 0' }}>{text('None', '暂无')}</div>
            )}
            {counts.tags.map((t) => (
              <FilterCheckbox
                key={t.id}
                checked={selectedTags.has(t.id)}
                onChange={() => toggle(selectedTags, setSelectedTags, t.id)}
                label={`#${t.id}`}
                count={t.count}
              />
            ))}
          </div>

          <div style={{ paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <button className="btn" style={{ width: '100%' }} onClick={() => {
              setSelectedNs(new Set()); setSelectedClass(new Set()); setSelectedStatus(new Set()); setSelectedTags(new Set()); setSearchInput(''); setSearch('');
              clearAuthor();
            }}>{text('Clear all filters', '清空所有过滤')}</button>
          </div>
        </aside>

        <div>
          {authorFilter && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '4px 10px 4px 12px', marginBottom: 10,
              background: 'var(--primary-50, rgba(79,70,229,0.08))',
              color: 'var(--primary-700, var(--primary))',
              borderRadius: 999, fontSize: 12, fontWeight: 500,
              border: '1px solid var(--primary-200, rgba(79,70,229,0.18))',
            }}>
              <span>{text('Author:', '作者:')} <span className="mono">@{authorFilter}</span></span>
              <button
                onClick={clearAuthor}
                title={text('Clear author filter', '清除作者过滤')}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, padding: 0, border: 'none',
                  background: 'transparent', cursor: 'pointer',
                  color: 'inherit', borderRadius: '50%',
                }}
              ><IconX size={11} /></button>
            </div>
          )}
          <div className="browse-toolbar">
            <div className="input-wrap">
              <span className="icon-left"><IconSearch size={15} /></span>
              <input className="input with-icon" placeholder={text('Search skill name, description, tags...', '搜索 skill 名称、描述、标签...')} value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
            </div>
            <div style={{ position: 'relative' }}>
              <button className="dropdown" style={{ height: 36 }} onClick={() => setSortOpen((v) => !v)}>
                {text('Sort:', '排序:')} <strong style={{ color: 'var(--text)' }}>{sortLabel(sort, text)}</strong> <IconChevronDown size={12} />
              </button>
              {sortOpen && (
                <>
                  <div onClick={() => setSortOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
                  <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 50, minWidth: 160, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 8px 20px rgba(15,23,42,0.12)', overflow: 'hidden' }}>
                    {(['updated', 'activations', 'rating'] as SortKey[]).map((k) => (
                      <div key={k} onClick={() => { setSort(k); setSortOpen(false); }} style={{
                        padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                        background: sort === k ? 'var(--primary-50, rgba(79,70,229,0.08))' : 'transparent',
                        color: sort === k ? 'var(--primary-700, var(--primary))' : 'var(--text)',
                      }}>{sortLabel(k, text)}</div>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="seg">
              <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><IconGrid size={13} /> {text('Grid', '网格')}</button>
              <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><IconList size={13} /> {text('List', '列表')}</button>
            </div>
          </div>

          <div className="browse-meta">
            <span>{text('Total ', '共 ')}<strong style={{ color: 'var(--text)' }} className="num">{filtered.length}</strong>{text(' skills', ' 个 skill')}</span>
            {totalPages > 1 && (
              <span style={{ marginLeft: 8, color: 'var(--text-subtle)', fontSize: 12 }}>
                {text(`Page ${page + 1} / ${totalPages}`, `第 ${page + 1} / ${totalPages} 页`)}
              </span>
            )}
          </div>

          {skills.loading && <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>{text('Loading...', '加载中...')}</div></div>}
          {skills.error && <div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>{text('Load failed: ', '加载失败: ')}{skills.error.message}</div></div>}

          {!skills.loading && view === 'grid' && (
            <div className="skills-grid">
              {paginated.map((s) => <SkillCard key={s.id} s={s} onOpen={openSkill} />)}
            </div>
          )}
          {!skills.loading && view === 'list' && (
            <div className="card">
              <div className="card-body flush table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Skill</th><th>{text('Classification', '密级')}</th><th>{text('Status', '状态')}</th>
                      <th style={{ textAlign: 'right' }}>{text('Rating', '评分')}</th>
                      <th style={{ textAlign: 'right' }}>{text('Activations / Week', '激活/周')}</th>
                      <th style={{ textAlign: 'right' }}>{text('Version', '版本')}</th>
                      <th>{text('Updated', '更新')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((s) => (
                      <tr key={s.id} onClick={() => openSkill(s)}>
                        <td>
                          <div className="tbl-name">
                            <SkillIcon ns={s.ns} name={s.name} icon={s.icon} iconClass={s.iconClass} />
                            <div>
                              <div className="skill-name-text"><span style={{ color: 'var(--text-subtle)', fontWeight: 500 }}>{s.ns}/</span>{s.name}</div>
                              <div className="skill-name-desc" style={{ maxWidth: 380, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.desc}</div>
                            </div>
                          </div>
                        </td>
                        <td><ClassificationTag level={s.classification} /></td>
                        <td><StatusPill status={s.status} /></td>
                        <td style={{ textAlign: 'right' }} className="num">{s.rating > 0 ? <><IconStar size={11} /> {s.rating}</> : <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                        <td className="num" style={{ textAlign: 'right', fontWeight: 500 }}>{s.activations.toLocaleString()}</td>
                        <td style={{ textAlign: 'right' }}><span className="mono">v{s.version}</span></td>
                        <td style={{ color: 'var(--text-subtle)', fontSize: 12.5 }}>{new Date(s.updatedAt).toLocaleDateString(locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {!skills.loading && totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(0)}>«</button>
              <button className="btn sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ {text('Previous', '上一页')}</button>
              <span style={{ fontSize: 12.5, color: 'var(--text-subtle)', minWidth: 80, textAlign: 'center' }}>
                {page + 1} / {totalPages}
              </span>
              <button className="btn sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>{text('Next', '下一页')} ›</button>
              <button className="btn sm" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>»</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
