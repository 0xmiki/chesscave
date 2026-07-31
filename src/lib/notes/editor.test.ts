import { describe, expect, test } from "bun:test";
import {
  insertParagraph,
  mergeParagraphBackward,
  noteBlockText,
  pastePlainText,
  replaceParagraphText,
  resolveParagraphKey,
  splitParagraph,
  trailingParagraph,
} from "./editor";
import type {
  NewNoteBlock,
  NoteBlockRecord,
  NotesPageChunk,
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
  type: "page" | "paragraph",
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
});
