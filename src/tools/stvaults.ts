import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { publicClient, walletClient, getAccountAddress } from "../sdk-factory.js";
import { appConfig, STETH_ADDRESSES } from "../config.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError, sanitizeErrorMessage } from "../utils/errors.js";
import { validateReceiver, validateAmountCap } from "../utils/security.js";
import {
  vaultHubAbi,
  vaultFactoryAbi,
  stakingVaultAbi,
  getVaultHubAddress,
  getVaultFactoryAddress,
} from "../utils/vaulthub-abi.js";

interface VaultPreFlight {
  connected: boolean;
  healthy: boolean;
  totalValue: bigint;
  withdrawableValue: bigint;
  owner: string | null;
  nodeOperator: string | null;
  depositor: string | null;
}

async function getVaultPreFlight(hubAddress: Address, vaultAddr: Address): Promise<VaultPreFlight> {
  const results = await publicClient.multicall({
    contracts: [
      { address: hubAddress, abi: vaultHubAbi, functionName: "isVaultConnected" as const, args: [vaultAddr] },
      { address: hubAddress, abi: vaultHubAbi, functionName: "isVaultHealthy" as const, args: [vaultAddr] },
      { address: hubAddress, abi: vaultHubAbi, functionName: "totalValue" as const, args: [vaultAddr] },
      { address: hubAddress, abi: vaultHubAbi, functionName: "withdrawableValue" as const, args: [vaultAddr] },
      { address: vaultAddr, abi: stakingVaultAbi, functionName: "owner" as const },
      { address: vaultAddr, abi: stakingVaultAbi, functionName: "nodeOperator" as const },
      { address: vaultAddr, abi: stakingVaultAbi, functionName: "depositor" as const },
    ],
  });
  return {
    connected: results[0]?.status === "success" ? results[0].result as boolean : false,
    healthy: results[1]?.status === "success" ? results[1].result as boolean : false,
    totalValue: results[2]?.status === "success" ? results[2].result as bigint : 0n,
    withdrawableValue: results[3]?.status === "success" ? results[3].result as bigint : 0n,
    owner: results[4]?.status === "success" ? results[4].result as string : null,
    nodeOperator: results[5]?.status === "success" ? results[5].result as string : null,
    depositor: results[6]?.status === "success" ? results[6].result as string : null,
  };
}

function preFlightLines(pf: VaultPreFlight): string[] {
  return [
    "Vault status:",
    `  Connected: ${pf.connected}`,
    `  Healthy: ${pf.healthy}`,
    `  Total value: ${formatEther(pf.totalValue)} ETH`,
    `  Withdrawable: ${formatEther(pf.withdrawableValue)} ETH`,
  ];
}

function roleWarning(sender: Address, pf: VaultPreFlight, requiredRole: "owner" | "nodeOperator" | "depositor"): string[] {
  const roleAddr = pf[requiredRole];
  if (!roleAddr) return [];
  const senderLower = sender.toLowerCase();
  if (roleAddr.toLowerCase() === senderLower) return [];
  const roleLabel = requiredRole === "nodeOperator" ? "node operator" : requiredRole;
  return [`WARNING: Your address (${sender}) is not the vault ${roleLabel} (${roleAddr}). This transaction will likely revert.`];
}

