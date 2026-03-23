import { formatUnits, type Address, parseAbi } from "viem";
import { z } from "zod";
import { getMainnetClient } from "./mainnet-client.js";
import { FETCH_TIMEOUT_MS, BIGINT_SCALE_18, normalizeAddress } from "./config.js";
import type { VaultWatch, VaultSnapshot, BenchmarkRates } from "./types.js";

const erc4626Abi = parseAbi([
  "function totalAssets() view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function asset() view returns (address)",
]);

const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export async function readVaultOnChain(address: Address): Promise<{
  totalAssets: bigint;
  sharePrice: bigint;
  name: string;
  symbol: string;
  vaultDecimals: number;
  assetDecimals: number;
  assetSymbol: string;
}> {
  const client = getMainnetClient();

  // Pin all reads to the same block for consistency
  const blockNumber = await client.getBlockNumber();

  const vaultResults = await client.multicall({
    contracts: [
      { address, abi: erc4626Abi, functionName: "totalAssets" },
      { address, abi: erc4626Abi, functionName: "name" },
      { address, abi: erc4626Abi, functionName: "symbol" },
      { address, abi: erc4626Abi, functionName: "decimals" },
      { address, abi: erc4626Abi, functionName: "asset" },
    ],
    allowFailure: true,
    blockNumber,
  });

  const totalAssetsOk = vaultResults[0].status === "success";
  const totalAssets = totalAssetsOk ? (vaultResults[0].result as bigint) : 0n;
  const name = vaultResults[1].status === "success" ? (vaultResults[1].result as string) : "Unknown Vault";
  const symbol = vaultResults[2].status === "success" ? (vaultResults[2].result as string) : "VAULT";
  const vaultDecimals = vaultResults[3].status === "success" ? Number(vaultResults[3].result) : 18;
  const assetAddress = vaultResults[4].status === "success" ? (vaultResults[4].result as Address) : null;

  if (!totalAssetsOk) {
    console.error(`[VaultMonitor] Warning: totalAssets() call failed for ${address} — may not be a valid ERC-4626 vault.`);
  }

  const oneShare = 10n ** BigInt(vaultDecimals);

  const assetPromise = assetAddress
    ? client.multicall({
        contracts: [
          { address: assetAddress, abi: erc20Abi, functionName: "decimals" },
          { address: assetAddress, abi: erc20Abi, functionName: "symbol" },
        ],
        allowFailure: true,
        blockNumber,
      })
    : null;

  const sharePricePromise = client.multicall({
    contracts: [
      { address, abi: erc4626Abi, functionName: "convertToAssets", args: [oneShare] },
    ],
    allowFailure: true,
    blockNumber,
  });

  const [assetResults, sharePriceResults] = await Promise.all([assetPromise, sharePricePromise]);

  let assetDecimals = vaultDecimals;
  let assetSymbol = "ETH";

  if (assetResults) {
    if (assetResults[0].status === "success") {
      assetDecimals = Number(assetResults[0].result);
    }
    if (assetResults[1].status === "success") {
      assetSymbol = assetResults[1].result as string;
    }
  }

  const sharePriceOk = sharePriceResults[0].status === "success";
  const sharePrice = sharePriceOk
    ? (sharePriceResults[0].result as bigint)
    : 10n ** BigInt(assetDecimals);

  if (!sharePriceOk) {
    console.error(`[VaultMonitor] Warning: convertToAssets() call failed for ${address} — using 1:1 share price fallback.`);
  }

  return { totalAssets, sharePrice, name, symbol, vaultDecimals, assetDecimals, assetSymbol };
}

const MAX_REASONABLE_APR_PCT = 100;
const MIN_REASONABLE_APR_PCT = -20;

const mellowVaultSchema = z.object({
  address: z.string(),
  name: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  chain_id: z.number().nullable().optional(),
  apr: z.number().nullable().optional(),
  apy: z.number().nullable().optional(),
  totalApy: z.number().nullable().optional(),
  metrics: z.object({ apy: z.number().nullable().optional() }).nullable().optional(),
}).passthrough();

const mellowApiResponseSchema = z.array(mellowVaultSchema);

let mellowCacheData: z.infer<typeof mellowApiResponseSchema> | null = null;
let mellowCacheTimestamp = 0;
const MELLOW_CACHE_TTL_MS = 60_000; // 1 minute

