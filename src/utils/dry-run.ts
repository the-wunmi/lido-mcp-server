import { formatEther } from "viem";
import { publicClient } from "../sdk-factory.js";
import { sanitizeErrorMessage } from "./errors.js";
import type { DryRunResult } from "../types.js";

interface PopulatedTx {
  to: `0x${string}`;
  from: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
}

export async function performDryRun(
  populateFn: () => Promise<PopulatedTx>,
  simulateFn?: () => Promise<unknown>,
  estimateGasFn?: () => Promise<bigint>,
): Promise<DryRunResult> {
  const populated = await populateFn();

  let simulation: { success: boolean; error?: string };
  if (simulateFn) {
    try {
      await simulateFn();
      simulation = { success: true };
    } catch (err) {
      simulation = {
        success: false,
        error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
      };
    }
  } else {
    simulation = { success: false, error: "simulation skipped (not available for this operation)" };
  }

  let gasEstimate: bigint | null;
  if (estimateGasFn) {
    try {
      gasEstimate = await estimateGasFn();
    } catch {
      gasEstimate = populated.gas ?? null;
    }
  } else {
    gasEstimate = populated.gas ?? null;
  }

  const gasPrice = await publicClient.getGasPrice();
  const gasCostWei = gasEstimate !== null ? gasEstimate * gasPrice : null;

  return {
    populated_tx: {
      to: populated.to,
      from: populated.from,
      value: (populated.value ?? 0n).toString(),
      data: populated.data ?? "0x",
    },
    gas_estimate: gasEstimate !== null ? gasEstimate.toString() : "unknown",
    gas_cost_eth: gasCostWei !== null ? formatEther(gasCostWei) : "unknown",
    simulation,
  };
}

export function formatDryRunResult(result: DryRunResult): string {
  const lines = [
    "=== DRY RUN RESULT (no transaction sent) ===",
    "",
    `To: ${result.populated_tx.to}`,
    `From: ${result.populated_tx.from}`,
    `Value: ${formatEther(BigInt(result.populated_tx.value))} ETH`,
    `Data: ${result.populated_tx.data.length > 66 ? result.populated_tx.data.slice(0, 66) + "..." : result.populated_tx.data}`,
    "",
    `Gas estimate: ${result.gas_estimate}`,
    `Estimated gas cost: ${result.gas_cost_eth} ETH`,
    "",
    `Simulation: ${result.simulation.success ? "SUCCESS" : "FAILED"}`,
  ];

  if (result.simulation.error && !result.simulation.success) {
    lines.push(`Simulation note: ${result.simulation.error}`);
  }

  lines.push("", "Note: Gas estimates and simulation results reflect conditions at the time of this dry run. They may differ at execution time.");

  return lines.join("\n");
}
