import { formatEther, formatUnits } from "viem";
import { z } from "zod";

export const ethAmountSchema = z
  .string()
  .regex(/^\d+\.?\d*$/, "Amount must be a positive decimal number (e.g. '1.5')")
  .refine((v) => parseFloat(v) > 0, "Amount must be greater than zero")
  .refine(
    (v) => !v.includes(".") || v.split(".")[1].length <= 18,
    "Amount cannot exceed 18 decimal places (Ethereum's maximum precision)"
  );

export function formatETH(wei: bigint): string {
  return `${formatEther(wei)} ETH`;
}

export function formatStETH(wei: bigint): string {
  return `${formatEther(wei)} stETH`;
}

export function formatWstETH(wei: bigint): string {
  return `${formatEther(wei)} wstETH`;
}

export function formatGwei(wei: bigint): string {
  return `${formatUnits(wei, 9)} Gwei`;
}

export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

export function textResult(text: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(message: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

export function formatTimestamp(ts: number | bigint): string {
  return new Date(Number(ts) * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  return parts.join(" ") || `${seconds}s`;
}
