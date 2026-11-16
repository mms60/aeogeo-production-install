/*
 * Interactive entity-graph preview for /ai-visibility-schema-studio.
 * Illustrative data only. No network calls, no external dependencies.
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  var NODES = [
    {
      id: "org",
      label: "Example Client Brand",
      shortType: "Organization",
      category: "core",
      x: 50,
      y: 48,
      uri: "https://examplebrand.com/#organization",
      beforeUri: "No @id (anonymous inline block)",
      aiUnified: "Acts as the root Entity Home. ChatGPT Search, Perplexity, and Google AI Overviews resolve brand queries here first, traversing subOrganization, founder, and sameAs edges with zero ambiguity.",
      aiFragmented: "Without a canonical @id, AI crawlers treat the homepage Organization snippet as an isolated mention disconnected from location pages, founders, and third-party profiles.",
      unifiedJson: {
        "@type": "Organization",
        "@id": "https://examplebrand.com/#organization",
        "name": "Example Client Brand",
        "url": "https://examplebrand.com/",
        "logo": {
          "@type": "ImageObject",
          "@id": "https://examplebrand.com/#logo",
          "url": "https://examplebrand.com/assets/logo.png"
        },
        "founder": { "@id": "https://examplebrand.com/#founder" },
        "subOrganization": { "@id": "https://examplebrand.com/locations/dallas/#localbusiness" },
        "sameAs": [
          "https://www.wikidata.org/wiki/Q123456789",
          "https://www.crunchbase.com/organization/example-brand",
          "https://www.linkedin.com/company/example-brand"
        ]
      },
      fragmentedJson: {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Example Client Brand",
        "url": "https://examplebrand.com/"
        // Missing @id, subOrganization, founder, and verified sameAs anchors
      }
    },
    {
      id: "local",
      label: "Dallas Flagship Office",
      shortType: "LocalBusiness",
      category: "core",
      x: 24,
      y: 26,
      uri: "https://examplebrand.com/locations/dallas/#localbusiness",
      beforeUri: "Isolated LocalBusiness snippet (no parentOrganization)",
      aiUnified: "Explicitly linked to the parent Organization via parentOrganization and anchored to its verified Google Business Profile via hasMap and sameAs. Prevents multi-location cannibalization in local AI packs.",
      aiFragmented: "Appears as a standalone business entity unlinked from the main brand domain. LLMs struggle to verify whether Dallas reviews and services apply to the parent brand.",
      unifiedJson: {
        "@type": "ProfessionalService",
        "@id": "https://examplebrand.com/locations/dallas/#localbusiness",
        "name": "Example Client Brand — Dallas",
        "parentOrganization": { "@id": "https://examplebrand.com/#organization" },
        "telephone": "+1-214-555-0199",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "2100 Ross Ave, Suite 400",
          "addressLocality": "Dallas",
          "addressRegion": "TX",
          "postalCode": "75201",
          "addressCountry": "US"
        },
        "hasMap": "https://maps.google.com/?cid=9876543210987654321",
        "sameAs": "https://g.page/r/example-brand-dallas"
      },
      fragmentedJson: {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": "Example Client Brand Dallas",
        "telephone": "214-555-0199"
        // Missing parentOrganization @id, hasMap, and GBP sameAs
      }
    },
    {
      id: "service",
      label: "AI Search & Entity Optimization",
      shortType: "Service",
      category: "core",
      x: 24,
      y: 74,
      uri: "https://examplebrand.com/services/entity-booster/#service",
      beforeUri: "Unstructured webpage text (no Service @id)",
      aiUnified: "Connects provider (@id: #organization) and availableAtOrFrom (@id: #localbusiness) with Wikidata geographic URIs in areaServed. Enables AI engines to recommend this exact office for high-intent local service queries.",
      aiFragmented: "Service offerings exist only as unstructured H2 headings. AI models must guess service availability and geographic coverage from surrounding paragraphs.",
      unifiedJson: {
        "@type": "Service",
        "@id": "https://examplebrand.com/services/entity-booster/#service",
        "name": "AI Search & Entity Optimization",
        "provider": { "@id": "https://examplebrand.com/#organization" },
        "availableAtOrFrom": { "@id": "https://examplebrand.com/locations/dallas/#localbusiness" },
        "areaServed": [
          {
            "@type": "City",
            "name": "Dallas",
            "sameAs": "https://www.wikidata.org/wiki/Q16557"
          }
        ]
      },
      fragmentedJson: {
        "@context": "https://schema.org",
        "@type": "Service",
        "name": "AI Search & Entity Optimization"
        // Missing provider @id, location link, and Wikidata areaServed
      }
    },
    {
      id: "person",
      label: "Lead Strategist / Founder",
      shortType: "Person",
      category: "core",
      x: 50,
      y: 82,
      uri: "https://examplebrand.com/#founder",
      beforeUri: "Plain text author byline (no Person entity)",
      aiUnified: "Establishes verifiable E-E-A-T authority by linking the founder's Person @id directly to the Organization and their verified LinkedIn profile via sameAs.",
      aiFragmented: "Author bylines are plain strings. AI search systems cannot verify industry credentials or link published thought leadership back to the brand entity.",
      unifiedJson: {
        "@type": "Person",
        "@id": "https://examplebrand.com/#founder",
        "name": "Jordan Vance",
        "jobTitle": "Founder & Principal Entity Architect",
        "worksFor": { "@id": "https://examplebrand.com/#organization" },
        "sameAs": [
          "https://www.linkedin.com/in/jordan-vance-aeogeo"
        ]
      },
      fragmentedJson: {
        "@type": "Person",
        "name": "Jordan Vance"
        // Missing @id, worksFor @id, and external credential sameAs
      }
    },
    {
      id: "wikidata",
      label: "Wikidata QID",
      shortType: "sameAs Anchor",
      category: "external",
      x: 78,
      y: 20,
      uri: "https://www.wikidata.org/wiki/Q123456789",
      beforeUri: "Disconnected external record",
      aiUnified: "Primary open-knowledge base anchor. Serves as a machine-readable Rosetta Stone used by Google Knowledge Graph and LLM pre-training corpora to disambiguate the brand from similarly named companies.",
      aiFragmented: "Even if a Wikidata item exists, omitting it from the website's sameAs array leaves AI retrieval pipelines uncertain whether the QID matches this domain.",
      unifiedJson: {
        "relation": "owl:sameAs / schema:sameAs",
        "source": "https://examplebrand.com/#organization",
        "target": "https://www.wikidata.org/wiki/Q123456789",
        "verification": "Bidirectional reference confirmed via official website property (P856)"
      },
      fragmentedJson: {
        "status": "Unlinked external node",
        "issue": "Domain does not declare schema:sameAs pointing to Wikidata QID."
      }
    },
    {
      id: "gbp",
      label: "Google Business Profile",
      shortType: "sameAs / hasMap",
      category: "external",
      x: 78,
      y: 40,
      uri: "https://g.page/r/example-brand-dallas",
      beforeUri: "Unlinked GBP listing",
      aiUnified: "Bridges real-time local map pack signals, verified street address, and customer reviews directly into the LocalBusiness @id node for Google AI Overviews.",
      aiFragmented: "Google relies solely on fuzzy NAP string matching between the website footer and GBP, risking entity split when suite numbers or phone formats vary.",
      unifiedJson: {
        "relation": "schema:sameAs & schema:hasMap",
        "source": "https://examplebrand.com/locations/dallas/#localbusiness",
        "target": "https://g.page/r/example-brand-dallas",
        "napParity": "100% exact match verified"
      },
      fragmentedJson: {
        "status": "Unlinked external node",
        "issue": "No explicit hasMap or sameAs edge connecting location page to GBP."
      }
    },
    {
      id: "crunchbase",
      label: "Crunchbase Profile",
      shortType: "sameAs Anchor",
      category: "external",
      x: 78,
      y: 60,
      uri: "https://www.crunchbase.com/organization/example-brand",
      beforeUri: "Unlinked business directory entity",
      aiUnified: "Reinforces corporate entity legitimacy, founding year, and executive leadership nodes across commercial knowledge graphs queried by Perplexity and ChatGPT.",
      aiFragmented: "Third-party corporate profile floats independently without a schema bridge back to the canonical Entity Home.",
      unifiedJson: {
        "relation": "schema:sameAs",
        "source": "https://examplebrand.com/#organization",
        "target": "https://www.crunchbase.com/organization/example-brand"
      },
      fragmentedJson: {
        "status": "Unlinked external node",
        "issue": "Missing from Organization sameAs array."
      }
    },
    {
      id: "linkedin",
      label: "LinkedIn Company & Exec",
      shortType: "sameAs Anchor",
      category: "external",
      x: 78,
      y: 80,
      uri: "https://www.linkedin.com/company/example-brand",
      beforeUri: "Footer icon link only (no semantic role)",
      aiUnified: "Connects both the corporate Organization and the Founder Person node to verified professional network entities, strengthening B2B and local trust signals.",
      aiFragmented: "A standard HTML anchor tag in the footer tells crawlers a link exists, not that the LinkedIn page represents the exact same legal entity.",
      unifiedJson: {
        "relation": "schema:sameAs",
        "sources": [
          "https://examplebrand.com/#organization",
          "https://examplebrand.com/#founder"
        ],
        "targets": [
          "https://www.linkedin.com/company/example-brand",
          "https://www.linkedin.com/in/jordan-vance-aeogeo"
        ]
      },
      fragmentedJson: {
        "status": "Unlinked external node",
        "issue": "Present only as an untyped HTML anchor tag; absent from the JSON-LD graph."
      }
    }
  ];

  var EDGES = [
    { from: "org", to: "local", label: "subOrganization / parentOrganization" },
    { from: "org", to: "service", label: "makesOffer / provider" },
    { from: "local", to: "service", label: "availableAtOrFrom" },
    { from: "org", to: "person", label: "founder / worksFor" },
    { from: "org", to: "wikidata", label: "sameAs (QID)" },
    { from: "local", to: "gbp", label: "sameAs / hasMap" },
    { from: "org", to: "crunchbase", label: "sameAs" },
    { from: "org", to: "linkedin", label: "sameAs" },
    { from: "person", to: "linkedin", label: "sameAs (exec)" }
  ];

  var state = { mode: "after", selected: "org" };
  var byId = new Map(NODES.map(function (node) { return [node.id, node]; }));

  // Narrow-screen layout: two columns, four spaced rows. Desktop positions
  // remain in NODES so the wide layout is unchanged.
  var NARROW_POSITIONS = {
    local: { x: 25, y: 10 },
    wikidata: { x: 75, y: 10 },
    org: { x: 25, y: 36 },
    gbp: { x: 75, y: 36 },
    service: { x: 25, y: 62 },
    crunchbase: { x: 75, y: 62 },
    person: { x: 25, y: 88 },
    linkedin: { x: 75, y: 88 }
  };

  function byIdLookup(id) {
    return byId.get(id);
  }

  function setMode(mode) {
    state.mode = mode;
    var demo = document.querySelector(".kg-demo");
    if (!demo) return;
    demo.setAttribute("data-mode", mode);

    var before = document.getElementById("kg-btn-before");
    var after = document.getElementById("kg-btn-after");
    var isAfter = mode === "after";

    before.classList.toggle("is-active", !isAfter);
    after.classList.toggle("is-active", isAfter);
    before.setAttribute("aria-pressed", String(!isAfter));
    after.setAttribute("aria-pressed", String(isAfter));

    document.getElementById("kg-edge-badge").textContent = isAfter
      ? EDGES.length + " verified edges"
      : "0 semantic edges";

    document.getElementById("kg-status-text").innerHTML = isAfter
      ? '<strong>Unified @graph active:</strong> all entities resolve to canonical <code>@id</code> URIs with bidirectional semantic edges for GraphRAG and LLM retrieval.'
      : '<strong>Fragmented schema:</strong> isolated JSON-LD blocks without <code>@id</code> URIs force AI models to guess relationships and risk entity collisions.';

    renderGraph();
    updateInspector();
  }

  function selectNode(id) {
    state.selected = id;
    renderGraph();
    updateInspector();
  }

  function renderGraph() {
    var graph = document.getElementById("kg-graph");
    var svg = document.getElementById("kg-edges");
    var layer = document.getElementById("kg-nodes");
    if (!graph || !svg || !layer) return;

    var width = graph.clientWidth;
    var height = graph.clientHeight;
    var narrow = width < 560;
    graph.classList.toggle("is-narrow", narrow);
    var selected = state.selected;
    var isAfter = state.mode === "after";

    svg.replaceChildren();
    layer.replaceChildren();

    var activeEdges = [];

    EDGES.forEach(function (edge) {
      var source = byIdLookup(edge.from);
      var target = byIdLookup(edge.to);
      if (!source || !target) return;

      var sourcePosition = narrow ? (NARROW_POSITIONS[source.id] || source) : source;
      var targetPosition = narrow ? (NARROW_POSITIONS[target.id] || target) : target;
      var x1 = (sourcePosition.x / 100) * width;
      var y1 = (sourcePosition.y / 100) * height;
      var x2 = (targetPosition.x / 100) * width;
      var y2 = (targetPosition.y / 100) * height;
      var active = edge.from === selected || edge.to === selected;

      var line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("class", "kg-edge" + (isAfter && active ? " is-active is-animated" : ""));
      svg.appendChild(line);

      if (isAfter && active) activeEdges.push({ edge: edge, x1: x1, y1: y1, x2: x2, y2: y2 });
    });

    activeEdges.forEach(function (item) {
      var midX = (item.x1 + item.x2) / 2;
      var midY = (item.y1 + item.y2) / 2;
      var textValue = item.edge.label.length > 26 ? item.edge.label.slice(0, 24) + "…" : item.edge.label;
      var pillWidth = Math.min(textValue.length * 6.2 + 16, 190);

      var group = document.createElementNS(SVG_NS, "g");
      var rect = document.createElementNS(SVG_NS, "rect");
      rect.setAttribute("x", midX - pillWidth / 2);
      rect.setAttribute("y", midY - 10);
      rect.setAttribute("width", pillWidth);
      rect.setAttribute("height", 20);
      rect.setAttribute("rx", 6);
      rect.setAttribute("class", "kg-edge-pill");

      var text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", midX);
      text.setAttribute("y", midY + 3.5);
      text.setAttribute("class", "kg-edge-pill-text");
      text.textContent = textValue;

      group.appendChild(rect);
      group.appendChild(text);
      svg.appendChild(group);
    });

    NODES.forEach(function (node) {
      var isSelected = node.id === selected;
      var button = document.createElement("button");
      button.type = "button";
      button.className =
        "kg-node" +
        (node.category === "external" ? " is-external" : "") +
        (isSelected ? " is-selected" : "");
      var position = narrow ? (NARROW_POSITIONS[node.id] || node) : node;
      button.style.left = position.x + "%";
      button.style.top = position.y + "%";
      button.setAttribute("aria-label", node.shortType + ": " + node.label);
      button.setAttribute("aria-pressed", String(isSelected));
      button.addEventListener("click", function () { selectNode(node.id); });

      var top = document.createElement("span");
      top.className = "kg-node-top";
      var dot = document.createElement("span");
      dot.className = "kg-node-dot";
      var type = document.createElement("span");
      type.className = "kg-node-type";
      type.textContent = node.shortType;
      top.appendChild(dot);
      top.appendChild(type);

      var label = document.createElement("span");
      label.className = "kg-node-label";
      label.textContent = node.label;

      button.appendChild(top);
      button.appendChild(label);
      layer.appendChild(button);
    });
  }

  function updateInspector() {
    var node = byIdLookup(state.selected) || NODES[0];
    var isAfter = state.mode === "after";

    document.getElementById("kg-title").textContent = node.label;
    document.getElementById("kg-type").textContent = node.shortType;

    var stateEl = document.getElementById("kg-state");
    stateEl.textContent = isAfter
      ? (node.id === "org" ? "Canonical entity home" : "Verified @graph node")
      : "Fragmented / unlinked";
    stateEl.className = "kg-state " + (isAfter ? "is-good" : "is-warn");

    var uri = document.getElementById("kg-uri");
    uri.textContent = isAfter ? node.uri : node.beforeUri;
    uri.className = isAfter ? "is-good" : "is-warn";

    document.getElementById("kg-ai-notes").textContent = isAfter ? node.aiUnified : node.aiFragmented;

    var valid = document.getElementById("kg-valid");
    valid.textContent = isAfter ? "✓ Valid @graph node" : "⚠ Missing @id bridge";
    valid.className = "kg-valid " + (isAfter ? "is-good" : "is-warn");

    document.getElementById("kg-json").textContent = JSON.stringify(
      isAfter ? node.unifiedJson : node.fragmentedJson,
      null,
      2
    );

    var list = document.getElementById("kg-edge-list");
    list.replaceChildren();

    if (!isAfter) {
      var empty = document.createElement("div");
      empty.className = "kg-empty";
      empty.textContent = "No active semantic edges in fragmented mode. Switch to Unified @graph to inspect the @id links.";
      list.appendChild(empty);
      return;
    }

    var connected = EDGES.filter(function (edge) {
      return edge.from === node.id || edge.to === node.id;
    });

    if (!connected.length) {
      var none = document.createElement("div");
      none.className = "kg-empty";
      none.textContent = "This node has no semantic edges in the example graph.";
      list.appendChild(none);
      return;
    }

    connected.forEach(function (edge) {
      var other = byIdLookup(edge.from === node.id ? edge.to : edge.from);
      if (!other) return;

      var row = document.createElement("button");
      row.type = "button";
      row.className = "kg-edge-row";

      var left = document.createElement("span");
      left.className = "kg-edge-left";
      var arrow = document.createElement("span");
      arrow.className = "kg-edge-arrow";
      arrow.textContent = edge.from === node.id ? "→" : "←";
      var name = document.createElement("span");
      name.className = "kg-edge-name";
      name.textContent = other.label;
      left.appendChild(arrow);
      left.appendChild(name);

      var label = document.createElement("span");
      label.className = "kg-edge-label";
      label.textContent = edge.label;

      row.appendChild(left);
      row.appendChild(label);
      row.addEventListener("click", function () { selectNode(other.id); });
      list.appendChild(row);
    });
  }

  function copyNodeJson() {
    var text = document.getElementById("kg-json").textContent;
    var button = document.getElementById("kg-copy");
    var original = button.textContent;

    function done() {
      button.textContent = "Copied";
      window.setTimeout(function () { button.textContent = original; }, 1600);
    }

    function fallback() {
      var helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      try {
        document.execCommand("copy");
        done();
      } catch (error) {
        /* Clipboard access is unavailable; leave the button unchanged. */
      }
      helper.remove();
    }

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function init() {
    var graph = document.getElementById("kg-graph");
    if (!graph) return;

    document.getElementById("kg-btn-before").addEventListener("click", function () { setMode("before"); });
    document.getElementById("kg-btn-after").addEventListener("click", function () { setMode("after"); });
    document.getElementById("kg-focus").addEventListener("click", function () { selectNode("org"); });
    document.getElementById("kg-copy").addEventListener("click", copyNodeJson);

    setMode("after");

    if ("ResizeObserver" in window) {
      var frame = 0;
      new ResizeObserver(function () {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(renderGraph);
      }).observe(graph);
    } else {
      window.addEventListener("resize", renderGraph);
    }
  }

  init();
})();
