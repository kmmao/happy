"""探测 HuggingFace Space 的 API 端点"""
from gradio_client import Client

print("=== Kokoro TTS ===")
try:
    client = Client("hexgrad/Kokoro-TTS", verbose=False)
    client.view_api()
except Exception as e:
    print(f"失败: {e}")

print("\n=== Chatterbox ===")
try:
    client = Client("ResembleAI/Chatterbox", verbose=False)
    client.view_api()
except Exception as e:
    print(f"失败: {e}")
