import { describe, it, expect } from "vitest";
import {
  formatAlertForTelegram,
  formatAlertForEmail,
  formatVaultHealthReport,
  formatWatchList,
  formatAlertList,
  formatDryRunResult,
  escapeTelegramMarkdown,
  escapeHtml,
  formatTvl,
  formatSharePrice,
} from "../../src/monitor/formatter.js";
import type { VaultAlert, VaultSnapshot, VaultWatch, BenchmarkRates, AlertContext } from "../../src/monitor/types.js";
import type { DryRunResult } from "../../src/monitor/rules.js";

function makeContext(overrides: Partial<AlertContext> = {}): AlertContext {
  return {
    expression: "apy < 3.0",
    scope: {
      apr: 2.8, apy_prev: 3.45, apy_delta: -0.65, tvl: 48500, tvl_prev: 49000,
      tvl_change_pct: 1.02, share_price: 1.001, share_price_prev: 1.0,
      share_price_change_pct: 0.1, steth_apr: 3.1, spread_vs_steth: -0.3,
    },
    current: { apr: 2.8, tvl: "48500", sharePrice: (10n ** 18n).toString(), assetSymbol: "ETH" },
    previous: { apr: 3.45, tvl: "49000", sharePrice: (10n ** 18n).toString() },
    benchmarks: { stethApr: 3.1 },
    ...overrides,
  };
}

describe("escapeTelegramMarkdown", () => {
  it("escapes asterisks", () => {
    expect(escapeTelegramMarkdown("bold *text*")).toBe("bold \\*text\\*");
  });

  it("escapes underscores", () => {
    expect(escapeTelegramMarkdown("snake_case_name")).toBe("snake\\_case\\_name");
  });

  it("escapes backticks", () => {
    expect(escapeTelegramMarkdown("code `block`")).toBe("code \\`block\\`");
  });

  it("escapes square brackets", () => {
    expect(escapeTelegramMarkdown("[link](url)")).toBe("\\[link\\](url)");
  });

  it("handles multiple special characters in one string", () => {
    expect(escapeTelegramMarkdown("*bold* _italic_ `code` [link]"))
      .toBe("\\*bold\\* \\_italic\\_ \\`code\\` \\[link\\]");
  });

  it("returns plain text unchanged", () => {
    expect(escapeTelegramMarkdown("hello world 123")).toBe("hello world 123");
  });
});

describe("formatTvl", () => {
  it("formats >= 1M with M suffix", () => {
    expect(formatTvl("1230000", "ETH")).toBe("1.23M ETH");
  });

  it("formats >= 1M with more precision", () => {
    expect(formatTvl("5678900", "ETH")).toBe("5.68M ETH");
  });

  it("formats >= 1K with commas and 2 decimals", () => {
    const result = formatTvl("1234.56", "ETH");
    expect(result).toContain("1,234.56");
    expect(result).toContain("ETH");
  });

  it("formats < 1K with 4 decimals", () => {
    expect(formatTvl("0.1234", "ETH")).toBe("0.1234 ETH");
  });

  it("formats exactly 1000 with comma format", () => {
    const result = formatTvl("1000", "WETH");
    expect(result).toContain("1,000.00");
    expect(result).toContain("WETH");
  });

  it("handles non-numeric TVL gracefully", () => {
    expect(formatTvl("NaN", "ETH")).toBe("NaN ETH");
  });

  it("uses correct symbol", () => {
    expect(formatTvl("500", "USDC")).toBe("500.0000 USDC");
  });
});

describe("formatSharePrice", () => {
  it("normalizes 18-decimal share price", () => {
    // 1.001 ETH = 1001000000000000000 wei
    const result = formatSharePrice("1001000000000000000", 18, "ETH");
    expect(result).toBe("1.001000 ETH/share");
  });

  it("normalizes 6-decimal share price", () => {
    // 1.001 USDC = 1001000
    const result = formatSharePrice("1001000", 6, "USDC");
    expect(result).toBe("1.001000 USDC/share");
  });

  it("handles 1:1 peg (exactly 1.0)", () => {
    const result = formatSharePrice("1000000000000000000", 18, "ETH");
    expect(result).toBe("1.000000 ETH/share");
  });

  it("formats with 6 decimal places", () => {
    const result = formatSharePrice("1234567890123456789", 18, "WETH");
    expect(result).toContain("WETH/share");
    // Should have exactly 6 decimal places
    expect(result).toMatch(/\d+\.\d{6}/);
  });
});

