import Anthropic from "@anthropic-ai/sdk";
import { monitorConfig } from "./config.js";
import type { VaultAlert } from "./types.js";
import { extractErrorMessage } from "../utils/errors.js";
import { isMellowCoreVault } from "./vault-registry.js";

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!monitorConfig.anthropic.enabled) return null;
  if (!client) {
    client = new Anthropic({ apiKey: monitorConfig.anthropic.apiKey });
  }
  return client;
}

/**
 * Sanitize a string for safe inclusion in an LLM prompt.
 * Strips newlines and control characters, truncates to maxLength.
 */
function sanitizeForPrompt(text: string, maxLength = 200): string {
  return text.replace(/[\n\r]/g, " ").replace(/[\x00-\x1f]/g, "").slice(0, maxLength);
}

/**
 * Aggressively sanitize on-chain strings (vault name, asset symbol) that are
 * attacker-controlled. Only allow alphanumeric, spaces, hyphens, dots, parens.
 */
function sanitizeOnChainString(text: string, maxLength = 100): string {
  return text.replace(/[^a-zA-Z0-9 .()_-]/g, "").slice(0, maxLength);
}

const SYSTEM_PROMPT = `You are a DeFi vault monitoring assistant. You write Telegram alert messages for depositors who hold positions in yield vaults on Ethereum (both ERC-4626 and Mellow Core vaults).

Your job is to explain vault alerts in plain language. Each message must cover:
1. What changed — the specific metric that triggered the alert
2. Why it likely happened — plausible explanations based on the data
3. What to consider — whether the depositor should act, wait, or investigate further

Rules:
- Write for a depositor who understands DeFi basics but not every protocol detail
- Be concise — 3-5 short paragraphs max, Telegram messages should be scannable
- Use numbers from the data provided, don't make up figures
- ALWAYS use the asset denomination provided in the data (e.g., USDC, WETH, ETH) — never assume ETH
- If stETH benchmark data is available, compare against it
- Use the vault type provided (ERC-4626 or Mellow Core) — do not assume ERC-4626
- Never recommend specific financial actions ("sell", "buy") — frame as considerations
- If you can't determine the cause, say so honestly rather than speculating wildly

Telegram formatting rules:
- Use *bold* sparingly for key figures only
- Do NOT use Markdown headers (#, ##, ###)
- Do NOT use backticks or code blocks
- Do NOT use square brackets for links
- Use plain text with occasional *bold* for emphasis
- Keep paragraphs short — one key point per paragraph`;

export async function explainAlert(alert: VaultAlert): Promise<string | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const ctx = alert.context;
  // On-chain strings (vault name, asset symbol) are attacker-controlled — sanitize aggressively
  const vaultName = sanitizeOnChainString(alert.vaultName);
  const assetSymbol = sanitizeOnChainString(ctx.current.assetSymbol ?? "ETH", 20);
  const expression = sanitizeForPrompt(ctx.expression, 200);

  const vaultType = isMellowCoreVault(alert.vaultAddress) ? "Mellow Core" : "ERC-4626";

  const dataBlock = [
    `<vault_data>`,
    `Vault: ${vaultName} (${alert.vaultAddress})`,
    `Vault type: ${vaultType}`,
    `Asset denomination: ${assetSymbol} (use this unit for all values — do NOT substitute with ETH)`,
    `Severity: ${alert.severity}`,
    `Rule triggered: ${expression}`,
    `Rule message: ${sanitizeForPrompt(alert.message, 300)}`,
    "",
    "Current state:",
    `  APR: ${ctx.current.apr !== null ? ctx.current.apr.toFixed(2) + "%" : "N/A"}`,
    `  TVL: ${ctx.current.tvl} ${assetSymbol}`,
    "",
  ];

  if (ctx.previous) {
    dataBlock.push(
      "Previous state:",
      `  APR: ${ctx.previous.apr !== null ? ctx.previous.apr.toFixed(2) + "%" : "N/A"}`,
      `  TVL: ${ctx.previous.tvl} ${assetSymbol}`,
      "",
    );
  }

  if (ctx.benchmarks.stethApr !== null) {
    dataBlock.push(`stETH benchmark APR: ${ctx.benchmarks.stethApr.toFixed(2)}%`);
  }

  const scope = ctx.scope;
  const metrics: string[] = [];
  if (!isNaN(scope.apr_delta)) metrics.push(`APR change: ${scope.apr_delta > 0 ? "+" : ""}${scope.apr_delta.toFixed(2)}pp`);
  if (!isNaN(scope.tvl_change_pct)) metrics.push(`TVL change: ${scope.tvl_change_pct.toFixed(1)}%`);
  if (!isNaN(scope.spread_vs_steth)) metrics.push(`Spread vs stETH: ${scope.spread_vs_steth > 0 ? "+" : ""}${scope.spread_vs_steth.toFixed(2)}pp`);
  if (!isNaN(scope.share_price_change_pct)) metrics.push(`Share price change: ${scope.share_price_change_pct.toFixed(4)}%`);

  if (metrics.length > 0) {
    dataBlock.push("", "Computed metrics:", ...metrics.map(m => `  ${m}`));
  }

  if (ctx.allocationShifts && ctx.allocationShifts.length > 0) {
    dataBlock.push("", "Protocol allocation shifts:");
    for (const shift of ctx.allocationShifts) {
      dataBlock.push(`  ${shift.protocol}: ${shift.from.toFixed(1)}% → ${shift.to.toFixed(1)}% (${shift.delta > 0 ? "+" : ""}${shift.delta.toFixed(1)}pp)`);
    }
  }

  dataBlock.push(`</vault_data>`);

  try {
    const response = await anthropic.messages.create({
      model: monitorConfig.anthropic.model,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Write a Telegram alert message for this vault event:\n\n${dataBlock.join("\n")}`,
        },
      ],
    });

    const text = response.content[0];
    if (text.type === "text" && text.text.trim()) {
      return text.text.trim();
    }
    return null;
  } catch (err) {
    console.error("[VaultMonitor] LLM explanation failed:", extractErrorMessage(err));
    return null;
  }
}
