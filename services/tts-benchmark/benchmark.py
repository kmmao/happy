"""
TTS Benchmark: 对比 Edge TTS / Kokoro / Chatterbox / macOS 系统 TTS
测试指标：延迟（首字节时间 + 总生成时间）、文件大小、采样率
输出音频文件供人工质量对比
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

# 测试用例：中英文各一句，短句和长句
TEST_CASES = [
    {"id": "zh_short", "text": "你好，我已连接到你的编码会话。你想让我告诉 Claude Code 什么？", "lang": "zh"},
    {"id": "en_short", "text": "Hey! I'm connected to your coding session. What would you like me to tell Claude Code?", "lang": "en"},
    {"id": "zh_long", "text": "我已经分析了你的代码库，发现了三个主要问题。第一个是认证模块存在安全漏洞，第二个是数据库查询效率较低，第三个是前端组件缺少错误处理。建议我们按优先级逐一修复。", "lang": "zh"},
    {"id": "en_long", "text": "I've analyzed your codebase and found three main issues. The first is a security vulnerability in the authentication module, the second is inefficient database queries, and the third is missing error handling in frontend components. I suggest we fix them one by one in order of priority.", "lang": "en"},
]

results = []


def get_wav_duration(filepath):
    """从 WAV 文件头读取时长"""
    try:
        with open(filepath, 'rb') as f:
            header = f.read(44)
            if len(header) < 44:
                return 0
            # Read sample rate (bytes 24-27) and byte rate (bytes 28-31)
            sample_rate = struct.unpack('<I', header[24:28])[0]
            byte_rate = struct.unpack('<I', header[28:32])[0]
            file_size = os.path.getsize(filepath)
            if byte_rate > 0:
                return (file_size - 44) / byte_rate
    except Exception:
        pass
    return 0


def get_audio_duration(filepath):
    """尝试获取任意音频文件时长"""
    # 先试 WAV
    if filepath.endswith('.wav'):
        dur = get_wav_duration(filepath)
        if dur > 0:
            return dur
    # 用 ffprobe
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', filepath],
            capture_output=True, text=True, timeout=5
        )
        info = json.loads(result.stdout)
        return float(info['format']['duration'])
    except Exception:
        return 0


# ============================================================
# 1. Edge TTS
# ============================================================
async def test_edge_tts():
    """测试 Edge TTS"""
    try:
        import edge_tts
    except ImportError:
        print("[Edge TTS] 未安装，跳过")
        return

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
        ttfb = (first_chunk_time - start) if first_chunk_time else (end - start)
        total = end - start
        file_size = os.path.getsize(output_file)
        duration = get_audio_duration(output_file)

        result = {
            "engine": "Edge TTS",
            "case": case["id"],
            "ttfb_ms": round(ttfb * 1000),
            "total_ms": round(total * 1000),
            "file_size_kb": round(file_size / 1024, 1),
            "audio_duration_s": round(duration, 1),
            "file": output_file,
        }
        results.append(result)
        print(f"  [Edge TTS] {case['id']}: TTFB={result['ttfb_ms']}ms, Total={result['total_ms']}ms, Duration={result['audio_duration_s']}s")


# ============================================================
# 2. Kokoro TTS (via HuggingFace Space)
# ============================================================
async def test_kokoro():
    """测试 Kokoro TTS via HuggingFace Gradio API"""
    try:
        from gradio_client import Client
    except ImportError:
        print("[Kokoro] gradio_client 未安装，跳过")
        return

    print("  [Kokoro] 连接 HuggingFace Space...")
    try:
        client = Client("hexgrad/Kokoro-TTS", verbose=False)
    except Exception as e:
        print(f"  [Kokoro] 连接失败: {e}")
        return

    for case in TEST_CASES:
        output_file = os.path.join(OUTPUT_DIR, f"kokoro_{case['id']}.wav")

        start = time.time()
        try:
            # Kokoro API: text, voice (preset), speed
            voice = "zf_xiaobei" if case["lang"] == "zh" else "af_heart"
            result_audio = client.predict(
                text=case["text"],
                voice=voice,
                speed=1.0,
                api_name="/generate_speech"
            )
            end = time.time()

            # gradio_client returns the file path
            if isinstance(result_audio, tuple):
                audio_path = result_audio[0]
            else:
                audio_path = result_audio

            # Copy to our output
            if audio_path and os.path.exists(audio_path):
                subprocess.run(['cp', audio_path, output_file], check=True)
                file_size = os.path.getsize(output_file)
                duration = get_audio_duration(output_file)
            else:
                file_size = 0
                duration = 0

            total = end - start
            result = {
                "engine": "Kokoro",
                "case": case["id"],
                "ttfb_ms": "N/A (batch)",
                "total_ms": round(total * 1000),
                "file_size_kb": round(file_size / 1024, 1),
                "audio_duration_s": round(duration, 1),
                "file": output_file,
            }
            results.append(result)
            print(f"  [Kokoro] {case['id']}: Total={result['total_ms']}ms, Duration={result['audio_duration_s']}s")

        except Exception as e:
            print(f"  [Kokoro] {case['id']}: 失败 - {e}")


# ============================================================
# 3. Chatterbox TTS (via HuggingFace Space)
# ============================================================
async def test_chatterbox():
    """测试 Chatterbox TTS via HuggingFace Gradio API"""
    try:
        from gradio_client import Client
    except ImportError:
        print("[Chatterbox] gradio_client 未安装，跳过")
        return

    print("  [Chatterbox] 连接 HuggingFace Space...")
    try:
        client = Client("ResembleAI/Chatterbox", verbose=False)
    except Exception as e:
        print(f"  [Chatterbox] 连接失败: {e}")
        return

    for case in TEST_CASES:
        output_file = os.path.join(OUTPUT_DIR, f"chatterbox_{case['id']}.wav")

        start = time.time()
        try:
            result_audio = client.predict(
                text=case["text"],
                audio_prompt=None,
                exaggeration=0.5,
                pace=1.0,
                temperature=0.8,
                seed_num=0,
                cfg_weight=0.5,
                api_name="/generate"
            )
            end = time.time()

            if isinstance(result_audio, tuple):
                audio_path = result_audio[0]
            else:
                audio_path = result_audio

            if audio_path and os.path.exists(audio_path):
                subprocess.run(['cp', audio_path, output_file], check=True)
                file_size = os.path.getsize(output_file)
                duration = get_audio_duration(output_file)
            else:
                file_size = 0
                duration = 0

            total = end - start
            result = {
                "engine": "Chatterbox",
                "case": case["id"],
                "ttfb_ms": "N/A (batch)",
                "total_ms": round(total * 1000),
                "file_size_kb": round(file_size / 1024, 1),
                "audio_duration_s": round(duration, 1),
                "file": output_file,
            }
            results.append(result)
            print(f"  [Chatterbox] {case['id']}: Total={result['total_ms']}ms, Duration={result['audio_duration_s']}s")

        except Exception as e:
            print(f"  [Chatterbox] {case['id']}: 失败 - {e}")


# ============================================================
# 4. macOS 系统 TTS (say 命令)
# ============================================================
async def test_system_tts():
    """测试 macOS 系统 TTS"""
    import platform
    if platform.system() != "Darwin":
        print("[System TTS] 非 macOS，跳过")
        return

    voice_map = {"zh": "Tingting", "en": "Samantha"}

    for case in TEST_CASES:
        voice = voice_map[case["lang"]]
        output_file = os.path.join(OUTPUT_DIR, f"system_{case['id']}.aiff")

        start = time.time()
        try:
            proc = subprocess.run(
                ['say', '-v', voice, '-o', output_file, case["text"]],
                capture_output=True, text=True, timeout=30
            )
            end = time.time()

            if proc.returncode != 0:
                print(f"  [System TTS] {case['id']}: say 命令失败 - {proc.stderr}")
                continue

            file_size = os.path.getsize(output_file)
            duration = get_audio_duration(output_file)
            total = end - start

            result = {
                "engine": "macOS System",
                "case": case["id"],
                "ttfb_ms": "N/A (batch)",
                "total_ms": round(total * 1000),
                "file_size_kb": round(file_size / 1024, 1),
                "audio_duration_s": round(duration, 1),
                "file": output_file,
            }
            results.append(result)
            print(f"  [System TTS] {case['id']}: Total={result['total_ms']}ms, Duration={result['audio_duration_s']}s")

        except Exception as e:
            print(f"  [System TTS] {case['id']}: 失败 - {e}")


# ============================================================
# 5. ElevenLabs (当前方案，作为对照)
# ============================================================
async def test_elevenlabs():
    """测试 ElevenLabs TTS API 作为基准对照"""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        print("⚠️  ELEVENLABS_API_KEY not set, skipping ElevenLabs benchmark")
        return

    import aiohttp

    voice_id = "eXpIbVcVbLo8ZJQDlDnl"  # 当前 Agent 使用的 voice
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream"

    for case in TEST_CASES:
        output_file = os.path.join(OUTPUT_DIR, f"elevenlabs_{case['id']}.mp3")

        start = time.time()
        first_chunk_time = None

        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    headers={
                        "xi-api-key": api_key,
                        "Content-Type": "application/json",
                    },
                    json={
                        "text": case["text"],
                        "model_id": "eleven_turbo_v2_5",
                        "voice_settings": {
                            "stability": 0.5,
                            "similarity_boost": 0.8,
                        }
                    }
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        print(f"  [ElevenLabs] {case['id']}: API 错误 {resp.status} - {error_text[:100]}")
                        continue

                    with open(output_file, "wb") as f:
                        async for chunk in resp.content.iter_chunked(1024):
                            if first_chunk_time is None:
                                first_chunk_time = time.time()
                            f.write(chunk)

            end = time.time()
            ttfb = (first_chunk_time - start) if first_chunk_time else (end - start)
            total = end - start
            file_size = os.path.getsize(output_file)
            duration = get_audio_duration(output_file)

            result = {
                "engine": "ElevenLabs",
                "case": case["id"],
                "ttfb_ms": round(ttfb * 1000),
                "total_ms": round(total * 1000),
                "file_size_kb": round(file_size / 1024, 1),
                "audio_duration_s": round(duration, 1),
                "file": output_file,
            }
            results.append(result)
            print(f"  [ElevenLabs] {case['id']}: TTFB={result['ttfb_ms']}ms, Total={result['total_ms']}ms, Duration={result['audio_duration_s']}s")

        except Exception as e:
            print(f"  [ElevenLabs] {case['id']}: 失败 - {e}")


# ============================================================
# Main
# ============================================================
async def main():
    print("=" * 60)
    print("TTS Benchmark - 延迟与质量对比测试")
    print("=" * 60)
    print(f"输出目录: {OUTPUT_DIR}")
    print()

    engines = [
        ("ElevenLabs（基准对照）", test_elevenlabs),
        ("Edge TTS", test_edge_tts),
        ("Kokoro TTS", test_kokoro),
        ("Chatterbox TTS", test_chatterbox),
        ("macOS System TTS", test_system_tts),
    ]

    for name, test_fn in engines:
        print(f"\n--- {name} ---")
        try:
            await test_fn()
        except Exception as e:
            print(f"  错误: {e}")

    # 汇总
    print("\n" + "=" * 60)
    print("汇总结果")
    print("=" * 60)

    # Group by case
    cases = {}
    for r in results:
        case_id = r["case"]
        if case_id not in cases:
            cases[case_id] = []
        cases[case_id].append(r)

    for case_id, case_results in cases.items():
        print(f"\n[{case_id}]")
        print(f"  {'Engine':<18} {'TTFB':>10} {'Total':>10} {'Audio':>8} {'Size':>8}")
        print(f"  {'-'*18} {'-'*10} {'-'*10} {'-'*8} {'-'*8}")
        for r in sorted(case_results, key=lambda x: x['total_ms'] if isinstance(x['total_ms'], (int, float)) else 99999):
            ttfb_str = f"{r['ttfb_ms']}ms" if isinstance(r['ttfb_ms'], (int, float)) else r['ttfb_ms']
            print(f"  {r['engine']:<18} {ttfb_str:>10} {r['total_ms']}ms{' '*(7-len(str(r['total_ms'])))} {r['audio_duration_s']}s{' '*(5-len(str(r['audio_duration_s'])))} {r['file_size_kb']}KB")

    # Save JSON
    json_file = os.path.join(OUTPUT_DIR, "benchmark_results.json")
    with open(json_file, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n详细结果已保存到: {json_file}")
    print(f"音频文件已保存到: {OUTPUT_DIR}/")
    print("请听取各音频文件对比质量！")


if __name__ == "__main__":
    asyncio.run(main())
