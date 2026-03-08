FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# notebooklm-py needs playwright
RUN pip install playwright && python -m playwright install --with-deps chromium

COPY src/ src/
COPY scripts/ scripts/

EXPOSE 8090
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8090"]
