"""
SkillHub Python 客户端 — 详细使用示例
=====================================

每个示例都附有完整的 HTTP 请求/响应说明，
帮助理解每一步服务器在做什么。

运行前准备：
  cd server && go run ./cmd/api   # 启动服务器
  pip install requests
  python3 walkthrough.py
"""

import hashlib
import os
import threading
import time

import requests

BASE = os.environ.get("SKILLHUB_URL", "http://localhost:8080")
sep = "─" * 60


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hr(title: str):
    print(f"\n{sep}\n  {title}\n{sep}")


# ─────────────────────────────────────────────────────────────────
# 步骤 0：获取 JWT，再换成 PAT
# ─────────────────────────────────────────────────────────────────

def step0_auth():
    hr("步骤 0 / 认证：用密码换 JWT，再换成长期 PAT")

    # POST /api/v1/auth/login
    # 返回一个 24 小时有效的 JWT。
    # 每次重启服务器 JWT 会失效（除非设置了固定 SKILLHUB_JWT_SECRET）。
    print("→ POST /api/v1/auth/login")
    r = requests.post(f"{BASE}/api/v1/auth/login",
                      json={"username": "alice", "password": "password"})
    r.raise_for_status()
    jwt = r.json()["token"]
    print(f"   JWT (前40字符): {jwt[:40]}…")
    print("   有效期: 24h，服务器重启后失效")

    # POST /api/v1/me/tokens
    # 用 JWT 换一个 PAT（Personal Access Token）。
    # PAT 格式：skillhub_<随机串>，每次请求都校验 is_disabled。
    print("\n→ POST /api/v1/me/tokens")
    r = requests.post(f"{BASE}/api/v1/me/tokens",
                      json={"name": "walkthrough-bot", "expiresIn": ""},
                      headers={"Authorization": f"Bearer {jwt}"})
    r.raise_for_status()
    pat = r.json()["token"]
    print(f"   PAT: {pat}")
    print("   有效期: 永不过期（expiresIn=''），每次请求都会校验账号是否被禁用")
    print("   ⚠ 这是唯一一次看到完整 PAT 的机会，请保存到密钥存储")

    return pat


# ─────────────────────────────────────────────────────────────────
# 步骤 1：第一次推送 —— 新建一个 Skill
# ─────────────────────────────────────────────────────────────────

def step1_create(pat: str) -> str:
    hr("步骤 1 / 新建 Skill（base_tree_hash = null）")
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {pat}"

    skill_md = b"""\
---
name: hello-skill
description: A demo skill for the walkthrough
license: Apache-2.0
---

# hello-skill

Prints a greeting.

## Usage

```bash
skillhub run hello-skill
```
"""

    run_sh = b"""\
#!/bin/bash
set -euo pipefail
echo "Hello from hello-skill!"
"""

    files = {
        "SKILL.md": skill_md,
        "scripts/run.sh": run_sh,
    }

    # ── 1a. 批量检查哪些 blob 服务器已有 ──────────────────────────
    all_sums = {path: sha256(data) for path, data in files.items()}
    print("→ POST /api/v1/blobs/exists")
    print(f"   请求: {{ sha256s: [{', '.join(all_sums.values())}] }}")
    r = sess.post(f"{BASE}/api/v1/blobs/exists",
                  json={"sha256s": list(all_sums.values())})
    r.raise_for_status()
    missing = set(r.json()["missing"])
    print(f"   响应: missing={list(missing)}")
    print(f"   服务器没有这些 blob，需要上传 {len(missing)} 个")

    # ── 1b. 上传缺失的 blob ───────────────────────────────────────
    for path, data in files.items():
        s = sha256(data)
        if s not in missing:
            print(f"   跳过 {path}（服务器已有，内容去重）")
            continue
        print(f"\n→ PUT /api/v1/blobs/{s[:16]}…  ({path}, {len(data)} bytes)")
        r = sess.put(f"{BASE}/api/v1/blobs/{s}", data=data,
                     headers={"Content-Type": "application/octet-stream",
                               "Content-Length": str(len(data))})
        r.raise_for_status()
        print(f"   HTTP {r.status_code} — blob 已存储")

    # ── 1c. 提交 tree（base_tree_hash = null → 创建新 Skill）────
    payload = {
        "base_tree_hash": None,         # ← null 表示新建
        "files": [
            {"path": p, "sha256": s, "size": len(files[p])}
            for p, s in all_sums.items()
        ] + [
            {"path": "scripts/run.sh", "sha256": all_sums["scripts/run.sh"],
             "size": len(files["scripts/run.sh"]), "executable": True}
        ],
        "description":    "A demo skill for the walkthrough",
        "classification": "L1",
        "tags":           "demo,walkthrough",
        "message":        "initial commit",
    }
    # 去重 files 列表（run.sh 被加了两次仅为演示）
    seen = {}
    for f in payload["files"]:
        seen[f["path"]] = f
    payload["files"] = list(seen.values())

    print("\n→ POST /api/v1/skills/platform-team/hello-skill/push")
    print(f"   base_tree_hash: null  ← 新建")
    r = sess.post(f"{BASE}/api/v1/skills/platform-team/hello-skill/push",
                  json=payload)
    if r.status_code == 409:
        # Skill 已存在，本示例重新运行时会遇到这种情况
        print("   409: Skill 已存在（重复运行本脚本会出现），跳到下一步")
        return _get_current_tree(sess)
    r.raise_for_status()
    result = r.json()
    print(f"   HTTP 200")
    print(f"   tree_hash : {result['tree_hash']}")
    print(f"   merged    : {result['merged']}  ← false 表示快进，无合并")
    print(f"   summary   : {result['summary']}")
    print("\n   服务器做了什么：")
    print("   1. 确认所有 sha256 都在 blob_objects 表中")
    print("   2. 计算 tree_hash = SHA256(sorted(path+sha256+size+exe))")
    print("   3. INSERT INTO skills(..., draft_tree_hash=tree_hash)")
    print("   4. 同步 skill_files 表（供 Web 编辑器使用）")
    return result["tree_hash"]


