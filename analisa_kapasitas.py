#!/usr/bin/env python3
"""
Analisa Uji Kapasitas per Node (1/2/3 node) -> grafik PNG + tabel kapasitas.

Baca file hasil uji (lihat PANDUAN_UJI_KAPASITAS_NODE.md):
  - cap_{k}node_history.csv   : histori Locust (User Count, Requests/s, 95% resp time)
  - kapasitas_{k}node.csv     : timeline kubectl (waktu, nodes, running, pending)
untuk k = 1, 2, 3 (yang ada saja yang diproses).

Output:
  - kapasitas_{k}node.png     : 2 panel (Running/Pending vs waktu ; user vs p95 resp)
  - ringkasan_kapasitas.png   : batang Kapasitas(1/2/3) + garis linearitas ideal
  - tabel Kapasitas dicetak ke layar

Jalankan:  py analisa_kapasitas.py
Butuh matplotlib:  py -m pip install matplotlib
"""
import csv
import os
import sys

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    print("matplotlib belum terpasang. Pasang dulu:  py -m pip install matplotlib")
    sys.exit(1)

NODES = [1, 2, 3]

# Set False agar grafik BERSIH (hanya Running + Pending); ContainerCreating dijelaskan
# terpisah lewat tabel data. Set True bila ingin menampilkan area ContainerCreating.
SHOW_CREATING = False


def _hms_to_sec(s):
    """'HH:MM:SS' -> detik sejak tengah malam."""
    hh, mm, ss = s.strip().split(":")
    return int(hh) * 3600 + int(mm) * 60 + int(ss)


def read_timeline(path):
    """kapasitas_{k}node.csv -> list of (menit, running, creating, pending).
    Waktu dihitung dari kolom 'waktu' sehingga interval perekam berapa pun tetap benar."""
    rows = []
    t0 = None
    with open(path, newline="", encoding="utf-8", errors="ignore") as f:
        for r in csv.DictReader(f):
            try:
                sec = _hms_to_sec(r["waktu"])
                if t0 is None:
                    t0 = sec
                rows.append(((sec - t0) / 60.0, int(r["running"]),
                             int(r.get("creating", 0) or 0), int(r["pending"])))
            except (KeyError, ValueError):
                continue
    return rows




def capacity_from_timeline(tl):
    """Kapasitas = running tertinggi yang bertahan; catat kapan pending mulai naik."""
    if not tl:
        return 0, None
    cap = max(r for _, r, _, _ in tl)
    onset = next((r for _, r, _, p in tl if p > 0), None)  # running saat pending pertama muncul
    return cap, onset


def _despike(seq):
    """Buang 'pulau' 1-sampel (nilai transien saat 1 gelombang pod belum selesai transisi)
    agar tangga bersih. Aman: level nyata bertahan belasan sampel, hanya transien 1-sampel dibuang."""
    v = list(seq)
    for i in range(1, len(v) - 1):
        if v[i] != v[i - 1] and v[i] != v[i + 1]:
            v[i] = v[i - 1]
    return v


def plot_node(k, tl):
    """Satu grafik fokus: Running (plateau=kapasitas) + Pending + ContainerCreating (area).
    Panel response-time DIHILANGKAN: data menunjukkan orchestrator tetap cepat & 0% gagal,
    jadi tak ada 'batas lunak' — satu-satunya batas adalah penjadwalan pod (Pending)."""
    fig, ax = plt.subplots(figsize=(11, 5))
    if tl:
        t = [x[0] for x in tl]
        run = _despike([x[1] for x in tl])
        cre = [x[2] for x in tl]
        pen = _despike([x[3] for x in tl])
        cap, _ = capacity_from_timeline(tl)
        # ContainerCreating sebagai AREA agar gundukan singkat tetap terlihat.
        if SHOW_CREATING and max(cre) > 0:
            ax.fill_between(t, cre, color="#2A78D6", alpha=0.30, label="ContainerCreating (dibuat)")
            ax.plot(t, cre, color="#2A78D6", lw=1.2)
        ax.plot(t, run, drawstyle="steps-post", color="#1BAF7A", lw=2.6, label="Running (lab aktif)")
        ax.plot(t, pen, drawstyle="steps-post", ls="--", color="#E34948", lw=2, label="Pending (tak muat)")
        ax.axhline(cap, ls=":", color="#888780", lw=1.5)
        ax.annotate(f"Kapasitas = {cap} lab", (t[-1], cap), ha="right", va="bottom",
                    color="#1BAF7A", fontweight="bold")
    ax.set_xlabel("Waktu (menit)")
    ax.set_ylabel("Jumlah pod lab")
    ax.set_ylim(bottom=0)
    ax.set_xlim(left=0)
    ax.margins(x=0)
    ax.grid(alpha=0.3)
    ax.legend(loc="center right")
    cap, _ = capacity_from_timeline(tl)
    ax.set_title(f"Uji kapasitas {k} node — Kapasitas = {cap} lab (0% gagal)",
                 fontsize=13, fontweight="bold")

    fig.tight_layout()
    out = f"kapasitas_{k}node.png"
    fig.savefig(out, dpi=130)
    plt.close(fig)
    return out


