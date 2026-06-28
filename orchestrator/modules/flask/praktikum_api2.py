# praktikum_api2.py
# Modul Praktikum: Pembelajaran Mesin untuk Telekomunikasi (Flask API)
# Dijalankan dengan: python /app/praktikum_api2.py
# Dependencies: flask, pandas, numpy, scikit-learn, joblib
# Untuk development: pip install flask pandas numpy scikit-learn joblib

from flask import Flask, request, jsonify, send_file, abort, render_template_string
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
import joblib
import os
import io

app = Flask(__name__)

# lokasi penyimpanan model & dataset (diremoon dalam container: /app)
DATA_CSV = "telekom_dataset.csv"
MODEL_FILE = "telekom_model.joblib"

# ===== Deskripsi modul (akan ditampilkan di halaman utama) =====
MODULE_INFO = {
    "title": "Praktikum: Pembelajaran Mesin untuk Telekomunikasi",
    "objective": [
        "Memahami penerapan supervised learning untuk mengklasifikasikan kualitas link telekomunikasi.",
        "Melatih dan mengevaluasi model klasifikasi (Random Forest).",
        "Mengeksplorasi pengaruh parameter model terhadap performa."
    ],
    "prerequisites": [
        "Python dasar (pandas, scikit-learn).",
        "Konsep supervised learning dan metrik evaluasi klasifikasi."
    ],
    "steps": [
        "1. Download dataset (endpoint /api/dataset).",
        "2. Eksplorasi dataset (statistik & visualisasi).",
        "3. Konfigurasi parameter training (n_estimators, max_depth, test_size).",
        "4. Jalankan training (POST ke /api/train) dan lihat metrik.",
        "5. Lakukan prediksi pada kasus baru (POST ke /api/predict)."
    ],
    "expected_results": [
        "Model klasifikasi terlatih (tersimpan sebagai joblib).",
        "Laporan akurasi, precision, recall, f1-score.",
        "Confusion matrix menunjukkan distribusi prediksi per kelas."
    ],
    "user_manual": [
        "Gunakan endpoint API atau buka halaman utama untuk instruksi.",
        "Untuk training otomatis: POST /api/train dengan JSON parameter.",
        "Untuk prediksi: POST /api/predict dengan features JSON."
    ]
}

# ===== Helper: buat dataset sintetis bila belum ada =====
def generate_synthetic_dataset(path=DATA_CSV, n=2000, random_state=42):
    """Buat dataset sintetis dengan fitur telekomunikasi dan target kualitas link."""
    rng = np.random.RandomState(random_state)
    # fitur
    rssi = rng.normal(loc=-70, scale=8, size=n)             # dBm
    snr = rng.normal(loc=20, scale=6, size=n)               # dB
    ber = np.clip(rng.lognormal(mean=-8, sigma=1.0, size=n), 1e-6, 0.1)  # bit error rate
    throughput = np.clip(rng.normal(loc=5, scale=2, size=n), 0.1, 100)   # Mbps
    latency = np.clip(rng.normal(loc=50, scale=20, size=n), 1, 200)      # ms

    # rule-based label: good / moderate / poor
    score = (snr * 0.4) + (throughput * 0.3) - (np.log10(ber + 1e-9) * 2) - (latency * 0.05) + ( -rssi * 0.02)
    labels = np.digitize(score, bins=[20, 40])  # 0,1,2
    label_map = {0: "poor", 1: "moderate", 2: "good"}
    quality = [label_map[int(x)] for x in labels]

    df = pd.DataFrame({
        "rssi_dbm": np.round(rssi, 2),
        "snr_db": np.round(snr, 2),
        "ber": np.round(ber, 8),
        "throughput_mbps": np.round(throughput, 3),
        "latency_ms": np.round(latency, 2),
        "quality": quality
    })
    df.to_csv(path, index=False)
    return df

# pastikan dataset ada
if not os.path.exists(DATA_CSV):
    generate_synthetic_dataset(DATA_CSV)

# ===== Routes =====

