# Image lab Jupyter — DIOPTIMASI agar jauh lebih kecil (~5GB -> ~2GB).
#
# Sebelumnya: FROM jupyter/scipy-notebook (~5GB) yang membawa banyak paket tak dipakai
# (dask, numba, bokeh, sympy, statsmodels, dll). Sekarang: base MINIMAL + hanya library
# yang benar-benar dipakai notebook praktikum Iris. Image lebih kecil = pull lebih cepat
# di tiap node baru = scale-out lebih cepat (mengatasi bottleneck yang ditemukan di Fase 6).
FROM jupyter/minimal-notebook:latest

# Hanya library yang dipakai praktikum_ml_iris.ipynb:
# pandas, scikit-learn, matplotlib, seaborn (numpy/scipy ikut sebagai dependensi).
RUN pip install --no-cache-dir \
        pandas \
        scikit-learn \
        matplotlib \
        seaborn \
    && conda clean --all -f -y \
    && rm -rf "/home/${NB_USER}/.cache"

# Bake notebook ke workspace. WAJIB untuk Kubernetes: tidak ada volume-copy seperti
# di versi Docker (app.py), jadi notebook harus sudah ada di dalam image.
COPY praktikum_ml_iris.ipynb /home/jovyan/work/

# Pastikan kepemilikan file benar
USER root
RUN chown -R 1000:100 /home/jovyan/work
USER $NB_UID
