FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ghostscript qpdf tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-core && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir fastapi uvicorn python-multipart ocrmypdf
WORKDIR /app
COPY app.py .
EXPOSE 8080
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8080"]
