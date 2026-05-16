package main

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/spf13/cobra"
)

func reviewCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "review",
		Short: "Manage reviews",
	}
	cmd.AddCommand(reviewListCmd())
	cmd.AddCommand(reviewShowCmd())
	cmd.AddCommand(reviewApproveCmd())
	cmd.AddCommand(reviewRejectCmd())
	return cmd
}

// ── list ───────────────────────────────────────────────────────────────────

func reviewListCmd() *cobra.Command {
	var status string
	var jsonOut bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List reviews",
		RunE: func(_ *cobra.Command, _ []string) error {
			cl, _ := mustClient()
			var reviews []struct {
				ID       int64    `json:"id"`
				NS       string   `json:"ns"`
				Name     string   `json:"name"`
				Version  string   `json:"version"`
				Status   string   `json:"status"`
				Author   string   `json:"author"`
				Urgency  string   `json:"urgency"`
				SLA      string   `json:"sla"`
				IsHotfix bool     `json:"isHotfix"`
				Reviewers []string `json:"reviewers"`
			}
			path := "/reviews"
			if status != "" {
				path += "?status=" + status
			}
			if err := cl.get(path, &reviews); err != nil {
				return err
			}
			if jsonOut {
				return printJSON(reviews)
			}
			if len(reviews) == 0 {
				fmt.Println("No reviews found.")
				return nil
			}
			printTable(
				[]string{"ID", "Skill", "Version", "Status", "Author", "Urgency", "SLA"},
				func(row func(...string)) {
					for _, r := range reviews {
						urgency := r.Urgency
						if r.IsHotfix {
							urgency = "hotfix"
						}
						row(
							strconv.FormatInt(r.ID, 10),
							r.NS+"/"+r.Name,
							r.Version,
							r.Status,
							r.Author,
							urgency,
							r.SLA,
						)
					}
				},
			)
			return nil
		},
	}
	cmd.Flags().StringVar(&status, "status", "", "Filter: pending|approved|rejected")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output raw JSON")
	return cmd
}

// ── show ───────────────────────────────────────────────────────────────────

func reviewShowCmd() *cobra.Command {
	var jsonOut bool
	cmd := &cobra.Command{
		Use:   "show <id>",
		Short: "Show review details and comments",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			cl, _ := mustClient()
			var review struct {
				ID           int64    `json:"id"`
				NS           string   `json:"ns"`
				Name         string   `json:"name"`
				Version      string   `json:"version"`
				Status       string   `json:"status"`
				Author       string   `json:"author"`
				Reviewers    []string `json:"reviewers"`
				Urgency      string   `json:"urgency"`
				SLA          string   `json:"sla"`
				Note         string   `json:"note"`
				IsHotfix     bool     `json:"isHotfix"`
				HotfixReason string   `json:"hotfixReason"`
				SubmittedAt  string   `json:"submittedAt"`
			}
			if err := cl.get("/reviews/"+args[0], &review); err != nil {
				return err
			}
			if jsonOut {
				return printJSON(review)
			}

			fmt.Printf("Review #%d\n", review.ID)
			fmt.Printf("  Skill     : %s/%s @ %s\n", review.NS, review.Name, review.Version)
			fmt.Printf("  Status    : %s\n", review.Status)
			fmt.Printf("  Author    : %s\n", review.Author)
			fmt.Printf("  Reviewers : %s\n", strings.Join(review.Reviewers, ", "))
			fmt.Printf("  Urgency   : %s  SLA: %s\n", review.Urgency, review.SLA)
			if review.IsHotfix {
				fmt.Printf("  Hotfix    : %s\n", review.HotfixReason)
			}
			if review.Note != "" {
				fmt.Printf("  Note      : %s\n", review.Note)
			}
			fmt.Printf("  Submitted : %s\n", review.SubmittedAt)

			// comments
			var comments []struct {
				ID        int64  `json:"id"`
				Author    string `json:"author"`
				Body      string `json:"body"`
				CreatedAt string `json:"createdAt"`
			}
			if err := cl.get("/reviews/"+args[0]+"/comments", &comments); err == nil && len(comments) > 0 {
				fmt.Printf("\nComments (%d):\n", len(comments))
				for _, c := range comments {
					fmt.Printf("  [%s] @%s: %s\n", c.CreatedAt[:10], c.Author, c.Body)
				}
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output raw JSON")
	return cmd
}

// ── approve / reject ───────────────────────────────────────────────────────

func reviewApproveCmd() *cobra.Command {
	var note string
	cmd := &cobra.Command{
		Use:   "approve <id>",
		Short: "Approve a review",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return reviewDecide(args[0], "approve", note)
		},
	}
	cmd.Flags().StringVarP(&note, "note", "n", "", "Optional approval note")
	return cmd
}

func reviewRejectCmd() *cobra.Command {
	var note string
	cmd := &cobra.Command{
		Use:   "reject <id>",
		Short: "Reject a review",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			return reviewDecide(args[0], "reject", note)
		},
	}
	cmd.Flags().StringVarP(&note, "note", "n", "", "Rejection reason")
	return cmd
}

func reviewDecide(id, decision, note string) error {
	cl, _ := mustClient()
	body := map[string]string{"decision": decision}
	if note != "" {
		body["note"] = note
	}
	var result struct {
		Status string `json:"status"`
	}
	if err := cl.post("/reviews/"+id+"/decision", body, &result); err != nil {
		return err
	}
	fmt.Printf("Review #%s %sd. New status: %s\n", id, decision, result.Status)
	return nil
}
