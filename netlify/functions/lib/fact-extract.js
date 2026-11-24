'use strict';
// Content Decay Predictor - deterministic fact extraction.
//
// Every claim this module returns is either a verbatim substring of the page
// text the crawler already fetched, or a property declared in that page's own
// JSON-LD. No model is involved, so the same page always yields the same claims
// and a claim cannot be invented. A visible claim whose quote does not literally
// appear in the source text is dropped.
//
// Scope is deliberately narrow. Only facts that can be canonicalised reliably
// are extracted. Service areas, turnaround promises, warranties and credentials
// are not extracted here: they need a model, and a noisy report is worse than a
// short one.
//
// Contract:
//   extractClaims({pages}) -> [claim]
//   claim = {
//     category, attribute, valueKey, valueDisplay,
//     quote, sourceUrl, sourceKind: 'visible' | 'jsonld'
//   }

const MAX_TEXT = 80000;
const CONTEXT = 60;
const PLAN_ORDER = [
  ['agency', /\b(?:agency|enterprise|platinum|gold)\b/i],
  ['professional', /\b(?:professional|pro|standard|silver|business)\b/i],
  ['starter', /\b(?:starter|basic|bronze|entry|essential)\b/i]
];
const DAY_INDEX = {
  mo: 'mon', mon: 'mon', monday: 'mon',
  tu: 'tue', tue: 'tue', tues: 'tue', tuesday: 'tue',
  we: 'wed', wed: 'wed', wednesday: 'wed',
  th: 'thu', thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu',
  fr: 'fri', fri: 'fri', friday: 'fri',
  sa: 'sat', sat: 'sat', saturday: 'sat',
  su: 'sun', sun: 'sun', sunday: 'sun'
};
const DAY_PATTERN = '(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)';
const DAY_NAMES = {
  monday: 'mon', tuesday: 'tue', wednesday: 'wed', thursday: 'thu',
  friday: 'fri', saturday: 'sat', sunday: 'sun'
};

const money = () => /\$\s?(\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.(\d{2}))?/g;

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function slice(value, limit) {
  const text = String(value == null ? '' : value);
  return text.length > limit ? text.slice(0, limit) : text;
}

function amountInCents(digits, decimals) {
  const whole = Number(String(digits).replace(/,/g, ''));
  const cents = decimals ? Number(decimals) : 0;
  if (!Number.isFinite(whole)) return null;
  return whole * 100 + cents;
}

function moneyDisplay(cents) {
  return '$' + (cents / 100).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})
    .replace(/\.00$/, '');
}

function periodAfter(text, end) {
  const match = /^\s*(?:\/|per\s+|a\s+)(month|mo|hour|hr|year|yr|week|wk|project)\b/i
    .exec(text.slice(end, end + 24));
  if (!match) return 'once';
  const word = match[1].toLowerCase().replace(/\.$/, '');
  if (word === 'mo') return 'month';
  if (word === 'hr') return 'hour';
  if (word === 'yr') return 'year';
  if (word === 'wk') return 'week';
  return word;
}

function planWordBefore(text, index) {
  const window = text.slice(Math.max(0, index - 90), index);
  for (const [plan, pattern] of PLAN_ORDER) {
    if (pattern.test(window)) return plan;
  }
  return '';
}

// Surrounding evidence for a short match. The window is snapped to word
// boundaries so a report never quotes a fragment like "ving McKinney families".
// The result is still a verbatim slice of the source text.
function contextQuote(text, start, end) {
  let from = Math.max(0, start - CONTEXT);
  let to = Math.min(text.length, end + CONTEXT);
  if (from > 0) {
    const space = text.indexOf(' ', from);
    if (space !== -1 && space < start) from = space + 1;
  }
  if (to < text.length) {
    const space = text.lastIndexOf(' ', to);
    if (space > end) to = space;
  }
  return clean(text.slice(from, to));
}

// ---------------------------------------------------------------------------
// Visible-copy extractors
// ---------------------------------------------------------------------------

