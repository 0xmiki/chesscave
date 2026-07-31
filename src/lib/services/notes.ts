import { invoke } from "@tauri-apps/api/core";
import type {
  NoteOperation,
  NotesBootstrap,
  NotesPageChunk,
  NotesSidebarSnapshot,
  NotesTransactionResult,
} from "$lib/notes/types";

export function bootstrapNotes(): Promise<NotesBootstrap> {
  return invoke<NotesBootstrap>("notes_bootstrap");
}

export function loadNotesSidebar(): Promise<NotesSidebarSnapshot> {
  return invoke<NotesSidebarSnapshot>("notes_load_sidebar");
}

export function loadNotesPage(pageId: string): Promise<NotesPageChunk> {
  return invoke<NotesPageChunk>("notes_load_page", { pageId });
}

export function applyNotesTransaction(
  operations: NoteOperation[],
): Promise<NotesTransactionResult> {
  return invoke<NotesTransactionResult>("notes_apply_transaction", {
    operations,
  });
}
