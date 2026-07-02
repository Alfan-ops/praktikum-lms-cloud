#!/usr/bin/env python3
"""
plot_autoscale.py — Membuat grafik autoscaling dari CSV hasil
collect_autoscale_metrics.sh (k8s/), untuk laporan TA.

Menghasilkan grafik garis: BEBAN (jumlah lab) vs RESPONS (jumlah node) dan
PRE-WARM prediktif (placeholder) sepanjang waktu, pada sumbu-y ganda.

PEMAKAIAN:
  python plot_autoscale.py autoscale_log.csv
  python plot_autoscale.py autoscale_log.csv --out grafik_autoscaling.png --title "Uji Beban 30 Lab"

Kebutuhan: pandas, matplotlib  (pip install pandas matplotlib)
CSV harus punya kolom: elapsed_s, lab_running, lab_pending, node_ready, placeholder
"""
import argparse
import sys

try:
    import pandas as pd
    import matplotlib
    matplotlib.use("Agg")  # tak butuh display (aman di server/Cloud Shell)
    import matplotlib.pyplot as plt
except ImportError as e:
    sys.exit(f"Pustaka belum terpasang: {e}. Jalankan: pip install pandas matplotlib")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv", help="File CSV dari collect_autoscale_metrics.sh")
    ap.add_argument("--out", default="grafik_autoscaling.png", help="Nama file PNG keluaran")
    ap.add_argument("--title", default="Perilaku Autoscaling terhadap Beban Lab", help="Judul grafik")
    ap.add_argument("--minutes", action="store_true", help="Sumbu-x dalam menit (default: detik)")
    args = ap.parse_args()

    df = pd.read_csv(args.csv)
    required = {"elapsed_s", "lab_running", "node_ready"}
    missing = required - set(df.columns)
    if missing:
        sys.exit(f"Kolom hilang di CSV: {missing}. Pastikan CSV dari collect_autoscale_metrics.sh.")

    # Sumbu waktu relatif (mulai dari 0)
    df["elapsed_s"] = df["elapsed_s"] - df["elapsed_s"].min()
    x = df["elapsed_s"] / 60.0 if args.minutes else df["elapsed_s"]
    xlabel = "Waktu (menit)" if args.minutes else "Waktu (detik)"

    fig, ax1 = plt.subplots(figsize=(11, 5.5))

    # --- Sumbu kiri: jumlah lab (beban) ---
    color_lab = "#2E75B6"
    ax1.set_xlabel(xlabel)
    ax1.set_ylabel("Jumlah pod lab", color=color_lab)
    ax1.plot(x, df["lab_running"], color=color_lab, lw=2.2, marker="o", ms=3,
             label="Lab Running (beban)")
    if "lab_pending" in df.columns and df["lab_pending"].max() > 0:
        ax1.plot(x, df["lab_pending"], color="#9DC3E6", lw=1.5, ls="--",
                 label="Lab Pending (antre)")
    ax1.tick_params(axis="y", labelcolor=color_lab)
    ax1.set_ylim(bottom=0)
    ax1.grid(True, alpha=0.3)

    # --- Sumbu kanan: jumlah node + placeholder (respons/pre-warm) ---
    ax2 = ax1.twinx()
    color_node = "#C00000"
    ax2.set_ylabel("Jumlah node / placeholder", color=color_node)
    ax2.step(x, df["node_ready"], color=color_node, lw=2.2, where="post",
             label="Node Ready (respons scaling)")
    if "placeholder" in df.columns and df["placeholder"].max() > 0:
        ax2.step(x, df["placeholder"], color="#548235", lw=1.8, ls=":", where="post",
                 label="Placeholder (pre-warm prediktif)")
    ax2.tick_params(axis="y", labelcolor=color_node)
    ax2.set_ylim(bottom=0)

    # Legenda gabungan dua sumbu
    h1, l1 = ax1.get_legend_handles_labels()
    h2, l2 = ax2.get_legend_handles_labels()
    ax1.legend(h1 + h2, l1 + l2, loc="upper left", fontsize=9, framealpha=0.9)

    plt.title(args.title, fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(args.out, dpi=150)
    print(f"Grafik disimpan: {args.out}")

    # Ringkasan angka untuk narasi laporan
    print("--- Ringkasan ---")
    print(f"Puncak lab Running   : {int(df['lab_running'].max())}")
    print(f"Node minimum/maksimum: {int(df['node_ready'].min())} / {int(df['node_ready'].max())}")
    if "placeholder" in df.columns:
        print(f"Placeholder maksimum : {int(df['placeholder'].max())}")
    dur = int(df['elapsed_s'].max())
    print(f"Durasi rekaman       : {dur} detik (~{dur // 60} menit)")


if __name__ == "__main__":
    main()