function priceClaims(text, url) {
  const claims = [];
  const pattern = money();
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const index = match.index;
    const end = index + match[0].length;
    const cents = amountInCents(match[1], match[2]);
    if (cents === null || cents <= 0) continue;
    // "$1,000 off" and "20% discount" are not prices.
    const after = text.slice(end, end + 14);
    if (/^\s*(?:off\b|discount|savings)/i.test(after)) continue;
    if (/%\s*$/.test(text.slice(Math.max(0, index - 3), index))) continue;

    const period = periodAfter(text, end);
    const before = text.slice(Math.max(0, index - 48), index);
    const quote = contextQuote(text, index, end);

    if (/\b(?:starting\s+at|starts?\s+at|starting\s+from|from|as\s+low\s+as|begin(?:s|ning)?\s+at|only)\s*$/i.test(before)) {
      claims.push({
        category: 'pricing',
        attribute: 'starting_price:' + period,
        valueKey: 'usd:' + cents + ':' + period,
        valueDisplay: moneyDisplay(cents) + (period === 'once' ? '' : ' / ' + period),
        quote,
        sourceUrl: url,
        sourceKind: 'visible'
      });
    }

    // A plan price is only comparable against the same plan on another page,
    // so the plan word is part of the attribute, not the value.
    const plan = planWordBefore(text, index);
    if (plan && (period === 'month' || period === 'year')) {
      claims.push({
        category: 'pricing',
        attribute: 'plan_price:' + plan + ':' + period,
        valueKey: 'usd:' + cents + ':' + period,
        valueDisplay: moneyDisplay(cents) + ' / ' + period,
        quote,
        sourceUrl: url,
        sourceKind: 'visible'
      });
    }
  }
  return claims;
}

function phoneKey(digits) {
  let value = String(digits || '').replace(/\D/g, '');
  if (value.length === 11 && value.startsWith('1')) value = value.slice(1);
  return value.length === 10 ? value : '';
}

function phoneDisplay(key) {
  return '(' + key.slice(0, 3) + ') ' + key.slice(3, 6) + '-' + key.slice(6);
}

function phoneClaims(text, url) {
  const claims = [];
  const pattern = /(?<![\d$])(?:\+?1[\s.-]?)?\(?([2-9]\d{2})\)?[\s.-]?(\d{3})[\s.-](\d{4})(?!\d)/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const key = phoneKey(match[1] + match[2] + match[3]);
    if (!key) continue;
    claims.push({
      category: 'phone',
      attribute: 'phone',
      valueKey: 'phone:' + key,
      valueDisplay: phoneDisplay(key),
      quote: clean(match[0]),
      sourceUrl: url,
      sourceKind: 'visible'
    });
  }
  return claims;
}

const STREET_SUFFIX = 'Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Parkway|Pkwy|Court|Ct|Place|Pl|Circle|Cir|Terrace|Ter';
// Abbreviations and their long forms must canonicalise to one value, or
// "123 Main St" and "123 Main Street" would look like a contradiction.
const SUFFIX_KEY = {
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', road: 'rd', rd: 'rd',
  boulevard: 'blvd', blvd: 'blvd', drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln',
  way: 'way', parkway: 'pkwy', pkwy: 'pkwy', court: 'ct', ct: 'ct',
  place: 'pl', pl: 'pl', circle: 'cir', cir: 'cir', terrace: 'ter', ter: 'ter'
};

function addressKey(street, city, state, zip) {
  const normal = value => clean(value).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = [normal(street), normal(city), normal(state), String(zip || '').replace(/\D/g, '')];
  if (parts.some(part => !part)) return '';
  return 'addr:' + parts.join('|');
}

function addressClaims(text, url) {
  const claims = [];
  const pattern = new RegExp(
    '\\b(\\d{1,5})\\s+([A-Za-z0-9.\'-]+(?:\\s+[A-Za-z0-9.\'-]+){0,3})\\s+(' + STREET_SUFFIX + ')\\b\\.?'
    + '[\\s,]+([A-Za-z][A-Za-z .\'-]{1,28}),\\s*([A-Z]{2})\\s+(\\d{5})(?:-\\d{4})?\\b',
    'g'
  );
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const suffix = SUFFIX_KEY[match[3].toLowerCase()] || match[3].toLowerCase();
    const street = (match[1] + ' ' + match[2] + ' ' + suffix).replace(/\s+/g, ' ').trim();
    const key = addressKey(street, match[4], match[5], match[6]);
    if (!key) continue;
    claims.push({
      category: 'address',
      attribute: 'address',
      valueKey: key,
      valueDisplay: clean(match[0]),
      quote: clean(match[0]),
      sourceUrl: url,
      sourceKind: 'visible'
    });
  }
  return claims;
}

function toMinutes(hour, minute, meridiem, fallbackToAfternoon) {
  let value = Number(hour);
  if (!Number.isInteger(value) || value < 0 || value > 24) return null;
  const mins = minute === undefined || minute === null ? 0 : Number(minute);
  if (!Number.isInteger(mins) || mins < 0 || mins > 59) return null;
  if (meridiem) {
    const lower = meridiem.toLowerCase();
    if (value === 12) value = 0;
    if (lower === 'pm') value += 12;
  } else if (fallbackToAfternoon && value < 12) {
    value += 12;
  }
  if (value > 24) return null;
  return value * 60 + mins;
}

