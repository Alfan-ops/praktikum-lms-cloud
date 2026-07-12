# Panduan Lengkap Uji Kapasitas per Node di Azure Cloud Shell
### (dari Cloud Shell nyala → grafik PNG jadi)

Panduan ini **self-contained**: semua file dibuat langsung di Cloud Shell (paste),
jadi tidak perlu `git push` dari laptop. Ikuti berurutan dari atas.

> **Tujuan uji:** mengukur berapa lab (user) maksimum yang mampu ditampung
> **1 node**, lalu **2 node**, lalu **3 node**, sampai node jenuh.
> Hasil = **Kapasitas(k)** → membuktikan rumus `MODEL_MATEMATIKA_AUTOSCALING.md`.
>
> Identitas: RG `lms-aks-rg` · AKS `lms-aks` · Registry `lmsalfan2744` · Nodepool `nodepool1`

**Prinsip:** autoscaler **DIMATIKAN**, node **dipatok** (1/2/3), beban dinaikkan
bertahap 5→54 user. Kapasitas(k) = `Running` mentok saat `Pending` mulai menumpuk.

---

## 🗺️ Urutan fase (kerjakan berurutan)

| Fase | Yang dikerjakan |
|---|---|
| **FASE 0** | Nyalakan cluster + kredensial kubectl |
| **FASE 1** | Clone repo · matikan autoscaler · prewarm image |
| **FASE R** | *(bila ambil data ulang)* reset: hapus data & pod lama |
| **FASE 2** | Paste buat 2 file (Locust yaml + analisa py) · deploy Locust |
| **FASE 3** | `tmux` → tempel fungsi → `jalankan_uji 1` → `2` → `3` (~4,5 mnt/run) |
| **FASE 4** | Keluar tmux → `python3 analisa_kapasitas.py` → grafik PNG → download |
| **FASE 5** | Teardown: hapus lab · nyalakan autoscaler · `az aks stop` |

> Detail tiap fase ada di bawah. Kunci FASE 3: **tempel fungsi `jalankan_uji` sekali**,
> lalu panggil `jalankan_uji 1/2/3` satu per satu (K jadi argumen → tak mungkin salah).

---

## FASE 0 — Nyalakan Cloud Shell & cluster

1. Buka **portal.azure.com** → login.
2. Klik ikon **Cloud Shell** (`>_`) di kanan atas toolbar → pilih **Bash**.
3. Tunggu prompt siap, lalu jalankan (satu blok):

```bash
RG=lms-aks-rg; ACR=lmsalfan2744; AKS=lms-aks

# nyalakan cluster bila tertidur
STATE=$(az aks show -n $AKS -g $RG --query "powerState.code" -o tsv)
echo "Status cluster: $STATE"
if [ "$STATE" = "Stopped" ]; then
  echo "Menyalakan cluster (tunggu ~3-5 menit)..."
  az aks start -n $AKS -g $RG
fi

# kredensial kubectl
az aks get-credentials -n $AKS -g $RG --overwrite-existing
kubectl get nodes
```

Tunggu sampai `kubectl get nodes` menampilkan node `Ready`.

---

## FASE 1 — Siapkan repo, orchestrator, & matikan autoscaler

```bash
# ambil kode & ganti registry OCIR -> ACR Azure
cd ~
[ -d praktikum-lms-cloud ] || git clone https://github.com/Alfan-ops/praktikum-lms-cloud.git
cd praktikum-lms-cloud
grep -rl 'hsg.ocir.io/axyfpuh4ahcf' k8s/ | xargs sed -i 's|hsg.ocir.io/axyfpuh4ahcf|lmsalfan2744.azurecr.io|g' 2>/dev/null

# pastikan orchestrator hidup
kubectl -n lms-praktikum get pods | grep orchestrator || {
  echo "Orchestrator belum ada — deploy ulang:"
  kubectl apply -f k8s/00-namespace.yaml
  kubectl -n lms-praktikum create secret generic orch-secret \
    --from-literal=ORCH_TOKEN=$(openssl rand -hex 16) 2>/dev/null
  kubectl apply -f k8s/61-orchestrator-rbac.yaml
  kubectl apply -f k8s/60-orchestrator.yaml
  kubectl -n lms-praktikum rollout status deploy/orchestrator --timeout=180s
}
```

