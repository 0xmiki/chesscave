# ADR 0001: Local block store for ChessCave Notes

- Status: Accepted
- Date: 2026-07-31

## Context

ChessCave Notes needs individually addressable pages and content blocks, stable
nested relationships, ordered children, type transformation, and durable local
editing. A single user action can affect more than one record. Creating a
paragraph, for example, creates the paragraph and inserts its ID into the
parent's ordered content.

Notion's published model provides the useful conceptual foundation: blocks
have IDs, types, properties, ordered content references, and parent references;
client actions become operations grouped into transactions. ChessCave does not
currently need Notion's collaboration, permissions, server queue, databases, or
real-time update infrastructure.

## Decision

1. Notes is local-first and single-user.
2. The Rust host owns a bundled SQLite database under ChessCave's application
   data directory.
3. The Svelte client creates UUID v4 block IDs and submits typed operations
   through Tauri commands. It never accesses SQLite directly.
4. SQLite stores one row per block, including JSON properties, an ordered JSON
   content array, an upward parent pointer, timestamps, and a revision.
5. Root page order is stored as the content of an implicit workspace root in
   `notes_metadata`.
6. Relationship changes preserve both downward content and upward parent
   pointers in one database transaction.
7. Every committed transaction is validated for missing references, duplicate
   ownership, parent mismatch, and cycles.
8. The client applies editor changes locally and serializes persistence through
   a failure-aware save queue. Failed work and the corresponding local document
   remain available until an explicit retry succeeds.
9. Text-block split, merge, paste, indentation, type transformation, undo, and
   redo are represented as reversible operation groups. Removing a single
   block requires detaching it first, and leaf deletion is limited to childless
   blocks. Confirmed page deletion uses a separate atomic subtree operation
   that removes the owning reference and all descendants before graph
   validation and commit.
10. Editing history is session-local; durable storage contains the resulting
   block graph rather than an ever-growing command log.
11. The stored model remains independent of the editor rendering
   library.
12. Schema 2 expands the accepted application vocabulary without replacing the
    schema 1 JSON-backed storage shape. Rich-text marks and unknown compatible
    properties remain opaque JSON at the persistence boundary.

## Why SQLite

A JSON document would make whole-file rewriting and multi-record rollback the
application's responsibility. SQLite already provides atomic transactions,
crash-safe persistence, schema versions, indexes, and a well-understood
migration path. The bundled library keeps the desktop behavior consistent
across supported systems.

## Why redundant parent and content references

The content array is the render order. The parent pointer makes upward
navigation and cycle validation direct. The redundancy is accepted only
because all relationship mutations pass through one validated transaction
boundary; inconsistent states are rejected before commit.

## Consequences

- Notes can load a sidebar tree separately from one selected page.
- A transaction failure leaves the previous graph intact.
- Unknown future properties remain preserved as JSON.
- Undo can recreate a removed leaf with its original stable ID and sibling
  position.
- Schema evolution requires explicit migrations.
- The SQLite dependency adds native code and binary size, so later persistence
  dependencies require a similarly concrete benefit.
- Cloud sync or collaboration would need a separate design; the current UI
  must not imply either capability.

## Rejected alternatives

- **Browser local storage:** unsuitable for a durable multi-record graph and
  migration/rollback guarantees.
- **One Markdown file per page:** useful as an export format, but loses stable
  block identity and structural transactions.
- **One JSON file for the workspace:** simple initially, but makes atomic
  partial edits, indexing, and recovery increasingly fragile.
- **Direct SQL from Svelte:** weakens the Rust ownership boundary already used
  by ChessCave's other durable desktop services.
