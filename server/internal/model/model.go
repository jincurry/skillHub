package model

import (
	"time"
)

type Skill struct {
	ID             int64     `json:"id"`
	Namespace      string    `json:"ns"`
	Name           string    `json:"name"`
	Description    string    `json:"desc"`
	LongDesc       string    `json:"longDesc"`
	Icon           string    `json:"icon"`
	IconClass      string    `json:"iconClass"`
	Classification string    `json:"classification"` // L1|L2|L3
	Status         string    `json:"status"`         // published|draft|review|deprecated|yanked
	Version        string    `json:"version"`
	Author         string    `json:"author"`
	Rating         float64   `json:"rating"`
	Ratings        int       `json:"ratings"`
	Activations    int       `json:"activations"`
	DeltaPct       int       `json:"delta"`
	Hot            bool      `json:"hot"`
	Tags           []string  `json:"tags"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type Namespace struct {
	ID    string `json:"id"`
	Owner string `json:"owner"`
	Count int    `json:"count"`
}

type Review struct {
	ID             int64     `json:"id"`
	Namespace      string    `json:"ns"`
	SkillName      string    `json:"name"`
	Version        string    `json:"version"`
	Classification string    `json:"classification"`
	Author         string    `json:"author"`
	Reviewers      []string  `json:"reviewers"`
	Status         string    `json:"status"` // pending|approved|rejected
	Urgency        string    `json:"urgency"`
	SLA            string    `json:"sla"`
	Note           string    `json:"note"`
	SubmittedAt    time.Time `json:"submittedAt"`
	// IsHotfix flags the emergency channel: reviewers see a banner, the
	// approval requirement is relaxed (1 reviewer), and the SLA is 4h.
	IsHotfix     bool   `json:"isHotfix"`
	HotfixReason string `json:"hotfixReason,omitempty"`
	// PolicySnapshot is the policy frozen at submission time. Nil means the
	// review predates the snapshot feature; the UI should fall back to the
	// live policy then.
	PolicySnapshot *PolicySnapshot `json:"policySnapshot,omitempty"`
}

// PolicySnapshot is a JSON-serialisable mirror of policy.Policy. We keep it
// in the model package so model.Review can refer to it without importing
// the policy package (which would create a cycle once the store reads
// reviews through model).
type PolicySnapshot struct {
	Classification string       `json:"classification"`
	Mode           string       `json:"mode"` // parallel|serial
	SLAHours       int          `json:"slaHours"`
	Slots          []PolicySlot `json:"slots"`
	// Hotfix marks this snapshot as the override used by the emergency
	// channel — handy for the reviewer-facing UI to label it clearly.
	Hotfix bool `json:"hotfix,omitempty"`
}

type PolicySlot struct {
	Roles []string `json:"roles"`
	Count int      `json:"count"`
}

// DistTag is one alias ("latest"|"stable"|"beta"|custom) → version pointer
// for a skill. Multiple tags can coexist; "latest" is auto-managed.
type DistTag struct {
	Tag       string    `json:"tag"`
	Version   string    `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
	UpdatedBy string    `json:"updatedBy"`
}

// Subscription represents one user's interest in a skill's release stream.
type Subscription struct {
	Namespace string    `json:"ns"`
	SkillName string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
}

type Comment struct {
	ID        int64     `json:"id"`
	ReviewID  int64     `json:"reviewId"`
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	// FilePath, LineNo, Side together anchor an inline review comment to
	// a specific spot in the diff snapshot. FilePath="" means a general
	// comment. Side ∈ {"", "base", "head"} ("base" = old/left, "head" =
	// new/right of the diff).
	FilePath string `json:"filePath,omitempty"`
	LineNo   int    `json:"lineNo,omitempty"`
	Side     string `json:"side,omitempty"`
}

type AuditLog struct {
	ID        int64     `json:"id"`
	Actor     string    `json:"actor"`
	Action    string    `json:"action"`
	Target    string    `json:"target"`
	Version   string    `json:"version"`
	IP        string    `json:"ip"`
	CreatedAt time.Time `json:"createdAt"`
}

type Notification struct {
	ID         int64     `json:"id"`
	Kind       string    `json:"kind"` // review|comment|publish|warn
	Body       string    `json:"body"`
	TargetKind string    `json:"targetKind"` // skill | review | audit | "" (no target)
	TargetRef  string    `json:"targetRef"`  // skill -> "ns/name" ; review -> review_id ; audit -> ""
	Unread     bool      `json:"unread"`
	CreatedAt  time.Time `json:"createdAt"`
}

