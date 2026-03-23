FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Parameters.xlsx must be present at build time OR mounted at runtime:
#   docker run -v /host/path/Parameters.xlsx:/app/Parameters.xlsx ...

CMD ["python", "worker.py"]