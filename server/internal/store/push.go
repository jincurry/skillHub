package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// PushFile is one file entry in a push request tree manifest.
type PushFile struct {
	Path       string `json:"path"`
	SHA256     string `json:"sha256"`
	Size       int64  `json:"size"`
	Executable bool   `json:"executable,omitempty"`
	Deleted    bool   `json:"deleted,omitempty"`
}

// PushSkillParams contains all inputs for PushSkillTree.
type PushSkillParams struct {
	NS       string
	Name     string
	PushedBy string
	// BaseTreeHash is nil when creating a new skill; non-nil for updates.
	BaseTreeHash *string
	Files        []PushFile
	Message      string
	// Used only when creating a new skill (BaseTreeHash == nil).
	Description    string
	Classification string
	Tags           string
}

// PushResult is returned on a successful push.
type PushResult struct {
	TreeHash     string
	Merged       bool
	MergeSummary []string
}

// ConflictDetail describes a single unresolvable file conflict.
type ConflictDetail struct {
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// ConflictError is returned when push conflicts cannot be auto-resolved.
// The caller should surface Conflicts to the client so the user can pull
// and resolve before retrying.
type ConflictError struct {
	Conflicts []ConflictDetail
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("push conflict in %d file(s)", len(e.Conflicts))
}

var (
	ErrSkillAlreadyExists = errors.New("skill already exists")
	ErrSkillNotFound      = errors.New("skill not found")
	ErrUnderReview        = errors.New("skill is under review")
)

// PushSkillTree is the single entry point for all push operations (create and
// update). It runs entirely inside one transaction so that concurrent pushes
// from different users are serialised by SQLite's single-writer guarantee,
// preventing silent overwrites.
func (s *Store) PushSkillTree(p PushSkillParams) (*PushResult, error) {
	tx, err := s.DB.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var result *PushResult
	if p.BaseTreeHash == nil {
		result, err = createSkillWithTree(tx, p)
	} else {
		result, err = updateSkillTree(tx, p)
	}
	if err != nil {
		return nil, err
	}
	return result, tx.Commit()
}

// createSkillWithTree handles the base_tree_hash == nil case (new skill).
// The UNIQUE constraint on (ns, name) serialises two simultaneous creates:
// the loser gets a UNIQUE violation which we surface as ErrSkillAlreadyExists.
func createSkillWithTree(tx *sql.Tx, p PushSkillParams) (*PushResult, error) {
	var exists int
	if err := tx.QueryRow(
		`SELECT COUNT(*) FROM skills WHERE ns=? AND name=?`, p.NS, p.Name,
	).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, ErrSkillAlreadyExists
	}

	treeHash, manifest := buildTree(p.Files)
	if err := insertTree(tx, treeHash, manifest); err != nil {
		return nil, err
	}

	classification := p.Classification
	if classification == "" {
		classification = "L2"
	}
	if _, err := tx.Exec(`
		INSERT INTO skills(ns, name, description, classification, tags_csv, author,
		                   status, draft_tree_hash, draft_seq)
		VALUES(?, ?, ?, ?, ?, ?, 'draft', ?, 1)`,
		p.NS, p.Name, p.Description, classification, p.Tags, p.PushedBy, treeHash,
	); err != nil {
		return nil, err
	}
	if err := syncSkillFiles(tx, p.NS, p.Name, p.Files, p.PushedBy); err != nil {
		return nil, err
	}
	return &PushResult{TreeHash: treeHash}, nil
}

// updateSkillTree handles the base_tree_hash != nil case (update existing skill).
func updateSkillTree(tx *sql.Tx, p PushSkillParams) (*PushResult, error) {
	var currentTreeHash, status string
	err := tx.QueryRow(`
		SELECT COALESCE(draft_tree_hash, ''), status
		FROM skills WHERE ns=? AND name=?`,
		p.NS, p.Name,
	).Scan(&currentTreeHash, &status)
	if err == sql.ErrNoRows {
		return nil, ErrSkillNotFound
	}
	if err != nil {
		return nil, err
	}
	if status == "review" {
		return nil, ErrUnderReview
	}

	newTreeHash, newManifest := buildTree(p.Files)

	if currentTreeHash == *p.BaseTreeHash {
		return doFastForward(tx, p, newTreeHash, newManifest)
	}
	return doMerge(tx, p, currentTreeHash)
}

func doFastForward(tx *sql.Tx, p PushSkillParams, treeHash, manifest string) (*PushResult, error) {
	if err := insertTree(tx, treeHash, manifest); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`
		UPDATE skills
		SET draft_tree_hash=?, draft_seq=draft_seq+1, updated_at=CURRENT_TIMESTAMP
		WHERE ns=? AND name=?`,
		treeHash, p.NS, p.Name,
	); err != nil {
		return nil, err
	}
	if err := syncSkillFiles(tx, p.NS, p.Name, p.Files, p.PushedBy); err != nil {
		return nil, err
	}
	return &PushResult{TreeHash: treeHash}, nil
}