def _get_current_tree(sess: requests.Session) -> str:
    r = sess.get(f"{BASE}/api/v1/skills/platform-team/hello-skill/draft-tree")
    r.raise_for_status()
    return r.json()["draft_tree_hash"]


# ─────────────────────────────────────────────────────────────────
# 步骤 2：第二次推送 —— 快进更新
# ─────────────────────────────────────────────────────────────────

def step2_fast_forward(pat: str, base_tree_hash: str) -> str:
    hr("步骤 2 / 快进更新（我改了文件，服务器端没有其他人改）")
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {pat}"

    updated_skill_md = b"""\
---
name: hello-skill
description: A demo skill for the walkthrough (v2)
license: Apache-2.0
version: "0.2.0"
---

# hello-skill

Prints a greeting. Now with a name argument!

## Usage

```bash
skillhub run hello-skill --name World
```
"""

    new_sum = sha256(updated_skill_md)

    # 只上传变化的 blob
    r = sess.post(f"{BASE}/api/v1/blobs/exists", json={"sha256s": [new_sum]})
    if new_sum in r.json()["missing"]:
        sess.put(f"{BASE}/api/v1/blobs/{new_sum}", data=updated_skill_md,
                 headers={"Content-Type": "application/octet-stream",
                           "Content-Length": str(len(updated_skill_md))})

    run_sh = b"#!/bin/bash\nset -euo pipefail\necho \"Hello from hello-skill!\"\n"

    print(f"   base_tree_hash (我读到的当前版本): {base_tree_hash[:20]}…")
    print("→ POST /api/v1/skills/platform-team/hello-skill/push")

    r = sess.post(f"{BASE}/api/v1/skills/platform-team/hello-skill/push",
                  json={
                      "base_tree_hash": base_tree_hash,  # ← 我基于这个版本改的
                      "files": [
                          {"path": "SKILL.md", "sha256": new_sum,
                           "size": len(updated_skill_md)},
                          {"path": "scripts/run.sh", "sha256": sha256(run_sh),
                           "size": len(run_sh), "executable": True},
                      ],
                      "message": "v0.2: add name argument",
                  })
    r.raise_for_status()
    result = r.json()
    print(f"   HTTP 200  merged={result['merged']}")
    print(f"   新 tree_hash: {result['tree_hash']}")
    print("\n   服务器逻辑：")
    print(f"   draft_tree_hash({result['tree_hash'][:12]}…) == base_tree_hash 吗？")
    print("   → 是 ✓ 快进：直接 UPDATE skills SET draft_tree_hash=新hash, draft_seq+=1")
    return result["tree_hash"]


# ─────────────────────────────────────────────────────────────────
# 步骤 3：并发推送 —— 自动三方合并
# ─────────────────────────────────────────────────────────────────

