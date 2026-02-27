"""探测 HuggingFace Space API - verbose"""
from gradio_client import Client
import sys

spaces = [
    "hexgrad/Kokoro-TTS",
    "Remsky/Kokoro-TTS-Zero",
    "ResembleAI/Chatterbox",
    "mrfakename/Chatterbox-Demo",
]

for space in spaces:
    print(f"\n{'='*50}")
    print(f"探测: {space}")
    print(f"{'='*50}")
    try:
        client = Client(space, verbose=False)
        info = client.view_api(return_format="str")
        print(info if info else "(no info returned)")
    except Exception as e:
        print(f"失败: {e}")
    sys.stdout.flush()
