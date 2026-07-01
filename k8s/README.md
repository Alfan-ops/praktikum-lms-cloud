# Kubernetes Manifests — Fase 1 (Service Stateless)

Manifest dasar untuk menjalankan LMS Praktikum di Kubernetes. Ini **Fase 1** dari
[../RENCANA_KUBERNETES.md](../RENCANA_KUBERNETES.md): hanya service **stateless**
(frontend, backend, redis, prometheus, grafana). Orchestrator masih placeholder —
akan di-rewrite di **Fase 3**.

> Manifest ini TIDAK menyentuh deployment Docker yang sudah online di Oracle VM.
> Ini jalur terpisah untuk membangun arsitektur K8s secara bertahap.

## Isi Folder

| File | Fungsi |
|---|---|
| `00-namespace.yaml` | Namespace `lms-praktikum` |
| `01-secret.example.yaml` | Template Secret Supabase (buat manual, jangan commit nilai asli) |
| `10-redis.yaml` | Redis Deployment + Service |
| `20-backend.yaml` | Backend API (Flask) Deployment + Service |
| `30-frontend.yaml` | Frontend (nginx) Deployment + Service |
| `40-prometheus.yaml` | Prometheus + ConfigMap |
| `50-grafana.yaml` | Grafana + provisioning datasource/dashboard |
| `60-orchestrator.yaml` | Placeholder (rewrite di Fase 3) |
| `70-ingress.yaml` | Ingress frontend + grafana |
| `build-and-push.sh` | Build & push image ke registry |

## Prasyarat

- Cluster Kubernetes (mis. Oracle OKE) + `kubectl` terkonfigurasi
- Ingress Controller (mis. `ingress-nginx`)
- Registry image (Docker Hub / OCIR) + sudah `docker login`

## Langkah Deploy

### 1. Build & push image
```bash
export REGISTRY=docker.io/USERNAME_ANDA
cd ..            # ke root proyek
./k8s/build-and-push.sh
```
Lalu ganti `docker.io/CHANGEME` → `$REGISTRY` di `k8s/20-backend.yaml`,
`30-frontend.yaml`, `60-orchestrator.yaml`.

### 2. Buat namespace & secret
```bash
kubectl apply -f k8s/00-namespace.yaml

kubectl -n lms-praktikum create secret generic supabase-credentials \
  --from-literal=SUPABASE_URL='https://xxxx.supabase.co' \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY='isi_service_role_key'
```

### 3. Buat ConfigMap dashboard Grafana (dari file yang sudah ada)
```bash
kubectl -n lms-praktikum create configmap grafana-dashboards \
  --from-file=lms-containers.json=grafana/dashboards/lms-containers.json
```

### 4. Apply semua manifest
```bash
kubectl apply -f k8s/
```

### 5. Verifikasi
```bash
kubectl -n lms-praktikum get pods
kubectl -n lms-praktikum get svc
kubectl -n lms-praktikum get ingress
```
Semua pod harus `Running`. Akses LMS via IP/host Ingress Controller.

## Yang BELUM di Fase 1 (menyusul)

- **Orchestrator rewrite** (Docker SDK → Kubernetes API) — Fase 3
- **KEDA / HPA / Cluster Autoscaler** — Fase 4
- **Estimator FB Prophet → predictive scaling** — Fase 5
- **PersistentVolume** untuk data mahasiswa & Prometheus (kini `emptyDir`, non-persisten)
- **TLS/HTTPS** pada Ingress

## Catatan

- `backend` & `frontend` di-set `replicas: 2` sebagai contoh; sesuaikan.
- Prometheus & Grafana pakai `emptyDir` (data hilang saat pod restart). Ganti ke
  PVC untuk persistensi (menyusul).
- Orchestrator placeholder tidak akan berfungsi sampai rewrite Fase 3.
