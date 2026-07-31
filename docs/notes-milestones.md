# ChessCave Notes milestones

## Product intent

Notes gives a player a quiet place to develop ideas beside their chess study:
opening plans, recurring mistakes, calculation habits, and position-specific
observations. It should feel as direct as Notion's page editor while remaining
visually and conceptually part of ChessCave.

“Notion-like” means adopting the useful interaction grammar:

- pages and nested pages in a persistent sidebar;
- content made from individually addressable blocks;
- direct editing with minimal permanent chrome;
- familiar Markdown shortcuts; and
- a keyboard-first `/` menu for inserting or transforming blocks.

It does **not** mean copying Notion's visual identity or attempting immediate
feature parity. ChessCave keeps its warm editorial typography, pearl surfaces,
coral focus, restrained motion, and local-first honesty.

## Source model and deliberate boundary

Notion's official description treats every unit—including a page—as a block.
Each block has an ID, type, properties, ordered content references, and a parent
reference. Edits become operations that are committed together as
transactions. This is the part of the model ChessCave needs. See
[The data model behind Notion's flexibility](https://www.notion.com/blog/data-model-behind-notion).

ChessCave Notes will begin as a local, single-user system. Collaboration,
accounts, permissions, databases, formulas, tables, comments, real-time sync,
public sharing, embeds, templates, and AI writing are outside the core build.
They must not shape the first schema or appear as inactive controls.

Markdown is an input and export format, not the source of truth. The block graph
is the source of truth.

## Foundation contract

The durable record is intentionally small:

```ts
type BlockId = string; // client-generated UUID v4

interface BlockRecord {
  id: BlockId;
  type: BlockType;
  properties: Record<string, unknown>;
  content: BlockId[];       // ordered downward references
  parentId: BlockId | null; // upward reference
  revision: number;
  createdAt: number;
  updatedAt: number;
}
```

Text-bearing blocks store rich-text runs under `properties.title`. A `page`
block stores its visible title in the same property and its document blocks in
`content`. A nested page is simply a page block whose parent is another page.

The first persisted block types are only:

```text
page
paragraph
```

Additional types arrive through migrations only when their behavior is ready.
Unknown block types must remain recoverable and must never be silently deleted.

### Persistence choice

The Rust host owns a local SQLite database under the application data
directory. The Svelte webview never writes SQLite directly. A small
`notes.rs` boundary owns migrations, validation, transactions, and Tauri
commands.

SQLite is justified here because a single editor action can change several
records—for example, creating a block and inserting its ID into its parent's
ordered content. Those changes must either all commit or all roll back.

The initial command boundary is:

```text
notes_bootstrap
notes_load_sidebar
notes_load_page
notes_apply_transaction
```

Transactions are made from a narrow operation vocabulary:

```text
create block
update properties
change type
insert child
move child
remove child
```

Every committed transaction must preserve these invariants:

1. Every ID is unique.
2. Every content reference resolves to an existing block.
3. A block appears at most once in a parent's content.
4. A child's `parentId` mirrors the parent that contains it.
5. No operation can create a parent cycle.
6. Sibling order is deterministic.
7. A rejected transaction leaves the database unchanged.

## Build order and gates

Each milestone is a stop/go boundary. Work on the next milestone begins only
after the current exit gate passes in automated tests and a desktop build.

| Milestone | Status | Depends on |
| --- | --- | --- |
| 0 · Durable block foundation | Complete · 2026-07-31 | — |
| 1 · Notes destination and page tree | Complete · 2026-07-31 | Milestone 0 |
| 2 · Reliable paragraph editor | Ready to begin | Milestone 1 |
| 3 · Essential document vocabulary | Gated | Milestone 2 |
| 4 · Slash menu and block transformation | Gated | Milestone 3 |
| 5 · Organization, recovery, and portability | Gated | Core Notes v1 |
| 6 · Chess-native notes | Gated | Core Notes v1 |

### Milestone 0 — Durable block foundation

**Outcome:** ChessCave can create, load, mutate, and reopen a block tree without
an editor UI.

**Scope**

- Add a versioned SQLite schema and migration runner.
- Implement `BlockRecord`, rich-text-run, transaction, and operation contracts
  in Rust and TypeScript.
- Generate block IDs on the client.
- Implement the four Tauri commands in the foundation contract.
- Apply every multi-block edit in one SQLite transaction.
- Add a serial client save queue so local UI state can update immediately while
  disk writes remain ordered.
- Add explicit saved, saving, and failed states to the client contract.
- Record a short architecture decision covering SQLite, block ownership, and
  the local-only boundary. See
  [ADR 0001: Local block store for ChessCave Notes](adr/0001-notes-block-store.md).

**Not in this milestone**

- A user-facing Notes route.
- Rich text, slash commands, drag and drop, or Markdown conversion.
- Collaboration or a network transaction queue.

**Exit gate**

- A fresh database migrates to the current schema.
- A root page, nested page, and paragraphs survive process restart with order
  intact.
- Transaction rollback is proven by an injected invalid operation.
- Tests reject orphan references, duplicate children, mismatched parents, and
  cycles.
- A migration test upgrades a previous fixture without data loss.
- Rust tests, Svelte checks, and a Tauri desktop build pass.

**Completion record · 2026-07-31**

- SQLite schema 1 and its migration runner are implemented.
- Rust and TypeScript share the block, operation, snapshot, and transaction
  contracts.
- Tauri exposes bootstrap, sidebar, page-chunk, and transaction commands.
- The client save queue preserves failed work and resumes in order on retry.
- Restart, migration, rollback, stale-revision, missing-reference,
  duplicate-child, parent-mismatch, cycle, and camel-case transport tests pass.
- Svelte checks, all frontend tests, Rust tests, strict Clippy, and a Tauri
  debug build pass.

### Milestone 1 — Notes destination and page tree

**Outcome:** Selecting **Notes** in the global ChessCave navigation opens a real
notes destination with persistent root and nested pages.

**Scope**

- Extract shared application chrome instead of adding more state to the current
  study page.
- Add a static `/notes` route; keep the selected page in the URL query so Tauri
  deep linking remains simple.
- Add clear global destinations for **Study** and **Notes**.
- Build a recursive page sidebar with create, select, rename, expand, collapse,
  and “new sub-page.”
- Restore the last open page and expansion state locally.
- Show the selected page title and a single immediately editable paragraph in
  the main pane, with debounced local persistence.
- Use a drawer for the page tree on narrow windows.
- Provide complete keyboard focus and navigation for the tree.

**Visual direction**

- One quiet sidebar surface and one reading surface; no field of cards.
- Fraunces for the page title, DM Sans for navigation and editable body text.
- Coral indicates focus or the selected destination, not decoration.
- The empty state is simply an untitled page ready for input.

**Not in this milestone**

- Page drag-and-drop, trash, search, rich block types, or a slash menu.

**Exit gate**

- Root and nested pages can be created, renamed, selected, and reopened.
- Sidebar hierarchy always matches the stored block hierarchy.
- Browser back/forward restores page selection.
- Tree interactions work by pointer and keyboard at desktop and narrow widths.
- No study-page state or keyboard shortcut leaks into `/notes`.

**Completion record · 2026-07-31**

- Shared ChessCave chrome now exposes clear **Study** and **Notes**
  destinations without coupling their route state.
- `/notes` restores URL-selected and last-open pages, while the persistent
  recursive sidebar supports root pages, nested pages, rename, expand, and
  collapse.
- The page tree follows WAI-style arrow, Home, End, and F2 keyboard behavior;
  its state resolution is covered independently of the DOM.
- The narrow layout converts the page tree into a dismissible drawer.
- Page titles and the initial plain paragraph persist through the ordered save
  queue. The paragraph fills the remaining document height without field or
  quote chrome.
- New Notes and shared-chrome controls use individually imported Phosphor
  icons.
- Frontend type checks, 32 Bun tests, 10 Rust tests, strict Clippy, the
  static production build, and the Tauri debug executable build pass.

### Milestone 2 — Reliable paragraph editor

**Outcome:** A user can write and revise a plain block document naturally, and
their work is durable.

**Scope**

- Render one editable surface per paragraph block.
- Support click-to-edit, `Enter` to split, `Backspace` at an empty boundary to
  merge/remove, and arrow-key movement between blocks.
- Support page-title editing and plain-text multiline paste.
- Apply edits locally first, then persist them through the ordered save queue.
- Show a quiet save error only when action is required.
- Add transaction-based undo and redo for the current editing session.
- Preserve selection across block splits, merges, saves, and rerenders.
- Test composition events so IME input is not corrupted.

**Implementation constraint**

The stored block model must remain independent of the rendering library. Begin
with focused platform `contenteditable` behavior. Introduce a heavier editor
framework only if the selection, IME, accessibility, and mapping tests show the
platform approach cannot meet the exit gate.

**Exit gate**

- A 100-paragraph document can be typed, split, merged, pasted, undone, saved,
  closed, and reopened without lost or reordered text.
- Rapid typing never waits for a disk round trip.
- Save failure preserves the unsaved local text and offers a clear retry.
- Screen-reader labels, focus order, IME input, and reduced-motion behavior are
  verified.

### Milestone 3 — Essential document vocabulary

**Outcome:** Notes supports the small Markdown vocabulary needed for useful
chess writing.

**Block types**

- paragraph;
- heading 1, heading 2, and heading 3;
- bulleted-list item;
- numbered-list item;
- to-do item;
- quote;
- divider; and
- code block.

**Inline marks**

- bold;
- italic;
- inline code; and
- link.

**Behavior**

- Recognize start-of-block shortcuts such as `# `, `## `, `- `, `1. `, `[] `,
  `> `, and triple backticks.
- Transform the existing block without replacing its ID or losing compatible
  properties.
- Treat indentation as structure: `Tab` nests a supported list item under its
  preceding sibling; `Shift+Tab` moves it up.
- Render unsupported stored properties harmlessly so type transformation does
  not destroy user intent.

**Not in this milestone**

- Images, files, tables, columns, databases, mentions, colors, or arbitrary
  layout controls.

**Exit gate**

- Every block type round-trips through SQLite and process restart.
- Markdown shortcuts transform only at valid boundaries and remain ordinary
  text elsewhere.
- Type changes preserve block IDs, children, and compatible properties.
- Nested lists maintain valid parent/content relationships through undo, redo,
  and restart.
- All rendered blocks use correct document semantics.

### Milestone 4 — Slash menu and block transformation

**Outcome:** Typing `/` in an empty block exposes the supported block vocabulary
without adding a permanent toolbar.

**Scope**

- Open a positioned command menu from `/` at a valid block boundary.
- Search commands by label and a small set of plain-language aliases.
- Navigate with arrow keys, choose with `Enter`, and dismiss with `Escape`.
- Offer only implemented actions: Text, Heading 1–3, Bulleted list, Numbered
  list, To-do, Quote, Divider, Code, and Page.
- Use the same type-change operation as Markdown shortcuts.
- Let `/page` create a nested page block and focus its title.
- Add an accessible “Turn into” route for pointer-only and assistive-technology
  users instead of making slash syntax the sole control.

**Exit gate**

- The menu tracks the active block during scroll and window resize.
- Keyboard and pointer selection produce identical transactions.
- Filtering, empty results, escape, focus restoration, and reduced motion are
  tested.
- No command is shown before its underlying behavior passes its own tests.

**Core Notes v1 gate**

At the end of Milestone 4, Notes is considered a usable core product: durable
pages, nested navigation, paragraph editing, essential Markdown blocks, and a
slash menu. Only then should scope expand.

### Milestone 5 — Organization, recovery, and portability

**Outcome:** A growing notes collection remains navigable and recoverable.

**Scope**

- Reorder and reparent pages with drag-and-drop plus a keyboard alternative.
- Add breadcrumbs for deeply nested pages.
- Add title search across pages.
- Add archive/trash, restore, and permanent-delete confirmation.
- Add duplicate-page behavior with regenerated IDs and preserved hierarchy.
- Add Markdown export for a page subtree and a conservative Markdown import.
- Add block reorder handles only if pointer and keyboard movement share one
  transaction path.

**Exit gate**

- Moving a page cannot create cycles or lose descendants.
- Archived pages disappear from the active tree and restore to a valid parent.
- Duplicate and import operations never reuse source IDs.
- Exported Markdown preserves all supported blocks without hidden metadata.
- A large-tree fixture remains navigable and responsive, with a recorded
  performance baseline rather than an invented marketing claim.

### Milestone 6 — Chess-native notes

**Outcome:** Notes becomes part of ChessCave rather than a generic document
editor.

**Scope**

- Add a `chess_position` block containing an immutable FEN snapshot plus
  optional game-review key, ply, orientation, and user caption.
- Add `/position` to insert the currently selected study position when one is
  available.
- Add **Add to Notes** from Study, with an explicit destination page choice.
- Render a compact local board preview using existing ChessCave piece artwork.
- Open the referenced game/ply when the original local study still exists;
  otherwise show the preserved snapshot honestly.
- Make position blocks readable by Sol only through an explicit, read-only
  Notes MCP contract introduced in this milestone.

**Exit gate**

- A position note remains visually and semantically valid if its source game or
  review cache is removed.
- Navigating between Study and Notes restores both contexts.
- MCP access is read-only, scoped to the selected note, and never exposes the
  entire notes database implicitly.
- Position blocks export a FEN and human-readable caption in Markdown.

## Ethos checks applied to every milestone

| Ethos principle | Notes decision |
| --- | --- |
| Useful | Page hierarchy and writing come before databases, decoration, or AI. |
| Aesthetic | Notion's interaction grammar is expressed with ChessCave's own type, color, spacing, and material. |
| Understandable | Sidebar hierarchy, page title, and document flow communicate structure before helper text. |
| Unobtrusive | Formatting appears contextually through shortcuts and `/`, not a permanent control wall. |
| Honest | The UI says saved, saving, local-only, or failed; it never implies cloud sync or collaboration. |
| Long-lasting | Stable block IDs, versioned migrations, and a small operation vocabulary precede visual polish. |
| Thorough | Keyboard, focus, IME, restart, rollback, error, narrow-window, and reduced-motion cases are gates. |
| Environmentally responsible | The local database loads only the selected tree/page; new dependencies require a measured benefit. |
| As little design as possible | Unsupported Notion features do not appear, even as placeholders. |

Before adding any later capability, the ChessCave working test still applies:
what user need does it serve, can structure explain it, is its state truthful,
does it reuse the existing language, and what becomes worse if it is removed?

## Known architectural risks

1. **The current study page is monolithic.** Notes must receive its own route
   and domain modules; shared chrome should be extracted rather than copying or
   enlarging the study component.
2. **Parent and content references are intentionally redundant.** All
   relationship edits must pass through one validated Rust transaction path.
3. **Browser selection APIs have edge cases.** The paragraph milestone is kept
   separate from rich formatting so selection, paste, IME, and undo can be
   proven before the vocabulary expands.
4. **A Notion clone can become an endless scope.** The Core Notes v1 gate is
   explicit, and every post-core feature must justify itself as ChessCave work.
5. **Local-only must remain legible.** Portability and recovery arrive before
   any future sync work, and no UI should suggest that notes already exist in
   the cloud.

## Immediate next step

Milestone 0 has passed its exit gate. Milestone 1—Notes destination and page
tree—is now ready to begin. Editor behavior remains gated until the page tree
passes its own persistence, routing, keyboard, and responsive-layout checks.
