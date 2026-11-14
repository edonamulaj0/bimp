FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --system --no-create-home app
COPY service.py .
USER app
EXPOSE 8080
# Each parse runs in a limited child process, one at a time per instance (see service.py).
CMD ["uvicorn", "service:app", "--host", "0.0.0.0", "--port", "8080", "--limit-concurrency", "4"]