describe("formatAlertForTelegram", () => {
  const baseAlert: VaultAlert = {
    ruleId: "yield-floor",
    severity: "critical",
    vaultAddress: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    vaultName: "EarnETH",
    message: "APY dropped to 2.80%, below your 3.0% floor. stETH is at 3.10%.",
    context: makeContext(),
    timestamp: 1700000000,
  };

  it("includes vault name and severity", () => {
    const text = formatAlertForTelegram(baseAlert);
    expect(text).toContain("EarnETH");
    expect(text).toContain("Critical");
  });

  it("uses correct severity emoji: critical = red siren", () => {
    const text = formatAlertForTelegram(baseAlert);
    // U+1F6A8 is the police car revolving light / siren emoji
    expect(text).toContain("\u{1F6A8}");
  });

  it("uses correct severity emoji: warning = warning sign", () => {
    const alert = { ...baseAlert, severity: "warning" as const };
    const text = formatAlertForTelegram(alert);
    expect(text).toContain("\u26a0\ufe0f");
  });

  it("uses correct severity emoji: info = info symbol", () => {
    const alert: VaultAlert = {
      ...baseAlert,
      severity: "info",
      context: makeContext({
        scope: { ...makeContext().scope, spread_vs_steth: 0.5 },
      }),
    };
    const text = formatAlertForTelegram(alert);
    expect(text).toContain("\u2139\ufe0f");
  });

  it("includes the rendered rule message", () => {
    const text = formatAlertForTelegram(baseAlert);
    expect(text).toContain("2.80%");
    expect(text).toContain("3.0% floor");
  });

  it("includes context section with current and previous values", () => {
    const text = formatAlertForTelegram(baseAlert);
    expect(text).toContain("Current APR: 2.80%");
    expect(text).toContain("Previous APR: 3.45%");
  });

  it("includes benchmark comparison", () => {
    const text = formatAlertForTelegram(baseAlert);
    expect(text).toContain("stETH benchmark: 3.10%");
    expect(text).toContain("below");
  });

  it("includes Etherscan link", () => {
    const text = formatAlertForTelegram(baseAlert);
    expect(text).toContain("[View on Etherscan](https://etherscan.io/address/0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e)");
  });

  it("includes UTC timestamp footer", () => {
    const text = formatAlertForTelegram(baseAlert);
    // timestamp 1700000000 -> 2023-11-14 22:13:20 UTC
    expect(text).toContain("UTC");
    expect(text).toContain("2023-11-14");
  });

  it("includes actionable guidance when underperforming stETH", () => {
    const text = formatAlertForTelegram(baseAlert);
    expect(text).toContain("underperforming");
    expect(text).toContain("rebalancing");
  });

  it("shows warning-level guidance for non-critical alerts", () => {
    const alert: VaultAlert = {
      ...baseAlert,
      severity: "warning",
      context: makeContext({
        scope: { ...makeContext().scope, spread_vs_steth: 0.5 },
      }),
    };
    const text = formatAlertForTelegram(alert);
    expect(text).toContain("Worth monitoring");
  });

  it("shows info-level content without strong guidance", () => {
    const alert: VaultAlert = {
      ...baseAlert,
      severity: "info",
      context: makeContext({
        scope: { ...makeContext().scope, spread_vs_steth: 0.5 },
      }),
    };
    const text = formatAlertForTelegram(alert);
    expect(text).toContain("Info");
    expect(text).not.toContain("Review your position");
  });

  it("handles missing previous snapshot", () => {
    const alert: VaultAlert = {
      ...baseAlert,
      context: makeContext({ previous: null }),
    };
    const text = formatAlertForTelegram(alert);
    expect(text).not.toContain("Previous APR");
    expect(text).not.toContain("Previous TVL");
  });

  it("uses AI explanation when provided (passed through for Telegram)", () => {
    const aiText = "Your EarnETH vault yield dropped to *2.80%*, down from 3.45%.";
    const text = formatAlertForTelegram(baseAlert, aiText);
    expect(text).toContain("EarnETH");
    expect(text).toContain("Critical");
    // AI is instructed to produce Telegram Markdown — passed through as-is
    expect(text).toContain("Your EarnETH vault yield dropped to *2.80%*, down from 3.45%.");
    // Should NOT contain the template-based context section
    expect(text).not.toContain("_Context:_");
    expect(text).not.toContain("underperforming");
    // Should still have Etherscan link and timestamp
    expect(text).toContain("Etherscan");
    expect(text).toContain("UTC");
  });

  it("falls back to template when AI explanation is null", () => {
    const text = formatAlertForTelegram(baseAlert, null);
    expect(text).toContain("_Context:_");
    expect(text).toContain("Current APR: 2.80%");
  });

  it("uses formatTvl for TVL display in context", () => {
    const text = formatAlertForTelegram(baseAlert);
    // 48500 ETH should be formatted with commas
    expect(text).toContain("48,500.00 ETH");
  });
});

