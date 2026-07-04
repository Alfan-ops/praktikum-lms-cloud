# Kubernetes Manifests — Platform LMS Praktikum (Fase 1–6)

Manifest untuk menjalankan LMS Praktikum di Kubernetes (Oracle OKE) dengan
**autoscaling reaktif & prediktif**. Ini implementasi lengkap dari
[../RENCANA_KUBERNETES.md](../RENCANA_KUBERNETES.md): dari service stateless
sampai orchestrator berbasis Kubernetes API, Cluster Autoscaler, dan pre-scaling
prediktif berbasis FB Prophet.

> **Status:** Fase 1–6 **selesai & terbukti** (uji beban 30 user: 0% gagal, vs
> baseline T50 91% gagal). Lihat ringkasan di [../LANJUTAN_DEVICE_BARU.md](../LANJUTAN_DEVICE_BARU.md)
> dan detail migrasi di [../PENJELASAN_MIGRASI_KUBERNETES.md](../PENJELASAN_MIGRASI_KUBERNETES.md).
>
> Manifest ini TERPISAH dari deployment Docker yang online di Oracle VM
> (`http://168.110.216.236:3000`), yang tetap dipertahankan sebagai fallback.

## Isi Folder

### Service inti (stateless + orchestrator)
| File | Fungsi |
|---|---|
| `00-namespace.yaml` | Namespace `lms-praktikum` |
| `01-secret.example.yaml` | Template Secret Supabase (buat manual, jangan commit nilai asli) |
| `10-redis.yaml` | Redis Deployment + Service |
| `20-backend.yaml` | Backend API (Flask) Deployment + Service |
| `30-frontend.yaml` | Frontend (nginx) Deployment + Service |
| `40-prometheus.yaml` | Prometheus + ConfigMap |
| `50-grafana.yaml` | Grafana + provisioning datasource/dashboard |
| `60-orchestrator.yaml` | Orchestrator versi K8s (`app_k8s.py`) — spawn lab sbg Deployment+Service+Ingress per mahasiswa via Kubernetes API |
| `61-orchestrator-rbac.yaml` | RBAC orchestrator: izin kelola Deployment/Service/Ingress + baca Pod/metrik |
| `70-ingress.yaml` | Ingress frontend + grafana |

### Autoscaling prediktif (pre-warm node)
| File | Fungsi |
|---|---|
| `80-priorityclass.yaml` | PriorityClass `placeholder-low` (−10): placeholder diusir workload nyata (lab) |
| `81-placeholder.yaml` | Deployment `capacity-placeholder` — "pemesan tempat" (~1 node/replica) agar Cluster Autoscaler pre-provision node. Replika diatur otomatis oleh estimator |
| `82-estimator.yaml` | Estimator FB Prophet + RBAC — meramal beban & mengatur jumlah placeholder (pre-scaling) |
| `cluster-autoscaler.yaml` | Cluster Autoscaler OKE (instance principal) — tambah/kurang worker node otomatis (`--nodes=MIN:MAX:NODEPOOL_OCID`) |

### Optimasi & keamanan
| File | Fungsi |
|---|---|
| `90-prepull-lab-image.yaml` | DaemonSet pre-pull image lab (~2 GB) ke tiap node → scale-out cepat (warm cache) alih-alih cold pull ~6 menit |
| `91-netpol-lab-isolation.yaml` | NetworkPolicy isolasi pod lab (multi-tenant hardening): lab hanya menerima trafik Ingress, egress hanya DNS + internet |

### Uji beban (Fase 6)
| File | Fungsi |
|---|---|
| `loadtest-labs.yaml` | Job: kirim N Launch Lab konkuren (env `LAB_COUNT`, default 30) → picu Cluster Autoscaler |
| `loadtest-locust.yaml` | Locust menembak orchestrator `/deploy` dari dalam cluster → grafik RPS/latency/failure (format sama T50) |
| `collect_autoscale_metrics.sh` | Kumpulkan metrik autoscaling selama uji (CSV untuk plotting) |

