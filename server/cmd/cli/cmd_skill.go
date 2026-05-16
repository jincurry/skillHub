package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

func skillCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "skill",
		Short: "Manage skills",
	}
	cmd.AddCommand(skillListCmd())
	cmd.AddCommand(skillGetCmd())
	cmd.AddCommand(skillPullCmd())
	cmd.AddCommand(skillPushCmd())
	cmd.AddCommand(skillValidateCmd())
	cmd.AddCommand(skillSubmitCmd())
	cmd.AddCommand(skillActivateCmd())
	return cmd
}

// ── list ───────────────────────────────────────────────────────────────────

func skillListCmd() *cobra.Command {
	var ns, status, q string
	var jsonOut bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List skills",
		RunE: func(_ *cobra.Command, _ []string) error {
			cl, _ := mustClient()
			query := url.Values{}
			if ns != "" {
				query.Set("ns", ns)
			}
			if status != "" {
				query.Set("status", status)
			}
			if q != "" {
				query.Set("q", q)
			}
			var skills []struct {
				Namespace string   `json:"ns"`
				Name      string   `json:"name"`
				Version   string   `json:"version"`
				Status    string   `json:"status"`
				Class     string   `json:"classification"`
				Hot       bool     `json:"hot"`
				Tags      []string `json:"tags"`
			}
			if err := cl.getQ("/skills", query, &skills); err != nil {
				return err
			}
			if jsonOut {
				return printJSON(skills)
			}
			if len(skills) == 0 {
				fmt.Println("No skills found.")
				return nil
			}
			printTable(
				[]string{"Namespace/Name", "Version", "Status", "Class", "Hot"},
				func(row func(...string)) {
					for _, s := range skills {
						hot := ""
						if s.Hot {
							hot = "🔥"
						}
						row(s.Namespace+"/"+s.Name, s.Version, s.Status, s.Class, hot)
					}
				},
			)
			return nil
		},
	}
	cmd.Flags().StringVar(&ns, "ns", "", "Filter by namespace")
	cmd.Flags().StringVar(&status, "status", "", "Filter by status (draft|published|…)")
	cmd.Flags().StringVarP(&q, "query", "q", "", "Search query")
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output raw JSON")
	return cmd
}

// ── get ────────────────────────────────────────────────────────────────────

func skillGetCmd() *cobra.Command {
	var jsonOut bool
	cmd := &cobra.Command{
		Use:   "get <ns/name>",
		Short: "Show skill details",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, name, err := splitRef(args[0])
			if err != nil {
				return err
			}
			cl, _ := mustClient()
			var skill struct {
				Namespace      string   `json:"ns"`
				Name           string   `json:"name"`
				Description    string   `json:"desc"`
				Version        string   `json:"version"`
				Status         string   `json:"status"`
				Classification string   `json:"classification"`
				Author         string   `json:"author"`
				Rating         float64  `json:"rating"`
				Activations    int      `json:"activations"`
				DeltaPct       int      `json:"delta"`
				Hot            bool     `json:"hot"`
				Tags           []string `json:"tags"`
			}
			if err := cl.get("/skills/"+ns+"/"+name, &skill); err != nil {
				return err
			}
			if jsonOut {
				return printJSON(skill)
			}
			fmt.Printf("%-16s %s/%s\n", "Skill:", skill.Namespace, skill.Name)
			fmt.Printf("%-16s %s\n", "Version:", skill.Version)
			fmt.Printf("%-16s %s\n", "Status:", skill.Status)
			fmt.Printf("%-16s %s\n", "Class:", skill.Classification)
			fmt.Printf("%-16s %s\n", "Author:", skill.Author)
			fmt.Printf("%-16s %.1f (%d)\n", "Rating:", skill.Rating, 0)
			fmt.Printf("%-16s %d (Δ%d%%)\n", "Activations:", skill.Activations, skill.DeltaPct)
			if skill.Hot {
				fmt.Printf("%-16s 🔥 trending\n", "Hot:")
			}
			if len(skill.Tags) > 0 {
				fmt.Printf("%-16s %s\n", "Tags:", strings.Join(skill.Tags, ", "))
			}
			fmt.Printf("%-16s %s\n", "Description:", skill.Description)
			return nil
		},
	}
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output raw JSON")
	return cmd
}

// ── pull ───────────────────────────────────────────────────────────────────

func skillPullCmd() *cobra.Command {
	var dir string
	cmd := &cobra.Command{
		Use:   "pull <ns/name>",
		Short: "Download skill files to a local directory",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, name, err := splitRef(args[0])
			if err != nil {
				return err
			}
			cl, _ := mustClient()

			var files []struct {
				Path string `json:"path"`
				Size int    `json:"size"`
			}
			if err := cl.get("/skills/"+ns+"/"+name+"/files", &files); err != nil {
				return err
			}

			target := dir
			if target == "" {
				target = name
			}
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}

			for _, f := range files {
				var content struct {
					Content string `json:"content"`
				}
				if err := cl.get("/skills/"+ns+"/"+name+"/files/"+f.Path, &content); err != nil {
					fmt.Fprintf(os.Stderr, "warn: skip %s: %v\n", f.Path, err)
					continue
				}
				dest := filepath.Join(target, filepath.FromSlash(f.Path))
				if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
					return err
				}
				if err := os.WriteFile(dest, []byte(content.Content), 0644); err != nil {
					return err
				}
				fmt.Printf("  wrote %s\n", dest)
			}
			fmt.Printf("Pulled %d file(s) to %s/\n", len(files), target)
			return nil
		},
	}
	cmd.Flags().StringVar(&dir, "dir", "", "Target directory (default: skill name)")
	return cmd
}

