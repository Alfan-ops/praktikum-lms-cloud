# Catatan Lanjutan & Panduan Pindah Device

Dokumen untuk **melanjutkan pekerjaan dari device (laptop) lain** dan **ringkasan semua
perubahan** migrasi Kubernetes + optimasi. Semua aset ada di cloud (VM, cluster OKE,
OCIR, GitHub), jadi pindah device hanya perlu setup akses — bukan install ulang.

---

## A. Ringkasan Perubahan Sesi Ini (Migrasi Kubernetes)

Dari LMS Docker single-host (rawan crash, T50: 91% gagal di ~50 user) → **platform
Kubernetes multi-node dengan autoscaling reaktif & prediktif**.

| Fase | Isi | Status |
|---|---|---|
| 1 | Manifest dasar K8s (`k8s/`) | ✅ |
| 2 | Cluster OKE + deploy (LMS online di Ingress) | ✅ |
| 3 | Rewrite orchestrator Docker SDK → Kubernetes API (`app_k8s.py`) | ✅ |
| 4 | Cluster Autoscaler (reactive, node 1↔3 otomatis) | ✅ terbukti |
| 5 | FB Prophet → predictive pre-scaling (`estimator/`) | ✅ terbukti |
| 6 | Uji beban 30 user (Locust): **0% gagal** (vs T50 91%) | ✅ |
| Optimasi | Image lab 5,42GB → 2,06GB (−62%) + fix arch arm64 | ✅ |

File dokumentasi terkait di repo: `PENJELASAN_MIGRASI_KUBERNETES.md`,
`RENCANA_KUBERNETES.md`, `PANDUAN_UJI_BEBAN_FASE6.md`, `k8s/README.md`.

---

## B. Aset & Akses (Identitas Penting)

| Aset | Nilai |
|---|---|
| Oracle Cloud | login akun (email + password) di cloud.oracle.com |
| Region | Indonesia North / **Batam** (`ap-batam-1`) |
| VM (Docker LMS) | `ubuntu@168.110.216.236` (SSH pakai private key) |
| LMS Docker | http://168.110.216.236:3000 · Grafana :3001 |
| Cluster OKE | `lms-oke` |
| Cluster OCID | `ocid1.cluster.oc1.ap-batam-1.aaaaaaaavpv3iv5o7xjbjsb6kj7p44a2kqfocbvfzc7u2a3i5cxteli5xu4a` |
| Node pool OCID | `ocid1.nodepool.oc1.ap-batam-1.aaaaaaaah773u2bnq6gs5t6pmn5xyelmqj4dzp76ahusqi76dnhrzkb3oo6q` |
| LMS Kubernetes | http://168.110.219.203 · Grafana :80/grafana |
| Registry (OCIR) | `hsg.ocir.io/axyfpuh4ahcf` |
| OCIR username | `axyfpuh4ahcf/muhamadalfan0511@gmail.com` |
| GitHub | https://github.com/Alfan-ops/praktikum-lms-cloud (branch `main`) |

---

## C. WAJIB Dibawa/Disiapkan ke Device Baru

1. **File private key SSH** VM: `ssh-key-2026-07-01.key`
   → **SALIN file ini** dari laptop lama (USB / email ke diri sendiri / cloud drive).
   Tanpa ini tidak bisa SSH ke VM. (Alternatif: buat key baru & tambahkan lewat console.)
2. **Login Oracle Cloud** (email + password akun).
3. **OCIR Auth Token** (untuk `docker login` di VM saat push image).
   Token tak bisa dilihat lagi → generate baru bila hilang: Console → My profile →
   Auth tokens → Generate. (Kalau generate baru & hapus lama, update juga secret
   `ocir-secret` di cluster — lihat bawah.)
