import { ZodError } from "zod";
import { errorResult } from "./format.js";

export function handleToolError(error: unknown) {
  if (error instanceof ZodError) {
    const issues = error.issues.map(i => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    return errorResult(`Invalid input:\n${issues}`);
  }

  if (error instanceof Error) {
    const msg = error.message;

    if (msg.includes("insufficient funds")) {
      return errorResult("Insufficient ETH balance to cover this transaction plus gas fees.");
    }
    if (msg.includes("execution reverted")) {
      const reason = extractRevertReason(msg);
      return errorResult(`Transaction would revert: ${reason}`);
    }
    if (msg.includes("nonce")) {
      return errorResult("Nonce conflict — another transaction may be pending. Try again shortly.");
    }
    if (msg.includes("STAKE_LIMIT")) {
      return errorResult("Staking limit reached. The protocol limits daily stake volume. Try a smaller amount or wait.");
    }
    if (msg.includes("PAUSED") || msg.includes("paused")) {
      return errorResult("The Lido protocol is currently paused. Staking and withdrawals are temporarily unavailable.");
    }

    return errorResult(sanitizeErrorMessage(msg));
  }

  return errorResult(sanitizeErrorMessage(String(error)));
}

export function sanitizeErrorMessage(msg: string): string {
  return msg.replace(/https?:\/\/[^\s)]+/gi, "[REDACTED_URL]");
}

function extractRevertReason(msg: string): string {
  const match = msg.match(/reason:\s*(.+?)(?:\n|$)/);
  return match?.[1]?.trim() ?? msg;
}
