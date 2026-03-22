/**
 * Shared ERC-20 ABI fragments used across multiple tool files.
 */

export const erc20Abi = [
  { name: "name", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ name: "", type: "string" }] },
  { name: "symbol", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ name: "", type: "string" }] },
  { name: "decimals", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { name: "totalSupply", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "approve", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { name: "transfer", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;
