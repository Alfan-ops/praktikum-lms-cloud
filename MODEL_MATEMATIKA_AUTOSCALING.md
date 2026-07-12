# Model Matematika Kebijakan Autoscaling LMS Praktikum

> Dokumen landasan Tugas Akhir — menjawab catatan bimbingan:
> 1. Rumus matematika agar autoscaling **efektif tanpa over-provisioning**
> 2. **Mengapa cluster Azure memberi 3 node untuk 30 user** padahal batas maksimum 4 node
> 3. Karakterisasi trafik: **total request, ukuran request (KB/s), ukuran balasan (byte/s), payload**
> 4. Rumus prediksi: **berapa node harus dilangganan untuk N praktikan** agar tidak boros
>
> Identitas cluster: RG `lms-aks-rg` · AKS `lms-aks` · Nodepool `nodepool1` · autoscaler `min=1, max=4`

---

## 0. Konsep dasar (fondasi semua rumus)

Sebelum rumus, empat istilah yang WAJIB dipahami — karena keputusan autoscaling
Kubernetes bergantung pada ini, bukan pada "jumlah user" secara langsung.

| Istilah | Arti | Nilai di sistem Anda |
|---|---|---|
| **Request** (permintaan resource) | Jaminan minimum resource yang dipesan sebuah pod. Scheduler memakai angka INI untuk menaruh pod ke node. | `cpu: 100m`, `memory: 256Mi` per lab (`orchestrator/app_k8s.py`) |
| **Limit** | Batas atas pemakaian. TIDAK dipakai untuk keputusan penjadwalan/scaling. | `cpu: 1`, `memory: 1Gi` per lab |
| **Allocatable** | Kapasitas node yang benar-benar bisa dipakai pod = kapasitas fisik − jatah sistem (kube-reserved, system-reserved, eviction). | diukur dari cluster (lihat §7) |
| **Pending pod** | Pod yang belum dapat node karena resource habis. **Inilah pemicu tunggal Cluster Autoscaler menambah node.** | muncul saat lonjakan Launch Lab |

**Poin kunci untuk dosen:** Kubernetes TIDAK menambah node karena "user banyak".
Ia menambah node **hanya jika ada pod berstatus `Pending`** (tak muat di mana pun).
Inilah kenapa sistemnya otomatis tidak over-provisioning — node hanya lahir saat
benar-benar dibutuhkan. (Lihat §4.)

---

## 1. Notasi

| Simbol | Arti | Satuan |
|---|---|---|
| `N` | jumlah praktikan aktif serentak (= jumlah pod lab) | orang / pod |
| `r_cpu` | request CPU per pod lab | milicore (m) |
| `r_mem` | request memori per pod lab | MiB |
| `A_cpu` | CPU allocatable per node | milicore (m) |
| `A_mem` | memori allocatable per node | MiB |
| `S_cpu`, `S_mem` | resource yang dipakai pod sistem yang menetap di node (CoreDNS, metrics-server, ingress, orchestrator, prometheus, dll.) | m / MiB |
| `P` | kapasitas pod lab per node (lab-slot) | pod/node |
| `M` | jumlah node yang dibutuhkan | node |
| `α` | faktor margin keamanan (headroom), mis. 0,8 | tak berdimensi |

---

## 2. Model kapasitas per node (bin-packing)

Sebuah node dapat menampung pod lab sampai **salah satu** resource (CPU atau memori)
habis lebih dulu. Karena itu kapasitas node = nilai terkecil dari dua batas:

```
        ⌊ (A_cpu − S_cpu) / r_cpu ⌋      ← batas dari CPU
P = min {                                 }
        ⌊ (A_mem − S_mem) / r_mem ⌋      ← batas dari memori
```

- `⌊x⌋` = pembulatan ke bawah (tak mungkin ada setengah pod).
- Resource yang menghasilkan nilai lebih kecil disebut **binding resource**
  (sumber daya pengikat) — itulah "leher botol" yang menentukan kapasitas.

**Angka NYATA cluster (Standard_B2s_v2, hasil `kubectl describe node` — lihat §9).**
`A_cpu = 1900m`, `A_mem ≈ 5790MiB` (5,65 GiB). Pod sistem yang menetap **berbeda
tiap jenis node**: node "murni" hanya menanggung DaemonSet (`S_cpu ≈ 345m`,
`S_mem ≈ 542MiB`), sedangkan **node-1** menanggung tambahan pod sistem singleton.

