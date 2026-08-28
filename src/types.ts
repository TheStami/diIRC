
export enum ChannelType {
  TEXT = "TEXT"
}

export interface Profile {
  id: string;
  userId: string;
  name: string;
  realname?: string;
  host?: string;
  imageUrl: string;
  email: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Member {
  id: string;
  profileId: string;
  profile: Profile;
  serverId: string;
  createdAt?: string;
  updatedAt?: string;
}

export type NotificationOverrideValue = "default" | "enabled" | "disabled";
export type ChannelNotificationMode = "all" | "mentions" | "off";
export type DmNotificationMode = "all" | "off";
export type ChannelNotificationOverrideValue = "default" | "all" | "mentions" | "off";
export type DmNotificationOverrideValue = "default" | "all" | "off";

export type SoundPreset = "chime" | "ping" | "bell" | "pop" | "custom";

export interface NotificationOverride {
  sound?: NotificationOverrideValue;
  popup?: NotificationOverrideValue;
  taskbar?: NotificationOverrideValue;
  soundCooldown?: "default" | number;
  soundPreset?: "default" | SoundPreset;
  dmSoundPreset?: "default" | SoundPreset;
  customSoundUrl?: string;
  customDmSoundUrl?: string;
  channelNotifications?: ChannelNotificationOverrideValue;
  dmNotifications?: DmNotificationOverrideValue;
}

export interface GlobalNotificationSettings {
  soundEnabled: boolean;
  soundPreset: SoundPreset;
  dmSoundPreset?: SoundPreset;
  customSoundUrl?: string;
  customDmSoundUrl?: string;
  soundCooldownMs?: number;
  popupEnabled: boolean;
  taskbarHighlightEnabled: boolean;
  channelNotifications?: ChannelNotificationMode;
  dmNotifications?: DmNotificationMode;
}

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  profileId: string;
  serverId: string;
  topic?: string;
  key?: string;
  modes?: string[];
  isTemporary?: boolean;
  notificationSettings?: NotificationOverride;
  createdAt?: string;
  updatedAt?: string;
}

export interface PendingInvite {
  id: string;
  serverId: string;
  channelName: string;
  inviter: string;
  createdAt: string;
}

export interface MessageReplyTo {
  messageId: string;
  nick: string;
  preview: string;
  msgid?: string;
}

export interface Message {
  id: string;
  content: string;
  fileUrl?: string | null;
  memberId: string;
  member: Member;
  channelId: string;
  deleted: boolean;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
  /** Byte offset in the native log (windowed pagination). */
  offset?: number;
  /** IRCv3 msgid when provided by the server. */
  ircMsgid?: string;
  /** IRCv3 +draft/reply target msgid. */
  replyToMsgid?: string;
  /** Persisted reply preview for UI (survives restart). */
  replyTo?: MessageReplyTo;
}

export interface DirectMessage {
  id: string;
  content: string;
  fileUrl?: string | null;
  memberId: string;
  member: Member;
  conversationId: string;
  deleted: boolean;
  isSystem?: boolean;
  createdAt: string;
  updatedAt: string;
  /** Byte offset in the native log (windowed pagination). */
  offset?: number;
  ircMsgid?: string;
  replyToMsgid?: string;
  replyTo?: MessageReplyTo;
}

export interface LogEntry {
  timestamp: string;
  sender: string;
  content: string;
  /** Byte offset of the line start in the native log file (used for windowed pagination). */
  offset?: number;
  msgid?: string;
  replyToMsgid?: string;
  replyNick?: string;
  replyPreview?: string;
  replyParentOffset?: number;
}

export interface LogPage {
  entries: LogEntry[];
  nextOffset: number | null;
  /** Forward-pagination cursor: offset of the last returned line (continue from here). */
  nextAfter?: number | null;
}

/**
 * Sliding window state for the single rendered chat (transient, never persisted).
 *
 * The native append-only log is the source of truth; the window holds at most
 * `MAX_HISTORY_WINDOW` items in memory, slides backward via `olderCursor`
 * (`load_log_page` with `before`) and forward via `newerCursor` (`after`), and
 * queues offsetless live messages in `pendingLive` while the user reads history.
 */
export interface HistoryWindow {
  key: string | null;
  serverId: string | null;
  type: "channel" | "conversation" | null;
  chatId: string | null;
  target: string | null;
  /** Next `before` cursor for backward pagination. */
  olderCursor: number | null;
  /** Next `after` cursor for forward pagination. */
  newerCursor: number | null;
  hasOlder: boolean;
  hasNewer: boolean;
  loadingOlder: boolean;
  loadingNewer: boolean;
  /** Offsetless live messages received while reading history (bounded). */
  pendingLive: (Message | DirectMessage)[];
  /** Event-driven unread total for the active chat; survives window sliding/trimming. */
  unreadCount: number;
  /** Id of the newest message the user has actually seen at the bottom. */
  lastSeenTailId: string | null;
  /** Live flag mirrored from ChatMessages: is the user currently following the tail? */
  tailPinned: boolean;
  /** True once the initial tail page is loaded or failed. */
  ready: boolean;
}

export interface Conversation {
  id: string;
  memberOneId: string;
  memberOne: Member;
  memberTwoId: string;
  memberTwo: Member;
  directMessages?: DirectMessage[];
}

export interface CustomCommand {
  trigger: string;
  message: string;
  description?: string;
  suggestions?: string[];
}

export type MotdDisplayPolicy = "always" | "on_change" | "never";
export type ServerMotdDisplayPolicy = "default" | "always" | "on_change" | "never" | "never_globally";

export type UserDisplayNameMode = "nickname" | "realname" | "username";
export type ServerUserDisplayNameMode = "default" | "nickname" | "realname" | "username";

export interface Server {
  id: string;
  name: string;
  imageUrl: string;
  inviteCode: string;
  profileId: string;
  channels: Channel[];
  members: Member[];
  createdAt?: string;
  updatedAt?: string;
  host?: string;
  port?: number;
  nicknames?: string[];
  currentNick?: string;
  username?: string;
  realname?: string;
  password?: string;
  useTls?: boolean;
  autoConnect?: boolean;
  autoReconnect?: boolean;
  customCommands?: CustomCommand[];
  notificationSettings?: NotificationOverride;
  motd?: string[];
  motdPolicy?: ServerMotdDisplayPolicy;
  displayNameMode?: ServerUserDisplayNameMode;
  parseLegacyZncTimestamps?: boolean;
  legacyReply?: boolean;
}

export type ServerWithMembersWithProfiles = Server;

export type StatusDisplayMode = "always" | "on_error" | "disabled";





