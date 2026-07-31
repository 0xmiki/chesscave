import { describe, expect, test } from "bun:test";
import {
  filterSlashCommands,
  matchSlashMenuQuery,
  resolveSlashMenuKey,
  slashMenuFocusTarget,
  slashCommands,
} from "./slash-commands";

describe("Notes slash commands", () => {
  test("exposes only the implemented Milestone 4 vocabulary", () => {
    expect(slashCommands.map((command) => command.label)).toEqual([
      "Text",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bulleted list",
      "Numbered list",
      "To-do",
      "Quote",
      "Divider",
      "Code",
      "Page",
    ]);
  });

  test("searches labels and plain-language aliases predictably", () => {
    expect(filterSlashCommands("head").map((command) => command.id))
      .toEqual(["heading-1", "heading-2", "heading-3"]);
    expect(filterSlashCommands("checkbox")[0]?.id).toBe("to-do");
    expect(filterSlashCommands("subpage")[0]?.id).toBe("page");
    expect(filterSlashCommands("separator")[0]?.id).toBe("divider");
    expect(filterSlashCommands("not a real block")).toEqual([]);
  });

  test("recognizes a complete slash expression from the current block", () => {
    expect(matchSlashMenuQuery("/", 1)).toBe("");
    expect(matchSlashMenuQuery("/number", 7)).toBe("number");
    expect(matchSlashMenuQuery("plan /number", 12)).toBeNull();
    expect(matchSlashMenuQuery("/number", 3)).toBeNull();
    expect(matchSlashMenuQuery("/two/levels", 11)).toBeNull();
    expect(matchSlashMenuQuery("/two\nlevels", 11)).toBeNull();
  });

  test("does not depend on the lifetime of a debounced typing session", () => {
    expect(matchSlashMenuQuery("/", 1)).toBe("");
    expect(matchSlashMenuQuery("/header", 7)).toBe("header");
  });

  test("wraps arrow navigation and resolves selection and dismissal", () => {
    expect(resolveSlashMenuKey("ArrowDown", 2, 3)).toEqual({
      kind: "highlight",
      index: 0,
    });
    expect(resolveSlashMenuKey("ArrowUp", 0, 3)).toEqual({
      kind: "highlight",
      index: 2,
    });
    expect(resolveSlashMenuKey("Enter", 1, 3)).toEqual({
      kind: "select",
      index: 1,
    });
    expect(resolveSlashMenuKey("Escape", 1, 3)).toEqual({ kind: "dismiss" });
    expect(resolveSlashMenuKey("Enter", 0, 0)).toEqual({ kind: "dismiss" });
    expect(resolveSlashMenuKey("ArrowDown", 0, 0)).toEqual({
      kind: "highlight",
      index: 0,
    });
    expect(resolveSlashMenuKey("Tab", 0, 3)).toBeNull();
    expect(slashMenuFocusTarget("slash")).toBe("editor");
    expect(slashMenuFocusTarget("turn")).toBe("trigger");
  });

  test("inherits the app-wide reduced-motion contract", async () => {
    const appCss = await Bun.file(
      new URL("../../app.css", import.meta.url),
    ).text();
    expect(appCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(appCss).toContain("transition-duration: 0.01ms !important");
  });
});
