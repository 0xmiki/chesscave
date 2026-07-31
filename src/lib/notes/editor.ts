import type {
  NewNoteBlock,
  NoteBlockProperties,
  NoteBlockRecord,
  NoteOperation,
  NotesPageChunk,
} from "./types";

export interface EditorSelection {
  blockId: string;
  offset: number;
}

export interface EditorChange {
  label: "typing" | "insert" | "split" | "merge" | "paste";
  before: NotesPageChunk;
  after: NotesPageChunk;
  forward: NoteOperation[];
  inverse: NoteOperation[];
  beforeSelection: EditorSelection;
  afterSelection: EditorSelection;
}

export type ParagraphKeyAction =
  | "split"
  | "merge-backward"
  | "move-previous"
  | "move-next"
  | "undo"
  | "redo";

export interface ParagraphKeyContext {
  key: string;
  composing: boolean;
  collapsed: boolean;
  start: number;
  end: number;
  textLength: number;
  shiftKey?: boolean;
  primaryModifier?: boolean;
}

export function resolveParagraphKey(
  context: ParagraphKeyContext,
): ParagraphKeyAction | null {
  if (context.composing) return null;
  const key = context.key.toLowerCase();
  if (context.primaryModifier && key === "z") {
    return context.shiftKey ? "redo" : "undo";
  }
  if (context.primaryModifier && key === "y") return "redo";
  if (context.key === "Enter" && !context.shiftKey) return "split";
  if (
    context.key === "Backspace" &&
    context.collapsed &&
    context.start === 0
  ) {
    return "merge-backward";
  }
  if (
    context.key === "ArrowUp" &&
    context.collapsed &&
    context.start === 0
  ) {
    return "move-previous";
  }
  if (
    context.key === "ArrowDown" &&
    context.collapsed &&
    context.end === context.textLength
  ) {
    return "move-next";
  }
  return null;
}

export function noteBlockText(block: NoteBlockRecord): string {
  return block.properties.title.map((run) => run.text).join("");
}

export function textProperties(
  source: NoteBlockProperties,
  text: string,
): NoteBlockProperties {
  return {
    ...source,
    title: text ? [{ text }] : [],
  };
}

export function replaceParagraphText(
  chunk: NotesPageChunk,
  blockId: string,
  text: string,
  beforeOffset = noteBlockText(requireParagraph(chunk, blockId)).length,
  afterOffset = text.length,
): EditorChange {
  const block = requireParagraph(chunk, blockId);
  const previousText = noteBlockText(block);
  const after = replaceBlocks(chunk, [
    {
      ...block,
      properties: textProperties(block.properties, text),
    },
  ]);
  return {
    label: "typing",
    before: chunk,
    after,
    forward: [updateTextOperation(block, text)],
    inverse: [updateTextOperation(block, previousText)],
    beforeSelection: {
      blockId,
      offset: clampOffset(beforeOffset, previousText),
    },
    afterSelection: { blockId, offset: clampOffset(afterOffset, text) },
  };
}

export function trailingParagraph(
  chunk: NotesPageChunk,
): NoteBlockRecord | null {
  const page = requirePage(chunk);
  const lastId = page.content.at(-1);
  if (!lastId) return null;
  return chunk.blocks.find(
    (block) => block.id === lastId && block.type === "paragraph",
  ) ?? null;
}

export function insertParagraph(
  chunk: NotesPageChunk,
  index: number,
  newBlock: NewNoteBlock,
): EditorChange {
  const page = requirePage(chunk);
  if (newBlock.type !== "paragraph") {
    throw new Error("Only a paragraph can be inserted into the writing flow.");
  }
  if (index < 0 || index > page.content.length) {
    throw new Error(
      `Paragraph index ${index} is outside page ${page.id}.`,
    );
  }
  const created = recordFromNewBlock(newBlock, page.id);
  const nextPage = {
    ...page,
    content: page.content.toSpliced(index, 0, created.id),
  };
  const previousParagraph = page.content
    .slice(0, index)
    .toReversed()
    .map((id) => chunk.blocks.find((block) => block.id === id))
    .find((block) => block?.type === "paragraph");
  const beforeSelection = previousParagraph
    ? {
        blockId: previousParagraph.id,
        offset: noteBlockText(previousParagraph).length,
      }
    : { blockId: created.id, offset: 0 };

  return {
    label: "insert",
    before: chunk,
    after: replaceBlocks(chunk, [nextPage], [created]),
    forward: [
      { kind: "createBlock", block: newBlock },
      {
        kind: "insertChild",
        parentId: page.id,
        childId: created.id,
        index,
      },
    ],
    inverse: [
      { kind: "removeChild", parentId: page.id, childId: created.id },
      { kind: "deleteBlock", id: created.id },
    ],
    beforeSelection,
    afterSelection: { blockId: created.id, offset: 0 },
  };
}

