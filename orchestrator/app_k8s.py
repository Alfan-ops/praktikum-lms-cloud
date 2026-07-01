"""
Orchestrator versi KUBERNETES (Fase 3).

Versi ini menggantikan Docker SDK dengan Kubernetes API. Alih-alih `docker run`,
setiap permintaan lab membuat **Deployment + Service + Ingress** di dalam cluster,
sehingga pod lab bisa tersebar ke banyak node (horizontal scaling) dan diskalakan
oleh Cluster Autoscaler + KEDA.

Kontrak API dipertahankan sama dengan app.py (Docker) agar backend tidak perlu diubah:
  POST /deploy            {group, tool, module|notebook, cpu, ram}
  POST /stop             {group}
  GET  /job/<job_id>
  GET  /autoscaler/status
  GET  /containers/stats  (JSON)
  GET  /metrics/containers (Prometheus)
  GET  /modules
  GET  /health

CATATAN: app.py (Docker) TETAP dipertahankan untuk deployment single-host.
File ini dipakai HANYA di Kubernetes (lihat Dockerfile.k8s).
"""
from flask import Flask, request, jsonify, Response
import os, secrets, logging, threading, uuid, re

from kubernetes import client, config
from kubernetes.client.rest import ApiException

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)

# ================= KONFIGURASI KUBERNETES =================
try:
    # Saat berjalan di dalam pod (produksi)
    config.load_incluster_config()
    logging.info("Loaded in-cluster Kubernetes config.")
except Exception:
    try:
        # Saat dijalankan lokal untuk pengembangan
        config.load_kube_config()
        logging.info("Loaded local kubeconfig.")
    except Exception as e:
        logging.error(f"Tidak bisa memuat konfigurasi Kubernetes: {e}")

apps_v1 = client.AppsV1Api()
core_v1 = client.CoreV1Api()
net_v1 = client.NetworkingV1Api()
custom = client.CustomObjectsApi()

NAMESPACE = os.environ.get("LAB_NAMESPACE", "lms-praktikum")
JUPYTER_IMAGE = os.environ.get("JUPYTER_IMAGE", "hsg.ocir.io/axyfpuh4ahcf/ml-lab-single-user:latest")
ACCESSIBLE_HOST = os.environ.get("ACCESSIBLE_HOST", "localhost")  # IP/host Ingress LB
INGRESS_CLASS = os.environ.get("INGRESS_CLASS", "nginx")
IMAGE_PULL_SECRET = os.environ.get("IMAGE_PULL_SECRET", "ocir-secret")
DEFAULT_MODULE = os.environ.get("DEFAULT_MODULE", "praktikum_ml_iris.ipynb")

# ================= AUTOSCALER (dipertahankan dari app.py) =================
MAX_CONCURRENT_DEPLOYS = int(os.environ.get("MAX_CONCURRENT_DEPLOYS", "5"))
DEPLOY_QUEUE_MAX = int(os.environ.get("DEPLOY_QUEUE_MAX", "50"))

_semaphore = threading.Semaphore(MAX_CONCURRENT_DEPLOYS)
_active_count = 0
_active_lock = threading.Lock()
_queue_count = 0
_queue_lock = threading.Lock()
_job_results = {}
_job_results_lock = threading.Lock()


def _inc_active():
    global _active_count
    with _active_lock:
        _active_count += 1


def _dec_active():
    global _active_count
    with _active_lock:
        _active_count -= 1


def _inc_queue():
    global _queue_count
    with _queue_lock:
        _queue_count += 1


def _dec_queue():
    global _queue_count
    with _queue_lock:
        _queue_count -= 1


def _set_job_result(job_id, result):
    with _job_results_lock:
        _job_results[job_id] = result
        if len(_job_results) > 200:
            del _job_results[list(_job_results.keys())[0]]


def _get_job_result(job_id):
    with _job_results_lock:
        return _job_results.get(job_id)


def autoscaler_status():
    return {
        "max_concurrent": MAX_CONCURRENT_DEPLOYS,
        "active_deploys": _active_count,
        "queued_deploys": _queue_count,
        "queue_capacity": DEPLOY_QUEUE_MAX,
        "slots_available": max(0, MAX_CONCURRENT_DEPLOYS - _active_count),
    }


