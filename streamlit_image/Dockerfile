FROM python:3.10-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy ALL streamlit modules
COPY *.py /app/

ENV PORT=8501
EXPOSE 8501

CMD ["sh", "-c", "streamlit run ${STREAMLIT_APP_FILE:-praktikum_streamlit.py} --server.port=8501 --server.address=0.0.0.0"]
