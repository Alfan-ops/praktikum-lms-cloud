# Penjelasan Perubahan Kode Tugas Akhir

Dokumen ini menjelaskan seluruh perubahan kode yang dilakukan (ringkasan dari CHANGELOG),
dikelompokkan per tema, lengkap dengan **file yang diubah**, **apa yang dilakukan**,
**alasannya**, dan **kaitannya dengan kekurangan Dokumen T50**.

Pendamping slide: `Perubahan_Kode_TA.pptx`.

---

## Konteks

Dokumen T50 mencatat beberapa kekurangan pada sistem:
1. `POST /api/labs/start` gagal **91%** saat stress test 100 user
2. Monitoring per-container (cAdvisor) **gagal** di WSL2
3. Autoscaling KEDA/Kubernetes tidak jadi (diganti Docker SDK)
4. Validasi 100 user tanpa crash belum tercapai

Perubahan kode berikut dilakukan untuk menutup kekurangan tersebut dan menstabilkan sistem.

---

## Tema 1 — Autoscaling Reactive (Opsi A)

**Tujuan:** mencegah server crash saat lonjakan permintaan pembuatan container.

### `orchestrator/app.py`
- **Semaphore** membatasi maksimal **5** pembuatan container (`docker run`) berjalan
  bersamaan (`MAX_CONCURRENT_DEPLOYS`).
- **Antrian async** menampung permintaan berlebih (maksimal 50, `DEPLOY_QUEUE_MAX`).
  Jika penuh → balas **503** (backpressure), bukan crash.
- Endpoint baru: `GET /job/<job_id>` (status job antrian) & `GET /autoscaler/status`
  (slot aktif, panjang antrian, kapasitas).

### `backend/management.py`
- **ThreadPoolExecutor** — scheduler memproses maksimal **5** sesi bersamaan
  (`MAX_SCHEDULER_CONCURRENT`), bukan semua sekaligus.
- **Rate limiter** — 1 klik "Start Lab" per **10 detik** per mahasiswa
  (`LABS_RATE_LIMIT_SECONDS`); pakai Redis, fallback in-memory. Menolak **429** jika terlalu cepat.

### `docker-compose.yml`
- Menambah variabel environment agar batas bisa diatur tanpa ubah kode.

**Hasil:** server tetap hidup di bawah beban (menolak via 503/429), tidak tumbang.

---

## Tema 2 — Perbaikan Metodologi Load Testing

**Tujuan:** memperbaiki bug metodologi T50 (100 user memakai 1 token → cascade 403 palsu).

### `backend/locustfile_integrated.py` (ditulis ulang)
- Dulu: 100 user virtual memakai 1 token hardcoded yang sama.
- Sekarang: membaca **token unik** dari `locust_tokens.csv`, dibagikan **round-robin**
  ke tiap user virtual. Menghilangkan cascade 403 palsu.

### `backend/get_tokens.py`
- Anon key diganti ke Supabase baru (milik user, bukan teman).
- Jeda antar-login dinaikkan `0.1s → 2s` untuk menghindari Supabase auth rate limit
  (berhasil dapat 50/50 token).

### `backend/locustfile_orchestrator.py` (file baru)
- Menguji autoscaler orchestrator langsung (Opsi A): tiap user kirim 1 `POST /deploy`
  grup unik, lalu pantau `/autoscaler/status`.

### `backend/cleanup_loadtest.ps1` (file baru)
- Menghapus container `praktikum_loadtest-*` sisa load testing.

---

## Tema 3 — Web Server Produksi (Gunicorn)

**Tujuan:** Flask dev server tidak mampu menangani banyak koneksi bersamaan
(ConnectionResetError + timeout saat 100 user).

### `orchestrator/requirements.txt`
- Menambah `gunicorn` dan `gevent`.

### `docker-compose.yml` (service orchestrator)
- Command diganti menjadi:
  `gunicorn app:app --bind 0.0.0.0:4000 --workers 1 --worker-class gevent --worker-connections 1000 --timeout 120 --reload`
- **`--workers 1` WAJIB**: state semaphore/antrian autoscaler disimpan di memori proses.
  Banyak worker = tiap worker punya semaphore sendiri → batas global rusak.
- **gevent + 1000 connections**: menangani ratusan koneksi via greenlet.

**Hasil:** deploy 0% gagal pada 50 user (sebelumnya crash). Batas berikutnya = fisik host (RAM).

---

## Tema 4 — Predictive Autoscaling (Opsi B)

**Tujuan:** membuktikan sistem menyiapkan kapasitas SEBELUM lonjakan (predictive),
sesuai judul TA.

