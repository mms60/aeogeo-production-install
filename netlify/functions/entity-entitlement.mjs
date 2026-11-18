import { json, userFromEvent } from "./avss-shared.mjs";
import purchases from "./lib/entity-purchases.js";

export default async event => {
  if (!["GET", "POST"].includes(String(event.httpMethod || "GET").toUpperCase())) {
    return json(405, { error: "Use GET or POST to check entitlement." });
  }

  let user;
  try {
    user = await userFromEvent(event);
  } catch (error) {
    return json(401, { error: error.message, code: "SIGN_IN_REQUIRED" });
  }

  try {
    const entitlement = await purchases.entitlementForUser(user.id);
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
