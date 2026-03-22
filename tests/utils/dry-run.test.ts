import { describe, it, expect, vi } from "vitest";
import { performDryRun, formatDryRunResult } from "../../src/utils/dry-run.js";
import { publicClient } from "../../src/sdk-factory.js";
import type { DryRunResult } from "../../src/types.js";

const MOCK_TX = {
  to: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84" as `0x${string}`,
  from: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
  data: "0xa1903eab" as `0x${string}`,
  value: 1_000_000_000_000_000_000n,
  gas: 100_000n,
};

describe("dry-run utilities", () => {
  describe("performDryRun", () => {
    it("returns a complete dry-run result with all functions provided", async () => {
      const populateFn = vi.fn().mockResolvedValue(MOCK_TX);
      const simulateFn = vi.fn().mockResolvedValue(undefined);
      const estimateGasFn = vi.fn().mockResolvedValue(150_000n);

      const result = await performDryRun(populateFn, simulateFn, estimateGasFn);

      expect(populateFn).toHaveBeenCalledOnce();
      expect(simulateFn).toHaveBeenCalledOnce();
      expect(estimateGasFn).toHaveBeenCalledOnce();

      expect(result.populated_tx.to).toBe(MOCK_TX.to);
      expect(result.populated_tx.from).toBe(MOCK_TX.from);
      expect(result.populated_tx.value).toBe("1000000000000000000");
      expect(result.populated_tx.data).toBe("0xa1903eab");

      expect(result.simulation.success).toBe(true);
      expect(result.simulation.error).toBeUndefined();

      expect(result.gas_estimate).toBe("150000");
      expect(result.gas_cost_eth).toBe("0.003");
    });

    it("marks simulation as skipped when simulateFn is not provided", async () => {
      const populateFn = vi.fn().mockResolvedValue(MOCK_TX);

      const result = await performDryRun(populateFn);

      expect(result.simulation.success).toBe(false);
      expect(result.simulation.error).toBe(
        "simulation skipped (not available for this operation)",
      );
    });

    it("captures simulation failure with sanitized error message", async () => {
      const populateFn = vi.fn().mockResolvedValue(MOCK_TX);
      const simulateFn = vi
        .fn()
        .mockRejectedValue(new Error("revert at https://rpc.example.com/key"));

      const result = await performDryRun(populateFn, simulateFn);

      expect(result.simulation.success).toBe(false);
      expect(result.simulation.error).toContain("[REDACTED_URL]");
      expect(result.simulation.error).not.toContain("rpc.example.com");
    });

    it("captures simulation failure with non-Error thrown value", async () => {
      const populateFn = vi.fn().mockResolvedValue(MOCK_TX);
      const simulateFn = vi.fn().mockRejectedValue("string error");

      const result = await performDryRun(populateFn, simulateFn);

      expect(result.simulation.success).toBe(false);
      expect(result.simulation.error).toBe("string error");
    });

    it("falls back to populated tx gas when estimateGasFn is not provided", async () => {
      const populateFn = vi.fn().mockResolvedValue(MOCK_TX);

      const result = await performDryRun(populateFn);

      expect(result.gas_estimate).toBe("100000");
    });

    it("falls back to populated tx gas when estimateGasFn throws", async () => {
      const populateFn = vi.fn().mockResolvedValue(MOCK_TX);
      const estimateGasFn = vi.fn().mockRejectedValue(new Error("estimation failed"));

      const result = await performDryRun(populateFn, undefined, estimateGasFn);

      expect(result.gas_estimate).toBe("100000");
    });

    it("returns 'unknown' gas when no estimateGasFn and no gas on tx", async () => {
      const txNoGas = { ...MOCK_TX, gas: undefined };
      const populateFn = vi.fn().mockResolvedValue(txNoGas);

      const result = await performDryRun(populateFn);

      expect(result.gas_estimate).toBe("unknown");
      expect(result.gas_cost_eth).toBe("unknown");
    });

    it("returns 'unknown' gas when estimateGasFn throws and tx has no gas", async () => {
      const txNoGas = { ...MOCK_TX, gas: undefined };
      const populateFn = vi.fn().mockResolvedValue(txNoGas);
      const estimateGasFn = vi.fn().mockRejectedValue(new Error("fail"));

      const result = await performDryRun(populateFn, undefined, estimateGasFn);

      expect(result.gas_estimate).toBe("unknown");
      expect(result.gas_cost_eth).toBe("unknown");
    });

    it("handles tx with no value and no data", async () => {
      const minimalTx = {
        to: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84" as `0x${string}`,
        from: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
      };
      const populateFn = vi.fn().mockResolvedValue(minimalTx);

      const result = await performDryRun(populateFn);

      expect(result.populated_tx.value).toBe("0");
      expect(result.populated_tx.data).toBe("0x");
    });

    it("calls publicClient.getGasPrice for cost calculation", async () => {
      const populateFn = vi.fn().mockResolvedValue(MOCK_TX);

      await performDryRun(populateFn);

      expect(publicClient.getGasPrice).toHaveBeenCalled();
    });
  });

  describe("formatDryRunResult", () => {
    const baseResult: DryRunResult = {
      populated_tx: {
        to: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
        from: "0x1234567890abcdef1234567890abcdef12345678",
        value: "1000000000000000000",
        data: "0xa1903eab",
      },
      gas_estimate: "150000",
      gas_cost_eth: "0.003",
      simulation: { success: true },
    };

    it("formats a successful dry-run result", () => {
      const output = formatDryRunResult(baseResult);

      expect(output).toContain("DRY RUN RESULT");
      expect(output).toContain("no transaction sent");
      expect(output).toContain("To: 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
      expect(output).toContain("From: 0x1234567890abcdef1234567890abcdef12345678");
      expect(output).toContain("Value: 1 ETH");
      expect(output).toContain("Data: 0xa1903eab");
      expect(output).toContain("Gas estimate: 150000");
      expect(output).toContain("Estimated gas cost: 0.003 ETH");
      expect(output).toContain("Simulation: SUCCESS");
      expect(output).not.toContain("Simulation note:");
    });

    it("shows simulation note when simulation failed", () => {
      const failedResult: DryRunResult = {
        ...baseResult,
        simulation: { success: false, error: "execution reverted" },
      };
      const output = formatDryRunResult(failedResult);

      expect(output).toContain("Simulation: FAILED");
      expect(output).toContain("Simulation note: execution reverted");
    });

    it("does not show simulation note when simulation succeeded (even if error is set)", () => {
      const weirdResult: DryRunResult = {
        ...baseResult,
        simulation: { success: true, error: "this should not appear" },
      };
      const output = formatDryRunResult(weirdResult);

      expect(output).toContain("Simulation: SUCCESS");
      expect(output).not.toContain("Simulation note:");
    });

    it("truncates long data fields", () => {
      const longData = "0x" + "ab".repeat(100);
      const result: DryRunResult = {
        ...baseResult,
        populated_tx: { ...baseResult.populated_tx, data: longData },
      };
      const output = formatDryRunResult(result);

      expect(output).toContain("...");
      expect(output).toContain(longData.slice(0, 66) + "...");
    });

    it("does not truncate short data fields", () => {
      const shortData = "0xa1903eab";
      const result: DryRunResult = {
        ...baseResult,
        populated_tx: { ...baseResult.populated_tx, data: shortData },
      };
      const output = formatDryRunResult(result);

      expect(output).toContain(`Data: ${shortData}`);
      expect(output).not.toMatch(new RegExp(`Data: ${shortData}\\.\\.\\.`));
    });

    it("formats zero-value transactions", () => {
      const result: DryRunResult = {
        ...baseResult,
        populated_tx: { ...baseResult.populated_tx, value: "0" },
      };
      const output = formatDryRunResult(result);

      expect(output).toContain("Value: 0 ETH");
    });

    it("includes gas estimate caveat note at the end", () => {
      const output = formatDryRunResult(baseResult);

      expect(output).toContain(
        "Gas estimates and simulation results reflect conditions at the time of this dry run",
      );
    });
  });
});
