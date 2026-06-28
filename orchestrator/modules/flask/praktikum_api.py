# praktikum_api.py
from flask import Flask, jsonify, request

app = Flask(__name__)

# Contoh dataset dummy
students = [
    {"id": 1, "name": "Agung", "score": 85},
    {"id": 2, "name": "Daffa", "score": 90},
    {"id": 3, "name": "Rizky", "score": 78}
]

@app.route("/")
def home():
    return "<h2>👋 Praktikum Flask API berjalan!</h2><p>Gunakan endpoint /api/scores</p>"

@app.route("/api/scores", methods=["GET"])
def get_scores():
    return jsonify(students)

@app.route("/api/scores", methods=["POST"])
def add_score():
    data = request.get_json()
    if not data or "name" not in data or "score" not in data:
        return jsonify({"error": "Invalid input"}), 400

    new_id = max(s["id"] for s in students) + 1
    students.append({"id": new_id, "name": data["name"], "score": data["score"]})
    return jsonify({"success": True, "data": students}), 201

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
