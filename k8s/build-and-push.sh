#!/usr/bin/env bash
# Build & push image LMS ke registry, agar bisa dipakai Kubernetes.
# K8s tidak bisa build dari source seperti docker-compose; image HARUS ada di registry.
#
# PENGGUNAAN:
#   export REGISTRY=docker.io/USERNAME_ANDA      # atur registry Anda
#   ./build-and-push.sh
#
# Prasyarat: sudah `docker login` ke registry tsb.
# Jalankan dari root proyek (folder yang berisi backend/, frontend/, orchestrator/).
set -e

REGISTRY="${REGISTRY:?Set dulu: export REGISTRY=docker.io/USERNAME_ANDA}"
TAG="${TAG:-latest}"

echo "Registry : $REGISTRY"
echo "Tag      : $TAG"
echo ""

build_push() {
  local name="$1" ctx="$2"
  echo "=== Build $name dari $ctx ==="
  docker build -t "$REGISTRY/praktikum-$name:$TAG" "$ctx"
  docker push "$REGISTRY/praktikum-$name:$TAG"
  echo ""
}

build_push backend      ./backend
build_push frontend     ./frontend

# Orchestrator versi Docker (untuk deployment single-host / VM).
build_push orchestrator ./orchestrator

# Orchestrator versi KUBERNETES (app_k8s.py) — dipakai di cluster OKE.
echo "=== Build orchestrator-k8s (Dockerfile.k8s) ==="
docker build -f ./orchestrator/Dockerfile.k8s -t "$REGISTRY/praktikum-orchestrator-k8s:$TAG" ./orchestrator
docker push "$REGISTRY/praktikum-orchestrator-k8s:$TAG"
echo ""

# Estimator (FB Prophet) — Fase 5 predictive. Build bisa lama di ARM (compile stan).
echo "=== Build estimator (FB Prophet) ==="
docker build -t "$REGISTRY/praktikum-estimator:$TAG" ./estimator
docker push "$REGISTRY/praktikum-estimator:$TAG"
echo ""

# Image lab Jupyter (dipakai orchestrator saat spawn Pod lab).
echo "=== Build jupyter lab image ==="
docker build -t "$REGISTRY/ml-lab-single-user:$TAG" ./jupyter_image
docker push "$REGISTRY/ml-lab-single-user:$TAG"

echo ""
echo "SELESAI. Update image di k8s/*.yaml:"
echo "  ganti 'docker.io/CHANGEME' -> '$REGISTRY'"
