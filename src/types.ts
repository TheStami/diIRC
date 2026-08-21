
export enum ChannelType {
  TEXT = "TEXT"
}

export interface Profile {
  id: string;
  userId: string;
  name: string;
  realname?: string;
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
}

export interface LogEntry {
  timestamp: string;
  sender: string;
  content: string;
  /** Byte offset of the line start in the native log file (used for windowed pagination). */
  offset?: number;
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
  realname?: string;
  password?: string;
  useTls?: boolean;
  autoJoinChannels?: string[];
  autoConnect?: boolean;
  autoReconnect?: boolean;
}

export type ServerWithMembersWithProfiles = Server;

export type StatusDisplayMode = "always" | "on_error" | "disabled";


