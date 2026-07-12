#!/usr/bin/env python3
"""
plot_autoscale.py — Grafik autoscaling dari CSV collect_autoscale_metrics.sh, untuk laporan TA.

SATU sumbu-Y (kiri) + SATU sumbu-X (bawah) + SATU origin 0.
(Versi lama memakai sumbu-Y ganda/twinx sehingga muncul dua label "0" dan sumbu kanan
 — dihilangkan sesuai masukan pembimbing.)

Semua deret (lab running, lab pending, node, placeholder) berbagi satu sumbu "Jumlah".
Karena node bernilai kecil (1-3) dibanding lab (0-30), perubahan node ditandai dengan
garis vertikal + anotasi angka agar tetap terbaca tanpa sumbu kedua.

PEMAKAIAN:
  python plot_autoscale.py autoscale_log.csv --minutes
  python plot_autoscale.py autoscale_log.csv --out grafik_autoscaling.png --title "Uji Beban 30 Lab" --minutes

Kebutuhan: pandas, matplotlib  (pip install pandas matplotlib)
CSV harus punya kolom: elapsed_s, lab_running, lab_pending, node_ready, placeholder
"""
import argparse
import sys

try:
    import pandas as pd
    import matplotlib
    matplotlib.use("Agg")
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

    df["elapsed_s"] = df["elapsed_s"] - df["elapsed_s"].min()
    x = df["elapsed_s"] / 60.0 if args.minutes else df["elapsed_s"]
    xlabel = "Waktu (menit)" if args.minutes else "Waktu (detik)"

    fig, ax = plt.subplots(figsize=(11, 5.5))

    # --- SATU sumbu-Y: semua deret berbagi skala "Jumlah" ---
    ax.plot(x, df["lab_running"], color="#2E9E6B", lw=2.2, marker="o", ms=3,
            label="Lab Running (beban)")
    if "lab_creating" in df.columns and df["lab_creating"].max() > 0:
        ax.plot(x, df["lab_creating"], color="#2A78D6", lw=1.8, ls="-.",
                label="Lab ContainerCreating (dibuat)")
    if "lab_pending" in df.columns and df["lab_pending"].max() > 0:
        ax.plot(x, df["lab_pending"], color="#E8A020", lw=1.8, ls="--",
                label="Lab Pending (antre)")
    ax.step(x, df["node_ready"], color="#5B4FC4", lw=2.2, where="post",
            label="Node Ready (respons scaling)")
    if "placeholder" in df.columns and df["placeholder"].max() > 0:
        ax.step(x, df["placeholder"], color="#548235", lw=1.8, ls=":", where="post",
                label="Placeholder (pre-warm)")

    # Tandai tiap perubahan jumlah node dengan garis vertikal + anotasi angka,
    # agar node (nilai kecil) tetap terbaca tanpa sumbu kedua.
    node = df["node_ready"].values
    ymax = float(df["lab_running"].max())
    for i in range(1, len(node)):
        if node[i] != node[i - 1]:
            xi = x.iloc[i]
            ax.axvline(xi, color="#5B4FC4", ls=":", lw=1, alpha=0.5)
            ax.annotate(f"{int(node[i-1])}→{int(node[i])} node",
                        xy=(xi, ymax * 0.92), ha="left", va="top",
                        color="#5B4FC4", fontsize=9, fontweight="bold",
                        xytext=(3, 0), textcoords="offset points")

    ax.set_xlabel(xlabel)
    ax.set_ylabel("Jumlah (pod lab / node)")
    ax.set_ylim(bottom=0)
    ax.margins(x=0.01)
    ax.grid(True, alpha=0.3)
    ax.legend(loc="center right", fontsize=9, framealpha=0.9)

    plt.title(args.title, fontsize=13, fontweight="bold")
    fig.tight_layout()
    fig.savefig(args.out, dpi=150)
    print(f"Grafik disimpan: {args.out}")

    print("--- Ringkasan ---")
    print(f"Puncak lab Running   : {int(df['lab_running'].max())}")
    print(f"Node minimum/maksimum: {int(df['node_ready'].min())} / {int(df['node_ready'].max())}")
    if "placeholder" in df.columns:
        print(f"Placeholder maksimum : {int(df['placeholder'].max())}")
    dur = int(df['elapsed_s'].max())
    print(f"Durasi rekaman       : {dur} detik (~{dur // 60} menit)")


if __name__ == "__main__":
    main()
