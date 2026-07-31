<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AppHeader from "$lib/components/AppHeader.svelte";
  import NotePageTree from "$lib/components/NotePageTree.svelte";
  import ParagraphBlockEditor from "$lib/components/ParagraphBlockEditor.svelte";
  import { NotesSaveQueue, type NotesSaveState } from "$lib/notes/save-queue";
  import { notePageTitle } from "$lib/notes/tree";
  import IconArrowRightRegular from "phosphor-icons-svelte/IconArrowRightRegular.svelte";
  import IconCheckCircleRegular from "phosphor-icons-svelte/IconCheckCircleRegular.svelte";
  import IconFileTextRegular from "phosphor-icons-svelte/IconFileTextRegular.svelte";
  import IconListRegular from "phosphor-icons-svelte/IconListRegular.svelte";
  import IconPlusBold from "phosphor-icons-svelte/IconPlusBold.svelte";
  import IconSpinnerGapRegular from "phosphor-icons-svelte/IconSpinnerGapRegular.svelte";
  import {
    createNoteBlock,
    type NoteBlockRecord,
    type NoteOperation,
    type NotesPageChunk,
  } from "$lib/notes/types";
  import {
    applyNotesTransaction,
    bootstrapNotes,
    loadNotesPage,
    loadNotesSidebar,
  } from "$lib/services/notes";
  import { hasNativeHost } from "$lib/services/native";

  const nativeHost = hasNativeHost();
  const saveQueue = new NotesSaveQueue(applyNotesTransaction);
  let pages = $state<NoteBlockRecord[]>([]);
  let rootPageIds = $state<string[]>([]);
  let expandedIds = $state<string[]>([]);
  let pageChunk = $state<NotesPageChunk | null>(null);
  let loading = $state(true);
  let pageLoading = $state(false);
  let mutationBusy = $state(false);
  let error = $state("");
  let drawerOpen = $state(false);
  let saveState = $state<NotesSaveState>({
    status: "saved",
    pending: 0,
    error: null,
  });
  let pageLoadCycle = 0;
  let blockPreviewElement = $state<HTMLDivElement>();

  const requestedPageId = $derived(page.url.searchParams.get("page"));
  const selectedPage = $derived(
    pages.find((candidate) => candidate.id === requestedPageId) ?? null,
  );
  const chunkBlocks = $derived(
    new Map((pageChunk?.blocks ?? []).map((block) => [block.id, block])),
  );
  const selectedContent = $derived(
    selectedPage
      ? selectedPage.content
          .map((id) => chunkBlocks.get(id) ?? pages.find((item) => item.id === id))
          .filter((block): block is NoteBlockRecord => Boolean(block))
      : [],
  );

  onMount(() => {
    const unsubscribe = saveQueue.subscribe((state) => {
      saveState = state;
    });
    try {
      const saved = localStorage.getItem("chesscave.notes.expanded.v1");
      if (saved) expandedIds = JSON.parse(saved);
    } catch {
      localStorage.removeItem("chesscave.notes.expanded.v1");
    }
    void initialize();
    return unsubscribe;
  });

  $effect(() => {
    const id = selectedPage?.id;
    if (!id || !nativeHost) {
      pageChunk = null;
      return;
    }
    void loadPageContent(id);
    expandAncestors(id);
    localStorage.setItem("chesscave.notes.last-page.v1", id);
  });

  async function initialize() {
    if (!nativeHost) {
      loading = false;
      error = "Notes persistence is available in the ChessCave desktop app.";
      return;
    }

    try {
      await bootstrapNotes();
      await refreshSidebar();
      if (!rootPageIds.length) {
        await createPage(null, true);
        return;
      }

      const requested = requestedPageId;
      const saved = localStorage.getItem("chesscave.notes.last-page.v1");
      const initial =
        pages.find((item) => item.id === requested)?.id ??
        pages.find((item) => item.id === saved)?.id ??
        rootPageIds[0];
      if (initial && initial !== requested) selectPage(initial, true);
      else if (initial) expandAncestors(initial);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function refreshSidebar() {
    const snapshot = await loadNotesSidebar();
    pages = snapshot.pages;
    rootPageIds = snapshot.rootPageIds;
  }

  async function loadPageContent(id: string) {
    const cycle = ++pageLoadCycle;
    pageLoading = true;
    try {
      const next = await loadNotesPage(id);
      if (cycle === pageLoadCycle) pageChunk = next;
    } catch (cause) {
      if (cycle === pageLoadCycle) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (cycle === pageLoadCycle) pageLoading = false;
    }
  }

  function selectPage(id: string, replaceState = false) {
    drawerOpen = false;
    const url = new URL(page.url);
    url.searchParams.set("page", id);
    void goto(`${url.pathname}${url.search}`, {
      replaceState,
      keepFocus: true,
      noScroll: true,
    });
  }

  function expandAncestors(id: string) {
    const expanded = new Set(expandedIds);
    let current = pages.find((item) => item.id === id);
    let changed = false;
    while (current?.parentId) {
      if (!expanded.has(current.parentId)) {
        expanded.add(current.parentId);
        changed = true;
      }
      current = pages.find((item) => item.id === current?.parentId);
    }
    if (changed) persistExpanded([...expanded]);
  }

  function persistExpanded(next: string[]) {
    expandedIds = next;
    localStorage.setItem(
      "chesscave.notes.expanded.v1",
      JSON.stringify(next),
    );
  }

  function toggleExpanded(id: string) {
    const expanded = new Set(expandedIds);
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    persistExpanded([...expanded]);
  }

  async function createPage(parentId: string | null, replaceState = false) {
    if (mutationBusy || !nativeHost) return;
    mutationBusy = true;
    error = "";
    const nextPage = createNoteBlock("page", "Untitled");
    const paragraph = createNoteBlock("paragraph");
    const parent = parentId
      ? pages.find((candidate) => candidate.id === parentId)
      : null;
    const index = parent ? parent.content.length : rootPageIds.length;
    const operations: NoteOperation[] = [
      { kind: "createBlock", block: nextPage },
      { kind: "createBlock", block: paragraph },
      {
        kind: "insertChild",
        parentId,
        childId: nextPage.id,
        index,
      },
      {
        kind: "insertChild",
        parentId: nextPage.id,
        childId: paragraph.id,
        index: 0,
      },
    ];

    try {
      await saveQueue.enqueue(operations);
      await refreshSidebar();
      if (parentId) {
        const expanded = new Set(expandedIds);
        expanded.add(parentId);
        persistExpanded([...expanded]);
      }
      selectPage(nextPage.id, replaceState);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      mutationBusy = false;
      loading = false;
    }
  }

  async function renamePage(id: string, title: string) {
    const current = pages.find((candidate) => candidate.id === id);
    if (!current || mutationBusy) return;
    const normalized = title.trim() || "Untitled";
    if (normalized === notePageTitle(current)) return;
    mutationBusy = true;
    error = "";

    try {
      await saveQueue.enqueue([
        {
          kind: "updateProperties",
          id,
          properties: {
            ...current.properties,
            title: [{ text: normalized }],
          },
          expectedRevision: current.revision,
        },
      ]);
      await refreshSidebar();
      if (requestedPageId === id) await loadPageContent(id);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      mutationBusy = false;
    }
  }

  async function saveParagraph(
    id: string,
    text: string,
    expectedRevision: number,
  ): Promise<number> {
    const current = pageChunk?.blocks.find((block) => block.id === id);
    if (!current || current.type !== "paragraph") return expectedRevision;
    error = "";

    try {
      const result = await saveQueue.enqueue([
        {
          kind: "updateProperties",
          id,
          properties: {
            ...current.properties,
            title: text ? [{ text }] : [],
          },
          expectedRevision,
        },
      ]);
      const updated = result.blocks.find((block) => block.id === id);
      if (!updated) throw new Error("The saved paragraph was not returned.");
      const currentChunk = pageChunk;
      if (currentChunk && currentChunk.rootId === selectedPage?.id) {
        pageChunk = {
          ...currentChunk,
          blocks: currentChunk.blocks.map((block) =>
            block.id === updated.id ? updated : block,
          ),
        };
      }
      return updated.revision;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
  }

  function blockText(block: NoteBlockRecord): string {
    return block.properties.title.map((run) => run.text).join("");
  }

  function focusLastParagraph() {
    const editors = blockPreviewElement?.querySelectorAll<HTMLElement>(
      "[data-note-paragraph-editor]",
    );
    const editor = editors?.item(editors.length - 1);
    if (!editor) return;

    editor.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
</script>

<svelte:head>
  <title>Notes — ChessCave</title>
  <meta
    name="description"
    content="Local, structured chess notes in ChessCave."
  />
</svelte:head>

<div class="notes-app">
  {#snippet headerActions()}
    <div class="header-actions">
      <button
        class="sidebar-toggle"
        type="button"
        aria-label="Toggle page sidebar"
        aria-expanded={drawerOpen}
        onclick={() => (drawerOpen = !drawerOpen)}
      >
        <IconListRegular />
      </button>
      {#if saveState.status === "failed"}
        <button class="retry" type="button" onclick={() => saveQueue.retry()}>
          Retry save
        </button>
      {:else}
        <span class:working={saveState.status === "saving"} class="save-state">
          {#if saveState.status === "saving"}
            <IconSpinnerGapRegular />
          {:else}
            <IconCheckCircleRegular />
          {/if}
          {saveState.status === "saving" ? "Saving" : "Local"}
        </span>
      {/if}
      <button
        class="new-page"
        type="button"
        disabled={!nativeHost || mutationBusy}
        onclick={() => createPage(null)}
      >
        New page
      </button>
    </div>
  {/snippet}

  <AppHeader
    active="notes"
    title={selectedPage ? notePageTitle(selectedPage) : "Notes"}
    subtitle="Private notes on this device"
    actions={headerActions}
  />

  <main class="notes-workspace">
    {#if drawerOpen}
      <button
        class="sidebar-backdrop"
        type="button"
        aria-label="Close page sidebar"
        onclick={() => (drawerOpen = false)}
      ></button>
    {/if}

    <aside class:open={drawerOpen} aria-label="Notes sidebar">
      <div class="sidebar-heading">
        <div>
          <span>Library</span>
          <strong>Pages</strong>
        </div>
        <button
          type="button"
          disabled={!nativeHost || mutationBusy}
          aria-label="Create a root page"
          title="New page"
          onclick={() => createPage(null)}
        ><IconPlusBold /></button>
      </div>

      <div class="tree-scroll">
        {#if loading}
          <div class="sidebar-state">Loading pages…</div>
        {:else if pages.length}
          <NotePageTree
            {rootPageIds}
            {pages}
            selectedId={selectedPage?.id ?? null}
            {expandedIds}
            mutating={mutationBusy}
            onSelect={selectPage}
            onToggle={toggleExpanded}
            onCreateChild={(id) => createPage(id)}
            onRename={renamePage}
          />
        {:else if !error}
          <div class="sidebar-state">No pages yet.</div>
        {/if}
      </div>

      <div class="local-note">
        <span aria-hidden="true"></span>
        Stored locally on this device
      </div>
    </aside>

    <section class="page-surface" aria-label="Selected note page">
      {#if loading}
        <div class="page-state">Preparing Notes…</div>
      {:else if error && !selectedPage}
        <div class="page-state error">
          <strong>Notes could not open.</strong>
          <span>{error}</span>
        </div>
      {:else if selectedPage}
        <article>
          <span class="page-kicker">Note</span>
          <input
            class="page-title"
            value={notePageTitle(selectedPage)}
            aria-label="Page title"
            disabled={mutationBusy}
            onkeydown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.currentTarget.value = notePageTitle(selectedPage);
                event.currentTarget.blur();
              }
            }}
            onblur={(event) => renamePage(selectedPage.id, event.currentTarget.value)}
          />

          {#if error}
            <div class="inline-error">{error}</div>
          {/if}

          <div
            class:loading={pageLoading}
            class="block-preview"
            bind:this={blockPreviewElement}
          >
            {#each selectedContent as block (block.id)}
              {#if block.type === "page"}
                <button
                  class="subpage-link"
                  type="button"
                  onclick={() => selectPage(block.id)}
                >
                  <span aria-hidden="true"><IconFileTextRegular /></span>
                  {notePageTitle(block)}
                  <i><IconArrowRightRegular /></i>
                </button>
              {:else if block.type === "paragraph"}
                <ParagraphBlockEditor
                  {block}
                  disabled={!nativeHost}
                  onSave={saveParagraph}
                />
              {:else}
                <div class="paragraph-block">
                  {blockText(block)}
                </div>
              {/if}
            {/each}
            <button
              class="editor-tail"
              type="button"
              tabindex="-1"
              aria-label="Continue writing"
              onclick={focusLastParagraph}
            ></button>
          </div>
        </article>
      {:else}
        <div class="page-state">
          <strong>Select a page.</strong>
        </div>
      {/if}
    </section>
  </main>
</div>

<style>
  .notes-app {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: 68px minmax(0, 1fr);
    color: var(--ink);
    background: var(--paper);
  }

  .header-actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .save-state {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    color: var(--muted);
    font-size: 10px;
    white-space: nowrap;
  }

  .save-state :global(svg) {
    width: 13px;
    height: 13px;
    color: var(--sage);
  }

  .save-state.working :global(svg) {
    color: var(--coral);
    animation: spin 900ms linear infinite;
  }

  .header-actions button {
    min-height: 34px;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--ink-soft);
    background: var(--pearl-raised);
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }

  .header-actions button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .header-actions .new-page {
    padding-inline: 15px;
    border-color: var(--ink);
    color: var(--pearl-raised);
    background: var(--ink);
  }

  .header-actions .new-page:hover:not(:disabled) {
    border-color: var(--coral-dark);
    background: var(--coral-dark);
  }

  .retry {
    padding-inline: 12px;
    color: var(--danger) !important;
  }

  .sidebar-toggle {
    display: none !important;
    width: 34px;
    padding: 0;
  }

  .notes-workspace {
    position: relative;
    display: grid;
    grid-template-columns: 268px minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  aside {
    z-index: 10;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--line);
    background: #ece6dc;
  }

  .sidebar-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 72px;
    padding: 14px 16px 12px 20px;
  }

  .sidebar-heading > div {
    display: grid;
    gap: 2px;
  }

  .sidebar-heading span,
  .page-kicker {
    color: var(--coral-dark);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .sidebar-heading strong {
    font-family: var(--display);
    font-size: 14px;
    font-variation-settings: "opsz" 20, "wght" 590;
  }

  .sidebar-heading button {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    color: var(--ink-soft);
    background: transparent;
    font-size: 18px;
    cursor: pointer;
  }

  .sidebar-heading button:hover:not(:disabled) {
    color: var(--coral-dark);
    background: var(--coral-soft);
  }

  .sidebar-heading button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .tree-scroll {
    min-height: 0;
    overflow-y: auto;
    padding: 0 10px 20px;
    overscroll-behavior: contain;
  }

  .sidebar-state {
    padding: 12px 10px;
    color: var(--muted);
    font-size: 11px;
  }

  .local-note {
    display: flex;
    gap: 7px;
    align-items: center;
    margin: 0 16px;
    padding: 14px 4px 18px;
    border-top: 1px solid rgba(124, 115, 105, 0.2);
    color: var(--muted);
    font-size: 9px;
  }

  .local-note span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--sage);
  }

  .page-surface {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    background: var(--pearl);
  }

  article {
    display: flex;
    flex-direction: column;
    width: min(760px, calc(100% - 72px));
    min-height: 100%;
    margin: 0 auto;
    padding: 78px 0 0;
  }

  .page-kicker {
    display: block;
    margin-bottom: 12px;
  }

  .page-title {
    width: 100%;
    padding: 0;
    border: 0;
    outline: 0;
    color: var(--ink);
    background: transparent;
    font-family: var(--display);
    font-size: clamp(36px, 5vw, 58px);
    font-variation-settings: "opsz" 58, "wght" 520;
    line-height: 1.08;
  }

  .page-title:focus {
    box-shadow: inset 0 -1px 0 var(--coral);
  }

  .block-preview {
    display: flex;
    flex: 1;
    flex-direction: column;
    margin-top: 36px;
    transition: opacity 140ms ease;
  }

  .editor-tail {
    flex: 1;
    min-height: 80px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: text;
  }

  .block-preview.loading {
    opacity: 0.45;
  }

  .paragraph-block {
    min-height: 34px;
    padding: 5px 2px;
    color: var(--ink-soft);
    font-size: 15px;
    line-height: 1.6;
  }

  .subpage-link {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto;
    gap: 9px;
    align-items: center;
    width: 100%;
    min-height: 40px;
    padding: 5px 2px;
    border: 0;
    border-bottom: 1px solid var(--line);
    color: var(--ink-soft);
    background: transparent;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .subpage-link > span {
    display: grid;
    color: var(--faint);
    font-size: 15px;
  }

  .subpage-link i {
    display: grid;
    color: var(--faint);
    font-style: normal;
    font-size: 14px;
  }

  .subpage-link:hover {
    color: var(--coral-dark);
  }

  .page-state {
    display: grid;
    place-content: center;
    min-height: 100%;
    color: var(--muted);
    font-size: 12px;
    text-align: center;
  }

  .page-state.error {
    gap: 5px;
  }

  .page-state strong {
    color: var(--ink);
    font-family: var(--display);
    font-size: 22px;
  }

  .inline-error {
    margin-top: 20px;
    padding: 10px 12px;
    border-left: 2px solid var(--danger);
    color: var(--danger);
    background: rgba(169, 79, 66, 0.06);
    font-size: 11px;
  }

  .sidebar-backdrop {
    display: none;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 760px) {
    .notes-app {
      grid-template-rows: 62px minmax(0, 1fr);
    }

    .notes-workspace {
      grid-template-columns: minmax(0, 1fr);
    }

    .sidebar-toggle {
      display: grid !important;
      place-items: center;
    }

    .save-state {
      display: none;
    }

    aside {
      position: absolute;
      inset: 0 auto 0 0;
      width: min(310px, calc(100vw - 44px));
      transform: translateX(-102%);
      transition: transform 180ms ease;
      box-shadow: 16px 0 40px rgba(60, 48, 39, 0.15);
    }

    aside.open {
      transform: translateX(0);
    }

    .sidebar-backdrop {
      position: absolute;
      z-index: 9;
      inset: 0;
      display: block;
      width: 100%;
      border: 0;
      background: rgba(41, 36, 31, 0.2);
    }

    article {
      width: min(680px, calc(100% - 40px));
      padding-top: 48px;
    }
  }

  @media (max-width: 520px) {
    .header-actions {
      gap: 6px;
    }

    .header-actions .new-page {
      min-height: 32px;
      padding-inline: 11px;
    }

    article {
      width: calc(100% - 30px);
      padding-top: 36px;
    }

    .page-title {
      font-size: 38px;
    }
  }
</style>
