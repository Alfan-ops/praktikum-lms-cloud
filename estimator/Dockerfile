# Image estimator (FB Prophet). Prophet perlu compiler C/C++ untuk cmdstan di ARM.
FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc g++ build-essential python3-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Prophet build bisa lama di ARM (compile stan). Sabar saat build image ini.
RUN pip install --no-cache-dir -r requirements.txt

COPY predictive_scaler.py .

CMD ["python", "predictive_scaler.py"]
