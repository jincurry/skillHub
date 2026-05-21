package store

// ThreeWayMergeText performs a line-based three-way merge of text content.
// Deferred to P4; currently all text file conflicts are surfaced as 409 so
// the client can resolve manually.
func ThreeWayMergeText(ancestor, ours, theirs string) (merged string, clean bool) {
	_ = ancestor
	_ = ours
	_ = theirs
	return "", false
}
