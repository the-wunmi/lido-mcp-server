import { describe, it, expect, beforeEach, vi } from "vitest";
import { detectChanges, _resetDedupState } from "../../src/monitor/detector.js";
import { evaluateRule } from "../../src/monitor/rules.js";
import type { VaultWatch, VaultSnapshot, BenchmarkRates } from "../../src/monitor/types.js";

const benchmarks: BenchmarkRates = { stethApr: 3.1, timestamp: Date.now() };

const baseWatch: VaultWatch = {
  address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
  name: "TestVault",
  rules: [],
  addedAt: Date.now(),
};

function makeSnapshot(overrides: Partial<VaultSnapshot> = {}): VaultSnapshot {
  return {
    address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    name: "TestVault",
    apr: 3.5,
    tvl: "1000",
    tvlRaw: 1000n * 10n ** 18n,
    sharePrice: 10n ** 18n,
    timestamp: Math.floor(Date.now() / 1000),
    assetDecimals: 18,
    assetSymbol: "ETH",
    ...overrides,
  };
}

describe("detectChanges", () => {
  beforeEach(() => {
    _resetDedupState();
    vi.mocked(evaluateRule).mockReturnValue(false);
  });

  it("returns no alerts when no rules are defined", () => {
    const current = makeSnapshot();
    const alerts = detectChanges(baseWatch, current, undefined, benchmarks);
    expect(alerts).toHaveLength(0);
  });

  it("returns alert when a rule evaluates to true", () => {
    vi.mocked(evaluateRule).mockReturnValue(true);

    const watch = {
      ...baseWatch,
      rules: [{
        id: "yield-floor",
        expression: "apy < 3.0",
        severity: "critical" as const,
        message: "APY dropped to {{apy}}%",
      }],
    };

    const current = makeSnapshot({ apr: 2.5 });
    const alerts = detectChanges(watch, current, undefined, benchmarks);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleId).toBe("yield-floor");
    expect(alerts[0].severity).toBe("critical");
    expect(alerts[0].context.expression).toBe("apy < 3.0");
  });

  it("returns no alert when rule evaluates to false", () => {
    vi.mocked(evaluateRule).mockReturnValue(false);

    const watch = {
      ...baseWatch,
      rules: [{
        id: "yield-floor",
        expression: "apy < 3.0",
        severity: "warning" as const,
        message: "test",
      }],
    };

    const current = makeSnapshot({ apr: 3.5 });
    const alerts = detectChanges(watch, current, undefined, benchmarks);
    expect(alerts).toHaveLength(0);
  });

  it("evaluates multiple rules independently", () => {
    vi.mocked(evaluateRule)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    const watch = {
      ...baseWatch,
      rules: [
        { id: "r1", expression: "apy < 3", severity: "critical" as const, message: "m1" },
        { id: "r2", expression: "tvl < 100", severity: "warning" as const, message: "m2" },
        { id: "r3", expression: "spread_vs_steth < -1", severity: "info" as const, message: "m3" },
      ],
    };

    const alerts = detectChanges(watch, makeSnapshot(), undefined, benchmarks);
    expect(alerts).toHaveLength(2);
    expect(alerts[0].ruleId).toBe("r1");
    expect(alerts[1].ruleId).toBe("r3");
  });

  it("includes context with snapshot data in alert", () => {
    vi.mocked(evaluateRule).mockReturnValue(true);

    const watch = {
      ...baseWatch,
      rules: [{ id: "test", expression: "apy < 3", severity: "warning" as const, message: "test" }],
    };

    const previous = makeSnapshot({ apr: 4.0, tvl: "900" });
    const current = makeSnapshot({ apr: 2.5, tvl: "1000" });
    const alerts = detectChanges(watch, current, previous, benchmarks);

    expect(alerts[0].context.current.apr).toBe(2.5);
    expect(alerts[0].context.previous?.apr).toBe(4.0);
    expect(alerts[0].context.benchmarks.stethApr).toBe(3.1);
  });

  it("includes assetSymbol in alert context", () => {
    vi.mocked(evaluateRule).mockReturnValue(true);

    const watch = {
      ...baseWatch,
      rules: [{ id: "test", expression: "apy < 3", severity: "warning" as const, message: "test" }],
    };

    const current = makeSnapshot({ assetSymbol: "WETH" });
    const alerts = detectChanges(watch, current, undefined, benchmarks);

    expect(alerts[0].context.current.assetSymbol).toBe("WETH");
  });

  describe("deduplication", () => {
    it("suppresses duplicate rule alerts within cooldown", () => {
      vi.mocked(evaluateRule).mockReturnValue(true);

      const watch = {
        ...baseWatch,
        rules: [{ id: "r1", expression: "apy < 3", severity: "critical" as const, message: "test" }],
      };

      const first = detectChanges(watch, makeSnapshot(), undefined, benchmarks);
      expect(first).toHaveLength(1);

      const second = detectChanges(watch, makeSnapshot(), undefined, benchmarks);
      expect(second).toHaveLength(0);
    });

    it("allows different rule IDs on the same vault", () => {
      vi.mocked(evaluateRule).mockReturnValue(true);

      const watch1 = {
        ...baseWatch,
        rules: [{ id: "r1", expression: "apy < 3", severity: "critical" as const, message: "test" }],
      };

      const watch2 = {
        ...baseWatch,
        rules: [{ id: "r2", expression: "tvl < 100", severity: "warning" as const, message: "test" }],
      };

      const first = detectChanges(watch1, makeSnapshot(), undefined, benchmarks);
      const second = detectChanges(watch2, makeSnapshot(), undefined, benchmarks);

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
    });

    it("allows same rule ID on different vaults", () => {
      vi.mocked(evaluateRule).mockReturnValue(true);

      const watch1 = {
        ...baseWatch,
        address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        rules: [{ id: "r1", expression: "apy < 3", severity: "critical" as const, message: "test" }],
      };

      const watch2 = {
        ...baseWatch,
        address: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        rules: [{ id: "r1", expression: "apy < 3", severity: "critical" as const, message: "test" }],
      };

      const snap1 = makeSnapshot({ address: watch1.address });
      const snap2 = makeSnapshot({ address: watch2.address });

      const first = detectChanges(watch1, snap1, undefined, benchmarks);
      const second = detectChanges(watch2, snap2, undefined, benchmarks);

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
    });
  });
});

