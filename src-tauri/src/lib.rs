use base64::Engine;
use chrono::Local;
use futures::prelude::*;
use irc::client::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
struct IrcTopicErrorEvent {
    server_id: String,
    channel: String,
    error: String,
}

#[derive(Serialize, Clone)]
struct IrcBadChannelKeyEvent {
    server_id: String,
    channel: String,
    error: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    timestamp: String,
    sender: String,
    content: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogPage {
    entries: Vec<LogEntry>,
    next_offset: Option<u64>,
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
}

struct IrcState {
    senders: Arc<Mutex<HashMap<String, Sender>>>,
    nicknames: Arc<Mutex<HashMap<String, String>>>,
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

async fn append_log_line(
    app: &AppHandle,
    state: &LogState,
    server_id: &str,
    target: &str,
    sender: &str,
    content: &str,
) -> Result<(), String> {
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
    })
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
        });
    }

    let end = position;
    let mut page = Vec::new();
    const CHUNK_SIZE: u64 = 8192;

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

        if page.iter().filter(|byte| **byte == b'\n').count() > 100 || position == 0 {
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

    let start = lines.len().saturating_sub(100);
    let selected = &lines[start..];
    let next_offset = selected
        .first()
        .map(|(offset, _)| *offset)
        .filter(|offset| *offset > 0);

    Ok(LogPage {
        entries: selected
            .iter()
            .filter_map(|(_, line)| parse_log_line(line))
            .collect(),
        next_offset,
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
) -> Result<LogPage, String> {
    read_log_page(&app, &server_id, &channel, before).await
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

    let mut client = Client::from_config(config).await.map_err(|e| {
        let _ = app.emit(
            "irc_status",
            IrcStatusEvent {
                server_id: server_id.clone(),
                connected: false,
            },
        );
        e.to_string()
    })?;

    client.identify().map_err(|e| {
        let _ = app.emit(
            "irc_status",
            IrcStatusEvent {
                server_id: server_id.clone(),
                connected: false,
            },
        );
        e.to_string()
    })?;

    let sender = client.sender();
    state.senders.lock().await.insert(server_id.clone(), sender);
    state
        .nicknames
        .lock()
        .await
        .insert(server_id.clone(), primary_nickname.clone());

    let _ = app.emit(
        "irc_status",
        IrcStatusEvent {
            server_id: server_id.clone(),
            connected: true,
        },
    );

    let stream_server_id = server_id.clone();
    let senders_clone = state.senders.clone();
    let nicknames_clone = state.nicknames.clone();
    let app_clone = app.clone();
    let log_state_clone = LogState {
        writers: log_state.writers.clone(),
    };
    
    let initial_channels = channels_to_join.clone();

    tauri::async_runtime::spawn(async move {
        let mut stream = match client.stream() {
            Ok(s) => s,
            Err(e) => {
                log::error!(
                    "Failed to open stream for server {}: {}",
                    stream_server_id,
                    e
                );
                senders_clone.lock().await.remove(&stream_server_id);
                nicknames_clone.lock().await.remove(&stream_server_id);
                let _ = app_clone.emit(
                    "irc_status",
                    IrcStatusEvent {
                        server_id: stream_server_id,
                        connected: false,
                    },
                );
                return;
            }
        };

        while let Some(message_res) = stream.next().await {
            match message_res {
                Ok(message) => {
                    log::info!("IRC [{}] Received: {:?}", stream_server_id, message.command);
                    match message.command {
                        Command::PRIVMSG(channel, content) => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source {
                                    Prefix::Nickname(nick, _, _) => nick,
                                    Prefix::ServerName(name) => name,
                                };
                                let own_nickname =
                                    nicknames_clone.lock().await.get(&stream_server_id).cloned();
                                if own_nickname.as_deref().is_some_and(|nickname| {
                                    nickname.eq_ignore_ascii_case(&sender_name)
                                }) {
                                    continue;
                                }
                                let log_target =
                                    if channel.starts_with('#') || channel.starts_with('&') {
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
                                let payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: sender_name.clone(),
                                    content,
                                    channel: channel.clone(),
                                    is_system: false,
                                };
                                let _ = app_clone.emit("irc_message", payload);

                                let payload_users = IrcUserEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.clone(),
                                    users: vec![sender_name],
                                    event_type: "JOIN".to_string(),
                                };
                                let _ = app_clone.emit("irc_user_event", payload_users);
                            }
                        }
                        Command::JOIN(channel, _, _) => {
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
                                let payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: sender_name.clone(),
                                    content: format!("{} has joined", full_source),
                                    channel: channel.clone(),
                                    is_system: true,
                                };
                                let _ = app_clone.emit("irc_message", payload);

                                let payload_users = IrcUserEvent {
                                    server_id: stream_server_id.clone(),
                                    channel,
                                    users: vec![sender_name],
                                    event_type: "JOIN".to_string(),
                                };
                                let _ = app_clone.emit("irc_user_event", payload_users);
                            }
                        }
                        Command::PART(channel, _) => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source.clone() {
                                    Prefix::Nickname(nick, _, _) => nick,
                                    Prefix::ServerName(name) => name,
                                };
                                let payload_users = IrcUserEvent {
                                    server_id: stream_server_id.clone(),
                                    channel,
                                    users: vec![sender_name],
                                    event_type: "PART".to_string(),
                                };
                                let _ = app_clone.emit("irc_user_event", payload_users);
                            }
                        }
                        Command::QUIT(_) => {
                            if let Some(source) = message.prefix {
                                let sender_name = match source.clone() {
                                    Prefix::Nickname(nick, _, _) => nick,
                                    Prefix::ServerName(name) => name,
                                };
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
                                    users.push(clean.clone());
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

                                let ops_payload = IrcOpsEvent {
                                    server_id: stream_server_id.clone(),
                                    channel: channel.to_string(),
                                    ops,
                                };
                                let _ = app_clone.emit("irc_ops_event", ops_payload);
                            }
                        }
                        Command::Response(Response::RPL_WELCOME, ref _args) => {
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
                        Command::Response(Response::ERR_CHANOPRIVSNEEDED, ref args) => {
                            let channel = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "You're not channel operator".to_string());
                            
                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Cannot change topic on {}: {}", channel, reason),
                                channel: channel.clone(),
                                is_system: true,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcTopicErrorEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: reason,
                            };
                            let _ = app_clone.emit("irc_topic_error", err_payload);
                        }
                        Command::Response(Response::ERR_CANNOTSENDTOCHAN, ref args) => {
                            let channel = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "Cannot send to channel".to_string());
                            
                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Error: {} ({})", reason, channel),
                                channel: channel.clone(),
                                is_system: true,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);
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
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);

                            let err_payload = IrcBadChannelKeyEvent {
                                server_id: stream_server_id.clone(),
                                channel,
                                error: reason,
                            };
                            let _ = app_clone.emit("irc_bad_channel_key", err_payload);
                        }
                        Command::Response(Response::ERR_NOPRIVILEGES, ref args) => {
                            let reason = args.get(1).cloned().unwrap_or_else(|| "Permission Denied".to_string());
                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Permission Denied: {}", reason),
                                channel: "".to_string(),
                                is_system: true,
                            };
                            let _ = app_clone.emit("irc_message", msg_payload);
                        }
                        Command::Response(Response::ERR_NOCHANMODES, ref args) => {
                            let channel = args.get(1).cloned().unwrap_or_default();
                            let reason = args.get(2).cloned().unwrap_or_else(|| "Channel doesn't support modes".to_string());
                            let msg_payload = IrcMessage {
                                server_id: stream_server_id.clone(),
                                sender: "System".to_string(),
                                content: format!("Cannot set topic on {}: {}", channel, reason),
                                channel,
                                is_system: true,
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
                                let msg_payload = IrcMessage {
                                    server_id: stream_server_id.clone(),
                                    sender: sender.clone(),
                                    content: sys_content,
                                    channel: channel.clone(),
                                    is_system: true,
                                };
                                let _ = app_clone.emit("irc_message", msg_payload);
                            }
                        }
                        _ => {}
                    }
                }
                Err(e) => {
                    log::error!("IRC [{}] Stream error: {}", stream_server_id, e);
                }
            }
        }

        log::warn!("IRC [{}] Stream closed!", stream_server_id);
        senders_clone.lock().await.remove(&stream_server_id);
        nicknames_clone.lock().await.remove(&stream_server_id);
        close_server_logs(&log_state_clone, &stream_server_id).await;
        let _ = app_clone.emit(
            "irc_status",
            IrcStatusEvent {
                server_id: stream_server_id,
                connected: false,
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
                },
            );
            return Err(e.to_string());
        }
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
        },
    );
    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(IrcState {
            senders: Arc::new(Mutex::new(HashMap::new())),
            nicknames: Arc::new(Mutex::new(HashMap::new())),
        })
        .manage(LogState {
            writers: Arc::new(Mutex::new(HashMap::new())),
        })
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            connect_irc,
            send_message,
            load_log_tail,
            load_log_page,
            disconnect_irc,
            join_channel,
            part_channel,
            set_channel_topic,
            set_channel_key,
            fetch_image_proxy
        ])
        .setup(|app| {
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
