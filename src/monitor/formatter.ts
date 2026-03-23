import type { VaultAlert, VaultSnapshot, VaultWatch, BenchmarkRates } from "./types.js";
import { safeBigInt } from "./types.js";
import { BIGINT_SCALE_18, normalizeAddress } from "./config.js";
import { VARIABLE_DECIMALS, type DryRunResult } from "./rules.js";

export function escapeTelegramMarkdown(text: string): string {
  return text.replace(/[*_`\[\]]/g, "\\$&");
}

export function formatTvl(tvl: string, symbol: string): string {
  const num = parseFloat(tvl);
  if (isNaN(num)) return `${tvl} ${symbol}`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M ${symbol}`;
  if (num >= 1_000) return `${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol}`;
  return `${num.toFixed(4)} ${symbol}`;
}

export function formatSharePrice(sharePrice: string, assetDecimals: number, assetSymbol: string): string {
  const raw = safeBigInt(sharePrice, "sharePrice");
  const divisor = 10n ** BigInt(assetDecimals);
  const normalized = Number((raw * BIGINT_SCALE_18) / divisor) / 1e18;
  return `${normalized.toFixed(6)} ${assetSymbol}/share`;
}

export function formatAlertForTelegram(alert: VaultAlert, aiExplanation?: string | null): string {
  const lines: string[] = [];
  const sev = alert.severity === "critical" ? "\u{1F6A8}" : alert.severity === "warning" ? "\u26a0\ufe0f" : "\u2139\ufe0f";

  lines.push(`*${escapeTelegramMarkdown(alert.vaultName)}* ${sev} ${severityLabel(alert.severity)}`);
  lines.push("");

  if (aiExplanation) {
    // AI is instructed to produce Telegram Markdown — pass through as-is
    lines.push(aiExplanation);
  } else {
    // User-provided rule message templates may contain Markdown special chars
    lines.push(escapeTelegramMarkdown(alert.message));
    lines.push("");

    const ctx = alert.context;
    const contextLines: string[] = [];
    const unit = ctx.current.assetSymbol ?? "ETH";

    if (ctx.current.apr !== null) {
      contextLines.push(`Current APR: ${ctx.current.apr.toFixed(2)}%`);
    }
    if (ctx.previous?.apr !== null && ctx.previous?.apr !== undefined) {
      contextLines.push(`Previous APR: ${ctx.previous.apr.toFixed(2)}%`);
    }
    contextLines.push(`TVL: ${formatTvl(ctx.current.tvl, unit)}`);
    if (ctx.previous) {
      contextLines.push(`Previous TVL: ${formatTvl(ctx.previous.tvl, unit)}`);
    }
    if (ctx.benchmarks.stethApr !== null) {
      contextLines.push(`stETH benchmark: ${ctx.benchmarks.stethApr.toFixed(2)}%`);
      if (ctx.current.apr !== null) {
        const spread = ctx.current.apr - ctx.benchmarks.stethApr;
        const label = spread >= 0 ? "above" : "below";
        contextLines.push(`Spread vs stETH: ${Math.abs(spread).toFixed(2)}pp ${label}`);
      }
    }

    if (contextLines.length > 0) {
      lines.push("_Context:_");
      for (const cl of contextLines) {
        lines.push(`\u2022 ${cl}`);
      }
      lines.push("");
    }

    const guidance = buildGuidance(alert);
    if (guidance) {
      lines.push(`_${guidance}_`);
    }
  }

  lines.push("");
  lines.push(`[View on Etherscan](https://etherscan.io/address/${alert.vaultAddress})`);

  const ts = new Date(alert.timestamp * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  lines.push(`_${ts}_`);

  return lines.join("\n");
}

function severityLabel(severity: string): string {
  switch (severity) {
    case "critical": return "*Critical*";
    case "warning": return "Warning";
    default: return "Info";
  }
}

function buildGuidance(alert: VaultAlert): string | null {
  const { scope } = alert.context;

  if (!isNaN(scope.spread_vs_steth) && scope.spread_vs_steth < 0) {
    return "This vault is currently underperforming direct stETH staking. If this persists, consider rebalancing.";
  }

  if (alert.severity === "critical") {
    return "Review your position. Consider adjusting your alert thresholds or rebalancing if this persists.";
  }

  if (alert.severity === "warning") {
    return "Worth monitoring. No immediate action needed unless this trend continues.";
  }

  return null;
}

export function formatVaultHealthReport(snapshot: VaultSnapshot, benchmarks?: BenchmarkRates): string {
  const lines: string[] = [];
  const unit = snapshot.assetSymbol ?? "ETH";
  const decimals = snapshot.assetDecimals ?? 18;
  lines.push(`=== Vault Health: ${snapshot.name} ===`);
  lines.push("");
  lines.push(`Address: ${snapshot.address}`);
  lines.push(`TVL: ${formatTvl(snapshot.tvl, unit)}`);
  lines.push(`Share Price: ${formatSharePrice(snapshot.sharePrice.toString(), decimals, unit)}`);

  if (snapshot.apr !== null) {
    lines.push(`APR: ${snapshot.apr.toFixed(2)}%`);
  } else {
    lines.push("APR: Not available (insufficient data or no API coverage)");
  }

  if (benchmarks?.stethApr !== null && benchmarks?.stethApr !== undefined) {
    lines.push("");
    lines.push("--- Benchmark ---");
    lines.push(`stETH APR (SMA): ${benchmarks.stethApr.toFixed(2)}%`);
    if (snapshot.apr !== null) {
      const spread = snapshot.apr - benchmarks.stethApr;
      const label = spread >= 0 ? "above" : "below";
      lines.push(`Spread: ${Math.abs(spread).toFixed(2)}pp ${label} stETH benchmark`);
    }
  }

  lines.push("");
  lines.push(`Last checked: ${new Date(snapshot.timestamp * 1000).toISOString()}`);

  return lines.join("\n");
}

export function formatWatchList(
  watches: VaultWatch[],
  snapshots: Map<string, VaultSnapshot>,
): string {
  if (watches.length === 0) {
    return "No vaults are currently being watched. Use lido_watch_vault to add one.";
  }

  const sections = watches.map((w) => {
    const snap = snapshots.get(normalizeAddress(w.address));
    const lines: string[] = [];

    lines.push(`${w.name} (${w.address})`);
    lines.push(`  Added: ${new Date(w.addedAt).toISOString()}`);
    if (w.recipient) {
      lines.push(`  Email alerts: ${w.recipient}`);
    }

    if (w.rules.length > 0) {
      lines.push(`  Rules (${w.rules.length}):`);
      for (const rule of w.rules) {
        lines.push(`    ${rule.expression} [${rule.severity}] (${rule.id})`);
      }
    } else {
      lines.push("  Rules: None (monitoring only, no alerts)");
    }

    if (snap) {
      const unit = snap.assetSymbol ?? "ETH";
      lines.push(`  Latest TVL: ${formatTvl(snap.tvl, unit)}`);
      if (snap.apr !== null) {
        lines.push(`  Latest APR: ${snap.apr.toFixed(2)}%`);
      }
      lines.push(`  Last checked: ${new Date(snap.timestamp * 1000).toISOString()}`);
    } else {
      lines.push("  Status: Awaiting first health check");
    }

    return lines.join("\n");
  });

  return `=== Watched Vaults (${watches.length}) ===\n\n${sections.join("\n\n")}`;
}

export function formatAlertList(alerts: VaultAlert[]): string {
  if (alerts.length === 0) {
    return "No recent alerts.";
  }

  const lines = alerts.map((a) => {
    const time = new Date(a.timestamp * 1000).toISOString();
    const sev = a.severity.toUpperCase();
    return `[${time}] [${sev}] ${a.vaultName}: ${a.message}`;
  });

  return `=== Recent Alerts (${alerts.length}) ===\n\n${lines.join("\n")}`;
}

export function formatDryRunResult(expression: string, result: DryRunResult): string {
  const lines: string[] = [];

  lines.push("--- Dry Run ---");
  lines.push(result.fired ? "Result: WOULD FIRE with current data" : "Result: would NOT fire with current data");

  const usedVars = Object.keys(result.scope).filter((key) => {
    if (isNaN(result.scope[key])) return false;
    return expression.includes(key);
  });

  if (usedVars.length > 0) {
    lines.push("Current values:");
    for (const v of usedVars) {
      const decimals = VARIABLE_DECIMALS[v] ?? 2;
      lines.push(`  ${v} = ${result.scope[v].toFixed(decimals)}`);
    }
  }

  if (result.fired) {
    lines.push(`Message preview: ${result.renderedMessage}`);
  }

  return lines.join("\n");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function markdownBoldToHtml(text: string): string {
  return text.replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
}

export function formatAlertForEmail(alert: VaultAlert, aiExplanation?: string | null): string {
  const parts: string[] = [];
  const sev = alert.severity === "critical" ? "&#x1F6A8;" : alert.severity === "warning" ? "&#x26A0;&#xFE0F;" : "&#x2139;&#xFE0F;";

  parts.push(`<h2>${escapeHtml(alert.vaultName)} ${sev} ${severityLabel(alert.severity).replace(/\*/g, "")}</h2>`);

  if (aiExplanation) {
    parts.push(`<p>${markdownBoldToHtml(escapeHtml(aiExplanation))}</p>`);
  } else {
    parts.push(`<p>${escapeHtml(alert.message)}</p>`);

    const ctx = alert.context;
    const contextLines: string[] = [];
    const unit = ctx.current.assetSymbol ?? "ETH";

    if (ctx.current.apr !== null) {
      contextLines.push(`Current APR: ${ctx.current.apr.toFixed(2)}%`);
    }
    if (ctx.previous?.apr !== null && ctx.previous?.apr !== undefined) {
      contextLines.push(`Previous APR: ${ctx.previous.apr.toFixed(2)}%`);
    }
    contextLines.push(`TVL: ${formatTvl(ctx.current.tvl, unit)}`);
    if (ctx.previous) {
      contextLines.push(`Previous TVL: ${formatTvl(ctx.previous.tvl, unit)}`);
    }
    if (ctx.benchmarks.stethApr !== null) {
      contextLines.push(`stETH benchmark: ${ctx.benchmarks.stethApr.toFixed(2)}%`);
      if (ctx.current.apr !== null) {
        const spread = ctx.current.apr - ctx.benchmarks.stethApr;
        const label = spread >= 0 ? "above" : "below";
        contextLines.push(`Spread vs stETH: ${Math.abs(spread).toFixed(2)}pp ${label}`);
      }
    }

    if (contextLines.length > 0) {
      parts.push("<p><em>Context:</em></p><ul>");
      for (const cl of contextLines) {
        parts.push(`<li>${escapeHtml(cl)}</li>`);
      }
      parts.push("</ul>");
    }

    const guidance = buildGuidance(alert);
    if (guidance) {
      parts.push(`<p><em>${escapeHtml(guidance)}</em></p>`);
    }
  }

  parts.push(`<p><a href="https://etherscan.io/address/${alert.vaultAddress}">View on Etherscan</a></p>`);

  return parts.join("\n");
}
