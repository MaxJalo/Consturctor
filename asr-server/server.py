"""Распознавание речи на видеокарте сервера.

Слушает только localhost. В установщики Constructor и Orchestrator не входит:
модель и CUDA живут в этом каталоге, основной backend только отправляет сюда файл.
"""

from __future__ import annotations

import os
import tempfile
import threading
from pathlib import Path
from typing import Any

import av
import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from diarize import VoiceSplitter

HOST = os.environ.get("ASR_HOST", "127.0.0.1")
PORT = int(os.environ.get("ASR_PORT", "7820"))
MODEL_ID = (os.environ.get("ASR_MODEL") or "openai/whisper-large-v3").strip()
SAMPLE_RATE = 16000
MAX_BYTES = 500 * 1024 * 1024

_model: Any = None
_processor: Any = None
_voices = VoiceSplitter()
_gpu_name = ""
_lock = threading.RLock()
_ROOT = Path(__file__).resolve().parent

app = FastAPI(title="Constructor ASR", docs_url=None, redoc_url=None)


def _cache_dir() -> Path:
    folder = Path(__file__).resolve().parent / "models"
    folder.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(folder))
    os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(folder / "hub"))
    return folder


def _decode(path: Path) -> np.ndarray:
    """Моно float32, 16 кГц. PyAV читает wav, mp3, m4a, wma и остальные контейнеры."""
    container = av.open(str(path))
    stream = next((item for item in container.streams if item.type == "audio"), None)
    if stream is None:
        raise RuntimeError("В файле нет аудиодорожки")
    resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
    chunks: list[np.ndarray] = []
    for frame in container.decode(stream):
        for resampled in resampler.resample(frame):
            chunks.append(resampled.to_ndarray().reshape(-1))
    for resampled in resampler.resample(None):
        chunks.append(resampled.to_ndarray().reshape(-1))
    container.close()
    if not chunks:
        raise RuntimeError("Не удалось декодировать аудио")
    return np.concatenate(chunks).astype(np.float32, copy=False)


def load_model() -> None:
    global _model, _processor, _gpu_name
    _cache_dir()
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA недоступна: распознавание запускается только на видеокарте сервера")
    _gpu_name = torch.cuda.get_device_name(0)
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        MODEL_ID,
        dtype=torch.float16,
        low_cpu_mem_usage=True,
    )
    model.to("cuda")
    _model = model
    _processor = AutoProcessor.from_pretrained(MODEL_ID)
    _voices.load(_cache_dir())


def _number(value: Any) -> float:
    if hasattr(value, "item"):
        value = value.item()
    return float(value)


def _text_of(tokens: Any) -> str:
    if tokens is None:
        return ""
    if hasattr(tokens, "tolist"):
        tokens = tokens.tolist()
    return _processor.tokenizer.decode(tokens, skip_special_tokens=True).strip()


def _rows_from_generate(output: Any, duration: float) -> list[dict[str, Any]]:
    segments = output.get("segments") if isinstance(output, dict) else None
    rows: list[dict[str, Any]] = []
    if segments:
        batch = segments[0] if segments and isinstance(segments[0], list) else segments
        for segment in batch:
            text = _text_of(segment.get("tokens"))
            if not text:
                continue
            start = _number(segment.get("start") or 0.0)
            end = _number(segment.get("end") or start)
            rows.append({"start": round(start, 2), "end": round(max(end, start), 2), "text": text})
        return rows
    token_ids = output["sequences"] if isinstance(output, dict) else output
    decoded = _processor.tokenizer.decode(token_ids[0], decode_with_timestamps=True, skip_special_tokens=False)
    import re

    pattern = re.compile(r"<\|(\d+(?:\.\d+)?)\|>")
    marks = list(pattern.finditer(decoded))
    for index, mark in enumerate(marks):
        start = float(mark.group(1))
        end = float(marks[index + 1].group(1)) if index + 1 < len(marks) else duration
        text = pattern.sub("", decoded[mark.end() : marks[index + 1].start() if index + 1 < len(marks) else len(decoded)])
        text = text.replace("<|endoftext|>", "").strip()
        if text:
            rows.append({"start": round(start, 2), "end": round(max(end, start), 2), "text": text})
    return rows


