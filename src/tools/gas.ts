import { z } from "zod";
import { formatEther, formatUnits, parseEther } from "viem";
import { publicClient, sdk } from "../sdk-factory.js";
import { textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const gasToolDef = {
  name: "lido_check_gas_conditions",
  description:
    "Check current gas conditions and estimate costs for common Lido operations. " +
    "Shows current gas price with context, estimated costs for staking, wrapping, " +
    "and withdrawals, and advises whether now is a good time to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      stake_amount: {
        type: "string",
        description: "ETH amount to estimate staking gas for (default: '1.0').",
      },
    },
  },
  annotations: {
    title: "Check Gas Conditions",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

// Typical gas units for Lido operations (conservative estimates)
const GAS_ESTIMATES = {
  stake: 100_000n,
  wrapSteth: 120_000n,
  wrapEth: 180_000n,
  unwrap: 100_000n,
  requestWithdrawal: 300_000n,
  claimWithdrawal: 200_000n,
} as const;

const schema = z.object({
  stake_amount: z
    .string()
    .regex(/^\d+\.?\d*$/, "Amount must be a positive decimal number")
    .optional()
    .default("1.0"),
});

export async function handleCheckGasConditions(args: Record<string, unknown>) {
  try {
    const { stake_amount: stakeAmount } = schema.parse(args);

    const gasPrice = await publicClient.getGasPrice();
    const gasPriceGwei = Number(formatUnits(gasPrice, 9));

    // Try to get a more accurate stake gas estimate
    let stakeGas: bigint = GAS_ESTIMATES.stake;
    let gasEstimateNote = "";
    try {
      const amountWei = parseEther(stakeAmount);
      stakeGas = await sdk.stake.stakeEthEstimateGas({ value: amountWei });
    } catch {
      gasEstimateNote = "(using conservative estimate — live gas estimation failed)";
    }

    // Calculate costs for each operation
    const operations = [
      { name: "Stake ETH → stETH", gas: stakeGas },
      { name: "Wrap stETH → wstETH", gas: GAS_ESTIMATES.wrapSteth },
      { name: "Stake+Wrap ETH → wstETH", gas: GAS_ESTIMATES.wrapEth },
      { name: "Unwrap wstETH → stETH", gas: GAS_ESTIMATES.unwrap },
      { name: "Request withdrawal", gas: GAS_ESTIMATES.requestWithdrawal },
      { name: "Claim withdrawal", gas: GAS_ESTIMATES.claimWithdrawal },
    ];

    // Gas price context
    let gasTier: string;
    let recommendation: string;
    if (gasPriceGwei < 10) {
      gasTier = "Very Low";
      recommendation = "Excellent time to execute transactions. Gas is well below average.";
    } else if (gasPriceGwei < 25) {
      gasTier = "Low";
      recommendation = "Good time to execute. Gas prices are reasonable.";
    } else if (gasPriceGwei < 50) {
      gasTier = "Moderate";
      recommendation = "Acceptable for most operations. Consider waiting if the transaction isn't urgent.";
    } else if (gasPriceGwei < 100) {
      gasTier = "High";
      recommendation = "Consider waiting for lower gas unless the transaction is time-sensitive.";
    } else {
      gasTier = "Very High";
      recommendation = "Gas is unusually high. Strongly recommend waiting unless urgent.";
    }

    const lines = [
      "=== Gas Conditions ===",
      "",
      `Current gas price: ${gasPriceGwei.toFixed(2)} Gwei (${gasTier})`,
      ...(gasEstimateNote ? [`Note: ${gasEstimateNote}`] : []),
      `Recommendation: ${recommendation}`,
      "",
      "Estimated costs at current gas price:",
    ];

    for (const op of operations) {
      const costWei = op.gas * gasPrice;
      const costEth = Number(formatEther(costWei));
      lines.push(`  ${op.name}: ${costEth.toFixed(6)} ETH (${Number(op.gas).toLocaleString()} gas)`);
    }

    // Add context about whether staking amount justifies gas
    const stakeCostWei = stakeGas * gasPrice;
    const stakeCostEth = Number(formatEther(stakeCostWei));
    const stakeAmountNum = parseFloat(stakeAmount);

    if (stakeAmountNum > 0) {
      try {
        const apr = await sdk.statistics.apr.getLastApr();

        lines.push(
          "",
          `Break-even analysis for staking ${stakeAmount} ETH:`,
          `  Gas cost: ${stakeCostEth.toFixed(6)} ETH`,
          `  Current APR: ${apr.toFixed(2)}%`,
        );

        if (apr <= 0) {
          lines.push(`  Break-even: unable to calculate (APR is currently 0%)`);
        } else {
          const annualYield = stakeAmountNum * (apr / 100);
          const dailyYield = annualYield / 365;
          const breakEvenDays = stakeCostEth / dailyYield;

          lines.push(
            `  Daily yield: ${dailyYield.toFixed(8)} ETH`,
            `  Days to recoup gas: ${breakEvenDays.toFixed(1)} days`,
          );

          if (breakEvenDays > 365) {
            lines.push(`  ⚠ Gas cost exceeds one year of staking rewards. Consider a larger stake amount.`);
          } else if (breakEvenDays > 30) {
            lines.push(`  ⚠ Takes over a month to recoup gas. Acceptable for long-term staking.`);
          } else {
            lines.push(`  ✓ Gas cost is reasonable relative to expected yield.`);
          }
        }
      } catch {
        // APR unavailable, skip break-even analysis
      }
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
