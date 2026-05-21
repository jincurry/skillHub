package store

import (
	"database/sql"
	"errors"
	"path"
	"regexp"
	"strings"

	"github.com/jincurry/skillhub/server/internal/model"
)

// MaxFileBytes caps a single file at 1 MiB. The bundle (sum of all files) is
// not enforced here — the validate package can add that as a check.
const MaxFileBytes = 1 << 20

// validPathSegment enforces conservative file/directory names. We deliberately
// reject leading dots so dotfiles can't sneak in (`.env`, `.git`, ...).
var validPathSegment = regexp.MustCompile(`^[A-Za-z0-9_-][A-Za-z0-9_.-]*$`)

// ValidateFilePath returns the cleaned path on success or an error explaining
// what's wrong. Path rules:
//   - 1..200 chars
//   - no leading slash, no leading or embedded ".." segments
//   - each segment matches [A-Za-z0-9_-][A-Za-z0-9_.-]* (no leading dot)
//   - max depth 8
func ValidateFilePath(p string) (string, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return "", errors.New("path is empty")
	}
	if len(p) > 200 {
		return "", errors.New("path too long (max 200)")
	}
	if strings.HasPrefix(p, "/") {
		return "", errors.New("path cannot be absolute")
	}
	cleaned := path.Clean(p)
	if cleaned != p {
		return "", errors.New("path must already be clean (no ./ or //)")
	}
	if cleaned == "." || strings.HasPrefix(cleaned, "../") || cleaned == ".." {
		return "", errors.New("path cannot escape the bundle root")
	}
	parts := strings.Split(cleaned, "/")
	if len(parts) > 8 {
		return "", errors.New("path too deep (max 8 segments)")
	}
	for _, seg := range parts {
		if !validPathSegment.MatchString(seg) {
			return "", errors.New("invalid path segment: " + seg)
		}
	}
	return cleaned, nil
}

