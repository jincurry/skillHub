// Shared metadata for audit-log rendering, used by both the global audit page
// and the per-skill audit tab.

export const AUDIT_ACTION_COLOR: Record<string, string> = {
  publish: 'green',
  yank: 'red',
  deprecated: 'amber',
  approve_review: 'green',
  reject_review: 'red',
  request_changes: 'amber',
  submit_review: 'blue',
  create_draft: 'blue',
  create_namespace: 'indigo',
  delete_namespace: 'red',
  add_maintainer: 'indigo',
  remove_maintainer: 'amber',
  activate: '',
  update_settings: 'amber',
  rotate_key: 'amber',
  update_profile: 'blue',
  edit_file: '',
  delete_file: 'amber',
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  publish: '发布',
  yank: '撤销',
  deprecated: '废弃',
  approve_review: '通过审批',
  reject_review: '驳回审批',
  request_changes: '请求修改',
  submit_review: '提交审批',
  create_draft: '创建草稿',
  create_namespace: '创建命名空间',
  delete_namespace: '删除命名空间',
  add_maintainer: '添加维护者',
  remove_maintainer: '移除维护者',
  activate: '激活',
  update_settings: '更新配置',
  rotate_key: '轮换密钥',
  update_profile: '更新资料',
  edit_file: '编辑文件',
  delete_file: '删除文件',
};

export const AUDIT_ACTION_LABEL_EN: Record<string, string> = {
  publish: 'Publish',
  yank: 'Yank',
  deprecated: 'Deprecate',
  approve_review: 'Approve review',
  reject_review: 'Reject review',
  request_changes: 'Request changes',
  submit_review: 'Submit review',
  create_draft: 'Create draft',
  create_namespace: 'Create namespace',
  delete_namespace: 'Delete namespace',
  add_maintainer: 'Add maintainer',
  remove_maintainer: 'Remove maintainer',
  activate: 'Activate',
  update_settings: 'Update settings',
  rotate_key: 'Rotate key',
  update_profile: 'Update profile',
  edit_file: 'Edit file',
  delete_file: 'Delete file',
};

export function auditActionLabel(action: string, isEnglish: boolean): string {
  return (isEnglish ? AUDIT_ACTION_LABEL_EN[action] : AUDIT_ACTION_LABEL[action]) ?? action;
}

/**
 * Coarse-grained category for the audit-tab filter chips.
 * release: lifecycle changes (publish, yank, deprecate)
 * review:  review submit / decisions
 * file:    edits inside the skill bundle
 * other:   everything else
 */
export type AuditCategory = 'release' | 'review' | 'file' | 'other';

export function auditCategory(action: string): AuditCategory {
  switch (action) {
    case 'publish':
    case 'yank':
    case 'deprecated':
      return 'release';
    case 'submit_review':
    case 'approve_review':
    case 'reject_review':
    case 'request_changes':
      return 'review';
    case 'edit_file':
    case 'delete_file':
      return 'file';
    default:
      return 'other';
  }
}

/**
 * For per-skill audit views the `ns/name` prefix on `target` is redundant.
 * Strip it down to just the file path (for edit_file / delete_file targets
 * shaped `ns/name:path`) or render a placeholder when the action is on the
 * skill itself.
 */
export function shortTarget(target: string, ns: string, name: string): string {
  const prefix = `${ns}/${name}`;
  if (target === prefix) return '';
  if (target.startsWith(prefix + ':')) return target.slice(prefix.length + 1);
  return target; // fallback (shouldn't happen for filtered list)
}
