#!/usr/bin/env python3
"""Record from USB camera mic until stdin is closed, then transcribe with Whisper small.
Prints the transcribed text to stdout."""
import sys, wave, tempfile, subprocess, os

# Record raw audio from USB camera mic (hw:3,0) until stdin gets 'STOP'
def record_audio():
    tf = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tf.close()
    # Start arecord in background
    proc = subprocess.Popen(
        ['arecord', '-D', 'hw:3,0', '-f', 'S16_LE', '-r', '16000', '-c', '1', tf.name],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    # Wait for STOP signal on stdin
    for line in sys.stdin:
        if line.strip() == 'STOP':
            break
    proc.terminate()
    proc.wait()
    return tf.name

def transcribe(wav_path):
    from faster_whisper import WhisperModel
    model = WhisperModel("small", device="cuda", compute_type="float16")
    segments, info = model.transcribe(wav_path, beam_size=5, language="en")
    text = " ".join(seg.text.strip() for seg in segments)
    return text

if __name__ == '__main__':
    wav_path = record_audio()
    try:
        text = transcribe(wav_path)
        print(text.strip(), flush=True)
    finally:
        os.unlink(wav_path)
