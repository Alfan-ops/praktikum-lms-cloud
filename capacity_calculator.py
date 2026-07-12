#!/usr/bin/env python3
"""
Kalkulator Kapasitas Autoscaling LMS Praktikum  ("software pintar" TA)
======================================================================

Mewujudkan rumus di MODEL_MATEMATIKA_AUTOSCALING.md. Tiga fungsi:

  1. berapa NODE untuk N praktikan  (anti over-provisioning)     -> --nodes
  2. berapa PRAKTIKAN maksimum untuk anggaran M node             -> --students
  3. karakterisasi TRAFIK dari hasil uji Locust                  -> --traffic

Pemakaian cepat:
  python capacity_calculator.py --nodes 30
  python capacity_calculator.py --nodes 30 --acpu 1900 --amem 4900 --scpu 700 --smem 1500
  python capacity_calculator.py --students --budget 4
  python capacity_calculator.py --traffic --nreq 4200 --dur 360 --sreq 120 --sres 260

Semua parameter punya nilai default yang mencerminkan konfigurasi repo ini
(request lab 100m/256Mi, node ~Standard_DS2_v2). Ganti lewat argumen bila
Anda sudah mengukur angka nyata dari `kubectl describe node` (lihat §7 dokumen).
"""
import argparse
import math

# ---------------------------------------------------------------------------
# Nilai default (dari konfigurasi repo — ganti dengan hasil ukur cluster nyata)
# ---------------------------------------------------------------------------
DEF_RCPU = 100     # request CPU per pod lab (milicore)  -> app_k8s.py
DEF_RMEM = 256     # request memori per pod lab (MiB)     -> app_k8s.py
DEF_ACPU = 1900    # CPU allocatable per node (m)  ~Standard_DS2_v2 (2 vCPU)
DEF_AMEM = 4900    # memori allocatable per node (MiB) ~DS2_v2 (7 GiB)
DEF_SCPU = 700     # CPU dipakai pod sistem menetap (m)
DEF_SMEM = 1500    # memori dipakai pod sistem menetap (MiB)
DEF_ALPHA = 0.8    # faktor margin keamanan (headroom 20%)
DEF_MAXNODE = 4    # plafon nodepool AKS (--max-count)


def pods_per_node(acpu, amem, scpu, smem, rcpu, rmem):
    """P = min( batas CPU, batas MEM ).  Kembalikan (P, resource pengikat)."""
    by_cpu = (acpu - scpu) // rcpu
    by_mem = (amem - smem) // rmem
    if by_cpu <= by_mem:
        return int(by_cpu), "CPU"
    return int(by_mem), "MEMORI"


def nodes_needed(n, p, alpha):
    """M(N) = ceil( N / (alpha * P) )."""
    eff = alpha * p
    return math.ceil(n / eff) if eff > 0 else float("inf")