type Me struct {
	Username    string    `json:"username"`
	Display     string    `json:"display"`
	Role        string    `json:"role"`
	Team        string    `json:"team"`
	Email       string    `json:"email"`
	Bio         string    `json:"bio"`
	Location    string    `json:"location"`
	AvatarURL   string    `json:"avatarUrl"`
	CoverPreset string    `json:"coverPreset"`
	CoverFrom   string    `json:"coverFrom"`
	CoverTo     string    `json:"coverTo"`
	IsAdmin     bool      `json:"isAdmin"`
	JoinedAt    time.Time `json:"joinedAt"`
}

// UpdateMeRequest carries the editable subset of the user profile. All fields
// are pointers so that an omitted field means "leave unchanged" while an empty
// string means "clear it out".
type UpdateMeRequest struct {
	Display     *string `json:"display" binding:"omitempty,max=80"`
	Email       *string `json:"email" binding:"omitempty,max=200"`
	Bio         *string `json:"bio" binding:"omitempty,max=500"`
	Location    *string `json:"location" binding:"omitempty,max=120"`
	CoverPreset *string `json:"coverPreset" binding:"omitempty,max=32"`
	CoverFrom   *string `json:"coverFrom" binding:"omitempty,max=16"`
	CoverTo     *string `json:"coverTo" binding:"omitempty,max=16"`
}

// MeStats aggregates "what does this user own / care about" counts for the
// Profile and Workspace dashboards.
type MeStats struct {
	Published        int     `json:"published"`
	Drafts           int     `json:"drafts"`
	Activations      int     `json:"activations"`
	RatingsReceived  int     `json:"ratingsReceived"`
	AvgRating        float64 `json:"avgRating"`
	PendingReviews   int     `json:"pendingReviews"`   // assigned to me, status=pending
	ReviewsCompleted int     `json:"reviewsCompleted"` // approved/rejected/changes_requested by me
}

// ReviewStats summarises the org-wide approval queue for the Reviews KPI strip.
type ReviewStats struct {
	Total             int     `json:"total"`
	Pending           int     `json:"pending"`
	Approved          int     `json:"approved"`
	Rejected          int     `json:"rejected"`          // includes changes_requested
	Overdue           int     `json:"overdue"`           // pending + urgency=overdue
	SLAComplianceRate float64 `json:"slaComplianceRate"` // % of decided reviews not overdue
	AvgDecisionHours  float64 `json:"avgDecisionHours"`  // -1 when no data yet
}

// CreateNamespaceRequest is the body for POST /namespaces. Owner defaults to
// the caller when empty.
type CreateNamespaceRequest struct {
	ID    string `json:"id" binding:"required,min=2,max=64"`
	Owner string `json:"owner"`
}

// SkillFile is one file inside a skill bundle. Used both in the list endpoint
// (where Content is empty to keep the payload small) and in the single-file
// endpoint (where Content is the full body).
type SkillFile struct {
	Path      string    `json:"path"`
	Content   string    `json:"content,omitempty"`
	Size      int       `json:"size"`
	UpdatedAt time.Time `json:"updatedAt"`
	UpdatedBy string    `json:"updatedBy"`
}

// TrendPoint is one row in the SkillDetail activation sparkline. The Day
// is "YYYY-MM-DD" so the client can plot it without TZ acrobatics.
type TrendPoint struct {
	Day         string `json:"day"`
	Activations int    `json:"activations"`
}

// AIProviderSummary groups AI-config counters shown in the admin overview.
// Total is the raw row count; Enabled only counts providers with enabled=1;
// WithKey counts providers that actually have an API key on file. We expose
// the three separately so the UI can flag "configured but no key" as a
// warning.
type AIProviderSummary struct {
	Total   int `json:"total"`
	Enabled int `json:"enabled"`
	WithKey int `json:"withKey"`
}

