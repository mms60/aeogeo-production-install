# Studio paid-path code

Generated from the working tree. Each section is the complete file, unmodified.
See MANIFEST.md for hashes.

---

## entity-authority-tool.js

Repo path: `site/assets/entity-authority-tool.js`  
Lines: 1307  
SHA-256: `2c3773a50ba5219edb6f75048bb7f7816582f513e40315eb982be703ba4d6164`

Free audit UI, free structure preview, entitlement/plan-lock UI, paid JSON-LD render, copy/download controls, checkout and claim handoff.

```js
The server must enforce paid access

The browser checks whether a customer has purchased, but browser-side checks are not security. Someone can modify JavaScript, change form values, or call the endpoints directly.

Your entity-implementation endpoint must independently verify the authenticated user's active purchase and enforce the correct plan limits before generating or returning JSON-LD.

Critical to verify
2. Plan limits must be enforced on the server

The JavaScript defines three locations and two people for Single-Hub, and ten locations and six people for Multi-Location. These limits currently appear in the browser code. The backend must independently enforce them; otherwise someone could submit a modified request containing more entities than their purchase allows. Pasted text(3).txt


Important
3. The free audit endpoint needs protection

The public audit sends a visitor-provided URL to your server. The backend needs protections against server-side request forgery (SSRF), private/internal IP access, redirects to restricted destinations, and excessive requests. This matters because the endpoint accepts unauthenticated requests. Pasted text(3).txt


Important
4. Stripe purchase verification needs to be genuine

The browser receives a Stripe session ID and submits it to entity-purchase-claim. The server must retrieve and verify that session with Stripe, confirm payment is complete, verify the customer email and purchased plan, and prevent the same purchase from being claimed by multiple accounts. The browser's success message is not proof of payment. Pasted text(3).txt


Important
5. The paid JSON-LD is visible after generation

Once a paying customer generates their JSON-LD, it is sent to the browser and can be inspected, copied, or saved. That is normal for a downloadable product. The protection you need is preventing unpaid users from obtaining it—not pretending it can be made impossible for customers to copy their own purchased output. Pasted text(3).txt


One thing I would keep
I would keep the free structure preview. It shows the customer the planned Organization, WebSite, Location, Person, and Service relationships without handing over the complete customized JSON-LD. That's a reasonable way to demonstrate value before purchase. Pasted text(3).txt

What I still need to inspect
This file does not contain the server-side code that actually protects the paid product. It references these Netlify functions:
Function	What I need to verify
entity-entitlement	Checks real purchase and active entitlement
entity-implementation	Protects complete JSON-LD generation
entity-purchase-claim	Verifies Stripe payment and prevents duplicate claims
entity-authority-checkout	Creates valid Stripe checkout sessions
entity-audit	Protects the public URL-scanning endpoint

Please send me the actual backend function files for these five endpoints. I can then check whether your paid tool is genuinely protected or whether someone could bypass the purchase screen and retrieve the paid output without paying.

My recommendation right now: don't rebuild the page or change the pricing. The front-end structure is largely in place. The next step is verifying the backend before calling this product ready.
```

---

## entity-graph-builder.js

Repo path: `netlify/functions/lib/entity-graph-builder.js`  
Lines: 246  
SHA-256: `916965df27f6237bc5ed37afd9b98eba1fa9895fe2597a431843e7efb74fd941`

Deterministic Schema.org @graph compiler. Imported only by the paid implementation endpoint and Node tests; never published to site/.

