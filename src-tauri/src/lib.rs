use base64::Engine;
use chrono::Local;
use futures::prelude::*;
use irc::client::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::sync::Mutex;

#[derive(Serialize, Clone)]
struct IrcMessage {
    server_id: String,
    sender: String,
    content: String,
    channel: String,
    is_system: bool,
    timestamp: Option<String>,
}

impl IrcMessage {
    fn system(server_id: String, sender: String, content: String, channel: String) -> Self {
        Self {
            server_id,
            sender,
            content,
            channel,
            is_system: true,
            timestamp: None,
        }
    }
}

#[derive(Serialize, Clone)]
struct IrcUserEvent {
    server_id: String,
    channel: String,
    users: Vec<String>,
    event_type: String,
}

#[derive(Serialize, Clone)]
struct IrcStatusEvent {
    server_id: String,
    connected: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
struct IrcWelcomeNickEvent {
    server_id: String,
    welcome_nick: String,
}

#[derive(Serialize, Clone)]
struct IrcNickChangeEvent {
    server_id: String,
    old_nick: String,
    new_nick: String,
}

#[derive(Serialize, Clone)]
struct IrcTopicEvent {
    server_id: String,
    channel: String,
    topic: String,
    set_by: Option<String>,
}

#[derive(Serialize, Clone)]
struct IrcOpsEvent {
    server_id: String,
    channel: String,
    ops: Vec<String>,
}

#[derive(Serialize, Clone)]
struct IrcModeEvent {
    server_id: String,
    channel: String,
    modes: String,
    set_by: Option<String>,
    is_full_listing: Option<bool>,
}

#[derive(Serialize, Clone)]
struct IrcTopicErrorEvent {
    server_id: String,
    channel: String,
    error: String,
}

#[derive(Serialize, Clone)]
struct IrcUserHostEvent {
    server_id: String,
    nick: String,
    host: String,
    realname: Option<String>,
}

fn emit_user_host(
    app: &AppHandle,
    server_id: &str,
    nick: &str,
    user: &str,
    host: &str,
    realname: Option<String>,
) {
    if nick.is_empty() || host.is_empty() {
        return;
    }
    let hostmask = if user.is_empty() {
        host.to_string()
    } else {
        format!("{}@{}", user, host)
    };
    let _ = app.emit(
        "irc_user_host_event",
        IrcUserHostEvent {
            server_id: server_id.to_string(),
            nick: nick.to_string(),
            host: hostmask,
            realname,
        },
    );
}

#[derive(Serialize, Clone)]
struct IrcBadChannelKeyEvent {
    server_id: String,
    channel: String,
    error: String,
}

#[derive(Serialize, Clone)]
struct IrcInviteOnlyEvent {
    server_id: String,
    channel: String,
    error: String,
}

#[derive(Serialize, Clone)]
struct IrcModeErrorEvent {
    server_id: String,
    channel: String,
    error: String,
}

#[derive(Serialize, Clone)]
struct IrcInvitedEvent {
    server_id: String,
    channel: String,
    inviter: String,
}

#[derive(Serialize, Clone)]
struct IrcMotdEvent {
    server_id: String,
    motd: Vec<String>,
}

#[derive(Serialize, Clone)]
struct IrcAwayEvent {
    server_id: String,
    nick: String,
    away: bool,
    reason: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    timestamp: String,
    sender: String,
    content: String,
    #[serde(default)]
    offset: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogPage {
    entries: Vec<LogEntry>,
    next_offset: Option<u64>,
    #[serde(default)]
    next_after: Option<u64>,
}

/// Structured search criteria produced by the frontend query parser
/// (`src/lib/search/search-query.ts`). All text matching is case-insensitive.
#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct SearchCriteria {
    /// Every term must appear in the lowercased content (`foo bar`).
    #[serde(default)]
    terms: Vec<String>,
    /// Exact multi-word phrases that must appear verbatim (`"quoted phrase"`).
    #[serde(default)]
    phrases: Vec<String>,
    /// Terms that must NOT appear in the content (`-term`).
    #[serde(default)]
    exclude_terms: Vec<String>,
    /// Exact phrases that must NOT appear (`-"quoted phrase"`).
    #[serde(default)]
    exclude_phrases: Vec<String>,
    /// `from:` — resolved by the frontend into a list of nicks (nick OR realname
    /// match against the member list). Case-insensitive ANY-of match.
    #[serde(default)]
    senders: Vec<String>,
    /// `mentions:` — case-insensitive substring match in content.
    #[serde(default)]
    mention: Option<String>,
    /// Inclusive lower bound, local time formatted `YYYY-MM-DD HH:MM:SS`.
    #[serde(default)]
    after: Option<String>,
    /// Inclusive upper bound, local time formatted `YYYY-MM-DD HH:MM:SS`.
    #[serde(default)]
    before: Option<String>,
    /// `/pattern/` regex literals the content must match (patterns carry inline `(?i)`).
    #[serde(default)]
    regexes: Vec<String>,
    /// Negated regex literals (`-/pattern/`).
    #[serde(default)]
    exclude_regexes: Vec<String>,
    /// Maximum number of hits returned per page (default 200).
    #[serde(default)]
    limit: Option<usize>,
    /// Sort order: "newest" (default) or "oldest".
    #[serde(default)]
    order: Option<String>,
    /// For pagination / lazy loading when order == "newest": only matches with offset < before_offset.
    #[serde(default)]
    before_offset: Option<u64>,
    /// For pagination / lazy loading when order == "oldest": only matches with offset > after_offset.
    #[serde(default)]
    after_offset: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SearchHit {
    timestamp: String,
    sender: String,
    content: String,
    offset: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ChannelConfig {
    name: String,
    password: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IrcConnectParams {
    server_id: String,
    host: String,
    port: u16,
    nicknames: Vec<String>,
    #[serde(default)]
    realname: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    channels: Vec<ChannelConfig>,
    #[serde(default)]
    use_tls: bool,
    #[serde(default)]
    parse_legacy_znc_timestamps: bool,
}

struct RecentSentMessage {
    server_id: String,
    target: String,
    content: String,
    timestamp: std::time::Instant,
}

struct IrcState {
    senders: Arc<Mutex<HashMap<String, Sender>>>,
    nicknames: Arc<Mutex<HashMap<String, String>>>,
    /// Key: "server_id\x00channel_lowercase" → set of lowercase nicks
    channel_members: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    recent_sent_messages: Arc<Mutex<Vec<RecentSentMessage>>>,
}

#[derive(Clone)]
struct LogState {
    writers: Arc<Mutex<HashMap<String, Arc<Mutex<File>>>>>,
}

fn safe_log_component(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '#') {
                character
            } else {
                '_'
            }
        })
        .collect();

    let sanitized = sanitized.trim_matches('.');
    if sanitized.is_empty() || sanitized == ".." {
        "unknown".to_string()
    } else {
        sanitized.to_string()
    }
}

fn log_path(app: &AppHandle, server_id: &str, target: &str) -> Result<(String, PathBuf), String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
        .join("logs");
    let safe_server = safe_log_component(server_id);
    let safe_target = safe_log_component(target);
    let key = format!("{server_id}\0{target}");
    Ok((
        key,
        root.join(safe_server).join(format!("{safe_target}.log")),
    ))
}

fn extract_message_timestamp(
    tags: &Option<Vec<irc::proto::message::Tag>>,
    content: &mut String,
    parse_legacy: bool,
) -> Option<String> {
    if let Some(tags_vec) = tags {
        for tag in tags_vec {
            if tag.0 == "time" || tag.0 == "znc.in/server-time-iso" {
                if let Some(ref val) = tag.1 {
                    if !val.trim().is_empty() {
                        return Some(val.trim().to_string());
                    }
                }
            }
        }
    }

    if parse_legacy {
        use regex::Regex;
        static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        let re = RE.get_or_init(|| Regex::new(r"^\[(\d{2}:\d{2}(?::\d{2})?)\]\s*").unwrap());

        let matched = re.captures(content).and_then(|captures| {
            let time_str = captures.get(1)?.as_str().to_string();
            let match_len = captures.get(0)?.len();
            Some((time_str, match_len))
        });

        if let Some((time_str, match_len)) = matched {
            *content = content[match_len..].to_string();
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            let iso_time = if time_str.len() == 5 {
                format!("{today}T{time_str}:00Z")
            } else {
                format!("{today}T{time_str}Z")
            };
            return Some(iso_time);
        }
    }

    None
}

async fn append_log_line(
    app: &AppHandle,
    state: &LogState,
    server_id: &str,
    target: &str,
    sender: &str,
    content: &str,
) -> Result<(), String> {
    if target == "***" || sender == "***" || target.trim().is_empty() {
        return Ok(());
    }
    let (key, path) = log_path(app, server_id, target)?;
    let writer = {
        let mut writers = state.writers.lock().await;
        if let Some(writer) = writers.get(&key) {
            writer.clone()
        } else {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)
                    .await
                    .map_err(|error| format!("Failed to create log directory: {error}"))?;
            }
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .await
                .map_err(|error| format!("Failed to open log file: {error}"))?;
            let writer = Arc::new(Mutex::new(file));
            writers.insert(key, writer.clone());
            writer
        }
    };

    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let normalized_content = content.replace(['\r', '\n'], " ");
    let line = format!("[{timestamp}] <{sender}> {normalized_content}\n");
    let mut file = writer.lock().await;
    file.write_all(line.as_bytes())
        .await
        .map_err(|error| format!("Failed to append log line: {error}"))?;
    file.flush()
        .await
        .map_err(|error| format!("Failed to flush log line: {error}"))
}

async fn close_server_logs(state: &LogState, server_id: &str) {
    let prefix = format!("{server_id}\0");
    state
        .writers
        .lock()
        .await
        .retain(|key, _| !key.starts_with(&prefix));
}

fn parse_log_line(line: &str) -> Option<LogEntry> {
    let timestamp_end = line.find("] <")?;
    let timestamp = line.get(1..timestamp_end)?.to_string();
    let sender_start = timestamp_end + 3;
    let sender_end = line.get(sender_start..)?.find("> ")? + sender_start;
    let sender = line.get(sender_start..sender_end)?.to_string();
    let content = line.get(sender_end + 2..)?.to_string();

    Some(LogEntry {
        timestamp,
        sender,
        content,
        offset: 0,
    })
}

