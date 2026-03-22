import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { sdk, publicClient, getAccountAddress } from "../sdk-factory.js";
import { appConfig } from "../config.js";
import { textResult, errorResult, formatPercent, formatTimestamp, formatDuration } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";
import { GOVERNANCE_STATE_LABELS, GOVERNANCE_STATE_DESCRIPTIONS } from "../utils/governance-labels.js";
import { easyTrackAbi, getEasyTrackAddress, type EasyTrackMotion } from "../utils/easytrack-abi.js";
import { getFactoryLabel } from "../utils/easytrack-labels.js";
import { getAragonVotingAddress, aragonVotingAbi } from "../utils/aragon-abi.js";
import { escrowAbi } from "../utils/escrow-abi.js";


export const estimateVetoImpactToolDef = {
  name: "lido_estimate_veto_impact",
  description:
    "Estimate the impact of locking a given stETH amount in the Dual Governance veto escrow. " +
    "Computes: current veto %, projected % after lock, whether it would trigger first/second seal, " +
    "and estimated dynamic timelock duration.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount of stETH to hypothetically lock (e.g. '100.0').",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Estimate Veto Impact",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const getVetoThresholdsToolDef = {
  name: "lido_get_veto_thresholds",
  description:
    "Get Dual Governance veto threshold configuration with context: " +
    "first seal and second seal thresholds (amount + %), current escrow level, " +
    "and how much more stETH is needed to reach each threshold.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "Get Veto Thresholds",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const getGovernanceTimelineToolDef = {
  name: "lido_get_governance_timeline",
  description:
    "Unified governance timeline across all systems: " +
    "Dual Governance state + transition timing, open Aragon votes with time remaining, " +
    "active Easy Track motions with time remaining, and objection windows.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "Get Governance Timeline",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const getGovernancePositionImpactToolDef = {
  name: "lido_get_governance_position_impact",
  description:
    "Analyze how the current governance state affects a staking position. " +
    "Returns: risk level, whether stETH is at risk (rage quit scenario), locked vs free stETH, " +
    "withdrawal queue impact, and actionable recommendations.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address to analyze. Defaults to configured wallet.",
      },
    },
  },
  annotations: {
    title: "Governance Position Impact",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};


const vetoImpactSchema = z.object({
  amount: z.string().regex(/^\d+\.?\d*$/, "Amount must be a positive decimal number"),
});

const positionImpactSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});


