import type {
  NewNoteBlock,
  NoteBlockProperties,
  NoteBlockRecord,
  NoteOperation,
  NotesPageChunk,
  RichTextRun,
} from "./types";
import {
  isListNoteBlockType,
  isTextNoteBlockType,
  type SupportedNoteBlockType,
  type TextNoteBlockType,
} from "./types";

export interface EditorSelection {
  blockId: string;
  offset: number;
}

export interface EditorChange {
  label:
    | "typing"
    | "insert"
    | "split"
    | "merge"
    | "paste"
    | "transform"
    | "format"
    | "indent"
    | "outdent"
    | "check";
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
  | "indent"
  | "outdent"
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
  if (context.key === "Tab" && !context.primaryModifier) {
    return context.shiftKey ? "outdent" : "indent";
  }
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

export function richTextProperties(
  source: NoteBlockProperties,
  runs: RichTextRun[],
): NoteBlockProperties {
  return { ...source, title: normalizeRuns(runs) };
}

export interface MarkdownBlockShortcut {
  marker: string;
  type: Exclude<SupportedNoteBlockType, "page">;
  checked?: boolean;
}

const markdownBlockShortcuts: MarkdownBlockShortcut[] = [
  { marker: "### ", type: "heading_3" },
  { marker: "## ", type: "heading_2" },
  { marker: "# ", type: "heading_1" },
  { marker: "- ", type: "bulleted_list_item" },
  { marker: "* ", type: "bulleted_list_item" },
  { marker: "1. ", type: "numbered_list_item" },
  { marker: "[ ] ", type: "to_do", checked: false },
  { marker: "[] ", type: "to_do", checked: false },
  { marker: "[x] ", type: "to_do", checked: true },
  { marker: "> ", type: "quote" },
  { marker: "```", type: "code" },
  { marker: "---", type: "divider" },
];

export function matchMarkdownBlockShortcut(
  text: string,
  caretOffset: number,
): MarkdownBlockShortcut | null {
  return markdownBlockShortcuts.find(
    (shortcut) =>
      text.startsWith(shortcut.marker) &&
      caretOffset === shortcut.marker.length,
  ) ?? null;
}

export function transformTextBlock(
  chunk: NotesPageChunk,
  blockId: string,
  type: SupportedNoteBlockType,
  content: string | RichTextRun[],
  beforeOffset: number,
  afterOffset: number,
  propertyPatch: Record<string, unknown> = {},
): EditorChange {
  const block = requireTextBlock(chunk, blockId);
  if (type === "page") {
    throw new Error("A writing block cannot be transformed into a page.");
  }
  const runs = typeof content === "string"
    ? content === noteBlockText(block)
      ? block.properties.title
      : plainTextRuns(content)
    : content;
  const text = runs.map((run) => run.text).join("");
  const properties = {
    ...richTextProperties(block.properties, runs),
    ...propertyPatch,
  };
  const next = { ...block, type, properties };
  return {
    label: "transform",
    before: chunk,
    after: replaceBlocks(chunk, [next]),
    forward: [
      { kind: "changeType", id: block.id, type },
      { kind: "updateProperties", id: block.id, properties },
    ],
    inverse: [
      { kind: "changeType", id: block.id, type: block.type as SupportedNoteBlockType },
      {
        kind: "updateProperties",
        id: block.id,
        properties: block.properties,
      },
    ],
    beforeSelection: {
      blockId,
      offset: clampOffset(beforeOffset, noteBlockText(block)),
    },
    afterSelection: { blockId, offset: clampOffset(afterOffset, text) },
  };
}

export function applyMarkdownBlockShortcut(
  chunk: NotesPageChunk,
  blockId: string,
  shortcut: MarkdownBlockShortcut,
  caretOffset: number,
): EditorChange {
  if (shortcut.type === "divider") {
    throw new Error("A divider shortcut needs a following paragraph block.");
  }
  const block = requireTextBlock(chunk, blockId);
  const text = noteBlockText(block);
  const nextRuns = sliceRichTextRuns(
    block.properties.title,
    shortcut.marker.length,
    text.length,
  );
  return transformTextBlock(
    chunk,
    blockId,
    shortcut.type,
    nextRuns,
    caretOffset,
    Math.max(0, caretOffset - shortcut.marker.length),
    shortcut.type === "to_do"
      ? { checked: shortcut.checked ?? false }
      : {},
  );
}

export function transformToDivider(
  chunk: NotesPageChunk,
  blockId: string,
  newBlock: NewNoteBlock,
  beforeOffset: number,
): EditorChange {
  const { page, block, index } = textBlockContext(chunk, blockId);
  if (newBlock.type !== "paragraph") {
    throw new Error("A divider must be followed by a paragraph block.");
  }
  const created = recordFromNewBlock(newBlock, page.id);
  const dividerProperties = textProperties(block.properties, "");
  const divider = {
    ...block,
    type: "divider" as const,
    properties: dividerProperties,
  };
  const nextPage = {
    ...page,
    content: page.content.toSpliced(index + 1, 0, created.id),
  };
  return {
    label: "transform",
    before: chunk,
    after: replaceBlocks(chunk, [nextPage, divider], [created]),
    forward: [
      { kind: "changeType", id: block.id, type: "divider" },
      {
        kind: "updateProperties",
        id: block.id,
        properties: dividerProperties,
      },
      { kind: "createBlock", block: newBlock },
      {
        kind: "insertChild",
        parentId: page.id,
        childId: created.id,
        index: index + 1,
      },
    ],
    inverse: [
      { kind: "removeChild", parentId: page.id, childId: created.id },
      { kind: "deleteBlock", id: created.id },
      {
        kind: "changeType",
        id: block.id,
        type: block.type as TextNoteBlockType,
      },
      {
        kind: "updateProperties",
        id: block.id,
        properties: block.properties,
      },
    ],
    beforeSelection: { blockId, offset: beforeOffset },
    afterSelection: { blockId: created.id, offset: 0 },
  };
}

export interface ParsedInlineMarkdown {
  changed: boolean;
  runs: RichTextRun[];
  text: string;
  offset: number;
}

export function parseInlineMarkdown(
  source: string,
  caretOffset = source.length,
): ParsedInlineMarkdown {
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g;
  const runs: RichTextRun[] = [];
  let cursor = 0;
  let outputLength = 0;
  let mappedOffset = Math.min(caretOffset, source.length);
  let changed = false;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      const plain = source.slice(cursor, index);
      runs.push({ text: plain });
      outputLength += plain.length;
    }
    const full = match[0];
    const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? "";
    const run: RichTextRun = { text: value };
    if (match[1] !== undefined) run.bold = true;
    else if (match[2] !== undefined) run.italic = true;
    else if (match[3] !== undefined) run.code = true;
    else if (match[4] !== undefined) run.link = match[5];
    runs.push(run);
    if (caretOffset >= index + full.length) {
      mappedOffset -= full.length - value.length;
    } else if (caretOffset > index) {
      mappedOffset = outputLength + Math.min(value.length, caretOffset - index);
    }
    outputLength += value.length;
    cursor = index + full.length;
    changed = true;
  }

  if (cursor < source.length) runs.push({ text: source.slice(cursor) });
  if (!runs.length && source) runs.push({ text: source });
  const normalized = normalizeRuns(runs);
  const text = normalized.map((run) => run.text).join("");
  return {
    changed,
    runs: normalized,
    text,
    offset: clampOffset(mappedOffset, text),
  };
}

