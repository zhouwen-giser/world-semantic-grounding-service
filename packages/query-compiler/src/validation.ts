import { createHash } from "node:crypto";
import type { WorldQueryPlanV2 } from "./types.js";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function validateCompiledPlan(plan: WorldQueryPlanV2): WorldQueryPlanV2 {
  if (plan.queryPlanVersion !== "2.0" || plan.nodes.length === 0 || plan.nodes.length > 64) throw new Error("INVALID_PLAN_NODE_COUNT");
  if (plan.nodes.length > plan.budgets.maximumNodes) throw new Error("PLAN_NODE_BUDGET_EXCEEDED");
  const nodeIds = plan.nodes.map((node) => node.nodeId);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("DUPLICATE_PLAN_NODE_ID");
  const nodeSet = new Set(nodeIds);
  let rows = 0;
  let candidates = 0;
  let outputBytes = 0;
  let executionMs = 0;
  for (const node of plan.nodes) {
    rows += node.budget.maximumRows;
    candidates += node.budget.maximumCandidates;
    outputBytes += node.budget.maximumOutputBytes;
    executionMs += node.budget.maximumExecutionMs;
    for (const binding of Object.values(node.inputs)) {
      if (binding.kind === "NODE_OUTPUT" && (!binding.nodeId || !nodeSet.has(binding.nodeId))) throw new Error("DANGLING_PLAN_BINDING");
      if (binding.port.unitSemantics === "LINEAR_METERS" && binding.port.valueKind === "H3_CELL") {
        throw new Error("ANGULAR_DISCRETE_UNIT_MIX");
      }
    }
  }
  if (
    rows > plan.budgets.maximumRows || candidates > plan.budgets.maximumCandidates ||
    outputBytes > plan.budgets.maximumOutputBytes || executionMs > plan.budgets.maximumExecutionMs
  ) throw new Error("PLAN_AGGREGATE_BUDGET_EXCEEDED");
  for (const output of plan.outputs) {
    if (!nodeSet.has(output.binding.nodeId)) throw new Error("DANGLING_PLAN_OUTPUT");
  }
  return plan;
}

export function canonicalPlanHash(plan: WorldQueryPlanV2): `sha256:${string}` {
  validateCompiledPlan(plan);
  return `sha256:${createHash("sha256").update(canonical(plan), "utf8").digest("hex")}`;
}
