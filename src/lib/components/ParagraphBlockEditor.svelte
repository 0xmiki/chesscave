<script lang="ts">
  import { onDestroy } from "svelte";
  import type { NoteBlockRecord } from "$lib/notes/types";

  let {
    block,
    disabled = false,
    onSave,
  }: {
    block: NoteBlockRecord;
    disabled?: boolean;
    onSave: (
      id: string,
      text: string,
      expectedRevision: number,
    ) => Promise<number>;
  } = $props();

  let editor: HTMLDivElement;
  let activeId = $state("");
  let draft = $state("");
  let saved = $state("");
  let revision = $state(0);
  let saving = $state(false);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (block.id !== activeId) {
      activeId = block.id;
      draft = blockText(block);
      saved = draft;
      revision = block.revision;
      return;
    }

    const persisted = blockText(block);
    if (!saving && draft === saved && persisted !== saved) {
      draft = persisted;
      saved = persisted;
      revision = block.revision;
    }
  });

  onDestroy(() => {
    if (saveTimer) clearTimeout(saveTimer);
    if (draft !== saved) void flush();
  });

  function blockText(value: NoteBlockRecord): string {
    return value.properties.title.map((run) => run.text).join("");
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flush();
    }, 500);
  }

  function handleInput() {
    scheduleSave();
  }

  async function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (saving || draft === saved) return;

    const next = draft;
    const expectedRevision = revision;
    saving = true;
    try {
      revision = await onSave(block.id, next, expectedRevision);
      saved = next;
    } finally {
      saving = false;
      if (draft !== saved) scheduleSave();
    }
  }
</script>

<div class="paragraph-shell" class:saving>
  <div
    class="paragraph-editor"
    class:empty={!draft}
    bind:this={editor}
    bind:textContent={draft}
    contenteditable="true"
    data-note-paragraph-editor
    role="textbox"
    tabindex={disabled ? -1 : 0}
    aria-disabled={disabled}
    aria-label="Paragraph"
    aria-multiline="true"
    data-placeholder="Write something…"
    onbeforeinput={(event) => {
      if (disabled) event.preventDefault();
    }}
    oninput={handleInput}
    onblur={() => void flush()}
    onkeydown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        editor.blur();
      }
    }}
  ></div>
</div>

<style>
  .paragraph-shell {
    position: relative;
    min-height: 34px;
  }

  .paragraph-editor {
    height: 100%;
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

  .paragraph-editor.empty::before {
    content: attr(data-placeholder);
    position: absolute;
    color: var(--faint);
    pointer-events: none;
  }

  .paragraph-shell.saving::after {
    content: "";
    position: absolute;
    top: 13px;
    right: -15px;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--coral);
    animation: pulse 700ms ease-in-out infinite alternate;
  }

  @keyframes pulse {
    to {
      opacity: 0.25;
    }
  }
</style>
