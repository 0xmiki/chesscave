use rusqlite::{
    params, types::Type, Connection, OptionalExtension, Row, Transaction as SqlTransaction,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const NOTES_SCHEMA_VERSION: u32 = 2;
const ROOT_CONTENT_KEY: &str = "root_content";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub properties: Value,
    pub content: Vec<String>,
    pub parent_id: Option<String>,
    pub revision: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewNoteBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub properties: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NoteOperation {
    CreateBlock {
        block: NewNoteBlock,
    },
    UpdateProperties {
        id: String,
        properties: Value,
        #[serde(default)]
        expected_revision: Option<u64>,
    },
    ChangeType {
        id: String,
        #[serde(rename = "type")]
        block_type: String,
        #[serde(default)]
        expected_revision: Option<u64>,
    },
    InsertChild {
        parent_id: Option<String>,
        child_id: String,
        index: usize,
    },
    MoveChild {
        child_id: String,
        parent_id: Option<String>,
        index: usize,
    },
    RemoveChild {
        parent_id: Option<String>,
        child_id: String,
    },
    DeleteBlock {
        id: String,
    },
    DeleteSubtree {
        id: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesBootstrap {
    schema_version: u32,
    root_page_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesSidebarSnapshot {
    root_page_ids: Vec<String>,
    pages: Vec<NoteBlock>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesPageChunk {
    root_id: String,
    blocks: Vec<NoteBlock>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotesTransactionResult {
    committed_at: i64,
    root_page_ids: Vec<String>,
    blocks: Vec<NoteBlock>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn notes_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("notes").join("chesscave-notes.sqlite3"))
        .map_err(|error| format!("Could not resolve the ChessCave notes directory: {error}"))
}

fn configure_database(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("Could not configure the notes database timeout: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;",
        )
        .map_err(|error| format!("Could not configure the notes database: {error}"))
}

fn migrate_database(connection: &mut Connection) -> Result<(), String> {
    let current: u32 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| format!("Could not read the notes schema version: {error}"))?;
    if current > NOTES_SCHEMA_VERSION {
        return Err(format!(
            "This notes database uses schema version {current}, but this build supports only version {NOTES_SCHEMA_VERSION}."
        ));
    }

    for version in (current + 1)..=NOTES_SCHEMA_VERSION {
        match version {
            1 => migrate_to_v1(connection)?,
            2 => migrate_to_v2(connection)?,
            _ => return Err(format!("No notes migration exists for version {version}.")),
        }
    }
    Ok(())
}

fn migrate_to_v1(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not begin notes migration 1: {error}"))?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS notes_metadata (
                key TEXT PRIMARY KEY NOT NULL,
                value_json TEXT NOT NULL
             );

             CREATE TABLE IF NOT EXISTS note_blocks (
                id TEXT PRIMARY KEY NOT NULL,
                block_type TEXT NOT NULL,
                properties_json TEXT NOT NULL,
                content_json TEXT NOT NULL,
                parent_id TEXT NULL REFERENCES note_blocks(id)
                    DEFERRABLE INITIALLY DEFERRED,
                revision INTEGER NOT NULL CHECK (revision >= 1),
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
             );

             CREATE INDEX IF NOT EXISTS note_blocks_parent_idx
                ON note_blocks(parent_id);
             CREATE INDEX IF NOT EXISTS note_blocks_type_idx
                ON note_blocks(block_type);",
        )
        .map_err(|error| format!("Could not create notes schema 1: {error}"))?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO notes_metadata (key, value_json)
             VALUES (?1, '[]')",
            params![ROOT_CONTENT_KEY],
        )
        .map_err(|error| format!("Could not initialize the notes root: {error}"))?;
    transaction
        .pragma_update(None, "user_version", 1)
        .map_err(|error| format!("Could not record notes schema 1: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit notes migration 1: {error}"))
}

fn migrate_to_v2(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not begin notes migration 2: {error}"))?;
    // Version 2 expands the application-level block and rich-text vocabulary.
    // The v1 JSON-backed columns already preserve the new properties losslessly.
    transaction
        .pragma_update(None, "user_version", 2)
        .map_err(|error| format!("Could not record notes schema 2: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit notes migration 2: {error}"))
}

fn open_database(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the notes directory: {error}"))?;
    }
    let mut connection = Connection::open(path)
        .map_err(|error| format!("Could not open the notes database: {error}"))?;
    configure_database(&connection)?;
    migrate_database(&mut connection)?;
    Ok(connection)
}

async fn run_database<T, F>(path: PathBuf, callback: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut connection = open_database(&path)?;
        callback(&mut connection)
    })
    .await
    .map_err(|error| format!("The notes database task stopped unexpectedly: {error}"))?
}

fn json_conversion_error(index: usize, error: serde_json::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, Type::Text, Box::new(error))
}

fn row_to_block(row: &Row<'_>) -> rusqlite::Result<NoteBlock> {
    let properties_json: String = row.get(2)?;
    let content_json: String = row.get(3)?;
    let revision: i64 = row.get(5)?;
    Ok(NoteBlock {
        id: row.get(0)?,
        block_type: row.get(1)?,
        properties: serde_json::from_str(&properties_json)
            .map_err(|error| json_conversion_error(2, error))?,
        content: serde_json::from_str(&content_json)
            .map_err(|error| json_conversion_error(3, error))?,
        parent_id: row.get(4)?,
        revision: u64::try_from(revision)
            .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(5, revision))?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const BLOCK_COLUMNS: &str =
    "id, block_type, properties_json, content_json, parent_id, revision, created_at, updated_at";

fn load_block(connection: &Connection, id: &str) -> Result<Option<NoteBlock>, String> {
    connection
        .query_row(
            &format!("SELECT {BLOCK_COLUMNS} FROM note_blocks WHERE id = ?1"),
            params![id],
            row_to_block,
        )
        .optional()
        .map_err(|error| format!("Could not load note block {id}: {error}"))
}

fn require_block(connection: &Connection, id: &str) -> Result<NoteBlock, String> {
    load_block(connection, id)?.ok_or_else(|| format!("Note block {id} does not exist."))
}

fn load_all_blocks(connection: &Connection) -> Result<Vec<NoteBlock>, String> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT {BLOCK_COLUMNS} FROM note_blocks ORDER BY created_at, id"
        ))
        .map_err(|error| format!("Could not prepare the notes block query: {error}"))?;
    let rows = statement
        .query_map([], row_to_block)
        .map_err(|error| format!("Could not query note blocks: {error}"))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|error| format!("Could not decode note blocks: {error}"))
}