export function splitParagraph(
  chunk: NotesPageChunk,
  blockId: string,
  start: number,
  newBlock: NewNoteBlock,
  end = start,
): EditorChange {
  const { page, block, index } = paragraphContext(chunk, blockId);
  const text = noteBlockText(block);
  const from = clampOffset(Math.min(start, end), text);
  const to = clampOffset(Math.max(start, end), text);
  const beforeText = text.slice(0, from);
  const afterText = text.slice(to);
  const created = recordFromNewBlock(newBlock, page.id);
  const nextCreated = {
    ...created,
    properties: textProperties(created.properties, afterText),
  };
  const nextPage = {
    ...page,
    content: page.content.toSpliced(index + 1, 0, created.id),
  };
  const nextBlock = {
    ...block,
    properties: textProperties(block.properties, beforeText),
  };
  const after = replaceBlocks(chunk, [nextPage, nextBlock], [nextCreated]);

  return {
    label: "split",
    before: chunk,
    after,
    forward: [
      updateTextOperation(block, beforeText),
      {
        kind: "createBlock",
        block: {
          ...newBlock,
          properties: textProperties(newBlock.properties, afterText),
        },
      },
      {
        kind: "insertChild",
        parentId: page.id,
        childId: created.id,
        index: index + 1,
      },
    ],
    inverse: [
      updateTextOperation(block, text),
      { kind: "removeChild", parentId: page.id, childId: created.id },
      { kind: "deleteBlock", id: created.id },
    ],
    beforeSelection: { blockId, offset: from },
    afterSelection: { blockId: created.id, offset: 0 },
  };
}

export function mergeParagraphBackward(
  chunk: NotesPageChunk,
  blockId: string,
): EditorChange | null {
  const { page, block, index } = paragraphContext(chunk, blockId);
  if (index === 0) return null;
  const previousId = page.content[index - 1];
  const previous = chunk.blocks.find((candidate) =>
    candidate.id === previousId && candidate.type === "paragraph"
  );
  if (!previous) return null;

  const previousText = noteBlockText(previous);
  const currentText = noteBlockText(block);
  const mergedText = previousText + currentText;
  const nextPrevious = {
    ...previous,
    properties: textProperties(previous.properties, mergedText),
  };
  const nextPage = {
    ...page,
    content: page.content.filter((id) => id !== block.id),
  };
  const replaced = replaceBlocks(chunk, [nextPage, nextPrevious]);
  const after = {
    ...replaced,
    blocks: replaced.blocks.filter(
      (candidate) => candidate.id !== block.id,
    ),
  };

  return {
    label: "merge",
    before: chunk,
    after,
    forward: [
      updateTextOperation(previous, mergedText),
      { kind: "removeChild", parentId: page.id, childId: block.id },
      { kind: "deleteBlock", id: block.id },
    ],
    inverse: [
      updateTextOperation(previous, previousText),
      {
        kind: "createBlock",
        block: {
          id: block.id,
          type: "paragraph",
          properties: block.properties,
        },
      },
      {
        kind: "insertChild",
        parentId: page.id,
        childId: block.id,
        index,
      },
    ],
    beforeSelection: { blockId, offset: 0 },
    afterSelection: { blockId: previous.id, offset: previousText.length },
  };
}

