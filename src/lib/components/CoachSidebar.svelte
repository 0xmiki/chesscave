<script lang="ts">
  import type { CoachMessage } from "$lib/chess/types";

  let {
    messages,
    status,
    detail,
    busy,
    onSend,
    onNewConversation,
  }: {
    messages: CoachMessage[];
    status: "offline" | "starting" | "ready" | "thinking" | "error";
    detail: string;
    busy: boolean;
    onSend: (message: string) => void;
    onNewConversation: () => void;
  } = $props();

  let draft = $state("");
  const suggested = [
    "Why was the last move played?",
    "What is the strongest plan here?",
    "Show me the tactical danger.",
  ];

  function submit() {
    const message = draft.trim();
    if (!message || busy || status === "offline") return;
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
</script>

<aside class="coach">
  <header>
    <div class="coach-mark">S</div>
    <div>
      <div class="eyebrow">PERSONAL COACH</div>
      <h2>Ask Sol</h2>
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

  <div class="context-card">
    <div class="context-icon">⌁</div>
    <div>
      <strong>Board aware</strong>
      <span>{detail}</span>
    </div>
  </div>

  <div class="messages" aria-live="polite">
    {#if messages.length === 0}
      <div class="welcome">
        <div class="spark">✦</div>
        <h3>Let’s study this position.</h3>
        <p>I can ask Stockfish for concrete lines, then help you understand the ideas behind them.</p>
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
          {#if message.role === "assistant"}
            <span class="avatar">S</span>
          {/if}
          <div class="bubble">
            {@html renderMarkdown(message.text || "Thinking")}
            {#if message.pending}<span class="typing">···</span>{/if}
          </div>
        </div>
      {/each}
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
    <button class="send" type="submit" disabled={!draft.trim() || busy || status === "offline"} aria-label="Send">
      ↑
    </button>
    <div class="input-meta">
      <span class="live-dot"></span>
      {status === "ready" ? "Codex + Stockfish ready" : detail}
    </div>
  </form>
</aside>

<style>
  .coach {
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    border-left: 1px solid #333730;
    background:
      radial-gradient(circle at 80% -10%, rgba(99, 142, 70, 0.12), transparent 30%),
      #222521;
  }

  header {
    display: grid;
    grid-template-columns: 38px 1fr auto;
    gap: 11px;
    align-items: center;
    padding: 18px 20px 14px;
  }

  .coach-mark,
  .avatar {
    display: grid;
    place-items: center;
    width: 36px;
    aspect-ratio: 1;
    border-radius: 11px;
    color: #15210f;
    background: linear-gradient(145deg, #a8d28b, #78a85a);
    font-family: Georgia, serif;
    font-size: 19px;
    font-weight: 800;
    box-shadow: 0 5px 16px rgba(73, 113, 47, 0.22);
  }

  .eyebrow {
    color: #8fa881;
    font-size: 9px;
    font-weight: 850;
    letter-spacing: 0.16em;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    margin-top: 1px;
    color: #f0f2ec;
    font-family: Georgia, serif;
    font-size: 19px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #6d716a;
    box-shadow: 0 0 0 4px rgba(109, 113, 106, 0.09);
  }

  .status-dot.ready {
    background: #88b96a;
    box-shadow: 0 0 0 4px rgba(136, 185, 106, 0.1);
  }

  .status-dot.thinking {
    background: #d3a84f;
    animation: pulse 1.2s ease-in-out infinite;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .new-conversation {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid #3b4038;
    border-radius: 8px;
    color: #aeb5aa;
    background: #292d27;
    cursor: pointer;
  }

  .new-conversation:hover:not(:disabled) {
    border-color: #668456;
    color: #dce8d5;
    background: #30362d;
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

  .context-card {
    display: flex;
    gap: 11px;
    align-items: center;
    margin: 0 16px 12px;
    padding: 11px 13px;
    border: 1px solid #393e36;
    border-radius: 10px;
    background: #292d27;
  }

  .context-icon {
    color: #9dc183;
    font-size: 24px;
  }

  .context-card strong,
  .context-card span {
    display: block;
  }

  .context-card strong {
    color: #e2e5de;
    font-size: 12px;
  }

  .context-card span {
    max-width: 260px;
    overflow: hidden;
    color: #8f958c;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .messages {
    min-height: 0;
    overflow: auto;
    padding: 10px 18px 20px;
    scrollbar-color: #4b5048 transparent;
  }

  .welcome {
    padding: 28px 8px 21px;
    text-align: center;
  }

  .spark {
    margin-bottom: 12px;
    color: #a7ce8d;
    font-size: 24px;
  }

  h3 {
    color: #e9ebe6;
    font-family: Georgia, serif;
    font-size: 18px;
  }

  .welcome p {
    max-width: 270px;
    margin: 9px auto 0;
    color: #979d94;
    font-size: 12px;
    line-height: 1.55;
  }

  .suggestions {
    display: grid;
    gap: 7px;
  }

  .suggestions button {
    display: flex;
    justify-content: space-between;
    padding: 11px 12px;
    border: 1px solid #393d37;
    border-radius: 9px;
    color: #cbd0c7;
    background: #292c28;
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }

  .suggestions button:hover:not(:disabled) {
    border-color: #5f7950;
    background: #30352e;
  }

  .suggestions button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  .message {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin: 12px 0;
  }

  .message.assistant {
    justify-content: flex-start;
  }

  .message .avatar {
    flex: 0 0 25px;
    width: 25px;
    height: 25px;
    border-radius: 8px;
    font-size: 13px;
  }

  .bubble {
    max-width: 82%;
    padding: 10px 12px;
    border-radius: 12px 12px 3px 12px;
    color: #f0f1ed;
    background: #4f713e;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .assistant .bubble {
    border: 1px solid #393d37;
    border-radius: 3px 12px 12px;
    color: #daddd6;
    background: #292c28;
  }

  .bubble :global(strong) {
    color: #f0f2ec;
    font-weight: 780;
  }

  .bubble :global(em) {
    color: #c8d9be;
  }

  .bubble :global(code) {
    padding: 1px 4px;
    border-radius: 4px;
    color: #c7dfb8;
    background: #1e211d;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
  }

  .typing {
    margin-left: 3px;
    animation: pulse 1s infinite;
  }

  form {
    position: relative;
    margin: 0 16px 16px;
    padding: 10px 48px 25px 12px;
    border: 1px solid #42473f;
    border-radius: 12px;
    background: #2c302b;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.17);
  }

  textarea {
    width: 100%;
    resize: none;
    border: 0;
    outline: 0;
    color: #edf0e9;
    background: transparent;
    font: inherit;
    font-size: 12px;
    line-height: 1.45;
  }

  textarea::placeholder {
    color: #7e847b;
  }

  .send {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: grid;
    place-items: center;
    width: 31px;
    height: 31px;
    border: 0;
    border-radius: 9px;
    color: #172210;
    background: #90bd72;
    font-size: 18px;
    font-weight: 800;
    cursor: pointer;
  }

  .send:disabled {
    color: #767b73;
    background: #3b4039;
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
    color: #767c73;
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .live-dot {
    flex: 0 0 4px;
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: #7ca963;
  }

  @keyframes pulse {
    50% {
      opacity: 0.4;
    }
  }
</style>
