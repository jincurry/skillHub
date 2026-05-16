package store

import (
	"strings"
	"testing"

	"github.com/jincurry/skillhub/server/internal/auth"
	"github.com/jincurry/skillhub/server/internal/model"
)

// ---------------------------------------------------------------------------
// RecordActivation
// ---------------------------------------------------------------------------

func TestRecordActivation_Basic(t *testing.T) {
	s := newTestStore(t)
	_, name := seedBasicWorld(t, s)
	ns := "test-team-x"

	total, err := s.RecordActivation(ns, name, 5)
	if err != nil {
		t.Fatalf("RecordActivation: %v", err)
	}
	if total != 5 {
		t.Errorf("total = %d, want 5", total)
	}

	// Second call accumulates.
	total, err = s.RecordActivation(ns, name, 3)
	if err != nil {
		t.Fatalf("RecordActivation (2nd): %v", err)
	}
	if total != 8 {
		t.Errorf("total after 2nd call = %d, want 8", total)
	}

	// skills.activations and skill_daily_metrics should agree.
	var dbTotal int
	if err := s.DB.QueryRow(`SELECT activations FROM skills WHERE ns=? AND name=?`, ns, name).Scan(&dbTotal); err != nil {
		t.Fatalf("read activations: %v", err)
	}
	if dbTotal != 8 {
		t.Errorf("skills.activations = %d, want 8", dbTotal)
	}

	var dailyTotal int
	if err := s.DB.QueryRow(
		`SELECT COALESCE(SUM(activations),0) FROM skill_daily_metrics WHERE ns=? AND name=?`, ns, name,
	).Scan(&dailyTotal); err != nil {
		t.Fatalf("read daily_metrics: %v", err)
	}
	if dailyTotal != 8 {
		t.Errorf("skill_daily_metrics sum = %d, want 8", dailyTotal)
	}
}

func TestRecordActivation_CountClampedAt1000(t *testing.T) {
	s := newTestStore(t)
	_, name := seedBasicWorld(t, s)
	ns := "test-team-x"

	total, err := s.RecordActivation(ns, name, 9999)
	if err != nil {
		t.Fatalf("RecordActivation: %v", err)
	}
	if total != 1000 {
		t.Errorf("total = %d, want 1000 (capped)", total)
	}
}

func TestRecordActivation_ZeroOrNegativeDefaultsToOne(t *testing.T) {
	s := newTestStore(t)
	_, name := seedBasicWorld(t, s)
	ns := "test-team-x"

	for _, bad := range []int{0, -1, -100} {
		total, err := s.RecordActivation(ns, name, bad)
		if err != nil {
			t.Fatalf("count=%d: %v", bad, err)
		}
		if total < 1 {
			t.Errorf("count=%d: total = %d, want ≥1", bad, total)
		}
	}
}

