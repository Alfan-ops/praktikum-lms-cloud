# Cheatsheet Presentasi Progress TA

> Pegangan cepat saat presentasi ke dosen pembimbing + demo live.

---

## 1. Persiapan Sebelum Presentasi (jalankan dulu)

```powershell
# Masuk ke folder proyek
cd "C:\Users\aqila\Downloads\Tugas Akhir - Praktikum - LMS Project\praktikum-lms-project-integrasi-backend"

# Nyalakan semua service
docker-compose up -d

# Pastikan semua hidup
docker-compose ps
```

Tunggu ~30 detik, lalu cek service penting di browser.

---

## 2. URL & Kredensial (buka tab sebelum mulai)

| Layanan | URL | Login |
|---|---|---|
| LMS (Frontend) | http://localhost:3000 | admin & mahasiswa di bawah |
| Grafana (monitoring) | http://localhost:3001 | admin / admin |
| Prometheus | http://localhost:9090 | - |
| Backend API health | http://localhost:5001/health | - |
| Orchestrator stats | http://localhost:4000/containers/stats | - |

**Akun demo:**
- Admin: (akun administrator LMS Anda)
- Mahasiswa sudah submit: `articuno@itb.ac.id` / `student123` → progress **100%**
- Mahasiswa belum submit: `arceus@itb.ac.id` / `student123` → progress **0%**

---

## 3. Urutan Demo Live (5 menit)

1. **Login admin** → tunjukkan menu (Courses, Students, Resources, Monitoring)
2. **Buat/tunjukkan jadwal** praktikum (status PENDING → ACTIVE otomatis)
3. **Login mahasiswa (Articuno)** → Courses → Modul Iris → **Launch Lab**
   - Jupyter terbuka dengan `praktikum_ml_iris.ipynb`
   - Jalankan 1-2 cell (Shift+Enter) untuk tunjukkan notebook hidup
4. **Submit assignment** → kembali ke Courses → progress **100%**
5. **Login mahasiswa baru (Arceus)** → progress **0%** (bukti bug fix)
6. **Buka Grafana** (localhost:3001) → Dashboards → LMS Praktikum → Monitoring Per-Container
   - Tunjukkan CPU/memori per container real-time

---

## 4. Angka Kunci (hafalkan)

- **91% → ditangani**: kegagalan `POST /api/labs/start` di T50 (token unik + antrian)
- **3 dari 4** kekurangan T50 sudah ditutup
- **7 panel** Grafana monitoring per-container
- **~50 container** = batas fisik laptop (Docker crash) → justifikasi horizontal scaling
- **5 menit** = window pre-warm scheduler sebelum sesi mulai

---

## 5. Poin Pembicaraan per Slide

1. **Judul** — laporan progress lanjutan T40/T50
2. **Konteks** — T40 (desain) → T50 (uji, ada kekurangan) → Kini (menutup kekurangan)
3. **Ringkasan** — capaian utama dalam angka
4. **Alur end-to-end** — *bagian terkuat, demokan live*
5. **Status T50** — kejujuran metodologi: 3/4 ditutup
6. **Grafana** — cAdvisor gagal → diganti exporter Docker API (workaround valid)
7. **Rencana** — gap "predictive" (Prophet), validasi 100 user, dokumentasi
8. **Kesimpulan** — minta arahan pembimbing

---

## 6. Antisipasi Pertanyaan Pembimbing (Q&A)

**Q: Kenapa autoscaling KEDA/Kubernetes tidak jadi?**
> Diganti Docker SDK + docker-compose karena kompleksitas infrastruktur. Sudah didiskusikan & disetujui. Tercatat di T50 bagian 3.3.

**Q: Apakah ini benar-benar "predictive"?**
> Saat ini pre-warm berbasis JADWAL (scheduler menyiapkan container sebelum sesi).
> Integrasi FB Prophet (forecast memicu scaling) adalah langkah berikutnya — ini gap yang saya sadari dan jadi prioritas.

**Q: Kenapa stress test 100 user belum bersih?**
> Autoscaler berhasil mencegah crash aplikasi (server tetap hidup, menolak via 503).
> Yang tumbang adalah batas fisik laptop (RAM habis ~50 container). Ini bukti empiris perlunya multi-node. Perlu uji ulang di hardware lebih tinggi.

**Q: Bagaimana monitoring per-container kalau cAdvisor gagal?**
> Orchestrator (punya akses Docker socket) menghitung CPU/memori tiap container via Docker API, diekspos format Prometheus, divisualisasikan Grafana. Terbukti UP & real-time.

**Q: Bug progress 100% itu apa?**
> Mahasiswa baru tampil 100% padahal belum mengerjakan — karena logika lama menganggap "tidak ada assignment = selesai". Sudah diperbaiki: mulai dari 0%.

---

## 7. Kalau Demo Gagal (plan B)

- Container tidak muncul → `docker-compose restart backend orchestrator`
- Grafana kosong → pastikan ada container praktikum hidup (Launch Lab dulu), tunggu 15 dtk (scrape interval)
- Jupyter "Cannot open" → cek `HOST_USER_DATA_PATH`/`HOST_MODULES_PATH` di docker-compose (harus drive C)
- Siapkan **screenshot cadangan** semua langkah (untuk jaga-jaga internet/Docker bermasalah)

---

## 8. Matikan Setelah Selesai (opsional)

```powershell
docker-compose down            # hentikan service (data tetap aman di volume)
# JANGAN pakai -v kecuali ingin hapus data Grafana/Prometheus
```
