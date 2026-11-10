'use strict';
// Verifies the Stripe Checkout session before releasing the kit.
// Never exposes the file path or contents before Stripe confirms payment.
const fs = require('node:fs');
const path = require('node:path');
const { stripe } = require('./lib/stripe');

const PRICE_ID = 'price_1UaHa5BIJX5f6WmhiJwYMHlO';
const PRODUCT = 'directory-listing-kit';
const FILENAME = 'AEOGEO-Search-Directory-Listing-Kit.docx';
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Netlify may lay the bundled asset out differently depending on the build
// setup; cover the common layouts (next to the function, repo root relative,
// and repo-relative under cwd). process.cwd() is normally the repo root.
const CANDIDATES = [
  path.join(process.cwd(), 'assets', FILENAME),
  path.join(__dirname, 'assets', FILENAME),
  path.join(process.cwd(), 'netlify', 'functions', 'assets', FILENAME),
  path.join(__dirname, '..', '..', 'netlify', 'functions', 'assets', FILENAME),
  path.join(process.cwd(), FILENAME),
  path.join(__dirname, FILENAME)
];

function text(status, message) {
  return { statusCode: status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, body: message };
}

exports.handler = async event => {
  if ((event.httpMethod || 'GET') !== 'GET') return text(405, 'Method not allowed.');
  const sessionId = (event.queryStringParameters || {}).session_id || '';
  if (!/^cs_(test|live)_[A-Za-z0-9_-]{8,}$/.test(sessionId)) return text(400, 'A valid checkout session is required. Reference: DL_BAD_REQUEST.');

  try {
    const session = await stripe(`checkout/sessions/${sessionId}`, { method: 'GET' });
    if (!session || session.payment_status !== 'paid') return text(402, 'This checkout has not been paid. Reference: DL_NOT_PAID.');
    if (String(session.currency || '').toLowerCase() !== 'usd') return text(403, 'This receipt is not for the listed product. Reference: DL_MISMATCH.');
    if (Number(session.amount_total) !== 4700) return text(403, 'This receipt does not match the Directory Listing Kit. Reference: DL_MISMATCH.');
    if (!session.metadata || session.metadata.product !== PRODUCT) return text(403, 'This receipt does not match this product. Reference: DL_MISMATCH.');

    const items = await stripe(`checkout/sessions/${sessionId}/line_items`, { method: 'GET' });
    const priceIds = (items && Array.isArray(items.data) ? items.data : []).map(item => item && item.price && item.price.id).filter(Boolean);
    if (!priceIds.includes(PRICE_ID)) return text(403, 'This receipt is for a different product. Reference: DL_MISMATCH.');

    let buffer = null;
    for (const candidate of CANDIDATES) {
      try { buffer = fs.readFileSync(candidate); break; } catch { /* try next */ }
    }
    if (!buffer) {
      console.error('kit-download: asset missing from all candidate paths');
      return text(503, 'The kit file is temporarily unavailable. Reference: DL_FILE_MISSING.');
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': MIME,
        'Content-Disposition': `attachment; filename="${FILENAME}"`,
        'Cache-Control': 'private, no-store',
        'Content-Length': String(buffer.length),
        'X-Content-Type-Options': 'nosniff'
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    const status = error && error.status === 404 ? 404 : (error && error.status) || 503;
    const message = (error && error.message) ? String(error.message).slice(0, 300) : 'The download is unavailable right now. Reference: DL_FALLBACK.';
    console.error('kit-download failed', status, error && error.code ? error.code : 'unknown');
    return text(status, message);
  }
};
