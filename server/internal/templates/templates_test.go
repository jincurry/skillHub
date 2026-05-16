package templates

import (
	"strings"
	"testing"
)

func TestAllTemplatesValid(t *testing.T) {
	all := All()
	if len(all) == 0 {
		t.Fatal("expected at least one built-in template")
	}
	seen := map[string]bool{}
	for _, tpl := range all {
		if tpl.ID == "" {
			t.Errorf("template with empty ID: %+v", tpl)
		}
		if seen[tpl.ID] {
			t.Errorf("duplicate template ID: %s", tpl.ID)
		}
		seen[tpl.ID] = true
		if _, ok := tpl.Files["SKILL.md"]; !ok {
			t.Errorf("template %s missing SKILL.md", tpl.ID)
		}
	}
}

func TestRenderSubstitutesVars(t *testing.T) {
	tpl := Get("code-review")
	if tpl == nil {
		t.Fatal("missing code-review template")
	}
	out := tpl.Render(Vars{Name: "go-review", Description: "Review Go diffs."})
	skill := out["SKILL.md"]
	if !strings.Contains(skill, "go-review") {
		t.Errorf("name not substituted: %q", skill[:120])
	}
	if !strings.Contains(skill, "Review Go diffs.") {
		t.Errorf("description not substituted: %q", skill[:200])
	}
	if strings.Contains(skill, "{{name}}") || strings.Contains(skill, "{{description}}") {
		t.Errorf("placeholders left after render: %q", skill[:120])
	}
}

func TestGetMissing(t *testing.T) {
	if Get("nope") != nil {
		t.Error("Get should return nil for unknown id")
	}
}
