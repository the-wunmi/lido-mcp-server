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

/** wstETH contract addresses per chain (L2 bridges deploy as ERC-20). */
export const WSTETH_ADDRESSES: Record<number, Address> = {
  1: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
  17000: "0x8d09a4502Cc8Cf1547aD300E066060D043f6982D",
  560048: "0x7E99eE3C66636DE415D2d7C880938F2f40f94De4",
  8453: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  10: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
  42161: "0x5979D7b546E38E414F7E9822514be443A4800529",
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
