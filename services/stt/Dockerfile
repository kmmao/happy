FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    portaudio19-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY services/stt/requirements.txt /app/requirements.txt
# Install PyTorch CPU-only first to avoid pulling CUDA (~2GB savings)
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install -r /app/requirements.txt

# Pre-download Whisper models so they're baked into the image (no download on first run)
# Main model (for final transcription) — configurable via build arg
ARG STT_MODEL=small
ENV STT_MODEL_PRE=${STT_MODEL}
RUN python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['STT_MODEL_PRE'], compute_type='int8', device='cpu')"
# Realtime model (for interim transcription) — "small" for readable Chinese interim results
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('small', compute_type='int8', device='cpu')"

COPY services/stt/app.py /app/app.py
COPY services/stt/server.py /app/server.py
COPY services/stt/supervisord.conf /etc/supervisord.conf

EXPOSE 8000 8001

CMD ["supervisord", "-c", "/etc/supervisord.conf"]
