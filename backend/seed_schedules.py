"""
OPSI B — Demonstrasi PREDICTIVE Autoscaling.

Skrip ini mengisi tabel `practikum_schedules` dengan sesi berstatus PENDING
yang waktu mulainya beberapa menit ke depan. Background scheduler di backend
(check_schedules, jalan tiap 30 detik) akan otomatis MENYIAPKAN container
SEBELUM waktu mulai (pre-warm dalam jendela 5 menit) — inilah bukti predictive.

Sumber student_id: locust_tokens.csv (kolom user_id) hasil get_tokens.py.

PENGGUNAAN:
  # Buat 10 jadwal yang mulai 4 menit dari sekarang (aman untuk laptop):
  python seed_schedules.py --count 10 --minutes 4

  # Buat 50 jadwal (HANYA di laptop spek tinggi):
  python seed_schedules.py --count 50 --minutes 4

  # Hapus semua jadwal hasil seed (cleanup):
  python seed_schedules.py --cleanup

Catatan: jadwal hasil seed ditandai feedback="OPSI_B_SEED" agar mudah dibersihkan.
"""

import os
import csv
import argparse
import datetime
from supabase import create_client, Client


def load_env_file():
    """Baca .env secara manual (tanpa library python-dotenv).
    Cek backend/.env lalu ../.env (root proyek)."""
    candidates = [".env", os.path.join("..", ".env")]
    for path in candidates:
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
            return path
    return None


load_env_file()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
TOKEN_CSV = "locust_tokens.csv"
SEED_MARKER = "OPSI_B_SEED"
DEFAULT_MODULE_ID = 1


def get_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak ada di .env")
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def read_user_ids(limit):
    if not os.path.exists(TOKEN_CSV):
        raise SystemExit(f"{TOKEN_CSV} tidak ditemukan. Jalankan get_tokens.py dulu.")
    ids = []
    with open(TOKEN_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            uid = (row.get("user_id") or "").strip()
            if uid:
                ids.append(uid)
    return ids[:limit]


def ensure_module(sb):
    """Pastikan ada minimal 1 module (buat rantai period->course->module bila kosong).
    Mengembalikan module_id yang valid."""
    # Sudah ada module?
    mod = sb.table("modules").select("id").limit(1).execute()
    if mod.data:
        return mod.data[0]["id"]

    print("Tabel modules kosong. Membuat prasyarat (period -> course -> module)...")

    # 1. Period aktif
    per = sb.table("periods").select("id").eq("is_active", True).limit(1).execute()
    if per.data:
        period_id = per.data[0]["id"]
    else:
        per_ins = sb.table("periods").insert(
            {"year": 2025, "semester": "Ganjil", "is_active": True}
        ).execute()
        period_id = per_ins.data[0]["id"]
        print(f"  + period dibuat (id={period_id})")

    # 2. Course
    crs = sb.table("courses").select("id").eq("course_code", "ML-TEST").limit(1).execute()
    if crs.data:
        course_id = crs.data[0]["id"]
    else:
        crs_ins = sb.table("courses").insert(
            {
                "course_code": "ML-TEST",
                "course_name": "Praktikum Machine Learning (Uji)",
                "description": "Course untuk demonstrasi predictive autoscaling",
            }
        ).execute()
        course_id = crs_ins.data[0]["id"]
        print(f"  + course dibuat (id={course_id})")

    # 3. Course offering (agar course muncul; tidak wajib untuk scheduler)
    off = (
        sb.table("course_offerings")
        .select("id")
        .eq("course_id", course_id)
        .eq("period_id", period_id)
        .limit(1)
        .execute()
    )
    if not off.data:
        sb.table("course_offerings").insert(
            {"course_id": course_id, "period_id": period_id, "instructor_name": "Dosen Uji"}
        ).execute()
        print("  + course_offering dibuat")

    # 4. Module
    mod_ins = sb.table("modules").insert(
        {
            "course_id": course_id,
            "module_title": "Modul Iris (Uji)",
            "description": "Modul untuk demonstrasi predictive autoscaling",
        }
    ).execute()
    module_id = mod_ins.data[0]["id"]
    print(f"  + module dibuat (id={module_id})")
    return module_id


def seed(count, minutes, module_id):
    sb = get_client()
    user_ids = read_user_ids(count)
    if not user_ids:
        raise SystemExit("Tidak ada user_id di CSV.")

    # Pastikan module_id valid (buat prasyarat bila perlu)
    module_id = ensure_module(sb)

    now = datetime.datetime.now(datetime.timezone.utc)
    start_time = (now + datetime.timedelta(minutes=minutes)).isoformat()
    end_time = (now + datetime.timedelta(minutes=minutes + 60)).isoformat()

    rows = [
        {
            "module_id": module_id,
            "student_id": uid,
            "start_time": start_time,
            "end_time": end_time,
            "cpu_limit": "1",
            "memory_limit": "1g",
            "storage_limit": "2g",
            "status": "PENDING",
        }
        for uid in user_ids
    ]
    res = sb.table("practikum_schedules").insert(rows).execute()
    n = len(res.data) if res.data else 0
    print("=" * 60)
    print(f"Berhasil membuat {n} jadwal PENDING.")
    print(f"  Waktu mulai : {start_time}  (~{minutes} menit dari sekarang)")
    print(f"  Waktu selesai: {end_time}")
    print(f"  module_id   : {module_id}")
    print("=" * 60)
    print("Scheduler akan otomatis pre-warm container dalam <5 menit.")
    print("Pantau: docker ps  (container 'praktikum_*' akan muncul)")
    print("Pantau status jadwal: python seed_schedules.py --status")


def status():
    sb = get_client()
    user_ids = read_user_ids(1000)
    res = (
        sb.table("practikum_schedules")
        .select("id, student_id, status, start_time")
        .in_("student_id", user_ids)
        .execute()
    )
    rows = res.data or []
    if not rows:
        print("Tidak ada jadwal untuk student tes.")
        return
    counts = {}
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    print(f"Total jadwal student tes: {len(rows)}")
    for st, c in counts.items():
        print(f"  {st}: {c}")


def cleanup():
    sb = get_client()
    user_ids = read_user_ids(1000)
    res = (
        sb.table("practikum_schedules")
        .delete()
        .in_("student_id", user_ids)
        .execute()
    )
    n = len(res.data) if res.data else 0
    print(f"Dihapus {n} jadwal student tes.")
    print("Hapus juga container-nya dengan: docker ps  lalu docker rm -f <nama>")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--count", type=int, default=10)
    p.add_argument("--minutes", type=int, default=4)
    p.add_argument("--module-id", type=int, default=DEFAULT_MODULE_ID)
    p.add_argument("--cleanup", action="store_true")
    p.add_argument("--status", action="store_true")
    args = p.parse_args()

    if args.cleanup:
        cleanup()
    elif args.status:
        status()
    else:
        seed(args.count, args.minutes, args.module_id)