### Utilitas
| File | Fungsi |
|---|---|
| `build-and-push.sh` | Build & push semua image ke registry (OCIR) |

## Prasyarat

- Cluster Kubernetes (Oracle OKE) + `kubectl` terkonfigurasi (via OCI Cloud Shell)
- Ingress Controller (`ingress-nginx`)
- Registry image (OCIR `hsg.ocir.io/axyfpuh4ahcf`) + `imagePullSecret` `ocir-secret`
- Untuk Cluster Autoscaler: Dynamic Group + Policy agar node berhak mengelola node pool

## Langkah Deploy

### 1. Build & push image (DI VM ARM — bukan Cloud Shell)
```bash
export REGISTRY=hsg.ocir.io/axyfpuh4ahcf
cd ..            # ke root proyek
bash k8s/build-and-push.sh
```
> Cloud Shell = amd64 → jangan build image lab di sana (`exec format error` di node ARM).
> Pastikan image `linux/arm64`. Ganti `docker.io/CHANGEME` → `$REGISTRY` di manifest bila perlu.

### 2. Namespace, Secret Supabase, & imagePullSecret OCIR
```bash
kubectl apply -f k8s/00-namespace.yaml

kubectl -n lms-praktikum create secret generic supabase-credentials \
  --from-literal=SUPABASE_URL='https://xxxx.supabase.co' \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY='isi_service_role_key'

kubectl -n lms-praktikum create secret docker-registry ocir-secret \
  --docker-server=hsg.ocir.io \
  --docker-username='axyfpuh4ahcf/muhamadalfan0511@gmail.com' \
  --docker-password='OCIR_AUTH_TOKEN' \
  --docker-email='muhamadalfan0511@gmail.com'
```

### 3. ConfigMap dashboard Grafana
```bash
kubectl -n lms-praktikum create configmap grafana-dashboards \
  --from-file=lms-containers.json=grafana/dashboards/lms-containers.json
```

### 4. Apply manifest inti
```bash
kubectl apply -f k8s/          # service inti + orchestrator + RBAC + prewarm + netpol
```
> `cluster-autoscaler.yaml`: ganti `NODEPOOL_OCID` & tag image sesuai versi cluster
> SEBELUM apply (lihat komentar di file).

### 5. Verifikasi
```bash
kubectl -n lms-praktikum get pods       # semua Running
kubectl -n lms-praktikum get svc
kubectl -n lms-praktikum get ingress
kubectl get nodes                        # node pool aktif
```
Akses LMS via IP/host Ingress Controller (mis. `http://168.110.219.203`).

## Uji Beban (Fase 6)

Lihat [../PANDUAN_UJI_BEBAN_FASE6.md](../PANDUAN_UJI_BEBAN_FASE6.md). Ringkas:
```bash
kubectl apply -f k8s/loadtest-locust.yaml
# atau uji Launch Lab langsung:
kubectl apply -f k8s/loadtest-labs.yaml
kubectl -n lms-praktikum logs -f job/loadtest-labs
```

### ⚠️ Teardown (WAJIB setelah uji — node ekstra berbayar)
```bash
kubectl -n lms-praktikum delete job loadtest-labs 2>/dev/null
kubectl -n lms-praktikum delete -f k8s/loadtest-locust.yaml 2>/dev/null
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab
kubectl get nodes                        # Cluster Autoscaler menurunkan ke node minimum
```

## Catatan

- **Orchestrator & placeholder wajib `replicas: 1`/dikelola estimator** — state
  semaphore/antrian autoscaler ada di memori 1 proses.
- **Persistensi:** Prometheus/Grafana & data lab mahasiswa masih `emptyDir`/ephemeral
  (hilang saat pod restart). Untuk simpan hasil, gunakan fitur submit (Assignments)
  atau tambah PVC — lihat keterbatasan di [../LINGKUP_LMS.md](../LINGKUP_LMS.md).
- **Belum dikerjakan (opsional):** PVC per mahasiswa, TLS/HTTPS pada Ingress,
  Reserved Public IP, uji beban skala penuh 100 user.
