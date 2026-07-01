# Penjelasan Lengkap: Migrasi LMS ke Kubernetes

Dokumen ini menjelaskan **semua yang dilakukan** saat memigrasi LMS Praktikum dari
Docker single-host ke Kubernetes (Oracle OKE), ditulis untuk **dipelajari dari nol**.
Dibagi jadi: (A) Konsep dasar, (B) Kenapa migrasi, (C) Apa yang dibangun, (D) Masalah
& solusinya, (E) Cara kerja end-to-end, (F) Kondisi sekarang, (G) Glosarium.

---

## A. Konsep Dasar Kubernetes (Wajib Paham Dulu)

Bayangkan Kubernetes (K8s) sebagai "manajer" yang menjalankan banyak container di
banyak komputer sekaligus, secara otomatis.

| Istilah | Analogi sederhana | Di proyek kita |
|---|---|---|
| **Cluster** | Seluruh "pabrik" | Cluster `lms-oke` di Oracle |
| **Node** | Satu mesin/komputer pekerja | 1 VM ARM (2 CPU/12GB) |
| **Pod** | Bungkus terkecil berisi 1 container | 1 pod = 1 container backend/lab/dll |
| **Deployment** | Resep "jalankan N salinan pod ini" | backend (2 replika), frontend (2), dll |
| **Service** | Alamat tetap ke sekumpulan pod | `backend:5001` selalu nyambung |
| **Ingress** | Pintu masuk dari internet + rute | `/` → frontend, `/lab/x` → lab |
| **Namespace** | Folder pemisah resource | semua di `lms-praktikum` |
| **Secret** | Brankas untuk rahasia | kunci Supabase, token OCIR |
| **ConfigMap** | File konfigurasi | prometheus.yml, dashboard Grafana |
| **RBAC** | Kartu izin akses | orchestrator boleh buat pod |
| **LoadBalancer** | Penyeimbang trafik + IP publik | IP `168.110.219.203` |
| **kubectl** | Remote control cluster | perintah `kubectl ...` |

**Perbedaan inti dengan Docker Compose:** Compose menjalankan container di **satu
komputer**. Kubernetes menjalankan pod di **banyak komputer (node)** dan bisa
**menambah node otomatis** saat beban naik — inilah kunci melayani 100 user.

---

## B. Kenapa Migrasi ke Kubernetes?

Dokumen T50 menemukan: saat ~50 container Jupyter hidup di **satu host**, RAM/CPU
laptop habis → Docker crash (kegagalan 91% di `/api/labs/start`).

**Masalahnya bukan software, tapi batas fisik satu mesin.** Autoscaler reactive
(antrian + backpressure) mencegah crash aplikasi, tapi tidak bisa melampaui kapasitas
satu host.

**Solusi Kubernetes:** sebar pod lab ke **banyak node**, dan tambah node otomatis
(Cluster Autoscaler) saat pod tak muat. Inilah **horizontal scaling** yang dibutuhkan
untuk 100 user.

> Catatan: migrasi ini **membalik** keputusan T50 (yang mengganti Kubernetes dengan
> Docker SDK). Perlu sepengetahuan pembimbing.

---

## C. Apa yang Dibangun (3 Fase)

### Fase 1 — Manifest Dasar (folder `k8s/`)
File YAML yang mendefinisikan tiap komponen sebagai resource Kubernetes:

| File | Membuat |
|---|---|
| `00-namespace.yaml` | Namespace `lms-praktikum` |
| `01-secret.example.yaml` | Contoh secret Supabase (template) |
| `10-redis.yaml` | Redis (Deployment + Service) |
| `20-backend.yaml` | Backend API + health probe |
| `30-frontend.yaml` | Frontend nginx |
| `40-prometheus.yaml` | Prometheus + konfigurasi |
| `50-grafana.yaml` | Grafana + provisioning otomatis |
| `60-orchestrator.yaml` | Orchestrator (versi K8s) |
| `61-orchestrator-rbac.yaml` | Izin (RBAC) untuk orchestrator |
| `70-ingress.yaml` | Rute internet → frontend & grafana |
| `build-and-push.sh` | Script build & kirim image ke registry |

### Fase 3 — Rewrite Orchestrator (yang paling berat)
Orchestrator lama (`app.py`) memakai **Docker SDK** (`docker run`) — hanya bisa di
satu host. Dibuat versi baru **`app_k8s.py`** yang memakai **Kubernetes API**.