// PlatformMetrics is the aggregated snapshot that drives the admin overview
// dashboard. All counts are live — no materialised view — because the data
// set is tiny. SkillsByStatus and ReviewsByStatus map the enum values back
// to counts so the client can render a stacked bar without a second call.
type PlatformMetrics struct {
	Users             int               `json:"users"`
	Namespaces        int               `json:"namespaces"`
	TotalSkills       int               `json:"totalSkills"`
	SkillsByStatus    map[string]int    `json:"skillsByStatus"`
	TotalReviews      int               `json:"totalReviews"`
	ReviewsByStatus   map[string]int    `json:"reviewsByStatus"`
	AvgDecisionHours  float64           `json:"avgDecisionHours"`
	SlaComplianceRate float64           `json:"slaComplianceRate"`
	Overdue           int               `json:"overdue"`
	AIProviders       AIProviderSummary `json:"aiProviders"`
	Activations30d    int               `json:"activations30d"`
	ActivationsTrend  []TrendPoint      `json:"activationsTrend"`
	RecentAudit       []AuditLog        `json:"recentAudit"`
}

// ReviewFile is one file's snapshot inside a review request. BaseContent is
// the same path's body in the previous approved review (empty if this is a
// brand-new file or the skill has no prior approval). NewContent is what the
// author submitted *for this review*. ChangeKind is precomputed at submit
// time so the UI doesn't have to diff every file just to render a sidebar.
type ReviewFile struct {
	Path        string `json:"path"`
	BaseContent string `json:"baseContent"`
	NewContent  string `json:"newContent"`
	// ChangeKind ∈ "added" | "modified" | "deleted" | "unchanged".
	ChangeKind string `json:"changeKind"`
}

// PutFileRequest is the body for PUT /skills/:ns/:name/files/*path.
type PutFileRequest struct {
	Content string `json:"content"`
}

// RenameFileRequest is the body for POST /skills/:ns/:name/files/rename.
type RenameFileRequest struct {
	From string `json:"from" binding:"required"`
	To   string `json:"to"   binding:"required"`
}

// Achievement is one badge surfaced on the Profile page. Server-computed from
// existing data (stats, audit log, ownership) so we don't need a dedicated
// achievements table for the MVP.
type Achievement struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Desc     string  `json:"desc"`
	Icon     string  `json:"icon"`
	Earned   bool    `json:"earned"`
	Rare     bool    `json:"rare"`
	Progress float64 `json:"progress"` // 0..1
	Hint     string  `json:"hint,omitempty"`
}

// SearchResult is the bag returned by the global ⌘K search endpoint.
type SearchResult struct {
	Skills     []Skill         `json:"skills"`
	Namespaces []Namespace     `json:"namespaces"`
	Users      []SearchUserHit `json:"users"`
}

// SearchUserHit is the user shape exposed by /search. We deliberately do not
// expose email / bio here — the search box doesn't need them.
type SearchUserHit struct {
	Username string `json:"username"`
	Display  string `json:"display"`
	Role     string `json:"role"`
	Team     string `json:"team"`
}

type DecisionRequest struct {
	Decision string `json:"decision" binding:"required,oneof=approve reject request_changes"`
	Note     string `json:"note"`
}

type CommentRequest struct {
	Body string `json:"body" binding:"required,min=1,max=4000"`
	// Optional: anchor this comment to a file + line in the diff snapshot.
	// All three must be supplied together; otherwise the comment is general.
	FilePath string `json:"filePath"`
	LineNo   int    `json:"lineNo"`
	Side     string `json:"side"` // "base" or "head"
}

type CreateSkillRequest struct {
	Namespace      string   `json:"ns" binding:"required"`
	Name           string   `json:"name" binding:"required"`
	Description    string   `json:"desc"`
	Classification string   `json:"classification" binding:"required,oneof=L1 L2 L3"`
	Tags           []string `json:"tags"`
	// TemplateID seeds the new skill's bundle from a built-in template
	// (see internal/templates). Empty = the default SKILL.md / skill.yaml /
	// skill.yaml pair produced by SeedDefaultFiles.
	TemplateID string `json:"templateId"`
}

type SubmitReviewRequest struct {
	Version      string   `json:"version"`
	Note         string   `json:"note"`
	Reviewers    []string `json:"reviewers"`
	IsHotfix     bool     `json:"isHotfix"`
	HotfixReason string   `json:"hotfixReason"`
}

// SetDistTagRequest is the body of PUT /skills/:ns/:name/tags/:tag.
type SetDistTagRequest struct {
	Version string `json:"version" binding:"required"`
}

type Rating struct {
	Username  string    `json:"username"`
	Stars     int       `json:"stars"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"createdAt"`
}

type RatingSummary struct {
	Average float64 `json:"average"`
	Count   int     `json:"count"`
	Mine    int     `json:"mine"` // 0 if user hasn't rated
}

type RateRequest struct {
	Stars   int    `json:"stars" binding:"required,min=1,max=5"`
	Comment string `json:"comment" binding:"max=2000"`
}

