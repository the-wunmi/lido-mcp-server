import { describe, it, expect, vi, beforeEach } from "vitest";

// Unmock telegram.js so we test the real implementation
vi.unmock("../../src/monitor/telegram.js");

// We need to re-mock config with Telegram enabled for the enabled-path tests
vi.mock("../../src/monitor/config.js", () => ({
  monitorConfig: {
    telegram: { enabled: true, botToken: "test-bot-token", chatId: "12345" },
  },
  FETCH_TIMEOUT_MS: 15_000,
}));

import { TelegramChannel } from "../../src/monitor/telegram.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("TelegramChannel.send (real implementation)", () => {
  let channel: InstanceType<typeof TelegramChannel>;

  beforeEach(() => {
    mockFetch.mockReset();
    channel = new TelegramChannel();
  });

  it("constructs URL with bot token", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await channel.send("Test alert");

    expect(mockFetch).toHaveBeenCalledOnce();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
  });

  it("sends correct request body with chat_id, text, and parse_mode", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await channel.send("Hello world");

    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });

    const body = JSON.parse(opts.body as string);
    expect(body.chat_id).toBe("12345");
    expect(body.text).toBe("Hello world");
    expect(body.parse_mode).toBe("Markdown");
    expect(body.disable_web_page_preview).toBe(true);
  });

  it("throws on non-OK HTTP response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden: bot was blocked"),
    });

    await expect(channel.send("Test")).rejects.toThrow(
      "Telegram API error (403): Forbidden: bot was blocked"
    );
  });

  it("throws on network error (with sanitized message)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network unreachable"));

    await expect(channel.send("Test")).rejects.toThrow("Telegram send failed: Network unreachable");
  });

  it("reports name and enabled status", () => {
    expect(channel.name).toBe("telegram");
    expect(channel.enabled).toBe(true);
  });
});

describe("TelegramChannel.sendTest (real implementation)", () => {
  let channel: InstanceType<typeof TelegramChannel>;

  beforeEach(() => {
    mockFetch.mockReset();
    channel = new TelegramChannel();
  });

  it("returns { success: true } on OK response", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await channel.sendTest();

    expect(result).toEqual({ success: true });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("bottest-bot-token/sendMessage");
  });

  it("returns { success: false, error } on non-OK response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    });

    const result = await channel.sendTest();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Telegram API error (401)");
    expect(result.error).toContain("Unauthorized");
  });

  it("returns { success: false, error } on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("DNS lookup failed"));

    const result = await channel.sendTest();

    expect(result.success).toBe(false);
    expect(result.error).toBe("DNS lookup failed");
  });

  it("sends the correct test message text", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await channel.sendTest();

    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.text).toContain("Lido Vault Monitor connected");
    expect(body.parse_mode).toBe("Markdown");
  });
});