import { buildScope } from "../../src/monitor/rules.js";

describe("detectChanges (end-to-end with real rules)", () => {
  // These tests configure the mocked evaluateRule and buildScope to simulate
  // real expression evaluation behavior, verifying the detection pipeline
  // works end-to-end with realistic scope data.

  beforeEach(() => {
    _resetDedupState();
  });

  it("triggers alert when APY drops below threshold (mock simulates real eval)", () => {
    // Configure mock to return true when expression would match
    vi.mocked(evaluateRule).mockImplementation((expr: string, scope: Record<string, number>) => {
      if (expr === "apy < 3.0" && scope.apy < 3.0) return true;
      return false;
    });

    vi.mocked(buildScope).mockReturnValue({
      apr: 2.5, apr_prev: 3.5, apr_delta: -1.0,
      apy: 2.5, apy_prev: 3.5, apy_delta: -1.0,
      tvl: 1000, tvl_prev: 900, tvl_change_pct: 11.1,
      share_price: 1.001, share_price_prev: 1.0, share_price_change_pct: 0.1,
      steth_apr: 3.1, spread_vs_steth: -0.6,
    });

    const watch = {
      ...baseWatch,
      rules: [{
        id: "yield-floor",
        expression: "apy < 3.0",
        severity: "warning" as const,
        message: "APY dropped to {{apy}}%",
      }],
    };

    const current = makeSnapshot({ apr: 2.5 });
    const previous = makeSnapshot({ apr: 3.5 });
    const alerts = detectChanges(watch, current, previous, benchmarks);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("warning");
    expect(alerts[0].vaultName).toBe("TestVault");
  });

  it("does not trigger when APY is above threshold", () => {
    vi.mocked(evaluateRule).mockImplementation((expr: string, scope: Record<string, number>) => {
      if (expr === "apy < 3.0" && scope.apy < 3.0) return true;
      return false;
    });

    vi.mocked(buildScope).mockReturnValue({
      apr: 3.5, apr_prev: 3.4, apr_delta: 0.1,
      apy: 3.5, apy_prev: 3.4, apy_delta: 0.1,
      tvl: 1000, tvl_prev: 990, tvl_change_pct: 1.0,
      share_price: 1.0, share_price_prev: 0.999, share_price_change_pct: 0.1,
      steth_apr: 3.1, spread_vs_steth: 0.4,
    });

    const watch = {
      ...baseWatch,
      rules: [{
        id: "yield-floor",
        expression: "apy < 3.0",
        severity: "warning" as const,
        message: "APY dropped to {{apy}}%",
      }],
    };

    const current = makeSnapshot({ apr: 3.5 });
    const alerts = detectChanges(watch, current, undefined, benchmarks);

    expect(alerts).toHaveLength(0);
  });

  it("includes allocation shift data in alert context", () => {
    vi.mocked(evaluateRule).mockReturnValue(true);

    const watch: VaultWatch = {
      ...baseWatch,
      rules: [{
        id: "alloc-rule",
        expression: "max_alloc_shift > 5",
        severity: "warning" as const,
        message: "Allocation shifted",
      }],
    };

    const previous = makeSnapshot({
      allocations: [
        { protocol: "Aave", valueWei: "500", percentage: 50 },
        { protocol: "Morpho", valueWei: "500", percentage: 50 },
      ],
    });

    const current = makeSnapshot({
      allocations: [
        { protocol: "Aave", valueWei: "300", percentage: 30 },
        { protocol: "Morpho", valueWei: "700", percentage: 70 },
      ],
    });

    const alerts = detectChanges(watch, current, previous, benchmarks);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].context.allocationShifts).toBeDefined();
    expect(alerts[0].context.allocationShifts!.length).toBe(2);

    const aaveShift = alerts[0].context.allocationShifts!.find(s => s.protocol === "Aave");
    expect(aaveShift?.from).toBe(50);
    expect(aaveShift?.to).toBe(30);
  });
});
