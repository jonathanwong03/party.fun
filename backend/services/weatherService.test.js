import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { assessEvent, __setForecastForTests, __resetForecastForTests } from './weatherService.js';

afterEach(__resetForecastForTests);

const sgYmd = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const day = (ymd, percent) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return { displayDate: { year: y, month: m, day: d }, daytimeForecast: { precipitation: { probability: { percent } } }, nighttimeForecast: { precipitation: { probability: { percent: 0 } } } };
};
const inDaysIso = (n) => `${sgYmd(new Date(Date.now() + n * 86400000).toISOString())}T19:00:00+08:00`;

test('assessEvent flags rain over 70% as willRain', async () => {
  const start = inDaysIso(3);
  __setForecastForTests(async () => [day(sgYmd(start), 85)]);
  const out = await assessEvent({ startISO: start });
  assert.equal(out.status, 'ok');
  assert.equal(out.willRain, true);
  assert.equal(out.precipitationProbability, 85);
});

test('assessEvent scans every day of a multi-day event and flags the wet ones', async () => {
  const start = inDaysIso(3);
  const mid = inDaysIso(4);
  const end = inDaysIso(5);
  __setForecastForTests(async () => [day(sgYmd(start), 20), day(sgYmd(mid), 90), day(sgYmd(end), 40)]);
  const out = await assessEvent({ startISO: start, endISO: end });
  assert.equal(out.status, 'ok');
  assert.equal(out.willRain, true);
  assert.equal(out.precipitationProbability, 90);
  assert.equal(out.days.length, 3);
  assert.deepEqual(out.rainyDays, [sgYmd(mid)]); // only the middle day is > 70%
});

test('assessEvent treats 70% or below as fine (strictly over 70)', async () => {
  const start = inDaysIso(3);
  __setForecastForTests(async () => [day(sgYmd(start), 70)]);
  const out = await assessEvent({ startISO: start });
  assert.equal(out.status, 'ok');
  assert.equal(out.willRain, false);
});

test('assessEvent reports past dates', async () => {
  __setForecastForTests(async () => [day(sgYmd(inDaysIso(0)), 10)]);
  const out = await assessEvent({ startISO: inDaysIso(-3) });
  assert.equal(out.status, 'past');
  assert.equal(out.willRain, false);
});

test('assessEvent reports beyond_horizon when the date is not in the forecast window', async () => {
  __setForecastForTests(async () => [day(sgYmd(inDaysIso(1)), 10)]); // only a near day is known
  const out = await assessEvent({ startISO: inDaysIso(20) });
  assert.equal(out.status, 'beyond_horizon');
});

test('assessEvent reports unavailable when no forecast is configured', async () => {
  __setForecastForTests(async () => null);
  const out = await assessEvent({ startISO: inDaysIso(3) });
  assert.equal(out.status, 'unavailable');
  assert.equal(out.willRain, false);
});

test('assessEvent falls back to Singapore coordinates when none are given', async () => {
  const start = inDaysIso(2);
  let calledWith = null;
  __setForecastForTests(async (lat, lon) => { calledWith = { lat, lon }; return [day(sgYmd(start), 30)]; });
  const out = await assessEvent({ startISO: start }); // no lat/lon
  assert.equal(out.status, 'ok');
  assert.equal(calledWith.lat, 1.3521);
  assert.equal(calledWith.lon, 103.8198);
});