def run_with_autoscaler(deploy_fn, job_id, *args, **kwargs):
    _dec_queue()
    _inc_active()
    try:
        result = deploy_fn(*args, **kwargs)
        if hasattr(result, "get_json"):
            _set_job_result(job_id, {"status": "done", "result": result.get_json()})
        else:
            _set_job_result(job_id, {"status": "done", "result": result})
    except Exception as e:
        logging.error(f"Autoscaler job {job_id} failed: {e}")
        _set_job_result(job_id, {"status": "error", "error": str(e)})
    finally:
        _dec_active()
        _semaphore.release()


@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.exception(e)
    return jsonify(success=False, error=str(e)), 500


# ================= HELPER =================
def k8s_name(group):
    """Ubah nama grup jadi nama resource K8s yang valid (RFC1123)."""
    name = "lab-" + re.sub(r"[^a-z0-9-]", "-", group.lower()).strip("-")
    return name[:60].rstrip("-")


def norm_mem(ram):
    """'1g'->'1Gi', '256m'->'256Mi'. Default 512Mi."""
    if not ram:
        return "512Mi"
    r = str(ram).strip().lower()
    if r.endswith("g"):
        return r[:-1] + "Gi"
    if r.endswith("m"):
        return r[:-1] + "Mi"
    return r


def norm_cpu(cpu):
    """'1'->'1', '500m'->'500m'. Default 500m."""
    if not cpu:
        return "500m"
    return str(cpu).strip()


def _lab_labels(name, safe):
    return {"app": "lab", "lms/group": safe, "lms/name": name}


# ================= DEPLOY JUPYTER (via Kubernetes) =================
def deploy_jupyter_internal(data, safe_group):
    module = data.get("module") or data.get("notebook") or DEFAULT_MODULE
    name = k8s_name(safe_group)
    base_url = f"/lab/{safe_group}"

    # Sudah ada? Kembalikan info existing (baca token dari annotation).
    try:
        existing = apps_v1.read_namespaced_deployment(name, NAMESPACE)
        token = (existing.metadata.annotations or {}).get("lms/token", "")
        return jsonify(
            success=True,
            message="Already running",
            tool="jupyter",
            url=f"http://{ACCESSIBLE_HOST}{base_url}/lab/tree/{module}?token={token}",
            group=safe_group,
        )
    except ApiException as e:
        if e.status != 404:
            raise

    token = secrets.token_hex(16)
    mem = norm_mem(data.get("ram"))
    cpu = norm_cpu(data.get("cpu"))

    # --- Deployment ---
    deployment = {
        "apiVersion": "apps/v1",
        "kind": "Deployment",
        "metadata": {
            "name": name,
            "namespace": NAMESPACE,
            "labels": _lab_labels(name, safe_group),
            "annotations": {"lms/token": token, "lms/module": module},
        },
        "spec": {
            "replicas": 1,
            "selector": {"matchLabels": {"app": "lab", "lms/name": name}},
            "template": {
                "metadata": {"labels": _lab_labels(name, safe_group)},
                "spec": {
                    "imagePullSecrets": [{"name": IMAGE_PULL_SECRET}],
                    "containers": [
                        {
                            "name": "lab",
                            "image": JUPYTER_IMAGE,
                            "command": [
                                "start-notebook.sh",
                                f"--ServerApp.base_url={base_url}",
                                f"--ServerApp.token={token}",
                                "--ServerApp.root_dir=/home/jovyan/work",
                            ],
                            "ports": [{"containerPort": 8888}],
                            "resources": {
                                "requests": {"cpu": "100m", "memory": "256Mi"},
                                "limits": {"cpu": cpu, "memory": mem},
                            },
                        }
                    ],
                },
            },
        },
    }
    apps_v1.create_namespaced_deployment(NAMESPACE, deployment)

    # --- Service ---
    service = {
        "apiVersion": "v1",
        "kind": "Service",
        "metadata": {"name": name, "namespace": NAMESPACE, "labels": _lab_labels(name, safe_group)},
        "spec": {
            "selector": {"app": "lab", "lms/name": name},
            "ports": [{"port": 8888, "targetPort": 8888}],
        },
    }
    core_v1.create_namespaced_service(NAMESPACE, service)

    # --- Ingress (path /lab/<group>) ---
    ingress = {
        "apiVersion": "networking.k8s.io/v1",
        "kind": "Ingress",
        "metadata": {
            "name": name,
            "namespace": NAMESPACE,
            "labels": _lab_labels(name, safe_group),
            "annotations": {"nginx.ingress.kubernetes.io/proxy-read-timeout": "3600"},
        },
        "spec": {
            "ingressClassName": INGRESS_CLASS,
            "rules": [
                {
                    "http": {
                        "paths": [
                            {
                                "path": base_url,
                                "pathType": "Prefix",
                                "backend": {"service": {"name": name, "port": {"number": 8888}}},
                            }
                        ]
                    }
                }
            ],
        },
    }
    net_v1.create_namespaced_ingress(NAMESPACE, ingress)

    return jsonify(
        success=True,
        tool="jupyter",
        url=f"http://{ACCESSIBLE_HOST}{base_url}/lab/tree/{module}?token={token}",
        group=safe_group,
    )