**Perbedaan intinya:**

| Dulu (Docker, `app.py`) | Sekarang (Kubernetes, `app_k8s.py`) |
|---|---|
| `client.containers.run()` | Buat **Deployment + Service + Ingress** per mahasiswa |
| Port acak di host | **Ingress path** `/lab/<grup>` |
| Akses `/var/run/docker.sock` | **ServiceAccount + RBAC** |
| `docker stats` (monitoring) | Metrik via **metrics.k8s.io** |
| Data di folder host | (untuk uji) pod ephemeral |

**Penting:** `app.py` (Docker) **TIDAK dihapus**. Dua versi hidup berdampingan:
- `app.py` → dipakai deployment Docker di VM (tetap online)
- `app_k8s.py` → dipakai di cluster Kubernetes
- Dibedakan lewat `Dockerfile` (Docker) vs `Dockerfile.k8s` (Kubernetes)

Kontrak API **dipertahankan sama** (`/deploy`, `/stop`, `/autoscaler/status`, dll),
jadi backend **tidak perlu diubah**.

### Fase 2 — Buat Cluster & Deploy
Langkah nyata di Oracle Cloud:
1. Buat cluster **OKE `lms-oke`** (tipe **Basic = gratis**) + 1 node ARM.
2. Akses via **OCI Cloud Shell** (`kubectl` sudah tersedia).
3. Install **ingress-nginx** (pintu masuk + LoadBalancer) & **metrics-server**.
4. Buat **secret**: token OCIR (`ocir-secret`), Supabase (`supabase-credentials`).
5. `kubectl apply -f k8s/` → semua pod jalan.
6. Set IP Ingress (`168.110.219.203`) ke orchestrator.
7. **LMS online di http://168.110.219.203** ✅

---

## D. Masalah yang Ditemui & Solusinya (Bagian Belajar Terpenting)

### 1. Image harus ada di Registry (OCIR)
**Masalah:** K8s tidak bisa `build` dari kode seperti Compose; ia hanya **menarik
image jadi** dari registry.
**Solusi:** Semua image di-build lalu di-push ke **OCIR** (registry Oracle):
`hsg.ocir.io/axyfpuh4ahcf/...`. Registry ini private → butuh **imagePullSecret**
(`ocir-secret`) agar cluster boleh menariknya.

### 2. Arsitektur ARM
**Masalah:** Node & VM pakai CPU **ARM (aarch64)**. Image harus ARM juga.
**Solusi:** Build image **di VM ARM** → otomatis jadi ARM. Untuk orchestrator,
`gevent` tak punya paket siap-pakai di ARM → `Dockerfile.k8s` menambah **build tools**
(gcc) agar bisa di-compile.

### 3. Short-name enforcement (CRI-O)
**Masalah:** Node OKE menolak nama image "pendek" seperti `redis:alpine` dengan error
*"short name mode is enforcing... ambiguous"*.
**Solusi:** Tulis nama **lengkap**: `docker.io/library/redis:alpine`,
`docker.io/prom/prometheus:latest`, `docker.io/grafana/grafana:latest`.

### 4. RBAC untuk Orchestrator
**Masalah:** Orchestrator perlu **membuat/menghapus** Deployment, Service, Ingress di
cluster — tapi secara default pod tidak punya izin.
**Solusi:** `61-orchestrator-rbac.yaml` memberi **ServiceAccount + Role + RoleBinding**
dengan izin spesifik itu.

### 5. Secret jangan tertimpa template
**Masalah:** `kubectl apply -f k8s/` akan menerapkan `01-secret.example.yaml` (berisi
nilai palsu) dan menimpa secret asli.
**Solusi:** Hapus file contoh (`rm k8s/01-secret.example.yaml`) sebelum apply; secret
asli dibuat manual via `kubectl create secret`.

---

## E. Cara Kerja End-to-End (Alur Saat Mahasiswa Pakai)

