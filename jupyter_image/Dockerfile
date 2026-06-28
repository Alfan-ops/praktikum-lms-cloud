FROM jupyter/scipy-notebook:latest

# Tambah library praktikum kalau perlu, contoh scikit-learn, pandas, dsb.
RUN pip install scikit-learn pandas matplotlib

# Pastikan kepemilikan file benar
USER root
RUN chown -R 1000:100 /home/jovyan/work
USER $NB_UID
