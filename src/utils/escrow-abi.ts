/**
 * Dual Governance escrow contract ABIs.
 */

export const escrowAbi = [
  {
    name: "lockStETH",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [{ name: "lockedStETHShares", type: "uint256" }],
  },
  {
    name: "unlockStETH",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "unlockedStETHShares", type: "uint256" }],
  },
  {
    name: "getVetoerDetails",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "vetoer", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "unstETHIdsCount", type: "uint256" },
          { name: "stETHLockedShares", type: "uint128" },
          { name: "unstETHLockedShares", type: "uint128" },
          { name: "lastAssetsLockTimestamp", type: "uint40" },
        ],
      },
    ],
  },
] as const;

export const stethApproveAbi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;