fn load_root_ids(connection: &Connection) -> Result<Vec<String>, String> {
    let value: String = connection
        .query_row(
            "SELECT value_json FROM notes_metadata WHERE key = ?1",
            params![ROOT_CONTENT_KEY],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not load the notes root: {error}"))?;
    serde_json::from_str(&value)
        .map_err(|error| format!("The notes root order is invalid: {error}"))
}

fn save_root_ids(transaction: &SqlTransaction<'_>, root_ids: &[String]) -> Result<(), String> {
    let value = serde_json::to_string(root_ids)
        .map_err(|error| format!("Could not encode the notes root: {error}"))?;
    transaction
        .execute(
            "UPDATE notes_metadata SET value_json = ?1 WHERE key = ?2",
            params![value, ROOT_CONTENT_KEY],
        )
        .map_err(|error| format!("Could not update the notes root: {error}"))?;
    Ok(())
}

fn validate_uuid_v4(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36
        || bytes[8] != b'-'
        || bytes[13] != b'-'
        || bytes[18] != b'-'
        || bytes[23] != b'-'
        || bytes[14] != b'4'
        || !matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
    {
        return false;
    }
    bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
}

fn validate_supported_type(block_type: &str) -> Result<(), String> {
    if matches!(
        block_type,
        "page"
            | "paragraph"
            | "heading_1"
            | "heading_2"
            | "heading_3"
            | "bulleted_list_item"
            | "numbered_list_item"
            | "to_do"
            | "quote"
            | "divider"
            | "code"
    ) {
        Ok(())
    } else {
        Err(format!(
            "Block type `{block_type}` is not available in this Notes build."
        ))
    }
}

fn validate_properties(properties: &Value) -> Result<(), String> {
    let object = properties
        .as_object()
        .ok_or_else(|| "Block properties must be a JSON object.".to_string())?;
    let title = object
        .get("title")
        .and_then(Value::as_array)
        .ok_or_else(|| "Block properties must contain a title array.".to_string())?;
    for run in title {
        let text = run
            .as_object()
            .and_then(|value| value.get("text"))
            .and_then(Value::as_str);
        if text.is_none() {
            return Err("Every rich-text run must contain a text string.".to_string());
        }
    }
    Ok(())
}

fn check_revision(block: &NoteBlock, expected: Option<u64>) -> Result<(), String> {
    if let Some(expected) = expected {
        if block.revision != expected {
            return Err(format!(
                "Note block {} changed from revision {expected} to {} before this edit could be saved.",
                block.id, block.revision
            ));
        }
    }
    Ok(())
}

fn persist_block(transaction: &SqlTransaction<'_>, block: &NoteBlock) -> Result<(), String> {
    let properties_json = serde_json::to_string(&block.properties)
        .map_err(|error| format!("Could not encode block properties: {error}"))?;
    let content_json = serde_json::to_string(&block.content)
        .map_err(|error| format!("Could not encode block content: {error}"))?;
    transaction
        .execute(
            "UPDATE note_blocks
             SET block_type = ?1,
                 properties_json = ?2,
                 content_json = ?3,
                 parent_id = ?4,
                 revision = ?5,
                 updated_at = ?6
             WHERE id = ?7",
            params![
                block.block_type,
                properties_json,
                content_json,
                block.parent_id,
                block.revision,
                block.updated_at,
                block.id
            ],
        )
        .map_err(|error| format!("Could not update note block {}: {error}", block.id))?;
    Ok(())
}

fn bump(block: &mut NoteBlock, timestamp: i64) {
    block.revision = block.revision.saturating_add(1);
    block.updated_at = timestamp;
}

fn attach_reference(
    transaction: &SqlTransaction<'_>,
    parent_id: Option<&str>,
    child_id: &str,
    index: usize,
    timestamp: i64,
    touched: &mut BTreeSet<String>,
) -> Result<(), String> {
    if let Some(parent_id) = parent_id {
        if parent_id == child_id {
            return Err("A block cannot contain itself.".to_string());
        }
        let mut parent = require_block(transaction, parent_id)?;
        if parent.content.iter().any(|id| id == child_id) {
            return Err(format!(
                "Block {child_id} already appears in parent {parent_id}."
            ));
        }
        if index > parent.content.len() {
            return Err(format!(
                "Child index {index} is outside parent {parent_id} with {} children.",
                parent.content.len()
            ));
        }
        parent.content.insert(index, child_id.to_string());
        bump(&mut parent, timestamp);
        persist_block(transaction, &parent)?;
        touched.insert(parent.id);
    } else {
        let child = require_block(transaction, child_id)?;
        if child.block_type != "page" {
            return Err("Only page blocks can live at the Notes root.".to_string());
        }
        let mut roots = load_root_ids(transaction)?;
        if roots.iter().any(|id| id == child_id) {
            return Err(format!(
                "Page {child_id} already appears at the Notes root."
            ));
        }
        if index > roots.len() {
            return Err(format!(
                "Root index {index} is outside the root with {} pages.",
                roots.len()
            ));
        }
        roots.insert(index, child_id.to_string());
        save_root_ids(transaction, &roots)?;
    }
    Ok(())
}

fn detach_reference(
    transaction: &SqlTransaction<'_>,
    parent_id: Option<&str>,
    child_id: &str,
    timestamp: i64,
    touched: &mut BTreeSet<String>,
) -> Result<usize, String> {
    if let Some(parent_id) = parent_id {
        let mut parent = require_block(transaction, parent_id)?;
        let index = parent
            .content
            .iter()
            .position(|id| id == child_id)
            .ok_or_else(|| format!("Block {child_id} is not a child of {parent_id}."))?;
        parent.content.remove(index);
        bump(&mut parent, timestamp);
        persist_block(transaction, &parent)?;
        touched.insert(parent.id);
        Ok(index)
    } else {
        let mut roots = load_root_ids(transaction)?;
        let index = roots
            .iter()
            .position(|id| id == child_id)
            .ok_or_else(|| format!("Page {child_id} is not at the Notes root."))?;
        roots.remove(index);
        save_root_ids(transaction, &roots)?;
        Ok(index)
    }
}

fn current_parent(
    connection: &Connection,
    child: &NoteBlock,
) -> Result<Option<Option<String>>, String> {
    if let Some(parent) = &child.parent_id {
        return Ok(Some(Some(parent.clone())));
    }
    let roots = load_root_ids(connection)?;
    if roots.iter().any(|id| id == &child.id) {
        Ok(Some(None))
    } else {
        Ok(None)
    }
}

fn validate_graph(connection: &Connection) -> Result<(), String> {
    let blocks = load_all_blocks(connection)?;
    let by_id: HashMap<&str, &NoteBlock> = blocks
        .iter()
        .map(|block| (block.id.as_str(), block))
        .collect();
    let roots = load_root_ids(connection)?;
    let mut reference_counts: HashMap<&str, usize> = HashMap::new();
    let mut root_seen = HashSet::new();

    for root_id in &roots {
        if !root_seen.insert(root_id.as_str()) {
            return Err(format!("Root page {root_id} appears more than once."));
        }
        let root = by_id
            .get(root_id.as_str())
            .ok_or_else(|| format!("Root page {root_id} does not exist."))?;
        if root.block_type != "page" {
            return Err(format!("Root block {root_id} is not a page."));
        }
        if root.parent_id.is_some() {
            return Err(format!("Root page {root_id} still has a parent."));
        }
        *reference_counts.entry(root_id.as_str()).or_default() += 1;
    }

    for block in &blocks {
        let mut seen = HashSet::new();
        for child_id in &block.content {
            if !seen.insert(child_id.as_str()) {
                return Err(format!(
                    "Block {} contains child {child_id} more than once.",
                    block.id
                ));
            }
            let child = by_id.get(child_id.as_str()).ok_or_else(|| {
                format!("Block {} references missing child {child_id}.", block.id)
            })?;
            if child.parent_id.as_deref() != Some(block.id.as_str()) {
                return Err(format!(
                    "Child {child_id} does not point back to parent {}.",
                    block.id
                ));
            }
            *reference_counts.entry(child_id.as_str()).or_default() += 1;
        }
    }

    for block in &blocks {
        let references = reference_counts
            .get(block.id.as_str())
            .copied()
            .unwrap_or(0);
        if references != 1 {
            return Err(format!(
                "Block {} has {references} owning references; exactly one is required.",
                block.id
            ));
        }
        if let Some(parent_id) = &block.parent_id {
            if !by_id.contains_key(parent_id.as_str()) {
                return Err(format!(
                    "Block {} points to missing parent {parent_id}.",
                    block.id
                ));
            }
        }

        let mut ancestors = HashSet::new();
        let mut cursor = Some(block);
        while let Some(current) = cursor {
            if !ancestors.insert(current.id.as_str()) {
                return Err(format!("The note tree contains a cycle at {}.", current.id));
            }
            cursor = current
                .parent_id
                .as_deref()
                .and_then(|parent| by_id.get(parent).copied());
        }
    }
    Ok(())
}

fn collect_subtree_ids(connection: &Connection, root_id: &str) -> Result<Vec<String>, String> {
    let mut ordered = Vec::new();
    let mut stack = vec![root_id.to_string()];
    let mut visited = HashSet::new();

    while let Some(id) = stack.pop() {
        if !visited.insert(id.clone()) {
            continue;
        }
        let block = require_block(connection, &id)?;
        ordered.push(id);
        stack.extend(block.content);
    }

    Ok(ordered)
}

fn apply_operations(
    connection: &mut Connection,
    operations: Vec<NoteOperation>,
) -> Result<NotesTransactionResult, String> {
    if operations.is_empty() {
        return Err("A notes transaction needs at least one operation.".to_string());
    }
    validate_graph(connection)?;
    let timestamp = now_ms();
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Could not begin the notes transaction: {error}"))?;
    let mut touched = BTreeSet::new();

    for operation in operations {
        match operation {
            NoteOperation::CreateBlock { block } => {
                if !validate_uuid_v4(&block.id) {
                    return Err(format!("Block ID {} is not a UUID v4.", block.id));
                }
                validate_supported_type(&block.block_type)?;
                validate_properties(&block.properties)?;
                let properties_json = serde_json::to_string(&block.properties)
                    .map_err(|error| format!("Could not encode block properties: {error}"))?;
                transaction
                    .execute(
                        "INSERT INTO note_blocks (
                            id, block_type, properties_json, content_json,
                            parent_id, revision, created_at, updated_at
                         ) VALUES (?1, ?2, ?3, '[]', NULL, 1, ?4, ?4)",
                        params![block.id, block.block_type, properties_json, timestamp],
                    )
                    .map_err(|error| format!("Could not create note block: {error}"))?;
                touched.insert(block.id);
            }
            NoteOperation::UpdateProperties {
                id,
                properties,
                expected_revision,
            } => {
                validate_properties(&properties)?;
                let mut block = require_block(&transaction, &id)?;
                check_revision(&block, expected_revision)?;
                block.properties = properties;
                bump(&mut block, timestamp);
                persist_block(&transaction, &block)?;
                touched.insert(id);
            }
            NoteOperation::ChangeType {
                id,
                block_type,
                expected_revision,
            } => {
                validate_supported_type(&block_type)?;
                let mut block = require_block(&transaction, &id)?;
                check_revision(&block, expected_revision)?;
                block.block_type = block_type;
                bump(&mut block, timestamp);
                persist_block(&transaction, &block)?;
                touched.insert(id);
            }
            NoteOperation::InsertChild {
                parent_id,
                child_id,
                index,
            } => {
                let mut child = require_block(&transaction, &child_id)?;
                if current_parent(&transaction, &child)?.is_some() {
                    return Err(format!(
                        "Block {child_id} already has an owning parent; use moveChild."
                    ));
                }
                attach_reference(
                    &transaction,
                    parent_id.as_deref(),
                    &child_id,
                    index,
                    timestamp,
                    &mut touched,
                )?;
                child.parent_id = parent_id;
                bump(&mut child, timestamp);
                persist_block(&transaction, &child)?;
                touched.insert(child_id);
            }
            NoteOperation::MoveChild {
                child_id,
                parent_id,
                index,
            } => {
                let mut child = require_block(&transaction, &child_id)?;
                let existing = current_parent(&transaction, &child)?
                    .ok_or_else(|| format!("Block {child_id} has no owning parent."))?;
                if existing == parent_id {
                    let old_index = detach_reference(
                        &transaction,
                        existing.as_deref(),
                        &child_id,
                        timestamp,
                        &mut touched,
                    )?;
                    attach_reference(
                        &transaction,
                        parent_id.as_deref(),
                        &child_id,
                        index,
                        timestamp,
                        &mut touched,
                    )
                    .map_err(|error| {
                        format!("Could not move child {child_id} from index {old_index}: {error}")
                    })?;
                } else {
                    detach_reference(
                        &transaction,
                        existing.as_deref(),
                        &child_id,
                        timestamp,
                        &mut touched,
                    )?;
                    attach_reference(
                        &transaction,
                        parent_id.as_deref(),
                        &child_id,
                        index,
                        timestamp,
                        &mut touched,
                    )?;
                    child.parent_id = parent_id;
                    bump(&mut child, timestamp);
                    persist_block(&transaction, &child)?;
                    touched.insert(child_id.clone());
                }
            }
            NoteOperation::RemoveChild {
                parent_id,
                child_id,
            } => {
                let mut child = require_block(&transaction, &child_id)?;
                let existing = current_parent(&transaction, &child)?
                    .ok_or_else(|| format!("Block {child_id} has no owning parent."))?;
                if existing != parent_id {
                    return Err(format!(
                        "Block {child_id} is not owned by the supplied parent."
                    ));
                }
                detach_reference(
                    &transaction,
                    parent_id.as_deref(),
                    &child_id,
                    timestamp,
                    &mut touched,
                )?;
                child.parent_id = None;
                bump(&mut child, timestamp);
                persist_block(&transaction, &child)?;
                touched.insert(child_id);
            }
            NoteOperation::DeleteBlock { id } => {
                let block = require_block(&transaction, &id)?;
                if current_parent(&transaction, &block)?.is_some() {
                    return Err(format!(
                        "Block {id} must be detached before it can be deleted."
                    ));
                }
                if !block.content.is_empty() {
                    return Err(format!(
                        "Block {id} still owns children and cannot be deleted."
                    ));
                }
                transaction
                    .execute("DELETE FROM note_blocks WHERE id = ?1", params![id])
                    .map_err(|error| format!("Could not delete note block: {error}"))?;
                touched.remove(&id);
            }
            NoteOperation::DeleteSubtree { id } => {
                let root = require_block(&transaction, &id)?;
                if root.block_type != "page" {
                    return Err(format!("Block {id} is not a page subtree."));
                }
                let owner = current_parent(&transaction, &root)?
                    .ok_or_else(|| format!("Page {id} has no owning parent."))?;
                let subtree = collect_subtree_ids(&transaction, &id)?;
                detach_reference(&transaction, owner.as_deref(), &id, timestamp, &mut touched)?;
                for block_id in subtree.iter().rev() {
                    transaction
                        .execute("DELETE FROM note_blocks WHERE id = ?1", params![block_id])
                        .map_err(|error| format!("Could not delete page subtree {id}: {error}"))?;
                    touched.remove(block_id);
                }
            }
        }
    }

    validate_graph(&transaction)?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit the notes transaction: {error}"))?;

    let mut blocks = Vec::with_capacity(touched.len());
    for id in touched {
        if let Some(block) = load_block(connection, &id)? {
            blocks.push(block);
        }
    }
    Ok(NotesTransactionResult {
        committed_at: timestamp,
        root_page_ids: load_root_ids(connection)?,
        blocks,
    })
}