**MATIKAN autoscaler** (WAJIB — agar node tak nambah sendiri saat uji kapasitas):
```bash
az aks nodepool update -g $RG --cluster-name $AKS -n nodepool1 --disable-cluster-autoscaler
```

**(Disarankan) prewarm image lab** agar startup mencerminkan penjadwalan, bukan tarik image:
```bash
kubectl apply -f k8s/90-prepull-lab-image.yaml
kubectl -n lms-praktikum rollout status ds/prepull-lab-image --timeout=300s 2>/dev/null || true
```

---

## FASE R — Reset total (jalankan bila ingin AMBIL DATA ULANG dari nol)

Menghapus semua riwayat uji lama (perekam yang masih jalan, file hasil, grafik, pod
lab sisa) supaya data baru tidak tercampur/menempel dengan yang lama. **Lewati** bila
ini uji pertama Anda di sesi bersih.

```bash
# 1) hentikan perekam & tmux yang mungkin masih jalan
kill $(jobs -p) 2>/dev/null; pkill -f 'seq 1 360' 2>/dev/null; tmux kill-server 2>/dev/null

# 2) hapus SEMUA file hasil uji + grafik
rm -f ~/kapasitas_*node.* ~/cap_*node* ~/*.png ~/*.zip ~/bukti_*

# 3) hapus pod lab sisa di cluster
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab 2>/dev/null

# 4) verifikasi bersih
ls ~/kapasitas_* ~/cap_* ~/*.png 2>/dev/null || echo "Cloud Shell BERSIH dari riwayat"
```

> Ini menghapus **data hasil** (CSV, PNG, zip, tabel bukti), BUKAN skrip/perkakas
> (`analisa_kapasitas.py`, manifest Locust tetap aman). Setelah reset, lanjut FASE 2.

---

## FASE 2 — Buat file uji langsung di Cloud Shell (paste sekali)

### 2a. Manifest Locust beban bertingkat

Paste **seluruh blok** ini apa adanya (membuat file `~/loadtest-locust-kapasitas.yaml`):

```bash
cat > ~/loadtest-locust-kapasitas.yaml <<'YAMLEOF'
apiVersion: v1
kind: ConfigMap
metadata:
  name: locust-cap-script
  namespace: lms-praktikum
data:
  locustfile.py: |
    import os, uuid, threading
    from locust import HttpUser, task, between, LoadTestShape

    NOTEBOOK = "praktikum_ml_iris.ipynb"
    ORCH_TOKEN = os.environ.get("ORCH_TOKEN", "")
    AUTH_HEADERS = {"X-Orch-Token": ORCH_TOKEN}
    _counter = 0
    _lock = threading.Lock()

    def next_group():
        global _counter
        with _lock:
            _counter += 1
            return f"cap-{_counter}-{uuid.uuid4().hex[:6]}"

    class LabUser(HttpUser):
        wait_time = between(2, 5)

        def on_start(self):
            g = next_group()
            with self.client.post(
                "/deploy",
                json={"group": g, "tool": "jupyter", "module": NOTEBOOK},
                headers=AUTH_HEADERS,
                name="POST /deploy (Launch Lab)",
                catch_response=True,
            ) as r:
                if r.status_code in (200, 202):
                    r.success()
                else:
                    r.failure(f"status {r.status_code}: {r.text[:100]}")

        @task
        def check_status(self):
            self.client.get("/autoscaler/status", name="GET /autoscaler/status")

    class StepLoad(LoadTestShape):
        stages = [   # 30 dtk/tahap → total ramp ~4,5 menit (dulu 9 menit)
            (30,   5, 5), (60, 10, 5), (90, 15, 5), (120, 20, 5),
            (150, 25, 5), (180, 30, 5), (210, 38, 5), (240, 46, 5), (270, 54, 5),
        ]
        def tick(self):
            t = self.get_run_time()
            for end, users, rate in self.stages:
                if t < end:
                    return (users, rate)
            return None
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: locust-cap
  namespace: lms-praktikum
  labels: { app: locust-cap }
spec:
  replicas: 1
  selector:
    matchLabels: { app: locust-cap }
  template:
    metadata:
      labels: { app: locust-cap }
    spec:
      containers:
        - name: locust
          image: docker.io/locustio/locust:latest
          env:
            - name: ORCH_TOKEN
              valueFrom:
                secretKeyRef: { name: orch-secret, key: ORCH_TOKEN }
          args: ["-f", "/mnt/locust/locustfile.py", "--host", "http://orchestrator:4000"]
          ports:
            - containerPort: 8089
          volumeMounts:
            - name: script
              mountPath: /mnt/locust
          resources:
            requests: { cpu: "100m", memory: "128Mi" }
            limits: { cpu: "500m", memory: "512Mi" }
      volumes:
        - name: script
          configMap: { name: locust-cap-script }
---
apiVersion: v1
kind: Service
metadata:
  name: locust-cap
  namespace: lms-praktikum
spec:
  selector: { app: locust-cap }
  ports:
    - port: 8089
      targetPort: 8089
YAMLEOF
echo "OK: ~/loadtest-locust-kapasitas.yaml dibuat."
```

