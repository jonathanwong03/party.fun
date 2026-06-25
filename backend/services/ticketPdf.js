import PDFDocument from 'pdfkit';
import { qrPngBuffer } from './qrCode.js';

const ORANGE = '#ff4d2e';

// Build a printable PDF with one page per ticket; each page shows the event
// details and that ticket's own QR (encoding its qrCode for individual entry).
// `tickets` = [{ qrCode }] (active tickets only), `event` = { title, dateText, location, reference }.
export async function buildTicketsPdf({ event, tickets }) {
  const doc = new PDFDocument({ size: 'A4', margin: 56 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const list = tickets.length ? tickets : [];
  for (let i = 0; i < list.length; i++) {
    if (i > 0) doc.addPage();
    const t = list[i];
    const qr = await qrPngBuffer(t.qrCode);

    doc.fillColor(ORANGE).fontSize(30).font('Helvetica-Bold').text('party.fun', { align: 'center' });
    doc.moveDown(0.4);
    doc.fillColor('#111').fontSize(13).font('Helvetica')
      .text('Present this QR code at the door for entry.', { align: 'center' });
    doc.moveDown(1.5);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const qrSize = 230;
    doc.image(qr, doc.page.margins.left + (pageW - qrSize) / 2, doc.y, { width: qrSize, height: qrSize });
    doc.y += qrSize + 20;

    doc.fillColor('#111').fontSize(20).font('Helvetica-Bold').text(event.title, { align: 'center' });
    doc.moveDown(0.6);
    doc.fontSize(12).font('Helvetica').fillColor('#444');
    if (event.dateText) doc.text(event.dateText, { align: 'center' });
    if (event.location) doc.text(event.location, { align: 'center' });
    doc.moveDown(0.6);
    doc.fillColor('#888').fontSize(10)
      .text(`Ticket ${i + 1} of ${list.length}  •  Ref ${event.reference ?? ''}`, { align: 'center' });
    doc.fillColor('#aaa').fontSize(8).text(t.qrCode, { align: 'center' });
  }

  if (list.length === 0) {
    doc.fillColor('#111').fontSize(16).text('No active tickets for this booking.', { align: 'center' });
  }

  doc.end();
  return done;
}
