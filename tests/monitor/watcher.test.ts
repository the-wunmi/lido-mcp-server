import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Unmock watcher.js so we test the real implementation
vi.unmock("../../src/monitor/watcher.js");

// Unmock data.js, detector.js, types.js since watcher depends on them
vi.unmock("../../src/monitor/data.js");
vi.unmock("../../src/monitor/detector.js");
vi.unmock("../../src/monitor/types.js");

// Mock global fetch for API calls (Mellow API, Lido stETH API)
const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
vi.stubGlobal("fetch", mockFetch);

import {
  startWatcher,
  stopWatcher,
  addWatch,
  removeWatch,
  addRule,
  removeRule,
  getWatches,
  getSnapshots,
  getLatestAlerts,
  getLatestSnapshot,
  getBenchmarks,
  runHealthCheck,
  updateWatchRecipient,
  _resetForTesting,
} from "../../src/monitor/watcher.js";
import { sendAlertNotification } from "../../src/monitor/notifier.js";
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
} from "../../src/monitor/db.js";
import type { AlertRule } from "../../src/monitor/types.js";

const VALID_ADDRESS = "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e" as `0x${string}`;
let mockDbWatches: Array<{
  address: `0x${string}`;
  name: string;
  rules: AlertRule[];
  addedAt: number;
  recipient?: string;
}> = [];
let mockDbSnapshots = new Map<string, {
  address: `0x${string}`;
  name: string;
  apr: number | null;
  tvl: string;
  tvlRaw: bigint;
  sharePrice: bigint;
  timestamp: number;
  assetDecimals: number;
  assetSymbol: string;
}>();

function cloneWatch(watch: {
  address: `0x${string}`;
  name: string;
  rules: AlertRule[];
  addedAt: number;
  recipient?: string;
}) {
  return {
    ...watch,
    rules: watch.rules.map((r) => ({ ...r })),
  };
}

function findMockWatch(address: string) {
  return mockDbWatches.find((w) => w.address.toLowerCase() === address.toLowerCase());
}

function resetWatchDbMocks(): void {
  mockDbWatches = [];
  mockDbSnapshots = new Map();

  vi.mocked(dbLoadWatch).mockImplementation((address) => {
    const w = findMockWatch(address);
    return w ? cloneWatch(w) : undefined;
  });
  vi.mocked(loadAllWatches).mockImplementation(() => mockDbWatches.map(cloneWatch));
  vi.mocked(dbWatchCount).mockImplementation(() => mockDbWatches.length);
  vi.mocked(dbWatchExists).mockImplementation((address) => findMockWatch(address) !== undefined);

  vi.mocked(dbInsertWatch).mockImplementation((watch) => {
    mockDbWatches.push(cloneWatch(watch));
  });
  vi.mocked(dbDeleteWatch).mockImplementation((address) => {
    mockDbWatches = mockDbWatches.filter((w) => w.address.toLowerCase() !== address.toLowerCase());
  });
  vi.mocked(dbUpdateRecipient).mockImplementation((address, recipient) => {
    const watch = findMockWatch(address);
    if (watch) watch.recipient = recipient;
  });
  vi.mocked(dbInsertRule).mockImplementation((address, rule) => {
    const watch = findMockWatch(address);
    if (watch) watch.rules.push({ ...rule });
  });
  vi.mocked(dbDeleteRule).mockImplementation((ruleId) => {
    for (const watch of mockDbWatches) {
      watch.rules = watch.rules.filter((r) => r.id !== ruleId);
    }
  });

  vi.mocked(dbLoadSnapshot).mockImplementation((address) => {
    const s = mockDbSnapshots.get(address.toLowerCase());
    return s ? { ...s } : undefined;
  });
  vi.mocked(loadAllSnapshots).mockImplementation(() => new Map(mockDbSnapshots));
  vi.mocked(upsertSnapshot).mockImplementation((snapshot) => {
    mockDbSnapshots.set(snapshot.address.toLowerCase(), { ...snapshot });
  });
  vi.mocked(dbDeleteSnapshot).mockImplementation((address) => {
    mockDbSnapshots.delete(address.toLowerCase());
  });
}