# ================= DEPLOY ROUTE =================
@app.route("/deploy", methods=["POST"])
def deploy():
    raw = request.json or {}

    # BACKWARD COMPAT (payload lama {module_id})
    if "module_id" in raw:
        raw = {
            "group": str((raw.get("student_ids") or ["default"])[0]),
            "tool": "jupyter",
            "module": DEFAULT_MODULE,
        }

    group = raw.get("group")
    tool = str(raw.get("tool", "jupyter")).lower()
    if not group:
        return jsonify(success=False, error="Group required"), 400

    safe_group = "".join(c for c in group if c.isalnum() or c in "-_")

    if tool != "jupyter":
        # Flask/Streamlit bisa ditambahkan mirip jupyter bila diperlukan.
        return jsonify(success=False, error=f"Tool '{tool}' belum didukung di versi K8s"), 501

    deploy_fn = deploy_jupyter_internal
    name = k8s_name(safe_group)

    # Sudah berjalan? Langsung kembalikan (tanpa antrian).
    try:
        apps_v1.read_namespaced_deployment(name, NAMESPACE)
        return deploy_fn(raw, safe_group)
    except ApiException as e:
        if e.status != 404:
            raise

    # Cek kapasitas antrian
    with _queue_lock:
        if _queue_count >= DEPLOY_QUEUE_MAX:
            return jsonify(
                success=False,
                error="Server sedang sangat sibuk. Antrian penuh, coba lagi nanti.",
                autoscaler=autoscaler_status(),
            ), 503

    # Ada slot? Jalankan langsung.
    if _semaphore.acquire(blocking=False):
        _inc_active()
        try:
            return deploy_fn(raw, safe_group)
        finally:
            _dec_active()
            _semaphore.release()

    # Tidak ada slot -> antrian async
    job_id = str(uuid.uuid4())
    _inc_queue()
    _set_job_result(job_id, {"status": "queued"})

    def worker():
        _semaphore.acquire()
        run_with_autoscaler(deploy_fn, job_id, raw, safe_group)

    threading.Thread(target=worker, daemon=True).start()

    return jsonify(
        success=True,
        queued=True,
        job_id=job_id,
        message="Container sedang dipersiapkan, cek /job/<job_id>.",
        autoscaler=autoscaler_status(),
    ), 202


@app.route("/job/<job_id>", methods=["GET"])
def job_status(job_id):
    result = _get_job_result(job_id)
    if result is None:
        return jsonify(success=False, error="Job tidak ditemukan"), 404
    return jsonify(success=True, **result)


@app.route("/autoscaler/status", methods=["GET"])
def get_autoscaler_status():
    return jsonify(success=True, autoscaler=autoscaler_status())


# ================= STOP =================
@app.route("/stop", methods=["POST"])
def stop():
    group = (request.json or {}).get("group")
    if not group:
        return jsonify(success=False, error="Group required"), 400
    safe = "".join(c for c in group if c.isalnum() or c in "-_")
    name = k8s_name(safe)

    def _del(fn):
        try:
            fn(name, NAMESPACE)
        except ApiException as e:
            if e.status != 404:
                logging.warning(f"Gagal hapus {name}: {e}")

    _del(net_v1.delete_namespaced_ingress)
    _del(core_v1.delete_namespaced_service)
    _del(apps_v1.delete_namespaced_deployment)
    return jsonify(success=True)