type SkillVersion struct {
	ID        int64     `json:"id"`
	Namespace string    `json:"ns"`
	Name      string    `json:"name"`
	Version   string    `json:"version"`
	Status    string    `json:"status"`
	Author    string    `json:"author"`
	Note      string    `json:"note"`
	ReviewID  int64     `json:"reviewId"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// AIProvider is the admin-facing view of a configured LLM endpoint. The raw
// api_key is *never* serialised back; HasKey reports whether one is stored.
type AIProvider struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	BaseURL   string    `json:"baseUrl"`
	Model     string    `json:"model"`
	HasKey    bool      `json:"hasKey"`
	Enabled   bool      `json:"enabled"`
	IsDefault bool      `json:"isDefault"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// AIProviderRef is the trimmed form returned to non-admin users; just enough
// for the editor's "pick a model" dropdown.
type AIProviderRef struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Model     string `json:"model"`
	IsDefault bool   `json:"isDefault"`
}

type CreateAIProviderRequest struct {
	Name      string `json:"name"      binding:"required,max=80"`
	BaseURL   string `json:"baseUrl"   binding:"required,max=300"`
	Model     string `json:"model"     binding:"required,max=120"`
	APIKey    string `json:"apiKey"    binding:"required,max=400"`
	Enabled   bool   `json:"enabled"`
	IsDefault bool   `json:"isDefault"`
}

// UpdateAIProviderRequest uses pointers so callers can leave fields untouched.
// In particular, leaving APIKey nil preserves the existing encrypted key.
type UpdateAIProviderRequest struct {
	Name      *string `json:"name"      binding:"omitempty,max=80"`
	BaseURL   *string `json:"baseUrl"   binding:"omitempty,max=300"`
	Model     *string `json:"model"     binding:"omitempty,max=120"`
	APIKey    *string `json:"apiKey"    binding:"omitempty,max=400"`
	Enabled   *bool   `json:"enabled"`
	IsDefault *bool   `json:"isDefault"`
}

// AIAssistRequest is the editor -> server message that kicks off a streaming
// LLM call for documentation help.
type AIAssistRequest struct {
	ProviderID     int64          `json:"providerId"       binding:"required"`
	Action         string         `json:"action"`         // outline|expand|polish|examples|summary|translate|review|fix-validation|commit-summary|freeform
	Instruction    string         `json:"instruction"`    // user's free-form intent
	Selection      string         `json:"selection"`      // optional: only-this-region edits
	CurrentContent string         `json:"currentContent"` // full file body for context
	FilePath       string         `json:"filePath"`       // SKILL.md / skill.yaml / etc.
	History        []AIAssistTurn `json:"history"`        // optional: prior turns in a multi-turn chat
	// AdditionalFiles gives the LLM cross-file context. Each entry maps
	// path → content (truncated by the frontend to keep the prompt sane).
	AdditionalFiles map[string]string `json:"additionalFiles"`
	// ValidationErrors is populated by the frontend when the user triggers
	// the "fix-validation" action. Each string is one human-readable error
	// or warning line from the validation report.
	ValidationErrors []string `json:"validationErrors"`
}

// AIAssistTurn is one prior message kept around so the LLM can see what the
// user already asked / what it already answered. We deliberately accept only
// "user" and "assistant" roles from the client (system is owned by the server).
type AIAssistTurn struct {
	Role    string `json:"role"    binding:"required,oneof=user assistant"`
	Content string `json:"content" binding:"required"`
}

// APIToken is the client-visible representation of a PAT. The raw token value
// is only present in CreateAPITokenResponse (returned once at creation time).
type APIToken struct {
	ID        int64      `json:"id"`
	Name      string     `json:"name"`
	Username  string     `json:"username"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt *time.Time `json:"expiresAt"` // nil = never
	LastUsed  *time.Time `json:"lastUsed"`
}

type CreateAPITokenRequest struct {
	Name      string `json:"name" binding:"required,min=1,max=80"`
	ExpiresIn string `json:"expiresIn"` // "30d"|"90d"|"365d"|"" (never)
}

type CreateAPITokenResponse struct {
	Token    string   `json:"token"` // raw token, shown once
	APIToken APIToken `json:"apiToken"`
}

// Webhook is one registered HTTP callback endpoint.
type Webhook struct {
	ID        int64     `json:"id"`
	Namespace string    `json:"ns"` // "" = all namespaces
	URL       string    `json:"url"`
	HasSecret bool      `json:"hasSecret"`
	Events    []string  `json:"events"`
	Enabled   bool      `json:"enabled"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
}