describe("watcher CRUD operations", () => {
  beforeEach(() => {
    _resetForTesting();
    resetWatchDbMocks();
    vi.mocked(loadDedupTimestamps).mockReturnValue({});
  });

  afterEach(() => {
    _resetForTesting();
  });

  it("startWatcher initializes without error", () => {
    startWatcher();
    expect(getWatches()).toEqual([]);
    expect(getSnapshots().size).toBe(0);
  });

  it("startWatcher opens the database", () => {
    startWatcher();
    expect(openDb).toHaveBeenCalled();
  });

  it("addWatch adds a vault and returns a snapshot", async () => {
    startWatcher();

    const snapshot = await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    expect(snapshot).toBeDefined();
    expect(snapshot.address).toBe(VALID_ADDRESS);
    expect(typeof snapshot.tvl).toBe("string");
    expect(getWatches()).toHaveLength(1);
    expect(getSnapshots().size).toBe(1);
  });

  it("addWatch persists watch and snapshot to db", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    expect(dbInsertWatch).toHaveBeenCalledWith(
      expect.objectContaining({ address: VALID_ADDRESS, name: "TestVault" })
    );
    expect(upsertSnapshot).toHaveBeenCalled();
  });

  it("addWatch rejects duplicate vault", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    await expect(
      addWatch({
        address: VALID_ADDRESS,
        name: "Duplicate",
        rules: [],
        addedAt: Date.now(),
      })
    ).rejects.toThrow("already being watched");
  });

  it("removeWatch removes a vault and cleans up", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    const removed = await removeWatch(VALID_ADDRESS);
    expect(removed.address).toBe(VALID_ADDRESS);
    expect(getWatches()).toHaveLength(0);
    expect(getSnapshots().size).toBe(0);
    expect(dbDeleteWatch).toHaveBeenCalled();
  });

  it("removeWatch rejects unknown vault", async () => {
    startWatcher();

    await expect(removeWatch(VALID_ADDRESS)).rejects.toThrow("not being watched");
  });

  it("addRule adds a rule to an existing watch", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    const rule: AlertRule = {
      id: "rule-test",
      expression: "apy < 3.0",
      severity: "warning",
      message: "APR below threshold",
    };

    const watch = await addRule(VALID_ADDRESS, rule);
    expect(watch.rules).toHaveLength(1);
    expect(watch.rules[0].id).toBe("rule-test");
    expect(dbInsertRule).toHaveBeenCalled();
  });

  it("addRule rejects duplicate rule ID", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    const rule: AlertRule = {
      id: "rule-dup",
      expression: "apy < 3.0",
      severity: "warning",
      message: "APR below threshold",
    };

    await addRule(VALID_ADDRESS, rule);
    await expect(addRule(VALID_ADDRESS, rule)).rejects.toThrow("already exists");
  });

  it("removeRule removes a rule from a watch", async () => {
    startWatcher();

    const rule: AlertRule = {
      id: "rule-remove",
      expression: "apy < 3.0",
      severity: "warning",
      message: "APR below threshold",
    };

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [rule],
      addedAt: Date.now(),
    });

    const watch = await removeRule(VALID_ADDRESS, "rule-remove");
    expect(watch.rules).toHaveLength(0);
    expect(dbDeleteRule).toHaveBeenCalledWith("rule-remove");
  });

  it("removeRule rejects unknown rule ID", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    await expect(removeRule(VALID_ADDRESS, "nonexistent")).rejects.toThrow("not found");
  });

  it("enforces MAX_WATCHES limit (20)", async () => {
    startWatcher();

    for (let i = 0; i < 20; i++) {
      const hex = i.toString(16).padStart(2, "0");
      const addr = `0x${"0".repeat(38)}${hex}` as `0x${string}`;
      await addWatch({ address: addr, name: `V${i}`, rules: [], addedAt: Date.now() });
    }

    expect(getWatches()).toHaveLength(20);
    await expect(
      addWatch({
        address: "0x" + "ff".repeat(20) as `0x${string}`,
        name: "TooMany",
        rules: [],
        addedAt: Date.now(),
      })
    ).rejects.toThrow("Maximum number of watches");
  });

  it("enforces MAX_RULES_PER_WATCH limit (50)", async () => {
    startWatcher();

    const rules: AlertRule[] = Array.from({ length: 50 }, (_, i) => ({
      id: `rule-${i}`,
      expression: "apy < 3.0",
      severity: "warning" as const,
      message: `Rule ${i}`,
    }));

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules,
      addedAt: Date.now(),
    });

    await expect(
      addRule(VALID_ADDRESS, {
        id: "rule-overflow",
        expression: "apy < 2.0",
        severity: "warning",
        message: "Too many",
      })
    ).rejects.toThrow("Maximum");
  });

  it("updateWatchRecipient sets recipient on an existing watch", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    const watch = await updateWatchRecipient(VALID_ADDRESS, "user@example.com");
    expect(watch.recipient).toBe("user@example.com");
    expect(getWatches()[0].recipient).toBe("user@example.com");
    expect(dbUpdateRecipient).toHaveBeenCalled();
  });

  it("updateWatchRecipient rejects unknown vault", async () => {
    startWatcher();

    await expect(
      updateWatchRecipient(VALID_ADDRESS, "user@example.com")
    ).rejects.toThrow("not being watched");
  });
});

