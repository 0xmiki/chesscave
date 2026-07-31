import type {
  NoteOperation,
  NotesTransactionResult,
} from "./types";

export type NotesSaveStatus = "saved" | "saving" | "failed";

export interface NotesSaveState {
  status: NotesSaveStatus;
  pending: number;
  error: string | null;
}

type PersistNotes = (
  operations: NoteOperation[],
) => Promise<NotesTransactionResult>;

interface QueuedTransaction {
  operations: NoteOperation[];
  resolve: (result: NotesTransactionResult) => void;
}

export class NotesSaveQueue {
  readonly #persist: PersistNotes;
  readonly #listeners = new Set<(state: NotesSaveState) => void>();
  readonly #queue: QueuedTransaction[] = [];
  #working = false;
  #failure: string | null = null;

  constructor(persist: PersistNotes) {
    this.#persist = persist;
  }

  get state(): NotesSaveState {
    return {
      status: this.#failure
        ? "failed"
        : this.#working || this.#queue.length
          ? "saving"
          : "saved",
      pending: this.#queue.length,
      error: this.#failure,
    };
  }

  subscribe(listener: (state: NotesSaveState) => void): () => void {
    this.#listeners.add(listener);
    listener(this.state);
    return () => this.#listeners.delete(listener);
  }

  enqueue(operations: NoteOperation[]): Promise<NotesTransactionResult> {
    return new Promise((resolve) => {
      this.#queue.push({ operations, resolve });
      this.#notify();
      void this.#pump();
    });
  }

  retry(): void {
    if (!this.#failure) return;
    this.#failure = null;
    this.#notify();
    void this.#pump();
  }

  async #pump(): Promise<void> {
    if (this.#working || this.#failure || !this.#queue.length) return;
    this.#working = true;
    this.#notify();

    while (this.#queue.length && !this.#failure) {
      const current = this.#queue[0];
      try {
        const result = await this.#persist(current.operations);
        this.#queue.shift();
        current.resolve(result);
      } catch (error) {
        this.#failure = error instanceof Error ? error.message : String(error);
      }
      this.#notify();
    }

    this.#working = false;
    this.#notify();
  }

  #notify(): void {
    const snapshot = this.state;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
