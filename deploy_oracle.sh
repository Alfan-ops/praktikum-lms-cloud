#!/usr/bin/env bash
# ============================================================
# Script deploy LMS Praktikum ke Oracle Cloud VM (Ubuntu ARM).
# Menangani: install Docker, buka firewall, sesuaikan path Linux
# & IP publik di docker-compose.yml, lalu build & jalankan.
#
# CARA PAKAI (di dalam VM, setelah SSH):
#   git clone https://github.com/Alfan-ops/praktikum-lms-cloud.git
#   cd praktikum-lms-cloud
#   cp .env.example .env && nano .env      # isi kunci Supabase
#   chmod +x deploy_oracle.sh
#   ./deploy_oracle.sh
# ============================================================
set -e

echo "=================================================="
echo " Deploy LMS Praktikum -> Oracle Cloud VM"
echo "=================================================="

PROJECT_DIR="$(pwd)"

# --- 0. Cek .env ---
if [ ! -f ".env" ]; then
  echo "[!] File .env belum ada. Jalankan dulu:"
  echo "    cp .env.example .env && nano .env   (isi SUPABASE_URL & SERVICE_ROLE_KEY)"
  exit 1
fi

# --- 1. Deteksi IP publik ---
PUBLIC_IP=$(curl -s https://api.ipify.org || curl -s ifconfig.me || true)
if [ -z "$PUBLIC_IP" ]; then
  read -rp "[?] Tidak bisa deteksi IP publik otomatis. Masukkan IP publik VM: " PUBLIC_IP
fi
echo "[i] IP publik VM: $PUBLIC_IP"

# --- 2. Install Docker bila belum ada ---
if ! command -v docker >/dev/null 2>&1; then
  echo "[i] Docker belum ada, menginstal..."
  sudo apt-get update -y
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "[!] Docker terinstal. Kamu mungkin perlu logout & login SSH lagi,"
  echo "    lalu jalankan ulang ./deploy_oracle.sh"
fi

# --- 3. Buka firewall di dalam VM (iptables) ---
echo "[i] Membuka port firewall VM (3000, 3001, 9090, 8888-9000)..."
for p in 3000 3001 9090; do
  sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || \
  sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $p -j ACCEPT
done
sudo iptables -C INPUT -p tcp --dport 8888:9000 -j ACCEPT 2>/dev/null || \
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8888:9000 -j ACCEPT
# simpan aturan agar bertahan setelah reboot
sudo apt-get install -y netfilter-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save >/dev/null 2>&1 || true

# --- 4. Sesuaikan docker-compose.yml untuk Linux ---
echo "[i] Menyesuaikan docker-compose.yml (IP publik & path Linux)..."
# backup sekali
[ -f docker-compose.yml.bak ] || cp docker-compose.yml docker-compose.yml.bak

sed -i "s|ACCESSIBLE_HOST=.*|ACCESSIBLE_HOST=$PUBLIC_IP|g" docker-compose.yml
sed -i "s|HOST_USER_DATA_PATH=.*|HOST_USER_DATA_PATH=$PROJECT_DIR/orchestrator/user_data|g" docker-compose.yml
sed -i "s|HOST_MODULES_PATH=.*|HOST_MODULES_PATH=$PROJECT_DIR/orchestrator/modules|g" docker-compose.yml

echo "[i] Hasil penyesuaian:"
grep -E "ACCESSIBLE_HOST|HOST_USER_DATA_PATH|HOST_MODULES_PATH" docker-compose.yml | sed 's/^/    /'

# --- 5. Build & jalankan ---
echo "[i] Build & menjalankan container (bisa 5-15 menit pertama kali)..."
docker compose build
docker compose up -d

echo ""
echo "=================================================="
echo " SELESAI. Akses dari device manapun:"
echo "   LMS      : http://$PUBLIC_IP:3000"
echo "   Grafana  : http://$PUBLIC_IP:3001  (admin/admin)"
echo "   Prometheus: http://$PUBLIC_IP:9090"
echo "=================================================="
echo "[!] Pastikan port di atas juga dibuka di OCI Security List"
echo "    (Console -> VCN -> Security Lists -> Add Ingress Rules)."
echo "[i] Cek status: docker compose ps"