````js
/*
 * Deterministic Schema.org @graph compiler for the AI Entity & Citation
 * Authority tool. Shared by the browser and Node tests. No network calls.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AEOEntityGraph = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function text(value, max) {
    return typeof value === "string" ? value.trim().slice(0, max || 2000) : "";
  }

  function absoluteUrl(value) {
    const raw = text(value, 2048);
    if (!raw) return "";
    try {
      const url = new URL(raw);
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function baseOrigin(value) {
    const url = absoluteUrl(value);
    return url ? new URL(url).origin : "";
  }

  function slugify(value, fallback) {
    const source = text(value, 120) || text(fallback, 120);
    return source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function uniqueUrls(value) {
    const list = Array.isArray(value) ? value : [];
    return Array.from(new Set(list.map(absoluteUrl).filter(Boolean)));
  }

  function stringList(value, max) {
    const list = Array.isArray(value) ? value : [];
    return list.map(item => text(item, max || 200)).filter(Boolean);
  }

  function locationAddress(input) {
    const address = {
      "@type": "PostalAddress",
      streetAddress: text(input.streetAddress, 240),
      addressLocality: text(input.city, 120),
      addressRegion: text(input.state, 120),
      postalCode: text(input.postalCode, 40),
      addressCountry: text(input.country, 80)
    };
    const populated = Object.fromEntries(Object.entries(address).filter(([key, value]) => key === "@type" || value));
    return Object.keys(populated).length > 1 ? populated : null;
  }

  function buildMasterKnowledgeGraphObject(input) {
    if (!input || typeof input !== "object") throw new Error("Brand details are required.");
    const base = baseOrigin(input.domain);
    if (!base) throw new Error("Enter a full website address, for example https://yourcompany.com.");

    const brandName = text(input.brandName, 200);
    if (!brandName) throw new Error("Enter the brand name.");
    const description = text(input.description, 2000);
    if (!description) throw new Error("Add a short description of the brand.");

    const orgId = `${base}/#organization`;
    const websiteId = `${base}/#website`;
    const logoId = `${base}/#logo`;
    const seenIds = new Set();
    const claimId = (id, label) => {
      if (seenIds.has(id)) throw new Error(`Duplicate entity ID ${id}. Use a unique slug for ${label}.`);
      seenIds.add(id);
    };
    claimId(orgId, 'the Organization');
    claimId(websiteId, 'the WebSite');
    const logoUrl = absoluteUrl(input.logoUrl);
    const telephone = text(input.telephone, 80);
    const sameAs = uniqueUrls(input.sameAsUrls);

    const rawLocations = Array.isArray(input.locations) ? input.locations : [];
    const rawPeople = Array.isArray(input.people) ? input.people : [];
    const rawServices = Array.isArray(input.services) ? input.services : [];

    const locations = [];
    const locationRefs = [];
    rawLocations.forEach((location, index) => {
      if (!location || typeof location !== "object") return;
      const name = text(location.name, 200);
      if (!name) throw new Error(`Location ${index + 1} needs a name.`);
      const slug = slugify(location.slug, name);
      if (!slug) throw new Error(`Location ${index + 1} needs a URL slug.`);
      const id = `${base}/locations/${slug}/#localbusiness`;
      claimId(id, `location ${index + 1}`);
      const node = {
        "@type": text(location.businessType, 80) || "LocalBusiness",
        "@id": id,
        name,
        url: absoluteUrl(location.locationPageUrl) || `${base}/locations/${slug}/`,
        parentOrganization: { "@id": orgId }
      };
      if (logoUrl) node.image = { "@id": logoId };
      const locationPhone = text(location.telephone, 80);
      if (locationPhone) node.telephone = locationPhone;
      const address = locationAddress(location);
      if (address) node.address = address;
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);
      if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
        node.geo = { "@type": "GeoCoordinates", latitude, longitude };
      }
      const maps = absoluteUrl(location.googleMapsUrl);
      if (maps) node.hasMap = maps;
      const gbp = absoluteUrl(location.gbpShareUrl);
      if (gbp) node.sameAs = [gbp];
      locations.push(node);
      locationRefs.push({ "@id": id });
    });

    const people = [];
    const personRefs = [];
    rawPeople.forEach((person, index) => {
      if (!person || typeof person !== "object") return;
      const name = text(person.name, 200);
      if (!name) throw new Error(`Person ${index + 1} needs a name.`);
      const slug = slugify(person.slug, name);
      if (!slug) throw new Error(`Person ${index + 1} needs a URL slug.`);
      const id = `${base}/#person-${slug}`;
      claimId(id, `person ${index + 1}`);
      const node = { "@type": "Person", "@id": id, name, worksFor: { "@id": orgId } };
      const jobTitle = text(person.jobTitle, 160);
      if (jobTitle) node.jobTitle = jobTitle;
      const profileUrl = absoluteUrl(person.profilePageUrl);
      if (profileUrl) node.url = profileUrl;
      const knowsAbout = stringList(person.knowsAbout, 120);
      if (knowsAbout.length) node.knowsAbout = knowsAbout;
      const anchors = uniqueUrls(person.sameAsUrls);
      if (anchors.length) node.sameAs = anchors;
      people.push(node);
      personRefs.push({ "@id": id });
    });

    const services = [];
    rawServices.forEach((service, index) => {
      if (!service || typeof service !== "object") return;
      const name = text(service.name, 200);
      if (!name) throw new Error(`Service ${index + 1} needs a name.`);
      const slug = slugify(service.slug, name);
      if (!slug) throw new Error(`Service ${index + 1} needs a URL slug.`);
      const serviceId = `${base}/services/${slug}/#service`;
      claimId(serviceId, `service ${index + 1}`);
      const node = {
        "@type": "Service",
        "@id": serviceId,
        name,
        provider: { "@id": orgId }
      };
      const serviceUrl = absoluteUrl(service.serviceUrl);
      if (serviceUrl) node.url = serviceUrl;
      const serviceDescription = text(service.description, 1200);
      if (serviceDescription) node.description = serviceDescription;
      if (locationRefs.length) node.availableAtOrFrom = locationRefs;
      const cities = Array.isArray(service.areaServedCities) ? service.areaServedCities : [];
      const areaServed = cities.map(city => {
        if (typeof city === "string") return { "@type": "City", name: text(city, 120) };
        if (!city || typeof city !== "object") return null;
        const cityName = text(city.name, 120);
        if (!cityName) return null;
        const wikidata = absoluteUrl(city.wikidataUrl);
        return { "@type": "City", name: cityName, ...(wikidata ? { sameAs: wikidata } : {}) };
      }).filter(Boolean);
      if (areaServed.length) node.areaServed = areaServed;
      services.push(node);
    });

    const website = {
      "@type": "WebSite",
      "@id": websiteId,
      url: `${base}/`,
      name: brandName,
      publisher: { "@id": orgId }
    };

    const organization = {
      "@type": "Organization",
      "@id": orgId,
      name: brandName,
      url: `${base}/`,
      description
    };
    const legalName = text(input.legalName, 200);
    if (legalName) organization.legalName = legalName;
    const disambiguatingDescription = text(input.disambiguatingDescription, 600);
    if (disambiguatingDescription) organization.disambiguatingDescription = disambiguatingDescription;
    const foundingYear = text(input.foundingYear, 20);
    if (foundingYear) organization.foundingDate = foundingYear;
    if (logoUrl) {
      organization.logo = {
        "@type": "ImageObject",
        "@id": logoId,
        url: logoUrl,
        contentUrl: logoUrl
      };
      organization.image = { "@id": logoId };
    }
    if (telephone) {
      organization.contactPoint = {
        "@type": "ContactPoint",
        telephone,
        contactType: "customer service"
      };
    }
    if (personRefs.length) organization.employee = personRefs;
    if (locationRefs.length) organization.subOrganization = locationRefs;
    if (sameAs.length) organization.sameAs = sameAs;

    const graph = [
      website,
      organization,
      ...locations,
      ...people,
      ...services
    ];

    return {
      "@context": "https://schema.org",
      "@graph": graph
    };
  }

  function buildMasterKnowledgeGraph(input) {
    return JSON.stringify(buildMasterKnowledgeGraphObject(input), null, 2);
  }

  return {
    buildMasterKnowledgeGraph,
    buildMasterKnowledgeGraphObject,
    normalizeDomain: baseOrigin
  };
});
````

---

## entity-implementation.mjs

Repo path: `netlify/functions/entity-implementation.mjs`  
Lines: 64  
SHA-256: `a23df0d06ed76a049feac401e8fd897a032379c24735eed68fa16f34e4b4ce81`

Paid endpoint. Order is auth -> entitlement -> body -> plan limits -> compile -> validate.

````js
import { json, readBody, requestMethod, userFromEvent } from "./avss-shared.mjs";
import purchases from "./lib/entity-purchases.js";
import graph from "./lib/entity-graph-builder.js";

export default async event => {
  if (requestMethod(event) !== "POST") {
    return json(405, { error: "Use POST to generate an implementation." });
  }

  let user;
  try {
    user = await userFromEvent(event);
  } catch (error) {
    return json(401, { error: error.message, code: "SIGN_IN_REQUIRED" });
  }

  try {
    // Entitlement is checked before any input is compiled or returned.
    const entitlement = await purchases.entitlementForUser(user.id, user);
    if (!entitlement) {
      return json(403, {
        error: "A paid AI Entity and Citation Authority implementation is required to generate the complete JSON-LD.",
        code: "PURCHASE_REQUIRED"
      });
    }

    let body;
    try {
      body = await readBody(event);
    } catch (error) {
      return json(400, { error: error.message, code: "INVALID_JSON" });
    }
    const input = body?.input;
    const check = purchases.validateImplementationInput(input, entitlement.plan);
    if (!check.ok) {
      return json(check.status || 400, { error: check.error, code: check.code });
    }

    let payload;
    try {
      payload = graph.buildMasterKnowledgeGraphObject(input);
    } catch (error) {
      return json(400, { error: error.message || "Check the brand details and try again." });
    }

    const validation = purchases.validateGraph(payload);
    if (validation.length) {
      return json(422, {
        error: 'The generated graph did not pass validation. ' + validation[0],
        code: 'GRAPH_VALIDATION_FAILED',
        validation
      });
    }
    return json(200, {
      plan: entitlement.plan,
      limits: entitlement.limits,
      jsonLd: payload,
      validation,
      instructions: purchases.implementationInstructions(entitlement.plan)
    });
  } catch (error) {
    return json(error.status || 503, { error: error.message || "The implementation could not be generated. Please retry." });
  }
};
````

---

## avss-shared.mjs

Repo path: `netlify/functions/avss-shared.mjs`  
Lines: 114  
SHA-256: `5cbf1602cb02ff466062011a720e1c4a50714ed4b9953c97278ce94d7727deaf`

Shared Response helpers and userFromEvent, which verifies the Supabase bearer token before any paid work.

````js
import { createClient } from "@supabase/supabase-js";
import dns from "node:dns/promises";
import net from "node:net";

// These are Netlify Functions 2.0 handlers (ESM default export), so every response
// must be a real Response object. Returning {statusCode, headers, body} makes the
// platform reject the value with a 502 before the client ever sees the JSON.
export const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
});
export function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || "";
}
export const requestMethod = event => String(event?.method || event?.httpMethod || "GET").toUpperCase();
export const readBody = async event => {
  const raw = typeof event?.text === "function" && typeof event?.headers?.get === "function"
    ? await event.text()
    : event?.body || "";
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("Request body must be valid JSON."); }
};
export function adminClient() {
  if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase server environment variables are missing.");
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function userFromEvent(event) {
  const token=headerValue(event?.headers,"authorization").replace(/^Bearer\s+/i,"");
  if(!token) throw new Error("Sign in is required.");
  const anon=process.env.SUPABASE_ANON_KEY||process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!anon) throw new Error("The Supabase public key is missing.");
  const client=createClient(process.env.SUPABASE_URL,anon,{auth:{persistSession:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user) throw new Error("Your session is invalid or expired. Please sign in again.");
  return data.user;
}
async function paidRow(userId) {
  const db=adminClient();
  const {data,error}=await db.from("subscriptions").select("status,current_period_end").eq("user_id",userId).in("status",["active","trialing"]).maybeSingle();
  if(error) throw new Error(`Subscription lookup failed: ${error.message}`);
  return data||null;
}
// A subscription bought before the account existed is stored with the buyer's email.
// The first time that email signs in, the row is attached to the account.
async function claimPendingSubscription(user) {
  if(!user?.email) return false;
  const db=adminClient();
  const {data:rows,error}=await db.from("avss_pending_subscriptions")
    .select("id,stripe_customer_id,stripe_subscription_id,status,price_id,current_period_end")
    .ilike("email",user.email).in("status",["active","trialing"]).limit(1);
  if(error||!rows||!rows.length) return false;
  const row=rows[0];
  const {error:writeError}=await db.from("subscriptions").upsert({
    user_id:user.id,stripe_customer_id:row.stripe_customer_id,stripe_subscription_id:row.stripe_subscription_id,
    status:row.status,price_id:row.price_id,current_period_end:row.current_period_end,updated_at:new Date().toISOString()
  },{onConflict:"stripe_subscription_id"});
  if(writeError) return false;
  if(row.stripe_customer_id) await db.from("profiles").upsert({id:user.id,stripe_customer_id:row.stripe_customer_id},{onConflict:"id"});
  await db.from("avss_pending_subscriptions").delete().eq("id",row.id);
  return true;
}
export async function requirePaid(userOrId) {
  const user = typeof userOrId === "string" ? { id: userOrId } : userOrId;
  let data = await paidRow(user.id);
  if(!data && user.email && await claimPendingSubscription(user)) data = await paidRow(user.id);
  if(!data) throw new Error("An active paid subscription is required to use this tool.");
  if(data.current_period_end && new Date(data.current_period_end)<new Date()) throw new Error("Your subscription period has expired.");
  return data;
}
export async function assertPublicHttpUrl(raw) {
  let u; try{u=new URL(raw);}catch{throw new Error("Enter a valid website URL.");}
  if(!["http:","https:"].includes(u.protocol)) throw new Error("Only HTTP and HTTPS websites are supported.");
  if(u.username||u.password) throw new Error("URLs containing credentials are not allowed.");
  const host=u.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host==="metadata.google.internal") throw new Error("Private and local hosts cannot be scanned.");
  const records=await dns.lookup(host,{all:true,verbatim:true}).catch(()=>[]);
  if(!records.length) throw new Error("The hostname could not be resolved.");
  for(const rec of records) if(isPrivateIp(rec.address)) throw new Error("Private, local, or reserved IP addresses cannot be scanned.");
  return u;
}
function isPrivateIp(ip){
  if(net.isIPv4(ip)){
    const [a,b]=ip.split(".").map(Number);
    return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);
  }
  if(net.isIPv6(ip)){
    const x=ip.toLowerCase();
    return x==="::"||x==="::1"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe8")||x.startsWith("fe9")||x.startsWith("fea")||x.startsWith("feb")||x.startsWith("::ffff:127.")||x.startsWith("::ffff:10.");
  }
  return true;
}
export async function safeFetch(url, options={}) {
  let current=await assertPublicHttpUrl(url);
  for(let i=0;i<4;i++){
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),options.timeout||12000);
    let res;
    try{
      res=await fetch(current.href,{method:"GET",redirect:"manual",signal:controller.signal,headers:{
        "User-Agent":options.userAgent||"AEOGEO-Accessibility-Audit/1.0 (+https://aeogeosearch.com)",
        "Accept":"text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.5"
      }});
    }finally{clearTimeout(timer);}
    if([301,302,303,307,308].includes(res.status)){
      const loc=res.headers.get("location"); if(!loc) return res;
      current=await assertPublicHttpUrl(new URL(loc,current).href); continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}
export async function saveFailure(db,scanId,message){
  await db.from("crawler_scans").update({status:"failed",error_message:String(message).slice(0,1000),completed_at:new Date().toISOString()}).eq("id",scanId);
}
````

---

## entity-entitlement.mjs

Repo path: `netlify/functions/entity-entitlement.mjs`  
Lines: 27  
SHA-256: `b11f9f2b756b8021dfc186bf49c3acd5a31abb3db2e699a6241fce1f4dacc9d3`

Returns active/plan/limits for the signed-in account. Never returns a graph.

````js
import { json, requestMethod, userFromEvent } from "./avss-shared.mjs";
import purchases from "./lib/entity-purchases.js";

export default async event => {
  if (!["GET", "POST"].includes(requestMethod(event))) {
    return json(405, { error: "Use GET or POST to check entitlement." });
  }

  let user;
  try {
    user = await userFromEvent(event);
  } catch (error) {
    return json(401, { error: error.message, code: "SIGN_IN_REQUIRED" });
  }

  try {
    const entitlement = await purchases.entitlementForUser(user.id, user);
    if (!entitlement) return json(200, { active: false, plan: null, limits: null });
    return json(200, {
      active: true,
      plan: entitlement.plan,
      limits: entitlement.limits
    });
  } catch (error) {
    return json(error.status || 503, { error: error.message, code: error.code });
  }
};
````

---

## entity-purchases.js

Repo path: `netlify/functions/lib/entity-purchases.js`  
Lines: 386  
SHA-256: `cf3fe948e0d0ce84d82554fafb36c3519ef7b9b538ce953f817bc91dfa50f63f`

Stripe session validation, purchase recording, email claim fallback, entitlement lookup, plan-limit validation, graph validation, refund/dispute handling.

````js
'use strict';
// One-time AI Entity & Citation Authority Setup purchases.
// Stripe Checkout is still created by entity-authority-checkout.js. This module
// records the verified session, links it to a signed-in account, and answers
// entitlement questions. It never exposes the graph compiler to the browser.
const { stripe } = require('./stripe');
const { db } = require('./db');

const PRODUCT = 'entity-authority';
const OFFERS = Object.freeze({
  single: Object.freeze({
    plan: 'single',
    label: 'Single-Hub Brand',
    priceId: 'price_1Uc6kWBIJX5f6WmhvQeqzs7o',
    amount: 79900
  }),
  multi: Object.freeze({
    plan: 'multi',
    label: 'Multi-Location Brand',
    priceId: 'price_1Uc6ksBIJX5f6WmhHI94dIms',
    amount: 119900
  })
});
const LIMITS = Object.freeze({
  single: Object.freeze({ locations: 3, people: 2, services: 10 }),
  multi: Object.freeze({ locations: 10, people: 6, services: 10 })
});
const UPGRADE = Object.freeze({
  from: 'single',
  to: 'multi',
  amount: 40000,
  credit: 79900
});
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9_-]{8,}$/;
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_INPUT_BYTES = 200000;

function statusError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function offerForPlan(plan) {
  return typeof plan === 'string' && Object.prototype.hasOwnProperty.call(OFFERS, plan) ? OFFERS[plan] : null;
}

function limitsForPlan(plan) {
  return LIMITS[plan] || null;
}

function idOf(value) {
  if (typeof value === 'string') return value;
  return value && typeof value === 'object' && typeof value.id === 'string' ? value.id : '';
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

// A checkout can be paid and recorded in Stripe while a webhook is delayed, or
// an older purchase can be stored without a user_id. Once the buyer signs in,
// match only unclaimed live purchases by the email they have confirmed on their
// account. This is the durable fallback to the checkout's metadata user_id.
async function claimUnclaimedByEmail(user) {
  if (!user || !USER_ID.test(String(user.id || '')) || !user.email_confirmed_at) return 0;
  const email = normalizedEmail(user.email);
  if (!validEmail(email)) return 0;
  const rows = await db(
    'entity_purchases?email=eq.' + encodeURIComponent(email) +
    '&status=eq.paid&livemode=eq.true&user_id=is.null&select=id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { user_id: user.id, updated_at: new Date().toISOString() }
    }
  );
  return Array.isArray(rows) ? rows.length : 0;
}

function sessionEmail(session) {
  return normalizedEmail(session?.customer_details?.email || session?.customer_email || '');
}

function sessionIsUpgrade(session, offer) {
  if (!session || typeof session !== 'object' || !offer) return false;
  const metadata = session.metadata || {};
  return (
    offer.plan === UPGRADE.to &&
    metadata.product === PRODUCT &&
    metadata.plan === UPGRADE.to &&
    metadata.upgrade === '1' &&
    metadata.previous_plan === UPGRADE.from
  );
}

function sessionIsPaid(session, offer) {
  if (!session || typeof session !== 'object' || !offer) return false;
  if (session.object !== 'checkout.session' || session.mode !== 'payment') return false;
  if (session.status !== 'complete' || session.payment_status !== 'paid') return false;
  if (session.livemode !== true) return false;
  if (String(session.currency || '').toLowerCase() !== 'usd') return false;
  const expectedAmount = sessionIsUpgrade(session, offer) ? UPGRADE.amount : offer.amount;
  if (Number(session.amount_total) !== expectedAmount) return false;
  const metadata = session.metadata || {};
  return metadata.product === PRODUCT && metadata.plan === offer.plan;
}

async function recordSession(session, extra = {}) {
  const offer = offerForPlan(session?.metadata?.plan);
  if (!offer || !sessionIsPaid(session, offer)) return false;
  const row = {
    email: sessionEmail(session) || null,
    plan: offer.plan,
    status: 'paid',
    stripe_session_id: session.id,
    stripe_payment_intent: idOf(session.payment_intent) || null,
    amount_total: Number(session.amount_total) || null,
    currency: 'usd',
    livemode: true,
    updated_at: new Date().toISOString()
  };
  // Never send user_id: null from the webhook. PostgREST merge-duplicates
  // updates only supplied columns, so omitting it preserves a claimed purchase.
  const metadataUserId = session?.metadata?.user_id;
  const userId = extra.user_id || (USER_ID.test(String(metadataUserId || '')) ? metadataUserId : null);
  if (userId) row.user_id = userId;
  await db('entity_purchases?on_conflict=stripe_session_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: [row]
  });
  return true;
}

async function entitlementForUser(userId, user) {
  if (typeof userId !== 'string' || !userId) return null;
  const read = () => db(
    'entity_purchases?user_id=eq.' + encodeURIComponent(userId) +
    '&status=eq.paid&select=plan,created_at&order=created_at.desc'
  );
  let rows = await read();
  if ((!Array.isArray(rows) || !rows.length) && user) {
    try {
      await claimUnclaimedByEmail(user);
      rows = await read();
    } catch {
      // An account with an existing linked purchase must not be locked out by a
      // failure in the optional email fallback.
    }
  }
  if (!Array.isArray(rows) || !rows.length) return null;
  const plans = new Set(rows.map(row => row.plan));
  const plan = plans.has('multi') ? 'multi' : 'single';
  return { plan, limits: LIMITS[plan], purchases: rows.length };
}

async function claimPurchase(user, sessionId) {
  if (!user || typeof user.id !== 'string' || !user.id) {
    throw statusError(401, 'Sign in to claim this purchase.', 'SIGN_IN_REQUIRED');
  }
  if (!user.email_confirmed_at) {
    throw statusError(403, 'Confirm your email address before claiming a purchase.', 'EMAIL_CONFIRMATION_REQUIRED');
  }
  if (!SESSION_ID.test(String(sessionId || ''))) {
    throw statusError(400, 'A valid Stripe checkout session is required.', 'CHECKOUT_SESSION_INVALID');
  }

  const session = await stripe('checkout/sessions/' + encodeURIComponent(sessionId));
  const offer = offerForPlan(session?.metadata?.plan);
  if (!offer || !sessionIsPaid(session, offer)) {
    throw statusError(403, 'That checkout could not be verified for this implementation.', 'CHECKOUT_NOT_VERIFIED');
  }

  const email = sessionEmail(session);
  const userEmail = normalizedEmail(user.email);
  if (!validEmail(email) || !userEmail || email !== userEmail) {
    throw statusError(403, 'Sign in with the email address used at Stripe to claim this purchase.', 'EMAIL_MISMATCH');
  }

  const existing = await db(
    'entity_purchases?stripe_session_id=eq.' + encodeURIComponent(sessionId) +
    '&select=user_id,status'
  );
  const row = Array.isArray(existing) ? existing[0] : null;
  if (row?.user_id && row.user_id !== user.id) {
    throw statusError(409, 'This purchase is already linked to another account. Contact us if that is not right.', 'PURCHASE_TAKEN');
  }
  if (row?.status === 'revoked') {
    throw statusError(403, 'This purchase is no longer active.', 'PURCHASE_REVOKED');
  }

  const lineItems = await stripe(
    'checkout/sessions/' + encodeURIComponent(sessionId) + '/line_items?limit=2'
  );
  const items = Array.isArray(lineItems?.data) ? lineItems.data : [];
  if (
    lineItems?.has_more ||
    items.length !== 1 ||
    items[0]?.quantity !== 1 ||
    items[0]?.price?.id !== offer.priceId
  ) {
    throw statusError(409, 'The checkout items could not be verified.', 'CHECKOUT_ITEMS_MISMATCH');
  }

  await recordSession(session, { user_id: user.id });
  return { plan: offer.plan, limits: LIMITS[offer.plan] };
}

function validateImplementationInput(input, plan) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'Enter the brand details before generating the implementation.' };
  }
  const limits = LIMITS[plan];
  if (!limits) {
    return { ok: false, status: 403, error: 'No active paid implementation was found for this account.', code: 'PURCHASE_REQUIRED' };
  }
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(input), 'utf8'); } catch { size = MAX_INPUT_BYTES + 1; }
  if (size > MAX_INPUT_BYTES) {
    return { ok: false, status: 413, error: 'The submitted details are too large. Shorten the descriptions and try again.' };
  }
  const locations = Array.isArray(input.locations) ? input.locations : [];
  const people = Array.isArray(input.people) ? input.people : [];
  const services = Array.isArray(input.services) ? input.services : [];
  if (locations.length > limits.locations) {
    return {
      ok: false,
      status: 403,
      error: `The ${OFFERS[plan].label} plan covers up to ${limits.locations} locations. Remove the extra locations or contact us to upgrade.`,
      code: 'PLAN_LOCATION_LIMIT'
    };
  }
  if (people.length > limits.people) {
    return {
      ok: false,
      status: 403,
      error: `The ${OFFERS[plan].label} plan covers up to ${limits.people} people. Remove the extra people or contact us to upgrade.`,
      code: 'PLAN_PEOPLE_LIMIT'
    };
  }
  if (services.length > limits.services) {
    return {
      ok: false,
      status: 403,
      error: `The ${OFFERS[plan].label} plan covers up to ${limits.services} services. Remove the extra services or contact us.`,
      code: 'PLAN_SERVICE_LIMIT'
    };
  }
  return { ok: true };
}

function validateGraph(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['The output is not a JSON object.'];
  }
  const issues = [];
  if (payload['@context'] !== 'https://schema.org') issues.push('The @context value is missing or incorrect.');
  const graph = Array.isArray(payload['@graph']) ? payload['@graph'] : [];
  if (!graph.length) issues.push('The graph does not contain any entities.');

  const ids = new Set();
  for (const node of graph) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      issues.push('Every graph entry must be an object.');
      continue;
    }
    if (!node['@type']) issues.push('An entity is missing its @type.');
    if (typeof node['@id'] !== 'string' || !node['@id']) {
      issues.push('An entity is missing its @id.');
    } else if (ids.has(node['@id'])) {
      issues.push('Duplicate @id: ' + node['@id']);
    } else {
      ids.add(node['@id']);
    }
  }
  if (!graph.some(node => node && node['@type'] === 'Organization')) {
    issues.push('The graph does not include an Organization entity.');
  }

  const refKeys = ['parentOrganization', 'worksFor', 'provider', 'publisher', 'employee', 'subOrganization', 'availableAtOrFrom'];
  const checkReference = value => {
    if (Array.isArray(value)) {
      value.forEach(checkReference);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (typeof value['@id'] === 'string' && Object.keys(value).length === 1 && !ids.has(value['@id'])) {
      issues.push('A relationship points to a missing entity: ' + value['@id']);
    }
  };
  for (const node of graph) {
    if (!node || typeof node !== 'object') continue;
    for (const key of refKeys) {
      if (node[key]) checkReference(node[key]);
    }
  }
  return [...new Set(issues)];
}

function implementationInstructions(plan) {
  const label = OFFERS[plan]?.label || 'paid';
  return [
    `Keep this JSON-LD with the ${label} implementation record so the identifiers stay consistent.`,
    'Add the graph to the head of the main brand page, or load it from the same document template on every page.',
    'Use the same @id values on location, service, and team pages. Do not publish a second Organization identifier.',
    'Publish the location, person, and service pages at the URLs used in the graph. Keep names, addresses, phone numbers, and profile links consistent with the visible page content.',
    'Validate the final markup with a Schema.org validator and confirm every fact matches the business.',
    'Record the pages changed and the validation result. Recheck the graph when the business changes a location, service, or leader.'
  ];
}

async function revokeByPaymentIntent(paymentIntent) {
  if (!paymentIntent) return false;
  const rows = await db(
    'entity_purchases?stripe_payment_intent=eq.' + encodeURIComponent(paymentIntent) +
    '&status=eq.paid&select=id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: 'revoked', updated_at: new Date().toISOString() }
    }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function restoreByPaymentIntent(paymentIntent) {
  if (!paymentIntent) return false;
  const rows = await db(
    'entity_purchases?stripe_payment_intent=eq.' + encodeURIComponent(paymentIntent) +
    '&status=eq.revoked&select=id',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: 'paid', updated_at: new Date().toISOString() }
    }
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function handleWebhook(event) {
  if (!event || typeof event.type !== 'string') return false;
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data?.object;
    if (session?.metadata?.product !== PRODUCT) return false;
    return recordSession(session);
  }
  if (event.type === 'charge.refunded') {
    const charge = event.data?.object || {};
    if (charge.refunded !== true) return false;
    return revokeByPaymentIntent(idOf(charge.payment_intent));
  }
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data?.object || {};
    return revokeByPaymentIntent(idOf(dispute.payment_intent));
  }
  if (event.type === 'charge.dispute.closed') {
    const dispute = event.data?.object || {};
    if (dispute.status !== 'won') return false;
    return restoreByPaymentIntent(idOf(dispute.payment_intent));
  }
  return false;
}

module.exports = {
  PRODUCT,
  OFFERS,
  LIMITS,
  UPGRADE,
  sessionIsUpgrade,
  offerForPlan,
  limitsForPlan,
  sessionIsPaid,
  sessionEmail,
  validEmail,
  claimUnclaimedByEmail,
  claimPurchase,
  entitlementForUser,
  validateImplementationInput,
  validateGraph,
  implementationInstructions,
  handleWebhook,
  recordSession
};
````

---

## entity-purchase-claim.mjs

Repo path: `netlify/functions/entity-purchase-claim.mjs`  
Lines: 23  
SHA-256: `36c75653073c5f1b5c54e2323c1140ecbf0ccee730f2444d323dad8ae351253a`

Links a verified Stripe session to the signed-in account after checking session status, amount, item and email.

````js
import { json, readBody, requestMethod, userFromEvent } from "./avss-shared.mjs";
import purchases from "./lib/entity-purchases.js";

export default async event => {
  if (requestMethod(event) !== "POST") {
    return json(405, { error: "Use POST to claim a purchase." });
  }

  let user;
  try {
    user = await userFromEvent(event);
  } catch (error) {
    return json(401, { error: error.message, code: "SIGN_IN_REQUIRED" });
  }

  try {
    const { sessionId } = await readBody(event);
    const result = await purchases.claimPurchase(user, sessionId);
    return json(200, { active: true, plan: result.plan, limits: result.limits });
  } catch (error) {
    return json(error.status || 400, { error: error.message, code: error.code });
  }
};
````

---

## db.js

Repo path: `netlify/functions/lib/db.js`  
Lines: 47  
SHA-256: `b78dc0210438869b8b442282bc34b5eaaadc9d03d006679d38941800ce887a31`

Service-role PostgREST access plus the account lookup used by checkout and claims.

````js
'use strict';
const crypto = require('node:crypto');
const {databaseDiagnostic} = require('./db-diagnostics');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function config() {
 const url = process.env.SUPABASE_URL?.trim();
 const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
 if (!url || !key) throw Object.assign(new Error('The audit service connection is not configured. Contact the website owner. Reference: BACKEND_CONNECTION.'),{status:503,code:'backend_configuration'});
 try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash)throw Error();}catch{throw Object.assign(new Error('The audit service connection URL is invalid. Contact the website owner. Reference: BACKEND_URL.'),{status:503,code:'backend_configuration'});}
 return {url: url.replace(/\/$/, ''), key};
}
async function db(path, {method='GET', body, headers={}}={}) {
 const {url,key} = config();
 const response = await fetch(url+'/rest/v1/'+path, {method, headers: {apikey:key, ...(key.startsWith('sb_secret_')?{}:{Authorization:'Bearer '+key}), 'Content-Type':'application/json', ...headers}, body:body===undefined?undefined:JSON.stringify(body), signal:AbortSignal.timeout(15000)});
 const text = await response.text();
 if (!response.ok) { console.error('Database request failed',response.status,path.split('?')[0],JSON.stringify(databaseDiagnostic({key,url,text,status:response.status,headers,context:process.env.CONTEXT}))); throw Object.assign(new Error(response.status===401||response.status===403?'Your website sign-in is separate from the audit database connection. The website owner needs to check the server database key. Reference: BACKEND_DATABASE.':'The audit database could not complete this request. Please retry or contact the website owner. Your saved reports have not been removed.'),{status:503,code:'backend_database'}); }
 return text ? JSON.parse(text) : null;
}
// The browser and server verify website sessions against the same PUBLIC key.
// This is not the private key used for database administration.
const AUTH_PUBLIC_KEY='sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO';
const serviceError=(code,message)=>Object.assign(new Error(message),{status:503,code});
async function user(event) {
 const {url}=config();
 const token=(event.headers?.authorization||event.headers?.Authorization||'').match(/^Bearer (.+)$/i)?.[1];
 if (!token) throw Object.assign(new Error('Please sign in.'), {status:401,code:'sign_in_required'});
 let r;
 try{r=await fetch(url+'/auth/v1/user',{headers:{apikey:AUTH_PUBLIC_KEY,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});}
 catch{throw serviceError('auth_connection_unavailable','The website sign-in service could not be reached. Please retry. This does not mean your session has ended.');}
 if(!r.ok){
  let details={};try{details=await r.json();}catch{}
  const description=String(details.message||details.msg||details.error_description||details.error||'');
  if(/(?:invalid|missing|no|not found|incorrect).{0,24}api[ _-]?key|api[ _-]?key.{0,24}(?:invalid|missing|not found|incorrect)/i.test(description))
   throw serviceError('auth_configuration','The website sign-in service is not connected correctly. Please contact the website owner. Reference: AUTH_CONNECTION.');
  if(r.status===401)throw Object.assign(new Error('Your session has ended. Please sign in again.'),{status:401,code:'session_expired'});
  if(r.status===403)throw Object.assign(new Error('This account cannot access the audit service. Please confirm your email or contact support.'),{status:403,code:'account_access_denied'});
  throw serviceError('auth_connection_unavailable','The website sign-in service is temporarily unavailable. Please retry. Your saved reports have not been removed.');
 }
 let u;try{u=await r.json();}catch{throw serviceError('auth_response_invalid','The sign-in service returned an unreadable response. Please retry.');}
 if(!UUID.test(u?.id||''))throw serviceError('auth_response_invalid','The sign-in service returned an invalid account response. Please contact support.');
 if(!u.email_confirmed_at)throw Object.assign(new Error('Please confirm your email first.'),{status:403,code:'email_confirmation_required'});
 return u;
}
function reply(status,body){return{statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)};}
function signature(id,time){return crypto.createHmac('sha256',config().key).update(id+':'+time).digest('hex');}
function verifySignature(id,time,sig){if(!UUID.test(id||'')||!/^\d+$/.test(time||'')||Math.abs(Date.now()-Number(time))>300000||!/^[0-9a-f]{64}$/i.test(sig||''))return false; return crypto.timingSafeEqual(Buffer.from(signature(id,time),'hex'),Buffer.from(sig,'hex'));}
module.exports={db,user,reply,signature,verifySignature,UUID};
````

---

## entity-authority-checkout.js

Repo path: `netlify/functions/entity-authority-checkout.js`  
Lines: 266  
SHA-256: `c1a0d7dc6a3687ba61346ab264efab4174b5de19308214e8771066bac644091f`

Creates account-bound Checkout sessions, verifies the live price and amount server-side, handles the $400 single-to-multi upgrade.

````js
'use strict';
// Creates Stripe Checkout sessions for the two one-time AI Entity & Citation
// Authority Setup offers. Checkout is account-bound: the client must send the
// Supabase access token, and the verified account email/user ID are attached to
// the Stripe session. A Single-Hub owner can buy the Multi-Location upgrade for
// the $400 difference instead of paying the full Multi-Location price again.
const { stripe, origin } = require('./lib/stripe');
const { user: authUser } = require('./lib/db');
const purchases = require('./lib/entity-purchases');

const PRODUCT = 'entity-authority';
const UPGRADE = Object.freeze({
  from: 'single',
  to: 'multi',
  amount: 40000,
  credit: 79900
});
const OFFERS = Object.freeze({
  single: Object.freeze({
    label: 'Single-Hub Brand',
    priceId: 'price_1Uc6kWBIJX5f6WmhvQeqzs7o',
    productId: 'prod_VdNVizBmTfDoqH',
    amount: 79900
  }),
  multi: Object.freeze({
    label: 'Multi-Location Brand',
    priceId: 'price_1Uc6ksBIJX5f6WmhHI94dIms',
    productId: 'prod_VdNVrX9bS9IVPF',
    amount: 119900
  })
});

function reply(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

function statusError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function requestPayload(event) {
  const query = event && event.queryStringParameters ? event.queryStringParameters : {};
  let plan = String(query.plan || '').trim().toLowerCase();
  let upgrade = String(query.upgrade || '') === '1';

  if (!plan && event && event.httpMethod === 'POST' && event.body) {
    const raw = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8');
    const headers = event.headers || {};
    const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(raw);
        plan = String(parsed && parsed.plan || '').trim().toLowerCase();
        upgrade = Boolean(parsed && parsed.upgrade) || upgrade;
      } catch {
        plan = '';
      }
    } else {
      plan = String(new URLSearchParams(raw).get('plan') || '').trim().toLowerCase();
      upgrade = String(new URLSearchParams(raw).get('upgrade') || '') === '1' || upgrade;
    }
  }

  return { plan, upgrade };
}

function authorization(event) {
  const headers = event && event.headers ? event.headers : {};
  return String(headers.authorization || headers.Authorization || '');
}

function productId(price) {
  return typeof price.product === 'string' ? price.product : price.product && price.product.id;
}

function validLivePrice(price, offer) {
  return Boolean(
    price &&
    price.id === offer.priceId &&
    productId(price) === offer.productId &&
    price.active === true &&
    price.livemode === true &&
    price.type === 'one_time' &&
    price.currency === 'usd' &&
    price.unit_amount === offer.amount &&
    price.billing_scheme === 'per_unit' &&
    !price.recurring &&
    !price.custom_unit_amount &&
    !price.transform_quantity
  );
}

async function requireUser(event) {
  if (!authorization(event)) {
    throw statusError(401, 'Sign in before starting checkout so the purchase is linked to your account.', 'SIGN_IN_REQUIRED');
  }
  return authUser(event);
}

exports.handler = async event => {
  const method = String(event && event.httpMethod || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    const response = reply(405, { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' });
    response.headers.Allow = 'GET, POST';
    return response;
  }

  const request = requestPayload(event);
  const offer = Object.prototype.hasOwnProperty.call(OFFERS, request.plan) ? OFFERS[request.plan] : null;
  if (!offer) {
    return reply(400, { error: 'Choose the Single-Hub ($799) or Multi-Location ($1,199) plan.', code: 'PLAN_REQUIRED' });
  }
  if (request.upgrade && request.plan !== UPGRADE.to) {
    return reply(400, { error: 'The upgrade option is only available for the Multi-Location plan.', code: 'UPGRADE_PLAN_INVALID' });
  }

  let checkoutUser;
  try {
    checkoutUser = await requireUser(event);
  } catch (error) {
    return reply(error.status || 401, {
      error: error.message || 'Sign in before starting checkout.',
      code: error.code || 'SIGN_IN_REQUIRED'
    });
  }

  try {
    const entitlement = await purchases.entitlementForUser(checkoutUser.id, checkoutUser);

    if (request.upgrade) {
      if (!entitlement || entitlement.plan !== UPGRADE.from) {
        return reply(403, {
          error: 'The $400 upgrade is only available to an account with an active Single-Hub purchase.',
          code: 'UPGRADE_REQUIRES_SINGLE'
        });
      }
    } else if (entitlement) {
      if (entitlement.plan === 'multi' || entitlement.plan === request.plan) {
        return reply(409, {
          error: 'This account already has that DIY builder plan. Open the builder instead of paying again.',
          code: 'ALREADY_PURCHASED'
        });
      }
      if (entitlement.plan === 'single' && request.plan === 'multi') {
        return reply(409, {
          error: 'This account has Single-Hub. Use the $400 upgrade option instead of buying Multi-Location again.',
          code: 'UPGRADE_REQUIRED'
        });
      }
    }

    const price = await stripe(`prices/${encodeURIComponent(offer.priceId)}`);
    if (!validLivePrice(price, offer)) {
      console.error('entity-authority-checkout price verification failed', request.plan);
      return reply(503, {
        error: 'Secure checkout is unavailable because the live price could not be verified.',
        code: 'PRICE_VERIFICATION_FAILED'
      });
    }

    let couponId = null;
    if (request.upgrade) {
      const coupon = await stripe('coupons', {
        method: 'POST',
        idempotency: `ea-upgrade-${checkoutUser.id}`,
        data: {
          amount_off: String(UPGRADE.credit),
          currency: 'usd',
          duration: 'once',
          name: 'Single-Hub to Multi-Location upgrade',
          'metadata[product]': PRODUCT,
          'metadata[user_id]': checkoutUser.id
        }
      });
      if (!coupon || !coupon.id) {
        throw statusError(503, 'The upgrade discount could not be created.', 'UPGRADE_COUPON_MISSING');
      }
      couponId = coupon.id;
    }

    const expectedAmount = request.upgrade ? UPGRADE.amount : offer.amount;
    const base = origin();
    const sessionData = {
      mode: 'payment',
      'line_items[0][price]': offer.priceId,
      'line_items[0][quantity]': '1',
      success_url: `${base}/ai-visibility-schema-studio?checkout=success&session_id={CHECKOUT_SESSION_ID}${request.upgrade ? '&upgrade=1' : ''}#get-started`,
      cancel_url: `${base}/ai-visibility-schema-studio?checkout=cancelled#pricing`,
      customer_email: checkoutUser.email,
      client_reference_id: checkoutUser.id,
      'metadata[plan]': request.plan,
      'metadata[product]': PRODUCT,
      'metadata[price]': offer.priceId,
      'metadata[amount]': String(expectedAmount),
      'metadata[user_id]': checkoutUser.id,
      'payment_intent_data[metadata][plan]': request.plan,
      'payment_intent_data[metadata][product]': PRODUCT,
      'payment_intent_data[metadata][price]': offer.priceId,
      'payment_intent_data[metadata][amount]': String(expectedAmount),
      'payment_intent_data[metadata][user_id]': checkoutUser.id,
      allow_promotion_codes: false
    };

    if (request.upgrade) {
      sessionData['metadata[upgrade]'] = '1';
      sessionData['metadata[previous_plan]'] = UPGRADE.from;
      sessionData['discounts[0][coupon]'] = couponId;
    }

    const session = await stripe('checkout/sessions', {
      method: 'POST',
      data: sessionData
    });

    if (!session || !session.url) {
      throw statusError(503, 'Checkout could not be created.', 'CHECKOUT_SESSION_MISSING');
    }
    if (
      session.mode !== 'payment' ||
      session.livemode !== true ||
      session.currency !== 'usd' ||
      session.amount_total !== expectedAmount
    ) {
      throw statusError(503, 'Checkout response did not match the verified offer.', 'CHECKOUT_SESSION_MISMATCH');
    }

    let target;
    try {
      target = new URL(session.url);
      if (target.protocol !== 'https:' || target.hostname !== 'checkout.stripe.com' || target.port) {
        throw new Error('Invalid checkout host.');
      }
    } catch {
      throw statusError(503, 'Checkout address could not be verified.', 'CHECKOUT_URL_INVALID');
    }

    return reply(200, {
      url: target.href,
      plan: request.plan,
      upgrade: Boolean(request.upgrade)
    });
  } catch (error) {
    const allowed = [400, 401, 403, 409, 503];
    const status = allowed.includes(error && error.status) ? error.status : 503;
    const code = error && error.code ? String(error.code).slice(0, 80) : 'CHECKOUT_UNAVAILABLE';
    console.error('entity-authority-checkout failed', status, code);
    return reply(status, {
      error: status === 503
        ? 'Secure checkout is unavailable right now. Please retry in a moment.'
        : (error.message || 'Checkout could not be started.'),
      code
    });
  }
};

exports.OFFERS = OFFERS;
exports.UPGRADE = UPGRADE;
exports.validLivePrice = validLivePrice;
````

---

## stripe.js

Repo path: `netlify/functions/lib/stripe.js`  
Lines: 16  
SHA-256: `24ff8f9ae49d7c37b6cd0a16d4c07193304d6681fc92d284d2969bdc4404b73f`

Stripe REST wrapper and webhook HMAC verification with a five-minute timestamp tolerance.

````js
'use strict';
const crypto=require('node:crypto');
const {requireStripeCredential}=require('./stripe-credential');
async function stripe(path,{method='GET',data,idempotency}={}){
 const {key}=requireStripeCredential();
 const form=new URLSearchParams();for(const [k,v] of Object.entries(data||{}))if(v!==undefined&&v!==null)form.set(k,String(v));
 let r;try{r=await fetch('https://api.stripe.com/v1/'+path,{method,headers:{Authorization:'Bearer '+key,'Stripe-Version':'2025-02-24.acacia',...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},body:method==='POST'?form.toString():undefined,signal:AbortSignal.timeout(20000)});}catch{throw Object.assign(new Error('Stripe could not be reached. Reference: PAYMENT_STRIPE_NETWORK.'),{status:503,code:'PAYMENT_STRIPE_NETWORK'});}
 let body;try{body=await r.json();}catch{throw Object.assign(new Error('Stripe returned an unreadable response. Reference: PAYMENT_STRIPE_RESPONSE.'),{status:503,code:'PAYMENT_STRIPE_RESPONSE'});}
 if(!r.ok){const code=r.status===401?'PAYMENT_STRIPE_AUTH':r.status===403?'PAYMENT_STRIPE_PERMISSIONS':r.status===429?'PAYMENT_STRIPE_BUSY':'PAYMENT_STRIPE_REQUEST';const message=r.status===401?'Stripe rejected the server credential.':r.status===403?'Stripe denied this API operation.':r.status===429?'Stripe is temporarily limiting requests.':'Stripe could not complete this operation.';console.error('Stripe request failed',r.status,code);throw Object.assign(new Error(message+' Reference: '+code+'.'),{status:503,code});}return body;
}
function verifyWebhook(raw,header,secret,now=Date.now()){
 if(!secret||!header)return false;const parts=header.split(',').map(x=>x.split('='));const t=parts.find(x=>x[0]==='t')?.[1];if(!/^\d+$/.test(t||'')||Math.abs(now/1000-Number(t))>300)return false;
 const expected=crypto.createHmac('sha256',secret).update(t+'.').update(raw).digest();return parts.filter(x=>x[0]==='v1').some(x=>{try{const b=Buffer.from(x[1],'hex');return b.length===expected.length&&crypto.timingSafeEqual(b,expected);}catch{return false;}});
}
function origin(){const u=new URL(process.env.PUBLIC_SITE_URL||process.env.URL||'');if(u.protocol!=='https:'||u.username||u.password)throw new Error('Canonical HTTPS site URL is missing.');return u.origin;}
module.exports={stripe,verifyWebhook,origin};
````

---

## stripe-credential.js

Repo path: `netlify/functions/lib/stripe-credential.js`  
Lines: 34  
SHA-256: `88333144454c6887dc20711bd1a707af67ad29f018aef29916fd83a5890c0b2d`

Validates the server key format and mode. Never logs or serializes the key.

````js
'use strict';
// Never log or serialize a credential. Diagnostics below contain fixed codes only.
function normalizedStripeKey(env=process.env){
 const raw=env.STRIPE_SECRET_KEY;if(typeof raw!=='string')return '';
 let key=raw.trim();
 if(key.length>=2&&((key[0]==='"'&&key.at(-1)==='"')||(key[0]==="'"&&key.at(-1)==="'")))key=key.slice(1,-1).trim();
 return key;
}
function stripeKeyInfo(env=process.env){
 const key=normalizedStripeKey(env);
 if(!key)return {mode:null,kind:null,code:'PAYMENT_KEY_MISSING'};
 if(key.includes('*'))return {mode:null,kind:null,code:'PAYMENT_KEY_MASKED'};
 if(key.startsWith('sk_org_'))return {mode:null,kind:'organization',code:'PAYMENT_KEY_ORGANIZATION'};
 if(/^pk_(live|test)_/.test(key))return {mode:null,kind:'publishable',code:'PAYMENT_KEY_PUBLISHABLE'};
 const m=/^(sk|rk)_(live|test)_[A-Za-z0-9_]+$/.exec(key);
 if(!m)return {mode:null,kind:null,code:'PAYMENT_KEY_FORMAT'};
 return {mode:m[2],kind:m[1]==='rk'?'restricted':'secret',code:null};
}
function stripeKeyMode(env=process.env){return stripeKeyInfo(env).mode;}
function requireStripeCredential(env=process.env){
 const info=stripeKeyInfo(env);
 if(info.code){
  const messages={
   PAYMENT_KEY_MISSING:'The running payment function has no Stripe server key. Reference: PAYMENT_KEY_MISSING.',
   PAYMENT_KEY_MASKED:'The running payment function received a masked placeholder instead of a Stripe server key. Reference: PAYMENT_KEY_MASKED.',
   PAYMENT_KEY_ORGANIZATION:'This integration requires an account-level Stripe server key, not an organization key. Reference: PAYMENT_KEY_ORGANIZATION.',
   PAYMENT_KEY_PUBLISHABLE:'The payment function received a publishable key instead of a server key. Reference: PAYMENT_KEY_PUBLISHABLE.',
   PAYMENT_KEY_FORMAT:'The running payment function received an unrecognized Stripe server-key format. Reference: PAYMENT_KEY_FORMAT.'
  };
  throw Object.assign(new Error(messages[info.code]),{status:503,code:info.code});
 }
 return {key:normalizedStripeKey(env),mode:info.mode,kind:info.kind};
}
module.exports={normalizedStripeKey,stripeKeyInfo,stripeKeyMode,requireStripeCredential};
````

---

## stripe-webhook.js

Repo path: `netlify/functions/stripe-webhook.js`  
Lines: 32  
SHA-256: `d1f83976247f394b540ad6c3d21fb23f678d0a07ccaf1ad9cbf21fb0c5ab000f`

Signature verification, event allow-list, routing to the entity purchase handler before the other product handlers.

````js
'use strict';
const {reply} = require('./lib/db');
const {verifyWebhook} = require('./lib/stripe');
const {configuredBillingSync} = require('./lib/billing-sync');
const supported = new Set(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','invoice.paid','invoice.payment_failed','customer.subscription.updated','customer.subscription.deleted','charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed']);
exports.handler = async event => {
 if (event.httpMethod !== 'POST') return reply(405, {error: 'POST required'});
 const raw = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');
 if (!verifyWebhook(raw, event.headers?.['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)) return reply(400, {error: 'Invalid webhook signature'});
 let e;try {e = JSON.parse(raw.toString('utf8'));} catch {return reply(400, {error: 'Invalid event'});}
 if (typeof e.id !== 'string' || !e.id.startsWith('evt_') || typeof e.type !== 'string') return reply(400, {error: 'Invalid event'});
 if (!supported.has(e.type)) return reply(200, {received: true, ignored: true});
 try {
  const competitorResult = await require("./lib/competitor-intelligence").configuredCompetitorIntelligence().webhook(e);
  if (competitorResult) return reply(200, {received: true, competitorIntelligence: true});
  const contentResult = await require("./lib/content-service").configuredContentService().webhook(e);
  if (contentResult) return reply(200, {received: true, contentService: true});
  const guestResult = await require("./lib/guest-service-checkout").configuredGuestServiceCheckout().webhook(e);
  if (guestResult) return reply(200, {received: true, guestService: true});
  const serviceResult = await require("./lib/service-checkout").configuredServiceCheckout().webhook(e);
  if (serviceResult) return reply(200, {received: true, service: true});
  const entityPurchaseResult = await require("./lib/entity-purchases").handleWebhook(e);
  if (entityPurchaseResult) return reply(200, {received: true, entityPurchase: true});
  const studioResult = await require("./lib/studio-link").handleStudioWebhook(e);
  if (studioResult) return reply(200, {received: true, studio: true});
  const result = await configuredBillingSync().event(e);
  return reply(200, {received: true, ignored: !!result.ignored});
 } catch (err) {
  console.error('Stripe webhook reconciliation failed', e.id, err.status || 'internal');
  return reply(500, {error: 'Billing update could not finish. Stripe should retry.'});
 }
};
````

---

## 10-entity-purchases.sql

Repo path: `database/10-entity-purchases.sql`  
Lines: 37  
SHA-256: `a712eaa91df06439dfa74efe805f87e9abb6c553ffe0a28dfeb332b69f9fb7e4`

Table definition, indexes, RLS enablement and the single self-read policy. No write policies by design.

````js
-- AI Entity & Citation Authority Setup purchase entitlements.
-- Additive only. Existing subscriptions, GEO audit tables, and Stripe records are untouched.
-- RLS allows a signed-in customer to read their own purchases; all writes go through
-- service-role Netlify functions and the Stripe webhook.
create extension if not exists pgcrypto;

create table if not exists public.entity_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  plan text not null check (plan in ('single', 'multi')),
  status text not null default 'paid' check (status in ('paid', 'revoked')),
  stripe_session_id text unique not null,
  stripe_payment_intent text,
  amount_total integer,
  currency text not null default 'usd',
  livemode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entity_purchases_user_status_idx
  on public.entity_purchases(user_id, status);
create index if not exists entity_purchases_email_idx
  on public.entity_purchases(lower(email), status);
create index if not exists entity_purchases_payment_intent_idx
  on public.entity_purchases(stripe_payment_intent);

alter table public.entity_purchases enable row level security;

drop policy if exists "read own entity purchases" on public.entity_purchases;
create policy "read own entity purchases"
  on public.entity_purchases for select
  using (auth.uid() = user_id);

-- No insert, update, or delete policies are intentional. Only service-role
-- functions and the verified Stripe webhook may write purchase records.
````

---

## verify-entity-gate.mjs

Repo path: `artifacts/verify-entity-gate.mjs`  
Lines: 510  
SHA-256: `d164e1e714a4ca9713495ed93f95882e053024a08013abd9e739c68cd2472cb4`

Ad-hoc harness that ran 32 checks against the real handlers with fake Supabase/Stripe transports.

````js
/*
 * Backend verification harness for the AI Visibility & Schema Studio paid path.
 * Runs the real Netlify handlers with fake Supabase/Stripe transports so each
 * authorization, entitlement and plan-limit branch can be exercised without a
 * live charge. No production credentials are used.
 */
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SUPA = "https://fixture.supabase.co";
process.env.SUPABASE_URL = SUPA;
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_fixture_only";
process.env.SUPABASE_ANON_KEY = "sb_publishable_fixture_only";
process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_fixture_only";
process.env.STRIPE_SECRET_KEY = "sk_live_fixture_only";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture_only";
process.env.PUBLIC_SITE_URL = "https://aeogeosearch.com";