def _recognize(audio: np.ndarray, hint: str) -> list[dict[str, Any]]:
    if len(audio) < int(0.4 * SAMPLE_RATE):
        return []
    duration = round(len(audio) / SAMPLE_RATE, 2)
    features = _processor.feature_extractor(
        audio,
        sampling_rate=SAMPLE_RATE,
        return_tensors="pt",
        truncation=False,
        padding="longest",
        return_attention_mask=True,
    )
    input_features = features.input_features.to(device="cuda", dtype=torch.float16)
    attention_mask = features.attention_mask.to(device="cuda")
    kwargs: dict[str, Any] = {
        "attention_mask": attention_mask,
        "return_timestamps": True,
        "language": "russian",
        "task": "transcribe",
        "condition_on_prev_tokens": False,
    }
    if duration > 30:
        kwargs["return_segments"] = True
        kwargs["temperature"] = (0.0, 0.2, 0.4, 0.6, 0.8, 1.0)
        kwargs["compression_ratio_threshold"] = 1.35
        kwargs["logprob_threshold"] = -1.0
        kwargs["no_speech_threshold"] = 0.6
    if hint:
        kwargs["prompt_ids"] = torch.as_tensor(_processor.get_prompt_ids(hint), device="cuda")
    with _lock:
        output = _model.generate(input_features, **kwargs)
    return _rows_from_generate(output, duration)


def _stamp(rows: list[dict[str, Any]], offset: float, speaker: str) -> list[dict[str, Any]]:
    stamped: list[dict[str, Any]] = []
    for row in rows:
        text = str(row.get("text") or "").strip()
        if not text:
            continue
        start = round(float(row["start"]) + offset, 2)
        end = round(max(float(row["end"]) + offset, start), 2)
        stamped.append({"start": start, "end": end, "text": text, "speaker": speaker})
    return stamped


def _slice(audio: np.ndarray, start: float, end: float) -> np.ndarray:
    left = max(0, int(start * SAMPLE_RATE))
    right = min(len(audio), int(end * SAMPLE_RATE))
    return audio[left:right]


def _same_words(left: list[dict[str, Any]], right: list[dict[str, Any]]) -> bool:
    """Два потока сказали одно и то же — это не два человека, а одно и то же слово дважды."""
    def words(rows: list[dict[str, Any]]) -> set[str]:
        text = " ".join(str(row.get("text") or "") for row in rows).casefold()
        return {item for item in text.split() if len(item) > 2}

    first, second = words(left), words(right)
    if not first or not second:
        return True
    shared = len(first & second) / min(len(first), len(second))
    return shared > 0.5


def transcribe(path: Path, prompt: str) -> dict[str, Any]:
    if _model is None or _processor is None:
        raise RuntimeError("Модель ещё не загружена")
    audio = _decode(path)
    duration = round(len(audio) / SAMPLE_RATE, 2)
    hint = " ".join((prompt or "").split())[:240]
    turns, speaker_count, speakers = _voices.analyze(audio, _ROOT / "voices")
    rows: list[dict[str, Any]] = []
    for turn in turns:
        piece = _slice(audio, turn.start, turn.end)
        if turn.overlap and turn.speakers is not None:
            left, right = _voices.separate(piece)
            first = _stamp(_recognize(left, hint), turn.start, turn.speakers[0])
            second = _stamp(_recognize(right, hint), turn.start, turn.speakers[1])
            if _same_words(first, second):
                rows.extend(first)
            else:
                rows.extend(first)
                rows.extend(second)
            continue
        rows.extend(_stamp(_recognize(piece, hint), turn.start, turn.speaker))
    rows.sort(key=lambda item: (item["start"], item["speaker"]))
    return {
        "ok": True,
        "language": "ru",
        "model": MODEL_ID,
        "device": "cuda",
        "gpu": _gpu_name,
        "duration_sec": duration,
        "speaker_count": speaker_count,
        "speakers": speakers,
        "voices_separable": speaker_count > 1,
        "segments": rows,
        "names_hint": hint,
    }


@app.on_event("startup")
def _startup() -> None:
    load_model()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": _model is not None and _voices.ready,
        "device": "cuda",
        "gpu": _gpu_name,
        "model": MODEL_ID,
        "diarization": _voices.ready,
    }


@app.post("/transcribe")
async def transcribe_upload(
    file: UploadFile = File(...),
    prompt: str = Form(""),
) -> dict[str, Any]:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="Файл больше 500 МБ")
    suffix = Path(file.filename or "audio.wav").suffix.lower() or ".wav"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        return transcribe(tmp_path, prompt)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    import uvicorn

    _cache_dir()
    uvicorn.run("server:app", host=HOST, port=PORT, reload=False)
