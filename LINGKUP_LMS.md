# Lingkup Praktikum yang Dapat Dijalankan di LMS

Ringkasan kemampuan platform lab virtual LMS (per 2026-07-02).

## Jawaban singkat

Lab pada dasarnya adalah **Jupyter Notebook + Python 3** dengan stack
`numpy`, `pandas`, `scikit-learn`, `matplotlib`, `seaborn` (dan library lain
yang bisa `pip install`). Maka **semua praktikum yang bisa dihitung/
disimulasikan dengan kode Python dapat dijalankan** — termasuk Antena &
Saluran Transmisi sebagai simulasi numerik. Yang **tidak** bisa adalah hal yang
butuh perangkat keras nyata atau software EM komersial berbasis GUI.

## ✅ Bisa dijalankan

- Machine Learning / Data Science (contoh aktif: **Iris**, **Prediksi Kualitas Sinyal Jaringan**)
- Pengolahan sinyal digital (DSP): FFT, filter, modulasi (`numpy`, `scipy`)
- Komunikasi: BER, konstelasi QAM/PSK, kanal AWGN
- **Antena & Saluran Transmisi** (simulasi numerik — lihat bawah)
- Komputasi numerik, visualisasi, statistika

## ❌ Tidak bisa

- Pengukuran perangkat keras nyata (VNA, spectrum analyzer, antena di anechoic chamber)
- Software EM solver komersial berbasis GUI (CST, HFSS, FEKO, ADS)
- Beban berat / GPU (image minimal, limit ~1 core / 1 GB per lab, tanpa GPU)
- Kernel non-Python (MATLAB/Octave/Verilog) kecuali ditambahkan ke image

## Khusus "Antena dan Saluran Transmisi"

**Bisa** sebagai simulasi numerik. Topik yang cocok di Jupyter:

- **Saluran transmisi**: koefisien refleksi (Γ), VSWR, impedansi input,
  panjang gelombang, **Smith chart**, impedance matching (stub, quarter-wave)
- **Antena**: pola radiasi, **array factor** antena array, directivity,
  half-power beamwidth, dipole/half-wave

Semua murni matematis → cukup `numpy` + `matplotlib`. Untuk analisis RF/
microwave lebih lengkap (S-parameter, Smith chart otomatis) tersedia library
**`scikit-rf`** (tinggal `pip install`), tetapi **belum ada di image** — perlu
ditambahkan ke `jupyter_image/Dockerfile` bila akan dipakai.

## Cara mengaktifkan modul baru (3 langkah)

Sama seperti modul Telekomunikasi:

1. Buat notebook `<Nama>_Praktikum.ipynb`.
2. (Opsional) tambahkan library yang diperlukan di `jupyter_image/Dockerfile`,
   lalu build ulang image lab di VM ARM & push.
3. Bake notebook (`COPY` di Dockerfile) + tambah keyword di
   `notebook_for_module()` (backend/management.py) + seed course/module
   (contoh: `backend/seed_telekom.py`) + buat jadwal.

## ⚠️ Keterbatasan penting

- **Pekerjaan mahasiswa belum persisten**: notebook di-bake ke image dan
  direktori kerja bersifat *ephemeral* (tidak ada PersistentVolume). Bila pod
  di-restart/dihapus, perubahan mahasiswa hilang. Untuk menyimpan hasil,
  gunakan fitur submit (Assignments) atau tambahkan PVC per mahasiswa.
- Satu sesi lab aktif per mahasiswa (lab dikunci per-NIM).
