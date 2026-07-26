import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_OUTPUT_MAX_CHARS, buildToolOutputTruncationMarker } from "@fusion/core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { wrapCustomToolsForPluginRuntime } from "../agent-session-helpers.js";
import { wrapToolsWithOutputBudget } from "../pi.js";

function toolWithResult(result: unknown, name = "fn_budget_test"): ToolDefinition {
  return { name, label: name, description: name, parameters: {} as never, execute: async () => result } as ToolDefinition;
}

async function execute(tool: ToolDefinition): Promise<any> {
  return (tool.execute as any)("call", {}, undefined);
}

describe("tool output budget wrapper", () => {
  it("enforces a single total cap across text blocks while preserving mixed blocks and details", async () => {
    const details = { nested: { untouched: true } };
    const original = {
      content: [
        { type: "text", text: "a".repeat(12_000) },
        { type: "image", data: "unchanged" },
        { type: "text", text: "b".repeat(12_000) },
        { type: "text", text: "c".repeat(100) },
      ],
      details,
      isError: true,
    };
    const result = await execute(wrapToolsWithOutputBudget([toolWithResult(original)])[0]);
    const texts = result.content.filter((block: any) => block.type === "text").map((block: any) => block.text);
    expect(texts.join("").length).toBeLessThanOrEqual(DEFAULT_TOOL_OUTPUT_MAX_CHARS);
    expect(texts[1]).toContain("Tool output truncated");
    expect(texts[2]).toBe("");
    expect(result.content[1]).toEqual(original.content[1]);
    expect(result.details).toBe(details);
    expect(result.isError).toBe(true);
    expect(texts[0]).not.toBe("");
  });

  it("preserves empty and undefined text, and puts a boundary overflow marker in document order", async () => {
    const marker = buildToolOutputTruncationMarker();
    const result = await execute(wrapToolsWithOutputBudget([
      toolWithResult({ content: [{ type: "text", text: "abcd" }, { type: "text", text: "z".repeat(200) }, { type: "text", text: undefined }] }),
    ], { overrides: { fn_budget_test: marker.length + 4 } })[0]);
    expect(result.content.map((block: any) => block.text)).toEqual(["abcd", marker, ""]);
  });

  it("honors finite larger and smaller overrides, rejects invalid values, and does not double-mark", async () => {
    const source = "x".repeat(200);
    const large = await execute(wrapToolsWithOutputBudget([toolWithResult({ content: [{ type: "text", text: source }] })], { overrides: { fn_budget_test: 300 } })[0]);
    const small = await execute(wrapToolsWithOutputBudget([toolWithResult({ content: [{ type: "text", text: source }] })], { overrides: { fn_budget_test: 100 } })[0]);
    expect(large.content[0].text).toBe(source);
    expect(small.content[0].text.length).toBeLessThanOrEqual(100);
    await expect(execute(wrapToolsWithOutputBudget([toolWithResult({ content: [{ type: "text", text: source }] })], { overrides: { fn_budget_test: Infinity } })[0])).rejects.toThrow(/finite positive integers/);
    const once = wrapToolsWithOutputBudget([toolWithResult({ content: [{ type: "text", text: source }] })], { overrides: { fn_budget_test: 100 } });
    const twice = wrapToolsWithOutputBudget(once, { overrides: { fn_budget_test: 100 } });
    const result = await execute(twice[0]);
    expect(result.content[0].text.match(/Tool output truncated/g)).toHaveLength(1);
  });

  it("applies the same clamp on the non-pi plugin-runtime path exactly once", async () => {
    const result = await execute(wrapCustomToolsForPluginRuntime([
      toolWithResult({ content: [{ type: "text", text: "x".repeat(DEFAULT_TOOL_OUTPUT_MAX_CHARS + 1) }] }),
    ], {})![0]);
    expect(result.content[0].text.length).toBeLessThanOrEqual(DEFAULT_TOOL_OUTPUT_MAX_CHARS);
    expect(result.content[0].text.match(/Tool output truncated/g)).toHaveLength(1);
  });
});
