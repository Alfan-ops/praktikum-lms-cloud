# (IMPORT & CONFIG SAMA SEPERTI PUNYA KAMU — DIPERSINGKAT DI SINI)
from flask import Flask, request, jsonify, Response
from docker import from_env, errors
import shutil, os, secrets, logging, threading, time, uuid, json
from collections import deque

logging.basicConfig(level=logging.INFO)
app = Flask(__name__)

# ================= AUTOSCALER =================
MAX_CONCURRENT_DEPLOYS = int(os.environ.get("MAX_CONCURRENT_DEPLOYS", "5"))
DEPLOY_QUEUE_MAX = int(os.environ.get("DEPLOY_QUEUE_MAX", "50"))

_semaphore = threading.Semaphore(MAX_CONCURRENT_DEPLOYS)
_active_count = 0
_active_lock = threading.Lock()
_queue_count = 0
_queue_lock = threading.Lock()
_job_results = {}  # job_id -> result dict
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
        # Bersihkan hasil lama (lebih dari 200 entri)
        if len(_job_results) > 200:
            oldest = list(_job_results.keys())[0]
            del _job_results[oldest]

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
    """Jalankan deploy_fn dengan semaphore. Dipanggil dari thread terpisah."""
    _dec_queue()
    _inc_active()
    try:
        result = deploy_fn(*args, **kwargs)
        # Flask response object — ambil data JSON-nya
        if hasattr(result, 'get_json'):
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

try:
    client = from_env()
except:
    client = None

USER_DATA_BASE_PATH = os.environ.get("USER_DATA_PATH", "/app/user_data")
MODULE_BASE_PATH = os.environ.get("MODULE_BASE_PATH", "/app/modules")

UPLOAD_FOLDERS = {
    "jupyter": os.path.join(MODULE_BASE_PATH, "jupyter"),
    "flask": os.path.join(MODULE_BASE_PATH, "flask"),
    "streamlit": os.path.join(MODULE_BASE_PATH, "streamlit"),
}

JUPYTER_MODULE_DIR = UPLOAD_FOLDERS["jupyter"]
FLASK_MODULE_DIR = UPLOAD_FOLDERS["flask"]
STREAMLIT_MODULE_DIR = UPLOAD_FOLDERS["streamlit"]

ACCESSIBLE_HOST = os.environ.get("ACCESSIBLE_HOST", "localhost")

JUPYTER_IMAGE = os.environ.get("JUPYTER_IMAGE")
FLASK_IMAGE = os.environ.get("FLASK_IMAGE")
STREAMLIT_IMAGE = os.environ.get("STREAMLIT_IMAGE")

HOST_USER_DATA_PATH = os.environ.get("HOST_USER_DATA_PATH", "/tmp/user_data")

DEFAULT_MEM_LIMIT = "256m"

# ================= MODULE DISCOVERY =================
def discover_modules():
    def list_files(path, ext):
        return [f for f in os.listdir(path) if f.endswith(ext)] if os.path.exists(path) else []

    return {
        "jupyter": list_files(JUPYTER_MODULE_DIR, ".ipynb"),
        "flask": list_files(FLASK_MODULE_DIR, ".py"),
        "streamlit": list_files(STREAMLIT_MODULE_DIR, ".py"),
    }

# ================= TOKEN =================
def get_or_create_token(token_file):
    if os.path.exists(token_file):
        return open(token_file).read().strip()

    token = secrets.token_hex(16)
    with open(token_file, "w") as f:
        f.write(token)

    return token

