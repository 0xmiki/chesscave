import { describe, expect, test } from "bun:test";
import { NotesSaveQueue } from "./save-queue";
import type {
  NoteOperation,
  NotesTransactionResult,
} from "./types";

const operation = (id: string): NoteOperation => ({
  kind: "updateProperties",
  id,
  properties: { title: [{ text: id }] },
});

const result = (committedAt: number): NotesTransactionResult => ({
  committedAt,
  rootPageIds: [],
  blocks: [],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("NotesSaveQueue", () => {
  test("persists transactions strictly in enqueue order", async () => {
    const first = deferred<NotesTransactionResult>();
    const calls: string[] = [];
    const queue = new NotesSaveQueue(async (operations) => {
      const id = operations[0]?.kind === "updateProperties"
        ? operations[0].id
        : "unknown";
      calls.push(id);
      return id === "first" ? first.promise : result(2);
    });

    const firstSave = queue.enqueue([operation("first")]);
    const secondSave = queue.enqueue([operation("second")]);
    await Promise.resolve();
    expect(calls).toEqual(["first"]);
    expect(queue.state).toMatchObject({ status: "saving", pending: 2 });

    first.resolve(result(1));
    await expect(firstSave).resolves.toMatchObject({ committedAt: 1 });
    await expect(secondSave).resolves.toMatchObject({ committedAt: 2 });
    expect(calls).toEqual(["first", "second"]);
    expect(queue.state).toEqual({ status: "saved", pending: 0, error: null });
  });

  test("retains the failed transaction and resumes only after retry", async () => {
    let attempts = 0;
    const states: string[] = [];
    const queue = new NotesSaveQueue(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("disk unavailable");
      return result(9);
    });
    queue.subscribe((state) => states.push(state.status));

    const pending = queue.enqueue([operation("page")]);
    while (queue.state.status !== "failed") await Promise.resolve();
    expect(queue.state).toEqual({
      status: "failed",
      pending: 1,
      error: "disk unavailable",
    });

    queue.retry();
    await expect(pending).resolves.toMatchObject({ committedAt: 9 });
    expect(attempts).toBe(2);
    expect(states).toContain("failed");
    expect(queue.state).toEqual({ status: "saved", pending: 0, error: null });
  });

  test("keeps an undo transaction ordered behind a failed local edit", async () => {
    let firstAttempt = true;
    const committed: string[] = [];
    const queue = new NotesSaveQueue(async (operations) => {
      const id = operations[0]?.kind === "updateProperties"
        ? operations[0].id
        : "unknown";
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("disk paused");
      }
      committed.push(id);
      return result(committed.length);
    });

    const forward = queue.enqueue([operation("forward")]);
    while (queue.state.status !== "failed") await Promise.resolve();
    const undo = queue.enqueue([operation("undo")]);
    expect(queue.state).toMatchObject({ status: "failed", pending: 2 });

    queue.retry();
    await Promise.all([forward, undo]);
    expect(committed).toEqual(["forward", "undo"]);
    expect(queue.state).toEqual({ status: "saved", pending: 0, error: null });
  });
});