function clock(total) {
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function hoursKey(from, to) {
  const startDay = DAY_NAMES[from.toLowerCase()] || DAY_INDEX[from.slice(0, 2).toLowerCase()] || '';
  const endDay = DAY_NAMES[to.toLowerCase()] || DAY_INDEX[to.slice(0, 2).toLowerCase()] || '';
  return startDay && endDay ? startDay + '-' + endDay : '';
}

function hoursClaims(text, url) {
  const claims = [];
  if (/\b24\s*\/\s*7\b/.test(text)) {
    claims.push({
      category: 'hours',
      attribute: 'hours',
      valueKey: 'hours:24/7',
      valueDisplay: 'Open 24/7',
      quote: '24/7',
      sourceUrl: url,
      sourceKind: 'visible'
    });
  }

  const pattern = new RegExp(
    '\\b(' + DAY_PATTERN + ')\\s*(?:-|\\u2013|\\u2014|to|through|thru)\\s*(' + DAY_PATTERN + ')\\b'
    + '[\\s,:]*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?'
    + '\\s*(?:-|\\u2013|\\u2014|to)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?',
    'gi'
  );
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const days = hoursKey(match[1], match[2]);
    if (!days) continue;
    const endMeridiem = match[8];
    const noMeridiem = !match[5] && !endMeridiem;
    const endRaw = Number(match[6]);
    const startRaw = Number(match[3]);
    const crossesNoon = noMeridiem && endRaw <= startRaw;
    const start = toMinutes(match[3], match[4], match[5] || endMeridiem || null, false);
    const end = toMinutes(match[6], match[7], endMeridiem || match[5] || null, crossesNoon);
    if (start === null || end === null || end <= start) continue;
    claims.push({
      category: 'hours',
      attribute: 'hours',
      valueKey: 'hours:' + days + ':' + clock(start) + '-' + clock(end),
      valueDisplay: days.toUpperCase() + ' ' + clock(start) + '-' + clock(end),
      quote: clean(match[0]),
      sourceUrl: url,
      sourceKind: 'visible'
    });
  }
  return claims;
}

function foundedClaims(text, url, today) {
  const claims = [];
  const pattern = /\b(?:founded|established)\b(?:\s+in)?\s+((?:18|19|20)\d{2})\b|\b(?:since|in business since)\s+((?:18|19|20)\d{2})\b/gi;
  const currentYear = today.getUTCFullYear();
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const year = Number(match[1] || match[2]);
    if (!Number.isInteger(year) || year < 1900 || year > currentYear) continue;
    claims.push({
      category: 'founded',
      attribute: 'founded_year',
      valueKey: 'year:' + year,
      valueDisplay: String(year),
      quote: contextQuote(text, match.index, match.index + match[0].length),
      sourceUrl: url,
      sourceKind: 'visible'
    });
  }
  return claims;
}

function headcountClaims(text, url) {
  const claims = [];
  const pattern = /\b(?:team|staff)\s+of\s+(\d{1,4})\b|\b(\d{1,4})[\s-](?:person|people|member|employee)s?\b|\b(\d{1,4})\s+(?:employees|people|staff)\b/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const size = Number(match[1] || match[2] || match[3]);
    if (!Number.isInteger(size) || size < 1 || size > 100000) continue;
    claims.push({
      category: 'headcount',
      attribute: 'team_size',
      valueKey: 'size:' + size,
      valueDisplay: String(size),
      quote: contextQuote(text, match.index, match.index + match[0].length),
      sourceUrl: url,
      sourceKind: 'visible'
    });
  }
  return claims;
}

// ---------------------------------------------------------------------------
// JSON-LD extractors
// ---------------------------------------------------------------------------

function walkJsonLd(blocks, visit, depth = 0) {
  if (depth > 12) return;
  for (const block of blocks) {
    let parsed;
    try { parsed = JSON.parse(block); } catch { continue; }
    const step = (node, level) => {
      if (!node || typeof node !== 'object' || level > 8) return;
      if (Array.isArray(node)) { node.forEach(item => step(item, level + 1)); return; }
      visit(node);
      for (const value of Object.values(node)) {
        if (value && typeof value === 'object') step(value, level + 1);
      }
    };
    step(parsed, 0);
  }
}

