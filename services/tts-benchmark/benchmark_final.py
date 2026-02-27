"""
TTS Benchmark 最终版
测试：Edge TTS / Chatterbox (HuggingFace) / Kokoro (HF Inference API) / macOS System TTS
"""

import asyncio
import time
import os
import subprocess
import json
import struct
import sys

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

TEST_CASES = [
    {"id": "zh_short", "text": "你好，我已连接到你的编码会话。你想让我告诉 Claude Code 什么？", "lang": "zh"},
    {"id": "en_short", "text": "Hey! I'm connected to your coding session. What would you like me to tell Claude Code?", "lang": "en"},
    {"id": "zh_long", "text": "我已经分析了你的代码库，发现了三个主要问题。第一个是认证模块存在安全漏洞，第二个是数据库查询效率较低，第三个是前端组件缺少错误处理。建议我们按优先级逐一修复。", "lang": "zh"},
    {"id": "en_long", "text": "I've analyzed your codebase and found three main issues. The first is a security vulnerability in the authentication module, the second is inefficient database queries, and the third is missing error handling in frontend components. I suggest we fix them one by one in order of priority.", "lang": "en"},
]

results = []


def get_audio_duration(filepath):
    """获取音频文件时长"""
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', filepath],
            capture_output=True, text=True, timeout=5
        )
        info = json.loads(result.stdout)
        return float(info['format']['duration'])
    except Exception:
        pass
    # WAV fallback
    try:
        with open(filepath, 'rb') as f:
            header = f.read(44)
            if len(header) >= 44:
                byte_rate = struct.unpack('<I', header[28:32])[0]
                file_size = os.path.getsize(filepath)
                if byte_rate > 0:
                    return (file_size - 44) / byte_rate
    except Exception:
        pass
    return 0


def add_result(engine, case_id, ttfb_ms, total_ms, filepath):
    file_size = os.path.getsize(filepath) if os.path.exists(filepath) else 0
    duration = get_audio_duration(filepath)
    r = {
        "engine": engine,
        "case": case_id,
        "ttfb_ms": ttfb_ms,
        "total_ms": total_ms,
        "file_size_kb": round(file_size / 1024, 1),
        "audio_duration_s": round(duration, 1),
        "file": filepath,
    }
    results.append(r)
    ttfb_str = f"TTFB={ttfb_ms}ms, " if isinstance(ttfb_ms, (int, float)) else ""
    print(f"  [{engine}] {case_id}: {ttfb_str}Total={total_ms}ms, Duration={r['audio_duration_s']}s, Size={r['file_size_kb']}KB")


# ============================================================
# 1. Edge TTS
# ============================================================
async def test_edge_tts():
    import edge_tts
    voice_map = {"zh": "zh-CN-XiaoxiaoNeural", "en": "en-US-JennyNeural"}

    for case in TEST_CASES:
        voice = voice_map[case["lang"]]
        output_file = os.path.join(OUTPUT_DIR, f"edge_{case['id']}.mp3")

        start = time.time()
        communicate = edge_tts.Communicate(case["text"], voice)
        first_chunk_time = None

        with open(output_file, "wb") as f:
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    if first_chunk_time is None:
                        first_chunk_time = time.time()
                    f.write(chunk["data"])

        end = time.time()
        ttfb = round((first_chunk_time - start) * 1000) if first_chunk_time else round((end - start) * 1000)
        total = round((end - start) * 1000)
        add_result("Edge TTS", case["id"], ttfb, total, output_file)


# ============================================================
# 2. Chatterbox (HuggingFace Space)
# ============================================================
def test_chatterbox():
    from gradio_client import Client

    print("  连接 HuggingFace Space...")
    client = Client("ResembleAI/Chatterbox", verbose=False)
    print("  已连接!")

    for case in TEST_CASES:
        output_file = os.path.join(OUTPUT_DIR, f"chatterbox_{case['id']}.wav")

        start = time.time()
        try:
            result_audio = client.predict(
                text_input=case["text"],
                exaggeration_input=0.5,
                temperature_input=0.8,
                seed_num_input=0,
                cfgw_input=0.5,
                vad_trim_input=False,
                api_name="/generate_tts_audio"
            )
            end = time.time()

            audio_path = result_audio[0] if isinstance(result_audio, tuple) else result_audio

            if audio_path and os.path.exists(str(audio_path)):
                subprocess.run(['cp', str(audio_path), output_file], check=True)
                add_result("Chatterbox", case["id"], "N/A", round((end - start) * 1000), output_file)
            else:
                print(f"  [Chatterbox] {case['id']}: 无音频返回")

        except Exception as e:
            print(f"  [Chatterbox] {case['id']}: 失败 - {e}")


# ============================================================
# 3. Kokoro (HuggingFace Inference API)
# ============================================================
async def test_kokoro_inference():
    """通过 HuggingFace Inference API 测试 Kokoro"""
    import aiohttp

    # 使用 HuggingFace 免费 Inference API
    url = "https://router.huggingface.co/hf-inference/models/hexgrad/Kokoro-82M"

    for case in TEST_CASES:
        output_file = os.path.join(OUTPUT_DIR, f"kokoro_{case['id']}.wav")

        start = time.time()
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json={"inputs": case["text"]},
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as resp:
                    if resp.status != 200:
                        error = await resp.text()
                        print(f"  [Kokoro API] {case['id']}: HTTP {resp.status} - {error[:150]}")
                        continue

                    audio_data = await resp.read()
                    end = time.time()

                    with open(output_file, "wb") as f:
                        f.write(audio_data)

                    # Check if we got actual audio
                    if len(audio_data) < 100:
                        print(f"  [Kokoro API] {case['id']}: 返回数据太小 ({len(audio_data)} bytes)")
                        continue

                    add_result("Kokoro", case["id"], "N/A", round((end - start) * 1000), output_file)

        except Exception as e:
            print(f"  [Kokoro API] {case['id']}: 失败 - {e}")


# ============================================================
# 4. macOS System TTS
# ============================================================
def test_system_tts():
    voice_map = {"zh": "Tingting", "en": "Samantha"}

    for case in TEST_CASES:
        voice = voice_map[case["lang"]]
        output_file = os.path.join(OUTPUT_DIR, f"system_{case['id']}.aiff")

        start = time.time()
        proc = subprocess.run(
            ['say', '-v', voice, '-o', output_file, case["text"]],
            capture_output=True, text=True, timeout=30
        )
        end = time.time()

        if proc.returncode != 0:
            print(f"  [System TTS] {case['id']}: 失败 - {proc.stderr}")
            continue

        add_result("macOS System", case["id"], "N/A", round((end - start) * 1000), output_file)


# ============================================================
# Main
# ============================================================
async def main():
    print("=" * 65)
    print("  TTS Benchmark - 延迟与质量对比测试")
    print("  测试文本：中英文各 2 句（短句 + 长句）")
    print("=" * 65)
    print(f"输出目录: {OUTPUT_DIR}\n")

    print("--- 1/4 Edge TTS（微软免费 API）---")
    await test_edge_tts()

    print("\n--- 2/4 Chatterbox（HuggingFace Space，可能较慢）---")
    test_chatterbox()

    print("\n--- 3/4 Kokoro（HuggingFace Inference API）---")
    await test_kokoro_inference()

    print("\n--- 4/4 macOS System TTS（基线）---")
    test_system_tts()

    # ========== 汇总 ==========
    print("\n" + "=" * 65)
    print("  汇总结果")
    print("=" * 65)

    # Group by case
    case_order = ["zh_short", "en_short", "zh_long", "en_long"]
    case_labels = {
        "zh_short": "中文短句",
        "en_short": "英文短句",
        "zh_long": "中文长句",
        "en_long": "英文长句",
    }

    for case_id in case_order:
        case_results = [r for r in results if r["case"] == case_id]
        if not case_results:
            continue
        print(f"\n  [{case_labels[case_id]}]")
        print(f"  {'Engine':<16} {'TTFB':>8} {'Total':>9} {'Audio':>7} {'Size':>8}")
        print(f"  {'-'*16} {'-'*8} {'-'*9} {'-'*7} {'-'*8}")
        for r in sorted(case_results, key=lambda x: x['total_ms'] if isinstance(x['total_ms'], (int, float)) else 99999):
            ttfb_s = f"{r['ttfb_ms']}ms" if isinstance(r['ttfb_ms'], (int, float)) else "N/A"
            print(f"  {r['engine']:<16} {ttfb_s:>8} {r['total_ms']:>6}ms {r['audio_duration_s']:>5}s {r['file_size_kb']:>6}KB")

    # Save
    json_file = os.path.join(OUTPUT_DIR, "benchmark_final.json")
    with open(json_file, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\n  结果 JSON: {json_file}")
    print(f"  音频目录: {OUTPUT_DIR}/")
    print(f"\n  请播放 output/ 下的音频文件对比质量！")
    print(f"  例如: open {OUTPUT_DIR}/edge_zh_short.mp3")


if __name__ == "__main__":
    asyncio.run(main())
