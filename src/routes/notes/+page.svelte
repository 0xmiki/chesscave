<script lang="ts">
  import { onMount, tick } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import AppHeader from "$lib/components/AppHeader.svelte";
  import NotePageTree from "$lib/components/NotePageTree.svelte";
  import ParagraphBlockEditor from "$lib/components/ParagraphBlockEditor.svelte";
  import {
    applyMarkdownBlockShortcut,
    continuationBlockType,
    indentListItem,
    insertParagraph,
    matchMarkdownBlockShortcut,
    mergeParagraphBackward,
    noteBlockText,
    outdentListItem,
    pastePlainText,
    parseInlineMarkdown,
    removeDividerBackward,
    replaceBlockRuns,
    splitParagraph,
    richTextProperties,
    toggleTodo,
    transformTextBlock,
    transformToDivider,
    trailingParagraph,
    type EditorChange,
    type EditorSelection,
  } from "$lib/notes/editor";
  import { NotesSaveQueue, type NotesSaveState } from "$lib/notes/save-queue";
  import { createPageTransaction } from "$lib/notes/page-operations";
  import {
    collectPageSubtreeIds,
    deletionFallbackPageId,
    notePageTitle,
  } from "$lib/notes/tree";
  import IconArrowRightRegular from "phosphor-icons-svelte/IconArrowRightRegular.svelte";
  import IconArrowClockwiseRegular from "phosphor-icons-svelte/IconArrowClockwiseRegular.svelte";
  import IconArrowCounterClockwiseRegular from "phosphor-icons-svelte/IconArrowCounterClockwiseRegular.svelte";
  import IconCheckCircleRegular from "phosphor-icons-svelte/IconCheckCircleRegular.svelte";
  import IconCheckBold from "phosphor-icons-svelte/IconCheckBold.svelte";
  import IconFileTextRegular from "phosphor-icons-svelte/IconFileTextRegular.svelte";
  import IconListRegular from "phosphor-icons-svelte/IconListRegular.svelte";
  import IconPlusBold from "phosphor-icons-svelte/IconPlusBold.svelte";
  import IconSpinnerGapRegular from "phosphor-icons-svelte/IconSpinnerGapRegular.svelte";
  import {
    createNoteBlock,
    isTextNoteBlockType,
    type NoteBlockRecord,
    type NoteOperation,
    type NotesPageChunk,
    type NotesTransactionResult,
    type RichTextRun,
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
  interface TypingSession {
    before: NotesPageChunk;
    beforeOffset: number;
    afterOffset: number;
    timer: ReturnType<typeof setTimeout> | null;
  }

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
  let pageTitleElement = $state<HTMLTextAreaElement>();
  let focusRequest = $state<
    (EditorSelection & { token: number }) | null
  >(null);
  let undoStack = $state<EditorChange[]>([]);
  let redoStack = $state<EditorChange[]>([]);
  let typingActive = $state(false);
  let focusToken = 0;
  const typingSessions = new Map<string, TypingSession>();
  const pendingDocuments = new Map<string, NotesPageChunk>();
  const historyByPage = new Map<
    string,
    { undo: EditorChange[]; redo: EditorChange[] }
  >();

  const requestedPageId = $derived(page.url.searchParams.get("page"));
  const selectedPage = $derived(
    pages.find((candidate) => candidate.id === requestedPageId) ?? null,
  );
  const activePageChunk = $derived(
    pageChunk?.rootId === selectedPage?.id ? pageChunk : null,
  );
  const selectedRoot = $derived(
    activePageChunk?.blocks.find(
      (block) => block.id === activePageChunk.rootId,
    ) ??
      selectedPage,
  );
  const chunkBlocks = $derived(
    new Map((activePageChunk?.blocks ?? []).map((block) => [block.id, block])),
  );
  $effect(() => {
    const title = selectedPage ? notePageTitle(selectedPage) : "";
    void title;
    void tick().then(() => {
      if (pageTitleElement) resizePageTitle(pageTitleElement);
    });
  });

  onMount(() => {
    const unsubscribe = saveQueue.subscribe((state) => {
      saveState = state;
      if (state.status === "saved" && state.pending === 0) {
        pendingDocuments.clear();
      }
    });
    try {
      const saved = localStorage.getItem("chesscave.notes.expanded.v1");
      if (saved) expandedIds = JSON.parse(saved);
    } catch {
      localStorage.removeItem("chesscave.notes.expanded.v1");
    }
    void initialize();
    return () => {
      finalizeAllTyping();
      unsubscribe();
    };
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
      if (cycle === pageLoadCycle) {
        clearTypingSessions();
        const pending = pendingDocuments.get(id);
        const sidebarPage = pages.find((block) => block.id === id);
        const loaded = pending ?? next;
        pageChunk = sidebarPage
          ? {
              ...loaded,
              blocks: loaded.blocks.map((block) =>
                block.id === id
                  ? { ...block, properties: sidebarPage.properties }
                  : block,
              ),
            }
          : loaded;
        const history = historyByPage.get(id);
        undoStack = history?.undo ?? [];
        redoStack = history?.redo ?? [];
        focusRequest = null;
      }
    } catch (cause) {
      if (cycle === pageLoadCycle) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    } finally {
      if (cycle === pageLoadCycle) pageLoading = false;
    }
  }

  function selectPage(id: string, replaceState = false) {
    finalizeAllTyping();
    cacheCurrentDocument();
    cacheCurrentHistory();
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
    const parent = parentId
      ? pages.find((candidate) => candidate.id === parentId)
      : null;
    const index = parent ? parent.content.length : rootPageIds.length;
    const { page: nextPage, operations } = createPageTransaction(
      parentId,
      index,
    );

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

  async function deletePage(id: string) {
    if (mutationBusy || !nativeHost) return;
    finalizeAllTyping();
    const deletedPageIds = collectPageSubtreeIds(pages, id);
    if (!deletedPageIds.length) return;
    const deleted = new Set(deletedPageIds);
    const selectedId = selectedPage?.id ?? null;
    const selectedWasDeleted = Boolean(selectedId && deleted.has(selectedId));
    const fallbackId = deletionFallbackPageId(rootPageIds, pages, id);
    mutationBusy = true;
    error = "";

    try {
      await saveQueue.enqueue([{ kind: "deleteSubtree", id }]);
      for (const pageId of deletedPageIds) {
        pendingDocuments.delete(pageId);
        historyByPage.delete(pageId);
      }
      persistExpanded(expandedIds.filter((pageId) => !deleted.has(pageId)));
      await refreshSidebar();

      if (selectedWasDeleted) {
        clearTypingSessions();
        pageLoadCycle += 1;
        pageChunk = null;
        undoStack = [];
        redoStack = [];
        focusRequest = null;
        const nextId = fallbackId && pages.some((page) => page.id === fallbackId)
          ? fallbackId
          : rootPageIds[0];
        if (nextId) selectPage(nextId, true);
        else clearPageSelection();
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      mutationBusy = false;
    }
  }

  function clearPageSelection() {
    localStorage.removeItem("chesscave.notes.last-page.v1");
    const url = new URL(page.url);
    url.searchParams.delete("page");
    void goto(`${url.pathname}${url.search}`, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  function renamePage(id: string, title: string) {
    const current = pages.find((candidate) => candidate.id === id);
    if (!current) return;
    const normalized = title.replace(/[\r\n]+/g, " ").trim() || "Untitled";
    if (normalized === notePageTitle(current)) return;
    const properties = {
      ...current.properties,
      title: [{ text: normalized }],
    };
    pages = pages.map((pageBlock) =>
      pageBlock.id === id ? { ...pageBlock, properties } : pageBlock
    );
    const currentChunk = pageChunk;
    if (currentChunk?.rootId === id) {
      pageChunk = {
        ...currentChunk,
        blocks: currentChunk.blocks.map((block) =>
          block.id === id ? { ...block, properties } : block
        ),
      };
      cacheCurrentDocument();
    }
    persistEditorOperations([
      { kind: "updateProperties", id, properties },
    ]);
  }

  function blockText(block: NoteBlockRecord): string {
    return block.properties.title.map((run) => run.text).join("");
  }

  interface RenderGroup {
    kind:
      | "block"
      | "bulleted_list_item"
      | "numbered_list_item"
      | "to_do";
    blocks: NoteBlockRecord[];
  }

  function groupRenderChildren(childIds: string[]): RenderGroup[] {
    const groups: RenderGroup[] = [];
    for (const id of childIds) {
      const block = chunkBlocks.get(id);
      if (!block) continue;
      let kind: RenderGroup["kind"] = "block";
      if (block.type === "bulleted_list_item") kind = "bulleted_list_item";
      else if (block.type === "numbered_list_item") {
        kind = "numbered_list_item";
      } else if (block.type === "to_do") kind = "to_do";
      const previous = groups.at(-1);
      if (kind !== "block" && previous?.kind === kind) {
        previous.blocks.push(block);
      } else {
        groups.push({ kind, blocks: [block] });
      }
    }
    return groups;
  }

  function handleParagraphInput(
    id: string,
    runs: RichTextRun[],
    beforeOffset: number,
    offset: number,
    composing: boolean,
  ) {
    const current = pageChunk;
    const block = current?.blocks.find((candidate) => candidate.id === id);
    if (!current || !block || !isTextNoteBlockType(block.type)) return;
    const text = runs.map((run) => run.text).join("");

    let session = typingSessions.get(id);
    if (!session) {
      session = {
        before: current,
        beforeOffset: Math.min(beforeOffset, noteBlockText(block).length),
        afterOffset: offset,
        timer: null,
      };
      typingSessions.set(id, session);
      typingActive = true;
    }
    session.afterOffset = offset;
    const updated: NotesPageChunk = {
      ...current,
      blocks: current.blocks.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              properties: richTextProperties(candidate.properties, runs),
            }
          : candidate,
      ),
    };
    pageChunk = updated;
    cacheCurrentDocument();
    if (!composing) {
      const shortcut = matchMarkdownBlockShortcut(text, offset);
      if (shortcut) {
        discardTyping(id);
        try {
          const change = shortcut.type === "divider"
            ? transformToDivider(
                updated,
                id,
                createNoteBlock("paragraph"),
                offset,
              )
            : applyMarkdownBlockShortcut(updated, id, shortcut, offset);
          applyEditorChange(change);
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
        }
        return;
      }
      scheduleTypingCommit(id);
    }
  }

  function scheduleTypingCommit(id: string) {
    const session = typingSessions.get(id);
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => {
      session.timer = null;
      finalizeTyping(id);
    }, 450);
  }

  function handleParagraphCommit(id: string, offset: number) {
    const session = typingSessions.get(id);
    if (session) session.afterOffset = offset;
    finalizeTyping(id);
    normalizeInlineMarkdown(id, offset);
  }

  function discardTyping(id: string) {
    const session = typingSessions.get(id);
    if (session?.timer) clearTimeout(session.timer);
    typingSessions.delete(id);
    typingActive = typingSessions.size > 0;
  }

  function normalizeInlineMarkdown(id: string, offset: number) {
    const current = pageChunk;
    const block = current?.blocks.find((candidate) => candidate.id === id);
    if (!current || !block || !isTextNoteBlockType(block.type)) return;
    if (block.properties.title.some(
      (run) => run.bold || run.italic || run.code || run.link,
    )) return;
    const parsed = parseInlineMarkdown(noteBlockText(block), offset);
    if (!parsed.changed) return;
    applyEditorChange(
      replaceBlockRuns(current, id, parsed.runs, offset, parsed.offset),
      false,
    );
  }

  function finalizeTyping(id: string) {
    const session = typingSessions.get(id);
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    typingSessions.delete(id);
    typingActive = typingSessions.size > 0;

    const current = pageChunk;
    const currentBlock = current?.blocks.find((block) => block.id === id);
    const beforeBlock = session.before.blocks.find((block) => block.id === id);
    if (
      !current ||
      !currentBlock ||
      !beforeBlock ||
      current.rootId !== session.before.rootId
    ) {
      return;
    }
    const currentText = noteBlockText(currentBlock);
    if (JSON.stringify(currentBlock.properties.title) ===
      JSON.stringify(beforeBlock.properties.title)) return;
    const base = replaceBlockRuns(
      session.before,
      id,
      currentBlock.properties.title,
      session.beforeOffset,
      session.afterOffset,
    );
    const change: EditorChange = {
      ...base,
      label: "typing",
      after: current,
      afterSelection: {
        blockId: id,
        offset: Math.min(session.afterOffset, currentText.length),
      },
    };
    pushHistory(change);
    persistEditorOperations(change.forward);
  }

  function finalizeAllTyping() {
    for (const id of [...typingSessions.keys()]) finalizeTyping(id);
  }

  function clearTypingSessions() {
    for (const session of typingSessions.values()) {
      if (session.timer) clearTimeout(session.timer);
    }
    typingSessions.clear();
    typingActive = false;
  }

  function pushHistory(change: EditorChange) {
    undoStack = [...undoStack, change];
    redoStack = [];
    cacheCurrentHistory();
  }

  function applyEditorChange(change: EditorChange, focus = true) {
    pageChunk = change.after;
    cacheCurrentDocument();
    pushHistory(change);
    persistEditorOperations(change.forward);
    if (focus) requestEditorFocus(change.afterSelection);
  }

  function persistEditorOperations(operations: NoteOperation[]) {
    error = "";
    void saveQueue
      .enqueue(operations)
      .then(mergeCommittedResult)
      .catch((cause) => {
        error = cause instanceof Error ? cause.message : String(cause);
      });
  }

  function mergeCommittedResult(result: NotesTransactionResult) {
    const current = pageChunk;
    if (!current) return;
    const committed = new Map(result.blocks.map((block) => [block.id, block]));
    const localById = new Map(current.blocks.map((block) => [block.id, block]));
    pageChunk = {
      ...current,
      blocks: current.blocks.map((local) => {
        const stored = committed.get(local.id);
        return stored
          ? {
              ...stored,
              type: local.type,
              properties: local.properties,
              content: local.content,
              parentId: local.parentId,
            }
          : local;
      }),
    };
    if (saveState.status !== "saved" || saveState.pending > 0) {
      cacheCurrentDocument();
    }
    pages = pages.map((local) => {
      const stored = committed.get(local.id);
      const documentVersion = localById.get(local.id);
      return stored?.type === "page"
        ? {
            ...stored,
            properties: local.properties,
            content: documentVersion?.content ?? stored.content,
          }
        : local;
    });
  }

  function handleSplitParagraph(id: string, start: number, end: number) {
    finalizeTyping(id);
    const current = pageChunk;
    const block = current?.blocks.find((candidate) => candidate.id === id);
    if (!current || !block || !isTextNoteBlockType(block.type)) return;
    try {
      if (!noteBlockText(block) && block.type !== "paragraph") {
        applyEditorChange(
          transformTextBlock(
            current,
            id,
            "paragraph",
            block.properties.title,
            start,
            0,
          ),
        );
        return;
      }
      applyEditorChange(
        splitParagraph(
          current,
          id,
          start,
          createNoteBlock(continuationBlockType(block.type)),
          end,
        ),
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function handleMergeBackward(id: string): boolean {
    finalizeTyping(id);
    const current = pageChunk;
    if (!current) return false;
    try {
      const change = mergeParagraphBackward(current, id) ??
        removeDividerBackward(current, id);
      if (!change) return false;
      applyEditorChange(change);
      return true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }

  function handleParagraphMove(
    id: string,
    direction: "previous" | "next",
  ): boolean {
    finalizeTyping(id);
    const current = pageChunk;
    if (!current) return false;
    const editableIds = editableBlockIds(current);
    const index = editableIds.indexOf(id);
    const targetId = editableIds[index + (direction === "previous" ? -1 : 1)];
    if (!targetId) return false;
    const target = pageChunk?.blocks.find((block) => block.id === targetId);
    requestEditorFocus({
      blockId: targetId,
      offset: direction === "previous" && target
        ? noteBlockText(target).length
        : 0,
    });
    return true;
  }

  function editableBlockIds(chunk: NotesPageChunk): string[] {
    const byId = new Map(chunk.blocks.map((block) => [block.id, block]));
    const root = byId.get(chunk.rootId);
    if (!root) return [];
    const ordered: string[] = [];
    function visit(ids: string[]) {
      for (const id of ids) {
        const block = byId.get(id);
        if (!block || block.type === "page") continue;
        if (isTextNoteBlockType(block.type)) ordered.push(id);
        if (block.content.length) visit(block.content);
      }
    }
    visit(root.content);
    return ordered;
  }

  function handleIndent(id: string, offset: number): boolean {
    finalizeTyping(id);
    const current = pageChunk;
    if (!current) return false;
    try {
      const change = indentListItem(current, id, offset);
      if (!change) return false;
      applyEditorChange(change);
      return true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }

  function handleOutdent(id: string, offset: number): boolean {
    finalizeTyping(id);
    const current = pageChunk;
    if (!current) return false;
    try {
      const change = outdentListItem(current, id, offset);
      if (!change) return false;
      applyEditorChange(change);
      return true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return false;
    }
  }

  function handleToggleTodo(id: string) {
    finalizeTyping(id);
    const current = pageChunk;
    if (!current) return;
    try {
      applyEditorChange(toggleTodo(current, id), false);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function handleParagraphPaste(
    id: string,
    start: number,
    end: number,
    text: string,
  ) {
    finalizeTyping(id);
    const current = pageChunk;
    const source = current?.blocks.find((block) => block.id === id);
    if (!current || !source || !isTextNoteBlockType(source.type)) return;
    const lineCount = text
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .split("\n").length;
    const blocks = Array.from(
      { length: Math.max(0, lineCount - 1) },
      () => createNoteBlock(continuationBlockType(source.type)),
    );
    try {
      applyEditorChange(
        pastePlainText(current, id, start, end, text, blocks),
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function undoEditorChange() {
    finalizeAllTyping();
    const change = undoStack.at(-1);
    if (!change) return;
    undoStack = undoStack.slice(0, -1);
    redoStack = [...redoStack, change];
    pageChunk = change.before;
    cacheCurrentDocument();
    cacheCurrentHistory();
    persistEditorOperations(change.inverse);
    requestEditorFocus(change.beforeSelection);
  }

  function redoEditorChange() {
    finalizeAllTyping();
    const change = redoStack.at(-1);
    if (!change) return;
    redoStack = redoStack.slice(0, -1);
    undoStack = [...undoStack, change];
    pageChunk = change.after;
    cacheCurrentDocument();
    cacheCurrentHistory();
    persistEditorOperations(change.forward);
    requestEditorFocus(change.afterSelection);
  }

  function requestEditorFocus(selection: EditorSelection) {
    focusToken += 1;
    focusRequest = { ...selection, token: focusToken };
  }

  function focusFirstParagraph() {
    const current = pageChunk;
    if (!current) return;
    const firstId = editableBlockIds(current)[0];
    if (firstId) requestEditorFocus({ blockId: firstId, offset: 0 });
  }

  function resizePageTitle(element: HTMLTextAreaElement) {
    element.style.height = "0";
    element.style.height = `${element.scrollHeight}px`;
  }

  function cacheCurrentDocument() {
    const current = pageChunk;
    if (current) pendingDocuments.set(current.rootId, current);
  }

  function cacheCurrentHistory() {
    const pageId = pageChunk?.rootId;
    if (!pageId) return;
    historyByPage.set(pageId, {
      undo: [...undoStack],
      redo: [...redoStack],
    });
  }

  function continueWriting() {
    finalizeAllTyping();
    const current = pageChunk;
    if (!current || current.rootId !== selectedPage?.id) return;
    const trailing = trailingParagraph(current);
    if (trailing) {
      requestEditorFocus({
        blockId: trailing.id,
        offset: noteBlockText(trailing).length,
      });
      return;
    }

    const root = current.blocks.find((block) => block.id === current.rootId);
    if (!root) return;
    try {
      applyEditorChange(
        insertParagraph(
          current,
          root.content.length,
          createNoteBlock("paragraph"),
        ),
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
</script>

<svelte:head>
  <title>Notes — ChessCave</title>
  <meta
    name="description"
    content="Local, structured chess notes in ChessCave."
  />
</svelte:head>

<svelte:window
  onresize={() => {
    if (pageTitleElement) resizePageTitle(pageTitleElement);
  }}
/>

{#snippet textEditor(block: NoteBlockRecord)}
  <ParagraphBlockEditor
    {block}
    disabled={!nativeHost}
    {focusRequest}
    onInput={handleParagraphInput}
    onCommit={handleParagraphCommit}
    onSplit={handleSplitParagraph}
    onMergeBackward={handleMergeBackward}
    onMove={handleParagraphMove}
    onPaste={handleParagraphPaste}
    onIndent={handleIndent}
    onOutdent={handleOutdent}
    onUndo={undoEditorChange}
    onRedo={redoEditorChange}
  />
{/snippet}

{#snippet todoEditor(block: NoteBlockRecord)}
  <div class="todo-row">
    <button
      class="todo-check"
      class:checked={block.properties.checked === true}
      type="button"
      role="checkbox"
      aria-checked={block.properties.checked === true}
      aria-label={block.properties.checked === true
        ? "Mark as not done"
        : "Mark as done"}
      onclick={() => handleToggleTodo(block.id)}
    ><IconCheckBold /></button>
    {@render textEditor(block)}
  </div>
{/snippet}

{#snippet renderChildren(childIds: string[])}
  {#each groupRenderChildren(childIds) as group}
    {#if group.kind === "bulleted_list_item"}
      <ul class="note-list">
        {#each group.blocks as block (block.id)}
          <li>
            {@render textEditor(block)}
            {#if block.content.length}
              {@render renderChildren(block.content)}
            {/if}
          </li>
        {/each}
      </ul>
    {:else if group.kind === "numbered_list_item"}
      <ol class="note-list">
        {#each group.blocks as block (block.id)}
          <li>
            {@render textEditor(block)}
            {#if block.content.length}
              {@render renderChildren(block.content)}
            {/if}
          </li>
        {/each}
      </ol>
    {:else if group.kind === "to_do"}
      <div class="todo-list">
        {#each group.blocks as block (block.id)}
          <div class="todo-branch">
            {@render todoEditor(block)}
            {#if block.content.length}
              <div class="nested-blocks">
                {@render renderChildren(block.content)}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      {@const block = group.blocks[0]}
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
      {:else if isTextNoteBlockType(block.type)}
        {@render textEditor(block)}
        {#if block.content.length}
          <div class="nested-blocks">
            {@render renderChildren(block.content)}
          </div>
        {/if}
      {:else if block.type === "divider"}
        <hr class="note-divider" />
        {#if block.content.length}
          <div class="nested-blocks">
            {@render renderChildren(block.content)}
          </div>
        {/if}
      {:else}
        <div class="paragraph-block">{blockText(block)}</div>
      {/if}
    {/if}
  {/each}
{/snippet}

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
      <div class="history-actions" role="group" aria-label="Editing history">
        <button
          class="icon-action"
          type="button"
          aria-label="Undo"
          title="Undo"
          disabled={!typingActive && !undoStack.length}
          onclick={undoEditorChange}
        >
          <IconArrowCounterClockwiseRegular />
        </button>
        <button
          class="icon-action"
          type="button"
          aria-label="Redo"
          title="Redo"
          disabled={typingActive || !redoStack.length}
          onclick={redoEditorChange}
        >
          <IconArrowClockwiseRegular />
        </button>
      </div>
      {#if saveState.status === "failed"}
        <button
          class="retry"
          type="button"
          title={saveState.error ?? "The last edit could not be saved."}
          onclick={() => saveQueue.retry()}
        >
          Retry save
        </button>
      {:else}
        <span
          class:working={saveState.status === "saving"}
          class="save-state"
          aria-live="polite"
        >
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
            onDelete={deletePage}
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
          <textarea
            class="page-title"
            bind:this={pageTitleElement}
            value={notePageTitle(selectedPage)}
            rows="1"
            wrap="soft"
            aria-label="Page title"
            disabled={mutationBusy}
            oninput={(event) => resizePageTitle(event.currentTarget)}
            onkeydown={(event) => {
              if (event.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
                focusFirstParagraph();
              } else if (event.key === "Escape") {
                event.currentTarget.value = notePageTitle(selectedPage);
                resizePageTitle(event.currentTarget);
                event.currentTarget.blur();
              }
            }}
            onblur={(event) => renamePage(selectedPage.id, event.currentTarget.value)}
          ></textarea>

          {#if error}
            <div class="inline-error">{error}</div>
          {/if}

          <div
            class:loading={pageLoading}
            class="block-preview"
          >
            {@render renderChildren(selectedRoot?.content ?? [])}
            <button
              class="editor-tail"
              type="button"
              tabindex="-1"
              aria-label="Continue writing"
              onclick={continueWriting}
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

  .history-actions {
    display: flex;
    gap: 1px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--paper);
  }

  .header-actions .icon-action {
    display: grid;
    width: 28px;
    min-height: 28px;
    place-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    font-size: 14px;
  }

  .header-actions .icon-action:hover:not(:disabled) {
    color: var(--coral-dark);
    background: var(--coral-soft);
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
    display: block;
    width: 100%;
    min-height: 1.08em;
    padding: 0;
    border: 0;
    outline: 0;
    overflow: hidden;
    resize: none;
    color: var(--ink);
    background: transparent;
    font-family: var(--display);
    font-size: clamp(36px, 5vw, 58px);
    font-variation-settings: "opsz" 58, "wght" 520;
    line-height: 1.08;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
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

  .todo-row {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    gap: 7px;
    align-items: start;
  }

  .note-list {
    margin: 0;
    padding-left: 25px;
    color: var(--ink-soft);
  }

  .note-list li {
    padding-left: 2px;
  }

  .note-list li::marker {
    color: var(--muted);
    font-size: 0.9em;
  }

  .note-list .note-list {
    margin-left: 2px;
  }

  .todo-list {
    display: grid;
  }

  .nested-blocks {
    margin-left: 27px;
  }

  .todo-check {
    display: grid;
    width: 16px;
    height: 16px;
    place-items: center;
    margin-top: 9px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    color: transparent;
    background: transparent;
    cursor: pointer;
  }

  .todo-check.checked {
    border-color: var(--sage);
    color: var(--pearl-raised);
    background: var(--sage);
  }

  .todo-check :global(svg) {
    width: 10px;
    height: 10px;
  }

  .todo-row:has(.todo-check.checked) :global(.paragraph-editor) {
    color: var(--muted);
    text-decoration: line-through;
  }

  .note-divider {
    width: 100%;
    margin: 13px 0;
    border: 0;
    border-top: 1px solid var(--line);
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

    .history-actions {
      display: none;
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