HOME_HTML = """
<!doctype html>
<title>{{title}}</title>
<h1>{{title}}</h1>
<h3>Tujuan</h3>
<ul>{% for o in objective %}<li>{{o}}</li>{% endfor %}</ul>
<h3>Langkah praktikum</h3>
<ol>{% for s in steps %}<li>{{s}}</li>{% endfor %}</ol>
<h3>Endpoint penting</h3>
<ul>
  <li><b>GET /api/dataset</b> — unduh dataset CSV</li>
  <li><b>POST /api/train</b> — latih model (lihat doc)</li>
  <li><b>POST /api/predict</b> — prediksi kualitas link</li>
  <li><b>GET /api/info</b> — info modul</li>
</ul>
<p><b>Contoh training (curl):</b></p>
<pre>
curl -X POST http://localhost:5000/api/train -H "Content-Type: application/json" -d '{"test_size":0.2,"n_estimators":100,"max_depth":6,"random_state":42}'
</pre>
<p><b>Contoh prediksi (curl):</b></p>
<pre>
curl -X POST http://localhost:5000/api/predict -H "Content-Type: application/json" -d '{"rssi_dbm":-65,"snr_db":25,"ber":0.00001,"throughput_mbps":10,"latency_ms":30}'
</pre>
"""

@app.route("/")
def home():
    return render_template_string(HOME_HTML,
                                  title=MODULE_INFO["title"],
                                  objective=MODULE_INFO["objective"],
                                  steps=MODULE_INFO["steps"])

@app.route("/api/info", methods=["GET"])
def api_info():
    return jsonify(MODULE_INFO)

@app.route("/api/dataset", methods=["GET"])
def api_dataset():
    if not os.path.exists(DATA_CSV):
        generate_synthetic_dataset(DATA_CSV)
    return send_file(DATA_CSV, as_attachment=True, download_name="telekom_dataset.csv")

@app.route("/api/train", methods=["POST"])
def api_train():
    """
    POST JSON parameters:
    {
      "test_size": 0.2,
      "n_estimators": 100,
      "max_depth": 6,
      "random_state": 42
    }
    Response: metrics, model path
    """
    params = request.get_json() or {}
    test_size = float(params.get("test_size", 0.2))
    n_estimators = int(params.get("n_estimators", 100))
    max_depth = params.get("max_depth")
    max_depth = int(max_depth) if max_depth is not None else None
    rs = int(params.get("random_state", 42))

    df = pd.read_csv(DATA_CSV)
    X = df[["rssi_dbm", "snr_db", "ber", "throughput_mbps", "latency_ms"]]
    y = df["quality"]

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=rs, stratify=y)

    clf = RandomForestClassifier(n_estimators=n_estimators, max_depth=max_depth, random_state=rs)
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    report = classification_report(y_test, y_pred, output_dict=True)
    cm = confusion_matrix(y_test, y_pred).tolist()

    # simpan model
    joblib.dump(clf, MODEL_FILE)

    return jsonify({
        "success": True,
        "model_file": MODEL_FILE,
        "accuracy": acc,
        "classification_report": report,
        "confusion_matrix": cm,
        "params": {"test_size": test_size, "n_estimators": n_estimators, "max_depth": max_depth}
    })

@app.route("/api/predict", methods=["POST"])
def api_predict():
    """
    POST JSON single sample:
    {
      "rssi_dbm": -65,
      "snr_db": 25,
      "ber": 0.00001,
      "throughput_mbps": 10,
      "latency_ms": 30
    }
    """
    features = request.get_json() or {}
    required = ["rssi_dbm", "snr_db", "ber", "throughput_mbps", "latency_ms"]
    if not all(k in features for k in required):
        return jsonify({"error": "Missing feature(s). Required: " + ",".join(required)}), 400

    if not os.path.exists(MODEL_FILE):
        return jsonify({"error": "Model belum dilatih. Jalankan /api/train terlebih dahulu."}), 400

    clf = joblib.load(MODEL_FILE)
    X = [[features["rssi_dbm"], features["snr_db"], features["ber"], features["throughput_mbps"], features["latency_ms"]]]
    pred = clf.predict(X)[0]
    prob = None
    if hasattr(clf, "predict_proba"):
        prob = dict(zip(clf.classes_.tolist(), clf.predict_proba(X)[0].tolist()))

    return jsonify({"prediction": pred, "probability": prob})

@app.route("/api/status", methods=["GET"])
def api_status():
    model_exists = os.path.exists(MODEL_FILE)
    return jsonify({
        "dataset_exists": os.path.exists(DATA_CSV),
        "model_exists": model_exists,
        "model_file": MODEL_FILE if model_exists else None
    })

# run
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
