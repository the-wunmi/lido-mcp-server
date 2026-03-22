import { z } from "zod";
import { formatEther, formatUnits, type Address } from "viem";
import { sdk, publicClient, getAccountAddress } from "../sdk-factory.js";
import { appConfig } from "../config.js";
import { formatPercent, textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";
import { GOVERNANCE_WARNING_THRESHOLD } from "../config.js";
import { GOVERNANCE_STATE_LABELS, GOVERNANCE_STATE_DESCRIPTIONS } from "../utils/governance-labels.js";
import { ldoBalanceAbi, getLdoTokenAddress } from "../utils/easytrack-abi.js";
import { escrowAbi } from "../utils/escrow-abi.js";

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

export const votingPowerToolDef = {
  name: "lido_get_voting_power",
  description:
    "Get cross-system governance power for an address: " +
    "LDO balance (for Aragon voting + Easy Track objections), " +
    "stETH balance (for Dual Governance veto power), " +
    "stETH locked in escrow, and wstETH balance.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address to check. Defaults to configured wallet.",
      },
    },
  },
  annotations: {
    title: "Get Voting Power",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const votingPowerSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function handleGetVotingPower(args: Record<string, unknown>) {
  try {
    const { address: inputAddress } = votingPowerSchema.parse(args);
    const address = (inputAddress ?? getAccountAddress()) as Address;

    const [ldoBalance, stethBalance, wstethBalance] = await Promise.all([
      publicClient.readContract({
        address: getLdoTokenAddress(),
        abi: ldoBalanceAbi,
        functionName: "balanceOf",
        args: [address],
      }),
      sdk.steth.balance(address),
      sdk.wsteth.balance(address),
    ]);

    let lockedShares = 0n;
    let lockedStethEquivalent = 0n;
    try {
      const escrowAddress = await sdk.dualGovernance.getVetoSignallingEscrowAddress();

      const details = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "getVetoerDetails",
        args: [address],
      });
      lockedShares = BigInt(details.stETHLockedShares);

      if (lockedShares > 0n) {
        try {
          lockedStethEquivalent = await sdk.shares.getPooledEthByShares(lockedShares);
        } catch {
          lockedStethEquivalent = lockedShares;
        }
      }
    } catch {
      // No escrow data available
    }

    let wstethInSteth = 0n;
    if (wstethBalance > 0n) {
      try {
        wstethInSteth = await sdk.wrap.convertWstethToSteth(wstethBalance);
      } catch {
        wstethInSteth = wstethBalance;
      }
    }

    const totalVetoPower = stethBalance + wstethInSteth + lockedStethEquivalent;

    const lines = [
      `=== Governance Voting Power ===`,
      "",
      `Address: ${address}`,
      "",
      "--- Aragon DAO + Easy Track (LDO) ---",
      `  LDO balance: ${formatEther(ldoBalance)} LDO`,
      `  Used for: Aragon DAO voting, Easy Track objections`,
      "",
      "--- Dual Governance (stETH) ---",
      `  Free stETH: ${formatEther(stethBalance)}`,
      `  wstETH: ${formatEther(wstethBalance)} (≈ ${formatEther(wstethInSteth)} stETH)`,
      `  Locked in escrow: ${formatEther(lockedStethEquivalent)} stETH`,
      `  Total veto power: ${formatEther(totalVetoPower)} stETH equivalent`,
      `  Used for: Dual Governance veto signalling`,
    ];

    if (ldoBalance === 0n && totalVetoPower === 0n) {
      lines.push(
        "",
        "No governance power detected.",
        "- Get LDO with lido_swap_eth_for_ldo to participate in Aragon/Easy Track governance.",
        "- Stake ETH with lido_stake_eth to get stETH for Dual Governance veto power.",
      );
    } else {
      lines.push("");
      if (ldoBalance > 0n) {
        lines.push("You can participate in Aragon voting and Easy Track objections.");
      }
      if (totalVetoPower > 0n) {
        lines.push("You can lock stETH for Dual Governance veto signalling.");
      }
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
