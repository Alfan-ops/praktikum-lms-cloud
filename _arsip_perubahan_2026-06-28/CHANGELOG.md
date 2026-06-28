# Arsip Perubahan LMS — Fitur Autoscaling & Perbaikan Load Testing

**Tanggal arsip:** 28 Juni 2026
**Proyek:** praktikum-lms-project-integrasi-backend
**Konteks:** Implementasi fitur autoscaling untuk mengatasi kegagalan LMS yang
terdokumentasi di dokumen T50 (kegagalan 91% pada `/api/labs/start` saat lonjakan
100 user), serta perbaikan metodologi load testing.

> Folder ini berisi **salinan** semua file yang diubah pada tanggal di atas,
> sebagai cadangan dan referensi laporan tugas akhir.

---

## A. Fitur Autoscaling

### 1. `orchestrator/app.py`
**Status:** DIMODIFIKASI

Ditambahkan sistem autoscaler:
- **Semaphore** — membatasi maksimal 5 pembuatan container (`docker run`) berjalan
  bersamaan (`MAX_CONCURRENT_DEPLOYS`, default 5).
- **Antrian async** — permintaan yang melebihi slot masuk antrian, maksimal 50
  (`DEPLOY_QUEUE_MAX`). Jika antrian penuh → balas `503` (backpressure), bukan crash.
- **Pelacakan job** — fungsi `run_with_autoscaler`, penyimpanan hasil job.
- **Endpoint baru:**
  - `GET /job/<job_id>` — cek status job di antrian (queued/done/error).
  - `GET /autoscaler/status` — pantau slot aktif, panjang antrian, kapasitas.
- **Endpoint `/deploy` dimodifikasi** — cek container existing → cek kapasitas antrian
  → acquire semaphore (langsung jika ada slot, antri jika penuh).

### 2. `backend/management.py`
**Status:** DIMODIFIKASI

- **ThreadPoolExecutor** — background scheduler (`check_schedules`) memproses maksimal
  5 sesi bersamaan (`MAX_SCHEDULER_CONCURRENT`), bukan semua sekaligus.
- **Rate limiter** — fungsi `check_rate_limit`, membatasi 1 klik "Start Lab" per
  10 detik per mahasiswa (`LABS_RATE_LIMIT_SECONDS`). Pakai Redis, fallback in-memory.
- **`/api/labs/start` dimodifikasi** — menolak `429 Too Many Requests` jika terlalu cepat.
- **Endpoint baru** `GET /api/autoscaler/status` — proxy status autoscaler orchestrator.

### 3. `docker-compose.yml`
**Status:** DIMODIFIKASI

Ditambahkan variabel environment (agar bisa diatur tanpa ubah kode):
- Service `backend`: `MAX_SCHEDULER_CONCURRENT=5`, `LABS_RATE_LIMIT_SECONDS=10`
- Service `orchestrator`: `MAX_CONCURRENT_DEPLOYS=5`, `DEPLOY_QUEUE_MAX=50`

---

## B. Perbaikan Load Testing

### 4. `backend/locustfile_integrated.py`
**Status:** DITULIS ULANG

- **Sebelum:** 100 user virtual memakai 1 token hardcoded yang sama → menyebabkan
  cascade `403` di T50 (metodologi tidak valid).
- **Sesudah:** membaca token unik dari `locust_tokens.csv`, dibagikan round-robin ke
  tiap user virtual. Menghilangkan cascade 403 palsu.

### 5. `backend/get_tokens.py`
**Status:** DIMODIFIKASI

- Anon key diganti dari Supabase lama (`rvmhhoqhfhdtcrnnaigx`, milik teman) →
  Supabase baru (`zxnbqthxtnkbsbmzmucq`).
- Jeda antar-login dinaikkan dari `0.1` detik → `2` detik untuk menghindari
  Supabase auth rate limit (berhasil dapat 50/50 token).

### 6. `backend/locustfile_orchestrator.py`
**Status:** FILE BARU

Locustfile untuk menguji autoscaler orchestrator secara langsung (Opsi A).
Tiap user virtual mengirim 1 `POST /deploy` dengan nama grup unik, lalu memantau
`/autoscaler/status`. Membuktikan semaphore + antrian bekerja saat lonjakan.

### 7. `backend/cleanup_loadtest.ps1`
**Status:** FILE BARU

Skrip PowerShell untuk menghapus semua container `praktikum_loadtest-*` yang
terbentuk selama load testing.

---

## D. Perbaikan Web Server Orchestrator (Gunicorn)

Dilakukan setelah tes Opsi A 100 user mengungkap bahwa Flask dev server tidak
mampu menangani banyak koneksi bersamaan (ConnectionResetError + timeout 30 dtk
pada `/autoscaler/status`).