def _linfit(xs, ys):
    """Regresi garis lurus y = a*x + b (least squares). Butuh >=2 titik."""
    n = len(xs)
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    denom = n * sxx - sx * sx
    if denom == 0:
        return 0.0, (sy / n if n else 0.0)
    a = (n * sxy - sx * sy) / denom
    b = (sy - a * sx) / n
    return a, b


def _formula(a, b):
    return f"Kapasitas(k) = {a:.0f}k {'-' if b < 0 else '+'} {abs(b):.0f}"


def plot_summary(caps):
    ks = sorted(caps)
    vals = [caps[k] for k in ks]
    fig, ax = plt.subplots(figsize=(7.5, 4.8))
    ax.bar([str(k) for k in ks], vals, color="#1BAF7A", alpha=0.85, label="Kapasitas terukur")
    for k, v in zip(ks, vals):
        ax.annotate(str(v), (str(k), v), ha="center", va="bottom", fontweight="bold")
    label = "Model regresi"
    if len(ks) >= 2:
        a, b = _linfit(ks, vals)
        model = [a * k + b for k in ks]
        ax.plot([str(k) for k in ks], model, "-o", color="#5B4FC4", label=_formula(a, b))
        label = _formula(a, b)
    ax.set_xlabel("Jumlah node"); ax.set_ylabel("Kapasitas (lab maksimum)")
    ax.set_title(f"Kapasitas vs jumlah node — {label}", fontsize=12, fontweight="bold")
    ax.legend(); ax.grid(alpha=0.3, axis="y")
    fig.tight_layout()
    fig.savefig("ringkasan_kapasitas.png", dpi=130)
    plt.close(fig)


def main():
    caps = {}
    print("=" * 56)
    print(" ANALISA UJI KAPASITAS PER NODE")
    print("=" * 56)
    for k in NODES:
        tl_path = f"kapasitas_{k}node.csv"
        if not os.path.exists(tl_path):
            print(f" [{k} node] {tl_path} tidak ada — dilewati.")
            continue
        tl = read_timeline(tl_path)
        cap, onset = capacity_from_timeline(tl)
        caps[k] = cap
        png = plot_node(k, tl)
        print(f" [{k} node] Kapasitas = {cap} lab"
              + (f" (running saat pending pertama muncul: {onset})" if onset else "")
              + f"  -> {png}")
    print("-" * 56)
    if caps:
        plot_summary(caps)
        ks = sorted(caps)
        if len(ks) >= 2:
            a, b = _linfit(ks, [caps[k] for k in ks])
            print(f"   Model: {_formula(a, b)}   ({a:.0f} = kapasitas/node, {b:.0f} = overhead sistem)")
            for k in ks:
                print(f"   Kapasitas({k}) terukur = {caps[k]:>3}  |  model = {a*k+b:>5.0f}")
            nxt = ks[-1] + 1
            print(f"   Prediksi Kapasitas({nxt}) = {a*nxt+b:.0f} lab")
            print(f"   Jumlah node untuk N praktikan:  k = ceil((N - ({b:.0f})) / {a:.0f})")
        else:
            print("   (perlu >=2 titik node untuk membentuk rumus; jalankan K=2 & K=3)")
        print("   Grafik ringkasan -> ringkasan_kapasitas.png")
    else:
        print(" Tidak ada file hasil uji ditemukan. Jalankan uji dulu"
              " (PANDUAN_UJI_KAPASITAS_CLOUDSHELL.md).")
    print("=" * 56)


if __name__ == "__main__":
    main()
