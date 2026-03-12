FROM python:3.12-slim

WORKDIR /app

# 安裝依賴
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 複製應用程式碼
COPY . .

# 環境變數（可在部署時覆蓋）
ENV PORT=8000
ENV RUNNINGHUB_API_KEY=""
ENV RUNNINGHUB_BASE_URL="https://www.runninghub.cn"

EXPOSE 8000

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
