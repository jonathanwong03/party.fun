import QRCode from 'qrcode';

export const dependencies = {
  toBuffer: async (text, opts) => QRCode.toBuffer(text, opts),
};

// Render a QR code (encoding the given text) as a PNG.
const OPTS = { margin: 1, width: 320, errorCorrectionLevel: 'M' };

export async function qrPngBuffer(text) {
  return dependencies.toBuffer(String(text), { type: 'png', ...OPTS });
}

export async function qrPngBase64(text) {
  return (await qrPngBuffer(text)).toString('base64');
}