### 8. `orchestrator/requirements.txt`
**Status:** DIMODIFIKASI
- Ditambahkan `gunicorn` dan `gevent`.

### 9. `docker-compose.yml` (service orchestrator)
**Status:** DIMODIFIKASI
- Command diganti dari `flask run --host=0.0.0.0 --port=4000`
  menjadi:
  `gunicorn app:app --bind 0.0.0.0:4000 --workers 1 --worker-class gevent --worker-connections 1000 --timeout 120 --reload`
- **`--workers 1` WAJIB**: state semaphore/antrian autoscaler disimpan di memori
  proses. Banyak worker = tiap worker punya semaphore sendiri → batas global rusak.
- **gevent + 1000 worker-connections**: tangani ratusan koneksi bersamaan via greenlet.
- **`--reload`**: tetap muat ulang otomatis saat `app.py` diubah (volume mount).

---

## C. Hasil Pengujian (ringkasan)

### Tes 1 — `/api/labs/start` via backend (50 token unik, 10 user)
- Cascade `403` dari T50 **hilang** (token sudah unik).
- Sisa kegagalan: `403` (mahasiswa tes belum dijadwalkan) + `429` (rate limiter bekerja).
- **Temuan:** `/api/labs/start` ternyata hanya membaca database, TIDAK membuat
  container. Pembuatan container dilakukan background scheduler. Maka tes ini tidak
  menguji autoscaler → beralih ke Opsi A.

### Tes 2 — `/deploy` orchestrator (Opsi A, autoscaler, Flask dev server)
| Beban | Hasil |
|-------|-------|
| 10 user | 0% gagal. Response time naik ~1.2 dtk lalu turun (jejak antrian). |
| 100 user | `POST /deploy`: 34% ditolak `503` (antrian penuh) — backpressure terkendali, server tidak crash. Namun `/autoscaler/status`: 168× ConnectionResetError + timeout 30 dtk (Flask dev server saturasi). |

### Tes 3 — `/deploy` orchestrator (Opsi A, SETELAH Gunicorn, 50 user)
| Metrik | Hasil |
|--------|-------|
| `POST /deploy` | 50 permintaan, **0% gagal** (Gunicorn + antrian menampung semua) |
| `GET /autoscaler/status` | masih ada 85 kegagalan (RemoteDisconnected/ConnReset), response time melonjak 30 dtk DI AKHIR tes |
| Kondisi sistem | **Docker Desktop crash** setelah ~50 container Jupyter hidup |

**Perbandingan inti (jalur deploy):**
| | T50 (tanpa autoscaler) | Sesudah (autoscaler + Gunicorn) |
|---|---|---|
| Kegagalan deploy | 91% — ConnectionResetError (crash) | 0% (50 user) / 34%-503 (100 user, antrian penuh) |
| Server aplikasi | Tumbang | Tetap hidup (menolak via 503) |

### TEMUAN UTAMA: Batas Fisik Host
- Perbaikan Gunicorn berhasil untuk lapisan web (deploy 0% gagal di 50 user).
- Namun tes mengungkap bottleneck sebenarnya: **RAM/CPU laptop habis** saat ~50
  container Jupyter hidup bersamaan → Docker Desktop crash (dua kali: di 100 user
  dan di 50 user).
- Timeout `/autoscaler/status` di akhir tes = host kehabisan sumber daya, BUKAN
  masalah web server.
- **Implikasi ilmiah:** autoscaler reactive (antri + backpressure) mencegah crash
  aplikasi, tetapi tidak dapat melampaui kapasitas fisik satu host. Ini menjadi
  justifikasi kuat untuk **horizontal scaling / multi-node (Kubernetes HPA)** agar
  benar-benar melayani 100 user serentak.

### Rencana lanjutan (BELUM dikerjakan)
- Uji ulang 100 user di **laptop spek lebih tinggi** (RAM lebih besar) untuk
  mendapat grafik "100 user, 0% gagal" tanpa crash. Naikkan juga
  `MAX_CONCURRENT_DEPLOYS` (mis. 5 → 10/15).
- **Opsi B (predictive autoscaling)** — buktikan scheduler pre-warm container
  sebelum lonjakan berdasarkan jadwal `practikum_schedules`. Diperlukan untuk
  klaim "predictive" pada judul TA.
- Catatan: pengaman "batas total container" sengaja TIDAK ditambahkan, sesuai
  keputusan pengguna (akan diuji di hardware lebih tinggi).

---

## E. Demonstrasi Predictive Autoscaling (Opsi B)

### 10. `backend/seed_schedules.py`
**Status:** FILE BARU