fn load_sidebar(connection: &Connection) -> Result<NotesSidebarSnapshot, String> {
    let pages = load_all_blocks(connection)?
        .into_iter()
        .filter(|block| block.block_type == "page")
        .collect();
    Ok(NotesSidebarSnapshot {
        root_page_ids: load_root_ids(connection)?,
        pages,
    })
}

fn load_page_chunk(connection: &Connection, page_id: &str) -> Result<NotesPageChunk, String> {
    let root = require_block(connection, page_id)?;
    if root.block_type != "page" {
        return Err(format!("Note block {page_id} is not a page."));
    }

    let by_id: HashMap<String, NoteBlock> = load_all_blocks(connection)?
        .into_iter()
        .map(|block| (block.id.clone(), block))
        .collect();
    let mut ordered = Vec::new();
    let mut visited = HashSet::new();
    let mut stack = vec![page_id.to_string()];

    while let Some(id) = stack.pop() {
        if !visited.insert(id.clone()) {
            continue;
        }
        let block = by_id
            .get(&id)
            .ok_or_else(|| format!("Page {page_id} references missing block {id}."))?;
        ordered.push(block.clone());
        if block.block_type == "page" && block.id != page_id {
            continue;
        }
        for child in block.content.iter().rev() {
            stack.push(child.clone());
        }
    }

    Ok(NotesPageChunk {
        root_id: page_id.to_string(),
        blocks: ordered,
    })
}

