import { evaluate, parse, type MathNode } from "mathjs";
import type { VaultSnapshot, BenchmarkRates } from "./types.js";
import { BIGINT_SCALE_18 } from "./config.js";

const ALLOWED_VARS = new Set([
  "apr",
  "apr_prev",
  "apr_delta",
  "apy",        // alias for apr (backward compatibility)
  "apy_prev",   // alias for apr_prev
  "apy_delta",  // alias for apr_delta
  "tvl",
  "tvl_prev",
  "tvl_change_pct",
  "share_price",
  "share_price_prev",
  "share_price_change_pct",
  "steth_apr",
  "spread_vs_steth",
]);

const SAFE_FUNCTIONS = new Set([
  "abs", "min", "max", "round", "floor", "ceil", "sqrt", "sign", "log",
  "and", "or", "not",
]);

const ALLOWED_NODE_TYPES = new Set([
  "ConstantNode",
  "OperatorNode",
  "ParenthesisNode",
  "ConditionalNode",
  "SymbolNode",
  "FunctionNode",
]);

const REJECTED_NODE_TYPES = new Set([
  "AssignmentNode",
  "FunctionAssignmentNode",
  "BlockNode",
  "AccessorNode",
  "IndexNode",
  "ObjectNode",
  "ArrayNode",
  "RangeNode",
]);

export const MAX_EXPRESSION_LENGTH = 500;
export const MAX_MESSAGE_LENGTH = 1000;

const MAX_AST_DEPTH = 10;

function validateAst(node: MathNode, depth = 0): string | null {
  if (depth > MAX_AST_DEPTH) {
    return `Expression too deeply nested (max ${MAX_AST_DEPTH} levels).`;
  }

  const nodeType = node.type;

  if (REJECTED_NODE_TYPES.has(nodeType)) {
    return `Forbidden node type: ${nodeType}. Only comparison and arithmetic expressions are allowed.`;
  }

  if (!ALLOWED_NODE_TYPES.has(nodeType)) {
    return `Unsupported node type: ${nodeType}.`;
  }

  if (nodeType === "SymbolNode") {
    const name = (node as unknown as { name: string }).name;
    if (!ALLOWED_VARS.has(name) && !SAFE_FUNCTIONS.has(name)) {
      return `Unknown variable "${name}". Allowed: ${[...ALLOWED_VARS].join(", ")}`;
    }
  }

  if (nodeType === "FunctionNode") {
    const fnNode = node as unknown as { fn: { name?: string } };
    const fnName = fnNode.fn?.name;
    if (!fnName || !SAFE_FUNCTIONS.has(fnName)) {
      return `Function "${fnName ?? "unknown"}" is not allowed. Allowed: ${[...SAFE_FUNCTIONS].join(", ")}`;
    }
  }

  let childError: string | null = null;
  node.forEach((child: MathNode) => {
    if (childError) return;
    childError = validateAst(child, depth + 1);
  });

  return childError;
}

/**
 * Build the evaluation scope from current/previous snapshots and benchmarks.
 * Missing values default to NaN so expressions using them evaluate to false.
 */
