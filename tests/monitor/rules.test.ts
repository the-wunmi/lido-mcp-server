import { describe, it, expect } from "vitest";

// Unmock rules.js for this test — we want to test real mathjs evaluation
import { vi } from "vitest";
vi.unmock("../../src/monitor/rules.js");

import {
  validateExpression,
  evaluateRule,
  buildScope,
  renderTemplate,
  generateRuleId,
  getAvailableVariables,
  dryRunRule,
  VARIABLE_DECIMALS,
  MAX_EXPRESSION_LENGTH,
  MAX_MESSAGE_LENGTH,
} from "../../src/monitor/rules.js";
import type { VaultSnapshot, BenchmarkRates } from "../../src/monitor/types.js";

describe("validateExpression", () => {
  it("accepts valid expressions", () => {
    expect(validateExpression("apy < 3.0")).toBeNull();
    expect(validateExpression("tvl_change_pct > 10")).toBeNull();
    expect(validateExpression("apy < steth_apr - 0.5")).toBeNull();
    expect(validateExpression("abs(apy_delta) > 1.5")).toBeNull();
    expect(validateExpression("apy < 3 and tvl_change_pct > 5")).toBeNull();
    expect(validateExpression("apy < 3 or tvl > 1000")).toBeNull();
    // apr aliases
    expect(validateExpression("apr < 3.0")).toBeNull();
    expect(validateExpression("apr_prev > 2.0")).toBeNull();
    expect(validateExpression("apr_delta < -1.0")).toBeNull();
  });

  it("accepts compound expressions with multiple operators", () => {
    expect(validateExpression("apy < 3 and tvl > 500 or spread_vs_steth < -1")).toBeNull();
    expect(validateExpression("abs(apy_delta) > 1 and abs(tvl_change_pct) > 5")).toBeNull();
    expect(validateExpression("max(apy, steth_apr) > 5")).toBeNull();
    expect(validateExpression("min(tvl, tvl_prev) < 100")).toBeNull();
  });

  it("rejects empty expressions", () => {
    expect(validateExpression("")).not.toBeNull();
    expect(validateExpression("  ")).not.toBeNull();
  });

  it("rejects invalid syntax", () => {
    expect(validateExpression("apy <<< 3")).not.toBeNull();
  });

  it("rejects forbidden keywords via AST validation", () => {
    expect(validateExpression("import('os')")).not.toBeNull();
    expect(validateExpression("eval('code')")).not.toBeNull();
    expect(validateExpression("constructor")).not.toBeNull();
  });

  describe("AST allowlist validation", () => {
    it("rejects assignment expressions (x = 5)", () => {
      const result = validateExpression("x = 5");
      expect(result).not.toBeNull();
      expect(result).toContain("Forbidden node type: AssignmentNode");
    });

    it("rejects function definitions", () => {
      const result = validateExpression("f(x) = x + 1");
      expect(result).not.toBeNull();
      expect(result).toContain("Forbidden node type: FunctionAssignmentNode");
    });

    it("rejects unknown variables", () => {
      const result = validateExpression("unknown_var < 3");
      expect(result).not.toBeNull();
      expect(result).toContain('Unknown variable "unknown_var"');
    });

    it("rejects unknown functions", () => {
      const result = validateExpression("sin(apy)");
      expect(result).not.toBeNull();
      expect(result).toContain('Function "sin" is not allowed');
    });

    it("accepts all allowed math functions", () => {
      expect(validateExpression("abs(apy_delta) > 1")).toBeNull();
      expect(validateExpression("min(apy, steth_apr) > 1")).toBeNull();
      expect(validateExpression("max(apy, steth_apr) > 1")).toBeNull();
      expect(validateExpression("round(apy) > 3")).toBeNull();
      expect(validateExpression("floor(tvl) > 100")).toBeNull();
      expect(validateExpression("ceil(apy) > 3")).toBeNull();
      expect(validateExpression("sqrt(tvl) > 10")).toBeNull();
      expect(validateExpression("sign(apy_delta) < 0")).toBeNull();
    });

    it("rejects expression over MAX_EXPRESSION_LENGTH", () => {
      const longExpr = "apy < " + "3".repeat(MAX_EXPRESSION_LENGTH);
      const result = validateExpression(longExpr);
      expect(result).not.toBeNull();
      expect(result).toContain("Expression too long");
      expect(result).toContain(`max ${MAX_EXPRESSION_LENGTH}`);
    });

    it("rejects deeply nested expressions (AST depth > 10)", () => {
      // Build a deeply nested expression: abs(abs(abs(abs(abs(abs(abs(abs(abs(abs(abs(apy))))))))))) > 1
      const depth = 12;
      let expr = "apy";
      for (let i = 0; i < depth; i++) {
        expr = `abs(${expr})`;
      }
      expr += " > 1";
      const result = validateExpression(expr);
      expect(result).not.toBeNull();
      expect(result).toContain("too deeply nested");
    });
  });
});