# ================= JUPYTER =================
def deploy_jupyter_internal(data, safe_group):
    module = data.get("module") or data.get("notebook")

    if not module:
        return jsonify(success=False, error="Module required"), 400

    src = os.path.join(JUPYTER_MODULE_DIR, module)
    if not os.path.isfile(src):
        return jsonify(success=False, error="Notebook not found"), 404

    container_name = f"praktikum_{safe_group}"

    group_dir = os.path.join(USER_DATA_BASE_PATH, safe_group)
    work_dir = os.path.join(group_dir, "work")
    host_work = os.path.join(HOST_USER_DATA_PATH, safe_group, "work")

    os.makedirs(work_dir, exist_ok=True)
    os.makedirs(host_work, exist_ok=True)

    dest = os.path.join(work_dir, module)
    if not os.path.exists(dest):
        shutil.copy(src, dest)

    token = get_or_create_token(os.path.join(group_dir, ".jupyter_token"))

    try:
        client.containers.get(container_name)
        return jsonify(success=True, message="Already running")
    except:
        pass

    c = client.containers.run(
        JUPYTER_IMAGE,
        name=container_name,
        detach=True,
        ports={"8888/tcp": None},
        volumes={host_work: {"bind": "/home/jovyan/work", "mode": "rw"}},
        command=[
            "start-notebook.sh",
            "--ServerApp.root_dir=/home/jovyan/work",
            f"--ServerApp.token={token}",
        ],
    )

    c.reload()
    port = c.attrs["NetworkSettings"]["Ports"]["8888/tcp"][0]["HostPort"]

    return jsonify(
        success=True,
        tool="jupyter",
        url=f"http://{ACCESSIBLE_HOST}:{port}/lab/tree/{module}?token={token}",
        group=safe_group
    )

# ================= FLASK =================
def deploy_flask(data, safe_group):
    module = data.get("module")
    src = os.path.join(FLASK_MODULE_DIR, module)

    if not os.path.isfile(src):
        return jsonify(success=False, error="Module not found"), 404

    name = f"praktikum_flask_{safe_group}"

    group_dir = os.path.join(USER_DATA_BASE_PATH, safe_group)
    work_dir = os.path.join(group_dir, "work")
    host_work = os.path.join(HOST_USER_DATA_PATH, safe_group, "work")

    os.makedirs(work_dir, exist_ok=True)
    os.makedirs(host_work, exist_ok=True)

    shutil.copy(src, os.path.join(work_dir, module))

    try:
        client.containers.get(name)
        return jsonify(success=True, message="Already running")
    except:
        pass

    c = client.containers.run(
        FLASK_IMAGE,
        name=name,
        detach=True,
        ports={"5000/tcp": None},
        volumes={host_work: {"bind": "/app/work", "mode": "rw"}},
        environment={"FLASK_APP_FILE": f"/app/work/{module}"}
    )

    c.reload()
    port = c.attrs["NetworkSettings"]["Ports"]["5000/tcp"][0]["HostPort"]

    return jsonify(success=True, tool="flask", url=f"http://{ACCESSIBLE_HOST}:{port}")

# ================= STREAMLIT =================
def deploy_streamlit(data, safe_group):
    module = data.get("module")
    src = os.path.join(STREAMLIT_MODULE_DIR, module)

    if not os.path.isfile(src):
        return jsonify(success=False, error="Module not found"), 404

    name = f"praktikum_streamlit_{safe_group}"

    group_dir = os.path.join(USER_DATA_BASE_PATH, safe_group)
    work_dir = os.path.join(group_dir, "work")
    host_work = os.path.join(HOST_USER_DATA_PATH, safe_group, "work")

    os.makedirs(work_dir, exist_ok=True)
    os.makedirs(host_work, exist_ok=True)

    shutil.copy(src, os.path.join(work_dir, module))

    try:
        client.containers.get(name)
        return jsonify(success=True, message="Already running")
    except:
        pass

    c = client.containers.run(
        STREAMLIT_IMAGE,
        name=name,
        detach=True,
        ports={"8501/tcp": None},
        volumes={host_work: {"bind": "/app/work", "mode": "rw"}},
        environment={"STREAMLIT_APP_FILE": f"/app/work/{module}"}
    )

    c.reload()
    port = c.attrs["NetworkSettings"]["Ports"]["8501/tcp"][0]["HostPort"]

    return jsonify(success=True, tool="streamlit", url=f"http://{ACCESSIBLE_HOST}:{port}")

