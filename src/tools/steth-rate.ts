import { formatEther, parseEther } from "viem";
import { sdk } from "../sdk-factory.js";
import { textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const stethRateToolDef = {
  name: "lido_check_steth_rate",
  description:
    "Check the current stETH protocol rate (share rate) and pool composition. " +
    "Shows how much ETH backs each stETH, the total pooled ETH, total shares, " +
    "and the wstETH conversion rate. Use this to understand the true value of stETH " +
    "and whether buying stETH on a DEX might be cheaper than staking directly.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "Check stETH Rate",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleCheckStethRate(_args: Record<string, unknown>) {
  try {
    const [shareRate, totalSupply, wstethPerSteth, stethPerWsteth] = await Promise.all([
      sdk.shares.getShareRate(),
      sdk.shares.getTotalSupply(),
      sdk.wrap.convertStethToWsteth(parseEther("1")),
      sdk.wrap.convertWstethToSteth(parseEther("1")),
    ]);

    const totalPooledEth = formatEther(totalSupply.totalEther);
    const totalShares = formatEther(totalSupply.totalShares);

    if (totalSupply.totalShares === 0n) {
      return textResult("stETH pool has zero shares — the protocol may not be initialized on this network.");
    }

    // Protocol rate: how much ETH 1 share is worth
    // If stETH is trading at a discount on DEXes, buying is cheaper than staking
    // If at premium, staking directly is better
    // Compute in BigInt with 18-decimal precision, then convert once to avoid double Number conversion
    const protocolRate = Number(totalSupply.totalEther * 10n**18n / totalSupply.totalShares) / 1e18;

    // stETH is pegged 1:1 with ETH at the protocol level, but the share rate drifts up
    // as rewards accrue. The "fair value" of 1 stETH is always 1 ETH at protocol level.
    // Any deviation on DEXes represents a discount or premium.

    const lines = [
      "=== stETH Protocol Rate ===",
      "",
      "Share Rate:",
      `  1 share = ${shareRate.toFixed(8)} stETH`,
      `  Protocol rate: ${protocolRate.toFixed(8)} ETH per share`,
      "",
      "Pool Composition:",
      `  Total pooled ETH: ${totalPooledEth} ETH`,
      `  Total shares: ${totalShares}`,
      "",
      "Conversion Rates:",
      `  1 stETH → ${formatEther(wstethPerSteth)} wstETH`,
      `  1 wstETH → ${formatEther(stethPerWsteth)} stETH`,
      "",
      "What This Means:",
      `  At the protocol level, 1 stETH = 1 ETH (redeemable via withdrawal).`,
      `  The share rate (${shareRate.toFixed(4)}) reflects accumulated rewards since inception.`,
      `  If stETH trades below 1.0 ETH on a DEX, buying stETH on the DEX`,
      `  is cheaper than staking — you get the same staking rewards but at a discount.`,
      `  If stETH trades above 1.0 ETH, staking directly is more economical.`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
