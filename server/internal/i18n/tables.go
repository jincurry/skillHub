package i18n

// Translation tables. Keys are dotted snake_case and grouped by surface:
//
//	api.*       → HTTP error responses (gin.H{"error": ...})
//	notif.*     → notification body templates inserted into notifications.body
//	common.*    → reused fragments (e.g. "skill not found")
//
// When adding a new key, define it in BOTH zh-CN and en. Missing keys fall
// back to zh-CN, then to the literal key.

var tables = map[Lang]map[string]string{
	ZhCN: {
		// Permission gates surfaced as 403 from the API layer.
		"api.need_author_or_member":     "需要 author 或 namespace 成员身份",
		"api.need_author_or_maintainer": "需要 author 或 namespace owner / maintainer 身份",

		// Resource lookups.
		"api.skill_not_found":     "skill not found",
		"api.namespace_exists":    "namespace already exists",
		"api.tag_not_found":       "tag not found",
		"api.review_not_found":    "review not found",
		"api.user_not_found":      "user not found",
		"api.namespace_not_found": "namespace not found",

		// File mutations on the canonical SKILL.md entry point.
		"api.skill_md_undeletable":   "SKILL.md 是 skill 入口，不可删除",
		"api.skill_md_unrenameable":  "SKILL.md 是 skill 入口，不可重命名",

		// Auth / password change.
		"store.password_old_wrong": "旧密码不正确",

		// Notification body templates. %s placeholders are substituted in the
		// order documented next to each key.
		// notif.review_approved: ns/name, version
		"notif.review_approved":         "你的 %s v%s 已审批通过",
		// notif.review_rejected: ns/name, version, optional note (with separator)
		"notif.review_rejected":         "你的 %s v%s 被驳回",
		"notif.review_rejected_with_note": "你的 %s v%s 被驳回：%s",
		// notif.review_changes: ns/name, version, optional note
		"notif.review_changes":          "你的 %s v%s 需要修改",
		"notif.review_changes_with_note": "你的 %s v%s 需要修改：%s",

		// Skill lifecycle (yank / deprecate). Args: ns/name, actor, status,
		// optional reason.
		"notif.skill_status_changed":           "%s 已被 @%s 标记为 %s",
		"notif.skill_status_changed_with_reason": "%s 已被 @%s 标记为 %s：%s",

		// Member management.
		"notif.member_added": "@%s 把你加入了 %s (%s)", // actor, ns, role
	},
	En: {
		"api.need_author_or_member":     "Author or namespace member role required",
		"api.need_author_or_maintainer": "Author or namespace owner/maintainer role required",

		"api.skill_not_found":     "skill not found",
		"api.namespace_exists":    "namespace already exists",
		"api.tag_not_found":       "tag not found",
		"api.review_not_found":    "review not found",
		"api.user_not_found":      "user not found",
		"api.namespace_not_found": "namespace not found",

		"api.skill_md_undeletable":  "SKILL.md is the skill entry point and cannot be deleted",
		"api.skill_md_unrenameable": "SKILL.md is the skill entry point and cannot be renamed",

		"store.password_old_wrong": "old password is incorrect",

		"notif.review_approved":          "Your %s v%s was approved",
		"notif.review_rejected":          "Your %s v%s was rejected",
		"notif.review_rejected_with_note": "Your %s v%s was rejected: %s",
		"notif.review_changes":           "Your %s v%s needs changes",
		"notif.review_changes_with_note":  "Your %s v%s needs changes: %s",

		"notif.skill_status_changed":            "%s was marked %s by @%s",
		"notif.skill_status_changed_with_reason": "%s was marked %s by @%s: %s",

		"notif.member_added": "@%s added you to %s as %s",
	},
}
