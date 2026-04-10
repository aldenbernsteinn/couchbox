#!/usr/bin/env python3
"""Shared Whisper HTTP server — one instance serves both Jarvis and Patatin.

Port 8897. Uses energy-based VAD for fast end-of-turn detection.

API:
  POST /record         → start recording
  POST /stop           → stop recording, return final transcription
  GET  /status         → {"ready": bool, "recording": bool}
  WS   /ws             → streams {"type":"partial","text":"..."} and {"type":"result","text":"..."}
"""

import os, sys, signal, subprocess, tempfile, threading, time, wave, json, asyncio, struct
import numpy as np

signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))

sys.stderr.write("Loading Whisper medium model...\n")
sys.stderr.flush()
from faster_whisper import WhisperModel
MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "medium")
model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")

# Warmup
_tf = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
with wave.open(_tf.name, 'w') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(np.zeros(16000, dtype=np.int16).tobytes())
try: list(model.transcribe(_tf.name, beam_size=1)[0])
except: pass
os.unlink(_tf.name)
sys.stderr.write("Whisper model ready\n")
sys.stderr.flush()

# ── State ────────────────────────────────────────────────────────────────────

rec_proc = None
raw_file = None
streaming = False
stream_thread = None
model_ready = True
ws_clients = set()
loop = None

# VAD config
SPEECH_RMS_THRESHOLD = 500   # RMS above this = speech
SILENCE_DURATION = 1.5       # seconds of silence after speech = end of turn
SAMPLE_RATE = 16000

def snapshot_to_wav(raw_path):
    try:
        with open(raw_path, 'rb') as f:
            raw_data = f.read()
        if len(raw_data) < 16000:
            return None
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        with wave.open(tmp.name, 'w') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SAMPLE_RATE)
            w.writeframes(raw_data)
        return tmp.name
    except:
        return None

def transcribe_file(path):
    try:
        segments, _ = model.transcribe(path, beam_size=5, language="en",
                                        vad_filter=True,
                                        vad_parameters=dict(min_silence_duration_ms=500))
        return " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as e:
        sys.stderr.write(f"transcribe error: {e}\n")
        return ""

def broadcast_ws(msg):
    global ws_clients
    if not ws_clients or not loop:
        return
    data = json.dumps(msg)
    dead = set()
    for ws in ws_clients.copy():
        try:
            asyncio.run_coroutine_threadsafe(ws.send_text(data), loop)
        except:
            dead.add(ws)
    if dead:
        ws_clients -= dead

def get_rms(raw_path, offset_bytes=0):
    """Get RMS of the last chunk of audio."""
    try:
        with open(raw_path, 'rb') as f:
            f.seek(max(0, os.path.getsize(raw_path) - 32000))  # last 1s
            data = f.read()
        if len(data) < 3200:
            return 0
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32)
        return np.sqrt(np.mean(samples ** 2))
    except:
        return 0

def stream_loop():
    """Transcribe periodically + VAD-based end-of-turn detection."""
    global streaming
    last_text = ""
    speech_detected = False
    silence_start = 0

    sys.stderr.write("Stream loop started\n")
    sys.stderr.flush()
    time.sleep(1.5)  # wait for initial audio

    while streaming:
        try:
            if not rec_proc or rec_proc.poll() is not None:
                break
            if not raw_file or not os.path.exists(raw_file):
                time.sleep(0.5)
                continue

            # Check audio energy for VAD
            rms = get_rms(raw_file)

            if rms > SPEECH_RMS_THRESHOLD:
                speech_detected = True
                silence_start = 0
            elif speech_detected and silence_start == 0:
                silence_start = time.time()

            # Transcribe periodically
            fsize = os.path.getsize(raw_file) if os.path.exists(raw_file) else 0
            if fsize > 32000:  # at least 1s of audio
                wav_path = snapshot_to_wav(raw_file)
                if wav_path:
                    text = transcribe_file(wav_path)
                    try: os.unlink(wav_path)
                    except: pass
                    if text and text != last_text:
                        last_text = text
                        broadcast_ws({"type": "partial", "text": text})

            # End-of-turn: speech was detected, then silence for SILENCE_DURATION
            if speech_detected and silence_start > 0:
                if time.time() - silence_start >= SILENCE_DURATION and last_text:
                    sys.stderr.write(f"VAD end-of-turn: \"{last_text[:50]}...\"\n")
                    sys.stderr.flush()
                    broadcast_ws({"type": "end_of_turn"})
                    speech_detected = False
                    silence_start = 0

        except Exception as e:
            sys.stderr.write(f"Stream loop error: {e}\n")
            sys.stderr.flush()
        time.sleep(0.3)  # poll faster than before for snappier VAD

record_lock = threading.Lock()

def do_record():
    global rec_proc, raw_file, streaming, stream_thread
    if not record_lock.acquire(timeout=5):
        return
    try:
        # Clean up previous recording
        if rec_proc:
            rec_proc.terminate()
            try: rec_proc.wait(timeout=2)
            except: pass
        streaming = False
        if stream_thread and stream_thread.is_alive():
            stream_thread.join(timeout=3)

        tf = tempfile.NamedTemporaryFile(suffix='.raw', delete=False)
        tf.close()
        raw_file = tf.name
        rec_proc = subprocess.Popen(
            ['arecord', '-D', 'default', '-f', 'S16_LE', '-r', str(SAMPLE_RATE), '-c', '1', '-t', 'raw', raw_file],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        streaming = True
        stream_thread = threading.Thread(target=stream_loop, daemon=True)
        stream_thread.start()
        broadcast_ws({"type": "recording", "active": True})
    finally:
        record_lock.release()

def do_stop():
    global rec_proc, raw_file, streaming, stream_thread
    streaming = False
    text = ""
    if rec_proc:
        rec_proc.terminate()
        try: rec_proc.wait(timeout=2)
        except: pass
        rec_proc = None
        if stream_thread:
            stream_thread.join(timeout=5)
        wav_path = snapshot_to_wav(raw_file)
        if wav_path:
            text = transcribe_file(wav_path)
            try: os.unlink(wav_path)
            except: pass
        try: os.unlink(raw_file)
        except: pass
        raw_file = None
    broadcast_ws({"type": "result", "text": text})
    broadcast_ws({"type": "recording", "active": False})
    return text

# ── HTTP + WebSocket ─────────────────────────────────────────────────────────

from fastapi import FastAPI, WebSocket as FastAPIWebSocket, WebSocketDisconnect
import uvicorn

app = FastAPI(title="whisper-shared")

@app.on_event("startup")
async def on_startup():
    global loop
    loop = asyncio.get_event_loop()

@app.post("/record")
async def record():
    do_record()
    return {"status": "recording"}

@app.post("/stop")
async def stop():
    text = do_stop()
    return {"text": text}

@app.get("/status")
async def status():
    return {"ready": model_ready, "recording": rec_proc is not None}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.websocket("/ws")
async def websocket_endpoint(ws: FastAPIWebSocket):
    await ws.accept()
    ws_clients.add(ws)
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "record":
                do_record()
            elif msg.get("type") == "stop":
                do_stop()
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(ws)

if __name__ == "__main__":
    port = int(os.environ.get("WHISPER_PORT", "8897"))
    sys.stderr.write(f"Whisper HTTP server starting on :{port}\n")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
