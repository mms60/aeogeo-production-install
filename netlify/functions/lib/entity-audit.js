'use strict';

const CORE_TYPES = new Set([
  'Organization',
  'Corporation',
  'LocalBusiness',
  'ProfessionalService',
  'Store',
  'Restaurant',
  'Person',
  'Service'
]);

function typeList(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string');
  return [];
}

function sameAsList(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string');
  return [];
}

function hostOf(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return '';
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Inspects parseable JSON-LD in a page. This is deliberately conservative:
 * it reports what is published, not whether Google or an AI engine will use it.
 */
function jsonLdScripts(html) {
  const source = String(html || '');
  const scripts = [];
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(source))) {
    const typeMatch = match[1].match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i) || [];
    const type = typeMatch[1] || typeMatch[2] || typeMatch[3] || '';
    if (/application\/ld\+json/i.test(type)) scripts.push(match[2]);
  }
  return scripts;
}

function inspectEntityHtml(html) {
  const blocks = [];
  let malformedJsonLdBlocks = 0;

  for (const script of jsonLdScripts(html)) {
    const raw = script.trim();
    if (!raw) {
      malformedJsonLdBlocks += 1;
      continue;
    }
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      malformedJsonLdBlocks += 1;
    }
  }

  let hasUnifiedGraph = false;
  let hasPersistentIds = false;
  let sameAsCount = 0;
  const detectedTypes = new Set();
  const coreEntityTypes = new Set();
  const sameAsHosts = new Set();

  function inspectNode(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(inspectNode);
      return;
    }

    for (const type of typeList(node['@type'])) {
      const name = type.trim();
      if (!name) continue;
      detectedTypes.add(name);
      if (CORE_TYPES.has(name)) coreEntityTypes.add(name);
    }

    if (typeof node['@id'] === 'string' && node['@id'].includes('#')) {
      hasPersistentIds = true;
    }

    for (const url of sameAsList(node.sameAs)) {
      if (!/^https?:\/\//i.test(url)) continue;
      sameAsCount += 1;
      const host = hostOf(url);
      if (host) sameAsHosts.add(host);
    }

    if (Array.isArray(node['@graph'])) {
      hasUnifiedGraph = true;
      node['@graph'].forEach(inspectNode);
    }
  }

  blocks.forEach(inspectNode);

  const fragmentationIssues = [];
  if (blocks.length === 0) {
    fragmentationIssues.push(
      'No readable brand identity data (JSON-LD) was found on the page. AI systems have to infer the business from page text alone.'
    );
  }
  if (malformedJsonLdBlocks > 0) {
    fragmentationIssues.push(
      `${malformedJsonLdBlocks} structured-data block${malformedJsonLdBlocks === 1 ? '' : 's'} could not be read. A syntax error can hide the whole entity from machines.`
    );
  }
  if (blocks.length > 1 && !hasUnifiedGraph) {
    fragmentationIssues.push(
      `The page publishes ${blocks.length} separate identity blocks instead of one connected graph. AI systems cannot reliably merge them into one brand.`
    );
  }
  if (blocks.length > 0 && !hasPersistentIds) {
    fragmentationIssues.push(
      'The identity blocks do not use persistent entity IDs (for example #organization). The same business can be treated as a different entity on every page.'
    );
  }
  if (blocks.length > 0 && sameAsCount === 0) {
    fragmentationIssues.push(
      'No verified external profiles are linked to the brand identity. Google Business Profile, LinkedIn, Crunchbase, and public knowledge bases are left to guesswork.'
    );
  }
  if (blocks.length > 0 && coreEntityTypes.size === 0) {
    fragmentationIssues.push(
      'No Organization, LocalBusiness, Person, or Service entity was found. The page describes content, but not who the business is.'
    );
  }

  return {
    jsonLdBlocksFound: blocks.length,
    malformedJsonLdBlocks,
    hasUnifiedGraph,
    hasPersistentIds,
    hasSameAsAnchors: sameAsCount > 0,
    sameAsCount,
    sameAsHosts: Array.from(sameAsHosts).sort(),
    detectedTypes: Array.from(detectedTypes).sort(),
    coreEntityTypes: Array.from(coreEntityTypes).sort(),
    fragmentationIssues
  };
}

module.exports = { inspectEntityHtml, CORE_TYPES };