func TestRecordActivation_SkillNotFound(t *testing.T) {
	s := newTestStore(t)

	_, err := s.RecordActivation("no-ns", "no-skill", 1)
	if err == nil {
		t.Fatal("expected error for unknown skill, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err)
	}
}

func TestRecordActivation_DeltaPctAndHotFlag(t *testing.T) {
	s := newTestStore(t)
	_, name := seedBasicWorld(t, s)
	ns := "test-team-x"

	// Seed 7 days ago with a small baseline so the recent window looks large.
	oldDay := "2026-05-02" // 14 days before 2026-05-16
	if _, err := s.DB.Exec(
		`INSERT INTO skill_daily_metrics(ns,name,day,activations) VALUES(?,?,?,?)`,
		ns, name, oldDay, 10,
	); err != nil {
		t.Fatalf("seed old metrics: %v", err)
	}

	// Recording 100 activations today makes recent >> prev → delta > 20 → hot.
	if _, err := s.RecordActivation(ns, name, 100); err != nil {
		t.Fatalf("RecordActivation: %v", err)
	}

	var deltaPct int
	var hotInt int
	if err := s.DB.QueryRow(
		`SELECT delta_pct, hot FROM skills WHERE ns=? AND name=?`, ns, name,
	).Scan(&deltaPct, &hotInt); err != nil {
		t.Fatalf("read delta_pct/hot: %v", err)
	}
	if deltaPct <= 20 {
		t.Errorf("delta_pct = %d, want > 20", deltaPct)
	}
	if hotInt != 1 {
		t.Errorf("hot = %d, want 1", hotInt)
	}
}

// ---------------------------------------------------------------------------
// ChangePassword
// ---------------------------------------------------------------------------

// seedUserWithPassword inserts a user whose password_hash is a real bcrypt hash.
func seedUserWithPassword(t *testing.T, s *Store, username, password string) {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := s.DB.Exec(
		`INSERT INTO users(username,display,role,team,password_hash,email,bio,location,is_admin)
		 VALUES(?,?,?,?,?,?,?,?,?)`,
		username, username, "engineer", "test", hash, username+"@test.com", "", "", 0,
	); err != nil {
		t.Fatalf("insert user %s: %v", username, err)
	}
}

func TestChangePassword_Success(t *testing.T) {
	s := newTestStore(t)
	seedUserWithPassword(t, s, "pw-user", "oldpass1")

	if err := s.ChangePassword("pw-user", "oldpass1", "newpass2"); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}

	// Old password must no longer work.
	var hash string
	_ = s.DB.QueryRow(`SELECT password_hash FROM users WHERE username='pw-user'`).Scan(&hash)
	if auth.VerifyPassword(hash, "oldpass1") {
		t.Error("old password should be invalid after change")
	}
	// New password must work.
	if !auth.VerifyPassword(hash, "newpass2") {
		t.Error("new password should verify correctly")
	}
}

func TestChangePassword_WrongOldPassword(t *testing.T) {
	s := newTestStore(t)
	seedUserWithPassword(t, s, "pw-user2", "correct")

	err := s.ChangePassword("pw-user2", "wrong", "newpass")
	if err == nil {
		t.Fatal("expected error for wrong old password, got nil")
	}
	if !strings.Contains(err.Error(), "旧密码不正确") {
		t.Errorf("error = %q", err)
	}
}

