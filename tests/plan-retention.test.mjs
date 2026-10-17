import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_RETENTION_MS, prunePlans } from '../lib/agent/plan-retention.mjs';
test('recommendations remain usable for three days regardless of old short expiry, then are removed', () => {
  const now = Date.now();
  const recent = {createdAt:new Date(now-3600000).toISOString(),expiresAt:new Date(now-1800000).toISOString()};
  const plans = {recent, boundary:{createdAt:new Date(now-PLAN_RETENTION_MS).toISOString()}, old:{createdAt:new Date(now-PLAN_RETENTION_MS-1).toISOString()}};
  prunePlans(plans,now);
  assert.deepEqual(Object.keys(plans),['recent','boundary']);
  assert.equal(plans.recent,recent);
  prunePlans(plans,now+PLAN_RETENTION_MS);
  assert.deepEqual(plans,{});
});
