import { formatEther } from "viem";
import { securityConfig } from "../config.js";
import { getAccountAddress } from "../sdk-factory.js";

/**
 * Validate that a receiver address is in the allowlist.
 * If no allowlist is configured, only the wallet's own address is allowed.
 */
export function validateReceiver(address: string): string | null {
  const normalized = address.toLowerCase();
  if (securityConfig.allowedReceivers) {
    if (!securityConfig.allowedReceivers.has(normalized)) {
      return `Receiver address ${address} is not in the allowed receivers list. ` +
        `Allowed: ${[...securityConfig.allowedReceivers].join(", ")}`;
    }
    return null;
  }
  // Default: only allow the configured wallet address
  const ownAddress = getAccountAddress().toLowerCase();
  if (normalized !== ownAddress) {
    return `Receiver address ${address} does not match the configured wallet address. ` +
      `Set LIDO_ALLOWED_RECEIVERS to allow other addresses.`;
  }
  return null;
}

/**
 * Validate that a transaction amount does not exceed the configured cap.
 * Returns an error message string if the cap is exceeded, or null if OK.
 */
export function validateAmountCap(amountWei: bigint): string | null {
  if (securityConfig.maxTransactionWei && amountWei > securityConfig.maxTransactionWei) {
    return `Amount ${formatEther(amountWei)} ETH exceeds the maximum transaction limit of ` +
      `${formatEther(securityConfig.maxTransactionWei)} ETH (LIDO_MAX_TRANSACTION_ETH).`;
  }
  return null;
}
