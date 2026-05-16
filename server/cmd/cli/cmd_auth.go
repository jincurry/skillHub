package main

import (
	"fmt"
	"syscall"

	"github.com/spf13/cobra"
	"golang.org/x/term"
)

func authCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Authentication — login, logout, tokens, whoami",
	}
	cmd.AddCommand(authLoginCmd())
	cmd.AddCommand(authLogoutCmd())
	cmd.AddCommand(authWhoamiCmd())
	cmd.AddCommand(authTokenCmd())
	return cmd
}

// ── login ──────────────────────────────────────────────────────────────────

func authLoginCmd() *cobra.Command {
	var server, username string
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Log in and store credentials",
		RunE: func(cmd *cobra.Command, _ []string) error {
			cfg, _ := loadConfig()
			if server != "" {
				cfg.Server = server
			}
			if cfg.Server == "" {
				cfg.Server = "http://localhost:8080"
			}

			if username == "" {
				fmt.Print("Username: ")
				fmt.Scan(&username)
			}
			fmt.Print("Password: ")
			pwBytes, err := term.ReadPassword(int(syscall.Stdin))
			fmt.Println()
			if err != nil {
				return fmt.Errorf("reading password: %w", err)
			}

			cl := newClient(cfg)
			var result struct {
				Token string `json:"token"`
				User  struct {
					Username string `json:"username"`
					Display  string `json:"display"`
				} `json:"user"`
			}
			if err := cl.post("/auth/login", map[string]string{
				"username": username,
				"password": string(pwBytes),
			}, &result); err != nil {
				return err
			}

			cfg.Token = result.Token
			if err := saveConfig(cfg); err != nil {
				return fmt.Errorf("saving config: %w", err)
			}
			fmt.Printf("Logged in as %s (%s)\n", result.User.Username, cfg.Server)
			fmt.Println("Tip: create a PAT for non-interactive use: skillhub auth token create <name>")
			return nil
		},
	}
	cmd.Flags().StringVar(&server, "server", "", "API server URL (e.g. https://hub.example.com)")
	cmd.Flags().StringVarP(&username, "username", "u", "", "Username")
	return cmd
}

// ── logout ─────────────────────────────────────────────────────────────────

func authLogoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Clear stored credentials",
		RunE: func(_ *cobra.Command, _ []string) error {
			cfg, err := loadConfig()
			if err != nil {
				return err
			}
			cfg.Token = ""
			if err := saveConfig(cfg); err != nil {
				return err
			}
			fmt.Println("Logged out.")
			return nil
		},
	}
}

// ── whoami ─────────────────────────────────────────────────────────────────

func authWhoamiCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "whoami",
		Short: "Show the current authenticated user",
		RunE: func(_ *cobra.Command, _ []string) error {
			cl, cfg := mustClient()
			var me struct {
				Username string `json:"username"`
				Display  string `json:"display"`
				Email    string `json:"email"`
				Role     string `json:"role"`
				Team     string `json:"team"`
				IsAdmin  bool   `json:"isAdmin"`
			}
			if err := cl.get("/me", &me); err != nil {
				return err
			}
			fmt.Printf("Username : %s\n", me.Username)
			fmt.Printf("Display  : %s\n", me.Display)
			fmt.Printf("Email    : %s\n", me.Email)
			fmt.Printf("Role     : %s\n", me.Role)
			if me.Team != "" {
				fmt.Printf("Team     : %s\n", me.Team)
			}
			if me.IsAdmin {
				fmt.Printf("Admin    : yes\n")
			}
			fmt.Printf("Server   : %s\n", cfg.Server)
			return nil
		},
	}
}

// ── token ──────────────────────────────────────────────────────────────────

func authTokenCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "token",
		Short: "Manage personal access tokens (PAT)",
	}
	cmd.AddCommand(authTokenCreateCmd())
	cmd.AddCommand(authTokenListCmd())
	cmd.AddCommand(authTokenDeleteCmd())
	return cmd
}

func authTokenCreateCmd() *cobra.Command {
	var days int
	var write bool
	cmd := &cobra.Command{
		Use:   "create <name>",
		Short: "Create a new PAT",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			cl, _ := mustClient()
			body := map[string]any{"name": args[0]}
			if days > 0 {
				body["expiresInDays"] = days
			}
			var result struct {
				Token     string `json:"token"`
				Name      string `json:"name"`
				ExpiresAt string `json:"expiresAt"`
			}
			if err := cl.post("/me/tokens", body, &result); err != nil {
				return err
			}
			fmt.Printf("Token : %s\n", result.Token)
			fmt.Printf("Name  : %s\n", result.Name)
			if result.ExpiresAt != "" {
				fmt.Printf("Expires: %s\n", result.ExpiresAt)
			}
			if write {
				cfg, _ := loadConfig()
				cfg.Token = result.Token
				if err := saveConfig(cfg); err != nil {
					return fmt.Errorf("saving config: %w", err)
				}
				fmt.Println("Config updated to use new token.")
			} else {
				fmt.Println("\nCopy this token — it will not be shown again.")
				fmt.Println("Use --save to write it to your config automatically.")
			}
			return nil
		},
	}
	cmd.Flags().IntVar(&days, "days", 0, "Expiry in days (0 = never)")
	cmd.Flags().BoolVar(&write, "save", false, "Write the new token to config")
	return cmd
}

func authTokenListCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "list",
		Short: "List personal access tokens",
		RunE: func(_ *cobra.Command, _ []string) error {
			cl, _ := mustClient()
			var tokens []struct {
				ID        int64  `json:"id"`
				Name      string `json:"name"`
				Prefix    string `json:"prefix"`
				ExpiresAt string `json:"expiresAt"`
				CreatedAt string `json:"createdAt"`
			}
			if err := cl.get("/me/tokens", &tokens); err != nil {
				return err
			}
			if len(tokens) == 0 {
				fmt.Println("No tokens.")
				return nil
			}
			printTable(
				[]string{"ID", "Name", "Prefix", "Expires", "Created"},
				func(row func(...string)) {
					for _, t := range tokens {
						exp := t.ExpiresAt
						if exp == "" {
							exp = "never"
						}
						row(fmt.Sprint(t.ID), t.Name, t.Prefix, exp, t.CreatedAt)
					}
				},
			)
			return nil
		},
	}
}

func authTokenDeleteCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "delete <id>",
		Short: "Delete a PAT by ID",
		Args:  cobra.ExactArgs(1),
		RunE: func(_ *cobra.Command, args []string) error {
			cl, _ := mustClient()
			if err := cl.delete("/me/tokens/" + args[0]); err != nil {
				return err
			}
			fmt.Printf("Token %s deleted.\n", args[0])
			return nil
		},
	}
}

