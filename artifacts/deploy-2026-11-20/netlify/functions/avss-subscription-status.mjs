import { json, userFromEvent, requirePaid } from "./avss-shared.mjs";
export default async (event) => {
  try { const user=await userFromEvent(event); await requirePaid(user); return json(200,{active:true}); }
  catch(e){ return json(200,{active:false,reason:e.message}); }
};
