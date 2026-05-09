import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClassificationTag, StatusPill } from '../components/Tags';
import {
  IconBookmark, IconPlus, IconSearch, IconChevronDown, IconGrid, IconList,
  IconClock, IconStar, IconFire, IconCopy,
} from '../components/Icons';
import { api } from '../api/client';
import { useAsync } from '../api/useAsync';
import { openCreateSkill } from '../components/CreateSkillModal';
import type { Skill } from '../api/types';

function copyInstallCommand(s: Skill): Promise<void> {
  const cmd = `skillhub install ${s.ns}/${s.name}@${s.version}`;
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(cmd);
  }
  return Promise.resolve();
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
  const [copied, setCopied] = useState(false);
  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await copyInstallCommand(s);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="skill-card" onClick={() => onOpen(s)}>
      <div className="skill-card-head">
        <div className={`skill-icon ${s.iconClass}`} style={{ width: 36, height: 36, borderRadius: 8, fontSize: 14 }}>{s.icon}</div>
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
          <span className="stat-mini" style={{ color: 'var(--text-faint)' }}><IconStar size={13} /> 暂无评分</span>
        )}
        {s.activations > 0 ? (
          <span className="stat-mini">
            <IconFire size={13} /> <strong style={{ color: 'var(--text)' }}>{s.activations.toLocaleString()}</strong>
            <span style={{ color: 'var(--text-subtle)' }}>/周</span>
          </span>
        ) : (
          <span className="stat-mini" style={{ color: 'var(--text-faint)' }}><IconFire size={13} /> 暂无激活</span>
        )}
      </div>

      <div className="skill-card-meta">
        <span className="mono">v{s.version}</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span>{new Date(s.updatedAt).toLocaleDateString()}</span>
        <span style={{ color: 'var(--text-faint)' }}>·</span>
        <span className="mono">@{s.author}</span>
      </div>

      <div className="skill-card-tags">
        {s.tags.slice(0, 3).map((t) => <span key={t} className="tag">#{t}</span>)}
        {s.tags.length > 3 && <span className="tag">+{s.tags.length - 3}</span>}
      </div>

      <div className="skill-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn sm" onClick={() => onOpen(s)}>查看详情</button>
        <button className="btn sm primary" onClick={onCopy}>
          <IconCopy size={12} /> {copied ? '已复制' : '复制安装命令'}
        </button>
      </div>
    </div>
  );
}