async fn remove_last_log_line_internal(
    app: &AppHandle,
    state: &LogState,
    server_id: &str,
    target: &str,
    sender: &str,
) -> Result<bool, String> {
    let (key, path) = log_path(app, server_id, target)?;

    {
        let mut writers = state.writers.lock().await;
        writers.remove(&key);
    }

    if !path.exists() {
        return Ok(false);
    }

    let content = match fs::read_to_string(&path).await {
        Ok(c) => c,
        Err(e) => return Err(format!("Failed to read log file: {e}")),
    };

    let mut lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        let _ = fs::remove_file(&path).await;
        return Ok(false);
    }

    let mut remove_idx = None;
    for (i, line) in lines.iter().enumerate().rev() {
        if let Some(entry) = parse_log_line(line) {
            if entry.sender.eq_ignore_ascii_case(sender) || sender.is_empty() || sender == "You" {
                remove_idx = Some(i);
                break;
            }
        }
    }

    if let Some(idx) = remove_idx {
        lines.remove(idx);
        if lines.is_empty() {
            if let Err(e) = fs::remove_file(&path).await {
                log::error!("Failed to remove empty log file {:?}: {}", path, e);
            }
        } else {
            let new_content = lines.join("\n") + "\n";
            if let Err(e) = fs::write(&path, new_content).await {
                return Err(format!("Failed to write updated log file: {e}"));
            }
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

async fn read_log_tail(
    app: &AppHandle,
    server_id: &str,
    target: &str,
) -> Result<Vec<LogEntry>, String> {
    Ok(read_log_page(app, server_id, target, None).await?.entries)
}

async fn read_log_page(
    app: &AppHandle,
    server_id: &str,
    target: &str,
    before: Option<u64>,
) -> Result<LogPage, String> {
    let (_, path) = log_path(app, server_id, target)?;
    let mut file = match File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LogPage {
                entries: Vec::new(),
                next_offset: None,
                next_after: None,
            })
        }
        Err(error) => return Err(format!("Failed to open log file: {error}")),
    };

    let file_size = file
        .metadata()
        .await
        .map_err(|error| format!("Failed to read log metadata: {error}"))?
        .len();
    let mut position = before.unwrap_or(file_size).min(file_size);
    if position == 0 {
        return Ok(LogPage {
            entries: Vec::new(),
            next_offset: None,
            next_after: None,
        });
    }

    let end = position;
    let mut page = Vec::new();
    const CHUNK_SIZE: u64 = 16384;

    while position > 0 {
        let read_size = position.min(CHUNK_SIZE);
        position -= read_size;
        file.seek(SeekFrom::Start(position))
            .await
            .map_err(|error| format!("Failed to seek log file: {error}"))?;
        let mut chunk = vec![0; read_size as usize];
        file.read_exact(&mut chunk)
            .await
            .map_err(|error| format!("Failed to read log file: {error}"))?;
        chunk.extend_from_slice(&page);
        page = chunk;

        if page.iter().filter(|byte| **byte == b'\n').count() > 200 || position == 0 {
            break;
        }
    }

    let content_start = if position > 0 {
        page.iter()
            .position(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(page.len())
    } else {
        0
    };
    let content = &page[content_start..];
    let mut lines = Vec::new();
    let mut line_offset = end - page.len() as u64 + content_start as u64;

    for line in content.split(|byte| *byte == b'\n') {
        let current_offset = line_offset;
        line_offset += line.len() as u64 + 1;
        if line.is_empty() {
            continue;
        }
        if let Ok(line) = std::str::from_utf8(line) {
            lines.push((current_offset, line.trim_end_matches('\r')));
        }
    }

    const PAGE_LINES: usize = 200;
    let start = lines.len().saturating_sub(PAGE_LINES);
    let selected = &lines[start..];
    let next_offset = selected
        .first()
        .map(|(offset, _)| *offset)
        .filter(|offset| *offset > 0);

    Ok(LogPage {
        entries: selected
            .iter()
            .filter_map(|(offset, line)| {
                parse_log_line(line).map(|mut entry| {
                    entry.offset = *offset;
                    entry
                })
            })
            .collect(),
        next_offset,
        next_after: None,
    })
}

#[tauri::command]
async fn load_log_tail(
    app: AppHandle,
    server_id: String,
    channel: String,
) -> Result<Vec<LogEntry>, String> {
    read_log_tail(&app, &server_id, &channel).await
}

#[tauri::command]
async fn load_log_page(
    app: AppHandle,
    server_id: String,
    channel: String,
    before: Option<u64>,
    after: Option<u64>,
) -> Result<LogPage, String> {
    if let Some(after_offset) = after {
        read_log_page_forward(&app, &server_id, &channel, after_offset).await
    } else {
        read_log_page(&app, &server_id, &channel, before).await
    }
}

/// Reads up to 200 log lines *strictly after* the given byte offset (line start),
/// continuing forward. Returns `next_after` so the next page can continue from
/// where this one stopped.
async fn read_log_page_forward(
    app: &AppHandle,
    server_id: &str,
    target: &str,
    after: u64,
) -> Result<LogPage, String> {
    let (_, path) = log_path(app, server_id, target)?;
    let mut file = match File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LogPage {
                entries: Vec::new(),
                next_offset: None,
                next_after: None,
            })
        }
        Err(error) => return Err(format!("Failed to open log file: {error}")),
    };

    let file_size = file
        .metadata()
        .await
        .map_err(|error| format!("Failed to read log metadata: {error}"))?
        .len();
    // Sip over the (partial) line that starts exactly at `after`, then collect
    // full lines that begin after it.
    if after >= file_size {
        return Ok(LogPage {
            entries: Vec::new(),
            next_offset: None,
            next_after: None,
        });
    }
    file.seek(SeekFrom::Start(after)).await
        .map_err(|error| format!("Failed to seek log file: {error}"))?;

    const PAGE_LINES: usize = 200;
    const CHUNK_SIZE: usize = 16384;
    let mut lines: Vec<(u64, String)> = Vec::new();
    let mut partial: Vec<u8> = Vec::new();
    let mut line_offset = after;
    let mut skip_current_line = true; // the line beginning at `after` belongs to the previous page
    let mut cursor = after;
    let mut chunk = vec![0u8; CHUNK_SIZE];

    'outer: loop {
        let n = file.read(&mut chunk).await
            .map_err(|error| format!("Failed to read log file: {error}"))?;
        if n == 0 {
            break 'outer;
        }
        let mut i = 0usize;
        while i < n {
            let byte = chunk[i];
            i += 1;
            if byte == b'\n' {
                if !skip_current_line {
                    if let Ok(line) = std::str::from_utf8(&partial) {
                        let line_str = line.trim_end_matches('\r').to_string();
                        if !line_str.is_empty() {
                            lines.push((line_offset, line_str));
                            if lines.len() >= PAGE_LINES {
                                break 'outer;
                            }
                        }
                    }
                }
                partial.clear();
                line_offset = cursor + i as u64;
                skip_current_line = false;
            } else {
                partial.push(byte);
            }
        }
        cursor += n as u64;
    }

    if !skip_current_line && !partial.is_empty() {
        if let Ok(line) = std::str::from_utf8(&partial) {
            let line_str = line.trim_end_matches('\r').to_string();
            if !line_str.is_empty() {
                lines.push((line_offset, line_str));
            }
        }
    }

    let next_after = if lines.len() >= PAGE_LINES {
        lines
            .last()
            .map(|(offset, _)| *offset)
            .filter(|offset| *offset < file_size)
    } else {
        None
    };

    Ok(LogPage {
        entries: lines
            .iter()
            .filter_map(|(offset, line)| {
                parse_log_line(line).map(|mut entry| {
                    entry.offset = *offset;
                    entry
                })
            })
            .collect(),
        next_offset: None,
        next_after,
    })
}

/// Criteria with case-normalized text fields so per-line matching avoids repeated allocations.
struct PreparedSearch {
    terms: Vec<String>,
    phrases: Vec<String>,
    exclude_terms: Vec<String>,
    exclude_phrases: Vec<String>,
    senders: Vec<String>,
    mention: Option<String>,
    after: Option<String>,
    before: Option<String>,
    regexes: Vec<regex::Regex>,
    exclude_regexes: Vec<regex::Regex>,
}

impl PreparedSearch {
    fn new(criteria: &SearchCriteria) -> Self {
        Self {
            terms: criteria.terms.iter().map(|t| t.to_lowercase()).collect(),
            phrases: criteria.phrases.iter().map(|t| t.to_lowercase()).collect(),
            exclude_terms: criteria.exclude_terms.iter().map(|t| t.to_lowercase()).collect(),
            exclude_phrases: criteria.exclude_phrases.iter().map(|t| t.to_lowercase()).collect(),
            senders: criteria.senders.clone(),
            mention: criteria.mention.as_ref().map(|m| m.to_lowercase()),
            after: criteria.after.clone(),
            before: criteria.before.clone(),
            regexes: criteria
                .regexes
                .iter()
                .filter_map(|pattern| regex::Regex::new(pattern).ok())
                .collect(),
            exclude_regexes: criteria
                .exclude_regexes
                .iter()
                .filter_map(|pattern| regex::Regex::new(pattern).ok())
                .collect(),
        }
    }
}

fn line_matches(
    timestamp: &str,
    sender: &str,
    content: &str,
    content_lower: &str,
    search: &PreparedSearch,
) -> bool {
    // Log timestamps are fixed-width `YYYY-MM-DD HH:MM:SS`, so lexicographic compare is chronological.
    if let Some(after) = &search.after {
        if timestamp < after.as_str() {
            return false;
        }
    }
    if let Some(before) = &search.before {
        if timestamp > before.as_str() {
            return false;
        }
    }
    if !search.senders.is_empty() {
        // ANY-of match (the frontend resolves realname queries into nick lists).
        if !search.senders.iter().any(|candidate| sender.eq_ignore_ascii_case(candidate)) {
            return false;
        }
    }
    if let Some(mention) = &search.mention {
        if !content_lower.contains(mention.as_str()) {
            return false;
        }
    }
    for term in &search.terms {
        if !content_lower.contains(term.as_str()) {
            return false;
        }
    }
    for phrase in &search.phrases {
        if !content_lower.contains(phrase.as_str()) {
            return false;
        }
    }
    for excluded in &search.exclude_terms {
        if content_lower.contains(excluded.as_str()) {
            return false;
        }
    }
    for excluded in &search.exclude_phrases {
        if content_lower.contains(excluded.as_str()) {
            return false;
        }
    }
    // Regex literals run against the ORIGINAL-case content; their inline `(?i)` flag
    // handles case-insensitivity without relying on the pre-lowercased copy.
    for re in &search.regexes {
        if !re.is_match(content) {
            return false;
        }
    }
    for re in &search.exclude_regexes {
        if re.is_match(content) {
            return false;
        }
    }
    true
}

