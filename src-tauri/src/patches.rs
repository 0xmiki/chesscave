use rusqlite::{params, Connection};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const PATCHES_SCHEMA_VERSION: u32 = 1;

fn patches_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("patches").join("chesscave-patches.sqlite3"))
        .map_err(|error| format!("Could not resolve the ChessCave patches directory: {error}"))
}

fn open_database(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create the patches directory: {error}"))?;
    }
    let connection = Connection::open(path)
        .map_err(|error| format!("Could not open the patches database: {error}"))?;
    connection
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| format!("Could not configure the patches database timeout: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS patch_cards (
                id TEXT PRIMARY KEY NOT NULL,
                card_json TEXT NOT NULL,
                due_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS patch_cards_due_idx
                ON patch_cards(due_at, created_at);",
        )
        .map_err(|error| format!("Could not initialize the patches database: {error}"))?;
    connection
        .pragma_update(None, "user_version", PATCHES_SCHEMA_VERSION)
        .map_err(|error| format!("Could not record the patches schema: {error}"))?;
    Ok(connection)
}

async fn run_database<T, F>(path: PathBuf, callback: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(Connection) -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(move || callback(open_database(&path)?))
        .await
        .map_err(|error| format!("The patches database task stopped unexpectedly: {error}"))?
}

fn integer_at(card: &Value, pointer: &str, label: &str) -> Result<i64, String> {
    card.pointer(pointer)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("Patch card {label} must be an integer."))
}

fn validate_card(card: &Value) -> Result<(&str, i64, i64, i64), String> {
    let object = card
        .as_object()
        .ok_or_else(|| "A patch card must be a JSON object.".to_string())?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("This patch card schema is not supported.".to_string());
    }
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty() && value.len() <= 80)
        .ok_or_else(|| "A patch card needs a valid ID.".to_string())?;
    if card
        .pointer("/source/fen")
        .and_then(Value::as_str)
        .is_none()
        || card.pointer("/quiz/kind").and_then(Value::as_str) != Some("find-move")
        || card
            .pointer("/quiz/acceptedMoves")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
    {
        return Err("The patch card is missing its position or move quiz.".to_string());
    }
    Ok((
        id,
        integer_at(card, "/schedule/dueAt", "due date")?,
        integer_at(card, "/createdAt", "creation time")?,
        integer_at(card, "/updatedAt", "update time")?,
    ))
}

fn save_card(connection: &Connection, card: Value) -> Result<Value, String> {
    let (id, due_at, created_at, updated_at) = validate_card(&card)?;
    let encoded = serde_json::to_string(&card)
        .map_err(|error| format!("Could not encode the patch card: {error}"))?;
    connection
        .execute(
            "INSERT INTO patch_cards (id, card_json, due_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                card_json = excluded.card_json,
                due_at = excluded.due_at,
                updated_at = excluded.updated_at",
            params![id, encoded, due_at, created_at, updated_at],
        )
        .map_err(|error| format!("Could not save patch card {id}: {error}"))?;
    Ok(card)
}

fn list_cards(connection: &Connection) -> Result<Vec<Value>, String> {
    let mut statement = connection
        .prepare("SELECT card_json FROM patch_cards ORDER BY due_at, created_at, id")
        .map_err(|error| format!("Could not prepare the patches query: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Could not query patch cards: {error}"))?;
    rows.map(|row| {
        let encoded = row.map_err(|error| format!("Could not read a patch card: {error}"))?;
        serde_json::from_str(&encoded)
            .map_err(|error| format!("A saved patch card is invalid: {error}"))
    })
    .collect()
}

#[tauri::command]
pub async fn patches_save(app: AppHandle, card: Value) -> Result<Value, String> {
    let path = patches_database_path(&app)?;
    run_database(path, move |connection| save_card(&connection, card)).await
}

#[tauri::command]
pub async fn patches_list(app: AppHandle) -> Result<Vec<Value>, String> {
    let path = patches_database_path(&app)?;
    run_database(path, |connection| list_cards(&connection)).await
}

#[tauri::command]
pub async fn patches_delete(app: AppHandle, id: String) -> Result<(), String> {
    let path = patches_database_path(&app)?;
    run_database(path, move |connection| {
        connection
            .execute("DELETE FROM patch_cards WHERE id = ?1", params![id])
            .map_err(|error| format!("Could not delete the patch card: {error}"))?;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TestDatabase(PathBuf);

    impl TestDatabase {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            Self(std::env::temp_dir().join(format!(
                "chesscave-patches-{label}-{}-{unique}.sqlite3",
                process::id()
            )))
        }
    }

    impl Drop for TestDatabase {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm"] {
                let _ = fs::remove_file(format!("{}{}", self.0.display(), suffix));
            }
        }
    }

    fn card(id: &str, due_at: i64) -> Value {
        json!({
            "schemaVersion": 1,
            "id": id,
            "source": { "fen": "8/8/8/8/8/8/4K3/6k1 w - - 0 1" },
            "quiz": {
                "kind": "find-move",
                "acceptedMoves": [{ "uci": "e2e3", "san": "Ke3" }]
            },
            "schedule": { "dueAt": due_at },
            "createdAt": 100,
            "updatedAt": 100
        })
    }

    #[test]
    fn saves_updates_and_orders_patch_cards() {
        let database = TestDatabase::new("save");
        let connection = open_database(&database.0).expect("database");
        save_card(&connection, card("later", 300)).expect("later card");
        save_card(&connection, card("first", 200)).expect("first card");
        let mut updated = card("later", 100);
        updated["updatedAt"] = json!(200);
        save_card(&connection, updated).expect("updated card");

        let cards = list_cards(&connection).expect("cards");
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0]["id"], "later");
        assert_eq!(cards[1]["id"], "first");
    }

    #[test]
    fn rejects_unrenderable_cards() {
        let database = TestDatabase::new("reject");
        let connection = open_database(&database.0).expect("database");
        let invalid = json!({ "schemaVersion": 1, "id": "broken" });
        assert!(save_card(&connection, invalid).is_err());
    }
}
