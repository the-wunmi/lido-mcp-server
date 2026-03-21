import { z } from "zod";
import { formatEther, parseEther } from "viem";
import { sdk } from "../sdk-factory.js";
import { textResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const convertToolDef = {
  name: "lido_convert_amounts",
  description:
    "Convert between stETH and wstETH amounts using the current on-chain exchange rate. " +
    "This is a read-only conversion — no transaction is performed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount to convert (in ETH-scale, e.g. '1.5')",
      },
      direction: {
        type: "string",
        enum: ["steth_to_wsteth", "wsteth_to_steth"],
        description: "Conversion direction",
      },
    },
    required: ["amount", "direction"],
  },
  annotations: {
    title: "Convert stETH/wstETH Amounts",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const schema = z.object({
  amount: ethAmountSchema,
  direction: z.enum(["steth_to_wsteth", "wsteth_to_steth"]),
});

export async function handleConvertAmounts(args: Record<string, unknown>) {
  try {
    const { amount, direction } = schema.parse(args);
    const amountWei = parseEther(amount);

    if (direction === "steth_to_wsteth") {
      const result = await sdk.wrap.convertStethToWsteth(amountWei);
      return textResult(
        `${amount} stETH = ${formatEther(result)} wstETH (at current rate)`
      );
    } else {
      const result = await sdk.wrap.convertWstethToSteth(amountWei);
      return textResult(
        `${amount} wstETH = ${formatEther(result)} stETH (at current rate)`
      );
    }
  } catch (error) {
    return handleToolError(error);
  }
}
