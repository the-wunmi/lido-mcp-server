import { config } from "dotenv";
import { parseEther } from "viem";
import { mainnet, holesky, hoodi, base, optimism, arbitrum } from "viem/chains";
import type { Chain, Address } from "viem";

config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** L1 chain IDs where the full Lido SDK is available. */
const L1_CHAIN_IDS = new Set([1, 17000, 560048]);

/** L2 chain IDs where only wstETH (bridged ERC-20) is available. */
const L2_CHAIN_IDS = new Set([8453, 10, 42161]);

/** stETH (Lido) contract addresses per chain. */
export const STETH_ADDRESSES: Record<number, Address> = {
  1: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
  17000: "0x3F1c547b21f65e10480dE3ad8E19fAAC46C95034",
  560048: "0x3508A952176b3c15387C97BE809eaffB1982176a",
};

/** wstETH contract addresses per chain (L2 bridges deploy as ERC-20). */
export const WSTETH_ADDRESSES: Record<number, Address> = {
  1: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  17000: "0x8d09a4502Cc8Cf1547aD300E066060D043f6982D",
  560048: "0x7E99eE3C66636DE415D2d7C880938F2f40f94De4",
  8453: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  10: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
  42161: "0x5979D7b546E38E414F7E9822514be443A4800529",
};

/** LDO token addresses per chain. */
export const LDO_ADDRESSES: Record<number, Address> = {
  1: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
  17000: "0x14ae7daeecdf57034f3E9db8564e46Dba8D97344",
  560048: "0xEf2573966D009CcEA0Fc74451dee2193564198dc",
};

/** Withdrawal queue (ERC-721) addresses per chain. */
export const WITHDRAWAL_QUEUE_ADDRESSES: Record<number, Address> = {
  1: "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1",
  17000: "0xc7cc160b58F8Bb0baC94b80847E2CF2800565C50",
  560048: "0xfe56573178f1bcdf53F01A6E9977670dcBBD9186",
};

/**
 * L2 wstETH addresses for cross-chain balance queries (read-only).
 * These are queried from L1 via public RPC endpoints.
 */
