# Panduan Uji Kapasitas per Node (1, 2, 3 Node) — Azure AKS

Tujuan: mengukur **berapa lab (user) maksimum** yang mampu ditampung **1 node**,
lalu **2 node**, lalu **3 node**, sampai node jenuh (pod `Pending` menumpuk /
response time melonjak). Hasilnya = nilai **Kapasitas(k)** yang membuktikan rumus
di `MODEL_MATEMATIKA_AUTOSCALING.md`.

> Identitas: RG `lms-aks-rg` · AKS `lms-aks` · Registry `lmsalfan2744.azurecr.io` · Nodepool `nodepool1`

**Prinsip uji:** autoscaler **DIMATIKAN**, node **dipatok** ke jumlah tetap (1/2/3),
lalu beban dinaikkan bertahap 5→54 user (LoadTestShape). Sinyal jenuh:
- **KERAS** → `Running` mentok (plateau) & `Pending` mulai naik = **Kapasitas(k)**
- **LUNAK** → response time (p95) Locust melonjak = node mulai sesak

---

## 0. Persiapan sekali (di awal semua sesi)

Buka **Azure Cloud Shell (Bash)**:

```bash
RG=lms-aks-rg; ACR=lmsalfan2744; AKS=lms-aks

az aks show -n $AKS -g $RG --query "powerState.code" -o tsv     # jika Stopped:
# az aks start -n $AKS -g $RG   (tunggu ~3-5 menit)
az aks get-credentials -n $AKS -g $RG --overwrite-existing

cd ~; [ -d praktikum-lms-cloud ] || git clone https://github.com/Alfan-ops/praktikum-lms-cloud.git
cd praktikum-lms-cloud
grep -rl 'hsg.ocir.io/axyfpuh4ahcf' k8s/ | xargs sed -i 's|hsg.ocir.io/axyfpuh4ahcf|lmsalfan2744.azurecr.io|g' 2>/dev/null

kubectl -n lms-praktikum get pods | grep orchestrator     # pastikan hidup
```

**MATIKAN autoscaler** (wajib — agar node tidak nambah sendiri saat uji kapasitas):
```bash
az aks nodepool update -g $RG --cluster-name $AKS -n nodepool1 --disable-cluster-autoscaler
```

**(Opsional tapi disarankan) prewarm image lab** agar startup mencerminkan
penjadwalan, bukan tarik image:
```bash
kubectl apply -f k8s/90-prepull-lab-image.yaml   # tunggu daemonset Ready
```

Deploy Locust-kapasitas (sekali saja, dipakai untuk ketiga run):
```bash
kubectl apply -f k8s/loadtest-locust-kapasitas.yaml
kubectl -n lms-praktikum rollout status deploy/locust-cap --timeout=180s
```

---

## 1. Prosedur satu run (ULANGI untuk k = 1, lalu 2, lalu 3)

Ganti `K` di bawah dengan 1, 2, atau 3.

### (a) Patok jumlah node = K, reset lab ke nol
```bash
K=1     # <-- ubah ke 1, lalu 2, lalu 3 di run berikutnya

# reset hasil run K ini (cegah data run lama menempel / "riwayat")
rm -f ~/kapasitas_${K}node.log ~/kapasitas_${K}node.csv ~/cap_${K}node*.csv ~/cap_${K}node.html
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab 2>/dev/null
az aks nodepool scale -g $RG --cluster-name $AKS -n nodepool1 --node-count $K
kubectl get nodes                      # WAJIB: tepat K node Ready sebelum lanjut
```

### (b) Nyalakan perekam timeline (khusus run ini)
```bash
( for i in $(seq 1 360); do
    pods=$(kubectl -n lms-praktikum get pods -l app=lab --no-headers 2>/dev/null)
    echo "$(date +%H:%M:%S) nodes=$(kubectl get nodes --no-headers 2>/dev/null|wc -l) running=$(echo "$pods"|grep -c Running) creating=$(echo "$pods"|grep -c ContainerCreating) pending=$(echo "$pods"|grep -c Pending)"
    sleep 2
  done ) >> ~/kapasitas_${K}node.log 2>&1 &
REC=$!; echo "Perekam run K=$K jalan tiap 2 dtk (PID $REC)"
```