4. **Kunci Supabase** (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — hanya perlu bila
   membuat ulang `.env` (VM & cluster sudah terisi). Ada di `.env` laptop lama /
   dashboard Supabase.

---

## D. Langkah di Device Baru

### 1. Software
- **Git** (wajib). **SSH** (bawaan Windows/Mac/Linux). Docker/Node/Python **tidak perlu**
  di device baru — build image dilakukan di VM, kubectl lewat Cloud Shell.

### 2. Clone repo (semua kode & dokumentasi)
```bash
git clone https://github.com/Alfan-ops/praktikum-lms-cloud.git
cd praktikum-lms-cloud
```

### 3. Akses cluster Kubernetes — via OCI Cloud Shell (TERMUDAH, tanpa install)
1. Login cloud.oracle.com → klik ikon **Cloud Shell** (kanan atas, region ap-batam-1)
2. Regenerate kubeconfig (sekali per sesi Cloud Shell):
   ```bash
   oci ce cluster create-kubeconfig \
     --cluster-id ocid1.cluster.oc1.ap-batam-1.aaaaaaaavpv3iv5o7xjbjsb6kj7p44a2kqfocbvfzc7u2a3i5cxteli5xu4a \
     --file $HOME/.kube/config --region ap-batam-1 \
     --token-version 2.0.0 --kube-endpoint PUBLIC_ENDPOINT
   ```
3. Uji: `kubectl get nodes` (harus muncul node cluster)
4. Clone repo juga di Cloud Shell bila perlu manifest: `git clone <url> && cd ...`

> Catatan: **Cloud Shell = amd64** — hanya untuk `kubectl`, JANGAN build image lab di sini
> (image jadi amd64 → `exec format error` di node ARM). Build image di VM (ARM).

### 4. Akses VM (Docker LMS + build image ARM) — SSH
Dari PowerShell/terminal device baru (letakkan private key, sesuaikan path):
```powershell
$key = "C:\path\ke\ssh-key-2026-07-01.key"
icacls $key /reset; icacls $key /inheritance:r; icacls $key /grant:r "$($env:USERNAME):R"
ssh -i $key ubuntu@168.110.216.236
```
(Windows perlu perbaiki permission key dengan `icacls` di atas, sekali saja.)

### 5. Login OCIR di VM (untuk push image)
```bash
docker login hsg.ocir.io
# Username: axyfpuh4ahcf/muhamadalfan0511@gmail.com
# Password: <OCIR Auth Token>
```

---

## E. Perintah Operasional Penting

### Build & push image (DI VM — arsitektur ARM)
```bash
cd ~/praktikum-lms-cloud && git pull
export REGISTRY=hsg.ocir.io/axyfpuh4ahcf
bash k8s/build-and-push.sh                # semua image
# atau satu image, mis. lab:
docker build -t hsg.ocir.io/axyfpuh4ahcf/ml-lab-single-user:latest ./jupyter_image
docker inspect ... --format '{{.Os}}/{{.Architecture}}'   # pastikan linux/arm64
docker push hsg.ocir.io/axyfpuh4ahcf/ml-lab-single-user:latest
```

### Deploy / update ke cluster (DI Cloud Shell)
```bash
kubectl -n lms-praktikum get pods
kubectl apply -f k8s/                      # terapkan manifest
kubectl -n lms-praktikum rollout restart deployment/backend   # tarik image baru
```

### Update secret OCIR di cluster (bila token diganti)
```bash
kubectl -n lms-praktikum delete secret ocir-secret
kubectl -n lms-praktikum create secret docker-registry ocir-secret \
  --docker-server=hsg.ocir.io \
  --docker-username='axyfpuh4ahcf/muhamadalfan0511@gmail.com' \
  --docker-password='TOKEN_BARU' \
  --docker-email='muhamadalfan0511@gmail.com'
```

### Uji beban (Fase 6)
Lihat `PANDUAN_UJI_BEBAN_FASE6.md`. Ringkas (Cloud Shell):
```bash
kubectl apply -f k8s/loadtest-locust.yaml
kubectl -n lms-praktikum exec -it deploy/locust -- \
  locust -f /mnt/locust/locustfile.py --host http://orchestrator:4000 \
  --headless -u 30 -r 5 -t 5m --html /tmp/report.html --csv /tmp/lms
# ambil hasil: kubectl cp ... ; download via Cloud Shell Menu -> Download
```

### ⚠️ TEARDOWN (WAJIB setelah uji — node ekstra berbayar)
```bash
kubectl -n lms-praktikum delete job loadtest-labs 2>/dev/null
kubectl -n lms-praktikum delete -f k8s/loadtest-locust.yaml 2>/dev/null
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab
kubectl get nodes                          # CA turunkan ke 1
```

---

## F. Biaya

- Akun **Free Trial** (kredit ~SGD 400, 30 hari) — node berbayar uji beban ditanggung kredit.
- Cluster Basic + 1 node A1 = gratis. **Node ekstra & LB** = biaya (kecil bila teardown).
- **Selalu teardown** lab uji & scale node ke 1 setelah selesai.

---

## G. Status & Yang Bisa Dilanjutkan

Selesai: Fase 1–6 + optimasi image. Opsi lanjutan:
- **Pre-pull image** (DaemonSet) → scale-out instan (image sudah di node sebelum lab diminta).
- **Tuning resource** lab (request/limit) agar lebih banyak lab per node stabil.
- **Susun bab Hasil & Pembahasan** dari data: T50 vs sekarang (0% gagal), autoscaling
  reaktif+prediktif, uji beban, optimasi image (−62%), temuan pull-time.
- Reserved Public IP (agar IP tetap), HTTPS/domain.

> Deployment Docker lama (VM, http://168.110.216.236:3000) tetap online sebagai fallback
> yang berfungsi, terpisah dari cluster K8s.
