<script lang="ts">
  import { tick } from "svelte";
  import type { CoachActivity, CoachMessage } from "$lib/chess/types";

  let {
    messages,
    status,
    detail,
    activity,
    contextLabel,
    busy,
    onSend,
    onNewConversation,
  }: {
    messages: CoachMessage[];
    status: "offline" | "starting" | "ready" | "thinking" | "error";
    detail: string;
    activity: CoachActivity | null;
    contextLabel: string;
    busy: boolean;
    onSend: (message: string) => void;
    onNewConversation: () => void;
  } = $props();

  let draft = $state("");
  let messagesElement: HTMLDivElement;
  const suggested = [
    "Why was the last move played?",
    "What is the strongest plan here?",
    "Show me the tactical danger.",
  ];

  function submit() {
    const message = draft.trim();
    if (!message || busy || status !== "ready") return;
    draft = "";
    onSend(message);
  }

  function startNewConversation() {
    draft = "";
    onNewConversation();
  }

  function renderMarkdown(text: string): string {
    return text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
      .replaceAll("\n", "<br />");
  }

  $effect(() => {
    messages.length;
    messages.at(-1)?.text;
    messages.at(-1)?.pending;
    activity?.label;
    activity?.detail;
    void tick().then(() => {
      if (messagesElement && (activity || messages.at(-1)?.pending)) {
        messagesElement.scrollTop = messagesElement.scrollHeight;
      }
    });
  });
</script>

