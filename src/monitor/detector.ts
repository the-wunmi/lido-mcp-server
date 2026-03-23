import type { VaultWatch, VaultSnapshot, VaultAlert, BenchmarkRates, AlertContext } from "./types.js";
import { monitorConfig, normalizeAddress } from "./config.js";
import { buildScope, evaluateRule, renderTemplate } from "./rules.js";

const lastAlertTimes = new Map<string, number>();

function dedupKey(ruleId: string, address: string): string {
  return `${ruleId}:${normalizeAddress(address)}`;
}

function isDuplicate(ruleId: string, address: string): boolean {
  const key = dedupKey(ruleId, address);
  const last = lastAlertTimes.get(key);
  if (!last) return false;
  return Date.now() - last < monitorConfig.dedupCooldownMs;
}

function recordAlert(ruleId: string, address: string): void {
  lastAlertTimes.set(dedupKey(ruleId, address), Date.now());
}

export function detectChanges(
  watch: VaultWatch,
  current: VaultSnapshot,
  previous: VaultSnapshot | undefined,
  benchmarks: BenchmarkRates,
): VaultAlert[] {
  const alerts: VaultAlert[] = [];
  const now = Math.floor(Date.now() / 1000);
  const scope = buildScope(current, previous, benchmarks);

  for (const rule of watch.rules) {
    if (isDuplicate(rule.id, watch.address)) continue;

    const triggered = evaluateRule(rule.expression, scope);
    if (!triggered) continue;

    const message = renderTemplate(rule.message, scope);

    const context: AlertContext = {
      expression: rule.expression,
      scope,
      current: {
        apr: current.apr,
        tvl: current.tvl,
        sharePrice: current.sharePrice.toString(),
        assetSymbol: current.assetSymbol,
      },
      previous: previous
        ? { apr: previous.apr, tvl: previous.tvl, sharePrice: previous.sharePrice.toString() }
        : null,
      benchmarks: { stethApr: benchmarks.stethApr },
    };

    alerts.push({
      ruleId: rule.id,
      severity: rule.severity,
      vaultAddress: watch.address,
      vaultName: current.name,
      message,
      context,
      timestamp: now,
    });

    recordAlert(rule.id, watch.address);
  }

  return alerts;
}

export function restoreDedupState(alerts: VaultAlert[]): void {
  lastAlertTimes.clear();
  for (const alert of alerts) {
    const key = dedupKey(alert.ruleId, alert.vaultAddress);
    const existing = lastAlertTimes.get(key);
    if (!existing || alert.timestamp * 1000 > existing) {
      lastAlertTimes.set(key, alert.timestamp * 1000);
    }
  }
}

export function evictExpiredDedup(): void {
  const now = Date.now();
  for (const [key, ts] of lastAlertTimes) {
    if (now - ts >= monitorConfig.dedupCooldownMs) {
      lastAlertTimes.delete(key);
    }
  }
}

export function getDedupTimestamps(): Record<string, number> {
  return Object.fromEntries(lastAlertTimes);
}

export function restoreDedupTimestamps(timestamps: Record<string, number>): void {
  lastAlertTimes.clear();
  for (const [key, ts] of Object.entries(timestamps)) {
    if (typeof ts === "number" && ts > 0) {
      lastAlertTimes.set(key, ts);
    }
  }
}

export function _resetDedupState(): void {
  lastAlertTimes.clear();
}
