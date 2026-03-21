export interface DryRunResult {
  populated_tx: {
    to: string;
    from: string;
    value: string;
    data: string;
  };
  gas_estimate: string;
  gas_cost_eth: string;
  simulation: {
    success: boolean;
    error?: string;
  };
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}