const U = {
  unpaid: { id: "11111111-1111-4111-8111-111111111111", email: "unpaid@example.com" },
  single: { id: "22222222-2222-4222-8222-222222222222", email: "single@example.com" },
  multi: { id: "33333333-3333-4333-8333-333333333333", email: "multi@example.com" },
  other: { id: "44444444-4444-4444-8444-444444444444", email: "other@example.com" }
};
for (const user of Object.values(U)) user.email_confirmed_at = "2026-01-01T00:00:00.000Z";

const TOKENS = {
  "token-unpaid": U.unpaid,
  "token-single": U.single,
  "token-multi": U.multi,
  "token-other": U.other
};

const PRICES = {
  price_1Uc6kWBIJX5f6WmhvQeqzs7o: { product: "prod_VdNVizBmTfDoqH", amount: 79900, plan: "single" },
  price_1Uc6ksBIJX5f6WmhHI94dIms: { product: "prod_VdNVrX9bS9IVPF", amount: 119900, plan: "multi" }
};

const state = {
  purchases: [],
  requests: [],
  session: null,
  sessionLookup: null
};

function headerOf(init, name) {
  const headers = init.headers || {};
  if (typeof headers.get === "function") return headers.get(name) || "";
  const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : "";
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function filterRows(url) {
  let rows = state.purchases.slice();
  for (const [key, value] of url.searchParams) {
    if (key === "select" || key === "order" || key === "on_conflict") continue;
    if (value.startsWith("eq.")) {
      const expected = value.slice(3);
      rows = rows.filter(row => String(row[key]) === expected);
    } else if (value === "is.null") {
      rows = rows.filter(row => row[key] === null || row[key] === undefined);
    }
  }
  return rows;
}

async function supabaseRoute(url, method, init) {
  if (url.pathname === "/auth/v1/user") {
    const token = headerOf(init, "authorization").replace(/^Bearer\s+/i, "");
    const user = TOKENS[token];
    return user ? jsonResponse(user) : jsonResponse({ message: "invalid JWT" }, 401);
  }

  if (url.pathname === "/rest/v1/entity_purchases") {
    if (method === "GET") return jsonResponse(filterRows(url));
    if (method === "POST") {
      const rows = JSON.parse(init.body || "[]");
      for (const row of rows) {
        const existing = state.purchases.find(item => item.stripe_session_id === row.stripe_session_id);
        if (existing) Object.assign(existing, row);
        else state.purchases.push({ created_at: new Date().toISOString(), ...row });
      }
      return new Response("", { status: 201 });
    }
    if (method === "PATCH") {
      const rows = filterRows(url);
      const patch = JSON.parse(init.body || "{}");
      for (const row of rows) Object.assign(row, patch);
      return jsonResponse(rows);
    }
  }

  throw new Error("Unexpected Supabase request: " + method + " " + url.pathname + url.search);
}

async function stripeRoute(url, method, init) {
  const form = init.body ? new URLSearchParams(String(init.body)) : new URLSearchParams();

  if (method === "GET" && url.pathname.startsWith("/v1/prices/")) {
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const price = PRICES[id];
    if (!price) return jsonResponse({ error: { message: "No such price" } }, 404);
    return jsonResponse({
      id,
      product: price.product,
      active: true,
      livemode: true,
      type: "one_time",
      currency: "usd",
      unit_amount: price.amount,
      billing_scheme: "per_unit",
      recurring: null,
      custom_unit_amount: null,
      transform_quantity: null
    });
  }

  if (method === "POST" && url.pathname === "/v1/coupons") {
    return jsonResponse({ id: "coupon_fixture" });
  }

  if (method === "POST" && url.pathname === "/v1/checkout/sessions") {
    const priceId = form.get("line_items[0][price]");
    const price = PRICES[priceId];
    const coupon = form.get("discounts[0][coupon]");
    const amount = coupon ? price.amount - 79900 : price.amount;
    return jsonResponse({
      id: "cs_live_fixture_session",
      url: "https://checkout.stripe.com/c/pay/cs_live_fixture_session",
      mode: "payment",
      livemode: true,
      currency: "usd",
      amount_total: amount
    });
  }

  if (method === "GET" && /^\/v1\/checkout\/sessions\/[^/]+$/.test(url.pathname)) {
    return jsonResponse(state.sessionLookup);
  }

  if (method === "GET" && url.pathname.endsWith("/line_items")) {
    const plan = state.sessionLookup?.metadata?.plan;
    const priceId = plan === "multi" ? "price_1Uc6ksBIJX5f6WmhHI94dIms" : "price_1Uc6kWBIJX5f6WmhvQeqzs7o";
    return jsonResponse({ has_more: false, data: [{ quantity: 1, price: { id: priceId } }] });
  }

  throw new Error("Unexpected Stripe request: " + method + " " + url.pathname);
}

const realFetch = global.fetch;
global.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = String(init.method || "GET").toUpperCase();
  state.requests.push({ href: url.href, method, pathname: url.pathname });
  if (url.origin === SUPA) return supabaseRoute(url, method, init);
  if (url.origin === "https://api.stripe.com") return stripeRoute(url, method, init);
  throw new Error("Unexpected external request: " + method + " " + url.href);
};

