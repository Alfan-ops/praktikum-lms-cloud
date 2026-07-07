# Panduan Uji Beban 30 User di Azure AKS (Headless & Web UI)

Cara mengambil data uji autoscaling 30 user di cluster **Azure AKS** — untuk metrik:
- **Response time** & **tingkat kegagalan** (dari Locust)
- **Waktu sampai 30 lab siap** & **scale-out node** (dari perekam timeline)

> Identitas: RG `lms-aks-rg` · Cluster `lms-aks` · Registry `lmsalfan2744.azurecr.io` · Nodepool `nodepool1`

---

## 0. Persiapan (selalu dilakukan lebih dulu)

Buka **Azure Cloud Shell (Bash)** → jalankan:

```bash
RG=lms-aks-rg; ACR=lmsalfan2744; AKS=lms-aks

# nyalakan cluster bila tertidur
az aks show -n $AKS -g $RG --query "powerState.code" -o tsv
# jika "Stopped": az aks start -n $AKS -g $RG   (tunggu ~3-5 menit)

# kredensial kubectl
az aks get-credentials -n $AKS -g $RG --overwrite-existing

# repo + ganti registry OCIR -> ACR
cd ~
[ -d praktikum-lms-cloud ] || git clone https://github.com/Alfan-ops/praktikum-lms-cloud.git
cd praktikum-lms-cloud
grep -rl 'hsg.ocir.io/axyfpuh4ahcf' k8s/ | xargs sed -i 's|hsg.ocir.io/axyfpuh4ahcf|lmsalfan2744.azurecr.io|g' 2>/dev/null

# pastikan orchestrator hidup
kubectl -n lms-praktikum get pods | grep orchestrator
```

Jika orchestrator tidak ada, deploy ulang:
```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl -n lms-praktikum create secret generic orch-secret --from-literal=ORCH_TOKEN=$(openssl rand -hex 16) 2>/dev/null
kubectl apply -f k8s/61-orchestrator-rbac.yaml
kubectl apply -f k8s/60-orchestrator.yaml
kubectl -n lms-praktikum rollout status deploy/orchestrator --timeout=180s
```

### Reset baseline ke 1 node (agar grafik scale-out bersih dari awal)
```bash
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab 2>/dev/null
kubectl -n lms-praktikum delete -f k8s/loadtest-locust.yaml 2>/dev/null

az aks nodepool update -g $RG --cluster-name $AKS -n nodepool1 --disable-cluster-autoscaler
az aks nodepool scale  -g $RG --cluster-name $AKS -n nodepool1 --node-count 1
az aks nodepool update -g $RG --cluster-name $AKS -n nodepool1 --enable-cluster-autoscaler --min-count 1 --max-count 4

kubectl get nodes   # WAJIB: 1 node Ready + autoscaler AKTIF sebelum uji
```

> PENTING: autoscaler HARUS `--enable-cluster-autoscaler` kembali. Kalau lupa, node tak akan bertambah saat uji.

### Perekam timeline (dipakai di KEDUA mode)
Jalankan tepat sebelum menembak beban — mencatat node & lab tiap 15 detik:
```bash
( for i in $(seq 1 50); do
    echo "$(date +%H:%M:%S) nodes=$(kubectl get nodes --no-headers 2>/dev/null|wc -l) running=$(kubectl -n lms-praktikum get pods -l app=lab --no-headers 2>/dev/null|grep -c Running) pending=$(kubectl -n lms-praktikum get pods -l app=lab --no-headers 2>/dev/null|grep -c Pending)"
    sleep 15
  done ) >> ~/aks_timeline.log 2>&1 &
echo "Perekam jalan (PID $!)"
```

---

## MODE A — Headless (otomatis, tanpa UI)

Nilai uji tertanam di perintah; Locust jalan sendiri lalu berhenti. **Tidak ada input manual.**

```bash
# deploy Locust
kubectl apply -f k8s/loadtest-locust.yaml
kubectl -n lms-praktikum rollout status deploy/locust --timeout=180s
POD=$(kubectl -n lms-praktikum get pod -l app=locust -o jsonpath='{.items[0].metadata.name}')

# (nyalakan perekam timeline di sini - lihat bagian 0)

# tembak 30 user, 6 menit
kubectl -n lms-praktikum exec -it "$POD" -- \
  locust -f /mnt/locust/locustfile.py --host http://orchestrator:4000 \
  --headless -u 30 -r 5 -t 6m --html /tmp/report.html --csv /tmp/lms
```

