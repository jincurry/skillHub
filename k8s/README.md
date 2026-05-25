# SkillHub Kubernetes Deployment

Minimal k8s manifests for deploying SkillHub to a cluster.

## Prerequisites

- `kubectl` configured for the target cluster
- Docker image pushed to `registry-sy.xcloud.lenovo.com/xdba/skillhub:<tag>`
- StorageClass `local-path` available (default on Rancher k3s)

## Quick Start

```bash
# 1. Generate a real JWT secret and update secrets.yaml
openssl rand -base64 36
# Edit k8s/secrets.yaml: replace the placeholder with the generated value

# 2. Apply all manifests
kubectl apply -f k8s/

# 3. Verify
kubectl get pods -n skillhub
kubectl logs -n skillhub -l app.kubernetes.io/name=skillhub

# 4. Port-forward for local access
kubectl port-forward -n skillhub svc/skillhub 8080:8080
```

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `SKILLHUB_ADDR` | `:8080` | Listen address |
| `SKILLHUB_DB` | `/app/data/skillhub.db` | SQLite database path |
| `SKILLHUB_DATA_DIR` | `/app/data` | Data directory for large files |
| `SKILLHUB_WEB_DIR` | `/app/web` | Static frontend files |
| `SKILLHUB_SEED` | `false` | Seed demo data on first run |
| `SKILLHUB_JWT_SECRET` | (required) | ≥ 32 char secret for JWT signing |

## Notes

- SkillHub uses **SQLite**, so only **1 replica** is supported.
- PVC must be `ReadWriteOnce`.
- On first deployment with `SKILLHUB_SEED=false`, you need to register users
  via the web UI or admin API.
