# Panduan Uji Beban Fase 6 (Kubernetes + Autoscaling)

Cara menguji beban LMS di cluster Kubernetes dan mengumpulkan **dua jenis data**:
1. **Data performa** (Locust) — RPS, waktu respons, tingkat kegagalan (format sama T50).
2. **Data resource per pod** (Grafana + `kubectl top`) — CPU & memori tiap lab.

> Tujuan: membuktikan bahwa arsitektur Kubernetes + Cluster Autoscaler menangani banyak
> Launch Lab konkuren dengan menskalakan node — pembanding langsung terhadap T50
> (yang gagal 91% pada satu host).

---

## Prasyarat
- Cluster OKE `lms-oke` aktif, `kubectl` via OCI Cloud Shell (kubeconfig sudah diset).
- LMS ter-deploy (`kubectl -n lms-praktikum get pods` semua Running).
- Cluster Autoscaler berjalan (`kubectl -n kube-system get pods -l app=cluster-autoscaler`).
- **Node kembali 1 & bersih** dari sisa uji sebelumnya (lihat Teardown).

## Biaya & Skala
- Tiap node A1 (2 OCPU/12GB) menampung ~10 lab. Batas CA saat ini `--nodes=1:3`.
- **Node ke-2+ berbayar** (~$0.15/jam). Uji singkat = recehan; **WAJIB teardown** setelah.
- Untuk skala > 30 lab: naikkan `--nodes` max di `k8s/cluster-autoscaler.yaml`
  (mis. `1:10`) — biaya & risiko "out of host capacity" A1 meningkat.

---

## File Terkait
| File | Fungsi |
|---|---|
| `k8s/loadtest-locust.yaml` | Locust in-cluster (grafik performa) — **disarankan** |
| `k8s/loadtest-labs.yaml` | Job curl sederhana (tanpa grafik, alternatif cepat) |
| `k8s/cluster-autoscaler.yaml` | Cluster Autoscaler (atur batas node di `--nodes`) |
| `grafana/dashboards/lms-containers.json` | Dashboard resource per-pod |

---

## A. Uji Performa dengan Locust (grafik seperti T50)

### 1. Deploy Locust
```bash
cd ~/praktikum-lms-cloud && git pull
kubectl apply -f k8s/loadtest-locust.yaml
kubectl -n lms-praktikum get pods -l app=locust      # tunggu Running
```

### 2. Buka UI Locust
```bash
kubectl -n lms-praktikum port-forward svc/locust 8089:8089
```
Cloud Shell → ikon **Web Preview** (kanan atas) → **Change port** → **8089**.

### 3. Jalankan tes
Di UI Locust:
- **Number of users:** 30 (jumlah "mahasiswa" simultan)
- **Spawn rate:** 5
- **Host:** `http://orchestrator:4000` (sudah preset)
- **Start**

Tiap user virtual = 1 mahasiswa Launch Lab (POST /deploy grup unik) lalu memantau
`/autoscaler/status`. Buka tab **Charts**: RPS, Response Times (p95), Failures.

### 4. Ambil data
- Screenshot tab **Charts**.
- Klik **Download Data** → CSV (`_stats.csv`, `_failures.csv`) untuk laporan.

---

## B. Data Resource per Pod

### 1. `kubectl top` (cepat, real-time)
```bash
# CPU & memori tiap pod lab
kubectl top pods -n lms-praktikum -l app=lab
# Per node
kubectl top nodes
# Pantau live
watch -n 3 kubectl top pods -n lms-praktikum -l app=lab
```
> Butuh ~1 menit setelah pod jalan agar metrik muncul (metrics-server).

### 2. Grafana (grafik)
Buka `http://168.110.219.203/grafana` (admin/admin) → **Dashboards → LMS Praktikum →
Monitoring Per-Container**. Panel CPU/memori per pod & jumlah lab terisi otomatis
selama tes.

### 3. Angka scaling
```bash
kubectl get nodes                                              # node 1 -> 2 -> 3
kubectl -n lms-praktikum get pods -l app=lab --no-headers | grep -c Running  # lab Running
kubectl -n kube-system logs -l app=cluster-autoscaler --tail=15              # keputusan CA
```

---

## C. Ringkasan Data untuk Laporan
Catat dan bandingkan dengan T50:

| Metrik | T50 (1 host) | Sekarang (K8s + autoscaling) |
|---|---|---|
| Kegagalan Launch Lab | 91% | (isi dari Locust) |
| Lab berjalan | crash ~50 | (X/30 Running) |
| Jumlah node | 1 (habis) | (Y node, scale otomatis) |
| Resource per lab | - | (~CPU/memori dari kubectl top) |

---

## D. TEARDOWN (WAJIB — hentikan biaya node)
```bash
# Hentikan Locust
kubectl -n lms-praktikum delete -f k8s/loadtest-locust.yaml
# Hapus semua pod lab + service + ingress-nya
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab
# Pantau CA menurunkan node kembali ke 1 (~10 menit cooldown)
kubectl get nodes
```
Pastikan `kubectl get nodes` kembali **1 node** agar biaya kembali $0.

> Jika sebelumnya memakai `loadtest-labs.yaml` (Job curl):
> `kubectl -n lms-praktikum delete job loadtest-labs` lalu hapus lab seperti di atas.

---

## E. Alternatif Cepat (tanpa grafik) — Job curl
```bash
kubectl apply -f k8s/loadtest-labs.yaml            # default N=30 (ubah di file)
kubectl -n lms-praktikum logs -f job/loadtest-labs # lihat HTTP code tiap request
```
Lalu pantau resource & scaling seperti Bagian B, dan teardown seperti Bagian D.

---

## Catatan Penting
- **Selalu teardown** setelah mengambil data — node ekstra berbayar per jam.
- Kalau CA mentok di 3 node & sebagian lab `Pending`: itu wajar (batas untuk kendali
  biaya) dan tetap hasil valid ("3 node menampung ~N lab"). Naikkan `--nodes` max
  jika ingin skala lebih besar.
- Kalau muncul **"Out of host capacity"** di log CA: kapasitas A1 Batam penuh saat itu
  (batasan Oracle, bukan konfigurasi) — catat sebagai temuan.
