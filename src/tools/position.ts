import { z } from "zod";
import { formatEther, type Address } from "viem";
import { sdk, publicClient, getAccountAddress } from "../sdk-factory.js";
import { formatPercent, textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const positionToolDef = {
  name: "lido_analyze_position",
  description:
    "Analyze a Lido staking position against optional bounds. " +
    "Returns balances, APR, pending rewards, withdrawal status, and actionable recommendations. " +
    "Use this for autonomous position monitoring — set bounds like min_apr, max_position_eth, " +
    "or min_position_eth and the tool will flag when action is needed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address. Defaults to configured wallet.",
      },
      min_apr: {
        type: "number",
        description: "Minimum acceptable APR (e.g. 3.0 for 3%). If current APR is below this, recommends unstaking.",
      },
      max_position_eth: {
        type: "number",
        description: "Maximum total staked value in ETH. If position exceeds this, recommends partial withdrawal.",
      },
      min_position_eth: {
        type: "number",
        description: "Minimum target position in ETH. If position is below this and wallet has ETH, recommends staking more.",
      },
      check_claimable: {
        type: "boolean",
        description: "Also check for claimable withdrawals (slightly slower). Default: true.",
      },
    },
  },
  annotations: {
    title: "Analyze Staking Position",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const schema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  min_apr: z.number().min(0).optional(),
  max_position_eth: z.number().min(0).optional(),
  min_position_eth: z.number().min(0).optional(),
  check_claimable: z.boolean().optional().default(true),
}).refine(
  (d) => d.min_position_eth === undefined || d.max_position_eth === undefined || d.min_position_eth <= d.max_position_eth,
  { message: "min_position_eth must be <= max_position_eth" },
);

export async function handleAnalyzePosition(args: Record<string, unknown>) {
  try {
    const { address: rawAddr, min_apr, max_position_eth, min_position_eth, check_claimable } =
      schema.parse(args);
    const address = (rawAddr ?? getAccountAddress()) as Address;

    const [ethBalance, stethBalance, wstethBalance, lastApr, smaApr] = await Promise.all([
      publicClient.getBalance({ address }),
      sdk.steth.balance(address),
      sdk.wsteth.balance(address),
      sdk.statistics.apr.getLastApr(),
      sdk.statistics.apr.getSmaApr({ days: 7 }),
    ]);

    let wstethInSteth = 0n;
    if (wstethBalance > 0n) {
      wstethInSteth = await sdk.wrap.convertWstethToSteth(wstethBalance);
    }

    const totalStakedWei = stethBalance + wstethInSteth;
    const totalStakedEth = Number(formatEther(totalStakedWei));
    const ethBalanceNum = Number(formatEther(ethBalance));

    let claimableEth = 0n;
    let pendingRequests = 0;
    let claimableRequests = 0;
    let withdrawalInfoAvailable = true;
    if (check_claimable) {
      try {
        const info = await sdk.withdraw.requestsInfo.getWithdrawalRequestsInfo({
          account: address,
        });
        claimableEth = info.claimableETH.ethSum;
        pendingRequests = info.pendingInfo.pendingRequests.length;
        claimableRequests = info.claimableInfo.claimableRequests.filter(r => !r.isClaimed).length;
      } catch {
        withdrawalInfoAvailable = false;
      }
    }

    const lines = [
      `=== Position Analysis for ${address} ===`,
      "",
      "Balances:",
      `  ETH (unstaked):  ${formatEther(ethBalance)}`,
      `  stETH:           ${formatEther(stethBalance)}`,
      `  wstETH:          ${formatEther(wstethBalance)}`,
      `  wstETH (as stETH): ${formatEther(wstethInSteth)}`,
      `  Total staked:    ${totalStakedEth.toFixed(6)} ETH equivalent`,
      "",
      "Yield:",
      `  Current APR: ${formatPercent(lastApr)}`,
      `  7-day SMA APR: ${formatPercent(smaApr)}`,
    ];

    if (check_claimable) {
      if (withdrawalInfoAvailable) {
        lines.push(
          "",
          "Withdrawals:",
          `  Pending requests: ${pendingRequests}`,
          `  Claimable requests: ${claimableRequests}`,
          `  Claimable ETH: ${formatEther(claimableEth)}`,
        );
      } else {
        lines.push(
          "",
          "Withdrawals:",
          "  ⚠ Could not fetch withdrawal data — info may be temporarily unavailable.",
        );
      }
    }

    // Generate recommendations
    const recommendations: string[] = [];

    if (min_apr !== undefined && lastApr < min_apr) {
      recommendations.push(
        `⚠ APR is ${formatPercent(lastApr)} — below your minimum of ${formatPercent(min_apr)}. ` +
        `Consider withdrawing or waiting for APR recovery. Check 7-day SMA (${formatPercent(smaApr)}) for trend.`,
      );
    }

    if (max_position_eth !== undefined && totalStakedEth > max_position_eth) {
      const excess = totalStakedEth - max_position_eth;
      recommendations.push(
        `⚠ Position (${totalStakedEth.toFixed(4)} ETH) exceeds your max of ${max_position_eth} ETH. ` +
        `Consider withdrawing ~${excess.toFixed(4)} ETH to rebalance.`,
      );
    }

    if (min_position_eth !== undefined && totalStakedEth < min_position_eth && ethBalanceNum > 0.01) {
      const deficit = min_position_eth - totalStakedEth;
      const canStake = Math.min(deficit, ethBalanceNum - 0.01); // leave 0.01 for gas
      if (canStake > 0.001) {
        recommendations.push(
          `⚠ Position (${totalStakedEth.toFixed(4)} ETH) is below your min of ${min_position_eth} ETH. ` +
          `Wallet has ${ethBalanceNum.toFixed(4)} ETH available. Consider staking ~${canStake.toFixed(4)} ETH.`,
        );
      }
    }

    if (claimableRequests > 0) {
      recommendations.push(
        `✓ ${claimableRequests} withdrawal request(s) ready to claim (${formatEther(claimableEth)} ETH). ` +
        `Use lido_claim_withdrawal to collect.`,
      );
    }

    if (recommendations.length > 0) {
      lines.push("", "Recommendations:");
      for (const rec of recommendations) {
        lines.push(`  ${rec}`);
      }
    } else {
      lines.push("", "Status: ✓ Position is within bounds. No action needed.");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
