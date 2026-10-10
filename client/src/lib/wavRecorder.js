// Records the microphone as 16 kHz mono 16-bit PCM and packs it into a WAV
// file. Plain PCM rather than MediaRecorder because browsers disagree on
// MediaRecorder formats (iOS gives MP4/AAC, Chrome WebM/Opus) and Azure
// Speech takes WAV from every one of them. 16 kHz is what speech
// recognition uses anyway, and keeps a 15-minute call around 29 MB.

const TARGET_RATE = 16000;

export async function startWavRecorder({ onLevel, onInterrupted } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  await ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but still works everywhere, unlike
  // AudioWorklet in some embedded browsers -- fine for a pilot.
  const proc = ctx.createScriptProcessor(4096, 1, 1);

  const chunks = [];
  let samples = 0;
  let paused = false;
  let stopped = false;
  // Downsample by averaging each run of input samples that maps onto one
  // output sample; the running state carries across buffers.
  const ratio = ctx.sampleRate / TARGET_RATE;
  let acc = 0, accN = 0, pos = 0;

  proc.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    if (onLevel) {
      let peak = 0;
      for (let i = 0; i < input.length; i += 16) peak = Math.max(peak, Math.abs(input[i]));
      onLevel(paused ? 0 : peak);
    }
    if (paused || stopped) return;
    const out = new Int16Array(Math.ceil(input.length / ratio) + 1);
    let n = 0;
    for (let i = 0; i < input.length; i++) {
      acc += input[i]; accN++; pos++;
      if (pos >= ratio) {
        const v = Math.max(-1, Math.min(1, acc / accN));
        out[n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        pos -= ratio; acc = 0; accN = 0;
      }
    }
    chunks.push(out.subarray(0, n));
    samples += n;
  };
  source.connect(proc);
  proc.connect(ctx.destination); // must be connected for onaudioprocess to fire

  // iOS suspends/interrupts the audio context on a phone call, Siri, or the
  // screen locking; the mic track ends if another app takes the microphone.
  ctx.onstatechange = () => { if (!stopped && !paused && ctx.state !== 'running') onInterrupted?.(); };
  stream.getAudioTracks().forEach(t => { t.onended = () => { if (!stopped) onInterrupted?.(); }; });

  return {
    durationMs: () => (samples / TARGET_RATE) * 1000,
    pause: () => { paused = true; },
    resume: async () => { await ctx.resume(); paused = false; },
    async stop() {
      stopped = true;
      try { source.disconnect(); proc.disconnect(); } catch { /* already gone */ }
      stream.getTracks().forEach(t => t.stop());
      try { await ctx.close(); } catch { /* already closed */ }
      return encodeWav(chunks, samples);
    },
  };
}

function encodeWav(chunks, samples) {
  const buf = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, samples * 2, true);
  let off = 44;
  for (const c of chunks) { for (let i = 0; i < c.length; i++, off += 2) view.setInt16(off, c[i], true); }
  return new Blob([buf], { type: 'audio/wav' });
}