export function buildScope(
  current: VaultSnapshot,
  previous: VaultSnapshot | undefined,
  benchmarks: BenchmarkRates,
): Record<string, number> {
  const apr = current.apr ?? NaN;
  const aprPrev = previous?.apr ?? NaN;
  const tvl = parseFloat(current.tvl) || 0;
  const tvlPrev = previous ? (parseFloat(previous.tvl) || 0) : NaN;
  const tvlChangePct = tvlPrev !== 0 && !isNaN(tvlPrev)
    ? ((tvl - tvlPrev) / tvlPrev) * 100
    : NaN;

  const decimals = current.assetDecimals ?? 18;
  const divisorBig = 10n ** BigInt(decimals);
  const sharePrice = Number((current.sharePrice * BIGINT_SCALE_18) / divisorBig) / 1e18;
  const sharePricePrev = previous
    ? Number((previous.sharePrice * BIGINT_SCALE_18) / divisorBig) / 1e18
    : NaN;
  const sharePriceChangePct = (previous && previous.sharePrice !== 0n)
    ? Number(((current.sharePrice - previous.sharePrice) * BIGINT_SCALE_18 * 100n) / previous.sharePrice) / 1e18
    : NaN;

  const stethApr = benchmarks.stethApr ?? NaN;
  const spreadVsSteth = !isNaN(apr) && !isNaN(stethApr) ? apr - stethApr : NaN;

  const aprDelta = !isNaN(apr) && !isNaN(aprPrev) ? apr - aprPrev : NaN;

  return {
    apr,
    apr_prev: aprPrev,
    apr_delta: aprDelta,
    // apy aliases — same values (backward compatibility)
    apy: apr,
    apy_prev: aprPrev,
    apy_delta: aprDelta,
    tvl,
    tvl_prev: tvlPrev,
    tvl_change_pct: tvlChangePct,
    share_price: sharePrice,
    share_price_prev: sharePricePrev,
    share_price_change_pct: sharePriceChangePct,
    steth_apr: stethApr,
    spread_vs_steth: spreadVsSteth,
  };
}

export function validateExpression(expression: string): string | null {
  if (!expression.trim()) {
    return "Expression cannot be empty.";
  }

  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return `Expression too long (${expression.length} chars, max ${MAX_EXPRESSION_LENGTH}).`;
  }

  let ast: MathNode;
  try {
    ast = parse(expression);
  } catch (err) {
    return `Invalid expression syntax: ${err instanceof Error ? err.message : String(err)}`;
  }

  const astError = validateAst(ast);
  if (astError) return astError;

  const testScope: Record<string, number> = {};
  for (const v of ALLOWED_VARS) {
    testScope[v] = 1;
  }

  try {
    const result = evaluate(expression, testScope);
    if (typeof result !== "boolean" && typeof result !== "number") {
      return `Expression must evaluate to a boolean or number, got ${typeof result}.`;
    }
  } catch (err) {
    return `Expression evaluation error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return null;
}

/** Returns true if triggered, false otherwise. Returns false on any error. */
export function evaluateRule(expression: string, scope: Record<string, number>): boolean {
  try {
    // AST validation in validateExpression ensures only ALLOWED_VARS are accessible,
    // preventing prototype chain access (e.g., constructor, __proto__)
    const result = evaluate(expression, scope);
    return Boolean(result);
  } catch {
    return false;
  }
}

export const VARIABLE_DECIMALS: Record<string, number> = {
  apr: 2,
  apr_prev: 2,
  apr_delta: 2,
  apy: 2,
  apy_prev: 2,
  apy_delta: 2,
  tvl: 0,
  tvl_prev: 0,
  tvl_change_pct: 2,
  share_price: 6,
  share_price_prev: 6,
  share_price_change_pct: 2,
  steth_apr: 2,
  spread_vs_steth: 2,
};

export function renderTemplate(template: string, scope: Record<string, number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = scope[key];
    if (val === undefined || isNaN(val)) return "N/A";
    const decimals = VARIABLE_DECIMALS[key] ?? 2;
    return val.toFixed(decimals);
  });
}

export function generateRuleId(): string {
  return `rule-${crypto.randomUUID().slice(0, 8)}`;
}

export function getAvailableVariables(): string[] {
  return [...ALLOWED_VARS];
}

export interface DryRunResult {
  fired: boolean;
  scope: Record<string, number>;
  renderedMessage: string;
}

export function dryRunRule(
  expression: string,
  message: string,
  current: VaultSnapshot,
  previous: VaultSnapshot | undefined,
  benchmarks: BenchmarkRates,
): DryRunResult {
  const scope = buildScope(current, previous, benchmarks);
  const fired = evaluateRule(expression, scope);
  const renderedMessage = renderTemplate(message, scope);
  return { fired, scope, renderedMessage };
}