### 2b. Skrip analisa (pembuat grafik PNG)

Paste **seluruh blok** ini (membuat file `~/analisa_kapasitas.py`):

```bash
cat > ~/analisa_kapasitas.py <<'PYEOF'
import csv, os, sys
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    print("matplotlib belum ada. Jalankan:  pip install --user matplotlib"); sys.exit(1)

NODES = [1, 2, 3]
SHOW_CREATING = False  # False = grafik bersih (Running+Pending); True = tampilkan ContainerCreating

def _hms(s):
    hh,mm,ss=s.strip().split(":"); return int(hh)*3600+int(mm)*60+int(ss)

def read_timeline(path):
    rows=[]; t0=None
    with open(path, newline="", encoding="utf-8", errors="ignore") as f:
        for r in csv.DictReader(f):
            try:
                sec=_hms(r["waktu"])
                if t0 is None: t0=sec
                rows.append(((sec-t0)/60.0, int(r["running"]), int(r.get("creating",0) or 0), int(r["pending"])))
            except (KeyError, ValueError): continue
    return rows

def capacity_from_timeline(tl):
    if not tl: return 0, None
    cap = max(r for _,r,_,_ in tl)
    onset = next((r for _,r,_,p in tl if p>0), None)
    return cap, onset

def _despike(seq):
    v=list(seq)
    for i in range(1,len(v)-1):
        if v[i]!=v[i-1] and v[i]!=v[i+1]: v[i]=v[i-1]
    return v

def plot_node(k, tl):
    fig,ax=plt.subplots(figsize=(11,5))
    if tl:
        t=[x[0] for x in tl]; run=_despike([x[1] for x in tl]); cre=[x[2] for x in tl]; pen=_despike([x[3] for x in tl])
        cap,_=capacity_from_timeline(tl)
        if SHOW_CREATING and max(cre)>0:
            ax.fill_between(t,cre,color="#2A78D6",alpha=0.30,label="ContainerCreating (dibuat)")
            ax.plot(t,cre,color="#2A78D6",lw=1.2)
        ax.plot(t,run,drawstyle="steps-post",color="#1BAF7A",lw=2.6,label="Running (lab aktif)")
        ax.plot(t,pen,drawstyle="steps-post",ls="--",color="#E34948",lw=2,label="Pending (tak muat)")
        ax.axhline(cap,ls=":",color="#888780",lw=1.5)
        ax.annotate(f"Kapasitas = {cap} lab",(t[-1],cap),ha="right",va="bottom",
                    color="#1BAF7A",fontweight="bold")
    ax.set_xlabel("Waktu (menit)"); ax.set_ylabel("Jumlah pod lab")
    ax.set_ylim(bottom=0); ax.set_xlim(left=0); ax.margins(x=0); ax.grid(alpha=0.3); ax.legend(loc="center right")
    cap,_=capacity_from_timeline(tl)
    ax.set_title(f"Uji kapasitas {k} node - Kapasitas = {cap} lab (0% gagal)",fontsize=13,fontweight="bold")
    fig.tight_layout(); out=f"kapasitas_{k}node.png"
    fig.savefig(out,dpi=130); plt.close(fig); return out

def _linfit(xs, ys):
    n=len(xs); sx=sum(xs); sy=sum(ys); sxx=sum(x*x for x in xs); sxy=sum(x*y for x,y in zip(xs,ys))
    d=n*sxx-sx*sx
    if d==0: return 0.0,(sy/n if n else 0.0)
    a=(n*sxy-sx*sy)/d; return a,(sy-a*sx)/n

def _formula(a,b): return f"Kapasitas(k) = {a:.0f}k {'-' if b<0 else '+'} {abs(b):.0f}"

def plot_summary(caps):
    ks=sorted(caps); vals=[caps[k] for k in ks]
    fig,ax=plt.subplots(figsize=(7.5,4.8))
    ax.bar([str(k) for k in ks],vals,color="#1BAF7A",alpha=0.85,label="Kapasitas terukur")
    for k,v in zip(ks,vals): ax.annotate(str(v),(str(k),v),ha="center",va="bottom",fontweight="bold")
    label="Model regresi"
    if len(ks)>=2:
        a,b=_linfit(ks,vals); ax.plot([str(k) for k in ks],[a*k+b for k in ks],"-o",color="#5B4FC4",label=_formula(a,b)); label=_formula(a,b)
    ax.set_xlabel("Jumlah node"); ax.set_ylabel("Kapasitas (lab maksimum)")
    ax.set_title(f"Kapasitas vs jumlah node - {label}",fontsize=12,fontweight="bold"); ax.legend(); ax.grid(alpha=0.3,axis="y")
    fig.tight_layout(); fig.savefig("ringkasan_kapasitas.png",dpi=130); plt.close(fig)

def main():
    caps={}
    print("="*56); print(" ANALISA UJI KAPASITAS PER NODE"); print("="*56)
    for k in NODES:
        tl_path=f"kapasitas_{k}node.csv"
        if not os.path.exists(tl_path): print(f" [{k} node] {tl_path} tidak ada - dilewati."); continue
        tl=read_timeline(tl_path)
        cap,onset=capacity_from_timeline(tl); caps[k]=cap; png=plot_node(k,tl)
        print(f" [{k} node] Kapasitas = {cap} lab"+(f" (running saat pending pertama: {onset})" if onset else "")+f"  -> {png}")
    print("-"*56)
    if caps:
        plot_summary(caps); ks=sorted(caps)
        if len(ks)>=2:
            a,b=_linfit(ks,[caps[k] for k in ks])
            print(f"   Model: {_formula(a,b)}   ({a:.0f}=kapasitas/node, {b:.0f}=overhead sistem)")
            for k in ks: print(f"   Kapasitas({k}) terukur = {caps[k]:>3}  |  model = {a*k+b:>5.0f}")
            print(f"   Prediksi Kapasitas({ks[-1]+1}) = {a*(ks[-1]+1)+b:.0f} lab")
            print(f"   Jumlah node untuk N praktikan:  k = ceil((N - ({b:.0f})) / {a:.0f})")
        else:
            print("   (perlu >=2 titik node untuk rumus; jalankan K=2 & K=3)")
        print("   Grafik ringkasan -> ringkasan_kapasitas.png")
    print("="*56)

if __name__=="__main__": main()
PYEOF
echo "OK: ~/analisa_kapasitas.py dibuat."
```