function jsonLdDay(value) {
  const text = clean(value).toLowerCase().replace(/^https?:\/\/schema\.org\//, '');
  return DAY_NAMES[text] || DAY_INDEX[text.slice(0, 3)] || '';
}

function jsonLdClaims(blocks, url) {
  const claims = [];
  const push = (claim, quote) => claims.push({...claim, quote, sourceUrl: url, sourceKind: 'jsonld'});

  walkJsonLd(blocks, node => {
    const telephone = node.telephone;
    if (typeof telephone === 'string' && telephone.trim()) {
      const key = phoneKey(telephone);
      if (key) {
        push({
          category: 'phone',
          attribute: 'phone',
          valueKey: 'phone:' + key,
          valueDisplay: phoneDisplay(key)
        }, 'telephone: ' + clean(telephone));
      }
    }

    const address = node.address;
    if (address && typeof address === 'object' && !Array.isArray(address)) {
      const street = clean(address.streetAddress);
      const key = addressKey(street, address.addressLocality, address.addressRegion, address.postalCode);
      if (key) {
        push({
          category: 'address',
          attribute: 'address',
          valueKey: key,
          valueDisplay: [street, clean(address.addressLocality), clean(address.addressRegion) + ' ' + clean(address.postalCode)]
            .filter(Boolean).join(', ')
        }, 'address: ' + [street, clean(address.addressLocality), clean(address.addressRegion), clean(address.postalCode)]
          .filter(Boolean).join(', '));
      }
    }

    const founding = node.foundingDate;
    if (typeof founding === 'string' && /^(?:18|19|20)\d{2}/.test(founding.trim())) {
      const year = Number(founding.trim().slice(0, 4));
      push({
        category: 'founded',
        attribute: 'founded_year',
        valueKey: 'year:' + year,
        valueDisplay: String(year)
      }, 'foundingDate: ' + clean(founding));
    }

    const employees = node.numberOfEmployees;
    const headcount = typeof employees === 'number'
      ? employees
      : Number(employees && typeof employees === 'object' ? employees.value : NaN);
    if (Number.isInteger(headcount) && headcount > 0 && headcount <= 100000) {
      push({
        category: 'headcount',
        attribute: 'team_size',
        valueKey: 'size:' + headcount,
        valueDisplay: String(headcount)
      }, 'numberOfEmployees: ' + String(headcount));
    }

    const opening = node.openingHours;
    const list = Array.isArray(opening) ? opening : (typeof opening === 'string' ? [opening] : []);
    for (const entry of list) {
      const match = /^\s*([A-Za-z]{2})\s*-\s*([A-Za-z]{2})\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(String(entry));
      if (!match) continue;
      const days = hoursKey(match[1], match[2]);
      const start = toMinutes(match[3], match[4], null, false);
      const end = toMinutes(match[5], match[6], null, false);
      if (!days || start === null || end === null || end <= start) continue;
      push({
        category: 'hours',
        attribute: 'hours',
        valueKey: 'hours:' + days + ':' + clock(start) + '-' + clock(end),
        valueDisplay: days.toUpperCase() + ' ' + clock(start) + '-' + clock(end)
      }, 'openingHours: ' + clean(entry));
    }

    const specification = node.openingHoursSpecification;
    const specs = Array.isArray(specification) ? specification : (specification ? [specification] : []);
    for (const spec of specs) {
      if (!spec || typeof spec !== 'object') continue;
      const days = (Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek])
        .map(jsonLdDay).filter(Boolean);
      if (!days.length) continue;
      const start = toMinutes(String(spec.opens || '').split(':')[0], String(spec.opens || '').split(':')[1], null, false);
      const end = toMinutes(String(spec.closes || '').split(':')[0], String(spec.closes || '').split(':')[1], null, false);
      if (start === null || end === null || end <= start) continue;
      const range = days.length > 1 ? days[0] + '-' + days[days.length - 1] : days[0];
      push({
        category: 'hours',
        attribute: 'hours',
        valueKey: 'hours:' + range + ':' + clock(start) + '-' + clock(end),
        valueDisplay: range.toUpperCase() + ' ' + clock(start) + '-' + clock(end)
      }, 'openingHoursSpecification: ' + range + ' ' + clock(start) + '-' + clock(end));
    }
  });

  return claims;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function extractClaims({pages, today = new Date()} = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const now = today instanceof Date && !Number.isNaN(today.getTime()) ? today : new Date();
  const claims = [];
  const seen = new Set();

  const add = claim => {
    if (!claim || !claim.valueKey) return;
    const key = [claim.category, claim.attribute, claim.valueKey, claim.sourceUrl, claim.sourceKind].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    claims.push(claim);
  };

  for (const page of list) {
    if (!page || typeof page.url !== 'string') continue;
    const text = slice(clean(page.text), MAX_TEXT);
    if (text) {
      for (const claim of priceClaims(text, page.url)) add(claim);
      for (const claim of phoneClaims(text, page.url)) add(claim);
      for (const claim of addressClaims(text, page.url)) add(claim);
      for (const claim of hoursClaims(text, page.url)) add(claim);
      for (const claim of foundedClaims(text, page.url, now)) add(claim);
      for (const claim of headcountClaims(text, page.url)) add(claim);
    }

    const blocks = Array.isArray(page.jsonLd) ? page.jsonLd.slice(0, 30) : [];
    if (blocks.length) {
      for (const claim of jsonLdClaims(blocks, page.url)) add(claim);
    }
  }

  return claims;
}

module.exports = {extractClaims, phoneKey, addressKey, hoursKey};
