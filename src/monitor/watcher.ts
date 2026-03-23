import { parseAbi, type Address } from "viem";
import { getMainnetClient } from "./mainnet-client.js";
import { monitorConfig, MAINNET_STETH, normalizeAddress } from "./config.js";
import { buildVaultSnapshot, fetchStethBenchmark, clearMellowCache } from "./data.js";
import { detectChanges, evictExpiredDedup, getDedupTimestamps, restoreDedupTimestamps } from "./detector.js";
import { sendAlertNotification } from "./notifier.js";
import { explainAlert } from "./explain.js";
import {
  openDb,
  closeDb,
  insertWatch as dbInsertWatch,
  deleteWatch as dbDeleteWatch,
  updateRecipient as dbUpdateRecipient,
  loadWatch as dbLoadWatch,
  loadAllWatches,
  watchCount as dbWatchCount,
  watchExists as dbWatchExists,
  insertRule as dbInsertRule,
  deleteRule as dbDeleteRule,
  upsertSnapshot,
  deleteSnapshot as dbDeleteSnapshot,
  loadSnapshot as dbLoadSnapshot,
  loadAllSnapshots,
  appendAlerts,
  loadAlertHistory,
  loadAlertsByVault,
  trimAlertHistory,
  loadDedupTimestamps,
  saveDedupTimestamps,
} from "./db.js";
import type {
  VaultWatch,
  VaultSnapshot,
  VaultAlert,
  AlertRule,
  BenchmarkRates,
} from "./types.js";
import { extractErrorMessage } from "../utils/errors.js";

const unwatchMap = new Map<string, () => void>();
let globalUnsubscribe: (() => void) | null = null;

let latestBenchmarks: BenchmarkRates = { stethApr: null, timestamp: 0 };

let started = false;
let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

const pendingChecks = new Map<string, ReturnType<typeof setTimeout>>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 5_000;
const POLLING_INTERVAL_MS = 0.5 * 60 * 1000;
const MAX_WATCHES = 20;
const MAX_RULES_PER_WATCH = 50;

const WS_BASE_RECONNECT_MS = 1_000;
const WS_MAX_RECONNECT_MS = 60_000;
const reconnectAttempts = new Map<string, number>();

function getReconnectDelay(key: string): number {
  const attempts = reconnectAttempts.get(key) ?? 0;
  reconnectAttempts.set(key, attempts + 1);
  const delay = Math.min(WS_BASE_RECONNECT_MS * 2 ** attempts, WS_MAX_RECONNECT_MS);
  const jitter = delay * (0.75 + Math.random() * 0.5);
  return Math.floor(jitter);
}

function resetReconnectAttempts(key: string): void {
  reconnectAttempts.delete(key);
}

function scheduleReconnect(key: string, fn: () => void): void {
  const existing = reconnectTimers.get(key);
  if (existing) clearTimeout(existing);
  const delay = getReconnectDelay(key);
  const timer = setTimeout(() => {
    reconnectTimers.delete(key);
    fn();
  }, delay);
  reconnectTimers.set(key, timer);
}

function findWatch(address: string): VaultWatch | undefined {
  return dbLoadWatch(address);
}

function findWatchOrThrow(address: string): VaultWatch {
  const watch = dbLoadWatch(address);
  if (!watch) throw new Error(`Vault ${address} is not being watched.`);
  return watch;
}

function getStoredSnapshot(address: string): VaultSnapshot | undefined {
  return dbLoadSnapshot(address);
}

let checkLock: Promise<void> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const result = checkLock.then(fn, fn);
  checkLock = result.then(() => {}, () => {});
  return result as Promise<T>;
}

const erc4626EventsAbi = parseAbi([
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
]);

const lidoEventsAbi = parseAbi([
  "event TokenRebased(uint256 indexed reportTimestamp, uint256 timeElapsed, uint256 preTotalShares, uint256 preTotalEther, uint256 postTotalShares, uint256 postTotalEther, uint256 sharesMintedAsFees)",
]);

function subscribeToVault(watch: VaultWatch): void {
  const key = normalizeAddress(watch.address);
  if (unwatchMap.has(key)) return;

  try {
    const client = getMainnetClient();
    const unwatch = client.watchContractEvent({
      address: watch.address,
      abi: erc4626EventsAbi,
      onLogs: () => {
        resetReconnectAttempts(`vault:${key}`);
        debouncedVaultCheck(watch.address, watch.name);
      },
      onError: (err: Error) => {
        console.error(`[VaultMonitor] WebSocket error for ${watch.name}:`, err.message);
        unwatchMap.delete(key);
        scheduleReconnect(`vault:${key}`, () => subscribeToVault(watch));
      },
    });
    unwatchMap.set(key, unwatch);
    resetReconnectAttempts(`vault:${key}`);
  } catch (err) {
    console.error(`[VaultMonitor] Failed to subscribe to ${watch.name}:`, extractErrorMessage(err));
    scheduleReconnect(`vault:${key}`, () => subscribeToVault(watch));
  }
}