describe("MAX_EXPRESSION_LENGTH and MAX_MESSAGE_LENGTH exports", () => {
  it("MAX_EXPRESSION_LENGTH is 500", () => {
    expect(MAX_EXPRESSION_LENGTH).toBe(500);
  });

  it("MAX_MESSAGE_LENGTH is 1000", () => {
    expect(MAX_MESSAGE_LENGTH).toBe(1000);
  });
});

describe("evaluateRule", () => {
  const scope = {
    apy: 2.5,
    apy_prev: 3.5,
    apy_delta: -1.0,
    tvl: 1000,
    tvl_prev: 900,
    tvl_change_pct: 11.1,
    share_price: 1.001,
    share_price_prev: 1.0,
    share_price_change_pct: 0.1,
    steth_apr: 3.1,
    spread_vs_steth: -0.6,
  };

  it("returns true when expression matches", () => {
    expect(evaluateRule("apy < 3.0", scope)).toBe(true);
    expect(evaluateRule("tvl_change_pct > 10", scope)).toBe(true);
    expect(evaluateRule("spread_vs_steth < 0", scope)).toBe(true);
  });

  it("returns false when expression does not match", () => {
    expect(evaluateRule("apy > 3.0", scope)).toBe(false);
    expect(evaluateRule("tvl_change_pct < 5", scope)).toBe(false);
  });

  it("handles compound expressions", () => {
    expect(evaluateRule("apy < 3 and tvl_change_pct > 10", scope)).toBe(true);
    expect(evaluateRule("apy > 5 and tvl_change_pct > 10", scope)).toBe(false);
    expect(evaluateRule("apy > 5 or tvl_change_pct > 10", scope)).toBe(true);
  });

  it("handles math functions", () => {
    expect(evaluateRule("abs(apy_delta) > 0.5", scope)).toBe(true);
    expect(evaluateRule("abs(apy_delta) > 2", scope)).toBe(false);
  });

  it("returns false on NaN comparisons (safe default)", () => {
    const scopeWithNaN = { ...scope, apy: NaN };
    expect(evaluateRule("apy < 3.0", scopeWithNaN)).toBe(false);
  });

  it("returns false on evaluation error", () => {
    expect(evaluateRule("undefined_var < 3", scope)).toBe(false);
  });
});

