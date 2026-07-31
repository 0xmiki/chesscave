import { describe, expect, test } from "bun:test";
import {
  applyMarkdownBlockShortcut,
  indentListItem,
  insertParagraph,
  matchMarkdownBlockShortcut,
  mergeParagraphBackward,
  noteBlockText,
  pastePlainText,
  parseInlineMarkdown,
  removeBlockStyleBackward,
  removeDividerBackward,
  replaceParagraphText,
  resolveParagraphKey,
  splitParagraph,
  trailingParagraph,
  transformToDivider,
  transformTextBlockToPage,
  outdentListItem,
} from "./editor";
import type {
  NewNoteBlock,
  NoteBlockRecord,
  NotesPageChunk,
  SupportedNoteBlockType,
  TextNoteBlockType,
} from "./types";

const pageId = "00000000-0000-4000-8000-000000000001";
const paragraphId = "00000000-0000-4000-8000-000000000002";

const newParagraph = (id: string, text = ""): NewNoteBlock => ({
  id,
  type: "paragraph",
  properties: { title: text ? [{ text }] : [] },
});

const record = (
  id: string,
  type: SupportedNoteBlockType,
  text: string,
  content: string[] = [],
  parentId: string | null = type === "page" ? null : pageId,
): NoteBlockRecord => ({
  id,
  type,
  properties: { title: text ? [{ text }] : [] },
  content,
  parentId,
  revision: 2,
  createdAt: 1,
  updatedAt: 1,
});

const document = (text = "hello world"): NotesPageChunk => ({
  rootId: pageId,
  blocks: [
    record(pageId, "page", "Plans", [paragraphId]),
    record(paragraphId, "paragraph", text),
  ],
});

