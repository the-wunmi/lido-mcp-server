import { z } from "zod";
import { sdk } from "../sdk-factory.js";
import { formatPercent, textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const aprToolDef = {
  name: "lido_get_staking_apr",
  description:
    "Get the current Lido staking APR and optionally a Simple Moving Average (SMA) over N days. " +
    "Returns the latest APR from the most recent rebase event.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sma_days: {
        type: "number",
        description: "Number of days for SMA calculation (e.g. 7, 30). Optional.",
      },
    },
  },
  annotations: {
    title: "Get Staking APR",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const schema = z.object({
  sma_days: z.number().int().min(1).max(365).optional(),
});

export async function handleGetStakingApr(args: Record<string, unknown>) {
  try {
    const { sma_days } = schema.parse(args);

    const lastApr = await sdk.statistics.apr.getLastApr();

    const lines = [
      `Current Lido Staking APR: ${formatPercent(lastApr)}`,
    ];

    if (sma_days) {
      const smaApr = await sdk.statistics.apr.getSmaApr({ days: sma_days });
      lines.push(`${sma_days}-day SMA APR: ${formatPercent(smaApr)}`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
