import { z } from "zod";
import { formatEther, type Address } from "viem";
import { sdk, publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { appConfig, WITHDRAWAL_QUEUE_ADDRESSES } from "../config.js";
import { textResult, errorResult } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { validateReceiver } from "../utils/security.js";

const withdrawalQueueNftAbi = [
  { name: "ownerOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { name: "transferFrom", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
  { name: "approve", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "to", type: "address" }, { name: "tokenId", type: "uint256" }], outputs: [] },
] as const;

function getWithdrawalQueueAddress(): Address {
  const addr = WITHDRAWAL_QUEUE_ADDRESSES[appConfig.chainId];
  if (!addr) throw new Error("Withdrawal queue not available on this chain");
  return addr;
}

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

export const withdrawalNftOwnerToolDef = {
  name: "lido_get_withdrawal_nft_owner",
  description:
    "Check the current owner of a withdrawal request NFT by request ID. " +
    "Withdrawal requests are ERC-721 tokens that can be transferred.",
  inputSchema: {
    type: "object" as const,
    properties: {
      request_id: {
        type: "string",
        description: "The withdrawal request ID (token ID).",
      },
    },
    required: ["request_id"],
  },
  annotations: {
    title: "[Withdrawals] Withdrawal NFT Owner",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const nftOwnerSchema = z.object({
  request_id: z.string().regex(/^\d+$/),
});

export async function handleGetWithdrawalNftOwner(args: Record<string, unknown>) {
  try {
    const { request_id } = nftOwnerSchema.parse(args);
    const queueAddr = getWithdrawalQueueAddress();

    const owner = await publicClient.readContract({
      address: queueAddr,
      abi: withdrawalQueueNftAbi,
      functionName: "ownerOf",
      args: [BigInt(request_id)],
    });

    return textResult(
      [
        `=== Withdrawal NFT #${request_id} ===`,
        "",
        `Owner: ${owner}`,
        `Contract: ${queueAddr}`,
        "",
        "Withdrawal request NFTs are transferable ERC-721 tokens.",
        "The owner can claim the finalized ETH.",
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const transferWithdrawalNftToolDef = {
  name: "lido_transfer_withdrawal_nft",
  description:
    "Transfer a withdrawal request NFT to another address. " +
    "The new owner will be able to claim the finalized ETH. " +
    "Defaults to dry_run=true (simulation only).",
  inputSchema: {
    type: "object" as const,
    properties: {
      request_id: {
        type: "string",
        description: "The withdrawal request ID (token ID) to transfer.",
      },
      to: {
        type: "string",
        description: "Recipient address (0x...).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["request_id", "to"],
  },
  annotations: {
    title: "[Withdrawals] Transfer Withdrawal NFT",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const transferNftSchema = z.object({
  request_id: z.string().regex(/^\d+$/),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  dry_run: z.boolean().optional().default(true),
});

export async function handleTransferWithdrawalNft(args: Record<string, unknown>) {
  try {
    const { request_id, to, dry_run } = transferNftSchema.parse(args);
    const queueAddr = getWithdrawalQueueAddress();
    const sender = getAccountAddress();
    const tokenId = BigInt(request_id);

    const receiverError = validateReceiver(to);
    if (receiverError) return errorResult(receiverError);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: queueAddr,
          abi: withdrawalQueueNftAbi,
          functionName: "transferFrom",
          args: [sender, to as Address, tokenId],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const lines = [
        `=== DRY RUN: Transfer Withdrawal NFT ===`,
        "",
        `Request ID: ${request_id}`,
        `From: ${sender}`,
        `To: ${to}`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];
      if (simulationError) lines.push(`Simulation note: ${simulationError}`);

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: queueAddr,
      abi: withdrawalQueueNftAbi,
      functionName: "transferFrom",
      args: [sender, to as Address, tokenId],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Withdrawal NFT Transferred ===`,
        `Transaction hash: ${txHash}`,
        `Request ID: ${request_id}`,
        `From: ${sender}`,
        `To: ${to}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const approveWithdrawalNftToolDef = {
  name: "lido_approve_withdrawal_nft",
  description:
    "Approve an address to transfer a specific withdrawal request NFT. " +
    "Defaults to dry_run=true (simulation only).",
  inputSchema: {
    type: "object" as const,
    properties: {
      request_id: {
        type: "string",
        description: "The withdrawal request ID (token ID).",
      },
      approved: {
        type: "string",
        description: "Address to approve for transferring this NFT (0x...).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["request_id", "approved"],
  },
  annotations: {
    title: "[Withdrawals] Approve Withdrawal NFT",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const approveNftSchema = z.object({
  request_id: z.string().regex(/^\d+$/),
  approved: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  dry_run: z.boolean().optional().default(true),
});

export async function handleApproveWithdrawalNft(args: Record<string, unknown>) {
  try {
    const { request_id, approved, dry_run } = approveNftSchema.parse(args);
    const queueAddr = getWithdrawalQueueAddress();
    const sender = getAccountAddress();
    const tokenId = BigInt(request_id);

    const receiverError = validateReceiver(approved);
    if (receiverError) return errorResult(receiverError);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: queueAddr,
          abi: withdrawalQueueNftAbi,
          functionName: "approve",
          args: [approved as Address, tokenId],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const lines = [
        `=== DRY RUN: Approve Withdrawal NFT ===`,
        "",
        `Request ID: ${request_id}`,
        `Approved address: ${approved}`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];
      if (simulationError) lines.push(`Simulation note: ${simulationError}`);

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: queueAddr,
      abi: withdrawalQueueNftAbi,
      functionName: "approve",
      args: [approved as Address, tokenId],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Withdrawal NFT Approval ===`,
        `Transaction hash: ${txHash}`,
        `Request ID: ${request_id}`,
        `Approved address: ${approved}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}