describe("formatVaultHealthReport", () => {
  const snapshot: VaultSnapshot = {
    address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    name: "EarnETH",
    apr: 3.5,
    tvl: "50000",
    tvlRaw: 50000n * 10n ** 18n,
    sharePrice: 10n ** 18n,
    timestamp: 1700000000,
    assetDecimals: 18,
    assetSymbol: "ETH",
  };

  it("includes all vault details", () => {
    const text = formatVaultHealthReport(snapshot);
    expect(text).toContain("EarnETH");
    expect(text).toContain("3.50%");
  });

  it("uses formatTvl for TVL display", () => {
    const text = formatVaultHealthReport(snapshot);
    // 50000 ETH -> "50,000.00 ETH"
    expect(text).toContain("50,000.00 ETH");
  });

  it("uses formatSharePrice for share price display", () => {
    const text = formatVaultHealthReport(snapshot);
    // 1.0 ETH/share
    expect(text).toContain("1.000000 ETH/share");
  });

  it("shows spread vs benchmark", () => {
    const benchmarks: BenchmarkRates = { stethApr: 3.0, timestamp: Date.now() };
    const text = formatVaultHealthReport(snapshot, benchmarks);
    expect(text).toContain("stETH APR (SMA): 3.00%");
    expect(text).toContain("0.50pp above");
  });

  it("handles null APY", () => {
    const snap = { ...snapshot, apr: null };
    const text = formatVaultHealthReport(snap);
    expect(text).toContain("Not available");
  });

  it("uses correct asset symbol from snapshot", () => {
    const usdcSnap: VaultSnapshot = {
      ...snapshot,
      assetDecimals: 6,
      assetSymbol: "USDC",
      sharePrice: 1000000n, // 1.0 in 6 decimals
      tvl: "5000000",
    };
    const text = formatVaultHealthReport(usdcSnap);
    expect(text).toContain("USDC");
    expect(text).toContain("5.00M USDC");
    expect(text).toContain("1.000000 USDC/share");
  });
});

describe("formatWatchList", () => {
  it("shows empty message when no watches", () => {
    const text = formatWatchList([], new Map());
    expect(text).toContain("No vaults are currently being watched");
  });

  it("formats watch with rules in 'expression [severity] (id)' format", () => {
    const watches: VaultWatch[] = [
      {
        address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
        name: "EarnETH",
        rules: [
          { id: "r1", expression: "apy < 3.0", severity: "critical", message: "APY below floor" },
          { id: "r2", expression: "tvl_change_pct > 10", severity: "warning", message: "TVL surge" },
        ],
        addedAt: 1700000000000,
      },
    ];
    const snapshots = new Map<string, VaultSnapshot>([
      [
        "0x82dc3260f599f4fc4307209a1e3b53ddca4c585e",
        {
          address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
          name: "EarnETH",
          apr: 3.5,
          tvl: "50000",
          tvlRaw: 50000n * 10n ** 18n,
          sharePrice: 10n ** 18n,
          timestamp: 1700000000,
          assetDecimals: 18,
          assetSymbol: "ETH",
        },
      ],
    ]);

    const text = formatWatchList(watches, snapshots);
    expect(text).toContain("Watched Vaults (1)");
    expect(text).toContain("EarnETH");
    // Rule format: "expression [severity] (id)"
    expect(text).toContain("apy < 3.0 [critical] (r1)");
    expect(text).toContain("tvl_change_pct > 10 [warning] (r2)");
    expect(text).toContain("Rules (2):");
  });

  it("shows no rules message when watch has empty rules", () => {
    const watches: VaultWatch[] = [
      {
        address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
        name: "TestVault",
        rules: [],
        addedAt: Date.now(),
      },
    ];
    const text = formatWatchList(watches, new Map());
    expect(text).toContain("None");
  });

  it("uses formatTvl for latest TVL display", () => {
    const watches: VaultWatch[] = [
      {
        address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
        name: "TestVault",
        rules: [],
        addedAt: Date.now(),
      },
    ];
    const snapshots = new Map<string, VaultSnapshot>([
      [
        "0x82dc3260f599f4fc4307209a1e3b53ddca4c585e",
        {
          address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
          name: "TestVault",
          apr: 3.5,
          tvl: "1500000",
          tvlRaw: 1500000n * 10n ** 18n,
          sharePrice: 10n ** 18n,
          timestamp: 1700000000,
          assetDecimals: 18,
          assetSymbol: "ETH",
        },
      ],
    ]);

    const text = formatWatchList(watches, snapshots);
    expect(text).toContain("1.50M ETH");
  });

  it("shows 'Awaiting first health check' when no snapshot", () => {
    const watches: VaultWatch[] = [
      {
        address: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
        name: "TestVault",
        rules: [],
        addedAt: Date.now(),
      },
    ];

    const text = formatWatchList(watches, new Map());
    expect(text).toContain("Awaiting first health check");
  });
});

