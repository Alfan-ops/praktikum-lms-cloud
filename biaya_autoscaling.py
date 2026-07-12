#!/usr/bin/env python3
"""
biaya_autoscaling.py — Model & grafik perbandingan biaya:
  Autoscaling REAKTIF (berbasis beban)  vs  SMART (sadar-biaya).

Ide: biaya total = biaya cloud (node) + biaya asisten (sesi).
  - Reaktif : layani semua N serentak → tambah NODE   (1 sesi, 1 asisten).
  - Smart   : batasi node → tambah SESI (asisten) bila lebih murah.

Model kapasitas (dari uji Anda): Cap(k) = 15k − 8   (node-1=7, tiap node +15).

ANGKA DI BAWAH = ASUMSI. Ganti dengan angka nyata (tarif GCP & honor asisten).
"""
import math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ================= ASUMSI (UBAH DI SINI) =================
T   = 3         # durasi 1 sesi praktikum (jam)
c_n = 1500      # tarif sewa 1 node e2-standard-2 per jam (Rp)  ~ $0.09
c_a = 15000     # honor 1 asisten pengawas per jam (Rp)
C_sup = c_a * T                 # biaya 1 asisten per sesi = 45.000

# Dua skenario harga node per sesi:
C_node_murah = c_n * T          # on-demand (autoscale-down) = 4.500
C_node_mahal = 200000           # node always-on/reserved (amortisasi idle) = 200.000

TEAL, RED, NAVY, PURPLE, MUTED = "#1BAF7A", "#E24B4A", "#0B3A53", "#5B4FC4", "#888780"

# ================= MODEL =================
def cap(k):            return 15 * k - 8            # kapasitas k node
def nodes_for(N):      return max(1, math.ceil((N + 8) / 15))   # reaktif
def sessions(N, k):    return max(1, math.ceil(N / cap(k)))

def cost_reactive(N, Cn):
    return nodes_for(N) * Cn + 1 * C_sup

def cost_smart(N, Cn):
    best = None
    for k in range(1, nodes_for(N) + 1):
        c = k * Cn + sessions(N, k) * C_sup
        if best is None or c < best[0]:
            best = (c, k, sessions(N, k))
    return best        # (biaya, k*, sesi*)

def rb(x):             # format ribuan Rupiah untuk sumbu
    return x / 1000.0

# ================= GRAFIK 1: biaya vs jumlah node (N tetap) =================
def g1(N=45):
    ks = list(range(1, nodes_for(N) + 1))
    fig, ax = plt.subplots(figsize=(9, 5))
    for Cn, warna, label in [(C_node_murah, TEAL, "Cloud murah (on-demand)"),
                             (C_node_mahal, PURPLE, "Cloud mahal (always-on)")]:
        y = [rb(k * Cn + sessions(N, k) * C_sup) for k in ks]
        ax.plot(ks, y, "-o", color=warna, lw=2.4, label=label)
        kstar = min(ks, key=lambda k: k * Cn + sessions(N, k) * C_sup)
        ax.plot(kstar, rb(kstar * Cn + sessions(N, kstar) * C_sup), "*",
                color=warna, ms=18, markeredgecolor="white")
    kR = nodes_for(N)
    ax.axvline(kR, ls=":", color=RED, lw=1.5)
    ax.annotate("Reaktif (semua 1 sesi)", (kR, ax.get_ylim()[1]*0.9), color=RED,
                ha="right", fontsize=10, rotation=90, va="top")
    ax.set_xlabel("Jumlah node (k)"); ax.set_ylabel("Biaya total (ribu Rp)")
    ax.set_title(f"Biaya total vs jumlah node  (N = {N} praktikan)\n★ = titik termurah (optimal smart)",
                 fontsize=12, fontweight="bold")
    ax.set_xticks(ks); ax.grid(alpha=0.3); ax.legend()
    fig.tight_layout(); fig.savefig("biaya_1_vs_node.png", dpi=130); plt.close(fig)

# ================= GRAFIK 2: biaya vs N (reaktif vs smart), 2 skenario =================
def g2():
    Ns = list(range(5, 121, 5))
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    for ax, Cn, judul in [(axes[0], C_node_murah, "Cloud MURAH (on-demand)"),
                          (axes[1], C_node_mahal, "Cloud MAHAL (always-on)")]:
        yR = [rb(cost_reactive(N, Cn)) for N in Ns]
        yS = [rb(cost_smart(N, Cn)[0]) for N in Ns]
        ax.plot(Ns, yR, color=RED, lw=2.4, ls="--", label="Reaktif")
        ax.plot(Ns, yS, color=TEAL, lw=2.4, label="Smart (optimal)")
        ax.set_xlabel("Jumlah praktikan (N)"); ax.set_ylabel("Biaya total (ribu Rp)")
        ax.set_title(judul, fontsize=12, fontweight="bold")
        ax.grid(alpha=0.3); ax.legend()
    fig.suptitle("Biaya total: Reaktif vs Smart — bergantung harga cloud",
                 fontsize=13, fontweight="bold")
    fig.tight_layout(rect=(0, 0, 1, 0.95))
    fig.savefig("biaya_2_vs_N.png", dpi=130); plt.close(fig)

