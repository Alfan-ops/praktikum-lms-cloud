import redis
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, g
from flask_cors import CORS
import requests
import datetime
import os
import logging
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST
from supabase import create_client, Client
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler

# Load environment variables
load_dotenv()

# Basic logging setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)
CORS(app)

# --- Configuration ---
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
ORCHESTRATOR_URL = os.environ.get("ORCHESTRATOR_URL", "http://orchestrator:4000")
REDIS_URL = os.environ.get("REDIS_URL")

# --- Initialize Redis ---
try:
    cache = redis.from_url(REDIS_URL) if REDIS_URL else None
    logging.info("Redis cache initialized.")
except Exception as e:
    logging.warning(f"Redis not available: {e}")
    cache = None

# --- Prometheus Metrics ---
requests_counter = Counter(
    "management_requests_total",
    "Total number of service requests received",
    ['method', 'endpoint']
)
periods_counter = Counter(
    "periods_operations_total",
    "Total number of period operations",
    ['operation']
)

# --- Session status in-memory ---
SESSIONS = {}

# --- Autoscaler: batas concurrent deploy dari scheduler ---
MAX_SCHEDULER_CONCURRENT = int(os.environ.get("MAX_SCHEDULER_CONCURRENT", "5"))
_scheduler_executor = ThreadPoolExecutor(max_workers=MAX_SCHEDULER_CONCURRENT)

# --- Rate limiter in-memory (fallback jika Redis tidak ada) ---
_rate_limit_lock = threading.Lock()
_rate_limit_store = {}  # student_id -> last_request_time

LABS_RATE_LIMIT_SECONDS = int(os.environ.get("LABS_RATE_LIMIT_SECONDS", "10"))

def check_rate_limit(student_id: str) -> bool:
    """Return True jika request diizinkan, False jika terlalu cepat."""
    now = datetime.datetime.now().timestamp()
    rate_key = f"ratelimit:labs:{student_id}"

    # Coba pakai Redis terlebih dahulu
    if cache:
        try:
            existing = cache.get(rate_key)
            if existing:
                return False
            cache.setex(rate_key, LABS_RATE_LIMIT_SECONDS, "1")
            return True
        except Exception:
            pass  # Fallback ke in-memory

    # Fallback in-memory
    with _rate_limit_lock:
        last = _rate_limit_store.get(student_id, 0)
        if now - last < LABS_RATE_LIMIT_SECONDS:
            return False
        _rate_limit_store[student_id] = now
        return True 

