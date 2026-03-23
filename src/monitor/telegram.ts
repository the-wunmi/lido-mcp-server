import { monitorConfig, FETCH_TIMEOUT_MS } from "./config.js";
import type { NotificationChannel } from "./types.js";

function sanitizeTelegramError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\d+:[A-Za-z0-9_-]{30,}/g, "[REDACTED_TOKEN]");
}

export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram";

  get enabled(): boolean {
    return monitorConfig.telegram.enabled;
  }

  private async postMessage(
    text: string,
    options?: { disablePreview?: boolean },
  ): Promise<Response> {
    const { botToken, chatId } = monitorConfig.telegram;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        ...(options?.disablePreview ? { disable_web_page_preview: true } : {}),
      }),
    });
  }

  async send(message: string): Promise<void> {
    if (!this.enabled) {
      console.error("[VaultMonitor] Alert (no Telegram configured):", message);
      return;
    }

    let resp: Response;
    try {
      resp = await this.postMessage(message, { disablePreview: true });
    } catch (err) {
      throw new Error(`Telegram send failed: ${sanitizeTelegramError(err)}`);
    }

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Telegram API error (${resp.status}): ${sanitizeTelegramError(body)}`);
    }
  }

  async sendTest(): Promise<{ success: boolean; error?: string }> {
    if (!this.enabled) {
      return { success: false, error: "Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID." };
    }

    try {
      const resp = await this.postMessage(
        "Lido Vault Monitor connected. Alerts will be sent to this chat.",
      );

      if (!resp.ok) {
        const body = await resp.text();
        return { success: false, error: `Telegram API error (${resp.status}): ${body}` };
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: sanitizeTelegramError(err) };
    }
  }
}