// ── push ───────────────────────────────────────────────────────────────────

func skillPushCmd() *cobra.Command {
	var dir string
	cmd := &cobra.Command{
		Use:   "push <ns/name>",
		Short: "Upload local files to the skill on the server",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, name, err := splitRef(args[0])
			if err != nil {
				return err
			}
			cl, _ := mustClient()

			src := dir
			if src == "" {
				src = name
			}
			info, err := os.Stat(src)
			if err != nil || !info.IsDir() {
				return fmt.Errorf("directory %q not found", src)
			}

			var pushed int
			err = filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
				if err != nil || info.IsDir() {
					return err
				}
				rel, _ := filepath.Rel(src, path)
				rel = filepath.ToSlash(rel)

				data, err := os.ReadFile(path)
				if err != nil {
					return err
				}
				if err := cl.put("/skills/"+ns+"/"+name+"/files/"+rel,
					map[string]string{"content": string(data)}, nil); err != nil {
					fmt.Fprintf(os.Stderr, "warn: skip %s: %v\n", rel, err)
					return nil
				}
				fmt.Printf("  pushed %s\n", rel)
				pushed++
				return nil
			})
			if err != nil {
				return err
			}
			fmt.Printf("Pushed %d file(s) to %s/%s\n", pushed, ns, name)
			return nil
		},
	}
	cmd.Flags().StringVar(&dir, "dir", "", "Source directory (default: skill name)")
	return cmd
}

// ── validate ───────────────────────────────────────────────────────────────

func skillValidateCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "validate <ns/name>",
		Short: "Run the 6-check validation suite",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, name, err := splitRef(args[0])
			if err != nil {
				return err
			}
			cl, _ := mustClient()
			var result struct {
				Checks []struct {
					Name    string `json:"name"`
					Severity string `json:"severity"`
					Message string `json:"message"`
				} `json:"checks"`
				Valid bool `json:"valid"`
			}
			if err := cl.get("/skills/"+ns+"/"+name+"/validate", &result); err != nil {
				return err
			}

			for _, ch := range result.Checks {
				icon := "✓"
				switch ch.Severity {
				case "err":
					icon = "✗"
				case "warn":
					icon = "⚠"
				}
				fmt.Printf("  %s [%s] %s\n", icon, ch.Name, ch.Message)
			}
			fmt.Println()
			if result.Valid {
				fmt.Println("Validation passed.")
			} else {
				fmt.Fprintln(os.Stderr, "Validation failed — fix errors before submitting.")
				os.Exit(1)
			}
			return nil
		},
	}
}

// ── submit ─────────────────────────────────────────────────────────────────

func skillSubmitCmd() *cobra.Command {
	var version, note string
	var hotfix bool
	var hotfixReason string
	cmd := &cobra.Command{
		Use:   "submit <ns/name>",
		Short: "Submit a draft for review",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, name, err := splitRef(args[0])
			if err != nil {
				return err
			}
			if version == "" {
				return fmt.Errorf("--version is required")
			}
			cl, _ := mustClient()
			body := map[string]any{"version": version}
			if note != "" {
				body["note"] = note
			}
			if hotfix {
				body["isHotfix"] = true
				body["hotfixReason"] = hotfixReason
			}
			var result struct {
				ReviewID int64  `json:"reviewId"`
				Status   string `json:"status"`
			}
			if err := cl.post("/skills/"+ns+"/"+name+"/submit", body, &result); err != nil {
				return err
			}
			fmt.Printf("Submitted for review (ID: %d, status: %s)\n", result.ReviewID, result.Status)
			return nil
		},
	}
	cmd.Flags().StringVarP(&version, "version", "v", "", "Version string (required)")
	cmd.Flags().StringVarP(&note, "note", "n", "", "Submission note")
	cmd.Flags().BoolVar(&hotfix, "hotfix", false, "Use the hotfix channel (1 reviewer, 4h SLA)")
	cmd.Flags().StringVar(&hotfixReason, "hotfix-reason", "", "Reason for hotfix (required with --hotfix)")
	return cmd
}

// ── activate ───────────────────────────────────────────────────────────────

func skillActivateCmd() *cobra.Command {
	var count int
	cmd := &cobra.Command{
		Use:   "activate <ns/name>",
		Short: "Record skill activation(s)",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			ns, name, err := splitRef(args[0])
			if err != nil {
				return err
			}
			if count < 1 {
				count = 1
			}
			cl, _ := mustClient()
			var result struct {
				Activations int `json:"activations"`
			}
			if err := cl.post("/skills/"+ns+"/"+name+"/activate",
				map[string]int{"count": count}, &result); err != nil {
				return err
			}
			fmt.Printf("Recorded %d activation(s). Total: %d\n", count, result.Activations)
			return nil
		},
	}
	cmd.Flags().IntVarP(&count, "count", "c", 1, "Number of activations to record (max 1000)")
	return cmd
}

// ── helpers ────────────────────────────────────────────────────────────────

func splitRef(ref string) (ns, name string, err error) {
	parts := strings.SplitN(ref, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("invalid skill reference %q — expected <ns>/<name>", ref)
	}
	return parts[0], parts[1], nil
}
