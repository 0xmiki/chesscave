export type NoteBlockType =
  | "page"
  | "paragraph"
  | (string & {});

export interface RichTextRun {
  text: string;
  [key: string]: unknown;
}

export interface NoteBlockProperties {
  title: RichTextRun[];
  [key: string]: unknown;
}

export interface NoteBlockRecord {
  id: string;
  type: NoteBlockType;
  properties: NoteBlockProperties;
  content: string[];
  parentId: string | null;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface NewNoteBlock {
  id: string;
  type: "page" | "paragraph";
  properties: NoteBlockProperties;
}

export type NoteOperation =
  | {
      kind: "createBlock";
      block: NewNoteBlock;
    }
  | {
      kind: "updateProperties";
      id: string;
      properties: NoteBlockProperties;
      expectedRevision?: number;
    }
  | {
      kind: "changeType";
      id: string;
      type: "page" | "paragraph";
      expectedRevision?: number;
    }
  | {
      kind: "insertChild";
      parentId: string | null;
      childId: string;
      index: number;
    }
  | {
      kind: "moveChild";
      childId: string;
      parentId: string | null;
      index: number;
    }
  | {
      kind: "removeChild";
      parentId: string | null;
      childId: string;
    }
  | {
      kind: "deleteBlock";
      id: string;
    }
  | {
      kind: "deleteSubtree";
      id: string;
    };

export interface NotesBootstrap {
  schemaVersion: number;
  rootPageIds: string[];
}

export interface NotesSidebarSnapshot {
  rootPageIds: string[];
  pages: NoteBlockRecord[];
}

export interface NotesPageChunk {
  rootId: string;
  blocks: NoteBlockRecord[];
}

export interface NotesTransactionResult {
  committedAt: number;
  rootPageIds: string[];
  blocks: NoteBlockRecord[];
}

export function createNoteBlock(
  type: "page" | "paragraph",
  text = "",
): NewNoteBlock {
  return {
    id: crypto.randomUUID(),
    type,
    properties: {
      title: text ? [{ text }] : [],
    },
  };
}