function debouncedVaultCheck(address: Address, name: string): void {
  const key = normalizeAddress(address);
  const existing = pendingChecks.get(key);
  if (existing) clearTimeout(existing);

  const timeout = setTimeout(() => {
    pendingChecks.delete(key);
    runVaultCheck(address).catch((err) => {
      console.error(`[VaultMonitor] Error checking ${name}:`, extractErrorMessage(err));
    });
  }, DEBOUNCE_MS);

  pendingChecks.set(key, timeout);
}

function unsubscribeFromVault(address: string): void {
  const key = normalizeAddress(address);
  const unwatch = unwatchMap.get(key);
  if (unwatch) {
    unwatch();
    unwatchMap.delete(key);
  }
  const pending = pendingChecks.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingChecks.delete(key);
  }
  const reconnectKey = `vault:${key}`;
  const reconnectTimer = reconnectTimers.get(reconnectKey);
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimers.delete(reconnectKey);
  }
  reconnectAttempts.delete(reconnectKey);
}

function subscribeToTokenRebased(): void {
  if (globalUnsubscribe) return;

  try {
    const client = getMainnetClient();
    globalUnsubscribe = client.watchContractEvent({
      address: MAINNET_STETH,
      abi: lidoEventsAbi,
      eventName: "TokenRebased",
      onLogs: () => {
        resetReconnectAttempts("tokenRebased");
        runHealthCheck().catch((err) => {
          console.error("[VaultMonitor] Error in health check:", extractErrorMessage(err));
        });
      },
      onError: (err: Error) => {
        console.error("[VaultMonitor] WebSocket error for TokenRebased:", err.message);
        globalUnsubscribe = null;
        scheduleReconnect("tokenRebased", () => subscribeToTokenRebased());
      },
    });
    resetReconnectAttempts("tokenRebased");
  } catch (err) {
    console.error("[VaultMonitor] Failed to subscribe to TokenRebased:", extractErrorMessage(err));
    scheduleReconnect("tokenRebased", () => subscribeToTokenRebased());
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function processAlerts(newAlerts: VaultAlert[], recipient?: string | null): Promise<void> {
  for (const alert of newAlerts) {
    try {
      const explanation = await withTimeout(explainAlert(alert), 15_000);
      await sendAlertNotification(alert, explanation, 3, recipient);
    } catch (err) {
      console.error(`[VaultMonitor] Failed to process alert for ${alert.vaultName}:`, extractErrorMessage(err));
    }
  }

  appendAlerts(newAlerts);
  trimAlertHistory(monitorConfig.maxAlertHistory);
}

const MAX_CONCURRENT_CHECKS = 5;

export function runHealthCheck(): Promise<void> {
  return serialized(async () => {
    const currentWatches = loadAllWatches();
    if (currentWatches.length === 0) return;

    clearMellowCache();

    try {
      latestBenchmarks = await fetchStethBenchmark();
    } catch {}

    for (let i = 0; i < currentWatches.length; i += MAX_CONCURRENT_CHECKS) {
      const batch = currentWatches.slice(i, i + MAX_CONCURRENT_CHECKS);
      const results = await Promise.allSettled(
        batch.map(async (watch) => {
          const previous = getStoredSnapshot(watch.address);
          const current = await buildVaultSnapshot(watch, previous);
          const alerts = detectChanges(watch, current, previous, latestBenchmarks);
          upsertSnapshot(current);
          return { alerts, recipient: watch.recipient };
        }),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.alerts.length > 0) {
          await processAlerts(result.value.alerts, result.value.recipient);
        } else if (result.status === "rejected") {
          console.error(`[VaultMonitor] Health check failed:`, extractErrorMessage(result.reason));
        }
      }
    }

    evictExpiredDedup();
    saveDedupTimestamps(getDedupTimestamps());
  });
}

export function runVaultCheck(address: Address): Promise<void> {
  return serialized(async () => {
    const watch = findWatch(address);
    if (!watch) return;

    try {
      const previous = getStoredSnapshot(watch.address);
      const current = await buildVaultSnapshot(watch, previous);
      const alerts = detectChanges(watch, current, previous, latestBenchmarks);

      upsertSnapshot(current);
      await processAlerts(alerts, watch.recipient);
      saveDedupTimestamps(getDedupTimestamps());
    } catch (err) {
      console.error(`[VaultMonitor] Vault check failed for ${watch.name}:`, extractErrorMessage(err));
    }
  });
}

function ensurePollingInterval(): void {
  if (healthCheckInterval) return;
  healthCheckInterval = setInterval(() => {
    runHealthCheck().catch((err) => {
      console.error("[VaultMonitor] Periodic health check failed:", extractErrorMessage(err));
    });
  }, POLLING_INTERVAL_MS);
  if (healthCheckInterval && typeof healthCheckInterval === "object" && "unref" in healthCheckInterval) {
    healthCheckInterval.unref();
  }
}

export function startWatcher(): void {
  if (started) return;

  if (!monitorConfig.mainnetAvailable) {
    console.error("[VaultMonitor] No mainnet RPC available — vault monitoring disabled.");
    return;
  }

  openDb();

  const restoredWatches = loadAllWatches();

  const dedupTs = loadDedupTimestamps();
  if (Object.keys(dedupTs).length > 0) {
    restoreDedupTimestamps(dedupTs);
  }

  started = true;

  if (restoredWatches.length > 0) {
    console.error(`[VaultMonitor] Restored ${restoredWatches.length} watch(es).`);
    for (const watch of restoredWatches) {
      // Mellow Core vaults have no ERC-4626 Deposit/Withdraw events — skip WS subscription
      if (watch.vaultType !== "mellow_core") {
        subscribeToVault(watch);
      }
    }
    subscribeToTokenRebased();
  }

  ensurePollingInterval();
}

export function addWatch(watch: VaultWatch): Promise<VaultSnapshot> {
  return serialized(async () => {
    if (dbWatchCount() >= MAX_WATCHES) {
      throw new Error(`Maximum number of watches (${MAX_WATCHES}) reached. Remove a watch before adding a new one.`);
    }

    const existing = dbLoadWatch(watch.address);
    if (existing) {
      throw new Error(`Vault ${watch.address} is already being watched as "${existing.name}".`);
    }

    if (watch.rules.length > MAX_RULES_PER_WATCH) {
      throw new Error(`Maximum ${MAX_RULES_PER_WATCH} rules per watch. Got ${watch.rules.length}.`);
    }

    const snapshot = await buildVaultSnapshot(watch);

    dbInsertWatch(watch);
    if (watch.vaultType !== "mellow_core") {
      subscribeToVault(watch);
    }
    subscribeToTokenRebased();
    ensurePollingInterval();

    upsertSnapshot(snapshot);
    return snapshot;
  });
}

export function removeWatch(address: string): Promise<VaultWatch> {
  return serialized(async () => {
    const watch = dbLoadWatch(address);
    if (!watch) {
      throw new Error(`Vault ${address} is not being watched.`);
    }

    unsubscribeFromVault(address);
    dbDeleteWatch(address);
    dbDeleteSnapshot(address);

    if (dbWatchCount() === 0) {
      if (globalUnsubscribe) {
        globalUnsubscribe();
        globalUnsubscribe = null;
      }
      if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
      }
    }

    console.error(`[VaultMonitor] Stopped watching ${watch.name} (${address}).`);
    return watch;
  });
}

