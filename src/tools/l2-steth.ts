import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { validateReceiver, validateAmountCap } from "../utils/security.js";

/** Rebasing stETH on Optimism (launched Oct 2024). */
const OP_STETH_ADDRESS: Address = "0x76A50b8c7349cCDDb7578c6627e79b5d99D24138";

const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// --- Balance tool ---

export const l2StethBalanceToolDef = {
  name: "lido_l2_get_steth_balance",
  description:
    "Get rebasing stETH and native ETH balances on Optimism. " +
    "stETH on Optimism rebases via the L1 oracle rate — your balance grows automatically as staking rewards accrue. " +
    "If no address is provided, uses the configured wallet address.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address (0x...). Defaults to the configured wallet.",
      },
    },
  },
  annotations: {
    title: "Get stETH Balance (Optimism)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const balanceSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function handleL2GetStethBalance(args: Record<string, unknown>) {
  try {
    const { address: rawAddr } = balanceSchema.parse(args);
    const address = (rawAddr ?? getAccountAddress()) as Address;

    const [ethBalance, stethBalance] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.readContract({
        address: OP_STETH_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);

    const lines = [
      `Balances for ${address} on Optimism:`,
      `  ETH:   ${formatEther(ethBalance)}`,
      `  stETH: ${formatEther(stethBalance)}`,
      "",
      "Note: stETH on Optimism is a rebasing token — your balance grows automatically",
      "as staking rewards accrue via the L1 oracle rate. There may be 1-2 wei rounding",
      "differences due to the rebasing mechanism.",
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

// --- Transfer tool ---

export const l2StethTransferToolDef = {
  name: "lido_l2_transfer_steth",
  description:
    "Transfer rebasing stETH to another address on Optimism. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute. " +
    "Note: transferred amounts may differ by 1-2 wei due to stETH rebasing mechanics.",
  inputSchema: {
    type: "object" as const,
    properties: {
      to: {
        type: "string",
        description: "Recipient address (0x...).",
      },
      amount: {
        type: "string",
        description: "Amount of stETH to transfer (e.g. '1.0').",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only — no transaction sent. Default: true.",
      },
    },
    required: ["to", "amount"],
  },
  annotations: {
    title: "Transfer stETH (Optimism)",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const transferSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleL2TransferSteth(args: Record<string, unknown>) {
  try {
    const { to, amount, dry_run } = transferSchema.parse(args);
    const amountWei = parseEther(amount);
    const sender = getAccountAddress();

    const receiverError = validateReceiver(to);
    if (receiverError) return errorResult(receiverError);

    const capError = validateAmountCap(amountWei);
    if (capError) return errorResult(capError);

    const balance = await publicClient.readContract({
      address: OP_STETH_ADDRESS,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [sender],
    });

    if (balance < amountWei) {
      return errorResult(
        `Insufficient stETH balance on Optimism. ` +
        `You have ${formatEther(balance)} stETH but are trying to transfer ${amount} stETH.`
      );
    }

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 65_000n;
      let gasEstimateNote = "(using conservative estimate)";

      try {
        await publicClient.simulateContract({
          address: OP_STETH_ADDRESS,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, amountWei],
          account: sender,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: OP_STETH_ADDRESS,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, amountWei],
          account: sender,
        });
        gasEstimateNote = "";
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      const lines = [
        "=== DRY RUN: Transfer stETH on Optimism ===",
        "",
        `From: ${sender}`,
        `To: ${to}`,
        `Amount: ${amount} stETH`,
        `Your balance: ${formatEther(balance)} stETH`,
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
        "Note: stETH is a rebasing token. The received amount may differ by 1-2 wei",
        "due to share-based accounting in the stETH contract.",
      );

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: OP_STETH_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as Address, amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const lines = [
      "=== stETH Transfer on Optimism ===",
      `Transaction hash: ${txHash}`,
      `From: ${sender}`,
      `To: ${to}`,
      `Amount: ${amount} stETH`,
      `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      "",
      "Note: The received amount may differ by 1-2 wei due to stETH rebasing mechanics.",
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