def step3_auto_merge(pat: str, base_tree_hash: str) -> str:
    hr("步骤 3 / 并发推送 —— 两人基于同一版本，改不同文件，自动合并")

    sess_alice = requests.Session()
    sess_alice.headers["Authorization"] = f"Bearer {pat}"

    # ── Alice 的修改：改 SKILL.md ─────────────────────────────────
    skill_md_alice = b"""\
---
name: hello-skill
description: ALICE updated the description
license: Apache-2.0
version: "0.3.0"
---

# hello-skill (Alice's update)
"""
    sum_alice = sha256(skill_md_alice)
    sess_alice.put(f"{BASE}/api/v1/blobs/{sum_alice}", data=skill_md_alice,
                   headers={"Content-Type": "application/octet-stream",
                             "Content-Length": str(len(skill_md_alice))})

    # ── Bob 的修改：加新文件 config.yaml（用相同 PAT 模拟，实际场景是不同账号）──
    config_yaml = b"version: 1\nlog_level: info\ntimeout: 30\n"
    sum_config = sha256(config_yaml)
    sess_alice.put(f"{BASE}/api/v1/blobs/{sum_config}", data=config_yaml,
                   headers={"Content-Type": "application/octet-stream",
                             "Content-Length": str(len(config_yaml))})

    run_sh = b"#!/bin/bash\nset -euo pipefail\necho \"Hello from hello-skill!\"\n"
    sum_run = sha256(run_sh)

    # ── Alice 先推 ────────────────────────────────────────────────
    print(f"   两人都读到 base_tree_hash = {base_tree_hash[:20]}…")
    print("\n→ Alice 先 push（改了 SKILL.md）")
    r = sess_alice.post(f"{BASE}/api/v1/skills/platform-team/hello-skill/push",
                        json={
                            "base_tree_hash": base_tree_hash,
                            "files": [
                                {"path": "SKILL.md", "sha256": sum_alice,
                                 "size": len(skill_md_alice)},
                                {"path": "scripts/run.sh", "sha256": sum_run,
                                 "size": len(run_sh), "executable": True},
                            ],
                        })
    r.raise_for_status()
    after_alice = r.json()["tree_hash"]
    print(f"   Alice push 成功，新 tree_hash = {after_alice[:20]}…")

    # ── Bob 后推，base 还是旧的，但改的是不同文件 ───────────────
    print("\n→ Bob 后 push（新增 config.yaml，base 还是旧的）")
    print(f"   Bob 的 base_tree_hash = {base_tree_hash[:20]}…  ← 和 Alice 一样的旧版本")
    print(f"   服务器当前   tree_hash = {after_alice[:20]}…  ← Alice 已经推了新版本")
    print("   base ≠ current → 触发三方合并")

    r = sess_alice.post(f"{BASE}/api/v1/skills/platform-team/hello-skill/push",
                        json={
                            "base_tree_hash": base_tree_hash,  # Bob 读到的旧版本
                            "files": [
                                # Bob 没改 SKILL.md，发的是原始版本
                                # （服务器会发现：base 里的 SKILL.md 和 current 不同
                                #   但 Bob 发的和 base 相同，所以取 Alice 的版本）
                                {"path": "SKILL.md",
                                 "sha256": sha256(b"""\
---
name: hello-skill
description: A demo skill for the walkthrough (v2)
license: Apache-2.0
version: "0.2.0"
---

# hello-skill

Prints a greeting. Now with a name argument!

## Usage

```bash
skillhub run hello-skill --name World
```
"""), "size": 200},
                                {"path": "scripts/run.sh", "sha256": sum_run,
                                 "size": len(run_sh), "executable": True},
                                {"path": "config.yaml", "sha256": sum_config,  # Bob 新增
                                 "size": len(config_yaml)},
                            ],
                        })
    r.raise_for_status()
    result = r.json()
    print(f"\n   HTTP 200  merged={result['merged']}  ← true 表示做了合并")
    print(f"   merged tree_hash = {result['tree_hash']}")
    if result.get("summary"):
        for note in result["summary"]:
            print(f"   合并说明: {note}")
    print("\n   三方合并逻辑：")
    print("   base[SKILL.md]  = v2 描述  current[SKILL.md]  = Alice 改的")
    print("   Bob 的[SKILL.md] = v2 描述（和 base 一样）→ 取 Alice 的版本 ✓")
    print("   base[config.yaml] = 不存在  current[config.yaml] = 不存在")
    print("   Bob 的[config.yaml] = 新增 → 加入合并结果 ✓")
    return result["tree_hash"]


# ─────────────────────────────────────────────────────────────────
# 步骤 4：文本文件同行冲突 —— 409
# ─────────────────────────────────────────────────────────────────

