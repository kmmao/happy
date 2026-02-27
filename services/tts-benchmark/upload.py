"""上传 benchmark 音频文件到 MinIO，生成公开链接"""

import os
from minio import Minio

MINIO_HOST = "localhost:9000"
MINIO_ACCESS = "minioadmin"
MINIO_SECRET = "minioadmin"
BUCKET = "handy"
PREFIX = "public/tts-benchmark"

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# MIME 类型映射
MIME_MAP = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".aiff": "audio/aiff",
    ".flac": "audio/flac",
}

client = Minio(MINIO_HOST, access_key=MINIO_ACCESS, secret_key=MINIO_SECRET, secure=False)

# 确保 bucket 存在
if not client.bucket_exists(BUCKET):
    print(f"Bucket '{BUCKET}' 不存在!")
    exit(1)

print(f"上传音频文件到 MinIO ({MINIO_HOST}/{BUCKET}/{PREFIX}/)...\n")

audio_files = [f for f in os.listdir(OUTPUT_DIR) if any(f.endswith(ext) for ext in MIME_MAP)]
audio_files.sort()

urls = []

for filename in audio_files:
    filepath = os.path.join(OUTPUT_DIR, filename)
    ext = os.path.splitext(filename)[1]
    content_type = MIME_MAP.get(ext, "application/octet-stream")
    object_name = f"{PREFIX}/{filename}"

    client.fput_object(BUCKET, object_name, filepath, content_type=content_type)
    url = f"http://localhost:9000/{BUCKET}/{object_name}"
    urls.append({"file": filename, "url": url})
    print(f"  ✓ {filename} → {url}")

print(f"\n共上传 {len(urls)} 个文件\n")

# 按引擎分组显示
print("=" * 60)
print("音频对比链接（按引擎分组）")
print("=" * 60)

engines = {}
for item in urls:
    engine = item["file"].split("_")[0]
    if engine not in engines:
        engines[engine] = []
    engines[engine].append(item)

engine_labels = {
    "edge": "Edge TTS（微软免费 API）",
    "system": "macOS 系统 TTS（基线）",
    "chatterbox": "Chatterbox",
    "kokoro": "Kokoro",
    "elevenlabs": "ElevenLabs（对照）",
}

for engine, items in engines.items():
    label = engine_labels.get(engine, engine)
    print(f"\n{label}:")
    for item in items:
        print(f"  {item['url']}")
