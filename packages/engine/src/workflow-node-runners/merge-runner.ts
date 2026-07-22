import type { Settings } from "@fusion/core";
import { resolveEffectiveAutoMerge } from "@fusion/core";

import type { WorkflowNodeHandler } from "../workflow-graph-executor.js";
import type { WorkflowPrimitiveContext, WorkflowRuntimePrimitives } from "../runtime-primitives.js";
import { runWorkflowMergeAttemptNode } from "../workflow-merge-nodes.js";
import type { WorkflowLegacySeams } from "../workflow-node-handlers.js";

type MergeRunnerNode = Parameters<WorkflowNodeHandler>[0];
type MergeRunnerContext = Parameters<WorkflowNodeHandler>[1];

export interface MergeAttemptRunnerDeps {
  primitives?: WorkflowRuntimePrimitives;
  seams: Pick<WorkflowLegacySeams, "merge">;
  buildPrimitiveContext: (
    node: MergeRunnerNode,
    context: MergeRunnerContext,
    attempt?: number,
  ) => WorkflowPrimitiveContext;
}

/*
FNXC:WorkflowNodeRunners 2026-07-01-00:00:
Merge-attempt behavior is isolated behind a runner factory so the graph handler map no longer owns merge primitive dispatch. Primitive-backed production runs keep using WorkflowRuntimePrimitives; legacy-seam compatibility remains explicit for runner migration tests.
*/
export function createMergeAttemptHandler(deps: MergeAttemptRunnerDeps): WorkflowNodeHandler {
  return async (node, ctx) => {
    if (!deps.primitives) {
      return deps.seams.merge(ctx.task, ctx.context, ctx.signal);
    }
    const attempt = typeof ctx.context["workflow:work-item-attempt"] === "number"
      ? ctx.context["workflow:work-item-attempt"]
      : undefined;
    return runWorkflowMergeAttemptNode(
      { primitives: deps.primitives },
      deps.buildPrimitiveContext(node, ctx, attempt),
      ctx.task,
    );
  };
}

export function createMergeGateHandler(): WorkflowNodeHandler {
  return async (_node, ctx) => {
    // FUS-010: canonical resolver. Pass through project autoMerge without coercing
    // undefined→false (schema default is true; old gate used `!== false`). Callers
    // should pass materialized store settings; missing settings fail closed only
    // when both task and project/global slices are unset.
    const settingsSlice = {
      autoMerge: (ctx.settings as Partial<Settings> | undefined)?.autoMerge,
    };
    const autoMerge = resolveEffectiveAutoMerge(ctx.task, settingsSlice);
    return {
      outcome: "success",
      value: autoMerge ? "auto-on" : "auto-off",
    };
  };
}