- `-u 30` = 30 user · `-r 5` = spawn 5/detik · `-t 6m` = jalan 6 menit
- **Di mana Locust terlihat:** di **terminal Cloud Shell** (tabel teks tiap ~2 detik). Bukan halaman web.

### Ambil data (headless)
```bash
# laporan HTML + CSV ada DI DALAM pod -> salin ke home
kubectl cp lms-praktikum/$POD:/tmp/report.html          ~/report.html
kubectl cp lms-praktikum/$POD:/tmp/lms_stats.csv        ~/lms_stats.csv
kubectl cp lms-praktikum/$POD:/tmp/lms_failures.csv     ~/lms_failures.csv
kubectl cp lms-praktikum/$POD:/tmp/lms_stats_history.csv ~/lms_stats_history.csv

# unduh ke laptop (perintah bawaan Cloud Shell)
download ~/report.html
download ~/lms_stats.csv
```
Simpan juga baris ringkasan `Aggregated` yang muncul di terminal.

---

## MODE B — Web UI (grafik real-time, input manual)

```bash
# deploy Locust (mode web UI - manifest default TANPA --headless)
kubectl apply -f k8s/loadtest-locust.yaml
kubectl -n lms-praktikum rollout status deploy/locust --timeout=180s

# (nyalakan perekam timeline di sini - lihat bagian 0)

# jembatan port (biarkan menggantung). Port lokal 8091 (valid utk Web Preview Azure)
kubectl -n lms-praktikum port-forward svc/locust 8091:8089
```

Buka UI:
1. Toolbar Cloud Shell → ikon **Web Preview** (`{}` / monitor) → **Configure**
2. Port **`8091`** → **Buka dan telusuri** → tab baru = UI Locust

**Input nilai (SAAT UI terbuka):**
- Number of users: `30`
- Spawn rate: `5`
- Host: `http://orchestrator:4000`
- klik **Start** → buka tab **Charts** (RPS, Response Times, Failures/s)

> Batasan port Web Preview Azure: **1025-8079** atau **8091-49151** (8080-8090 dilarang → pakai 8091).

### Ambil data (Web UI)
- Tab **DOWNLOAD DATA** → **Download Report** (HTML) + **Download requests CSV**.
  - Jika tombol download tak berfungsi (blokir Web Preview): buka Report, tekan **Ctrl+P → Save as PDF**.
- **Screenshot** tab **STATISTICS** (0% Fails) & **CHARTS**.
- Klik **STOP** setelah ~6-10 menit.

---

## Data timeline (kedua mode) → grafik

Setelah uji, ambil timeline:
```bash
cat ~/aks_timeline.log
```

Ekspor ke CSV untuk grafik di Excel/Sheets:
```bash
echo "waktu,nodes,running,pending" > ~/aks_timeline.csv
sed -E 's/ nodes=/,/; s/ running=/,/; s/ pending=/,/' ~/aks_timeline.log >> ~/aks_timeline.csv
download ~/aks_timeline.csv
```
Buka di Excel/Google Sheets → Insert → Chart (Line): sumbu-X waktu, garis `running`, `pending`, `nodes`.

Metrik kunci yang dibaca dari timeline:
- **Waktu sampai 30 lab siap** = selisih waktu `running=0` pertama → `running=30`
- **Scale-out node** = kapan `nodes` naik 1 → 3

---

## Teardown (WAJIB setelah selesai — hemat kredit)

```bash
kill %1 2>/dev/null                                            # hentikan perekam
kubectl -n lms-praktikum delete -f k8s/loadtest-locust.yaml    # hentikan Locust
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab  # hapus 30 lab
kubectl get nodes                                              # node turun ke 1 (~10 mnt)

az aks stop -n $AKS -g $RG                                     # jeda tagihan node (~$0)
# nyalakan lagi nanti: az aks start -n $AKS -g $RG
```

> Cek sisa kredit: portal.azure.com → cari "Education" → Overview (kartu "Kredit yang tersedia").

---

## Ringkasan perbedaan

| | Headless | Web UI |
|---|---|---|
| Input di Locust | Tidak (di perintah) | Ya (30 user, saat UI terbuka) |
| Locust terlihat di | Terminal Cloud Shell (teks) | Browser (Web Preview port 8091) |
| Grafik real-time | Tidak | Ya (tab Charts) |
| Ambil laporan | `kubectl cp` dari pod → `download` | DOWNLOAD DATA / Ctrl+P PDF |
| Cocok untuk | Data cepat & reproducible | Demo live & screenshot grafik |

Metrik akhir tetap sama: **30 lab siap, 0% gagal, node 1→3**.