export function addRule(address: string, rule: AlertRule): Promise<VaultWatch> {
  return serialized(async () => {
    const watch = findWatchOrThrow(address);

    if (watch.rules.length >= MAX_RULES_PER_WATCH) {
      throw new Error(`Maximum ${MAX_RULES_PER_WATCH} rules per watch reached.`);
    }

    if (watch.rules.some((r) => r.id === rule.id)) {
      throw new Error(`Rule "${rule.id}" already exists on this watch.`);
    }

    dbInsertRule(address, rule);
    return findWatchOrThrow(address);
  });
}

export function removeRule(address: string, ruleId: string): Promise<VaultWatch> {
  return serialized(async () => {
    const watch = findWatchOrThrow(address);

    if (!watch.rules.some((r) => r.id === ruleId)) {
      throw new Error(`Rule "${ruleId}" not found on this watch.`);
    }

    dbDeleteRule(ruleId);
    return findWatchOrThrow(address);
  });
}

export function getWatch(address: string): VaultWatch | undefined {
  return dbLoadWatch(address);
}

export function getWatches(): VaultWatch[] {
  return loadAllWatches();
}

export function getSnapshots(): Map<string, VaultSnapshot> {
  return loadAllSnapshots();
}

export function getLatestSnapshot(address: string): VaultSnapshot | undefined {
  return dbLoadSnapshot(address);
}

export function getLatestAlerts(count = 20, filterAddress?: string): VaultAlert[] {
  if (filterAddress) {
    return loadAlertsByVault(filterAddress, count);
  }
  return loadAlertHistory(count);
}

export function getBenchmarks(): BenchmarkRates {
  return latestBenchmarks;
}

export function updateWatchRecipient(address: string, recipient: string): Promise<VaultWatch> {
  return serialized(async () => {
    dbUpdateRecipient(address, recipient);
    return findWatchOrThrow(address);
  });
}

export function stopWatcher(): void {
  if (started) {
    saveDedupTimestamps(getDedupTimestamps());
    closeDb();
  }

  for (const [, unwatch] of unwatchMap) {
    unwatch();
  }
  unwatchMap.clear();

  if (globalUnsubscribe) {
    globalUnsubscribe();
    globalUnsubscribe = null;
  }

  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }

  for (const [, timeout] of pendingChecks) {
    clearTimeout(timeout);
  }
  pendingChecks.clear();

  for (const [, timer] of reconnectTimers) {
    clearTimeout(timer);
  }
  reconnectTimers.clear();

  started = false;
}

export function _resetForTesting(): void {
  stopWatcher();
  latestBenchmarks = { stethApr: null, timestamp: 0 };
  reconnectAttempts.clear();
  reconnectTimers.clear();
}
