export const PLAN_RETENTION_MS = 3 * 86400000;
export const oldPlan = (plan, now = Date.now()) => now - Date.parse(plan.createdAt) > PLAN_RETENTION_MS;
export function prunePlans(plans, now = Date.now()) {
  for (const [id, plan] of Object.entries(plans)) if (oldPlan(plan, now)) delete plans[id];
}
