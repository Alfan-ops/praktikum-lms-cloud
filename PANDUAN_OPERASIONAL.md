# Panduan Operasional — Cheatsheet Mandiri

Catatan operasional agar tidak perlu menanyakan hal yang sama berulang kali.
Mencakup: **(1) menjalankan Locust**, **(2) demo predictive autoscaling**,
**(3) monitoring per-container**, dan **(4) update repo GitHub**.

> Semua perintah dijalankan dari folder proyek:
> `cd "C:\Users\aqila\Downloads\Tugas Akhir - Praktikum - LMS Project\praktikum-lms-project-integrasi-backend"`
> Pastikan service hidup dulu: `docker-compose up -d`

---

## 1. Cara Menjalankan Locust (Load Testing)

### Langkah 0 — Siapkan token unik (WAJIB sekali di awal)
Locust butuh token login mahasiswa. Buat dulu file `locust_tokens.csv`:

```powershell
cd backend
python get_tokens.py
```
Hasil: `locust_tokens.csv` berisi token unik per mahasiswa (kolom `access_token`, `user_id`, `email`).

> Tanpa file ini, semua user virtual akan gagal. Token inilah perbaikan dari bug
> metodologi T50 (dulu 100 user pakai 1 token → cascade 403 palsu).

### Pilihan A — Uji backend LMS (`/api/labs/start` dkk)
```powershell
cd backend
python -m locust -f locustfile_integrated.py
```
- Buka browser: **http://localhost:8089**
- **Host:** `http://localhost:5001`  (port BACKEND)
- Isi: Number of users (mis. 50), Spawn rate (mis. 5), lalu **Start**

### Pilihan B — Uji autoscaler orchestrator langsung (`/deploy`)
Ini yang membuktikan semaphore + antrian autoscaler bekerja:
```powershell
cd backend
python -m locust -f locustfile_orchestrator.py
```
- Buka browser: **http://localhost:8089**
- **Host:** `http://localhost:4000`  (port ORCHESTRATOR, bukan 5001)
- Tiap user virtual membuat 1 container dengan grup unik, lalu memantau `/autoscaler/status`.

### Membaca hasil
- **200** = container langsung dibuat (ada slot)
- **202** = masuk antrian (slot penuh, autoscaler mengantri) → tetap dihitung sukses
- **503** = antrian penuh (backpressure) → server menolak dengan rapi, TIDAK crash

### Bersihkan container sisa load test
```powershell
cd backend
./cleanup_loadtest.ps1
```

---

## 2. Demo Predictive Autoscaling (Opsi B)

**Konsep yang dibuktikan:**
> Sistem tidak menunggu mahasiswa klik (reactive), tapi **meramal dari jadwal** dan
> menyiapkan kapasitas lebih dulu — itulah **predictive autoscaling**. Karena hanya
> 10 container, laptop tidak crash (sesuai prediksi, batas aman di Opsi A).

Background scheduler (`check_schedules`, jalan tiap 30 detik) akan **pre-warm**
container untuk jadwal yang waktu mulainya dalam 5 menit ke depan.

### Buat jadwal PENDING yang mulai beberapa menit lagi
```powershell
cd backend
# 10 jadwal yang mulai 4 menit dari sekarang (aman untuk laptop)
python seed_schedules.py --count 10 --minutes 4
```

### Pantau prosesnya
```powershell
# Cek status jadwal (PENDING / ACTIVE / COMPLETED)
python seed_schedules.py --status

# Lihat container yang muncul otomatis
docker ps
```

### Yang akan terlihat (bukti predictive)
| Fase | Pengamatan |
|------|-----------|
| T+0 | 10 jadwal PENDING dibuat, belum ada container |
| ~T+2 menit | Scheduler deteksi jadwal masuk jendela pre-warm 5 menit |
| Saat pre-warm | Status → ACTIVE, 10 container `praktikum_<nim>` dibuat & healthy |
| Bukti kunci | Container siap **SEBELUM** waktu mulai resmi → predictive terbukti |

### Bersihkan setelah demo
```powershell
python seed_schedules.py --cleanup
# lalu hapus container-nya bila perlu:
docker ps          # lihat nama container praktikum_*
docker rm -f <nama_container>
```

> Catatan: 10 container = batas aman. Di Opsi A, ~50 container membuat Docker Desktop
> crash karena RAM/CPU laptop habis. Itu batas FISIK host, bukan bug aplikasi.

---

## 3. Monitoring Per-Container

Metrik CPU & memori tiap container lab dihitung orchestrator via Docker API
(pengganti cAdvisor yang gagal di WSL2), lalu di-scrape Prometheus & ditampilkan Grafana.

### Cara cepat — JSON langsung
```
http://localhost:4000/containers/stats
```

### Format Prometheus (yang di-scrape)
```
http://localhost:4000/metrics/containers
```
Metrik tersedia: `lms_container_cpu_percent`, `lms_container_memory_bytes`,
`lms_container_memory_limit_bytes`, `lms_container_total`.

### Grafana (visualisasi — paling enak dilihat)
1. Buka **http://localhost:3001**
2. Login: **admin / admin**
3. Menu **Dashboards → LMS Praktikum → LMS Praktikum - Monitoring Per-Container**

Dashboard auto-refresh 5 detik, berisi 7 panel: jumlah container hidup, total CPU,
total memori, CPU per container, memori per container, bar gauge memori vs limit,
dan tabel stats per-NIM.

### Cek pipeline sehat (kalau data kosong)
- Prometheus targets: **http://localhost:9090/targets** → `container_metrics` harus **UP**
- Syarat data muncul: harus ada container praktikum **hidup**. Launch Lab dulu atau
  jalankan seed (Bagian 2), tunggu ~15 detik (interval scrape Prometheus).

---

## 4. Update Repo GitHub

Repo: **https://github.com/Alfan-ops/praktikum-lms-cloud** (branch `main`).

### Menyimpan perubahan ke GitHub (paling sering dipakai)
```powershell
cd "C:\Users\aqila\Downloads\Tugas Akhir - Praktikum - LMS Project\praktikum-lms-project-integrasi-backend"
git add -A
git commit -m "deskripsi singkat perubahan"
git push
```

### Mengambil perubahan terbaru dari GitHub (mis. di device lain)
```powershell
git pull
```

### Perintah bantu yang berguna
```powershell
git status              # lihat file apa saja yang berubah
git log --oneline -5    # lihat 5 commit terakhir
git diff                # lihat detail perubahan yang belum di-commit
```

### Kalau kerja di 2 device
Selalu `git pull` SEBELUM mulai kerja, dan `git push` SETELAH selesai, agar tidak bentrok.

### Pengingat keamanan
- File `.env`, `*_tokens.csv`, `users_to_import.csv` **otomatis diabaikan** (`.gitignore`).
  Jangan pernah memaksa menambahkannya (`git add -f`).
- Kalau `git push` minta login: gunakan akun GitHub `Alfan-ops` (browser/Personal Access Token).

---

## Lampiran — URL & Port Penting

| Layanan | URL | Login |
|---|---|---|
| LMS Frontend | http://localhost:3000 | admin / mahasiswa |
| Grafana | http://localhost:3001 | admin / admin |
| Locust (saat dijalankan) | http://localhost:8089 | - |
| Prometheus | http://localhost:9090 | - |
| Backend API | http://localhost:5001 | - |
| Orchestrator | http://localhost:4000 | - |

Akun mahasiswa demo: `articuno@itb.ac.id` / `student123` (sudah submit, 100%),
`arceus@itb.ac.id` / `student123` (belum submit, 0%).
