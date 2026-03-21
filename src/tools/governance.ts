import { z } from "zod";
import { formatEther, formatUnits } from "viem";
import { sdk } from "../sdk-factory.js";
import { formatPercent, textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";
import { GOVERNANCE_WARNING_THRESHOLD } from "../config.js";
import { GOVERNANCE_STATE_LABELS, GOVERNANCE_STATE_DESCRIPTIONS } from "../utils/governance-labels.js";

export const governanceToolDef = {
  name: "lido_get_governance_state",
  description:
    "Get the current Lido Dual Governance state including persisted state, " +
    "veto signalling progress, escrow details, and governance warning status. " +
    "Use this before any governance action to understand the current state.",
  inputSchema: {
    type: "object" as const,
    properties: {
      warning_threshold: {
        type: "number",
        description:
          "Percent threshold for governance warning (default: 50). " +
          "If veto support exceeds this, status is 'Warning'; if governance is blocked, status is 'Blocked'.",
      },
    },
  },
  annotations: {
    title: "Get Governance State",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const governanceSchema = z.object({
  warning_threshold: z.number().min(0).max(100).optional(),
});

export async function handleGetGovernanceState(args: Record<string, unknown>) {
  try {
    const { warning_threshold } = governanceSchema.parse(args);
    const triggerPercent = warning_threshold ?? GOVERNANCE_WARNING_THRESHOLD;

    const [state, vetoProgress, escrowDetails, totalStETHSupply, config, warningStatus] =
      await Promise.all([
        sdk.dualGovernance.getDualGovernanceState(),
        sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress(),
        sdk.dualGovernance.getVetoSignallingEscrowLockedAssets(),
        sdk.dualGovernance.getTotalStETHSupply(),
        sdk.dualGovernance.getDualGovernanceConfig(),
        sdk.dualGovernance.getGovernanceWarningStatus({ triggerPercent }),
      ]);

    const stateNum = typeof state === "number" ? state : Number(state);
    const stateLabel = GOVERNANCE_STATE_LABELS[stateNum] ?? `Unknown(${stateNum})`;
    const stateDesc = GOVERNANCE_STATE_DESCRIPTIONS[stateNum] ?? "";

    const lines = [
      "=== Lido Dual Governance State ===",
      "",
      `State: ${stateLabel}`,
      `  ${stateDesc}`,
      `Warning status: ${warningStatus.state} (threshold: ${triggerPercent}%)`,
      `Veto signalling support: ${formatPercent(vetoProgress.currentSupportPercent)}`,
      "",
      "Escrow Details:",
      `  Total stETH locked (shares): ${formatEther(escrowDetails.totalStETHLockedShares)}`,
      `  Total stETH claimed ETH: ${formatEther(escrowDetails.totalStETHClaimedETH)}`,
      `  Total unstETH unfinalized (shares): ${formatEther(escrowDetails.totalUnstETHUnfinalizedShares)}`,
      `  Total unstETH finalized ETH: ${formatEther(escrowDetails.totalUnstETHFinalizedETH)}`,
      "",
      `Total stETH supply: ${formatEther(totalStETHSupply)}`,
      "",
      "Governance Configuration:",
      `  First seal rage-quit support: ${formatUnits(config.firstSealRageQuitSupport, 16)}%`,
      `  Second seal rage-quit support: ${formatUnits(config.secondSealRageQuitSupport, 16)}%`,
      `  Min assets lock duration: ${config.minAssetsLockDuration}s`,
      `  Veto signalling min duration: ${config.vetoSignallingMinDuration}s`,
      `  Veto signalling max duration: ${config.vetoSignallingMaxDuration}s`,
      `  Veto cooldown duration: ${config.vetoCooldownDuration}s`,
      `  Rage quit extension period: ${config.rageQuitExtensionPeriodDuration}s`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