// doMerge performs a three-way file-level merge between the common base
// (p.BaseTreeHash), the current server draft, and the incoming push.
func doMerge(tx *sql.Tx, p PushSkillParams, currentHash string) (*PushResult, error) {
	baseFiles    := loadTreeManifest(tx, *p.BaseTreeHash)
	currentFiles := loadTreeManifest(tx, currentHash)
	theirFiles   := filesToMap(p.Files)

	var merged    []PushFile
	var conflicts []ConflictDetail
	var summary   []string

	for _, path := range unionPaths(baseFiles, currentFiles, theirFiles) {
		m, conflict, note := mergeOneFile(path, baseFiles[path], currentFiles[path], theirFiles[path])
		if conflict != nil {
			conflicts = append(conflicts, *conflict)
		} else if m != nil {
			merged = append(merged, *m)
			if note != "" {
				summary = append(summary, note)
			}
		}
	}

	if len(conflicts) > 0 {
		return nil, &ConflictError{Conflicts: conflicts}
	}

	mergedHash, mergedManifest := buildTree(merged)
	if err := insertTree(tx, mergedHash, mergedManifest); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`
		UPDATE skills
		SET draft_tree_hash=?, draft_seq=draft_seq+1, updated_at=CURRENT_TIMESTAMP
		WHERE ns=? AND name=?`,
		mergedHash, p.NS, p.Name,
	); err != nil {
		return nil, err
	}
	if err := syncSkillFiles(tx, p.NS, p.Name, merged, p.PushedBy); err != nil {
		return nil, err
	}
	return &PushResult{TreeHash: mergedHash, Merged: true, MergeSummary: summary}, nil
}

// mergeOneFile applies three-way merge logic for a single path.
// Returns (mergedFile, conflict, summaryNote).
func mergeOneFile(path string, base, current, theirs *PushFile) (*PushFile, *ConflictDetail, string) {
	switch {
	case current == nil && theirs == nil:
		// Both sides independently deleted the file.
		return nil, nil, ""

	case current == nil && base == nil:
		// Client added a new file the server has never seen.
		f := *theirs
		return &f, nil, fmt.Sprintf("%s: added", path)

	case theirs == nil && base == nil:
		// Server added a file the client doesn't have; keep it.
		return current, nil, ""

	case current == nil:
		// Server deleted the file, client modified it.
		return nil, &ConflictDetail{path, "delete/modify conflict"}, ""

	case theirs == nil:
		// Client deleted the file, server modified it.
		return nil, &ConflictDetail{path, "modify/delete conflict"}, ""

	case current.SHA256 == theirs.SHA256:
		// Both sides converged on the same content.
		return current, nil, ""

	case base != nil && current.SHA256 == base.SHA256:
		// Only the client changed this file; accept theirs.
		f := *theirs
		return &f, nil, fmt.Sprintf("%s: accepted theirs", path)

	case base != nil && theirs.SHA256 == base.SHA256:
		// Only the server changed this file; keep ours.
		return current, nil, fmt.Sprintf("%s: kept ours", path)

	default:
		// Both sides changed the file independently.
		// Text files are a candidate for line-level merge (deferred to P4).
		reason := "both sides modified"
		if isTextFile(path) {
			reason = "both sides modified (text merge not yet implemented)"
		}
		return nil, &ConflictDetail{path, reason}, ""
	}
}

// buildTree computes a deterministic tree hash from a file list and returns
// (treeHash, JSONManifest). Deleted entries are excluded.
func buildTree(files []PushFile) (string, string) {
	active := make([]PushFile, 0, len(files))
	for _, f := range files {
		if !f.Deleted {
			active = append(active, f)
		}
	}
	sort.Slice(active, func(i, j int) bool { return active[i].Path < active[j].Path })

	h := sha256.New()
	for _, f := range active {
		fmt.Fprintf(h, "%s\x00%s\x00%d\x00%v\n", f.Path, f.SHA256, f.Size, f.Executable)
	}
	b, _ := json.Marshal(active)
	return hex.EncodeToString(h.Sum(nil)), string(b)
}

func insertTree(tx *sql.Tx, hash, manifest string) error {
	_, err := tx.Exec(
		`INSERT OR IGNORE INTO skill_trees(tree_hash, manifest) VALUES(?, ?)`,
		hash, manifest,
	)
	return err
}

// syncSkillFiles replaces the current skill_files rows with the new tree.
// This keeps the existing file API and Web editor consistent without changes.
func syncSkillFiles(tx *sql.Tx, ns, name string, files []PushFile, pushedBy string) error {
	if _, err := tx.Exec(
		`DELETE FROM skill_files WHERE ns=? AND skill_name=?`, ns, name,
	); err != nil {
		return err
	}
	for _, f := range files {
		if f.Deleted {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO skill_files(ns, skill_name, path, content, blob_hash, size, updated_by)
			VALUES(?, ?, ?, '', ?, ?, ?)`,
			ns, name, f.Path, f.SHA256, f.Size, pushedBy,
		); err != nil {
			return err
		}
	}
	return nil
}

func loadTreeManifest(tx *sql.Tx, treeHash string) map[string]*PushFile {
	if treeHash == "" {
		return map[string]*PushFile{}
	}
	var raw string
	if err := tx.QueryRow(
		`SELECT manifest FROM skill_trees WHERE tree_hash=?`, treeHash,
	).Scan(&raw); err != nil {
		return map[string]*PushFile{}
	}
	var files []PushFile
	json.Unmarshal([]byte(raw), &files)
	return filesToMap(files)
}

func filesToMap(files []PushFile) map[string]*PushFile {
	m := make(map[string]*PushFile, len(files))
	for i := range files {
		f := files[i]
		if !f.Deleted {
			m[f.Path] = &f
		}
	}
	return m
}

func unionPaths(maps ...map[string]*PushFile) []string {
	seen := make(map[string]struct{})
	for _, m := range maps {
		for k := range m {
			seen[k] = struct{}{}
		}
	}
	paths := make([]string, 0, len(seen))
	for k := range seen {
		paths = append(paths, k)
	}
	sort.Strings(paths)
	return paths
}

func isTextFile(path string) bool {
	for _, ext := range []string{".md", ".yaml", ".yml", ".json", ".sh", ".txt", ".toml"} {
		if strings.HasSuffix(path, ext) {
			return true
		}
	}
	return false
}