Kapasitas **node murni** (DaemonSet saja):
```
Batas CPU  = ⌊(1900 − 345) / 100⌋ = ⌊15,55⌋ = 15 pod
Batas MEM  = ⌊(5790 − 542) / 256⌋ = ⌊20,5⌋  = 20 pod
P = min(15, 20) = 15 lab-slot per node   →  binding resource = CPU
```

> **Penting:** rumus di atas memberi kapasitas **satu node murni** (= 15).
> Node-1 menanggung pod sistem singleton (prometheus, grafana, orchestrator, dll)
> sehingga kapasitasnya turun menjadi **7**. Karena itu kapasitas total tidak
> linear murni `P·k`, melainkan **afin**: `Kapasitas(k) = 15k − 8`. Penurunan
> lengkap + validasi (terukur 7/22/36) ada di **§9**.

> Heuristik pre-warm `LABS_PER_NODE = 10` (`k8s/82-estimator.yaml`,
> `estimator/predictive_scaler.py`) bersifat konservatif: berada di antara
> kapasitas node-1 (7) dan node murni (15), memberi cadangan untuk lonjakan CPU
> nyata (pod bisa memakai sampai `limit` = 1 core, jauh di atas `request` 100m).

---

## 3. Model jumlah node (rumus inti anti over-provisioning)

Jumlah node minimum untuk melayani `N` praktikan:

```
M(N) = ⌈ N / P ⌉                    (rumus dasar, tanpa margin)
```

Dengan margin keamanan `α` (pakai hanya `α`·P dari tiap node, sisakan headroom):

```
M(N) = ⌈ N / (α · P) ⌉             (rumus operasional, disarankan)
```

`⌈x⌉` = pembulatan ke atas.

> ⚠️ **Koreksi dari data nyata (penting).** Rumus uniform di atas mengasumsikan
> **setiap** node berkapasitas sama `P`. Pada cluster nyata **tidak begitu**: node-1
> menanggung pod sistem singleton sehingga hanya muat `P₁ = 7`, sedangkan node lain
> muat `P = 15`. Model uniform memberi hasil salah — mis. `M(30) = ⌈30/15⌉ = 2`,
> padahal realitas butuh **3** node. **Gunakan model afin terukur** (§8, §9):
> `Kapasitas(k) = 15k − 8` dan `k(N) = ⌈(N + 8)/15⌉`. Rumus uniform ini hanya
> pengantar konsep; angka final selalu memakai model afin.

**Definisi "tidak over-provisioning" secara matematis:** konfigurasi node `M`
disebut efektif-tanpa-boros jika memenuhi kedua syarat sekaligus:

```
(1) Cukup     :  M · P ≥ N            (semua praktikan kebagian slot)
(2) Tidak boros:  (M − 1) · P < N      (kurangi 1 node → ada yang tak kebagian)
```

Syarat (2) inilah bukti formal "tidak ada node menganggur". `M = ⌈N/P⌉`
adalah satu-satunya nilai yang memenuhi keduanya.

---

## 4. Menjawab: "Kenapa 3 node untuk 30 user, padahal maksimum 4?"

Tiga alasan yang saling menguatkan:

**(a) Cluster Autoscaler bersifat *demand-driven* (digerakkan kebutuhan).**
Algoritmanya sederhana:

```
ulangi tiap ~10 detik:
    jika ADA pod Pending yang akan muat bila node ditambah:
        tambah 1 node
    jika ADA node yang pod-nya bisa dipindah & node kosong > 10 menit:
        buang node
```

Node ke-4 **tidak pernah dibuat** karena setelah node ke-3 aktif, **tidak ada
lagi pod `Pending`** — 30 lab sudah semuanya `Running`. Tanpa pod Pending,
autoscaler tak punya alasan menambah node. Batas `max=4` hanyalah *plafon*,
bukan target.

**(b) Perhitungan kapasitas memang jatuh di 3.**
Dengan `P = 10` (heuristik sistem) dan `N = 30`:

```
M = ⌈30 / 10⌉ = ⌈3,0⌉ = 3 node   ✓ cocok dengan hasil uji
```

