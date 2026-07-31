<script lang="ts">
  import { tick } from "svelte";
  import IconCaretRightRegular from "phosphor-icons-svelte/IconCaretRightRegular.svelte";
  import IconDotsThreeBold from "phosphor-icons-svelte/IconDotsThreeBold.svelte";
  import IconFileTextRegular from "phosphor-icons-svelte/IconFileTextRegular.svelte";
  import IconTrashRegular from "phosphor-icons-svelte/IconTrashRegular.svelte";
  import {
    buildVisiblePageTree,
    notePageTitle,
    resolvePageTreeKey,
  } from "$lib/notes/tree";
  import type { NoteBlockRecord } from "$lib/notes/types";

  let {
    rootPageIds,
    pages,
    selectedId,
    expandedIds,
    mutating = false,
    onSelect,
    onToggle,
    onCreateChild,
    onRename,
    onDelete,
  }: {
    rootPageIds: string[];
    pages: NoteBlockRecord[];
    selectedId: string | null;
    expandedIds: string[];
    mutating?: boolean;
    onSelect: (id: string) => void;
    onToggle: (id: string) => void;
    onCreateChild: (parentId: string) => void;
    onRename: (id: string, title: string) => void;
    onDelete: (id: string) => void;
  } = $props();

  let treeElement: HTMLDivElement;
  let menuPageId = $state<string | null>(null);
  let confirmDeletePageId = $state<string | null>(null);
  let renamePageId = $state<string | null>(null);
  let renameDraft = $state("");
  const visible = $derived(
    buildVisiblePageTree(rootPageIds, pages, expandedIds),
  );

  function pageButton(id: string): HTMLButtonElement | null {
    if (!treeElement) return null;
    return (
      [...treeElement.querySelectorAll<HTMLButtonElement>("[data-page-tree-id]")]
        .find((button) => button.dataset.pageTreeId === id) ?? null
    );
  }

  async function focusPage(id: string) {
    await tick();
    pageButton(id)?.focus();
  }

  function closeMenu() {
    menuPageId = null;
    confirmDeletePageId = null;
  }

  function menuContains(target: EventTarget | null): boolean {
    if (!(target instanceof Node) || !menuPageId || !treeElement) return false;
    const menu = treeElement.querySelector<HTMLElement>(
      `[data-page-menu="${menuPageId}"]`,
    );
    const trigger = treeElement.querySelector<HTMLElement>(
      `[data-page-menu-trigger="${menuPageId}"]`,
    );
    return Boolean(menu?.contains(target) || trigger?.contains(target));
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (menuPageId && !menuContains(event.target)) closeMenu();
  }

  function handleWindowFocusIn(event: FocusEvent) {
    if (menuPageId && !menuContains(event.target)) closeMenu();
  }

  function handleWindowKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !menuPageId) return;
    event.preventDefault();
    const pageId = menuPageId;
    closeMenu();
    void tick().then(() => {
      treeElement?.querySelector<HTMLButtonElement>(
        `[data-page-menu-trigger="${pageId}"]`,
      )?.focus();
    });
  }

  function beginRename(page: NoteBlockRecord) {
    if (mutating) return;
    closeMenu();
    renameDraft = notePageTitle(page);
    renamePageId = page.id;
    void tick().then(() => {
      const input = treeElement?.querySelector<HTMLInputElement>(
        `[data-rename-page="${page.id}"]`,
      );
      input?.focus();
      input?.select();
    });
  }

  function commitRename(page: NoteBlockRecord) {
    if (renamePageId !== page.id) return;
    const next = renameDraft.trim() || "Untitled";
    renamePageId = null;
    if (next !== notePageTitle(page)) onRename(page.id, next);
    void focusPage(page.id);
  }

  function handleTreeKeydown(
    event: KeyboardEvent,
    index: number,
    page: NoteBlockRecord,
  ) {
    const action = resolvePageTreeKey(
      event.key,
      index,
      visible,
      expandedIds,
    );
    if (!action) return;
    event.preventDefault();
    if (action.kind === "focus") void focusPage(action.id);
    else if (action.kind === "toggle") onToggle(action.id);
    else beginRename(page);
  }
</script>

<svelte:window
  onpointerdown={handleWindowPointerDown}
  onfocusin={handleWindowFocusIn}
  onkeydown={handleWindowKeyDown}
/>

