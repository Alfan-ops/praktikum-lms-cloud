# Catatan Kerja — 1 Juli 2026

Ringkasan semua yang dikerjakan hari ini beserta langkah-langkah penting,
agar bisa dibaca ulang sewaktu-waktu.

---

## Ikhtisar Capaian Hari Ini

1. **Perbaikan kode** — bug progress tracking (mahasiswa baru 100% → 0%)
2. **Dashboard Grafana** — monitoring per-container ditambahkan & divisualisasikan
3. **Kode disimpan ke GitHub** — repo `Alfan-ops/praktikum-lms-cloud`
4. **Deploy ke Oracle Cloud** — LMS kini ONLINE di internet, bisa diakses lintas jaringan
5. **Dokumen pendukung** — PPT progress, PPT perubahan kode, cheatsheet, panduan

---

## BAGIAN 1 — Perbaikan Kode

### Bug progress tracking (`backend/management.py`)
- **Masalah:** mahasiswa baru tampil progress 100% padahal belum mengerjakan.
- **Sebab:** baris `elif total_assignments == 0: progress = 100`.
- **Perbaikan:** kondisi dihapus; progress mulai 0%, naik dari submission.
- **Verifikasi:** Arceus (belum submit)=0%, Articuno (submit)=100%.

### Dashboard Grafana monitoring per-container
File baru:
- `docker-compose.yml` → tambah service `grafana` (port 3001)
- `grafana/provisioning/datasources/prometheus.yml` → datasource otomatis
- `grafana/provisioning/dashboards/dashboards.yml` → provider dashboard
- `grafana/dashboards/lms-containers.json` → dashboard 7 panel (CPU, memori,
  gauge, tabel per-NIM), auto-refresh 5 detik
- Perbaikan tabel: transformasi `merge` → `joinByField` (1 baris per container)

---

## BAGIAN 2 — Menyimpan Kode ke GitHub

Repo: **https://github.com/Alfan-ops/praktikum-lms-cloud** (branch `main`)

### Langkah yang dilakukan
1. `git init` di folder proyek (sebelumnya bukan git repo)
2. Buat `.gitignore` — melindungi `.env`, `*_tokens.csv`, `users_to_import.csv`,
   `.venv/`, `node_modules/`, `user_data/`
3. Buat `.env.example` (template tanpa nilai rahasia)
4. `git add -A` → commit → `git push`

### Update kode ke GitHub (dipakai berulang)
```powershell
git add -A
git commit -m "deskripsi perubahan"
git push
```

### Ambil perubahan terbaru
```powershell
git pull
```

> PENTING: file `.env` (kunci Supabase) TIDAK ikut ke GitHub demi keamanan.

---

## BAGIAN 3 — Deploy ke Oracle Cloud (LMS Online)

Tujuan: LMS bisa diakses dari device & jaringan manapun, gratis.

### Hasil
- **URL LMS: http://168.110.216.236:3000**
- **Grafana: http://168.110.216.236:3001** (admin/admin)
- **Prometheus: http://168.110.216.236:9090**
- VM: `lms-praktikum`, Oracle Always Free ARM (Ubuntu 22.04), region Batam, $0

### Langkah-langkah penting (urut)

**A. Buat VM di Oracle Console**
1. Compute → Instances → Create instance
2. Image: Canonical Ubuntu 22.04; Shape: **VM.Standard.A1.Flex** (Always Free)
3. Networking: **Create new VCN** + **Create new public subnet**
4. SSH keys: **Generate a key pair** → **Download private key** (simpan!)
5. Create → tunggu **RUNNING**

**B. Pasang Public IP** (toggle di wizard sering ngadat, jadi dipasang setelah VM jadi)
1. Networking instance → Quick action **"Connect public subnet to internet"** → Create
2. VNIC → IP administration → IPv4 addresses → baris private IP → **⋮ → Edit**
3. Public IP type → **Ephemeral public IP** → Update → catat IP

**C. Buka Port (Firewall Cloud)**
- Networking → VCN → Subnets → subnet → **Default Security List** → Add Ingress Rules
- Source `0.0.0.0/0`, TCP, port: **22, 3000, 3001, 9090, 8888-9000**

