import { json, readBody, userFromEvent } from "./avss-shared.mjs";
import purchases from "./lib/entity-purchases.js";
import graph from "./lib/entity-graph-builder.js";

export default async event => {
  if (String(event.httpMethod || "POST").toUpperCase() !== "POST") {
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
    const entitlement = await purchases.entitlementForUser(user.id);
    if (!entitlement) {
      return json(403, {
        error: "A paid AI Entity and Citation Authority implementation is required to generate the complete JSON-LD.",
        code: "PURCHASE_REQUIRED"
      });
    }

    let body;
    try {
      body = readBody(event);
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
