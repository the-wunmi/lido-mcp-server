import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerTools } from "../../src/tools/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { securityConfig } from "../../src/config.js";

let listHandler: (request: any) => Promise<any>;
let callHandler: (request: any) => Promise<any>;

const mockServer = {
  setRequestHandler: vi.fn((schema: unknown, handler: any) => {
    if (schema === ListToolsRequestSchema) {
      listHandler = handler;
    } else if (schema === CallToolRequestSchema) {
      callHandler = handler;
    }
  }),
};

describe("registerTools", () => {
  beforeEach(() => {
    mockServer.setRequestHandler.mockClear();
    registerTools(mockServer as any);
  });

  it("registers exactly two request handlers (list and call)", () => {
    expect(mockServer.setRequestHandler).toHaveBeenCalledTimes(2);
    expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
      ListToolsRequestSchema,
      expect.any(Function),
    );
    expect(mockServer.setRequestHandler).toHaveBeenCalledWith(
      CallToolRequestSchema,
      expect.any(Function),
    );
  });

  describe("ListToolsRequestSchema handler", () => {
    it("returns an array of tool definitions", async () => {
      const response = await listHandler({});

      expect(response).toBeDefined();
      expect(response.tools).toBeDefined();
      expect(Array.isArray(response.tools)).toBe(true);
      expect(response.tools.length).toBeGreaterThan(0);
    });

    it("each tool has a name, description, and inputSchema", async () => {
      const response = await listHandler({});

      for (const tool of response.tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe("string");
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe("string");
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("tool names are unique", async () => {
      const response = await listHandler({});
      const names = response.tools.map((t: any) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("includes known L1 read tools in default mode", async () => {
      const response = await listHandler({});
      const names = response.tools.map((t: any) => t.name);

      expect(names).toContain("lido_get_balances");
      expect(names).toContain("lido_get_staking_apr");
      expect(names).toContain("lido_get_protocol_status");
    });

    it("includes write tools in full mode", async () => {
      const response = await listHandler({});
      const names = response.tools.map((t: any) => t.name);

      expect(names).toContain("lido_stake_eth");
      expect(names).toContain("lido_request_withdrawal");
    });
  });

  describe("CallToolRequestSchema handler", () => {
    it("returns error for unknown tool name", async () => {
      const result = await callHandler({
        params: { name: "nonexistent_tool", arguments: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Unknown tool: nonexistent_tool");
    });

    it("dispatches a known read tool and returns a result", async () => {
      const result = await callHandler({
        params: { name: "lido_get_balances", arguments: {} },
      });

      expect(result.content).toBeDefined();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.content[0].text).not.toContain("Unknown tool");
    });

    it("dispatches with empty arguments when none provided", async () => {
      const result = await callHandler({
        params: { name: "lido_get_balances" },
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).not.toContain("Unknown tool");
    });

    it("dispatches a known write tool", async () => {
      const result = await callHandler({
        params: {
          name: "lido_stake_eth",
          arguments: { amount: "1.0" },
        },
      });

      expect(result.content).toBeDefined();
      expect(result.content[0].text).not.toContain("Unknown tool");
    });
  });

  describe("read-only mode", () => {
    it("blocks write tools in read-only mode", async () => {
      const originalMode = securityConfig.mode;
      (securityConfig as any).mode = "read-only";

      try {
        mockServer.setRequestHandler.mockClear();
        registerTools(mockServer as any);

        const result = await callHandler({
          params: {
            name: "lido_stake_eth",
            arguments: { amount: "1.0" },
          },
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain("read-only mode");
      } finally {
        (securityConfig as any).mode = originalMode;
      }
    });

    it("excludes write tools from list in read-only mode", async () => {
      const originalMode = securityConfig.mode;
      (securityConfig as any).mode = "read-only";

      try {
        mockServer.setRequestHandler.mockClear();
        registerTools(mockServer as any);

        const response = await listHandler({});
        const names = response.tools.map((t: any) => t.name);

        expect(names).not.toContain("lido_stake_eth");
        expect(names).not.toContain("lido_request_withdrawal");
        expect(names).not.toContain("lido_claim_withdrawal");
        expect(names).toContain("lido_get_balances");
      } finally {
        (securityConfig as any).mode = originalMode;
      }
    });

    it("allows read tools in read-only mode", async () => {
      const originalMode = securityConfig.mode;
      (securityConfig as any).mode = "read-only";

      try {
        mockServer.setRequestHandler.mockClear();
        registerTools(mockServer as any);

        const result = await callHandler({
          params: { name: "lido_get_balances", arguments: {} },
        });

        expect(result.content).toBeDefined();
        expect(result.isError).toBeUndefined();
      } finally {
        (securityConfig as any).mode = originalMode;
      }
    });
  });

  describe("dry-run-only mode", () => {
    it("forces dry_run=true for write tools", async () => {
      const originalMode = securityConfig.mode;
      (securityConfig as any).mode = "dry-run-only";

      try {
        mockServer.setRequestHandler.mockClear();
        registerTools(mockServer as any);

        const result = await callHandler({
          params: {
            name: "lido_stake_eth",
            arguments: { amount: "1.0", dry_run: false },
          },
        });

        expect(result.content).toBeDefined();
        const text = result.content[0].text;
        expect(text).toContain("DRY RUN");
      } finally {
        (securityConfig as any).mode = originalMode;
      }
    });
  });

  describe("error handling", () => {
    it("catches errors thrown by handler and returns error result", async () => {
      const { publicClient } = await import("../../src/sdk-factory.js");
      vi.mocked(publicClient.getBalance).mockRejectedValueOnce(
        new Error("catastrophic failure"),
      );

      const result = await callHandler({
        params: { name: "lido_get_balances", arguments: {} },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("catastrophic failure");
    });
  });

  describe("write mutex", () => {
    it("serializes concurrent write tool calls", async () => {
      const { sdk } = await import("../../src/sdk-factory.js");

      const callOrder: Array<{ tool: string; phase: "start" | "end"; time: number }> = [];

      vi.mocked(sdk.stake.stakeEthPopulateTx).mockImplementation(async () => {
        callOrder.push({ tool: "stake", phase: "start", time: Date.now() });
        await new Promise((r) => setTimeout(r, 50));
        callOrder.push({ tool: "stake", phase: "end", time: Date.now() });
        return {
          to: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84" as `0x${string}`,
          from: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
          value: 1000000000000000000n,
          data: "0xa1903eab" as `0x${string}`,
        };
      });

      const [result1, result2] = await Promise.all([
        callHandler({
          params: { name: "lido_stake_eth", arguments: { amount: "1.0" } },
        }),
        callHandler({
          params: { name: "lido_stake_eth", arguments: { amount: "2.0" } },
        }),
      ]);

      expect(result1.content).toBeDefined();
      expect(result2.content).toBeDefined();

      const starts = callOrder.filter((e) => e.phase === "start");
      const ends = callOrder.filter((e) => e.phase === "end");
      if (starts.length >= 2 && ends.length >= 1) {
        expect(starts[1].time).toBeGreaterThanOrEqual(ends[0].time);
      }
    });
  });
});
