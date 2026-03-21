#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { validateChainId } from "./sdk-factory.js";
import { appConfig, securityConfig } from "./config.js";
import { sanitizeErrorMessage } from "./utils/errors.js";

const server = new Server(
  {
    name: "lido-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      // Prompts and resources are only available on L1 (they depend on the Lido SDK)
      ...(appConfig.isL1 ? { prompts: {}, resources: {} } : {}),
    },
  }
);

registerTools(server);

// Prompts and resources depend on the Lido SDK — only register on L1
if (appConfig.isL1) {
  registerPrompts(server);
  registerResources(server);
}

async function main() {
  await validateChainId();

  const chainLabel = `${appConfig.chain.name} (chain ${appConfig.chainId})`;
  if (appConfig.isL2) {
    console.error(`Lido MCP Server running in L2 mode on ${chainLabel} — wstETH tools only`);
  } else {
    console.error(`Lido MCP Server running on ${chainLabel}`);
  }

  if (securityConfig.mode !== "full") {
    console.error(`Security mode: ${securityConfig.mode}`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Lido MCP Server running on stdio");
}

main().catch((err) => {
  const msg = err instanceof Error ? sanitizeErrorMessage(err.message) : String(err);
  console.error("Fatal error:", msg);
  process.exit(1);
});