**D. SSH dari Windows (PowerShell)**
```powershell
$key = "C:\Users\aqila\Downloads\ssh-key-2026-07-01.key"
icacls $key /reset
icacls $key /inheritance:r
icacls $key /grant:r "$($env:USERNAME):R"
ssh -i $key ubuntu@168.110.216.236
```
(ketik `yes` saat ditanya fingerprint)

**E. Deploy Proyek (di dalam VM)**
```bash
cd ~
git clone https://github.com/Alfan-ops/praktikum-lms-cloud.git
cd praktikum-lms-cloud
cp .env.example .env
nano .env        # isi SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY, lalu Ctrl+O, Enter, Ctrl+X

# install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit             # logout lalu SSH lagi agar grup docker aktif
```
SSH lagi, lalu:
```bash
cd praktikum-lms-cloud
chmod +x deploy_oracle.sh
./deploy_oracle.sh
```
Script otomatis: buka firewall VM (iptables), sesuaikan `ACCESSIBLE_HOST` (IP publik)
& path Linux di `docker-compose.yml`, lalu build & jalankan container.

### Masalah yang ditemui & solusinya
- **Build gagal di `gevent` (ARM tanpa compiler C).**
  Solusi: `orchestrator/Dockerfile` ditambah build tools
  (`gcc build-essential libffi-dev`) sebelum `pip install`. Commit + push,
  lalu di VM: `git pull && docker compose build && docker compose up -d`.

### Cek status container di VM
```bash
docker compose ps      # semua harus Up
```

---

## BAGIAN 4 — Operasional Penting

### Update kode di VM (setelah push dari laptop)
```bash
cd ~/praktikum-lms-cloud
git pull
docker compose build
docker compose up -d
```

### Agar container auto-nyala setelah VM reboot
```bash
docker update --restart unless-stopped $(docker ps -q)
```

### Tentang Public IP
- **Ephemeral** — tetap sama selama VM JALAN & saat reboot.
- Berubah HANYA jika VM di-**Stop** lalu Start. Jadi **jangan Stop** VM.
- Untuk permanen: ubah ke **Reserved Public IP** (belum dilakukan).

### Agar tidak di-reclaim Oracle (idle)
- Opsi: upgrade akun ke **Pay As You Go** (tetap $0 dalam batas gratis, tapi
  VM tidak akan di-reclaim). Belum dilakukan.

---

## Akun & Akses Penting

| Item | Nilai |
|---|---|
| LMS | http://168.110.216.236:3000 |
| Grafana | http://168.110.216.236:3001 (admin/admin) |
| Prometheus | http://168.110.216.236:9090 |
| SSH | `ssh -i <key> ubuntu@168.110.216.236` |
| Repo GitHub | https://github.com/Alfan-ops/praktikum-lms-cloud |
| Mahasiswa (submit) | articuno@itb.ac.id / student123 |
| Mahasiswa (belum) | arceus@itb.ac.id / student123 |

---

## File Dokumentasi Lain di Repo

- `SETUP.md` — setup di device baru
- `PANDUAN_OPERASIONAL.md` — locust, predictive autoscaling, monitoring, git
- `CHEATSHEET_PRESENTASI.md` — persiapan presentasi
- `DEPLOY_ORACLE_CLOUD.md` — panduan deploy Oracle lengkap
- `PENJELASAN_PERUBAHAN_KODE.md` — detail perubahan kode (7 tema)
- `deploy_oracle.sh` — script otomasi deploy
- `_arsip_perubahan_2026-06-28/CHANGELOG.md` — changelog lengkap (Bagian A–H)
- PPT: `Progress_TA_LMS_Praktikum.pptx`, `Perubahan_Kode_TA.pptx`

---

## Yang Belum Dikerjakan (opsional, untuk nanti)

- Set auto-restart container (`docker update --restart ...`) di VM
- Reserved Public IP (agar 100% permanen)
- Upgrade Pay As You Go (anti idle-reclaim)
- Tes "Launch Lab" (Jupyter) dari device lain lewat internet
- Integrasi FB Prophet → autoscaling (memperkuat klaim "predictive")
- Validasi 100 user di hardware lebih tinggi
```
