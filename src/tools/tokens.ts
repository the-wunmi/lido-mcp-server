import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { publicClient, walletClient, getAccountAddress, sdk } from "../sdk-factory.js";
import { appConfig, STETH_ADDRESSES, WSTETH_ADDRESSES, LDO_ADDRESSES } from "../config.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { validateReceiver, validateAmountCap } from "../utils/security.js";
import { erc20Abi } from "../utils/erc20-abi.js";

const TOKEN_ADDRESSES: Record<string, Record<number, Address>> = {
  stETH: STETH_ADDRESSES as Record<number, Address>,
  wstETH: WSTETH_ADDRESSES as Record<number, Address>,
  LDO: LDO_ADDRESSES as Record<number, Address>,
};

const TOKEN_DISPLAY_NAMES: Record<string, string> = {
  STETH: "stETH",
  WSTETH: "wstETH",
  LDO: "LDO",
};

function resolveTokenSymbol(token: string): string {
  const symbol = TOKEN_DISPLAY_NAMES[token.toUpperCase()];
  if (!symbol) throw new Error(`Unknown token: ${token}. Supported: stETH, wstETH, LDO.`);
  return symbol;
}

function resolveTokenAddress(token: string): Address {
  const upper = token.toUpperCase();
  const mapping = upper === "STETH" ? TOKEN_ADDRESSES.stETH
    : upper === "WSTETH" ? TOKEN_ADDRESSES.wstETH
    : upper === "LDO" ? TOKEN_ADDRESSES.LDO
    : null;

  if (!mapping) throw new Error(`Unknown token: ${token}. Supported: stETH, wstETH, LDO.`);
  const addr = mapping[appConfig.chainId];
  if (!addr) throw new Error(`${token} not available on chain ${appConfig.chainId}.`);
  return addr;
}