export function pastePlainText(
  chunk: NotesPageChunk,
  blockId: string,
  start: number,
  end: number,
  text: string,
  newBlocks: NewNoteBlock[],
): EditorChange {
  const { page, block, index } = paragraphContext(chunk, blockId);
  const original = noteBlockText(block);
  const from = clampOffset(Math.min(start, end), original);
  const to = clampOffset(Math.max(start, end), original);
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const requiredBlocks = Math.max(0, lines.length - 1);
  if (newBlocks.length !== requiredBlocks) {
    throw new Error(
      `Multiline paste needs ${requiredBlocks} new paragraph IDs, received ${newBlocks.length}.`,
    );
  }

  if (lines.length === 1) {
    const nextText = original.slice(0, from) + lines[0] + original.slice(to);
    const change = replaceParagraphText(
      chunk,
      blockId,
      nextText,
      from,
      from + lines[0].length,
    );
    return { ...change, label: "paste" };
  }

  const prefix = original.slice(0, from);
  const suffix = original.slice(to);
  const firstText = prefix + lines[0];
  const inserted = newBlocks.map((candidate, lineIndex) => {
    const isLast = lineIndex === newBlocks.length - 1;
    const line = lines[lineIndex + 1] + (isLast ? suffix : "");
    return {
      record: {
        ...recordFromNewBlock(candidate, page.id),
        properties: textProperties(candidate.properties, line),
      },
      block: {
        ...candidate,
        properties: textProperties(candidate.properties, line),
      },
    };
  });
  const nextPage = {
    ...page,
    content: page.content.toSpliced(
      index + 1,
      0,
      ...inserted.map(({ record }) => record.id),
    ),
  };
  const nextBlock = {
    ...block,
    properties: textProperties(block.properties, firstText),
  };
  const after = replaceBlocks(
    chunk,
    [nextPage, nextBlock],
    inserted.map(({ record }) => record),
  );
  const last = inserted.at(-1)?.record;
  if (!last) throw new Error("Multiline paste did not create a final block.");
  const lastText = noteBlockText(last);

  return {
    label: "paste",
    before: chunk,
    after,
    forward: [
      updateTextOperation(block, firstText),
      ...inserted.flatMap(({ block: candidate }, insertedIndex) => [
        { kind: "createBlock", block: candidate } satisfies NoteOperation,
        {
          kind: "insertChild",
          parentId: page.id,
          childId: candidate.id,
          index: index + insertedIndex + 1,
        } satisfies NoteOperation,
      ]),
    ],
    inverse: [
      updateTextOperation(block, original),
      ...inserted.flatMap(({ record }) => [
        {
          kind: "removeChild",
          parentId: page.id,
          childId: record.id,
        } satisfies NoteOperation,
        { kind: "deleteBlock", id: record.id } satisfies NoteOperation,
      ]),
    ],
    beforeSelection: { blockId, offset: from },
    afterSelection: { blockId: last.id, offset: lastText.length },
  };
}

function paragraphContext(chunk: NotesPageChunk, blockId: string) {
  const page = requirePage(chunk);
  const block = requireParagraph(chunk, blockId);
  const index = page.content.indexOf(blockId);
  if (index < 0 || block.parentId !== page.id) {
    throw new Error(`Paragraph ${blockId} does not belong to page ${page.id}.`);
  }
  return { page, block, index };
}

function requirePage(chunk: NotesPageChunk): NoteBlockRecord {
  const page = chunk.blocks.find((block) => block.id === chunk.rootId);
  if (!page || page.type !== "page") {
    throw new Error(`Notes page ${chunk.rootId} is missing from its document.`);
  }
  return page;
}

function requireParagraph(
  chunk: NotesPageChunk,
  blockId: string,
): NoteBlockRecord {
  const block = chunk.blocks.find((candidate) => candidate.id === blockId);
  if (!block || block.type !== "paragraph") {
    throw new Error(`Paragraph ${blockId} is missing from the document.`);
  }
  return block;
}

function updateTextOperation(
  block: NoteBlockRecord,
  text: string,
): NoteOperation {
  return {
    kind: "updateProperties",
    id: block.id,
    properties: textProperties(block.properties, text),
  };
}

function recordFromNewBlock(
  block: NewNoteBlock,
  parentId: string,
): NoteBlockRecord {
  return {
    ...block,
    content: [],
    parentId,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

function replaceBlocks(
  chunk: NotesPageChunk,
  replacements: NoteBlockRecord[],
  additions: NoteBlockRecord[] = [],
): NotesPageChunk {
  const byId = new Map(replacements.map((block) => [block.id, block]));
  return {
    ...chunk,
    blocks: [
      ...chunk.blocks.map((block) => byId.get(block.id) ?? block),
      ...additions,
    ],
  };
}

function clampOffset(offset: number, text: string): number {
  return Math.max(0, Math.min(Math.trunc(offset), text.length));
}
