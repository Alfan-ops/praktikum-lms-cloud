# praktikum_streamlit.py
# Modul Praktikum: Pembelajaran Mesin untuk Telekomunikasi (Streamlit)
# Dijalankan dengan: streamlit run /app/praktikum_streamlit.py
# Dependencies: streamlit, pandas, numpy, scikit-learn, matplotlib, joblib

import streamlit as st
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score, confusion_matrix
import joblib
import os
import io
import matplotlib.pyplot as plt

DATA_CSV = "telekom_dataset.csv"
MODEL_FILE = "telekom_model.joblib"

# ===== Helper fungsi =====
def generate_synthetic_dataset(path=DATA_CSV, n=2000, random_state=42):
    rng = np.random.RandomState(random_state)
    rssi = rng.normal(loc=-70, scale=8, size=n)
    snr = rng.normal(loc=20, scale=6, size=n)
    ber = np.clip(rng.lognormal(mean=-8, sigma=1.0, size=n), 1e-6, 0.1)
    throughput = np.clip(rng.normal(loc=5, scale=2, size=n), 0.1, 100)
    latency = np.clip(rng.normal(loc=50, scale=20, size=n), 1, 200)
    score = (snr * 0.4) + (throughput * 0.3) - (np.log10(ber + 1e-9) * 2) - (latency * 0.05) + (-rssi * 0.02)
    labels = np.digitize(score, bins=[20, 40])
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

def load_dataset():
    if not os.path.exists(DATA_CSV):
        return generate_synthetic_dataset()
    return pd.read_csv(DATA_CSV)

def train_model(df, n_estimators=100, max_depth=None, test_size=0.2, random_state=42):
    X = df[["rssi_dbm", "snr_db", "ber", "throughput_mbps", "latency_ms"]]
    y = df["quality"]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=random_state, stratify=y)
    clf = RandomForestClassifier(n_estimators=n_estimators, max_depth=max_depth, random_state=random_state)
    clf.fit(X_train, y_train)
    y_pred = clf.predict(X_test)
    acc = accuracy_score(y_test, y_pred)
    report = classification_report(y_test, y_pred, output_dict=True)
    cm = confusion_matrix(y_test, y_pred)
    joblib.dump(clf, MODEL_FILE)
    return {"clf": clf, "acc": acc, "report": report, "confusion_matrix": cm}

def predict_from_input(clf, features):
    X = [[features["rssi_dbm"], features["snr_db"], features["ber"], features["throughput_mbps"], features["latency_ms"]]]
    pred = clf.predict(X)[0]
    prob = None
    if hasattr(clf, "predict_proba"):
        prob = dict(zip(clf.classes_.tolist(), clf.predict_proba(X)[0].tolist()))
    return pred, prob

# ===== Streamlit UI =====
st.set_page_config(page_title="Praktikum ML Telekom", layout="wide")
st.title("Praktikum: Pembelajaran Mesin untuk Telekomunikasi")

with st.expander("Tujuan & Instruksi", expanded=True):
    st.markdown("""
    **Tujuan**
    - Memahami penerapan supervised learning untuk klasifikasi kualitas link.
    - Latih model Random Forest, analisis metrik.

    **Langkah singkat**
    1. Lihat dataset.
    2. Atur parameter training di sidebar.
    3. Klik *Train model*.
    4. Tinjau metrik, confusion matrix.
    5. Uji prediksi dengan input manual.
    """)

df = load_dataset()

col1, col2 = st.columns([3,2])

with col1:
    st.subheader("1) Dataset")
    st.write("Ukuran dataset:", df.shape)
    st.dataframe(df.head(50))
    csv = df.to_csv(index=False).encode('utf-8')
    st.download_button("Download dataset (CSV)", data=csv, file_name="telekom_dataset.csv", mime="text/csv")

    st.subheader("2) Eksplorasi singkat")
    st.write(df.describe())

    st.subheader("3) Visualisasi (sample)")
    fig, ax = plt.subplots(1,2, figsize=(8,3))
    df["quality"].value_counts().plot(kind="bar", ax=ax[0], title="Distribusi Kelas")
    ax[0].set_ylabel("count")
    ax[1].scatter(df["snr_db"], df["throughput_mbps"], s=8, alpha=0.6)
    ax[1].set_xlabel("SNR (dB)"); ax[1].set_ylabel("Throughput (Mbps)")
    st.pyplot(fig)

with col2:
    st.sidebar.header("Parameter Training")
    n_estimators = st.sidebar.number_input("n_estimators", min_value=10, max_value=1000, value=100, step=10)
    max_depth = st.sidebar.number_input("max_depth (None=0)", min_value=0, max_value=50, value=0, step=1)
    if max_depth == 0:
        max_depth = None
    test_size = st.sidebar.slider("test_size", 0.05, 0.5, 0.2, 0.05)
    random_state = st.sidebar.number_input("random_state", value=42, step=1)
    st.sidebar.markdown("---")
    st.sidebar.write("Model file:", MODEL_FILE if os.path.exists(MODEL_FILE) else "Belum ada")

    if st.sidebar.button("Train model"):
        with st.spinner("Training..."):
            result = train_model(df, n_estimators=n_estimators, max_depth=max_depth, test_size=test_size, random_state=random_state)
        st.success(f"Training selesai — Accuracy: {result['acc']:.4f}")
        st.json({"accuracy": result["acc"], "report": result["report"]})
        st.write("Confusion matrix:")
        st.write(result["confusion_matrix"])

    st.sidebar.markdown("---")
    st.sidebar.subheader("Prediksi manual")
    rssi_dbm = st.sidebar.number_input("rssi_dbm", value=-70.0, format="%.2f")
    snr_db = st.sidebar.number_input("snr_db", value=20.0, format="%.2f")
    ber = st.sidebar.number_input("ber", value=0.00001, format="%.8f", step=1e-6)
    throughput_mbps = st.sidebar.number_input("throughput_mbps", value=5.0, format="%.3f")
    latency_ms = st.sidebar.number_input("latency_ms", value=50.0, format="%.2f")

    if st.sidebar.button("Predict (local model)"):
        if not os.path.exists(MODEL_FILE):
            st.error("Model belum tersedia. Lakukan training terlebih dahulu.")
        else:
            clf = joblib.load(MODEL_FILE)
            features = {"rssi_dbm": rssi_dbm, "snr_db": snr_db, "ber": ber, "throughput_mbps": throughput_mbps, "latency_ms": latency_ms}
            pred, prob = predict_from_input(clf, features)
            st.sidebar.success(f"Prediksi: {pred}")
            if prob:
                st.sidebar.write("Probabilitas:", prob)

st.markdown("---")
st.markdown("**Catatan untuk asisten praktikum / instruktur**: file model disimpan di file `telekom_model.joblib` di direktori kerja container.")