def report_nodes(a):
    p, binding = pods_per_node(a.acpu, a.amem, a.scpu, a.smem, a.rcpu, a.rmem)
    p_raw = min((a.acpu - a.scpu) // a.rcpu, (a.amem - a.smem) // a.rmem)
    m_raw = math.ceil(a.n / p) if p else float("inf")
    m = nodes_needed(a.n, p, a.alpha)

    print("=" * 64)
    print(" KALKULATOR NODE  -  berapa node untuk N praktikan")
    print("=" * 64)
    print(f" Input praktikan serentak (N)       : {a.n}")
    print(f" Request per lab                    : cpu={a.rcpu}m  mem={a.rmem}Mi")
    print(f" Allocatable per node               : cpu={a.acpu}m  mem={a.amem}Mi")
    print(f" Dipakai pod sistem (menetap)       : cpu={a.scpu}m  mem={a.smem}Mi")
    print("-" * 64)
    print(f" Batas dari CPU   : (acpu-scpu)/rcpu = {(a.acpu-a.scpu)//a.rcpu} pod")
    print(f" Batas dari MEMORI: (amem-smem)/rmem = {(a.amem-a.smem)//a.rmem} pod")
    print(f" Kapasitas per node P (min)         : {p} lab-slot  (pengikat: {binding})")
    print(f" Margin keamanan alpha              : {a.alpha}  -> P efektif = {a.alpha*p:.1f}")
    print("-" * 64)
    print(f" >> NODE dibutuhkan  M = ceil(N/(alpha*P)) = {m} node")
    print(f"    (tanpa margin: ceil(N/P) = {m_raw} node)")
    # bukti tidak over-provisioning terhadap plafon max node
    m_clip = min(m, a.maxnode)
    print("-" * 64)
    print(" Bukti optimalitas (pakai P tanpa margin):")
    ok_cukup = m_clip * p_raw >= a.n
    ok_hemat = (m_clip - 1) * p_raw < a.n
    print(f"   cukup     : M*P     = {m_clip*p_raw:>4} >= N={a.n}  -> {'YA' if ok_cukup else 'TIDAK'}")
    print(f"   tak boros : (M-1)*P = {(m_clip-1)*p_raw:>4} <  N={a.n}  -> {'YA' if ok_hemat else 'TIDAK'}")
    if m > a.maxnode:
        print(f"   !! Butuh {m} node > plafon {a.maxnode}. Naikkan --max-count nodepool.")
    print("=" * 64)


def report_students(a):
    p, binding = pods_per_node(a.acpu, a.amem, a.scpu, a.smem, a.rcpu, a.rmem)
    n_max = int(math.floor(a.budget * a.alpha * p))
    n_max_raw = a.budget * p
    print("=" * 64)
    print(" KALKULATOR PRAKTIKAN  -  berapa maksimum untuk M node")
    print("=" * 64)
    print(f" Anggaran node (M)                  : {a.budget}")
    print(f" Kapasitas per node P               : {p} lab-slot  (pengikat: {binding})")
    print(f" Margin keamanan alpha              : {a.alpha}")
    print("-" * 64)
    print(f" >> Praktikan MAKS (aman) = floor(M*alpha*P) = {n_max} orang")
    print(f"    (kapasitas teoretis maks: M*P = {n_max_raw} orang)")
    print("=" * 64)


def report_traffic(a):
    lam = a.nreq / a.dur if a.dur else 0
    b_up = lam * a.sreq
    b_down = lam * a.sres
    total = a.nreq * (a.sreq + a.sres)
    print("=" * 64)
    print(" KARAKTERISASI TRAFIK  (dari hasil uji Locust)")
    print("=" * 64)
    print(f" Total request (n_req)              : {a.nreq}")
    print(f" Durasi uji (T)                     : {a.dur} s")
    print(f" Payload request rata2 (s_req)      : {a.sreq} byte")
    print(f" Payload response rata2 (s_res)     : {a.sres} byte")
    print("-" * 64)
    print(f" Laju request      lambda = n_req/T : {lam:.2f} req/s")
    print(f" Uplink   B_up   = lambda*s_req     : {b_up:.1f} byte/s = {b_up/1024:.2f} KB/s")
    print(f" Downlink B_down = lambda*s_res     : {b_down:.1f} byte/s = {b_down/1024:.2f} KB/s")
    print(f" Total data      D = n_req*(sreq+sres): {total} byte = {total/1024/1024:.2f} MB")
    print("=" * 64)


def build_parser():
    p = argparse.ArgumentParser(
        description="Kalkulator kapasitas autoscaling LMS (TA).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--nodes", type=int, metavar="N",
                      help="hitung node untuk N praktikan")
    mode.add_argument("--students", action="store_true",
                      help="hitung praktikan maksimum untuk --budget node")
    mode.add_argument("--traffic", action="store_true",
                      help="karakterisasi trafik dari hasil Locust")
    # parameter kapasitas
    p.add_argument("--rcpu", type=int, default=DEF_RCPU)
    p.add_argument("--rmem", type=int, default=DEF_RMEM)
    p.add_argument("--acpu", type=int, default=DEF_ACPU)
    p.add_argument("--amem", type=int, default=DEF_AMEM)
    p.add_argument("--scpu", type=int, default=DEF_SCPU)
    p.add_argument("--smem", type=int, default=DEF_SMEM)
    p.add_argument("--alpha", type=float, default=DEF_ALPHA)
    p.add_argument("--maxnode", type=int, default=DEF_MAXNODE)
    p.add_argument("--budget", type=int, default=DEF_MAXNODE,
                   help="jumlah node yang dilangganan (mode --students)")
    # parameter trafik
    p.add_argument("--nreq", type=int, default=0)
    p.add_argument("--dur", type=float, default=360)
    p.add_argument("--sreq", type=int, default=120)
    p.add_argument("--sres", type=int, default=260)
    return p


def main():
    a = build_parser().parse_args()
    if a.nodes is not None:
        a.n = a.nodes
        report_nodes(a)
    elif a.students:
        report_students(a)
    elif a.traffic:
        report_traffic(a)


if __name__ == "__main__":
    main()
