# Panduan Setup di Device Baru

Panduan menjalankan **Platform Praktikum Berbasis Cloud (LMS)** di komputer/device baru
setelah meng-clone repo dari GitHub.

> **Penting:** Meng-clone repo saja TIDAK cukup. Beberapa file sengaja tidak diunggah
> ke GitHub (kunci rahasia & file besar) dan harus disiapkan ulang. Ikuti langkah di bawah.

---

## 1. Prasyarat (Install Dulu)

| Software | Wajib? | Untuk |
|---|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | ✅ Wajib | Menjalankan semua container |
| [Git](https://git-scm.com/) | ✅ Wajib | Clone & update repo |
| [Python 3.12](https://www.python.org/) | Opsional | Menjalankan script (`get_tokens.py`, `seed_schedules.py`) |
| [Node.js](https://nodejs.org/) | Opsional | Dev frontend di luar Docker |

Pastikan **Docker Desktop sudah berjalan** sebelum lanjut.

---

## 2. Clone Repo

```powershell
git clone https://github.com/Alfan-ops/praktikum-lms-cloud.git
cd praktikum-lms-cloud
```

---

## 3. Buat File `.env` (WAJIB — tidak ada di GitHub)

File `.env` berisi kunci Supabase dan sengaja tidak diunggah demi keamanan.
Salin dari template lalu isi nilai aslinya:

```powershell
copy .env.example .env
```

Buka `.env`, isi nilai berikut (ambil dari device lama atau dashboard Supabase →
Project Settings → API):

```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=isi_service_role_key_anda
```

> Jangan pernah commit file `.env` ke GitHub. File ini sudah masuk `.gitignore`.

---

## 4. Perbaiki Path di `docker-compose.yml` (WAJIB)

Di service `orchestrator` terdapat path **absolut** yang menunjuk ke lokasi folder.
Path ini HARUS disesuaikan dengan lokasi proyek di device baru.

Cari dua baris ini:

```yaml
- HOST_USER_DATA_PATH=/host_mnt/c/Users/aqila/Downloads/.../orchestrator/user_data
- HOST_MODULES_PATH=/host_mnt/c/Users/aqila/Downloads/.../orchestrator/modules
```

Ubah menjadi lokasi folder proyek di device baru. Format penulisan path Docker Desktop
di Windows: drive ditulis huruf kecil setelah `/host_mnt/`.

Contoh jika proyek ada di `D:\Kuliah\praktikum-lms-cloud`:

```yaml
- HOST_USER_DATA_PATH=/host_mnt/d/Kuliah/praktikum-lms-cloud/orchestrator/user_data
- HOST_MODULES_PATH=/host_mnt/d/Kuliah/praktikum-lms-cloud/orchestrator/modules
```

> Path yang salah = error "Could not find path: praktikum_ml_iris.ipynb" saat Launch Lab.

---

## 5. Build & Jalankan

```powershell
docker-compose build
docker-compose up -d
```

Docker akan otomatis: install dependency Python & Node, build image Jupyter, dll.
**Tidak perlu** menyalin `node_modules` atau `.venv` secara manual.

Cek semua service hidup:

```powershell
docker-compose ps
```

---

## 6. Akses Layanan

| Layanan | URL | Login |
|---|---|---|
| LMS (Frontend) | http://localhost:3000 | akun admin / mahasiswa |
| Grafana (monitoring) | http://localhost:3001 | admin / admin |
| Prometheus | http://localhost:9090 | - |
| Backend API health | http://localhost:5001/health | - |
| Orchestrator stats | http://localhost:4000/containers/stats | - |

---

## 7. (Opsional) Buat Ulang Token Load Testing

File `locust_tokens.csv` tidak ikut ke GitHub. Jika perlu load testing:

```powershell
cd backend
python get_tokens.py
```

---

## Yang TIDAK Perlu Dikhawatirkan

- **Database** — aman, Supabase di cloud. Semua user, jadwal, course tetap ada.
- **node_modules / .venv** — dibuat ulang otomatis oleh Docker/npm.
- **Docker images** — di-build ulang dari Dockerfile.

---

## Ringkasan Cepat

Yang **wajib** disiapkan manual di device baru:
1. Install Docker Desktop + Git
2. `git clone` repo
3. Buat `.env` (salin dari `.env.example`, isi kunci Supabase)
4. Perbaiki `HOST_USER_DATA_PATH` & `HOST_MODULES_PATH` di `docker-compose.yml`
5. `docker-compose build && docker-compose up -d`

Sisanya otomatis.

---

## Update Kode (di device manapun)

Mengambil perubahan terbaru dari GitHub:

```powershell
git pull
docker-compose build
docker-compose up -d
```

Menyimpan perubahan ke GitHub:

```powershell
git add -A
git commit -m "deskripsi perubahan"
git push
```
