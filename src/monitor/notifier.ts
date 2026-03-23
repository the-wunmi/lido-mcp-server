import { TelegramChannel } from "./telegram.js";
import { EmailChannel } from "./email.js";
import { formatAlertForTelegram, formatAlertForEmail } from "./formatter.js";
import { extractErrorMessage } from "../utils/errors.js";
import type { NotificationChannel, VaultAlert } from "./types.js";

let _telegramChannel: TelegramChannel | null = null;
let _emailChannel: EmailChannel | null = null;

function getTelegramChannel(): TelegramChannel {
  if (!_telegramChannel) _telegramChannel = new TelegramChannel();
  return _telegramChannel;
}

function getEmailChannel(): EmailChannel {
  if (!_emailChannel) _emailChannel = new EmailChannel();
  return _emailChannel;
}

function getChannels(): NotificationChannel[] {
  return [getTelegramChannel(), getEmailChannel()];
}

type AlertFormatter = (alert: VaultAlert, aiExplanation?: string | null) => string;

const formatters: Record<string, AlertFormatter> = {
  telegram: formatAlertForTelegram,
  email: formatAlertForEmail,
};

export async function sendAlertNotification(
  alert: VaultAlert,
  explanation?: string | null,
  retries = 3,
  recipient?: string,
): Promise<void> {
  getEmailChannel().recipient = recipient ?? null;

  for (const channel of getChannels()) {
    if (!channel.enabled) continue;

    const formatter = formatters[channel.name];
    if (!formatter) continue;

    const message = formatter(alert, explanation);

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        await channel.send(message);
        break;
      } catch (err) {
        if (attempt < retries - 1) {
          const delay = 1000 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, delay));
        } else {
          console.error(
            `[VaultMonitor] ${channel.name} send failed after ${retries} retries:`,
            extractErrorMessage(err),
          );
        }
      }
    }
  }
}

export async function testAllChannels(
  channelName?: string,
  recipient?: string,
): Promise<{ name: string; success: boolean; error?: string }[]> {
  const emailCh = getEmailChannel();
  const previousRecipient = emailCh.recipient;
  if (recipient !== undefined) {
    emailCh.recipient = recipient;
  }

  const targets = channelName
    ? getChannels().filter((c) => c.name === channelName)
    : getChannels();

  const results: { name: string; success: boolean; error?: string }[] = [];

  for (const channel of targets) {
    const result = await channel.sendTest();
    results.push({ name: channel.name, ...result });
  }

  emailCh.recipient = previousRecipient;

  return results;
}

export function getChannelStatus(): { name: string; enabled: boolean }[] {
  return getChannels().map((c) => ({ name: c.name, enabled: c.enabled }));
}
