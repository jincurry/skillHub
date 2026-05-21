package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"io"
	"strings"
)

// maxMergeLines caps the per-file line count for text merge. Files larger
// than this fall back to "conflict" rather than allocating a huge DP table.
const maxMergeLines = 1000

// ThreeWayMergeText performs a line-based 3-way merge of text content.
// Returns (merged, true) on clean merge, ("", false) on conflict.
// A clean merge means no region was changed by both sides in incompatible ways.
func ThreeWayMergeText(ancestor, ours, theirs string) (merged string, clean bool) {
	// Fast paths.
	if ancestor == ours {
		return theirs, true
	}
	if ancestor == theirs {
		return ours, true
	}
	if ours == theirs {
		return ours, true
	}

	a := splitLines(ancestor)
	o := splitLines(ours)
	t := splitLines(theirs)

	if len(a) > maxMergeLines || len(o) > maxMergeLines || len(t) > maxMergeLines {
		return "", false
	}

	ohunks := diffHunks(a, o)
	thunks := diffHunks(a, t)

	var out []string
	conflict := false
	aPos := 0
	oi, ti := 0, 0

	for oi < len(ohunks) || ti < len(thunks) {
		// Advance aPos to the start of the next event.
		oNext := len(a)
		if oi < len(ohunks) {
			oNext = ohunks[oi].aLo
		}
		tNext := len(a)
		if ti < len(thunks) {
			tNext = thunks[ti].aLo
		}
		nextEvent := oNext
		if tNext < nextEvent {
			nextEvent = tNext
		}
		if nextEvent > aPos {
			out = append(out, a[aPos:nextEvent]...)
			aPos = nextEvent
		}

		if oi >= len(ohunks) && ti >= len(thunks) {
			break
		}

		// Collect all overlapping hunks from both streams into one group.
		// Two hunks overlap if either starts strictly before the other ends.
		// The threshold starts at aPos+1 so we always grab the hunk at aPos.
		groupAHi := aPos
		threshold := aPos + 1
		var oGroup, tGroup []hunk
		for {
			grabbed := false
			if oi < len(ohunks) && ohunks[oi].aLo < threshold {
				h := ohunks[oi]
				oGroup = append(oGroup, h)
				if h.aHi > groupAHi {
					groupAHi = h.aHi
					threshold = groupAHi
				}
				oi++
				grabbed = true
			}
			if ti < len(thunks) && thunks[ti].aLo < threshold {
				h := thunks[ti]
				tGroup = append(tGroup, h)
				if h.aHi > groupAHi {
					groupAHi = h.aHi
					threshold = groupAHi
				}
				ti++
				grabbed = true
			}
			if !grabbed {
				break
			}
		}

		if len(oGroup) == 0 && len(tGroup) == 0 {
			break
		}

		oResult := applyHunks(a, aPos, groupAHi, o, oGroup)
		tResult := applyHunks(a, aPos, groupAHi, t, tGroup)

		switch {
		case slicesEqual(oResult, tResult):
			out = append(out, oResult...)
		case len(oGroup) == 0:
			out = append(out, tResult...)
		case len(tGroup) == 0:
			out = append(out, oResult...)
		default:
			conflict = true
			out = append(out, oResult...)
		}

		aPos = groupAHi
	}

	out = append(out, a[aPos:]...)

	if conflict {
		return "", false
	}
	return strings.Join(out, ""), true
}

// hunk describes a region [aLo, aHi) in ancestor replaced by b[bLo:bHi].
type hunk struct{ aLo, aHi, bLo, bHi int }

// diffHunks computes the non-matching regions between a and b using LCS.
func diffHunks(a, b []string) []hunk {
	matches := lcsMatches(a, b)
	var hunks []hunk
	prevA, prevB := 0, 0
	for _, m := range matches {
		ai, bi := m[0], m[1]
		if ai > prevA || bi > prevB {
			hunks = append(hunks, hunk{prevA, ai, prevB, bi})
		}
		prevA = ai + 1
		prevB = bi + 1
	}
	if prevA < len(a) || prevB < len(b) {
		hunks = append(hunks, hunk{prevA, len(a), prevB, len(b)})
	}
	return hunks
}

