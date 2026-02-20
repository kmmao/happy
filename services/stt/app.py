import os
import re
import tempfile
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException

app = FastAPI(title="happy-stt", version="0.3.0")

_model = None
_model_size = os.getenv("STT_MODEL", "small")

# Known Whisper hallucination patterns (triggered on silence/noise).
# These are common Chinese/multilingual subtitle attributions the model invents.
_HALLUCINATION_RE = re.compile(
    r"字幕|索兰娅|Amara\.org|請不吝點讚|订阅转发|謝謝觀看|感谢收看"
    r"|thanks for watching|subscribe"
    r"|^\s*[♪♫🎵🎶\s]+\s*$",
    re.IGNORECASE,
)


def get_model():
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel

            _model = WhisperModel(
                _model_size,
                device="cpu",
                compute_type="int8",
            )
        except Exception as e:
            raise RuntimeError(f"failed to initialize model: {e}")
    return _model


@app.on_event("startup")
def _preload_model():
    """Load the Whisper model at startup so the first request isn't slow."""
    import logging
    logging.info("Pre-loading Whisper model '%s' …", _model_size)
    get_model()
    logging.info("Model ready.")


@app.get("/healthz")
def healthz():
    return {"ok": True, "model": _model_size, "loaded": _model is not None}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
):
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="empty file")
        tmp.write(content)
        tmp_path = tmp.name

    try:
        model = get_model()

        # Normalize BCP-47 locale codes to ISO 639-1: "zh-CN" → "zh", "en-US" → "en"
        # Preserve the original locale to detect simplified vs traditional Chinese.
        original_locale = (language or "").lower()
        if language and language != "auto":
            lang = language.split("-")[0].lower() or None
        else:
            lang = None

        # Whisper doesn't distinguish simplified/traditional Chinese.
        # Use initial_prompt to bias output toward the expected script.
        initial_prompt = None
        if lang == "zh":
            # zh-TW, zh-HK, zh-Hant → traditional; everything else → simplified
            is_traditional = any(
                tag in original_locale for tag in ("tw", "hk", "hant")
            )
            if not is_traditional:
                initial_prompt = "以下是普通话的句子。"

        segments, info = model.transcribe(
            tmp_path,
            language=lang,
            beam_size=5,
            vad_filter=True,  # Filter silence to prevent hallucinations
            initial_prompt=initial_prompt,
        )
        # Consume generator — empty on pure-silence audio, not an error
        text = "".join(seg.text for seg in segments).strip()
        detected_lang = info.language

        # Guard against Whisper hallucinations on noise/silence
        if text and _HALLUCINATION_RE.search(text):
            text = ""

        return {
            "text": text,
            "language": detected_lang,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"transcribe failed: {e}")
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass
