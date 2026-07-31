import { describe, expect, test } from "bun:test";
import {
  buildVisiblePageTree,
  notePageTitle,
  resolvePageTreeKey,
} from "./tree";
import type { NoteBlockRecord } from "./types";

const page = (
  id: string,
  title: string,
  content: string[] = [],
  parentId: string | null = null,
): NoteBlockRecord => ({
  id,
  type: "page",
  properties: { title: title ? [{ text: title }] : [] },
  content,
  parentId,
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
});

describe("Notes page tree", () => {
  test("preserves root and nested content order", () => {
    const pages = [
      page("root", "Openings", ["paragraph", "child-b", "child-a"]),
      page("child-a", "Endgames", [], "root"),
      page("child-b", "Tactics", ["grandchild"], "root"),
      page("grandchild", "Pins", [], "child-b"),
    ];
    const visible = buildVisiblePageTree(
      ["root"],
      pages,
      ["root", "child-b"],
    );

    expect(visible.map((node) => node.page.id)).toEqual([
      "root",
      "child-b",
      "grandchild",
      "child-a",
    ]);
    expect(visible.map((node) => node.depth)).toEqual([0, 1, 2, 1]);
  });

  test("hides collapsed descendants and ignores invalid cycles", () => {
    const pages = [
      page("root", "Root", ["child"]),
      page("child", "Child", ["root"], "root"),
    ];
    expect(buildVisiblePageTree(["root"], pages, []).map((node) => node.page.id))
      .toEqual(["root"]);
    expect(
      buildVisiblePageTree(["root"], pages, ["root", "child"]).map(
        (node) => node.page.id,
      ),
    ).toEqual(["root", "child"]);
  });

  test("derives a plain page title without exposing empty metadata", () => {
    expect(notePageTitle(page("one", "  London System  "))).toBe(
      "London System",
    );
    expect(notePageTitle(page("two", ""))).toBe("Untitled");
  });

  test("resolves keyboard navigation without depending on the DOM", () => {
    const pages = [
      page("root", "Openings", ["child"]),
      page("child", "Plans", [], "root"),
      page("other", "Endgames"),
    ];
    const visible = buildVisiblePageTree(
      ["root", "other"],
      pages,
      ["root"],
    );

    expect(resolvePageTreeKey("ArrowDown", 0, visible, ["root"]))
      .toEqual({ kind: "focus", id: "child" });
    expect(resolvePageTreeKey("ArrowRight", 0, visible, ["root"]))
      .toEqual({ kind: "focus", id: "child" });
    expect(resolvePageTreeKey("ArrowLeft", 1, visible, ["root"]))
      .toEqual({ kind: "focus", id: "root" });
    expect(resolvePageTreeKey("End", 0, visible, ["root"]))
      .toEqual({ kind: "focus", id: "other" });
    expect(resolvePageTreeKey("F2", 1, visible, ["root"]))
      .toEqual({ kind: "rename", id: "child" });
  });

  test("uses right and left arrows to expand and collapse parents", () => {
    const pages = [
      page("root", "Openings", ["child"]),
      page("child", "Plans", [], "root"),
    ];
    const collapsed = buildVisiblePageTree(["root"], pages, []);
    const expanded = buildVisiblePageTree(["root"], pages, ["root"]);

    expect(resolvePageTreeKey("ArrowRight", 0, collapsed, []))
      .toEqual({ kind: "toggle", id: "root" });
    expect(resolvePageTreeKey("ArrowLeft", 0, expanded, ["root"]))
      .toEqual({ kind: "toggle", id: "root" });
    expect(resolvePageTreeKey("ArrowUp", 0, expanded, ["root"])).toBeNull();
  });
});