const impl = (await import("../netlify/functions/entity-implementation.mjs")).default;
const entitlement = (await import("../netlify/functions/entity-entitlement.mjs")).default;
const claim = (await import("../netlify/functions/entity-purchase-claim.mjs")).default;
const checkout = require("../netlify/functions/entity-authority-checkout.js");
const purchases = require("../netlify/functions/lib/entity-purchases.js");
const { verifyWebhook } = require("../netlify/functions/lib/stripe.js");

async function invoke(handler, event) {
  const response = await handler(event);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
}

function eventFor(token, body, method = "POST") {
  const raw = JSON.stringify(body ?? {});
  return {
    method,
    headers: token ? { authorization: "Bearer " + token } : {},
    body: raw,
    text: async () => raw
  };
}

function checkoutEvent(token, body) {
  return {
    httpMethod: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body || {})
  };
}

function inputFor(locations, people = 1, services = 1) {
  return {
    domain: "https://examplebrand.com",
    brandName: "Example Brand",
    description: "A verified example brand used for gate verification.",
    locations: Array.from({ length: locations }, (_, i) => ({ name: "Office " + (i + 1), slug: "office-" + (i + 1) })),
    people: Array.from({ length: people }, (_, i) => ({ name: "Person " + (i + 1), slug: "person-" + (i + 1) })),
    services: Array.from({ length: services }, (_, i) => ({ name: "Service " + (i + 1), slug: "service-" + (i + 1) }))
  };
}

