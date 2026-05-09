type Status = 'published' | 'draft' | 'review' | 'yanked' | 'deprecated';

export function StatusPill({ status }: { status: Status }) {
  const map: Record<Status, { cls: string; label: string }> = {
    published: { cls: 'published', label: 'Published' },
    draft: { cls: 'draft', label: 'Draft' },
    review: { cls: 'review', label: '审批中' },
    yanked: { cls: 'yanked', label: 'Yanked' },
    deprecated: { cls: 'deprecated', label: 'Deprecated' },
  };
  const it = map[status] || map.draft;
  return (
    <span className={`status-pill ${it.cls}`}>
      <span className="swatch"></span>
      {it.label}
    </span>
  );
}

export function ClassificationTag({ level }: { level: 'L1' | 'L2' | 'L3' }) {
  const map = {
    L1: { cls: 'blue', text: 'L1 公开' },
    L2: { cls: 'indigo', text: 'L2 内部' },
    L3: { cls: 'orange', text: 'L3 敏感' },
  } as const;
  const it = map[level] || map.L2;
  return <span className={`tag ${it.cls}`}>{it.text}</span>;
}
