import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { sdk, publicClient, getAccountAddress } from "../sdk-factory.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { performDryRun, formatDryRunResult } from "../utils/dry-run.js";
import { validateReceiver, validateAmountCap } from "../utils/security.js";

export const requestWithdrawalToolDef = {
  name: "lido_request_withdrawal",
  description:
    "Request a withdrawal of stETH or wstETH from Lido. Creates a withdrawal NFT. " +
    "After requesting, the withdrawal enters a queue (typically 1-5 days) before it can be claimed. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount to withdraw (e.g. '1.0')",
      },
      token: {
        type: "string",
        enum: ["stETH", "wstETH"],
        description: "Token to withdraw. Default: 'stETH'.",
      },
      receiver: {
        type: "string",
        description: "Address to receive the ETH. Defaults to configured wallet.",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Request Withdrawal",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export const claimWithdrawalToolDef = {
  name: "lido_claim_withdrawal",
  description:
    "Claim finalized withdrawal requests to receive ETH. " +
    "Provide specific request IDs, or omit to claim all finalized requests for the configured wallet. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      request_ids: {
        type: "array",
        items: { type: "string" },
        description: "Specific request IDs to claim (as strings). If omitted, claims all finalized requests.",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
  },
  annotations: {
    title: "Claim Withdrawal",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const requestSchema = z.object({
  amount: ethAmountSchema,
  token: z.enum(["stETH", "wstETH"]).optional().default("stETH"),
  receiver: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  dry_run: z.boolean().optional().default(true),
});

const claimSchema = z.object({
  request_ids: z.array(z.string().regex(/^\d+$/, "Request ID must be a numeric string")).optional(),
  dry_run: z.boolean().optional().default(true),
});

export async function handleRequestWithdrawal(args: Record<string, unknown>) {
  try {
    const { amount, token, receiver, dry_run } = requestSchema.parse(args);
    const amountWei = parseEther(amount);

    if (receiver) {
      const receiverError = validateReceiver(receiver);
      if (receiverError) return errorResult(receiverError);
    }

    const capError = validateAmountCap(amountWei);
    if (capError) return errorResult(capError);

    const requestProps = {
      amount: amountWei,
      token,
      ...(receiver ? { receiver: receiver as Address } : {}),
    };

    const allowance = await sdk.withdraw.approval.getAllowance({ token });
    const needsApproval = allowance < amountWei;

    if (dry_run) {
      const requests = await sdk.withdraw.request.splitAmountToRequests({
        amount: amountWei,
        token,
      });

      let gasEstimate: bigint;
      let gasEstimateNote = "";
      try {
        gasEstimate = await sdk.withdraw.request.requestWithdrawalEstimateGas(requestProps);
      } catch {
        gasEstimate = 300_000n;
        gasEstimateNote = " (using conservative estimate — live gas estimation failed)";
      }

      let simulationOk = true;
      let simulationError: string | undefined;
      if (needsApproval) {
        simulationError = `Simulation skipped: ${token} approval required for WithdrawalQueue (will be handled automatically on execution)`;
      } else {
        try {
          await sdk.withdraw.request.requestWithdrawalSimulateTx(requestProps);
        } catch (err) {
          simulationOk = false;
          simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
        }
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      const lines = [
        "=== DRY RUN RESULT (no transaction sent) ===",
        "",
        `Withdrawal: ${amount} ${token}`,
        `Split into ${requests.length} request(s): ${requests.map(r => formatEther(r)).join(", ")} ${token}`,
        `From: ${getAccountAddress()}`,
        `Approval needed: ${needsApproval ? `YES (will approve ${token} for WithdrawalQueue before requesting)` : "No"}`,
        "",
        `Gas estimate: ${gasEstimate.toString()}${gasEstimateNote}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${needsApproval ? "SKIPPED (approval needed first)" : simulationOk ? "SUCCESS" : "FAILED"}`,
      ];

      if (simulationError) {
        lines.push(`Note: ${simulationError}`);
      }

      return textResult(lines.join("\n"));
    }

    if (needsApproval) {
      // +2 wei buffer for stETH share-rounding
      await sdk.withdraw.approval.approve({ token, amount: amountWei + 2n });
    }

    const result = await sdk.withdraw.request.requestWithdrawal(requestProps);

    const lines = [
      "=== Withdrawal Request Submitted ===",
      `Transaction hash: ${result.hash}`,
    ];

    if (result.result) {
      lines.push(`Request(s) created:`);
      for (const req of result.result.requests) {
        lines.push(`  - Request #${req.requestId}: ${formatEther(req.amountOfStETH)} stETH`);
      }
    }

    if (needsApproval) {
      lines.push(`${token} approval was granted automatically.`);
    }

    lines.push("");
    lines.push("The withdrawal is now in the queue. Use lido_get_withdrawal_requests to check status.");
    lines.push("Once finalized (typically 1-5 days), use lido_claim_withdrawal to receive ETH.");

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleClaimWithdrawal(args: Record<string, unknown>) {
  try {
    const { request_ids, dry_run } = claimSchema.parse(args);

    let requestsIds: bigint[];
    let hints: readonly bigint[];

    if (request_ids && request_ids.length > 0) {
      requestsIds = request_ids.map(id => BigInt(id));

      // Verify caller owns these request IDs before proceeding
      const callerRequests = await sdk.withdraw.requestsInfo.getClaimableRequestsETHByAccount({
        account: getAccountAddress(),
      });
      const ownedIds = new Set(callerRequests.sortedIds.map(id => id.toString()));
      const notOwned = requestsIds.filter(id => !ownedIds.has(id.toString()));
      if (notOwned.length > 0) {
        return errorResult(
          `Request ID(s) ${notOwned.join(", ")} are not claimable by your address (${getAccountAddress()}). ` +
          `They may belong to another address, not yet be finalized, or already be claimed.`
        );
      }

      const sortedIds = [...requestsIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      requestsIds = sortedIds;
      const lastIndex = await sdk.withdraw.views.getLastCheckpointIndex();
      hints = await sdk.withdraw.views.findCheckpointHints({
        sortedIds: sortedIds as bigint[],
        lastIndex,
      });
    } else {
      const claimableInfo = await sdk.withdraw.requestsInfo.getClaimableRequestsETHByAccount({
        account: getAccountAddress(),
      });

      if (claimableInfo.ethSum === 0n) {
        return textResult("No claimable withdrawal requests found. Requests may still be pending in the queue.");
      }

      requestsIds = [...claimableInfo.sortedIds] as bigint[];
      hints = claimableInfo.hints;
    }

    const claimProps = { requestsIds, hints };

    if (dry_run) {
      const result = await performDryRun(
        () => sdk.withdraw.claim.claimRequestsPopulateTx(claimProps),
        () => sdk.withdraw.claim.claimRequestsSimulateTx(claimProps),
        () => sdk.withdraw.claim.claimRequestsEstimateGas(claimProps),
      );

      return textResult(
        `Dry run for claiming ${requestsIds.length} withdrawal request(s):\n\n${formatDryRunResult(result)}`
      );
    }

    const result = await sdk.withdraw.claim.claimRequests(claimProps);

    const lines = [
      "=== Withdrawal Claimed ===",
      `Transaction hash: ${result.hash}`,
    ];

    if (result.result) {
      let totalEth = 0n;
      for (const claim of result.result.requests) {
        lines.push(`  Request #${claim.requestId}: ${formatEther(claim.amountOfETH)} ETH → ${claim.receiver}`);
        totalEth += claim.amountOfETH;
      }
      lines.push(`  Total ETH received: ${formatEther(totalEth)}`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