### (c) Tembak beban bertingkat (Locust jalan ~9 menit lalu berhenti sendiri)
```bash
POD=$(kubectl -n lms-praktikum get pod -l app=locust-cap -o jsonpath='{.items[0].metadata.name}')
kubectl -n lms-praktikum exec -it "$POD" -- \
  locust -f /mnt/locust/locustfile.py --host http://orchestrator:4000 \
  --headless --html /tmp/cap_${K}node.html --csv /tmp/cap_${K}node
```
> Jumlah user & durasi DIATUR oleh skrip (LoadTestShape 5→54 user, 9 menit).
> Jangan tambah `-u`/`-t`; keduanya diabaikan saat ada shape.

### (d) Ambil data run ini
```bash
kubectl cp lms-praktikum/$POD:/tmp/cap_${K}node_stats.csv          ~/cap_${K}node_stats.csv
kubectl cp lms-praktikum/$POD:/tmp/cap_${K}node_stats_history.csv  ~/cap_${K}node_history.csv
kubectl cp lms-praktikum/$POD:/tmp/cap_${K}node.html               ~/cap_${K}node.html
kill $REC 2>/dev/null

# ekspor timeline -> CSV
echo "waktu,nodes,running,creating,pending" > ~/kapasitas_${K}node.csv
sed -E 's/ nodes=/,/; s/ running=/,/; s/ creating=/,/; s/ pending=/,/' ~/kapasitas_${K}node.log >> ~/kapasitas_${K}node.csv

download ~/cap_${K}node_history.csv
download ~/kapasitas_${K}node.csv
download ~/cap_${K}node.html
```

### (e) Baca hasilnya (langsung di terminal)
```bash
cat ~/kapasitas_${K}node.csv
```
- **Kapasitas(K)** = nilai `running` TERTINGGI yang bertahan saat `pending` mulai > 0
  dan terus naik. Contoh: kalau `running` mentok di 12 sementara `pending` naik
  4,9,17… → Kapasitas(1 node) = **12 lab**.

---

## 2. Setelah ketiga run selesai

Anda punya 3 pasang file: `cap_{1,2,3}node_history.csv` + `kapasitas_{1,2,3}node.csv`.
Taruh keenamnya di folder proyek laptop, lalu:

```powershell
py analisa_kapasitas.py
```
Skrip menghasilkan:
- Grafik PNG: **user vs response-time** dan **user vs Running/Pending** per node
- Tabel Kapasitas(1), Kapasitas(2), Kapasitas(3) + uji linearitas (≈ k × Kapasitas(1))

---

## 3. Teardown (WAJIB — hemat kredit) + kembalikan autoscaler

```bash
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab
kubectl -n lms-praktikum delete -f k8s/loadtest-locust-kapasitas.yaml

# aktifkan lagi autoscaler seperti semula (agar uji autoscaling normal tetap jalan)
az aks nodepool scale  -g $RG --cluster-name $AKS -n nodepool1 --node-count 1
az aks nodepool update -g $RG --cluster-name $AKS -n nodepool1 --enable-cluster-autoscaler --min-count 1 --max-count 4

az aks stop -n $AKS -g $RG     # jeda tagihan
```

---

## Ringkasan urutan (contekan cepat)

```
Persiapan: az aks start -> get-credentials -> DISABLE autoscaler -> apply locust-cap
Untuk K = 1, 2, 3:
   scale node=K -> rekam timeline -> jalankan Locust (9 mnt) -> cp CSV -> baca kapasitas
Analisa: py analisa_kapasitas.py  -> grafik PNG + tabel
Teardown: hapus lab & locust -> ENABLE autoscaler -> az aks stop
```
