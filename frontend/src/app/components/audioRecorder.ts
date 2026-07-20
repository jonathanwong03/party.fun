// Microphone capture that produces 16 kHz mono WAV (LINEAR16) in the browser.
//
// Why not MediaRecorder: iOS Safari only records `audio/mp4` (AAC), which Google Cloud
// Speech-to-Text v1 cannot decode — so the mic silently failed on iPhones. The Web Audio
// API works everywhere including iOS, so we capture raw PCM and write the WAV container
// ourselves. WAV carries its own header, so the backend doesn't have to guess an encoding
// and every browser produces the exact same format.
//
// 16 kHz mono is Google's recommended rate for speech: any higher just costs bandwidth
// without improving recognition.

const TARGET_RATE = 16000;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  // Older iOS only exposes the prefixed constructor.
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null;
}

export function isRecordingSupported(): boolean {
  return !!audioContextCtor() && !!navigator.mediaDevices?.getUserMedia;
}

// Average-and-decimate downsampling. The averaging acts as a crude low-pass filter, which
// is enough to avoid aliasing artefacts on speech.
function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) { sum += input[j]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);            // PCM header size
  view.setUint16(20, 1, true);             // format = PCM
  view.setUint16(22, 1, true);             // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (mono × 16-bit)
  view.setUint16(32, 2, true);             // block align
  view.setUint16(34, 16, true);            // bits per sample
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

export type Recording = {
  /** Stop capture, release the mic, and return the recorded clip as 16 kHz mono WAV. */
  stop: () => Promise<Blob>;
  /** Abandon the recording and release the mic without producing a clip. */
  cancel: () => void;
};

// Starts capturing immediately. Must be called from a user gesture (the mic button click),
// which is also what lets iOS resume the AudioContext.
export async function startRecording(): Promise<Recording> {
  const Ctor = audioContextCtor();
  if (!Ctor || !navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't record audio.");

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const ctx = new Ctor();
  // iOS starts contexts suspended until a gesture-driven resume.
  if (ctx.state === 'suspended') await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  // ScriptProcessorNode is deprecated but is the one path supported by every browser we
  // care about (AudioWorklet needs a separate module file and more iOS-specific care).
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (e) => {
    chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };

  // A ScriptProcessorNode only fires while connected to the graph's destination — route it
  // through a muted gain node so the mic is never echoed back out of the speakers.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    processor.onaudioprocess = null;
    try { source.disconnect(); processor.disconnect(); mute.disconnect(); } catch { /* already torn down */ }
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };

  return {
    async stop() {
      const rate = ctx.sampleRate;
      release();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let at = 0;
      for (const c of chunks) { merged.set(c, at); at += c.length; }
      chunks.length = 0;
      return encodeWav(downsample(merged, rate, TARGET_RATE), TARGET_RATE);
    },
    cancel() {
      release();
      chunks.length = 0;
    },
  };
}