/// Streams the whole channel log oldest → newest and returns up to `criteria.limit`
/// NEWEST matches ordered newest-first. Each hit carries the byte offset of its log
/// line so the frontend can jump straight to it via the windowed pagination.
async fn search_log_entries(
    app: &AppHandle,
    server_id: &str,
    target: &str,
    criteria: &SearchCriteria,
) -> Result<Vec<SearchHit>, String> {
    let (_, path) = log_path(app, server_id, target)?;
    let mut file = match File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Vec::new())
        }
        Err(error) => return Err(format!("Failed to open log file: {error}")),
    };

    const CHUNK_SIZE: usize = 65536;
    let limit = criteria.limit.unwrap_or(100).clamp(1, 1000);
    let search = PreparedSearch::new(criteria);
    let is_oldest_first = criteria.order.as_deref() == Some("oldest");

    if is_oldest_first {
        let mut hits: Vec<SearchHit> = Vec::with_capacity(limit.min(1024));
        let start_offset = criteria.after_offset.unwrap_or(0);
        if start_offset > 0 {
            file.seek(SeekFrom::Start(start_offset))
                .await
                .map_err(|error| format!("Failed to seek log file: {error}"))?;
        }

        let mut partial: Vec<u8> = Vec::new();
        let mut line_offset: u64 = start_offset;
        let mut cursor: u64 = start_offset;
        let mut chunk = vec![0u8; CHUNK_SIZE];
        let mut skip_first_line = start_offset > 0;

        'outer: loop {
            let n = file
                .read(&mut chunk)
                .await
                .map_err(|error| format!("Failed to read log file: {error}"))?;
            if n == 0 {
                break 'outer;
            }
            let mut i = 0usize;
            while i < n {
                let byte = chunk[i];
                i += 1;
                if byte == b'\n' {
                    if skip_first_line {
                        skip_first_line = false;
                    } else if !partial.is_empty() {
                        if let Ok(line) = std::str::from_utf8(&partial) {
                            let line_str = line.trim_end_matches('\r');
                            if let Some(entry) = parse_log_line(line_str) {
                                let content_lower = entry.content.to_lowercase();
                                if line_matches(
                                    &entry.timestamp,
                                    &entry.sender,
                                    &entry.content,
                                    &content_lower,
                                    &search,
                                ) {
                                    hits.push(SearchHit {
                                        timestamp: entry.timestamp,
                                        sender: entry.sender,
                                        content: entry.content,
                                        offset: line_offset,
                                    });
                                    if hits.len() >= limit {
                                        break 'outer;
                                    }
                                }
                            }
                        }
                    }
                    partial.clear();
                    line_offset = cursor + i as u64;
                } else {
                    partial.push(byte);
                }
            }
            cursor += n as u64;
        }

        Ok(hits)
    } else {
        // "newest" order (default)
        let max_bound = criteria.before_offset;
        let mut newest_hits: std::collections::VecDeque<SearchHit> =
            std::collections::VecDeque::with_capacity(limit.min(1024));
        let mut partial: Vec<u8> = Vec::new();
        let mut line_offset: u64 = 0;
        let mut cursor: u64 = 0;
        let mut chunk = vec![0u8; CHUNK_SIZE];

        'outer: loop {
            let n = file
                .read(&mut chunk)
                .await
                .map_err(|error| format!("Failed to read log file: {error}"))?;
            if n == 0 {
                break 'outer;
            }
            let mut i = 0usize;
            while i < n {
                let byte = chunk[i];
                i += 1;
                if byte == b'\n' {
                    if let Some(bound) = max_bound {
                        if line_offset >= bound {
                            break 'outer;
                        }
                    }
                    if !partial.is_empty() {
                        if let Ok(line) = std::str::from_utf8(&partial) {
                            let line_str = line.trim_end_matches('\r');
                            if let Some(entry) = parse_log_line(line_str) {
                                let content_lower = entry.content.to_lowercase();
                                if line_matches(
                                    &entry.timestamp,
                                    &entry.sender,
                                    &entry.content,
                                    &content_lower,
                                    &search,
                                ) {
                                    if newest_hits.len() >= limit {
                                        newest_hits.pop_front();
                                    }
                                    newest_hits.push_back(SearchHit {
                                        timestamp: entry.timestamp,
                                        sender: entry.sender,
                                        content: entry.content,
                                        offset: line_offset,
                                    });
                                }
                            }
                        }
                    }
                    partial.clear();
                    line_offset = cursor + i as u64;
                } else {
                    partial.push(byte);
                }
            }
            cursor += n as u64;
        }

        Ok(newest_hits.into_iter().rev().collect())
    }
}

#[tauri::command]
async fn search_log(
    app: AppHandle,
    server_id: String,
    channel: String,
    criteria: SearchCriteria,
) -> Result<Vec<SearchHit>, String> {
    search_log_entries(&app, &server_id, &channel, &criteria).await
}

