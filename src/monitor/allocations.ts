import { type Address, parseAbi } from "viem";
import { getMainnetClient } from "./mainnet-client.js";
import type { ProtocolAllocation } from "./types.js";
import { getVaultConfig, type MellowCoreVaultConfig, type Erc4626VaultConfig, type SubvaultEntry } from "./vault-registry.js";

const erc4626Abi = parseAbi([
  "function totalAssets() view returns (uint256)",
]);

const riskManagerAbi = parseAbi([
  "function subvaultState(address) view returns (int256 balance, int256 limit)",
]);

/** Minimum allocation delta (percentage points) to count as a shift. */
const MIN_SHIFT_PP = 0.01;

function toAllocations(
  subvaultValues: { protocol: string; valueWei: bigint }[],
): ProtocolAllocation[] {
  const total = subvaultValues.reduce((sum, sv) => sum + sv.valueWei, 0n);
  if (total === 0n) return [];

  return subvaultValues
    .map(({ protocol, valueWei }) => ({
      protocol,
      valueWei: valueWei.toString(),
      percentage: Number((valueWei * 10000n) / total) / 100,
    }))
    .filter((a) => a.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage);
}

async function readCoreVaultAllocations(
  config: MellowCoreVaultConfig,
  blockNumber: bigint,
): Promise<ProtocolAllocation[]> {
  const client = getMainnetClient();

  const calls = config.subvaults.map((sv) => ({
    address: config.riskManager,
    abi: riskManagerAbi,
    functionName: "subvaultState" as const,
    args: [sv.address] as [Address],
  }));

  const results = await client.multicall({
    contracts: calls,
    allowFailure: true,
    blockNumber,
  });

  const subvaultValues: { protocol: string; valueWei: bigint }[] = [];

  for (let i = 0; i < config.subvaults.length; i++) {
    const result = results[i];
    let value = 0n;
    if (result.status === "success") {
      const [balance] = result.result as readonly [bigint, bigint];
      value = balance < 0n ? 0n : balance;
    }
    subvaultValues.push({ protocol: config.subvaults[i].protocol, valueWei: value });
  }

  return toAllocations(subvaultValues);
}

/**
 * Read allocations for an ERC-4626 vault via subvault totalAssets().
 */
async function readErc4626Allocations(
  subvaults: SubvaultEntry[],
  blockNumber: bigint,
): Promise<ProtocolAllocation[]> {
  const client = getMainnetClient();

  const calls = subvaults.map((sv) => ({
    address: sv.address,
    abi: erc4626Abi,
    functionName: "totalAssets" as const,
  }));

  const results = await client.multicall({
    contracts: calls,
    allowFailure: true,
    blockNumber,
  });

  const subvaultValues: { protocol: string; valueWei: bigint }[] = [];

  for (let i = 0; i < subvaults.length; i++) {
    const result = results[i];
    const value = result.status === "success" ? (result.result as bigint) : 0n;
    subvaultValues.push({ protocol: subvaults[i].protocol, valueWei: value });
  }

  return toAllocations(subvaultValues);
}

/**
 * Read the total assets managed by each subvault of a known vault.
 * Routes to the appropriate reader based on vault type.
 *
 * Returns per-protocol allocation with percentage of total.
 */
export async function readAllocations(vaultAddress: Address, blockNumber: bigint): Promise<ProtocolAllocation[] | null> {
  const entry = getVaultConfig(vaultAddress);
  if (!entry) return null;

  if (entry.type === "mellow_core") {
    return readCoreVaultAllocations(entry.config, blockNumber);
  }

  return readErc4626Allocations(entry.config.subvaults, blockNumber);
}

/**
 * Detect significant allocation shifts between two snapshots.
 * Returns the largest absolute change in any single protocol's allocation.
 */
export function computeAllocationShift(
  current: ProtocolAllocation[],
  previous: ProtocolAllocation[],
): { maxShiftPct: number; shifted: { protocol: string; from: number; to: number; delta: number }[] } {
  const prevMap = new Map(previous.map((a) => [a.protocol, a.percentage]));
  const currMap = new Map(current.map((a) => [a.protocol, a.percentage]));

  const allProtocols = new Set([...prevMap.keys(), ...currMap.keys()]);
  const shifts: { protocol: string; from: number; to: number; delta: number }[] = [];

  for (const protocol of allProtocols) {
    const from = prevMap.get(protocol) ?? 0;
    const to = currMap.get(protocol) ?? 0;
    const delta = to - from;
    if (Math.abs(delta) > MIN_SHIFT_PP) {
      shifts.push({ protocol, from, to, delta });
    }
  }

  shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const maxShiftPct = shifts.length > 0 ? Math.abs(shifts[0].delta) : 0;

  return { maxShiftPct, shifted: shifts };
}
