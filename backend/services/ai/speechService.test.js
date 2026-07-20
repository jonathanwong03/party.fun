import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { transcribeAudio, isSpeechEnabled, __setFetchForTests, __resetFetchForTests } from './speechService.js';

const AUDIO = Buffer.from('fake-audio-bytes');

afterEach(() => {
  __resetFetchForTests();
  delete process.env.GOOGLE_SPEECH_API_KEY;
  delete process.env.GOOGLE_SPEECH_LANGUAGE;
});

const okResponse = (results) => ({
  ok: true,
  json: async () => ({ results }),
});

test('is disabled (and never calls out) without an API key', async () => {
  let called = false;
  __setFetchForTests(async () => { called = true; return okResponse([]); });
  assert.equal(isSpeechEnabled(), false);
  const out = await transcribeAudio(AUDIO, 'audio/webm');
  assert.equal(out.error, 'unavailable');
  assert.equal(called, false, 'no billed request is made when the key is unset');
});

test('transcribes webm/opus and joins multi-utterance results', async () => {
  process.env.GOOGLE_SPEECH_API_KEY = 'k';
  let seen = null;
  __setFetchForTests(async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return okResponse([
      { alternatives: [{ transcript: 'what events' }] },
      { alternatives: [{ transcript: 'can I join' }] },
    ]);
  });
  const out = await transcribeAudio(AUDIO, 'audio/webm;codecs=opus');
  assert.equal(out.text, 'what events can I join');
  assert.match(seen.url, /speech\.googleapis\.com\/v1\/speech:recognize\?key=k/);
  assert.equal(seen.body.config.encoding, 'WEBM_OPUS');
  assert.equal(seen.body.config.sampleRateHertz, 48000);
  assert.equal(seen.body.config.languageCode, 'en-SG');
  assert.equal(seen.body.config.enableAutomaticPunctuation, true);
  assert.equal(seen.body.audio.content, AUDIO.toString('base64'));
});

test('omits encoding for header-carrying containers (wav/flac) so Google reads the header', async () => {
  process.env.GOOGLE_SPEECH_API_KEY = 'k';
  let body = null;
  __setFetchForTests(async (_url, init) => { body = JSON.parse(init.body); return okResponse([{ alternatives: [{ transcript: 'hi' }] }]); });
  await transcribeAudio(AUDIO, 'audio/wav');
  assert.equal(body.config.encoding, undefined);
  assert.equal(body.config.sampleRateHertz, undefined);
});

test('rejects a container the v1 API cannot decode (iOS Safari mp4) without calling out', async () => {
  process.env.GOOGLE_SPEECH_API_KEY = 'k';
  let called = false;
  __setFetchForTests(async () => { called = true; return okResponse([]); });
  const out = await transcribeAudio(AUDIO, 'audio/mp4');
  assert.equal(out.error, 'unsupported_format');
  assert.match(out.message, /mp4/);
  assert.equal(called, false);
});

test('reports no_speech when Google returns no transcript', async () => {
  process.env.GOOGLE_SPEECH_API_KEY = 'k';
  __setFetchForTests(async () => okResponse([]));
  assert.equal((await transcribeAudio(AUDIO, 'audio/webm')).error, 'no_speech');
});

test('never throws on an upstream failure', async () => {
  process.env.GOOGLE_SPEECH_API_KEY = 'k';
  __setFetchForTests(async () => ({ ok: false, status: 403, text: async () => 'PERMISSION_DENIED' }));
  const out = await transcribeAudio(AUDIO, 'audio/webm');
  assert.equal(out.error, 'failed');
  assert.match(out.message, /try again/i);
});

test('respects GOOGLE_SPEECH_LANGUAGE and guards empty/oversized audio', async () => {
  process.env.GOOGLE_SPEECH_API_KEY = 'k';
  process.env.GOOGLE_SPEECH_LANGUAGE = 'en-US';
  let body = null;
  __setFetchForTests(async (_url, init) => { body = JSON.parse(init.body); return okResponse([{ alternatives: [{ transcript: 'x' }] }]); });
  await transcribeAudio(AUDIO, 'audio/webm');
  assert.equal(body.config.languageCode, 'en-US');

  assert.equal((await transcribeAudio(Buffer.alloc(0), 'audio/webm')).error, 'empty');
  assert.equal((await transcribeAudio(Buffer.alloc(11 * 1024 * 1024), 'audio/webm')).error, 'too_large');
});
