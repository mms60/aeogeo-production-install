# Studio paid-path source bundle

Every file below is a byte-identical copy of the repository file at the path shown.
Hashes are SHA-256 of the exact bytes in this folder.

| Area | File | Repo path | Lines | Bytes | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| 1. Browser client | [entity-authority-tool.js](./entity-authority-tool.js) | `site/assets/entity-authority-tool.js` | 1307 | 59964 | `2c3773a50ba5219edb6f75048bb7f7816582f513e40315eb982be703ba4d6164` |
| 2. Server graph compiler | [entity-graph-builder.js](./entity-graph-builder.js) | `netlify/functions/lib/entity-graph-builder.js` | 246 | 9149 | `916965df27f6237bc5ed37afd9b98eba1fa9895fe2597a431843e7efb74fd941` |
| 2. Server graph compiler | [entity-implementation.mjs](./entity-implementation.mjs) | `netlify/functions/entity-implementation.mjs` | 64 | 2097 | `a23df0d06ed76a049feac401e8fd897a032379c24735eed68fa16f34e4b4ce81` |
| 2. Server graph compiler | [avss-shared.mjs](./avss-shared.mjs) | `netlify/functions/avss-shared.mjs` | 114 | 6565 | `5cbf1602cb02ff466062011a720e1c4a50714ed4b9953c97278ce94d7727deaf` |
| 3. Entitlement | [entity-entitlement.mjs](./entity-entitlement.mjs) | `netlify/functions/entity-entitlement.mjs` | 27 | 841 | `b11f9f2b756b8021dfc186bf49c3acd5a31abb3db2e699a6241fce1f4dacc9d3` |
| 3. Entitlement | [entity-purchases.js](./entity-purchases.js) | `netlify/functions/lib/entity-purchases.js` | 386 | 14642 | `cf3fe948e0d0ce84d82554fafb36c3519ef7b9b538ce953f817bc91dfa50f63f` |
| 3. Entitlement | [entity-purchase-claim.mjs](./entity-purchase-claim.mjs) | `netlify/functions/entity-purchase-claim.mjs` | 23 | 751 | `36c75653073c5f1b5c54e2323c1140ecbf0ccee730f2444d323dad8ae351253a` |
| 3. Entitlement | [db.js](./db.js) | `netlify/functions/lib/db.js` | 47 | 4901 | `b78dc0210438869b8b442282bc34b5eaaadc9d03d006679d38941800ce887a31` |
| 4. Stripe | [entity-authority-checkout.js](./entity-authority-checkout.js) | `netlify/functions/entity-authority-checkout.js` | 266 | 9485 | `c1a0d7dc6a3687ba61346ab264efab4174b5de19308214e8771066bac644091f` |
| 4. Stripe | [stripe.js](./stripe.js) | `netlify/functions/lib/stripe.js` | 16 | 2358 | `24ff8f9ae49d7c37b6cd0a16d4c07193304d6681fc92d284d2969bdc4404b73f` |
| 4. Stripe | [stripe-credential.js](./stripe-credential.js) | `netlify/functions/lib/stripe-credential.js` | 34 | 2119 | `88333144454c6887dc20711bd1a707af67ad29f018aef29916fd83a5890c0b2d` |
| 4. Stripe | [stripe-webhook.js](./stripe-webhook.js) | `netlify/functions/stripe-webhook.js` | 32 | 2581 | `d1f83976247f394b540ad6c3d21fb23f678d0a07ccaf1ad9cbf21fb0c5ab000f` |
| 5. Database | [10-entity-purchases.sql](./10-entity-purchases.sql) | `database/10-entity-purchases.sql` | 37 | 1671 | `a712eaa91df06439dfa74efe805f87e9abb6c553ffe0a28dfeb332b69f9fb7e4` |
| 6. Verification | [verify-entity-gate.mjs](./verify-entity-gate.mjs) | `artifacts/verify-entity-gate.mjs` | 510 | 25578 | `d164e1e714a4ca9713495ed93f95882e053024a08013abd9e739c68cd2472cb4` |

## Reading order for the protection question

1. `entity-implementation.mjs` — the only path that returns complete JSON-LD. Auth and entitlement happen before the body is read or the compiler is called.
2. `entity-purchases.js` — `sessionIsPaid` (payment truth), `entitlementForUser` (who is paid), `validateImplementationInput` (plan limits), `validateGraph` (output integrity), `handleWebhook` (recording/revocation).
3. `entity-authority-tool.js` — confirm the browser only renders a paid graph after a 200 response containing `jsonLd`, and that the free preview and demo have no such data.
4. `entity-authority-checkout.js` and `stripe.js`/`stripe-webhook.js` — server-owned pricing, account binding, signature verification, per-event revalidation.
5. `10-entity-purchases.sql` — RLS is enabled; the only policy is SELECT for the owning user; there are no INSERT/UPDATE/DELETE policies.

`ALL-CODE.md` in this folder contains every file concatenated with a header.
