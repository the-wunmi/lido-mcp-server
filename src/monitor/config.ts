import type { Address } from "viem";
import { appConfig } from "../config.js";

export const BIGINT_SCALE_18 = 10n ** 18n;

/** Canonical address normalisation — single place to change if checksumming is added later. */
export function normalizeAddress(addr: string): string {
  return addr.toLowerCase();
}

/** stETH contract on mainnet — used for TokenRebased event subscription. */
export const MAINNET_STETH: Address = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";

/** Timeout for all external HTTP fetches (Mellow API, Lido API, Telegram). */
export const FETCH_TIMEOUT_MS = 15_000;

export const monitorConfig = {
  get telegram() {
    return {
      enabled: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
      chatId: process.env.TELEGRAM_CHAT_ID ?? "",
    };
  },

  get mainnetRpcUrl(): string | null {
    if (appConfig.chainId === 1) return appConfig.rpcUrl;
    return process.env.MAINNET_RPC_URL ?? null;
  },

  get mainnetAvailable(): boolean {
    return appConfig.chainId === 1 || Boolean(process.env.MAINNET_RPC_URL);
  },

  dataDir: ".data",
  dedupCooldownMs: 6 * 60 * 60 * 1000,
  maxAlertHistory: 100,

  get email() {
    const host = process.env.SMTP_HOST ?? "";
    return {
      enabled: Boolean(host),
      host,
      port: parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
      from: process.env.SMTP_FROM ?? "",
    };
  },

  get anthropic() {
    return {
      enabled: Boolean(process.env.ANTHROPIC_API_KEY),
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    };
  },
};