#[tauri::command]
async fn list_logged_conversations(
    app: AppHandle,
    server_id: String,
) -> Result<Vec<String>, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve application data directory: {error}"))?
        .join("logs");
    let safe_server = safe_log_component(&server_id);
    let server_dir = root.join(safe_server);

    let mut dir = match fs::read_dir(&server_dir).await {
        Ok(dir) => dir,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("Failed to read log directory: {e}")),
    };

    let mut logged_targets = Vec::new();
    while let Ok(Some(entry)) = dir.next_entry().await {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if ext == "log" {
                    if let Ok(meta) = entry.metadata().await {
                        if meta.len() > 0 {
                            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                                if !stem.starts_with('#') && !stem.starts_with('&') && stem != "***" && !stem.trim().is_empty() {
                                    logged_targets.push(stem.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(logged_targets)
}

#[tauri::command]
async fn delete_last_log_entry(
    app: AppHandle,
    log_state: State<'_, LogState>,
    server_id: String,
    target: String,
    sender: String,
) -> Result<bool, String> {
    remove_last_log_line_internal(&app, &log_state, &server_id, &target, &sender).await
}

#[tauri::command]
async fn load_config_toml(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    let config_path = dir.join("config.toml");

    if !config_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&config_path)
        .await
        .map_err(|e| format!("Failed to read config.toml: {e}"))?;
    let toml_val: serde_json::Value = toml::from_str(&content)
        .map_err(|e| format!("Failed to parse config.toml: {e}"))?;

    Ok(Some(toml_val))
}

#[tauri::command]
async fn save_config_toml(app: AppHandle, config: serde_json::Value) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    let config_path = dir.join("config.toml");
    let toml_string = toml::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize configuration to TOML: {e}"))?;

    fs::write(&config_path, toml_string)
        .await
        .map_err(|e| format!("Failed to write config.toml: {e}"))?;

    Ok(())
}

#[tauri::command]
async fn open_config_file(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    let config_path = dir.join("config.toml");

    if !config_path.exists() {
        let default_config = serde_json::json!({});
        let toml_string = toml::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize default config: {e}"))?;
        fs::write(&config_path, toml_string)
            .await
            .map_err(|e| format!("Failed to create config.toml: {e}"))?;
    }

    open::that(&config_path)
        .map_err(|e| format!("Failed to open config.toml in system editor: {e}"))?;

    Ok(())
}

#[tauri::command]
async fn connect_irc(
    app: AppHandle,
    state: State<'_, IrcState>,
    log_state: State<'_, LogState>,
    params: IrcConnectParams,
) -> Result<(), String> {
    let server_id = params.server_id.clone();

    {
        let senders = state.senders.lock().await;
        if senders.contains_key(&server_id) {
            let _ = app.emit(
                "irc_status",
                IrcStatusEvent {
                    server_id: server_id.clone(),
                    connected: true,
                    error: None,
                },
            );
            return Ok(());
        }
    }

    let primary_nickname = params
        .nicknames
        .first()
        .cloned()
        .unwrap_or_else(|| "ReactUser".to_string());
    let alt_nicknames = if params.nicknames.len() > 1 {
        params.nicknames[1..].to_vec()
    } else {
        Vec::new()
    };

    let mut options = std::collections::HashMap::new();
    options.insert("away-notify".to_string(), "".to_string());
    options.insert("server-time".to_string(), "".to_string());
    options.insert("batch".to_string(), "".to_string());
    options.insert("echo-message".to_string(), "".to_string());
    options.insert("znc.in/server-time-iso".to_string(), "".to_string());
    options.insert("znc.in/self-message".to_string(), "".to_string());

    let config = Config {
        nickname: Some(primary_nickname.clone()),
        username: Some(primary_nickname.clone()),
        realname: params
            .realname
            .filter(|s| !s.is_empty())
            .or(Some(primary_nickname.clone())),
        password: params.password.filter(|s| !s.is_empty()),
        alt_nicks: alt_nicknames,
        server: Some(params.host),
        port: Some(params.port),
        channels: vec![],
        use_tls: Some(params.use_tls),
        ping_time: Some(15),
        ping_timeout: Some(10),
        options,
        ..Config::default()
    };

    let channels_to_join = params.channels.clone();

    log::info!(
        "Connecting to IRC with nick: {:?}, alt_nicks: {:?}, user: {:?}, realname: {:?}",
        config.nickname,
        config.alt_nicks,
        config.username,
        config.realname
    );

    let pwd = config.password.clone();
    let nick_str = config.nickname.clone().unwrap_or_default();
    let user_str = config.username.clone().unwrap_or_default();
    let realname_str = config.realname.clone().unwrap_or_default();

    let mut client = Client::from_config(config).await.map_err(|e| {
        let err_msg = e.to_string();
        let _ = app.emit(
            "irc_status",
            IrcStatusEvent {
                server_id: server_id.clone(),
                connected: false,
                error: Some(err_msg.clone()),
            },
        );
        err_msg
    })?;

    // Start IRCv3 capability negotiation properly
    let _ = client.send(Command::Raw("CAP".to_string(), vec!["LS".to_string(), "302".to_string()]));

    // Send registration details manually (we don't use client.identify() because it sends CAP END prematurely)
    if let Some(p) = pwd {
        let _ = client.send(Command::PASS(p));
    }
    let _ = client.send(Command::NICK(nick_str));
    let _ = client.send(Command::USER(
        user_str,
        "8".to_owned(),
        realname_str,
    ));

    let sender = client.sender();
    state.senders.lock().await.insert(server_id.clone(), sender);
    state
        .nicknames
        .lock()
        .await
        .insert(server_id.clone(), primary_nickname.clone());

    let stream_server_id = server_id.clone();
    let senders_clone = state.senders.clone();
    let nicknames_clone = state.nicknames.clone();
    let channel_members_clone = state.channel_members.clone();
    let recent_sent_clone = state.recent_sent_messages.clone();
    let app_clone = app.clone();
    let log_state_clone = LogState {
        writers: log_state.writers.clone(),
    };
    
    let initial_channels = channels_to_join.clone();
    let parse_legacy_znc_timestamps = params.parse_legacy_znc_timestamps;

    tauri::async_runtime::spawn(async move {
        let mut stream = match client.stream() {
            Ok(s) => s,
            Err(e) => {
                let err_msg = e.to_string();
                log::error!(
                    "Failed to open stream for server {}: {}",
                    stream_server_id,
                    err_msg
                );
                senders_clone.lock().await.remove(&stream_server_id);
                nicknames_clone.lock().await.remove(&stream_server_id);
                let _ = app_clone.emit(
                    "irc_status",
                    IrcStatusEvent {
                        server_id: stream_server_id,
                        connected: false,
                        error: Some(err_msg),
                    },
                );
                return;
            }
        };

        let mut last_error: Option<String> = None;
        let mut motd_buffer: Vec<String> = Vec::new();

        while let Some(message_res) = stream.next().await {
            match message_res {
                Ok(message) => {
                    log::info!("IRC [{}] Received: {:?}", stream_server_id, message.command);
                    match message.command {
                        Command::CAP(_, ref subcmd, ref cap_name, _) => {
                            let sub_str = format!("{:?}", subcmd);
                            if sub_str == "LS" {
                                let cap_str = cap_name.as_deref().unwrap_or("");
                                let wanted = ["server-time", "away-notify", "batch", "echo-message", "znc.in/server-time-iso", "znc.in/self-message"];
                                let requested = wanted
                                    .iter()
                                    .filter(|&&c| cap_str.split_whitespace().any(|s| s == c))
                                    .copied()
                                    .collect::<Vec<_>>();
                                if !requested.is_empty() {
                                    if let Some(sender) = senders_clone.lock().await.get(&stream_server_id) {
                                        let _ = sender.send(Command::Raw(
                                            "CAP".to_string(),
                                            vec!["REQ".to_string(), requested.join(" ")],
                                        ));
                                    }
                                } else {
                                    // If we don't want anything they offer, just end negotiation
                                    if let Some(sender) = senders_clone.lock().await.get(&stream_server_id) {
                                        let _ = sender.send(Command::Raw(
                                            "CAP".to_string(),
                                            vec!["END".to_string()],
                                        ));
                                    }
                                }
                            } else if sub_str == "ACK" || sub_str == "NAK" {
                                if let Some(sender) = senders_clone.lock().await.get(&stream_server_id) {
                                    let _ = sender.send(Command::Raw(
                                        "CAP".to_string(),
                                        vec!["END".to_string()],
                                    ));
                                }
                            } else if sub_str == "NEW" {
                                let cap_str = cap_name.as_deref().unwrap_or("");
                                let wanted = ["server-time", "away-notify", "batch", "echo-message", "znc.in/server-time-iso", "znc.in/self-message"];
                                let requested = wanted
                                    .iter()
                                    .filter(|&&c| cap_str.split_whitespace().any(|s| s == c))
                                    .copied()
                                    .collect::<Vec<_>>();
                                if !requested.is_empty() {
                                    if let Some(sender) = senders_clone.lock().await.get(&stream_server_id) {
                                        log::info!("IRC [{}] CAP NEW received, requesting: {:?}", stream_server_id, requested);
                                        let _ = sender.send(Command::Raw(
                                            "CAP".to_string(),
                                            vec!["REQ".to_string(), requested.join(" ")],
                                        ));
                                    }
                                }
                            }
                        },
                        Command::PRIVMSG(ref channel, ref raw_content) | Command::NOTICE(ref channel, ref raw_content) => {
                            let mut content = raw_content.clone();
                            if let Some(source) = message.prefix {
                                let sender_name = match source.clone() {
                                    Prefix::Nickname(nick, user, host) => {
                                        emit_user_host(&app_clone, &stream_server_id, &nick, &user, &host, None);
                                        nick
                                    }
                                    Prefix::ServerName(name) => name,
                                };
                                let own_nickname =
                                    nicknames_clone.lock().await.get(&stream_server_id).cloned();
                                let is_self_sender = own_nickname.as_deref().is_some_and(|nickname| {
                                    nickname.eq_ignore_ascii_case(&sender_name)
                                });

                                let timestamp = extract_message_timestamp(&message.tags, &mut content, parse_legacy_znc_timestamps);

                                if is_self_sender {
                                    let mut recent = recent_sent_clone.lock().await;
                                    recent.retain(|m| m.timestamp.elapsed() < std::time::Duration::from_secs(10));
                                    
                                    let target_check = channel.clone();
                                    if let Some(pos) = recent.iter().position(|m| {
                                        m.server_id == stream_server_id
                                            && m.target.eq_ignore_ascii_case(&target_check)
                                            && m.content == content
                                    }) {
                                        recent.remove(pos);
                                        continue;
                                    }
                                }

                                let is_znc_buffer_notice = sender_name == "***"
                                    || content.contains("Buffer Playback")
                                    || content.contains("Playback Complete.");
                                let is_system = is_znc_buffer_notice || matches!(message.command, Command::NOTICE(..));

                                if sender_name != "***" && !sender_name.trim().is_empty() && !channel.trim().is_empty() {
                                    let log_target = if channel.starts_with('#') || channel.starts_with('&') {
                                        channel.clone()
                                    } else if is_self_sender {
                                        channel.clone()
                                    } else {
                                        sender_name.clone()
                                    };
                                    if let Err(error) = append_log_line(
                                        &app_clone,
                                        &log_state_clone,
                                        &stream_server_id,
                                        &log_target,
                                        &sender_name,
                                        &content,
                                    )
                                    .await
                                    {
                                        log::error!("Failed to log IRC message: {}", error);
                                    }
                                }

                                let payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: sender_name.clone(),
                                    content,
                                    channel: channel.clone(),
                                    is_system,
                                    timestamp,
                                };
                                let _ = app_clone.emit("irc_message", payload);

                                if sender_name != "***" && !sender_name.contains('*') && !sender_name.trim().is_empty() && channel.starts_with('#') {
                                    let payload_users = IrcUserEvent {
                                        server_id: stream_server_id.clone(),
                                        channel: channel.clone(),
                                        users: vec![sender_name],
                                        event_type: "JOIN".to_string(),
                                    };
                                    let _ = app_clone.emit("irc_user_event", payload_users);
                                }
                            }
                        }
                        Command::JOIN(channel, _, _) => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source.clone() {
                                    Prefix::Nickname(nick, user, host) => {
                                        emit_user_host(&app_clone, &stream_server_id, &nick, &user, &host, None);
                                        nick
                                    }
                                    Prefix::ServerName(name) => name,
                                };
                                let full_source = match source {
                                    Prefix::Nickname(nick, user, host) => {
                                        format!("{} ({}@{})", nick, user, host)
                                    }
                                    Prefix::ServerName(name) => name,
                                };
                                let payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: sender_name.clone(),
                                    content: format!("{} has joined", full_source),
                                    channel: channel.clone(),
                                    is_system: true,
                                timestamp: None,
                                };
                                let _ = app_clone.emit("irc_message", payload);

                                let payload_users = IrcUserEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.clone(),
                                    users: vec![sender_name.clone()],
                                    event_type: "JOIN".to_string(),
                                };
                                let _ = app_clone.emit("irc_user_event", payload_users);

                                // Track membership for QUIT routing
                                let cm_key = format!("{}\x00{}", stream_server_id, channel.to_lowercase());
                                channel_members_clone.lock().await
                                    .entry(cm_key)
                                    .or_default()
                                    .insert(sender_name.to_lowercase());

                                let my_nick = nicknames_clone.lock().await.get(&stream_server_id).cloned();
                                if let Some(ref nick) = my_nick {
                                    if nick.eq_ignore_ascii_case(&sender_name) {
                                        if let Some(s) = senders_clone.lock().await.get(&stream_server_id) {
                                            let _ = s.send(Command::Raw("MODE".to_string(), vec![channel.clone()]));
                                        }
                                    }
                                }
                            }
                        }
                        Command::PART(channel, ref comment_opt) => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source.clone() {
                                    Prefix::Nickname(nick, _, _) => nick,
                                    Prefix::ServerName(name) => name,
                                };
                                let full_source = match source {
                                    Prefix::Nickname(nick, user, host) => {
                                        format!("{} ({}@{})", nick, user, host)
                                    }
                                    Prefix::ServerName(name) => name,
                                };
                                let sys_content = match comment_opt {
                                    Some(reason) if !reason.trim().is_empty() => {
                                        format!("{} has left ({})", full_source, reason.trim())
                                    }
                                    _ => format!("{} has left", full_source),
                                };
                                let payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: sender_name.clone(),
                                    content: sys_content,
                                    channel: channel.clone(),
                                    is_system: true,
                                timestamp: None,
                                };
                                let _ = app_clone.emit("irc_message", payload);

                                let payload_users = IrcUserEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.clone(),
                                    users: vec![sender_name.clone()],
                                    event_type: "PART".to_string(),
                                };
                                let _ = app_clone.emit("irc_user_event", payload_users);

                                // Remove from membership tracking
                                let cm_key = format!("{}\x00{}", stream_server_id, channel.to_lowercase());
                                if let Some(set) = channel_members_clone.lock().await.get_mut(&cm_key) {
                                    set.remove(&sender_name.to_lowercase());
                                }
                }
                        }
                        Command::QUIT(ref comment_opt) => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source.clone() {
                                    Prefix::Nickname(nick, _, _) => nick,
                                    Prefix::ServerName(name) => name,
                                };
                                let full_source = match source {
                                    Prefix::Nickname(nick, user, host) => {
                                        format!("{} ({}@{})", nick, user, host)
                                    }
                                    Prefix::ServerName(name) => name,
                                };
                                let sys_content = match comment_opt {
                                    Some(reason) if !reason.trim().is_empty() => {
                                        format!("{} has quit ({})", full_source, reason.trim())
                                    }
                                    _ => format!("{} has quit", full_source),
                                };

                                // Find all channels the user was in and emit a message per channel
                                let sender_lower = sender_name.to_lowercase();
                                let prefix = format!("{}\x00", stream_server_id);
                                let mut matched_channels: Vec<String> = Vec::new();
                                {
                                    let mut cm = channel_members_clone.lock().await;
                                    let keys_to_update: Vec<String> = cm.keys()
                                        .filter(|k| k.starts_with(&prefix))
                                        .cloned()
                                        .collect();
                                    for key in keys_to_update {
                                        if let Some(set) = cm.get_mut(&key) {
                                            if set.remove(&sender_lower) {
                                                // key is "server_id\x00channel_lower"
                                                let chan = key[prefix.len()..].to_string();
                                                matched_channels.push(chan);
                                            }
                                        }
                                    }
                                                            if matched_channels.is_empty() {
                                    // Fallback: emit with empty channel so frontend can handle
                                    let payload = IrcMessage {
                                        server_id: stream_server_id.clone(),
                                        sender: sender_name.clone(),
                                        content: sys_content.clone(),
                                        channel: "".to_string(),
                                        is_system: true,
                                        timestamp: None,
                                    };
                                    let _ = app_clone.emit("irc_message", payload);
                                } else {
                                    for chan in &matched_channels {
                                        let payload = IrcMessage {
                                            server_id: stream_server_id.clone(),
                                            sender: sender_name.clone(),
                                            content: sys_content.clone(),
                                            channel: chan.clone(),
                                            is_system: true,
                                            timestamp: None,
                                        };
                                        let _ = app_clone.emit("irc_message", payload);
                                    }
                                }       }

                                let payload_users = IrcUserEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: "".to_string(),
                                    users: vec![sender_name],
                                    event_type: "QUIT".to_string(),
                                };
                                let _ = app_clone.emit("irc_user_event", payload_users);
                            }
                        }
                        Command::Response(Response::RPL_NAMREPLY, ref args) => {
                            if args.len() >= 4 {
                                let channel = &args[2];
                                let users_str = &args[3];
                                let mut users: Vec<String> = Vec::new();
                                let mut ops: Vec<String> = Vec::new();

                                for token in users_str.split_whitespace() {
                                    let is_op = token.starts_with('@') || token.starts_with('%') || token.starts_with('~') || token.starts_with('&');
                                    let clean = token.trim_start_matches(&['@', '+', '%', '~', '&'][..]).to_string();
                                    users.push(token.to_string());
                                    if is_op {
                                        ops.push(clean);
                                    }
                                }
                                let payload = IrcUserEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.to_string(),
                                    users,
                                    event_type: "NAMES".to_string(),
                                };
                                let _ = app_clone.emit("irc_user_event", payload);

                                // Populate backend membership tracking from NAMES list
                                let cm_key = format!("{}\x00{}", stream_server_id, channel.to_lowercase());
                                let mut cm = channel_members_clone.lock().await;
                                let set = cm.entry(cm_key).or_default();
                                for token in users_str.split_whitespace() {
                                    let nick = token.trim_start_matches(&['@', '+', '%', '~', '&'][..]).to_lowercase();
                                    set.insert(nick);
                                }

                                let ops_payload = IrcOpsEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.to_string(),
                                    ops,
                                };
                                let _ = app_clone.emit("irc_ops_event", ops_payload);

                                if let Some(sender) = senders_clone.lock().await.get(&stream_server_id) {
                                    let _ = sender.send(Command::WHO(Some(channel.to_string()), None));
                                }
                            }
                        }
                        Command::Response(Response::RPL_WELCOME, ref args) => {
                            if let Some(welcome_nick) = args.first() {
                                nicknames_clone
                                    .lock()
                                    .await
                                    .insert(stream_server_id.clone(), welcome_nick.clone());
                                let _ = app_clone.emit(
                                    "irc_welcome_nick",
                                    IrcWelcomeNickEvent {
                                        server_id: stream_server_id.clone(),
                                        welcome_nick: welcome_nick.clone(),
                                    },
                                );
                            }
                            let _ = app_clone.emit(
                                "irc_status",
                                IrcStatusEvent {
                                    server_id: stream_server_id.clone(),
                                    connected: true,
                                    error: None,
                                },
                            );
                            if let Some(s) = senders_clone.lock().await.get(&stream_server_id) {
                                for chan in &initial_channels {
                                    let mut formatted = chan.name.clone();
                                    if !formatted.starts_with('#') {
                                        formatted = format!("#{}", formatted);
                                    }
                                    let key = chan.password.clone().filter(|p| !p.trim().is_empty());
                                    if let Some(k) = key {
                                        let _ = s.send(Command::JOIN(formatted, Some(k), None));
                                    } else {
                                        let _ = s.send_join(&formatted);
                                    }
                                }
                            }
                        }
                        Command::ERROR(ref reason) => {
                            log::error!("IRC [{}] Received ERROR: {}", stream_server_id, reason);
                            last_error = Some(reason.clone());
                            let _ = app_clone.emit(
                                "irc_status",
                                IrcStatusEvent {
                                    server_id: stream_server_id.clone(),
                                    connected: false,
                                    error: Some(reason.clone()),
                                },
                            );
                            senders_clone.lock().await.remove(&stream_server_id);
                            nicknames_clone.lock().await.remove(&stream_server_id);
                            break;
                        }
                        Command::Response(Response::ERR_CHANOPRIVSNEEDED, ref args) => {
                            let channel = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "You're not channel operator".to_string());
                            
                            let msg_payload = IrcMessage::system(
                                stream_server_id.clone(),
                                "System".to_string(),
                                format!("Permission Denied: {}", reason),
                                channel.clone(),
                            );
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcTopicErrorEvent {
                                server_id: stream_server_id.clone(),
                                channel: channel.clone(),
                                error: reason.clone(),
                            };
                            let _ = app_clone.emit("irc_topic_error", err_payload);

                            let mode_err_payload = IrcModeErrorEvent {
                                server_id: stream_server_id.clone(),
                                channel: channel.clone(),
                                error: format!("Permission Denied: {}", reason),
                            };
                            let _ = app_clone.emit("irc_mode_error", mode_err_payload);

                            if !channel.is_empty() {
                                if let Some(s) = senders_clone.lock().await.get(&stream_server_id) {
                                    let formatted = if channel.starts_with('#') || channel.starts_with('&') {
                                        channel
                                    } else {
                                        format!("#{}", channel)
                                    };
                                    let _ = s.send(Command::Raw("NAMES".to_string(), vec![formatted]));
                                }
                            }
                        }
                        Command::Response(Response::ERR_CANNOTSENDTOCHAN, ref args) => {
                            let channel = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "Cannot send to channel".to_string());
                            let sender_name = nicknames_clone.lock().await.get(&stream_server_id).cloned().unwrap_or_else(|| "You".to_string());
                            let _ = remove_last_log_line_internal(&app_clone, &log_state_clone, &stream_server_id, &channel, &sender_name).await;

                            let msg_payload = IrcMessage::system(
                                stream_server_id.clone(),
                                "System".to_string(),
                                format!("Error: {} ({})", reason, channel),
                                channel.clone(),
                            );
                            let _ = app_clone.emit("irc_message", msg_payload);
                        }
                        Command::Response(Response::ERR_UNKNOWNMODE, ref args) => {
                            let mode_flag = args.get(1).cloned().unwrap_or_default();
                            let channel = args.iter().find(|a| a.starts_with('#') || a.starts_with('&')).cloned().unwrap_or_default();
                            let reason = args.last().cloned().unwrap_or_else(|| format!("Unknown mode flag '{}'", mode_flag));
                            let err_msg = format!("Unknown mode flag '{}': {}", mode_flag, reason);

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Mode error: {}", err_msg),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcModeErrorEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: err_msg,
                            };
                            let _ = app_clone.emit("irc_mode_error", err_payload);
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "472" => {
                            let mode_flag = args.get(1).cloned().unwrap_or_default();
                            let channel = args.iter().find(|a| a.starts_with('#') || a.starts_with('&')).cloned().unwrap_or_default();
                            let reason = args.last().cloned().unwrap_or_else(|| format!("Unknown mode flag '{}'", mode_flag));
                            let err_msg = format!("Unknown mode flag '{}': {}", mode_flag, reason);

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Mode error: {}", err_msg),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcModeErrorEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: err_msg,
                            };
                            let _ = app_clone.emit("irc_mode_error", err_payload);
                        }
                        Command::Response(Response::ERR_BADCHANNELKEY, ref args) => {
                            let channel = args
                                .iter()
                                .find(|a| a.starts_with('#') || a.starts_with('&'))
                                .cloned()
                                .unwrap_or_else(|| args.get(1).cloned().unwrap_or_default());
                            let reason = args
                                .last()
                                .cloned()
                                .unwrap_or_else(|| "Cannot join channel (+k)".to_string());

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Cannot join channel {}: {}", channel, reason),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcBadChannelKeyEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: reason,
                            };
                            let _ = app_clone.emit("irc_bad_channel_key", err_payload);
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "475" => {
                            let channel = args
                                .iter()
                                .find(|a| a.starts_with('#') || a.starts_with('&'))
                                .cloned()
                                .unwrap_or_else(|| args.get(1).cloned().unwrap_or_default());
                            let reason = args
                                .last()
                                .cloned()
                                .unwrap_or_else(|| "Cannot join channel (+k)".to_string());

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Cannot join channel {}: {}", channel, reason),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcBadChannelKeyEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: reason,
                            };
                            let _ = app_clone.emit("irc_bad_channel_key", err_payload);
                        }
                        Command::Response(Response::ERR_INVITEONLYCHAN, ref args) => {
                            let channel = args
                                .iter()
                                .find(|a| a.starts_with('#') || a.starts_with('&'))
                                .cloned()
                                .unwrap_or_else(|| args.get(1).cloned().unwrap_or_default());
                            let reason = args
                                .last()
                                .cloned()
                                .unwrap_or_else(|| "Cannot join channel (+i)".to_string());

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Cannot join channel {}: {}", channel, reason),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcInviteOnlyEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: reason,
                            };
                            let _ = app_clone.emit("irc_invite_only", err_payload);
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "473" => {
                            let channel = args
                                .iter()
                                .find(|a| a.starts_with('#') || a.starts_with('&'))
                                .cloned()
                                .unwrap_or_else(|| args.get(1).cloned().unwrap_or_default());
                            let reason = args
                                .last()
                                .cloned()
                                .unwrap_or_else(|| "Cannot join channel (+i)".to_string());

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Cannot join channel {}: {}", channel, reason),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcInviteOnlyEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: reason,
                            };
                            let _ = app_clone.emit("irc_invite_only", err_payload);
                        }
                        Command::Response(Response::ERR_NOPRIVILEGES, ref args) => {
                            let reason = args.get(1).cloned().unwrap_or_else(|| "Permission Denied".to_string());
                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Permission Denied: {}", reason),
                                channel: "".to_string(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let mode_err_payload = IrcModeErrorEvent {
                                server_id: stream_server_id.clone(),
                                channel: "".to_string(),
                                error: format!("Permission Denied: {}", reason),
                            };
                            let _ = app_clone.emit("irc_mode_error", mode_err_payload);
                        }
                        Command::Response(Response::ERR_NOCHANMODES, ref args) => {
                            let channel = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "Channel doesn't support modes".to_string());
                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Cannot set mode on {}: {}", channel, reason),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let mode_err_payload = IrcModeErrorEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: reason,
                            };
                            let _ = app_clone.emit("irc_mode_error", mode_err_payload);
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "477" => {
                            let channel = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "Channel doesn't support modes".to_string());
                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Cannot set mode on {}: {}", channel, reason),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let mode_err_payload = IrcModeErrorEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: reason,
                            };
                            let _ = app_clone.emit("irc_mode_error", mode_err_payload);
                        }
                        Command::Response(Response::ERR_NOSUCHNICK, ref args) => {
                            let target = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "No such nick".to_string());
                            let sender_name = nicknames_clone.lock().await.get(&stream_server_id).cloned().unwrap_or_else(|| "You".to_string());
                            let _ = remove_last_log_line_internal(&app_clone, &log_state_clone, &stream_server_id, &target, &sender_name).await;

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Error: Cannot send message to {}: {}", target, reason),
                                channel: target,
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "401" => {
                            let target = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "No such nick".to_string());
                            let sender_name = nicknames_clone.lock().await.get(&stream_server_id).cloned().unwrap_or_else(|| "You".to_string());
                            let _ = remove_last_log_line_internal(&app_clone, &log_state_clone, &stream_server_id, &target, &sender_name).await;

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Error: Cannot send message to {}: {}", target, reason),
                                channel: target,
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);
                        }
                        Command::Response(Response::RPL_TOPIC, ref args) => {
                            if args.len() >= 3 {
                                let channel = &args[1];
                                let topic = &args[2];
                                let payload = IrcTopicEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.to_string(),
                                    topic: topic.to_string(),
                                    set_by: None,
                                };
                                let _ = app_clone.emit("irc_topic_event", payload);
                            }
                        }
                        Command::TOPIC(ref channel, ref topic_opt) => {
                            let topic_text = topic_opt.as_deref().unwrap_or("");
                            let sender_name = message.prefix.as_ref().map(|source| match source {
                                Prefix::Nickname(nick, _, _) => nick.clone(),
                                Prefix::ServerName(name) => name.clone(),
                            });

                            let payload = IrcTopicEvent {
                                server_id: stream_server_id.clone(),
                                channel: channel.clone(),
                                topic: topic_text.to_string(),
                                set_by: sender_name.clone(),
                            };
                            let _ = app_clone.emit("irc_topic_event", payload);

                            if let Some(ref sender) = sender_name {
                                let sys_content = if topic_text.is_empty() {
                                    format!("{} cleared the topic", sender)
                                } else {
                                    format!("{} changed the topic to: {}", sender, topic_text)
                                };
                                let msg_payload = IrcMessage::system(
                                     stream_server_id.clone(),
                                     sender.clone(),
                                     sys_content,
                                     channel.clone(),
                                 );
                                let _ = app_clone.emit("irc_message", msg_payload);
                            }
                        }
                        Command::Response(Response::RPL_CHANNELMODEIS, ref args) => {
                            if args.len() >= 3 {
                                let channel = &args[1];
                                let modes_str = args[2..].join(" ");
                                let msg_payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: "System".to_string(),
                                    content: format!("Channel {} modes: {}", channel, modes_str),
                                    channel: channel.to_string(),
                                    is_system: true,
                                timestamp: None,
                                };
                                let _ = app_clone.emit("irc_message", msg_payload);

                                let mode_payload = IrcModeEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.to_string(),
                                    modes: modes_str,
                                    set_by: None,
                                    is_full_listing: Some(true),
                                };
                                let _ = app_clone.emit("irc_mode_event", mode_payload);
                            }
                        }
                        Command::KICK(ref channel, ref target, ref comment_opt) => {
                            let sender_name = message.prefix.as_ref().map(|source| match source {
                                Prefix::Nickname(nick, _, _) => nick.clone(),
                                Prefix::ServerName(name) => name.clone(),
                            }).unwrap_or_else(|| "Server".to_string());

                            let reason = comment_opt.as_deref().unwrap_or("");
                            let sys_content = if reason.is_empty() {
                                format!("{} was kicked from {} by {}", target, channel, sender_name)
                            } else {
                                format!("{} was kicked from {} by {} ({})", target, channel, sender_name, reason)
                            };

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: sender_name,
                                content: sys_content,
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let payload_users = IrcUserEvent {
                                server_id: stream_server_id.clone(),
                                channel: channel.clone(),
                                users: vec![target.clone()],
                                event_type: "PART".to_string(),
                            };
                            let _ = app_clone.emit("irc_user_event", payload_users);
                        }
                        Command::ChannelMODE(ref channel, ref modes) => {
                            let sender_name = message.prefix.as_ref().map(|source| match source {
                                Prefix::Nickname(nick, _, _) => nick.clone(),
                                Prefix::ServerName(name) => name.clone(),
                            }).unwrap_or_else(|| "Server".to_string());

                            let modes_str = modes
                                .iter()
                                .map(|m| m.to_string())
                                .collect::<Vec<_>>()
                                .join(" ");

                            let sys_text = if modes_str.is_empty() {
                                format!("Query mode for {}", channel)
                            } else {
                                format!("{} set mode: {} {}", sender_name, channel, modes_str)
                            };

                            let msg_payload = IrcMessage::system(
                                 stream_server_id.clone(),
                                 sender_name.clone(),
                                 sys_text,
                                 channel.clone(),
                             );
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let mode_payload = IrcModeEvent {
                                server_id: stream_server_id.clone(),
                                channel: channel.clone(),
                                modes: modes_str,
                                set_by: Some(sender_name),
                                is_full_listing: Some(false),
                            };
                            let _ = app_clone.emit("irc_mode_event", mode_payload);
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "MODE" => {
                            let sender_name = message.prefix.as_ref().map(|source| match source {
                                Prefix::Nickname(nick, _, _) => nick.clone(),
                                Prefix::ServerName(name) => name.clone(),
                            }).unwrap_or_else(|| "Server".to_string());

                            if let Some(target) = args.get(0) {
                                let modes_str = args.iter().skip(1).cloned().collect::<Vec<_>>().join(" ");
                                let sys_text = if modes_str.is_empty() {
                                    format!("Query mode for {}", target)
                                } else {
                                    format!("{} set mode: {} {}", sender_name, target, modes_str)
                                };
                                let msg_payload = IrcMessage::system(
                                     stream_server_id.clone(),
                                     sender_name.clone(),
                                     sys_text,
                                     target.clone(),
                                 );
                                let _ = app_clone.emit("irc_message", msg_payload);

                                let mode_payload = IrcModeEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: target.clone(),
                                    modes: modes_str,
                                    set_by: Some(sender_name),
                                    is_full_listing: Some(false),
                                };
                                let _ = app_clone.emit("irc_mode_event", mode_payload);
                            }
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "324" => {
                            if args.len() >= 3 {
                                let channel = &args[1];
                                let modes_str = args[2..].join(" ");
                                let msg_payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: "System".to_string(),
                                    content: format!("Channel {} modes: {}", channel, modes_str),
                                    channel: channel.to_string(),
                                    is_system: true,
                                timestamp: None,
                                };
                                let _ = app_clone.emit("irc_message", msg_payload);

                                let mode_payload = IrcModeEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.to_string(),
                                    modes: modes_str,
                                    set_by: None,
                                    is_full_listing: Some(true),
                                };
                                let _ = app_clone.emit("irc_mode_event", mode_payload);
                            }
                        }
                        Command::Response(Response::RPL_INVITING, ref args) => {
                            if args.len() >= 3 {
                                let target_user = &args[1];
                                let channel = &args[2];
                                let msg_payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: "System".to_string(),
                                    content: format!("Invited {} to {}", target_user, channel),
                                    channel: channel.to_string(),
                                    is_system: true,
                                timestamp: None,
                                };
                                let _ = app_clone.emit("irc_message", msg_payload);
                            }
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "341" => {
                            if args.len() >= 3 {
                                let target_user = &args[1];
                                let channel = &args[2];
                                let msg_payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: "System".to_string(),
                                    content: format!("Invited {} to {}", target_user, channel),
                                    channel: channel.to_string(),
                                    is_system: true,
                                timestamp: None,
                                };
                                let _ = app_clone.emit("irc_message", msg_payload);
                            }
                        }
                        Command::INVITE(ref target, ref channel) => {
                            let sender_name = message.prefix.as_ref().map(|source| match source {
                                Prefix::Nickname(nick, _, _) => nick.clone(),
                                Prefix::ServerName(name) => name.clone(),
                            }).unwrap_or_else(|| "Server".to_string());

                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: sender_name.clone(),
                                content: format!("{} invited {} to join {}", sender_name, target, channel),
                                channel: channel.clone(),
                                is_system: true,
                                timestamp: None,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let invite_payload = IrcInvitedEvent {
                                server_id: stream_server_id.clone(),
                                channel: channel.clone(),
                                inviter: sender_name,
                            };
                            let _ = app_clone.emit("irc_invited", invite_payload);
                        }
                        Command::NICK(ref new_nick) => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source {
                                    Prefix::Nickname(nick, _, _) => nick,
                                    Prefix::ServerName(name) => name,
                                };
                                let msg_payload = IrcMessage::system(
                                     stream_server_id.clone(),
                                     sender_name.clone(),
                                     format!("{} is now known as {}", sender_name, new_nick),
                                     "".to_string(),
                                 );
                                let _ = app_clone.emit("irc_message", msg_payload);

                                let nick_change_payload = IrcNickChangeEvent {
                                    server_id: stream_server_id.clone(),
                                    old_nick: sender_name.clone(),
                                    new_nick: new_nick.clone(),
                                };
                                let _ = app_clone.emit("irc_nick_change", nick_change_payload);

                                let mut nicks = nicknames_clone.lock().await;
                                let is_own = nicks
                                    .get(&stream_server_id)
                                    .map_or(false, |own_nick| own_nick.eq_ignore_ascii_case(&sender_name));
                                if is_own {
                                    nicks.insert(stream_server_id.clone(), new_nick.clone());
                                }
                            }
                        }
                        Command::Response(Response::RPL_MOTDSTART, _) => {
                            motd_buffer.clear();
                        }
                        Command::Raw(ref cmd, _) if cmd == "375" => {
                            motd_buffer.clear();
                        }
                        Command::Response(Response::RPL_MOTD, ref args) => {
                            if let Some(text) = args.get(1).or_else(|| args.last()) {
                                let clean_text = text.strip_prefix(":- ").or_else(|| text.strip_prefix("- ")).unwrap_or(text);
                                motd_buffer.push(clean_text.to_string());
                            }
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "372" => {
                            if let Some(text) = args.get(1).or_else(|| args.last()) {
                                let clean_text = text.strip_prefix(":- ").or_else(|| text.strip_prefix("- ")).unwrap_or(text);
                                motd_buffer.push(clean_text.to_string());
                            }
                        }
                        Command::Response(Response::RPL_ENDOFMOTD, _) => {
                            let payload = IrcMotdEvent {
                                server_id: stream_server_id.clone(),
                                motd: motd_buffer.clone(),
                            };
                            let _ = app_clone.emit("irc_motd_event", payload);
                        }
                        Command::Raw(ref cmd, _) if cmd == "376" => {
                            let payload = IrcMotdEvent {
                                server_id: stream_server_id.clone(),
                                motd: motd_buffer.clone(),
                            };
                            let _ = app_clone.emit("irc_motd_event", payload);
                        }
                        Command::Response(Response::ERR_NOMOTD, _) => {
                            motd_buffer.clear();
                            let payload = IrcMotdEvent {
                                server_id: stream_server_id.clone(),
                                motd: Vec::new(),
                            };
                            let _ = app_clone.emit("irc_motd_event", payload);
                        }
                        Command::Raw(ref cmd, _) if cmd == "422" => {
                            motd_buffer.clear();
                            let payload = IrcMotdEvent {
                                server_id: stream_server_id.clone(),
                                motd: Vec::new(),
                            };
                            let _ = app_clone.emit("irc_motd_event", payload);
                        }
                        Command::Response(Response::RPL_NOWAWAY, ref _args) => {
                            let own_nick = nicknames_clone.lock().await.get(&stream_server_id).cloned().unwrap_or_default();
                            let _ = app_clone.emit(
                                "irc_away_event",
                                IrcAwayEvent {
                                    server_id: stream_server_id.clone(),
                                    nick: own_nick,
                                    away: true,
                                    reason: None,
                                },
                            );
                        }
                        Command::Response(Response::RPL_UNAWAY, ref _args) => {
                            let own_nick = nicknames_clone.lock().await.get(&stream_server_id).cloned().unwrap_or_default();
                            let _ = app_clone.emit(
                                "irc_away_event",
                                IrcAwayEvent {
                                    server_id: stream_server_id.clone(),
                                    nick: own_nick,
                                    away: false,
                                    reason: None,
                                },
                            );
                        }
                        Command::Response(Response::RPL_AWAY, ref args) => {
                            if args.len() >= 2 {
                                let nick = args[1].clone();
                                let reason = args.get(2).cloned();
                                let _ = app_clone.emit(
                                    "irc_away_event",
                                    IrcAwayEvent {
                                        server_id: stream_server_id.clone(),
                                        nick,
                                        away: true,
                                        reason,
                                    },
                                );
                            }
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "301" => {
                            if args.len() >= 2 {
                                let nick = args[1].clone();
                                let reason = args.get(2).cloned();
                                let _ = app_clone.emit(
                                    "irc_away_event",
                                    IrcAwayEvent {
                                        server_id: stream_server_id.clone(),
                                        nick,
                                        away: true,
                                        reason,
                                    },
                                );
                            }
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "305" => {
                            let own_nick = nicknames_clone.lock().await.get(&stream_server_id).cloned().unwrap_or_default();
                            let _ = app_clone.emit(
                                "irc_away_event",
                                IrcAwayEvent {
                                    server_id: stream_server_id.clone(),
                                    nick: own_nick,
                                    away: false,
                                    reason: None,
                                },
                            );
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "306" => {
                            let own_nick = nicknames_clone.lock().await.get(&stream_server_id).cloned().unwrap_or_default();
                            let _ = app_clone.emit(
                                "irc_away_event",
                                IrcAwayEvent {
                                    server_id: stream_server_id.clone(),
                                    nick: own_nick,
                                    away: true,
                                    reason: None,
                                },
                            );
                        }
                        Command::Response(Response::RPL_WHOREPLY, ref args) => {
                            if args.len() >= 6 {
                                let nick = &args[5];
                                let user = args.get(2).map(|s| s.as_str()).unwrap_or("");
                                let host = args.get(3).map(|s| s.as_str()).unwrap_or("");
                                let realname = args.get(7).map(|r| r.trim_start_matches("0 ").trim().to_string()).filter(|r| !r.is_empty());
                                emit_user_host(&app_clone, &stream_server_id, nick, user, host, realname);
                            }
                            if args.len() >= 7 {
                                let nick = args[5].clone();
                                let flags = &args[6];
                                let is_away = flags.contains('G');
                                let _ = app_clone.emit(
                                    "irc_away_event",
                                    IrcAwayEvent {
                                        server_id: stream_server_id.clone(),
                                        nick,
                                        away: is_away,
                                        reason: None,
                                    },
                                );
                            }
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "352" => {
                            if args.len() >= 6 {
                                let nick = &args[5];
                                let user = args.get(2).map(|s| s.as_str()).unwrap_or("");
                                let host = args.get(3).map(|s| s.as_str()).unwrap_or("");
                                let realname = args.get(7).map(|r| r.trim_start_matches("0 ").trim().to_string()).filter(|r| !r.is_empty());
                                emit_user_host(&app_clone, &stream_server_id, nick, user, host, realname);
                            }
                            if args.len() >= 7 {
                                let nick = args[5].clone();
                                let flags = &args[6];
                                let is_away = flags.contains('G');
                                let _ = app_clone.emit(
                                    "irc_away_event",
                                    IrcAwayEvent {
                                        server_id: stream_server_id.clone(),
                                        nick,
                                        away: is_away,
                                        reason: None,
                                    },
                                );
                            }
                        }
                        Command::AWAY(ref reason_opt) => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source {
                                    Prefix::Nickname(nick, _, _) => nick,
                                    Prefix::ServerName(name) => name,
                                };
                                let is_away = reason_opt.as_ref().map_or(false, |r| !r.trim().is_empty());
                                log::info!("IRC [{}] AWAY event for nick={} away={} reason={:?}", stream_server_id, sender_name, is_away, reason_opt);
                                let _ = app_clone.emit(
                                    "irc_away_event",
                                    IrcAwayEvent {
                                        server_id: stream_server_id.clone(),
                                        nick: sender_name,
                                        away: is_away,
                                        reason: reason_opt.clone(),
                                    },
                                );
                            }
                        }
                        Command::Raw(ref cmd, ref args) if cmd == "AWAY" => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source {
                                    Prefix::Nickname(nick, _, _) => nick,
                                    Prefix::ServerName(name) => name,
                                };
                                let is_away = !args.is_empty() && !args[0].trim().is_empty();
                                let reason = if is_away { args.first().cloned() } else { None };
                                log::info!("IRC [{}] AWAY raw event for nick={} away={} reason={:?}", stream_server_id, sender_name, is_away, reason);
                                let _ = app_clone.emit(
                                    "irc_away_event",
                                    IrcAwayEvent {
                                        server_id: stream_server_id.clone(),
                                        nick: sender_name,
                                        away: is_away,
                                        reason,
                                    },
                                );
                            }
                        }
                        _ => {}
                    }
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    log::error!("IRC [{}] Stream error: {}", stream_server_id, err_msg);
                    last_error = Some(err_msg.clone());
                    let _ = app_clone.emit(
                        "irc_status",
                        IrcStatusEvent {
                            server_id: stream_server_id.clone(),
                            connected: false,
                            error: Some(err_msg),
                        },
                    );
                    senders_clone.lock().await.remove(&stream_server_id);
                    nicknames_clone.lock().await.remove(&stream_server_id);
                    break;
                }
            }
        }

        log::warn!("IRC [{}] Stream closed!", stream_server_id);
        senders_clone.lock().await.remove(&stream_server_id);
        nicknames_clone.lock().await.remove(&stream_server_id);
        close_server_logs(&log_state_clone, &stream_server_id).await;
        let final_error = last_error.unwrap_or_else(|| "Stream closed".to_string());
        let _ = app_clone.emit(
            "irc_status",
            IrcStatusEvent {
                server_id: stream_server_id,
                connected: false,
                error: Some(final_error),
            },
        );

        // Keep client alive in task scope
        let _ = client;
    });

    log::info!("IRC connection setup complete for server {}", server_id);
    Ok(())
}