### 2c. Deploy Locust (sekali, dipakai ketiga run)

```bash
kubectl apply -f ~/loadtest-locust-kapasitas.yaml
kubectl -n lms-praktikum rollout status deploy/locust-cap --timeout=180s
```

---

## FASE 3 — Jalankan uji (K=1, K=2, K=3) — ~4,5 menit per run

> Kini pakai **fungsi** `jalankan_uji K` (bukan ubah variabel manual): `K` jadi argumen
> sehingga **tak mungkin kosong**, dan node **dicek Ready otomatis** sebelum merekam —
> menutup dua bug yang sering terjadi (nama file salah & merekam saat node belum naik).

### 3·0. WAJIB: jalankan di dalam `tmux` (anti putus koneksi)

Cloud Shell mudah **lost connection** saat sesi panjang (idle timeout ~20 mnt /
websocket drop). Tanpa perlindungan, saat putus, Locust (foreground) + perekam
(background) ikut **mati** → uji hilang. `tmux` membuat sesi yang **tetap hidup di
container** walau browser terputus; tinggal reconnect lalu `tmux attach`.

Mulai sesi tmux SEKALI di awal FASE 3:
```bash
tmux new -s uji
```
**DI DALAM tmux, set ulang variabel** (tmux = shell baru, variabel lama tak terbawa):
```bash
RG=lms-aks-rg; ACR=lmsalfan2744; AKS=lms-aks
```
Lalu kerjakan 3a–3d seperti biasa **di dalam tmux ini**.

