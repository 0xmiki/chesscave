import {
  createNoteBlock,
  type NewNoteBlock,
  type NoteOperation,
} from "./types";

export interface CreatePageTransaction {
  page: NewNoteBlock;
  pageParagraph: NewNoteBlock;
  parentContinuation: NewNoteBlock | null;
  operations: NoteOperation[];
}

export function createPageTransaction(
  parentId: string | null,
  index: number,
): CreatePageTransaction {
  const page = createNoteBlock("page", "Untitled");
  const pageParagraph = createNoteBlock("paragraph");
  const parentContinuation = parentId
    ? createNoteBlock("paragraph")
    : null;
  const operations: NoteOperation[] = [
    { kind: "createBlock", block: page },
    { kind: "createBlock", block: pageParagraph },
    { kind: "insertChild", parentId, childId: page.id, index },
    {
      kind: "insertChild",
      parentId: page.id,
      childId: pageParagraph.id,
      index: 0,
    },
  ];

  if (parentContinuation) {
    operations.push(
      { kind: "createBlock", block: parentContinuation },
      {
        kind: "insertChild",
        parentId,
        childId: parentContinuation.id,
        index: index + 1,
      },
    );
  }

  return { page, pageParagraph, parentContinuation, operations };
}
