<script lang="ts">
  import type { Snippet } from "svelte";
  import IconHorseRegular from "phosphor-icons-svelte/IconHorseRegular.svelte";

  let {
    active,
    title,
    subtitle = "",
    actions,
  }: {
    active: "home" | "study" | "practice" | "notes";
    title: string;
    subtitle?: string;
    actions?: Snippet;
  } = $props();
</script>

<header class="topbar">
  <a class="brand" href="/" aria-label="ChessCave home">
    <span class="brand-mark" aria-hidden="true">
      <IconHorseRegular />
    </span>
    <span>ChessCave</span>
  </a>

  <nav aria-label="Primary navigation">
    <a class:active={active === "home"} href="/">Home</a>
    <a class:active={active === "study"} href="/study">Study</a>
    <a class:active={active === "practice"} href="/practice">Practice</a>
    <a class:active={active === "notes"} href="/notes">Notes</a>
  </nav>

  <div class="context">
    <h1>{title}</h1>
    {#if subtitle}<p>{subtitle}</p>{/if}
  </div>

  {#if actions}
    <div class="actions">
      {@render actions()}
    </div>
  {/if}
</header>

<style>
  .topbar {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    gap: 24px;
    align-items: center;
    min-height: 68px;
    padding: 0 28px;
    border-bottom: 1px solid var(--line);
    background: rgba(251, 248, 242, 0.97);
  }

  .brand {
    display: inline-flex;
    gap: 10px;
    align-items: center;
    color: var(--ink);
    font-family: var(--display);
    font-size: 19px;
    font-variation-settings: "opsz" 24, "wght" 650;
    text-decoration: none;
  }

  .brand-mark {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    color: var(--coral-dark);
    background: var(--pearl-raised);
    font-family: Georgia, serif;
    font-size: 20px;
  }

  nav {
    display: flex;
    gap: 2px;
    align-items: center;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper);
  }

  nav a {
    min-width: 54px;
    padding: 6px 11px;
    border-radius: 999px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 650;
    text-align: center;
    text-decoration: none;
  }

  nav a:hover {
    color: var(--ink);
  }

  nav a.active {
    color: var(--pearl-raised);
    background: var(--ink);
  }

  .context {
    min-width: 0;
    padding-left: 22px;
    border-left: 1px solid var(--line);
  }

  .context h1 {
    margin: 0;
    overflow: hidden;
    color: var(--ink);
    font-family: var(--display);
    font-size: 16px;
    font-variation-settings: "opsz" 18, "wght" 610;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context p {
    margin: 3px 0 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    min-width: 0;
  }

  @media (max-width: 1180px) {
    .topbar {
      gap: 16px;
      padding-inline: 20px;
    }

    .context {
      padding-left: 16px;
    }
  }

  @media (max-width: 760px) {
    .topbar {
      grid-template-columns: auto auto minmax(0, 1fr) auto;
      gap: 10px;
      min-height: 62px;
      padding-inline: 12px;
    }

    .brand > span:last-child,
    .context p {
      display: none;
    }

    .brand-mark {
      width: 32px;
      height: 32px;
    }

    nav a {
      min-width: 48px;
      padding-inline: 8px;
    }

    .context {
      padding-left: 0;
      border-left: 0;
    }

    .context h1 {
      font-size: 14px;
    }
  }

  @media (max-width: 520px) {
    .context {
      display: none;
    }

    .topbar {
      grid-template-columns: auto auto minmax(0, 1fr);
    }

    .actions {
      justify-self: end;
    }
  }
</style>