export const tokenInfoToolDef = {
  name: "lido_get_token_info",
  description:
    "Get token metadata for stETH, wstETH, or LDO: name, symbol, decimals, total supply, and contract address.",
  inputSchema: {
    type: "object" as const,
    properties: {
      token: {
        type: "string",
        enum: ["stETH", "wstETH", "LDO"],
        description: "Token to query.",
      },
    },
    required: ["token"],
  },
  annotations: {
    title: "[Tokens] Token Info",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const tokenInfoSchema = z.object({
  token: z.string(),
});

export async function handleGetTokenInfo(args: Record<string, unknown>) {
  try {
    const { token } = tokenInfoSchema.parse(args);
    const tokenAddr = resolveTokenAddress(token);

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "name" }),
      publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "symbol" }),
      publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "decimals" }),
      publicClient.readContract({ address: tokenAddr, abi: erc20Abi, functionName: "totalSupply" }),
    ]);

    const lines = [
      `=== ${symbol} Token Info ===`,
      "",
      `Name: ${name}`,
      `Symbol: ${symbol}`,
      `Decimals: ${decimals}`,
      `Total supply: ${formatEther(totalSupply as bigint)} ${symbol}`,
      `Contract: ${tokenAddr}`,
      `Chain: ${appConfig.chain.name} (${appConfig.chainId})`,
    ];

    const upper = token.toUpperCase();
    if (upper === "STETH" || upper === "WSTETH") {
      try {
        const [stethPerWsteth, wstethPerSteth] = await Promise.all([
          sdk.wsteth.convertToSteth(10n ** 18n),
          sdk.wsteth.convertToWsteth(10n ** 18n),
        ]);
        lines.push("");
        lines.push("Exchange rates:");
        lines.push(`  1 wstETH = ${formatEther(stethPerWsteth)} stETH`);
        lines.push(`  1 stETH = ${formatEther(wstethPerSteth)} wstETH`);
      } catch {
        // Exchange rate unavailable on this chain
      }
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const allowanceToolDef = {
  name: "lido_get_allowance",
  description:
    "Check the token allowance for a spender address. Shows how much of your stETH/wstETH/LDO " +
    "a spender is authorized to use.",
  inputSchema: {
    type: "object" as const,
    properties: {
      token: {
        type: "string",
        enum: ["stETH", "wstETH", "LDO"],
        description: "Token to check.",
      },
      spender: {
        type: "string",
        description: "Spender address to check allowance for (0x...).",
      },
      owner: {
        type: "string",
        description: "Owner address. Defaults to configured wallet.",
      },
    },
    required: ["token", "spender"],
  },
  annotations: {
    title: "[Tokens] Check Allowance",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const allowanceSchema = z.object({
  token: z.string(),
  spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  owner: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function handleGetAllowance(args: Record<string, unknown>) {
  try {
    const { token, spender, owner: rawOwner } = allowanceSchema.parse(args);
    const tokenAddr = resolveTokenAddress(token);
    const ownerAddr = (rawOwner ?? getAccountAddress()) as Address;

    const allowance = await publicClient.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ownerAddr, spender as Address],
    }) as bigint;

    const symbol = resolveTokenSymbol(token);

    const lines = [
      `=== ${symbol} Allowance ===`,
      "",
      `Owner: ${ownerAddr}`,
      `Spender: ${spender}`,
      `Allowance: ${formatEther(allowance)} ${symbol}`,
      allowance === 0n
        ? "The spender has no allowance to use your tokens."
        : `The spender can use up to ${formatEther(allowance)} ${symbol} on your behalf.`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const approveTokenToolDef = {
  name: "lido_approve_token",
  description:
    "Approve a spender to use stETH, wstETH, or LDO tokens on your behalf. " +
    "Required before DeFi interactions. Defaults to dry_run=true.",
  inputSchema: {
    type: "object" as const,
    properties: {
      token: {
        type: "string",
        enum: ["stETH", "wstETH", "LDO"],
        description: "Token to approve.",
      },
      spender: {
        type: "string",
        description: "Spender address to approve (0x...).",
      },
      amount: {
        type: "string",
        description: "Amount to approve (e.g. '100.0'). Use 'max' for unlimited.",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["token", "spender", "amount"],
  },
  annotations: {
    title: "[Tokens] Approve Token",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const approveTokenSchema = z.object({
  token: z.string(),
  spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string(),
  dry_run: z.boolean().optional().default(true),
});

export async function handleApproveToken(args: Record<string, unknown>) {
  try {
    const { token, spender, amount, dry_run } = approveTokenSchema.parse(args);
    const tokenAddr = resolveTokenAddress(token);
    const sender = getAccountAddress();
    const symbol = resolveTokenSymbol(token);

    const amountWei = amount.toLowerCase() === "max"
      ? BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")
      : parseEther(amount);

    const isUnlimited = amount.toLowerCase() === "max";
    const displayAmount = isUnlimited ? "unlimited" : `${amount} ${symbol}`;

    if (dry_run) {
      const [balance, currentAllowance] = await Promise.all([
        publicClient.readContract({
          address: tokenAddr, abi: erc20Abi, functionName: "balanceOf", args: [sender],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: tokenAddr, abi: erc20Abi, functionName: "allowance", args: [sender, spender as Address],
        }) as Promise<bigint>,
      ]);

      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender as Address, amountWei],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      return textResult(
        [
          `=== DRY RUN: Approve ${symbol} ===`,
          "",
          `Token: ${symbol} (${tokenAddr})`,
          `Spender: ${spender}`,
          `Amount: ${displayAmount}`,
          "",
          `Your balance: ${formatEther(balance)} ${symbol}`,
          `Current allowance: ${formatEther(currentAllowance)} ${symbol}`,
          ...(currentAllowance > 0n && !isUnlimited ? [
            `After approval: ${formatEther(amountWei)} ${symbol} (replaces current allowance)`,
          ] : []),
          ...(currentAllowance > 0n && amountWei > 0n && token.toUpperCase() === "STETH" ? [
            "",
            "WARNING: stETH has non-standard approval behavior due to rebasing.",
            "Setting a new allowance when the current allowance is non-zero may be",
            "vulnerable to a front-running race condition. Consider revoking the",
            "existing allowance first (lido_revoke_approval), then approving the new amount.",
          ] : []),
          ...(isUnlimited ? [
            "",
            "WARNING: Unlimited approvals allow this spender to use your entire",
            `${symbol} balance at any time. Prefer approving specific amounts when possible.`,
          ] : []),
          "",
          `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
          ...(simulationError ? [`Simulation note: ${simulationError}`] : []),
        ].join("\n")
      );
    }

    const txHash = await walletClient.writeContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender as Address, amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== ${symbol} Approval ===`,
        `Transaction hash: ${txHash}`,
        `Spender: ${spender}`,
        `Amount: ${displayAmount}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const transferTokenToolDef = {
  name: "lido_transfer_token",
  description:
    "Transfer stETH, wstETH, or LDO tokens to another address. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      token: {
        type: "string",
        enum: ["stETH", "wstETH", "LDO"],
        description: "Token to transfer.",
      },
      to: {
        type: "string",
        description: "Recipient address (0x...).",
      },
      amount: {
        type: "string",
        description: "Amount to transfer (e.g. '1.0').",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["token", "to", "amount"],
  },
  annotations: {
    title: "[Tokens] Transfer Token",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const transferTokenSchema = z.object({
  token: z.string(),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleTransferToken(args: Record<string, unknown>) {
  try {
    const { token, to, amount, dry_run } = transferTokenSchema.parse(args);
    const tokenAddr = resolveTokenAddress(token);
    const sender = getAccountAddress();
    const amountWei = parseEther(amount);
    const symbol = resolveTokenSymbol(token);

    const receiverError = validateReceiver(to);
    if (receiverError) return errorResult(receiverError);

    const capError = validateAmountCap(amountWei);
    if (capError) return errorResult(capError);

    const balance = await publicClient.readContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [sender],
    }) as bigint;

    if (balance < amountWei) {
      return errorResult(
        `Insufficient ${symbol} balance. You have ${formatEther(balance)} ${symbol} ` +
        `but are trying to transfer ${amount} ${symbol}.`
      );
    }

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 65_000n;

      try {
        await publicClient.simulateContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, amountWei],
          account: sender,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, amountWei],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      return textResult(
        [
          `=== DRY RUN: Transfer ${symbol} ===`,
          "",
          `From: ${sender}`,
          `To: ${to}`,
          `Amount: ${amount} ${symbol}`,
          `Your balance: ${formatEther(balance)} ${symbol}`,
          "",
          `Gas estimate: ${gasEstimate.toString()}`,
          `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
          "",
          `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
          ...(simulationError ? [`Simulation note: ${simulationError}`] : []),
        ].join("\n")
      );
    }

    const txHash = await walletClient.writeContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: "transfer",
      args: [to as Address, amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== ${symbol} Transfer ===`,
        `Transaction hash: ${txHash}`,
        `From: ${sender}`,
        `To: ${to}`,
        `Amount: ${amount} ${symbol}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const revokeApprovalToolDef = {
  name: "lido_revoke_approval",
  description:
    "Revoke a previous token approval by setting allowance to 0. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      token: {
        type: "string",
        enum: ["stETH", "wstETH", "LDO"],
        description: "Token to revoke approval for.",
      },
      spender: {
        type: "string",
        description: "Spender address to revoke (0x...).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["token", "spender"],
  },
  annotations: {
    title: "[Tokens] Revoke Approval",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const revokeApprovalSchema = z.object({
  token: z.string(),
  spender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  dry_run: z.boolean().optional().default(true),
});

export async function handleRevokeApproval(args: Record<string, unknown>) {
  try {
    const { token, spender, dry_run } = revokeApprovalSchema.parse(args);
    const tokenAddr = resolveTokenAddress(token);
    const sender = getAccountAddress();
    const symbol = resolveTokenSymbol(token);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: tokenAddr,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender as Address, 0n],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      return textResult(
        [
          `=== DRY RUN: Revoke ${symbol} Approval ===`,
          "",
          `Token: ${symbol} (${tokenAddr})`,
          `Spender: ${spender}`,
          `Action: Set allowance to 0`,
          "",
          `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
          ...(simulationError ? [`Simulation note: ${simulationError}`] : []),
        ].join("\n")
      );
    }

    const txHash = await walletClient.writeContract({
      address: tokenAddr,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender as Address, 0n],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== ${symbol} Approval Revoked ===`,
        `Transaction hash: ${txHash}`,
        `Spender: ${spender}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}
