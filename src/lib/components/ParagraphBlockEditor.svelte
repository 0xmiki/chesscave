<script lang="ts">
  import { tick } from "svelte";
  import {
    noteBlockText,
    resolveParagraphKey,
    type EditorSelection,
  } from "$lib/notes/editor";
  import type { NoteBlockRecord } from "$lib/notes/types";

  let {
    block,
    disabled = false,
    focusRequest = null,
    onInput,
    onCommit,
    onSplit,
    onMergeBackward,
    onMove,
    onPaste,
    onUndo,
    onRedo,
  }: {
    block: NoteBlockRecord;
    disabled?: boolean;
    focusRequest?: (EditorSelection & { token: number }) | null;
    onInput: (
      id: string,
      text: string,
      beforeOffset: number,
      offset: number,
      composing: boolean,
    ) => void;
    onCommit: (id: string, offset: number) => void;
    onSplit: (id: string, start: number, end: number) => void;
    onMergeBackward: (id: string) => boolean;
    onMove: (id: string, direction: "previous" | "next") => boolean;
    onPaste: (
      id: string,
      start: number,
      end: number,
      text: string,
    ) => void;
    onUndo: () => void;
    onRedo: () => void;
  } = $props();

  let editor: HTMLDivElement;
  let activeId = $state("");
  let draft = $state("");
  let composing = $state(false);
  let appliedFocusToken = -1;
  let pendingBeforeOffset: number | null = null;

  $effect(() => {
    const persisted = noteBlockText(block);
    if (block.id !== activeId || persisted !== draft) {
      activeId = block.id;
      draft = persisted;
      if (editor && editor.textContent !== persisted) {
        editor.textContent = persisted;
      }
    }
  });

  $effect(() => {
    const request = focusRequest;
    if (
      !request ||
      request.blockId !== block.id ||
      request.token === appliedFocusToken
    ) {
      return;
    }
    appliedFocusToken = request.token;
    void tick().then(() => setCaretOffset(request.offset));
  });

  function selectionOffsets(): {
    start: number;
    end: number;
    collapsed: boolean;
  } {
    const selection = window.getSelection();
    if (!selection?.rangeCount) {
      return { start: 0, end: 0, collapsed: true };
    }
    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return { start: 0, end: 0, collapsed: true };
    }
    const startRange = document.createRange();
    startRange.selectNodeContents(editor);
    startRange.setEnd(range.startContainer, range.startOffset);
    const endRange = document.createRange();
    endRange.selectNodeContents(editor);
    endRange.setEnd(range.endContainer, range.endOffset);
    const first = startRange.toString().length;
    const second = endRange.toString().length;
    return {
      start: Math.min(first, second),
      end: Math.max(first, second),
      collapsed: range.collapsed,
    };
  }

  function setCaretOffset(requested: number) {
    editor.focus();
    const offset = Math.max(0, Math.min(requested, draft.length));
    const walker = document.createTreeWalker(
      editor,
      NodeFilter.SHOW_TEXT,
    );
    let remaining = offset;
    let node = walker.nextNode();
    const range = document.createRange();

    while (node) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        range.collapse(true);
        installRange(range);
        return;
      }
      remaining -= length;
      node = walker.nextNode();
    }

    range.selectNodeContents(editor);
    range.collapse(false);
    installRange(range);
  }

  function installRange(range: Range) {
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function reportInput(isComposing: boolean) {
    const offsets = selectionOffsets();
    const beforeOffset = pendingBeforeOffset ?? offsets.end;
    pendingBeforeOffset = null;
    draft = editor.textContent ?? "";
    onInput(block.id, draft, beforeOffset, offsets.end, isComposing);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (disabled) return;
    const offsets = selectionOffsets();
    const action = resolveParagraphKey({
      key: event.key,
      composing: composing || event.isComposing,
      collapsed: offsets.collapsed,
      start: offsets.start,
      end: offsets.end,
      textLength: draft.length,
      shiftKey: event.shiftKey,
      primaryModifier: event.ctrlKey || event.metaKey,
    });
    if (!action) return;

    if (action === "merge-backward" && !onMergeBackward(block.id)) return;
    if (action === "move-previous" && !onMove(block.id, "previous")) return;
    if (action === "move-next" && !onMove(block.id, "next")) return;

    event.preventDefault();
    if (action === "split") {
      onSplit(block.id, offsets.start, offsets.end);
    }
    else if (action === "undo") onUndo();
    else if (action === "redo") onRedo();
  }
</script>

<div class="paragraph-shell">
  <div
    class="paragraph-editor"
    class:empty={!draft}
    bind:this={editor}
    contenteditable="true"
    data-note-paragraph-editor
    role="textbox"
    tabindex={disabled ? -1 : 0}
    aria-disabled={disabled}
    aria-label="Paragraph"
    aria-multiline="true"
    data-placeholder="Write something…"
    onbeforeinput={(event) => {
      const rejected =
        disabled ||
        (event instanceof InputEvent && event.inputType.startsWith("format"));
      if (rejected) {
        event.preventDefault();
        return;
      }
      pendingBeforeOffset = selectionOffsets().start;
    }}
    oninput={(event) =>
      reportInput(
        composing || (event instanceof InputEvent && event.isComposing),
      )}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => {
      composing = false;
      reportInput(false);
    }}
    onblur={() => {
      if (!composing) onCommit(block.id, selectionOffsets().end);
    }}
    onkeydown={handleKeydown}
    onpaste={(event) => {
      event.preventDefault();
      if (disabled) return;
      const offsets = selectionOffsets();
      onPaste(
        block.id,
        offsets.start,
        offsets.end,
        event.clipboardData?.getData("text/plain") ?? "",
      );
    }}
  ></div>
</div>

<style>
  .paragraph-shell {
    position: relative;
    min-height: 34px;
  }

  .paragraph-editor {
    min-height: inherit;
    padding: 5px 2px;
    border-radius: 3px;
    color: var(--ink-soft);
    font-size: 15px;
    line-height: 1.6;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    caret-color: var(--coral-dark);
  }

  .paragraph-editor:focus {
    outline: 0;
  }

  .paragraph-editor.empty:focus::before {
    content: attr(data-placeholder);
    position: absolute;
    color: var(--faint);
    pointer-events: none;
  }
</style>