describe("buildScope", () => {
  const current: VaultSnapshot = {
    address: "0x1234567890abcdef1234567890abcdef12345678",
    name: "Test",
    apr: 3.5,
    tvl: "1000",
    tvlRaw: 1000n * 10n ** 18n,
    sharePrice: 1001n * 10n ** 15n, // 1.001 ETH per share
    timestamp: 1700000000,
    assetDecimals: 18,
    assetSymbol: "ETH",
  };

  const previous: VaultSnapshot = {
    ...current,
    apr: 3.0,
    tvl: "900",
    tvlRaw: 900n * 10n ** 18n,
    sharePrice: 10n ** 18n, // 1.0 ETH per share
    timestamp: 1699900000,
  };

  const benchmarks: BenchmarkRates = { stethApr: 3.1, timestamp: Date.now() };

  it("builds correct scope with all values", () => {
    const scope = buildScope(current, previous, benchmarks);

    expect(scope.apr).toBe(3.5);
    expect(scope.apr_prev).toBe(3.0);
    expect(scope.apr_delta).toBeCloseTo(0.5);
    expect(scope.tvl).toBe(1000);
    expect(scope.tvl_prev).toBe(900);
    expect(scope.tvl_change_pct).toBeCloseTo(11.11, 1);
    expect(scope.steth_apr).toBe(3.1);
    expect(scope.spread_vs_steth).toBeCloseTo(0.4);
    // apy aliases mirror apr values (backward compatibility)
    expect(scope.apy).toBe(scope.apr);
    expect(scope.apy_prev).toBe(scope.apr_prev);
    expect(scope.apy_delta).toBe(scope.apr_delta);
  });

  it("uses NaN for missing previous snapshot", () => {
    const scope = buildScope(current, undefined, benchmarks);

    expect(isNaN(scope.apy_prev)).toBe(true);
    expect(isNaN(scope.apy_delta)).toBe(true);
    expect(isNaN(scope.tvl_change_pct)).toBe(true);
  });

  it("uses NaN for null APY", () => {
    const nullApr = { ...current, apr: null };
    const scope = buildScope(nullApr, previous, benchmarks);

    expect(isNaN(scope.apr)).toBe(true);
    expect(isNaN(scope.spread_vs_steth)).toBe(true);
  });

  it("uses BigInt arithmetic for share_price_change_pct", () => {
    // Current: 1.001 ETH/share, Previous: 1.0 ETH/share
    // Change should be ~0.1%
    const scope = buildScope(current, previous, benchmarks);

    expect(scope.share_price_change_pct).toBeCloseTo(0.1, 1);
  });

  it("normalizes share price using asset decimals", () => {
    const scope = buildScope(current, previous, benchmarks);

    // share_price = Number(1001n * 10n ** 15n) / 10^18 = ~1.001
    expect(scope.share_price).toBeCloseTo(1.001, 3);
    // share_price_prev = Number(10n ** 18n) / 10^18 = 1.0
    expect(scope.share_price_prev).toBeCloseTo(1.0, 3);
  });

  it("handles 6-decimal assets correctly", () => {
    // e.g. USDC vault with 6 decimal asset
    const usdc_current: VaultSnapshot = {
      ...current,
      sharePrice: 1001000n, // 1.001 in 6-decimal terms
      assetDecimals: 6,
    };
    const usdc_previous: VaultSnapshot = {
      ...previous,
      sharePrice: 1000000n, // 1.0 in 6-decimal terms
      assetDecimals: 6,
    };

    const scope = buildScope(usdc_current, usdc_previous, benchmarks);
    expect(scope.share_price).toBeCloseTo(1.001, 3);
    expect(scope.share_price_prev).toBeCloseTo(1.0, 3);
    expect(scope.share_price_change_pct).toBeCloseTo(0.1, 1);
  });
});

describe("renderTemplate", () => {
  it("replaces {{var}} with formatted values using variable-aware decimals", () => {
    const scope = { apy: 2.8, tvl: 48500, steth_apr: 3.1 };
    const result = renderTemplate("APY is {{apy}}%, TVL is {{tvl}} ETH", scope);
    // apy should have 2 decimals, tvl should have 0 decimals
    expect(result).toBe("APY is 2.80%, TVL is 48500 ETH");
  });

  it("formats tvl with 0 decimal places", () => {
    const scope = { tvl: 12345.6789 };
    const result = renderTemplate("TVL: {{tvl}}", scope);
    expect(result).toBe("TVL: 12346");
  });

  it("formats share_price with 6 decimal places", () => {
    const scope = { share_price: 1.001234 };
    const result = renderTemplate("Price: {{share_price}}", scope);
    expect(result).toBe("Price: 1.001234");
  });

  it("formats apy with 2 decimal places", () => {
    const scope = { apy: 3.14159 };
    const result = renderTemplate("APY: {{apy}}%", scope);
    expect(result).toBe("APY: 3.14%");
  });

  it("formats share_price_change_pct with 2 decimal places", () => {
    const scope = { share_price_change_pct: 0.12345 };
    const result = renderTemplate("Change: {{share_price_change_pct}}%", scope);
    expect(result).toBe("Change: 0.12%");
  });

  it("handles missing variables with N/A", () => {
    const scope = { apy: 2.8 };
    const result = renderTemplate("Unknown: {{missing}}", scope);
    expect(result).toBe("Unknown: N/A");
  });

  it("handles NaN values with N/A", () => {
    const result = renderTemplate("APY: {{apy}}", { apy: NaN });
    expect(result).toBe("APY: N/A");
  });

  it("returns original string when no placeholders", () => {
    expect(renderTemplate("No variables here", { apy: 3.5 })).toBe("No variables here");
  });
});