```
Mahasiswa buka http://168.110.219.203
        │
        ▼
  Ingress (nginx)  ──/──►  Frontend (pod)
        │                     │ panggil /api
        │                     ▼
        │                  Backend (pod) ──► Supabase (cloud)
        │                     │ saat Launch Lab
        │                     ▼
        │                  Orchestrator (pod, app_k8s.py)
        │                     │ pakai Kubernetes API
        │                     ▼
        │        Buat: Deployment + Service + Ingress lab
        │                     │
        └──/lab/<grup>──►  Pod Lab Jupyter (pod baru per mahasiswa)

  Prometheus (pod) ──► kumpulkan metrik ──► Grafana (pod) tampilkan
  metrics-server ──► CPU/memori tiap pod (untuk monitoring & autoscaling)
```

**Yang sudah diuji & terbukti:** kirim `/deploy` ke orchestrator → pod lab + service +
ingress `lab-test01` otomatis dibuat, URL dikembalikan; `/stop` menghapus semuanya.
Ini bukti rewrite Fase 3 bekerja.

---

## F. Kondisi Sekarang

| Item | Nilai |
|---|---|
| Cluster | `lms-oke` (OKE Basic, gratis), region Batam, K8s v1.36 |
| Node | 1× ARM A1 (2 OCPU/12GB), Always Free |
| URL LMS | http://168.110.219.203 |
| Registry | `hsg.ocir.io/axyfpuh4ahcf` (OCIR, private) |
| Akses kubectl | via OCI Cloud Shell |
| Status | 8 pod infra Running; Launch Lab tervalidasi |
| Deployment Docker lama | Tetap online di `http://168.110.216.236:3000` (fallback) |

### Perintah kubectl yang sering dipakai
```bash
kubectl -n lms-praktikum get pods          # lihat semua pod
kubectl -n lms-praktikum get svc           # lihat service
kubectl -n lms-praktikum get ingress       # lihat rute
kubectl -n lms-praktikum logs <pod>        # lihat log 1 pod
kubectl -n lms-praktikum describe pod <p>  # detail & error pod
kubectl apply -f k8s/                      # terapkan/ubah manifest
```

### Update aplikasi ke cluster (setelah ubah kode)
```bash
# 1. Di VM: build & push image baru
export REGISTRY=hsg.ocir.io/axyfpuh4ahcf
bash k8s/build-and-push.sh
# 2. Di Cloud Shell: restart deployment agar tarik image baru
kubectl -n lms-praktikum rollout restart deployment/backend
```

---

## G. Yang Belum Dikerjakan (Fase 4–6)

| Fase | Isi | Kebutuhan |
|---|---|---|
| 4. Cluster Autoscaler | Node nambah otomatis saat pod penuh | setup CA di OKE Basic |
| 5. Prophet → predictive | Forecast beban → pre-scale node lebih dulu | inti klaim "predictive" |
| 6. Uji 100 user | Grafik "100 user, 0% gagal" | node berbayar (wajib teardown) |

---

## H. Glosarium Singkat

- **OKE**: Oracle Kubernetes Engine (layanan Kubernetes terkelola Oracle).
- **OCIR**: Oracle Container Registry (tempat simpan image).
- **Ingress Controller**: program (nginx) yang mengeksekusi aturan Ingress + LoadBalancer.
- **metrics-server**: menyediakan data CPU/memori pod (untuk `kubectl top` & autoscaling).
- **imagePullSecret**: kredensial agar cluster boleh menarik image private.
- **ServiceAccount**: "identitas" yang dipakai pod untuk mengakses Kubernetes API.
- **manifest**: file YAML yang mendeklarasikan resource Kubernetes.
- **ephemeral**: sementara, hilang saat pod mati (mis. IP publik VM, data pod lab uji).

---

## Ringkasan Satu Paragraf

LMS dulu jalan di satu host (Docker Compose) sehingga tidak bisa melampaui kapasitas
satu mesin. Kami memigrasinya ke Kubernetes: menulis manifest untuk tiap komponen
(Fase 1), menulis ulang orchestrator agar membuat lab sebagai Pod/Service/Ingress lewat
Kubernetes API alih-alih Docker (Fase 3), lalu membuat cluster OKE gratis dan
men-deploy semuanya hingga LMS online di http://168.110.219.203 dengan pembuatan lab
dinamis yang sudah terbukti bekerja (Fase 2). Langkah berikutnya adalah autoscaling
lintas node (Fase 4), penskalaan prediktif berbasis FB Prophet (Fase 5), dan validasi
100 pengguna (Fase 6) yang memerlukan node berbayar.