export function replaceBlockRuns(
  chunk: NotesPageChunk,
  blockId: string,
  runs: RichTextRun[],
  beforeOffset: number,
  afterOffset: number,
): EditorChange {
  const block = requireTextBlock(chunk, blockId);
  const properties = richTextProperties(block.properties, runs);
  const next = { ...block, properties };
  return {
    label: "format",
    before: chunk,
    after: replaceBlocks(chunk, [next]),
    forward: [{ kind: "updateProperties", id: block.id, properties }],
    inverse: [{
      kind: "updateProperties",
      id: block.id,
      properties: block.properties,
    }],
    beforeSelection: {
      blockId,
      offset: clampOffset(beforeOffset, noteBlockText(block)),
    },
    afterSelection: {
      blockId,
      offset: clampOffset(afterOffset, properties.title.map((run) => run.text).join("")),
    },
  };
}

export function continuationBlockType(type: NoteBlockRecord["type"]): TextNoteBlockType {
  if (isListNoteBlockType(type)) return type as TextNoteBlockType;
  if (type === "quote") return "quote";
  if (type === "code") return "code";
  return "paragraph";
}

export function replaceParagraphText(
  chunk: NotesPageChunk,
  blockId: string,
  text: string,
  beforeOffset = noteBlockText(requireTextBlock(chunk, blockId)).length,
  afterOffset = text.length,
): EditorChange {
  const block = requireTextBlock(chunk, blockId);
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
  const { page, block, index } = textBlockContext(chunk, blockId);
  if (!isTextNoteBlockType(newBlock.type)) {
    throw new Error("A text block can only split into another text block.");
  }
  const text = noteBlockText(block);
  const from = clampOffset(Math.min(start, end), text);
  const to = clampOffset(Math.max(start, end), text);
  const beforeRuns = sliceRichTextRuns(block.properties.title, 0, from);
  const afterRuns = sliceRichTextRuns(
    block.properties.title,
    to,
    text.length,
  );
  const created = recordFromNewBlock(newBlock, page.id);
  const nextCreated = {
    ...created,
    properties: richTextProperties(created.properties, afterRuns),
  };
  const nextPage = {
    ...page,
    content: page.content.toSpliced(index + 1, 0, created.id),
  };
  const nextBlock = {
    ...block,
    properties: richTextProperties(block.properties, beforeRuns),
  };
  const after = replaceBlocks(chunk, [nextPage, nextBlock], [nextCreated]);

  return {
    label: "split",
    before: chunk,
    after,
    forward: [
      updateRunsOperation(block, beforeRuns),
      {
        kind: "createBlock",
        block: {
          ...newBlock,
          properties: richTextProperties(newBlock.properties, afterRuns),
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
      updateRunsOperation(block, block.properties.title),
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
  const { page, block, index } = textBlockContext(chunk, blockId);
  if (index === 0) return null;
  const previousId = page.content[index - 1];
  const previous = chunk.blocks.find((candidate) =>
    candidate.id === previousId && isTextNoteBlockType(candidate.type)
  );
  if (!previous) return null;

  const previousText = noteBlockText(previous);
  const mergedRuns = normalizeRuns([
    ...previous.properties.title,
    ...block.properties.title,
  ]);
  const nextPrevious = {
    ...previous,
    properties: richTextProperties(previous.properties, mergedRuns),
    content: [...previous.content, ...block.content],
  };
  const movedChildren = block.content.map((childId) => ({
    ...requireBlock(chunk, childId),
    parentId: previous.id,
  }));
  const nextPage = {
    ...page,
    content: page.content.filter((id) => id !== block.id),
  };
  const replaced = replaceBlocks(chunk, [
    nextPage,
    nextPrevious,
    ...movedChildren,
  ]);
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
      updateRunsOperation(previous, mergedRuns),
      ...block.content.map((childId, childIndex) => ({
        kind: "moveChild" as const,
        childId,
        parentId: previous.id,
        index: previous.content.length + childIndex,
      })),
      { kind: "removeChild", parentId: page.id, childId: block.id },
      { kind: "deleteBlock", id: block.id },
    ],
    inverse: [
      updateRunsOperation(previous, previous.properties.title),
      {
        kind: "createBlock",
        block: {
          id: block.id,
          type: block.type as TextNoteBlockType,
          properties: block.properties,
        },
      },
      {
        kind: "insertChild",
        parentId: page.id,
        childId: block.id,
        index,
      },
      ...block.content.map((childId, childIndex) => ({
        kind: "moveChild" as const,
        childId,
        parentId: block.id,
        index: childIndex,
      })),
    ],
    beforeSelection: { blockId, offset: 0 },
    afterSelection: { blockId: previous.id, offset: previousText.length },
  };
}

export function removeDividerBackward(
  chunk: NotesPageChunk,
  blockId: string,
): EditorChange | null {
  const { page, block, index } = textBlockContext(chunk, blockId);
  if (index === 0 || noteBlockText(block)) return null;
  const dividerId = page.content[index - 1];
  const divider = chunk.blocks.find((candidate) =>
    candidate.id === dividerId && candidate.type === "divider"
  );
  if (!divider || divider.content.length) return null;
  const nextPage = {
    ...page,
    content: page.content.filter((id) => id !== divider.id),
  };
  const replaced = replaceBlocks(chunk, [nextPage]);
  const after = {
    ...replaced,
    blocks: replaced.blocks.filter(
      (candidate) => candidate.id !== divider.id,
    ),
  };
  return {
    label: "merge",
    before: chunk,
    after,
    forward: [
      { kind: "removeChild", parentId: page.id, childId: divider.id },
      { kind: "deleteBlock", id: divider.id },
    ],
    inverse: [
      {
        kind: "createBlock",
        block: {
          id: divider.id,
          type: "divider",
          properties: divider.properties,
        },
      },
      {
        kind: "insertChild",
        parentId: page.id,
        childId: divider.id,
        index: index - 1,
      },
    ],
    beforeSelection: { blockId, offset: 0 },
    afterSelection: { blockId, offset: 0 },
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
  const { page, block, index } = textBlockContext(chunk, blockId);
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
    const nextRuns = normalizeRuns([
      ...sliceRichTextRuns(block.properties.title, 0, from),
      ...plainTextRuns(lines[0]),
      ...sliceRichTextRuns(block.properties.title, to, original.length),
    ]);
    const change = replaceBlockRuns(
      chunk,
      blockId,
      nextRuns,
      from,
      from + lines[0].length,
    );
    return { ...change, label: "paste" };
  }

  const prefixRuns = sliceRichTextRuns(block.properties.title, 0, from);
  const suffixRuns = sliceRichTextRuns(
    block.properties.title,
    to,
    original.length,
  );
  const firstRuns = normalizeRuns([
    ...prefixRuns,
    ...plainTextRuns(lines[0]),
  ]);
  const inserted = newBlocks.map((candidate, lineIndex) => {
    const isLast = lineIndex === newBlocks.length - 1;
    const lineRuns = normalizeRuns([
      ...plainTextRuns(lines[lineIndex + 1]),
      ...(isLast ? suffixRuns : []),
    ]);
    return {
      record: {
        ...recordFromNewBlock(candidate, page.id),
        properties: richTextProperties(candidate.properties, lineRuns),
      },
      block: {
        ...candidate,
        properties: richTextProperties(candidate.properties, lineRuns),
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
    properties: richTextProperties(block.properties, firstRuns),
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
      updateRunsOperation(block, firstRuns),
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
      updateRunsOperation(block, block.properties.title),
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

export function indentListItem(
  chunk: NotesPageChunk,
  blockId: string,
  offset: number,
): EditorChange | null {
  const block = requireTextBlock(chunk, blockId);
  if (!isListNoteBlockType(block.type) || !block.parentId) return null;
  const parent = requireBlock(chunk, block.parentId);
  const index = parent.content.indexOf(block.id);
  if (index <= 0) return null;
  const previous = requireBlock(chunk, parent.content[index - 1]);
  if (!isListNoteBlockType(previous.type)) return null;
  return moveListItem(
    chunk,
    block,
    parent,
    index,
    previous,
    previous.content.length,
    "indent",
    offset,
  );
}

export function outdentListItem(
  chunk: NotesPageChunk,
  blockId: string,
  offset: number,
): EditorChange | null {
  const block = requireTextBlock(chunk, blockId);
  if (!isListNoteBlockType(block.type) || !block.parentId) return null;
  const parent = requireBlock(chunk, block.parentId);
  if (!isListNoteBlockType(parent.type) || !parent.parentId) return null;
  const grandparent = requireBlock(chunk, parent.parentId);
  const parentIndex = grandparent.content.indexOf(parent.id);
  const index = parent.content.indexOf(block.id);
  if (parentIndex < 0 || index < 0) return null;
  return moveListItem(
    chunk,
    block,
    parent,
    index,
    grandparent,
    parentIndex + 1,
    "outdent",
    offset,
  );
}

export function toggleTodo(
  chunk: NotesPageChunk,
  blockId: string,
  offset = 0,
): EditorChange {
  const block = requireTextBlock(chunk, blockId);
  if (block.type !== "to_do") throw new Error(`Block ${blockId} is not a to-do.`);
  const properties = {
    ...block.properties,
    checked: block.properties.checked !== true,
  };
  return {
    label: "check",
    before: chunk,
    after: replaceBlocks(chunk, [{ ...block, properties }]),
    forward: [{ kind: "updateProperties", id: block.id, properties }],
    inverse: [{
      kind: "updateProperties",
      id: block.id,
      properties: block.properties,
    }],
    beforeSelection: { blockId, offset },
    afterSelection: { blockId, offset },
  };
}

function moveListItem(
  chunk: NotesPageChunk,
  block: NoteBlockRecord,
  oldParent: NoteBlockRecord,
  oldIndex: number,
  newParent: NoteBlockRecord,
  newIndex: number,
  label: "indent" | "outdent",
  offset: number,
): EditorChange {
  const nextOldParent = {
    ...oldParent,
    content: oldParent.content.filter((id) => id !== block.id),
  };
  const nextNewParent = {
    ...newParent,
    content: newParent.content.toSpliced(newIndex, 0, block.id),
  };
  const nextBlock = { ...block, parentId: newParent.id };
  return {
    label,
    before: chunk,
    after: replaceBlocks(chunk, [nextOldParent, nextNewParent, nextBlock]),
    forward: [{
      kind: "moveChild",
      childId: block.id,
      parentId: newParent.id,
      index: newIndex,
    }],
    inverse: [{
      kind: "moveChild",
      childId: block.id,
      parentId: oldParent.id,
      index: oldIndex,
    }],
    beforeSelection: { blockId: block.id, offset },
    afterSelection: { blockId: block.id, offset },
  };
}

function textBlockContext(chunk: NotesPageChunk, blockId: string) {
  const block = requireTextBlock(chunk, blockId);
  if (!block.parentId) {
    throw new Error(`Text block ${blockId} has no document parent.`);
  }
  const page = requireBlock(chunk, block.parentId);
  const index = page.content.indexOf(blockId);
  if (index < 0 || block.parentId !== page.id) {
    throw new Error(`Text block ${blockId} does not belong to page ${page.id}.`);
  }
  return { page, block, index };
}

function requireBlock(chunk: NotesPageChunk, blockId: string): NoteBlockRecord {
  const block = chunk.blocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new Error(`Block ${blockId} is missing from the document.`);
  return block;
}

function requirePage(chunk: NotesPageChunk): NoteBlockRecord {
  const page = chunk.blocks.find((block) => block.id === chunk.rootId);
  if (!page || page.type !== "page") {
    throw new Error(`Notes page ${chunk.rootId} is missing from its document.`);
  }
  return page;
}

function requireTextBlock(
  chunk: NotesPageChunk,
  blockId: string,
): NoteBlockRecord {
  const block = chunk.blocks.find((candidate) => candidate.id === blockId);
  if (!block || !isTextNoteBlockType(block.type)) {
    throw new Error(`Text block ${blockId} is missing from the document.`);
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

function updateRunsOperation(
  block: NoteBlockRecord,
  runs: RichTextRun[],
): NoteOperation {
  return {
    kind: "updateProperties",
    id: block.id,
    properties: richTextProperties(block.properties, runs),
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

function normalizeRuns(runs: RichTextRun[]): RichTextRun[] {
  const normalized: RichTextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const previous = normalized.at(-1);
    if (previous && sameRunMarks(previous, run)) previous.text += run.text;
    else normalized.push({ ...run });
  }
  return normalized;
}

function plainTextRuns(text: string): RichTextRun[] {
  return text ? [{ text }] : [];
}

function sliceRichTextRuns(
  runs: RichTextRun[],
  start: number,
  end: number,
): RichTextRun[] {
  if (end <= start) return [];
  const sliced: RichTextRun[] = [];
  let offset = 0;
  for (const run of runs) {
    const runStart = offset;
    const runEnd = offset + run.text.length;
    offset = runEnd;
    if (runEnd <= start || runStart >= end) continue;
    const text = run.text.slice(
      Math.max(0, start - runStart),
      Math.min(run.text.length, end - runStart),
    );
    if (text) sliced.push({ ...run, text });
  }
  return normalizeRuns(sliced);
}

function sameRunMarks(left: RichTextRun, right: RichTextRun): boolean {
  return runMarkSignature(left) === runMarkSignature(right);
}

function runMarkSignature(run: RichTextRun): string {
  return JSON.stringify(
    Object.keys(run)
      .filter((key) => key !== "text")
      .sort()
      .map((key) => [key, run[key]]),
  );
}
