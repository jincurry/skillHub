import { memo, useState, type ReactNode } from 'react';
import { IconChevronDown, IconChevronRight, IconPencil } from '../../components/Icons';
import type { SkillFile } from '../../api/types';
import { REQUIRED_FILES, STD_DIRS, STD_DIR_KEYS } from './constants';
import { dirIconFor, iconFor } from './helpers';
import { useLocaleText } from '../../i18n/useLocaleText';

export interface TreeNode {
  name: string;
  path: string;             // full path for files; directory prefix for dirs
  isDir: boolean;
  children: TreeNode[];
  size?: number;
}

export function buildTree(files: SkillFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      const isLeaf = i === parts.length - 1;
      acc = acc ? acc + '/' + seg : seg;
      let child = node.children.find((c) => c.name === seg && c.isDir === !isLeaf);
      if (!child) {
        child = { name: seg, path: acc, isDir: !isLeaf, children: [] };
        node.children.push(child);
      }
      if (isLeaf) child.size = f.size;
      node = child;
    }
  }
  // Sort: dirs first, alpha
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

function FileTreeImpl({
  root,
  activePath,
  dirtyPaths,
  onPick,
  onDelete,
  onRename,
  canEdit,
}: {
  root: TreeNode;
  activePath: string | null;
  dirtyPaths: Set<string>;
  onPick: (p: string) => void;
  onDelete: (p: string) => void;
  /** Called with (oldPath, newPath). Should return true on success so the
      inline editor can close itself. */
  onRename: (oldPath: string, newPath: string) => Promise<boolean>;
  canEdit: boolean;
}) {
  const { text } = useLocaleText();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Path currently being inline-renamed (null = none).
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState<string | null>(null);

  const toggle = (p: string) => {
    const next = new Set(collapsed);
    next.has(p) ? next.delete(p) : next.add(p);
    setCollapsed(next);
  };
  const startRename = (p: string) => {
    setRenaming(p);
    setRenameValue(p);
    setRenameErr(null);
  };
  const cancelRename = () => {
    if (renameBusy) return;
    setRenaming(null);
    setRenameValue('');
    setRenameErr(null);
  };
  const commitRename = async () => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (!next || next === renaming) {
      cancelRename();
      return;
    }
    setRenameBusy(true);
    setRenameErr(null);
    try {
      const ok = await onRename(renaming, next);
      if (ok) {
        setRenaming(null);
        setRenameValue('');
      }
    } catch (e) {
      setRenameErr((e as Error).message);
    } finally {
      setRenameBusy(false);
    }
  };

  const renderNode = (n: TreeNode, depth: number): ReactNode => {
    if (n.isDir) {
      const isOpen = !collapsed.has(n.path);
      // Top-level dirs that match the recommended layout get a coloured tint
      // so users learn the convention without reading any docs.
      const isStdDir = n.path === n.name && STD_DIR_KEYS.has(n.name);
      return (
        <div key={n.path || '(root)'}>
          {n.path && (
            <div
              className="file-row dir"
              style={{ paddingLeft: 8 + depth * 16, color: isStdDir ? 'var(--primary)' : undefined }}
              onClick={() => toggle(n.path)}
              title={isStdDir
                ? text(`Recommended directory · ${n.name}/`, `推荐目录 · ${STD_DIRS.find((d) => d.key === n.name)?.desc ?? ''}`)
                : n.path}
            >
              {isOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              <span style={{ marginRight: 2 }}>{dirIconFor(n.name)}</span>
              {n.name}/
            </div>
          )}
          {(n.path === '' || isOpen) && n.children.map((c) => renderNode(c, n.path === '' ? depth : depth + 1))}
        </div>
      );
    }
    const dirty = dirtyPaths.has(n.path);
    const isActive = activePath === n.path;
    const required = REQUIRED_FILES.has(n.path);
    const isRenaming = renaming === n.path;
    if (isRenaming) {
      // While renaming we replace the row with an inline form. We keep the
      // same paddingLeft so the user's eye doesn't jump.
      return (
        <div key={n.path} style={{ paddingLeft: 8 + depth * 16, padding: '4px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{iconFor(n.path)}</span>
            <input
              autoFocus
              value={renameValue}
              disabled={renameBusy}
              onChange={(e) => { setRenameValue(e.target.value); if (renameErr) setRenameErr(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1, minWidth: 0,
                fontSize: 12, fontFamily: 'var(--font-mono, monospace)',
                padding: '2px 6px', height: 22,
                border: '1px solid var(--primary, #4f46e5)', borderRadius: 4,
                background: 'var(--bg)', color: 'var(--text)',
              }}
            />
            <button
              className="btn sm primary"
              style={{ height: 22, padding: '0 6px', fontSize: 11 }}
              disabled={renameBusy}
              onClick={(e) => { e.stopPropagation(); commitRename(); }}
            >{renameBusy ? '...' : 'OK'}</button>
            <button
              className="btn sm ghost"
              style={{ height: 22, padding: '0 6px', fontSize: 11 }}
              disabled={renameBusy}
              onClick={(e) => { e.stopPropagation(); cancelRename(); }}
            >{text('Cancel', '取消')}</button>
          </div>
          {renameErr && (
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--red-text, #b91c1c)' }}>{renameErr}</div>
          )}
        </div>
      );
    }
    return (
      <div
        key={n.path}
        className={`file-row ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16, display: 'flex', alignItems: 'center', gap: 6 }}
        onClick={() => onPick(n.path)}
        title={n.path}
      >
        <span>{iconFor(n.path)}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {n.name}
        </span>
        {dirty && <span className="file-status M" title={text('Unsaved', '未保存')}>M</span>}
        {canEdit && !required && (
          <>
            <button
              className="btn sm ghost"
              style={{ padding: '0 4px', height: 18, minWidth: 0, opacity: 0.5 }}
              title={text(`Rename ${n.path}`, `重命名 ${n.path}`)}
              onClick={(e) => { e.stopPropagation(); startRename(n.path); }}
            ><IconPencil size={11} /></button>
            <button
              className="btn sm ghost"
              style={{ padding: '0 4px', height: 18, minWidth: 0, fontSize: 11, opacity: 0.5 }}
              title={text(`Delete ${n.path}`, `删除 ${n.path}`)}
              onClick={(e) => { e.stopPropagation(); onDelete(n.path); }}
            >×</button>
          </>
        )}
      </div>
    );
  };
  return <>{renderNode(root, 0)}</>;
}

export const FileTree = memo(FileTreeImpl);
