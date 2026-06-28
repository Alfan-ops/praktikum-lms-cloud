import random
import pandas as pd
from locust import HttpUser, task, between, events
from queue import Queue

# --- KONFIGURASI ---
TOKEN_CSV_PATH = "locust_tokens.csv" # File yang dihasilkan oleh get_tokens.py
HOST_URL = "http://localhost:5001"

# Ganti dengan ID modul yang valid yang sudah Anda jadwalkan
VALID_MODULE_ID = 1 
# ---

# Global queue untuk menyimpan data pengguna
user_credentials_queue = Queue()

@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    """
    Dijalankan sekali saat tes dimulai. Membaca semua token dari CSV.
    """
    try:
        users_df = pd.read_csv(TOKEN_CSV_PATH)
        if users_df.empty:
            print(f"ERROR: {TOKEN_CSV_PATH} kosong atau tidak ditemukan!")
            environment.runner.quit()
            return

        print(f"Memuat {len(users_df)} pengguna dari {TOKEN_CSV_PATH}...")
        # Masukkan setiap pengguna (sebagai dict) ke dalam antrian
        for user_data in users_df.to_dict('records'):
            user_credentials_queue.put(user_data)
        
        print(f"Berhasil memuat {user_credentials_queue.qsize()} pengguna ke antrian.")

    except FileNotFoundError:
        print(f"KRITIS: File token {TOKEN_CSV_PATH} tidak ditemukan!")
        environment.runner.quit()
    except Exception as e:
        print(f"KRITIS: Gagal membaca {TOKEN_CSV_PATH}: {e}")
        environment.runner.quit()


class RealStudentUser(HttpUser):
    wait_time = between(1, 5) # Tunggu 1-5 detik antar task
    host = HOST_URL

    def on_start(self):
        """
        Dijalankan sekali per pengguna virtual. 
        Setiap pengguna mengambil satu data unik dari antrian.
        """
        if user_credentials_queue.empty():
            print("PERINGATAN: Antrian token kosong, pengguna ini tidak akan melakukan apa-apa.")
            self.stop(True) # Menghentikan user ini
            return
            
        try:
            # Ambil satu pengguna unik dari antrian
            user_data = user_credentials_queue.get_nowait()
            self.access_token = user_data['access_token']
            self.user_id = user_data['user_id']
            self.email = user_data['email']

            self.client.headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json"
            }
            # print(f"User {self.email} (ID: {self.user_id}) dimulai.")
            
            # Lakukan task "login"
            self.client.get("/api/my-courses", name="/api/my-courses")

        except:
            # Jika terjadi error saat mengambil (misal antrian kosong), hentikan user
            self.stop(True)


    @task(3)
    def view_courses_and_modules(self):
        """Simulasi mahasiswa melihat-lihat materi"""
        # 1. Lihat semua mata kuliah
        self.client.get("/api/my-courses", name="/api/my-courses")
        
        # 2. Lihat modul (contoh untuk course_id=1)
        self.client.get(f"/api/courses/1/modules", name="/api/courses/[id]/modules")

    @task(1)
    def start_lab_session(self):
        """
        Tes Kritis (Stress Test): 
        Setiap user UNIK mencoba memulai lab mereka sendiri.
        Ini akan memicu N (misal 50) container run di Docker.
        """
        payload = {
            "module_id": VALID_MODULE_ID
        }
        # Setiap request akan menggunakan token unik dari self.access_token
        self.client.post("/api/labs/start", 
                         json=payload, 
                         name="/api/labs/start")
    
    @task(2)
    def view_assignments(self):
        """Simulasi mahasiswa melihat halaman tugas"""
        self.client.get(f"/api/my-deadlines", name="/api/my-deadlines")