# ================= GRAFIK 3: rincian biaya (cloud vs asisten) vs k =================
def g3(N=45, Cn=None):
    Cn = Cn if Cn is not None else C_node_mahal
    ks = list(range(1, nodes_for(N) + 1))
    cloud = [rb(k * Cn) for k in ks]
    asis = [rb(sessions(N, k) * C_sup) for k in ks]
    total = [c + a for c, a in zip(cloud, asis)]
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.plot(ks, cloud, "-o", color=PURPLE, lw=2, label="Biaya cloud (naik dgn node)")
    ax.plot(ks, asis, "-s", color=TEAL, lw=2, label="Biaya asisten (turun, sesi berkurang)")
    ax.plot(ks, total, "-^", color=NAVY, lw=2.6, label="Biaya TOTAL")
    kstar = ks[total.index(min(total))]
    ax.axvline(kstar, ls=":", color=MUTED); ax.annotate(f"optimal k={kstar}", (kstar, min(total)),
               color=NAVY, fontweight="bold", ha="left", va="bottom")
    ax.set_xlabel("Jumlah node (k)"); ax.set_ylabel("Biaya (ribu Rp)")
    ax.set_title(f"Rincian biaya vs jumlah node  (N={N}, skenario cloud mahal)\n"
                 "trade-off: cloud ↑ vs asisten ↓", fontsize=12, fontweight="bold")
    ax.set_xticks(ks); ax.grid(alpha=0.3); ax.legend()
    fig.tight_layout(); fig.savefig("biaya_3_rincian.png", dpi=130); plt.close(fig)

# ================= GRAFIK 4: sensitivitas harga node (break-even) =================
def g4(N=45):
    Cns = list(range(2000, 260001, 2000))
    yR = [rb(cost_reactive(N, Cn)) for Cn in Cns]
    yS = [rb(cost_smart(N, Cn)[0]) for Cn in Cns]
    fig, ax = plt.subplots(figsize=(9, 5))
    ax.plot([rb(c) for c in Cns], yR, color=RED, lw=2.4, ls="--", label="Reaktif")
    ax.plot([rb(c) for c in Cns], yS, color=TEAL, lw=2.4, label="Smart (optimal)")
    # titik break-even (reaktif mulai lebih mahal dari smart)
    be = next((Cns[i] for i in range(len(Cns)) if yR[i] > yS[i] + 1e-6), None)
    if be:
        ax.axvline(rb(be), ls=":", color=NAVY)
        ax.annotate(f"break-even\n≈ Rp {be:,.0f}/node/sesi".replace(",", "."),
                    (rb(be), ax.get_ylim()[1]*0.6), color=NAVY, fontweight="bold", ha="left")
    ax.set_xlabel("Harga sewa node per sesi (ribu Rp)")
    ax.set_ylabel("Biaya total (ribu Rp)")
    ax.set_title(f"Sensitivitas harga node  (N={N})\n"
                 "Kiri break-even: reaktif murah  ·  Kanan: smart menang",
                 fontsize=12, fontweight="bold")
    ax.grid(alpha=0.3); ax.legend()
    fig.tight_layout(); fig.savefig("biaya_4_sensitivitas.png", dpi=130); plt.close(fig)

# ================= GRAFIK 5: jumlah node vs waktu (perilaku) =================
def g5():
    # simulasi permintaan naik bertahap (mirip uji beban)
    t = list(range(0, 13))                       # menit
    demand = [0, 5, 10, 16, 22, 28, 34, 40, 46, 52, 52, 52, 52]  # praktikan aktif
    reaktif = [nodes_for(d) for d in demand]      # tambah node tiap kapasitas terlampaui
    k_budget = 2                                  # smart: plafon 2 node (kebijakan biaya)
    smart = [min(nodes_for(d), k_budget) for d in demand]
    fig, ax = plt.subplots(figsize=(10, 5))
    ax.plot(t, reaktif, drawstyle="steps-post", color=RED, lw=2.6, ls="--", label="Reaktif (node ikut beban)")
    ax.plot(t, smart, drawstyle="steps-post", color=TEAL, lw=2.6, label="Smart (plafon 2 node → sisanya via sesi)")
    ax.set_xlabel("Waktu (menit)"); ax.set_ylabel("Jumlah node disewa")
    ax.set_ylim(0, max(reaktif) + 1); ax.set_xlim(0, 12)
    ax.set_title("Perilaku scaling: Reaktif vs Smart\n"
                 "Reaktif menaikkan node tiap kapasitas terlampaui; Smart menahan di plafon biaya",
                 fontsize=12, fontweight="bold")
    ax.grid(alpha=0.3); ax.legend()
    fig.tight_layout(); fig.savefig("biaya_5_node_vs_waktu.png", dpi=130); plt.close(fig)

# ================= RINGKASAN ANGKA =================
def ringkasan():
    print("=" * 60)
    print(" PERBANDINGAN BIAYA: REAKTIF vs SMART  (angka ASUMSI)")
    print("=" * 60)
    print(f" C_sup (asisten/sesi) = Rp {C_sup:,.0f}".replace(",", "."))
    print(f" C_node murah/sesi    = Rp {C_node_murah:,.0f}".replace(",", "."))
    print(f" C_node mahal/sesi    = Rp {C_node_mahal:,.0f}".replace(",", "."))
    print("-" * 60)
    for N in (16, 30, 45, 60):
        for tag, Cn in (("murah", C_node_murah), ("mahal", C_node_mahal)):
            R = cost_reactive(N, Cn); S, k, s = cost_smart(N, Cn)
            menang = "SMART" if S < R else ("REAKTIF" if R < S else "SAMA")
            print(f" N={N:>3} [{tag}] : reaktif Rp {R:>10,.0f} | smart Rp {S:>10,.0f} ".replace(",", ".")
                  + f"(k={k} · {s} sesi) -> {menang}")
    print("=" * 60)

if __name__ == "__main__":
    g1(); g2(); g3(); g4(); g5(); ringkasan()
    print("Grafik: biaya_1_vs_node.png .. biaya_5_node_vs_waktu.png")
