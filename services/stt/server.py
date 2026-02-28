"""
RealtimeSTT WebSocket server for Happy voice chat.

Receives PCM audio chunks via WebSocket, feeds them to RealtimeSTT
for real-time transcription. Sends interim and final results back
as JSON messages.

The Whisper model is loaded ONCE at server startup (singleton pattern)
and reused across all WebSocket sessions for instant connection times.

Binary frame protocol (little-endian):
  [4-byte metadata_len][JSON metadata][PCM audio data]

Metadata example: {"sampleRate": 16000}

Response messages:
  {"type": "realtime", "text": "..."}     — interim result
  {"type": "fullSentence", "text": "..."}  — final result (hallucination-filtered)
  {"type": "ready"}                        — recorder ready
"""

import asyncio
import json
import logging
import os
import re
import struct
import sys
import threading
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
    """BCP-47 locale code -> ISO 639-1 language code."""
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


class RecorderManager:
    """Singleton manager for a pre-loaded AudioToTextRecorder.

    Loads the Whisper model once at server startup and reuses it
    across WebSocket sessions. Callbacks delegate to the active session.

    Supports one concurrent session at a time (personal tool).
    Language and initial_prompt are updated dynamically per session
    based on the client's locale setting (e.g. zh-Hans → language="zh",
    initial_prompt="以下是普通话的句子。").
    """

    def __init__(self):
        self.recorder: Optional[AudioToTextRecorder] = None
        self.active_session: Optional["SttSession"] = None
        self._lock = threading.Lock()

    # -- Callbacks (called from RealtimeSTT background threads) --

    def _on_realtime_update(self, text: str):
        with self._lock:
            session = self.active_session
        if session:
            session._on_realtime_update(text)

    def _on_recording_stop(self, text: str):
        with self._lock:
            session = self.active_session
        if session:
            session._on_recording_stop(text)

    # -- Lifecycle --

    def preload(self):
        """Pre-load the recorder with Whisper model. Blocking — run in executor."""
        recorder_config = {
            "model": _model_size,
            "language": "",
            "compute_type": "int8",
            "device": "cpu",
            "use_microphone": False,
            "spinner": False,
            "enable_realtime_transcription": True,
            # Use "small" model for realtime (244M params, ~1s/pass on CPU).
            # "tiny" (39M) can't do Chinese; "base" (74M) is faster but
            # produces garbled Chinese text. "small" is slower but gives
            # readable interim results. Final quality comes from turbo.
            "realtime_model_type": "small",
            "on_realtime_transcription_stabilized": self._on_realtime_update,
            "silero_sensitivity": 0.4,
            "webrtc_sensitivity": 3,
            "post_speech_silence_duration": 0.7,
            "min_length_of_recording": 0.3,
            "min_gap_between_recordings": 0,
            "realtime_processing_pause": 0.2,
            "beam_size": 5,
        }
        self.recorder = AudioToTextRecorder(**recorder_config)
        logger.info("Recorder pre-loaded: model=%s", _model_size)

    def run_loop(self):
        """Run the recorder's blocking text() loop. Call from executor — never returns."""
        try:
            while self.recorder is not None:
                self.recorder.text(self._on_recording_stop)
        except Exception as e:
            logger.critical(
                "Recorder loop crashed — STT is now non-functional: %s", e
            )

    def attach(
        self,
        session: "SttSession",
        lang: Optional[str] = None,
        locale: Optional[str] = None,
    ) -> bool:
        """Attach a session. Updates recorder language/prompt. Returns False if busy."""
        with self._lock:
            if self.active_session is not None:
                return False
            self.active_session = session
        # Update recorder language and initial_prompt based on client locale.
        # Safe: no audio is flowing yet (client sends audio after receiving "ready").
        if self.recorder is not None:
            self.recorder.language = lang or ""
            prompt = _get_initial_prompt(lang, locale)
            self.recorder.initial_prompt = prompt
            # Also set the realtime model's prompt (separate from main model)
            self.recorder.initial_prompt_realtime = prompt
            logger.info(
                "Recorder configured: lang=%s, prompt=%s",
                lang or "auto",
                prompt or "(none)",
            )
        return True

    def detach(self, session: "SttSession"):
        with self._lock:
            if self.active_session is session:
                self.active_session = None

    def feed_audio(self, pcm_bytes: bytes, sample_rate: int = 16000):
        if self.recorder is None:
            return
        chunk = np.frombuffer(pcm_bytes, dtype=np.int16)
        self.recorder.feed_audio(chunk, original_sample_rate=sample_rate)


_manager = RecorderManager()


class SttSession:
    """One WebSocket connection = one STT session (no model loading)."""

    def __init__(self, ws):
        self.ws = ws
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
        """Interim transcription callback."""
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


_VALID_SAMPLE_RATES = frozenset((8000, 16000, 22050, 44100, 48000))


async def _handle_connection(ws, path=None):
    """Handle a single WebSocket connection."""
    # websockets 15+: path is on ws.request.path (includes query string)
    # websockets <13: path is passed as second argument
    raw_path = getattr(getattr(ws, "request", None), "path", None) or (path or "")
    parsed = urllib.parse.urlparse(raw_path)
    params = urllib.parse.parse_qs(parsed.query)
    locale = params.get("lang", [None])[0]
    lang = _normalize_lang(locale)

    session = SttSession(ws)
    logger.info("New STT session: locale=%s", locale)

    if not _manager.attach(session, lang=lang, locale=locale):
        logger.warning("Rejected STT session — another session is active")
        await ws.send(json.dumps({"type": "error", "message": "STT busy"}))
        await ws.close(4429, "STT busy")
        return

    session._send_json({"type": "ready"})

    try:
        async for message in ws:
            if isinstance(message, bytes):
                if len(message) < 4:
                    continue
                # Parse binary frame: [4-byte LE metadata_len][JSON metadata][PCM]
                meta_len = struct.unpack("<I", message[:4])[0]
                if meta_len > 512 or len(message) < 4 + meta_len:
                    continue

                sample_rate = 16000
                if meta_len > 0:
                    try:
                        meta = json.loads(message[4 : 4 + meta_len])
                        raw_rate = int(meta.get("sampleRate", 16000))
                        sample_rate = (
                            raw_rate if raw_rate in _VALID_SAMPLE_RATES else 16000
                        )
                    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                        pass

                pcm_data = message[4 + meta_len :]
                if pcm_data:
                    _manager.feed_audio(pcm_data, sample_rate)

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
        _manager.detach(session)
        logger.info("STT session cleaned up")


async def main():
    port = int(os.getenv("STT_WS_PORT", "8001"))
    logger.info(
        "Starting RealtimeSTT WebSocket server on port %d (model=%s)",
        port,
        _model_size,
    )

    # Pre-load recorder with Whisper model (takes several seconds, only once)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _manager.preload)

    # Start recorder loop in background thread (runs forever)
    loop.run_in_executor(None, _manager.run_loop)

    async with websockets.serve(
        _handle_connection,
        "0.0.0.0",
        port,
        max_size=2**20,  # 1MB max message size
    ):
        logger.info("Server ready, accepting connections")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
