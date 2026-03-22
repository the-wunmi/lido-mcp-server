import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { sdk, publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { validateAmountCap } from "../utils/security.js";
import { escrowAbi, stethApproveAbi } from "../utils/escrow-abi.js";

const GOVERNANCE_STATE_RAGE_QUIT = 5;

export const lockStethGovernanceToolDef = {
  name: "lido_lock_steth_governance",
  description:
    "Lock stETH in the Lido Dual Governance veto signalling escrow. " +
    "This is the primary governance action for stETH holders — locking stETH signals opposition " +
    "to DAO proposals. When enough stETH is locked, governance transitions from Normal to VetoSignalling, " +
    "blocking proposal execution. " +
    "Requires stETH approval for the escrow contract. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount of stETH to lock in escrow (e.g. '1.0')",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Lock stETH for Governance",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export const unlockStethGovernanceToolDef = {
  name: "lido_unlock_steth_governance",
  description:
    "Unlock all stETH from the Lido Dual Governance veto signalling escrow. " +
    "Withdraws your locked stETH shares back to your wallet. " +
    "Note: there is a minimum lock duration before unlocking is allowed. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
  },
  annotations: {
    title: "Unlock stETH from Governance",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const lockSchema = z.object({
  amount: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

const unlockSchema = z.object({
  dry_run: z.boolean().optional().default(true),
});

async function getEscrowAddress(): Promise<Address> {
  return await sdk.dualGovernance.getVetoSignallingEscrowAddress();
}

async function getStethAddress(): Promise<Address> {
  return await sdk.dualGovernance.getStETHAddress();
}

export async function handleLockStethGovernance(args: Record<string, unknown>) {
  try {
    const { amount, dry_run } = lockSchema.parse(args);
    const amountWei = parseEther(amount);

    const capError = validateAmountCap(amountWei);
    if (capError) return errorResult(capError);

    const address = getAccountAddress();
    const escrowAddress = await getEscrowAddress();
    const stethAddress = await getStethAddress();

    const [state, stethBalance] = await Promise.all([
      sdk.dualGovernance.getDualGovernanceState(),
      sdk.steth.balance(address),
    ]);

    const stateNum = typeof state === "number" ? state : Number(state);
    if (stateNum === GOVERNANCE_STATE_RAGE_QUIT) {
      return textResult(
        "Cannot lock stETH: governance is in RageQuit state. " +
        "The escrow is no longer accepting new locks."
      );
    }

    if (stethBalance < amountWei) {
      return errorResult(
        `Insufficient stETH balance. You have ${formatEther(stethBalance)} stETH ` +
        `but are trying to lock ${amount} stETH.`
      );
    }

    const allowance = await publicClient.readContract({
      address: stethAddress,
      abi: stethApproveAbi,
      functionName: "allowance",
      args: [address, escrowAddress],
    });

    const needsApproval = allowance < amountWei;

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 200_000n; // Conservative default
      let gasEstimateNote = "(using conservative estimate — live gas estimation failed)";

      if (needsApproval) {
        // Simulation would revert without approval — report as skipped, not failed
        simulationError = "Simulation skipped: stETH approval required for escrow contract (will be handled automatically on execution)";

        try {
          const approveGas = await publicClient.estimateContractGas({
            address: stethAddress,
            abi: stethApproveAbi,
            functionName: "approve",
            args: [escrowAddress, amountWei],
            account: address,
          });
          gasEstimate += approveGas;
        } catch {
          gasEstimate += 50_000n;
        }
      } else {
        try {
          await publicClient.simulateContract({
            address: escrowAddress,
            abi: escrowAbi,
            functionName: "lockStETH",
            args: [amountWei],
            account: address,
          });
          gasEstimate = await publicClient.estimateContractGas({
            address: escrowAddress,
            abi: escrowAbi,
            functionName: "lockStETH",
            args: [amountWei],
            account: address,
          });
          gasEstimateNote = "";
          simulationOk = true;
        } catch (err) {
          simulationOk = false;
          simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
        }
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      let currentLocked = "0";
      try {
        const details = await publicClient.readContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "getVetoerDetails",
          args: [address],
        });
        currentLocked = formatEther(BigInt(details.stETHLockedShares));
      } catch {
        // May not have any locked
      }

      const lines = [
        "=== DRY RUN: Lock stETH for Governance ===",
        "",
        `Amount to lock: ${amount} stETH`,
        `Currently locked: ${currentLocked} stETH shares`,
        `Escrow address: ${escrowAddress}`,
        `Approval needed: ${needsApproval ? "YES (will approve before locking)" : "No"}`,
        "",
        `Gas estimate: ${gasEstimate.toString()}${gasEstimateNote ? ` ${gasEstimateNote}` : ""}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${needsApproval ? "SKIPPED (approval needed first)" : simulationOk ? "SUCCESS" : "FAILED"}`,
      ];

      if (simulationError) {
        lines.push(`Note: ${simulationError}`);
      }

      lines.push(
        "",
        "What this does:",
        "  Your stETH will be locked in the Dual Governance escrow contract.",
        "  This signals opposition to current DAO proposals.",
        "  When enough stETH is locked, governance enters VetoSignalling state,",
        "  which blocks proposal execution until the dispute is resolved.",
      );

      return textResult(lines.join("\n"));
    }

    if (needsApproval) {
      // +2 wei buffer to account for stETH share-rounding
      const approveAmount = amountWei + 2n;
      const approveHash = await walletClient.writeContract({
        address: stethAddress,
        abi: stethApproveAbi,
        functionName: "approve",
        args: [escrowAddress, approveAmount],
      });

      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    const lockHash = await walletClient.writeContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "lockStETH",
      args: [amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: lockHash });

    const lines = [
      "=== stETH Locked for Governance ===",
      `Transaction hash: ${lockHash}`,
      `Amount locked: ${amount} stETH`,
      `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
    ];

    if (needsApproval) {
      lines.push("stETH approval was granted automatically.");
    }

    lines.push(
      "",
      "Your stETH is now locked in the Dual Governance escrow.",
      "Use lido_get_governance_state to see how this affects the governance state.",
      "Use lido_unlock_steth_governance when you want to withdraw your stETH.",
    );

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleUnlockStethGovernance(args: Record<string, unknown>) {
  try {
    const { dry_run } = unlockSchema.parse(args);
    const address = getAccountAddress();
    const escrowAddress = await getEscrowAddress();

    const state = await sdk.dualGovernance.getDualGovernanceState();
    const stateNum = typeof state === "number" ? state : Number(state);
    if (stateNum === GOVERNANCE_STATE_RAGE_QUIT) {
      return textResult(
        "Cannot unlock stETH: governance is in RageQuit state. " +
        "The escrow is sealed and stETH cannot be unlocked until the rage quit is resolved."
      );
    }

    let lockedShares = 0n;
    try {
      const details = await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "getVetoerDetails",
        args: [address],
      });
      lockedShares = BigInt(details.stETHLockedShares);
    } catch {
      // May not have any locked
    }

    if (lockedShares === 0n) {
      return textResult(
        "No stETH is currently locked in the governance escrow for your address.\n" +
        "Use lido_lock_steth_governance to lock stETH for governance participation."
      );
    }

    let lockedStethEquivalent = "unknown";
    try {
      const stethAmount = await sdk.shares.getPooledEthByShares(lockedShares);
      lockedStethEquivalent = formatEther(stethAmount);
    } catch {
      lockedStethEquivalent = `${formatEther(lockedShares)} shares`;
    }

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 150_000n;
      let gasEstimateNote = "(using conservative estimate — live gas estimation failed)";

      try {
        await publicClient.simulateContract({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "unlockStETH",
          account: address,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: escrowAddress,
          abi: escrowAbi,
          functionName: "unlockStETH",
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
        "=== DRY RUN: Unlock stETH from Governance ===",
        "",
        `stETH locked: ~${lockedStethEquivalent} stETH (equivalent value)`,
        `Locked shares: ${formatEther(lockedShares)} shares (raw protocol units)`,
        `Escrow address: ${escrowAddress}`,
        "",
        `Gas estimate: ${gasEstimate.toString()}${gasEstimateNote ? ` ${gasEstimateNote}` : ""}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];

      if (simulationError) {
        lines.push(`Simulation note: ${simulationError}`);
        if (simulationError.includes("lock") || simulationError.includes("duration")) {
          lines.push("", "Note: There is a minimum lock duration. Your stETH may not be unlockable yet.");
        }
      }

      return textResult(lines.join("\n"));
    }

    const unlockHash = await walletClient.writeContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "unlockStETH",
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: unlockHash });

    const lines = [
      "=== stETH Unlocked from Governance ===",
      `Transaction hash: ${unlockHash}`,
      `stETH unlocked: ~${lockedStethEquivalent} stETH`,
      `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      "",
      "Your stETH has been returned to your wallet.",
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
