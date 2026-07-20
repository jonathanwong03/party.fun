// Speech-to-Text — Google Cloud Speech-to-Text v1 (speech:recognize), used by the
// assistant's mic button so users can dictate a message instead of typing.
//
// Auth is a plain API key on the query string (the same shape as GOOGLE_WEATHER_API_KEY),
// so there is no service account, no ADC file and no extra npm dependency. Node 22 has a
// global `fetch`.
//
// This is the SYNCHRONOUS endpoint: it accepts audio up to ~60s / 10MB inline, which is
// exactly the shape of a dictated chat message. Anything longer would need
// longrunningrecognize + GCS, which this feature deliberately doesn't do.

const SPEECH_URL = 'https://speech.googleapis.com/v1/speech:recognize';
const TIMEOUT_MS = 20000;
const MAX_BYTES = 10 * 1024 * 1024; // Google's inline-audio ceiling

// Browser MediaRecorder output → Google encoding. Containers that carry their own header
// (WAV/FLAC) are sent WITHOUT an explicit encoding so Google reads it from the header.
// Note MP4/AAC (what iOS Safari records) is NOT supported by the v1 sync API — we say so
// plainly rather than forwarding a cryptic upstream error.
function encodingFor(mimeType) {
  const m = String(mimeType ?? '').toLowerCase();
  if (m.includes('webm')) return { encoding: 'WEBM_OPUS', sampleRateHertz: 48000 };
  if (m.includes('ogg')) return { encoding: 'OGG_OPUS', sampleRateHertz: 48000 };
  if (m.includes('flac')) return {};                    // header-carried
  if (m.includes('wav') || m.includes('wave')) return {}; // header-carried
  return null;                                          // unsupported (mp4/aac/mpeg/…)
}

let warnedNoKey = false;

// Test seam so tests never hit the network.
export const dependencies = { fetchFn: (...args) => fetch(...args) };
export function __setFetchForTests(fn) { dependencies.fetchFn = fn; }
export function __resetFetchForTests() { dependencies.fetchFn = (...args) => fetch(...args); }

export function isSpeechEnabled() {
  return !!process.env.GOOGLE_SPEECH_API_KEY;
}

// Transcribe an audio buffer. Never throws — returns { text } or { error, message }.
export async function transcribeAudio(buffer, mimeType) {
  const key = process.env.GOOGLE_SPEECH_API_KEY;
  if (!key) {
    if (!warnedNoKey) { warnedNoKey = true; console.warn('[speech] GOOGLE_SPEECH_API_KEY is not set — voice input is disabled.'); }
    return { error: 'unavailable', message: 'Voice input is not configured.' };
  }
  if (!buffer?.length) return { error: 'empty', message: 'No audio was recorded.' };
  if (buffer.length > MAX_BYTES) return { error: 'too_large', message: 'That recording is too long — keep it under a minute.' };

  const enc = encodingFor(mimeType);
  if (enc === null) {
    return { error: 'unsupported_format', message: `This browser records ${mimeType || 'an unsupported format'}, which voice input can't read yet.` };
  }

  const body = {
    config: {
      languageCode: process.env.GOOGLE_SPEECH_LANGUAGE || 'en-SG',
      enableAutomaticPunctuation: true,
      ...enc,
    },
    audio: { content: buffer.toString('base64') },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await dependencies.fetchFn(`${SPEECH_URL}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[speech] recognize failed:', res.status, detail.slice(0, 300));
      return { error: 'failed', message: 'Could not transcribe that — try again.' };
    }
    const data = await res.json();
    // Google returns one result per utterance; join them into a single message.
    const text = (data?.results ?? [])
      .map((r) => r?.alternatives?.[0]?.transcript ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return { error: 'no_speech', message: "I didn't catch that — try again." };
    return { text };
  } catch (e) {
    const aborted = e?.name === 'AbortError';
    console.warn('[speech] recognize error:', aborted ? 'timeout' : (e?.message || e));
    return { error: 'failed', message: aborted ? 'Transcription timed out — try again.' : 'Could not transcribe that — try again.' };
  } finally {
    clearTimeout(timer);
  }
}
