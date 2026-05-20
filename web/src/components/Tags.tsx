import { useLocaleText } from '../i18n/useLocaleText';

type Status = 'published' | 'draft' | 'review' | 'yanked' | 'deprecated';

export function StatusPill({ status }: { status: Status }) {
  const { text } = useLocaleText();
  const map: Record<Status, { cls: string; label: string }> = {
    published: { cls: 'published', label: text('Published', '已发布') },
    draft: { cls: 'draft', label: text('Draft', '草稿') },
    review: { cls: 'review', label: text('In Review', '审批中') },
    yanked: { cls: 'yanked', label: text('Yanked', '已撤销') },
    deprecated: { cls: 'deprecated', label: text('Deprecated', '已弃用') },
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
  const { text } = useLocaleText();
  const map = {
    L1: { cls: 'blue', text: text('L1 Public', 'L1 公开') },
    L2: { cls: 'indigo', text: text('L2 Internal', 'L2 内部') },
    L3: { cls: 'orange', text: text('L3 Sensitive', 'L3 敏感') },
  } as const;
  const it = map[level] || map.L2;
  return <span className={`tag ${it.cls}`}>{it.text}</span>;
}
