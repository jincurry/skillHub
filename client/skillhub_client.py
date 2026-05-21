"""
SkillHub Python Client
======================
Integrates a Python service with the SkillHub API.

Typical integration flow:
  1. Each user/bot creates a PAT via the web UI (Settings → Tokens) or the
     helper below.  Store the token in an env var — it never expires by default.
  2. On every push cycle: scan local skill directories, call push_skill() for
     each one.  The client handles dedup, chunked upload, and conflict retry
     automatically.

Quick start
-----------
    from skillhub_client import SkillHubClient

    client = SkillHubClient(
        base_url="http://your-skillhub:8080",
        token="skillhub_xxxxxxxxxxxx",  # PAT from Settings → Tokens
    )

    # Push a local skill directory.
    result = client.push_skill(
        namespace="platform-team",
        name="my-skill",
        local_dir="./skills/my-skill",
        description="Does X",
        classification="L2",
        tags="platform,automation",
    )
    print(result)  # {"tree_hash": "abc...", "merged": False, "summary": []}

Dependencies
------------
    pip install requests
"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Any, Optional

import requests

# Files > this threshold go through the three-step chunked upload protocol.
_CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB, matches server constant

# Text extensions eligible for server-side auto-merge.
_TEXT_EXTS = {".md", ".yaml", ".yml", ".json", ".sh", ".txt", ".toml", ".py"}


class ConflictError(Exception):
    """Raised when a push cannot be auto-merged. Inspect .conflicts for details."""
    def __init__(self, conflicts: list[dict]):
        self.conflicts = conflicts
        super().__init__(f"push conflict in {len(conflicts)} file(s): "
                         + ", ".join(c["path"] for c in conflicts))


class SkillHubClient:
    """
    Thread-safe SkillHub API client.

    Parameters
    ----------
    base_url : str
        Root URL of the SkillHub API server (no trailing slash).
    token : str
        PAT or JWT bearer token.  PATs start with ``skillhub_`` and never
        expire unless you set a duration; JWTs expire after 24 h.
    timeout : int
        Per-request timeout in seconds (default 60).
    """

    def __init__(self, base_url: str, token: str, timeout: int = 60):
        self._base = base_url.rstrip("/")
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        })
        self._timeout = timeout

    # ------------------------------------------------------------------
    # Token management (one-time setup helpers)
    # ------------------------------------------------------------------

    @classmethod
    def login_and_create_pat(
        cls,
        base_url: str,
        username: str,
        password: str,
        pat_name: str = "ci-bot",
        expires_in: str = "",          # "" = never, "30d"/"90d"/"365d"
    ) -> str:
        """
        Log in with username/password, create a PAT, and return its value.
        Run this once in your bootstrap script and store the result securely.

            token = SkillHubClient.login_and_create_pat(
                "http://skillhub:8080", "alice", "password", pat_name="my-bot"
            )
            # → "skillhub_xxxxxxxxxxxxxxxxxxxxxxxx"
        """
        base = base_url.rstrip("/")
        # Step 1: get a short-lived JWT.
        r = requests.post(
            f"{base}/api/v1/auth/login",
            json={"username": username, "password": password},
            timeout=30,
        )
        r.raise_for_status()
        jwt = r.json()["token"]

        # Step 2: mint a PAT with the JWT.
        r = requests.post(
            f"{base}/api/v1/me/tokens",
            json={"name": pat_name, "expiresIn": expires_in},
            headers={"Authorization": f"Bearer {jwt}"},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()["token"]  # raw PAT, store this value

    # ------------------------------------------------------------------
    # High-level push API
    # ------------------------------------------------------------------

    def push_skill(
        self,
        namespace: str,
        name: str,
        local_dir: str | Path,
        *,
        description: str = "",
        classification: str = "L2",
        tags: str = "",
        message: str = "",
        max_conflict_retries: int = 3,
    ) -> dict:
        """
        Push a local skill directory to SkillHub.

        Walks ``local_dir``, uploads only changed blobs (content-addressed
        dedup), then commits the tree.  On diverged-branch conflicts the
        client fetches the current draft tree and retries up to
        ``max_conflict_retries`` times.

        Parameters
        ----------
        namespace : str
            Namespace that owns the skill (e.g. ``"platform-team"``).
        name : str
            Skill name slug (e.g. ``"deploy-checker"``).
        local_dir : path-like
            Root directory of the skill bundle.  All files inside are pushed.
            Symlinks are skipped.
        description, classification, tags, message : str
            Metadata — only used when creating a new skill.
        max_conflict_retries : int
            How many times to retry after a tree-divergence conflict before
            raising ``ConflictError``.

        Returns
        -------
        dict
            ``{"tree_hash": str, "merged": bool, "summary": list[str]}``

        Raises
        ------
        ConflictError
            When the same file was modified by both sides with incompatible
            changes (text-merge failed or binary file).
        requests.HTTPError
            For any other 4xx/5xx response.
        """
        root = Path(local_dir).resolve()
        files = self._collect_files(root)

        # Upload any blobs the server doesn't have yet.
        self._upload_missing_blobs(files)

        # Try to push; retry on tree divergence.
        base_tree_hash = self._get_draft_tree_hash(namespace, name)

        for attempt in range(max_conflict_retries + 1):
            try:
                return self._commit_push(
                    namespace, name, files,
                    base_tree_hash=base_tree_hash,
                    description=description,
                    classification=classification,
                    tags=tags,
                    message=message,
                )
            except _RetryWithNewBase as exc:
                # Another push landed while we were uploading blobs.
                # Refresh the base and retry; the server will auto-merge.
                if attempt == max_conflict_retries:
                    raise ConflictError(exc.conflicts) from exc
                base_tree_hash = self._get_draft_tree_hash(namespace, name)
                time.sleep(0.2 * (2 ** attempt))  # 0.2 s, 0.4 s, 0.8 s …

        raise RuntimeError("unreachable")  # pragma: no cover

    def push_files(
        self,
        namespace: str,
        name: str,
        files: dict[str, bytes],
        **kwargs,
    ) -> dict:
        """
        Push an in-memory dict of {path: content} instead of a local directory.

            client.push_files("platform-team", "my-skill", {
                "SKILL.md": b"---\nname: my-skill\n---\n# My Skill\n",
                "scripts/run.sh": b"#!/bin/bash\necho hello\n",
            })
        """
        blob_files = [
            _BlobFile(path=p, data=c, executable=p.startswith("scripts/"))
            for p, c in files.items()
        ]
        self._upload_missing_blobs(blob_files)
        base = self._get_draft_tree_hash(namespace, name)
        return self._commit_push(namespace, name, blob_files, base_tree_hash=base, **kwargs)

    # ------------------------------------------------------------------
    # Skill / namespace helpers
    # ------------------------------------------------------------------

    def get_skill(self, namespace: str, name: str) -> dict | None:
        """Return skill metadata or None if not found."""
        r = self._get(f"/api/v1/skills/{namespace}/{name}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    def list_skills(self, namespace: str | None = None) -> list[dict]:
        """List all visible skills, optionally filtered by namespace."""
        params = {}
        if namespace:
            params["ns"] = namespace
        return self._get("/api/v1/skills", params=params).json()

    def get_draft_tree_hash(self, namespace: str, name: str) -> str | None:
        """Return the current draft tree hash, or None for a brand-new skill."""
        return self._get_draft_tree_hash(namespace, name)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _collect_files(self, root: Path) -> list["_BlobFile"]:
        files = []
        for p in sorted(root.rglob("*")):
            if p.is_symlink() or p.is_dir():
                continue
            rel = p.relative_to(root).as_posix()
            data = p.read_bytes()
            executable = bool(os.access(p, os.X_OK))
            files.append(_BlobFile(path=rel, data=data, executable=executable))
        return files

    def _upload_missing_blobs(self, files: list["_BlobFile"]) -> None:
        """Upload only the blobs that the server doesn't already have."""
        all_sums = [f.sha256 for f in files]
        if not all_sums:
            return

        # Batch existence check — server returns the missing subset.
        r = self._post("/api/v1/blobs/exists", json={"sha256s": all_sums})
        r.raise_for_status()
        missing_set = set(r.json().get("missing", []))

        for f in files:
            if f.sha256 not in missing_set:
                continue
            if len(f.data) < _CHUNK_SIZE:
                self._upload_blob_direct(f)
            else:
                self._upload_blob_chunked(f)

    def _upload_blob_direct(self, f: "_BlobFile") -> None:
        r = self._session.put(
            f"{self._base}/api/v1/blobs/{f.sha256}",
            data=f.data,
            headers={"Content-Type": "application/octet-stream",
                     "Content-Length": str(len(f.data))},
            timeout=self._timeout,
        )
        r.raise_for_status()

    def _upload_blob_chunked(self, f: "_BlobFile") -> None:
        # Step 1: open upload session.
        r = self._post(f"/api/v1/blobs/{f.sha256}/uploads", json=None)
        r.raise_for_status()
        upload_id = r.json()["upload_id"]

        # Step 2: upload chunks.
        for idx, chunk in enumerate(_chunk_bytes(f.data, _CHUNK_SIZE)):
            r = self._session.put(
                f"{self._base}/api/v1/blobs/{f.sha256}/uploads/{upload_id}/chunks/{idx}",
                data=chunk,
                headers={"Content-Type": "application/octet-stream"},
                timeout=self._timeout,
            )
            r.raise_for_status()

        # Step 3: assemble.
        r = self._post(f"/api/v1/blobs/{f.sha256}/uploads/{upload_id}/complete", json=None)
        r.raise_for_status()

    def _commit_push(
        self,
        namespace: str,
        name: str,
        files: list["_BlobFile"],
        *,
        base_tree_hash: str | None,
        description: str = "",
        classification: str = "L2",
        tags: str = "",
        message: str = "",
    ) -> dict:
        payload: dict[str, Any] = {
            "base_tree_hash": base_tree_hash,
            "files": [
                {
                    "path": f.path,
                    "sha256": f.sha256,
                    "size": len(f.data),
                    "executable": f.executable,
                }
                for f in files
            ],
            "message": message,
            "description": description,
            "classification": classification,
            "tags": tags,
        }
        r = self._post(f"/api/v1/skills/{namespace}/{name}/push", json=payload)

        if r.status_code == 409:
            body = r.json()
            if "conflicts" in body:
                # File-level conflict that couldn't be auto-merged.
                raise ConflictError(body["conflicts"])
            # Tree diverged (another push landed between our read and commit).
            # The caller will refresh base_tree_hash and retry.
            raise _RetryWithNewBase(body.get("conflicts", []))

        r.raise_for_status()
        return r.json()

    def _get_draft_tree_hash(self, namespace: str, name: str) -> str | None:
        r = self._get(f"/api/v1/skills/{namespace}/{name}/draft-tree")
        if r.status_code == 404:
            return None  # skill doesn't exist yet → create
        r.raise_for_status()
        h = r.json().get("draft_tree_hash", "")
        return h if h else None

    def _get(self, path: str, **kwargs) -> requests.Response:
        return self._session.get(f"{self._base}{path}", timeout=self._timeout, **kwargs)

    def _post(self, path: str, **kwargs) -> requests.Response:
        if "json" in kwargs and kwargs["json"] is not None:
            kwargs.setdefault("headers", {})["Content-Type"] = "application/json"
        return self._session.post(f"{self._base}{path}", timeout=self._timeout, **kwargs)


# ------------------------------------------------------------------
# Internal data classes
# ------------------------------------------------------------------

class _BlobFile:
    __slots__ = ("path", "data", "executable", "sha256")

    def __init__(self, path: str, data: bytes, executable: bool = False):
        self.path = path
        self.data = data
        self.executable = executable
        self.sha256 = hashlib.sha256(data).hexdigest()


class _RetryWithNewBase(Exception):
    def __init__(self, conflicts: list[dict]):
        self.conflicts = conflicts


def _chunk_bytes(data: bytes, size: int):
    for i in range(0, len(data), size):
        yield data[i:i + size]
