import io
import logging
import re
from typing import Optional

import edge_tts
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

app = FastAPI(title="happy-tts", version="0.1.0")

logger = logging.getLogger("happy-tts")

# Default voice when none specified
DEFAULT_VOICE = "en-US-JennyNeural"

# Whitelist patterns for voice and rate parameters
_VOICE_RE = re.compile(r"^[a-zA-Z]{2,3}-[A-Z]{2}-\w+Neural$")
_RATE_RE = re.compile(r"^[+-]\d{1,3}%$")


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    voice: Optional[str] = None
    rate: Optional[str] = None  # e.g. "+20%", "-10%", "+0%"


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/voices")
async def list_voices():
    """List all available Edge TTS voices."""
    try:
        voices = await edge_tts.list_voices()
        return [
            {
                "name": v["ShortName"],
                "locale": v["Locale"],
                "gender": v["Gender"],
            }
            for v in voices
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"failed to list voices: {e}")


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    """Synthesize text to MP3 audio using Edge TTS."""
    voice = req.voice or DEFAULT_VOICE
    rate = req.rate or "+0%"

    if not _VOICE_RE.match(voice):
        raise HTTPException(status_code=400, detail="invalid voice format")
    if not _RATE_RE.match(rate):
        raise HTTPException(status_code=400, detail="invalid rate format")

    try:
        communicate = edge_tts.Communicate(req.text, voice, rate=rate)
        audio_buffer = io.BytesIO()

        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])

        if audio_buffer.tell() == 0:
            raise HTTPException(status_code=500, detail="no audio data generated")

        audio_buffer.seek(0)
        return StreamingResponse(
            audio_buffer,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=speech.mp3"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("synthesize failed: %s", e)
        raise HTTPException(status_code=500, detail=f"synthesize failed: {e}")
