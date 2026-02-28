"""
RealtimeSTT WebSocket server for Happy voice chat.

Receives PCM audio chunks via WebSocket, feeds them to RealtimeSTT
for real-time transcription. Sends interim and final results back
as JSON messages.

Binary frame protocol (little-endian):
  [4-byte metadata_len][JSON metadata][PCM audio data]

Metadata example: {"sampleRate": 16000}

Response messages:
  {"type": "realtime", "text": "..."}     — interim result
  {"type": "fullSentence", "text": "..."}  — final result (hallucination-filtered)
  {"type": "ready"}                        — recorder initialized
"""

import asyncio
import json
import logging
import os
import re
import struct
import sys
import types
import urllib.parse
from typing import Optional

import numpy as np
import websockets

# Stub out pvporcupine before importing RealtimeSTT.
# Porcupine (wake word detection) is not available on all platforms
# (e.g. aarch64 Docker) and we don't need it — we use use_microphone=False.
if "pvporcupine" not in sys.modules:
    sys.modules["pvporcupine"] = types.ModuleType("pvporcupine")

from RealtimeSTT import AudioToTextRecorder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [stt-ws] %(levelname)s %(message)s",
)
logger = logging.getLogger("stt-ws")

_model_size = os.getenv("STT_MODEL", "small")

# Known Whisper hallucination patterns (from app.py)
_HALLUCINATION_RE = re.compile(
    r"字幕|索兰娅|Amara\.org|請不吝點讚|订阅转发|謝謝觀看|感谢收看"
    r"|thanks for watching|subscribe"
    r"|^\s*[♪♫🎵🎶\s]+\s*$",
    re.IGNORECASE,
)


def _is_hallucination(text: str) -> bool:
    return bool(text and _HALLUCINATION_RE.search(text))


def _normalize_lang(locale: Optional[str]) -> Optional[str]:
    """BCP-47 locale code → ISO 639-1 language code."""
    if not locale or locale == "auto":
        return None
    return locale.split("-")[0].lower() or None


def _get_initial_prompt(lang: Optional[str], locale: Optional[str]) -> Optional[str]:
    """Chinese simplified/traditional bias via initial_prompt."""
    if lang != "zh":
        return None
    original = (locale or "").lower()
    is_traditional = any(tag in original for tag in ("tw", "hk", "hant"))
    if is_traditional:
        return None
    return "以下是普通话的句子。"


class SttSession:
    """One WebSocket connection = one RealtimeSTT session."""

    def __init__(self, ws, locale: Optional[str] = None):
        self.ws = ws
        self.locale = locale
        self.lang = _normalize_lang(locale)
        self.initial_prompt = _get_initial_prompt(self.lang, self.locale)
        self.recorder: Optional[AudioToTextRecorder] = None
        self._loop = asyncio.get_running_loop()

    def _send_json(self, data: dict):
        """Thread-safe send (RealtimeSTT callbacks run in background threads)."""
        asyncio.run_coroutine_threadsafe(
            self._safe_send(json.dumps(data)), self._loop
        )

    async def _safe_send(self, text: str):
        try:
            await self.ws.send(text)
        except Exception:
            pass

    def _on_realtime_update(self, text: str):
        """Interim transcription callback — skip hallucination check for speed."""
        text = (text or "").strip()
        if text:
            self._send_json({"type": "realtime", "text": text})

    def _on_recording_stop(self, text: str):
        """Final sentence callback — apply hallucination filter."""
        text = (text or "").strip()
        if text and not _is_hallucination(text):
            self._send_json({"type": "fullSentence", "text": text})
        else:
            self._send_json({"type": "fullSentence", "text": ""})

    def start(self):
        recorder_config = {
            "model": _model_size,
            "language": self.lang or "",
            "compute_type": "int8",
            "device": "cpu",
            "use_microphone": False,
            "spinner": False,
            "enable_realtime_transcription": True,
            "on_realtime_transcription_stabilized": self._on_realtime_update,
            "silero_sensitivity": 0.4,
            "webrtc_sensitivity": 3,
            "post_speech_silence_duration": 0.7,
            "min_length_of_recording": 0.3,
            "min_gap_between_recordings": 0,
            "realtime_processing_pause": 0.1,
            "beam_size": 5,
            "initial_prompt": self.initial_prompt,
        }
        self.recorder = AudioToTextRecorder(**recorder_config)
        self._send_json({"type": "ready"})
        logger.info("Recorder started: model=%s, lang=%s", _model_size, self.lang or "auto")

    def feed_audio(self, pcm_bytes: bytes, sample_rate: int = 16000):
        if self.recorder is None:
            return
        chunk = np.frombuffer(pcm_bytes, dtype=np.int16)
        self.recorder.feed_audio(chunk, original_sample_rate=sample_rate)

    def stop(self):
        if self.recorder:
            try:
                self.recorder.stop()
                self.recorder.shutdown()
            except Exception as e:
                logger.warning("Recorder cleanup error: %s", e)
            self.recorder = None


_VALID_SAMPLE_RATES = frozenset((8000, 16000, 22050, 44100, 48000))


def _run_recorder_loop(session: SttSession):
    """
    Run the recorder's blocking text() loop in a background thread.
    AudioToTextRecorder.text() blocks until speech is detected and
    transcribed. We call it in a loop so it keeps processing.
    """
    try:
        while session.recorder is not None:
            session.recorder.text(session._on_recording_stop)
    except Exception as e:
        logger.warning("Recorder loop ended: %s", e)


async def _handle_connection(ws, path=None):
    """Handle a single WebSocket connection."""
    # Parse query string for lang parameter
    parsed = urllib.parse.urlparse(ws.path if hasattr(ws, 'path') else (path or ""))
    params = urllib.parse.parse_qs(parsed.query)
    locale = params.get("lang", [None])[0]

    session = SttSession(ws, locale)
    logger.info("New STT session: locale=%s", locale)

    recorder_future = None
    try:
        # Initialize recorder in thread pool (model loading can take seconds)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, session.start)

        # Run recorder loop in background thread
        recorder_future = loop.run_in_executor(None, _run_recorder_loop, session)

        async for message in ws:
            if isinstance(message, bytes):
                if len(message) < 4:
                    continue
                # Parse binary frame: [4-byte LE metadata_len][JSON metadata][PCM]
                meta_len = struct.unpack("<I", message[:4])[0]
                # Guard: metadata JSON should never exceed 512 bytes
                if meta_len > 512 or len(message) < 4 + meta_len:
                    continue

                sample_rate = 16000
                if meta_len > 0:
                    try:
                        meta = json.loads(message[4:4 + meta_len])
                        raw_rate = int(meta.get("sampleRate", 16000))
                        sample_rate = raw_rate if raw_rate in _VALID_SAMPLE_RATES else 16000
                    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                        pass

                pcm_data = message[4 + meta_len:]
                if pcm_data:
                    session.feed_audio(pcm_data, sample_rate)

            elif isinstance(message, str):
                try:
                    ctrl = json.loads(message)
                    if ctrl.get("type") == "stop":
                        break
                except json.JSONDecodeError:
                    pass

    except websockets.exceptions.ConnectionClosed:
        logger.info("STT session disconnected")
    finally:
        session.stop()
        # Wait for recorder loop thread to exit (with timeout)
        if recorder_future is not None:
            try:
                await asyncio.wait_for(
                    asyncio.wrap_future(recorder_future), timeout=5.0
                )
            except (asyncio.TimeoutError, Exception):
                pass
        logger.info("STT session cleaned up")


async def main():
    port = int(os.getenv("STT_WS_PORT", "8001"))
    logger.info("Starting RealtimeSTT WebSocket server on port %d (model=%s)", port, _model_size)
    async with websockets.serve(
        _handle_connection,
        "0.0.0.0",
        port,
        max_size=2**20,  # 1MB max message size
    ):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