def step4_text_conflict(pat: str, base_tree_hash: str):
    hr("步骤 4 / 文本冲突 —— 两人改了同一行，服务器无法自动合并")
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {pat}"

    run_sh_orig = b"#!/bin/bash\nset -euo pipefail\necho \"Hello from hello-skill!\"\n"

    # Alice 改了 run.sh 第3行
    run_sh_alice = b"#!/bin/bash\nset -euo pipefail\necho \"Hello from ALICE!\"\n"
    sum_a = sha256(run_sh_alice)
    sess.put(f"{BASE}/api/v1/blobs/{sum_a}", data=run_sh_alice,
             headers={"Content-Type": "application/octet-stream",
                       "Content-Length": str(len(run_sh_alice))})

    skill_sum = sha256(b"---\nname: hello-skill\n---\n")

    # Alice 先推
    r = sess.post(f"{BASE}/api/v1/skills/platform-team/hello-skill/push",
                  json={
                      "base_tree_hash": base_tree_hash,
                      "files": [
                          {"path": "scripts/run.sh", "sha256": sum_a,
                           "size": len(run_sh_alice), "executable": True},
                      ],
                  })
    if r.status_code not in (200, 409):
        r.raise_for_status()

    # Bob 也改了 run.sh 第3行，但内容不同
    run_sh_bob = b"#!/bin/bash\nset -euo pipefail\necho \"Hello from BOB!\"\n"
    sum_b = sha256(run_sh_bob)
    sess.put(f"{BASE}/api/v1/blobs/{sum_b}", data=run_sh_bob,
             headers={"Content-Type": "application/octet-stream",
                       "Content-Length": str(len(run_sh_bob))})

    print("→ Bob push（run.sh 第3行和 Alice 改的不同）")
    r = sess.post(f"{BASE}/api/v1/skills/platform-team/hello-skill/push",
                  json={
                      "base_tree_hash": base_tree_hash,  # 旧 base
                      "files": [
                          {"path": "scripts/run.sh", "sha256": sum_b,
                           "size": len(run_sh_bob), "executable": True},
                      ],
                  })

    print(f"   HTTP {r.status_code}")
    if r.status_code == 409:
        body = r.json()
        print(f"   冲突详情: {body.get('conflicts', body)}")
        print("\n   服务器逻辑：")
        print("   ancestor[run.sh] = 原始版本")
        print("   ours[run.sh]     = Alice 改的（echo ALICE）")
        print("   theirs[run.sh]   = Bob 改的（echo BOB）")
        print("   LCS 对比发现第3行两边都改了，且内容不同 → 409")
        print("\n   解决方式：")
        print("   1. GET /api/v1/skills/ns/name/draft-tree  获取当前版本")
        print("   2. GET /api/v1/skills/ns/name/files/scripts%2Frun.sh  下载当前内容")
        print("   3. 本地手动合并后，以新 base_tree_hash 重新 push")


# ─────────────────────────────────────────────────────────────────
# 步骤 5：大文件分片上传（CLI 程序 / 二进制）
# ─────────────────────────────────────────────────────────────────

