import * as stripeModule from "../netlify/functions/lib/stripe.js";
import kitBytes from "../netlify/functions/assets/AEOGEO-Search-Directory-Listing-Kit.docx";

const { stripe } = stripeModule;
const PRICE_IDS = ["price_1UaHa5BIJX5f6WmhiJwYMHlO", "price_1UayqxBIJX5f6WmhOyuMvPCR"];
const PRODUCT = "directory-listing-kit";
const FILENAME = "AEOGEO-Search-Directory-Listing-Kit.docx";
const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function text(status, message) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default async function handler(event) {
  if ((event.httpMethod || "GET") !== "GET") return text(405, "Method not allowed.");
  const sessionId = (event.queryStringParameters || {}).session_id || "";
  if (!/^cs_(test|live)_[A-Za-z0-9_-]{8,}$/.test(sessionId)) {
    return text(400, "A valid checkout session is required. Reference: DL_BAD_REQUEST.");
  }

  try {
    const session = await stripe(`checkout/sessions/${sessionId}`, { method: "GET" });
    if (!session || session.payment_status !== "paid") return text(402, "This checkout has not been paid. Reference: DL_NOT_PAID.");
    if (String(session.currency || "").toLowerCase() !== "usd") return text(403, "This receipt is not for the listed product. Reference: DL_MISMATCH.");
    if (Number(session.amount_total) !== 4700) return text(403, "This receipt does not match the Directory Listing Kit. Reference: DL_MISMATCH.");
    if (!session.metadata || session.metadata.product !== PRODUCT) return text(403, "This receipt does not match this product. Reference: DL_MISMATCH.");

    const items = await stripe(`checkout/sessions/${sessionId}/line_items`, { method: "GET" });
    const priceIds = (items && Array.isArray(items.data) ? items.data : []).map(item => item && item.price && item.price.id).filter(Boolean);
    if (!priceIds.some(id => PRICE_IDS.includes(id))) return text(403, "This receipt is for a different product. Reference: DL_MISMATCH.");

    return new Response(kitBytes, {
      status: 200,
      headers: {
        "Content-Type": MIME,
        "Content-Disposition": `attachment; filename="${FILENAME}"`,
        "Cache-Control": "private, no-store",
        "Content-Length": String(kitBytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const status = error && error.status === 404 ? 404 : (error && error.status) || 503;
    const message = (error && error.message) ? String(error.message).slice(0, 300) : "The download is unavailable right now. Reference: DL_FALLBACK.";
    console.error("kit-download failed", status, error && error.code ? error.code : "unknown");
    return text(status, message);
  }
}
