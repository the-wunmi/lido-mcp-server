import { describe, it, expect, vi, beforeEach } from "vitest";

// Unmock email.js so we test the real implementation
vi.unmock("../../src/monitor/email.js");

// Use vi.hoisted so the mock fn is available in the vi.mock factory (hoisted to top)
const { mockSendMail } = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({ messageId: "test-123" }),
}));

// Mock nodemailer
vi.mock("nodemailer", () => ({
  createTransport: vi.fn().mockReturnValue({
    sendMail: mockSendMail,
  }),
}));

import { monitorConfig } from "../../src/monitor/config.js";
import { EmailChannel } from "../../src/monitor/email.js";

describe("EmailChannel", () => {
  beforeEach(() => {
    mockSendMail.mockClear();
  });

  it("reports enabled=false when email is not configured", () => {
    const channel = new EmailChannel();
    expect(channel.enabled).toBe(false);
    expect(channel.name).toBe("email");
  });

  it("reports enabled=false when SMTP is configured but no recipient set", () => {
    const original = monitorConfig.email;
    Object.defineProperty(monitorConfig, "email", {
      get: () => ({
        enabled: true,
        host: "smtp.test.com",
        port: 587,
        secure: false,
        user: "user",
        pass: "pass",
        from: "from@test.com",
      }),
      configurable: true,
    });

    const channel = new EmailChannel();
    expect(channel.enabled).toBe(false);

    Object.defineProperty(monitorConfig, "email", {
      get: () => original,
      configurable: true,
    });
  });

  it("reports enabled=true when SMTP is configured and recipient is set", () => {
    const original = monitorConfig.email;
    Object.defineProperty(monitorConfig, "email", {
      get: () => ({
        enabled: true,
        host: "smtp.test.com",
        port: 587,
        secure: false,
        user: "user",
        pass: "pass",
        from: "from@test.com",
      }),
      configurable: true,
    });

    const channel = new EmailChannel();
    channel.recipient = "user@test.com";
    expect(channel.enabled).toBe(true);

    Object.defineProperty(monitorConfig, "email", {
      get: () => original,
      configurable: true,
    });
  });

  it("sendTest() returns error when SMTP not configured", async () => {
    const channel = new EmailChannel();
    const result = await channel.sendTest();

    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });

  it("sendTest() returns error when no recipient set", async () => {
    const original = monitorConfig.email;
    Object.defineProperty(monitorConfig, "email", {
      get: () => ({
        enabled: true,
        host: "smtp.test.com",
        port: 587,
        secure: false,
        user: "user",
        pass: "pass",
        from: "from@test.com",
      }),
      configurable: true,
    });

    const channel = new EmailChannel();
    const result = await channel.sendTest();

    expect(result.success).toBe(false);
    expect(result.error).toContain("No email recipient");

    Object.defineProperty(monitorConfig, "email", {
      get: () => original,
      configurable: true,
    });
  });

  it("send() calls transporter.sendMail when enabled with recipient", async () => {
    const original = monitorConfig.email;
    Object.defineProperty(monitorConfig, "email", {
      get: () => ({
        enabled: true,
        host: "smtp.test.com",
        port: 587,
        secure: false,
        user: "user",
        pass: "pass",
        from: "from@test.com",
      }),
      configurable: true,
    });

    const channel = new EmailChannel();
    channel.recipient = "to@test.com";
    await channel.send("<p>Alert message</p>");

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "from@test.com",
        to: "to@test.com",
        subject: "Lido Vault Monitor Alert",
        html: "<p>Alert message</p>",
      }),
    );

    Object.defineProperty(monitorConfig, "email", {
      get: () => original,
      configurable: true,
    });
  });

  it("sendTest() returns success when email is sent", async () => {
    const original = monitorConfig.email;
    Object.defineProperty(monitorConfig, "email", {
      get: () => ({
        enabled: true,
        host: "smtp.test.com",
        port: 587,
        secure: false,
        user: "user",
        pass: "pass",
        from: "from@test.com",
      }),
      configurable: true,
    });

    const channel = new EmailChannel();
    channel.recipient = "to@test.com";
    const result = await channel.sendTest();

    expect(result.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalled();

    Object.defineProperty(monitorConfig, "email", {
      get: () => original,
      configurable: true,
    });
  });

  it("sendTest() returns error when sendMail throws", async () => {
    const original = monitorConfig.email;
    Object.defineProperty(monitorConfig, "email", {
      get: () => ({
        enabled: true,
        host: "smtp.test.com",
        port: 587,
        secure: false,
        user: "user",
        pass: "pass",
        from: "from@test.com",
      }),
      configurable: true,
    });

    mockSendMail.mockRejectedValueOnce(new Error("SMTP connection failed"));

    const channel = new EmailChannel();
    channel.recipient = "to@test.com";
    const result = await channel.sendTest();

    expect(result.success).toBe(false);
    expect(result.error).toContain("SMTP connection failed");

    Object.defineProperty(monitorConfig, "email", {
      get: () => original,
      configurable: true,
    });
  });
});
