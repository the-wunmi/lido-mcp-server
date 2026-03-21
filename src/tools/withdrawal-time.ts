import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { sdk, getAccountAddress } from "../sdk-factory.js";
import { textResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const estimateWithdrawalTimeToolDef = {
  name: "lido_estimate_withdrawal_time",
  description:
    "Estimate how long a withdrawal will take to finalize. " +
    "Can estimate for a new withdrawal amount, or check existing pending request IDs. " +
    "Also shows current queue depth, mode, and unfinalized stETH.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description:
          "Amount of stETH to withdraw (e.g. '10.0'). " +
          "Used to estimate wait time for a hypothetical new withdrawal request.",
      },
      request_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Existing withdrawal request IDs to check. " +
          "If provided, returns per-request finalization estimates.",
      },
      address: {
        type: "string",
        description:
          "Ethereum address to check pending requests for. " +
          "If neither amount nor request_ids are provided, checks all pending requests for this address.",
      },
    },
  },
  annotations: {
    title: "Estimate Withdrawal Time",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const schema = z.object({
  amount: ethAmountSchema.optional(),
  request_ids: z.array(z.string().regex(/^\d+$/, "Request ID must be a numeric string")).optional(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

const CALCULATION_TYPE_LABELS: Record<string, string> = {
  buffer: "using protocol buffer (fast — ETH available in buffer)",
  bunker: "bunker mode (slower — protocol is in protective mode)",
  vaultsBalance: "using vault balances",
  rewardsOnly: "waiting for staking rewards to cover the amount",
  validatorBalances: "waiting for validator exits",
  requestTimestampMargin: "based on request queue position",
  exitValidators: "requires validator exits (slowest — large withdrawal)",
};

export async function handleEstimateWithdrawalTime(args: Record<string, unknown>) {
  try {
    const { amount, request_ids, address: rawAddr } = schema.parse(args);

    // Gather queue state in parallel
    const [unfinalizedStETH, isPaused, isBunker, isTurbo] = await Promise.all([
      sdk.withdraw.views.getUnfinalizedStETH(),
      sdk.withdraw.views.isPaused(),
      sdk.withdraw.views.isBunkerModeActive(),
      sdk.withdraw.views.isTurboModeActive(),
    ]);

    let queueMode = "Normal";
    if (isPaused) queueMode = "PAUSED";
    else if (isBunker) queueMode = "Bunker";
    else if (isTurbo) queueMode = "Turbo";

    const lines = [
      "=== Withdrawal Time Estimate ===",
      "",
      "Queue Status:",
      `  Mode: ${queueMode}`,
      `  Unfinalized stETH in queue: ${formatEther(unfinalizedStETH)} stETH`,
    ];

    if (isPaused) {
      lines.push(
        "",
        "⚠ Withdrawals are currently PAUSED. No new requests can be submitted",
        "  and existing requests will not finalize until the protocol resumes.",
      );
      return textResult(lines.join("\n"));
    }

    if (isBunker) {
      lines.push(
        "",
        "⚠ Queue is in BUNKER mode. Finalization may be slower than normal.",
        "  This typically happens during adverse network conditions.",
      );
    }

    // Estimate by amount
    if (amount) {
      const amountWei = parseEther(amount);
      lines.push("", `Estimate for withdrawing ${amount} stETH:`);

      try {
        const estimate = await sdk.withdraw.waitingTime.getWithdrawalWaitingTimeByAmount({
          amount: amountWei,
        });

        const { requestInfo, status } = estimate;
        const typeLabel = CALCULATION_TYPE_LABELS[requestInfo.type] ?? requestInfo.type;

        if (status === "finalized") {
          lines.push(`  Status: Would finalize immediately (${typeLabel})`);
        } else {
          const hours = requestInfo.finalizationIn;
          const days = (hours / 24).toFixed(1);
          lines.push(
            `  Estimated wait: ~${hours} hours (~${days} days)`,
            `  Expected finalization: ${requestInfo.finalizationAt}`,
            `  Calculation method: ${typeLabel}`,
          );
        }
      } catch {
        lines.push("  Could not estimate — the withdrawal time API may be unavailable.");
      }
    }

    // Estimate by request IDs
    if (request_ids && request_ids.length > 0) {
      const ids = request_ids.map((id) => BigInt(id));
      lines.push("", "Per-request estimates:");

      try {
        const estimates = await sdk.withdraw.waitingTime.getWithdrawalWaitingTimeByRequestIds({
          ids,
        });

        for (const est of estimates) {
          const { requestInfo, status } = est;
          const reqId = requestInfo.requestId ?? "unknown";
          const typeLabel = CALCULATION_TYPE_LABELS[requestInfo.type] ?? requestInfo.type;

          if (status === "finalized") {
            lines.push(`  Request #${reqId}: FINALIZED — ready to claim`);
          } else {
            const hours = requestInfo.finalizationIn;
            const days = (hours / 24).toFixed(1);
            lines.push(
              `  Request #${reqId}: ~${hours}h (~${days}d) — ${typeLabel}`,
              `    Expected: ${requestInfo.finalizationAt}`,
            );
          }
        }
      } catch {
        lines.push("  Could not estimate — the withdrawal time API may be unavailable.");
      }
    }

    // If neither amount nor request_ids, check all pending for address
    if (!amount && (!request_ids || request_ids.length === 0)) {
      const address = (rawAddr ?? getAccountAddress()) as Address;
      lines.push("", `Checking pending requests for ${address}...`);

      try {
        const pendingInfo = await sdk.withdraw.requestsInfo.getPendingRequestsInfo({
          account: address,
        });

        if (pendingInfo.pendingRequests.length === 0) {
          lines.push("  No pending withdrawal requests found.");
        } else {
          lines.push(`  Found ${pendingInfo.pendingRequests.length} pending request(s):`);
          lines.push(`  Total pending: ${formatEther(pendingInfo.pendingAmountStETH)} stETH`);

          const ids = pendingInfo.pendingRequests.map((r) => r.id);
          try {
            const estimates = await sdk.withdraw.waitingTime.getWithdrawalWaitingTimeByRequestIds({
              ids,
            });

            for (const est of estimates) {
              const { requestInfo, status } = est;
              const reqId = requestInfo.requestId ?? "unknown";
              const typeLabel = CALCULATION_TYPE_LABELS[requestInfo.type] ?? requestInfo.type;

              if (status === "finalized") {
                lines.push(`  Request #${reqId}: FINALIZED — ready to claim`);
              } else {
                const hours = requestInfo.finalizationIn;
                const days = (hours / 24).toFixed(1);
                lines.push(`  Request #${reqId}: ~${hours}h (~${days}d) — ${typeLabel}`);
              }
            }
          } catch {
            // Fallback: show request details without time estimates
            for (const req of pendingInfo.pendingRequests) {
              const age = Date.now() / 1000 - Number(req.timestamp);
              const ageHours = (age / 3600).toFixed(1);
              lines.push(
                `  Request #${req.stringId}: ${formatEther(req.amountOfStETH)} stETH (pending for ${ageHours}h)`,
              );
            }
          }
        }
      } catch (err) {
        lines.push("  Could not fetch pending requests.");
      }
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