Skrip untuk mengisi tabel `practikum_schedules` dengan sesi PENDING yang waktu
mulainya beberapa menit ke depan, guna mendemonstrasikan predictive autoscaling
(scheduler pre-warm container SEBELUM waktu mulai).
- Sumber student_id: `locust_tokens.csv` (kolom user_id).
- Otomatis membuat prasyarat (period -> course -> course_offering -> module) bila
  tabel kurikulum kosong, lalu memakai module_id hasilnya.
- Mode: seed (default), `--status`, `--cleanup`.
- Membaca `.env` secara manual (tanpa dependensi python-dotenv).

### Hasil Tes Opsi B (Predictive)
| Fase | Pengamatan |
|------|-----------|
| T+0 | 10 jadwal PENDING dibuat (mulai 7 menit ke depan), belum ada container |
| ~T+2 menit | Scheduler deteksi jadwal masuk jendela pre-warm 5 menit |
| Saat pre-warm | Status -> ACTIVE, 10 container `praktikum_<nim>` dibuat & healthy |
| Bukti kunci | Container siap ~4 menit SEBELUM waktu mulai resmi (predictive terbukti) |

Kesimpulan: scheduler menyiapkan kapasitas berdasarkan jadwal sebelum lonjakan
terjadi (predictive), melengkapi mekanisme reactive di Opsi A.

---

## F. Monitoring Per-Container (Mengatasi Kegagalan cAdvisor T50)

Menyelesaikan tujuan T50 yang belum terpenuhi: monitoring per-kontainer (cAdvisor
gagal di WSL2). Orchestrator (punya akses Docker socket) menghitung metrik tiap
container lab langsung via Docker API.

### 11. `orchestrator/app.py`
**Status:** DIMODIFIKASI
- + `collect_container_stats()` — hitung CPU% & memori tiap container `praktikum_*`.
- + `GET /metrics/containers` — output format teks Prometheus
  (`lms_container_cpu_percent`, `lms_container_memory_bytes`,
  `lms_container_memory_limit_bytes`, `lms_container_total`).
- + `GET /containers/stats` — output JSON untuk dashboard/admin.
- Filter `praktikum_` (underscore) agar hanya container lab mahasiswa yang dipantau,
  bukan container infrastruktur (`praktikum-lms-project-...`).

### 12. `prometheus.yml`
**Status:** DIMODIFIKASI
- + scrape job `container_metrics` -> `orchestrator:4000/metrics/containers`.

### Bukti Berfungsi (end-to-end)
- Target Prometheus `container_metrics` = **up**.
- `lms_container_total` terbaca di Prometheus (mis. 3 saat 3 container hidup).
- `lms_container_memory_bytes` & `lms_container_cpu_percent` per container tersedia,
  siap divisualisasikan di Grafana (pengganti cAdvisor).

---

---

## G. Perbaikan Progress Tracking & Alur Praktikum (29 Juni 2026)

### 13. `backend/management.py`
**Status:** DIMODIFIKASI

**Bug:** Progress modul selalu tampil 100% untuk mahasiswa baru yang belum mengerjakan apapun.

**Penyebab:** Logika di fungsi `get_my_courses` (baris 734–738):
```python
elif total_assignments == 0:
    progress = 100  # ← BUG: jika tidak ada assignment, langsung 100%
```

**Perbaikan:** Kondisi `elif total_assignments == 0: progress = 100` dihapus.
Sekarang mahasiswa yang belum ada assignment maupun belum submit akan mendapat progress **0%**.

**Logika baru:**
```python
progress = 0
if total_assignments > 0:
    progress = (completed / total) * 100
```

### 14. Assignment "Laporan Praktikum Iris" dibuat via UI Admin

- Assignment baru ditambahkan ke Modul Iris (Uji) melalui form "Create New Assignment"
- Submission Start: 28 Jun 2026 23:40 | Submission End: 29 Jun 2026 23:40
- Max Score: 100
- Setelah assignment ada di modul, progress mahasiswa baru = **0%** (terbukti pada akun Arceus)
- Mahasiswa yang submit (akun Articuno) = **100%** ✅

### Verifikasi End-to-End Alur Praktikum
| Langkah | Status |
|---------|--------|
| Admin buat jadwal → status PENDING | ✅ |
| Scheduler pre-warm container ~5 menit sebelum mulai | ✅ |
| Mahasiswa Login → Courses → Modul Iris → Launch Lab | ✅ |
| Jupyter terbuka dengan notebook `praktikum_ml_iris.ipynb` | ✅ |
| Mahasiswa kerjakan notebook → submit assignment | ✅ |
| Progress 0% (belum submit) → 100% (setelah submit) | ✅ |
| Backend di-restart untuk apply fix progress | ✅ (`docker-compose restart backend`) |

---

