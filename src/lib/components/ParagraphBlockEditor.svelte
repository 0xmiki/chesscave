<script lang="ts">
  import { tick } from "svelte";
  import {
    noteBlockText,
    resolveParagraphKey,
    type EditorSelection,
  } from "$lib/notes/editor";
  import type { NoteBlockRecord, RichTextRun } from "$lib/notes/types";

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
    onIndent,
    onOutdent,
    onUndo,
    onRedo,
  }: {
    block: NoteBlockRecord;
    disabled?: boolean;
    focusRequest?: (EditorSelection & { token: number }) | null;
    onInput: (
      id: string,
      runs: RichTextRun[],
      beforeOffset: number,
      offset: number,
      composing: boolean,
    ) => void;
    onIndent: (id: string, offset: number) => boolean;
    onOutdent: (id: string, offset: number) => boolean;
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

  let editor: HTMLElement;
  let activeId = $state("");
  let draft = $state("");
  let draftRunsSignature = "";
  let composing = $state(false);
  let appliedFocusToken = -1;
  let pendingBeforeOffset: number | null = null;

  $effect(() => {
    const persisted = noteBlockText(block);
    const signature = runsSignature(block.properties.title);
    if (block.id !== activeId || signature !== draftRunsSignature) {
      activeId = block.id;
      draft = persisted;
      draftRunsSignature = signature;
      if (editor) renderRuns(block.properties.title);
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
    const runs = readEditorRuns();
    draft = runs.map((run) => run.text).join("");
    draftRunsSignature = runsSignature(runs);
    onInput(block.id, runs, beforeOffset, offsets.end, isComposing);
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
    if (action === "indent" && !onIndent(block.id, offsets.end)) return;
    if (action === "outdent" && !onOutdent(block.id, offsets.end)) return;

    event.preventDefault();
    if (action === "split") {
      onSplit(block.id, offsets.start, offsets.end);
    }
    else if (action === "undo") onUndo();
    else if (action === "redo") onRedo();
  }

  function renderRuns(runs: RichTextRun[]) {
    const nodes = runs.map((run) => {
      let node: Node = document.createTextNode(run.text);
      if (run.code) node = wrapNode("code", node);
      if (run.italic) node = wrapNode("em", node);
      if (run.bold) node = wrapNode("strong", node);
      if (run.link && /^(https?:\/\/|mailto:)/i.test(run.link)) {
        const anchor = document.createElement("a");
        anchor.href = run.link;
        anchor.tabIndex = -1;
        anchor.rel = "noreferrer";
        anchor.append(node);
        node = anchor;
      }
      return node;
    });
    editor.replaceChildren(...nodes);
  }

  function wrapNode(tag: "code" | "em" | "strong", child: Node): HTMLElement {
    const element = document.createElement(tag);
    element.append(child);
    return element;
  }

  function readEditorRuns(): RichTextRun[] {
    const runs: RichTextRun[] = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? "";
      if (text) {
        const run: RichTextRun = { text };
        let parent = node.parentElement;
        while (parent && parent !== editor) {
          const tag = parent.tagName.toLowerCase();
          if (tag === "strong" || tag === "b" || parent.style.fontWeight === "bold") {
            run.bold = true;
          }
          if (tag === "em" || tag === "i" || parent.style.fontStyle === "italic") {
            run.italic = true;
          }
          if (tag === "code") run.code = true;
          if (tag === "a") {
            const href = parent.getAttribute("href");
            if (href && /^(https?:\/\/|mailto:)/i.test(href)) run.link = href;
          }
          parent = parent.parentElement;
        }
        const previous = runs.at(-1);
        if (previous && sameMarks(previous, run)) previous.text += run.text;
        else runs.push(run);
      }
      node = walker.nextNode();
    }
    return runs;
  }

  function sameMarks(left: RichTextRun, right: RichTextRun): boolean {
    return Boolean(left.bold) === Boolean(right.bold) &&
      Boolean(left.italic) === Boolean(right.italic) &&
      Boolean(left.code) === Boolean(right.code) &&
      (left.link ?? null) === (right.link ?? null);
  }

  function runsSignature(runs: RichTextRun[]): string {
    return JSON.stringify(runs);
  }

  function editorTag(type: NoteBlockRecord["type"]): string {
    if (type === "heading_1") return "h1";
    if (type === "heading_2") return "h2";
    if (type === "heading_3") return "h3";
    if (type === "quote") return "blockquote";
    if (type === "code") return "pre";
    if (type === "paragraph") return "p";
    return "div";
  }

  function blockLabel(type: NoteBlockRecord["type"]): string {
    return type.replaceAll("_", " ");
  }
</script>

<div class="paragraph-shell">
  <svelte:element
    this={editorTag(block.type)}
    class="paragraph-editor"
    class:empty={!draft}
    bind:this={editor}
    contenteditable="true"
    data-note-paragraph-editor
    data-block-type={block.type}
    role="textbox"
    tabindex={disabled ? -1 : 0}
    aria-disabled={disabled}
    aria-label={blockLabel(block.type)}
    aria-multiline="true"
    data-placeholder="Write something…"
    onbeforeinput={(event) => {
      const rejected =
        disabled ||
        (event instanceof InputEvent &&
          event.inputType.startsWith("format") &&
          !["formatBold", "formatItalic"].includes(event.inputType));
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
    onclick={(event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("a")) {
        event.preventDefault();
      }
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
  ></svelte:element>
</div>

<style>
  .paragraph-shell {
    position: relative;
    min-height: 34px;
  }

  .paragraph-editor {
    margin: 0;
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

  .paragraph-editor[data-block-type="heading_1"] {
    padding-top: 12px;
    font-family: var(--display);
    font-size: 29px;
    font-variation-settings: "opsz" 32, "wght" 580;
    line-height: 1.25;
  }

  .paragraph-editor[data-block-type="heading_2"] {
    padding-top: 9px;
    font-family: var(--display);
    font-size: 23px;
    font-variation-settings: "opsz" 26, "wght" 570;
    line-height: 1.3;
  }

  .paragraph-editor[data-block-type="heading_3"] {
    padding-top: 7px;
    font-size: 18px;
    font-weight: 680;
    line-height: 1.4;
  }

  .paragraph-editor[data-block-type="quote"] {
    margin: 5px 0;
    padding-left: 14px;
    border-left: 2px solid var(--line-strong);
    color: var(--ink);
    font-family: var(--display);
    font-size: 17px;
  }

  .paragraph-editor[data-block-type="code"] {
    margin: 5px 0;
    padding: 11px 13px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--paper);
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 13px;
    line-height: 1.55;
  }

  .paragraph-editor :global(code) {
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--paper);
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.9em;
  }

  .paragraph-editor :global(a) {
    color: var(--coral-dark);
    text-decoration-color: color-mix(in srgb, var(--coral) 55%, transparent);
    text-underline-offset: 2px;
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
