import { z } from "zod";
import { formatEther, type Address } from "viem";
import { sdk, publicClient, getAccountAddress } from "../sdk-factory.js";
import { textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";

export const balancesToolDef = {
  name: "lido_get_balances",
  description:
    "Get ETH, stETH, and wstETH balances for a given Ethereum address. " +
    "If no address is provided, uses the configured wallet address.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Ethereum address (0x...). Defaults to the configured wallet.",
      },
    },
  },
  annotations: {
    title: "Get Token Balances",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const schema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function handleGetBalances(args: Record<string, unknown>) {
  try {
    const { address: rawAddr } = schema.parse(args);
    const address = (rawAddr ?? getAccountAddress()) as Address;

    const [ethBalance, stethBalance, wstethBalance] = await Promise.all([
      publicClient.getBalance({ address }),
      sdk.steth.balance(address),
      sdk.wsteth.balance(address),
    ]);

    const text = [
      `Balances for ${address}:`,
      `  ETH:    ${formatEther(ethBalance)}`,
      `  stETH:  ${formatEther(stethBalance)}`,
      `  wstETH: ${formatEther(wstethBalance)}`,
    ].join("\n");

    return textResult(text);
  } catch (error) {
    return handleToolError(error);
  }
}
