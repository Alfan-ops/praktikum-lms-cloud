import csv
import os
import itertools
import threading
from locust import HttpUser, task, between, events

# ============================================================
# KONFIGURASI
# ============================================================
HOST_URL = "http://localhost:5001"
VALID_MODULE_ID = 1

# File token unik per mahasiswa, dihasilkan oleh get_tokens.py
TOKEN_CSV_PATH = os.environ.get("TOKEN_CSV_PATH", "locust_tokens.csv")

# ============================================================
# MUAT TOKEN UNIK SAAT LOCUST START
# ============================================================
# Setiap user virtual akan mengambil 1 token berbeda dari daftar ini
# (round-robin). Ini memperbaiki bug metodologi T50 di mana 100 user
# virtual memakai 1 token yang sama sehingga memicu cascade 403.
TOKENS = []
_token_cycle = None
_token_lock = threading.Lock()


def load_tokens():
    """Baca semua access_token dari CSV hasil get_tokens.py."""
    tokens = []
    if not os.path.exists(TOKEN_CSV_PATH):
        return tokens
    with open(TOKEN_CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            token = (row.get("access_token") or "").strip()
            if token:
                tokens.append(token)
    return tokens


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    global TOKENS, _token_cycle
    TOKENS = load_tokens()
    _token_cycle = itertools.cycle(TOKENS) if TOKENS else None

    if not TOKENS:
        print("=" * 60)
        print(f"FATAL: Tidak ada token di '{TOKEN_CSV_PATH}'.")
        print("Jalankan dulu: python get_tokens.py")
        print("=" * 60)
    else:
        print("=" * 60)
        print(f"Berhasil memuat {len(TOKENS)} token unik dari {TOKEN_CSV_PATH}")
        print("Token akan dibagikan round-robin ke setiap user virtual.")
        print("=" * 60)


def next_token():
    """Ambil token berikutnya secara thread-safe (round-robin)."""
    if _token_cycle is None:
        return None
    with _token_lock:
        return next(_token_cycle)


# ============================================================
# SKENARIO PENGGUNA
# ============================================================
class StudentUser(HttpUser):
    wait_time = between(1, 5)
    host = HOST_URL

    def on_start(self):
        """Dijalankan sekali per user virtual: ambil token unik & 'login'."""
        token = next_token()
        if not token:
            # Tidak ada token -> hentikan user ini agar tidak mengotori hasil
            self.environment.runner.quit()
            return

        self.client.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        # Validasi token (sekaligus warm-up)
        self.client.get("/api/my-courses", name="/api/my-courses")

    @task(3)
    def view_courses_and_modules(self):
        """Simulasi mahasiswa melihat-lihat materi."""
        self.client.get("/api/my-courses", name="/api/my-courses")
        self.client.get("/api/courses/1/modules", name="/api/courses/[id]/modules")

    @task(1)
    def start_lab_session(self):
        """
        Tes Kritis (Stress Test):
        Mensimulasikan mahasiswa mengklik 'Launch Lab'.
        Memicu: Backend -> Orchestrator -> Docker container run.
        """
        payload = {"module_id": VALID_MODULE_ID}
        self.client.post(
            "/api/labs/start",
            json=payload,
            name="/api/labs/start",
        )

    @task(2)
    def view_assignments(self):
        """Simulasi mahasiswa melihat halaman tugas."""
        self.client.get("/api/my-deadlines", name="/api/my-deadlines")
