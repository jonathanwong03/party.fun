import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLicensePdf } from './licensePdf.js';

describe('licensePdf', () => {
  test('generates valid admin license PDF buffer', async () => {
    const license = {
      username: 'admin_user',
      licenseId: 'LIC-999-XYZ',
      issued: '2026-07-06',
      validity: 'Valid indefinitely',
    };

    const pdfBuffer = await buildLicensePdf(license);

    assert.ok(Buffer.isBuffer(pdfBuffer));
    // Verify PDF header magic bytes
    assert.equal(pdfBuffer.slice(0, 4).toString(), '%PDF');
    
    // Verify file footer indicating completion
    const endStr = pdfBuffer.slice(-100).toString();
    assert.match(endStr, /%%EOF/);
  });
});
