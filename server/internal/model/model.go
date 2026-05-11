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
}

type Comment struct {
	ID        int64     `json:"id"`
	ReviewID  int64     `json:"reviewId"`
	Author    string    `json:"author"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
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
	Rejected          int     `json:"rejected"`           // includes changes_requested
	Overdue           int     `json:"overdue"`            // pending + urgency=overdue
	SLAComplianceRate float64 `json:"slaComplianceRate"`  // % of decided reviews not overdue
	AvgDecisionHours  float64 `json:"avgDecisionHours"`   // -1 when no data yet
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
	Skills     []Skill          `json:"skills"`
	Namespaces []Namespace      `json:"namespaces"`
	Users      []SearchUserHit  `json:"users"`
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
}

type CreateSkillRequest struct {
	Namespace      string   `json:"ns" binding:"required"`
	Name           string   `json:"name" binding:"required"`
	Description    string   `json:"desc"`
	Classification string   `json:"classification" binding:"required,oneof=L1 L2 L3"`
	Tags           []string `json:"tags"`
}

type SubmitReviewRequest struct {
	Version   string   `json:"version"`
	Note      string   `json:"note"`
	Reviewers []string `json:"reviewers"`
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
	ProviderID     int64           `json:"providerId"     binding:"required"`
	Action         string          `json:"action"`         // outline|expand|polish|examples|summary|translate|review|freeform
	Instruction    string          `json:"instruction"`    // user's free-form intent
	Selection      string          `json:"selection"`      // optional: only-this-region edits
	CurrentContent string          `json:"currentContent"` // full file body for context
	FilePath       string          `json:"filePath"`       // SKILL.md / README.md
	History        []AIAssistTurn  `json:"history"`        // optional: prior turns in a multi-turn chat
}

// AIAssistTurn is one prior message kept around so the LLM can see what the
// user already asked / what it already answered. We deliberately accept only
// "user" and "assistant" roles from the client (system is owned by the server).
type AIAssistTurn struct {
	Role    string `json:"role"    binding:"required,oneof=user assistant"`
	Content string `json:"content" binding:"required"`
}
