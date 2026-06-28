"""
Locustfile OPSI A — Uji langsung autoscaler Orchestrator.

Tujuan: membuktikan bahwa fitur autoscaling (semaphore + antrian) di
orchestrator bekerja saat terjadi lonjakan permintaan pembuatan container.

Cara kerja tes:
- Setiap user virtual = 1 "mahasiswa" dengan nama grup UNIK.
- Saat user muncul (on_start), ia mengirim 1 permintaan POST /deploy.
- Orchestrator akan:
    * 200 -> container langsung dibuat (ada slot kosong)
    * 202 -> masuk antrian (semua slot penuh, autoscaler mengantri)
    * 503 -> antrian penuh (beban melebihi kapasitas maksimum)
- Setelah deploy, user memantau /autoscaler/status untuk melihat
  berapa slot aktif & panjang antrian secara real-time.

Jalankan:
    python -m locust -f locustfile_orchestrator.py

Lalu buka http://localhost:8089
    Host: http://localhost:4000   (PORT ORCHESTRATOR, bukan 5001)
"""

import uuid
import threading
from locust import HttpUser, task, between, events

# Notebook yang dipakai (harus ada di orchestrator/modules/jupyter)
NOTEBOOK = "praktikum_ml_iris.ipynb"

# Penghitung global agar nama grup benar-benar unik & berurutan
_counter = 0
_counter_lock = threading.Lock()


def next_group_name():
    global _counter
    with _counter_lock:
        _counter += 1
        n = _counter
    # Nama unik: gabungan nomor urut + uuid pendek
    return f"loadtest-{n}-{uuid.uuid4().hex[:6]}"


@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    print("=" * 60)
    print("OPSI A: Uji autoscaler Orchestrator (POST /deploy)")
    print("Pastikan Host = http://localhost:4000 (PORT ORCHESTRATOR)")
    print("Setiap user membuat 1 container dengan grup unik.")
    print("=" * 60)


class OrchestratorUser(HttpUser):
    wait_time = between(2, 5)

    def on_start(self):
        """Setiap user mencoba membuat 1 container (memicu autoscaler)."""
        self.group_name = next_group_name()
        payload = {
            "group": self.group_name,
            "tool": "jupyter",
            "module": NOTEBOOK,
        }
        # catch_response agar 202 (queued) tetap dihitung SUKSES, bukan gagal
        with self.client.post(
            "/deploy",
            json=payload,
            name="POST /deploy (buat container)",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 202):
                resp.success()
            else:
                resp.failure(f"Status {resp.status_code}: {resp.text[:120]}")

    @task
    def check_autoscaler(self):
        """Pantau status autoscaler (slot aktif & antrian)."""
        self.client.get(
            "/autoscaler/status",
            name="GET /autoscaler/status",
        )