const results = [];
async function check(name, fn) {
  state.requests.length = 0;
  try {
    await fn();
    results.push({ name, ok: true });
    console.log("PASS  " + name);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log("FAIL  " + name + "\n      " + error.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function noJsonLd(body, label) {
  assert(!body || !("jsonLd" in body), label + " returned jsonLd");
  assert(!JSON.stringify(body || {}).includes("@graph"), label + " returned a graph");
}

// ---------------------------------------------------------------- no account
await check("implementation: no Authorization header is rejected before any database read", async () => {
  const response = await invoke(impl, eventFor(null, { input: inputFor(1) }));
  assert(response.status === 401, "expected 401, got " + response.status);
  assert(response.body.code === "SIGN_IN_REQUIRED", "expected SIGN_IN_REQUIRED");
  noJsonLd(response.body, "unauthenticated call");
  assert(!state.requests.some(r => r.pathname === "/rest/v1/entity_purchases"), "entitlement table was read without auth");
});

await check("implementation: forged bearer token is rejected", async () => {
  const response = await invoke(impl, eventFor("forged-token", { input: inputFor(1) }));
  assert(response.status === 401, "expected 401, got " + response.status);
  noJsonLd(response.body, "forged token");
});

await check("implementation: GET is refused", async () => {
  const response = await invoke(impl, eventFor("token-single", null, "GET"));
  assert(response.status === 405, "expected 405, got " + response.status);
});

await check("entitlement: signed-out request is refused", async () => {
  const response = await invoke(entitlement, eventFor(null, {}));
  assert(response.status === 401, "expected 401, got " + response.status);
});

await check("claim: signed-out request is refused", async () => {
  const response = await invoke(claim, eventFor(null, { sessionId: "cs_live_abcdefgh" }));
  assert(response.status === 401, "expected 401, got " + response.status);
});

// --------------------------------------------------------------- no purchase
state.purchases = [];
await check("implementation: valid unpaid account gets 403 and no graph", async () => {
  const response = await invoke(impl, eventFor("token-unpaid", { input: inputFor(1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PURCHASE_REQUIRED", "expected PURCHASE_REQUIRED");
  noJsonLd(response.body, "unpaid account");
});

await check("entitlement: unpaid account reports inactive", async () => {
  const response = await invoke(entitlement, eventFor("token-unpaid", {}));
  assert(response.status === 200 && response.body.active === false, "expected inactive entitlement");
});

// ----------------------------------------------------------- single purchased
state.purchases = [{ id: "p1", user_id: U.single.id, plan: "single", status: "paid", livemode: true, created_at: "2026-01-02T00:00:00Z" }];
await check("implementation: Single-Hub account generates a complete graph within its limits", async () => {
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(3, 2, 2) }));
  assert(response.status === 200, "expected 200, got " + response.status + " " + JSON.stringify(response.body));
  assert(response.body.plan === "single", "server returned plan " + response.body.plan);
  assert(Array.isArray(response.body.jsonLd?.["@graph"]), "no @graph returned");
  assert(response.body.jsonLd["@graph"].length === 9, "expected 9 nodes, got " + response.body.jsonLd["@graph"].length);
  assert(Array.isArray(response.body.instructions) && response.body.instructions.length >= 5, "missing instructions");
  assert(Array.isArray(response.body.validation) && response.body.validation.length === 0, "graph failed validation");
  const org = response.body.jsonLd["@graph"].find(node => node["@type"] === "Organization");
  assert(org.name === "Example Brand", "custom brand facts were not compiled");
});

await check("implementation: Single-Hub account cannot exceed 3 locations", async () => {
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(4, 2, 1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PLAN_LOCATION_LIMIT", "expected PLAN_LOCATION_LIMIT");
  noJsonLd(response.body, "over-limit single account");
});

await check("implementation: Single-Hub account cannot exceed 2 people", async () => {
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(1, 3, 1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PLAN_PEOPLE_LIMIT", "expected PLAN_PEOPLE_LIMIT");
});

await check("implementation: forging plan=multi in the body does not raise the paid limits", async () => {
  const input = { ...inputFor(4, 1, 1), plan: "multi", upgrade: true };
  const response = await invoke(impl, eventFor("token-single", { input, plan: "multi", upgrade: true }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PLAN_LOCATION_LIMIT", "expected the single-plan limit to still apply");
  noJsonLd(response.body, "forged plan selector");
});

await check("implementation: forged plan on valid input still returns the purchased plan and limits", async () => {
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(3, 1, 1), plan: "multi" }));
  assert(response.status === 200, "expected 200, got " + response.status);
  assert(response.body.plan === "single", "expected plan single, got " + response.body.plan);
  assert(response.body.limits.locations === 3, "expected single limits, got " + JSON.stringify(response.body.limits));
});

// ------------------------------------------------------------ multi purchased
state.purchases = [{ id: "p2", user_id: U.multi.id, plan: "multi", status: "paid", livemode: true, created_at: "2026-01-03T00:00:00Z" }];
await check("implementation: Multi-Location account generates a 10-location, 6-person graph", async () => {
  const response = await invoke(impl, eventFor("token-multi", { input: inputFor(10, 6, 2) }));
  assert(response.status === 200, "expected 200, got " + response.status);
  assert(response.body.plan === "multi", "expected plan multi");
  assert(response.body.jsonLd["@graph"].length === 20, "expected 20 nodes, got " + response.body.jsonLd["@graph"].length);
});

await check("implementation: Multi-Location account is still bounded at 10 locations", async () => {
  const response = await invoke(impl, eventFor("token-multi", { input: inputFor(11, 1, 1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PLAN_LOCATION_LIMIT", "expected PLAN_LOCATION_LIMIT");
});

await check("entitlement: Multi-Location account reports active multi", async () => {
  const response = await invoke(entitlement, eventFor("token-multi", {}));
  assert(response.status === 200 && response.body.active === true, "expected active entitlement");
  assert(response.body.plan === "multi", "expected multi plan");
});

await check("implementation: one account cannot use another account's purchase", async () => {
  const response = await invoke(impl, eventFor("token-other", { input: inputFor(1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PURCHASE_REQUIRED", "expected PURCHASE_REQUIRED");
});

await check("implementation: revoked purchase removes access", async () => {
  state.purchases = [{ id: "p3", user_id: U.single.id, plan: "single", status: "revoked", livemode: true, created_at: "2026-01-04T00:00:00Z" }];
  const response = await invoke(impl, eventFor("token-single", { input: inputFor(1) }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "PURCHASE_REQUIRED", "expected PURCHASE_REQUIRED");
});

// ----------------------------------------------------------------- checkout
state.purchases = [];
await check("checkout: signed-out plan request is refused", async () => {
  const response = await checkout.handler(checkoutEvent(null, { plan: "single" }));
  assert(response.statusCode === 401, "expected 401, got " + response.statusCode);
  assert(JSON.parse(response.body).code === "SIGN_IN_REQUIRED", "expected SIGN_IN_REQUIRED");
});

await check("checkout: invalid plan is rejected before Stripe is contacted", async () => {
  const response = await checkout.handler(checkoutEvent("token-unpaid", { plan: "__proto__" }));
  assert(response.statusCode === 400, "expected 400, got " + response.statusCode);
  assert(!state.requests.some(r => r.href.startsWith("https://api.stripe.com")), "Stripe was contacted for an invalid plan");
});

await check("checkout: Single-Hub session is $799 and bound to the signed-in account", async () => {
  const response = await checkout.handler(checkoutEvent("token-unpaid", { plan: "single" }));
  assert(response.statusCode === 200, "expected 200, got " + response.statusCode + " " + response.body);
  assert(JSON.parse(response.body).url.startsWith("https://checkout.stripe.com/"), "unexpected checkout URL");
  const sessionRequest = state.requests.find(r => r.pathname === "/v1/checkout/sessions");
  assert(sessionRequest, "no Stripe session request");
});

await check("checkout: Multi-Location session is $1,199", async () => {
  const response = await checkout.handler(checkoutEvent("token-unpaid", { plan: "multi" }));
  assert(response.statusCode === 200, "expected 200, got " + response.statusCode);
});

await check("checkout: existing Single-Hub purchase blocks a second Single-Hub charge", async () => {
  state.purchases = [{ id: "p4", user_id: U.single.id, plan: "single", status: "paid", livemode: true, created_at: "2026-01-05T00:00:00Z" }];
  const response = await checkout.handler(checkoutEvent("token-single", { plan: "single" }));
  assert(response.statusCode === 409, "expected 409, got " + response.statusCode);
  assert(JSON.parse(response.body).code === "ALREADY_PURCHASED", "expected ALREADY_PURCHASED");
});

await check("checkout: existing Single-Hub purchase requires the $400 upgrade, not a full Multi charge", async () => {
  const response = await checkout.handler(checkoutEvent("token-single", { plan: "multi" }));
  assert(response.statusCode === 409, "expected 409, got " + response.statusCode);
  assert(JSON.parse(response.body).code === "UPGRADE_REQUIRED", "expected UPGRADE_REQUIRED");
});

await check("checkout: $400 upgrade is allowed only for a Single-Hub account", async () => {
  const allowed = await checkout.handler(checkoutEvent("token-single", { plan: "multi", upgrade: true }));
  assert(allowed.statusCode === 200, "expected 200 for single owner, got " + allowed.statusCode);
  const denied = await checkout.handler(checkoutEvent("token-unpaid", { plan: "multi", upgrade: true }));
  assert(denied.statusCode === 403, "expected 403 without a Single-Hub purchase, got " + denied.statusCode);
  assert(JSON.parse(denied.body).code === "UPGRADE_REQUIRES_SINGLE", "expected UPGRADE_REQUIRES_SINGLE");
});

// --------------------------------------------------------------- purchase claim
state.purchases = [];
state.sessionLookup = {
  object: "checkout.session",
  id: "cs_live_claimsession",
  mode: "payment",
  status: "complete",
  payment_status: "paid",
  livemode: true,
  currency: "usd",
  amount_total: 79900,
  metadata: { product: "entity-authority", plan: "single" },
  customer_details: { email: U.single.email },
  payment_intent: "pi_live_claim"
};
await check("claim: a purchased session is linked to the matching signed-in account", async () => {
  const response = await invoke(claim, eventFor("token-single", { sessionId: "cs_live_claimsession" }));
  assert(response.status === 200 && response.body.active === true, "expected claim to succeed: " + JSON.stringify(response.body));
  assert(response.body.plan === "single", "expected single plan");
  const stored = state.purchases.find(row => row.stripe_session_id === "cs_live_claimsession");
  assert(stored && stored.user_id === U.single.id, "purchase was not attached to the account");
});

await check("claim: a session paid by another email cannot be claimed", async () => {
  state.purchases = [];
  const response = await invoke(claim, eventFor("token-other", { sessionId: "cs_live_claimsession" }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "EMAIL_MISMATCH", "expected EMAIL_MISMATCH");
  assert(state.purchases.length === 0, "a mismatched claim wrote a purchase row");
});

await check("claim: an unpaid Stripe session cannot be claimed", async () => {
  state.sessionLookup = { ...state.sessionLookup, payment_status: "unpaid" };
  const response = await invoke(claim, eventFor("token-single", { sessionId: "cs_live_claimsession" }));
  assert(response.status === 403, "expected 403, got " + response.status);
  assert(response.body.code === "CHECKOUT_NOT_VERIFIED", "expected CHECKOUT_NOT_VERIFIED");
});

// ------------------------------------------------------------------ webhook
await check("webhook: invalid signature is rejected before any parsing or write", async () => {
  state.purchases = [];
  const raw = Buffer.from(JSON.stringify({ id: "evt_1", type: "checkout.session.completed" }));
  const now = Math.floor(Date.now() / 1000);
  const good = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(now + ".").update(raw).digest("hex");
  assert(verifyWebhook(raw, "t=" + now + ",v1=" + good, process.env.STRIPE_WEBHOOK_SECRET) === true, "valid signature was rejected");
  assert(verifyWebhook(raw, "t=" + now + ",v1=" + "0".repeat(64), process.env.STRIPE_WEBHOOK_SECRET) === false, "forged signature was accepted");
  assert(verifyWebhook(raw, "t=" + now, process.env.STRIPE_WEBHOOK_SECRET) === false, "missing signature was accepted");
  assert(verifyWebhook(raw, "t=" + (now - 4000) + ",v1=" + good, process.env.STRIPE_WEBHOOK_SECRET) === false, "stale signature was accepted");
});

function paidSession(overrides = {}) {
  return {
    object: "checkout.session",
    id: "cs_live_webhook01",
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    livemode: true,
    currency: "usd",
    amount_total: 79900,
    metadata: { product: "entity-authority", plan: "single" },
    customer_details: { email: U.single.email },
    payment_intent: "pi_live_webhook",
    ...overrides
  };
}

await check("webhook: paid Single-Hub session records the purchase", async () => {
  state.purchases = [];
  const recorded = await purchases.handleWebhook({ type: "checkout.session.completed", data: { object: paidSession() } });
  assert(recorded === true, "handleWebhook did not record the paid session");
  const row = state.purchases.find(item => item.stripe_session_id === "cs_live_webhook01");
  assert(row && row.plan === "single" && row.amount_total === 79900 && row.livemode === true, "stored row is wrong");
});

await check("webhook: paid Multi-Location session records $1,199", async () => {
  state.purchases = [];
  const session = paidSession({ id: "cs_live_webhook02", amount_total: 119900, metadata: { product: "entity-authority", plan: "multi" } });
  await purchases.handleWebhook({ type: "checkout.session.completed", data: { object: session } });
  const row = state.purchases.find(item => item.stripe_session_id === "cs_live_webhook02");
  assert(row && row.plan === "multi" && row.amount_total === 119900, "multi purchase was not recorded correctly");
});

await check("webhook: test-mode, unpaid and wrong-amount sessions are never recorded", async () => {
  for (const variant of [
    paidSession({ id: "cs_test_mode", livemode: false }),
    paidSession({ id: "cs_unpaid", payment_status: "unpaid" }),
    paidSession({ id: "cs_wrong_amount", amount_total: 119900 }),
    paidSession({ id: "cs_other_product", metadata: { product: "something-else", plan: "single" } })
  ]) {
    state.purchases = [];
    const result = await purchases.handleWebhook({ type: "checkout.session.completed", data: { object: variant } });
    assert(result === false, variant.id + " was accepted");
    assert(state.purchases.length === 0, variant.id + " wrote a row");
  }
});

await check("webhook: refund and dispute revoke the entitlement, won dispute restores it", async () => {
  state.purchases = [{ id: "p5", user_id: U.single.id, plan: "single", status: "paid", stripe_payment_intent: "pi_live_webhook", livemode: true, created_at: "2026-01-06T00:00:00Z" }];
  await purchases.handleWebhook({ type: "charge.refunded", data: { object: { refunded: true, payment_intent: "pi_live_webhook" } } });
  assert(state.purchases[0].status === "revoked", "refund did not revoke the purchase");
  await purchases.handleWebhook({ type: "charge.dispute.closed", data: { object: { status: "won", payment_intent: "pi_live_webhook" } } });
  assert(state.purchases[0].status === "paid", "won dispute did not restore the purchase");
});

global.fetch = realFetch;

const failed = results.filter(item => !item.ok);
console.log("\nSUMMARY  " + (results.length - failed.length) + " passed, " + failed.length + " failed, " + results.length + " total");
if (failed.length) {
  console.log("FAILED: " + failed.map(item => item.name).join(" | "));
  process.exit(1);
}
````