func TestChangePassword_UserNotFound(t *testing.T) {
	s := newTestStore(t)

	err := s.ChangePassword("ghost", "any", "newpass")
	if err == nil {
		t.Fatal("expected error for unknown user, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err)
	}
}

// ---------------------------------------------------------------------------
// UpdateSkillMeta
// ---------------------------------------------------------------------------

func TestUpdateSkillMeta_Description(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	desc := "updated description"
	skill, err := s.UpdateSkillMeta(ns, name, model.UpdateSkillMetaRequest{
		Description: &desc,
	})
	if err != nil {
		t.Fatalf("UpdateSkillMeta: %v", err)
	}
	if skill.Description != desc {
		t.Errorf("desc = %q, want %q", skill.Description, desc)
	}
}

func TestUpdateSkillMeta_Classification(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	cls := "L3"
	skill, err := s.UpdateSkillMeta(ns, name, model.UpdateSkillMetaRequest{
		Classification: &cls,
	})
	if err != nil {
		t.Fatalf("UpdateSkillMeta: %v", err)
	}
	if skill.Classification != "L3" {
		t.Errorf("classification = %q, want L3", skill.Classification)
	}
}

func TestUpdateSkillMeta_InvalidClassification(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	bad := "L9"
	_, err := s.UpdateSkillMeta(ns, name, model.UpdateSkillMetaRequest{Classification: &bad})
	if err == nil {
		t.Fatal("expected error for invalid classification, got nil")
	}
}

func TestUpdateSkillMeta_Tags(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	tags := []string{"ai", "nlp", "prod"}
	skill, err := s.UpdateSkillMeta(ns, name, model.UpdateSkillMetaRequest{Tags: tags})
	if err != nil {
		t.Fatalf("UpdateSkillMeta: %v", err)
	}
	if len(skill.Tags) != 3 {
		t.Errorf("tags = %v, want 3 items", skill.Tags)
	}
}

func TestUpdateSkillMeta_SkillNotFound(t *testing.T) {
	s := newTestStore(t)
	desc := "x"
	_, err := s.UpdateSkillMeta("no-ns", "no-skill", model.UpdateSkillMetaRequest{Description: &desc})
	if err == nil {
		t.Fatal("expected error for unknown skill, got nil")
	}
	if !strings.Contains(err.Error(), "not found") {
		t.Errorf("error = %q, want 'not found'", err)
	}
}

func TestUpdateSkillMeta_NoOpReturnsCurrent(t *testing.T) {
	s := newTestStore(t)
	ns, name := seedBasicWorld(t, s)

	skill, err := s.UpdateSkillMeta(ns, name, model.UpdateSkillMetaRequest{})
	if err != nil {
		t.Fatalf("no-op UpdateSkillMeta: %v", err)
	}
	if skill.Name != name {
		t.Errorf("name = %q, want %q", skill.Name, name)
	}
}

// ---------------------------------------------------------------------------
// Admin user management
// ---------------------------------------------------------------------------

func TestCreateAdminUser_AndList(t *testing.T) {
	s := newTestStore(t)
	before, _ := s.ListAdminUsers()

	if err := s.CreateAdminUser(model.CreateUserRequest{
		Username: "new-admin",
		Password: "secret99",
		Display:  "New Admin",
		Role:     "engineer",
		Team:     "core",
		Email:    "na@example.com",
		IsAdmin:  true,
	}); err != nil {
		t.Fatalf("CreateAdminUser: %v", err)
	}

	after, _ := s.ListAdminUsers()
	if len(after) != len(before)+1 {
		t.Errorf("user count: before=%d after=%d, want +1", len(before), len(after))
	}

	u, err := s.GetAdminUser("new-admin")
	if err != nil {
		t.Fatalf("GetAdminUser: %v", err)
	}
	if !u.IsAdmin {
		t.Error("IsAdmin should be true")
	}
	if u.Display != "New Admin" {
		t.Errorf("Display = %q, want 'New Admin'", u.Display)
	}
}

func TestCreateAdminUser_EmptyUsernameFails(t *testing.T) {
	s := newTestStore(t)
	err := s.CreateAdminUser(model.CreateUserRequest{Username: "  ", Password: "valid123"})
	if err == nil {
		t.Fatal("expected error for empty username, got nil")
	}
}

func TestAdminUpdateUser_DisableAndEnable(t *testing.T) {
	s := newTestStore(t)
	seedUserWithPassword(t, s, "toggle-user", "pass123")

	disabled := true
	u, err := s.AdminUpdateUser("toggle-user", model.AdminUpdateUserRequest{IsDisabled: &disabled})
	if err != nil {
		t.Fatalf("disable user: %v", err)
	}
	if !u.IsDisabled {
		t.Error("user should be disabled")
	}

	ok, err := s.IsUserDisabled("toggle-user")
	if err != nil {
		t.Fatalf("IsUserDisabled: %v", err)
	}
	if !ok {
		t.Error("IsUserDisabled should return true")
	}

	// Re-enable.
	enabled := false
	u, err = s.AdminUpdateUser("toggle-user", model.AdminUpdateUserRequest{IsDisabled: &enabled})
	if err != nil {
		t.Fatalf("enable user: %v", err)
	}
	if u.IsDisabled {
		t.Error("user should not be disabled after re-enable")
	}
}

func TestAdminUpdateUser_ShortPasswordFails(t *testing.T) {
	s := newTestStore(t)
	seedUserWithPassword(t, s, "short-pw-user", "valid123")

	short := "abc"
	_, err := s.AdminUpdateUser("short-pw-user", model.AdminUpdateUserRequest{Password: &short})
	if err == nil {
		t.Fatal("expected error for short password, got nil")
	}
}

func TestAdminUpdateUser_SetAdminFlag(t *testing.T) {
	s := newTestStore(t)
	seedUserWithPassword(t, s, "promote-user", "pass123")

	isAdmin := true
	u, err := s.AdminUpdateUser("promote-user", model.AdminUpdateUserRequest{IsAdmin: &isAdmin})
	if err != nil {
		t.Fatalf("AdminUpdateUser: %v", err)
	}
	if !u.IsAdmin {
		t.Error("IsAdmin should be true after promotion")
	}
}

func TestIsUserDisabled_UnknownUserReturnsFalse(t *testing.T) {
	s := newTestStore(t)

	disabled, err := s.IsUserDisabled("ghost-user")
	if err != nil {
		t.Fatalf("IsUserDisabled: %v", err)
	}
	if disabled {
		t.Error("unknown user should not be reported as disabled")
	}
}
