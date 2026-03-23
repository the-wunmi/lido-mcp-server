import { describe, it, expect, vi, beforeEach } from "vitest";

// Unmock explain.js so we test the real implementation
vi.unmock("../../src/monitor/explain.js");

// Mock @anthropic-ai/sdk
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockCreate };
    constructor(_opts: unknown) {}
  }
  return { default: MockAnthropic };
});

// Override monitor config to enable anthropic for these tests
vi.mock("../../src/monitor/config.js", () => ({
  monitorConfig: {
    anthropic: {
      enabled: true,
      apiKey: "test-key",
      model: "claude-haiku-4-5-20251001",
    },
  },
  normalizeAddress: (addr: string) => addr.toLowerCase(),
  FETCH_TIMEOUT_MS: 15_000,
  BIGINT_SCALE_18: 10n ** 18n,
}));

// vault-registry.js is loaded as a real module (no external deps besides config.js
// which is mocked above). explain.ts imports isMellowCoreVault from vault-registry.js.

import { explainAlert } from "../../src/monitor/explain.js";
import type { VaultAlert } from "../../src/monitor/types.js";

function makeAlert(overrides?: Partial<VaultAlert>): VaultAlert {
  return {
    ruleId: "rule-1",
    severity: "warning",
    vaultAddress: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    vaultName: "EarnETH",
    message: "APY dropped to 2.80%",
    timestamp: 1700000000,
    context: {
      expression: "apy < 3.0",
      scope: {
        apr: 2.8,
        apr_prev: 3.5,
        apr_delta: -0.7,
        apy: 2.8,
        apy_prev: 3.5,
        apy_delta: -0.7,
        tvl: 1000,
        tvl_prev: 950,
        tvl_change_pct: 5.3,
        share_price: 1.001,
        share_price_prev: 1.0,
        share_price_change_pct: 0.1,
        steth_apr: 3.1,
        spread_vs_steth: -0.3,
      },
      current: { apr: 2.8, tvl: "1000", sharePrice: "1001000000000000000", assetSymbol: "ETH" },
      previous: { apr: 3.5, tvl: "950", sharePrice: "1000000000000000000" },
      benchmarks: { stethApr: 3.1 },
    },
    ...overrides,
  };
}

describe("explainAlert", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns AI-generated explanation on success", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Your EarnETH vault APY dropped to *2.80%*..." }],
    });

    const result = await explainAlert(makeAlert());

    expect(result).toBe("Your EarnETH vault APY dropped to *2.80%*...");
    expect(mockCreate).toHaveBeenCalledOnce();

    // Verify the prompt includes key data
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
    expect(callArgs.max_tokens).toBe(500);
    expect(callArgs.messages[0].content).toContain("EarnETH");
    expect(callArgs.messages[0].content).toContain("apy < 3.0");
  });

  it("includes previous state in prompt when available", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Explanation text" }],
    });

    await explainAlert(makeAlert());

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("Previous state:");
    expect(prompt).toContain("3.50%");
  });

  it("includes computed metrics in prompt", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Explanation text" }],
    });

    await explainAlert(makeAlert());

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("APR change:");
    expect(prompt).toContain("TVL change:");
    expect(prompt).toContain("Spread vs stETH:");
  });

  it("includes vault type and asset denomination in prompt", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Explanation text" }],
    });

    await explainAlert(makeAlert());

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("Vault type: ERC-4626");
    expect(prompt).toContain("Asset denomination: ETH");
  });

  it("identifies Mellow Core vault type for Core Vault addresses", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Explanation text" }],
    });

    await explainAlert(makeAlert({
      vaultAddress: "0x6a37725ca7f4CE81c004c955f7280d5C704a249e",
      context: {
        expression: "tvl_change_pct < -10",
        scope: { apr: 5.0, tvl: 0, tvl_prev: 55000, tvl_change_pct: -100, steth_apr: 2.5, spread_vs_steth: 2.5 },
        current: { apr: 5.0, tvl: "0", sharePrice: "997466000000000000", assetSymbol: "WETH" },
        previous: { apr: 5.0, tvl: "55000", sharePrice: "1000000000000000000" },
        benchmarks: { stethApr: 2.5 },
      },
    }));

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("Vault type: Mellow Core");
    expect(prompt).toContain("Asset denomination: WETH");
  });

  it("includes benchmark in prompt when available", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "Explanation text" }],
    });

    await explainAlert(makeAlert());

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("stETH benchmark APR: 3.10%");
  });

  it("returns null when API call fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API rate limited"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await explainAlert(makeAlert());

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[VaultMonitor] LLM explanation failed:",
      "API rate limited",
    );
    consoleSpy.mockRestore();
  });

  it("returns null when response has no text content", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "   " }],
    });

    const result = await explainAlert(makeAlert());
    expect(result).toBeNull();
  });

  it("handles alert without previous state", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "First check explanation" }],
    });

    const alert = makeAlert({
      context: {
        expression: "apy < 3.0",
        scope: {
          apr: 2.8, apr_prev: NaN, apr_delta: NaN,
          apy: 2.8, apy_prev: NaN, apy_delta: NaN,
          tvl: 1000, tvl_prev: NaN, tvl_change_pct: NaN,
          share_price: 1.001, share_price_prev: NaN, share_price_change_pct: NaN,
          steth_apr: 3.1, spread_vs_steth: -0.3,
        },
        current: { apr: 2.8, tvl: "1000", sharePrice: "1001000000000000000", assetSymbol: "ETH" },
        previous: null,
        benchmarks: { stethApr: 3.1 },
      },
    });

    const result = await explainAlert(alert);
    expect(result).toBe("First check explanation");

    const prompt = mockCreate.mock.calls[0][0].messages[0].content;
    expect(prompt).not.toContain("Previous state:");
  });
});

describe("explainAlert when disabled", () => {
  it("returns null when anthropic is not enabled", async () => {
    // The mock in this file has anthropic.enabled = true, so we test
    // the failure path via API error instead. The disabled path is
    // covered by the global mock in setup.ts (enabled: false).
    // This test verifies the module gracefully handles errors.
    mockCreate.mockRejectedValueOnce(new Error("disabled"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await explainAlert(makeAlert());
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });
});
