import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Unmock modules that db.ts depends on
vi.unmock("../../src/monitor/db.js");
vi.unmock("../../src/monitor/types.js");

import {
  openDb,
  closeDb,
  insertWatch,
  deleteWatch,
  updateRecipient,
  loadWatch,
  loadAllWatches,
  watchCount,
  watchExists,
  insertRule,
  deleteRule,
  upsertSnapshot,
  loadSnapshot,
  loadAllSnapshots,
  appendAlerts,
  loadAlertHistory,
  loadAlertsByVault,
  trimAlertHistory,
  loadDedupTimestamps,
  saveDedupTimestamps,
  deleteSnapshot,
  getDb,
} from "../../src/monitor/db.js";
import type { VaultWatch, VaultSnapshot, VaultAlert, AlertRule } from "../../src/monitor/types.js";

const ADDR = "0x82dc3260f599f4fc4307209a1e3b53ddca4c585e";

function makeWatch(overrides?: Partial<VaultWatch>): VaultWatch {
  return {
    address: ADDR as `0x${string}`,
    name: "TestVault",
    rules: [],
    addedAt: 1700000000000,
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<VaultSnapshot>): VaultSnapshot {
  return {
    address: ADDR,
    name: "TestVault",
    apr: 3.5,
    tvl: "1000",
    tvlRaw: 1000n * 10n ** 18n,
    sharePrice: 10n ** 18n,
    timestamp: 1700000000,
    assetDecimals: 18,
    assetSymbol: "WETH",
    ...overrides,
  };
}

function makeAlert(overrides?: Partial<VaultAlert>): VaultAlert {
  return {
    ruleId: "rule-1",
    severity: "warning",
    vaultAddress: ADDR,
    vaultName: "TestVault",
    message: "APR dropped",
    context: {
      expression: "apr < 3.0",
      scope: { apr: 2.5 },
      current: { apr: 2.5, tvl: "1000", sharePrice: "1000000000000000000", assetSymbol: "WETH" },
      previous: null,
      benchmarks: { stethApr: 3.1 },
    },
    timestamp: 1700000000,
    ...overrides,
  };
}

describe("db module", () => {
  beforeEach(() => {
    openDb(":memory:");
  });

  afterEach(() => {
    closeDb();
  });

  describe("lifecycle", () => {
    it("openDb is idempotent", () => {
      openDb(":memory:"); // already open — should not throw
      expect(getDb()).toBeDefined();
    });

    it("getDb throws if not open", () => {
      closeDb();
      expect(() => getDb()).toThrow("Database not open");
    });

    it("closeDb is idempotent", () => {
      closeDb();
      closeDb(); // should not throw
    });
  });

  describe("watches", () => {
    it("inserts and loads a watch", () => {
      insertWatch(makeWatch());
      const watches = loadAllWatches();
      expect(watches).toHaveLength(1);
      expect(watches[0].address).toBe(ADDR);
      expect(watches[0].name).toBe("TestVault");
      expect(watches[0].addedAt).toBe(1700000000000);
    });

    it("inserts watch with rules", () => {
      const rules: AlertRule[] = [
        { id: "r1", expression: "apr < 3.0", severity: "warning", message: "Low APR" },
        { id: "r2", expression: "tvl < 500", severity: "critical", message: "Low TVL" },
      ];
      insertWatch(makeWatch({ rules }));

      const watches = loadAllWatches();
      expect(watches[0].rules).toHaveLength(2);
      expect(watches[0].rules[0].id).toBe("r1");
      expect(watches[0].rules[1].id).toBe("r2");
    });

    it("inserts watch with recipient", () => {
      insertWatch(makeWatch({ recipient: "user@test.com" }));
      const watches = loadAllWatches();
      expect(watches[0].recipient).toBe("user@test.com");
    });

    it("inserts watch without recipient", () => {
      insertWatch(makeWatch());
      const watches = loadAllWatches();
      expect(watches[0].recipient).toBeUndefined();
    });

    it("deletes a watch and cascades to rules", () => {
      const rules: AlertRule[] = [
        { id: "r1", expression: "apr < 3.0", severity: "warning", message: "Low APR" },
      ];
      insertWatch(makeWatch({ rules }));
      deleteWatch(ADDR);

      expect(loadAllWatches()).toHaveLength(0);
    });

    it("updates recipient", () => {
      insertWatch(makeWatch());
      updateRecipient(ADDR, "new@test.com");

      const watches = loadAllWatches();
      expect(watches[0].recipient).toBe("new@test.com");
    });

    it("loadWatch returns a single watch by address", () => {
      insertWatch(makeWatch());
      const watch = loadWatch(ADDR);
      expect(watch).toBeDefined();
      expect(watch!.address).toBe(ADDR);
      expect(watch!.name).toBe("TestVault");
    });

    it("loadWatch returns undefined for unknown address", () => {
      expect(loadWatch("0x0000000000000000000000000000000000000001")).toBeUndefined();
    });

    it("loadWatch includes rules", () => {
      const rules: AlertRule[] = [
        { id: "r1", expression: "apr < 3.0", severity: "warning", message: "Low APR" },
      ];
      insertWatch(makeWatch({ rules }));
      const watch = loadWatch(ADDR);
      expect(watch!.rules).toHaveLength(1);
      expect(watch!.rules[0].id).toBe("r1");
    });

    it("watchCount returns correct count", () => {
      expect(watchCount()).toBe(0);
      insertWatch(makeWatch());
      expect(watchCount()).toBe(1);
    });

    it("watchExists returns correct boolean", () => {
      expect(watchExists(ADDR)).toBe(false);
      insertWatch(makeWatch());
      expect(watchExists(ADDR)).toBe(true);
      expect(watchExists("0x0000000000000000000000000000000000000001")).toBe(false);
    });
  });

  describe("rules", () => {
    it("inserts a rule for an existing watch", () => {
      insertWatch(makeWatch());
      insertRule(ADDR, { id: "r-new", expression: "tvl < 100", severity: "critical", message: "TVL crash" });

      const watches = loadAllWatches();
      expect(watches[0].rules).toHaveLength(1);
      expect(watches[0].rules[0].id).toBe("r-new");
    });

    it("deletes a rule", () => {
      const rules: AlertRule[] = [
        { id: "r1", expression: "apr < 3.0", severity: "warning", message: "Low APR" },
      ];
      insertWatch(makeWatch({ rules }));
      deleteRule("r1");

      const watches = loadAllWatches();
      expect(watches[0].rules).toHaveLength(0);
    });
  });

  describe("snapshots", () => {
    it("upserts and loads a snapshot", () => {
      insertWatch(makeWatch());
      upsertSnapshot(makeSnapshot());

      const snaps = loadAllSnapshots();
      expect(snaps.size).toBe(1);
      const snap = snaps.get(ADDR)!;
      expect(snap.name).toBe("TestVault");
      expect(snap.apr).toBe(3.5);
      expect(snap.tvlRaw).toBe(1000n * 10n ** 18n);
      expect(snap.sharePrice).toBe(10n ** 18n);
      expect(snap.assetDecimals).toBe(18);
      expect(snap.assetSymbol).toBe("WETH");
    });

    it("upsert replaces an existing snapshot", () => {
      insertWatch(makeWatch());
      upsertSnapshot(makeSnapshot());
      upsertSnapshot(makeSnapshot({ apr: 4.0, timestamp: 1700000100 }));

      const snaps = loadAllSnapshots();
      expect(snaps.size).toBe(1);
      expect(snaps.get(ADDR)!.apr).toBe(4.0);
      expect(snaps.get(ADDR)!.timestamp).toBe(1700000100);
    });

    it("loadSnapshot returns a single snapshot by address", () => {
      insertWatch(makeWatch());
      upsertSnapshot(makeSnapshot());
      const snap = loadSnapshot(ADDR);
      expect(snap).toBeDefined();
      expect(snap!.name).toBe("TestVault");
      expect(snap!.apr).toBe(3.5);
      expect(snap!.tvlRaw).toBe(1000n * 10n ** 18n);
    });

    it("loadSnapshot returns undefined for unknown address", () => {
      expect(loadSnapshot("0x0000000000000000000000000000000000000001")).toBeUndefined();
    });

    it("deletes a snapshot", () => {
      insertWatch(makeWatch());
      upsertSnapshot(makeSnapshot());
      deleteSnapshot(ADDR);

      expect(loadAllSnapshots().size).toBe(0);
    });

    it("snapshot is cascade-deleted when watch is deleted", () => {
      insertWatch(makeWatch());
      upsertSnapshot(makeSnapshot());
      deleteWatch(ADDR);

      expect(loadAllSnapshots().size).toBe(0);
    });
  });

  describe("alerts", () => {
    it("appends and loads alerts", () => {
      const alerts = [makeAlert(), makeAlert({ ruleId: "rule-2", timestamp: 1700000100 })];
      appendAlerts(alerts);

      const loaded = loadAlertHistory(10);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].ruleId).toBe("rule-1");
      expect(loaded[1].ruleId).toBe("rule-2");
    });

    it("loads alerts by vault", () => {
      const otherAddr = "0x0000000000000000000000000000000000000001";
      appendAlerts([
        makeAlert(),
        makeAlert({ vaultAddress: otherAddr, ruleId: "rule-other" }),
      ]);

      const vaultAlerts = loadAlertsByVault(ADDR, 10);
      expect(vaultAlerts).toHaveLength(1);
      expect(vaultAlerts[0].ruleId).toBe("rule-1");
    });

    it("loadAlertHistory returns oldest first (limited)", () => {
      const alerts = Array.from({ length: 5 }, (_, i) =>
        makeAlert({ ruleId: `rule-${i}`, timestamp: 1700000000 + i })
      );
      appendAlerts(alerts);

      const loaded = loadAlertHistory(3);
      expect(loaded).toHaveLength(3);
      // Should be the 3 most recent, in oldest-first order
      expect(loaded[0].ruleId).toBe("rule-2");
      expect(loaded[1].ruleId).toBe("rule-3");
      expect(loaded[2].ruleId).toBe("rule-4");
    });

    it("trims alert history", () => {
      const alerts = Array.from({ length: 10 }, (_, i) =>
        makeAlert({ ruleId: `rule-${i}`, timestamp: 1700000000 + i })
      );
      appendAlerts(alerts);

      trimAlertHistory(3);
      const loaded = loadAlertHistory(100);
      expect(loaded).toHaveLength(3);
    });

    it("preserves context JSON round-trip", () => {
      appendAlerts([makeAlert()]);
      const loaded = loadAlertHistory(1);
      expect(loaded[0].context.expression).toBe("apr < 3.0");
      expect(loaded[0].context.scope).toEqual({ apr: 2.5 });
    });
  });

  describe("dedup", () => {
    it("saves and loads dedup timestamps", () => {
      const timestamps = { "rule-1:0xabc": 1700000000, "rule-2:0xdef": 1700000100 };
      saveDedupTimestamps(timestamps);

      const loaded = loadDedupTimestamps();
      expect(loaded).toEqual(timestamps);
    });

    it("save replaces all previous entries", () => {
      saveDedupTimestamps({ a: 1 });
      saveDedupTimestamps({ b: 2 });

      const loaded = loadDedupTimestamps();
      expect(loaded).toEqual({ b: 2 });
    });

    it("returns empty object when no dedup entries", () => {
      expect(loadDedupTimestamps()).toEqual({});
    });
  });
});