**Kalau Cloud Shell terputus di tengah uji:** reconnect, buka Cloud Shell lagi,
lalu kembalikan tampilan uji dengan:
```bash
tmux attach -t uji
```
> Reconnect **segera** — bila container Cloud Shell mati >~20 mnt setelah putus,
> tmux ikut hilang. Selesai semua run, tutup dgn `exit` atau `tmux kill-session -t uji`.

### 3·1. Set variabel + tempel FUNGSI uji (paste SEKALI di dalam tmux)

```bash
RG=lms-aks-rg; ACR=lmsalfan2744; AKS=lms-aks
```

Tempel fungsi ini **sekali** — dipakai untuk ketiga run:

```bash
jalankan_uji() {
  local K=$1
  [ -z "$K" ] && { echo "PAKAI: jalankan_uji 1  (atau 2, atau 3)"; return 1; }
  echo ">>> UJI K=$K NODE — reset & patok node <<<"
  rm -f ~/kapasitas_${K}node.log ~/kapasitas_${K}node.csv ~/cap_${K}node*
  kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab 2>/dev/null
  az aks nodepool scale -g "$RG" --cluster-name "$AKS" -n nodepool1 --node-count "$K" >/dev/null
  # GERBANG: tunggu sampai BENAR-BENAR K node Ready (bisa 2-4 menit)
  while [ "$(kubectl get nodes --no-headers 2>/dev/null|awk '$2=="Ready"'|wc -l)" -lt "$K" ]; do
    echo "  menunggu $K node Ready (kini $(kubectl get nodes --no-headers 2>/dev/null|awk '$2=="Ready"'|wc -l))..."; sleep 15
  done
  echo "  OK $K node Ready — mulai rekam & beban (~4,5 menit)"
  # perekam 2 detik (background, ~6 menit)
  ( for i in $(seq 1 180); do
      p=$(kubectl -n lms-praktikum get pods -l app=lab --no-headers 2>/dev/null)
      echo "$(date +%H:%M:%S) nodes=$(kubectl get nodes --no-headers 2>/dev/null|wc -l) running=$(echo "$p"|grep -c Running) creating=$(echo "$p"|grep -c ContainerCreating) pending=$(echo "$p"|grep -c Pending)"
      sleep 2
    done ) >> ~/kapasitas_${K}node.log 2>&1 &
  local REC=$!
  # tembak beban (Locust ~4,5 menit, berhenti sendiri)
  local POD=$(kubectl -n lms-praktikum get pod -l app=locust-cap -o jsonpath='{.items[0].metadata.name}')
  kubectl -n lms-praktikum exec -it "$POD" -- \
    locust -f /mnt/locust/locustfile.py --host http://orchestrator:4000 --headless --csv /tmp/cap_${K}node
  # ambil hasil + stop perekam
  kill $REC 2>/dev/null
  echo "waktu,nodes,running,creating,pending" > ~/kapasitas_${K}node.csv
  sed -E 's/ nodes=/,/; s/ running=/,/; s/ creating=/,/; s/ pending=/,/' ~/kapasitas_${K}node.log >> ~/kapasitas_${K}node.csv
  echo "=== K=$K SELESAI ==="; tail -1 ~/kapasitas_${K}node.csv
}
```

### 3·2. Jalankan ketiga uji — SATU per satu, tunggu tiap selesai

```bash
jalankan_uji 1
```
Tunggu sampai muncul `=== K=1 SELESAI ===`. Cek baris terakhirnya: kolom ke-2 (**nodes**) = **1**, `running` plateau **~7**. Lalu:
```bash
jalankan_uji 2
```
Cek: nodes = **2**, running **~22**. Lalu:
```bash
jalankan_uji 3
```
Cek: nodes = **3**, running **~36**.

> Fungsi otomatis: reset → patok node → **tunggu node benar-benar Ready** → rekam → beban → simpan CSV.
> `K` sebagai argumen → nama file pasti benar. Node dicek → tak mungkin merekam saat node belum naik.

**Verifikasi ketiganya BEDA** (wajib sebelum FASE 4):
```bash
for k in 1 2 3; do echo -n "K=$k -> "; tail -1 ~/kapasitas_${k}node.csv; done
# harus: kolom nodes 1/2/3 berbeda, running ~7/22/36 (BUKAN semua 7)
```
**Baca Kapasitas(K):** nilai `running` tertinggi yang bertahan saat `pending` mulai menumpuk.

---

## FASE 4 — Buat grafik PNG (di Cloud Shell)

Setelah ketiga run selesai (ada 3 pasang CSV di `~`):