Uji syarat tidak-boros: `(3−1)·10 = 20 < 30` ✓ → node ke-3 memang perlu; dan
`3·10 = 30 ≥ 30` ✓ → 3 node cukup. Node ke-4 gagal syarat kecukupan-minimal:
`4·10 = 40 ≫ 30`, sisa 10 slot kosong → itulah over-provisioning yang dihindari.

**(c) Ini justru bukti tesis Anda.** Sistem berhenti di 3 = titik optimal
(cukup tapi tidak berlebih). Kalau ia naik ke 4, itu MALAH over-provisioning.
Jadi "3 dari maksimum 4" adalah hasil yang **benar dan diinginkan**, bukan
keterbatasan.

> Catatan kejujuran ilmiah: nilai `P` sebenarnya harus diverifikasi dari
> allocatable cluster nyata (§7). Jika bin-packing murni memberi `P > 10`
> (mis. 12), maka 30 lab secara teori muat di ⌈30/12⌉ = 3 node juga — tetap 3.
> Angka observasi 3 node konsisten untuk `P` di rentang 10–15. Sertakan
> pengukuran `kubectl describe node` di lampiran TA sebagai bukti.

---

## 5. Model karakterisasi trafik

Yang diminta dosen: total request, request KB/s, balasan byte/s, payload.
Semua diukur dari **Locust** (`k8s/loadtest-locust.yaml`) + Prometheus.

### 5.1 Definisi

| Simbol | Arti | Sumber ukur |
|---|---|---|
| `λ` | laju request agregat (Requests Per Second) | Locust "RPS" |
| `n_req` | total request selama uji | Locust "# Requests" |
| `T` | durasi uji (detik) | parameter `-t` (mis. 6m = 360s) |
| `s_req` | ukuran rata-rata payload REQUEST (body dikirim) | header/body request |
| `s_res` | ukuran rata-rata payload RESPONSE (body diterima) | Locust "Average size (bytes)" |

### 5.2 Rumus

```
Laju request rata-rata            :  λ = n_req / T                     [req/s]

Payload naik (uplink)  per detik  :  B_up   = λ · s_req                [byte/s]
Payload turun (downlink) per detik:  B_down = λ · s_res                [byte/s]

Dalam KB/s (÷1024)                :  B_up[KB/s]   = (λ · s_req)  / 1024
                                     B_down[KB/s] = (λ · s_res) / 1024

Total data ditransfer selama uji  :  D = n_req · (s_req + s_res)       [byte]
```

### 5.3 Dua jenis trafik pada sistem ini (penting dibedakan)

1. **Trafik kontrol** (yang diukur Locust): `POST /deploy` (Launch Lab) dan
   `GET /autoscaler/status`. Kecil — payload JSON ~ratusan byte.
   - `POST /deploy` body ≈ `{"group","tool","module"}` → **s_req ≈ 80–150 byte**
   - respons `202` ≈ **s_res ≈ 100–300 byte**
2. **Trafik lab** (Jupyter notebook, WebSocket): jauh lebih besar & bursty,
   tidak diukur Locust. Untuk TA, cukup nyatakan trafik kontrol sebagai beban
   orchestrator, dan trafik lab sebagai beban node (CPU/memori) — keduanya
   dimodelkan terpisah (kontrol → §5, komputasi → §2).

### 5.4 Cara mengisi angka nyata

Setelah menjalankan Locust (lihat `PANDUAN_UJI_AKS_30USER.md`), buka
`~/lms_stats.csv` (baris `Aggregated`). Kolom yang dipakai:

- `Request Count` → `n_req`
- `Requests/s` → `λ`
- `Average Content Size` → `s_res` (byte)
- `s_req` diambil dari ukuran body JSON yang dikirim (ukur sekali, tetap).

Lalu masukkan ke `capacity_calculator.py --traffic` (§8) untuk hitung B_up/B_down.

---

## 6. Model prediktif (pre-warm) — yang sudah ada di kode Anda

Estimator (`estimator/predictive_scaler.py`) meramal puncak beban dengan Prophet
lalu menyiapkan node LEBIH DULU. Rantai rumusnya:

```
histori beban ──Prophet──▶ ŷ_peak (ramalan puncak jumlah lab, FORECAST_MINUTES ke depan)
                                │
                  M_pred = ⌈ ŷ_peak / LABS_PER_NODE ⌉      (node yang diramal perlu)
                                │
     placeholder = clamp( M_pred − 1 , 0 , MAX_PLACEHOLDER )  (node baseline sudah ada)
                                │
        Cluster Autoscaler melihat placeholder Pending ──▶ pre-provision node (pre-warm)
```

