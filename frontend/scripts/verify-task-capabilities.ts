/**
 * Brief E — the capability table's refusal rules, as a deterministic gate:
 *
 *   npx tsx scripts/verify-task-capabilities.ts
 *
 * Imports the REAL fixture table + the REAL default and asserts the refusal
 * matrix the brief demands. Exits non-zero on any failure. No npm dependency
 * beyond what tsx already needs, no browser, no server.
 */
import {
  taskCapabilitiesById,
  DEFAULT_TASK_CAPABILITY,
} from "../src/mock/tasks";

let failed = false;
const check = (label: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? " — " + JSON.stringify(detail) : ""}`);
  if (!ok) failed = true;
};

/* ------------------------------------------------------------------ *
 * The refusal table (encoded here independently of the UI):
 *   can_create_tasks=false → create refused  (CAPABILITY_DENIED)
 *   can_assign_tasks=false → assign refused  (CAPABILITY_DENIED)
 * ------------------------------------------------------------------ */
const denied = (has: boolean): boolean => !has; // the gate is exactly this

// Seeded shapes per the brief:
check("e1 (create+assign): create allowed", !denied(taskCapabilitiesById.e1.can_create_tasks));
check("e1 (create+assign): assign allowed", !denied(taskCapabilitiesById.e1.can_assign_tasks));
check("e2 (create only): create allowed", !denied(taskCapabilitiesById.e2.can_create_tasks), taskCapabilitiesById.e2);
check("e2 (create only): assign refused → CAPABILITY_DENIED", denied(taskCapabilitiesById.e2.can_assign_tasks), taskCapabilitiesById.e2);
check("e3 (neither): create refused → CAPABILITY_DENIED", denied(taskCapabilitiesById.e3.can_create_tasks), taskCapabilitiesById.e3);
check("e3 (neither): assign refused → CAPABILITY_DENIED", denied(taskCapabilitiesById.e3.can_assign_tasks), taskCapabilitiesById.e3);
check("e4 (neither): create refused → CAPABILITY_DENIED", denied(taskCapabilitiesById.e4.can_create_tasks), taskCapabilitiesById.e4);
check("m1 (manager): both", taskCapabilitiesById.m1.can_create_tasks && taskCapabilitiesById.m1.can_assign_tasks);
check("hr1 (HR): both", taskCapabilitiesById.hr1.can_create_tasks && taskCapabilitiesById.hr1.can_assign_tasks);

// Unlisted directory ids fall to the safe default: nothing allowed.
check("unlisted employee → DEFAULT create denied", denied(DEFAULT_TASK_CAPABILITY.can_create_tasks));
check("unlisted employee → DEFAULT assign denied", denied(DEFAULT_TASK_CAPABILITY.can_assign_tasks));

// Every directory id present in the fixture table must have a real boolean
// pair — a missing id silently denies everything, so make that a loud FAIL.
const ids = Object.keys(taskCapabilitiesById);
const shapeOk = ids.every((id) => {
  const flags = taskCapabilitiesById[id];
  return typeof flags?.can_create_tasks === "boolean" && typeof flags?.can_assign_tasks === "boolean";
});
check(`capability table is well-formed for all ${ids.length} ids`, shapeOk, ids);

if (failed) {
  console.log("\nCAPABILITY GATE FAILED");
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