# --- ###################################################### ---
# --- FIX: Supabase Client Management
# --- ###################################################### ---
def get_supabase_client() -> Client | None:
    """Creates a new Supabase client."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("Supabase URL or Key not found in environment variables.")
        return None
    try:
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        logging.error(f"Failed to initialize Supabase client: {e}")
        return None

# --- Middleware for Prometheus ---
@app.before_request
def increment_request_counter():
    if request.endpoint:
         requests_counter.labels(method=request.method, endpoint=request.endpoint).inc()

# --- Helper Function for Auth ---
def get_user_from_token():
    """Gets the authenticated Supabase user from the Authorization header."""
    if 'user' in g:
        return g.user
    
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        return None
        
    try:
        token = auth_header.split(" ")[1]
        # Use a fresh client for auth
        supabase = get_supabase_client()
        if not supabase:
            logging.error("get_user_from_token: Supabase client is not available.")
            return None
            
        user_info = supabase.auth.get_user(token)
        g.user = user_info.user
        return g.user
    except Exception as e:
        logging.warning(f"Failed to get user from token: {e}")
        return None

def start_scheduled_session(schedule):
    """Calls orchestrator to deploy a container for a schedule."""
    supabase = get_supabase_client()
    if not supabase:
        logging.error(f"Cannot start session {schedule['id']}: Supabase client not available.")
        return

    logging.info(f"Attempting to pre-warm session for schedule {schedule['id']}...")
    try:
        # Get student NIM for the group key
        user_res = supabase.table("users").select("nim").eq("id", schedule['student_id']).single().execute()
        if not user_res.data:
            raise Exception(f"Student NIM not found for user ID {schedule['student_id']}")
        
        group_key = user_res.data.get("nim", schedule['student_id'])

        # TODO: Get notebook name from module content
        # For now, we hardcode it as you did.
        notebook_name = "praktikum_ml_iris.ipynb"

        orch_res = requests.post(
            f"{ORCHESTRATOR_URL}/deploy",
            json={
                "group": group_key,
                "notebook": notebook_name,
                "cpu": schedule.get("cpu_limit", "1"),
                "ram": schedule.get("memory_limit", "1g"),
                "storage": schedule.get("storage_limit", "2g")
            },
            timeout=20
        )
        orch_res.raise_for_status()
        orch_data = orch_res.json()

        if orch_data.get("success"):
            # Store the URL and container ID back into the schedule
            update_payload = {
                "status": "ACTIVE",
                "container_id": orch_data.get("container_id"),
                "notebook_url": orch_data.get("url"),
                "token": orch_data.get("token")
            }
            supabase.table("practikum_schedules").update(update_payload).eq("id", schedule['id']).execute()
            logging.info(f"Successfully started and activated session for schedule {schedule['id']}.")
        else:
            raise Exception(orch_data.get("error", "Orchestrator failed to deploy"))

    except Exception as e:
        logging.error(f"Failed to start session for schedule {schedule['id']}: {e}")
        # Optionally set status to 'ERROR'
        supabase.table("practikum_schedules").update({"status": "ERROR", "feedback": str(e)}).eq("id", schedule['id']).execute()


def stop_scheduled_session(schedule):
    """Calls orchestrator to stop and remove a container."""
    supabase = get_supabase_client()
    if not supabase:
        logging.error(f"Cannot stop session {schedule['id']}: Supabase client not available.")
        return
        
    logging.info(f"Attempting to stop session for schedule {schedule['id']}...")
    try:
        # Get student NIM for the group key
        user_res = supabase.table("users").select("nim").eq("id", schedule['student_id']).single().execute()
        if not user_res.data:
            raise Exception(f"Student NIM not found for user ID {schedule['student_id']}")
        
        group_key = user_res.data.get("nim", schedule['student_id'])
        
        orch_res = requests.post(
            f"{ORCHESTRATOR_URL}/stop",
            json={"group": group_key},
            timeout=10
        )
        orch_res.raise_for_status()
        orch_data = orch_res.json()

        if orch_data.get("success"):
            supabase.table("practikum_schedules").update({"status": "COMPLETED"}).eq("id", schedule['id']).execute()
            logging.info(f"Successfully stopped session for schedule {schedule['id']}.")
        else:
            raise Exception(orch_data.get("error", "Orchestrator failed to stop"))

    except Exception as e:
        logging.error(f"Failed to stop session for schedule {schedule['id']}: {e}")
        # Even if orchestrator fails, mark as completed to avoid loop
        supabase.table("practikum_schedules").update({"status": "ERROR", "feedback": f"Failed to stop: {e}"}).eq("id", schedule['id']).execute()


def check_schedules():
    """Background task to manage lab session lifecycles."""
    logging.info(" Background scheduler running check_schedules")
    supabase = get_supabase_client()
    if not supabase:
        logging.error("check_schedules: Supabase client not available.")
        return # Don't run if DB isn't connected
        
    logging.info("Background scheduler running...")
    now = datetime.datetime.now(datetime.timezone.utc)
    
    # 1. Find sessions that need to be started (e.g., 5 mins in advance)
    pre_warm_time = (now + datetime.timedelta(minutes=5)).isoformat()
    
    try:
        pending_res = supabase.table("practikum_schedules") \
            .select("*") \
            .eq("status", "PENDING") \
            .lte("start_time", pre_warm_time) \
            .gte("end_time", now.isoformat()) \
            .execute()
        
        if pending_res.data:
            logging.info(f"Found {len(pending_res.data)} sessions to pre-warm (max {MAX_SCHEDULER_CONCURRENT} concurrent).")
            futures = [_scheduler_executor.submit(start_scheduled_session, s) for s in pending_res.data]
            for f in futures:
                try:
                    f.result(timeout=30)
                except Exception as e:
                    logging.error(f"Scheduler session start error: {e}")
                
    except Exception as e:
        logging.error(f"Error querying pending schedules: {e}")

    # 2. Find sessions that need to be stopped
    try:
        active_res = supabase.table("practikum_schedules") \
            .select("*") \
            .eq("status", "ACTIVE") \
            .lte("end_time", now.isoformat()) \
            .execute()
        
        if active_res.data:
            logging.info(f"Found {len(active_res.data)} active sessions to stop (max {MAX_SCHEDULER_CONCURRENT} concurrent).")
            futures = [_scheduler_executor.submit(stop_scheduled_session, s) for s in active_res.data]
            for f in futures:
                try:
                    f.result(timeout=15)
                except Exception as e:
                    logging.error(f"Scheduler session stop error: {e}")

    except Exception as e:
        logging.error(f"Error querying active schedules to stop: {e}")

# --- ###################################################### ---
# --- END: BACKGROUND SCHEDULER LOGIC
# --- ###################################################### ---


# --- API Endpoints ---
@app.route("/health", methods=["GET", "OPTIONS"])
def health_check():
    supabase = get_supabase_client()
    db_status = "connected" if supabase else "disconnected"
    if supabase:
        try:
            supabase.table('periods').select('id', head=True, count='exact').execute()
        except Exception as e:
            db_status = f"error: {e}"
    return jsonify({"status": "healthy", "database_status": db_status})


@app.route("/api/autoscaler/status", methods=["GET", "OPTIONS"])
def autoscaler_status_endpoint():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    try:
        orch_res = requests.get(f"{ORCHESTRATOR_URL}/autoscaler/status", timeout=5)
        orch_data = orch_res.json() if orch_res.ok else {}
    except Exception:
        orch_data = {"error": "Orchestrator tidak dapat dihubungi"}

    return jsonify({
        "backend": {
            "scheduler_max_concurrent": MAX_SCHEDULER_CONCURRENT,
            "rate_limit_seconds": LABS_RATE_LIMIT_SECONDS,
        },
        "orchestrator": orch_data.get("autoscaler", orch_data),
    })


# == Periods Endpoints ==
@app.route("/api/periods", methods=["GET", "OPTIONS"]) 
def get_periods():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    try:
        response = supabase.table("periods").select("*").order("year", desc=True).order("semester", desc=True).execute()
        if hasattr(response, 'data'):
            return jsonify({"periods": response.data})
        else:
             return jsonify({"error": "Failed to parse database response"}), 500
    except Exception as e:
        logging.error(f"Error fetching periods: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/periods", methods=["POST", "OPTIONS"])
def create_period():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    periods_counter.labels(operation='create').inc()
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    year = data.get("year")
    semester = data.get("semester")
    if not year or not semester:
        return jsonify({"error": "Year and semester are required"}), 400
    try:
        response = supabase.table("periods").insert({
            "year": int(year),
            "semester": semester,
            "is_active": False
        }).execute()

        if hasattr(response, 'data') and response.data:
            return jsonify({"message": "Period created successfully", "period": response.data[0]}), 201
        elif hasattr(response, 'error') and response.error:
            return jsonify({"error": response.error.message or "Database error"}), 400
        else:
            return jsonify({"error": "Failed to create period, unknown reason"}), 500
    except Exception as e:
        logging.error(f"Error creating period: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/periods/<int:period_id>", methods=["PUT", "OPTIONS"])
def update_period(period_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
        
    periods_counter.labels(operation='update').inc()
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    updates = {}
    if "is_active" in data:
        updates["is_active"] = bool(data["is_active"])
    if not updates:
        return jsonify({"error": "No update data provided"}), 400
    try:
        if updates.get("is_active") is True:
            logging.info(f"Deactivating other periods before activating {period_id}")
            supabase.table("periods").update({"is_active": False}).neq("id", period_id).execute()

        response = supabase.table("periods").update(updates).eq("id", period_id).execute()
        
        if hasattr(response, 'data') and response.data:
            refetch_response = supabase.table("periods").select("*").eq("id", period_id).single().execute()
            if refetch_response.data:
                return jsonify({"message": "Period updated successfully", "period": refetch_response.data})
            else:
                return jsonify({"error": f"Failed to refetch period {period_id}"}), 500
        elif not response.data:
             return jsonify({"error": f"Period with ID {period_id} not found"}), 404
        else:
             return jsonify({"error": "Failed to update period, unknown reason"}), 500
    except Exception as e:
        logging.error(f"Error updating period {period_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/periods/<int:period_id>", methods=["DELETE", "OPTIONS"])
def delete_period(period_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
        
    periods_counter.labels(operation='delete').inc()
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("periods").delete().eq("id", period_id).execute()
        if hasattr(response, 'error') and response.error:
            if "violates foreign key constraint" in response.error.message:
                 return jsonify({"error": f"Cannot delete period {period_id}. It is linked to other records."}), 409
            return jsonify({"error": response.error.message or "Database error"}), 400
        elif hasattr(response, 'data'):
            return jsonify({"message": f"Period {period_id} deleted successfully"})
        else:
             return jsonify({"error": "Failed to delete period, unknown reason"}), 500
    except Exception as e:
        logging.error(f"Error deleting period {period_id}: {e}")
        return jsonify({"error": str(e)}), 500

# == Students Endpoints ==
@app.route("/api/students", methods=["GET", "OPTIONS"]) 
def get_students():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("users").select("*").eq("role", "student").order("full_name", desc=False).execute()
        if hasattr(response, 'data'):
            return jsonify({"students": response.data})
        else:
            return jsonify({"error": "Failed to parse database response"}), 500
    except Exception as e:
        logging.error(f"Error fetching students: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/students", methods=["POST", "OPTIONS"])
def create_student():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    email = data.get("email")
    password = data.get("password")
    full_name = data.get("full_name")
    nim = data.get("nim")
    if not email or not password or not full_name or not nim:
        return jsonify({"error": "Email, password, full_name, and nim are required"}), 400
    try:
        auth_response = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": { "name": full_name, "role": "student", "nim": nim }
        })
        if not auth_response.user:
                if "already registered" in str(auth_response):
                    return jsonify({"error": "User with this email or NIM already exists"}), 409
                return jsonify({"error": "Failed to create authentication user"}), 500
        new_user = auth_response.user
        
        profile_response = supabase.table("users").insert({
            "id": new_user.id,
            "email": email,
            "full_name": full_name,
            "nim": nim,
            "role": "student"
        }).execute()

        if hasattr(profile_response, 'error') and profile_response.error:
            supabase.auth.admin.delete_user(new_user.id)
            return jsonify({"error": f"Failed to create user profile: {profile_response.error.message}"}), 500
        
        if hasattr(profile_response, 'data') and profile_response.data:
            return jsonify({"message": "Student created successfully", "student": profile_response.data[0]}), 201
        else:
            raise Exception("Profile insert succeeded but returned no data")
    except Exception as e:
        logging.error(f"Error creating student: {e}")
        if 'new_user' in locals() and new_user:
            try:
                supabase.auth.admin.delete_user(new_user.id)
            except Exception as cleanup_e:
                logging.error(f"Failed to cleanup orphaned auth user {new_user.id}: {cleanup_e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/students/bulk-upload", methods=["POST", "OPTIONS"])
def create_students_bulk():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403
    
    students_data = request.json
    if not isinstance(students_data, list):
        return jsonify({"error": "Request body must be an array of student objects"}), 400

    success_count = 0
    failed_count = 0
    created_students = []
    errors = []

    for student in students_data:
        email = student.get("email")
        password = student.get("password") or "password123" # Default password
        full_name = student.get("full_name")
        nim = student.get("nim")

        if not email or not full_name or not nim:
            failed_count += 1
            errors.append(f"Skipped: Missing data for {email or nim}")
            continue
        
        try:
            auth_response = supabase.auth.admin.create_user({
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": { "name": full_name, "role": "student", "nim": str(nim) }
            })
            if not auth_response.user:
                raise Exception("Failed to create auth user (maybe duplicate)")
            
            new_user = auth_response.user
            
            profile_response = supabase.table("users").insert({
                "id": new_user.id,
                "email": email,
                "full_name": full_name,
                "nim": str(nim),
                "role": "student"
            }).execute()

            if hasattr(profile_response, 'error') and profile_response.error:
                raise Exception(f"Failed to create profile: {profile_response.error.message}")
            
            if hasattr(profile_response, 'data') and profile_response.data:
                success_count += 1
                created_students.append(profile_response.data[0])
            else:
                raise Exception("Profile insert succeeded but returned no data")

        except Exception as e:
            failed_count += 1
            errors.append(f"Failed {email}: {str(e)}")
            if 'new_user' in locals() and new_user:
                try:
                    supabase.auth.admin.delete_user(new_user.id) # Rollback
                except Exception as cleanup_e:
                    logging.error(f"Failed to cleanup orphaned auth user {new_user.id}: {cleanup_e}")

    return jsonify({
        "message": f"Bulk import complete: {success_count} succeeded, {failed_count} failed.",
        "created_students": created_students,
        "errors": errors
    }), 201

@app.route("/api/students/<string:user_id>", methods=["DELETE", "OPTIONS"])
def delete_student(user_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    if not user_id: return jsonify({"error": "User ID is required"}), 400
    try:
        delete_response = supabase.auth.admin.delete_user(user_id)
        if hasattr(delete_response, 'id'):
                return jsonify({"message": "Student deleted successfully"})
        else:
            return jsonify({"error": "User not found or already deleted."}), 404
    except Exception as e:
        logging.error(f"Error deleting student {user_id}: {e}")
        return jsonify({"error": str(e)}), 500

# == Courses Endpoints ==
def get_active_period_id():
    supabase = get_supabase_client()
    if not supabase: return None
    try:
        period_response = supabase.table("periods").select("id").eq("is_active", True).limit(1).maybe_single().execute()
        
        if period_response and hasattr(period_response, 'data') and period_response.data:
            return period_response.data.get("id")
        elif period_response and hasattr(period_response, 'error') and period_response.error:
             logging.error(f"Error fetching active period (Supabase error): {period_response.error}")
             return None
        else:
            return None
    except Exception as e:
        logging.error(f"Error fetching active period: {e}")
        return None

@app.route("/api/courses", methods=["GET", "OPTIONS"]) 
def get_courses():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        active_period_id = get_active_period_id()
        if not active_period_id:
            logging.warning("get_courses: No active period found.")
            return jsonify({"courses": []})
        
        query = "*, courses(*, modules(count)), course_enrollments(count)"
        
        offerings_response = supabase.table("course_offerings") \
            .select(query) \
            .eq("period_id", active_period_id) \
            .execute()
        
        if hasattr(offerings_response, 'data'):
            formatted_courses = []
            for offering in offerings_response.data:
                if offering.get('courses'): 
                    course_data = offering['courses']
                    
                    module_count = 0
                    if 'modules' in course_data and isinstance(course_data['modules'], list) and len(course_data['modules']) > 0:
                        module_count = course_data['modules'][0].get('count', 0)
                    
                    student_count = 0
                    if 'course_enrollments' in offering and isinstance(offering['course_enrollments'], list) and len(offering['course_enrollments']) > 0:
                        student_count = offering['course_enrollments'][0].get('count', 0)
                    
                    if 'modules' in course_data:
                        del course_data['modules']
                    if 'course_enrollments' in offering:
                        del offering['course_enrollments']
                    
                    formatted_courses.append({
                        **course_data,
                        'offering_id': offering['id'],
                        'period_id': offering['period_id'],
                        'instructor_name': offering.get('instructor_name', 'N/A'),
                        'students_count': student_count,
                        'modules_count': module_count,
                    })
            return jsonify({"courses": formatted_courses})
        elif hasattr(offerings_response, 'error'):
             logging.error(f"Error fetching courses: {offerings_response.error.message}")
             return jsonify({"error": offerings_response.error.message}), 500
        else:
            return jsonify({"error": "Failed to parse database response"}), 500
    except Exception as e:
        logging.error(f"Error fetching courses: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/my-courses", methods=["GET", "OPTIONS"]) 
def get_my_courses():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    student = get_user_from_token()
    if not student:
        return jsonify({"error": "Authentication required."}), 401
    
    if cache:
        cache_key = f"my_courses_{student.id}"
        cached_data = cache.get(cache_key)
        if cached_data:
            logging.info(f"Serving courses from cache for {student.id}")
            return jsonify(json.loads(cached_data))
        
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        query = "*, course_offerings(*, courses(*, modules(id)))"
        response = supabase.table("course_enrollments") \
            .select(query) \
            .eq("student_id", student.id) \
            .execute()

        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if not hasattr(response, 'data'):
            return jsonify({"error": "Failed to parse database response"}), 500

        formatted_courses = []
        for enrollment in response.data:
            offering = enrollment.get('course_offerings')
            if not offering: continue
            
            course_data = offering.get('courses')
            if not course_data: continue
            
            total_assignments = 0
            completed_assignments = 0
            
            if 'modules' in course_data and course_data['modules']:
                module_ids = [m['id'] for m in course_data['modules']]
                
                content_res = supabase.table("module_content") \
                    .select("content_data") \
                    .in_("module_id", module_ids) \
                    .eq("content_type", "assignment") \
                    .execute()
                
                if content_res.data:
                    assignment_ids = [
                        c['content_data']['assignment_id'] 
                        for c in content_res.data 
                        if c.get('content_data') and c['content_data'].get('assignment_id')
                    ]
                    
                    if assignment_ids:
                        total_assignments = len(assignment_ids)
                        
                        submission_res = supabase.table("assignment_submissions") \
                            .select("id", count='exact') \
                            .in_("assignment_id", assignment_ids) \
                            .eq("student_id", student.id) \
                            .execute()
                            
                        if submission_res.count is not None:
                            completed_assignments = submission_res.count
            
            progress = 0
            if total_assignments > 0:
                progress = (completed_assignments / total_assignments) * 100
            elif total_assignments == 0:
                progress = 100 
            
            student_count_res = supabase.table("course_enrollments") \
                .select("id", count='exact') \
                .eq("course_offering_id", offering['id']) \
                .execute()
                
            student_count = student_count_res.count or 0
            
            formatted_courses.append({
                **course_data,
                'offering_id': offering['id'],
                'period_id': offering['period_id'],
                'instructor_name': offering.get('instructor_name', 'N/A'),
                'modules_count': len(course_data['modules']),
                'students_count': student_count,
                'progress': progress 
            })
        if cache:
            cache.setex(cache_key, 300, json.dumps({"courses": formatted_courses}))
               
        return jsonify({"courses": formatted_courses})
        
    except Exception as e:
        logging.error(f"Error fetching 'my-courses' for student {student.id}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

@app.route("/api/courses", methods=["POST", "OPTIONS"])
def create_course():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    course_code = data.get("course_code")
    course_name = data.get("course_name")
    description = data.get("description")
    instructor_name = data.get("instructor")
    if not course_code or not course_name:
        return jsonify({"error": "Course code and name are required"}), 400
    try:
        active_period_id = get_active_period_id()
        if not active_period_id:
            return jsonify({"error": "Cannot create course: No active period found."}), 400
        
        existing_course_res = supabase.table("courses").select("id").eq("course_code", course_code).limit(1).execute()
        if not hasattr(existing_course_res, 'data'):
            raise Exception(f"Failed to query courses. Response: {existing_course_res}")
            
        course_id = None
        if existing_course_res.data and len(existing_course_res.data) > 0:
            course_id = existing_course_res.data[0]['id']
            supabase.table("courses").update(
                {"course_name": course_name, "description": description}
            ).eq("id", course_id).execute()
        else:
            insert_res = supabase.table("courses").insert(
                {"course_code": course_code, "course_name": course_name, "description": description}
            ).execute()
            if hasattr(insert_res, 'error') and insert_res.error:
                raise Exception(f"Error inserting new course: {insert_res.error.message}")
            if not insert_res.data:
                 raise Exception("Course insert returned no data")
            course_id = insert_res.data[0]['id']

        offering_check_res = supabase.table("course_offerings").select("id").eq("course_id", course_id).eq("period_id", active_period_id).limit(1).execute()
        if not hasattr(offering_check_res, 'data'):
            raise Exception(f"Failed to query course_offerings. Response: {offering_check_res}")
        if offering_check_res.data and len(offering_check_res.data) > 0:
            return jsonify({"error": f"Course {course_code} is already offered in this period."}), 409
        
        offering_res = supabase.table("course_offerings").insert({
            "course_id": course_id,
            "period_id": active_period_id,
            "instructor_name": instructor_name
        }).execute()
        if hasattr(offering_res, 'error') and offering_res.error:
            raise Exception(f"Error creating course offering: {offering_res.error.message}")
        if not offering_res.data:
             raise Exception("Course offering insert returned no data")
        new_offering_id = offering_res.data[0]['id']

        final_res = supabase.table("course_offerings").select("*, courses(*)").eq("id", new_offering_id).single().execute()
        if hasattr(final_res, 'error') and final_res.error:
            raise Exception(f"Error fetching newly created offering: {final_res.error.message}")
        if not final_res.data or 'courses' not in final_res.data or not final_res.data['courses']:
             raise Exception(f"Failed to join course details for new offering {new_offering_id}.")
             
        offering = final_res.data
        formatted_course = {
            **offering['courses'],
            'offering_id': offering['id'],
            'period_id': offering['period_id'],
            'instructor_name': offering.get('instructor_name', 'N/A')
        }
        return jsonify({"message": "Course created and offered successfully", "course": formatted_course}), 201
    except Exception as e:
        logging.error(f"Error creating course: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/courses/<int:course_id>", methods=["PUT", "OPTIONS"])
def update_course(course_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    updates = {
        "course_code": data.get("course_code"),
        "course_name": data.get("course_name"),
        "description": data.get("description")
    }
    updates = {k: v for k, v in updates.items() if v is not None}
    if not updates:
        return jsonify({"error": "No data provided to update"}), 400
    try:
        response = supabase.table("courses").update(updates).eq("id", course_id).execute()
        
        if hasattr(response, 'data') and response.data:
            updated_course = supabase.table("courses").select("*").eq("id", course_id).single().execute()
            if updated_course.data:
                return jsonify({"message": "Course updated successfully", "course": updated_course.data})
            else:
                return jsonify({"error": "Failed to refetch course"}), 500
        if not response.data:
             return jsonify({"error": "Course not found"}), 404
        else:
            return jsonify({"error": "Failed to update course"}), 500
    except Exception as e:
        logging.error(f"Error updating course {course_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/courses/<int:course_id>", methods=["GET", "OPTIONS"])
def get_course_details(course_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503

    try:
        course_response = supabase.table("courses").select("*").eq("id", course_id).single().execute()
        if not course_response.data:
            return jsonify({"error": "Course not found"}), 404
        
        course_data = course_response.data
        
        offering_response = supabase.table("course_offerings") \
            .select("instructor_name") \
            .eq("course_id", course_id) \
            .neq("instructor_name", "null") \
            .limit(1) \
            .maybe_single() \
            .execute()

        if offering_response.data and offering_response.data.get("instructor_name"):
            course_data["instructor_name"] = offering_response.data["instructor_name"]
        else:
            course_data["instructor_name"] = "N/A"

        return jsonify(course_data)
        
    except Exception as e:
        logging.error(f"Error fetching course details for {course_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/course-offerings/<int:offering_id>", methods=["DELETE", "OPTIONS"])
def delete_course_offering(offering_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        offering_res = supabase.table("course_offerings").select("course_id").eq("id", offering_id).single().execute()
        if hasattr(offering_res, 'error') or not offering_res.data:
            return jsonify({"error": "Course offering not found"}), 404
        
        course_id_to_check = offering_res.data['course_id']
        delete_offering_res = supabase.table("course_offerings").delete().eq("id", offering_id).execute()
        if hasattr(delete_offering_res, 'error') and delete_offering_res.error:
            raise Exception(f"Error deleting course offering: {delete_offering_res.error.message}")
        
        other_offerings_res = supabase.table("course_offerings").select("id", count='exact').eq("course_id", course_id_to_check).execute()
        
        if not other_offerings_res.data or len(other_offerings_res.data) == 0:
            logging.info(f"No other offerings found for course ID {course_id_to_check}. Deleting base course.")
            supabase.table("courses").delete().eq("id", course_id_to_check).execute()
        
        return jsonify({"message": "Course offering deleted successfully"}), 200
    except Exception as e:
        logging.error(f"Error deleting course offering: {e}")
        return jsonify({"error": str(e)}), 500

# == Modules Endpoints ==
@app.route("/api/courses/<int:course_id>/modules", methods=["GET", "OPTIONS"]) 
def get_modules_for_course(course_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("modules").select("*").eq("course_id", course_id).order("module_title", desc=False).execute()
        if hasattr(response, 'data'):
            return jsonify({"modules": response.data})
        else:
            return jsonify({"error": "Failed to parse database response"}), 500
    except Exception as e:
        logging.error(f"Error fetching modules for course {course_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/modules", methods=["POST", "OPTIONS"])
def create_module():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    course_id = data.get("course_id")
    module_title = data.get("module_title")
    description = data.get("description")
    if not course_id or not module_title:
        return jsonify({"error": "Course ID and Module Title are required"}), 400
    try:
        response = supabase.table("modules").insert({
            "course_id": course_id,
            "module_title": module_title,
            "description": description
        }).execute()
        
        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if hasattr(response, 'data') and response.data:
            return jsonify({"message": "Module created successfully", "module": response.data[0]}), 201
        else:
            return jsonify({"error": "Failed to create module"}), 500
    except Exception as e:
        logging.error(f"Error creating module: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/modules/<int:module_id>", methods=["PUT", "OPTIONS"])
def update_module(module_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    updates = {
        "module_title": data.get("module_title"),
        "description": data.get("description")
    }
    updates = {k: v for k, v in updates.items() if v is not None}
    if not updates:
        return jsonify({"error": "No data provided to update"}), 400
    try:
        response = supabase.table("modules").update(updates).eq("id", module_id).execute()

        if hasattr(response, 'data') and response.data:
            refetch_response = supabase.table("modules").select("*").eq("id", module_id).single().execute()
            if refetch_response.data:
                return jsonify({"message": "Module updated successfully", "module": refetch_response.data})
            else:
                return jsonify({"error": "Failed to refetch module"}), 500
        if not response.data:
            return jsonify({"error": "Module not found"}), 404
        else:
            return jsonify({"error": "Failed to update module"}), 500
    except Exception as e:
        logging.error(f"Error updating module {module_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/modules/<int:module_id>", methods=["DELETE", "OPTIONS"])
def delete_module(module_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("modules").delete().eq("id", module_id).execute()
        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if not response.data:
            return jsonify({"error": "Module not found"}), 404
        return jsonify({"message": "Module deleted successfully"})
    except Exception as e:
        logging.error(f"Error deleting module {module_id}: {e}")
        return jsonify({"error": str(e)}), 500

# == Module Content Endpoints ==
@app.route("/api/modules/<int:module_id>/content", methods=["GET", "OPTIONS"]) 
def get_module_content(module_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("module_content").select("*") \
            .eq("module_id", module_id) \
            .order("order_index", desc=False) \
            .execute()
        if hasattr(response, 'data'):
            return jsonify({"content": response.data})
        else:
            return jsonify({"error": "Failed to parse database response"}), 500
    except Exception as e:
        logging.error(f"Error fetching content for module {module_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/module-content", methods=["POST", "OPTIONS"])
def create_module_content():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    module_id = data.get("module_id")
    content_type = data.get("content_type")
    content_data = data.get("content_data")
    order_index = data.get("order_index")
    if not module_id or not content_type or content_data is None:
        return jsonify({"error": "module_id, content_type, and content_data are required"}), 400
    try:
        response = supabase.table("module_content").insert({
            "module_id": module_id,
            "content_type": content_type,
            "content_data": content_data,
            "order_index": int(order_index)
        }).execute()

        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if hasattr(response, 'data') and response.data:
            return jsonify({"message": "Module content created", "content": response.data[0]}), 201
        else:
            return jsonify({"error": "Failed to create content"}), 500
    except Exception as e:
        logging.error(f"Error creating module content: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/module-content/<int:content_id>", methods=["DELETE", "OPTIONS"])
def delete_module_content(content_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("module_content").delete().eq("id", content_id).execute()
        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if not response.data:
            return jsonify({"error": "Content not found"}), 404
        return jsonify({"message": "Module content deleted successfully"})
    except Exception as e:
        logging.error(f"Error deleting module content {content_id}: {e}")
        return jsonify({"error": str(e)}), 500

# == Endpoints for Scheduler and Content Editor ==
@app.route("/api/courses/<int:course_id>/assignments", methods=["GET", "OPTIONS"]) 
def get_assignments_for_course(course_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("assignments").select("*") \
            .eq("course_id", course_id) \
            .order("title", desc=False) \
            .execute()
        if hasattr(response, 'data'):
            return jsonify({"assignments": response.data})
        else:
            raise Exception("Failed to parse database response")
    except Exception as e:
        logging.error(f"Error fetching assignments for course {course_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/assignments", methods=["POST", "OPTIONS"])
def create_assignment():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    try:
        payload = {
            "course_id": data.get("course_id"),
            "title": data.get("title"),
            "description": data.get("description"),
            "submission_start": data.get("submission_start"),
            "submission_end": data.get("submission_end"),
            "max_score": data.get("max_score")
        }
        
        if not all([payload["course_id"], payload["title"], payload["submission_start"], payload["submission_end"]]):
            return jsonify({"error": "Missing required fields"}), 400

        response = supabase.table("assignments").insert(payload).execute()
        
        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if hasattr(response, 'data') and response.data:
            return jsonify({"message": "Assignment created", "assignment": response.data[0]}), 201
        else:
            return jsonify({"error": "Failed to create assignment"}), 500

    except Exception as e:
        logging.error(f"Error creating assignment: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/assignments/<int:assignment_id>", methods=["PUT", "OPTIONS"])
def update_assignment(assignment_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403
    
    data = request.json
    try:
        payload = {
            "title": data.get("title"),
            "description": data.get("description"),
            "submission_start": data.get("submission_start"),
            "submission_end": data.get("submission_end"),
            "max_score": data.get("max_score")
        }
        
        payload = {k: v for k, v in payload.items() if v is not None}
        
        if not payload:
            return jsonify({"error": "No fields to update"}), 400

        response = supabase.table("assignments") \
            .update(payload) \
            .eq("id", assignment_id) \
            .execute()

        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if hasattr(response, 'data') and response.data:
            return jsonify(response.data[0]), 200
        else:
            return jsonify({"error": "Failed to update assignment or not found"}), 404

    except Exception as e:
        logging.error(f"Error updating assignment {assignment_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/course-offerings/<int:offering_id>/students", methods=["GET", "OPTIONS"]) 
def get_students_for_offering(offering_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("course_enrollments").select("*, users(id, full_name, nim)") \
            .eq("course_offering_id", offering_id) \
            .execute()
        if hasattr(response, 'data'):
            students = [item['users'] for item in response.data if item.get('users')]
            return jsonify({"students": students})
        else:
            raise Exception("Failed to parse database response")
    except Exception as e:
        logging.error(f"Error fetching students for offering {offering_id}: {e}")
        return jsonify({"error": str(e)}), 500
        
@app.route("/api/course-offerings/<int:offering_id>/enrolled-students", methods=["GET", "OPTIONS"]) 
def get_enrolled_students(offering_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    try:
        response = supabase.table("course_enrollments") \
            .select("*, users(id, full_name, nim, email)") \
            .eq("course_offering_id", offering_id) \
            .execute()
        
        if hasattr(response, 'data'):
            enrolled_students = []
            for item in response.data:
                if item.get('users'):
                    student_data = item['users']
                    student_data['enrollment_id'] = item['id']
                    enrolled_students.append(student_data)
            return jsonify({"students": enrolled_students})
        else:
            raise Exception("Failed to parse database response")
    except Exception as e:
        logging.error(f"Error fetching enrolled students for offering {offering_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/enrollments", methods=["POST", "OPTIONS"])
def enroll_student():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    offering_id = data.get("offering_id")
    student_id = data.get("student_id")

    if not offering_id or not student_id:
        return jsonify({"error": "offering_id and student_id are required"}), 400

    try:
        response = supabase.table("course_enrollments").insert({
            "course_offering_id": offering_id,
            "student_id": student_id
        }).execute()

        if hasattr(response, 'error') and response.error:
            if "23505" in response.error.code:
                 return jsonify({"error": "Student is already enrolled in this course"}), 409
            raise Exception(response.error.message)
        
        if hasattr(response, 'data') and response.data:
            return jsonify({"message": "Student enrolled successfully", "enrollment": response.data[0]}), 201
        else:
            raise Exception("Enrollment failed, no data returned")

    except Exception as e:
        logging.error(f"Error enrolling student: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/enrollments/<int:enrollment_id>", methods=["DELETE", "OPTIONS"])
def unenroll_student(enrollment_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503

    try:
        response = supabase.table("course_enrollments").delete().eq("id", enrollment_id).execute()

        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        
        if not response.data:
             return jsonify({"error": "Enrollment record not found"}), 404

        return jsonify({"message": "Student unenrolled successfully"})
    except Exception as e:
        logging.error(f"Error unenrolling student: {e}")
        return jsonify({"error": str(e)}), 500
        
# --- Submission & Grading Endpoints ---

@app.route("/api/submissions", methods=["GET", "OPTIONS"]) 
def get_submissions():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    student = get_user_from_token()
    if not student:
        return jsonify({"error": "Authentication required"}), 401
    
    assignment_id = request.args.get("assignment_id")
    target_student_id = request.args.get("student_id") or student.id
    
    if target_student_id != student.id and student.user_metadata.get("role") != "admin":
         return jsonify({"error": "Forbidden"}), 403
    
    try:
        query = supabase.table("assignment_submissions") \
            .select("*") \
            .eq("student_id", target_student_id)
            
        if assignment_id:
            query = query.eq("assignment_id", int(assignment_id))
            
        response = query.execute()

        if hasattr(response, 'data'):
            return jsonify(response.data) 
        else:
            raise Exception("Failed to get submissions")
            
    except Exception as e:
        logging.error(f"Error getting submissions for student {target_student_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/assignments/<int:assignment_id>/submissions", methods=["GET", "OPTIONS"])
def get_all_submissions_for_assignment(assignment_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403
    
    try:
        response = supabase.table("assignment_submissions") \
            .select("*, users(id, full_name, nim)") \
            .eq("assignment_id", assignment_id) \
            .execute()

        if hasattr(response, 'data'):
            return jsonify({"submissions": response.data})
        else:
            raise Exception("Failed to get submissions")
            
    except Exception as e:
        logging.error(f"Error getting all submissions for assignment {assignment_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/submissions", methods=["POST", "OPTIONS"])
def create_or_update_submission():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    student = get_user_from_token()
    if not student:
        return jsonify({"error": "Authentication required"}), 401
        
    data = request.json
    try:
        payload = {
            "assignment_id": data.get("assignment_id"),
            "student_id": student.id,
            "submission_text": data.get("submission_text"),
            "submission_file_url": data.get("submission_file_url"),
            "submission_file_name": data.get("submission_file_name"),
            "submitted_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
        
        if not payload["assignment_id"]:
            return jsonify({"error": "assignment_id is required"}), 400
        
        existing = supabase.table("assignment_submissions") \
            .select("id") \
            .eq("assignment_id", payload["assignment_id"]) \
            .eq("student_id", student.id) \
            .limit(1) \
            .maybe_single() \
            .execute()
        
        if existing and existing.data:
            response = supabase.table("assignment_submissions") \
                .update(payload) \
                .eq("id", existing.data["id"]) \
                .execute()
        else:
            response = supabase.table("assignment_submissions") \
                .insert(payload) \
                .execute()

        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if hasattr(response, 'data') and response.data:
            return jsonify(response.data[0]), 200
        else:
            raise Exception("Failed to create or update submission")

    except Exception as e:
        logging.error(f"Error creating/updating submission for student {student.id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/submissions/<int:submission_id>/grade", methods=["PUT", "OPTIONS"])
def grade_submission(submission_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403
        
    data = request.json
    try:
        payload = {
            "score": data.get("score"),
            "feedback": data.get("feedback")
        }
        
        if payload["score"] is None:
            return jsonify({"error": "Score is required"}), 400

        response = supabase.table("assignment_submissions") \
            .update(payload) \
            .eq("id", submission_id) \
            .execute()

        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if hasattr(response, 'data') and response.data:
            return jsonify(response.data[0]), 200
        else:
            raise Exception("Failed to grade submission. Record not found.")

    except Exception as e:
        logging.error(f"Error grading submission {submission_id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/upload-submission", methods=["POST", "OPTIONS"])
def upload_submission_file():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    student = get_user_from_token()
    if not student:
        return jsonify({"error": "Authentication required"}), 401

    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    try:
        file_ext = os.path.splitext(file.filename)[1]
        file_path = f"{student.id}/{datetime.datetime.now().isoformat()}{file_ext}"
        
        file_bytes = file.read()
        
        supabase.storage.from_("submissions").upload(
            file=file_bytes,
            path=file_path,
            file_options={"content-type": file.mimetype}
        )
        
        public_url = supabase.storage.from_("submissions").get_public_url(file_path) 

        return jsonify({
            "message": "File uploaded successfully",
            "file_url": public_url,
            "file_name": file.filename
        }), 201
            
    except Exception as e:
        logging.error(f"Error uploading submission file for student {student.id}: {e}")
        error_message = str(e)
        if 'Duplicate' in error_message: 
             error_message = "A file with this name already exists."
        return jsonify({"error": error_message}), 500

@app.route("/api/upload-module-file", methods=["POST", "OPTIONS"])
def upload_module_file():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403

    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    try:
        file_path = f"module_files/{admin_user.id}/{datetime.datetime.now().isoformat()}_{file.filename}"
        
        file_bytes = file.read()
        
        supabase.storage.from_("submissions").upload(
            file=file_bytes,
            path=file_path,
            file_options={"content-type": file.mimetype}
        )
        
        public_url = supabase.storage.from_("submissions").get_public_url(file_path) 

        return jsonify({
            "message": "File uploaded successfully",
            "file_url": public_url,
            "file_name": file.filename,
            "file_size": len(file_bytes)
        }), 201
            
    except Exception as e:
        logging.error(f"Error uploading module file for admin {admin_user.id}: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/schedules", methods=["POST", "OPTIONS"])
def create_practikum_schedule():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
    
    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    data = request.json
    module_id = data.get("module_id")
    student_ids = data.get("student_ids") # List of UUIDs
    start_time = data.get("start_time")
    end_time = data.get("end_time")
    limits = data.get("limits", {})
    if not all([module_id, student_ids, start_time, end_time]):
        return jsonify({"error": "module_id, student_ids, start_time, and end_time are required"}), 400
    try:
        schedules_to_insert = [
            {
                "module_id": module_id,
                "student_id": student_id,
                "start_time": start_time,
                "end_time": end_time,
                "cpu_limit": limits.get("cpu", "1"),
                "memory_limit": limits.get("memory", "1g"),
                "storage_limit": limits.get("storage", "2g"),
                "status": "PENDING"
            }
            for student_id in student_ids
        ]
        response = supabase.table("practikum_schedules").insert(schedules_to_insert).execute()
        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        return jsonify({"message": f"Successfully scheduled {len(response.data)} sessions"}), 201
    except Exception as e:
        logging.error(f"Error creating schedules: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/schedules", methods=["GET", "OPTIONS"]) 
def get_schedules():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503

    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403

    try:
        active_period_id = get_active_period_id()
        if not active_period_id:
            return jsonify({"schedules": []})

        response = supabase.table("practikum_schedules") \
            .select("""
                id,
                start_time,
                end_time,
                status,
                cpu_limit,
                memory_limit,
                storage_limit,
                users ( id, full_name, nim ),
                modules ( module_title, courses ( course_code, course_name ) )
            """) \
            .execute()

        if hasattr(response, 'data'):
            return jsonify({"schedules": response.data})
        else:
            raise Exception("Failed to get schedules")

    except Exception as e:
        logging.error(f"Error getting schedules: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/schedules/<int:schedule_id>", methods=["PUT", "OPTIONS"])
def update_schedule(schedule_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503

    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403

    data = request.json
    try:
        payload = {
            "start_time": data.get("start_time"),
            "end_time": data.get("end_time"),
            "cpu_limit": data.get("cpu_limit"),
            "memory_limit": data.get("memory_limit"),
            "storage_limit": data.get("storage_limit"),
        }
        payload = {k: v for k, v in payload.items() if v is not None}

        if not payload:
            return jsonify({"error": "No fields to update"}), 400

        response = supabase.table("practikum_schedules") \
            .update(payload) \
            .eq("id", schedule_id) \
            .execute()

        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        if hasattr(response, 'data') and response.data:
            return jsonify(response.data[0]), 200
        else:
            return jsonify({"error": "Failed to update schedule or not found"}), 404

    except Exception as e:
        logging.error(f"Error updating schedule {schedule_id}: {e}")
        return jsonify({"error": str(e)}), 500

# --- FIX: Bug "Orphaned Container" ---
@app.route("/api/schedules/<int:schedule_id>", methods=["DELETE", "OPTIONS"])
def delete_schedule(schedule_id):
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403
    
    try:
        # 1. Get schedule details BEFORE deleting
        schedule_res = supabase.table("practikum_schedules") \
            .select("student_id, users(nim)") \
            .eq("id", schedule_id) \
            .single() \
            .execute()
            
        if not schedule_res.data:
            return jsonify({"error": "Schedule record not found"}), 404
        
        # 2. Stop the container
        if schedule_res.data.get("users") and schedule_res.data["users"].get("nim"):
            group_key = schedule_res.data["users"]["nim"]
            logging.info(f"Admin deleting schedule. Stopping container for group: {group_key}")
            try:
                requests.post(f"{ORCHESTRATOR_URL}/stop", json={"group": group_key}, timeout=10)
            except Exception as e:
                logging.warning(f"Failed to stop container for {group_key}. It may need manual deletion. Error: {e}")
        else:
            logging.warning(f"Could not stop container for schedule {schedule_id}: student NIM not found.")

        # 3. Delete the schedule from database
        response = supabase.table("practikum_schedules").delete().eq("id", schedule_id).execute()

        if hasattr(response, 'error') and response.error:
            raise Exception(response.error.message)
        
        return jsonify({"message": "Schedule deleted and container stopped"})
        
    except Exception as e:
        logging.error(f"Error deleting schedule: {e}")
        return jsonify({"error": str(e)}), 500
# --- END FIX ---
           
# == Secure Lab Session Endpoints ==
@app.route("/api/labs/start", methods=["POST", "OPTIONS"])
def start_lab_session():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    student = get_user_from_token()
    if not student:
        return jsonify({"success": False, "message": "Authentication required."}), 401

    # Rate limiter: cegah spam klik tombol start
    if not check_rate_limit(student.id):
        return jsonify({
            "success": False,
            "message": f"Terlalu banyak permintaan. Tunggu {LABS_RATE_LIMIT_SECONDS} detik sebelum mencoba lagi."
        }), 429

    data = request.json
    module_id = data.get("module_id")
    if not module_id:
        return jsonify({"success": False, "message": "Module ID is required."}), 400

    logging.info(f"Student {student.id} attempting to start lab for module {module_id}")
    now = datetime.datetime.now(datetime.timezone.utc)
    
    try:
        supabase = get_supabase_client()
        if not supabase:
            logging.error("start_lab_session: Supabase client is not available.")
            return jsonify({"success": False, "message": "Database connection error."}), 500
            
        # 1. HAPPY PATH: Check for an ACTIVE session that hasn't ended.
        active_schedule_res = supabase.table("practikum_schedules") \
            .select("notebook_url, token, end_time") \
            .eq("student_id", student.id) \
            .eq("module_id", module_id) \
            .eq("status", "ACTIVE") \
            .gte("end_time", now.isoformat()) \
            .limit(1) \
            .maybe_single() \
            .execute()

        if active_schedule_res and active_schedule_res.data:
            logging.info(f"Access granted for student {student.id}. Session is ACTIVE.")
            schedule = active_schedule_res.data
            
            group_key = student.user_metadata.get("nim", student.id)
            SESSIONS[group_key] = {
                "active": True,
                "expires_at": schedule['end_time'],
                "notebook_url": schedule['notebook_url'],
            }
            return jsonify({
                "success": True,
                "message": "Session ready.",
                "session": SESSIONS[group_key]
            })

        # 2. PENDING CHECK: No active session found. Check for a PENDING one.
        pending_schedule_res = supabase.table("practikum_schedules") \
            .select("id, start_time") \
            .eq("student_id", student.id) \
            .eq("module_id", module_id) \
            .eq("status", "PENDING") \
            .gte("end_time", now.isoformat()) \
            .limit(1) \
            .maybe_single() \
            .execute()

        if pending_schedule_res and pending_schedule_res.data:
            schedule = pending_schedule_res.data
            start_time_str = schedule['start_time']
            start_time = datetime.datetime.fromisoformat(start_time_str)
            if start_time.tzinfo is None:
                start_time = start_time.replace(tzinfo=datetime.timezone.utc)

            pre_warm_window_start = start_time - datetime.timedelta(minutes=5)

            if now >= pre_warm_window_start:
                logging.warning(f"Access for {student.id} in pre-warm window, but status is still PENDING.")
                return jsonify({
                    "success": False,
                    "message": "Your lab is still being prepared. Please try again in a moment."
                }), 425 
            else:
                logging.warning(f"Access denied for {student.id}. Lab starts at {start_time_str}.")
                return jsonify({
                    "success": False,
                    "message": f"Access denied: Your lab session is scheduled to start at {start_time.strftime('%H:%M %Z on %d-%b-%Y')}. Please return closer to the start time."
                }), 403

        # 3. NO SESSION: No active or valid pending session found.
        logging.warning(f"Access denied for {student.id}, module {module_id}. No active or pending schedule found.")
        return jsonify({
            "success": False,
            "message": "Access denied: You are not scheduled for this lab at this time, or your session has expired."
        }), 403

    except Exception as e:
        logging.error(f"Error in start_lab_session for {student.id}: {e}", exc_info=True)
        return jsonify({"success": False, "message": "An internal server error occurred."}), 500


@app.route("/api/sessions/stop", methods=["POST", "OPTIONS"])
def stop_session():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
        
    student = get_user_from_token()
    if not student:
        return jsonify({"success": False, "message": "Authentication required."}), 401

    group_key = student.user_metadata.get("nim", student.id)
    logging.info(f"Request received to stop session for user {group_key}.")

    orch_status = {}
    try:
        orch_res = requests.post(
            f"{ORCHESTRATOR_URL}/stop",
            json={"group": group_key},
            timeout=10
        )
        orch_res.raise_for_status()
        orch_status = orch_res.json()
        
        supabase = get_supabase_client()
        if supabase:
            supabase.table("practikum_schedules").update({"status": "COMPLETED"}) \
                .eq("student_id", student.id) \
                .eq("status", "ACTIVE") \
                .execute()
    except requests.exceptions.RequestException as e:
        logging.error(f"Error calling orchestrator stop for group {group_key}: {e}")
        orch_status = {"error": str(e)}
    
    if group_key in SESSIONS:
         del SESSIONS[group_key]
         logging.info(f"Removed session state from memory for group {group_key}.")

    return jsonify({"success": True, "message": f"Stop request processed for group {group_key}.", "orchestrator": orch_status})

@app.route("/api/sessions/status", methods=["GET", "OPTIONS"]) 
def status_session():
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200
        
    student = get_user_from_token()
    if not student:
        return jsonify({"active": False, "error": "Authentication required"}), 401
    
    group_key = student.user_metadata.get("nim", student.id)
    logging.info(f"Checking session status for group {group_key}.")
    session_info = SESSIONS.get(group_key)

    if session_info and session_info.get("active"):
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        expires_at_str = session_info["expires_at"]
        
        expires_at = datetime.datetime.fromisoformat(expires_at_str)
        if expires_at.tzinfo is None:
             expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
        
        if now_utc > expires_at:
            logging.warning(f"Session for group {group_key} found in memory but has expired.")
            session_info["active"] = False
            if group_key in SESSIONS: del SESSIONS[group_key]
            return jsonify({"active": False, "message": "Session expired"})
        else:
            return jsonify(session_info)
    else:
        now = datetime.datetime.now(datetime.timezone.utc)
        try:
            supabase = get_supabase_client()
            if not supabase: raise Exception("Supabase client not available")
            
            schedule_response = supabase.table("practikum_schedules") \
                .select("*") \
                .eq("student_id", student.id) \
                .eq("status", "ACTIVE") \
                .lte("start_time", now.isoformat()) \
                .gte("end_time", now.isoformat()) \
                .limit(1) \
                .maybe_single() \
                .execute()
            
            if schedule_response.data:
                logging.info(f"Found active DB schedule for {group_key}, but not in cache.")
                return jsonify({"active": False, "message": "Session not in cache."})

        except Exception as e:
            logging.error(f"Error checking DB for active session status: {e}")

        return jsonify({"active": False})

# == Deprecated Endpoints ==
@app.route("/api/sessions/start", methods=["POST", "OPTIONS"]) 
def start_session():
    logging.warning("DEPRECATED: /api/sessions/start was called. Use /api/labs/start instead.")
    return jsonify({"success": False, "message": "This endpoint is deprecated. Please use /api/labs/start."}), 404

# == Prometheus Metrics Endpoint ==
@app.route("/metrics", methods=["GET", "OPTIONS"]) 
def metrics_route():
    return generate_latest(), 200, {"Content-Type": CONTENT_TYPE_LATEST}

# --- Monitoring Endpoints ---

@app.route("/api/monitoring/query", methods=["GET", "OPTIONS"])
def proxy_prometheus_query():
    """Proxy untuk kueri instan Prometheus (/api/v1/query)."""
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403

    query = request.args.get("query")
    if not query:
        return jsonify({"error": "Query parameter is required"}), 400

    try:
        prom_response = requests.get(
            f"http://prometheus:9090/api/v1/query",
            params={"query": query},
            timeout=10
        )
        prom_response.raise_for_status()
        return jsonify(prom_response.json())

    except requests.exceptions.RequestException as e:
        logging.error(f"Error proxying Prometheus request: {e}")
        return jsonify({"error": f"Failed to connect to Prometheus: {e}"}), 502
    except Exception as e:
        logging.error(f"Error processing Prometheus data: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/monitoring/query_range", methods=["GET", "OPTIONS"])
def proxy_prometheus_query_range():
    """Proxy untuk kueri rentang waktu Prometheus (/api/v1/query_range)."""
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    admin_user = get_user_from_token()
    if not admin_user or admin_user.user_metadata.get('role') != 'admin':
        return jsonify({"error": "Admin access required"}), 403

    params = {
        "query": request.args.get("query"),
        "start": request.args.get("start"),
        "end": request.args.get("end"),
        "step": request.args.get("step"),
    }
    
    if not all(params.values()):
        return jsonify({"error": "Parameters 'query', 'start', 'end', and 'step' are required"}), 400

    try:
        prom_response = requests.get(
            f"http://prometheus:9090/api/v1/query_range",
            params=params,
            timeout=15 
        )
        prom_response.raise_for_status()
        return jsonify(prom_response.json())

    except requests.exceptions.RequestException as e:
        logging.error(f"Error proxying Prometheus range request: {e}")
        return jsonify({"error": f"Failed to connect to Prometheus: {e}"}), 502
    except Exception as e:
        logging.error(f"Error processing Prometheus range data: {e}")
        return jsonify({"error": str(e)}), 500

# --- Student Dashboard Deadlines Endpoint ---
@app.route("/api/my-deadlines", methods=["GET", "OPTIONS"])
def get_my_deadlines():
    """Gets all upcoming assignment deadlines for a student."""
    if request.method == 'OPTIONS':
        return jsonify({"message": "CORS preflight OK"}), 200

    supabase = get_supabase_client()
    if not supabase: return jsonify({"error": "Database connection not available"}), 503
    
    student = get_user_from_token()
    if not student:
        return jsonify({"error": "Authentication required."}), 401
    
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    
    try:
        # 1. Get all courses the student is enrolled in
        enrollment_res = supabase.table("course_enrollments") \
            .select("course_offerings(courses(id, course_name)))") \
            .eq("student_id", student.id) \
            .execute()
            
        if not enrollment_res.data:
            return jsonify({"deadlines": []})

        course_ids = [
            item['course_offerings']['courses']['id']
            for item in enrollment_res.data
            if item.get('course_offerings') and item['course_offerings'].get('courses')
        ]
        
        if not course_ids:
            return jsonify({"deadlines": []})

        # 2. Get all assignments for those courses that are not yet ended
        assignments_res = supabase.table("assignments") \
            .select("title, submission_end, courses(course_name)") \
            .in_("course_id", course_ids) \
            .gte("submission_end", now) \
            .order("submission_end", desc=False) \
            .limit(10) \
            .execute()

        if not assignments_res.data:
            return jsonify({"deadlines": []})
            
        # 3. Format the data
        deadlines = [
            {
                "course_title": a['courses']['course_name'] if a.get('courses') else 'Unknown Course',
                "assignment_title": a['title'],
                "due_date": a['submission_end']
            }
            for a in assignments_res.data
        ]
            
        return jsonify({"deadlines": deadlines})
        
    except Exception as e:
        logging.error(f"Error fetching 'my-deadlines' for student {student.id}: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

# --- Run Flask App ---
if __name__ == "__main__":
    host = os.environ.get("FLASK_RUN_HOST", "0.0.0.0")
    port = int(os.environ.get("FLASK_RUN_PORT", 5001))
    debug_mode = os.environ.get("FLASK_DEBUG", "True").lower() == "true"

    if not get_supabase_client():
         logging.warning("Starting Flask app WITHOUT Supabase connection (check env vars).")
    else:
         logging.info("Starting Flask app WITH Supabase connection.")
         if not debug_mode or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
            logging.info("Starting background scheduler...")
            scheduler = BackgroundScheduler(daemon=True)
            scheduler.add_job(check_schedules, 'interval', seconds=30) 
            scheduler.start()
            logging.info("Background scheduler started.")

    app.run(host=host, port=port, debug=debug_mode)