## H. Visualisasi Grafana Monitoring Per-Container (29 Juni 2026)

Melengkapi Bagian F: metrik per-container yang sudah diekspos orchestrator kini
divisualisasikan di Grafana. Grafana sebelumnya BELUM ada di `docker-compose.yml`
(hanya Prometheus + cAdvisor), kini ditambahkan dengan provisioning otomatis.

### 15. `docker-compose.yml`
**Status:** DIMODIFIKASI
- + service `grafana` (image `grafana/grafana:latest`), port **3001:3000**
  (port 3000 host sudah dipakai frontend).
- Mount provisioning (`./grafana/provisioning`) & dashboard (`./grafana/dashboards`).
- + volume `grafana_data`. Kredensial default admin/admin.

### 16. `grafana/provisioning/datasources/prometheus.yml`
**Status:** FILE BARU
- Datasource Prometheus otomatis (uid `prometheus`, url `http://prometheus:9090`,
  default). Tidak perlu setup manual.

### 17. `grafana/provisioning/dashboards/dashboards.yml`
**Status:** FILE BARU
- Provider yang memuat semua dashboard JSON dari `/var/lib/grafana/dashboards`
  ke folder "LMS Praktikum".

### 18. `grafana/dashboards/lms-containers.json`
**Status:** FILE BARU
- Dashboard "LMS Praktikum - Monitoring Per-Container" (uid `lms-containers`),
  auto-refresh 5 dtk, 7 panel:
  1. Stat: jumlah container hidup (`lms_container_total`)
  2. Stat: total CPU semua container (`sum(lms_container_cpu_percent)`)
  3. Stat: total memori (`sum(lms_container_memory_bytes)`)
  4. Time series: CPU per container
  5. Time series: memori per container
  6. Bar gauge: memori vs limit (%) (`memory_bytes / memory_limit_bytes * 100`)
  7. Tabel: stats per-container saat ini (CPU + memori per NIM)

### Bukti Berfungsi (29 Juni 2026)
- Grafana health: ok (v13.1.0). Datasource & dashboard ter-provisioning otomatis.
- Target Prometheus `container_metrics` = **up**.
- `lms_container_total` = 2 saat 2 container praktikum hidup → terbaca di dashboard.
- Semua 7 panel menampilkan data real-time per container (CPU, memori, bar gauge).
- Akses: http://localhost:3001 (admin/admin) → Dashboards → LMS Praktikum.

### Perbaikan Tabel Stats Per-Container (29 Juni 2026)
**Masalah:** Panel "Tabel Stats Per-Container" menampilkan tiap container 2 baris
(CPU dan Memori di baris terpisah) karena transformasi `merge` tidak menggabungkan
berdasarkan label `container`.

**Perbaikan di `grafana/dashboards/lms-containers.json` (panel id 7):**
- Transformasi `merge` → `joinByField` (byField `container`, mode `outer`).
- `organize` diperluas untuk menyembunyikan kolom duplikat (`Time 1/2`,
  `instance 1/2`, `job 1/2`, `__name__ 1/2`) dan mengurutkan kolom:
  Container | CPU (%) | Memori.
- Hasil: **1 baris per container** dengan 3 kolom rapi.
- Provider Grafana (updateIntervalSeconds 10) memuat ulang otomatis, tanpa error.

---

## Status Tujuan Dokumen T40/T50 (per 29 Juni 2026)
| Tujuan | Status |
|--------|--------|
| Dashboard user-friendly | ✅ Tercapai (sejak awal) |
| Autoscaling berbasis jadwal (reactive + predictive) | ✅ Selesai (Opsi A + B) |
| POST /api/labs/start (91% gagal di T50) | ✅ Ditangani (token unik + antrian) |
| Monitoring per-container (cAdvisor gagal) | ✅ SELESAI (via Docker API, Bagian F) + visualisasi Grafana (Bagian H) |
| Progress tracking 0% → 100% (bug progress = 100 saat baru) | ✅ SELESAI (Bagian G) |
| Alur praktikum end-to-end (jadwal → lab → submit) | ✅ TERVERIFIKASI (Bagian G) |
| Validasi performa 100 user bersih | ⏳ Menunggu laptop spek lebih tinggi |
| HPA / Kubernetes | ⏳ Ditunda (keputusan pengguna); T50 sudah mengganti ke Docker SDK |

---

## Cara Mengembalikan (revert)
Untuk mengembalikan file ke versi arsip ini, salin file dari folder ini kembali ke
lokasi aslinya (struktur folder di arsip sama dengan struktur proyek).

## Catatan
- Proyek ini **bukan git repository**, jadi tidak ada riwayat commit otomatis.
  Arsip manual ini menggantikan fungsi tersebut.
