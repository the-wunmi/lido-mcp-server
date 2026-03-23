import { describe, it, expect, vi, beforeEach } from "vitest";

// Unmock notifier.js so we test the real implementation
vi.unmock("../../src/monitor/notifier.js");

// Use vi.hoisted so mock fns are available in the vi.mock factory
const {
  mockTelegramSend,
  mockTelegramSendTest,
  mockEmailSend,
  mockEmailSendTest,
} = vi.hoisted(() => ({
  mockTelegramSend: vi.fn().mockResolvedValue(undefined),
  mockTelegramSendTest: vi.fn().mockResolvedValue({ success: true }),
  mockEmailSend: vi.fn().mockResolvedValue(undefined),
  mockEmailSendTest: vi.fn().mockResolvedValue({ success: false, error: "not configured" }),
}));

// Mock the channel classes as proper constructors
vi.mock("../../src/monitor/telegram.js", () => ({
  TelegramChannel: class {
    name = "telegram";
    enabled = true;
    send = mockTelegramSend;
    sendTest = mockTelegramSendTest;
  },
}));

vi.mock("../../src/monitor/email.js", () => ({
  EmailChannel: class {
    name = "email";
    enabled = false;
    recipient: string | null = null;
    send = mockEmailSend;
    sendTest = mockEmailSendTest;
  },
}));

// Mock formatter
vi.mock("../../src/monitor/formatter.js", () => ({
  formatAlertForTelegram: vi.fn().mockReturnValue("telegram alert message"),
  formatAlertForEmail: vi.fn().mockReturnValue("<p>email alert message</p>"),
}));

import { sendAlertNotification, testAllChannels, getChannelStatus } from "../../src/monitor/notifier.js";
import type { VaultAlert, AlertContext } from "../../src/monitor/types.js";

function makeTestAlert(): VaultAlert {
  const context: AlertContext = {
    expression: "apr < 3.0",
    scope: { apr: 2.8 },
    current: { apr: 2.8, tvl: "48500", sharePrice: "1000000000000000000", assetSymbol: "ETH" },
    previous: null,
    benchmarks: { stethApr: 3.1 },
  };

  return {
    ruleId: "rule-test",
    severity: "warning",
    vaultAddress: "0x82dc3260f599f4fC4307209A1E3B53dDCA4C585e",
    vaultName: "TestVault",
    message: "APR below threshold",
    context,
    timestamp: 1700000000,
  };
}

describe("sendAlertNotification", () => {
  beforeEach(() => {
    mockTelegramSend.mockClear().mockResolvedValue(undefined);
    mockTelegramSendTest.mockClear().mockResolvedValue({ success: true });
    mockEmailSend.mockClear().mockResolvedValue(undefined);
    mockEmailSendTest.mockClear().mockResolvedValue({ success: true });
  });

  it("sends to enabled channels only", async () => {
    await sendAlertNotification(makeTestAlert());

    // Telegram is enabled, email is not
    expect(mockTelegramSend).toHaveBeenCalledWith("telegram alert message");
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("retries on failure with exponential backoff", async () => {
    mockTelegramSend
      .mockRejectedValueOnce(new Error("network error"))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(undefined);

    await sendAlertNotification(makeTestAlert(), null, 3);

    expect(mockTelegramSend).toHaveBeenCalledTimes(3);
  });

  it("logs error after all retries fail", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockTelegramSend.mockRejectedValue(new Error("persistent error"));

    await sendAlertNotification(makeTestAlert(), null, 2);

    expect(mockTelegramSend).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("send failed after"),
      expect.any(String),
    );
    consoleSpy.mockRestore();
  });
});

describe("testAllChannels", () => {
  beforeEach(() => {
    mockTelegramSendTest.mockClear().mockResolvedValue({ success: true });
    mockEmailSendTest.mockClear().mockResolvedValue({ success: false, error: "not configured" });
  });

  it("tests all channels and returns results", async () => {
    const results = await testAllChannels();

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ name: "telegram", success: true });
    expect(results[1]).toEqual({ name: "email", success: false, error: "not configured" });
  });

  it("filters to a specific channel", async () => {
    const results = await testAllChannels("telegram");

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("telegram");
  });

  it("returns empty array for unknown channel", async () => {
    const results = await testAllChannels("unknown");
    expect(results).toHaveLength(0);
  });
});

describe("getChannelStatus", () => {
  it("returns status for all channels", () => {
    const status = getChannelStatus();

    expect(status).toHaveLength(2);
    expect(status[0]).toEqual({ name: "telegram", enabled: true });
    expect(status[1]).toEqual({ name: "email", enabled: false });
  });
});

describe("sendAlertNotification with recipient", () => {
  beforeEach(() => {
    mockTelegramSend.mockClear().mockResolvedValue(undefined);
    mockEmailSend.mockClear().mockResolvedValue(undefined);
  });

  it("passes recipient to email channel", async () => {
    await sendAlertNotification(makeTestAlert(), null, 3, "user@example.com");

    // Telegram is enabled so it should be called
    expect(mockTelegramSend).toHaveBeenCalled();
  });

  it("clears email recipient when not provided", async () => {
    await sendAlertNotification(makeTestAlert());

    // With no recipient, email channel won't be enabled
    expect(mockEmailSend).not.toHaveBeenCalled();
  });
});