describe("generateRuleId", () => {
  it("generates unique IDs with rule- prefix", () => {
    const id1 = generateRuleId();
    const id2 = generateRuleId();
    const id3 = generateRuleId();

    expect(id1).toMatch(/^rule-[a-f0-9]{8}$/);
    expect(id2).toMatch(/^rule-[a-f0-9]{8}$/);
    expect(id3).toMatch(/^rule-[a-f0-9]{8}$/);

    // All IDs should be unique
    expect(new Set([id1, id2, id3]).size).toBe(3);
  });
});

describe("getAvailableVariables", () => {
  it("returns all expected variables", () => {
    const vars = getAvailableVariables();
    expect(vars).toContain("apy");
    expect(vars).toContain("steth_apr");
    expect(vars).toContain("tvl_change_pct");
    expect(vars).toContain("spread_vs_steth");
    expect(vars).toContain("share_price");
    expect(vars).toContain("share_price_prev");
    expect(vars).toContain("share_price_change_pct");
    // apr aliases
    expect(vars).toContain("apr");
    expect(vars).toContain("apr_prev");
    expect(vars).toContain("apr_delta");
  });
});

describe("VARIABLE_DECIMALS", () => {
  it("is exported and contains expected keys", () => {
    expect(VARIABLE_DECIMALS).toBeDefined();
    expect(VARIABLE_DECIMALS.apr).toBe(2);
    expect(VARIABLE_DECIMALS.tvl).toBe(0);
    expect(VARIABLE_DECIMALS.share_price).toBe(6);
  });
});

describe("dryRunRule", () => {
  const current: VaultSnapshot = {
    address: "0x1234567890abcdef1234567890abcdef12345678",
    name: "Test",
    apr: 2.5,
    tvl: "1000",
    tvlRaw: 1000n * 10n ** 18n,
    sharePrice: 10n ** 18n,
    timestamp: 1700000000,
    assetDecimals: 18,
    assetSymbol: "ETH",
  };

  const benchmarks: BenchmarkRates = { stethApr: 3.1, timestamp: Date.now() };

  it("returns fired=true when expression matches current data", () => {
    const result = dryRunRule("apr < 3.0", "APR is {{apr}}%", current, undefined, benchmarks);

    expect(result.fired).toBe(true);
    expect(result.scope.apr).toBe(2.5);
    expect(result.renderedMessage).toContain("2.50");
  });

  it("returns fired=false when expression does not match", () => {
    const result = dryRunRule("apr > 5.0", "APR is {{apr}}%", current, undefined, benchmarks);

    expect(result.fired).toBe(false);
    expect(result.scope.apr).toBe(2.5);
  });

  it("includes previous snapshot values when provided", () => {
    const previous: VaultSnapshot = {
      ...current,
      apr: 3.0,
      tvl: "900",
      tvlRaw: 900n * 10n ** 18n,
      timestamp: 1699900000,
    };

    const result = dryRunRule("apr_delta < -0.1", "APR changed by {{apr_delta}}pp", current, previous, benchmarks);

    expect(result.fired).toBe(true);
    expect(result.scope.apr_delta).toBeCloseTo(-0.5);
  });

  it("renders message template with scope values", () => {
    const result = dryRunRule("apr < 3.0", "APR dropped to {{apr}}%, stETH at {{steth_apr}}%", current, undefined, benchmarks);

    expect(result.renderedMessage).toContain("2.50");
    expect(result.renderedMessage).toContain("3.10");
  });
});
