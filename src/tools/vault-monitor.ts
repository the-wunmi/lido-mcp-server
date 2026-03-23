import { z } from "zod";
import type { Address } from "viem";
import { textResult } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";
import { monitorConfig } from "../monitor/config.js";
import {
  addWatch,
  removeWatch,
  addRule,
  removeRule,
  getWatch,
  getWatches,
  getSnapshots,
  getLatestAlerts,
  getLatestSnapshot,
  getBenchmarks,
  updateWatchRecipient,
  runVaultCheck,
} from "../monitor/watcher.js";
import { buildVaultSnapshot, fetchStethBenchmark, fetchMellowVaults } from "../monitor/data.js";
import { isMellowCoreVault, getAllMellowCoreVaults, getVaultType } from "../monitor/vault-registry.js";
import { testAllChannels, getChannelStatus } from "../monitor/notifier.js";
import { validateExpression, generateRuleId, getAvailableVariables, dryRunRule, MAX_EXPRESSION_LENGTH, MAX_MESSAGE_LENGTH } from "../monitor/rules.js";
import {
  formatVaultHealthReport,
  formatWatchList,
  formatAlertList,
  formatDryRunResult,
} from "../monitor/formatter.js";
import type { AlertRule } from "../monitor/types.js";

export const listEarnVaultsToolDef = {
  name: "lido_list_earn_vaults",
  description:
    "List available Mellow earn vaults from the live API. " +
    "Returns vault names, symbols, addresses, and APR/APY data. " +
    "Use this to discover vault addresses before watching or checking them.",
  inputSchema: {
    type: "object" as const,
    properties: {
      chain_id: {
        type: "number",
        description: "Filter by chain ID (default: 1 for mainnet).",
      },
    },
  },
  annotations: {
    title: "[Earn Vaults] List Earn Vaults",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

const listEarnVaultsSchema = z.object({
  chain_id: z.number().int().optional().default(1),
});

export async function handleListEarnVaults(args: Record<string, unknown>) {
  try {
    const { chain_id } = listEarnVaultsSchema.parse(args);

    const vaults = await fetchMellowVaults();

    // Core Vaults are in the API, but if the API is down we can still
    // show their addresses from our hardcoded config as a fallback.
    if (!vaults) {
      if (chain_id === 1) {
        const coreVaults = getAllMellowCoreVaults();
        const lines = [
          `=== Mellow Earn Vaults (chain ${chain_id}) ===`,
          `Total: ${coreVaults.length} (API unavailable — showing known Core Vaults only)`,
          "",
        ];
        for (const cv of coreVaults) {
          lines.push(`${cv.displayName} (${cv.displaySymbol}) [Core Vault]`);
          lines.push(`  Address: ${cv.vault}`);
          lines.push(`  Asset: ${cv.assetSymbol}`);
          lines.push("");
        }
        return textResult(lines.join("\n"));
      }
      return textResult("Unable to fetch vault data from the Mellow API. Try again later.");
    }

    const filtered = vaults.filter((v) => v.chain_id === undefined || v.chain_id === chain_id);

    if (filtered.length === 0) {
      return textResult(`No earn vaults found for chain ID ${chain_id}.`);
    }

    const lines = [
      `=== Mellow Earn Vaults (chain ${chain_id}) ===`,
      `Total: ${filtered.length}`,
      "",
    ];

    for (const v of filtered) {
      const name = v.name ?? "Unknown";
      const symbol = v.symbol ?? "—";
      const apr = v.apr ?? v.apy ?? v.totalApy ?? v.metrics?.apy;
      const aprStr = typeof apr === "number" && isFinite(apr) ? `${apr.toFixed(2)}%` : "N/A";
      const isCoreVault = isMellowCoreVault(v.address);

      lines.push(`${name} (${symbol})${isCoreVault ? " [Core Vault]" : ""}`);
      lines.push(`  Address: ${v.address}`);
      lines.push(`  APR: ${aprStr}`);
      lines.push("");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

const rulesDescription =
  "Array of alert rules. Each rule has: expression (mathjs expression evaluated against vault data — " +
  "available variables: apr (or apy), apr_prev (or apy_prev), apr_delta (or apy_delta), " +
  "tvl, tvl_prev, tvl_change_pct, share_price, " +
  "share_price_prev, share_price_change_pct, steth_apr, spread_vs_steth, " +
  "max_alloc_shift (largest protocol allocation change in pp), num_protocols, top_alloc_pct), " +
  "severity ('info', 'warning', or 'critical'), " +
  "message (template string with {{variable}} interpolation, e.g. 'APR dropped to {{apr}}%').";

export const watchVaultToolDef = {
  name: "lido_watch_vault",
  description:
    "Start watching an ERC-4626 or Mellow Core vault for yield and TVL changes. " +
    "Subscribes to on-chain events and runs periodic health checks. " +
    "Alert rules use mathjs expressions evaluated against vault data. " +
    "Alerts are sent via Telegram (if configured) and/or email (if SMTP is configured and email_to is provided). " +
    "Use lido_list_earn_vaults to discover available vault addresses.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Vault contract address (0x…). Use lido_list_earn_vaults to find addresses.",
      },
      name: {
        type: "string",
        description: "Human-readable name for the vault (auto-detected from on-chain if omitted).",
      },
      rules: {
        type: "array",
        description: rulesDescription,
        items: {
          type: "object",
          properties: {
            expression: { type: "string", description: "mathjs expression, e.g. 'apy < 3.0'" },
            severity: { type: "string", enum: ["info", "warning", "critical"] },
            message: { type: "string", description: "Template with {{var}} interpolation" },
          },
          required: ["expression"],
        },
      },
      email_to: {
        type: "string",
        description: "Email address to receive alerts for this vault. Required for email alerts when SMTP is configured. Stored per-watch.",
      },
    },
    required: ["address"],
  },
  annotations: {
    title: "[Earn Vaults] Watch Vault",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

export const unwatchVaultToolDef = {
  name: "lido_unwatch_vault",
  description: "Stop watching a vault. Unsubscribes from events and removes from config.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Vault contract address (0x…) to stop watching.",
      },
    },
    required: ["address"],
  },
  annotations: {
    title: "[Earn Vaults] Unwatch Vault",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export const addRuleToolDef = {
  name: "lido_add_rule",
  description:
    "Add an alert rule to a watched vault. Rules use mathjs expressions evaluated against " +
    "vault data variables: apr (or apy), apr_prev, apr_delta, tvl, tvl_prev, tvl_change_pct, " +
    "share_price, share_price_prev, share_price_change_pct, steth_apr, spread_vs_steth, " +
    "max_alloc_shift (largest protocol allocation change in pp), num_protocols, top_alloc_pct. " +
    "Use 'and'/'or' for boolean logic (not &&/||). Example: 'apr < 3.0 and tvl_change_pct > 5'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Vault contract address (0x…) to add the rule to.",
      },
      expression: {
        type: "string",
        description: "mathjs expression that evaluates to true when the alert should fire. E.g. 'apy < 3.0', 'tvl_change_pct > 10', 'apy < steth_apr - 0.5'.",
      },
      severity: {
        type: "string",
        enum: ["info", "warning", "critical"],
        description: "Alert severity. Default: 'warning'.",
      },
      message: {
        type: "string",
        description: "Message template with {{variable}} interpolation. E.g. 'APY dropped to {{apy}}%, below your 3% floor. stETH is at {{steth_apr}}%.'",
      },
    },
    required: ["address", "expression"],
  },
  annotations: {
    title: "[Earn Vaults] Add Alert Rule",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export const removeRuleToolDef = {
  name: "lido_remove_rule",
  description: "Remove an alert rule from a watched vault by rule ID.",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Vault contract address (0x…).",
      },
      rule_id: {
        type: "string",
        description: "ID of the rule to remove (shown in lido_list_watches output).",
      },
    },
    required: ["address", "rule_id"],
  },
  annotations: {
    title: "[Earn Vaults] Remove Alert Rule",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export const testNotificationsToolDef = {
  name: "lido_test_notifications",
  description:
    "Send a test message to all configured notification channels (Telegram, Email) or a specific one. " +
    "Provide address + email_to to update a watch's email recipient and test delivery. " +
    "Provide email_to alone for a one-off test without persisting.",
  inputSchema: {
    type: "object" as const,
    properties: {
      channel: {
        type: "string",
        description: "Optional: test only a specific channel ('telegram' or 'email'). Tests all if omitted.",
      },
      address: {
        type: "string",
        description: "Optional vault contract address (0x…). When combined with email_to, updates the watch's email recipient.",
      },
      email_to: {
        type: "string",
        description: "Email address for the test. Combined with address, persists to the watch.",
      },
    },
  },
  annotations: {
    title: "[Earn Vaults] Test Notifications",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const listWatchesToolDef = {
  name: "lido_list_watches",
  description: "List all watched vaults with their rules, thresholds, and latest status.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
  annotations: {
    title: "[Earn Vaults] List Watched Vaults",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const checkVaultToolDef = {
  name: "lido_check_vault",
  description:
    "On-demand health check for any ERC-4626 or Mellow Core vault (no watch required). " +
    "Returns APR, TVL, share price, stETH benchmark comparison, and protocol allocation breakdown (for known Lido Earn vaults).",
  inputSchema: {
    type: "object" as const,
    properties: {
      address: {
        type: "string",
        description: "Vault contract address (0x…). Use lido_list_earn_vaults to find addresses.",
      },
      name: {
        type: "string",
        description: "Optional name for the vault.",
      },
    },
    required: ["address"],
  },
  annotations: {
    title: "[Earn Vaults] Check Vault Health",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};

export const getVaultAlertsToolDef = {
  name: "lido_get_vault_alerts",
  description: "Get recent alerts from the vault monitor. Optionally filter by vault address.",
  inputSchema: {
    type: "object" as const,
    properties: {
      count: {
        type: "number",
        description: "Number of recent alerts to return (default 20, max 100).",
      },
      address: {
        type: "string",
        description: "Filter by vault contract address (0x…).",
      },
    },
  },
  annotations: {
    title: "[Earn Vaults] Get Vault Alerts",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const severitySchema = z.enum(["info", "warning", "critical"]).default("warning");

const ruleInputSchema = z.object({
  expression: z.string().min(1).max(MAX_EXPRESSION_LENGTH),
  severity: severitySchema,
  message: z.string().max(MAX_MESSAGE_LENGTH).optional(),
});

const watchVaultSchema = z.object({
  address: addressSchema,
  name: z.string().max(100).optional(),
  rules: z.array(ruleInputSchema).optional(),
  email_to: z.string().email().optional(),
});

const unwatchVaultSchema = z.object({
  address: addressSchema,
});

const addRuleSchema = z.object({
  address: addressSchema,
  expression: z.string().min(1).max(MAX_EXPRESSION_LENGTH),
  severity: severitySchema,
  message: z.string().max(MAX_MESSAGE_LENGTH).optional(),
});

const removeRuleSchema = z.object({
  address: addressSchema,
  rule_id: z.string().min(1),
});

const checkVaultSchema = z.object({
  address: addressSchema,
  name: z.string().optional(),
});

const testNotificationsSchema = z.object({
  channel: z.string().optional(),
  address: addressSchema.optional(),
  email_to: z.string().email().optional(),
});

const getAlertsSchema = z.object({
  count: z.number().int().min(1).max(100).optional(),
  address: addressSchema.optional(),
});

function generateDefaultMessage(expression: string): string {
  const trimmed = expression.trim();

  const aprBelow = trimmed.match(/^(?:apr|apy)\s*<\s*([\d.]+)$/);
  if (aprBelow) return `APR dropped to {{apr}}%, below your ${aprBelow[1]}% threshold`;

  const tvlDrop = trimmed.match(/^tvl_change_pct\s*<\s*-?([\d.]+)$/);
  if (tvlDrop) return `TVL dropped by {{tvl_change_pct}}%`;

  const spreadBelow = trimmed.match(/^spread_vs_steth\s*<\s*(-?[\d.]+)$/);
  if (spreadBelow) return `Vault underperforming stETH by {{spread_vs_steth}}pp`;

  const aprDelta = trimmed.match(/^(?:apr|apy)_delta\s*<\s*-?([\d.]+)$/);
  if (aprDelta) return `APR changed by {{apr_delta}}pp (now {{apr}}%)`;

  return `Alert: {{apr}}% APR, TVL {{tvl}}. Condition: ${expression}`;
}

type BuildRuleResult =
  | { ok: true; rule: AlertRule }
  | { ok: false; error: string };

function buildRule(input: { expression: string; severity: string; message?: string }): BuildRuleResult {
  const error = validateExpression(input.expression);
  if (error) return { ok: false, error };

  return {
    ok: true,
    rule: {
      id: generateRuleId(),
      expression: input.expression,
      severity: input.severity as AlertRule["severity"],
      message: input.message || generateDefaultMessage(input.expression),
    },
  };
}

export async function handleWatchVault(args: Record<string, unknown>) {
  try {
    if (!monitorConfig.mainnetAvailable) {
      return textResult(
        "Vault monitoring requires a mainnet RPC. Set MAINNET_RPC_URL in your environment."
      );
    }

    const { address, name, rules: ruleInputs, email_to } = watchVaultSchema.parse(args);

    const rules: AlertRule[] = [];
    if (ruleInputs) {
      for (const input of ruleInputs) {
        const result = buildRule(input);
        if (!result.ok) {
          return textResult(`Invalid rule expression "${input.expression}": ${result.error}`);
        }
        rules.push(result.rule);
      }
    }

    const telegramOn = monitorConfig.telegram.enabled;
    const smtpOn = monitorConfig.email.enabled;

    if (!telegramOn) {
      if (smtpOn && !email_to) {
        return textResult(
          "SMTP is configured but no recipient provided. Pass `email_to` to specify where alerts should be sent."
        );
      }
      if (!smtpOn) {
        return textResult(
          "No notification channels configured. Set up SMTP (SMTP_HOST etc.) and provide `email_to`, or configure Telegram (TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)."
        );
      }
    }

    const vaultType = getVaultType(address);

    const snapshot = await addWatch({
      address: address as Address,
      name: name ?? "",
      rules,
      addedAt: Date.now(),
      ...(email_to ? { recipient: email_to } : {}),
      vaultType,
    });

    const lines = [
      `Now watching vault: ${snapshot.name} (${address})`,
      `  TVL: ${snapshot.tvl} ${snapshot.assetSymbol}`,
      snapshot.apr !== null ? `  APR: ${snapshot.apr.toFixed(2)}%` : "  APR: Not yet available",
    ];

    if (email_to) {
      lines.push(`  Email alerts: ${email_to}`);
      lines.push("  Tip: Use lido_test_notifications to verify email delivery.");
    }

    if (rules.length > 0) {
      lines.push(`  Rules: ${rules.length}`);
      for (const r of rules) {
        lines.push(`    ${r.expression} [${r.severity}] (${r.id})`);
      }

      runVaultCheck(address as Address).catch(() => {});
    } else {
      lines.push("");
      lines.push("No alert rules configured yet. Here are some suggested rules:");
      lines.push('  "apy < 3.0"                    — Alert if APR drops below 3%');
      lines.push('  "spread_vs_steth < 0"           — Alert if vault underperforms stETH');
      lines.push('  "tvl_change_pct < -10"           — Alert on large TVL outflows');
      lines.push('  "share_price_change_pct < -0.1"  — Alert on share price drop (possible exploit)');
      lines.push('  "max_alloc_shift > 10"           — Alert on large protocol allocation shift (>10pp)');
      lines.push("");
      lines.push("Use lido_add_rule to add one.");
    }


    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleUnwatchVault(args: Record<string, unknown>) {
  try {
    const { address } = unwatchVaultSchema.parse(args);
    const watch = await removeWatch(address);
    const ruleCount = watch.rules.length;
    return textResult(
      `Stopped watching ${watch.name || address}. Removed ${ruleCount} rule(s).`
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleAddRule(args: Record<string, unknown>) {
  try {
    const { address, expression, severity, message } = addRuleSchema.parse(args);

    const result = buildRule({ expression, severity, message });
    if (!result.ok) {
      return textResult(`Invalid rule expression: ${result.error}`);
    }

    const { rule } = result;
    const watch = await addRule(address, rule);

    const lines = [
      `Added rule to ${watch.name || address}:`,
      `  ${rule.expression} [${rule.severity}] (${rule.id})`,
      `  Message: ${rule.message}`,
      "",
      `Total rules: ${watch.rules.length}`,
    ];

    const snapshot = getLatestSnapshot(address);
    if (snapshot) {
      const benchmarks = getBenchmarks();
      const previous = undefined;
      const dryResult = dryRunRule(rule.expression, rule.message, snapshot, previous, benchmarks);
      lines.push("");
      lines.push(formatDryRunResult(rule.expression, dryResult));
    } else {
      lines.push("");
      lines.push("No snapshot data yet. Rule will be evaluated on next health check.");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleRemoveRule(args: Record<string, unknown>) {
  try {
    const { address, rule_id } = removeRuleSchema.parse(args);
    const watch = await removeRule(address, rule_id);

    return textResult(`Removed rule "${rule_id}" from ${watch.name || address}. ${watch.rules.length} rule(s) remaining.`);
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleTestNotifications(args: Record<string, unknown>) {
  try {
    const { channel, address, email_to } = testNotificationsSchema.parse(args);

    let effectiveEmail: string | undefined = email_to;

    if (address && email_to) {
      // Update the watch's recipient and use it for testing
      await updateWatchRecipient(address, email_to);
    } else if (address && !email_to) {
      effectiveEmail = getWatch(address)?.recipient;
    }

    const results = await testAllChannels(channel, effectiveEmail);

    const lines = results.map((r) => {
      if (r.success) {
        return `${r.name}: Test message sent successfully.`;
      }
      return `${r.name}: Failed — ${r.error}`;
    });

    if (address && email_to) {
      lines.push(`\nEmail recipient for ${address} updated to: ${email_to}`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}


export async function handleListWatches(_args: Record<string, unknown>) {
  try {
    const watches = getWatches();
    const snaps = getSnapshots();
    return textResult(formatWatchList(watches, snaps));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleCheckVault(args: Record<string, unknown>) {
  try {
    if (!monitorConfig.mainnetAvailable) {
      return textResult(
        "Vault checking requires a mainnet RPC. Set MAINNET_RPC_URL in your environment."
      );
    }

    const { address, name } = checkVaultSchema.parse(args);

    const vaultType = getVaultType(address);
    const watch = { address: address as Address, name: name ?? "", rules: [], addedAt: 0, vaultType };
    const snapshot = await buildVaultSnapshot(watch);
    const benchmarks = await fetchStethBenchmark();

    return textResult(formatVaultHealthReport(snapshot, benchmarks));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleGetVaultAlerts(args: Record<string, unknown>) {
  try {
    const { count, address } = getAlertsSchema.parse(args);
    const alerts = getLatestAlerts(count ?? 20, address);
    return textResult(formatAlertList(alerts));
  } catch (error) {
    return handleToolError(error);
  }
}