#[tauri::command]
async fn send_message(
    app: AppHandle,
    state: State<'_, IrcState>,
    log_state: State<'_, LogState>,
    server_id: String,
    channel: String,
    message: String,
) -> Result<(), String> {
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        if let Err(e) = sender.send_privmsg(&channel, &message) {
            drop(senders);
            state.senders.lock().await.remove(&server_id);
            state.nicknames.lock().await.remove(&server_id);
            let _ = app.emit(
                "irc_status",
                IrcStatusEvent {
                    server_id: server_id.clone(),
                    connected: false,
                    error: Some(e.to_string()),
                },
            );
            return Err(e.to_string());
        }
        state.recent_sent_messages.lock().await.push(RecentSentMessage {
            server_id: server_id.clone(),
            target: channel.clone(),
            content: message.clone(),
            timestamp: std::time::Instant::now(),
        });
        let sender_name = state
            .nicknames
            .lock()
            .await
            .get(&server_id)
            .cloned()
            .unwrap_or_else(|| "You".to_string());
        if let Err(error) = append_log_line(
            &app,
            &log_state,
            &server_id,
            &channel,
            &sender_name,
            &message,
        )
        .await
        {
            log::error!("Failed to log outgoing IRC message: {}", error);
        }
        Ok(())
    } else {
        Err(format!("Not connected to server {}", server_id))
    }
}