# ================= MONITORING PER-POD (via metrics.k8s.io) =================
def _parse_cpu_millicores(v):
    """'500m'->500, '1'->1000, '123456n'->0.12, '250u'->0.25."""
    if not v:
        return 0.0
    v = str(v)
    try:
        if v.endswith("n"):
            return float(v[:-1]) / 1e6
        if v.endswith("u"):
            return float(v[:-1]) / 1e3
        if v.endswith("m"):
            return float(v[:-1])
        return float(v) * 1000.0
    except ValueError:
        return 0.0


def _parse_mem_bytes(v):
    """'128Mi'->bytes, '52428Ki'->bytes, '1Gi'->bytes."""
    if not v:
        return 0
    v = str(v)
    units = {"Ki": 1024, "Mi": 1024**2, "Gi": 1024**3, "Ti": 1024**4,
             "K": 1000, "M": 1000**2, "G": 1000**3}
    for u, mult in units.items():
        if v.endswith(u):
            try:
                return int(float(v[: -len(u)]) * mult)
            except ValueError:
                return 0
    try:
        return int(v)
    except ValueError:
        return 0


def collect_container_stats():
    """Ambil CPU & memori tiap pod lab dari metrics.k8s.io. Return list of dict."""
    result = []
    # Batas memori dari spec pod (untuk memory_limit_bytes)
    limits = {}
    try:
        pods = core_v1.list_namespaced_pod(NAMESPACE, label_selector="app=lab")
        for p in pods.items:
            lim = 0
            for c in p.spec.containers:
                if c.resources and c.resources.limits:
                    lim = _parse_mem_bytes(c.resources.limits.get("memory"))
            limits[p.metadata.name] = lim
    except ApiException as e:
        logging.warning(f"Gagal list pod: {e}")

    try:
        metrics = custom.list_namespaced_custom_object(
            group="metrics.k8s.io", version="v1beta1",
            namespace=NAMESPACE, plural="pods",
        )
    except ApiException as e:
        logging.warning(f"metrics.k8s.io tidak tersedia: {e}")
        return result

    for item in metrics.get("items", []):
        pod_name = item["metadata"]["name"]
        if pod_name not in limits:  # hanya pod lab
            continue
        cpu_m = 0.0
        mem_b = 0
        for c in item.get("containers", []):
            usage = c.get("usage", {})
            cpu_m += _parse_cpu_millicores(usage.get("cpu"))
            mem_b += _parse_mem_bytes(usage.get("memory"))
        result.append({
            "name": pod_name,
            "status": "running",
            "cpu_percent": round(cpu_m / 10.0, 2),  # 1000m = 100% dari 1 core
            "memory_bytes": mem_b,
            "memory_limit_bytes": limits.get(pod_name, 0),
        })
    return result


@app.route("/containers/stats", methods=["GET"])
def containers_stats_json():
    data = collect_container_stats()
    return jsonify(success=True, count=len(data), containers=data)


@app.route("/metrics/containers", methods=["GET"])
def containers_metrics_prometheus():
    data = collect_container_stats()
    lines = []
    lines.append("# HELP lms_container_cpu_percent Pemakaian CPU per pod lab (persen dari 1 core)")
    lines.append("# TYPE lms_container_cpu_percent gauge")
    for d in data:
        lines.append(f'lms_container_cpu_percent{{container="{d["name"]}"}} {d["cpu_percent"]}')
    lines.append("# HELP lms_container_memory_bytes Pemakaian memori per pod lab (byte)")
    lines.append("# TYPE lms_container_memory_bytes gauge")
    for d in data:
        lines.append(f'lms_container_memory_bytes{{container="{d["name"]}"}} {d["memory_bytes"]}')
    lines.append("# HELP lms_container_memory_limit_bytes Batas memori per pod lab (byte)")
    lines.append("# TYPE lms_container_memory_limit_bytes gauge")
    for d in data:
        lines.append(f'lms_container_memory_limit_bytes{{container="{d["name"]}"}} {d["memory_limit_bytes"]}')
    lines.append("# HELP lms_container_total Jumlah pod lab yang hidup")
    lines.append("# TYPE lms_container_total gauge")
    lines.append(f"lms_container_total {len(data)}")
    return Response("\n".join(lines) + "\n", mimetype="text/plain")


# ================= MODULES =================
@app.route("/modules")
def modules():
    # Modul kini dibundel di image lab; endpoint dipertahankan untuk kompatibilitas.
    return jsonify(success=True, modules={"jupyter": [DEFAULT_MODULE], "flask": [], "streamlit": []})


@app.route("/health")
def health():
    return jsonify(status="healthy")
