<script lang="ts">
  import { tick } from "svelte";
  import IconCheckSquareRegular from "phosphor-icons-svelte/IconCheckSquareRegular.svelte";
  import IconCodeBlockRegular from "phosphor-icons-svelte/IconCodeBlockRegular.svelte";
  import IconFilePlusRegular from "phosphor-icons-svelte/IconFilePlusRegular.svelte";
  import IconListBulletsRegular from "phosphor-icons-svelte/IconListBulletsRegular.svelte";
  import IconListNumbersRegular from "phosphor-icons-svelte/IconListNumbersRegular.svelte";
  import IconMinusRegular from "phosphor-icons-svelte/IconMinusRegular.svelte";
  import IconQuotesRegular from "phosphor-icons-svelte/IconQuotesRegular.svelte";
  import IconTextHOneRegular from "phosphor-icons-svelte/IconTextHOneRegular.svelte";
  import IconTextHThreeRegular from "phosphor-icons-svelte/IconTextHThreeRegular.svelte";
  import IconTextHTwoRegular from "phosphor-icons-svelte/IconTextHTwoRegular.svelte";
  import IconTextTRegular from "phosphor-icons-svelte/IconTextTRegular.svelte";
  import {
    resolveSlashMenuKey,
    type SlashCommand,
    type SlashCommandIcon,
  } from "$lib/notes/slash-commands";

  let {
    menuId,
    commands,
    selectedIndex,
    left,
    top,
    mode,
    onHighlight,
    onSelect,
    onDismiss,
  }: {
    menuId: string;
    commands: SlashCommand[];
    selectedIndex: number;
    left: number;
    top: number;
    mode: "slash" | "turn";
    onHighlight: (index: number) => void;
    onSelect: (command: SlashCommand) => void;
    onDismiss: () => void;
  } = $props();

  let menuElement: HTMLDivElement;
  let focusedMenuId = "";

  $effect(() => {
    const currentMenuId = menuId;
    const currentMode = mode;
    if (currentMode !== "turn" || focusedMenuId === currentMenuId) return;
    focusedMenuId = currentMenuId;
    void tick().then(() => optionButton(selectedIndex)?.focus());
  });

  $effect(() => {
    const index = selectedIndex;
    void tick().then(() => {
      optionButton(index)?.scrollIntoView({ block: "nearest" });
    });
  });

  function optionButton(index: number): HTMLButtonElement | null {
    return menuElement?.querySelector<HTMLButtonElement>(
      `[data-command-index="${index}"]`,
    ) ?? null;
  }

  function handleKeydown(event: KeyboardEvent) {
    const action = resolveSlashMenuKey(
      event.key,
      selectedIndex,
      commands.length,
    );
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "dismiss") onDismiss();
    else if (action.kind === "select") {
      const command = commands[action.index];
      if (command) onSelect(command);
    } else {
      onHighlight(action.index);
      if (mode === "turn") {
        void tick().then(() => optionButton(action.index)?.focus());
      }
    }
  }
</script>

{#snippet commandIcon(icon: SlashCommandIcon)}
  {#if icon === "text"}
    <IconTextTRegular />
  {:else if icon === "heading-1"}
    <IconTextHOneRegular />
  {:else if icon === "heading-2"}
    <IconTextHTwoRegular />
  {:else if icon === "heading-3"}
    <IconTextHThreeRegular />
  {:else if icon === "bulleted-list"}
    <IconListBulletsRegular />
  {:else if icon === "numbered-list"}
    <IconListNumbersRegular />
  {:else if icon === "to-do"}
    <IconCheckSquareRegular />
  {:else if icon === "quote"}
    <IconQuotesRegular />
  {:else if icon === "divider"}
    <IconMinusRegular />
  {:else if icon === "code"}
    <IconCodeBlockRegular />
  {:else}
    <IconFilePlusRegular />
  {/if}
{/snippet}

<div
  bind:this={menuElement}
  class="command-menu"
  data-note-command-surface
  id={menuId}
  role="menu"
  tabindex="-1"
  aria-label={mode === "slash" ? "Insert block" : "Turn block into"}
  style={`--command-left: ${left}px; --command-top: ${top}px;`}
  onkeydown={handleKeydown}
>
  <div class="command-heading">
    <span>{mode === "slash" ? "Basic blocks" : "Turn into"}</span>
    {#if mode === "slash"}<small>Type to filter</small>{/if}
  </div>

  {#if commands.length}
    <div class="command-options">
      {#each commands as command, index (command.id)}
        <button
          class:selected={index === selectedIndex}
          data-command-index={index}
          id={`${menuId}-option-${command.id}`}
          type="button"
          role="menuitem"
          tabindex={mode === "turn" && index === selectedIndex ? 0 : -1}
          onmouseenter={() => onHighlight(index)}
          onpointerdown={(event) => event.preventDefault()}
          onclick={() => onSelect(command)}
        >
          <i aria-hidden="true">{@render commandIcon(command.icon)}</i>
          <span>
            <strong>{command.label}</strong>
            <small>{command.description}</small>
          </span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="command-empty" role="status">No matching blocks.</p>
  {/if}
</div>

<style>
  .command-menu {
    position: fixed;
    z-index: 80;
    top: var(--command-top);
    left: var(--command-left);
    width: min(304px, calc(100vw - 24px));
    max-height: min(390px, calc(100vh - 24px));
    padding: 7px;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    background: var(--pearl-raised);
    box-shadow: 0 18px 48px rgba(48, 39, 31, 0.14),
      0 3px 10px rgba(48, 39, 31, 0.08);
  }

  .command-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 28px;
    padding: 2px 8px 5px;
    color: var(--muted);
  }

  .command-heading span {
    color: var(--coral-dark);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  .command-heading small {
    font-size: 9px;
  }

  .command-options {
    max-height: 338px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  button {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 9px;
    align-items: center;
    width: 100%;
    min-height: 48px;
    padding: 6px 8px;
    border: 0;
    border-radius: 6px;
    color: var(--ink-soft);
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  button:hover,
  button.selected,
  button:focus-visible {
    outline: 0;
    background: var(--coral-soft);
  }

  button i {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--ink-soft);
    background: var(--pearl);
    font-style: normal;
  }

  button i :global(svg) {
    width: 17px;
    height: 17px;
  }

  button > span {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  button strong {
    font-size: 12px;
    font-weight: 650;
  }

  button small {
    overflow: hidden;
    color: var(--muted);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-empty {
    margin: 0;
    padding: 18px 10px;
    color: var(--muted);
    font-size: 11px;
  }
</style>