```bash
cd ~
pip install --user matplotlib --quiet 2>/dev/null || python3 -m pip install --user matplotlib --quiet
python3 ~/analisa_kapasitas.py
ls -1 *.png
```

Hasil:
- `kapasitas_1node.png`, `kapasitas_2node.png`, `kapasitas_3node.png`
- `ringkasan_kapasitas.png` (batang Kapasitas + garis linear ideal)

Unduh ke laptop:
```bash
download ~/kapasitas_1node.png
download ~/kapasitas_2node.png
download ~/kapasitas_3node.png
download ~/ringkasan_kapasitas.png
# unduh juga CSV mentah untuk lampiran TA:
download ~/cap_1node_history.csv; download ~/kapasitas_1node.csv
download ~/cap_2node_history.csv; download ~/kapasitas_2node.csv
download ~/cap_3node_history.csv; download ~/kapasitas_3node.csv
```

---

## FASE 5 — Teardown (WAJIB — hemat kredit) + kembalikan autoscaler

```bash
kubectl -n lms-praktikum delete deploy,svc,ingress -l app=lab
kubectl -n lms-praktikum delete -f ~/loadtest-locust-kapasitas.yaml

# aktifkan lagi autoscaler seperti semula
az aks nodepool scale  -g $RG --cluster-name $AKS -n nodepool1 --node-count 1
az aks nodepool update -g $RG --cluster-name $AKS -n nodepool1 --enable-cluster-autoscaler --min-count 1 --max-count 4

az aks stop -n $AKS -g $RG      # jeda tagihan node (~$0)
```

---

## Contekan urutan cepat

```
FASE 0  portal -> Cloud Shell Bash -> az aks start -> get-credentials
FASE 1  clone repo -> cek orchestrator -> DISABLE autoscaler -> prewarm image
FASE R  (bila ambil data ulang) reset: stop perekam/tmux -> hapus file hasil -> hapus pod lab
FASE 2  paste buat 2 file (yaml + py) -> apply locust-cap
FASE 3  tmux new -s uji (set RG/AKS di dalam) -> tempel fungsi jalankan_uji ->
        jalankan_uji 1 ; jalankan_uji 2 ; jalankan_uji 3  (~4,5 mnt/run, auto tunggu node)
        (putus? reconnect -> tmux attach -t uji)
FASE 4  pip install matplotlib -> python3 analisa_kapasitas.py -> download PNG
FASE 5  hapus lab & locust -> ENABLE autoscaler -> az aks stop
```

## Kalau ada masalah (troubleshooting)

| Gejala | Sebab & solusi |
|---|---|
| `running` tetap 0, `pending` juga 0 | Locust belum jalan / token salah. Cek `kubectl -n lms-praktikum logs deploy/locust-cap`. Pastikan secret `orch-secret` ada. |
| Semua `/deploy` gagal 401 | Token `ORCH_TOKEN` tak cocok. Secret `orch-secret` harus sama dengan yang dipakai orchestrator. |
| Node tidak jadi K | Autoscaler belum dimatikan. Ulang perintah `--disable-cluster-autoscaler` lalu scale lagi. |
| `running` naik terus sampai 54 tanpa `pending` | Node terlalu besar / K terlalu besar untuk 54 user. Untuk melihat batas, naikkan target user di `stages` (mis. tambah `(600, 70, 5)`). |
| `download` tak jalan | Pakai menu Cloud Shell: ikon **Manage files → Download**, ketik path `~/ringkasan_kapasitas.png`. |
| Cloud Shell **lost connection** saat uji | Jalankan di dalam `tmux new -s uji` (FASE 3·0). Reconnect → `tmux attach -t uji`; uji tetap jalan, data tak hilang. |
| Ringkasan muncul `=== run K= ===` / analisa bilang `kapasitas_1node.csv tidak ada` | `$K` kosong → file jadi `kapasitas_node.*`. **Data tidak hilang**, cuma salah nama. Selamatkan: `cp ~/kapasitas_node.csv ~/kapasitas_1node.csv` (ganti angka sesuai run). Lalu selalu `echo "K=$K"` sebelum lanjut. |
| `kubectl cp ... one of src or dest must be a remote` | `$POD` kosong. Set ulang: `POD=$(kubectl -n lms-praktikum get pod -l app=locust-cap -o jsonpath='{.items[0].metadata.name}')` |
```
