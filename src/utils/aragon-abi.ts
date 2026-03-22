/**
 * Aragon voting contract ABI and per-chain addresses.
 */
import type { Address } from "viem";
import { appConfig } from "../config.js";

export const ARAGON_VOTING_ADDRESSES: Record<number, Address> = {
  1: "0x2e59A20f205bB85a89C53f1936454680651E618e",    // mainnet
  17000: "0xdA7d2573Df555002503F29aA4003e398d28cc00f", // holesky
  560048: "0x49B3512c44891bef83F8967d075121Bd1b07a01B", // hoodi
};

export function getAragonVotingAddress(): Address {
  const addr = ARAGON_VOTING_ADDRESSES[appConfig.chainId];
  if (!addr) throw new Error(`Aragon voting not available on chain ${appConfig.chainId}`);
  return addr;
}

export const aragonVotingAbi = [
  {
    name: "votesLength",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getVote",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_voteId", type: "uint256" }],
    outputs: [
      { name: "open", type: "bool" },
      { name: "executed", type: "bool" },
      { name: "startDate", type: "uint64" },
      { name: "snapshotBlock", type: "uint64" },
      { name: "supportRequired", type: "uint64" },
      { name: "minAcceptQuorum", type: "uint64" },
      { name: "yea", type: "uint256" },
      { name: "nay", type: "uint256" },
      { name: "votingPower", type: "uint256" },
      { name: "script", type: "bytes" },
    ],
  },
  {
    name: "canVote",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_voteId", type: "uint256" },
      { name: "_voter", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "getVoterState",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_voteId", type: "uint256" },
      { name: "_voter", type: "address" },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    name: "vote",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_voteId", type: "uint256" },
      { name: "_supports", type: "bool" },
      { name: "_executesIfDecided", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "voteTime",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    name: "objectionPhaseTime",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    name: "CastVote",
    type: "event",
    inputs: [
      { name: "voteId", type: "uint256", indexed: true },
      { name: "voter", type: "address", indexed: true },
      { name: "supports", type: "bool", indexed: false },
      { name: "stake", type: "uint256", indexed: false },
    ],
  },
] as const;