export const listVaultsToolDef = {
  name: "lido_list_vaults",
  description:
    "List staking vaults from the Lido VaultHub with pagination. " +
    "Returns vault addresses with connection status, health, and total value.",
  inputSchema: {
    type: "object" as const,
    properties: {
      count: {
        type: "number",
        description: "Number of vaults to return (max 50, default 10).",
      },
      offset: {
        type: "number",
        description: "Starting vault index, 1-indexed per the on-chain contract (default 1).",
      },
    },
  },
  annotations: {
    title: "[stVaults] List Vaults",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const listVaultsSchema = z.object({
  count: z.number().min(1).max(50).optional().default(10),
  offset: z.number().min(1).optional().default(1),
});

export async function handleListVaults(args: Record<string, unknown>) {
  try {
    const { count, offset } = listVaultsSchema.parse(args);
    const hubAddress = getVaultHubAddress();

    const totalVaults = await publicClient.readContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "vaultsCount",
    }) as bigint;

    const total = Number(totalVaults);
    if (total === 0) {
      return textResult("No vaults found on VaultHub.");
    }

    if (offset > total) {
      return textResult(`Offset ${offset} exceeds total vault count (${total}).`);
    }

    const endIndex = Math.min(offset + count - 1, total);
    const indices: number[] = [];
    for (let i = offset; i <= endIndex; i++) indices.push(i);

    const addressResults = await publicClient.multicall({
      contracts: indices.map((i) => ({
        address: hubAddress,
        abi: vaultHubAbi,
        functionName: "vaultByIndex" as const,
        args: [BigInt(i)],
      })),
    });

    const vaultAddresses: Address[] = [];
    for (const result of addressResults) {
      if (result.status === "success") {
        vaultAddresses.push(result.result as Address);
      }
    }

    const detailCalls = vaultAddresses.flatMap((addr) => [
      { address: hubAddress, abi: vaultHubAbi, functionName: "isVaultConnected" as const, args: [addr] },
      { address: hubAddress, abi: vaultHubAbi, functionName: "isVaultHealthy" as const, args: [addr] },
      { address: hubAddress, abi: vaultHubAbi, functionName: "totalValue" as const, args: [addr] },
    ]);

    const detailResults = await publicClient.multicall({ contracts: detailCalls });

    const lines = [
      `=== Lido Staking Vaults ===`,
      `VaultHub: ${hubAddress}`,
      `Total vaults: ${total}`,
      `Showing: ${offset} to ${endIndex}`,
      "",
    ];

    vaultAddresses.forEach((addr, idx) => {
      const base = idx * 3;
      const connected = detailResults[base]?.status === "success" ? detailResults[base].result as boolean : null;
      const healthy = detailResults[base + 1]?.status === "success" ? detailResults[base + 1].result as boolean : null;
      const value = detailResults[base + 2]?.status === "success" ? detailResults[base + 2].result as bigint : null;

      lines.push(`Vault #${indices[idx]}: ${addr}`);
      lines.push(`  Connected: ${connected ?? "unknown"}`);
      lines.push(`  Healthy: ${healthy ?? "unknown"}`);
      lines.push(`  Total value: ${value !== null ? formatEther(value) + " ETH" : "unavailable"}`);
      lines.push("");
    });

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const getVaultToolDef = {
  name: "lido_get_vault",
  description:
    "Get detailed information about a specific Lido staking vault. " +
    "Shows VaultHub status (connected, healthy, value, locked) and vault config (owner, operator, depositor).",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address (0x...).",
      },
    },
    required: ["vault_address"],
  },
  annotations: {
    title: "[stVaults] Get Vault Details",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const getVaultSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function handleGetVault(args: Record<string, unknown>) {
  try {
    const { vault_address } = getVaultSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;

    const results = await publicClient.multicall({
      contracts: [
        { address: hubAddress, abi: vaultHubAbi, functionName: "isVaultConnected", args: [vaultAddr] },
        { address: hubAddress, abi: vaultHubAbi, functionName: "isVaultHealthy", args: [vaultAddr] },
        { address: hubAddress, abi: vaultHubAbi, functionName: "totalValue", args: [vaultAddr] },
        { address: hubAddress, abi: vaultHubAbi, functionName: "withdrawableValue", args: [vaultAddr] },
        { address: hubAddress, abi: vaultHubAbi, functionName: "locked", args: [vaultAddr] },
        { address: hubAddress, abi: vaultHubAbi, functionName: "liabilityShares", args: [vaultAddr] },
        { address: vaultAddr, abi: stakingVaultAbi, functionName: "owner" },
        { address: vaultAddr, abi: stakingVaultAbi, functionName: "nodeOperator" },
        { address: vaultAddr, abi: stakingVaultAbi, functionName: "depositor" },
        { address: vaultAddr, abi: stakingVaultAbi, functionName: "beaconChainDepositsPaused" },
        { address: vaultAddr, abi: stakingVaultAbi, functionName: "withdrawalCredentials" },
      ],
    });

    const val = (i: number) => results[i]?.status === "success" ? results[i].result : null;

    const connected = val(0) as boolean | null;
    const healthy = val(1) as boolean | null;
    const totalValue = val(2) as bigint | null;
    const withdrawableValue = val(3) as bigint | null;
    const lockedValue = val(4) as bigint | null;
    const liabilityShares = val(5) as bigint | null;
    const owner = val(6) as string | null;
    const nodeOperator = val(7) as string | null;
    const depositor = val(8) as string | null;
    const depositsPaused = val(9) as boolean | null;
    const withdrawalCreds = val(10) as string | null;

    const lines = [
      `=== Vault Details: ${vaultAddr} ===`,
      "",
      "VaultHub Status:",
      `  Connected: ${connected ?? "unknown"}`,
      `  Healthy: ${healthy ?? "unknown"}`,
      `  Total value: ${totalValue !== null ? formatEther(totalValue) + " ETH" : "unavailable"}`,
      `  Withdrawable: ${withdrawableValue !== null ? formatEther(withdrawableValue) + " ETH" : "unavailable"}`,
      `  Locked: ${lockedValue !== null ? formatEther(lockedValue) + " ETH" : "unavailable"}`,
      `  Liability shares: ${liabilityShares !== null ? liabilityShares.toString() : "unavailable"}`,
      "",
      "Vault Configuration:",
      `  Owner: ${owner ?? "unavailable"}`,
      `  Node operator: ${nodeOperator ?? "unavailable"}`,
      `  Depositor: ${depositor ?? "unavailable"}`,
      `  Beacon deposits paused: ${depositsPaused ?? "unavailable"}`,
      `  Withdrawal credentials: ${withdrawalCreds ?? "unavailable"}`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultHubStatsToolDef = {
  name: "lido_get_vault_hub_stats",
  description:
    "Get VaultHub overview: total vault count, hub address, and factory address.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "[stVaults] VaultHub Stats",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleGetVaultHubStats(_args: Record<string, unknown>) {
  try {
    const hubAddress = getVaultHubAddress();
    const factoryAddress = getVaultFactoryAddress();

    const totalVaults = await publicClient.readContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "vaultsCount",
    }) as bigint;

    const lines = [
      `=== VaultHub Statistics ===`,
      "",
      `VaultHub address: ${hubAddress}`,
      `VaultFactory address: ${factoryAddress ?? "not available on this chain"}`,
      `Total vaults: ${totalVaults.toString()}`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultFundToolDef = {
  name: "lido_vault_fund",
  description:
    "Deposit ETH into a Lido staking vault via VaultHub. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address to fund (0x...).",
      },
      amount: {
        type: "string",
        description: "Amount of ETH to deposit (e.g. '1.0').",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vault_address", "amount"],
  },
  annotations: {
    title: "[stVaults] Fund Vault",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const vaultFundSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultFund(args: Record<string, unknown>) {
  try {
    const { vault_address, amount, dry_run } = vaultFundSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;
    const amountWei = parseEther(amount);
    const sender = getAccountAddress();

    const capError = validateAmountCap(amountWei);
    if (capError) return errorResult(capError);

    const ethBalance = await publicClient.getBalance({ address: sender });
    if (ethBalance < amountWei) {
      return errorResult(
        `Insufficient ETH balance. You have ${formatEther(ethBalance)} ETH ` +
        `but are trying to fund with ${amount} ETH.`
      );
    }

    const pf = await getVaultPreFlight(hubAddress, vaultAddr);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 100_000n;

      try {
        await publicClient.simulateContract({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "fund",
          args: [vaultAddr],
          value: amountWei,
          account: sender,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "fund",
          args: [vaultAddr],
          value: amountWei,
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      const lines = [
        `=== DRY RUN: Fund Vault ===`,
        "",
        `Vault: ${vaultAddr}`,
        `Amount: ${amount} ETH`,
        `Your balance: ${formatEther(ethBalance)} ETH`,
        "",
        ...preFlightLines(pf),
        ...(pf.connected === false ? ["NOTE: Vault is NOT connected to VaultHub. Funding may fail."] : []),
        ...roleWarning(sender, pf, "depositor"),
        "",
        `Gas estimate: ${gasEstimate.toString()}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];
      if (simulationError) lines.push(`Simulation note: ${simulationError}`);

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "fund",
      args: [vaultAddr],
      value: amountWei,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const lines = [
      `=== Vault Funded ===`,
      `Transaction hash: ${txHash}`,
      `Vault: ${vaultAddr}`,
      `Amount: ${amount} ETH`,
      `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      `Gas used: ${receipt.gasUsed.toString()}`,
    ];

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultWithdrawToolDef = {
  name: "lido_vault_withdraw",
  description:
    "Withdraw ETH from a Lido staking vault via VaultHub. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address (0x...).",
      },
      recipient: {
        type: "string",
        description: "Recipient address for withdrawn ETH (0x...). Defaults to configured wallet.",
      },
      amount: {
        type: "string",
        description: "Amount of ETH to withdraw (e.g. '1.0').",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vault_address", "amount"],
  },
  annotations: {
    title: "[stVaults] Withdraw from Vault",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const vaultWithdrawSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  amount: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultWithdraw(args: Record<string, unknown>) {
  try {
    const { vault_address, recipient: rawRecipient, amount, dry_run } = vaultWithdrawSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;
    const recipientAddr = (rawRecipient ?? getAccountAddress()) as Address;
    const amountWei = parseEther(amount);
    const sender = getAccountAddress();

    if (rawRecipient) {
      const receiverError = validateReceiver(rawRecipient);
      if (receiverError) return errorResult(receiverError);
    }

    const capError = validateAmountCap(amountWei);
    if (capError) return errorResult(capError);

    const pf = await getVaultPreFlight(hubAddress, vaultAddr);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let gasEstimate = 100_000n;

      try {
        await publicClient.simulateContract({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "withdraw",
          args: [vaultAddr, recipientAddr, amountWei],
          account: sender,
        });
        gasEstimate = await publicClient.estimateContractGas({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "withdraw",
          args: [vaultAddr, recipientAddr, amountWei],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const gasPrice = await publicClient.getGasPrice();
      const gasCostWei = gasEstimate * gasPrice;

      const lines = [
        `=== DRY RUN: Vault Withdrawal ===`,
        "",
        `Vault: ${vaultAddr}`,
        `Recipient: ${recipientAddr}`,
        `Amount: ${amount} ETH`,
        "",
        ...preFlightLines(pf),
        ...(amountWei > pf.withdrawableValue ? [`NOTE: Requested ${amount} ETH exceeds withdrawable value (${formatEther(pf.withdrawableValue)} ETH).`] : []),
        ...roleWarning(sender, pf, "owner"),
        "",
        `Gas estimate: ${gasEstimate.toString()}`,
        `Estimated gas cost: ${formatEther(gasCostWei)} ETH`,
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];
      if (simulationError) lines.push(`Simulation note: ${simulationError}`);

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "withdraw",
      args: [vaultAddr, recipientAddr, amountWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Vault Withdrawal ===`,
        `Transaction hash: ${txHash}`,
        `Vault: ${vaultAddr}`,
        `Recipient: ${recipientAddr}`,
        `Amount: ${amount} ETH`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultPauseToolDef = {
  name: "lido_vault_pause_beacon_deposits",
  description:
    "Pause beacon chain deposits for a staking vault. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address (0x...).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vault_address"],
  },
  annotations: {
    title: "[stVaults] Pause Vault Deposits",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const vaultPauseSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultPause(args: Record<string, unknown>) {
  try {
    const { vault_address, dry_run } = vaultPauseSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;
    const sender = getAccountAddress();

    const pf = await getVaultPreFlight(hubAddress, vaultAddr);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "pauseBeaconChainDeposits",
          args: [vaultAddr],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const lines = [
        `=== DRY RUN: Pause Beacon Deposits ===`,
        "",
        `Vault: ${vaultAddr}`,
        ...preFlightLines(pf),
        ...roleWarning(sender, pf, "owner"),
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];
      if (simulationError) lines.push(`Simulation note: ${simulationError}`);

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "pauseBeaconChainDeposits",
      args: [vaultAddr],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Beacon Deposits Paused ===`,
        `Transaction hash: ${txHash}`,
        `Vault: ${vaultAddr}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultResumeToolDef = {
  name: "lido_vault_resume_beacon_deposits",
  description:
    "Resume beacon chain deposits for a staking vault. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address (0x...).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vault_address"],
  },
  annotations: {
    title: "[stVaults] Resume Vault Deposits",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const vaultResumeSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultResume(args: Record<string, unknown>) {
  try {
    const { vault_address, dry_run } = vaultResumeSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;
    const sender = getAccountAddress();

    const pf = await getVaultPreFlight(hubAddress, vaultAddr);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "resumeBeaconChainDeposits",
          args: [vaultAddr],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const lines = [
        `=== DRY RUN: Resume Beacon Deposits ===`,
        "",
        `Vault: ${vaultAddr}`,
        ...preFlightLines(pf),
        ...roleWarning(sender, pf, "owner"),
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];
      if (simulationError) lines.push(`Simulation note: ${simulationError}`);

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "resumeBeaconChainDeposits",
      args: [vaultAddr],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Beacon Deposits Resumed ===`,
        `Transaction hash: ${txHash}`,
        `Vault: ${vaultAddr}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultMintSharesToolDef = {
  name: "lido_vault_mint_shares",
  description:
    "Mint stETH shares against a staking vault's locked ETH collateral via VaultHub. " +
    "The vault must be connected and healthy, and the mint must not exceed the vault's minting capacity. " +
    "Defaults to dry_run=true (simulation only).",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address (0x...).",
      },
      recipient: {
        type: "string",
        description: "Recipient address for the minted stETH shares (0x...). Defaults to configured wallet.",
      },
      shares: {
        type: "string",
        description: "Amount of shares to mint (in ETH-scale units, e.g. '1.0' = 1e18 shares).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vault_address", "shares"],
  },
  annotations: {
    title: "[stVaults] Mint Vault Shares",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const vaultMintSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  recipient: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  shares: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultMintShares(args: Record<string, unknown>) {
  try {
    const { vault_address, recipient: rawRecipient, shares, dry_run } = vaultMintSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;
    const recipientAddr = (rawRecipient ?? getAccountAddress()) as Address;
    const sharesWei = parseEther(shares);
    const sender = getAccountAddress();

    if (rawRecipient) {
      const receiverError = validateReceiver(rawRecipient);
      if (receiverError) return errorResult(receiverError);
    }

    const pf = await getVaultPreFlight(hubAddress, vaultAddr);

    const [capacity, liabilityShares, healthy] = await Promise.all([
      publicClient.readContract({
        address: hubAddress, abi: vaultHubAbi,
        functionName: "totalMintingCapacityShares", args: [vaultAddr, 0n],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: hubAddress, abi: vaultHubAbi,
        functionName: "liabilityShares", args: [vaultAddr],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: hubAddress, abi: vaultHubAbi,
        functionName: "isVaultHealthy", args: [vaultAddr],
      }) as Promise<boolean>,
    ]);

    const remainingCapacity = capacity > liabilityShares ? capacity - liabilityShares : 0n;

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "mintShares",
          args: [vaultAddr, recipientAddr, sharesWei],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      return textResult(
        [
          `=== DRY RUN: Mint Vault Shares ===`,
          "",
          `Vault: ${vaultAddr}`,
          `Recipient: ${recipientAddr}`,
          `Shares to mint: ${shares}`,
          "",
          `Vault healthy: ${healthy}`,
          `Current liability shares: ${formatEther(liabilityShares)}`,
          `Total minting capacity: ${formatEther(capacity)}`,
          `Remaining capacity: ${formatEther(remainingCapacity)}`,
          ...(sharesWei > remainingCapacity ? [`NOTE: Requested ${shares} shares exceeds remaining capacity (${formatEther(remainingCapacity)}).`] : []),
          ...roleWarning(sender, pf, "owner"),
          "",
          `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
          ...(simulationError ? [`Simulation note: ${simulationError}`] : []),
        ].join("\n")
      );
    }

    const txHash = await walletClient.writeContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "mintShares",
      args: [vaultAddr, recipientAddr, sharesWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Vault Shares Minted ===`,
        `Transaction hash: ${txHash}`,
        `Vault: ${vaultAddr}`,
        `Recipient: ${recipientAddr}`,
        `Shares minted: ${shares}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultBurnSharesToolDef = {
  name: "lido_vault_burn_shares",
  description:
    "Burn stETH shares to reduce a vault's liability on VaultHub. " +
    "The shares must have been previously transferred to VaultHub. " +
    "Defaults to dry_run=true (simulation only).",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address (0x...).",
      },
      shares: {
        type: "string",
        description: "Amount of shares to burn (in ETH-scale units, e.g. '1.0' = 1e18 shares).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vault_address", "shares"],
  },
  annotations: {
    title: "[stVaults] Burn Vault Shares",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const vaultBurnSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  shares: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultBurnShares(args: Record<string, unknown>) {
  try {
    const { vault_address, shares, dry_run } = vaultBurnSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;
    const sharesWei = parseEther(shares);
    const sender = getAccountAddress();

    const liabilityShares = await publicClient.readContract({
      address: hubAddress, abi: vaultHubAbi,
      functionName: "liabilityShares", args: [vaultAddr],
    }) as bigint;

    let senderStethBalance: bigint | null = null;
    try {
      const stethAddr = STETH_ADDRESSES[appConfig.chainId];
      if (stethAddr) {
        senderStethBalance = await publicClient.readContract({
          address: stethAddr,
          abi: [{ name: "sharesOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const,
          functionName: "sharesOf", args: [sender],
        }) as bigint;
      }
    } catch {
      // sharesOf unavailable on this chain
    }

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "burnShares",
          args: [vaultAddr, sharesWei],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      return textResult(
        [
          `=== DRY RUN: Burn Vault Shares ===`,
          "",
          `Vault: ${vaultAddr}`,
          `Shares to burn: ${shares}`,
          `Current liability shares: ${formatEther(liabilityShares)}`,
          `Liability after burn: ${formatEther(liabilityShares > sharesWei ? liabilityShares - sharesWei : 0n)}`,
          ...(senderStethBalance !== null ? [`Your stETH shares: ${formatEther(senderStethBalance)}`] : []),
          ...(senderStethBalance !== null && sharesWei > senderStethBalance
            ? [`WARNING: You hold ${formatEther(senderStethBalance)} shares but are trying to burn ${shares}. Ensure shares are transferred to VaultHub first.`] : []),
          "",
          `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
          ...(simulationError ? [`Simulation note: ${simulationError}`] : []),
        ].join("\n")
      );
    }

    const txHash = await walletClient.writeContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "burnShares",
      args: [vaultAddr, sharesWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Vault Shares Burned ===`,
        `Transaction hash: ${txHash}`,
        `Vault: ${vaultAddr}`,
        `Shares burned: ${shares}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultRebalanceToolDef = {
  name: "lido_vault_rebalance",
  description:
    "Rebalance a staking vault by withdrawing ETH and burning liability shares. " +
    "Used to restore vault health or voluntarily reduce liability. " +
    "Can be called permissionlessly if the vault is below the forced rebalance threshold. " +
    "Defaults to dry_run=true (simulation only).",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address (0x...).",
      },
      shares: {
        type: "string",
        description: "Amount of liability shares to eliminate via rebalance (in ETH-scale units).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vault_address", "shares"],
  },
  annotations: {
    title: "[stVaults] Rebalance Vault",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const vaultRebalanceSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  shares: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultRebalance(args: Record<string, unknown>) {
  try {
    const { vault_address, shares, dry_run } = vaultRebalanceSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;
    const sharesWei = parseEther(shares);
    const sender = getAccountAddress();

    const [healthy, liabilityShares, shortfall] = await Promise.all([
      publicClient.readContract({
        address: hubAddress, abi: vaultHubAbi,
        functionName: "isVaultHealthy", args: [vaultAddr],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: hubAddress, abi: vaultHubAbi,
        functionName: "liabilityShares", args: [vaultAddr],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: hubAddress, abi: vaultHubAbi,
        functionName: "healthShortfallShares", args: [vaultAddr],
      }) as Promise<bigint>,
    ]);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: hubAddress,
          abi: vaultHubAbi,
          functionName: "rebalance",
          args: [vaultAddr, sharesWei],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      return textResult(
        [
          `=== DRY RUN: Rebalance Vault ===`,
          "",
          `Vault: ${vaultAddr}`,
          `Shares to rebalance: ${shares}`,
          "",
          `Vault healthy: ${healthy}`,
          `Current liability shares: ${formatEther(liabilityShares)}`,
          `Health shortfall shares: ${formatEther(shortfall)}`,
          ...(shortfall > 0n ? [`NOTE: Vault is unhealthy. Rebalance at least ${formatEther(shortfall)} shares to restore health.`] : []),
          "",
          `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
          ...(simulationError ? [`Simulation note: ${simulationError}`] : []),
        ].join("\n")
      );
    }

    const txHash = await walletClient.writeContract({
      address: hubAddress,
      abi: vaultHubAbi,
      functionName: "rebalance",
      args: [vaultAddr, sharesWei],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Vault Rebalanced ===`,
        `Transaction hash: ${txHash}`,
        `Vault: ${vaultAddr}`,
        `Shares rebalanced: ${shares}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultCreateToolDef = {
  name: "lido_vault_create",
  description:
    "Create a new Lido staking vault via VaultFactory. Deploys a StakingVault and a VaultDashboard. " +
    "The caller becomes the vault owner. Defaults to dry_run=true (simulation only).",
  inputSchema: {
    type: "object" as const,
    properties: {
      node_operator: {
        type: "string",
        description: "Node operator address for the vault (0x...).",
      },
      confirm_expiry: {
        type: "number",
        description: "Confirmation expiry period in seconds (default 86400 = 24h).",
      },
      management_fee: {
        type: "number",
        description: "Management fee in basis points (e.g. 500 = 5%). Default: 0.",
      },
      performance_fee: {
        type: "number",
        description: "Performance fee in basis points (e.g. 1000 = 10%). Default: 0.",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["node_operator"],
  },
  annotations: {
    title: "[stVaults] Create Vault",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const vaultCreateSchema = z.object({
  node_operator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  confirm_expiry: z.number().min(0).optional().default(86400),
  management_fee: z.number().min(0).max(10000).optional().default(0),
  performance_fee: z.number().min(0).max(10000).optional().default(0),
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultCreate(args: Record<string, unknown>) {
  try {
    const { node_operator, confirm_expiry, management_fee, performance_fee, dry_run } = vaultCreateSchema.parse(args);
    const factoryAddress = getVaultFactoryAddress();
    if (!factoryAddress) {
      return errorResult(`VaultFactory not available on chain ${appConfig.chainId}.`);
    }

    const sender = getAccountAddress();
    const emptyMetadata = "0x" as `0x${string}`;

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;
      let vaultAddr: string | undefined;
      let dashboardAddr: string | undefined;

      try {
        const result = await publicClient.simulateContract({
          address: factoryAddress,
          abi: vaultFactoryAbi,
          functionName: "createVaultWithDashboard",
          args: [sender, node_operator as Address, BigInt(confirm_expiry), BigInt(management_fee), BigInt(performance_fee), emptyMetadata],
          account: sender,
        });
        if (Array.isArray(result.result) && result.result.length >= 2) {
          vaultAddr = result.result[0] as string;
          dashboardAddr = result.result[1] as string;
        }
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const lines = [
        `=== DRY RUN: Create Staking Vault ===`,
        "",
        `Factory: ${factoryAddress}`,
        `Owner: ${sender}`,
        `Node operator: ${node_operator}`,
        `Confirm expiry: ${confirm_expiry}s`,
        `Management fee: ${(management_fee / 100).toFixed(2)}%`,
        `Performance fee: ${(performance_fee / 100).toFixed(2)}%`,
        "",
        ...(vaultAddr ? [`Predicted vault address: ${vaultAddr}`] : []),
        ...(dashboardAddr ? [`Predicted dashboard address: ${dashboardAddr}`] : []),
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];
      if (simulationError) lines.push(`Simulation note: ${simulationError}`);

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: factoryAddress,
      abi: vaultFactoryAbi,
      functionName: "createVaultWithDashboard",
      args: [sender, node_operator as Address, BigInt(confirm_expiry), BigInt(management_fee), BigInt(performance_fee), emptyMetadata],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Staking Vault Created ===`,
        `Transaction hash: ${txHash}`,
        `Owner: ${sender}`,
        `Node operator: ${node_operator}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
        `Gas used: ${receipt.gasUsed.toString()}`,
        "",
        "Use lido_list_vaults or check the transaction logs to find your new vault address.",
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export const vaultRequestExitToolDef = {
  name: "lido_vault_request_validator_exit",
  description:
    "Request a validator exit from a staking vault. This signals the beacon chain to begin " +
    "the exit process for the specified validator. Requires the node operator role. " +
    "Defaults to dry_run=true (simulation only).",
  inputSchema: {
    type: "object" as const,
    properties: {
      vault_address: {
        type: "string",
        description: "The vault contract address (0x...).",
      },
      validator_pubkey: {
        type: "string",
        description: "Validator public key (48 bytes, hex-encoded with 0x prefix).",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["vault_address", "validator_pubkey"],
  },
  annotations: {
    title: "[stVaults] Request Validator Exit",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const vaultRequestExitSchema = z.object({
  vault_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  validator_pubkey: z.string().regex(/^0x[a-fA-F0-9]{96}$/, "Validator public key must be 48 bytes (96 hex chars) with 0x prefix"),
  dry_run: z.boolean().optional().default(true),
});

export async function handleVaultRequestExit(args: Record<string, unknown>) {
  try {
    const { vault_address, validator_pubkey, dry_run } = vaultRequestExitSchema.parse(args);
    const hubAddress = getVaultHubAddress();
    const vaultAddr = vault_address as Address;
    const sender = getAccountAddress();

    const pf = await getVaultPreFlight(hubAddress, vaultAddr);

    if (dry_run) {
      let simulationOk = true;
      let simulationError: string | undefined;

      try {
        await publicClient.simulateContract({
          address: vaultAddr,
          abi: stakingVaultAbi,
          functionName: "requestValidatorExit",
          args: [validator_pubkey as `0x${string}`],
          account: sender,
        });
      } catch (err) {
        simulationOk = false;
        simulationError = sanitizeErrorMessage(err instanceof Error ? err.message : String(err));
      }

      const lines = [
        `=== DRY RUN: Request Validator Exit ===`,
        "",
        `Vault: ${vaultAddr}`,
        `Validator: ${validator_pubkey.slice(0, 18)}...${validator_pubkey.slice(-8)}`,
        "",
        ...preFlightLines(pf),
        ...roleWarning(sender, pf, "nodeOperator"),
        "",
        `Simulation: ${simulationOk ? "SUCCESS" : "FAILED"}`,
      ];
      if (simulationError) lines.push(`Simulation note: ${simulationError}`);

      return textResult(lines.join("\n"));
    }

    const txHash = await walletClient.writeContract({
      address: vaultAddr,
      abi: stakingVaultAbi,
      functionName: "requestValidatorExit",
      args: [validator_pubkey as `0x${string}`],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    return textResult(
      [
        `=== Validator Exit Requested ===`,
        `Transaction hash: ${txHash}`,
        `Vault: ${vaultAddr}`,
        `Validator: ${validator_pubkey.slice(0, 18)}...${validator_pubkey.slice(-8)}`,
        `Status: ${receipt.status === "success" ? "Confirmed" : "Failed"}`,
        "",
        "The beacon chain will process this exit. The validator will stop proposing",
        "blocks and eventually become withdrawable. This may take several days.",
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}
