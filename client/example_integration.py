"""
Example: Third-party Python service pushing skills to SkillHub.

This shows three common integration patterns:
  A. Push a local skill directory (typical CI pipeline / agent).
  B. Push programmatically generated content (LLM output, code gen).
  C. Concurrent multi-user push with conflict handling.

Setup:
  pip install requests
  export SKILLHUB_URL=http://localhost:8080
  export SKILLHUB_TOKEN=skillhub_xxxxxxxxxxxxxxxx
"""

import os
import sys
from pathlib import Path

from skillhub_client import ConflictError, SkillHubClient


SKILLHUB_URL = os.environ.get("SKILLHUB_URL", "http://localhost:8080")
SKILLHUB_TOKEN = os.environ.get("SKILLHUB_TOKEN", "")


# ──────────────────────────────────────────────────────────────────────────────
# ONE-TIME SETUP: mint a PAT
# Run this once per user/bot; save the returned token in your secret store.
# ──────────────────────────────────────────────────────────────────────────────

def setup_pat():
    """
    Mint a PAT using username + password (run once, store the result).

    In production, call this from your provisioning script and write the
    returned token to your secrets manager (Vault, AWS Secrets Manager, etc.).
    """
    token = SkillHubClient.login_and_create_pat(
        base_url=SKILLHUB_URL,
        username="alice",       # ← your SkillHub username
        password="password",    # ← your SkillHub password
        pat_name="my-service-bot",
        expires_in="365d",      # or "" for never-expires
    )
    print(f"PAT (save this, shown only once):\n  {token}")
    return token


# ──────────────────────────────────────────────────────────────────────────────
# PATTERN A: push a local directory
# ──────────────────────────────────────────────────────────────────────────────

def push_local_directory():
    """
    Typical CI pipeline pattern: push a skill bundle from disk.

    Directory layout expected:
        skills/deploy-checker/
          SKILL.md          ← required, bundle entry point
          skill.yaml        ← optional metadata
          scripts/run.sh    ← executable scripts
          references/       ← supplementary docs
    """
    client = SkillHubClient(SKILLHUB_URL, SKILLHUB_TOKEN)

    result = client.push_skill(
        namespace="platform-team",
        name="deploy-checker",
        local_dir="./skills/deploy-checker",
        description="Validates deployment configs against policy",
        classification="L2",
        tags="platform,deploy,validation",
        message="ci: auto-push from pipeline",
    )
    print(f"pushed: tree_hash={result['tree_hash']!r}  merged={result['merged']}")
    if result.get("summary"):
        for note in result["summary"]:
            print(f"  • {note}")


# ──────────────────────────────────────────────────────────────────────────────
# PATTERN B: push programmatically generated content
# ──────────────────────────────────────────────────────────────────────────────

def push_generated_skill():
    """
    Agent / LLM output pattern: build file contents in memory, push directly.
    No local directory needed.
    """
    client = SkillHubClient(SKILLHUB_URL, SKILLHUB_TOKEN)

    skill_md = b"""\
---
name: sql-formatter
description: Formats SQL queries to a canonical style
license: Apache-2.0
---

# sql-formatter

Formats SQL queries according to team style guide.

## Usage

```bash
skillhub run sql-formatter
```

## Scripts

See `scripts/format.py`.
"""

    format_py = b"""\
#!/usr/bin/env python3
import sys
# minimal stub — replace with real implementation
print(sys.stdin.read().strip())
"""

    result = client.push_files(
        namespace="data-team",
        name="sql-formatter",
        files={
            "SKILL.md": skill_md,
            "scripts/format.py": format_py,
        },
        description="Formats SQL queries to a canonical style",
        classification="L1",
        tags="sql,formatter,data",
    )
    print(f"pushed: {result}")


# ──────────────────────────────────────────────────────────────────────────────
# PATTERN C: concurrent multi-user push with conflict handling
# ──────────────────────────────────────────────────────────────────────────────

def handle_conflicts():
    """
    When two agents edit the same file differently, the server returns a 409
    with a conflict list.  Text files are auto-merged when edits don't overlap;
    binary files and overlapping text edits require manual resolution.
    """
    client = SkillHubClient(SKILLHUB_URL, SKILLHUB_TOKEN)

    try:
        result = client.push_skill(
            namespace="platform-team",
            name="shared-skill",
            local_dir="./skills/shared-skill",
            max_conflict_retries=5,   # retry on tree divergence, not file conflicts
        )
        print(f"pushed cleanly: {result['tree_hash']}")

    except ConflictError as exc:
        # File-level conflicts that couldn't be auto-merged.
        # Typically: binary file changed by both sides, or overlapping text edits.
        print("Unresolvable conflicts — human review required:")
        for c in exc.conflicts:
            print(f"  {c['path']}: {c['reason']}")
        print("\nAction: pull the current draft, resolve conflicts locally, then re-push.")
        sys.exit(1)


# ──────────────────────────────────────────────────────────────────────────────
# PATTERN D: batch push from an external system
# ──────────────────────────────────────────────────────────────────────────────

def batch_push_all_skills(skills_root: str = "./skills"):
    """
    Walk a directory tree where each sub-directory is one skill:

        skills/
          platform-team/
            deploy-checker/   ← pushed as namespace=platform-team, name=deploy-checker
            secret-scanner/
          data-team/
            sql-formatter/

    Every skill is pushed independently; failures are collected and reported
    at the end so one broken skill doesn't block the rest.
    """
    client = SkillHubClient(SKILLHUB_URL, SKILLHUB_TOKEN)
    root = Path(skills_root)
    errors = {}

    for ns_dir in sorted(root.iterdir()):
        if not ns_dir.is_dir():
            continue
        namespace = ns_dir.name

        for skill_dir in sorted(ns_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_name = skill_dir.name

            try:
                result = client.push_skill(
                    namespace=namespace,
                    name=skill_name,
                    local_dir=skill_dir,
                    message="batch sync",
                )
                status = "merged" if result["merged"] else "ok"
                print(f"  {namespace}/{skill_name}: {status}  ({result['tree_hash'][:12]}…)")
            except ConflictError as exc:
                errors[f"{namespace}/{skill_name}"] = exc
                print(f"  {namespace}/{skill_name}: CONFLICT ({len(exc.conflicts)} files)")
            except Exception as exc:  # noqa: BLE001
                errors[f"{namespace}/{skill_name}"] = exc
                print(f"  {namespace}/{skill_name}: ERROR {exc}")

    if errors:
        print(f"\n{len(errors)} skill(s) failed:")
        for key, err in errors.items():
            print(f"  {key}: {err}")
        sys.exit(1)
    else:
        print("\nAll skills pushed successfully.")


# ──────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="SkillHub integration examples")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("setup-pat")
    sub.add_parser("push-dir")
    sub.add_parser("push-generated")
    sub.add_parser("conflicts")
    sub.add_parser("batch")
    args = parser.parse_args()

    if not SKILLHUB_TOKEN and args.cmd != "setup-pat":
        print("Set SKILLHUB_TOKEN env var first.  Run 'setup-pat' to mint one.")
        sys.exit(1)

    dispatch = {
        "setup-pat":       setup_pat,
        "push-dir":        push_local_directory,
        "push-generated":  push_generated_skill,
        "conflicts":       handle_conflicts,
        "batch":           batch_push_all_skills,
    }
    fn = dispatch.get(args.cmd or "")
    if fn:
        fn()
    else:
        parser.print_help()
