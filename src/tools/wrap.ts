import { z } from "zod";
import { formatEther, parseEther } from "viem";
import { sdk, publicClient, getAccountAddress } from "../sdk-factory.js";
import { textResult, errorResult, ethAmountSchema } from "../utils/format.js";
import { handleToolError } from "../utils/errors.js";
import { performDryRun, formatDryRunResult } from "../utils/dry-run.js";
import { validateAmountCap } from "../utils/security.js";

export const wrapStethToolDef = {
  name: "lido_wrap_steth_to_wsteth",
  description:
    "Wrap stETH to wstETH. wstETH is a non-rebasing wrapper — useful for DeFi and L2 bridging. " +
    "Requires stETH approval for the wstETH contract. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount of stETH to wrap (e.g. '1.0')",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Wrap stETH to wstETH",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export const wrapEthToolDef = {
  name: "lido_wrap_eth_to_wsteth",
  description:
    "Stake ETH and wrap to wstETH in a single transaction. " +
    "Equivalent to stake + wrap but more gas efficient. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount of ETH to stake and wrap (e.g. '1.0')",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Stake+Wrap ETH to wstETH",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

export const unwrapToolDef = {
  name: "lido_unwrap_wsteth_to_steth",
  description:
    "Unwrap wstETH back to stETH. Converts non-rebasing wstETH to rebasing stETH. " +
    "Defaults to dry_run=true (simulation only). Set dry_run=false to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      amount: {
        type: "string",
        description: "Amount of wstETH to unwrap (e.g. '1.0')",
      },
      dry_run: {
        type: "boolean",
        description: "If true, simulate only. Default: true.",
      },
    },
    required: ["amount"],
  },
  annotations: {
    title: "Unwrap wstETH to stETH",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const schema = z.object({
  amount: ethAmountSchema,
  dry_run: z.boolean().optional().default(true),
});

export async function handleWrapSteth(args: Record<string, unknown>) {
  try {
    const { amount, dry_run } = schema.parse(args);
    const value = parseEther(amount);

    const capError = validateAmountCap(value);
    if (capError) return errorResult(capError);

    const stethBalance = await sdk.steth.balance(getAccountAddress());
    if (stethBalance < value) {
      return errorResult(
        `Insufficient stETH balance. You have ${formatEther(stethBalance)} stETH ` +
        `but are trying to wrap ${amount} stETH.`
      );
    }

    const allowance = await sdk.wrap.getStethForWrapAllowance();
    const needsApproval = allowance < value;

    const props = { value };

    if (dry_run) {
      const result = await performDryRun(
        () => sdk.wrap.wrapStethPopulateTx(props),
        needsApproval ? undefined : () => sdk.wrap.wrapStethSimulateTx(props),
        () => sdk.wrap.wrapStethEstimateGas(props),
      );

      const approvalNote = needsApproval
        ? `\nApproval needed: YES (will approve stETH for wstETH contract before wrapping)`
        : `\nApproval needed: No`;

      return textResult(
        `Dry run for wrapping ${amount} stETH → wstETH:\n\n${formatDryRunResult(result)}${approvalNote}`
      );
    }

    if (needsApproval) {
      // +2 wei buffer for stETH share-rounding
      await sdk.wrap.approveStethForWrap({ value: value + 2n });
    }

    const result = await sdk.wrap.wrapSteth(props);
    const lines = [
      "=== Wrap Successful ===",
      `Transaction hash: ${result.hash}`,
      `stETH wrapped: ${result.result ? formatEther(result.result.stethWrapped) : "pending"}`,
      `wstETH received: ${result.result ? formatEther(result.result.wstethReceived) : "pending"}`,
    ];

    if (needsApproval) {
      lines.push("stETH approval was granted automatically.");
    }

    return textResult(lines.join("\n"));
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleWrapEth(args: Record<string, unknown>) {
  try {
    const { amount, dry_run } = schema.parse(args);
    const value = parseEther(amount);

    const capError = validateAmountCap(value);
    if (capError) return errorResult(capError);

    const ethBalance = await publicClient.getBalance({ address: getAccountAddress() });
    if (ethBalance < value) {
      return errorResult(
        `Insufficient ETH balance. You have ${formatEther(ethBalance)} ETH ` +
        `but are trying to wrap ${amount} ETH.`
      );
    }

    const props = { value };

    if (dry_run) {
      // Lido SDK doesn't expose wrapEthSimulateTx, so we simulate via viem's eth_call
      const simulateWrapEth = async () => {
        const populated = await sdk.wrap.wrapEthPopulateTx(props);
        await publicClient.call({
          to: populated.to,
          from: populated.from ?? getAccountAddress(),
          data: populated.data,
          value: populated.value,
        });
      };

      const result = await performDryRun(
        () => sdk.wrap.wrapEthPopulateTx(props),
        simulateWrapEth,
        () => sdk.wrap.wrapEthEstimateGas(props),
      );
      return textResult(
        `Dry run for wrapping ${amount} ETH → wstETH:\n\n${formatDryRunResult(result)}`
      );
    }

    const result = await sdk.wrap.wrapEth(props);
    return textResult(
      [
        "=== Wrap ETH → wstETH Successful ===",
        `Transaction hash: ${result.hash}`,
        `stETH wrapped: ${result.result ? formatEther(result.result.stethWrapped) : "pending"}`,
        `wstETH received: ${result.result ? formatEther(result.result.wstethReceived) : "pending"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}

export async function handleUnwrap(args: Record<string, unknown>) {
  try {
    const { amount, dry_run } = schema.parse(args);
    const value = parseEther(amount);

    const capError = validateAmountCap(value);
    if (capError) return errorResult(capError);

    const wstethBalance = await sdk.wsteth.balance(getAccountAddress());
    if (wstethBalance < value) {
      return errorResult(
        `Insufficient wstETH balance. You have ${formatEther(wstethBalance)} wstETH ` +
        `but are trying to unwrap ${amount} wstETH.`
      );
    }

    const props = { value };

    if (dry_run) {
      const result = await performDryRun(
        () => sdk.wrap.unwrapPopulateTx(props),
        () => sdk.wrap.unwrapSimulateTx(props),
        () => sdk.wrap.unwrapEstimateGas(props),
      );
      return textResult(
        `Dry run for unwrapping ${amount} wstETH → stETH:\n\n${formatDryRunResult(result)}`
      );
    }

    const result = await sdk.wrap.unwrap(props);
    return textResult(
      [
        "=== Unwrap Successful ===",
        `Transaction hash: ${result.hash}`,
        `wstETH unwrapped: ${result.result ? formatEther(result.result.wstethUnwrapped) : "pending"}`,
        `stETH received: ${result.result ? formatEther(result.result.stethReceived) : "pending"}`,
      ].join("\n")
    );
  } catch (error) {
    return handleToolError(error);
  }
}
