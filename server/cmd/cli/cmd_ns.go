package main

import (
	"fmt"

	"github.com/spf13/cobra"
)

func nsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "ns",
		Short: "Manage namespaces",
	}
	cmd.AddCommand(nsListCmd())
	cmd.AddCommand(nsMembersCmd())
	return cmd
}

// ── list ───────────────────────────────────────────────────────────────────

func nsListCmd() *cobra.Command {
	var jsonOut bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List namespaces",
		RunE: func(_ *cobra.Command, _ []string) error {
			cl, _ := mustClient()
			var namespaces []struct {
				ID    string `json:"id"`
				Owner string `json:"owner"`
				Count int    `json:"count"`
			}
			if err := cl.get("/namespaces", &namespaces); err != nil {
				return err
			}
			if jsonOut {
				return printJSON(namespaces)
			}
			if len(namespaces) == 0 {
				fmt.Println("No namespaces.")
				return nil
			}
			printTable(
				[]string{"Namespace", "Owner", "Skills"},
				func(row func(...string)) {
					for _, ns := range namespaces {
						row(ns.ID, ns.Owner, fmt.Sprint(ns.Count))
					}
				},
			)
			return nil
		},
	}
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output raw JSON")
	return cmd
}

// ── members ────────────────────────────────────────────────────────────────

func nsMembersCmd() *cobra.Command {
	var jsonOut bool
	cmd := &cobra.Command{
		Use:   "members <ns>",
		Short: "List members of a namespace",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			cl, _ := mustClient()
			var members []struct {
				Username string `json:"username"`
				Display  string `json:"display"`
				Role     string `json:"role"`
				Team     string `json:"team"`
			}
			if err := cl.get("/namespaces/"+args[0]+"/members", &members); err != nil {
				return err
			}
			if jsonOut {
				return printJSON(members)
			}
			if len(members) == 0 {
				fmt.Printf("No members in %s.\n", args[0])
				return nil
			}
			printTable(
				[]string{"Username", "Display", "Role", "Team"},
				func(row func(...string)) {
					for _, m := range members {
						row(m.Username, m.Display, m.Role, m.Team)
					}
				},
			)
			return nil
		},
	}
	cmd.Flags().BoolVar(&jsonOut, "json", false, "Output raw JSON")
	return cmd
}