type CreateWebhookRequest struct {
	Namespace string   `json:"ns"`
	URL       string   `json:"url"    binding:"required,min=8,max=500"`
	Secret    string   `json:"secret" binding:"max=256"`
	Events    []string `json:"events"`
	Enabled   *bool    `json:"enabled"`
}

type UpdateWebhookRequest struct {
	URL     *string  `json:"url"     binding:"omitempty,min=8,max=500"`
	Secret  *string  `json:"secret"  binding:"omitempty,max=256"`
	Events  []string `json:"events"`
	Enabled *bool    `json:"enabled"`
}

// WebhookDelivery is one delivery attempt recorded in webhook_deliveries.
type WebhookDelivery struct {
	ID          int64     `json:"id"`
	WebhookID   int64     `json:"webhookId"`
	Event       string    `json:"event"`
	StatusCode  int       `json:"statusCode"`
	Error       string    `json:"error,omitempty"`
	DurationMs  int       `json:"durationMs"`
	DeliveredAt time.Time `json:"deliveredAt"`
}

// WebhookPayload is the JSON body posted to each registered endpoint.
type WebhookPayload struct {
	ID        string           `json:"id"`    // unique delivery id
	Event     string           `json:"event"` // e.g. skill.published
	Timestamp time.Time        `json:"timestamp"`
	Data      WebhookSkillData `json:"data"`
}

type WebhookSkillData struct {
	Skill  WebhookSkill  `json:"skill"`
	Review WebhookReview `json:"review"`
}

type WebhookSkill struct {
	Namespace      string   `json:"ns"`
	Name           string   `json:"name"`
	Version        string   `json:"version"`
	Classification string   `json:"classification"`
	Description    string   `json:"description"`
	Tags           []string `json:"tags"`
	// DownloadURL is the bundle endpoint callers can use to pull the files.
	DownloadURL string `json:"downloadUrl"`
}

type WebhookReview struct {
	ID        int64     `json:"id"`
	DecidedBy string    `json:"decidedBy"`
	Decision  string    `json:"decision"`
	Note      string    `json:"note,omitempty"`
	DecidedAt time.Time `json:"decidedAt"`
}

// ChangePasswordRequest body for PATCH /me/password.
type ChangePasswordRequest struct {
	OldPassword string `json:"oldPassword" binding:"required"`
	NewPassword string `json:"newPassword" binding:"required,min=6"`
}

// AdminUser is the admin-facing view of a user row.
type AdminUser struct {
	Username   string    `json:"username"`
	Display    string    `json:"display"`
	Role       string    `json:"role"`
	Team       string    `json:"team"`
	Email      string    `json:"email"`
	IsAdmin    bool      `json:"isAdmin"`
	IsDisabled bool      `json:"isDisabled"`
	JoinedAt   time.Time `json:"joinedAt"`
}

// CreateUserRequest is the body for POST /admin/users.
type CreateUserRequest struct {
	Username string `json:"username" binding:"required,min=2,max=32"`
	Display  string `json:"display"`
	Password string `json:"password" binding:"required,min=6"`
	Role     string `json:"role"`
	Team     string `json:"team"`
	Email    string `json:"email"`
	IsAdmin  bool   `json:"isAdmin"`
}

// AdminUpdateUserRequest is the body for PATCH /admin/users/:username.
// All fields optional — only non-nil values are applied.
type AdminUpdateUserRequest struct {
	Display    *string `json:"display"`
	Role       *string `json:"role"`
	Team       *string `json:"team"`
	Email      *string `json:"email"`
	IsAdmin    *bool   `json:"isAdmin"`
	IsDisabled *bool   `json:"isDisabled"`
	Password   *string `json:"password"` // admin force-reset
}

// UpdateSkillMetaRequest is the body for PATCH /skills/:ns/:name.
// All fields optional — only non-nil values are applied.
// Version is intentionally rejected by the store; version changes must go
// through the draft review and publish lifecycle.
type UpdateSkillMetaRequest struct {
	Description    *string  `json:"desc"`
	LongDesc       *string  `json:"longDesc"`
	Icon           *string  `json:"icon"`
	IconClass      *string  `json:"iconClass"`
	Classification *string  `json:"classification"`
	Version        *string  `json:"version"`
	Tags           []string `json:"tags"` // nil = unchanged; [] = clear
}
