package model

import "time"

type Skill struct {
	ID             int64     `json:"id"`
	Namespace      string    `json:"ns"`
	Name           string    `json:"name"`
	Description    string    `json:"desc"`
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
	ID        int64     `json:"id"`
	Kind      string    `json:"kind"` // review|comment|publish|warn
	Body      string    `json:"body"`
	Unread    bool      `json:"unread"`
	CreatedAt time.Time `json:"createdAt"`
}

type Me struct {
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
