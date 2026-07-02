"""
Mendaftarkan MODUL TELEKOMUNIKASI ke LMS agar bisa dijalankan mahasiswa
(khususnya Teknik Telekomunikasi ITB).

Membuat rantai: period(aktif) -> course(TELKOM-ML) -> offering -> module
("Modul Telekomunikasi - Prediksi Kualitas Sinyal Jaringan"), lalu mengisi
module_content (teks pengantar + virtual_lab -> tombol "Launch Lab").

PENTING: judul modul sengaja memuat kata "Telekomunikasi/Sinyal" agar backend
(notebook_for_module di management.py) otomatis memilih notebook
ML_Telekomunikasi_Praktikum.ipynb (yang sudah di-bake di image lab).

PENGGUNAAN (jalankan dari folder backend/, .env berisi kredensial Supabase):
  python seed_telekom.py            # daftarkan modul + konten
  python seed_telekom.py --status   # tampilkan module_id & konten
  python seed_telekom.py --cleanup  # hapus konten modul telekom ini

Prasyarat: image lab sudah di-build ulang berisi ML_Telekomunikasi_Praktikum.ipynb.
"""

import argparse
import seed_schedules as s

COURSE_CODE = "TELKOM-ML"
COURSE_NAME = "Praktikum Machine Learning Telekomunikasi"
COURSE_DESC = "Penerapan machine learning pada permasalahan telekomunikasi."
MODULE_TITLE = "Modul Telekomunikasi - Prediksi Kualitas Sinyal Jaringan"
MODULE_DESC = "Melatih model ML untuk memprediksi kualitas sinyal jaringan telekomunikasi."
LAB_NAME = "Praktikum Telekomunikasi"
INTRO_TEXT = (
    "Selamat datang di Praktikum Machine Learning - Modul Telekomunikasi.\n\n"
    "Pada praktikum ini Anda akan membangun model machine learning untuk "
    "memprediksi kualitas sinyal jaringan berdasarkan parameter jaringan "
    "(mis. RSSI, SNR, jarak, interferensi). Klik tombol 'Launch Lab' di bawah "
    "untuk membuka Jupyter Notebook (ML_Telekomunikasi_Praktikum.ipynb) dan "
    "mulai mengerjakan."
)


def ensure_telekom_module(sb):
    """Buat/temukan course & module telekomunikasi. Return module_id."""
    # 1. Period aktif
    per = sb.table("periods").select("id").eq("is_active", True).limit(1).execute()
    if per.data:
        period_id = per.data[0]["id"]
    else:
        period_id = sb.table("periods").insert(
            {"year": 2025, "semester": "Ganjil", "is_active": True}
        ).execute().data[0]["id"]
        print(f"  + period dibuat (id={period_id})")

    # 2. Course TELKOM-ML
    crs = sb.table("courses").select("id").eq("course_code", COURSE_CODE).limit(1).execute()
    if crs.data:
        course_id = crs.data[0]["id"]
    else:
        course_id = sb.table("courses").insert(
            {"course_code": COURSE_CODE, "course_name": COURSE_NAME, "description": COURSE_DESC}
        ).execute().data[0]["id"]
        print(f"  + course '{COURSE_NAME}' dibuat (id={course_id})")

    # 3. Course offering (agar course tampil)
    off = sb.table("course_offerings").select("id") \
        .eq("course_id", course_id).eq("period_id", period_id).limit(1).execute()
    if not off.data:
        sb.table("course_offerings").insert(
            {"course_id": course_id, "period_id": period_id, "instructor_name": "Dosen Telekomunikasi"}
        ).execute()
        print("  + course_offering dibuat")

    # 4. Module telekom (cari berdasarkan judul agar idempoten)
    mod = sb.table("modules").select("id").eq("course_id", course_id) \
        .eq("module_title", MODULE_TITLE).limit(1).execute()
    if mod.data:
        return mod.data[0]["id"]
    module_id = sb.table("modules").insert(
        {"course_id": course_id, "module_title": MODULE_TITLE, "description": MODULE_DESC}
    ).execute().data[0]["id"]
    print(f"  + module '{MODULE_TITLE}' dibuat (id={module_id})")
    return module_id


def seed():
    sb = s.get_client()
    module_id = ensure_telekom_module(sb)

    existing = sb.table("module_content").select("id, content_type") \
        .eq("module_id", module_id).execute()
    if existing.data:
        print(f"Module {module_id} sudah punya {len(existing.data)} konten. Jalankan --cleanup untuk isi ulang.")
        return

    rows = [
        {"module_id": module_id, "content_type": "text",
         "content_data": {"text": INTRO_TEXT}, "order_index": 0},
        {"module_id": module_id, "content_type": "virtual_lab",
         "content_data": {"lab_name": LAB_NAME}, "order_index": 1},
    ]
    res = sb.table("module_content").insert(rows).execute()
    print("=" * 60)
    print(f"Modul Telekomunikasi aktif. module_id={module_id}")
    print(f"Ditambahkan {len(res.data)} konten (teks + virtual_lab).")
    print("=" * 60)
    print("Berikutnya: buat jadwal utk mahasiswa (Resources -> Schedule Session)")
    print(f"atau: python seed_schedules.py --count N --minutes 4 --module-id {module_id}")


def status():
    sb = s.get_client()
    crs = sb.table("courses").select("id").eq("course_code", COURSE_CODE).limit(1).execute()
    if not crs.data:
        print("Course telekom belum ada. Jalankan tanpa argumen untuk membuat.")
        return
    mod = sb.table("modules").select("id, module_title").eq("course_id", crs.data[0]["id"]) \
        .eq("module_title", MODULE_TITLE).limit(1).execute()
    if not mod.data:
        print("Module telekom belum ada.")
        return
    mid = mod.data[0]["id"]
    cont = sb.table("module_content").select("content_type, order_index").eq("module_id", mid).execute()
    print(f"module_id={mid} '{mod.data[0]['module_title']}'")
    for c in (cont.data or []):
        print(f"  - {c['content_type']} (order {c['order_index']})")


def cleanup():
    sb = s.get_client()
    crs = sb.table("courses").select("id").eq("course_code", COURSE_CODE).limit(1).execute()
    if not crs.data:
        print("Course telekom tidak ada.")
        return
    mod = sb.table("modules").select("id").eq("course_id", crs.data[0]["id"]) \
        .eq("module_title", MODULE_TITLE).limit(1).execute()
    if not mod.data:
        print("Module telekom tidak ada.")
        return
    n = len(sb.table("module_content").delete().eq("module_id", mod.data[0]["id"]).execute().data or [])
    print(f"Dihapus {n} konten dari module telekom (id={mod.data[0]['id']}).")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--cleanup", action="store_true")
    p.add_argument("--status", action="store_true")
    args = p.parse_args()
    if args.cleanup:
        cleanup()
    elif args.status:
        status()
    else:
        seed()
