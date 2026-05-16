package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "skillhub",
	Short: "skillHub CLI — manage AI Skills from the terminal",
}

// mustClient loads config and returns a ready client, printing an error and
// exiting if config is missing or the token is empty.
func mustClient() (*Client, *Config) {
	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: cannot read config: %v\n", err)
		os.Exit(1)
	}
	if cfg.Token == "" {
		fmt.Fprintln(os.Stderr, "error: not logged in — run `skillhub auth login` first")
		os.Exit(1)
	}
	return newClient(cfg), cfg
}

func main() {
	rootCmd.AddCommand(authCmd())
	rootCmd.AddCommand(skillCmd())
	rootCmd.AddCommand(reviewCmd())
	rootCmd.AddCommand(nsCmd())

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}
