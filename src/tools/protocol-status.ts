import { formatEther } from "viem";
import { sdk } from "../sdk-factory.js";
import { textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const protocolStatusToolDef = {
  name: "lido_get_protocol_status",
  description:
    "Get the current Lido protocol status including stake limits, withdrawal queue mode " +
    "(paused/bunker/turbo), and min/max withdrawal amounts.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "Get Protocol Status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleGetProtocolStatus(_args: Record<string, unknown>) {
  try {
    const [
      stakeLimitInfo,
      isPaused,
      isBunker,
      isTurbo,
      minSteth,
      maxSteth,
      unfinalizedStETH,
      totalSupply,
    ] = await Promise.all([
      sdk.stake.getStakeLimitInfo(),
      sdk.withdraw.views.isPaused(),
      sdk.withdraw.views.isBunkerModeActive(),
      sdk.withdraw.views.isTurboModeActive(),
      sdk.withdraw.views.minStethWithdrawalAmount(),
      sdk.withdraw.views.maxStethWithdrawalAmount(),
      sdk.withdraw.views.getUnfinalizedStETH(),
      sdk.shares.getTotalSupply(),
    ]);

    let queueMode = "Normal";
    if (isPaused) queueMode = "PAUSED";
    else if (isBunker) queueMode = "Bunker";
    else if (isTurbo) queueMode = "Turbo";

    const lines = [
      "=== Lido Protocol Status ===",
      "",
      `Total Value Locked (TVL): ${formatEther(totalSupply.totalEther)} ETH`,
      "",
      "Staking:",
      `  Staking paused: ${stakeLimitInfo.isStakingPaused}`,
      `  Stake limit set: ${stakeLimitInfo.isStakingLimitSet}`,
      `  Current stake limit: ${formatEther(stakeLimitInfo.currentStakeLimit)} ETH`,
      `  Max stake limit: ${formatEther(stakeLimitInfo.maxStakeLimit)} ETH`,
      "",
      "Withdrawal Queue:",
      `  Mode: ${queueMode}`,
      `  Min withdrawal: ${formatEther(minSteth)} stETH`,
      `  Max withdrawal: ${formatEther(maxSteth)} stETH`,
      `  Unfinalized stETH: ${formatEther(unfinalizedStETH)} stETH`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
