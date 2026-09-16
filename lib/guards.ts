/**
 * Best-effort per-IP guards for the public demo. In-memory, so they reset on a
 * cold start / redeploy; the real backstop is the account-level cap in the API
 * dashboards. Swap for Upstash (env already scaffolded) for durable,
 * multi-instance limits.
 */
import { USER_SPEND_CAP_USD } from "./config";

const RATE_WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const hits = new Map<string, number[]>();
const spend = new Map<string, { usd: number; resetAt: number }>();

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export function overSpendCap(ip: string): boolean {
  const now = Date.now();
  const e = spend.get(ip);
  if (!e || now > e.resetAt) {
    spend.set(ip, { usd: 0, resetAt: now + DAY_MS });
    return false;
  }
  return e.usd >= USER_SPEND_CAP_USD;
}

export function addSpend(ip: string, usd: number): void {
  const e = spend.get(ip) ?? { usd: 0, resetAt: Date.now() + DAY_MS };
  e.usd += usd;
  spend.set(ip, e);
}