export async function handleEstimateVetoImpact(args: Record<string, unknown>) {
  try {
    const { amount } = vetoImpactSchema.parse(args);
    const amountWei = parseEther(amount);

    const [vetoProgress, escrowDetails, totalStETHSupply, config] = await Promise.all([
      sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress(),
      sdk.dualGovernance.getVetoSignallingEscrowLockedAssets(),
      sdk.dualGovernance.getTotalStETHSupply(),
      sdk.dualGovernance.getDualGovernanceConfig(),
    ]);

    const currentSupportPct = vetoProgress.currentSupportPercent;

    const currentLockedWei = escrowDetails.totalStETHLockedShares;
    const projectedLockedWei = currentLockedWei + amountWei;
    const projectedSupportPct = totalStETHSupply > 0n
      ? (Number(projectedLockedWei) / Number(totalStETHSupply)) * 100
      : 0;

    const firstSealPct = Number(config.firstSealRageQuitSupport) / 1e16;
    const secondSealPct = Number(config.secondSealRageQuitSupport) / 1e16;

    const wouldTriggerFirstSeal = projectedSupportPct >= firstSealPct;
    const wouldTriggerSecondSeal = projectedSupportPct >= secondSealPct;

    let timelockEstimate = "None (below first seal)";
    if (wouldTriggerSecondSeal) {
      timelockEstimate = "Maximum — second seal reached, rage quit would be triggered";
    } else if (wouldTriggerFirstSeal) {
      // Linear interpolation between min and max veto signalling duration
      const minDuration = Number(config.vetoSignallingMinDuration);
      const maxDuration = Number(config.vetoSignallingMaxDuration);
      const ratio = (projectedSupportPct - firstSealPct) / (secondSealPct - firstSealPct);
      const estimatedDuration = minDuration + ratio * (maxDuration - minDuration);
      timelockEstimate = formatDuration(Math.floor(estimatedDuration));
    }

    const lines = [
      "=== Veto Impact Estimate ===",
      "",
      `Amount to lock: ${amount} stETH`,
      "",
      "--- Current State ---",
      `  Veto support: ${formatPercent(currentSupportPct)}`,
      `  stETH in escrow: ${formatEther(currentLockedWei)}`,
      `  Total stETH supply: ${formatEther(totalStETHSupply)}`,
      "",
      "--- Projected After Lock ---",
      `  Projected veto support: ${formatPercent(projectedSupportPct)}`,
      `  Projected stETH in escrow: ${formatEther(projectedLockedWei)}`,
      `  Change: +${formatPercent(projectedSupportPct - currentSupportPct)}`,
      "",
      "--- Threshold Analysis ---",
      `  First seal threshold: ${firstSealPct.toFixed(2)}%`,
      `  Would trigger first seal: ${wouldTriggerFirstSeal ? "YES" : "NO"}`,
      `  Second seal threshold: ${secondSealPct.toFixed(2)}%`,
      `  Would trigger second seal: ${wouldTriggerSecondSeal ? "YES" : "NO"}`,
      "",
      `  Estimated dynamic timelock: ${timelockEstimate}`,
    ];

    if (wouldTriggerSecondSeal) {
      lines.push(
        "",
        "WARNING: This amount would push veto support past the second seal threshold,",
        "potentially triggering an irreversible rage quit.",
      );
    } else if (wouldTriggerFirstSeal) {
      lines.push(
        "",
        "Note: This amount would activate veto signalling, blocking proposal execution",
        "until the dispute is resolved or support drops below the threshold.",
      );
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetVetoThresholds(args: Record<string, unknown>) {
  try {
    const [vetoProgress, escrowDetails, totalStETHSupply, config, state] = await Promise.all([
      sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress(),
      sdk.dualGovernance.getVetoSignallingEscrowLockedAssets(),
      sdk.dualGovernance.getTotalStETHSupply(),
      sdk.dualGovernance.getDualGovernanceConfig(),
      sdk.dualGovernance.getDualGovernanceState(),
    ]);

    const stateNum = typeof state === "number" ? state : Number(state);
    const stateLabel = GOVERNANCE_STATE_LABELS[stateNum] ?? `Unknown(${stateNum})`;

    const currentLockedWei = escrowDetails.totalStETHLockedShares;
    const currentSupportPct = vetoProgress.currentSupportPercent;

    const firstSealPct = Number(config.firstSealRageQuitSupport) / 1e16;
    const secondSealPct = Number(config.secondSealRageQuitSupport) / 1e16;

    const firstSealAmountWei = (totalStETHSupply * BigInt(Math.floor(firstSealPct * 1e4))) / 1000000n;
    const secondSealAmountWei = (totalStETHSupply * BigInt(Math.floor(secondSealPct * 1e4))) / 1000000n;

    const neededForFirstSeal = firstSealAmountWei > currentLockedWei
      ? firstSealAmountWei - currentLockedWei
      : 0n;
    const neededForSecondSeal = secondSealAmountWei > currentLockedWei
      ? secondSealAmountWei - currentLockedWei
      : 0n;

    const lines = [
      "=== Dual Governance Veto Thresholds ===",
      "",
      `Current governance state: ${stateLabel}`,
      `Current veto support: ${formatPercent(currentSupportPct)}`,
      `stETH in escrow: ${formatEther(currentLockedWei)}`,
      `Total stETH supply: ${formatEther(totalStETHSupply)}`,
      "",
      "--- First Seal (Veto Signalling Activation) ---",
      `  Threshold: ${firstSealPct.toFixed(2)}%`,
      `  Required stETH: ${formatEther(firstSealAmountWei)}`,
      `  Additional stETH needed: ${neededForFirstSeal > 0n ? formatEther(neededForFirstSeal) : "Already exceeded"}`,
      `  Status: ${currentSupportPct >= firstSealPct ? "EXCEEDED" : "Not reached"}`,
      "",
      "--- Second Seal (Rage Quit Trigger) ---",
      `  Threshold: ${secondSealPct.toFixed(2)}%`,
      `  Required stETH: ${formatEther(secondSealAmountWei)}`,
      `  Additional stETH needed: ${neededForSecondSeal > 0n ? formatEther(neededForSecondSeal) : "Already exceeded"}`,
      `  Status: ${currentSupportPct >= secondSealPct ? "EXCEEDED" : "Not reached"}`,
      "",
      "--- Timing Configuration ---",
      `  Min veto signalling duration: ${formatDuration(Number(config.vetoSignallingMinDuration))}`,
      `  Max veto signalling duration: ${formatDuration(Number(config.vetoSignallingMaxDuration))}`,
      `  Veto cooldown: ${formatDuration(Number(config.vetoCooldownDuration))}`,
      `  Min assets lock duration: ${formatDuration(Number(config.minAssetsLockDuration))}`,
      `  Rage quit extension period: ${formatDuration(Number(config.rageQuitExtensionPeriodDuration))}`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetGovernanceTimeline(args: Record<string, unknown>) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const votingAddress = getAragonVotingAddress();

    const [dgState, vetoProgress, totalVotes, voteTime, easyTrackMotions] = await Promise.all([
      sdk.dualGovernance.getDualGovernanceState(),
      sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress(),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "votesLength",
      }),
      publicClient.readContract({
        address: votingAddress,
        abi: aragonVotingAbi,
        functionName: "voteTime",
      }),
      (async () => {
        try {
          const etAddr = getEasyTrackAddress();
          return await publicClient.readContract({
            address: etAddr,
            abi: easyTrackAbi,
            functionName: "getMotions",
          }) as readonly EasyTrackMotion[];
        } catch {
          return [] as readonly EasyTrackMotion[];
        }
      })(),
    ]);

    const stateNum = typeof dgState === "number" ? dgState : Number(dgState);
    const stateLabel = GOVERNANCE_STATE_LABELS[stateNum] ?? `Unknown(${stateNum})`;
    const stateDesc = GOVERNANCE_STATE_DESCRIPTIONS[stateNum] ?? "";
    const voteDuration = Number(voteTime);
    const total = Number(totalVotes);

    const lines = [
      "=== Unified Governance Timeline ===",
      `  ${formatTimestamp(now)}`,
      "",
      "--- Dual Governance ---",
      `  State: ${stateLabel}`,
      `  ${stateDesc}`,
      `  Veto support: ${formatPercent(vetoProgress.currentSupportPercent)}`,
      "",
    ];

    lines.push("--- Aragon DAO Votes ---");
    let openAragonCount = 0;
    if (total > 0) {
      const recentCount = Math.min(10, total);
      const voteIds = Array.from({ length: recentCount }, (_, i) => total - 1 - i);

      const votes = await Promise.all(
        voteIds.map(async (id) => {
          const result = await publicClient.readContract({
            address: votingAddress,
            abi: aragonVotingAbi,
            functionName: "getVote",
            args: [BigInt(id)],
          });
          return {
            id,
            open: result[0] as boolean,
            executed: result[1] as boolean,
            startDate: Number(result[2]),
          };
        }),
      );

      const openVotes = votes.filter(v => v.open);
      openAragonCount = openVotes.length;
      if (openVotes.length > 0) {
        for (const v of openVotes) {
          const endTime = v.startDate + voteDuration;
          const remaining = endTime - now;
          lines.push(
            `  Vote #${v.id}: OPEN`,
            `    Ends: ${formatTimestamp(endTime)} (${formatDuration(Math.max(0, remaining))})`,
          );
        }
      } else {
        lines.push("  No open Aragon votes.");
      }
    } else {
      lines.push("  No Aragon votes found.");
    }

    lines.push("");

    // Easy Track motions
    lines.push("--- Easy Track Motions ---");
    const activeMotions = easyTrackMotions.filter((m: EasyTrackMotion) => {
      const endTime = Number(m.startDate) + Number(m.duration);
      return now < endTime;
    });

    if (activeMotions.length > 0) {
      for (const m of activeMotions) {
        const endTime = Number(m.startDate) + Number(m.duration);
        const remaining = endTime - now;
        const label = getFactoryLabel(appConfig.chainId, m.evmScriptFactory);
        lines.push(
          `  Motion #${m.id.toString()}: ACTIVE`,
          `    Type: ${label}`,
          `    Objection window ends: ${formatTimestamp(endTime)} (${formatDuration(Math.max(0, remaining))})`,
        );
      }
    } else {
      lines.push("  No active Easy Track motions.");
    }

    lines.push("");

    const actionItems: string[] = [];
    if (stateNum >= 2 && stateNum <= 3) {
      actionItems.push("Dual Governance is in VetoSignalling — proposals are blocked");
    }
    if (stateNum === 5) {
      actionItems.push("RAGE QUIT in progress — governance is halted");
    }
    if (openAragonCount > 0) {
      actionItems.push(`${openAragonCount} open Aragon vote(s) — check with lido_get_aragon_vote`);
    }
    if (activeMotions.length > 0) {
      actionItems.push(`${activeMotions.length} active Easy Track motion(s) — check with lido_get_easytrack_motions`);
    }

    if (actionItems.length > 0) {
      lines.push("--- Action Items ---");
      for (const item of actionItems) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push("No immediate governance actions required.");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetGovernancePositionImpact(args: Record<string, unknown>) {
  try {
    const { address: inputAddress } = positionImpactSchema.parse(args);
    const address = (inputAddress ?? getAccountAddress()) as Address;

    const [state, vetoProgress, config, stethBalance, wstethBalance] =
      await Promise.all([
        sdk.dualGovernance.getDualGovernanceState(),
        sdk.dualGovernance.calculateCurrentVetoSignallingThresholdProgress(),
        sdk.dualGovernance.getDualGovernanceConfig(),
        sdk.steth.balance(address),
        sdk.wsteth.balance(address),
      ]);

    const stateNum = typeof state === "number" ? state : Number(state);
    const stateLabel = GOVERNANCE_STATE_LABELS[stateNum] ?? `Unknown(${stateNum})`;
    const currentSupportPct = vetoProgress.currentSupportPercent;

    let lockedShares = 0n;
    try {
      const escrowAddress = await sdk.dualGovernance.getVetoSignallingEscrowAddress();

      const details = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "getVetoerDetails",
        args: [address],
      });
      lockedShares = BigInt(details.stETHLockedShares);
    } catch {
      // No locked assets
    }

    let lockedStethEquivalent = 0n;
    if (lockedShares > 0n) {
      try {
        lockedStethEquivalent = await sdk.shares.getPooledEthByShares(lockedShares);
      } catch {
        lockedStethEquivalent = lockedShares; // fallback to shares value
      }
    }

    let wstethInSteth = 0n;
    if (wstethBalance > 0n) {
      try {
        wstethInSteth = await sdk.wrap.convertWstethToSteth(wstethBalance);
      } catch {
        wstethInSteth = wstethBalance;
      }
    }

    const totalExposure = stethBalance + wstethInSteth + lockedStethEquivalent;

    let riskLevel: string;
    let riskDescription: string;
    const recommendations: string[] = [];

    const secondSealPct = Number(config.secondSealRageQuitSupport) / 1e16;

    if (stateNum === 5) {
      riskLevel = "CRITICAL";
      riskDescription = "Rage quit is in progress. stETH locked in escrow will be withdrawn from Lido.";
      if (lockedShares > 0n) {
        recommendations.push("Your locked stETH is part of the rage quit process.");
      }
      recommendations.push("Monitor the rage quit resolution closely.");
      recommendations.push("Free stETH/wstETH is not directly affected but withdrawal times may increase.");
    } else if (stateNum === 2 || stateNum === 3) {
      if (currentSupportPct >= secondSealPct * 0.8) {
        riskLevel = "HIGH";
        riskDescription = "Veto signalling is active and approaching the second seal threshold.";
        recommendations.push("Consider whether you want to participate in veto signalling.");
        if (totalExposure > 0n) {
          recommendations.push("If concerned, consider withdrawing some stETH to reduce exposure.");
        }
      } else {
        riskLevel = "MODERATE";
        riskDescription = "Veto signalling is active but well below the rage quit threshold.";
        recommendations.push("Monitor governance state for escalation.");
      }
    } else if (stateNum === 4) {
      riskLevel = "LOW";
      riskDescription = "Governance is in cooldown. Likely returning to normal.";
    } else {
      riskLevel = "NORMAL";
      riskDescription = "Governance is operating normally. No elevated risk to staking positions.";
    }

    // Withdrawal queue impact
    let withdrawalImpact = "Normal — standard withdrawal times expected";
    if (stateNum === 5) {
      withdrawalImpact = "Significant delays expected — rage quit increases withdrawal queue depth";
    } else if (stateNum === 2) {
      withdrawalImpact = "Possible delays if situation escalates — monitor closely";
    }

    const lines = [
      `=== Governance Impact on Position ===`,
      "",
      `Address: ${address}`,
      `Risk level: ${riskLevel}`,
      `  ${riskDescription}`,
      "",
      "--- Position Summary ---",
      `  Free stETH: ${formatEther(stethBalance)}`,
      `  Free wstETH: ${formatEther(wstethBalance)} (≈ ${formatEther(wstethInSteth)} stETH)`,
      `  Locked in governance escrow: ${formatEther(lockedStethEquivalent)} stETH`,
      `  Total exposure: ${formatEther(totalExposure)} stETH equivalent`,
      "",
      "--- Governance Context ---",
      `  State: ${stateLabel}`,
      `  Veto support: ${formatPercent(currentSupportPct)}`,
      `  Second seal threshold: ${secondSealPct.toFixed(2)}%`,
      "",
      `--- Withdrawal Queue Impact ---`,
      `  ${withdrawalImpact}`,
      "",
      "--- Recommendations ---",
    ];

    if (recommendations.length > 0) {
      for (const rec of recommendations) {
        lines.push(`  - ${rec}`);
      }
    } else {
      lines.push("  - No immediate action needed. Position is healthy.");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
