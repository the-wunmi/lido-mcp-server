import { z } from "zod";
import { formatEther, type Address } from "viem";
import { sdk, getAccountAddress } from "../sdk-factory.js";
import { textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const withdrawalRequestsToolDef = {
  name: "lido_get_withdrawal_requests",
  description:
    "Get all withdrawal request NFTs and their status for an address. " +
    "Shows request ID, amount, finalization status, and claim status.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address. Defaults to configured wallet.",
      },
    },
  },
  annotations: {
    title: "Get Withdrawal Requests",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const claimableEthToolDef = {
  name: "lido_get_claimable_eth",
  description:
    "Get the total amount of ETH claimable from finalized withdrawal requests for an address.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address. Defaults to configured wallet.",
      },
    },
  },
  annotations: {
    title: "Get Claimable ETH",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const schema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function handleGetWithdrawalRequests(args: Record<string, unknown>) {
  try {
    const { address: rawAddr } = schema.parse(args);
    const address = (rawAddr ?? getAccountAddress()) as Address;

    const info = await sdk.withdraw.requestsInfo.getWithdrawalRequestsInfo({
      account: address,
    });

    const { claimableInfo, pendingInfo, claimableETH } = info;

    const lines = [
      `=== Withdrawal Requests for ${address} ===`,
      "",
    ];

    if (claimableInfo.claimableRequests.length > 0) {
      lines.push(`Claimable requests (${claimableInfo.claimableRequests.length}):`);
      lines.push(`  Total claimable stETH: ${formatEther(claimableInfo.claimableAmountStETH)}`);
      lines.push(`  Total claimable ETH: ${formatEther(claimableETH.ethSum)}`);
      for (const req of claimableInfo.claimableRequests) {
        lines.push(`  - Request #${req.id}: ${formatEther(req.amountOfStETH)} stETH (finalized, ${req.isClaimed ? "claimed" : "unclaimed"})`);
      }
      lines.push("");
    }

    if (pendingInfo.pendingRequests.length > 0) {
      lines.push(`Pending requests (${pendingInfo.pendingRequests.length}):`);
      lines.push(`  Total pending stETH: ${formatEther(pendingInfo.pendingAmountStETH)}`);
      for (const req of pendingInfo.pendingRequests) {
        lines.push(`  - Request #${req.id}: ${formatEther(req.amountOfStETH)} stETH (pending since ${new Date(Number(req.timestamp) * 1000).toISOString()})`);
      }
      lines.push("");
    }

    if (claimableInfo.claimableRequests.length === 0 && pendingInfo.pendingRequests.length === 0) {
      lines.push("No withdrawal requests found for this address.");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetClaimableEth(args: Record<string, unknown>) {
  try {
    const { address: rawAddr } = schema.parse(args);
    const address = (rawAddr ?? getAccountAddress()) as Address;

    const result = await sdk.withdraw.requestsInfo.getClaimableRequestsETHByAccount({
      account: address,
    });

    if (result.ethSum === 0n) {
      return textResult(`No claimable ETH for ${address}. Either no finalized requests exist or all have been claimed.`);
    }

    const lines = [
      `Claimable ETH for ${address}: ${formatEther(result.ethSum)} ETH`,
      "",
      "Breakdown by request:",
    ];

    for (let i = 0; i < result.requests.length; i++) {
      const req = result.requests[i];
      const eth = i < result.ethByRequests.length ? result.ethByRequests[i] : 0n;
      lines.push(`  Request #${req.id}: ${formatEther(eth)} ETH`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