// ListSkillFiles returns all files (without content) for a skill, sorted by
// path so directories cluster together.
func (s *Store) ListSkillFiles(ns, name string) ([]model.SkillFile, error) {
	rows, err := s.DB.Query(`SELECT path, size, updated_at, updated_by
		FROM skill_files
		WHERE ns = ? AND skill_name = ? AND lower(path) <> 'readme.md'
		ORDER BY path`, ns, name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []model.SkillFile
	for rows.Next() {
		var f model.SkillFile
		if err := rows.Scan(&f.Path, &f.Size, &f.UpdatedAt, &f.UpdatedBy); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// GetSkillFile fetches a single file with content. Returns (nil, nil) when not
// found so the caller can return 404.
func (s *Store) GetSkillFile(ns, name, p string) (*model.SkillFile, error) {
	if strings.EqualFold(p, "README.md") {
		return nil, nil
	}
	row := s.DB.QueryRow(`
		SELECT path, content, COALESCE(blob_hash,''), size, updated_at, updated_by
		FROM skill_files WHERE ns = ? AND skill_name = ? AND path = ?`, ns, name, p)
	var f model.SkillFile
	if err := row.Scan(&f.Path, &f.Content, &f.BlobHash, &f.Size, &f.UpdatedAt, &f.UpdatedBy); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

// PutSkillFile inserts or replaces a file. Returns the row as it now exists.
func (s *Store) PutSkillFile(ns, name, p, content, updatedBy string) (*model.SkillFile, error) {
	if len(content) > MaxFileBytes {
		return nil, errors.New("file too large (max 1 MiB)")
	}
	if strings.EqualFold(p, "README.md") {
		return nil, errors.New("root README.md is no longer used for skills; put documentation in SKILL.md")
	}
	if _, err := s.DB.Exec(`
		INSERT INTO skill_files(ns, skill_name, path, content, size, updated_at, updated_by)
		VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
		ON CONFLICT(ns, skill_name, path) DO UPDATE SET
			content    = excluded.content,
			size       = excluded.size,
			updated_at = CURRENT_TIMESTAMP,
			updated_by = excluded.updated_by`,
		ns, name, p, content, len(content), updatedBy); err != nil {
		return nil, err
	}
	return s.GetSkillFile(ns, name, p)
}

// DeleteSkillFile removes a file. Returns true if a row was actually removed.
func (s *Store) DeleteSkillFile(ns, name, p string) (bool, error) {
	res, err := s.DB.Exec(`DELETE FROM skill_files WHERE ns = ? AND skill_name = ? AND path = ?`, ns, name, p)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// RenameSkillFile moves a file from one path to another within the same skill.
// Returns the updated row. Error cases:
//   - source file doesn't exist            → sql.ErrNoRows
//   - destination already exists           → "destination already exists"
//   - source == destination                → "source and destination are identical"
//
// Both paths are assumed to have already been validated by ValidateFilePath.
func (s *Store) RenameSkillFile(ns, name, fromPath, toPath, updatedBy string) (*model.SkillFile, error) {
	if fromPath == toPath {
		return nil, errors.New("source and destination are identical")
	}
	if strings.EqualFold(toPath, "README.md") {
		return nil, errors.New("root README.md is no longer used for skills; put documentation in SKILL.md")
	}
	// Bail out early if the target slot is taken — UPDATE would silently
	// fail the UNIQUE(ns, skill_name, path) constraint and the user wouldn't
	// know why.
	var exists int
	if err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM skill_files WHERE ns = ? AND skill_name = ? AND path = ?`,
		ns, name, toPath,
	).Scan(&exists); err != nil {
		return nil, err
	}
	if exists > 0 {
		return nil, errors.New("destination already exists")
	}
	res, err := s.DB.Exec(`
		UPDATE skill_files
		   SET path       = ?,
		       updated_at = CURRENT_TIMESTAMP,
		       updated_by = ?
		 WHERE ns = ? AND skill_name = ? AND path = ?`,
		toPath, updatedBy, ns, name, fromPath)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return nil, sql.ErrNoRows
	}
	return s.GetSkillFile(ns, name, toPath)
}

// SeedDefaultFiles bootstraps a freshly-created skill with the canonical
// SKILL.md so the editor opens to a meaningful bundle that already nods to
// the recommended layout (SKILL.md + scripts/ + references/ + assets/).
// No-op if the skill already has any files.
//
// SKILL.md is the only file we seed by default — it's the bundle's canonical
// entry point and the validate pass treats its absence as a blocker. Authors
// can add skill.yaml or anything else from the New File dialog if they want.
func (s *Store) SeedDefaultFiles(ns, name, description, author string) error {
	var existing int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM skill_files WHERE ns = ? AND skill_name = ?`, ns, name).Scan(&existing); err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	if _, err := s.PutSkillFile(ns, name, "SKILL.md", buildSkillMD(name, description), author); err != nil {
		return err
	}
	return nil
}

// buildSkillMD renders the canonical SKILL.md scaffold: YAML frontmatter +
// usage / examples / references sections that point at the optional dirs.
func buildSkillMD(name, description string) string {
	desc := strings.TrimSpace(description)
	if desc == "" {
		desc = "(一句话描述这个 skill 的用途)"
	}
	return "---\n" +
		"name: " + name + "\n" +
		"description: " + firstLine(desc) + "\n" +
		"license: Apache-2.0\n" +
		"---\n\n" +
		"# " + name + "\n\n" +
		desc + "\n\n" +
		"## 何时使用\n\n" +
		"- 适用场景 1\n- 适用场景 2\n\n" +
		"## 使用方式\n\n" +
		"描述如何调用这个 skill，期望的输入 / 输出。\n\n" +
		"```bash\nskillhub run " + name + "\n```\n\n" +
		"## 脚本\n\n" +
		"可执行代码放在 `scripts/` 目录。例如 `scripts/main.py`。\n\n" +
		"## 参考资料\n\n" +
		"补充文档（API 规约、长篇说明）放在 `references/` 目录。\n\n" +
		"## 资源\n\n" +
		"模板与静态资源放在 `assets/` 目录。\n"
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return strings.TrimSpace(s)
}

