# Deploy ke Oracle Cloud Always Free

Panduan mendaftar Oracle Cloud (tier gratis) dan men-deploy LMS Praktikum ke VM-nya,
agar bisa diakses dari device & jaringan manapun lewat internet — **gratis**.

> **Spesifikasi gratis (per Juni 2026):** ARM Ampere A1, **2 OCPU + 12 GB RAM**,
> 200 GB storage, 10 TB bandwidth/bulan. (Sebelumnya 4 OCPU/24GB — diturunkan untuk
> akun free tier.) 12 GB masih cukup untuk demo dengan beberapa container Jupyter.

---

## Bagian 1 — Daftar Oracle Cloud Always Free

1. Buka https://www.oracle.com/cloud/free/
2. Klik **Start for free**
3. Isi data: email, negara (**Indonesia**), nama
4. Verifikasi email → buat password
5. **Verifikasi kartu kredit/debit atau PayPal** (wajib, untuk anti-fraud)
   - Ada hold sementara ~Rp15rb–80rb, dikembalikan otomatis
   - Selama tetap di batas "Always Free", **tidak ada tagihan**
6. Pilih **Home Region** — penting:
   - Pilih region yang dekat & tidak terlalu penuh, mis. **Singapore** atau **Japan (Tokyo)**
   - Region tidak bisa diubah setelah dipilih
7. Tunggu akun aktif (beberapa menit)

> **Tips anti-tagihan:** setelah akun jadi, masuk **Billing → Upgrade and Manage Payment**
> dan pastikan akun tetap "Always Free" / jangan upgrade ke Pay As You Go kecuali perlu.

---

## Bagian 2 — Buat VM (Instance) ARM

1. Menu ☰ → **Compute → Instances → Create Instance**
2. **Name:** `lms-praktikum`
3. **Image & Shape:**
   - Image: **Canonical Ubuntu 22.04**
   - Klik **Edit Shape → Ampere (ARM)** → pilih **VM.Standard.A1.Flex**
   - Set **2 OCPU** dan **12 GB RAM** (batas gratis)
4. **Networking:** biarkan default (buat VCN baru), pastikan **Assign public IPv4 = yes**
5. **SSH Keys:** klik **Generate a key pair for me** → **Download private key** (simpan baik-baik, untuk login)
6. Klik **Create**

> ⚠️ **"Out of host capacity"** sering muncul untuk ARM gratis. Kalau gagal:
> - Coba lagi beberapa kali (bisa pakai script retry), atau
> - Coba Availability Domain lain, atau ganti jam (kapasitas berubah-ubah)

Setelah aktif, catat **Public IP address** instance (mis. `152.x.x.x`).

---

## Bagian 3 — Buka Port di Firewall (DUA lapis)

Oracle punya dua lapis firewall yang keduanya harus dibuka.

### 3a. Security List (level cloud)
1. Instance → klik nama **VCN** → **Security Lists** → **Default Security List**
2. **Add Ingress Rules** untuk tiap port:
   - Source `0.0.0.0/0`, IP Protocol TCP, Destination Port **3000** (LMS)
   - (opsional) **3001** Grafana, **9090** Prometheus
   - **8888-9000** (range port Jupyter Launch Lab — lihat catatan di bawah)

### 3b. Firewall di dalam VM (iptables Ubuntu)
Image Ubuntu Oracle memblokir hampir semua port secara default. Setelah login SSH (Bagian 4):
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3001 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8888:9000 -j ACCEPT
sudo netfilter-persistent save
```

---

## Bagian 4 — Login ke VM & Install Docker

Login lewat SSH (dari laptop, pakai private key tadi):
```bash
ssh -i /path/ke/private_key ubuntu@152.x.x.x
```

Install Docker + Compose:
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# logout & login lagi agar grup docker aktif
exit
```
Login lagi, verifikasi: `docker --version` dan `docker compose version`.

---

## Bagian 5 — Deploy Proyek

```bash
# Clone repo
git clone https://github.com/Alfan-ops/praktikum-lms-cloud.git
cd praktikum-lms-cloud

# Buat .env (isi kunci Supabase asli)
cp .env.example .env
nano .env        # isi SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY
```

### Sesuaikan `docker-compose.yml` untuk VM Linux
Edit `nano docker-compose.yml`, ubah di service **orchestrator**:

```yaml
# 1) ACCESSIBLE_HOST → IP publik VM (agar URL Jupyter bisa diakses dari luar)
- ACCESSIBLE_HOST=152.x.x.x

# 2) Path host: di Linux TIDAK pakai /host_mnt/c/. Pakai path asli VM:
- HOST_USER_DATA_PATH=/home/ubuntu/praktikum-lms-cloud/orchestrator/user_data
- HOST_MODULES_PATH=/home/ubuntu/praktikum-lms-cloud/orchestrator/modules
```

### Build & jalankan
```bash
docker compose build
docker compose up -d
docker compose ps
```

---

## Bagian 6 — Akses dari Device Manapun

| Layanan | URL |
|---|---|
| LMS | http://152.x.x.x:3000 |
| Grafana | http://152.x.x.x:3001 |
| Prometheus | http://152.x.x.x:9090 |

Kirim URL LMS ke dosen — bisa dibuka dari jaringan manapun. 🎉

---

## Catatan Penting (Baca Sebelum Deploy)

### 1. Arsitektur ARM
VM ini ARM (aarch64). Sebagian besar image mendukung ARM (python, node, redis,
prometheus, grafana, jupyter/scipy-notebook). Karena `docker compose build` membangun
di VM itu sendiri, image otomatis ter-build untuk ARM. Jika ada image yang gagal di ARM,
ganti tag image yang mendukung `arm64`.

### 2. "Launch Lab" (Jupyter) lewat internet
Tiap Launch Lab membuat container di port acak. Agar bisa diakses dari luar:
- `ACCESSIBLE_HOST` harus = IP publik VM (sudah diatur di Bagian 5)
- Range port (mis. 8888–9000) harus dibuka di firewall (Bagian 3)
- Pertimbangkan membatasi jumlah container agar 12 GB RAM tidak habis

### 3. Keamanan
- Jangan commit `.env` ke Git (sudah diabaikan `.gitignore`)
- Untuk demo singkat aman; untuk online permanen, tambahkan HTTPS (mis. Caddy/Nginx + domain gratis)

### 4. Kapasitas ARM gratis
Jika terus "Out of host capacity", alternatif: pakai VM x86 berbayar **per-jam**
(DigitalOcean/Vultr ~$0.07/jam, hapus setelah demo ≈ beberapa ribu rupiah).

---

## Mematikan / Menghemat

- **Stop instance** saat tidak dipakai: Compute → Instances → Stop
  (VM gratis tidak ditagih, tapi stop tetap praktik baik)
- **Terminate** jika sudah tidak perlu sama sekali

---

## Ringkasan Alur

```
Daftar Oracle (kartu utk verifikasi, region Singapore)
  → Buat VM ARM Ubuntu (2 OCPU/12GB)
  → Buka port (Security List + iptables)
  → SSH + install Docker
  → git clone + .env + ubah ACCESSIBLE_HOST & path Linux
  → docker compose up -d
  → akses http://<IP-publik>:3000 dari mana saja
```