export async function fetchMellowVaults(): Promise<z.infer<typeof mellowApiResponseSchema> | null> {
  const now = Date.now();
  if (mellowCacheData && now - mellowCacheTimestamp < MELLOW_CACHE_TTL_MS) {
    return mellowCacheData;
  }

  try {
    const resp = await fetch("https://points.mellow.finance/v1/vaults", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return null;

    const raw = await resp.json();
    const parsed = mellowApiResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[VaultMonitor] Warning: failed to parse mellow vaults: ${parsed.error.message}`);
      return null;
    }

    mellowCacheData = parsed.data;
    mellowCacheTimestamp = now;
    return parsed.data;
  } catch (e) {
    console.error(`[VaultMonitor] Warning: failed to fetch mellow vaults: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export function clearMellowCache(): void {
  mellowCacheData = null;
  mellowCacheTimestamp = 0;
}

/**
 * Fetch APR from the Mellow API. Returns null for unknown addresses or on failure.
 * APR/APY values are already in percentage form (e.g. 2.88 means 2.88%).
 */
export async function fetchMellowVaultApr(address: string): Promise<number | null> {
  const vaults = await fetchMellowVaults();
  if (!vaults) return null;

  const vault = vaults.find((v) =>
    normalizeAddress(v.address) === normalizeAddress(address)
  );
  if (!vault) return null;

  const candidates = [vault.apr, vault.apy, vault.totalApy, vault.metrics?.apy];
  for (const val of candidates) {
    if (typeof val === "number" && isFinite(val)) {
      if (val < MIN_REASONABLE_APR_PCT || val > MAX_REASONABLE_APR_PCT) return null;
      return val;
    }
  }

  return null;
}

const lidoAprResponseSchema = z.object({
  data: z.object({
    smaApr: z.number().nullable(),
  }),
});

const MAX_STETH_APR_PCT = 20;

export async function fetchStethBenchmark(): Promise<BenchmarkRates> {
  try {
    const resp = await fetch("https://eth-api.lido.fi/v1/protocol/steth/apr/sma", {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return { stethApr: null, timestamp: Date.now() };

    const raw = await resp.json();
    const parsed = lidoAprResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`[VaultMonitor] Warning: failed to parse stETH APR: ${parsed.error.message}`);
      return { stethApr: null, timestamp: Date.now() };
    }

    const apr = parsed.data.data.smaApr;
    if (apr === null || !isFinite(apr) || apr < 0 || apr > MAX_STETH_APR_PCT) {
      return { stethApr: null, timestamp: Date.now() };
    }

    return { stethApr: apr, timestamp: Date.now() };
  } catch (e) {
    console.error(`[VaultMonitor] Warning: failed to fetch stETH APR: ${e instanceof Error ? e.message : String(e)}`);
    return { stethApr: null, timestamp: Date.now() };
  }
}

const MIN_APR_ELAPSED_SECONDS = 3600;

/**
 * Compute annualized APR from share price change.
 *
 * Uses BigInt-scaled arithmetic to preserve precision for 18-decimal
 * share prices that exceed Number.MAX_SAFE_INTEGER.
 *
 * Returns simple annualized rate (APR) — not compound APY — since
 * the stETH benchmark from Lido is also APR (smaApr).
 */
export function computeApr(
  currentSharePrice: bigint,
  previousSharePrice: bigint,
  elapsedSeconds: number,
): number | null {
  if (previousSharePrice === 0n || elapsedSeconds <= 0) return null;

  // Require at least 1 hour of data to avoid annualizing transient noise
  if (elapsedSeconds < MIN_APR_ELAPSED_SECONDS) return null;

  const scaledRate = ((currentSharePrice - previousSharePrice) * BIGINT_SCALE_18) / previousSharePrice;

  const rate = Number(scaledRate) / 1e18;
  const secondsPerYear = 365.25 * 24 * 60 * 60;
  const apr = (rate * secondsPerYear) / elapsedSeconds;
  const aprPct = apr * 100;

  // Apply same sanity bounds as API-sourced data to prevent alert storms from
  // flash-loan-induced share price spikes or oracle manipulation.
  if (aprPct < MIN_REASONABLE_APR_PCT || aprPct > MAX_REASONABLE_APR_PCT) {
    return null;
  }

  return aprPct;
}

export async function buildVaultSnapshot(
  watch: VaultWatch,
  previousSnapshot?: VaultSnapshot,
): Promise<VaultSnapshot> {
  const onChain = await readVaultOnChain(watch.address);

  let apr = await fetchMellowVaultApr(watch.address);

  if (apr === null && previousSnapshot && previousSnapshot.sharePrice > 0n) {
    const elapsed = Math.floor(Date.now() / 1000) - previousSnapshot.timestamp;
    apr = computeApr(onChain.sharePrice, previousSnapshot.sharePrice, elapsed);
  }

  return {
    address: watch.address,
    name: watch.name || onChain.name,
    apr,
    tvl: formatUnits(onChain.totalAssets, onChain.assetDecimals),
    tvlRaw: onChain.totalAssets,
    sharePrice: onChain.sharePrice,
    timestamp: Math.floor(Date.now() / 1000),
    assetDecimals: onChain.assetDecimals,
    assetSymbol: onChain.assetSymbol,
  };
}