# ================= DEPLOY =================
@app.route("/deploy", methods=["POST"])
def deploy():
    if not client:
        return jsonify(success=False, error="Docker unavailable"), 500

    raw = request.json or {}

    # BACKWARD COMPAT
    if "module_id" in raw:
        raw = {
            "group": str((raw.get("student_ids") or ["default"])[0]),
            "tool": "jupyter",
            "module": "praktikum_ml_iris.ipynb"
        }

    group = raw.get("group")
    tool = str(raw.get("tool", "jupyter")).lower()

    if not group:
        return jsonify(success=False, error="Group required"), 400

    safe_group = "".join(c for c in group if c.isalnum() or c in "-_")

    # Pilih fungsi deploy
    if tool == "jupyter":
        deploy_fn = deploy_jupyter_internal
    elif tool == "flask":
        deploy_fn = deploy_flask
    elif tool == "streamlit":
        deploy_fn = deploy_streamlit
    else:
        return jsonify(success=False, error="Unknown tool"), 400

    # Cek apakah container sudah berjalan (tidak perlu antrian)
    container_prefixes = {
        "jupyter": f"praktikum_{safe_group}",
        "flask": f"praktikum_flask_{safe_group}",
        "streamlit": f"praktikum_streamlit_{safe_group}",
    }
    try:
        client.containers.get(container_prefixes[tool])
        return deploy_fn(raw, safe_group)  # langsung kembalikan info existing
    except Exception:
        pass  # container belum ada, lanjut ke autoscaler

    # Cek kapasitas antrian
    with _queue_lock:
        if _queue_count >= DEPLOY_QUEUE_MAX:
            return jsonify(
                success=False,
                error="Server sedang sangat sibuk. Antrian penuh, coba lagi dalam beberapa menit.",
                autoscaler=autoscaler_status()
            ), 503

    # Mode sync (default): coba acquire semaphore segera
    # Jika sudah ada slot, jalankan langsung (lebih cepat untuk slot tersedia)
    acquired = _semaphore.acquire(blocking=False)
    if acquired:
        _inc_active()
        try:
            return deploy_fn(raw, safe_group)
        except Exception as e:
            return jsonify(success=False, error=str(e)), 500
        finally:
            _dec_active()
            _semaphore.release()

    # Tidak ada slot — masukkan ke antrian async
    job_id = str(uuid.uuid4())
    _inc_queue()
    _set_job_result(job_id, {"status": "queued"})

    def worker():
        _semaphore.acquire()  # tunggu giliran
        run_with_autoscaler(deploy_fn, job_id, raw, safe_group)

    t = threading.Thread(target=worker, daemon=True)
    t.start()

    return jsonify(
        success=True,
        queued=True,
        job_id=job_id,
        message="Container sedang dipersiapkan, gunakan /job/<job_id> untuk cek status.",
        autoscaler=autoscaler_status()
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


# ================= MONITORING PER-CONTAINER =================
# Menggantikan cAdvisor yang gagal di WSL2: orchestrator (punya akses Docker
# socket) menghitung CPU% & memori tiap container praktikum langsung dari
# Docker API, lalu menyajikannya dalam format Prometheus + JSON.

# Hanya pantau container LAB mahasiswa (praktikum_<nim>, praktikum_flask_*, dll).
# Underscore membedakan dari container infrastruktur "praktikum-lms-project-...".
CONTAINER_NAME_PREFIX = "praktikum_"


def _calc_cpu_percent(stats):
    """Hitung CPU% dari satu snapshot docker stats (ada precpu_stats)."""
    try:
        cpu = stats["cpu_stats"]
        precpu = stats["precpu_stats"]
        cpu_delta = cpu["cpu_usage"]["total_usage"] - precpu["cpu_usage"]["total_usage"]
        system_delta = cpu.get("system_cpu_usage", 0) - precpu.get("system_cpu_usage", 0)
        online = cpu.get("online_cpus") or len(cpu["cpu_usage"].get("percpu_usage") or [1])
        if system_delta > 0 and cpu_delta > 0:
            return round((cpu_delta / system_delta) * online * 100.0, 2)
    except (KeyError, TypeError, ZeroDivisionError):
        pass
    return 0.0


def collect_container_stats():
    """Kumpulkan stats semua container praktikum. Return list of dict."""
    if not client:
        return []
    result = []
    try:
        containers = client.containers.list(filters={"name": CONTAINER_NAME_PREFIX})
    except Exception as e:
        logging.error(f"Gagal list container: {e}")
        return []

    for c in containers:
        try:
            s = c.stats(stream=False)
            mem = s.get("memory_stats", {}) or {}
            result.append({
                "name": c.name,
                "id": c.short_id,
                "status": c.status,
                "cpu_percent": _calc_cpu_percent(s),
                "memory_bytes": mem.get("usage", 0),
                "memory_limit_bytes": mem.get("limit", 0),
            })
        except Exception as e:
            logging.warning(f"Gagal ambil stats {c.name}: {e}")
    return result


@app.route("/containers/stats", methods=["GET"])
def containers_stats_json():
    """Stats per-container dalam JSON (untuk dashboard/admin)."""
    data = collect_container_stats()
    return jsonify(success=True, count=len(data), containers=data)


@app.route("/metrics/containers", methods=["GET"])
def containers_metrics_prometheus():
    """Metrik per-container dalam format teks Prometheus (untuk di-scrape)."""
    data = collect_container_stats()
    lines = []
    lines.append("# HELP lms_container_cpu_percent Pemakaian CPU per container (persen)")
    lines.append("# TYPE lms_container_cpu_percent gauge")
    for d in data:
        lines.append(f'lms_container_cpu_percent{{container="{d["name"]}"}} {d["cpu_percent"]}')

    lines.append("# HELP lms_container_memory_bytes Pemakaian memori per container (byte)")
    lines.append("# TYPE lms_container_memory_bytes gauge")
    for d in data:
        lines.append(f'lms_container_memory_bytes{{container="{d["name"]}"}} {d["memory_bytes"]}')

    lines.append("# HELP lms_container_memory_limit_bytes Batas memori per container (byte)")
    lines.append("# TYPE lms_container_memory_limit_bytes gauge")
    for d in data:
        lines.append(f'lms_container_memory_limit_bytes{{container="{d["name"]}"}} {d["memory_limit_bytes"]}')

    lines.append("# HELP lms_container_total Jumlah container praktikum yang hidup")
    lines.append("# TYPE lms_container_total gauge")
    lines.append(f"lms_container_total {len(data)}")

    return Response("\n".join(lines) + "\n", mimetype="text/plain")

# ================= MODULES =================
@app.route("/modules")
def modules():
    return jsonify(success=True, modules=discover_modules())

# ================= UPLOAD =================
@app.route("/upload", methods=["POST"])
def upload():
    tool = request.form.get("tool")
    file = request.files.get("file")

    if tool not in UPLOAD_FOLDERS:
        return {"success": False, "error": "Invalid tool"}, 400

    path = os.path.join(UPLOAD_FOLDERS[tool], file.filename)
    file.save(path)

    return {"success": True, "filename": file.filename}

# ================= STOP =================
@app.route("/stop", methods=["POST"])
def stop():
    group = (request.json or {}).get("group")
    safe = "".join(c for c in group if c.isalnum() or c in "-_")

    for name in [
        f"praktikum_{safe}",
        f"praktikum_flask_{safe}",
        f"praktikum_streamlit_{safe}",
    ]:
        try:
            c = client.containers.get(name)
            c.stop(); c.remove()
        except:
            pass

    return jsonify(success=True)

@app.route("/health")
def health():
    return jsonify(status="healthy")