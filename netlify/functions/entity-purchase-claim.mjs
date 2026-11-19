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
    return json(error.status || 401, { error: error.message, code: error.code || "SIGN_IN_REQUIRED" });
  }

  try {
    const { sessionId } = await readBody(event);
    const result = await purchases.claimPurchase(user, sessionId);
    return json(200, { active: true, plan: result.plan, limits: result.limits });
  } catch (error) {
    return json(error.status || 400, { error: error.message, code: error.code });
  }
};
