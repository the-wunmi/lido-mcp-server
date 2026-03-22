/**
 * Easy Track contract ABIs and per-chain addresses.
 */
import type { Address } from "viem";
import { appConfig } from "../config.js";

// ---- Addresses ----

export const EASY_TRACK_ADDRESSES: Record<number, Address> = {
  1: "0xF0211b7660680B49De1A7E9f25C65660F0a13Fea",      // mainnet
  17000: "0x1763b9ED3586B08AE796c7787811a2E1bc16163a",   // holesky
  560048: "0x284D91a7D47850d21A6DEaaC6E538AC7E5E6fc2a",  // hoodi
};

export function getEasyTrackAddress(): Address {
  const addr = EASY_TRACK_ADDRESSES[appConfig.chainId];
  if (!addr) throw new Error(`Easy Track not available on chain ${appConfig.chainId}`);
  return addr;
}

// ---- Motion struct returned by getMotions() ----

export interface EasyTrackMotion {
  id: bigint;
  evmScriptFactory: `0x${string}`;
  creator: `0x${string}`;
  duration: bigint;
  startDate: bigint;
  snapshotBlock: bigint;
  objectionsThreshold: bigint;
  objectionsAmount: bigint;
  evmScriptHash: `0x${string}`;
}

// ---- ABIs ----

export const easyTrackAbi = [
  {
    name: "getMotions",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "id", type: "uint256" },
          { name: "evmScriptFactory", type: "address" },
          { name: "creator", type: "address" },
          { name: "duration", type: "uint256" },
          { name: "startDate", type: "uint256" },
          { name: "snapshotBlock", type: "uint256" },
          { name: "objectionsThreshold", type: "uint256" },
          { name: "objectionsAmount", type: "uint256" },
          { name: "evmScriptHash", type: "bytes32" },
        ],
      },
    ],
  },
  {
    name: "motionDuration",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "objectionsThreshold",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "motionsCountLimit",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getEVMScriptFactories",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "canObjectToMotion",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_motionId", type: "uint256" },
      { name: "_objector", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "objectToMotion",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_motionId", type: "uint256" }],
    outputs: [],
  },
] as const;

export const ldoBalanceAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const LDO_TOKEN_ADDRESSES: Record<number, Address> = {
  1: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
  17000: "0x14ae7daeecdf57034f3E9db8564e46Dba8D97344",
  560048: "0xEf2573966D009CcEA0Fc74451dee2193564198dc",
};

export function getLdoTokenAddress(): Address {
  const addr = LDO_TOKEN_ADDRESSES[appConfig.chainId];
  if (!addr) throw new Error(`LDO token not available on chain ${appConfig.chainId}`);
  return addr;
}
