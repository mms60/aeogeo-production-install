/*
 * AI Entity & Citation Authority Setup: public audit and paid builder UI.
 * The JSON-LD compiler runs on the server and is never shipped to the browser.
 */
(function () {
  "use strict";

  var AUDIT_ENDPOINT = "/.netlify/functions/entity-audit";
  var CHECKOUT_ENDPOINT = "/.netlify/functions/entity-authority-checkout";
  var LIMITS = {
    single: { locations: 3, people: 2, services: 10 },
    multi: { locations: 10, people: 6, services: 10 }
  };
  var PLAN_LABEL = {
    single: "Single-Hub Brand",
    multi: "Multi-Location Brand"
  };
  var LIMIT_KEY = { location: "locations", person: "people", service: "services" };
  var STATUS_TIMER = 0;
  var SUPABASE_URL = "https://ftwohoenimegsmtliqgz.supabase.co";
  var SUPABASE_PUBLIC_KEY = "sb_publishable_0T08Pe4A0ZvoHD5CXrd1iA_BvUyVxAO";
  var authClient = null;
  var access = { checked: false, signedIn: false, email: "", active: false, plan: null, limits: null };

  function supabaseClient() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") return null;
    if (!authClient) {
      authClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY, {
        auth: { flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: true }
      });
    }
    return authClient;
  }

  async function currentSession() {
    var client = supabaseClient();
    if (!client) return null;
    try {
      var result = await client.auth.getSession();
      return result.data && result.data.session ? result.data.session : null;
    } catch (error) {
      return null;
    }
  }

  async function authFetch(name, body) {
    var session = await currentSession();
    if (!session) return { status: 401, data: { error: "Sign in to continue.", code: "SIGN_IN_REQUIRED" } };
    var response;
    try {
      response = await fetch("/.netlify/functions/" + name, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
        body: JSON.stringify(body || {}),
        cache: "no-store"
      });
    } catch (error) {
      return { status: 0, data: { error: "The server could not be reached. Check your connection and try again." } };
    }
    var data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    return { status: response.status, data: data || {} };
  }

  async function refreshAccess() {
    var session = await currentSession();
    access.checked = true;
    access.signedIn = Boolean(session);
    access.email = session && session.user ? session.user.email || "" : "";
    access.active = false;
    access.plan = null;
    access.limits = null;
    if (!session) return access;
    var result = await authFetch("entity-entitlement", {});
    if (result.status === 200 && result.data && result.data.active) {
      access.active = true;
      access.plan = result.data.plan || null;
      access.limits = result.data.limits || null;
    }
    return access;
  }

  function signInUrl() {
    return "/login/?next=" + encodeURIComponent("/ai-visibility-schema-studio#entity-audit-tool");
  }

  function checkoutSignInUrl() {
    return "/login/?next=" + encodeURIComponent("/ai-visibility-schema-studio#pricing");
  }

  function planName(plan) {
    return PLAN_LABEL[plan] || "DIY builder";
  }

  function updateAccessStatus() {
    var node = $("ea-access-status");
    if (!node) return;
    if (access.active) {
      node.textContent = "Signed in as " + (access.email || "your account") + ". " + planName(access.plan) + " DIY builder unlocked.";
    } else if (access.signedIn) {
      node.textContent = "Signed in as " + (access.email || "your account") + ". No DIY builder purchase is linked to this account yet.";
    } else {
      node.textContent = "Sign in to check a purchase. The free preview is available without an account.";
    }
  }

  function updateSubmitLabel() {
    var button = document.querySelector("#ea-builder-form button[type=submit]");
    if (button) button.textContent = access.active ? "Generate my JSON-LD" : "Preview the entity map";
  }

  function applyPlanLock() {
    var select = $("ea-plan");
    if (!select) return;
    var locked = Boolean(access.active && access.plan);
    if (locked) {
      select.value = access.plan;
      select.disabled = true;
    } else {
      select.disabled = false;
    }
    var note = $("ea-plan-lock");
    if (note) {
      note.hidden = !locked;
      note.textContent = locked ? "Your purchased plan is locked for this account." : "";
    }
    updateCounts();
    updateSubmitLabel();
  }

  function updateCheckoutUI() {
    var single = $("ea-checkout-single");
    var multi = $("ea-checkout-multi");
    var note = $("ea-checkout-note");
    if (!single || !multi) return;
    single.hidden = false;
    multi.hidden = false;
    single.textContent = "Buy Single-Hub ($799)";
    multi.textContent = "Buy Multi-Location ($1,199)";
    multi.removeAttribute("data-ea-upgrade");

    if (access.active && access.plan === "single") {
      single.hidden = true;
      multi.textContent = "Upgrade to Multi-Location ($400)";
      multi.setAttribute("data-ea-upgrade", "1");
      if (note) note.textContent = "Single-Hub DIY builder unlocked. Upgrade for the $400 difference to add up to 10 locations and 6 people.";
    } else if (access.active && access.plan === "multi") {
      single.hidden = true;
      multi.hidden = true;
      if (note) note.innerHTML = "Multi-Location DIY builder unlocked. <a href=\"#entity-audit-tool\">Open the builder</a>.";
    } else if (access.signedIn) {
      if (note) note.textContent = "No purchase is linked to " + (access.email || "your account") + " yet. If you just paid, refresh in a moment; purchases are matched to your verified account email.";
    } else if (note) {
      note.textContent = "Sign in before checkout so the purchase is linked to your account.";
    }
  }

  function applyAccessUI() {
    updateAccessStatus();
    applyPlanLock();
    updateCheckoutUI();
  }

  function $(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function safeLink(value, label) {
    try {
      var url = new URL(String(value || ""));
      if (!/^https?:$/.test(url.protocol)) return esc(label || value);
      return '<a href="' + esc(url.href) + '" target="_blank" rel="noopener noreferrer">' + esc(label || url.href) + "</a>";
    } catch (error) {
      return esc(label || value);
    }
  }

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "brand";
  }

  function setStatus(message, isError) {
    var status = $("ea-builder-status");
    if (!status) return;
    window.clearTimeout(STATUS_TIMER);
    status.textContent = message || "";
    status.classList.toggle("is-error", Boolean(isError));
    if (message && !isError) {
      STATUS_TIMER = window.setTimeout(function () {
        if (status.textContent === message) status.textContent = "";
      }, 5000);
    }
  }

  function currentPlan() {
    var select = $("ea-plan");
    return select && select.value === "multi" ? "multi" : "single";
  }

  function setIntakePlan(plan) {
    var select = $("ea-intake-plan");
    if (!select) return;
    select.value = plan === "multi" ? "Multi-Location Brand ($1,199)" : "Single-Hub Brand ($799)";
  }

  function setPlan(plan) {
    var selected = plan === "multi" ? "multi" : "single";
    var builderPlan = $("ea-plan");
    if (builderPlan) {
      builderPlan.value = selected;
      updateCounts();
    }
    setIntakePlan(selected);
    var target = $("get-started");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(function () {
      var name = document.querySelector('#ea-intake-form [name="name"]');
      if (name) name.focus({ preventScroll: true });
    }, 350);
  }

  function showPanel(name) {
    document.querySelectorAll("[data-ea-tab]").forEach(function (button) {
      var active = button.getAttribute("data-ea-tab") === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll(".ea-panel").forEach(function (panel) {
      var active = panel.id === "ea-panel-" + name;
      panel.classList.toggle("hidden", !active);
      panel.setAttribute("aria-hidden", String(!active));
    });
  }

  function scrollToolIntoView() {
    var tool = $("ea-tool");
    if (tool) tool.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* Repeaters ------------------------------------------------------------- */

  function locationTemplate() {
    return '' +
      '<div class="ea-repeater" data-kind="location">' +
        '<div class="ea-repeater-head"><strong>Location</strong><button type="button" class="ea-remove" data-ea-remove>Remove</button></div>' +
        '<div class="ea-form-grid">' +
          '<label class="ea-field">Location name <span class="ea-req">*</span><input data-field="name" type="text" maxlength="200" placeholder="Dallas Flagship Office"></label>' +
          '<label class="ea-field">URL slug<input data-field="slug" type="text" maxlength="80" placeholder="dallas"></label>' +
          '<label class="ea-field ea-field-wide">Location page URL<input data-field="locationPageUrl" type="url" placeholder="https://yourcompany.com/locations/dallas/"></label>' +
          '<label class="ea-field">Business type<select data-field="businessType">' +
            '<option value="LocalBusiness">LocalBusiness</option>' +
            '<option value="ProfessionalService">ProfessionalService</option>' +
            '<option value="LegalService">LegalService</option>' +
            '<option value="FinancialService">FinancialService</option>' +
            '<option value="HomeAndConstructionBusiness">HomeAndConstructionBusiness</option>' +
            '<option value="MedicalBusiness">MedicalBusiness</option>' +
            '<option value="Store">Store</option>' +
            '<option value="Restaurant">Restaurant</option>' +
          '</select></label>' +
          '<label class="ea-field">Phone<input data-field="telephone" type="tel" maxlength="80" placeholder="+1 (214) 555-0199"></label>' +
          '<label class="ea-field ea-field-wide">Street address<input data-field="streetAddress" type="text" maxlength="240" placeholder="2100 Ross Ave, Suite 400"></label>' +
          '<label class="ea-field">City<input data-field="city" type="text" maxlength="120" placeholder="Dallas"></label>' +
          '<label class="ea-field">State<input data-field="state" type="text" maxlength="120" placeholder="TX"></label>' +
          '<label class="ea-field">Postal code<input data-field="postalCode" type="text" maxlength="40" placeholder="75201"></label>' +
          '<label class="ea-field">Country<input data-field="country" type="text" maxlength="80" value="US"></label>' +
          '<details class="ea-repeater-advanced ea-field-wide"><summary>Advanced location signals</summary>' +
            '<div class="ea-form-grid">' +
              '<label class="ea-field">Latitude<input data-field="latitude" type="text" inputmode="decimal" placeholder="32.787"></label>' +
              '<label class="ea-field">Longitude<input data-field="longitude" type="text" inputmode="decimal" placeholder="-96.795"></label>' +
              '<label class="ea-field ea-field-wide">Google Maps URL<input data-field="googleMapsUrl" type="url" placeholder="https://maps.google.com/?cid=..."></label>' +
              '<label class="ea-field ea-field-wide">Google Business Profile URL<input data-field="gbpShareUrl" type="url" placeholder="https://g.page/r/..."></label>' +
            '</div>' +
          '</details>' +
        '</div>' +
      '</div>';
  }

  function personTemplate() {
    return '' +
      '<div class="ea-repeater" data-kind="person">' +
        '<div class="ea-repeater-head"><strong>Person</strong><button type="button" class="ea-remove" data-ea-remove>Remove</button></div>' +
        '<div class="ea-form-grid">' +
          '<label class="ea-field">Full name <span class="ea-req">*</span><input data-field="name" type="text" maxlength="200" placeholder="Jordan Vance"></label>' +
          '<label class="ea-field">URL slug<input data-field="slug" type="text" maxlength="80" placeholder="jordan-vance"></label>' +
          '<label class="ea-field">Job title<input data-field="jobTitle" type="text" maxlength="160" placeholder="Founder &amp; Principal"></label>' +
          '<label class="ea-field">Profile page URL<input data-field="profilePageUrl" type="url" placeholder="https://yourcompany.com/team/jordan-vance"></label>' +
          '<label class="ea-field ea-field-wide">Areas of expertise<textarea data-field="knowsAbout" rows="2" placeholder="AI search, entity strategy, local SEO"></textarea><span class="ea-hint">Separate with commas.</span></label>' +
          '<label class="ea-field ea-field-wide">Verified profiles<textarea data-field="sameAsUrls" rows="2" placeholder="One URL per line: LinkedIn, license, publications"></textarea></label>' +
        '</div>' +
      '</div>';
  }

  function serviceTemplate() {
    return '' +
      '<div class="ea-repeater" data-kind="service">' +
        '<div class="ea-repeater-head"><strong>Service</strong><button type="button" class="ea-remove" data-ea-remove>Remove</button></div>' +
        '<div class="ea-form-grid">' +
          '<label class="ea-field">Service name <span class="ea-req">*</span><input data-field="name" type="text" maxlength="200" placeholder="AI Search &amp; Entity Optimization"></label>' +
          '<label class="ea-field">URL slug<input data-field="slug" type="text" maxlength="80" placeholder="entity-booster"></label>' +
          '<label class="ea-field ea-field-wide">Service page URL<input data-field="serviceUrl" type="url" placeholder="https://yourcompany.com/services/entity-booster/"></label>' +
          '<label class="ea-field ea-field-wide">Description<textarea data-field="description" rows="2" maxlength="1200" placeholder="What the service is and who it is for."></textarea></label>' +
          '<label class="ea-field ea-field-wide">Cities served<textarea data-field="areaServedCities" rows="2" placeholder="One per line: Dallas | https://www.wikidata.org/wiki/Q16557"></textarea><span class="ea-hint">The Wikidata URL is optional but strengthens the geography.</span></label>' +
        '</div>' +
      '</div>';
  }

  function containerFor(kind) {
    if (kind === "location") return $("ea-locations");
    if (kind === "person") return $("ea-people");
    return $("ea-services");
  }

  function itemCount(kind) {
    var container = containerFor(kind);
    return container ? container.querySelectorAll(".ea-repeater").length : 0;
  }

  function updateCounts() {
    var plan = currentPlan();
    var limits = LIMITS[plan];
    var locations = itemCount("location");
    var people = itemCount("person");
    var services = itemCount("service");

    var locationCount = $("ea-location-count");
    if (locationCount) {
      locationCount.textContent = locations + " / " + limits.locations;
      locationCount.classList.toggle("is-over", locations > limits.locations);
    }
    var personCount = $("ea-person-count");
    if (personCount) {
      personCount.textContent = people + " / " + limits.people;
      personCount.classList.toggle("is-over", people > limits.people);
    }
    var serviceCount = $("ea-service-count");
    if (serviceCount) serviceCount.textContent = services + " service" + (services === 1 ? "" : "s");

    document.querySelectorAll("[data-ea-add]").forEach(function (button) {
      var kind = button.getAttribute("data-ea-add");
      var limit = limits[LIMIT_KEY[kind]];
      var count = itemCount(kind);
      button.disabled = count >= limit;
      button.title = count >= limit ? "This plan covers up to " + limit + " " + kind + (limit === 1 ? "" : "s") + "." : "";
    });
  }

  function renumber() {
    [
      ["location", "Location"],
      ["person", "Person"],
      ["service", "Service"]
    ].forEach(function (pair) {
      var container = containerFor(pair[0]);
      if (!container) return;
      Array.prototype.forEach.call(container.querySelectorAll(".ea-repeater"), function (item, index) {
        var label = item.querySelector(".ea-repeater-head strong");
        if (label) label.textContent = pair[1] + " " + (index + 1);
      });
    });
  }

  function setField(item, name, value) {
    var input = item.querySelector('[data-field="' + name + '"]');
    if (input) input.value = value == null ? "" : String(value);
  }

  function addItem(kind, data) {
    var container = containerFor(kind);
    if (!container) return null;
    var limits = LIMITS[currentPlan()];
    var limit = limits[LIMIT_KEY[kind]];
    if (container.querySelectorAll(".ea-repeater").length >= limit) {
      setStatus("The " + PLAN_LABEL[currentPlan()] + " plan covers up to " + limit + " " + (kind === "person" ? "people" : kind + "s") + ". Remove one or switch plans.", true);
      return null;
    }
    var holder = document.createElement("div");
    holder.innerHTML = kind === "location" ? locationTemplate() : kind === "person" ? personTemplate() : serviceTemplate();
    var item = holder.firstElementChild;
    if (!item) return null;
    var remove = item.querySelector("[data-ea-remove]");
    if (remove) {
      remove.addEventListener("click", function () {
        item.remove();
        renumber();
        updateCounts();
      });
    }
    container.appendChild(item);
    if (data) {
      Object.keys(data).forEach(function (key) {
        if (Array.isArray(data[key])) {
          setField(item, key, data[key].join("\n"));
        } else {
          setField(item, key, data[key]);
        }
      });
    }
    renumber();
    updateCounts();
    return item;
  }

  function fieldValue(item, name) {
    var input = item.querySelector('[data-field="' + name + '"]');
    return input ? String(input.value || "").trim() : "";
  }

  function blankLocation(item) {
    return !["name", "slug", "locationPageUrl", "telephone", "streetAddress", "city", "state", "postalCode", "googleMapsUrl", "gbpShareUrl"].some(function (name) {
      return fieldValue(item, name);
    });
  }

  function blankPerson(item) {
    return !["name", "slug", "jobTitle", "profilePageUrl", "knowsAbout", "sameAsUrls"].some(function (name) {
      return fieldValue(item, name);
    });
  }

  function blankService(item) {
    return !["name", "slug", "serviceUrl", "description", "areaServedCities"].some(function (name) {
      return fieldValue(item, name);
    });
  }

  function splitLines(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  }

  function splitList(value) {
    return String(value || "")
      .split(/\r?\n|,/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  }

  function readLocations() {
    var container = $("ea-locations");
    if (!container) return [];
    return Array.prototype.slice.call(container.querySelectorAll(".ea-repeater"))
      .filter(function (item) { return !blankLocation(item); })
      .map(function (item) {
        var latitude = fieldValue(item, "latitude");
        var longitude = fieldValue(item, "longitude");
        var location = {
          name: fieldValue(item, "name"),
          slug: fieldValue(item, "slug"),
          locationPageUrl: fieldValue(item, "locationPageUrl"),
          businessType: fieldValue(item, "businessType"),
          telephone: fieldValue(item, "telephone"),
          streetAddress: fieldValue(item, "streetAddress"),
          city: fieldValue(item, "city"),
          state: fieldValue(item, "state"),
          postalCode: fieldValue(item, "postalCode"),
          country: fieldValue(item, "country"),
          googleMapsUrl: fieldValue(item, "googleMapsUrl"),
          gbpShareUrl: fieldValue(item, "gbpShareUrl")
        };
        if (latitude !== "" && Number.isFinite(Number(latitude))) location.latitude = Number(latitude);
        if (longitude !== "" && Number.isFinite(Number(longitude))) location.longitude = Number(longitude);
        return location;
      });
  }

  function readPeople() {
    var container = $("ea-people");
    if (!container) return [];
    return Array.prototype.slice.call(container.querySelectorAll(".ea-repeater"))
      .filter(function (item) { return !blankPerson(item); })
      .map(function (item) {
        return {
          name: fieldValue(item, "name"),
          slug: fieldValue(item, "slug"),
          jobTitle: fieldValue(item, "jobTitle"),
          profilePageUrl: fieldValue(item, "profilePageUrl"),
          knowsAbout: splitList(fieldValue(item, "knowsAbout")),
          sameAsUrls: splitLines(fieldValue(item, "sameAsUrls"))
        };
      });
  }

  function readServices() {
    var container = $("ea-services");
    if (!container) return [];
    return Array.prototype.slice.call(container.querySelectorAll(".ea-repeater"))
      .filter(function (item) { return !blankService(item); })
      .map(function (item) {
        var areaServedCities = splitLines(fieldValue(item, "areaServedCities")).map(function (line) {
          var parts = line.split("|");
          var name = (parts[0] || "").trim();
          var url = (parts[1] || "").trim();
          return { name: name, ...(url ? { wikidataUrl: url } : {}) };
        }).filter(function (city) { return city.name; });
        return {
          name: fieldValue(item, "name"),
          slug: fieldValue(item, "slug"),
          serviceUrl: fieldValue(item, "serviceUrl"),
          description: fieldValue(item, "description"),
          areaServedCities: areaServedCities
        };
      });
  }

  function brandField(name) {
    var input = document.querySelector('#ea-builder-form [data-field="' + name + '"]');
    return input ? String(input.value || "").trim() : "";
  }

  function readBrand() {
    return {
      domain: brandField("domain"),
      brandName: brandField("brandName"),
      legalName: brandField("legalName"),
      description: brandField("description"),
      disambiguatingDescription: brandField("disambiguatingDescription"),
      logoUrl: brandField("logoUrl"),
      telephone: brandField("telephone"),
      foundingYear: brandField("foundingYear"),
      sameAsUrls: splitLines(brandField("sameAsUrls")),
      locations: readLocations(),
      people: readPeople(),
      services: readServices()
    };
  }

  function setBrandField(name, value) {
    var input = document.querySelector('#ea-builder-form [data-field="' + name + '"]');
    if (input) input.value = value == null ? "" : String(value);
  }

  /* Audit ----------------------------------------------------------------- */

  function auditLoading() {
    var output = $("ea-audit-output");
    output.setAttribute("aria-busy", "true");
    output.innerHTML = '<div class="ea-loading"><span class="ea-spinner" aria-hidden="true"></span><span>Reading the public page and checking how the brand is connected…</span></div>';
  }

  function auditError(message) {
    var output = $("ea-audit-output");
    output.setAttribute("aria-busy", "false");
    output.innerHTML = '<div class="ea-error"><strong>The check could not finish.</strong>' + esc(message) + '</div><p class="ea-fine">Try again in a moment, or use the <a href="/contact">contact form</a> and include the URL.</p>';
  }

  function auditValue(value, fallback) {
    return value == null || value === "" ? fallback : String(value);
  }

  function renderAudit(data) {
    var output = $("ea-audit-output");
    var matches = Array.isArray(data.knowledgeGraphMatches) ? data.knowledgeGraphMatches : [];
    var issues = Array.isArray(data.fragmentationIssues) ? data.fragmentationIssues : [];
    var types = Array.isArray(data.detectedTypes) ? data.detectedTypes : [];
    var hosts = Array.isArray(data.sameAsHosts) ? data.sameAsHosts : [];
    var url = data.finalUrl || data.url || "";
    var score = function (label, value, note, tone) {
      return '<div class="ea-score ' + esc(tone) + '"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong><small>' + esc(note) + '</small></div>';
    };
    var graphTone = data.hasUnifiedGraph ? "is-good" : "is-warn";
    var idTone = data.hasPersistentIds ? "is-good" : "is-warn";
    var anchorTone = data.hasSameAsAnchors ? "is-good" : "is-warn";
    var collisionTone = "is-neutral";
    var collisionValue = "Not enabled";
    var collisionNote = "Not available in this free check";
    if (data.knowledgeGraphEnabled) {
      collisionValue = matches.length ? matches.length + " match" + (matches.length === 1 ? "" : "es") : "No match";
      collisionNote = matches.length > 1 ? "Possible collision" : "Google Knowledge Graph";
      collisionTone = matches.length > 1 ? "is-warn" : "is-neutral";
    }

    var recommendations = [];
    if (!data.hasUnifiedGraph) recommendations.push("Publish one connected @graph, or one Organization block that every page references, instead of several disconnected identity blocks.");
    if (!data.hasPersistentIds) recommendations.push("Give the Organization and each connected entity a stable @id so search systems can merge the same business across pages.");
    if (!data.hasSameAsAnchors) recommendations.push("Add sameAs links to the official profiles you control, such as LinkedIn, Wikidata, or your Google Business Profile.");
    if (matches.length > 1) recommendations.push("Disambiguate the brand name so namesake companies are not blended with yours.");
    if (!types.length) recommendations.push("Publish Organization markup first, then connect the locations, people, and services that belong to it.");
    if (types.length && types.indexOf("Person") === -1) recommendations.push("Connect the founders or lead specialists to the brand with Person entities and verified profile links.");
    if (!recommendations.length) recommendations.push("Keep the published graph stable and re-run this check after any site or profile change.");

    var html = '' +
      '<div class="ea-result-head">' +
        '<div><p class="ea-output-kicker">PUBLIC ENTITY CHECK</p><h3>' + esc(auditValue(data.brandName, "Your brand")) + '</h3><p>' + safeLink(url, url) + '</p></div>' +
        '<span class="ea-http">HTTP ' + esc(auditValue(data.httpStatus, "Unknown")) + '</span>' +
      '</div>' +
      '<div class="ea-score-grid">' +
        score("Brand graph", data.hasUnifiedGraph ? "Connected" : "Fragmented", data.hasUnifiedGraph ? "One graph on this page" : "Separate blocks on this page", graphTone) +
        score("Permanent IDs", data.hasPersistentIds ? "Present" : "Not found", data.hasPersistentIds ? "Stable @id values on this page" : "No stable @id values on this page", idTone) +
        score("External anchors", data.hasSameAsAnchors ? data.sameAsCount + " found" : "Not found", hosts.length ? hosts.slice(0, 3).join(" · ") : "No profile links on this page", anchorTone) +
        score("Collision check", collisionValue, collisionNote, collisionTone) +
      '</div>' +
              '<div class="ea-block"><h4>' + (issues.length ? "What this page is missing" : "Public page signals") + '</h4>' +
        (issues.length
          ? '<ul class="ea-issue-list">' + issues.map(function (issue) { return '<li class="ea-issue">' + esc(issue) + '</li>'; }).join("") + '</ul>'
          : '<p class="ea-pass">No fragmentation issues were detected in the public page markup. That does not prove every location, person, or profile is connected; this check only reads one public page.</p>') +
      '</div>' +
      '<div class="ea-block"><h4>Recommended next steps</h4><ol class="ea-instructions">' + recommendations.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join("") + '</ol></div>';

    if (types.length) {
      html += '<div class="ea-block"><h4>Entity types found</h4><div class="ea-types">' + types.map(function (type) { return '<span class="ea-type">' + esc(type) + '</span>'; }).join("") + '</div></div>';
    }

    if (data.knowledgeGraphEnabled) {
      html += '<div class="ea-block"><h4>Google Knowledge Graph candidates</h4>';
      if (matches.length) {
        if (matches.length > 1) {
          html += '<p class="ea-issue" style="margin-bottom:7px">More than one matching entity can split or blur the brand. The paid DIY builder lets you add disambiguating signals to the entity graph.</p>';
        }
        html += '<div class="ea-kg-list">' + matches.map(function (match) {
          return '<div class="ea-kg"><strong>' + esc(match.name || "Unnamed entity") + '</strong>' +
            (match.description ? '<span>' + esc(match.description) + '</span>' : '') +
            '<small>' + esc((match.types || []).join(" · ")) + (match.resultScore ? ' · score ' + esc(Math.round(match.resultScore)) : '') + '</small>' +
            (match.detailedDescriptionUrl ? '<span>' + safeLink(match.detailedDescriptionUrl, "Knowledge Graph record") + '</span>' : '') +
            '</div>';
        }).join("") + '</div>';
      } else {
        html += '<p class="ea-pass">No candidate entity was found for this brand name. That can mean the brand has no Knowledge Graph entry yet, or the name is too generic for a confident match.</p>';
      }
      html += '</div>';
    } else {
              html += '<div class="ea-block"><h4>Google Knowledge Graph collision check</h4><p class="ea-pass">This public checker is not connected to the Knowledge Graph API, so it cannot test for namesake collisions. The paid DIY builder generates the entity graph, but it does not query live AI answers.</p></div>';
    }

    html += '<div class="ea-result-actions"><button class="ea-button" id="ea-build-from-audit" type="button">Preview the entity map</button><a href="#pricing">View DIY Builder Packages</a></div>' +
      '<p class="ea-fine">This check reads one public page. It does not query ChatGPT, Perplexity, or Google’s live answers, and the paid DIY builder does not query live AI answers either.</p>';

    output.setAttribute("aria-busy", "false");
    output.innerHTML = html;
    var buildButton = $("ea-build-from-audit");
    if (buildButton) {
      buildButton.addEventListener("click", function () {
        useAuditForBuilder(data);
      });
    }
  }

  function useAuditForBuilder(data) {
    var auditUrl = data.finalUrl || data.url;
    try {
      var origin = new URL(auditUrl).origin;
      setBrandField("domain", origin);
    } catch (error) {
      // The audit already validated the URL; leave the field alone if it cannot be parsed.
    }
    if (!brandField("brandName") && data.brandName) setBrandField("brandName", data.brandName);
    showPanel("builder");
    if (!itemCount("location")) addItem("location");
    setStatus("Domain and brand name copied from the check. Add a verified location, then preview the map.");
    scrollToolIntoView();
    window.setTimeout(function () {
      var locationName = document.querySelector('#ea-locations [data-field="name"]');
      if (locationName) locationName.focus({ preventScroll: true });
    }, 350);
  }

  function initAudit() {
    var form = $("ea-audit-form");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var urlInput = $("ea-audit-url");
      var brandInput = $("ea-audit-brand");
      var rawUrl = String(urlInput.value || "").trim();
      var brand = String(brandInput.value || "").trim();
      if (rawUrl && !/^https?:\/\//i.test(rawUrl) && rawUrl.includes(".")) rawUrl = "https://" + rawUrl;
      var target;
      try { target = new URL(rawUrl); } catch (error) { target = null; }
      if (!target || !/^https?:$/.test(target.protocol)) {
        auditError("Enter a full public website address, for example https://yourcompany.com.");
        urlInput.focus();
        return;
      }
      if (!brand) {
        auditError("Enter the brand name you want AI engines to resolve.");
        brandInput.focus();
        return;
      }

      var button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      auditLoading();

      try {
        var response = await fetch(AUDIT_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: target.href, brandName: brand })
        });
        var data = null;
        try { data = await response.json(); } catch (error) { data = null; }
        if (!response.ok) {
          auditError(data && data.error ? data.error : "The public check is unavailable right now. Try again in a moment.");
          return;
        }
        if (!data || typeof data !== "object") {
          auditError("The public check returned an unreadable response. Try again.");
          return;
        }
        renderAudit(data);
      } catch (error) {
        auditError("The public check could not reach the server. Check your connection and try again.");
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  /* Graph builder --------------------------------------------------------- */

  function mapLoading(message) {
    var output = $("ea-builder-output");
    output.setAttribute("aria-busy", "true");
    output.innerHTML = '<div class="ea-loading"><span class="ea-spinner" aria-hidden="true"></span><span>' + esc(message || "Preparing your structure preview...") + '</span></div>';
  }

  function mapError(message) {
    var output = $("ea-builder-output");
    output.setAttribute("aria-busy", "false");
    output.innerHTML = '<div class="ea-error"><strong>The map could not be built.</strong>' + esc(message) + '</div>';
  }

  function copyText(text, button) {
    var original = button ? button.textContent : "";
    var done = function () {
      if (!button) return;
      button.textContent = "Copied";
      window.setTimeout(function () { button.textContent = original; }, 1600);
    };
    var fallback = function () {
      var helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      try { document.execCommand("copy"); done(); } catch (error) { /* Clipboard access can be blocked. */ }
      helper.remove();
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function downloadJson(text, brandName) {
    var blob = new Blob([text], { type: "application/ld+json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "entity-map-" + slugify(brandName) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function domainOrigin(value) {
    try {
      var url = new URL(String(value || ""));
      return /^https?:$/.test(url.protocol) ? url.origin : "";
    } catch (error) {
      return "";
    }
  }

  function structureRows(input) {
    var base = domainOrigin(input.domain);
    var rows = [];
    if (!base) return rows;
    rows.push({ type: "Organization", id: base + "/#organization", note: "Parent brand identity" });
    rows.push({ type: "WebSite", id: base + "/#website", note: "Publisher points to the Organization" });
    (input.locations || []).forEach(function (location, index) {
      rows.push({
        type: location.businessType || "LocalBusiness",
        id: base + "/locations/" + slugify(location.slug || location.name || ("location-" + (index + 1))) + "/#localbusiness",
        note: "parentOrganization points to the Organization"
      });
    });
    (input.people || []).forEach(function (person, index) {
      rows.push({
        type: "Person",
        id: base + "/#person-" + slugify(person.slug || person.name || ("person-" + (index + 1))),
        note: "worksFor points to the Organization"
      });
    });
    (input.services || []).forEach(function (service, index) {
      rows.push({
        type: "Service",
        id: base + "/services/" + slugify(service.slug || service.name || ("service-" + (index + 1))) + "/#service",
        note: "provider points to the Organization"
      });
    });
    return rows;
  }

  function renderPreview(input, state) {
    state = state || {};
    var rows = structureRows(input);
    var output = $("ea-builder-output");
    output.setAttribute("aria-busy", "false");
    var accessNote = state.signedIn
      ? '<p class="ea-access-note">Signed in as ' + esc(state.email || "your account") + '. No DIY builder purchase is linked to this account yet.</p>' +
        '<p class="ea-access-note">If you just paid, refresh this page. Purchases are matched to your verified account email; if it still does not appear, <a href="/contact">contact us</a>.</p>'
      : '<p class="ea-access-note">Already purchased? <a href="' + esc(signInUrl()) + '">Sign in</a> to check the purchase linked to your account.</p>';
    output.innerHTML = '' +
      '<div class="ea-result-head"><div><p class="ea-output-kicker">FREE STRUCTURE PREVIEW</p><h3>' + esc(input.brandName || "Your brand") + '</h3><p>' + esc(domainOrigin(input.domain)) + '</p></div><span class="ea-http">STRUCTURE ONLY</span></div>' +
      '<div class="ea-map-summary">' +
        '<div><strong>' + rows.length + '</strong><span>Planned entities</span></div>' +
        '<div><strong>' + (input.locations || []).length + '</strong><span>Locations</span></div>' +
        '<div><strong>' + (input.people || []).length + '</strong><span>People</span></div>' +
        '<div><strong>' + (input.services || []).length + '</strong><span>Services</span></div>' +
      '</div>' +
      '<div class="ea-block"><h4>Planned entity relationships</h4>' +
        '<ul class="ea-preview-list">' + rows.map(function (row) {
          return '<li><strong>' + esc(row.type) + '</strong><code>' + esc(row.id) + '</code><span>' + esc(row.note) + '</span></li>';
        }).join("") + '</ul>' +
        '<p class="ea-fine">This preview shows the structure and stable identifiers only. It is not a JSON-LD implementation and cannot be copied into a site.</p>' +
      '</div>' +
      '<div class="ea-locked">' +
        '<p class="ea-output-kicker">PAID DIY BUILDER</p>' +
        '<h3>Build Your Complete Brand Entity Architecture</h3>' +
        '<p>Your business deserves more than disconnected schema markup.</p>' +
        '<p>The paid builder turns the verified facts you enter into the complete customized JSON-LD graph, connecting your brand identity, locations, services, leadership, and supporting authority signals so search systems can interpret your business.</p>' +
        '<p><strong>Unlock the complete DIY builder with AEOGEO Search.</strong></p>' +
        '<a class="ea-button" href="#pricing">View DIY Builder Packages</a>' +
        '<p class="ea-fine">The free preview shows structure only. The paid plan unlocks the complete customized JSON-LD, copy and download tools, validation, and implementation instructions for the limits of the plan you choose. You review and publish the markup yourself; no done-for-you build or AI testing report is included. Full-service implementation is available separately from AEOGEO Search.</p>' +
        accessNote +
      '</div>';
    output.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderPaidMap(data, input) {
    var json = JSON.stringify(data.jsonLd, null, 2);
    var output = $("ea-builder-output");
    output.setAttribute("aria-busy", "false");
    var validation = Array.isArray(data.validation) ? data.validation : [];
    var instructions = Array.isArray(data.instructions) ? data.instructions : [];
    output.innerHTML = '' +
      '<div class="ea-result-head"><div><p class="ea-output-kicker">DIY JSON-LD BUILDER</p><h3>' + esc(input.brandName) + '</h3><p>' + esc(planName(data.plan)) + '</p></div><span class="ea-http">JSON-LD</span></div>' +
      '<pre class="ea-json" id="ea-json-output">' + esc(json) + '</pre>' +
      '<div class="ea-output-actions"><button class="ea-copy" id="ea-copy-json" type="button">Copy JSON-LD</button><button class="ea-copy" id="ea-download-json" type="button">Download .json</button></div>' +
      '<div class="ea-block"><h4>Validation</h4>' +
        (validation.length
          ? '<ul class="ea-issue-list">' + validation.map(function (item) { return '<li class="ea-issue">' + esc(item) + '</li>'; }).join("") + '</ul>'
          : '<p class="ea-pass">The generated graph passed the built-in structure and reference checks. Validate the published markup with a Schema.org validator before release.</p>') +
      '</div>' +
      '<div class="ea-block"><h4>Implementation instructions</h4><ol class="ea-instructions">' + instructions.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join("") + '</ol></div>' +
      '<p class="ea-output-note">Draft only. Verify every fact, URL, and relationship before publishing. This output does not change your site, and it does not guarantee rankings, citations, or recommendations.</p>';
    var copyButton = $("ea-copy-json");
    if (copyButton) {
      copyButton.addEventListener("click", function () {
        var pre = $("ea-json-output");
        copyText(pre ? pre.textContent : json, copyButton);
      });
    }
    var downloadButton = $("ea-download-json");
    if (downloadButton) {
      downloadButton.addEventListener("click", function () { downloadJson(json, input.brandName); });
    }
    if (window.matchMedia("(max-width: 1024px)").matches) {
      output.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function loadExample() {
    ["ea-locations", "ea-people", "ea-services"].forEach(function (id) {
      var container = $(id);
      if (container) container.innerHTML = "";
    });

    setBrandField("domain", "https://examplebrand.com");
    setBrandField("brandName", "Example Client Brand");
    setBrandField("legalName", "Example Client Brand LLC");
    setBrandField("foundingYear", "2014");
    setBrandField("logoUrl", "https://examplebrand.com/assets/logo.png");
    setBrandField("telephone", "+1 (214) 555-0199");
    setBrandField("description", "A Dallas-based professional services brand used as an example for the connected entity map.");
    setBrandField("disambiguatingDescription", "Not affiliated with similarly named companies outside Texas.");
    setBrandField("sameAsUrls", "https://www.linkedin.com/company/example-brand\nhttps://www.wikidata.org/wiki/Q123456789\nhttps://www.crunchbase.com/organization/example-brand");

    addItem("location", {
      name: "Dallas Flagship Office",
      slug: "dallas",
      locationPageUrl: "https://examplebrand.com/locations/dallas/",
      businessType: "ProfessionalService",
      telephone: "+1 (214) 555-0199",
      streetAddress: "2100 Ross Ave, Suite 400",
      city: "Dallas",
      state: "TX",
      postalCode: "75201",
      country: "US",
      latitude: "32.787",
      longitude: "-96.795",
      googleMapsUrl: "https://maps.google.com/?cid=9876543210987654321",
      gbpShareUrl: "https://g.page/r/example-brand-dallas"
    });
    addItem("person", {
      name: "Jordan Vance",
      slug: "jordan-vance",
      jobTitle: "Founder & Principal Entity Architect",
      profilePageUrl: "https://examplebrand.com/team/jordan-vance",
      knowsAbout: "AI search, entity strategy, local SEO",
      sameAsUrls: "https://www.linkedin.com/in/jordan-vance-aeogeo"
    });
    addItem("service", {
      name: "AI Search & Entity Optimization",
      slug: "entity-booster",
      serviceUrl: "https://examplebrand.com/services/entity-booster/",
      description: "Connects the brand to its locations, people, and verified profiles so search systems can interpret the business consistently.",
      areaServedCities: "Dallas | https://www.wikidata.org/wiki/Q16557\nPlano"
    });
    updateCounts();
    setStatus("Example data loaded. Replace it with verified facts before using the map.");
    var first = document.querySelector('#ea-builder-form [data-field="brandName"]');
    if (first) first.focus({ preventScroll: true });
  }

  function validateBuilderInput(input) {
    var errors = [];
    var base = domainOrigin(input.domain);
    if (!base) {
      errors.push({
        message: "Enter a full website URL, for example https://yourcompany.com.",
        selector: '#ea-builder-form [data-field="domain"]'
      });
    }
    if (!String(input.brandName || "").trim()) {
      errors.push({
        message: "Enter the brand name you want search systems to resolve.",
        selector: '#ea-builder-form [data-field="brandName"]'
      });
    }
    if (!String(input.description || "").trim()) {
      errors.push({
        message: "Add a short description of the business.",
        selector: '#ea-builder-form [data-field="description"]'
      });
    }
    if (!input.locations.length) {
      errors.push({
        message: "Add at least one location or service area before previewing the entity map.",
        selector: '#ea-locations [data-field="name"]'
      });
    }
    input.locations.forEach(function (location, index) {
      if (!String(location.name || "").trim()) {
        errors.push({
          message: "Location " + (index + 1) + " needs a name.",
          selector: '#ea-locations .ea-repeater:nth-child(' + (index + 1) + ') [data-field="name"]'
        });
      }
    });
    input.people.forEach(function (person, index) {
      if (!String(person.name || "").trim()) {
        errors.push({
          message: "Person " + (index + 1) + " needs a name.",
          selector: '#ea-people .ea-repeater:nth-child(' + (index + 1) + ') [data-field="name"]'
        });
      }
    });
    input.services.forEach(function (service, index) {
      if (!String(service.name || "").trim()) {
        errors.push({
          message: "Service " + (index + 1) + " needs a name.",
          selector: '#ea-services .ea-repeater:nth-child(' + (index + 1) + ') [data-field="name"]'
        });
      }
    });
    if (!base) return errors;

    var seen = new Set();
    function claimId(id, message, selector) {
      if (seen.has(id)) {
        errors.push({ message: message, selector: selector });
        return;
      }
      seen.add(id);
    }
    input.locations.forEach(function (location, index) {
      var id = base + "/locations/" + slugify(location.slug || location.name || ("location-" + (index + 1))) + "/#localbusiness";
      claimId(
        id,
        "Duplicate entity ID: two or more locations use the same @id. Give each location a unique URL slug.",
        '#ea-locations .ea-repeater:nth-child(' + (index + 1) + ') [data-field="slug"]'
      );
    });
    input.people.forEach(function (person, index) {
      var id = base + "/#person-" + slugify(person.slug || person.name || ("person-" + (index + 1)));
      claimId(
        id,
        "Duplicate entity ID: two or more people use the same @id. Give each person a unique URL slug.",
        '#ea-people .ea-repeater:nth-child(' + (index + 1) + ') [data-field="slug"]'
      );
    });
    input.services.forEach(function (service, index) {
      var id = base + "/services/" + slugify(service.slug || service.name || ("service-" + (index + 1))) + "/#service";
      claimId(
        id,
        "Duplicate entity ID: two or more services use the same @id. Give each service a unique URL slug.",
        '#ea-services .ea-repeater:nth-child(' + (index + 1) + ') [data-field="slug"]'
      );
    });
    return errors;
  }

  function initBuilder() {
    var form = $("ea-builder-form");
    if (!form) return;
    addItem("location");
    updateCounts();

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      setStatus("");
      var input = readBrand();
      var errors = validateBuilderInput(input);
      if (errors.length) {
        var firstError = errors[0];
        setStatus(firstError.message, true);
        mapError(firstError.message);
        var target = firstError.selector ? document.querySelector(firstError.selector) : null;
        if (target && target.focus) target.focus({ preventScroll: true });
        return;
      }
      mapLoading("Preparing your structure preview...");
      var state = await refreshAccess();
      applyAccessUI();
      if (!state.active) {
        renderPreview(input, state);
        if (!state.signedIn) setStatus("Preview only. Sign in with a purchased account to generate the complete JSON-LD.");
        return;
      }
      mapLoading("Generating your complete JSON-LD...");
      var result = await authFetch("entity-implementation", { input: input });
      if (result.status === 200 && result.data && result.data.jsonLd) {
        renderPaidMap(result.data, input);
        setStatus("Complete DIY JSON-LD generated for the " + planName(result.data.plan) + " plan.");
        return;
      }
      if (result.status === 401) {
        access.active = false;
        access.signedIn = false;
        applyAccessUI();
        renderPreview(input, access);
        setStatus("Sign in to generate the complete JSON-LD.", true);
        return;
      }
      if (result.status === 403 && result.data && result.data.code === "PURCHASE_REQUIRED") {
        access.active = false;
        applyAccessUI();
        renderPreview(input, access);
        setStatus(result.data.error, true);
        return;
      }
      mapError(result.data && result.data.error ? result.data.error : "The complete JSON-LD could not be generated. Try again.");
    });

    document.querySelectorAll("[data-ea-add]").forEach(function (button) {
      button.addEventListener("click", function () {
        addItem(button.getAttribute("data-ea-add"));
      });
    });

    var exampleButton = $("ea-load-example");
    if (exampleButton) exampleButton.addEventListener("click", loadExample);

    var planSelect = $("ea-plan");
    if (planSelect) {
      planSelect.addEventListener("change", function () {
        updateCounts();
        setIntakePlan(planSelect.value);
        var limits = LIMITS[currentPlan()];
        if (itemCount("location") > limits.locations || itemCount("person") > limits.people) {
          setStatus("You have more locations or people than the selected plan covers. Remove extras or choose the Multi-Location plan.", true);
        } else {
          setStatus("");
        }
      });
    }
  }

  /* Intake and tabs ------------------------------------------------------- */

  function initIntake() {
    var form = $("ea-intake-form");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var status = $("ea-intake-status");
      var button = form.querySelector('button[type="submit"]');
      var data = new FormData(form);
      var name = String(data.get("name") || "").trim();
      var email = String(data.get("email") || "").trim();
      if (!name || !email) {
        if (status) {
          status.textContent = "Add your name and work email so we can reply.";
          status.classList.add("is-error");
        }
        return;
      }
      if (button) button.disabled = true;
      if (status) {
        status.textContent = "Sending your request…";
        status.classList.remove("is-error");
      }
      try {
        var response = await fetch("/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(data).toString()
        });
        if (!response.ok) throw new Error("The form service did not accept the request.");
        form.innerHTML = '<div class="ea-success"><strong>Request received, ' + esc(name) + '.</strong> We will confirm the scope and send the next step within one business day. If you need us sooner, use the <a href="/contact">contact form</a>.</div>';
      } catch (error) {
        if (status) {
          status.innerHTML = 'The form could not send. Use the <a href="/contact">contact form</a> or call <a href="tel:+14699052836">(469) 905-2836</a>.';
          status.classList.add("is-error");
        }
        if (button) button.disabled = false;
      }
    });
  }

  function initTabs() {
    document.querySelectorAll("[data-ea-tab]").forEach(function (button) {
      button.addEventListener("click", function () { showPanel(button.getAttribute("data-ea-tab")); });
    });
  }

  function cleanupCheckoutUrl() {
    if (!window.history || !window.history.replaceState) return;
    try {
      window.history.replaceState(null, "", "/ai-visibility-schema-studio#entity-audit-tool");
    } catch (error) {
      // Keep the URL if the browser blocks history cleanup.
    }
  }

  function checkoutMessage(html, isError) {
    var result = $("ea-checkout-result");
    if (!result) return;
    result.hidden = false;
    result.innerHTML = html;
    result.classList.toggle("is-error", Boolean(isError));
  }

  async function claimSession(sessionId) {
    var session = await currentSession();
    if (session && session.user && session.user.email) access.email = session.user.email;
    var result = await authFetch("entity-purchase-claim", { sessionId: sessionId });
    if (result.status === 200 && result.data && result.data.active) {
      access.checked = true;
      access.signedIn = true;
      access.active = true;
      access.plan = result.data.plan || null;
      access.limits = result.data.limits || null;
      try { sessionStorage.removeItem("ea-entity-session"); } catch (error) { }
      applyAccessUI();
      checkoutMessage("<strong>Purchase verified.</strong> The " + esc(planName(access.plan)) + " DIY builder is now unlocked above. Add the verified brand details and generate the complete JSON-LD.", false);
      setStatus("Purchase verified. " + planName(access.plan) + " DIY builder unlocked.");
      showPanel("builder");
      scrollToolIntoView();
      return true;
    }
    if (result.status === 401) {
      checkoutMessage("<strong>Payment received.</strong> Sign in with the email you used at Stripe to unlock the complete builder. <a href=\"" + esc(signInUrl()) + "\">Sign in</a>", false);
      return false;
    }
    if (result.status === 403 && result.data && result.data.code === "EMAIL_MISMATCH") {
      checkoutMessage("<strong>Use the purchase email.</strong> This account does not match the email on the Stripe payment. Sign in with the address used at checkout, or <a href=\"/contact\">contact us</a> if the purchase used a different address.", true);
      return false;
    }
    if (result.status === 409) {
      checkoutMessage("<strong>This purchase is already linked.</strong> " + esc(result.data.error || "") + " <a href=\"/contact\">Contact us</a> if that is not right.", true);
      return false;
    }
    checkoutMessage("<strong>The purchase check did not finish.</strong> " + esc(result.data && result.data.error ? result.data.error : "Try again in a moment.") + " <a href=\"/contact\">Contact us</a> if it keeps failing.", true);
    return false;
  }

  async function claimStoredSession() {
    var sessionId = "";
    try { sessionId = sessionStorage.getItem("ea-entity-session") || ""; } catch (error) { }
    if (!sessionId) return false;
    var session = await currentSession();
    if (!session) return false;
    return claimSession(sessionId);
  }

  async function startCheckout(plan, upgrade) {
    var session = await currentSession();
    if (!session) {
      window.location.assign(checkoutSignInUrl());
      return;
    }
    var response;
    try {
      response = await fetch(CHECKOUT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: "Bearer " + session.access_token
        },
        body: JSON.stringify({ plan: plan, upgrade: Boolean(upgrade) }),
        cache: "no-store"
      });
    } catch (error) {
      throw new Error("The checkout server could not be reached. Check your connection and try again.");
    }
    var data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    if (response.status === 401) {
      window.location.assign(checkoutSignInUrl());
      return;
    }
    if (!response.ok) {
      throw new Error(data && data.error ? data.error : "Checkout could not be started. Please retry.");
    }
    var target;
    try {
      target = new URL(data && data.url || "");
      if (target.protocol !== "https:" || target.hostname !== "checkout.stripe.com" || target.port) {
        throw new Error("Unexpected checkout destination.");
      }
    } catch (error) {
      throw new Error("The secure checkout address could not be verified. Please contact us.");
    }
    window.location.assign(target.href);
  }

  async function initCheckout() {
    var params = new URLSearchParams(window.location.search);
    var state = params.get("checkout");
    var sessionId = params.get("session_id") || "";

    if (state === "cancelled") {
      checkoutMessage("<strong>Checkout cancelled.</strong> No charge was made. You can try again from the pricing section, or use the intake form to talk it through first.", false);
      cleanupCheckoutUrl();
    } else if (state === "success" && sessionId) {
      try { sessionStorage.setItem("ea-entity-session", sessionId); } catch (error) { }
      var session = await currentSession();
      if (!session) {
        checkoutMessage("<strong>Payment received.</strong> Sign in with the email you used at Stripe to unlock the complete builder. <a href=\"" + esc(signInUrl()) + "\">Sign in</a>", false);
      } else {
        checkoutMessage("<strong>Verifying your purchase...</strong>", false);
        if (await claimSession(sessionId)) cleanupCheckoutUrl();
      }
    } else {
      await claimStoredSession();
    }

    document.addEventListener("click", async function (event) {
      var trigger = event.target.closest("[data-ea-checkout]");
      if (!trigger) return;
      event.preventDefault();
      if (trigger.getAttribute("aria-busy") === "true") return;
      var plan = trigger.getAttribute("data-ea-checkout");
      var upgrade = trigger.getAttribute("data-ea-upgrade") === "1";
      var original = trigger.textContent;
      trigger.setAttribute("aria-busy", "true");
      trigger.textContent = upgrade ? "Opening upgrade..." : "Opening secure checkout...";
      try {
        await startCheckout(plan, upgrade);
      } catch (error) {
        trigger.removeAttribute("aria-busy");
        trigger.textContent = original;
        checkoutMessage("<strong>Checkout could not start.</strong> " + esc(error.message) + " You can also use the <a href=\"/contact\">contact form</a>.", true);
      }
    });
  }

  function initPlans() {
    document.addEventListener("click", function (event) {
      var trigger = event.target.closest("[data-ea-plan]");
      if (!trigger) return;
      if (trigger.tagName === "A") event.preventDefault();
      setPlan(trigger.getAttribute("data-ea-plan"));
    });
  }

  function init() {
    if (!$("ea-audit-form")) return;
    initTabs();
    initAudit();
    initBuilder();
    initIntake();
    initCheckout();
    initPlans();
    refreshAccess().then(applyAccessUI);
  }

  init();
})();
