<script lang="ts">
  import { tick } from "svelte";
  import type { CoachActivity, CoachMessage } from "$lib/chess/types";
  import { renderCoachMarkdown } from "$lib/chat/markdown";

  let {
    messages,
    status,
    detail,
    activity,
    contextLabel,
    busy,
    onSend,
    onNewConversation,
    onRetry,
  }: {
    messages: CoachMessage[];
    status: "offline" | "starting" | "ready" | "thinking" | "error";
    detail: string;
    activity: CoachActivity | null;
    contextLabel: string;
    busy: boolean;
    onSend: (message: string) => void;
    onNewConversation: () => void;
    onRetry: () => void;
  } = $props();

  let draft = $state("");
  let messagesElement: HTMLDivElement;
  let composerElement: HTMLTextAreaElement;
  let followingLatest = $state(true);
  let showLatest = $state(false);
  let copiedMessage = $state("");
  const maximumMessageLength = 2_000;
  const suggested = [
    "Why was the last move played?",
    "What is the strongest plan here?",
    "Show me the tactical danger.",
  ];

  function submit() {
    const message = draft.trim();
    if (!message || busy || status !== "ready") return;
    draft = "";
    followingLatest = true;
    showLatest = false;
    onSend(message);
    void tick().then(() => {
      resizeComposer();
      composerElement?.focus();
    });
  }

  function startNewConversation() {
    draft = "";
    onNewConversation();
    void tick().then(() => {
      resizeComposer();
      composerElement?.focus();
    });
  }

  function sendSuggestion(message: string) {
    if (status !== "ready" || busy) return;
    followingLatest = true;
    showLatest = false;
    onSend(message);
  }

  function resizeComposer() {
    if (!composerElement) return;
    composerElement.style.height = "0px";
    composerElement.style.height = `${Math.min(composerElement.scrollHeight, 120)}px`;
  }

  function handleMessagesScroll() {
    if (!messagesElement) return;
    const distance =
      messagesElement.scrollHeight -
      messagesElement.scrollTop -
      messagesElement.clientHeight;
    followingLatest = distance < 56;
    showLatest = !followingLatest;
  }

  function scrollToLatest() {
    if (!messagesElement) return;
    followingLatest = true;
    showLatest = false;
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  async function copyResponse(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedMessage = id;
      window.setTimeout(() => {
        if (copiedMessage === id) copiedMessage = "";
      }, 1_500);
    } catch {
      copiedMessage = "";
    }
  }

  const composerStatus = $derived(
    status === "ready"
      ? "Ready for this position"
      : status === "thinking"
        ? "Sol is answering"
        : detail,
  );
  const canSend = $derived(Boolean(draft.trim()) && !busy && status === "ready");

  $effect(() => {
    messages.length;
    messages.at(-1)?.text;
    messages.at(-1)?.pending;
    activity?.label;
    activity?.detail;
    void tick().then(() => {
      if (messagesElement && followingLatest) {
        messagesElement.scrollTop = messagesElement.scrollHeight;
        showLatest = false;
      } else if (messagesElement) {
        showLatest = true;
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

  <div class="messages-shell">
    <div
      class="messages"
      bind:this={messagesElement}
      aria-live="polite"
      aria-busy={busy}
      onscroll={handleMessagesScroll}
    >
    {#if messages.length === 0}
      <div class="welcome">
        <h3>Ask about the game.</h3>
        <p>Sol can use the current position and the saved full-game review to explain what mattered.</p>
      </div>
      <div class="suggestions">
        {#each suggested as suggestion}
          <button type="button" onclick={() => sendSuggestion(suggestion)} disabled={status !== "ready" || busy}>
            {suggestion}
            <span aria-hidden="true">→</span>
          </button>
        {/each}
      </div>
    {:else}
      {#each messages as message (message.id)}
        {#if message.role === "assistant"}
          <article class="message assistant">
            <div class="message-byline">
              <span class="response-mark" aria-hidden="true">S</span>
              <div>
                <strong>Sol</strong>
                <small>{message.pending ? "Writing" : "Chess coach"}</small>
              </div>
              {#if message.text && !message.pending}
                <button
                  class="copy-response"
                  type="button"
                  onclick={() => copyResponse(message.id, message.text)}
                  aria-label={copiedMessage === message.id ? "Response copied" : "Copy response"}
                  title={copiedMessage === message.id ? "Copied" : "Copy response"}
                >
                  {#if copiedMessage === message.id}
                    <span>Copied</span>
                  {:else}
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="8" y="8" width="11" height="11" rx="2"></rect>
                      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
                    </svg>
                  {/if}
                </button>
              {/if}
            </div>
            {#if message.text}
              <div class="response-copy">
                {@html renderCoachMarkdown(message.text)}
                {#if message.pending}<span class="typing" aria-label="Response continues"></span>{/if}
              </div>
            {/if}
          </article>
        {:else}
          <div class="message user">
            <span class="user-label">You</span>
            <div class="bubble">{message.text}</div>
          </div>
        {/if}
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

    {#if status === "error"}
      <div class="coach-error" role="alert">
        <strong>Coach unavailable</strong>
        <span>{detail}</span>
      </div>
    {/if}
    </div>

    {#if showLatest}
      <button class="latest" type="button" onclick={scrollToLatest}>
        Latest response
        <span aria-hidden="true">↓</span>
      </button>
    {/if}
  </div>

  <form
    class:error={status === "error"}
    onsubmit={(event) => { event.preventDefault(); submit(); }}
    aria-label="Message Sol"
  >
    <div class="composer-row">
      <textarea
        bind:this={composerElement}
        bind:value={draft}
        placeholder={status === "offline" ? "Open the desktop app to chat…" : "Ask about this position…"}
        rows="1"
        maxlength={maximumMessageLength}
        disabled={status === "offline" || status === "starting"}
        aria-label="Ask Sol about this position"
        aria-describedby="coach-composer-meta"
        oninput={resizeComposer}
        onkeydown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      ></textarea>
      <button
        class="send"
        type="submit"
        disabled={!canSend}
        aria-label={busy ? "Wait for Sol to finish" : "Send message"}
        title="Send message"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m5 12 7-7 7 7M12 5v14"></path>
        </svg>
      </button>
    </div>
    <div class="input-meta" id="coach-composer-meta">
      <span class={`live-dot ${status}`}></span>
      <span class="composer-state">{composerStatus}</span>
      {#if status === "error"}
        <button class="retry-coach" type="button" onclick={onRetry}>Retry coach</button>
      {:else if draft.length > maximumMessageLength * 0.8}
        <span class="character-count">{draft.length}/{maximumMessageLength}</span>
      {:else}
        <span class="keyboard-hint"><kbd>Enter</kbd> send · <kbd>Shift Enter</kbd> new line</span>
      {/if}
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
  height: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px 24px 26px;
  overscroll-behavior: contain;
  scrollbar-color: var(--line-strong) transparent;
}

.messages-shell {
  position: relative;
  min-height: 0;
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
  margin: 22px 0;
}

.user {
  display: grid;
  justify-items: end;
  gap: 5px;
}

.user-label {
  padding-right: 3px;
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.user .bubble {
  width: fit-content;
  max-width: 88%;
  padding: 10px 14px;
  overflow-wrap: anywhere;
  border: 1px solid #ead6cd;
  border-radius: 12px 12px 2px;
  color: var(--ink);
  background: var(--coral-soft);
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.assistant {
  padding-bottom: 23px;
  border-bottom: 1px solid var(--line);
}

.message-byline {
  display: grid;
  grid-template-columns: 27px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}

.response-mark {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border: 1px solid #e5b9a9;
  border-radius: 50%;
  color: var(--coral-dark);
  background: var(--coral-soft);
  font-family: var(--display);
  font-size: 13px;
  font-weight: 650;
}

.message-byline > div {
  display: grid;
  gap: 0;
}

.message-byline strong {
  color: var(--ink);
  font-family: var(--display);
  font-size: 13px;
  font-weight: 650;
}

.message-byline small {
  color: var(--muted);
  font-size: 9px;
}

.copy-response {
  display: grid;
  min-width: 28px;
  height: 28px;
  place-items: center;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  font-size: 9px;
  cursor: pointer;
}

.copy-response:hover,
.copy-response:focus-visible {
  border-color: var(--line);
  color: var(--ink);
  background: var(--paper);
}

.copy-response svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

.response-copy {
  max-width: 66ch;
  overflow-wrap: anywhere;
  color: var(--ink-soft);
  font-size: 14px;
  line-height: 1.68;
}

.response-copy :global(p) {
  margin: 0 0 12px;
}

.response-copy :global(p:last-child) {
  margin-bottom: 0;
}

.response-copy :global(h3),
.response-copy :global(h4),
.response-copy :global(h5) {
  margin: 18px 0 7px;
  color: var(--ink);
  font-family: var(--display);
  font-size: 16px;
  font-weight: 620;
  line-height: 1.3;
}

.response-copy :global(h3:first-child),
.response-copy :global(h4:first-child),
.response-copy :global(h5:first-child) {
  margin-top: 0;
}

.response-copy :global(ul),
.response-copy :global(ol) {
  display: grid;
  gap: 6px;
  margin: 8px 0 14px;
  padding-left: 21px;
}

.response-copy :global(li::marker) {
  color: var(--coral-dark);
  font-weight: 700;
}

.response-copy :global(strong) {
  color: var(--ink);
  font-weight: 680;
}

.response-copy :global(em) {
  color: var(--coral-dark);
}

.response-copy :global(code) {
  padding: 2px 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink);
  background: var(--paper);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.88em;
}

.response-copy :global(pre) {
  margin: 12px 0;
  padding: 11px 12px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
}

.response-copy :global(pre code) {
  padding: 0;
  border: 0;
  background: transparent;
  white-space: pre;
}

.response-copy :global(blockquote) {
  margin: 12px 0;
  padding: 2px 0 2px 13px;
  border-left: 2px solid var(--coral);
  color: var(--muted);
}

.typing {
  display: inline-block;
  width: 5px;
  height: 1em;
  margin-left: 4px;
  border-radius: 2px;
  vertical-align: -2px;
  background: var(--coral-dark);
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

.coach-error {
  display: grid;
  gap: 2px;
  margin: 12px 0;
  padding: 10px 12px;
  border: 1px solid #e7b8a9;
  border-radius: 9px;
  color: var(--danger);
  background: var(--coral-soft);
}

.coach-error strong {
  font-size: 11px;
}

.coach-error span {
  font-size: 10px;
  line-height: 1.4;
}

.retry-coach {
  margin-left: auto;
  border: 0;
  padding: 0;
  color: var(--coral-dark);
  background: transparent;
  font: inherit;
  font-size: 9px;
  font-weight: 700;
  cursor: pointer;
}

.retry-coach:hover {
  text-decoration: underline;
}

.latest {
  position: absolute;
  bottom: 10px;
  left: 50%;
  z-index: 2;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--ink-soft);
  background: var(--pearl-raised);
  box-shadow: 0 4px 14px rgba(78, 61, 47, 0.1);
  font: inherit;
  font-size: 9px;
  font-weight: 650;
  transform: translateX(-50%);
  cursor: pointer;
}

form {
  margin: 0 18px 18px;
  padding: 11px 11px 8px 13px;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: var(--pearl-raised);
  box-shadow: 0 7px 20px rgba(78, 61, 47, 0.07);
}

form:focus-within {
  border-color: var(--coral-dark);
  box-shadow: 0 0 0 2px var(--coral-soft);
}

form.error {
  border-color: #df9e8b;
}

.composer-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 8px;
  align-items: end;
}

textarea {
  width: 100%;
  min-height: 34px;
  max-height: 120px;
  padding: 6px 0 5px;
  overflow-y: auto;
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
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 0;
  border-radius: 9px;
  color: var(--pearl-raised);
  background: var(--ink);
  cursor: pointer;
}

.send svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}

.send:hover:not(:disabled) {
  background: var(--coral-dark);
}

.send:focus-visible {
  outline: 2px solid var(--coral);
  outline-offset: 2px;
}

.send:disabled {
  color: var(--faint);
  background: var(--paper);
  cursor: not-allowed;
}

.input-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  margin-top: 3px;
  overflow: hidden;
  color: var(--faint);
  font-size: 8.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.live-dot {
  flex: 0 0 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--faint);
}

.live-dot.ready {
  background: var(--sage);
}

.live-dot.thinking {
  background: var(--coral);
}

.live-dot.error {
  background: var(--danger);
}

.composer-state {
  overflow: hidden;
  text-overflow: ellipsis;
}

.keyboard-hint,
.character-count {
  margin-left: auto;
  color: var(--muted);
}

kbd {
  font: inherit;
  font-weight: 650;
}

@media (max-width: 480px) {
  .messages {
    padding-inline: 18px;
  }

  .keyboard-hint {
    display: none;
  }

  form {
    margin-inline: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot.thinking,
  .typing,
  .activity-spinner {
    animation: none;
  }
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
