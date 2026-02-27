"""
单独测试 Kokoro 和 Chatterbox（通过 HuggingFace Space）
"""

import time
import os
import subprocess
import json
import struct

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
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', filepath],
            capture_output=True, text=True, timeout=5
        )
        info = json.loads(result.stdout)
        return float(info['format']['duration'])
    except Exception:
        # Try WAV header
        try:
            with open(filepath, 'rb') as f:
                header = f.read(44)
                if len(header) >= 44:
                    sample_rate = struct.unpack('<I', header[24:28])[0]
                    byte_rate = struct.unpack('<I', header[28:32])[0]
                    file_size = os.path.getsize(filepath)
                    if byte_rate > 0:
                        return (file_size - 44) / byte_rate
        except Exception:
            pass
        return 0


def test_kokoro():
    from gradio_client import Client

    print("[Kokoro] 连接 HuggingFace Space...")
    client = Client("hexgrad/Kokoro-TTS", verbose=False)
    print("[Kokoro] 已连接!")

    # 先查看 API 信息
    try:
        info = client.view_api(print_info=False, return_format="dict")
        print(f"[Kokoro] 可用端点: {[ep.get('api_name', ep.get('fn_index')) for ep in info.get('named_endpoints', {}).values()] if isinstance(info, dict) else 'unknown'}")
    except Exception:
        pass

    for case in TEST_CASES:
        output_file = os.path.join(OUTPUT_DIR, f"kokoro_{case['id']}.wav")
        voice = "zf_xiaobei" if case["lang"] == "zh" else "af_heart"

        start = time.time()
        try:
            result_audio = client.predict(
                text=case["text"],
                voice=voice,
                speed=1.0,
                api_name="/generate_speech"
            )
            end = time.time()

            if isinstance(result_audio, tuple):
                audio_path = result_audio[0]
            else:
                audio_path = result_audio

            if audio_path and os.path.exists(str(audio_path)):
                subprocess.run(['cp', str(audio_path), output_file], check=True)
                file_size = os.path.getsize(output_file)
                duration = get_audio_duration(output_file)
            else:
                print(f"  [Kokoro] {case['id']}: 返回结果异常 - {result_audio}")
                continue

            total = end - start
            r = {
                "engine": "Kokoro",
                "case": case["id"],
                "total_ms": round(total * 1000),
                "file_size_kb": round(file_size / 1024, 1),
                "audio_duration_s": round(duration, 1),
            }
            results.append(r)
            print(f"  [Kokoro] {case['id']}: Total={r['total_ms']}ms, Duration={r['audio_duration_s']}s, Size={r['file_size_kb']}KB")

        except Exception as e:
            print(f"  [Kokoro] {case['id']}: 失败 - {e}")
            # Try alternative API names
            try:
                print(f"  [Kokoro] 尝试备用 API...")
                result_audio = client.predict(
                    case["text"],
                    voice,
                    1.0,
                    fn_index=0
                )
                end = time.time()
                if isinstance(result_audio, tuple):
                    audio_path = result_audio[0]
                else:
                    audio_path = result_audio
                if audio_path and os.path.exists(str(audio_path)):
                    subprocess.run(['cp', str(audio_path), output_file], check=True)
                    file_size = os.path.getsize(output_file)
                    duration = get_audio_duration(output_file)
                    total = end - start
                    r = {
                        "engine": "Kokoro",
                        "case": case["id"],
                        "total_ms": round(total * 1000),
                        "file_size_kb": round(file_size / 1024, 1),
                        "audio_duration_s": round(duration, 1),
                    }
                    results.append(r)
                    print(f"  [Kokoro] {case['id']}: Total={r['total_ms']}ms, Duration={r['audio_duration_s']}s")
            except Exception as e2:
                print(f"  [Kokoro] {case['id']}: 备用也失败 - {e2}")


def test_chatterbox():
    from gradio_client import Client

    print("[Chatterbox] 连接 HuggingFace Space...")
    client = Client("ResembleAI/Chatterbox", verbose=False)
    print("[Chatterbox] 已连接!")

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

            if audio_path and os.path.exists(str(audio_path)):
                subprocess.run(['cp', str(audio_path), output_file], check=True)
                file_size = os.path.getsize(output_file)
                duration = get_audio_duration(output_file)
            else:
                print(f"  [Chatterbox] {case['id']}: 返回结果异常 - {result_audio}")
                continue

            total = end - start
            r = {
                "engine": "Chatterbox",
                "case": case["id"],
                "total_ms": round(total * 1000),
                "file_size_kb": round(file_size / 1024, 1),
                "audio_duration_s": round(duration, 1),
            }
            results.append(r)
            print(f"  [Chatterbox] {case['id']}: Total={r['total_ms']}ms, Duration={r['audio_duration_s']}s, Size={r['file_size_kb']}KB")

        except Exception as e:
            print(f"  [Chatterbox] {case['id']}: 失败 - {e}")


if __name__ == "__main__":
    print("=" * 60)
    print("HuggingFace Space TTS 测试")
    print("=" * 60)

    print("\n--- Kokoro TTS ---")
    try:
        test_kokoro()
    except Exception as e:
        print(f"Kokoro 整体失败: {e}")

    print("\n--- Chatterbox TTS ---")
    try:
        test_chatterbox()
    except Exception as e:
        print(f"Chatterbox 整体失败: {e}")

    # 汇总
    print("\n" + "=" * 60)
    print("HuggingFace Space 测试结果")
    print("=" * 60)
    for r in results:
        print(f"  {r['engine']:<15} {r['case']:<10} Total={r['total_ms']}ms  Duration={r['audio_duration_s']}s  Size={r['file_size_kb']}KB")

    # Append to existing results
    json_file = os.path.join(OUTPUT_DIR, "benchmark_results_hf.json")
    with open(json_file, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n结果已保存到: {json_file}")
