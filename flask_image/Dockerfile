FROM python:3.10-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all Flask modules
COPY *.py /app/

ENV PORT=5000
EXPOSE 5000

CMD ["sh", "-c", "python ${FLASK_APP_FILE:-praktikum_api.py}"]
