import { z } from "zod";
import { formatEther, type Address } from "viem";
import { sdk, publicClient } from "../sdk-factory.js";
import { textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";
import { appConfig, STETH_ADDRESSES, WSTETH_ADDRESSES, LDO_ADDRESSES, WITHDRAWAL_QUEUE_ADDRESSES } from "../config.js";
import { ARAGON_VOTING_ADDRESSES } from "../utils/aragon-abi.js";
import { EASY_TRACK_ADDRESSES } from "../utils/easytrack-abi.js";
import { VAULT_HUB_ADDRESSES, VAULT_FACTORY_ADDRESSES } from "../utils/vaulthub-abi.js";

export const protocolInfoToolDef = {
  name: "lido_get_protocol_info",
  description:
    "Get comprehensive Lido protocol information: TVL, fee structure, total shares, buffered ETH, " +
    "stETH/wstETH supply, and exchange rates.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "[Protocol] Protocol Info",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleGetProtocolInfo(_args: Record<string, unknown>) {
  try {
    const [
      stakeLimitInfo,
      lastApr,
      totalSupply,
      shareRate,
    ] = await Promise.all([
      sdk.stake.getStakeLimitInfo(),
      sdk.statistics.apr.getLastApr(),
      sdk.shares.getTotalSupply(),
      sdk.shares.getShareRate(),
    ]);

    // Additional reads via public client
    const lidoAddress = STETH_ADDRESSES[appConfig.chainId];
    if (!lidoAddress) {
      return textResult("Protocol info not available on this chain (no stETH contract).");
    }
    const lidoAbi = [
      { name: "getTotalPooledEther", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
      { name: "getBufferedEther", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
      { name: "getFee", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint16" }] },
    ] as const;

    const [totalPooled, buffered, fee] = await Promise.all([
      publicClient.readContract({ address: lidoAddress, abi: lidoAbi, functionName: "getTotalPooledEther" }),
      publicClient.readContract({ address: lidoAddress, abi: lidoAbi, functionName: "getBufferedEther" }),
      publicClient.readContract({ address: lidoAddress, abi: lidoAbi, functionName: "getFee" }),
    ]);

    const feePercent = (Number(fee) / 100).toFixed(2);

    const lines = [
      `=== Lido Protocol Info ===`,
      "",
      "Staking:",
      `  Total pooled ETH (TVL): ${formatEther(totalPooled)} ETH`,
      `  Buffered ETH: ${formatEther(buffered)} ETH`,
      `  Total shares: ${formatEther(totalSupply.totalShares)}`,
      `  Share rate: ${shareRate.toFixed(6)}`,
      `  Current APR: ${lastApr.toFixed(2)}%`,
      "",
      "Fee:",
      `  Protocol fee: ${feePercent}% (split between treasury and node operators)`,
      "",
      "Staking limits:",
      `  Paused: ${stakeLimitInfo.isStakingPaused}`,
      `  Limit set: ${stakeLimitInfo.isStakingLimitSet}`,
      `  Current limit: ${formatEther(stakeLimitInfo.currentStakeLimit)} ETH`,
      `  Max limit: ${formatEther(stakeLimitInfo.maxStakeLimit)} ETH`,
    ];

    // Add wstETH exchange rates if available
    const wstethAddr = WSTETH_ADDRESSES[appConfig.chainId];
    if (wstethAddr) {
      try {
        const [stethPerWsteth, wstethPerSteth] = await Promise.all([
          sdk.wsteth.convertToSteth(10n ** 18n),
          sdk.wsteth.convertToWsteth(10n ** 18n),
        ]);
        lines.push("");
        lines.push("wstETH exchange rates:");
        lines.push(`  1 wstETH = ${formatEther(stethPerWsteth)} stETH`);
        lines.push(`  1 stETH = ${formatEther(wstethPerSteth)} wstETH`);
      } catch {
        // Exchange rate unavailable — don't fail the whole response
      }
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const stakingModulesToolDef = {
  name: "lido_get_staking_modules",
  description:
    "List all staking router modules (curated, community, DVT, etc.) with their IDs and status.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "[Protocol] Staking Modules",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const stakingRouterAbi = [
  {
    name: "getStakingModulesCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getStakingModule",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_stakingModuleId", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint24" },
      { name: "stakingModuleAddress", type: "address" },
      { name: "stakingModuleFee", type: "uint16" },
      { name: "treasuryFee", type: "uint16" },
      { name: "stakeShareLimit", type: "uint16" },
      { name: "status", type: "uint8" },
      { name: "name", type: "string" },
      { name: "lastDepositAt", type: "uint64" },
      { name: "lastDepositBlock", type: "uint256" },
      { name: "exitedValidatorsCount", type: "uint256" },
    ],
  },
] as const;

const STAKING_ROUTER_ADDRESSES: Record<number, Address> = {
  1: "0xFdDf38947aFB03C621C71b06C9C70bce73f12999",
  17000: "0xd6EbF043D30A7fe46D1Db32BA90a0A51207FE229",
  560048: "0xCc820558B39ee15C7C45B59390B503b83fb499A8",
};

export async function handleGetStakingModules(_args: Record<string, unknown>) {
  try {
    const routerAddr = STAKING_ROUTER_ADDRESSES[appConfig.chainId];
    if (!routerAddr) {
      return textResult(`Staking router not available on chain ${appConfig.chainId}.`);
    }

    const count = await publicClient.readContract({
      address: routerAddr,
      abi: stakingRouterAbi,
      functionName: "getStakingModulesCount",
    }) as bigint;

    const total = Number(count);
    if (total === 0) {
      return textResult("No staking modules found.");
    }

    // Batch-fetch all modules via multicall (IDs are 1-indexed)
    const moduleCalls = Array.from({ length: total }, (_, i) => ({
      address: routerAddr,
      abi: stakingRouterAbi,
      functionName: "getStakingModule" as const,
      args: [BigInt(i + 1)],
    }));

    const results = await publicClient.multicall({ contracts: moduleCalls });

    const statusLabels: Record<number, string> = { 0: "Active", 1: "DepositsPaused", 2: "Stopped" };
    const lines = [`=== Staking Modules ===`, `Total modules: ${total}`, ""];

    for (let i = 0; i < total; i++) {
      const result = results[i];
      if (result.status === "success") {
        const mod = result.result as readonly [number, string, number, number, number, number, string, bigint, bigint, bigint];
        lines.push(`Module #${mod[0]}:`);
        lines.push(`  Name: ${mod[6]}`);
        lines.push(`  Address: ${mod[1]}`);
        lines.push(`  Status: ${statusLabels[mod[5]] ?? `Unknown(${mod[5]})`}`);
        lines.push(`  Module fee: ${(mod[2] / 100).toFixed(2)}%`);
        lines.push(`  Treasury fee: ${(mod[3] / 100).toFixed(2)}%`);
        lines.push(`  Exited validators: ${mod[9].toString()}`);
      } else {
        lines.push(`Module #${i + 1}: failed to read`);
      }
      lines.push("");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const nodeOperatorsToolDef = {
  name: "lido_get_node_operators",
  description:
    "List node operators in the curated staking module. Shows operator name, reward address, " +
    "and active/deposited/exited validator counts.",
  inputSchema: {
    type: "object" as const,
    properties: {
      count: {
        type: "number",
        description: "Number of operators to return (max 50, default 20).",
      },
      offset: {
        type: "number",
        description: "Starting operator index (0-indexed, default 0).",
      },
    },
  },
  annotations: {
    title: "[Protocol] Node Operators",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const nodeOperatorsSchema = z.object({
  count: z.number().min(1).max(50).optional().default(20),
  offset: z.number().min(0).optional().default(0),
});

const nodeOperatorsRegistryAbi = [
  {
    name: "getNodeOperatorsCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getNodeOperator",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_id", type: "uint256" },
      { name: "_fullInfo", type: "bool" },
    ],
    outputs: [
      { name: "active", type: "bool" },
      { name: "name", type: "string" },
      { name: "rewardAddress", type: "address" },
      { name: "totalVettedValidators", type: "uint64" },
      { name: "totalExitedValidators", type: "uint64" },
      { name: "totalAddedValidators", type: "uint64" },
      { name: "totalDepositedValidators", type: "uint64" },
    ],
  },
] as const;

const NODE_OPS_REGISTRY_ADDRESSES: Record<number, Address> = {
  1: "0x55032650b14df07b85bF18A3a3eC8E0Af2e028d5",
  17000: "0x595F64Ddc3856a3b5Ff4f4CC1d1fb4B46cFd2bAC",
  560048: "0x5cDbE1590c083b5A2A64427fAA63A7cfDB91FbB5",
};

export async function handleGetNodeOperators(args: Record<string, unknown>) {
  try {
    const { count, offset } = nodeOperatorsSchema.parse(args);

    const registryAddr = NODE_OPS_REGISTRY_ADDRESSES[appConfig.chainId];
    if (!registryAddr) {
      return textResult(`Node operators registry not available on chain ${appConfig.chainId}.`);
    }

    const totalCount = await publicClient.readContract({
      address: registryAddr,
      abi: nodeOperatorsRegistryAbi,
      functionName: "getNodeOperatorsCount",
    }) as bigint;

    const total = Number(totalCount);
    if (total === 0) {
      return textResult("No node operators found in the curated module.");
    }

    const endIndex = Math.min(offset + count, total);

    // Batch-fetch all operators in the range via multicall
    const operatorCalls = Array.from({ length: endIndex - offset }, (_, i) => ({
      address: registryAddr,
      abi: nodeOperatorsRegistryAbi,
      functionName: "getNodeOperator" as const,
      args: [BigInt(offset + i), true],
    }));

    const results = await publicClient.multicall({ contracts: operatorCalls });

    const lines = [
      `=== Node Operators (Curated Module) ===`,
      `Total operators: ${total}`,
      `Showing: ${offset} to ${endIndex - 1}`,
      "",
    ];

    for (let i = 0; i < results.length; i++) {
      const opIndex = offset + i;
      const result = results[i];
      if (result.status === "success") {
        const op = result.result as readonly [boolean, string, string, bigint, bigint, bigint, bigint];
        lines.push(`Operator #${opIndex}: ${op[1]}`);
        lines.push(`  Active: ${op[0]}`);
        lines.push(`  Reward address: ${op[2]}`);
        lines.push(`  Deposited validators: ${op[6].toString()}`);
        lines.push(`  Exited validators: ${op[4].toString()}`);
        lines.push(`  Total added: ${op[5].toString()}`);
      } else {
        lines.push(`Operator #${opIndex}: failed to read`);
      }
      lines.push("");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export const contractAddressesToolDef = {
  name: "lido_get_contract_addresses",
  description:
    "Get all known Lido contract addresses for the current chain. " +
    "Includes stETH, wstETH, withdrawal queue, voting, staking router, VaultHub, etc.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "[Protocol] Contract Addresses",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleGetContractAddresses(_args: Record<string, unknown>) {
  try {
    const chainId = appConfig.chainId;
    const chainName = appConfig.chain.name;

    const addresses: Record<string, string | null> = {
      "stETH (Lido)": STETH_ADDRESSES[chainId] ?? null,
      "wstETH": WSTETH_ADDRESSES[chainId] ?? null,
      "LDO": LDO_ADDRESSES[chainId] ?? null,
      "Withdrawal Queue": WITHDRAWAL_QUEUE_ADDRESSES[chainId] ?? null,
      "Aragon Voting": ARAGON_VOTING_ADDRESSES[chainId] ?? null,
      "Easy Track": EASY_TRACK_ADDRESSES[chainId] ?? null,
      "Staking Router": STAKING_ROUTER_ADDRESSES[chainId] ?? null,
      "Node Operators Registry": NODE_OPS_REGISTRY_ADDRESSES[chainId] ?? null,
      "VaultHub": VAULT_HUB_ADDRESSES[chainId] ?? null,
      "VaultFactory": VAULT_FACTORY_ADDRESSES[chainId] ?? null,
    };

    const lines = [
      `=== Lido Contract Addresses (${chainName}, chain ${chainId}) ===`,
      "",
    ];

    for (const [name, addr] of Object.entries(addresses)) {
      lines.push(`${name}: ${addr ?? "not available on this chain"}`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
