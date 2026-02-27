"""修复 Chatterbox 测试 - 处理 audio_prompt 问题"""
import time
import os
import subprocess
import json
import struct

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

TEST_CASES = [
    {"id": "zh_short", "text": "你好，我已连接到你的编码会话。你想让我告诉 Claude Code 什么？", "lang": "zh"},
    {"id": "en_short", "text": "Hey! I'm connected to your coding session. What would you like me to tell Claude Code?", "lang": "en"},
    {"id": "zh_long", "text": "我已经分析了你的代码库，发现了三个主要问题。第一个是认证模块存在安全漏洞，第二个是数据库查询效率较低，第三个是前端组件缺少错误处理。建议我们按优先级逐一修复。", "lang": "zh"},
    {"id": "en_long", "text": "I've analyzed your codebase and found three main issues. The first is a security vulnerability in the authentication module, the second is inefficient database queries, and the third is missing error handling in frontend components. I suggest we fix them one by one in order of priority.", "lang": "en"},
]


def get_audio_duration(filepath):
    try:
        result = subprocess.run(
            ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', filepath],
            capture_output=True, text=True, timeout=5
        )
        info = json.loads(result.stdout)
        return float(info['format']['duration'])
    except Exception:
        pass
    try:
        with open(filepath, 'rb') as f:
            header = f.read(44)
            if len(header) >= 44:
                byte_rate = struct.unpack('<I', header[28:32])[0]
                if byte_rate > 0:
                    return (os.path.getsize(filepath) - 44) / byte_rate
    except Exception:
        pass
    return 0


def main():
    from gradio_client import Client, handle_file

    print("[Chatterbox] 连接中...")
    client = Client("ResembleAI/Chatterbox", verbose=False)
    print("[Chatterbox] 已连接!")

    results = []

    for case in TEST_CASES:
        output_file = os.path.join(OUTPUT_DIR, f"chatterbox_{case['id']}.wav")

        start = time.time()
        try:
            # 提供一个有效的 audio prompt URL，避免使用缺失的默认文件
            result_audio = client.predict(
                text_input=case["text"],
                audio_prompt_path_input=handle_file("https://github.com/gradio-app/gradio/raw/main/test/test_files/audio_sample.wav"),
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
                file_size = os.path.getsize(output_file)
                duration = get_audio_duration(output_file)
                total = round((end - start) * 1000)
                r = {"case": case["id"], "total_ms": total, "duration_s": round(duration, 1), "size_kb": round(file_size / 1024, 1)}
                results.append(r)
                print(f"  {case['id']}: Total={total}ms, Duration={r['duration_s']}s, Size={r['size_kb']}KB")
            else:
                print(f"  {case['id']}: 无音频返回 - {result_audio}")

        except Exception as e:
            end = time.time()
            print(f"  {case['id']}: 失败({round((end-start)*1000)}ms) - {e}")

            # 尝试不传 audio_prompt
            try:
                print(f"  {case['id']}: 尝试不传 audio_prompt...")
                start2 = time.time()
                result_audio = client.predict(
                    text_input=case["text"],
                    exaggeration_input=0.5,
                    temperature_input=0.8,
                    seed_num_input=0,
                    cfgw_input=0.5,
                    vad_trim_input=False,
                    api_name="/generate_tts_audio"
                )
                end2 = time.time()
                audio_path = result_audio[0] if isinstance(result_audio, tuple) else result_audio
                if audio_path and os.path.exists(str(audio_path)):
                    subprocess.run(['cp', str(audio_path), output_file], check=True)
                    file_size = os.path.getsize(output_file)
                    duration = get_audio_duration(output_file)
                    total = round((end2 - start2) * 1000)
                    r = {"case": case["id"], "total_ms": total, "duration_s": round(duration, 1), "size_kb": round(file_size / 1024, 1)}
                    results.append(r)
                    print(f"  {case['id']}: Total={total}ms, Duration={r['duration_s']}s, Size={r['size_kb']}KB")
            except Exception as e2:
                print(f"  {case['id']}: 备选也失败 - {e2}")

    print("\n--- Chatterbox 结果 ---")
    for r in results:
        print(f"  {r['case']}: Total={r['total_ms']}ms, Duration={r['duration_s']}s, Size={r['size_kb']}KB")


if __name__ == "__main__":
    main()
