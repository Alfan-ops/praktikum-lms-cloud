"""
Mengisi konten ke dalam module praktikum (karena data konten asli dari Supabase
teman tidak ikut termigrasi). Menambahkan:
  1. Konten teks (materi pengantar)
  2. Konten virtual_lab (memunculkan tombol "Launch Lab" untuk mahasiswa)

PENGGUNAAN:
  python seed_content.py            # isi konten ke module
  python seed_content.py --cleanup  # hapus konten module

Catatan: memakai get_client() & ensure_module() dari seed_schedules.py.
"""

import argparse
import seed_schedules as s

LAB_NAME = "Praktikum Iris"
INTRO_TEXT = (
    "Selamat datang di Praktikum Machine Learning - Modul Iris.\n\n"
    "Pada praktikum ini Anda akan mempelajari klasifikasi dataset Iris "
    "menggunakan Python dan scikit-learn. Klik tombol 'Launch Lab' di bawah "
    "untuk membuka Jupyter Notebook dan mulai mengerjakan."
)


def seed():
    sb = s.get_client()
    module_id = s.ensure_module(sb)

    # Hindari duplikat: cek konten existing
    existing = sb.table("module_content").select("id, content_type") \
        .eq("module_id", module_id).execute()
    if existing.data:
        print(f"Module {module_id} sudah punya {len(existing.data)} konten:")
        for c in existing.data:
            print(f"  - {c['content_type']}")
        print("Jalankan --cleanup dulu jika ingin mengisi ulang.")
        return

    rows = [
        {
            "module_id": module_id,
            "content_type": "text",
            "content_data": {"text": INTRO_TEXT},
            "order_index": 0,
        },
        {
            "module_id": module_id,
            "content_type": "virtual_lab",
            "content_data": {"lab_name": LAB_NAME},
            "order_index": 1,
        },
    ]
    res = sb.table("module_content").insert(rows).execute()
    print("=" * 60)
    print(f"Berhasil menambahkan {len(res.data)} konten ke module {module_id}:")
    print("  1. Materi teks (pengantar)")
    print(f"  2. Virtual Lab '{LAB_NAME}' -> memunculkan tombol Launch Lab")
    print("=" * 60)
    print("Mahasiswa kini bisa: Courses -> Continue -> modul -> Launch Lab")


def cleanup():
    sb = s.get_client()
    module_id = s.ensure_module(sb)
    res = sb.table("module_content").delete().eq("module_id", module_id).execute()
    n = len(res.data) if res.data else 0
    print(f"Dihapus {n} konten dari module {module_id}.")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--cleanup", action="store_true")
    args = p.parse_args()
    cleanup() if args.cleanup else seed()
