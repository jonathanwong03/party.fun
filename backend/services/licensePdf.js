import PDFDocument from 'pdfkit';

const ORANGE = '#ff4d2e';

// A simple "Certificate of Administration" PDF for an admin's license.
// license = { username, licenseId, issued, validity }
export async function buildLicensePdf(license) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 50 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const w = doc.page.width, h = doc.page.height;
  doc.lineWidth(3).strokeColor(ORANGE).rect(28, 28, w - 56, h - 56).stroke();
  doc.lineWidth(1).strokeColor('#e5e5e5').rect(40, 40, w - 80, h - 80).stroke();

  doc.moveDown(2);
  doc.fillColor(ORANGE).font('Helvetica-Bold').fontSize(34).text('party.fun', { align: 'center' });
  doc.moveDown(0.3);
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(22).text('Certificate of Administration', { align: 'center' });
  doc.moveDown(1.4);

  doc.fillColor('#555').font('Helvetica').fontSize(13).text('This certifies that', { align: 'center' });
  doc.moveDown(0.5);
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(28).text(license.username, { align: 'center' });
  doc.moveDown(0.7);
  doc.fillColor('#444').font('Helvetica').fontSize(13)
    .text('is a Licensed Administrator of party.fun, authorised to moderate and manage events, perform ticket check-ins, and access platform analytics.',
      { align: 'center', width: w - 220, indent: 0, paragraphGap: 0, lineGap: 2 });

  doc.moveDown(1.6);
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(12).text(`License ID:  ${license.licenseId}`, { align: 'center' });
  doc.font('Helvetica').fillColor('#444').fontSize(12);
  doc.moveDown(0.2).text(`Issued:  ${license.issued}`, { align: 'center' });
  doc.moveDown(0.2).text(license.validity, { align: 'center' });

  doc.end();
  return done;
}