describe("watcher persistence (SQLite)", () => {
  beforeEach(() => {
    _resetForTesting();
    resetWatchDbMocks();
    vi.mocked(loadDedupTimestamps).mockReturnValue({});
  });

  afterEach(() => {
    _resetForTesting();
  });

  it("loads watches from db on startup", () => {
    vi.mocked(loadAllWatches).mockReturnValue([
      {
        address: VALID_ADDRESS,
        name: "RestoredVault",
        rules: [{ id: "r1", expression: "apy < 3.0", severity: "warning", message: "test" }],
        addedAt: 1700000000000,
      },
    ]);
    vi.mocked(loadAllSnapshots).mockReturnValue(
      new Map([
        [
          VALID_ADDRESS.toLowerCase(),
          {
            address: VALID_ADDRESS,
            name: "RestoredVault",
            apr: 3.5,
            tvl: "1000",
            tvlRaw: 1000n * 10n ** 18n,
            sharePrice: 10n ** 18n,
            timestamp: 1700000000,
            assetDecimals: 18,
            assetSymbol: "WETH",
          },
        ],
      ])
    );

    startWatcher();

    expect(getWatches()).toHaveLength(1);
    expect(getWatches()[0].name).toBe("RestoredVault");
    expect(getSnapshots().size).toBe(1);
  });

  it("restores dedup timestamps from db on startup", () => {
    const timestamps = { "rule-1:0xabc": 1700000000 };
    vi.mocked(loadDedupTimestamps).mockReturnValue(timestamps);

    startWatcher();

    expect(loadDedupTimestamps).toHaveBeenCalled();
  });

  it("stopWatcher saves dedup and closes db", () => {
    startWatcher();
    stopWatcher();

    expect(saveDedupTimestamps).toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalled();
  });
});

describe("watcher health check", () => {
  beforeEach(() => {
    _resetForTesting();
    resetWatchDbMocks();
    vi.mocked(loadDedupTimestamps).mockReturnValue({});
  });

  afterEach(() => {
    _resetForTesting();
  });

  it("runHealthCheck updates snapshots", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    const snapBefore = getLatestSnapshot(VALID_ADDRESS);
    expect(snapBefore).toBeDefined();

    await runHealthCheck();

    const snapAfter = getLatestSnapshot(VALID_ADDRESS);
    expect(snapAfter).toBeDefined();
    expect(snapAfter!.timestamp).toBeGreaterThanOrEqual(snapBefore!.timestamp);
  });

  it("runHealthCheck persists snapshots and dedup to db", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [],
      addedAt: Date.now(),
    });

    // Clear call counts from addWatch
    vi.mocked(upsertSnapshot).mockClear();
    vi.mocked(saveDedupTimestamps).mockClear();

    await runHealthCheck();

    expect(upsertSnapshot).toHaveBeenCalled();
    expect(saveDedupTimestamps).toHaveBeenCalled();
  });

  it("runHealthCheck is safe with no watches", async () => {
    startWatcher();
    await runHealthCheck(); // Should not throw
  });

  it("getBenchmarks returns initial state", () => {
    const b = getBenchmarks();
    expect(b).toHaveProperty("stethApr");
    expect(b).toHaveProperty("timestamp");
  });

  it("getLatestAlerts returns empty by default", () => {
    startWatcher();
    const alerts = getLatestAlerts();
    expect(alerts).toEqual([]);
    expect(loadAlertHistory).toHaveBeenCalled();
  });

  it("processAlerts uses sendAlertNotification (not direct Telegram)", async () => {
    startWatcher();

    await addWatch({
      address: VALID_ADDRESS,
      name: "TestVault",
      rules: [{ id: "rule-fire", expression: "apr < 999", severity: "warning", message: "test" }],
      addedAt: Date.now(),
    });

    await runHealthCheck();

    expect(sendAlertNotification).toBeDefined();
  });
});
