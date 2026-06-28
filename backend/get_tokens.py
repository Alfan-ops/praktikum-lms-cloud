import os
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client, Client
import time

# Muat environment variables dari file .env di folder backend
load_dotenv() 

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") # Gunakan service key untuk key anon

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Pastikan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY ada di file .env Anda")
    exit()

# Ganti ini ke path tempat Anda menyimpan users_to_import.csv
# Gunakan path absolut jika perlu
USER_CSV_PATH = "../users_to_import.csv" 
TOKEN_OUTPUT_PATH = "locust_tokens.csv"

def get_tokens():
    try:
        # Gunakan service key sebagai anon key untuk signin
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) 
        print(f"Berhasil terhubung ke Supabase di {SUPABASE_URL}")
    except Exception as e:
        print(f"Gagal terhubung ke Supabase: {e}")
        return

    try:
        users_df = pd.read_csv(USER_CSV_PATH)
        print(f"Berhasil membaca {len(users_df)} pengguna dari {USER_CSV_PATH}")
    except FileNotFoundError:
        print(f"ERROR: File {USER_CSV_PATH} tidak ditemukan.")
        print("Pastikan path di variabel USER_CSV_PATH sudah benar.")
        return
    except Exception as e:
        print(f"Gagal membaca CSV: {e}")
        return

    tokens = []
    total_users = len(users_df)

    for index, row in users_df.iterrows():
        email = row['email']
        password = row['password']
        
        print(f"Mencoba login... [{index + 1}/{total_users}] {email}")
        
        try:
            # Ganti service_key ke anon_key jika Anda punya
            # Tapi karena ini skrip admin, service_key/anon_key untuk sign_in_with_password
            # Kita perlu key anon, bukan service key. Mari kita hardcode dari frontend.
            # Ambil dari src/utils/supabase/info.tsx
            ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4bmJxdGh4dG5rYnNibXptdWNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMjAxNDIsImV4cCI6MjA5Nzg5NjE0Mn0.aDgoMqAtZM7R_k2PS4Jb3PpXndkFWaO7np92MrFbPIk"
            client_anon: Client = create_client(SUPABASE_URL, ANON_KEY)

            res = client_anon.auth.sign_in_with_password({
                "email": email,
                "password": password
            })
            
            if res.session and res.session.access_token:
                tokens.append({
                    "email": email,
                    "access_token": res.session.access_token,
                    "user_id": res.user.id
                })
                print(f"  > SUKSES: Token didapat untuk {email}")
            else:
                print(f"  > GAGAL: Tidak ada sesi/token untuk {email}. Error: {res.error}")
                
        except Exception as e:
            print(f"  > GAGAL: Exception saat login {email}: {e}")
        
        # Beri jeda agar tidak di-rate-limit oleh Supabase
        # (Supabase auth membatasi kecepatan login; 0.1s terlalu cepat)
        time.sleep(2)

    # Simpan token ke CSV baru
    if tokens:
        token_df = pd.DataFrame(tokens)
        token_df.to_csv(TOKEN_OUTPUT_PATH, index=False)
        print(f"\nBerhasil! {len(tokens)} token disimpan ke {TOKEN_OUTPUT_PATH}")
    else:
        print("\nTidak ada token yang berhasil didapat.")

if __name__ == "__main__":
    get_tokens()