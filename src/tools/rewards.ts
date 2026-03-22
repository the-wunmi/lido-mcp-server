import { z } from "zod";
import { formatEther, type Address } from "viem";
import { sdk, getAccountAddress } from "../sdk-factory.js";
import { formatPercent, textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const rewardsToolDef = {
  name: "lido_get_rewards",
  description:
    "Get historical staking rewards for an address. Uses on-chain data by default. " +
    "Specify `back` as a number of days or block count to look back, or `from_block` for a specific starting block.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address to query rewards for. Defaults to configured wallet.",
      },
      back_days: {
        type: "number",
        description: "Number of days to look back (e.g. 7, 30). Default: 7.",
      },
      from_block: {
        type: "number",
        description: "Start block number (alternative to back_days).",
      },
      step_block: {
        type: "number",
        description: "Block step size for scanning. Larger = faster but less granular. Default: 50000.",
      },
    },
    required: [],
  },
  annotations: {
    title: "Get Staking Rewards",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const schema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  back_days: z.number().int().min(1).max(365).optional(),
  from_block: z.number().int().optional(),
  step_block: z.number().int().min(100).optional(),
});

export async function handleGetRewards(args: Record<string, unknown>) {
  try {
    const { address: rawAddr, back_days, from_block, step_block } = schema.parse(args);
    const address = (rawAddr ?? getAccountAddress()) as Address;

    const backDays = back_days ?? 7;

    const base = {
      address,
      stepBlock: step_block ?? 10000,
      includeOnlyRebases: true,
    };

    const result = from_block
      ? await sdk.rewards.getRewardsFromChain({ ...base, from: { block: BigInt(from_block) } })
      : await sdk.rewards.getRewardsFromChain({ ...base, back: { days: BigInt(backDays) } });

    const lines = [
      `=== Staking Rewards for ${address} ===`,
      `Period: block ${result.fromBlock} → ${result.toBlock}`,
      `Total rewards: ${formatEther(result.totalRewards)} stETH`,
      `Base balance: ${formatEther(result.baseBalance)} stETH`,
      "",
    ];

    if (result.rewards.length > 0) {
      lines.push(`Rebase events (${result.rewards.length}):`);
      for (const r of result.rewards.slice(-10)) {
        const aprStr = r.apr !== undefined ? ` (APR: ${formatPercent(r.apr)})` : "";
        lines.push(`  ${r.type}: ${formatEther(r.change)} stETH → balance ${formatEther(r.balance)} stETH${aprStr}`);
      }
      if (result.rewards.length > 10) {
        lines.push(`  ... and ${result.rewards.length - 10} more events`);
      }
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
