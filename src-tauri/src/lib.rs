mod chess_com;
mod codex;
mod engine;
mod notes;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(codex::CoachState::default())
        .invoke_handler(tauri::generate_handler![
            engine::engine_status,
            engine::analyze_position,
            engine::review_game,
            chess_com::chess_com_dashboard,
            chess_com::chess_com_rapid_since,
            notes::notes_bootstrap,
            notes::notes_load_sidebar,
            notes::notes_load_page,
            notes::notes_apply_transaction,
            codex::coach_start,
            codex::coach_new_thread,
            codex::coach_send,
            codex::coach_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