#[tauri::command]
async fn join_channel(
    app: AppHandle,
    state: State<'_, IrcState>,
    server_id: String,
    channel: String,
    password: Option<String>,
) -> Result<(), String> {
    log::info!(
        "join_channel called for server: {}, channel: {}, key: {:?}",
        server_id,
        channel,
        password
    );
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        let formatted_channel = if channel.starts_with('#') {
            channel
        } else {
            format!("#{}", channel)
        };
        let key = password.filter(|p| !p.trim().is_empty());
        log::info!("Sending JOIN {} with key {:?}", formatted_channel, key);
        let res = if let Some(k) = key {
            sender.send(Command::JOIN(formatted_channel, Some(k), None))
        } else {
            sender.send_join(&formatted_channel)
        };
        if let Err(e) = res {
            log::error!("Error sending JOIN: {}", e);
            drop(senders);
            state.senders.lock().await.remove(&server_id);
            let _ = app.emit(
                "irc_status",
                IrcStatusEvent {
                    server_id: server_id.clone(),
                    connected: false,
                    error: Some(e.to_string()),
                },
            );
            return Err(e.to_string());
        }
        Ok(())
    } else {
        log::error!("Not connected to server {}", server_id);
        Err(format!("Not connected to server {}", server_id))
    }
}

