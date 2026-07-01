# Rencana Migrasi ke Kubernetes — Predictive Autoscaling Skala Nyata

Dokumen rencana untuk menjawab tujuan: **melayani 100 user konkuren tanpa crash**
melalui Kubernetes + autoscaling prediktif (FB Prophet). Ditujukan sebagai bahan
diskusi & persetujuan dengan dosen pembimbing sebelum implementasi.

> **Konteks:** T50 sebelumnya mengganti rencana Kubernetes/KEDA (T40) dengan Docker SDK
> karena kompleksitas. Dokumen ini mengusulkan **menghidupkan kembali** arah Kubernetes
> secara terukur untuk membuktikan skalabilitas horizontal.

---

## 1. Kenapa Kubernetes (bukan Docker Compose)

Temuan T50: pada 1 host, ~50 container Jupyter membuat RAM/CPU habis → Docker crash
(kegagalan 91% pada `/api/labs/start`). Autoscaler reactive mencegah crash aplikasi,
tapi **tidak bisa melampaui kapasitas fisik satu host**.

Kubernetes menjawab ini dengan **horizontal scaling lintas node**:
- Pod (container Jupyter) tersebar ke **banyak worker node**.
- **Cluster Autoscaler** menambah node otomatis saat pod tak tertampung.
- **KEDA/HPA** menskalakan jumlah pod berdasarkan metrik.

---

## 2. Arsitektur Target

```
                 ┌─────────────── Ingress Controller (NGINX) ───────────────┐
                 │                                                          │
   Pengguna ──▶ Ingress ──▶ Frontend (Deployment)                          │
                 │              └─▶ Backend API (Deployment) ──▶ Supabase   │
                 │                        │                                 │
                 │                        ▼                                 │
                 │             Orchestrator (Deployment)                    │
                 │             (pakai Kubernetes API, BUKAN Docker SDK)     │
                 │                        │ create/delete                   │
                 │                        ▼                                 │
                 │        Jupyter Lab Pods (1 per mahasiswa)                │
                 │        + Service + Ingress path per pod                  │
                 └──────────────────────────────────────────────────────────┘

   Estimator (FB Prophet, CronJob) ──▶ forecast beban ──▶ Postgres/Supabase
                                                              │
                     KEDA ScaledObject  ◀── baca forecast ────┘
                     (scale pod SEBELUM lonjakan = PREDICTIVE)

   Prometheus + Grafana ──▶ metrik cluster & per-pod
   Cluster Autoscaler ──▶ tambah/kurang worker node
```

**Inti "predictive":** Estimator (Prophet) meramal beban jam berikutnya → tulis ke DB →
KEDA membaca angka forecast sebagai metrik → menaikkan jumlah pod **sebelum** mahasiswa
datang. Ini beda dari reactive (yang baru bereaksi setelah beban naik).

---

## 3. Perubahan Kode Utama

| Komponen | Sekarang (Docker) | Menjadi (Kubernetes) |
|---|---|---|
| Orchestrator spawn lab | `client.containers.run()` | Kubernetes Python client: buat **Deployment + Service + Ingress** per mahasiswa |
| Akses lab | port acak host + IP | **Ingress path** (mis. `/lab/<nim>`) |
| Data mahasiswa | bind mount host | **PersistentVolumeClaim** |
| Batas resource | argumen docker | `resources.requests/limits` di Pod spec |
| Autoscaling | semaphore in-memory | **KEDA ScaledObject** + **HPA** |
| Scaling prediktif | scheduler pre-warm | **Prophet → metrik → KEDA** |
| Skala node | — | **Cluster Autoscaler** |

File `orchestrator/app.py` adalah perubahan terbesar (rewrite fungsi deploy/stop).

---

## 4. Pilihan Provider (Rekomendasi)

| Provider | Control plane | Worker node | Catatan |
|---|---|---|---|
| **Oracle OKE** (rekomendasi) | Gratis (Basic) | Bisa campur **A1 Always Free (24GB)** + node berbayar | Sudah punya akun; termurah |
| DigitalOcean DOKS | ~$12/bln | Node ~$12–48/bln | Paling sederhana dipakai |
| Google GKE | Ada biaya mgmt | Node bervariasi | Fitur terlengkap |

**Rekomendasi: Oracle OKE** — control plane gratis, dan worker node bisa memakai jatah
**Always Free A1 (4 OCPU/24GB)** sebagai node dasar, ditambah **node berbayar hanya saat
uji beban** (model bayar per jam → hapus setelah tes = murah).

**Estimasi biaya uji 100 user:** cluster dinyalakan beberapa jam saat load test lalu
node berbayar dihapus. Perkiraan kasar: **puluhan ribu rupiah per sesi uji**, bukan
langganan bulanan penuh.

---

## 5. Roadmap Bertahap

| Fase | Deliverable | Estimasi |
|---|---|---|
| **0. Persetujuan** | Diskusi pembimbing; sepakati scope & biaya | — |
| **1. Manifest dasar** | K8s manifest untuk service stateless (frontend, backend, redis, prometheus, grafana) | 2–3 hari |
| **2. Cluster** | Buat OKE cluster; deploy Fase 1; akses via Ingress | 1–2 hari |
| **3. Rewrite orchestrator** | Ganti Docker SDK → Kubernetes API (spawn lab sbg Pod+Service+Ingress) | 1–2 minggu |
| **4. Autoscaling reactive** | Pasang KEDA/HPA + Cluster Autoscaler; uji scale-out | 3–5 hari |
| **5. Predictive (Prophet)** | Estimator CronJob → forecast → KEDA metrik → pre-scale | 1 minggu |
| **6. Validasi 100 user** | Load test Locust; kumpulkan grafik "100 user, 0% gagal" | 3–5 hari |

Total realistis: **4–6 minggu** kerja fokus.

---

## 6. Risiko & Catatan

- **Biaya membengkak** bila cluster lupa dimatikan → selalu hapus node berbayar setelah tes.
- **Kompleksitas** jauh lebih tinggi dari Docker; butuh belajar konsep K8s.
- **Deployment Docker yang sekarang tetap dipertahankan** (di Oracle VM) sebagai fallback
  yang sudah berfungsi — migrasi K8s dikerjakan di jalur terpisah, tidak merusak yang ada.
- **Wajib konfirmasi pembimbing** karena membalik keputusan T50.

---

## 7. Keputusan yang Masih Diperlukan

1. Persetujuan pembimbing atas arah K8s (+ biaya).
2. Provider final (default: **Oracle OKE**).
3. Plafon biaya yang kamu siap keluarkan untuk sesi uji.
4. Target angka: benar-benar 100 user, atau cukup buktikan scale-out lintas node?

Setelah 4 poin ini jelas, kita mulai **Fase 1 (manifest dasar)** — bagian yang bisa
dikerjakan tanpa biaya dan tanpa menyentuh deployment yang sekarang.
