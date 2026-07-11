import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { qrPngBuffer, qrPngBase64, dependencies } from './qrCode.js';

describe('qrCode', () => {
  const originalToBuffer = dependencies.toBuffer;

  beforeEach(() => {
    dependencies.toBuffer = originalToBuffer;
  });

  afterEach(() => {
    dependencies.toBuffer = originalToBuffer;
  });

  test('qrPngBuffer calls qrcode library correctly and returns buffer', async () => {
    let called = null;
    dependencies.toBuffer = async (text, opts) => {
      called = { text, opts };
      return Buffer.from('mock_png_bytes');
    };

    const res = await qrPngBuffer('hello-qr');
    assert.deepEqual(res, Buffer.from('mock_png_bytes'));
    assert.ok(called);
    assert.equal(called.text, 'hello-qr');
    assert.equal(called.opts.type, 'png');
    assert.equal(called.opts.width, 320);
  });

  test('qrPngBase64 returns base64 string of buffer', async () => {
    dependencies.toBuffer = async () => Buffer.from('abc');
    const res = await qrPngBase64('test-base64');
    assert.equal(res, 'YWJj'); // 'abc' in base64
  });
});