#[tauri::command]
async fn set_channel_key(
    app: AppHandle,
    state: State<'_, IrcState>,
    server_id: String,
    channel: String,
    key: Option<String>,
) -> Result<(), String> {
    log::info!(
        "set_channel_key called for server: {}, channel: {}, key: {:?}",
        server_id,
        channel,
        key
    );
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        let formatted_channel = if channel.starts_with('#') {
            channel
        } else {
            format!("#{}", channel)
        };
        let key_clean = key.filter(|k| !k.trim().is_empty());
        let mode_cmd = match key_clean {
            Some(k) => Command::Raw("MODE".to_string(), vec![formatted_channel, "+k".to_string(), k]),
            None => Command::Raw("MODE".to_string(), vec![formatted_channel, "-k".to_string(), "*".to_string()]),
        };
        if let Err(e) = sender.send(mode_cmd) {
            drop(senders);
            state.senders.lock().await.remove(&server_id);
            let _ = app.emit(
                "irc_status",
                IrcStatusEvent {
                    server_id: server_id.clone(),
                    connected: false,
                    error: Some(e.to_string()),
                },
            );
            return Err(e.to_string());
        }
        Ok(())
    } else {
        Err(format!("Not connected to server {}", server_id))
    }
}

#[tauri::command]
async fn send_mode(
    app: AppHandle,
    state: State<'_, IrcState>,
    server_id: String,
    target: String,
    mode: Option<String>,
    params: Option<Vec<String>>,
) -> Result<(), String> {
    log::info!(
        "send_mode called for server: {}, target: {}, mode: {:?}, params: {:?}",
        server_id,
        target,
        mode,
        params
    );
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        let formatted_target = if target.starts_with('#') || target.starts_with('&') {
            target
        } else {
            format!("#{}", target)
        };
        let mut raw_args = vec![formatted_target];
        if let Some(m) = mode {
            if !m.trim().is_empty() {
                raw_args.push(m);
            }
        }
        if let Some(p_list) = params {
            for p in p_list {
                if !p.trim().is_empty() {
                    raw_args.push(p);
                }
            }
        }
        let mode_cmd = Command::Raw("MODE".to_string(), raw_args);
        if let Err(e) = sender.send(mode_cmd) {
            drop(senders);
            state.senders.lock().await.remove(&server_id);
            let _ = app.emit(
                "irc_status",
                IrcStatusEvent {
                    server_id: server_id.clone(),
                    connected: false,
                    error: Some(e.to_string()),
                },
            );
            return Err(e.to_string());
        }
        Ok(())
    } else {
        Err(format!("Not connected to server {}", server_id))
    }
}

#[tauri::command]
async fn part_channel(
    app: AppHandle,
    state: State<'_, IrcState>,
    server_id: String,
    channel: String,
) -> Result<(), String> {
    log::info!(
        "part_channel called for server: {}, channel: {}",
        server_id,
        channel
    );
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        let formatted_channel = if channel.starts_with('#') {
            channel
        } else {
            format!("#{}", channel)
        };
        log::info!("Sending PART {}", formatted_channel);
        if let Err(e) = sender.send(Command::PART(formatted_channel, None)) {
            log::error!("Error sending PART: {}", e);
            drop(senders);
            state.senders.lock().await.remove(&server_id);
            let _ = app.emit(
                "irc_status",
                IrcStatusEvent {
                    server_id: server_id.clone(),
                    connected: false,
                    error: Some(e.to_string()),
                },
            );
            return Err(e.to_string());
        }
        Ok(())
    } else {
        log::error!("Not connected to server {}", server_id);
        Err(format!("Not connected to server {}", server_id))
    }
}

#[tauri::command]
async fn set_channel_topic(
    app: AppHandle,
    state: State<'_, IrcState>,
    server_id: String,
    channel: String,
    topic: String,
) -> Result<(), String> {
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        let formatted_channel = if channel.starts_with('#') {
            channel
        } else {
            format!("#{}", channel)
        };
        if let Err(e) = sender.send_topic(&formatted_channel, &topic) {
            drop(senders);
            state.senders.lock().await.remove(&server_id);
            let _ = app.emit("irc_status", IrcStatusEvent {
                server_id: server_id.clone(),
                connected: false,
                error: Some(e.to_string()),
            });
            return Err(e.to_string());
        }
        Ok(())
    } else {
        Err(format!("Not connected to server {}", server_id))
    }
}

