export type SupportedNoteBlockType =
  | "page"
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  | "bulleted_list_item"
  | "numbered_list_item"
  | "to_do"
  | "quote"
  | "divider"
  | "code";

export type TextNoteBlockType = Exclude<
  SupportedNoteBlockType,
  "page" | "divider"
>;

export type NoteBlockType =
  | SupportedNoteBlockType
  | (string & {});

export interface RichTextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  link?: string;
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
  type: SupportedNoteBlockType;
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
      type: SupportedNoteBlockType;
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
  type: SupportedNoteBlockType,
  text = "",
): NewNoteBlock {
  return {
    id: crypto.randomUUID(),
    type,
    properties: {
      title: text ? [{ text }] : [],
      ...(type === "to_do" ? { checked: false } : {}),
    },
  };
}

const textBlockTypes = new Set<NoteBlockType>([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "quote",
  "code",
]);

export function isTextNoteBlockType(
  type: NoteBlockType,
): type is TextNoteBlockType {
  return textBlockTypes.has(type);
}

export function isListNoteBlockType(type: NoteBlockType): boolean {
  return type === "bulleted_list_item" ||
    type === "numbered_list_item" ||
    type === "to_do";
}
