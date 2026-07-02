#!/usr/bin/env bash
# =============================================================================
# collect_autoscale_metrics.sh
# Logger metrik autoscaling ke CSV untuk grafik TA (reaktif & prediktif).
#
# Merekam SERENTAK tiap beberapa detik:
#   - jumlah pod lab Running   (BEBAN / demand)         <- Cluster Autoscaler input
#   - jumlah pod lab Pending   (antrean belum terjadwal)
#   - jumlah node Ready        (RESPONS scaling / supply)
#   - replika placeholder      (PRE-WARM prediktif dari estimator Prophet)
#
# PEMAKAIAN (jalankan di Cloud Shell yang terhubung ke cluster):
#   bash k8s/collect_autoscale_metrics.sh [interval_detik] [file_output]
#   # default: interval 10 detik, file autoscale_log.csv
#
# ALUR UJI:
#   1) Jalankan skrip ini DULU (biarkan merekam baseline beberapa saat).
#   2) Mulai uji beban:  kubectl apply -f k8s/loadtest-labs.yaml
#   3) Amati scale-out; setelah selesai tekan Ctrl+C untuk berhenti.
#   4) Unduh CSV (Cloud Shell: menu ... -> Download) & buat grafik:
#        python plot_autoscale.py autoscale_log.csv
# =============================================================================
set -u

INTERVAL="${1:-10}"
OUTFILE="${2:-autoscale_log.csv}"
NS="lms-praktikum"
PLACEHOLDER_DEPLOY="capacity-placeholder"

# Header CSV (tulis hanya bila file baru/kosong)
if [[ ! -s "$OUTFILE" ]]; then
  echo "epoch,waktu,elapsed_s,lab_running,lab_pending,node_ready,placeholder" > "$OUTFILE"
fi

START_EPOCH=$(date +%s)
echo "Merekam ke $OUTFILE tiap ${INTERVAL}s. Tekan Ctrl+C untuk berhenti."
echo "epoch                waktu     elapsed  lab_run  lab_pend  node  placeholder"

trap 'echo; echo "Berhenti. Data tersimpan di '"$OUTFILE"'."; exit 0' INT TERM

while true; do
  now_epoch=$(date +%s)
  now_hms=$(date +%H:%M:%S)
  elapsed=$(( now_epoch - START_EPOCH ))

  # Pod lab (hitung berdasarkan STATUS di kolom ke-3 output get pods)
  pods=$(kubectl -n "$NS" get pods -l app=lab --no-headers 2>/dev/null)
  lab_running=$(echo "$pods" | grep -c 'Running' || true)
  lab_pending=$(echo "$pods" | grep -c 'Pending' || true)
  # Bila tak ada pod, grep -c mengembalikan 0 tapi echo "" tetap 1 baris; koreksi:
  [[ -z "$pods" ]] && lab_running=0 && lab_pending=0

  # Node Ready (hindari hitung "NotReady")
  node_ready=$(kubectl get nodes --no-headers 2>/dev/null | awk '$2=="Ready"{c++} END{print c+0}')

  # Placeholder (predictive pre-warm). 0 bila deployment belum ada.
  placeholder=$(kubectl -n "$NS" get deploy "$PLACEHOLDER_DEPLOY" \
    -o jsonpath='{.status.replicas}' 2>/dev/null)
  [[ -z "$placeholder" ]] && placeholder=0

  echo "$now_epoch,$now_hms,$elapsed,$lab_running,$lab_pending,$node_ready,$placeholder" >> "$OUTFILE"
  printf "%s  %s  %6ss  %6s  %7s  %5s  %10s\n" \
    "$now_epoch" "$now_hms" "$elapsed" "$lab_running" "$lab_pending" "$node_ready" "$placeholder"

  sleep "$INTERVAL"
done