#[tauri::command]
async fn disconnect_irc(
    app: AppHandle,
    state: State<'_, IrcState>,
    log_state: State<'_, LogState>,
    server_id: String,
) -> Result<(), String> {
    let mut senders = state.senders.lock().await;
    if let Some(sender) = senders.remove(&server_id) {
        let _ = sender.send_quit("Client disconnected");
    }
    state.nicknames.lock().await.remove(&server_id);
    close_server_logs(&log_state, &server_id).await;
    let _ = app.emit(
        "irc_status",
        IrcStatusEvent {
            server_id: server_id.clone(),
            connected: false,
            error: None,
        },
    );
    Ok(())
}

#[tauri::command]
async fn refresh_channel_names(
    state: State<'_, IrcState>,
    server_id: String,
    channel: String,
) -> Result<(), String> {
    log::info!("refresh_channel_names called for server: {}, channel: {}", server_id, channel);
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        let formatted_channel = if channel.starts_with('#') || channel.starts_with('&') {
            channel
        } else {
            format!("#{}", channel)
        };
        let _ = sender.send(Command::Raw("NAMES".to_string(), vec![formatted_channel]));
        Ok(())
    } else {
        Err(format!("Not connected to server {}", server_id))
    }
}

/// Fetches a remote image URL via the Rust backend and returns it as a base64 data URL.
/// This bypasses Cross-Origin-Resource-Policy (CORP) and Referer-based hotlink restrictions
/// that block image loading in the Tauri WebView.
#[tauri::command]
async fn fetch_image_proxy(url: String) -> Result<String, String> {
    log::info!("fetch_image_proxy fetching: {}", url);
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| {
            log::error!("Proxy build error: {}", e);
            e.to_string()
        })?;

    let response = client
        .get(&url)
        .header("Referer", "https://boards.4chan.org/")
        .send()
        .await
        .map_err(|e| {
            log::error!("Proxy fetch error: {}", e);
            e.to_string()
        })?;

    if !response.status().is_success() {
        let status = response.status();
        log::error!("Proxy bad status: {}", status);
        return Err(format!("Bad HTTP status: {}", status));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    if !content_type.starts_with("image/") {
        log::error!("Proxy not an image, got: {}", content_type);
        return Err(format!("Not an image: {}", content_type));
    }

    let bytes = response.bytes().await.map_err(|e| {
        log::error!("Proxy bytes error: {}", e);
        e.to_string()
    })?;
    
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", content_type, encoded))
}

#[tauri::command]
async fn send_invite(
    app: AppHandle,
    state: State<'_, IrcState>,
    server_id: String,
    channel: String,
    nickname: String,
) -> Result<(), String> {
    log::info!(
        "send_invite called for server: {}, channel: {}, nickname: {}",
        server_id,
        channel,
        nickname
    );
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        let formatted_channel = if channel.starts_with('#') || channel.starts_with('&') {
            channel
        } else {
            format!("#{}", channel)
        };
        log::info!("Sending INVITE {} to {}", nickname, formatted_channel);
        if let Err(e) = sender.send(Command::INVITE(nickname, formatted_channel)) {
            log::error!("Error sending INVITE: {}", e);
            drop(senders);
            state.senders.lock().await.remove(&server_id);
            let _ = app.emit(
                "irc_status",
                IrcStatusEvent {
                    server_id: server_id.clone(),
                    connected: false,
                    error: Some(e.to_string()),
                },
            );
            return Err(e.to_string());
        }
        Ok(())
    } else {
        log::error!("Not connected to server {}", server_id);
        Err(format!("Not connected to server {}", server_id))
    }
}

#[tauri::command]
async fn send_away(
    state: State<'_, IrcState>,
    server_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    log::info!("send_away called for server: {}, reason: {:?}", server_id, reason);
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        let res = match reason {
            Some(ref r) if !r.trim().is_empty() => {
                let formatted_reason = if r.trim().starts_with(':') {
                    r.trim().to_string()
                } else {
                    format!(":{}", r.trim())
                };
                sender.send(Command::Raw("AWAY".to_string(), vec![formatted_reason]))
            }
            _ => sender.send(Command::Raw("AWAY".to_string(), vec![])),
        };
        if let Err(e) = res {
            log::error!("Error sending AWAY: {}", e);
            return Err(e.to_string());
        }
        Ok(())
    } else {
        log::error!("Not connected to server {}", server_id);
        Err(format!("Not connected to server {}", server_id))
    }
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

/// Stores the D-Bus notification ID per tag, and reverse lookup for action clicks.
#[cfg(target_os = "linux")]
static TAG_TO_ID: std::sync::Mutex<Option<HashMap<String, u32>>> = std::sync::Mutex::new(None);
#[cfg(target_os = "linux")]
static ID_TO_TAG: std::sync::Mutex<Option<HashMap<u32, String>>> = std::sync::Mutex::new(None);

#[cfg(target_os = "linux")]
fn parse_gdbus_uint32(s: &str) -> Option<u32> {
    // gdbus output format: "(uint32 5,)\n"
    let inner = s.trim().trim_start_matches('(').trim_end_matches(')');
    let inner = inner.trim_end_matches(',').trim();
    let mut parts = inner.split_whitespace();
    if parts.next()? == "uint32" {
        parts.next()?.parse::<u32>().ok()
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn parse_action_invoked_id(line: &str) -> Option<u32> {
    if !line.contains("ActionInvoked") {
        return None;
    }
    if let Some(pos) = line.find("uint32") {
        let rest = &line[pos + 6..];
        let digits: String = rest
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        digits.parse::<u32>().ok()
    } else {
        let digits: String = line
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        digits.parse::<u32>().ok()
    }
}

/// Send a system notification using D-Bus directly via `gdbus`.
/// Uses replaces_id to update notifications in-place, and action strings to handle clicks.
#[tauri::command]
async fn send_os_notification(title: String, body: String, tag: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let tag_str = tag.as_deref().unwrap_or("default");

            let replace_id: u32 = {
                let mut lock = TAG_TO_ID.lock().unwrap_or_else(|e| e.into_inner());
                let map = lock.get_or_insert_with(HashMap::new);
                map.get(tag_str).copied().unwrap_or(0)
            };

            let hints = format!("{{\"x-canonical-private-synchronous\": <\"{tag_str}\">, \"urgency\": <byte 1>}}");

            let output = std::process::Command::new("gdbus")
                .args([
                    "call", "--session",
                    "--dest=org.freedesktop.Notifications",
                    "--object-path=/org/freedesktop/Notifications",
                    "--method=org.freedesktop.Notifications.Notify",
                    "diIRC",
                    &replace_id.to_string(),
                    "",          // icon
                    &title,
                    &body,
                    "[\"default\", \"Open\"]", // actions
                    &hints,
                    "6000",      // timeout ms
                ])
                .output();

            if let Ok(out) = output {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    if let Some(new_id) = parse_gdbus_uint32(&stdout) {
                        let mut lock_tag = TAG_TO_ID.lock().unwrap_or_else(|e| e.into_inner());
                        lock_tag.get_or_insert_with(HashMap::new).insert(tag_str.to_string(), new_id);

                        let mut lock_id = ID_TO_TAG.lock().unwrap_or_else(|e| e.into_inner());
                        lock_id.get_or_insert_with(HashMap::new).insert(new_id, tag_str.to_string());
                    }
                } else {
                    let _ = std::process::Command::new("notify-send")
                        .args(["--app-name=diIRC", "-t", "6000", "-u", "normal", "--", &title, &body])
                        .status();
                }
            }
        })
        .await
        .map_err(|e| format!("spawn_blocking failed: {e}"))?;

        return Ok(());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (title, body, tag);
        Ok(())
    }
}

#[tauri::command]
async fn clear_os_notification(tag: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let id = {
                let mut lock_tag = TAG_TO_ID.lock().unwrap_or_else(|e| e.into_inner());
                let id_opt = lock_tag.get_or_insert_with(HashMap::new).remove(&tag);
                if let Some(notif_id) = id_opt {
                    let mut lock_id = ID_TO_TAG.lock().unwrap_or_else(|e| e.into_inner());
                    lock_id.get_or_insert_with(HashMap::new).remove(&notif_id);
                }
                id_opt
            };
            if let Some(notif_id) = id {
                let _ = std::process::Command::new("gdbus")
                    .args([
                        "call", "--session",
                        "--dest=org.freedesktop.Notifications",
                        "--object-path=/org/freedesktop/Notifications",
                        "--method=org.freedesktop.Notifications.CloseNotification",
                        &notif_id.to_string(),
                    ])
                    .status();
            }
        })
        .await
        .map_err(|e| format!("spawn_blocking failed: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = tag;
        Ok(())
    }
}

#[tauri::command]
async fn request_motd(
    state: State<'_, IrcState>,
    server_id: String,
) -> Result<(), String> {
    let senders = state.senders.lock().await;
    if let Some(sender) = senders.get(&server_id) {
        sender
            .send(Command::Raw("MOTD".to_string(), vec![]))
            .map_err(|e| e.to_string())
    } else {
        Err(format!("Not connected to server {}", server_id))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(IrcState {
            senders: Arc::new(Mutex::new(HashMap::new())),
            nicknames: Arc::new(Mutex::new(HashMap::new())),
            channel_members: Arc::new(Mutex::new(HashMap::new())),
            recent_sent_messages: Arc::new(Mutex::new(Vec::new())),
        })
        .manage(LogState {
            writers: Arc::new(Mutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            connect_irc,
            send_message,
            load_log_tail,
            load_log_page,
            list_logged_conversations,
            delete_last_log_entry,
            search_log,
            disconnect_irc,
            join_channel,
            part_channel,
            set_channel_topic,
            set_channel_key,
            send_mode,
            send_invite,
            refresh_channel_names,
            fetch_image_proxy,
            toggle_devtools,
            send_os_notification,
            clear_os_notification,
            request_motd,
            send_away,
            load_config_toml,
            save_config_toml,
            open_config_file
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }

            #[cfg(target_os = "linux")]
            {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    use std::io::BufRead;
                    let child = std::process::Command::new("gdbus")
                        .args([
                            "monitor", "--session",
                            "--dest", "org.freedesktop.Notifications",
                            "--object-path", "/org/freedesktop/Notifications"
                        ])
                        .stdout(std::process::Stdio::piped())
                        .spawn();

                    if let Ok(mut child) = child {
                        if let Some(stdout) = child.stdout.take() {
                            let reader = std::io::BufReader::new(stdout);
                            for line_res in reader.lines() {
                                if let Ok(line) = line_res {
                                    if line.contains("ActionInvoked") {
                                        if let Some(id) = parse_action_invoked_id(&line) {
                                            let tag_opt = {
                                                let lock = ID_TO_TAG.lock().unwrap_or_else(|e| e.into_inner());
                                                lock.as_ref().and_then(|map| map.get(&id).cloned())
                                            };
                                            if let Some(tag) = tag_opt {
                                                if let Some(window) = app_handle.get_webview_window("main") {
                                                    let _ = window.unminimize();
                                                    let _ = window.show();
                                                    let _ = window.set_focus();
                                                }
                                                let _ = app_handle.emit("notification_clicked", tag);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        let _ = child.wait();
                    }
                });
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

