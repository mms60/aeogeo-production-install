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
      const node = {
        "@type": "Service",
        "@id": `${base}/services/${slug}/#service`,
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
