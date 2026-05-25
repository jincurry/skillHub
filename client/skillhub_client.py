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
import io
import os
import time
from pathlib import Path
from typing import Any, Iterator, Optional

import requests

# Files > this threshold use the three-step chunked upload protocol.
# Matches the server-side maxSmallBlobSize constant.
_CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB

# _HASH_BUF_SIZE controls how many bytes are read at a time when computing
# the SHA-256 of a large file.  Does not affect correctness, only memory use.
_HASH_BUF_SIZE = 1 * 1024 * 1024  # 1 MB read window

# Text extensions eligible for server-side auto-merge.
_TEXT_EXTS = {".md", ".yaml", ".yml", ".json", ".sh", ".txt", ".toml", ".py"}


class ConflictError(Exception):
    """Raised when a push cannot be auto-merged. Inspect .conflicts for details."""
    def __init__(self, conflicts: list[dict]):
        self.conflicts = conflicts
        super().__init__(
            f"push conflict in {len(conflicts)} file(s): "
            + ", ".join(c["path"] for c in conflicts)
        )


class SkillHubClient:
    """
    Thread-safe SkillHub API client.

    Parameters
    ----------
    base_url : str
        Root URL of the SkillHub API server (no trailing slash).
    token : str
        PAT or JWT bearer token.
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
        expires_in: str = "",
    ) -> str:
        """
        Log in with username/password, create a PAT, and return its raw value.
        Run this once in your bootstrap script and store the result securely.
        """
        base = base_url.rstrip("/")
        r = requests.post(f"{base}/api/v1/auth/login",
                          json={"username": username, "password": password},
                          timeout=30)
        r.raise_for_status()
        jwt = r.json()["token"]

        r = requests.post(f"{base}/api/v1/me/tokens",
                          json={"name": pat_name, "expiresIn": expires_in},
                          headers={"Authorization": f"Bearer {jwt}"},
                          timeout=30)
        r.raise_for_status()
        return r.json()["token"]

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

        Large files (≥ 4 MB) are streamed in chunks — the full content is
        never loaded into memory at once.
        """
        root = Path(local_dir).resolve()
        files = self._collect_files(root)

        self._upload_missing_blobs(files)

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
                if attempt == max_conflict_retries:
                    raise ConflictError(exc.conflicts) from exc
                base_tree_hash = self._get_draft_tree_hash(namespace, name)
                time.sleep(0.2 * (2 ** attempt))

        raise RuntimeError("unreachable")  # pragma: no cover

    def push_files(
        self,
        namespace: str,
        name: str,
        files: dict[str, bytes],
        **kwargs,
    ) -> dict:
        """Push an in-memory dict of {path: content} instead of a local directory."""
        blob_files = [
            _BlobFile.from_bytes(path=p, data=c,
                                 executable=p.startswith("scripts/"))
            for p, c in files.items()
        ]
        self._upload_missing_blobs(blob_files)
        base = self._get_draft_tree_hash(namespace, name)
        return self._commit_push(namespace, name, blob_files,
                                 base_tree_hash=base, **kwargs)

    # ------------------------------------------------------------------
    # Skill / namespace helpers
    # ------------------------------------------------------------------

    def get_skill(self, namespace: str, name: str) -> dict | None:
        r = self._get(f"/api/v1/skills/{namespace}/{name}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()

    def list_skills(self, namespace: str | None = None) -> list[dict]:
        params = {"ns": namespace} if namespace else {}
        return self._get("/api/v1/skills", params=params).json()

    def get_draft_tree_hash(self, namespace: str, name: str) -> str | None:
        return self._get_draft_tree_hash(namespace, name)

    # ------------------------------------------------------------------
    # Internal: file collection
    # ------------------------------------------------------------------

    def _collect_files(self, root: Path) -> list[_BlobFile]:
        """
        Walk the directory tree and build a _BlobFile for each regular file.

        Hash computation is streaming (1 MB read window) so a 500 MB binary
        only ever occupies 1 MB of RAM at this stage.  The file path is stored
        so chunks can be re-read from disk during upload without buffering the
        whole file.
        """
        files = []
        for p in sorted(root.rglob("*")):
            if p.is_symlink() or p.is_dir():
                continue
            rel = p.relative_to(root).as_posix()
            executable = bool(os.access(p, os.X_OK))
            files.append(_BlobFile.from_path(path=rel, disk_path=p,
                                             executable=executable))
        return files

    # ------------------------------------------------------------------
    # Internal: blob existence check + upload dispatch
    # ------------------------------------------------------------------

    def _upload_missing_blobs(self, files: list[_BlobFile]) -> None:
        """
        How the dedup check works
        ─────────────────────────
        1. Client computes SHA-256 of each file locally (streaming for large files).
        2. Sends ALL hashes in one POST /blobs/exists request (max 500 per call).
        3. Server checks its blob_objects table and the on-disk objects/ directory.
        4. Returns only the hashes that are absent on the server.
        5. Client uploads only the missing ones — already-present files cost
           nothing beyond the hash computation.

        This means:
        - Re-pushing the same file twice → server already has it, zero upload.
        - Two different skills sharing the same file (e.g. a common base image)
          → uploaded once, referenced by both trees.
        - The client never needs to track what it uploaded before; the server's
          CAS guarantees idempotency.
        """
        if not files:
            return

        all_sums = [f.sha256 for f in files]

        # Batch in groups of 500 (server limit).
        missing_set: set[str] = set()
        for batch in _batched(all_sums, 500):
            r = self._post("/api/v1/blobs/exists", json={"sha256s": batch})
            r.raise_for_status()
            missing_set.update(r.json().get("missing", []))

        for f in files:
            if f.sha256 not in missing_set:
                continue  # server already has this content — skip

            if f.size < _CHUNK_SIZE:
                self._upload_blob_direct(f)
            else:
                self._upload_blob_chunked(f)

    def _upload_blob_direct(self, f: _BlobFile) -> None:
        """
        Small file (< 4 MB): single PUT with the full body.

        The server re-verifies the SHA-256 while writing — if the hash
        doesn't match the URL parameter, it returns 422 and discards the data.
        """
        r = self._session.put(
            f"{self._base}/api/v1/blobs/{f.sha256}",
            data=f.read_all(),
            headers={
                "Content-Type": "application/octet-stream",
                "Content-Length": str(f.size),
            },
            timeout=self._timeout,
        )
        r.raise_for_status()

    def _upload_blob_chunked(self, f: _BlobFile) -> None:
        """
        Large file (≥ 4 MB): three-step protocol.

        Memory profile
        ──────────────
        Only ONE chunk (≤ 4 MB) is in memory at a time.  For a 500 MB binary:
          - step 1 open session: ~0 bytes
          - step 2 each chunk PUT: 4 MB read from disk, sent, released
          - step 3 complete: server streams chunks together via io.MultiReader

        Each chunk is itself stored as a CAS blob on the server with its own
        SHA-256.  If you upload the same large file twice, the second call to
        /blobs/exists returns it as already-present (sha256 of the full file),
        and the entire chunked upload is skipped.

        If the upload is interrupted mid-way, you can resume from the last
        successful chunk — the session stays alive for 24 h.  (The current
        client doesn't implement resume; it restarts the session.)
        """
        # Step 1 — open session, get upload_id.
        r = self._post(f"/api/v1/blobs/{f.sha256}/uploads", json=None)
        r.raise_for_status()
        upload_id = r.json()["upload_id"]

        # Step 2 — stream file in 4 MB windows, one PUT per chunk.
        for idx, chunk in enumerate(f.iter_chunks(_CHUNK_SIZE)):
            r = self._session.put(
                f"{self._base}/api/v1/blobs/{f.sha256}"
                f"/uploads/{upload_id}/chunks/{idx}",
                data=chunk,                   # ≤ 4 MB bytes object
                headers={"Content-Type": "application/octet-stream"},
                timeout=self._timeout,
            )
            r.raise_for_status()

        # Step 3 — tell server to assemble all chunks.
        # Server reads each chunk blob in order through io.MultiReader and
        # writes the assembled content to the final blob path, verifying the
        # overall SHA-256 matches the session's target hash.
        r = self._post(
            f"/api/v1/blobs/{f.sha256}/uploads/{upload_id}/complete",
            json=None,
        )
        r.raise_for_status()

    # ------------------------------------------------------------------
    # Internal: push commit
    # ------------------------------------------------------------------

    def _commit_push(
        self,
        namespace: str,
        name: str,
        files: list[_BlobFile],
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
                    "size": f.size,
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
                raise ConflictError(body["conflicts"])
            raise _RetryWithNewBase(body.get("conflicts", []))

        r.raise_for_status()
        return r.json()

    def _get_draft_tree_hash(self, namespace: str, name: str) -> str | None:
        r = self._get(f"/api/v1/skills/{namespace}/{name}/draft-tree")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        h = r.json().get("draft_tree_hash", "")
        return h if h else None

    def _get(self, path: str, **kwargs) -> requests.Response:
        return self._session.get(f"{self._base}{path}",
                                 timeout=self._timeout, **kwargs)

    def _post(self, path: str, **kwargs) -> requests.Response:
        if "json" in kwargs and kwargs["json"] is not None:
            kwargs.setdefault("headers", {})["Content-Type"] = "application/json"
        return self._session.post(f"{self._base}{path}",
                                  timeout=self._timeout, **kwargs)


# ------------------------------------------------------------------
# _BlobFile: lazy file handle — no content in memory until upload time
# ------------------------------------------------------------------

class _BlobFile:
    """
    Represents one file in a push.

    For disk-backed files the content is NEVER loaded into memory all at once:
    - SHA-256 is computed by streaming through the file in 1 MB windows.
    - Upload reads the file again in 4 MB chunks (iter_chunks).

    For in-memory files (push_files()) data is already a bytes object and
    is used directly — typically these are small generated files.
    """

    __slots__ = ("path", "size", "sha256", "executable", "_disk_path", "_data")

    def __init__(
        self,
        path: str,
        sha256: str,
        size: int,
        executable: bool,
        disk_path: Path | None,
        data: bytes | None,
    ):
        self.path = path
        self.sha256 = sha256
        self.size = size
        self.executable = executable
        self._disk_path = disk_path
        self._data = data

    @classmethod
    def from_path(cls, path: str, disk_path: Path,
                  executable: bool = False) -> _BlobFile:
        """
        Build a _BlobFile by streaming the file to compute its hash.

        Memory used: _HASH_BUF_SIZE (1 MB) regardless of file size.
        """
        h = hashlib.sha256()
        size = 0
        with disk_path.open("rb") as fh:
            while True:
                buf = fh.read(_HASH_BUF_SIZE)
                if not buf:
                    break
                h.update(buf)
                size += len(buf)
        return cls(
            path=path,
            sha256=h.hexdigest(),
            size=size,
            executable=executable,
            disk_path=disk_path,
            data=None,
        )

    @classmethod
    def from_bytes(cls, path: str, data: bytes,
                   executable: bool = False) -> _BlobFile:
        """Build a _BlobFile from an in-memory bytes object."""
        return cls(
            path=path,
            sha256=hashlib.sha256(data).hexdigest(),
            size=len(data),
            executable=executable,
            disk_path=None,
            data=data,
        )

    def read_all(self) -> bytes:
        """Return the full content (for small-file direct upload)."""
        if self._data is not None:
            return self._data
        return self._disk_path.read_bytes()

    def iter_chunks(self, chunk_size: int) -> Iterator[bytes]:
        """
        Yield successive chunks without loading the whole file.

        For a 500 MB file with chunk_size=4 MB:
          - 125 iterations, each holding 4 MB in memory momentarily.
          - Peak RSS increase: ~4 MB (one chunk), not 500 MB.
        """
        if self._data is not None:
            # In-memory path (push_files): slice the bytes object.
            for i in range(0, len(self._data), chunk_size):
                yield self._data[i:i + chunk_size]
        else:
            # Disk path: re-open and read window by window.
            with self._disk_path.open("rb") as fh:
                while True:
                    buf = fh.read(chunk_size)
                    if not buf:
                        break
                    yield buf


# ------------------------------------------------------------------
# Internal helpers
# ------------------------------------------------------------------

class _RetryWithNewBase(Exception):
    def __init__(self, conflicts: list[dict]):
        self.conflicts = conflicts


def _batched(items: list, n: int) -> Iterator[list]:
    """Yield successive n-sized slices of items."""
    for i in range(0, len(items), n):
        yield items[i:i + n]
