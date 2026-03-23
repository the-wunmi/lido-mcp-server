import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleListEarnVaults,
  handleWatchVault,
  handleUnwatchVault,
  handleAddRule,
  handleRemoveRule,
  handleTestNotifications,
  handleListWatches,
  handleCheckVault,
  handleGetVaultAlerts,
} from "../../src/tools/vault-monitor.js";
import { addWatch, removeWatch, addRule, removeRule, getWatch, getWatches, getSnapshots, getLatestAlerts, getLatestSnapshot, getBenchmarks, updateWatchRecipient, runVaultCheck } from "../../src/monitor/watcher.js";
import { testAllChannels, getChannelStatus } from "../../src/monitor/notifier.js";
import { validateExpression, dryRunRule } from "../../src/monitor/rules.js";
import { clearMellowCache } from "../../src/monitor/data.js";
import { monitorConfig } from "../../src/monitor/config.js";

// Mock global fetch to prevent real network calls from data.js (used by handleCheckVault)
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve([]),
});
vi.stubGlobal("fetch", mockFetch);

const VALID_ADDRESS = "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e";

describe("handleListEarnVaults", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
    clearMellowCache();
  });

  it("returns vaults from the Mellow API", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([
        { address: "0x6a37725ca7f4CE81c004c955f7280d5C704a249e", name: "Lido Earn ETH", symbol: "earnETH", chain_id: 1, apr: 2.88 },
        { address: "0x014e6DA8F283C4aF65B2AA0f201438680A004452", name: "Lido Earn USD", symbol: "earnUSD", chain_id: 1, apr: 4.0 },
      ]),
    });

    const result = await handleListEarnVaults({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Lido Earn ETH");
    expect(result.content[0].text).toContain("earnETH");
    expect(result.content[0].text).toContain("0x6a37725ca7f4CE81c004c955f7280d5C704a249e");
    expect(result.content[0].text).toContain("2.88%");
  });

  it("falls back to known Core Vaults when API is down", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await handleListEarnVaults({});
    // When API is unavailable, we still show known Core Vault addresses
    expect(result.content[0].text).toContain("API unavailable");
    expect(result.content[0].text).toContain("strETH");
    expect(result.content[0].text).toContain("earnETH");
    expect(result.content[0].text).toContain("earnUSD");
    expect(result.content[0].text).toContain("WETH");
    expect(result.content[0].text).toContain("USDC");
  });

  it("rejects invalid address format", async () => {
    const result = await handleWatchVault({ address: "not-an-address" });
    expect(result.isError).toBe(true);
  });
});

