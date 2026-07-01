"""
Predictive Scaler (FB Prophet) — Fase 5 (inti klaim "predictive").

Meramal beban lab mendatang dari histori metrik (Prometheus `lms_container_total`),
lalu PRE-SCALE kapasitas node dengan mengatur jumlah 'placeholder pod' berprioritas
rendah. Cluster Autoscaler melihat placeholder tsb dan menyediakan node LEBIH DULU
(pre-warm) sebelum lonjakan nyata. Saat mahasiswa Launch Lab (prioritas normal),
placeholder diusir dan lab langsung jalan di node yang sudah hangat.

Alur: histori -> Prophet forecast -> jumlah node -> jumlah placeholder -> CA pre-warm.
"""
import os, time, math, logging, datetime
import requests
import pandas as pd
from prophet import Prophet
from kubernetes import client, config

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# --- Konfigurasi (bisa diatur via env) ---
PROM_URL = os.environ.get("PROMETHEUS_URL", "http://prometheus:9090")
NAMESPACE = os.environ.get("NAMESPACE", "lms-praktikum")
PLACEHOLDER_DEPLOY = os.environ.get("PLACEHOLDER_DEPLOYMENT", "capacity-placeholder")
LABS_PER_NODE = int(os.environ.get("LABS_PER_NODE", "10"))        # perkiraan lab per node
FORECAST_MINUTES = int(os.environ.get("FORECAST_MINUTES", "30"))  # ramal berapa menit ke depan
INTERVAL_SECONDS = int(os.environ.get("INTERVAL_SECONDS", "300")) # jeda antar siklus
MAX_PLACEHOLDER = int(os.environ.get("MAX_PLACEHOLDER", "2"))      # batas pre-warm (kendali biaya)
HISTORY_DAYS = int(os.environ.get("HISTORY_DAYS", "3"))
METRIC = os.environ.get("METRIC_QUERY", "lms_container_total")

try:
    config.load_incluster_config()
except Exception:
    config.load_kube_config()
apps = client.AppsV1Api()


def fetch_history():
    """Ambil deret waktu metrik dari Prometheus (range query)."""
    end = datetime.datetime.utcnow()
    start = end - datetime.timedelta(days=HISTORY_DAYS)
    try:
        r = requests.get(f"{PROM_URL}/api/v1/query_range", params={
            "query": METRIC, "start": start.timestamp(),
            "end": end.timestamp(), "step": 600}, timeout=15)
        result = r.json()["data"]["result"]
        if not result:
            return None
        vals = result[0]["values"]  # [[ts, "val"], ...]
        df = pd.DataFrame(vals, columns=["ds", "y"])
        df["ds"] = pd.to_datetime(df["ds"].astype(float), unit="s")
        df["y"] = df["y"].astype(float)
        return df
    except Exception as e:
        logging.warning(f"Gagal ambil histori Prometheus: {e}")
        return None


def synthetic_history():
    """Fallback pola harian sintetis untuk DEMO saat histori nyata masih tipis.
    Beban tinggi jam praktikum (08-12 & 13-17), rendah di luar itu."""
    now = datetime.datetime.utcnow()
    rows = []
    for d in range(HISTORY_DAYS * 24 * 6):  # tiap 10 menit
        t = now - datetime.timedelta(minutes=10 * d)
        h = t.hour
        rows.append({"ds": t, "y": 8 if (8 <= h < 12 or 13 <= h < 17) else 1})
    return pd.DataFrame(rows)


def forecast_peak(df):
    """Fit Prophet & ramal puncak beban FORECAST_MINUTES ke depan."""
    m = Prophet(daily_seasonality=True, weekly_seasonality=False, yearly_seasonality=False)
    m.fit(df[["ds", "y"]])
    periods = max(1, FORECAST_MINUTES // 10)
    future = m.make_future_dataframe(periods=periods, freq="10min")
    fc = m.predict(future)
    return max(0.0, float(fc.tail(periods)["yhat"].max()))


def desired_placeholders(peak_labs):
    """Konversi ramalan jumlah lab -> jumlah node -> jumlah placeholder pod."""
    nodes = math.ceil(peak_labs / LABS_PER_NODE)
    ph = max(0, min(MAX_PLACEHOLDER, nodes - 1))  # 1 node baseline sudah ada
    return ph, nodes


def set_placeholder(replicas):
    apps.patch_namespaced_deployment_scale(
        PLACEHOLDER_DEPLOY, NAMESPACE, {"spec": {"replicas": replicas}})


def loop():
    logging.info("Predictive Scaler (Prophet) mulai. Interval=%ss", INTERVAL_SECONDS)
    while True:
        df = fetch_history()
        source = "Prometheus"
        if df is None or len(df) < 20:
            df, source = synthetic_history(), "sintetis(demo)"
        try:
            peak = forecast_peak(df)
            ph, nodes = desired_placeholders(peak)
            logging.info("[%s] ramalan puncak lab=%.1f -> butuh %d node -> placeholder=%d",
                         source, peak, nodes, ph)
            set_placeholder(ph)
        except Exception as e:
            logging.error("Gagal forecast/scale: %s", e)
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    loop()
