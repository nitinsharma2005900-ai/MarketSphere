FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml main.py ./
RUN pip install --no-cache-dir .
EXPOSE 8040
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8040"]