describe("Notes paragraph editor model", () => {
  test("applies local typing and creates a reversible property transaction", () => {
    const change = replaceParagraphText(document("old"), paragraphId, "new");
    expect(noteBlockText(change.after.blocks[1])).toBe("new");
    expect(change.forward).toEqual([
      {
        kind: "updateProperties",
        id: paragraphId,
        properties: { title: [{ text: "new" }] },
      },
    ]);
    expect(change.inverse[0]).toMatchObject({
      kind: "updateProperties",
      properties: { title: [{ text: "old" }] },
    });
  });

  test("inserts a real paragraph after a terminal subpage block", () => {
    const subpageId = "00000000-0000-4000-8000-000000000003";
    const continuationId = "00000000-0000-4000-8000-000000000004";
    const chunk: NotesPageChunk = {
      rootId: pageId,
      blocks: [
        record(pageId, "page", "Plans", [paragraphId, subpageId]),
        record(paragraphId, "paragraph", "before"),
        record(subpageId, "page", "Karo-Kann", [], pageId),
      ],
    };

    expect(trailingParagraph(chunk)).toBeNull();
    const change = insertParagraph(
      chunk,
      2,
      newParagraph(continuationId),
    );
    expect(change.after.blocks[0].content).toEqual([
      paragraphId,
      subpageId,
      continuationId,
    ]);
    expect(trailingParagraph(change.after)?.id).toBe(continuationId);
    expect(change.afterSelection).toEqual({
      blockId: continuationId,
      offset: 0,
    });
    expect(change.inverse).toEqual([
      {
        kind: "removeChild",
        parentId: pageId,
        childId: continuationId,
      },
      { kind: "deleteBlock", id: continuationId },
    ]);
  });

  test("splits a paragraph at the caret and restores it with inverse operations", () => {
    const nextId = "00000000-0000-4000-8000-000000000003";
    const change = splitParagraph(
      document(),
      paragraphId,
      5,
      newParagraph(nextId),
    );
    const page = change.after.blocks[0];
    expect(page.content).toEqual([paragraphId, nextId]);
    expect(change.after.blocks.slice(1).map(noteBlockText)).toEqual([
      "hello",
      " world",
    ]);
    expect(change.afterSelection).toEqual({ blockId: nextId, offset: 0 });
    expect(change.inverse.slice(-2)).toEqual([
      { kind: "removeChild", parentId: pageId, childId: nextId },
      { kind: "deleteBlock", id: nextId },
    ]);
  });

  test("removes a selected range while splitting", () => {
    const nextId = "00000000-0000-4000-8000-000000000003";
    const change = splitParagraph(
      document("before selected after"),
      paragraphId,
      7,
      newParagraph(nextId),
      15,
    );
    expect(change.after.blocks.slice(1).map(noteBlockText)).toEqual([
      "before ",
      " after",
    ]);
  });

  test("merges backward and recreates the removed paragraph for undo", () => {
    const secondId = "00000000-0000-4000-8000-000000000003";
    const chunk: NotesPageChunk = {
      rootId: pageId,
      blocks: [
        record(pageId, "page", "Plans", [paragraphId, secondId]),
        record(paragraphId, "paragraph", "first"),
        record(secondId, "paragraph", " second"),
      ],
    };
    const change = mergeParagraphBackward(chunk, secondId);
    expect(change).not.toBeNull();
    expect(change?.after.blocks.map((block) => block.id)).toEqual([
      pageId,
      paragraphId,
    ]);
    expect(noteBlockText(change!.after.blocks[1])).toBe("first second");
    expect(change?.afterSelection).toEqual({
      blockId: paragraphId,
      offset: 5,
    });
    expect(change?.inverse[1]).toMatchObject({
      kind: "createBlock",
      block: { id: secondId },
    });
  });

  test("removes a block style before merging backward", () => {
    const styledTypes: TextNoteBlockType[] = [
      "heading_1",
      "heading_2",
      "heading_3",
      "bulleted_list_item",
      "numbered_list_item",
      "to_do",
      "quote",
      "code",
    ];

    for (const type of styledTypes) {
      const chunk = document("styled text");
      chunk.blocks[1] = record(paragraphId, type, "styled text");
      chunk.blocks[1].properties.title = [
        { text: "styled", bold: true },
        { text: " text", italic: true },
      ];
      chunk.blocks[1].properties.checked = type === "to_do";

      const change = removeBlockStyleBackward(chunk, paragraphId);
      const normalized = change?.after.blocks[1];
      expect(normalized?.id).toBe(paragraphId);
      expect(normalized?.type).toBe("paragraph");
      expect(normalized?.properties.title).toEqual(
        chunk.blocks[1].properties.title,
      );
      expect(change?.afterSelection).toEqual({
        blockId: paragraphId,
        offset: 0,
      });
      expect(change?.inverse[0]).toEqual({
        kind: "changeType",
        id: paragraphId,
        type,
      });
    }

    expect(removeBlockStyleBackward(document(), paragraphId)).toBeNull();
  });

  test("moves nested children before merging away their list item", () => {
    const firstId = "00000000-0000-4000-8000-000000000003";
    const secondId = "00000000-0000-4000-8000-000000000004";
    const childId = "00000000-0000-4000-8000-000000000005";
    const chunk: NotesPageChunk = {
      rootId: pageId,
      blocks: [
        record(pageId, "page", "Plans", [firstId, secondId]),
        record(firstId, "bulleted_list_item", "first"),
        record(secondId, "bulleted_list_item", " second", [childId]),
        record(childId, "bulleted_list_item", "nested", [], secondId),
      ],
    };

    const change = mergeParagraphBackward(chunk, secondId);
    expect(change).not.toBeNull();
    expect(change?.after.blocks[0].content).toEqual([firstId]);
    expect(change?.after.blocks.find((block) => block.id === firstId)?.content)
      .toEqual([childId]);
    expect(change?.after.blocks.find((block) => block.id === childId)?.parentId)
      .toBe(firstId);
    expect(change?.forward[1]).toEqual({
      kind: "moveChild",
      childId,
      parentId: firstId,
      index: 0,
    });
    expect(change?.inverse.at(-1)).toEqual({
      kind: "moveChild",
      childId,
      parentId: secondId,
      index: 0,
    });
  });

  test("turns multiline plain text into ordered paragraph blocks", () => {
    const ids = [
      "00000000-0000-4000-8000-000000000003",
      "00000000-0000-4000-8000-000000000004",
    ];
    const change = pastePlainText(
      document("start finish"),
      paragraphId,
      6,
      6,
      "one\ntwo\nthree",
      ids.map((id) => newParagraph(id)),
    );
    expect(change.after.blocks[0].content).toEqual([paragraphId, ...ids]);
    expect(change.after.blocks.slice(1).map(noteBlockText)).toEqual([
      "start one",
      "two",
      "threefinish",
    ]);
    expect(change.afterSelection).toEqual({
      blockId: ids[1],
      offset: "threefinish".length,
    });
  });

  test("builds and reverses a 100-paragraph paste without reordering", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`);
    const ids = Array.from(
      { length: 99 },
      (_, index) =>
        `00000000-0000-4000-8${String(index).padStart(3, "0")}-000000000000`,
    );
    const change = pastePlainText(
      document(""),
      paragraphId,
      0,
      0,
      lines.join("\n"),
      ids.map((id) => newParagraph(id)),
    );
    const paragraphs = change.after.blocks.filter(
      (block) => block.type === "paragraph",
    );
    expect(paragraphs).toHaveLength(100);
    expect(paragraphs.map(noteBlockText)).toEqual(lines);
    expect(change.forward).toHaveLength(199);
    expect(change.inverse).toHaveLength(199);
  });

  test("suppresses structural shortcuts during IME composition", () => {
    expect(resolveParagraphKey({
      key: "Enter",
      composing: true,
      collapsed: true,
      start: 2,
      end: 2,
      textLength: 2,
    })).toBeNull();
    expect(resolveParagraphKey({
      key: "Backspace",
      composing: true,
      collapsed: true,
      start: 0,
      end: 0,
      textLength: 2,
    })).toBeNull();
  });

  test("resolves split, boundary movement, merge, undo, and redo", () => {
    const base = {
      composing: false,
      collapsed: true,
      start: 0,
      end: 0,
      textLength: 4,
    };
    expect(resolveParagraphKey({ ...base, key: "Enter" })).toBe("split");
    expect(resolveParagraphKey({ ...base, key: "Tab" })).toBe("indent");
    expect(resolveParagraphKey({ ...base, key: "Tab", shiftKey: true }))
      .toBe("outdent");
    expect(resolveParagraphKey({ ...base, key: "Backspace" }))
      .toBe("merge-backward");
    expect(resolveParagraphKey({ ...base, key: "ArrowUp" }))
      .toBe("move-previous");
    expect(resolveParagraphKey({
      ...base,
      key: "ArrowDown",
      start: 4,
      end: 4,
    })).toBe("move-next");
    expect(resolveParagraphKey({
      ...base,
      key: "z",
      primaryModifier: true,
    })).toBe("undo");
    expect(resolveParagraphKey({
      ...base,
      key: "z",
      primaryModifier: true,
      shiftKey: true,
    })).toBe("redo");
  });

  test("transforms Markdown block prefixes without replacing the block", () => {
    const source = document("## Calculation");
    source.blocks[1].properties.future = { preserved: true };
    source.blocks[1].content = ["nested"];
    const shortcut = matchMarkdownBlockShortcut("## Calculation", 3);
    expect(shortcut).toEqual({ marker: "## ", type: "heading_2" });
    const change = applyMarkdownBlockShortcut(
      source,
      paragraphId,
      shortcut!,
      3,
    );
    const transformed = change.after.blocks[1];
    expect(transformed.id).toBe(paragraphId);
    expect(transformed.type).toBe("heading_2");
    expect(noteBlockText(transformed)).toBe("Calculation");
    expect(transformed.content).toEqual(["nested"]);
    expect(transformed.properties.future).toEqual({ preserved: true });
    expect(change.afterSelection).toEqual({ blockId: paragraphId, offset: 0 });
    expect(matchMarkdownBlockShortcut("Move ## here", 8)).toBeNull();
    expect(matchMarkdownBlockShortcut("## Calculation", 14)).toBeNull();
  });

  test("turns a divider shortcut into a divider plus editable continuation", () => {
    const continuationId = "00000000-0000-4000-8000-000000000003";
    const source = document("---");
    const shortcut = matchMarkdownBlockShortcut("---", 3);
    expect(shortcut).toEqual({ marker: "---", type: "divider" });

    const change = transformToDivider(
      source,
      paragraphId,
      newParagraph(continuationId),
      3,
    );
    expect(change.after.blocks[0].content).toEqual([
      paragraphId,
      continuationId,
    ]);
    expect(change.after.blocks[1].type).toBe("divider");
    expect(change.afterSelection).toEqual({
      blockId: continuationId,
      offset: 0,
    });

    const removed = removeDividerBackward(change.after, continuationId);
    expect(removed).not.toBeNull();
    expect(removed?.after.blocks[0].content).toEqual([continuationId]);
    expect(removed?.after.blocks.some((block) => block.type === "divider"))
      .toBeFalse();
  });

  test("turns the active block into a stable nested page with a first paragraph", () => {
    const pageParagraphId = "00000000-0000-4000-8000-000000000003";
    const existingChildId = "00000000-0000-4000-8000-000000000004";
    const source = document("/page");
    source.blocks[1].properties.future = { preserved: true };
    source.blocks[1].content = [existingChildId];
    source.blocks.push(
      record(existingChildId, "paragraph", "kept", [], paragraphId),
    );
    const change = transformTextBlockToPage(
      source,
      paragraphId,
      newParagraph(pageParagraphId),
      [],
      5,
    );
    const nestedPage = change.after.blocks[1];
    expect(nestedPage.id).toBe(paragraphId);
    expect(nestedPage.type).toBe("page");
    expect(noteBlockText(nestedPage)).toBe("Untitled");
    expect(nestedPage.properties.future).toEqual({ preserved: true });
    expect(nestedPage.content).toEqual([existingChildId, pageParagraphId]);
    expect(change.after.blocks.at(-1)?.parentId).toBe(paragraphId);
    expect(change.afterSelection).toEqual({
      blockId: pageParagraphId,
      offset: 0,
    });
    expect(change.inverse[2]).toEqual({
      kind: "changeType",
      id: paragraphId,
      type: "paragraph",
    });
  });

  test("parses the supported inline Markdown marks into rich-text runs", () => {
    const parsed = parseInlineMarkdown(
      "Use **plans**, *tempo*, `c4`, and [study](https://example.com).",
    );
    expect(parsed.changed).toBeTrue();
    expect(parsed.text).toBe("Use plans, tempo, c4, and study.");
    expect(parsed.runs).toContainEqual({ text: "plans", bold: true });
    expect(parsed.runs).toContainEqual({ text: "tempo", italic: true });
    expect(parsed.runs).toContainEqual({ text: "c4", code: true });
    expect(parsed.runs).toContainEqual({
      text: "study",
      link: "https://example.com",
    });
  });

  test("preserves rich-text runs across split and merge", () => {
    const nextId = "00000000-0000-4000-8000-000000000003";
    const source = document("");
    source.blocks[1].properties.title = [
      { text: "plans", bold: true, futureMark: "kept" },
      { text: " and tempo", italic: true },
    ];
    const split = splitParagraph(
      source,
      paragraphId,
      3,
      newParagraph(nextId),
    );
    expect(split.after.blocks[1].properties.title).toEqual([
      { text: "pla", bold: true, futureMark: "kept" },
    ]);
    expect(split.after.blocks[2].properties.title).toEqual([
      { text: "ns", bold: true, futureMark: "kept" },
      { text: " and tempo", italic: true },
    ]);

    const merged = mergeParagraphBackward(split.after, nextId);
    expect(merged?.after.blocks[1].properties.title).toEqual(
      source.blocks[1].properties.title,
    );
  });

  test("preserves surrounding marks during multiline plain-text paste", () => {
    const nextId = "00000000-0000-4000-8000-000000000003";
    const source = document("");
    source.blocks[1].properties.title = [
      { text: "plans", bold: true },
      { text: "tempo", italic: true },
    ];
    const change = pastePlainText(
      source,
      paragraphId,
      5,
      5,
      " one\ntwo ",
      [newParagraph(nextId)],
    );
    expect(change.after.blocks[1].properties.title).toEqual([
      { text: "plans", bold: true },
      { text: " one" },
    ]);
    expect(change.after.blocks[2].properties.title).toEqual([
      { text: "two " },
      { text: "tempo", italic: true },
    ]);
  });

  test("indents and outdents list blocks with reversible move operations", () => {
    const firstId = "00000000-0000-4000-8000-000000000003";
    const secondId = "00000000-0000-4000-8000-000000000004";
    const chunk: NotesPageChunk = {
      rootId: pageId,
      blocks: [
        record(pageId, "page", "List", [firstId, secondId]),
        record(firstId, "bulleted_list_item", "first"),
        record(secondId, "bulleted_list_item", "second"),
      ],
    };
    const indented = indentListItem(chunk, secondId, 3);
    expect(indented).not.toBeNull();
    expect(indented?.after.blocks[0].content).toEqual([firstId]);
    expect(indented?.after.blocks[1].content).toEqual([secondId]);
    expect(indented?.forward).toEqual([{
      kind: "moveChild",
      childId: secondId,
      parentId: firstId,
      index: 0,
    }]);

    const outdented = outdentListItem(indented!.after, secondId, 3);
    expect(outdented).not.toBeNull();
    expect(outdented?.after.blocks[0].content).toEqual([firstId, secondId]);
    expect(outdented?.after.blocks[1].content).toEqual([]);
  });
});