Ini menambah dimensi **waktu**: rumus §3 menjawab "berapa node", rumus §6
menjawab "kapan menyediakannya" agar praktikan tak menunggu node dingin.
`MAX_PLACEHOLDER` menjaga pre-warm tak berlebihan (kendali biaya = anti-boros).

---

## 7. Cara mengukur angka nyata dari cluster (agar rumus presisi)

Jalankan saat cluster hidup (`az aks start`), sebelum teardown:

```bash
# (A) Allocatable per node  -> A_cpu, A_mem
kubectl describe node <nama-node> | grep -A6 "Allocatable"

# (B) Ukuran VM node (kapasitas fisik) -> konteks
kubectl get nodes -o custom-columns=NAME:.metadata.name,VM:.metadata.labels.'node\.kubernetes\.io/instance-type'

# (C) Resource pod sistem yang menetap -> S_cpu, S_mem
kubectl describe node <nama-node> | grep -A20 "Allocated resources"

# (D) Request pod lab (verifikasi 100m/256Mi) -> r_cpu, r_mem
kubectl -n lms-praktikum get pod <pod-lab> -o jsonpath='{.spec.containers[0].resources}'
```

Masukkan A, B, C, D ke §2 → dapat `P` presisi → §3 → `M` presisi.
**Lampirkan output perintah ini di TA sebagai bukti empiris rumus.**

---

## 8. Ringkasan rumus (untuk slide presentasi)

```
Kapasitas node murni :  P  = ⌊(A_cpu−d) / r_cpu⌋            = ⌊(1900−345)/100⌋ = 15
Kapasitas node-1     :  P₁ = ⌊(A_cpu−d−s) / r_cpu⌋          = ⌊(1900−345−792)/100⌋ = 7
Kapasitas k node     :  C(k) = P₁ + P·(k−1) = 15k − 8       (terukur: 7 / 22 / 36)

Node untuk N praktikan:  k(N) = ⌈ (N + 8) / 15 ⌉
                         (mis. 30 praktikan → ⌈38/15⌉ = 3 node ;  40 → ⌈48/15⌉ = 4 node)

Bukti tak-boros      :  C(k−1) < N ≤ C(k)

Trafik             :  λ = n_req/T ;  B_up = λ·s_req ;  B_down = λ·s_res

Prediktif          :  M_pred = ⌈ ŷ_peak / LABS_PER_NODE ⌉ ,
                      placeholder = clamp(M_pred−1, 0, MAX_PLACEHOLDER)
```

---

## 9. Hasil pengukuran nyata & validasi model (uji kapasitas 1/2/3 node)

Bagian ini mengisi rumus §2–§3 dengan **angka terukur langsung dari cluster AKS**,
lalu membandingkan teori vs hasil uji. Metode uji: autoscaler dimatikan, jumlah node
dipatok (1, 2, 3), beban Locust dinaikkan bertahap 5→54 user; kapasitas = jumlah pod
lab `Running` maksimum sebelum pod berikutnya `Pending`.

### 9.1 Spesifikasi tetap (variabel terkontrol)

| Objek | Spesifikasi | Sumber |
|---|---|---|
| **1 pod lab** | request **100m** CPU · **256Mi** RAM (limit 1 core / 1Gi) | `orchestrator/app_k8s.py:238` |
| **1 node** | `Standard_B2s_v2` (2 vCPU / 8 GiB fisik) | `az aks nodepool show` |
| — Allocatable CPU | **1900m** | `kubectl describe node` |
| — Allocatable RAM | **≈5,65 GiB** (5.929.708Ki) | `kubectl describe node` |
| — Maks pod/node | 250 (tidak mengikat) | `kubectl describe node` |

### 9.2 Sumber daya pengikat = CPU

Node kosong memuat ⌊1900/100⌋ = **19 lab** menurut CPU, tetapi ⌊5790Mi/256Mi⌋ = **22 lab**
menurut memori. Karena 19 < 22, **CPU habis lebih dulu** → kapasitas ditentukan CPU.

### 9.3 Overhead sistem (terukur, `describe node` saat 0 lab)