// applyHunks reconstructs what b says about a[aLo:aHi] given the hunk list.
func applyHunks(a []string, aLo, aHi int, b []string, hunks []hunk) []string {
	var out []string
	p := aLo
	for _, h := range hunks {
		if h.aLo > p {
			out = append(out, a[p:h.aLo]...)
		}
		out = append(out, b[h.bLo:h.bHi]...)
		p = h.aHi
	}
	if p < aHi {
		out = append(out, a[p:aHi]...)
	}
	return out
}

// lcsMatches returns matched (a-index, b-index) pairs forming the LCS.
func lcsMatches(a, b []string) [][2]int {
	m, n := len(a), len(b)
	if m == 0 || n == 0 {
		return nil
	}
	// dp[i][j] = length of LCS for a[i:] and b[j:].
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}
	for i := m - 1; i >= 0; i-- {
		for j := n - 1; j >= 0; j-- {
			if a[i] == b[j] {
				dp[i][j] = dp[i+1][j+1] + 1
			} else if dp[i+1][j] >= dp[i][j+1] {
				dp[i][j] = dp[i+1][j]
			} else {
				dp[i][j] = dp[i][j+1]
			}
		}
	}
	var matches [][2]int
	i, j := 0, 0
	for i < m && j < n {
		if a[i] == b[j] {
			matches = append(matches, [2]int{i, j})
			i++
			j++
		} else if dp[i+1][j] >= dp[i][j+1] {
			i++
		} else {
			j++
		}
	}
	return matches
}

// splitLines splits s into lines, each including its trailing newline.
// A trailing non-empty fragment with no newline is kept as-is.
func splitLines(s string) []string {
	if s == "" {
		return nil
	}
	var lines []string
	for len(s) > 0 {
		idx := strings.IndexByte(s, '\n')
		if idx == -1 {
			lines = append(lines, s)
			break
		}
		lines = append(lines, s[:idx+1])
		s = s[idx+1:]
	}
	return lines
}

func slicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// tryTextMerge attempts a line-level 3-way merge for a text file by reading
// blob content, running ThreeWayMergeText, and storing the result as a new blob.
// Returns (mergedFile, note, true) on success, (nil, "", false) on conflict or I/O error.
func tryTextMerge(ctx context.Context, tx *sql.Tx, blobs blobReadWriter, path, ancestorSHA, oursSHA, theirsSHA string, executable bool) (*PushFile, string, bool) {
	ancestor := readBlobText(ctx, blobs, ancestorSHA)
	ours := readBlobText(ctx, blobs, oursSHA)
	theirs := readBlobText(ctx, blobs, theirsSHA)
	if ancestor == nil || ours == nil || theirs == nil {
		return nil, "", false
	}

	mergedText, ok := ThreeWayMergeText(*ancestor, *ours, *theirs)
	if !ok {
		return nil, "", false
	}

	data := []byte(mergedText)
	sum := blobSHA256(data)
	size := int64(len(data))

	// Write merged content to blobstore (idempotent — same hash = no-op).
	if err := blobs.Put(ctx, sum, strings.NewReader(mergedText), size); err != nil {
		return nil, "", false
	}
	// Register in blob_objects within the open transaction. Uses INSERT OR IGNORE
	// so we don't clobber an existing row (e.g. if two merges produce identical output).
	tx.Exec(
		`INSERT OR IGNORE INTO blob_objects(sha256, size, is_chunked, ref_count) VALUES(?, ?, 0, 1)`,
		sum, size,
	)

	return &PushFile{
		Path:       path,
		SHA256:     sum,
		Size:       size,
		Executable: executable,
	}, "auto-merged " + path, true
}

// readBlobText reads blob content as a string.
// Returns nil on I/O error or if sha256 is empty.
func readBlobText(ctx context.Context, blobs blobReadWriter, sha256Hex string) *string {
	if sha256Hex == "" {
		return nil
	}
	rc, _, err := blobs.Get(ctx, sha256Hex)
	if err != nil {
		return nil
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		return nil
	}
	s := string(data)
	return &s
}

// blobSHA256 returns the hex-encoded SHA-256 of data.
func blobSHA256(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}
