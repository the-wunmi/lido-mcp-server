import { appConfig } from "../config.js";
import { textResult } from "../utils/format.js";

export const chainInfoToolDef = {
  name: "lido_get_chain_info",
  description:
    "Get the chain/network the Lido MCP server is connected to. " +
    "Returns chain ID, network name, L1/L2 mode, and block explorer URL.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "Get Chain Info",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export async function handleGetChainInfo() {
  const { chain, chainId, isL1, isL2 } = appConfig;
  const explorer = chain.blockExplorers?.default?.url ?? "N/A";

  const text = [
    `=== Chain Info ===`,
    `  Network:        ${chain.name}`,
    `  Chain ID:       ${chainId}`,
    `  Type:           ${isL1 ? "L1" : isL2 ? "L2" : "Unknown"}`,
    `  Block Explorer: ${explorer}`,
  ].join("\n");

  return textResult(text);
}
