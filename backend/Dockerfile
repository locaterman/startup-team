FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY backend /app/backend
COPY db /app/db
COPY contracts /app/contracts
ENV PYTHONPATH=/app/backend
CMD ["sh","-c","alembic -c /app/backend/alembic.ini upgrade head && python -m app.seed && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