describe("handleWatchVault", () => {
  beforeEach(() => {
    // Enable Telegram so watch creation passes the notification channel check
    (monitorConfig as any).telegram = { ...monitorConfig.telegram, enabled: true };
    vi.mocked(addWatch).mockClear();
  });

  afterEach(() => {
    (monitorConfig as any).telegram = { ...monitorConfig.telegram, enabled: false };
    (monitorConfig as any).email = { ...monitorConfig.email, enabled: false };
  });

  it("adds a vault watch and returns snapshot info", async () => {
    const result = await handleWatchVault({ address: VALID_ADDRESS, name: "EarnETH" });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Now watching vault");
    expect(text).toContain("TestVault");
    expect(addWatch).toHaveBeenCalled();
  });

  it("includes assetSymbol in watch output", async () => {
    const result = await handleWatchVault({ address: VALID_ADDRESS });

    const text = result.content[0].text;
    expect(text).toContain("WETH");
  });

  it("accepts rules array on watch creation", async () => {
    const result = await handleWatchVault({
      address: VALID_ADDRESS,
      rules: [
        { expression: "apy < 3.0", severity: "critical", message: "APY below {{apy}}%" },
      ],
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Rules: 1");
  });

  it("shows rules in 'expression [severity] (id)' format", async () => {
    const result = await handleWatchVault({
      address: VALID_ADDRESS,
      rules: [
        { expression: "apy < 3.0", severity: "critical", message: "APY low" },
      ],
    });

    const text = result.content[0].text;
    // The rule should show expression [severity] (id)
    expect(text).toMatch(/apy < 3\.0 \[critical\] \(rule-\d+\)/);
  });

  it("fires a real vault check when rules are provided", async () => {
    vi.mocked(runVaultCheck).mockClear();

    const result = await handleWatchVault({
      address: VALID_ADDRESS,
      rules: [
        { expression: "apy < 3.0", severity: "warning", message: "APY low" },
      ],
    });

    expect(result.isError).toBeUndefined();
    expect(runVaultCheck).toHaveBeenCalledWith(VALID_ADDRESS);
  });

  it("shows suggested rules when no rules provided", async () => {
    const result = await handleWatchVault({
      address: VALID_ADDRESS,
    });

    const text = result.content[0].text;
    expect(text).toContain("No alert rules configured yet");
    expect(text).toContain("suggested rules");
    expect(text).toContain('"apy < 3.0"');
    expect(text).toContain('"spread_vs_steth < 0"');
    expect(text).toContain('"tvl_change_pct < -10"');
    expect(text).toContain("lido_add_rule");
  });

  it("shows channel status instead of telegram-specific message", async () => {
    (monitorConfig as any).telegram = { ...monitorConfig.telegram, enabled: false };
    (monitorConfig as any).email = { ...monitorConfig.email, enabled: false };

    const result = await handleWatchVault({ address: VALID_ADDRESS });
    const text = result.content[0].text;
    expect(text).toContain("notification channels");
  });

  it("returns error for invalid address", async () => {
    const result = await handleWatchVault({ address: "not-an-address" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid");
  });

  it("returns error for invalid rule expression", async () => {
    vi.mocked(validateExpression).mockReturnValueOnce("bad syntax");

    const result = await handleWatchVault({
      address: VALID_ADDRESS,
      rules: [{ expression: "bad $$$ expression" }],
    });

    expect(result.isError).toBeUndefined(); // Not an error result, but an informative message
    expect(result.content[0].text).toContain("Invalid rule expression");
  });

  it("passes email_to as recipient on the watch", async () => {
    const result = await handleWatchVault({
      address: VALID_ADDRESS,
      email_to: "vault@example.com",
    });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Email alerts: vault@example.com");

    const calls = vi.mocked(addWatch).mock.calls;
    const watch = calls[calls.length - 1]?.[0];
    expect(watch?.recipient).toBe("vault@example.com");
    expect(text).toContain("lido_test_notifications");
  });

  it("handles already-watched vault error", async () => {
    vi.mocked(addWatch).mockRejectedValueOnce(new Error("already being watched"));

    const result = await handleWatchVault({ address: VALID_ADDRESS });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already being watched");
  });

  it("fails when no notification channels are configured", async () => {
    (monitorConfig as any).telegram = { ...monitorConfig.telegram, enabled: false };
    (monitorConfig as any).email = { ...monitorConfig.email, enabled: false };

    const result = await handleWatchVault({ address: VALID_ADDRESS });
    expect(result.content[0].text).toContain("No notification channels configured");
    expect(result.content[0].text).toContain("SMTP_HOST");
    expect(result.content[0].text).toContain("TELEGRAM_BOT_TOKEN");
    expect(addWatch).not.toHaveBeenCalled();
  });

  it("fails when SMTP configured but no email_to and no Telegram", async () => {
    (monitorConfig as any).telegram = { ...monitorConfig.telegram, enabled: false };
    (monitorConfig as any).email = { ...monitorConfig.email, enabled: true };

    const result = await handleWatchVault({ address: VALID_ADDRESS });
    expect(result.content[0].text).toContain("SMTP is configured but no recipient provided");
    expect(result.content[0].text).toContain("email_to");
    expect(addWatch).not.toHaveBeenCalled();
  });

  it("proceeds when SMTP configured with email_to and no Telegram", async () => {
    (monitorConfig as any).telegram = { ...monitorConfig.telegram, enabled: false };
    (monitorConfig as any).email = { ...monitorConfig.email, enabled: true };

    const result = await handleWatchVault({ address: VALID_ADDRESS, email_to: "user@example.com" });
    expect(result.content[0].text).toContain("Now watching vault");
    expect(addWatch).toHaveBeenCalled();
  });

  it("proceeds with Telegram even when SMTP configured but no email_to", async () => {
    (monitorConfig as any).telegram = { ...monitorConfig.telegram, enabled: true };
    (monitorConfig as any).email = { ...monitorConfig.email, enabled: true };

    const result = await handleWatchVault({ address: VALID_ADDRESS });
    expect(result.content[0].text).toContain("Now watching vault");
    expect(addWatch).toHaveBeenCalled();
  });
});

describe("handleUnwatchVault", () => {
  it("removes a vault watch and shows vault name and rule count", async () => {
    const result = await handleUnwatchVault({ address: VALID_ADDRESS });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Stopped watching");
    expect(text).toContain("TestVault");
    expect(text).toContain("1 rule(s)");
    expect(removeWatch).toHaveBeenCalledWith(VALID_ADDRESS);
  });

  it("shows 0 rules when watch had no rules", async () => {
    vi.mocked(removeWatch).mockResolvedValueOnce({
      address: VALID_ADDRESS as `0x${string}`,
      name: "EmptyVault",
      rules: [],
      addedAt: 1700000000000,
    });

    const result = await handleUnwatchVault({ address: VALID_ADDRESS });
    const text = result.content[0].text;
    expect(text).toContain("Stopped watching EmptyVault");
    expect(text).toContain("0 rule(s)");
  });

  it("returns error for invalid address", async () => {
    const result = await handleUnwatchVault({ address: "bad" });
    expect(result.isError).toBe(true);
  });

  it("handles not-watched error", async () => {
    vi.mocked(removeWatch).mockRejectedValueOnce(new Error("not being watched"));

    const result = await handleUnwatchVault({ address: VALID_ADDRESS });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not being watched");
  });
});

describe("handleAddRule", () => {
  it("adds a rule to an existing watch", async () => {
    const result = await handleAddRule({
      address: VALID_ADDRESS,
      expression: "apy < 3.0",
      severity: "critical",
      message: "APY dropped to {{apy}}%",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Added rule");
    expect(addRule).toHaveBeenCalled();
  });

  it("shows rule in 'expression [severity] (id)' format", async () => {
    const result = await handleAddRule({
      address: VALID_ADDRESS,
      expression: "apy < 3.0",
      severity: "warning",
    });

    const text = result.content[0].text;
    expect(text).toMatch(/apy < 3\.0 \[warning\] \(rule-\d+\)/);
  });

  it("shows dry-run when snapshot exists", async () => {
    vi.mocked(getLatestSnapshot).mockReturnValueOnce({
      address: VALID_ADDRESS,
      name: "TestVault",
      apr: 3.5,
      tvl: "1000",
      tvlRaw: 1000n * 10n ** 18n,
      sharePrice: 10n ** 18n,
      timestamp: 1700000000,
      assetDecimals: 18,
      assetSymbol: "WETH",
    });

    const result = await handleAddRule({
      address: VALID_ADDRESS,
      expression: "apy < 3.0",
    });

    const text = result.content[0].text;
    expect(text).toContain("Dry Run");
    expect(dryRunRule).toHaveBeenCalled();
  });

  it("shows 'no snapshot' message when no data yet", async () => {
    vi.mocked(getLatestSnapshot).mockReturnValueOnce(undefined);

    const result = await handleAddRule({
      address: VALID_ADDRESS,
      expression: "apy < 3.0",
    });

    const text = result.content[0].text;
    expect(text).toContain("No snapshot data yet");
  });

  it("returns error for invalid expression", async () => {
    vi.mocked(validateExpression).mockReturnValueOnce("syntax error");

    const result = await handleAddRule({
      address: VALID_ADDRESS,
      expression: "bad expression",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Invalid rule expression");
  });

  it("defaults severity to warning", async () => {
    const result = await handleAddRule({
      address: VALID_ADDRESS,
      expression: "apy < 3.0",
    });

    expect(result.isError).toBeUndefined();
    expect(addRule).toHaveBeenCalled();
    const calls = vi.mocked(addRule).mock.calls;
    const rule = calls[calls.length - 1]?.[1];
    expect(rule?.severity).toBe("warning");
  });

  it("generates default message when none provided", async () => {
    const result = await handleAddRule({
      address: VALID_ADDRESS,
      expression: "apy < 3.0",
    });

    const calls = vi.mocked(addRule).mock.calls;
    const rule = calls[calls.length - 1]?.[1];
    // Should have a generated default message, not empty
    expect(rule?.message).toBeTruthy();
    expect(rule?.message.length).toBeGreaterThan(0);
  });
});

describe("handleRemoveRule", () => {
  it("removes a rule", async () => {
    const result = await handleRemoveRule({
      address: VALID_ADDRESS,
      rule_id: "rule-1",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Removed rule");
    expect(removeRule).toHaveBeenCalledWith(VALID_ADDRESS, "rule-1");
  });

  it("handles not-found error", async () => {
    vi.mocked(removeRule).mockRejectedValueOnce(new Error("not found"));

    const result = await handleRemoveRule({
      address: VALID_ADDRESS,
      rule_id: "nonexistent",
    });

    expect(result.isError).toBe(true);
  });
});

describe("handleTestNotifications", () => {
  beforeEach(() => {
    vi.mocked(updateWatchRecipient).mockClear();
    vi.mocked(testAllChannels).mockClear();
    vi.mocked(getWatches).mockReturnValue([]);
  });

  it("returns results for all channels", async () => {
    const result = await handleTestNotifications({});

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("telegram");
    expect(text).toContain("email");
    expect(testAllChannels).toHaveBeenCalled();
  });

  it("passes channel filter when specified", async () => {
    await handleTestNotifications({ channel: "telegram" });

    expect(testAllChannels).toHaveBeenCalledWith("telegram", undefined);
  });

  it("shows success and failure messages", async () => {
    const result = await handleTestNotifications({});

    const text = result.content[0].text;
    expect(text).toContain("sent successfully");
    expect(text).toContain("Failed");
  });

  it("updates watch recipient when address + email_to provided", async () => {
    const result = await handleTestNotifications({
      address: VALID_ADDRESS,
      email_to: "user@example.com",
    });

    expect(updateWatchRecipient).toHaveBeenCalledWith(VALID_ADDRESS, "user@example.com");
    expect(testAllChannels).toHaveBeenCalledWith(undefined, "user@example.com");
    const text = result.content[0].text;
    expect(text).toContain("updated to: user@example.com");
  });

  it("uses one-off email_to without persisting when no address", async () => {
    const result = await handleTestNotifications({ email_to: "test@example.com" });

    expect(updateWatchRecipient).not.toHaveBeenCalled();
    expect(testAllChannels).toHaveBeenCalledWith(undefined, "test@example.com");
    expect(result.isError).toBeUndefined();
  });

  it("looks up watch recipient when only address provided", async () => {
    vi.mocked(getWatch).mockReturnValueOnce({
      address: VALID_ADDRESS as `0x${string}`,
      name: "TestVault",
      rules: [],
      addedAt: 1700000000000,
      recipient: "stored@example.com",
    });

    await handleTestNotifications({ address: VALID_ADDRESS });

    expect(testAllChannels).toHaveBeenCalledWith(undefined, "stored@example.com");
  });

  it("tests with no recipient when neither address nor email_to provided", async () => {
    await handleTestNotifications({});

    expect(testAllChannels).toHaveBeenCalledWith(undefined, undefined);
  });
});

describe("handleListWatches", () => {
  it("returns empty list message", async () => {
    vi.mocked(getWatches).mockReturnValueOnce([]);
    vi.mocked(getSnapshots).mockReturnValueOnce(new Map());

    const result = await handleListWatches({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No vaults");
  });
});

describe("handleCheckVault", () => {
  it("returns health report for valid vault", async () => {
    const result = await handleCheckVault({ address: VALID_ADDRESS });

    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("Vault Health");
  });

  it("returns error for invalid address", async () => {
    const result = await handleCheckVault({ address: "0xinvalid" });
    expect(result.isError).toBe(true);
  });
});

describe("handleGetVaultAlerts", () => {
  it("returns empty alerts message", async () => {
    vi.mocked(getLatestAlerts).mockReturnValueOnce([]);

    const result = await handleGetVaultAlerts({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No recent alerts");
  });

  it("accepts count and address filters", async () => {
    const result = await handleGetVaultAlerts({ count: 5, address: VALID_ADDRESS });

    expect(result.isError).toBeUndefined();
    expect(getLatestAlerts).toHaveBeenCalledWith(5, VALID_ADDRESS);
  });

  it("rejects invalid count", async () => {
    const result = await handleGetVaultAlerts({ count: 0 });
    expect(result.isError).toBe(true);
  });
});