export function Browse() {
  const navigate = useNavigate();
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedNs, setSelectedNs] = useState<Set<string>>(new Set());
  const [selectedClass, setSelectedClass] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const namespaces = useAsync(() => api.namespaces(), []);
  const skills = useAsync(() => api.listSkills(), []);

  const filtered = useMemo(() => {
    const all = skills.data ?? [];
    return all.filter((s) => {
      if (selectedNs.size && !selectedNs.has(s.ns)) return false;
      if (selectedClass.size && !selectedClass.has(s.classification)) return false;
      if (selectedStatus.size && !selectedStatus.has(s.status)) return false;
      if (selectedTags.size && !s.tags.some((t) => selectedTags.has(t))) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(s.name + s.desc + s.tags.join(',')).toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [skills.data, selectedNs, selectedClass, selectedStatus, selectedTags, search]);

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
          <h1 className="page-title">浏览 Skills</h1>
          <p className="page-subtitle">在公司内部 {skills.data?.length ?? '...'} 个 skill 中找到你需要的能力 — 按命名空间、密级、标签筛选。</p>
        </div>
        <div className="page-actions">
          <button className="btn"><IconBookmark size={14} /> 我的收藏</button>
          <button className="btn primary" onClick={openCreateSkill}><IconPlus size={14} /> 创建 Skill</button>
        </div>
      </div>

      <div className="browse-grid">
        <aside>
          <div className="filter-group">
            <h4 className="filter-group-title">命名空间</h4>
            {namespaces.data?.map((ns) => (
              <FilterCheckbox key={ns.id} checked={selectedNs.has(ns.id)} onChange={() => toggle(selectedNs, setSelectedNs, ns.id)} label={ns.id} count={ns.count} />
            ))}
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">密级</h4>
            <FilterCheckbox checked={selectedClass.has('L1')} onChange={() => toggle(selectedClass, setSelectedClass, 'L1')} label={<><span className="tag blue" style={{ marginRight: 6 }}>L1</span>公开</>} count={counts.byClass.L1} />
            <FilterCheckbox checked={selectedClass.has('L2')} onChange={() => toggle(selectedClass, setSelectedClass, 'L2')} label={<><span className="tag indigo" style={{ marginRight: 6 }}>L2</span>内部</>} count={counts.byClass.L2} />
            <FilterCheckbox checked={selectedClass.has('L3')} onChange={() => toggle(selectedClass, setSelectedClass, 'L3')} label={<><span className="tag orange" style={{ marginRight: 6 }}>L3</span>敏感</>} count={counts.byClass.L3} />
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">状态</h4>
            {(['published', 'review', 'deprecated', 'yanked', 'draft'] as const).map((st) => (
              <FilterCheckbox key={st} checked={selectedStatus.has(st)} onChange={() => toggle(selectedStatus, setSelectedStatus, st)} label={st} count={counts.byStatus[st] || 0} />
            ))}
          </div>

          <div className="filter-group">
            <h4 className="filter-group-title">标签</h4>
            {counts.tags.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '4px 0' }}>暂无</div>
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
              setSelectedNs(new Set()); setSelectedClass(new Set()); setSelectedStatus(new Set()); setSelectedTags(new Set()); setSearch('');
            }}>清空所有过滤</button>
          </div>
        </aside>

        <div>
          <div className="browse-toolbar">
            <div className="input-wrap">
              <span className="icon-left"><IconSearch size={15} /></span>
              <input className="input with-icon" placeholder="搜索 skill 名称、描述、标签..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button className="dropdown" style={{ height: 36 }}>
              排序: <strong style={{ color: 'var(--text)' }}>相关度</strong> <IconChevronDown size={12} />
            </button>
            <div className="seg">
              <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}><IconGrid size={13} /> 网格</button>
              <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><IconList size={13} /> 列表</button>
            </div>
          </div>

          <div className="browse-meta">
            <span>共 <strong style={{ color: 'var(--text)' }} className="num">{filtered.length}</strong> 个 skill</span>
            <span><IconClock size={12} stroke={2} /> 实时数据</span>
          </div>

          {skills.loading && <div className="card"><div className="card-body" style={{ color: 'var(--text-subtle)' }}>加载中...</div></div>}
          {skills.error && <div className="card"><div className="card-body" style={{ color: 'var(--red-text)' }}>加载失败: {skills.error.message}</div></div>}

          {!skills.loading && view === 'grid' && (
            <div className="skills-grid">
              {filtered.map((s) => <SkillCard key={s.id} s={s} onOpen={openSkill} />)}
            </div>
          )}
          {!skills.loading && view === 'list' && (
            <div className="card">
              <div className="card-body flush table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Skill</th><th>密级</th><th>状态</th>
                      <th style={{ textAlign: 'right' }}>评分</th>
                      <th style={{ textAlign: 'right' }}>激活/周</th>
                      <th style={{ textAlign: 'right' }}>版本</th>
                      <th>更新</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.id} onClick={() => openSkill(s)}>
                        <td>
                          <div className="tbl-name">
                            <div className={`skill-icon ${s.iconClass}`}>{s.icon}</div>
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
                        <td style={{ color: 'var(--text-subtle)', fontSize: 12.5 }}>{new Date(s.updatedAt).toLocaleDateString()}</td>
                        <td>
                          <button
                            className="btn sm ghost"
                            title="复制安装命令"
                            onClick={(e) => { e.stopPropagation(); void copyInstallCommand(s); }}
                          >
                            <IconCopy size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
