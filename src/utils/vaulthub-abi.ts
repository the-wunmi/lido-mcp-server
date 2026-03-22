import type { Address } from "viem";
import { appConfig } from "../config.js";

export const VAULT_HUB_ADDRESSES: Record<number, Address> = {
  1: "0x1d201BE093d847f6446530Efb0E8Fb426d176709",       // mainnet
  560048: "0x4C9fFC325392090F789255b9948Ab1659b797964",   // hoodi
};

export const VAULT_FACTORY_ADDRESSES: Record<number, Address> = {
  1: "0x02Ca7772FF14a9F6c1a08aF385aA96bb1b34175A",       // mainnet
  560048: "0x7Ba269a03eeD86f2f54CB04CA3b4b7626636Df4E",   // hoodi
};

export function getVaultHubAddress(): Address {
  const addr = VAULT_HUB_ADDRESSES[appConfig.chainId];
  if (!addr) throw new Error(`VaultHub not available on chain ${appConfig.chainId}. Supported: mainnet (1), Hoodi (560048).`);
  return addr;
}

export function getVaultFactoryAddress(): Address | null {
  return VAULT_FACTORY_ADDRESSES[appConfig.chainId] ?? null;
}

export const vaultHubAbi = [
  {
    name: "vaultsCount",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "vaultByIndex",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "isVaultConnected",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "isVaultHealthy",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "totalValue",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "withdrawableValue",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "locked",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "liabilityShares",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "fund",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "vault", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "pauseBeaconChainDeposits",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [],
  },
  {
    name: "resumeBeaconChainDeposits",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "vault", type: "address" }],
    outputs: [],
  },
  {
    name: "mintShares",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_vault", type: "address" },
      { name: "_recipient", type: "address" },
      { name: "_amountOfShares", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "burnShares",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_vault", type: "address" },
      { name: "_amountOfShares", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "rebalance",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_vault", type: "address" },
      { name: "_shares", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "totalMintingCapacityShares",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_vault", type: "address" },
      { name: "_deltaValue", type: "int256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "healthShortfallShares",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_vault", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const vaultFactoryAbi = [
  {
    name: "createVaultWithDashboard",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_vaultOwner", type: "address" },
      { name: "_nodeOperator", type: "address" },
      { name: "_confirmExpiry", type: "uint256" },
      { name: "_managementFee", type: "uint256" },
      { name: "_performanceFee", type: "uint256" },
      { name: "_metadata", type: "bytes" },
    ],
    outputs: [
      { name: "vault", type: "address" },
      { name: "dashboard", type: "address" },
    ],
  },
] as const;

export const stakingVaultAbi = [
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "nodeOperator",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "depositor",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "beaconChainDepositsPaused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "withdrawalCredentials",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    name: "requestValidatorExit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_validatorPublicKey", type: "bytes" }],
    outputs: [],
  },
] as const;