### `backend/seed_schedules.py` (file baru)
- Mengisi tabel `practikum_schedules` dengan sesi PENDING yang mulai beberapa menit
  ke depan. Background scheduler otomatis **pre-warm** container dalam jendela 5 menit.
- Otomatis membuat prasyarat (period → course → offering → module) bila tabel kosong.
- Mode: seed (default), `--status`, `--cleanup`.

**Hasil:** container `praktikum_<nim>` siap ~4 menit **sebelum** waktu mulai resmi →
predictive terbukti. Dengan 10 container, laptop tidak crash (batas aman Opsi A).

---

## Tema 5 — Monitoring Per-Container (Pengganti cAdvisor)

**Tujuan:** menyelesaikan tujuan T50 yang gagal (cAdvisor gagal di WSL2).

### `orchestrator/app.py`
- `collect_container_stats()` — hitung CPU% & memori tiap container `praktikum_*`
  langsung via Docker API (orchestrator punya akses Docker socket).
- `GET /metrics/containers` — output format teks Prometheus
  (`lms_container_cpu_percent`, `lms_container_memory_bytes`,
  `lms_container_memory_limit_bytes`, `lms_container_total`).
- `GET /containers/stats` — output JSON untuk dashboard/admin.

### `prometheus.yml`
- Menambah scrape job `container_metrics` → `orchestrator:4000/metrics/containers`.

**Hasil:** metrik per-container terbaca di Prometheus (target UP), siap divisualisasikan.

---

## Tema 6 — Visualisasi Grafana

**Tujuan:** menampilkan metrik per-container secara visual (Grafana belum ada sebelumnya).

### `docker-compose.yml`
- Menambah service `grafana` (port **3001**), mount provisioning & dashboard, volume data.

### `grafana/provisioning/datasources/prometheus.yml` (baru)
- Datasource Prometheus otomatis (tanpa setup manual).

### `grafana/provisioning/dashboards/dashboards.yml` (baru)
- Provider yang memuat dashboard JSON otomatis ke folder "LMS Praktikum".

### `grafana/dashboards/lms-containers.json` (baru)
- Dashboard 7 panel, auto-refresh 5 detik: jumlah container, total CPU, total memori,
  CPU per container, memori per container, bar gauge memori vs limit, tabel stats per-NIM.
- **Perbaikan tabel:** transformasi `merge` → `joinByField` (byField `container`)
  agar 1 baris per container (kolom Container | CPU | Memori).

**Hasil:** dashboard real-time berfungsi; target `container_metrics` UP, data terbaca.

---

## Tema 7 — Perbaikan Bug Progress Tracking

**Tujuan:** mahasiswa baru tampil 100% padahal belum mengerjakan apapun.

### `backend/management.py` (fungsi `get_my_courses`)
- **Bug:** `elif total_assignments == 0: progress = 100` → jika modul belum punya
  assignment, progress langsung dianggap 100%.
- **Perbaikan:** kondisi tersebut dihapus. Progress mulai dari **0%**, hanya naik
  berdasarkan submission: `progress = (completed / total) * 100`.

### Assignment "Laporan Praktikum Iris"
- Dibuat via UI admin agar modul punya assignment yang bisa dikerjakan.

**Hasil:** mahasiswa baru (Arceus) = 0%, mahasiswa yang submit (Articuno) = 100%.

---

## Ringkasan: File → Perubahan → Kaitan T50

| File | Jenis | Tema | Menutup Kekurangan T50 |
|---|---|---|---|
| `orchestrator/app.py` | Modifikasi | Autoscaling + Monitoring | #1 gagal 91%, #2 cAdvisor |
| `backend/management.py` | Modifikasi | Autoscaling + Bug progress | #1 gagal 91% |
| `docker-compose.yml` | Modifikasi | Autoscaling + Gunicorn + Grafana | #1, #2 |
| `backend/locustfile_integrated.py` | Ditulis ulang | Load testing | #1 (metodologi) |
| `backend/get_tokens.py` | Modifikasi | Load testing | #1 (metodologi) |
| `backend/locustfile_orchestrator.py` | Baru | Load testing | #4 validasi |
| `backend/cleanup_loadtest.ps1` | Baru | Load testing | pendukung |
| `orchestrator/requirements.txt` | Modifikasi | Gunicorn | #1, #4 |
| `backend/seed_schedules.py` | Baru | Predictive | judul "predictive" |
| `prometheus.yml` | Modifikasi | Monitoring | #2 cAdvisor |
| `grafana/**` (4 file) | Baru | Visualisasi | #2 cAdvisor |

**Status akhir:** 3 dari 4 kekurangan T50 ditutup; sisa (validasi 100 user bersih)
terhalang batas fisik host — justru menjadi bukti empiris perlunya horizontal scaling.
