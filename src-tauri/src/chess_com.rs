use reqwest::{Client, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const API_ROOT: &str = "https://api.chess.com/pub/player";
const MAX_ARCHIVES: usize = 4;
const RECENT_GAMES_PER_CLASS: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComProfile {
    username: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    avatar: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    location: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    joined: Option<u64>,
    #[serde(default)]
    last_online: Option<u64>,
    #[serde(default)]
    followers: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComRatingSnapshot {
    rating: i32,
    date: u64,
    #[serde(default)]
    rd: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComBestRating {
    rating: i32,
    date: u64,
    #[serde(default)]
    game: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComRecord {
    #[serde(default)]
    win: u32,
    #[serde(default)]
    loss: u32,
    #[serde(default)]
    draw: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComRatingStats {
    #[serde(default)]
    last: Option<ChessComRatingSnapshot>,
    #[serde(default)]
    best: Option<ChessComBestRating>,
    #[serde(default)]
    record: ChessComRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComStats {
    #[serde(default)]
    chess_rapid: Option<ChessComRatingStats>,
    #[serde(default)]
    chess_blitz: Option<ChessComRatingStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComGamePlayer {
    #[serde(default)]
    username: String,
    #[serde(default)]
    rating: i32,
    #[serde(default)]
    result: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComAccuracies {
    #[serde(default)]
    white: Option<f64>,
    #[serde(default)]
    black: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct ChessComGame {
    #[serde(default)]
    url: String,
    #[serde(default)]
    pgn: String,
    #[serde(default)]
    time_control: String,
    #[serde(default)]
    end_time: u64,
    #[serde(default)]
    rated: bool,
    #[serde(default)]
    time_class: String,
    #[serde(default)]
    rules: String,
    #[serde(default)]
    uuid: Option<String>,
    #[serde(default)]
    eco: Option<String>,
    #[serde(default)]
    accuracies: Option<ChessComAccuracies>,
    #[serde(default)]
    white: ChessComGamePlayer,
    #[serde(default)]
    black: ChessComGamePlayer,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChessComDashboard {
    profile: ChessComProfile,
    stats: ChessComStats,
    games: Vec<ChessComGame>,
    fetched_at_ms: u64,
}

#[derive(Debug, Deserialize)]
struct ChessComArchives {
    #[serde(default)]
    archives: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ChessComGamesResponse {
    #[serde(default)]
    games: Vec<ChessComGame>,
}

fn normalize_username(value: &str) -> Result<String, String> {
    let username = value.trim().trim_start_matches('@').to_ascii_lowercase();
    if username.is_empty() {
        return Err("Enter a Chess.com username.".to_string());
    }
    if username.len() > 32
        || !username
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err("That Chess.com username has an unsupported format.".to_string());
    }
    Ok(username)
}

fn api_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("ChessCave/0.1 (desktop chess study; public profile dashboard)")
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|error| format!("Could not prepare the Chess.com connection: {error}"))
}

async fn fetch_json<T: DeserializeOwned>(
    client: &Client,
    url: &str,
    description: &str,
) -> Result<T, String> {
    let response = client.get(url).send().await.map_err(|error| {
        format!("Could not reach Chess.com while loading {description}: {error}")
    })?;
    let status = response.status();

    if status == StatusCode::NOT_FOUND {
        return Err(format!("Chess.com could not find {description}."));
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return Err(
            "Chess.com is temporarily rate limiting requests. Wait a moment and refresh again."
                .to_string(),
        );
    }
    if !status.is_success() {
        return Err(format!(
            "Chess.com returned {status} while loading {description}."
        ));
    }

    response
        .json::<T>()
        .await
        .map_err(|error| format!("Chess.com returned invalid {description} data: {error}"))
}

fn select_recent_games(games: Vec<ChessComGame>, limit: usize) -> Vec<ChessComGame> {
    let mut rapid = games
        .iter()
        .filter(|game| game.rules == "chess" && game.time_class == "rapid" && !game.pgn.is_empty())
        .cloned()
        .collect::<Vec<_>>();
    let mut blitz = games
        .into_iter()
        .filter(|game| game.rules == "chess" && game.time_class == "blitz" && !game.pgn.is_empty())
        .collect::<Vec<_>>();

    rapid.sort_by(|left, right| right.end_time.cmp(&left.end_time));
    blitz.sort_by(|left, right| right.end_time.cmp(&left.end_time));
    rapid.truncate(limit);
    blitz.truncate(limit);
    rapid.extend(blitz);
    rapid.sort_by(|left, right| right.end_time.cmp(&left.end_time));
    rapid
}

fn select_rapid_since(games: Vec<ChessComGame>, since: u64) -> Vec<ChessComGame> {
    let mut rapid = games
        .into_iter()
        .filter(|game| {
            game.rules == "chess"
                && game.time_class == "rapid"
                && !game.pgn.is_empty()
                && game.end_time >= since
        })
        .collect::<Vec<_>>();
    rapid.sort_by(|left, right| right.end_time.cmp(&left.end_time));
    rapid
}

#[tauri::command]
pub async fn chess_com_rapid_since(
    username: String,
    since: u64,
) -> Result<Vec<ChessComGame>, String> {
    let username = normalize_username(&username)?;
    let client = api_client()?;
    let profile_url = format!("{API_ROOT}/{username}");
    let archives_url = format!("{profile_url}/games/archives");
    let archives =
        fetch_json::<ChessComArchives>(&client, &archives_url, "the game archive").await?;
    let trusted_archive_prefix = format!("{profile_url}/games/");
    let mut games = Vec::new();

    // Four archives safely covers a trailing seven-day window around month and
    // year boundaries without turning this into a broad history sync.
    for archive_url in archives.archives.iter().rev().take(MAX_ARCHIVES) {
        if !archive_url.starts_with(&trusted_archive_prefix) {
            continue;
        }
        let archive =
            fetch_json::<ChessComGamesResponse>(&client, archive_url, "weekly Rapid games").await?;
        games.extend(archive.games);
    }

    Ok(select_rapid_since(games, since))
}

#[tauri::command]
pub async fn chess_com_dashboard(username: String) -> Result<ChessComDashboard, String> {
    let username = normalize_username(&username)?;
    let client = api_client()?;
    let profile_url = format!("{API_ROOT}/{username}");
    let stats_url = format!("{profile_url}/stats");
    let archives_url = format!("{profile_url}/games/archives");

    // Chess.com's PubAPI asks clients to make requests serially to avoid rate limiting.
    let profile =
        fetch_json::<ChessComProfile>(&client, &profile_url, &format!("player “{username}”"))
            .await?;
    let stats = fetch_json::<ChessComStats>(&client, &stats_url, "player ratings").await?;
    let archives =
        fetch_json::<ChessComArchives>(&client, &archives_url, "the game archive").await?;

    let trusted_archive_prefix = format!("{profile_url}/games/");
    let mut games = Vec::new();
    let mut rapid_count = 0usize;
    let mut blitz_count = 0usize;

    for archive_url in archives.archives.iter().rev().take(MAX_ARCHIVES) {
        if !archive_url.starts_with(&trusted_archive_prefix) {
            continue;
        }
        let archive =
            fetch_json::<ChessComGamesResponse>(&client, archive_url, "recent games").await?;
        for game in archive.games {
            if game.rules != "chess" || game.pgn.is_empty() {
                continue;
            }
            match game.time_class.as_str() {
                "rapid" => rapid_count += 1,
                "blitz" => blitz_count += 1,
                _ => continue,
            }
            games.push(game);
        }
        if rapid_count >= RECENT_GAMES_PER_CLASS && blitz_count >= RECENT_GAMES_PER_CLASS {
            break;
        }
    }

    let fetched_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64;

    Ok(ChessComDashboard {
        profile,
        stats,
        games: select_recent_games(games, RECENT_GAMES_PER_CLASS),
        fetched_at_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::{normalize_username, select_rapid_since, select_recent_games, ChessComGame};

    fn game(time_class: &str, end_time: u64, rules: &str, pgn: &str) -> ChessComGame {
        ChessComGame {
            time_class: time_class.to_string(),
            end_time,
            rules: rules.to_string(),
            pgn: pgn.to_string(),
            ..ChessComGame::default()
        }
    }

    #[test]
    fn validates_and_normalizes_usernames() {
        assert_eq!(
            normalize_username(" @Example_Player ").unwrap(),
            "example_player"
        );
        assert!(normalize_username("member/name").is_err());
        assert!(normalize_username(" ").is_err());
    }

    #[test]
    fn keeps_only_recent_standard_rapid_and_blitz_games() {
        let selected = select_recent_games(
            vec![
                game("rapid", 2, "chess", "rapid-new"),
                game("rapid", 1, "chess", "rapid-old"),
                game("blitz", 4, "chess", "blitz-new"),
                game("blitz", 3, "chess960", "variant"),
                game("bullet", 5, "chess", "bullet"),
                game("blitz", 6, "chess", ""),
            ],
            1,
        );

        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].pgn, "blitz-new");
        assert_eq!(selected[1].pgn, "rapid-new");
    }

    #[test]
    fn keeps_every_rapid_game_inside_the_requested_window() {
        let selected = select_rapid_since(
            vec![
                game("rapid", 300, "chess", "newest"),
                game("rapid", 200, "chess", "inside"),
                game("rapid", 99, "chess", "old"),
                game("blitz", 250, "chess", "wrong-class"),
            ],
            100,
        );

        assert_eq!(selected.len(), 2);
        assert_eq!(selected[0].pgn, "newest");
        assert_eq!(selected[1].pgn, "inside");
    }
}
