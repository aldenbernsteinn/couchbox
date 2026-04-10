#!/usr/bin/env python3
"""Persistent Whisper server — loads model into VRAM once, streams live transcription.
Protocol (stdin/stdout):
  RECORD  → starts recording, sends PARTIAL:<text> every ~2s
  STOP    → stops recording, sends RESULT:<text>
  QUIT    → exits
  READY   → (output) model loaded
"""
import sys, os, signal, subprocess, tempfile, threading, time, wave

signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))

sys.stderr.write("Loading Whisper small model...\n")
sys.stderr.flush()
from faster_whisper import WhisperModel
import numpy as np
MODEL_SIZE = "medium"  # Options: tiny, base, small, medium, large
model = WhisperModel(MODEL_SIZE, device="cuda", compute_type="float16")

# Warm up CUDA kernels
_tf = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
with wave.open(_tf.name, 'w') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(np.zeros(16000, dtype=np.int16).tobytes())
try: list(model.transcribe(_tf.name, beam_size=1)[0])
except: pass
os.unlink(_tf.name)

print("READY", flush=True)

rec_proc = None
raw_file = None
streaming = False
stream_thread = None

def snapshot_to_wav(raw_path):
    """Read current raw PCM bytes and write a valid WAV for transcription."""
    try:
        with open(raw_path, 'rb') as f:
            raw_data = f.read()
        if len(raw_data) < 16000:  # less than 0.5s
            return None
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        with wave.open(tmp.name, 'w') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(raw_data)
        return tmp.name
    except Exception as e:
        sys.stderr.write(f"snapshot error: {e}\n")
        sys.stderr.flush()
        return None

def transcribe_file(path):
    try:
        segments, _ = model.transcribe(path, beam_size=5, language="en",
                                        vad_filter=True,
                                        vad_parameters=dict(min_silence_duration_ms=500))
        return " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as e:
        sys.stderr.write(f"transcribe error: {e}\n")
        sys.stderr.flush()
        return ""

def stream_loop():
    """Periodically transcribe the growing recording and send partial results."""
    global streaming
    last_text = ""
    sys.stderr.write("Stream loop started\n")
    sys.stderr.flush()
    time.sleep(2)  # wait for initial audio
    while streaming:
        if not rec_proc or rec_proc.poll() is not None:
            break
        sys.stderr.write(f"Streaming tick, raw file size: {os.path.getsize(raw_file) if raw_file and os.path.exists(raw_file) else 0}\n")
        sys.stderr.flush()
        wav_path = snapshot_to_wav(raw_file)
        if wav_path:
            text = transcribe_file(wav_path)
            try: os.unlink(wav_path)
            except: pass
            sys.stderr.write(f"Partial result: [{text}]\n")
            sys.stderr.flush()
            if text and text != last_text:
                last_text = text
                print(f"PARTIAL:{text}", flush=True)
        time.sleep(2)
    sys.stderr.write("Stream loop ended\n")
    sys.stderr.flush()

for line in sys.stdin:
    cmd = line.strip()
    if cmd == 'RECORD':
        if rec_proc:
            rec_proc.terminate()
            rec_proc.wait()
        streaming = False
        if stream_thread:
            stream_thread.join(timeout=3)

        tf = tempfile.NamedTemporaryFile(suffix='.raw', delete=False)
        tf.close()
        raw_file = tf.name
        rec_proc = subprocess.Popen(
            ['arecord', '-D', 'default', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'raw', raw_file],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        streaming = True
        stream_thread = threading.Thread(target=stream_loop, daemon=True)
        stream_thread.start()
        print("RECORDING", flush=True)

    elif cmd == 'STOP':
        streaming = False
        if rec_proc:
            rec_proc.terminate()
            rec_proc.wait()
            rec_proc = None
            if stream_thread:
                stream_thread.join(timeout=5)
            wav_path = snapshot_to_wav(raw_file)
            if wav_path:
                text = transcribe_file(wav_path)
                print(f"RESULT:{text}", flush=True)
                try: os.unlink(wav_path)
                except: pass
            else:
                print("RESULT:", flush=True)
            try: os.unlink(raw_file)
            except: pass
            raw_file = None
        else:
            print("RESULT:", flush=True)

    elif cmd == 'QUIT':
        streaming = False
        if rec_proc:
            rec_proc.terminate()
        break

sys.exit(0)
