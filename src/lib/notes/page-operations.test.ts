import { describe, expect, test } from "bun:test";
import { createPageTransaction } from "./page-operations";

describe("Notes page operations", () => {
  test("creates a nested page followed by an editable parent paragraph", () => {
    const change = createPageTransaction("parent", 3);
    const continuation = change.parentContinuation;
    expect(continuation?.type).toBe("paragraph");
    if (!continuation) throw new Error("Nested page needs a continuation.");
    expect(change.operations.at(-1)).toEqual({
      kind: "insertChild",
      parentId: "parent",
      childId: continuation.id,
      index: 4,
    });
    expect(change.operations).toContainEqual({
      kind: "insertChild",
      parentId: change.page.id,
      childId: change.pageParagraph.id,
      index: 0,
    });
  });

  test("keeps a root page limited to its own initial paragraph", () => {
    const change = createPageTransaction(null, 0);
    expect(change.parentContinuation).toBeNull();
    expect(change.operations).toHaveLength(4);
  });
});
