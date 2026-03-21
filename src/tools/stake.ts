import { z } from "zod";
import { formatEther, parseEther, type Address } from "viem";
import { sdk, publicClient, getAccountAddress } from "../sdk-factory.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";
import { performDryRun, formatDryRunResult } from "../utils/dry-run.js";
import { validateReceiver, validateAmountCap } from "../utils/security.js";

export const stakeToolDef = {
  name: "lido_stake_eth",
  description:
    "Stake ETH with Lido to receive stETH. " +
    "Defaults to dry_run=true (simulation only). " +
    "Set dry_run=false to execute the real transaction.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount of ETH to stake (e.g. '1.0', '0.5')",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only — no transaction sent. Default: true.",
      },
      referral_address: {
        type: "string",
        description: "Optional referral address for Lido referral program.",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Stake ETH",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const schema = z.object({
  amount: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
  referral_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
});

export async function handleStakeEth(args: Record<string, unknown>) {
  try {
    const { amount, dry_run, referral_address } = schema.parse(args);
    const value = parseEther(amount);

    if (referral_address) {
      const receiverError = validateReceiver(referral_address);
      if (receiverError) return errorResult(receiverError);
    }

    const capError = validateAmountCap(value);
    if (capError) return errorResult(capError);

    const ethBalance = await publicClient.getBalance({ address: getAccountAddress() });
    if (ethBalance < value) {
      return errorResult(
        `Insufficient ETH balance. You have ${formatEther(ethBalance)} ETH ` +
        `but are trying to stake ${amount} ETH.`
      );
    }

    const stakeProps = {
      value,
      ...(referral_address ? { referralAddress: referral_address as Address } : {}),
    };

    if (dry_run) {
      const result = await performDryRun(
        () => sdk.stake.stakeEthPopulateTx(stakeProps),
        () => sdk.stake.stakeEthSimulateTx(stakeProps),
        () => sdk.stake.stakeEthEstimateGas(stakeProps),
      );

      return textResult(
        `Dry run for staking ${amount} ETH:\n\n${formatDryRunResult(result)}`
      );
    }

    const result = await sdk.stake.stakeEth(stakeProps);

    const lines = [
      `=== Stake Successful ===`,
      `Transaction hash: ${result.hash}`,
      `stETH received: ${result.result ? formatEther(result.result.stethReceived) : "pending"}`,
      `Shares received: ${result.result ? result.result.sharesReceived.toString() : "pending"}`,
    ];

    if (result.confirmations !== undefined) {
      lines.push(`Confirmations: ${result.confirmations}`);
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}
