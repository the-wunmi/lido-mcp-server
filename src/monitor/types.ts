import type { Address } from "viem";

export interface AlertRule {
  id: string;
  expression: string;
  severity: AlertSeverity;
  message: string;
}

export interface VaultWatch {
  address: Address;
  name: string;
  rules: AlertRule[];
  addedAt: number;
  recipient?: string;
}

export interface VaultSnapshot {
  address: string;
  name: string;
  apr: number | null;
  tvl: string;
  tvlRaw: bigint;
  sharePrice: bigint;
  timestamp: number;
  assetDecimals: number;
  assetSymbol: string;
}

export interface BenchmarkRates {
  stethApr: number | null;
  timestamp: number;
}

export type AlertSeverity = "info" | "warning" | "critical";

export interface VaultAlert {
  ruleId: string;
  severity: AlertSeverity;
  vaultAddress: string;
  vaultName: string;
  message: string;
  context: AlertContext;
  timestamp: number;
}

export interface AlertContext {
  expression: string;
  scope: Record<string, number>;
  current: { apr: number | null; tvl: string; sharePrice: string; assetSymbol: string };
  previous: { apr: number | null; tvl: string; sharePrice: string } | null;
  benchmarks: { stethApr: number | null };
}

export interface NotificationChannel {
  readonly name: string;
  readonly enabled: boolean;
  send(message: string): Promise<void>;
  sendTest(): Promise<{ success: boolean; error?: string }>;
}

/** Bump this when the PersistedState shape changes in a backwards-incompatible way. */
export const PERSISTED_STATE_VERSION = 2;

export interface PersistedState {
  version: number;
  watches: VaultWatch[];
  snapshots: Record<string, SerializedSnapshot>;
  alertHistory: VaultAlert[];
  dedupTimestamps?: Record<string, number>;
}

export interface SerializedSnapshot {
  address: string;
  name: string;
  apr: number | null;
  tvl: string;
  tvlRaw: string;
  sharePrice: string;
  timestamp: number;
  assetDecimals: number;
  assetSymbol: string;
}

export function serializeSnapshot(s: VaultSnapshot): SerializedSnapshot {
  return {
    address: s.address,
    name: s.name,
    apr: s.apr,
    tvl: s.tvl,
    tvlRaw: s.tvlRaw.toString(),
    sharePrice: s.sharePrice.toString(),
    timestamp: s.timestamp,
    assetDecimals: s.assetDecimals,
    assetSymbol: s.assetSymbol,
  };
}

const BIGINT_PATTERN = /^-?\d{1,78}$/;

export function safeBigInt(value: string, field: string): bigint {
  if (!BIGINT_PATTERN.test(value)) {
    throw new Error(`Invalid BigInt value for ${field}: "${value}"`);
  }
  return BigInt(value);
}

export function deserializeSnapshot(s: SerializedSnapshot): VaultSnapshot {
  return {
    address: s.address,
    name: s.name,
    apr: s.apr,
    tvl: s.tvl,
    tvlRaw: safeBigInt(s.tvlRaw, "tvlRaw"),
    sharePrice: safeBigInt(s.sharePrice, "sharePrice"),
    timestamp: s.timestamp,
    assetDecimals: s.assetDecimals ?? 18,
    assetSymbol: s.assetSymbol ?? "ETH",
  };
}
