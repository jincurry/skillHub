# SkillHub + Clawith UAT 部署操作清单

> 本文档记录将 SkillHub 部署到 UAT K8s 环境，并通过 Clawith 前端反向代理对外暴露的完整操作步骤。

---

## 一、环境信息

| 项目 | 值 |
|---|---|
| **K8s 集群** | UAT 环境 |
| **镜像仓库** | `registry-sy.xcloud.lenovo.com/xdba` |
| **SkillHub 命名空间** | `skillhub` |
| **Clawith 命名空间** | `clawith` |
| **SkillHub 内部地址** | `http://skillhub.skillhub.svc.cluster.local:8080` |
| **外部访问地址** | `https://xcloud-dev.lenovo.com/dbmaster/clawith/skillhub/` |

---

## 二、SkillHub 代码准备

### 2.1 合并分支到 main

```bash
cd /data/jintao4/workstations/skillHub
git checkout main
git merge <feature-branch> --no-ff
git push origin main
```

### 2.2 前端 subpath 改造

以下文件需要修改，支持通过子路径部署：

**`Dockerfile`** — 添加 `VITE_BASE_PATH` 构建参数：
```dockerfile
FROM node:20-alpine AS web-build
WORKDIR /web
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
```

**`web/vite.config.ts`** — 使用环境变量作为 base：
```ts
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  // ...
});
```

**`web/src/main.tsx`** — BrowserRouter 使用 BASE_URL：
```tsx
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
setUnauthorizedHandler(() => {
  if (window.location.pathname !== basePath + '/login') {
    window.location.assign(basePath + '/login');
  }
});
// ...
<BrowserRouter basename={basePath}>
```

**`web/src/api/client.ts`** — API 请求前缀：
```ts
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api/v1';
```

**`web/src/lib/download.ts`** — 下载请求前缀：
```ts
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '') + '/api/v1';
```

---

## 三、SkillHub K8s 部署

### 3.1 创建 K8s 清单文件

在 `k8s/` 目录下创建以下文件：

- `namespace.yaml` — 命名空间 `skillhub`
- `secrets.yaml` — JWT Secret（≥32 字符）
- `pvc.yaml` — SQLite 数据持久化（5Gi，`local-path`）
- `deployment.yaml` — 单副本 Deployment
- `service.yaml` — ClusterIP Service（端口 8080）

关键配置项：
```yaml
# deployment.yaml 重要配置
env:
  - name: SKILLHUB_ADDR
    value: ":8080"
  - name: SKILLHUB_DB
    value: "/app/data/skillhub.db"
  - name: SKILLHUB_DATA_DIR
    value: "/app/data"
  - name: SKILLHUB_WEB_DIR
    value: "/app/web"
  - name: SKILLHUB_SEED
    value: "false"            # 不预置用户数据
  - name: SKILLHUB_JWT_SECRET
    valueFrom:
      secretKeyRef:
        name: skillhub-secrets
        key: jwt-secret
imagePullPolicy: Always       # 使用 :latest 标签时必须
```

### 3.2 构建并推送镜像

```bash
docker build \
  --build-arg GOPROXY=https://goproxy.cn,direct \
  --build-arg VITE_BASE_PATH=/dbmaster/clawith/skillhub/ \
  -t registry-sy.xcloud.lenovo.com/xdba/skillhub:latest \
  /data/jintao4/workstations/skillHub

docker push registry-sy.xcloud.lenovo.com/xdba/skillhub:latest
```

### 3.3 部署到 K8s

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml
```

### 3.4 验证部署

```bash
kubectl get pods -n skillhub
kubectl logs -n skillhub deployment/skillhub --tail=20
kubectl exec -n skillhub deployment/skillhub -- wget -qO- http://127.0.0.1:8080/readyz
```

---

## 四、NetworkPolicy 放行

Clawith 命名空间有 NetworkPolicy 限制出站流量。需要 patch 允许访问 `skillhub` 命名空间：

```bash
# 查看现有 egress policy
kubectl get networkpolicy -n clawith

# Patch egress 规则，添加 skillhub 命名空间
kubectl patch networkpolicy clawith-egress-restrictions -n clawith --type='json' \
  -p='[{"op":"add","path":"/spec/egress/-","value":{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"skillhub"}}}]}}]'

# 如果有 clawith-dev-egress-restrictions 也需要 patch
kubectl patch networkpolicy clawith-dev-egress-restrictions -n clawith --type='json' \
  -p='[{"op":"add","path":"/spec/egress/-","value":{"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"skillhub"}}}]}}]'
```

验证连通性：
```bash
kubectl exec -n clawith deployment/clawith-backend -- \
  python -c "import httpx,asyncio; asyncio.run(httpx.AsyncClient().get('http://skillhub.skillhub.svc.cluster.local:8080/readyz').then(lambda r: print(r.status_code, r.text)))"
```

---

## 五、Clawith 前端反向代理

### 5.1 修改 `frontend/nginx.conf`

在 Clawith 前端 nginx 配置中添加 SkillHub 反代：

```nginx
# 处理无尾部斜杠的请求
location = /skillhub {
    return 302 /skillhub/;
}