#[tauri::command]
pub async fn notes_bootstrap(app: AppHandle) -> Result<NotesBootstrap, String> {
    let path = notes_database_path(&app)?;
    run_database(path, |connection| {
        validate_graph(connection)?;
        Ok(NotesBootstrap {
            schema_version: NOTES_SCHEMA_VERSION,
            root_page_ids: load_root_ids(connection)?,
        })
    })
    .await
}

#[tauri::command]
pub async fn notes_load_sidebar(app: AppHandle) -> Result<NotesSidebarSnapshot, String> {
    let path = notes_database_path(&app)?;
    run_database(path, |connection| load_sidebar(connection)).await
}

#[tauri::command]
pub async fn notes_load_page(app: AppHandle, page_id: String) -> Result<NotesPageChunk, String> {
    let path = notes_database_path(&app)?;
    run_database(path, move |connection| {
        load_page_chunk(connection, &page_id)
    })
    .await
}

#[tauri::command]
pub async fn notes_apply_transaction(
    app: AppHandle,
    operations: Vec<NoteOperation>,
) -> Result<NotesTransactionResult, String> {
    let path = notes_database_path(&app)?;
    run_database(path, move |connection| {
        apply_operations(connection, operations)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::process;

    const ROOT: &str = "00000000-0000-4000-8000-000000000001";
    const CHILD: &str = "00000000-0000-4000-8000-000000000002";
    const PARAGRAPH: &str = "00000000-0000-4000-8000-000000000003";
    const SECOND_PARAGRAPH: &str = "00000000-0000-4000-8000-000000000004";
    const MISSING: &str = "00000000-0000-4000-8000-000000000099";

    struct TestDatabase {
        path: PathBuf,
    }

    impl TestDatabase {
        fn new(label: &str) -> Self {
            let unique = format!(
                "chesscave-notes-{label}-{}-{}.sqlite3",
                process::id(),
                now_ms()
            );
            Self {
                path: std::env::temp_dir().join(unique),
            }
        }

        fn open(&self) -> Connection {
            open_database(&self.path).expect("test database")
        }
    }

    impl Drop for TestDatabase {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let _ = fs::remove_file(format!("{}{}", self.path.display(), suffix));
            }
        }
    }

    fn properties(text: &str) -> Value {
        json!({ "title": [{ "text": text }] })
    }

    fn create(id: &str, block_type: &str, text: &str) -> NoteOperation {
        NoteOperation::CreateBlock {
            block: NewNoteBlock {
                id: id.to_string(),
                block_type: block_type.to_string(),
                properties: properties(text),
            },
        }
    }

    fn insert(parent_id: Option<&str>, child_id: &str, index: usize) -> NoteOperation {
        NoteOperation::InsertChild {
            parent_id: parent_id.map(str::to_string),
            child_id: child_id.to_string(),
            index,
        }
    }

    fn seed_tree(connection: &mut Connection) {
        apply_operations(
            connection,
            vec![
                create(ROOT, "page", "Study notes"),
                create(CHILD, "page", "London System"),
                create(PARAGRAPH, "paragraph", "The c-pawn break matters."),
                insert(None, ROOT, 0),
                insert(Some(ROOT), CHILD, 0),
                insert(Some(CHILD), PARAGRAPH, 0),
            ],
        )
        .expect("seed note tree");
    }

    #[test]
    fn migrates_and_reopens_a_nested_block_tree() {
        let database = TestDatabase::new("restart");
        {
            let mut connection = database.open();
            seed_tree(&mut connection);
            assert_eq!(
                connection
                    .pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0))
                    .expect("schema version"),
                NOTES_SCHEMA_VERSION
            );
        }

        let connection = database.open();
        validate_graph(&connection).expect("valid reopened graph");
        let sidebar = load_sidebar(&connection).expect("sidebar");
        assert_eq!(sidebar.root_page_ids, vec![ROOT]);
        assert_eq!(sidebar.pages.len(), 2);
        let page = load_page_chunk(&connection, CHILD).expect("nested page");
        assert_eq!(
            page.blocks
                .iter()
                .map(|block| block.id.as_str())
                .collect::<Vec<_>>(),
            vec![CHILD, PARAGRAPH]
        );
        assert_eq!(
            page.blocks[1].properties["title"][0]["text"],
            "The c-pawn break matters."
        );
    }

    #[test]
    fn rolls_back_an_operation_that_would_create_a_cycle() {
        let database = TestDatabase::new("rollback");
        let mut connection = database.open();
        seed_tree(&mut connection);

        let error = apply_operations(
            &mut connection,
            vec![NoteOperation::MoveChild {
                child_id: ROOT.to_string(),
                parent_id: Some(CHILD.to_string()),
                index: 1,
            }],
        )
        .expect_err("cycle must fail");
        assert!(error.contains("cycle"), "{error}");

        assert_eq!(load_root_ids(&connection).expect("root"), vec![ROOT]);
        assert_eq!(
            require_block(&connection, ROOT).expect("root page").content,
            vec![CHILD]
        );
        assert_eq!(
            require_block(&connection, CHILD)
                .expect("child page")
                .parent_id
                .as_deref(),
            Some(ROOT)
        );
    }

    #[test]
    fn rejects_missing_duplicate_mismatched_and_cyclic_relationships() {
        type Corruption = (&'static str, Box<dyn Fn(&Connection)>);
        let cases: Vec<Corruption> = vec![
            (
                "missing child",
                Box::new(|connection| {
                    connection
                        .execute(
                            "UPDATE note_blocks SET content_json = ?1 WHERE id = ?2",
                            params![format!("[\"{MISSING}\"]"), ROOT],
                        )
                        .expect("corrupt missing");
                }),
            ),
            (
                "more than once",
                Box::new(|connection| {
                    connection
                        .execute(
                            "UPDATE notes_metadata SET value_json = ?1 WHERE key = ?2",
                            params![format!("[\"{ROOT}\",\"{ROOT}\"]"), ROOT_CONTENT_KEY],
                        )
                        .expect("corrupt duplicate");
                }),
            ),
            (
                "does not point back",
                Box::new(|connection| {
                    connection
                        .execute(
                            "UPDATE note_blocks SET parent_id = NULL WHERE id = ?1",
                            params![CHILD],
                        )
                        .expect("corrupt parent");
                }),
            ),
            (
                "cycle",
                Box::new(|connection| {
                    connection
                        .execute(
                            "UPDATE notes_metadata SET value_json = '[]' WHERE key = ?1",
                            params![ROOT_CONTENT_KEY],
                        )
                        .expect("clear root");
                    connection
                        .execute(
                            "UPDATE note_blocks
                             SET parent_id = ?1, content_json = ?2
                             WHERE id = ?3",
                            params![CHILD, format!("[\"{CHILD}\"]"), ROOT],
                        )
                        .expect("cycle root");
                    connection
                        .execute(
                            "UPDATE note_blocks
                             SET parent_id = ?1, content_json = ?2
                             WHERE id = ?3",
                            params![ROOT, format!("[\"{ROOT}\"]"), CHILD],
                        )
                        .expect("cycle child");
                }),
            ),
        ];

        for (expected, corrupt) in cases {
            let database = TestDatabase::new(expected);
            let mut connection = database.open();
            seed_tree(&mut connection);
            corrupt(&connection);
            let error = validate_graph(&connection).expect_err("invalid graph");
            assert!(
                error.contains(expected),
                "expected `{expected}` in `{error}`"
            );
        }
    }

    #[test]
    fn migrates_a_v1_store_to_the_document_vocabulary_without_data_loss() {
        let database = TestDatabase::new("migration");
        {
            let mut connection = database.open();
            apply_operations(
                &mut connection,
                vec![create(ROOT, "page", "Preserve me"), insert(None, ROOT, 0)],
            )
            .expect("seed migration fixture");
            connection
                .pragma_update(None, "user_version", 1)
                .expect("mark fixture as schema 1");
        }

        let connection = database.open();
        assert_eq!(
            require_block(&connection, ROOT)
                .expect("preserved block")
                .properties["title"][0]["text"],
            "Preserve me"
        );
        assert_eq!(
            load_root_ids(&connection).expect("preserved root"),
            vec![ROOT]
        );
        assert_eq!(
            connection
                .pragma_query_value::<u32, _>(None, "user_version", |row| row.get(0))
                .expect("upgraded schema version"),
            NOTES_SCHEMA_VERSION
        );
    }

    #[test]
    fn rejects_stale_property_updates_without_changing_the_block() {
        let database = TestDatabase::new("revision");
        let mut connection = database.open();
        apply_operations(
            &mut connection,
            vec![create(ROOT, "page", "Original"), insert(None, ROOT, 0)],
        )
        .expect("seed revision");
        let before = require_block(&connection, ROOT).expect("before");

        let error = apply_operations(
            &mut connection,
            vec![NoteOperation::UpdateProperties {
                id: ROOT.to_string(),
                properties: properties("Stale"),
                expected_revision: Some(before.revision - 1),
            }],
        )
        .expect_err("stale edit");
        assert!(error.contains("changed from revision"));
        assert_eq!(
            require_block(&connection, ROOT).expect("after").properties,
            before.properties
        );
    }

    #[test]
    fn deletes_only_detached_leaf_blocks_and_can_recreate_them_for_undo() {
        let database = TestDatabase::new("delete-leaf");
        let mut connection = database.open();
        seed_tree(&mut connection);

        let error = apply_operations(
            &mut connection,
            vec![NoteOperation::DeleteBlock {
                id: PARAGRAPH.to_string(),
            }],
        )
        .expect_err("attached block must not be deleted");
        assert!(error.contains("must be detached"), "{error}");
        assert!(load_block(&connection, PARAGRAPH)
            .expect("load attached paragraph")
            .is_some());

        apply_operations(
            &mut connection,
            vec![
                NoteOperation::RemoveChild {
                    parent_id: Some(CHILD.to_string()),
                    child_id: PARAGRAPH.to_string(),
                },
                NoteOperation::DeleteBlock {
                    id: PARAGRAPH.to_string(),
                },
            ],
        )
        .expect("detach and delete paragraph");
        assert!(load_block(&connection, PARAGRAPH)
            .expect("load deleted paragraph")
            .is_none());
        assert!(require_block(&connection, CHILD)
            .expect("parent after delete")
            .content
            .is_empty());

        apply_operations(
            &mut connection,
            vec![
                create(PARAGRAPH, "paragraph", "Restored by undo"),
                insert(Some(CHILD), PARAGRAPH, 0),
            ],
        )
        .expect("recreate deleted paragraph");
        let restored = load_page_chunk(&connection, CHILD).expect("restored page");
        assert_eq!(restored.blocks.len(), 2);
        assert_eq!(
            restored.blocks[1].properties["title"][0]["text"],
            "Restored by undo"
        );
    }

    #[test]
    fn deletes_a_page_and_every_owned_descendant_atomically() {
        let database = TestDatabase::new("delete-page-subtree");
        let mut connection = database.open();
        seed_tree(&mut connection);

        apply_operations(
            &mut connection,
            vec![NoteOperation::DeleteSubtree {
                id: CHILD.to_string(),
            }],
        )
        .expect("delete nested page subtree");

        validate_graph(&connection).expect("valid graph after subtree deletion");
        let root = load_page_chunk(&connection, ROOT).expect("remaining root page");
        assert_eq!(root.blocks.len(), 1);
        assert!(root.blocks[0].content.is_empty());
        assert!(load_block(&connection, CHILD)
            .expect("load deleted child page")
            .is_none());
        assert!(load_block(&connection, PARAGRAPH)
            .expect("load deleted descendant paragraph")
            .is_none());
    }

    #[test]
    fn deleting_a_root_page_removes_its_subtree_from_the_workspace() {
        let database = TestDatabase::new("delete-root-subtree");
        let mut connection = database.open();
        seed_tree(&mut connection);

        apply_operations(
            &mut connection,
            vec![NoteOperation::DeleteSubtree {
                id: ROOT.to_string(),
            }],
        )
        .expect("delete root page subtree");

        validate_graph(&connection).expect("valid empty graph");
        assert!(load_root_ids(&connection).expect("empty roots").is_empty());
        assert!(load_all_blocks(&connection)
            .expect("empty block store")
            .is_empty());
    }

    #[test]
    fn persists_split_merge_and_undo_as_atomic_editor_transactions() {
        let database = TestDatabase::new("editor-transactions");
        {
            let mut connection = database.open();
            apply_operations(
                &mut connection,
                vec![
                    create(ROOT, "page", "Editor transactions"),
                    create(PARAGRAPH, "paragraph", "Queen's pawn"),
                    insert(None, ROOT, 0),
                    insert(Some(ROOT), PARAGRAPH, 0),
                ],
            )
            .expect("seed editor transaction fixture");

            apply_operations(
                &mut connection,
                vec![
                    NoteOperation::UpdateProperties {
                        id: PARAGRAPH.to_string(),
                        properties: properties("Queen's"),
                        expected_revision: None,
                    },
                    create(SECOND_PARAGRAPH, "paragraph", " pawn"),
                    insert(Some(ROOT), SECOND_PARAGRAPH, 1),
                ],
            )
            .expect("split paragraph");
            let split = load_page_chunk(&connection, ROOT).expect("load split page");
            assert_eq!(split.blocks[0].content, vec![PARAGRAPH, SECOND_PARAGRAPH]);
            assert_eq!(split.blocks[1].properties["title"][0]["text"], "Queen's");
            assert_eq!(split.blocks[2].properties["title"][0]["text"], " pawn");

            apply_operations(
                &mut connection,
                vec![
                    NoteOperation::UpdateProperties {
                        id: PARAGRAPH.to_string(),
                        properties: properties("Queen's pawn"),
                        expected_revision: None,
                    },
                    NoteOperation::RemoveChild {
                        parent_id: Some(ROOT.to_string()),
                        child_id: SECOND_PARAGRAPH.to_string(),
                    },
                    NoteOperation::DeleteBlock {
                        id: SECOND_PARAGRAPH.to_string(),
                    },
                ],
            )
            .expect("merge paragraph");
            let merged = load_page_chunk(&connection, ROOT).expect("load merged page");
            assert_eq!(merged.blocks[0].content, vec![PARAGRAPH]);
            assert_eq!(
                merged.blocks[1].properties["title"][0]["text"],
                "Queen's pawn"
            );

            apply_operations(
                &mut connection,
                vec![
                    NoteOperation::UpdateProperties {
                        id: PARAGRAPH.to_string(),
                        properties: properties("Queen's"),
                        expected_revision: None,
                    },
                    create(SECOND_PARAGRAPH, "paragraph", " pawn"),
                    insert(Some(ROOT), SECOND_PARAGRAPH, 1),
                ],
            )
            .expect("undo paragraph merge");
        }

        let connection = database.open();
        let reopened = load_page_chunk(&connection, ROOT).expect("reopen undone page");
        assert_eq!(
            reopened.blocks[0].content,
            vec![PARAGRAPH, SECOND_PARAGRAPH]
        );
        assert_eq!(reopened.blocks[1].properties["title"][0]["text"], "Queen's");
        assert_eq!(reopened.blocks[2].properties["title"][0]["text"], " pawn");
    }

    #[test]
    fn reopens_one_hundred_paragraphs_in_their_original_order() {
        let database = TestDatabase::new("hundred-paragraphs");
        let paragraph_ids = (0..100)
            .map(|index| format!("00000000-0000-4000-8000-{:012x}", index + 0x1000))
            .collect::<Vec<_>>();
        {
            let mut connection = database.open();
            let mut operations = vec![create(ROOT, "page", "Large note"), insert(None, ROOT, 0)];
            for (index, id) in paragraph_ids.iter().enumerate() {
                operations.push(create(id, "paragraph", &format!("Paragraph {index}")));
                operations.push(insert(Some(ROOT), id, index));
            }
            apply_operations(&mut connection, operations).expect("create large note");
        }

        let connection = database.open();
        let reopened = load_page_chunk(&connection, ROOT).expect("reopen large note");
        assert_eq!(reopened.blocks.len(), 101);
        assert_eq!(
            reopened.blocks[0].content, paragraph_ids,
            "stored paragraph order changed"
        );
        for (index, block) in reopened.blocks.iter().skip(1).enumerate() {
            assert_eq!(
                block.properties["title"][0]["text"],
                format!("Paragraph {index}")
            );
        }
    }

    #[test]
    fn round_trips_the_essential_document_block_vocabulary() {
        let database = TestDatabase::new("essential-block-types");
        let block_types = [
            "paragraph",
            "heading_1",
            "heading_2",
            "heading_3",
            "bulleted_list_item",
            "numbered_list_item",
            "to_do",
            "quote",
            "divider",
            "code",
        ];
        let ids = block_types
            .iter()
            .enumerate()
            .map(|(index, block_type)| {
                (
                    format!("00000000-0000-4000-8000-{:012x}", index + 0x2000),
                    *block_type,
                )
            })
            .collect::<Vec<_>>();
        {
            let mut connection = database.open();
            let mut operations = vec![create(ROOT, "page", "Vocabulary"), insert(None, ROOT, 0)];
            for (index, (id, block_type)) in ids.iter().enumerate() {
                operations.push(create(id, block_type, &format!("{block_type} text")));
                operations.push(insert(Some(ROOT), id, index));
            }
            apply_operations(&mut connection, operations).expect("create essential blocks");
        }

        let connection = database.open();
        let reopened = load_page_chunk(&connection, ROOT).expect("reopen essential blocks");
        assert_eq!(reopened.blocks.len(), block_types.len() + 1);
        for (id, block_type) in ids {
            let block = reopened
                .blocks
                .iter()
                .find(|block| block.id == id)
                .expect("reopened essential block");
            assert_eq!(block.block_type, block_type);
            assert_eq!(
                block.properties["title"][0]["text"],
                format!("{block_type} text")
            );
        }
    }

    #[test]
    fn reopens_a_text_block_transformed_into_a_nested_page() {
        let database = TestDatabase::new("slash-page-transform");
        {
            let mut connection = database.open();
            apply_operations(
                &mut connection,
                vec![
                    create(ROOT, "page", "Opening notes"),
                    create(PARAGRAPH, "paragraph", "/page"),
                    insert(None, ROOT, 0),
                    insert(Some(ROOT), PARAGRAPH, 0),
                    NoteOperation::ChangeType {
                        id: PARAGRAPH.to_string(),
                        block_type: "page".to_string(),
                        expected_revision: None,
                    },
                    NoteOperation::UpdateProperties {
                        id: PARAGRAPH.to_string(),
                        properties: properties("Untitled"),
                        expected_revision: None,
                    },
                    create(SECOND_PARAGRAPH, "paragraph", ""),
                    insert(Some(PARAGRAPH), SECOND_PARAGRAPH, 0),
                ],
            )
            .expect("transform text block into a nested page");
        }

        let connection = database.open();
        let sidebar = load_sidebar(&connection).expect("reopen page sidebar");
        assert!(sidebar.pages.iter().any(|page| page.id == PARAGRAPH));
        let parent = load_page_chunk(&connection, ROOT).expect("reopen parent page");
        assert_eq!(parent.blocks[0].content, vec![PARAGRAPH]);
        assert_eq!(parent.blocks[1].id, PARAGRAPH);
        assert_eq!(parent.blocks[1].block_type, "page");
        let nested = load_page_chunk(&connection, PARAGRAPH).expect("open nested page");
        assert_eq!(nested.blocks[0].id, PARAGRAPH);
        assert_eq!(nested.blocks[0].content, vec![SECOND_PARAGRAPH]);
        assert_eq!(nested.blocks[1].parent_id.as_deref(), Some(PARAGRAPH));
    }

    #[test]
    fn changing_type_preserves_unknown_compatible_properties() {
        let database = TestDatabase::new("type-properties");
        {
            let mut connection = database.open();
            apply_operations(
                &mut connection,
                vec![
                    create(ROOT, "page", "Types"),
                    NoteOperation::CreateBlock {
                        block: NewNoteBlock {
                            id: PARAGRAPH.to_string(),
                            block_type: "paragraph".to_string(),
                            properties: json!({
                                "title": [
                                    { "text": "remember", "bold": true },
                                    {
                                        "text": " this",
                                        "link": "https://example.com/study",
                                        "futureMark": { "kept": true }
                                    }
                                ],
                                "checked": true,
                                "futureProperty": { "kept": true }
                            }),
                        },
                    },
                    insert(None, ROOT, 0),
                    insert(Some(ROOT), PARAGRAPH, 0),
                    NoteOperation::ChangeType {
                        id: PARAGRAPH.to_string(),
                        block_type: "to_do".to_string(),
                        expected_revision: None,
                    },
                ],
            )
            .expect("change paragraph into a to-do");
        }

        let connection = database.open();
        let block = require_block(&connection, PARAGRAPH).expect("changed block");
        assert_eq!(block.block_type, "to_do");
        assert_eq!(block.properties["checked"], true);
        assert_eq!(block.properties["futureProperty"]["kept"], true);
        assert_eq!(block.properties["title"][0]["bold"], true);
        assert_eq!(
            block.properties["title"][1]["link"],
            "https://example.com/study"
        );
        assert_eq!(block.properties["title"][1]["futureMark"]["kept"], true);
    }

    #[test]
    fn reopens_nested_list_moves_through_undo_and_redo() {
        let database = TestDatabase::new("nested-list-moves");
        {
            let mut connection = database.open();
            apply_operations(
                &mut connection,
                vec![
                    create(ROOT, "page", "Plans"),
                    create(PARAGRAPH, "bulleted_list_item", "Prepare c4"),
                    create(SECOND_PARAGRAPH, "bulleted_list_item", "Watch b5"),
                    insert(None, ROOT, 0),
                    insert(Some(ROOT), PARAGRAPH, 0),
                    insert(Some(ROOT), SECOND_PARAGRAPH, 1),
                    NoteOperation::MoveChild {
                        child_id: SECOND_PARAGRAPH.to_string(),
                        parent_id: Some(PARAGRAPH.to_string()),
                        index: 0,
                    },
                ],
            )
            .expect("indent list item");
        }

        {
            let mut connection = database.open();
            let nested = load_page_chunk(&connection, ROOT).expect("reopen nested list");
            assert_eq!(nested.blocks[0].content, vec![PARAGRAPH]);
            let parent = nested
                .blocks
                .iter()
                .find(|block| block.id == PARAGRAPH)
                .expect("list parent");
            assert_eq!(parent.content, vec![SECOND_PARAGRAPH]);

            apply_operations(
                &mut connection,
                vec![NoteOperation::MoveChild {
                    child_id: SECOND_PARAGRAPH.to_string(),
                    parent_id: Some(ROOT.to_string()),
                    index: 1,
                }],
            )
            .expect("undo list indentation");
        }

        {
            let mut connection = database.open();
            let unnested = load_page_chunk(&connection, ROOT).expect("reopen undone list");
            assert_eq!(
                unnested.blocks[0].content,
                vec![PARAGRAPH, SECOND_PARAGRAPH]
            );
            apply_operations(
                &mut connection,
                vec![NoteOperation::MoveChild {
                    child_id: SECOND_PARAGRAPH.to_string(),
                    parent_id: Some(PARAGRAPH.to_string()),
                    index: 0,
                }],
            )
            .expect("redo list indentation");
        }

        let connection = database.open();
        let redone = load_page_chunk(&connection, ROOT).expect("reopen redone list");
        assert_eq!(redone.blocks[0].content, vec![PARAGRAPH]);
        let child = redone
            .blocks
            .iter()
            .find(|block| block.id == SECOND_PARAGRAPH)
            .expect("nested list child");
        assert_eq!(child.parent_id.as_deref(), Some(PARAGRAPH));
    }

    #[test]
    fn accepts_the_camel_case_tauri_operation_contract() {
        let operation: NoteOperation = serde_json::from_value(json!({
            "kind": "insertChild",
            "parentId": ROOT,
            "childId": CHILD,
            "index": 0
        }))
        .expect("camel-case operation");

        match operation {
            NoteOperation::InsertChild {
                parent_id,
                child_id,
                index,
            } => {
                assert_eq!(parent_id.as_deref(), Some(ROOT));
                assert_eq!(child_id, CHILD);
                assert_eq!(index, 0);
            }
            _ => panic!("wrong operation variant"),
        }

        let deletion: NoteOperation = serde_json::from_value(json!({
            "kind": "deleteSubtree",
            "id": ROOT
        }))
        .expect("camel-case subtree deletion");
        match deletion {
            NoteOperation::DeleteSubtree { id } => assert_eq!(id, ROOT),
            _ => panic!("wrong deletion variant"),
        }

        let block = NoteBlock {
            id: ROOT.to_string(),
            block_type: "page".to_string(),
            properties: properties("Contract"),
            content: vec![CHILD.to_string()],
            parent_id: None,
            revision: 1,
            created_at: 1,
            updated_at: 1,
        };
        let serialized = serde_json::to_value(block).expect("serialized block");
        assert_eq!(serialized["type"], "page");
        assert_eq!(serialized["parentId"], Value::Null);
        assert_eq!(serialized["updatedAt"], 1);
    }
}