<section class="coach" aria-label="Coach">
  <header>
    <div class="coach-mark">S</div>
    <div class="coach-title">
      <h2>Sol</h2>
      <p>{contextLabel}</p>
    </div>
    <div class="header-actions">
      <button
        class="new-conversation"
        type="button"
        onclick={startNewConversation}
        disabled={busy || status === "starting" || status === "offline"}
        aria-label="Start a new conversation"
        title="Start a new conversation"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 18.4 3.7 21v-4.5A8 8 0 1 1 7 18.4Z"></path>
          <path d="M12 8v6M9 11h6"></path>
        </svg>
      </button>
      <span class:ready={status === "ready"} class:thinking={status === "thinking"} class="status-dot"></span>
    </div>
  </header>

  <div class="messages" bind:this={messagesElement} aria-live="polite">
    {#if messages.length === 0}
      <div class="welcome">
        <h3>Ask about the game.</h3>
        <p>Sol can use the current position and the saved full-game review to explain what mattered.</p>
      </div>
      <div class="suggestions">
        {#each suggested as suggestion}
          <button type="button" onclick={() => onSend(suggestion)} disabled={status !== "ready"}>
            {suggestion}
            <span>↗</span>
          </button>
        {/each}
      </div>
    {:else}
      {#each messages as message (message.id)}
        <div class:assistant={message.role === "assistant"} class="message">
          {#if message.text}
            <div class="bubble">
              {@html renderMarkdown(message.text)}
              {#if message.pending}<span class="typing">···</span>{/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}

    {#if activity}
      <div class={`activity ${activity.kind}`} role="status" aria-live="polite">
        <span class="activity-spinner" aria-hidden="true"></span>
        <span class="activity-copy">
          <strong>{activity.label}</strong>
          <small>{activity.detail}</small>
        </span>
      </div>
    {/if}
  </div>

  <form onsubmit={(event) => { event.preventDefault(); submit(); }}>
    <textarea
      bind:value={draft}
      placeholder={status === "offline" ? "Open the desktop app to chat…" : "Ask about this position…"}
      rows="2"
      disabled={status === "offline" || status === "starting"}
      onkeydown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submit();
        }
      }}
    ></textarea>
    <button class="send" type="submit" disabled={!draft.trim() || busy || status !== "ready"} aria-label="Send">
      ↑
    </button>
    <div class="input-meta">
      <span class="live-dot"></span>
      {status === "ready" ? "Ready for this position" : detail}
    </div>
  </form>
</section>

<style>
.coach {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  height: auto;
  overflow: hidden;
  background: transparent;
}

header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 18px 20px 16px;
  border-bottom: 1px solid var(--line);
}

.coach-mark {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid #e5b9a9;
  border-radius: 50%;
  color: var(--coral-dark);
  background: var(--coral-soft);
  font-family: var(--display);
  font-size: 16px;
  font-weight: 650;
}

.coach-title {
  display: grid;
  min-width: 0;
  gap: 1px;
}

h2,
h3,
p {
  margin: 0;
}

.coach-title h2 {
  color: var(--ink);
  font-family: var(--display);
  font-size: 18px;
  font-variation-settings: "opsz" 20, "wght" 600;
}

.coach-title p {
  overflow: hidden;
  color: var(--muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--faint);
}

.status-dot.ready {
  background: var(--sage);
}

.status-dot.thinking {
  background: var(--coral);
  animation: pulse 1.2s ease-in-out infinite;
}

.new-conversation {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: var(--ink-soft);
  background: var(--paper);
  cursor: pointer;
}

.new-conversation:hover:not(:disabled) {
  border-color: var(--coral);
  color: var(--coral-dark);
  background: var(--coral-soft);
}

.new-conversation:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.new-conversation svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.messages {
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 24px 26px;
  overscroll-behavior: contain;
  scrollbar-color: var(--line-strong) transparent;
}

.welcome {
  padding: 35px 0 24px;
  text-align: left;
}

.welcome h3 {
  color: var(--ink);
  font-family: var(--display);
  font-size: 26px;
  font-variation-settings: "opsz" 28, "wght" 570;
}

.welcome p {
  max-width: 32ch;
  margin-top: 10px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
}

.suggestions {
  display: grid;
  gap: 0;
  border-top: 1px solid var(--line);
}

.suggestions button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  color: var(--ink-soft);
  background: transparent;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.suggestions button span {
  color: var(--coral-dark);
}

.suggestions button:hover:not(:disabled) {
  padding-inline: 8px;
  color: var(--coral-dark);
  background: var(--coral-soft);
}

.suggestions button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.message {
  display: block;
  margin: 18px 0;
}

.bubble {
  width: fit-content;
  max-width: 88%;
  margin-left: auto;
  padding: 10px 13px;
  overflow-wrap: anywhere;
  border: 0;
  border-radius: 12px 12px 2px;
  color: var(--ink);
  background: var(--coral-soft);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.assistant .bubble {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 5px 0 18px;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  color: var(--ink-soft);
  background: transparent;
  font-size: 14px;
  line-height: 1.65;
}

.bubble :global(strong) {
  color: var(--ink);
  font-weight: 700;
}

.bubble :global(em) {
  color: var(--coral-dark);
}

.bubble :global(code) {
  padding: 1px 4px;
  border-radius: 4px;
  color: var(--ink);
  background: var(--paper);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

.typing {
  margin-left: 3px;
  animation: pulse 1s infinite;
}

.activity {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 9px;
  align-items: center;
  margin: 12px 0 4px;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink-soft);
  background: rgba(255, 255, 255, 0.38);
}

.activity-spinner {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--line-strong);
  border-top-color: var(--coral-dark);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.activity.calling .activity-spinner,
.activity.waiting .activity-spinner {
  border-top-color: var(--sage);
}

.activity-copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.activity-copy strong {
  overflow: hidden;
  color: var(--ink);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-copy small {
  overflow: hidden;
  color: var(--muted);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

form {
  position: relative;
  margin: 0 18px 18px;
  padding: 10px 48px 25px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--pearl-raised);
  box-shadow: 0 8px 24px rgba(78, 61, 47, 0.08);
}

textarea {
  width: 100%;
  resize: none;
  border: 0;
  outline: 0;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
}

textarea::placeholder {
  color: var(--faint);
}

.send {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: grid;
  width: 31px;
  height: 31px;
  place-items: center;
  border: 0;
  border-radius: 50%;
  color: var(--pearl-raised);
  background: var(--ink);
  font-size: 18px;
  font-weight: 800;
  cursor: pointer;
}

.send:hover:not(:disabled) {
  background: var(--coral-dark);
}

.send:disabled {
  color: var(--faint);
  background: var(--paper);
  cursor: not-allowed;
}

.input-meta {
  position: absolute;
  left: 12px;
  bottom: 7px;
  display: flex;
  align-items: center;
  gap: 5px;
  max-width: calc(100% - 60px);
  overflow: hidden;
  color: var(--faint);
  font-size: 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-dot {
  flex: 0 0 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--sage);
}

@keyframes pulse {
  50% {
    opacity: 0.4;
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
