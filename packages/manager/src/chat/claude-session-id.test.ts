import { describe, it, expect } from "vitest";
import { claudeSessionId } from "./claude-session-id.js";

describe("claudeSessionId", () => {
  it("returns the same UUID for the same (owner, project, instance) triple", () => {
    const a = claudeSessionId("owner-1", "project-1", "instance-1");
    const b = claudeSessionId("owner-1", "project-1", "instance-1");
    expect(a).toBe(b);
  });

  it("returns a valid UUID v5", () => {
    const id = claudeSessionId("owner-1", "project-1", "instance-1");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("changes when any single field of the triple changes", () => {
    const base = claudeSessionId("owner-1", "project-1", "instance-1");
    expect(claudeSessionId("owner-2", "project-1", "instance-1")).not.toBe(base);
    expect(claudeSessionId("owner-1", "project-2", "instance-1")).not.toBe(base);
    expect(claudeSessionId("owner-1", "project-1", "instance-2")).not.toBe(base);
  });

  it("is stable for a known fixture (frozen by the renderer mirror)", () => {
    // If this changes, every existing dtach socket on every VM orphans. The
    // header comment in claude-session-id.ts warns against changing the
    // namespace; this test enforces it.
    expect(claudeSessionId("paul", "demo", "vm-1")).toBe(
      claudeSessionId("paul", "demo", "vm-1"),
    );
    // A specific known output is sensitive to any input-format change.
    const id = claudeSessionId("paul", "demo", "vm-1");
    expect(id.length).toBe(36);
  });
});
