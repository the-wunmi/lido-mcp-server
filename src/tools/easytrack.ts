import { z } from "zod";
import { formatEther, type Address } from "viem";
import { publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { appConfig } from "../config.js";
import { textResult, errorResult, formatTimestamp } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import {
  easyTrackAbi,
  ldoBalanceAbi,
  getEasyTrackAddress,
  getLdoTokenAddress,
  type EasyTrackMotion,
} from "../utils/easytrack-abi.js";
import { getFactoryLabel, getAllFactoryLabels } from "../utils/easytrack-labels.js";

export const getEasyTrackMotionsToolDef = {
  name: "lido_get_easytrack_motions",
  description:
    "List Easy Track motions with optional status filter. " +
    "Easy Track is Lido's lightweight governance for routine operations (payments, reward programs, node operator management). " +
    "Motions pass automatically unless enough LDO holders object. " +
    "Returns: id, factory label, creator, objection count/%, time remaining.",
  inputSchema: {
    type: "object" as const,
    properties: {
      status: {
        type: "string",
        description: "Filter by status: 'active' (still open for objection), 'all' (all current motions). Default: 'all'.",
        enum: ["active", "all"],
      },
    },
  },
  annotations: {
    title: "Get Easy Track Motions",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const getEasyTrackMotionToolDef = {
  name: "lido_get_easytrack_motion",
  description:
    "Get detailed view of a specific Easy Track motion by ID. " +
    "Returns all fields plus can-object status for your address and objection progress vs threshold.",
  inputSchema: {
    type: "object" as const,
    properties: {
      motion_id: {
        type: "number",
        description: "The motion ID to query.",
      },
    },
    required: ["motion_id"],
  },
  annotations: {
    title: "Get Easy Track Motion Detail",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const getEasyTrackConfigToolDef = {
  name: "lido_get_easytrack_config",
  description:
    "Get Easy Track system configuration: objection threshold, motion duration, motions count limit, and registered factories.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "Get Easy Track Config",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const getEasyTrackFactoriesToolDef = {
  name: "lido_get_easytrack_factories",
  description:
    "List all registered Easy Track EVM script factories with human-readable descriptions. " +
    "Each factory defines a specific type of operation that can be executed via Easy Track.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "Get Easy Track Factories",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const objectEasyTrackMotionToolDef = {
  name: "lido_object_easytrack_motion",
  description:
    "Object to an active Easy Track motion. " +
    "Requires LDO tokens. If enough LDO holders object (exceeding the objection threshold), " +
    "the motion is rejected. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      motion_id: {
        type: "number",
        description: "The motion ID to object to.",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["motion_id"],
  },
  annotations: {
    title: "Object to Easy Track Motion",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};


const getMotionsSchema = z.object({
  status: z.enum(["active", "all"]).optional().default("all"),
});

const getMotionSchema = z.object({
  motion_id: z.number().int().min(0),
});

const objectMotionSchema = z.object({
  motion_id: z.number().int().min(0),
  dry_run: z.boolean().optional().default(true),
});


function getMotionStatus(motion: EasyTrackMotion, now: number): string {
  const endTime = Number(motion.startDate) + Number(motion.duration);
  if (now < endTime) return "Active";
  return "Enacted";
}

function getTimeRemaining(motion: EasyTrackMotion, now: number): string {
  const endTime = Number(motion.startDate) + Number(motion.duration);
  const remaining = endTime - now;
  if (remaining <= 0) return "Ended";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h remaining`;
  }
  return `${hours}h ${minutes}m remaining`;
}

function formatObjectionPercent(objectionsAmount: bigint, threshold: bigint): string {
  if (threshold === 0n) return "0.00%";
  const bps = (objectionsAmount * 10000n) / threshold;
  return `${(Number(bps) / 100).toFixed(2)}%`;
}


export async function handleGetEasyTrackMotions(args: Record<string, unknown>) {
  try {
    const { status } = getMotionsSchema.parse(args);
    const easyTrackAddress = getEasyTrackAddress();
    const now = Math.floor(Date.now() / 1000);

    const [motions, ldoTotalSupply] = await Promise.all([
      publicClient.readContract({
        address: easyTrackAddress,
        abi: easyTrackAbi,
        functionName: "getMotions",
      }) as Promise<readonly EasyTrackMotion[]>,
      publicClient.readContract({
        address: getLdoTokenAddress(),
        abi: ldoBalanceAbi,
        functionName: "totalSupply",
      }),
    ]);

    let filteredMotions = [...motions];
    if (status === "active") {
      filteredMotions = filteredMotions.filter(m => {
        const endTime = Number(m.startDate) + Number(m.duration);
        return now < endTime;
      });
    }

    if (filteredMotions.length === 0) {
      return textResult(
        status === "active"
          ? "No active Easy Track motions at this time."
          : "No Easy Track motions found."
      );
    }

    const lines = [
      `=== Easy Track Motions (${filteredMotions.length} ${status === "active" ? "active" : "total"}) ===`,
      "",
    ];

    for (const m of filteredMotions) {
      const motionStatus = getMotionStatus(m, now);
      const label = getFactoryLabel(appConfig.chainId, m.evmScriptFactory);
      const objPct = formatObjectionPercent(m.objectionsAmount, ldoTotalSupply);

      lines.push(
        `Motion #${m.id.toString()}: ${motionStatus}`,
        `  Type: ${label}`,
        `  Creator: ${m.creator}`,
        `  Started: ${formatTimestamp(m.startDate)}`,
        `  ${getTimeRemaining(m, now)}`,
        `  Objections: ${formatEther(m.objectionsAmount)} LDO (${objPct} of supply)`,
        `  Threshold: ${(Number(m.objectionsThreshold) / 100).toFixed(2)}%`,
        "",
      );
    }

    const activeCount = filteredMotions.filter(m => getMotionStatus(m, now) === "Active").length;
    if (activeCount > 0) {
      lines.push(
        `${activeCount} motion(s) currently active and open for objection.`,
        "Use lido_get_easytrack_motion for detailed view.",
        "Use lido_object_easytrack_motion to object.",
      );
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetEasyTrackMotion(args: Record<string, unknown>) {
  try {
    const { motion_id } = getMotionSchema.parse(args);
    const easyTrackAddress = getEasyTrackAddress();
    const address = getAccountAddress();
    const now = Math.floor(Date.now() / 1000);

    const [motions, ldoBalance, ldoTotalSupply] = await Promise.all([
      publicClient.readContract({
        address: easyTrackAddress,
        abi: easyTrackAbi,
        functionName: "getMotions",
      }) as Promise<readonly EasyTrackMotion[]>,
      publicClient.readContract({
        address: getLdoTokenAddress(),
        abi: ldoBalanceAbi,
        functionName: "balanceOf",
        args: [address],
      }),
      publicClient.readContract({
        address: getLdoTokenAddress(),
        abi: ldoBalanceAbi,
        functionName: "totalSupply",
      }),
    ]);

    const motion = motions.find((m: EasyTrackMotion) => Number(m.id) === motion_id);
    if (!motion) {
      return errorResult(
        `Motion #${motion_id} not found. ` +
        `Available motions: ${motions.map((m: EasyTrackMotion) => `#${m.id.toString()}`).join(", ") || "none"}`
      );
    }

    const motionStatus = getMotionStatus(motion, now);
    const label = getFactoryLabel(appConfig.chainId, motion.evmScriptFactory);
    const objPct = formatObjectionPercent(motion.objectionsAmount, ldoTotalSupply);
    const thresholdPct = (Number(motion.objectionsThreshold) / 100).toFixed(2);

    // Check if user can object
    let canObject = false;
    if (motionStatus === "Active") {
      try {
        canObject = await publicClient.readContract({
          address: easyTrackAddress,
          abi: easyTrackAbi,
          functionName: "canObjectToMotion",
          args: [BigInt(motion_id), address],
        }) as boolean;
      } catch {
        // May fail if motion ended between check and now
      }
    }

    const endTime = Number(motion.startDate) + Number(motion.duration);

    const lines = [
      `=== Easy Track Motion #${motion_id} ===`,
      "",
      `Status: ${motionStatus}`,
      `Type: ${label}`,
      `Factory: ${motion.evmScriptFactory}`,
      `Creator: ${motion.creator}`,
      "",
      `Started: ${formatTimestamp(motion.startDate)}`,
      `Ends: ${formatTimestamp(BigInt(endTime))}`,
      `${getTimeRemaining(motion, now)}`,
      "",
      "--- Objection Progress ---",
      `  Objections: ${formatEther(motion.objectionsAmount)} LDO (${objPct} of total supply)`,
      `  Threshold to reject: ${thresholdPct}%`,
      `  EVM script hash: ${motion.evmScriptHash}`,
      `  Snapshot block: ${motion.snapshotBlock.toString()}`,
      "",
      "--- Your Status ---",
      `  LDO balance: ${formatEther(ldoBalance)} LDO`,
      `  Can object: ${canObject ? "YES" : motionStatus !== "Active" ? "NO (motion not active)" : "NO (already objected or no LDO at snapshot)"}`,
    ];

    if (canObject) {
      lines.push(
        "",
        "Use lido_object_easytrack_motion to object to this motion.",
      );
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetEasyTrackConfig(args: Record<string, unknown>) {
  try {
    const easyTrackAddress = getEasyTrackAddress();

    const [duration, threshold, countLimit, factories] = await Promise.all([
      publicClient.readContract({
        address: easyTrackAddress,
        abi: easyTrackAbi,
        functionName: "motionDuration",
      }),
      publicClient.readContract({
        address: easyTrackAddress,
        abi: easyTrackAbi,
        functionName: "objectionsThreshold",
      }),
      publicClient.readContract({
        address: easyTrackAddress,
        abi: easyTrackAbi,
        functionName: "motionsCountLimit",
      }),
      publicClient.readContract({
        address: easyTrackAddress,
        abi: easyTrackAbi,
        functionName: "getEVMScriptFactories",
      }) as Promise<readonly Address[]>,
    ]);

    const durationHours = Number(duration) / 3600;
    const thresholdPct = (Number(threshold) / 100).toFixed(2);

    const lines = [
      "=== Easy Track Configuration ===",
      "",
      `Contract: ${easyTrackAddress}`,
      `Motion duration: ${durationHours}h (${Number(duration)}s)`,
      `Objection threshold: ${thresholdPct}% of LDO total supply`,
      `Motions count limit: ${Number(countLimit)}`,
      "",
      `Registered factories: ${factories.length}`,
    ];

    for (const factory of factories) {
      const label = getFactoryLabel(appConfig.chainId, factory);
      lines.push(`  - ${factory}: ${label}`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetEasyTrackFactories(args: Record<string, unknown>) {
  try {
    const easyTrackAddress = getEasyTrackAddress();

    const factories = await publicClient.readContract({
      address: easyTrackAddress,
      abi: easyTrackAbi,
      functionName: "getEVMScriptFactories",
    }) as readonly Address[];

    const allLabels = getAllFactoryLabels(appConfig.chainId);

    const lines = [
      `=== Easy Track Factories (${factories.length} registered) ===`,
      "",
    ];

    for (const factory of factories) {
      const label = getFactoryLabel(appConfig.chainId, factory);
      lines.push(`${factory}`, `  ${label}`, "");
    }

    const knownCount = Object.keys(allLabels).length;
    const onChainSet = new Set(factories.map(f => f.toLowerCase()));
    const labeledOnChain = Object.keys(allLabels).filter(a => onChainSet.has(a.toLowerCase())).length;

    lines.push(
      `${labeledOnChain} of ${factories.length} factories have known labels.`,
      `${knownCount} labels in local database.`,
    );

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleObjectEasyTrackMotion(args: Record<string, unknown>) {
  try {
    const { motion_id, dry_run } = objectMotionSchema.parse(args);
    const easyTrackAddress = getEasyTrackAddress();
    const address = getAccountAddress();

    const motions = await publicClient.readContract({
      address: easyTrackAddress,
      abi: easyTrackAbi,
      functionName: "getMotions",
    }) as readonly EasyTrackMotion[];

    const motion = motions.find(m => Number(m.id) === motion_id);
    if (!motion) {
      return errorResult(`Motion #${motion_id} not found.`);
    }

    const now = Math.floor(Date.now() / 1000);
    const endTime = Number(motion.startDate) + Number(motion.duration);
    if (now >= endTime) {
      return errorResult(`Motion #${motion_id} has already ended.`);
    }

    const canObject = await publicClient.readContract({
      address: easyTrackAddress,
      abi: easyTrackAbi,
      functionName: "canObjectToMotion",
      args: [BigInt(motion_id), address],
    });

    if (!canObject) {
      return errorResult(
        `Cannot object to motion #${motion_id}. ` +
        "This usually means you've already objected or had no LDO at the snapshot block."
      );
    }

    const [ldoBalance, ldoTotalSupply] = await Promise.all([
      publicClient.readContract({
        address: getLdoTokenAddress(),
        abi: ldoBalanceAbi,
        functionName: "balanceOf",
        args: [address],
      }),
      publicClient.readContract({
        address: getLdoTokenAddress(),
        abi: ldoBalanceAbi,
        functionName: "totalSupply",
      }),
    ]);

    const label = getFactoryLabel(appConfig.chainId, motion.evmScriptFactory);
    const currentObjPct = formatObjectionPercent(motion.objectionsAmount, ldoTotalSupply);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 100_000n;
      let gasEstimateNote = "(using conservative estimate)";

      try {
        await publicClient.simulateContract({
          address: easyTrackAddress,
          abi: easyTrackAbi,
          functionName: "objectToMotion",
          args: [BigInt(motion_id)],
          account: address,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: easyTrackAddress,
          abi: easyTrackAbi,
          functionName: "objectToMotion",
          args: [BigInt(motion_id)],
          account: address,
        });
        gasEstimateNote = "";
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      const lines = [
        "=== DRY RUN: Object to Easy Track Motion ===",
        "",
        `Motion: #${motion_id}`,
        `Type: ${label}`,
        `Your LDO balance: ${formatEther(ldoBalance)} LDO`,
        "",
        `Current objections: ${formatEther(motion.objectionsAmount)} LDO (${currentObjPct})`,
        `Threshold to reject: ${(Number(motion.objectionsThreshold) / 100).toFixed(2)}%`,
        `Time remaining: ${getTimeRemaining(motion, now)}`,
        "",
        `Gas estimate: ${gasEstimate.toString()}${gasEstimateNote ? ` ${gasEstimateNote}` : ""}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];

      if (simulationError) {
        lines.push(`Simulation note: ${simulationError}`);
      }

      lines.push(
        "",
        "What this does:",
        "  Your LDO weight (at snapshot block) will be counted as an objection.",
        "  If total objections exceed the threshold, the motion is rejected.",
      );

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: easyTrackAddress,
      abi: easyTrackAbi,
      functionName: "objectToMotion",
      args: [BigInt(motion_id)],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const lines = [
      "=== Objection Recorded on Easy Track ===",
      `Transaction hash: ${txHash}`,
      `Motion: #${motion_id} (${label})`,
      `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      "",
      "Use lido_get_easytrack_motion to see updated objection progress.",
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
