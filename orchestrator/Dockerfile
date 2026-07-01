FROM python:3.10-slim

WORKDIR /app

# Build tools diperlukan agar gevent bisa di-compile di ARM (aarch64),
# di mana wheel siap-pakai tidak selalu tersedia. Di x86 wheel dipakai
# langsung sehingga tools ini tidak memperlambat build secara berarti.
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc build-essential libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

CMD ["python", "app.py"]

