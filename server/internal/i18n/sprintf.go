package i18n

import "fmt"

// sprintf is a thin wrapper around fmt.Sprintf so the public T() function
// can call into it without exposing fmt to every translation site. Kept in
// its own file for testability.
func sprintf(format string, args ...any) string {
	return fmt.Sprintf(format, args...)
}