export const L2_WSTETH_CHAINS: Record<string, { chainId: number; rpcUrl: string; address: Address }> = {
  Arbitrum: { chainId: 42161, rpcUrl: process.env.LIDO_ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc", address: "0x5979D7b546E38E414F7E9822514be443A4800529" },
  Optimism: { chainId: 10, rpcUrl: process.env.LIDO_OPTIMISM_RPC_URL ?? "https://mainnet.optimism.io", address: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb" },
  Base: { chainId: 8453, rpcUrl: process.env.LIDO_BASE_RPC_URL ?? "https://mainnet.base.org", address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452" },
  Polygon: { chainId: 137, rpcUrl: process.env.LIDO_POLYGON_RPC_URL ?? "https://polygon-rpc.com", address: "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD" },
  "zkSync Era": { chainId: 324, rpcUrl: process.env.LIDO_ZKSYNC_RPC_URL ?? "https://mainnet.era.zksync.io", address: "0x703b52F2b28fEbcB60E1372858AF5b18849FE867" },
  Mantle: { chainId: 5000, rpcUrl: process.env.LIDO_MANTLE_RPC_URL ?? "https://rpc.mantle.xyz", address: "0x458ed78EB972a369799fb278c0243b25e5242A83" },
  Linea: { chainId: 59144, rpcUrl: process.env.LIDO_LINEA_RPC_URL ?? "https://rpc.linea.build", address: "0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F" },
  Scroll: { chainId: 534352, rpcUrl: process.env.LIDO_SCROLL_RPC_URL ?? "https://rpc.scroll.io", address: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32" },
  Mode: { chainId: 34443, rpcUrl: process.env.LIDO_MODE_RPC_URL ?? "https://mainnet.mode.network", address: "0x98f96A4B34D03a2E6f225B28b8f8Cb1279562d81" },
  "BNB Chain": { chainId: 56, rpcUrl: process.env.LIDO_BSC_RPC_URL ?? "https://bsc-dataseed.binance.org", address: "0x26c5e01524d2E6280A48F2c50fF6De7e52E9611C" },
  Zircuit: { chainId: 48900, rpcUrl: process.env.LIDO_ZIRCUIT_RPC_URL ?? "https://zircuit1-mainnet.p2pify.com", address: "0xf0e673Bc224A8Ca3ff67a61605814666b1234833" },
};

function getChain(chainId: number): Chain {
  switch (chainId) {
    case 1: return mainnet;
    case 17000: return holesky;
    case 560048: return hoodi;
    case 8453: return base;
    case 10: return optimism;
    case 42161: return arbitrum;
    default:
      throw new Error(
        `Unsupported chain ID: ${chainId}. ` +
        `Use 1 (mainnet), 17000 (Holesky), 560048 (Hoodi), 8453 (Base), 10 (Optimism), or 42161 (Arbitrum).`
      );
  }
}

const chainId = parseInt(requireEnv("LIDO_CHAIN_ID"), 10);

function requireHexKey(name: string): `0x${string}` {
  const value = requireEnv(name);
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 64-char hex string`);
  }
  return value as `0x${string}`;
}

export type SupportedChainId = 1 | 17000 | 560048 | 8453 | 10 | 42161;

// Safe narrowing — getChain() above throws for unsupported chain IDs
const validatedChainId = chainId as SupportedChainId;

export const appConfig = {
  rpcUrl: requireEnv("LIDO_RPC_URL"),
  chainId: validatedChainId,
  chain: getChain(chainId),
  /** True when running on an L2 (Base, Optimism, Arbitrum). L2 mode only exposes wstETH tools. */
  isL2: L2_CHAIN_IDS.has(chainId),
  /** True when running on L1 (mainnet, Holesky, or Hoodi). Full Lido SDK is available. */
  isL1: L1_CHAIN_IDS.has(chainId),
  /** True when running on Optimism — enables rebasing stETH tools alongside wstETH. */
  isOptimism: chainId === 10,
} as const;

/**
 * Read, validate, and return the private key, then scrub it from process.env.
 * This is called exactly once by sdk-factory.ts during initialization.
 * The key is never stored on any exported object.
 */
export function consumePrivateKey(): `0x${string}` {
  const key = requireHexKey("LIDO_PRIVATE_KEY");
  delete process.env.LIDO_PRIVATE_KEY;
  return key;
}

export type LidoMode = "full" | "dry-run-only" | "read-only";

function parseLidoMode(): LidoMode {
  const raw = process.env.LIDO_MODE?.toLowerCase().trim();
  if (!raw || raw === "full") return "full";
  if (raw === "dry-run-only") return "dry-run-only";
  if (raw === "read-only") return "read-only";
  throw new Error(`Invalid LIDO_MODE: "${raw}". Must be "full", "dry-run-only", or "read-only".`);
}

function parseAllowedReceivers(): Set<string> | null {
  const raw = process.env.LIDO_ALLOWED_RECEIVERS?.trim();
  if (!raw) return null;
  const addresses = raw.split(",").map(a => a.trim().toLowerCase());
  for (const addr of addresses) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      throw new Error(`Invalid address in LIDO_ALLOWED_RECEIVERS: "${addr}"`);
    }
  }
  return new Set(addresses);
}

function parseMaxTransactionEth(): bigint | null {
  const raw = process.env.LIDO_MAX_TRANSACTION_ETH?.trim();
  if (!raw) return null;
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(`Invalid LIDO_MAX_TRANSACTION_ETH: "${raw}". Must be a positive number.`);
  }
  return parseEther(raw);
}

export const securityConfig = {
  mode: parseLidoMode(),
  allowedReceivers: parseAllowedReceivers(),
  maxTransactionWei: parseMaxTransactionEth(),
};

/** Default threshold for governance warning status (percent of veto support). */
export const GOVERNANCE_WARNING_THRESHOLD = 50;