# SkillHub 反向代理
location /skillhub/ {
    proxy_pass http://skillhub.skillhub.svc.cluster.local:8080/;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
}
```

> **注意**：`location = /skillhub` 必须存在，否则无尾斜杠的请求会被 nginx 用内部端口 3000 做重定向，导致跳转到错误地址。

### 5.2 构建并推送 Clawith 前端镜像

```bash
cd /data/jintao4/workstations/clawith

docker build \
  --no-cache \
  --build-arg CLAWITH_PUBLIC_BASE_PATH="/dbmaster/clawith/" \
  --build-arg VITE_SKILLHUB_URL="/dbmaster/clawith/skillhub/" \
  -t registry-sy.xcloud.lenovo.com/xdba/clawith-frontend:dev-skillhub \
  -f frontend/Dockerfile frontend

docker push registry-sy.xcloud.lenovo.com/xdba/clawith-frontend:dev-skillhub
```

> **关键**：`VITE_SKILLHUB_URL` 必须带尾部斜杠 `/dbmaster/clawith/skillhub/`

### 5.3 更新 Clawith 前端 Deployment

```bash
kubectl set image deployment/clawith-frontend -n clawith \
  frontend=registry-sy.xcloud.lenovo.com/xdba/clawith-frontend:dev-skillhub

# 确保 imagePullPolicy=Always（避免节点缓存旧镜像）
kubectl patch deployment clawith-frontend -n clawith --type='json' \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"Always"}]'
```

---

## 六、Clawith 后端配置

### 6.1 注入 SkillHub 环境变量

```bash
kubectl set env deployment/clawith-backend -n clawith \
  SKILLHUB_BASE_URL=http://skillhub.skillhub.svc.cluster.local:8080 \
  SKILLHUB_API_KEY=skillhub_<your-pat-token> \
  SKILLHUB_NAMESPACE=platform-team
```

### 6.2 构建并推送 Clawith 后端镜像（可选，如有代码变更）

```bash
cd /data/jintao4/workstations/clawith

docker build \
  --no-cache \
  --build-arg CLAWITH_PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ \
  --build-arg CLAWITH_PIP_TRUSTED_HOST=mirrors.aliyun.com \
  -t registry-sy.xcloud.lenovo.com/xdba/clawith-backend:dev-skillhub \
  -f backend/Dockerfile backend

docker push registry-sy.xcloud.lenovo.com/xdba/clawith-backend:dev-skillhub

kubectl set image deployment/clawith-backend -n clawith \
  backend=registry-sy.xcloud.lenovo.com/xdba/clawith-backend:dev-skillhub
```

### 6.3 验证后端连接 SkillHub

```bash
kubectl exec -n clawith deployment/clawith-backend -- env | grep SKILLHUB

kubectl exec -n clawith deployment/clawith-backend -- python -c "
import httpx, asyncio
async def check():
    c = httpx.AsyncClient()
    r = await c.get('http://skillhub.skillhub.svc.cluster.local:8080/api/v1/me',
                     headers={'Authorization': 'Bearer skillhub_<your-pat-token>'})
    print(r.status_code, r.text[:200])
asyncio.run(check())
"
```

---

## 七、最终验证

| 验证项 | 命令/操作 | 预期结果 |
|---|---|---|
| SkillHub Pod 运行 | `kubectl get pods -n skillhub` | Running, 1/1 |
| SkillHub 健康检查 | `curl .../skillhub/readyz` | `{"status":"ready"}` |
| Clawith → SkillHub 网络 | 后端 exec curl | 200 |
| SkillHub PAT 验证 | 后端 exec /api/v1/me | 200 + 用户信息 |
| 前端跳转 | 点击"打开 SkillHub" | 跳转到 `.../skillhub/` |
| SkillHub SPA | 访问 `.../skillhub/login` | 正常渲染登录页 |
| SkillHub API | `.../skillhub/api/v1/skills` | 401 (需 token) |

---

## 八、踩坑记录

1. **`imagePullPolicy: IfNotPresent` + `:latest` 标签**：节点缓存旧镜像不会自动拉取新版本，必须设置 `imagePullPolicy: Always`。
2. **nginx `location /skillhub/` 不匹配 `/skillhub`**：无尾斜杠的请求不会命中 `location /skillhub/`，nginx 自动重定向时会使用内部端口 3000，导致跳转到 `http://host:3000/skillhub/`。需要加 `location = /skillhub { return 302 /skillhub/; }` 处理。
3. **`VITE_SKILLHUB_URL` 必须带尾部斜杠**：否则 `<a href>` 链接会指向 `/dbmaster/clawith/skillhub`（无斜杠），不走反代而是被 Clawith SPA 的 `try_files` 捕获。
4. **pip 镜像源 403**：清华镜像偶尔返回 403 Forbidden，切换到阿里云镜像 `mirrors.aliyun.com/pypi/simple/` 解决。
5. **NetworkPolicy 跨命名空间阻断**：Clawith 命名空间的 egress NetworkPolicy 默认不允许访问 `skillhub` 命名空间，需要手动 patch 放行。
