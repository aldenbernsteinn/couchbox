#!/usr/bin/env python3
"""Shared Whisper HTTP server with client ownership.
Only the client that requested recording receives events.
Port 8897.
"""

import os, sys, signal, subprocess, tempfile, threading, time, wave, json, asyncio
import numpy as np

signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))

def log(msg):
    sys.stderr.write(f"{msg}\n")
    sys.stderr.flush()

log("Loading Whisper medium model...")
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
log("Whisper model ready")

# ── State ────────────────────────────────────────────────────────────────────

SAMPLE_RATE = 16000
SPEECH_RMS_THRESHOLD = 500
SILENCE_DURATION = 1.5
loop = None

# Client tracking
ws_clients = set()
recording_owner = None  # the WebSocket that owns the current recording (or None)

# Recording state
rec_proc = None
raw_file = None
recording = False
stop_requested = False


def send_to_owner(msg):
    """Send a message ONLY to the client that owns the recording."""
    if not recording_owner or not loop:
        return
    if recording_owner not in ws_clients:
        return
    try:
        data = json.dumps(msg)
        asyncio.run_coroutine_threadsafe(recording_owner.send_text(data), loop)
    except:
        pass


def snapshot_to_wav(raw_path):
    try:
        with open(raw_path, 'rb') as f:
            data = f.read()
        if len(data) < 16000:
            return None
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        with wave.open(tmp.name, 'w') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SAMPLE_RATE)
            w.writeframes(data)
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
        log(f"transcribe error: {e}")
        return ""


def get_rms(raw_path):
    try:
        size = os.path.getsize(raw_path)
        with open(raw_path, 'rb') as f:
            f.seek(max(0, size - 32000))
            data = f.read()
        if len(data) < 3200:
            return 0
        samples = np.frombuffer(data, dtype=np.int16).astype(np.float32)
        return np.sqrt(np.mean(samples ** 2))
    except:
        return 0


def recording_thread():
    """Single long-lived thread for record/stop cycles."""
    global rec_proc, raw_file, recording, stop_requested

    while True:
        while not recording:
            time.sleep(0.1)

        log(f"Recording started (owner={id(recording_owner) if recording_owner else 'none'})")
        send_to_owner({"type": "recording", "active": True})

        tf = tempfile.NamedTemporaryFile(suffix='.raw', delete=False)
        tf.close()
        raw_file = tf.name
        rec_proc = subprocess.Popen(
            ['arecord', '-D', 'default', '-f', 'S16_LE', '-r', str(SAMPLE_RATE),
             '-c', '1', '-t', 'raw', raw_file],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

        last_text = ""
        speech_detected = False
        silence_start = 0
        time.sleep(1.5)

        while recording and not stop_requested:
            try:
                if not rec_proc or rec_proc.poll() is not None:
                    break
                if not raw_file or not os.path.exists(raw_file):
                    time.sleep(0.3)
                    continue

                rms = get_rms(raw_file)
                if rms > SPEECH_RMS_THRESHOLD:
                    speech_detected = True
                    silence_start = 0
                elif speech_detected and silence_start == 0:
                    silence_start = time.time()

                fsize = os.path.getsize(raw_file) if os.path.exists(raw_file) else 0
                if fsize > 32000:
                    wav_path = snapshot_to_wav(raw_file)
                    if wav_path:
                        text = transcribe_file(wav_path)
                        try: os.unlink(wav_path)
                        except: pass
                        if text and text != last_text:
                            last_text = text
                            log(f"Partial: [{text[:50]}]")
                            send_to_owner({"type": "partial", "text": text})

                if speech_detected and silence_start > 0:
                    if time.time() - silence_start >= SILENCE_DURATION and last_text:
                        log(f"VAD end-of-turn: [{last_text[:40]}]")
                        send_to_owner({"type": "end_of_turn"})
                        speech_detected = False
                        silence_start = 0

            except Exception as e:
                log(f"Stream error: {e}")
            time.sleep(0.3)

        # Stop arecord
        if rec_proc:
            rec_proc.terminate()
            try: rec_proc.wait(timeout=2)
            except: pass
            rec_proc = None

        # Final transcription
        final_text = ""
        if raw_file and os.path.exists(raw_file):
            wav_path = snapshot_to_wav(raw_file)
            if wav_path:
                final_text = transcribe_file(wav_path)
                try: os.unlink(wav_path)
                except: pass
            try: os.unlink(raw_file)
            except: pass
            raw_file = None

        log(f"Recording stopped. Final: [{final_text[:50]}]")
        send_to_owner({"type": "result", "text": final_text})
        send_to_owner({"type": "recording", "active": False})

        recording = False
        stop_requested = False


threading.Thread(target=recording_thread, daemon=True).start()


def do_record(owner=None):
    global recording, stop_requested, recording_owner
    if recording:
        stop_requested = True
        time.sleep(0.3)
    recording_owner = owner
    recording = True
    stop_requested = False


def do_stop():
    global stop_requested
    if not recording:
        send_to_owner({"type": "result", "text": ""})
        send_to_owner({"type": "recording", "active": False})
        return
    stop_requested = True
    deadline = time.time() + 5
    while recording and time.time() < deadline:
        time.sleep(0.1)


# ── HTTP + WebSocket ─────────────────────────────────────────────────────────

from fastapi import FastAPI, WebSocket as FastAPIWebSocket, WebSocketDisconnect
import uvicorn

app = FastAPI(title="whisper-shared")

@app.on_event("startup")
async def on_startup():
    global loop
    loop = asyncio.get_event_loop()

@app.post("/record")
async def api_record():
    # HTTP record — no WS owner, results go to no one (use /stop to get text)
    do_record(owner=None)
    return {"status": "recording"}

@app.post("/stop")
async def api_stop():
    do_stop()
    return {"status": "stopped"}

@app.get("/status")
async def status():
    return {"ready": True, "recording": recording, "has_owner": recording_owner is not None}

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.websocket("/ws")
async def ws_endpoint(ws: FastAPIWebSocket):
    await ws.accept()
    ws_clients.add(ws)
    log(f"WS client connected ({len(ws_clients)} total)")
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)
            if msg.get("type") == "record":
                # This client takes ownership of recording
                do_record(owner=ws)
            elif msg.get("type") == "stop":
                # Only the owner can stop
                if recording_owner == ws:
                    do_stop()
    except WebSocketDisconnect:
        pass
    finally:
        ws_clients.discard(ws)
        # If this client owned the recording, stop it
        if recording_owner == ws and recording:
            do_stop()
        log(f"WS client disconnected ({len(ws_clients)} total)")

if __name__ == "__main__":
    port = int(os.environ.get("WHISPER_PORT", "8897"))
    log(f"Starting on :{port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