def step5_chunked_upload(pat: str, base_tree_hash: str) -> str:
    hr("步骤 5 / 大文件分片上传（≥ 4 MB 的 CLI 程序）")
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {pat}"

    # 模拟一个 6 MB 的二进制文件（真实场景是编译好的 CLI 工具）
    CHUNK = 4 * 1024 * 1024
    fake_binary = b"\x7fELF" + os.urandom(6 * 1024 * 1024 - 4)  # fake ELF
    total_sum = sha256(fake_binary)
    print(f"   文件大小: {len(fake_binary) / 1024 / 1024:.1f} MB")
    print(f"   sha256:   {total_sum[:20]}…")

    # ── 5a. 开启 upload session ───────────────────────────────────
    print("\n→ POST /api/v1/blobs/{sha256}/uploads  （开启分片会话）")
    r = sess.post(f"{BASE}/api/v1/blobs/{total_sum}/uploads")
    r.raise_for_status()
    upload_id = r.json()["upload_id"]
    print(f"   upload_id: {upload_id}")
    print("   服务器在 blob_uploads 表插入一行，有效期 24h")

    # ── 5b. 逐片上传 ──────────────────────────────────────────────
    chunks = [fake_binary[i:i + CHUNK] for i in range(0, len(fake_binary), CHUNK)]
    print(f"\n   共 {len(chunks)} 个分片，每片最大 4 MB")
    for idx, chunk in enumerate(chunks):
        url = f"{BASE}/api/v1/blobs/{total_sum}/uploads/{upload_id}/chunks/{idx}"
        print(f"→ PUT …/chunks/{idx}  ({len(chunk) / 1024:.0f} KB)")
        r = sess.put(url, data=chunk,
                     headers={"Content-Type": "application/octet-stream"})
        r.raise_for_status()
        print(f"   HTTP {r.status_code}  （每个分片本身也作为 blob 存储，可去重）")

    # ── 5c. 合并 ─────────────────────────────────────────────────
    print(f"\n→ POST …/uploads/{upload_id}/complete  （拼合所有分片）")
    r = sess.post(
        f"{BASE}/api/v1/blobs/{total_sum}/uploads/{upload_id}/complete")
    r.raise_for_status()
    result = r.json()
    print(f"   sha256: {result['sha256'][:20]}…  size: {result['size']} bytes")
    print("   服务器用 io.MultiReader 流式拼合，不会全部加载到内存")

    # ── 5d. 在 push 里引用这个大文件 ─────────────────────────────
    print("\n→ POST …/push（在 files 里引用大文件，和普通文件没区别）")
    r = sess.post(f"{BASE}/api/v1/skills/platform-team/hello-skill/push",
                  json={
                      "base_tree_hash": base_tree_hash,
                      "files": [
                          {
                              "path": "bin/hello-cli",
                              "sha256": total_sum,
                              "size": len(fake_binary),
                              "executable": True,       # ← 标记可执行
                          }
                      ],
                  })
    r.raise_for_status()
    result = r.json()
    print(f"   HTTP 200  tree_hash={result['tree_hash'][:20]}…  merged={result['merged']}")
    return result["tree_hash"]


# ─────────────────────────────────────────────────────────────────
# 步骤 6：读取 Skill 信息
# ─────────────────────────────────────────────────────────────────

def step6_read(pat: str):
    hr("步骤 6 / 读取 Skill 信息")
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {pat}"

    # 元数据
    r = sess.get(f"{BASE}/api/v1/skills/platform-team/hello-skill")
    r.raise_for_status()
    meta = r.json()
    print(f"→ GET /skills/platform-team/hello-skill")
    print(f"   name:           {meta['name']}")
    print(f"   status:         {meta['status']}")
    print(f"   draft_tree_hash:{meta.get('draft_tree_hash', '')[:20]}…")

    # 文件列表
    r = sess.get(f"{BASE}/api/v1/skills/platform-team/hello-skill/files")
    r.raise_for_status()
    files = r.json()
    print(f"\n→ GET /skills/platform-team/hello-skill/files")
    for f in (files or []):
        blob = f.get('blobHash', '')
        src = f"blob:{blob[:12]}…" if blob else "inline"
        print(f"   {f['path']:30s}  {f['size']:>8} bytes  [{src}]")

    # 当前 draft tree hash（客户端下次 push 的 base）
    r = sess.get(f"{BASE}/api/v1/skills/platform-team/hello-skill/draft-tree")
    r.raise_for_status()
    print(f"\n→ GET /skills/platform-team/hello-skill/draft-tree")
    print(f"   draft_tree_hash: {r.json()['draft_tree_hash']}")
    print("   ← 下次 push 前先读这个，作为 base_tree_hash 的值")


# ─────────────────────────────────────────────────────────────────
# 主流程
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("SkillHub Python 客户端 — 完整演示")
    print("确保服务器已启动：cd server && go run ./cmd/api\n")

    pat = step0_auth()

    tree0 = step1_create(pat)
    print(f"\n  ✓ 初始 tree_hash = {tree0[:20]}…")

    tree1 = step2_fast_forward(pat, tree0)
    print(f"\n  ✓ 快进后 tree_hash = {tree1[:20]}…")

    tree2 = step3_auto_merge(pat, tree1)
    print(f"\n  ✓ 合并后 tree_hash = {tree2[:20]}…")

    step4_text_conflict(pat, tree2)

    # 重新读最新 tree（step4 里 Alice 的 push 可能成功了）
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {pat}"
    r = sess.get(f"{BASE}/api/v1/skills/platform-team/hello-skill/draft-tree")
    latest = r.json()["draft_tree_hash"]

    tree3 = step5_chunked_upload(pat, latest)
    print(f"\n  ✓ 含大文件的 tree_hash = {tree3[:20]}…")

    step6_read(pat)

    print(f"\n{sep}")
    print("  演示完成！")
    print(sep)