describe("formatAlertList", () => {
  it("shows empty message when no alerts", () => {
    const text = formatAlertList([]);
    expect(text).toContain("No recent alerts");
  });

  it("formats alerts with timestamps", () => {
    const alerts: VaultAlert[] = [
      {
        ruleId: "yield-floor",
        severity: "critical",
        vaultAddress: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
        vaultName: "EarnETH",
        message: "APY below floor",
        context: makeContext(),
        timestamp: 1700000000,
      },
    ];
    const text = formatAlertList(alerts);
    expect(text).toContain("Recent Alerts (1)");
    expect(text).toContain("[CRITICAL]");
    expect(text).toContain("EarnETH");
  });
});

describe("formatDryRunResult", () => {
  it("shows WOULD FIRE when fired is true", () => {
    const result: DryRunResult = {
      fired: true,
      scope: { apr: 2.5, steth_apr: 3.1, tvl: 1000, spread_vs_steth: -0.6 },
      renderedMessage: "APR dropped to 2.50%",
    };
    const text = formatDryRunResult("apr < 3.0", result);
    expect(text).toContain("WOULD FIRE");
    expect(text).toContain("apr = 2.50");
    expect(text).toContain("Message preview: APR dropped to 2.50%");
  });

  it("shows would NOT fire when fired is false", () => {
    const result: DryRunResult = {
      fired: false,
      scope: { apr: 3.5, steth_apr: 3.1, tvl: 1000, spread_vs_steth: 0.4 },
      renderedMessage: "APR dropped to 3.50%",
    };
    const text = formatDryRunResult("apr < 3.0", result);
    expect(text).toContain("would NOT fire");
    expect(text).toContain("apr = 3.50");
    expect(text).not.toContain("Message preview");
  });

  it("filters out NaN values from displayed scope", () => {
    const result: DryRunResult = {
      fired: false,
      scope: { apr: 3.5, apr_prev: NaN, steth_apr: 3.1 },
      renderedMessage: "",
    };
    const text = formatDryRunResult("apr < 3.0", result);
    expect(text).toContain("apr = 3.50");
    expect(text).not.toContain("apr_prev");
  });

  it("only shows variables mentioned in the expression", () => {
    const result: DryRunResult = {
      fired: false,
      scope: { apr: 3.5, tvl: 1000, share_price: 1.001 },
      renderedMessage: "",
    };
    const text = formatDryRunResult("apr < 3.0", result);
    expect(text).toContain("apr = 3.50");
    expect(text).not.toContain("tvl");
    expect(text).not.toContain("share_price");
  });
});

describe("escapeHtml", () => {
  it("escapes & < > and quotes", () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot;');
  });

  it("returns plain text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("formatAlertForEmail", () => {
  const baseAlert: VaultAlert = {
    ruleId: "yield-floor",
    severity: "critical",
    vaultAddress: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    vaultName: "EarnETH",
    message: "APY dropped to 2.80%, below your 3.0% floor.",
    context: makeContext(),
    timestamp: 1700000000,
  };

  it("produces HTML with vault name and severity", () => {
    const html = formatAlertForEmail(baseAlert);
    expect(html).toContain("<h2>");
    expect(html).toContain("EarnETH");
    expect(html).toContain("Critical");
  });

  it("includes Etherscan link", () => {
    const html = formatAlertForEmail(baseAlert);
    expect(html).toContain("etherscan.io/address/0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e");
    expect(html).toContain("<a href=");
  });

  it("includes context section with list items", () => {
    const html = formatAlertForEmail(baseAlert);
    expect(html).toContain("<li>");
    expect(html).toContain("Current APR: 2.80%");
    expect(html).toContain("stETH benchmark:");
  });

  it("uses AI explanation when provided", () => {
    const aiText = "Your vault yield dropped to *2.80%* from 3.45%.";
    const html = formatAlertForEmail(baseAlert, aiText);
    expect(html).toContain("<strong>2.80%</strong>");
    // Should NOT contain the template-based context section
    expect(html).not.toContain("<li>");
  });

  it("includes guidance when underperforming stETH", () => {
    const html = formatAlertForEmail(baseAlert);
    expect(html).toContain("underperforming");
    expect(html).toContain("rebalancing");
  });
});