<div class="page-tree" role="tree" aria-label="Note pages" bind:this={treeElement}>
  {#each visible as node, index (node.page.id)}
    <div
      class:selected={selectedId === node.page.id}
      class="tree-row"
      style={`--tree-depth: ${node.depth};`}
    >
      <button
        class:hidden={!node.childPageIds.length}
        class="disclosure"
        type="button"
        tabindex="-1"
        aria-label={expandedIds.includes(node.page.id) ? "Collapse page" : "Expand page"}
        onclick={() => onToggle(node.page.id)}
      >
        <span class:expanded={expandedIds.includes(node.page.id)}>
          <IconCaretRightRegular />
        </span>
      </button>

      {#if renamePageId === node.page.id}
        <input
          class="rename-input"
          data-rename-page={node.page.id}
          bind:value={renameDraft}
          aria-label="Page title"
          onblur={() => commitRename(node.page)}
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename(node.page);
            } else if (event.key === "Escape") {
              event.preventDefault();
              renamePageId = null;
              void focusPage(node.page.id);
            }
          }}
        />
      {:else}
        <button
          class="page-link"
          data-page-tree-id={node.page.id}
          type="button"
          role="treeitem"
          tabindex={selectedId === node.page.id ? 0 : -1}
          aria-level={node.depth + 1}
          aria-selected={selectedId === node.page.id}
          aria-expanded={node.childPageIds.length
            ? expandedIds.includes(node.page.id)
            : undefined}
          ondblclick={() => beginRename(node.page)}
          onkeydown={(event) =>
            handleTreeKeydown(
              event,
              index,
              node.page,
            )}
          onclick={() => {
            closeMenu();
            onSelect(node.page.id);
          }}
        >
          <span class="page-icon" aria-hidden="true">
            <IconFileTextRegular />
          </span>
          <span>{notePageTitle(node.page)}</span>
        </button>
      {/if}

      <button
        class="more"
        data-page-menu-trigger={node.page.id}
        type="button"
        aria-label={`Page actions for ${notePageTitle(node.page)}`}
        aria-expanded={menuPageId === node.page.id}
        disabled={mutating}
        onclick={() => {
          const next = menuPageId === node.page.id ? null : node.page.id;
          closeMenu();
          menuPageId = next;
        }}
      ><IconDotsThreeBold /></button>

      {#if menuPageId === node.page.id}
        <div class="page-menu" data-page-menu={node.page.id} role="menu">
          {#if confirmDeletePageId === node.page.id}
            <p>Delete “{notePageTitle(node.page)}” and everything inside it?</p>
            <div class="confirm-actions">
              <button
                type="button"
                role="menuitem"
                onclick={() => (confirmDeletePageId = null)}
              >Cancel</button>
              <button
                class="confirm-delete"
                type="button"
                role="menuitem"
                disabled={mutating}
                onclick={() => {
                  closeMenu();
                  onDelete(node.page.id);
                }}
              >Delete</button>
            </div>
          {:else}
            <button type="button" role="menuitem" onclick={() => beginRename(node.page)}>
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={mutating}
              onclick={() => {
                closeMenu();
                onCreateChild(node.page.id);
              }}
            >
              New sub-page
            </button>
            <button
              class="delete-page"
              type="button"
              role="menuitem"
              disabled={mutating}
              onclick={() => (confirmDeletePageId = node.page.id)}
            >
              <IconTrashRegular />
              Delete page
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .page-tree {
    display: grid;
    gap: 1px;
  }

  .tree-row {
    position: relative;
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr) 28px;
    align-items: center;
    min-height: 31px;
    padding-left: calc(var(--tree-depth) * 16px);
    border-radius: 6px;
  }

  .tree-row:hover,
  .tree-row.selected {
    background: rgba(255, 253, 248, 0.64);
  }

  .tree-row.selected {
    box-shadow: inset 2px 0 0 var(--coral);
  }

  button,
  input {
    min-width: 0;
    border: 0;
    color: var(--ink-soft);
    background: transparent;
  }

  .disclosure {
    display: grid;
    width: 20px;
    height: 26px;
    place-items: center;
    padding: 0;
    cursor: pointer;
  }

  .disclosure.hidden {
    visibility: hidden;
  }

  .disclosure span {
    display: grid;
    width: 13px;
    height: 13px;
    color: var(--muted);
    transition: transform 140ms ease;
  }

  .disclosure span.expanded {
    transform: rotate(90deg);
  }

  .page-link {
    display: flex;
    gap: 7px;
    align-items: center;
    height: 30px;
    padding: 0 5px;
    overflow: hidden;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }

  .page-link > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .page-icon {
    display: grid;
    flex: 0 0 auto;
    color: var(--faint);
    font-size: 14px;
  }

  .rename-input {
    width: 100%;
    height: 26px;
    padding: 0 5px;
    border: 1px solid var(--coral);
    border-radius: 4px;
    outline: 0;
    background: var(--pearl-raised);
    font-size: 12px;
  }

  .more {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    padding: 0;
    border-radius: 4px;
    color: transparent;
    font-size: 17px;
    cursor: pointer;
  }

  .tree-row:hover .more,
  .more:focus-visible,
  .more[aria-expanded="true"] {
    color: var(--muted);
  }

  .more:hover {
    color: var(--ink);
    background: var(--line);
  }

  .more:disabled,
  .page-menu button:disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }

  .page-menu {
    position: absolute;
    z-index: 20;
    top: 29px;
    right: 2px;
    display: grid;
    min-width: 132px;
    padding: 5px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--pearl-raised);
    box-shadow: 0 12px 28px rgba(66, 51, 40, 0.14);
  }

  .page-menu button {
    padding: 7px 8px;
    border-radius: 5px;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .page-menu p {
    max-width: 180px;
    margin: 3px 5px 7px;
    color: var(--ink-soft);
    font-size: 11px;
    line-height: 1.45;
  }

  .page-menu .delete-page {
    display: flex;
    gap: 7px;
    align-items: center;
    color: var(--danger);
  }

  .page-menu .delete-page :global(svg) {
    width: 14px;
    height: 14px;
  }

  .confirm-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }

  .page-menu .confirm-delete {
    color: var(--pearl-raised);
    text-align: center;
    background: var(--danger);
  }

  .page-menu .confirm-delete:hover,
  .page-menu .confirm-delete:focus-visible {
    color: var(--pearl-raised);
    background: var(--coral-dark);
  }

  .page-menu button:hover,
  .page-menu button:focus-visible {
    color: var(--ink);
    background: var(--coral-soft);
  }
</style>