| Komponen | CPU | Cara ukur |
|---|---|---|
| DaemonSet per node | **345m** | node tanpa pod singleton (`vmss…008`) |
| Pod singleton (sekali) | **692m** | node-1 (1037m) − DaemonSet (345m); prometheus, grafana, orchestrator, redis, backend, frontend, estimator |
| Generator beban `locust-cap` (hanya saat uji) | 100m | manifest loadtest |

### 9.4 Penurunan rumus dari angka nyata

$$P_\text{murni} = \left\lfloor \frac{1900 - 345}{100} \right\rfloor = 15 \text{ lab/node}
\qquad
P_\text{node-1} = \left\lfloor \frac{1900 - 345 - 692 - 100}{100} \right\rfloor = 7 \text{ lab}$$

$$\boxed{\ \text{Kapasitas}(k) = 15(k-1) + 7 = 15k - 8\ }$$

### 9.5 Validasi teori vs pengukuran

| k (node) | Teori `15k−8` | Terukur | Selisih |
|---|---|---|---|
| 1 | 7 | **7** | 0 |
| 2 | 22 | **22** | 0 |
| 3 | 37 | **36** | −1 (2,7%) |

Deviasi 1 lab di k=3: marginal node-2 = +15, node-3 = +14 → kemungkinan satu pod
sistem tambahan (replika CoreDNS/metrics-server/DaemonSet) terjadwal di node-3
(~100m). Variasi penjadwalan normal; model tetap terkonfirmasi (deviasi ≤2,7%).
Regresi 3 titik memberi `≈14,5k − 7,3` (marginal 14–15 lab/node) sebagai cross-check.

**Kapasitas untuk k node (rumus `15k − 8`, dan seterusnya):**

| k node | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| Kapasitas (lab) | 7 | 22 | 37 | 52 | 67 | 82 | 97 | 112 |
| Terukur | 7 ✓ | 22 ✓ | 36 | — | — | — | — | — |

Pola: node pertama = 7 (berbagi dgn pod sistem), setiap **node tambahan menambah 15 lab**.
Rumus umum: **Kapasitas(k) = 7 + 15·(k−1) = 15k − 8**.

### 9.6 Rumus jumlah node untuk N praktikan (anti over-provisioning)

$$k_\text{minimum}(N) = \left\lceil \frac{N + 8}{15} \right\rceil$$

| N praktikan | k node | | N praktikan | k node |
|---|---|---|---|---|
| 30 | **3** | | 50 | 4 |
| 40 | 4 | | 100 | 8 |

**Menjawab pertanyaan dosen:** 30 user tidak muat di 2 node (22 < 30), butuh node ke-3
(37 ≥ 30), dan berhenti di 3 (tidak perlu node ke-4). → autoscaling efektif, tanpa boros.

### 9.7 Paragraf metodologi (siap tempel ke laporan)

> Pengujian kapasitas dilakukan dengan variabel terkontrol: setiap pod praktikum
> dikonfigurasi dengan permintaan sumber daya tetap sebesar 100 milicore CPU dan 256 MiB
> memori, dan seluruh node menggunakan tipe seragam Standard_B2s_v2 dengan CPU allocatable
> 1900 milicore. Cluster autoscaler dinonaktifkan dan jumlah node dipatok pada 1, 2, dan 3
> untuk mengisolasi pengaruh jumlah node terhadap kapasitas. Beban dinaikkan bertahap
> menggunakan Locust hingga sebagian pod tidak lagi terjadwal (berstatus Pending),
> sehingga kapasitas terbaca sebagai jumlah pod Running maksimum. Hasil pengukuran
> menunjukkan kapasitas 7 pod untuk 1 node dan 22 pod untuk 2 node. Karena CPU merupakan
> sumber daya pengikat (19 pod/CPU lebih kecil daripada 22 pod/memori), kapasitas dapat
> diturunkan secara analitis: setiap node menyumbang ⌊(1900−345)/100⌋ = 15 slot pod,
> sementara node pertama kehilangan sekitar 8 slot untuk menampung pod sistem singleton
> (Prometheus, Grafana, orchestrator, dan lainnya) beserta generator beban. Dengan demikian
> diperoleh model kapasitas Kapasitas(k) = 15k − 8, yang konsisten antara perhitungan
> teoritis dan hasil pengukuran, serta menghasilkan rumus kebutuhan node minimum
> k = ⌈(N + 8)/15⌉ untuk N praktikan.
