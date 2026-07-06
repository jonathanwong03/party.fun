import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketsPdf, dependencies } from './ticketPdf.js';

describe('ticketPdf', () => {
  const originalQrPngBuffer = dependencies.qrPngBuffer;

  beforeEach(() => {
    // Return a tiny 1x1 transparent PNG buffer mock to speed up tests
    dependencies.qrPngBuffer = async () => Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );
  });

  afterEach(() => {
    dependencies.qrPngBuffer = originalQrPngBuffer;
  });

  test('generates valid PDF buffer with multiple ticket pages', async () => {
    const event = {
      title: 'Inter-Uni Welcome Bash',
      dateText: 'Fri, 14 Aug 2026',
      location: 'NTU North Spine Plaza',
      reference: 'PF-ABCD-1234',
    };
    const tickets = [
      { qrCode: 'PF-TICKET-01' },
      { qrCode: 'PF-TICKET-02' },
    ];

    const pdfBuffer = await buildTicketsPdf({ event, tickets });
    
    assert.ok(Buffer.isBuffer(pdfBuffer));
    // Verify PDF header magic bytes
    assert.equal(pdfBuffer.slice(0, 4).toString(), '%PDF');
    
    // Verify file footer indicating completion
    const endStr = pdfBuffer.slice(-100).toString();
    assert.match(endStr, /%%EOF/);
  });

  test('generates empty page PDF fallback when no tickets provided', async () => {
    const event = { title: 'Empty event' };
    const tickets = [];

    const pdfBuffer = await buildTicketsPdf({ event, tickets });

    assert.ok(Buffer.isBuffer(pdfBuffer));
    assert.equal(pdfBuffer.slice(0, 4).toString(), '%PDF');
    const endStr = pdfBuffer.slice(-100).toString();
    assert.match(endStr, /%%EOF/);
  });
});
