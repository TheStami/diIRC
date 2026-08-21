import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { format } from "date-fns";
import { 
  Server, 
  Channel, 
  Member, 
  Message, 
  DirectMessage, 
  Profile, 
  ChannelType,
  LogPage,
  StatusDisplayMode,
  HistoryWindow,
  PendingInvite
} from "@/types";
import { 
  INITIAL_SERVERS, 
  INITIAL_MESSAGES, 
  INITIAL_DIRECT_MESSAGES, 
  MOCK_PROFILE 
} from "./mock-data";
import { v4 as uuidv4 } from "uuid";
import { ImageUploadConfig, UrlAuthRule } from "./upload/types";

export const MAX_HISTORY_WINDOW = 600;
export const MAX_PENDING_LIVE = 100;

const EMPTY_HISTORY_WINDOW: HistoryWindow = {
  key: null,
  serverId: null,
  type: null,
  chatId: null,
  target: null,
  olderCursor: null,
  newerCursor: null,
  hasOlder: false,
  hasNewer: false,
  loadingOlder: false,
  loadingNewer: false,
  pendingLive: [],
  ready: false,
};

const chatKey = (type: "channel" | "conversation", chatId: string) => `${type}:${chatId}`;

const applyWindow = (
  set: (fn: (state: MockState) => Partial<MockState>) => void,
  type: "channel" | "conversation",
  chatId: string,
  items: (Message | DirectMessage)[],
  patch: Partial<HistoryWindow>,
) =>
  set((state) => ({
    ...(type === "channel"
      ? { messages: { ...state.messages, [chatId]: dedupById(items) as Message[] } }
      : { directMessages: { ...state.directMessages, [chatId]: dedupById(items) as DirectMessage[] } }),
    historyWindow: { ...state.historyWindow, ...patch } as HistoryWindow,
  }));

const trimWindow = (items: (Message | DirectMessage)[]): (Message | DirectMessage)[] =>
  items.slice(-MAX_HISTORY_WINDOW);

/**
 * Guarantees unique message ids before they reach the virtualizer. TanStack Virtual's
 * measurement cache is keyed by `getItemKey`, so two messages sharing an id (e.g. the
 * same native log offset fetched twice, or a live echo kept beside its logged copy)
 * would collapse to duplicated virtual rows. Keeping the LAST occurrence per id removes
 * the duplicate keys so the list, scrollbar and row layout stay correct.
 */
const dedupById = (items: (Message | DirectMessage)[]): (Message | DirectMessage)[] => {
  if (items.length <= 1) return items;
  const byId = new Map<string, Message | DirectMessage>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()];
};

const firstLogOffset = (items: (Message | DirectMessage)[]): number | null => {
  for (let i = 0; i < items.length; i += 1) {
    const offset = items[i].offset;
    if (offset !== undefined) return offset;
  }
  return null;
};

const lastLogOffset = (items: (Message | DirectMessage)[]): number | null => {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const offset = items[i].offset;
    if (offset !== undefined) return offset;
  }
  return null;
};

/** True when both values plausibly describe the same native log line (offsetless vs fetched). */
const isSameLogLine = (a: Message | DirectMessage, b: Message | DirectMessage): boolean =>
  a.content === b.content
  && a.member?.profile?.name?.toLowerCase() === b.member?.profile?.name?.toLowerCase()
  && Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) < 30000;

/** Drops offsetless items from `existing` that have a counterpart in the fetched log page. */
const dedupOffsetlessAgainstFetched = (
  existing: (Message | DirectMessage)[],
  fetched: (Message | DirectMessage)[],
): (Message | DirectMessage)[] => {
  const offsetless = existing.filter((m) => m.offset === undefined);
  if (offsetless.length === 0) return existing;
  const logged = existing.filter((m) => m.offset !== undefined);
  const kept = offsetless.filter((ol) => !fetched.some((f) => isSameLogLine(ol, f)));
  return [...logged, ...kept];
};

export const formatMessageDate = (
  date: Date | string | number,
  dateFormatPreset: string = "d MMM yyyy, HH:mm",
  customDateFormat: string = "yyyy/MM/dd HH:mm"
): string => {
  const pattern = dateFormatPreset === "custom" 
    ? (customDateFormat.trim() || "d MMM yyyy, HH:mm") 
    : dateFormatPreset;
  try {
    const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
    if (isNaN(d.getTime())) return String(date);
    return format(d, pattern);
  } catch {
    try {
      const d = typeof date === "string" || typeof date === "number" ? new Date(date) : date;
      return format(d, "d MMM yyyy, HH:mm");
    } catch {
      return String(date);
    }
  }
};

const parseLogTimestamp = (timestamp: string) => {
  const parsed = new Date(timestamp.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
};

const createIrcMember = (serverId: string, name: string): Member => ({
  id: `irc-${name}`,
  profileId: `profile-${name}`,
  profile: {
    id: `profile-${name}`,
    userId: `user-${name}`,
    name,
    imageUrl: "",
    email: `${name}@irc.local`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  serverId,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const mapLogEntries = (
  entries: LogPage["entries"],
  server: Server | undefined,
  serverId: string,
  type: "channel" | "conversation",
  chatId: string,
): (Message | DirectMessage)[] => entries.map((entry) => {
  const member = server?.members.find(
    (item) => item.profile.name.toLowerCase() === entry.sender.toLowerCase()
  ) || createIrcMember(serverId, entry.sender);
  const createdAt = parseLogTimestamp(entry.timestamp);
  const stableId = entry.offset !== undefined
    ? `log-${serverId}-${chatId}-${entry.offset}`
    : `log-${serverId}-${chatId}-${entry.timestamp}-${entry.sender}`;

  return {
    id: stableId,
    offset: entry.offset,
    content: entry.content,
    fileUrl: null,
    memberId: member.id,
    member,
    channelId: type === "channel" ? chatId : undefined,
    conversationId: type === "conversation" ? chatId : undefined,
    deleted: false,
    createdAt,
    updatedAt: createdAt,
  } as Message | DirectMessage;
});

export interface AddServerOptions {
  name: string;
  host: string;
  port: number;
  nicknames: string[];
  realname?: string;
  password?: string;
  useTls: boolean;
  autoJoinChannels?: string[];
  imageUrl?: string;
  autoConnect?: boolean;
  autoReconnect?: boolean;
}

export interface UpdateServerOptions {
  name: string;
  host: string;
  port: number;
  nicknames?: string[];
  realname?: string;
  password?: string;
  useTls: boolean;
  autoJoinChannels?: string[];
  imageUrl?: string;
  autoConnect?: boolean;
  autoReconnect?: boolean;
}

export type { StatusDisplayMode };

interface MockState {
  currentProfile: Profile;
  servers: Server[];
  messages: Record<string, Message[]>;
  directMessages: Record<string, DirectMessage[]>;
  activeChatKey: string | null;
  historyLoadToken: number;
  historyWindow: HistoryWindow;
  compactMode: boolean;
  enableMarkdown: boolean;
  confirmLeaveChannel: boolean;
  enableCommandSuggestions: boolean;
  enableLinkPreviews: boolean;
  enableWebPagePreviews: boolean;
  linkPreviewApiUrl: string;
  uploadConfig: ImageUploadConfig;
  urlAuthRules: UrlAuthRule[];
  ircConnectedServers: Record<string, boolean>;
  ircConnectionErrors: Record<string, string | null>;
  statusDisplayMode: StatusDisplayMode;
  dateFormatPreset: string;
  customDateFormat: string;

  // Connection Actions
  setIrcConnected: (serverId: string, isConnected: boolean, error?: string | null) => void;
  setStatusDisplayMode: (mode: StatusDisplayMode) => void;

  // Settings Actions
  setCompactMode: (enabled: boolean) => void;
  setEnableMarkdown: (enabled: boolean) => void;
  setConfirmLeaveChannel: (enabled: boolean) => void;
  setEnableCommandSuggestions: (enabled: boolean) => void;
  setEnableLinkPreviews: (enabled: boolean) => void;
  setEnableWebPagePreviews: (enabled: boolean) => void;
  setLinkPreviewApiUrl: (url: string) => void;
  setUploadConfig: (config: ImageUploadConfig) => void;
  addUrlAuthRule: (rule: Omit<UrlAuthRule, "id">) => void;
  removeUrlAuthRule: (id: string) => void;
  setDateFormatPreset: (preset: string) => void;
  setCustomDateFormat: (format: string) => void;

  // Server Actions
  addServer: (optionsOrName: string | AddServerOptions, imageUrl?: string) => Server;
  updateServer: (serverId: string, optionsOrName: string | UpdateServerOptions, imageUrl?: string) => void;
  deleteServer: (serverId: string) => void;
  joinServerByInvite: (inviteCode: string) => Server | null;
  updateInviteCode: (serverId: string) => string;

  // Channel Actions
  pendingJoin: { serverId: string; channelName: string; password?: string } | null;
  setPendingJoin: (serverId: string | null, channelName: string | null, password?: string) => void;
  addChannel: (serverId: string, name: string, type: ChannelType, isTemporary?: boolean) => Channel;
  updateChannel: (serverId: string, channelId: string, name: string, type: ChannelType) => void;
  updateChannelTopic: (serverId: string, channelId: string, topic: string) => void;
  updateChannelTopicByName: (serverId: string, channelName: string, topic: string) => void;
  updateChannelKey: (serverId: string, channelId: string, key?: string) => void;
  deleteChannel: (serverId: string, channelId: string) => void;
  setChannelTemporary: (serverId: string, channelName: string, isTemporary: boolean) => void;
  pendingInvites: Record<string, PendingInvite[]>;
  addPendingInvite: (serverId: string, channelName: string, inviter: string) => void;
  removePendingInvite: (serverId: string, channelName: string) => void;
  acceptPendingInvite: (serverId: string, channelName: string) => Promise<void>;
  ignorePendingInvite: (serverId: string, channelName: string) => void;

  // Member Actions
  removeMember: (serverId: string, memberId: string) => void;
  addServerMember: (serverId: string, name: string, realname?: string) => Member | undefined;
  removeServerMember: (serverId: string, name: string) => void;
  channelMembers: Record<string, string[]>;
  channelOps: Record<string, string[]>;
  channelUserModes: Record<string, Record<string, string[]>>;
  channelModes: Record<string, string[]>;
  updateChannelMembers: (serverId: string, channelName: string, users: string[], eventType: "NAMES" | "JOIN" | "PART" | "QUIT") => void;
  updateChannelOps: (serverId: string, channelName: string, ops: string[]) => void;
  updateChannelModes: (serverId: string, channelName: string, modeString: string, isFullListing?: boolean) => void;

  // Message Actions
  loadChatHistory: (type: "channel" | "conversation", chatId: string, serverId: string, target: string) => Promise<void>;
      loadOlderHistory: (type: "channel" | "conversation", chatId: string, serverId: string, target: string) => Promise<boolean>;
      loadNewerHistory: (type: "channel" | "conversation", chatId: string, serverId: string, target: string) => Promise<boolean>;
      jumpToLatest: (type: "channel" | "conversation", chatId: string, serverId: string, target: string) => Promise<void>;
  clearHistoryLoading: () => void;
  addMessage: (channelId: string, member: Member, content: string, fileUrl?: string | null, isSystem?: boolean) => Message;
  deleteMessage: (channelId: string, messageId: string) => void;

  // Direct Message Actions
  activeConversations: Record<string, string[]>;
  openConversation: (serverId: string, memberId: string) => void;
  closeConversation: (serverId: string, memberId: string) => void;
  addDirectMessage: (conversationId: string, member: Member, content: string, fileUrl?: string | null) => DirectMessage;
  deleteDirectMessage: (conversationId: string, messageId: string) => void;
}

export const useMockStore = create<MockState>()(
  persist<MockState>(
    (set, get) => ({
      currentProfile: MOCK_PROFILE,
      servers: INITIAL_SERVERS,
      messages: INITIAL_MESSAGES,
      directMessages: INITIAL_DIRECT_MESSAGES,
      activeChatKey: null,
      historyLoadToken: 0,
      historyWindow: EMPTY_HISTORY_WINDOW,
      pendingJoin: null,
      pendingInvites: {},
      setPendingJoin: (serverId, channelName, password) => {
        if (!serverId || !channelName) {
          set({ pendingJoin: null });
        } else {
          set({ pendingJoin: { serverId, channelName: channelName.replace(/^#/, ""), password } });
        }
      },
      activeConversations: {},
      compactMode: false,
      enableMarkdown: true,
      confirmLeaveChannel: true,
      enableCommandSuggestions: true,
      enableLinkPreviews: true,
      enableWebPagePreviews: true,
      linkPreviewApiUrl: "https://api.microlink.io",
      uploadConfig: {
        provider: "litterbox",
        litterboxTime: "24h",
      },
      urlAuthRules: [],
      ircConnectedServers: {},
      ircConnectionErrors: {},
      statusDisplayMode: "always",
      dateFormatPreset: "d MMM yyyy, HH:mm",
      customDateFormat: "yyyy/MM/dd HH:mm",

      setIrcConnected: (serverId: string, isConnected: boolean, error: string | null = null) =>
        set((state) => ({
          ircConnectedServers: {
            ...state.ircConnectedServers,
            [serverId]: isConnected,
          },
          ircConnectionErrors: {
            ...state.ircConnectionErrors,
            [serverId]: isConnected ? null : (error ?? state.ircConnectionErrors[serverId] ?? null),
          },
        })),

      setStatusDisplayMode: (mode: StatusDisplayMode) => set({ statusDisplayMode: mode }),
      setDateFormatPreset: (preset: string) => set({ dateFormatPreset: preset }),
      setCustomDateFormat: (format: string) => set({ customDateFormat: format }),

      setCompactMode: (enabled: boolean) => set({ compactMode: enabled }),
      setEnableMarkdown: (enabled: boolean) => set({ enableMarkdown: enabled }),
      setConfirmLeaveChannel: (enabled: boolean) => set({ confirmLeaveChannel: enabled }),
      setEnableCommandSuggestions: (enabled: boolean) => set({ enableCommandSuggestions: enabled }),
      setEnableLinkPreviews: (enabled: boolean) => set({ enableLinkPreviews: enabled }),
      setEnableWebPagePreviews: (enabled: boolean) => set({ enableWebPagePreviews: enabled }),
      setLinkPreviewApiUrl: (url: string) => set({ linkPreviewApiUrl: url }),
      setUploadConfig: (config: ImageUploadConfig) => set({ uploadConfig: config }),
      addUrlAuthRule: (rule) =>
        set((state) => ({
          urlAuthRules: [
            ...state.urlAuthRules,
            { ...rule, id: `auth-rule-${uuidv4().slice(0, 8)}` },
          ],
        })),
      removeUrlAuthRule: (id) =>
        set((state) => ({
          urlAuthRules: state.urlAuthRules.filter((r) => r.id !== id),
        })),

      addServer: (optionsOrName, imageUrlParam) => {
        const newServerId = `server-${uuidv4().slice(0, 8)}`;
        const newMemberId = `member-${uuidv4().slice(0, 8)}`;

        let name = "";
        let host = "127.0.0.1";
        let port = 6667;
        let nicknames = [get().currentProfile.name.replace(/\s+/g, "") || "ReactUser"];
        let realname = "";
        let password = "";
        let useTls = false;
        let autoConnect = true;
        let autoReconnect = true;
        let autoJoinChannels: string[] = ["general", "test"];
        let imageUrl = imageUrlParam || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=200&auto=format&fit=crop&q=80";

        if (typeof optionsOrName === "object") {
          name = optionsOrName.name;
          host = optionsOrName.host || host;
          port = optionsOrName.port || port;
          nicknames = optionsOrName.nicknames || nicknames;
          realname = optionsOrName.realname || "";
          password = optionsOrName.password || "";
          useTls = optionsOrName.useTls ?? false;
          autoConnect = optionsOrName.autoConnect ?? true;
          autoReconnect = optionsOrName.autoReconnect ?? true;
          if (optionsOrName.autoJoinChannels && optionsOrName.autoJoinChannels.length > 0) {
            autoJoinChannels = optionsOrName.autoJoinChannels;
          }
          if (optionsOrName.imageUrl) {
            imageUrl = optionsOrName.imageUrl;
          }
        } else {
          name = optionsOrName;
        }

        const initialChannels: Channel[] = autoJoinChannels.map((ch) => {
          const cleanName = ch.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
          return {
            id: `channel-${uuidv4().slice(0, 8)}`,
            name: cleanName || "general",
            type: ChannelType.TEXT,
            profileId: get().currentProfile.id,
            serverId: newServerId,
          };
        });

        if (initialChannels.length === 0) {
          initialChannels.push({
            id: `channel-${uuidv4().slice(0, 8)}`,
            name: "general",
            type: ChannelType.TEXT,
            profileId: get().currentProfile.id,
            serverId: newServerId,
          });
        }

        const primaryNick = nicknames[0] || get().currentProfile.name.replace(/\s+/g, "") || "ReactUser";

        const newServer: Server = {
          id: newServerId,
          name,
          host,
          port,
          nicknames,
          realname,
          password,
          useTls,
          autoConnect,
          autoReconnect,
          autoJoinChannels,
          imageUrl,
          inviteCode: `invite-${uuidv4().slice(0, 8)}`,
          profileId: get().currentProfile.id,
          channels: initialChannels,
          members: [
            {
              id: newMemberId,
              profileId: get().currentProfile.id,
              profile: {
                ...get().currentProfile,
                name: primaryNick,
              },
              serverId: newServerId,
            }
          ]
        };

        set((state) => ({
          servers: [...state.servers, newServer],
        }));

        return newServer;
      },

      updateServer: (serverId, optionsOrName, imageUrlParam) => {
        set((state) => {
          const nextMessages = { ...state.messages };
          const updatedServers = state.servers.map((s) => {
            if (s.id !== serverId) return s;

            if (typeof optionsOrName === "object") {
              const newNicknames = optionsOrName.nicknames && optionsOrName.nicknames.length > 0
                ? optionsOrName.nicknames
                : s.nicknames;
              const primaryNick = newNicknames && newNicknames.length > 0 ? newNicknames[0] : "ReactUser";

              const updatedChannels = optionsOrName.autoJoinChannels && optionsOrName.autoJoinChannels.length > 0
                ? optionsOrName.autoJoinChannels.map((ch) => {
                    const cleanName = ch.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
                    const existing = s.channels.find((c) => c.name.trim().replace(/^#/, "").toLowerCase() === cleanName);
                    return existing || {
                      id: `channel-${uuidv4().slice(0, 8)}`,
                      name: cleanName,
                      type: ChannelType.TEXT,
                      profileId: get().currentProfile.id,
                      serverId,
                    };
                  })
                : s.channels;

              const updatedRealname = optionsOrName.realname ?? s.realname;
              const updatedMembers = s.members.map((m) => {
                if (m.profileId === get().currentProfile.id || m.id.startsWith("member-")) {
                  return {
                    ...m,
                    profile: {
                      ...m.profile,
                      name: primaryNick,
                      realname: updatedRealname,
                    },
                  };
                }
                return m;
              });

              // Update any existing messages sent by the user in this server's channels
              s.channels.forEach((ch) => {
                if (nextMessages[ch.id]) {
                  nextMessages[ch.id] = nextMessages[ch.id].map((msg) => {
                    if (msg.member.profileId === get().currentProfile.id || msg.member.id.startsWith("member-")) {
                      return {
                        ...msg,
                        member: {
                          ...msg.member,
                          profile: {
                            ...msg.member.profile,
                            name: primaryNick,
                            realname: updatedRealname,
                          },
                        },
                      };
                    }
                    return msg;
                  });
                }
              });

              return {
                ...s,
                name: optionsOrName.name || s.name,
                host: optionsOrName.host || s.host,
                port: optionsOrName.port || s.port,
                nicknames: newNicknames,
                realname: updatedRealname,
                password: optionsOrName.password ?? s.password,
                useTls: optionsOrName.useTls ?? s.useTls,
                autoConnect: optionsOrName.autoConnect ?? s.autoConnect ?? true,
                autoReconnect: optionsOrName.autoReconnect ?? s.autoReconnect ?? true,
                autoJoinChannels: optionsOrName.autoJoinChannels || s.autoJoinChannels,
                imageUrl: optionsOrName.imageUrl || s.imageUrl,
                channels: updatedChannels,
                members: updatedMembers,
              };
            } else {
              return {
                ...s,
                name: optionsOrName || s.name,
                imageUrl: imageUrlParam || s.imageUrl,
              };
            }
          });

          return {
            servers: updatedServers,
            messages: nextMessages,
          };
        });
      },

      deleteServer: (serverId) => {
        const targetServer = get().servers.find((s) => s.id === serverId);
        const channelIdsToRemove = new Set(targetServer?.channels.map((c) => c.id) || []);

        try {
          invoke("disconnect_irc", { serverId }).catch(() => {});
        } catch (_) {}

        set((state) => {
          const nextMessages = { ...state.messages };
          channelIdsToRemove.forEach((id) => delete nextMessages[id]);

          return {
            servers: state.servers.filter((s) => s.id !== serverId),
            messages: nextMessages,
          };
        });
      },

      joinServerByInvite: (inviteCode) => {
        const existing = get().servers.find((s) => s.inviteCode === inviteCode);
        if (existing) return existing;

        const newServer = get().addServer(`Joined Server (${inviteCode.slice(0, 5)})`, "");
        return newServer;
      },

      updateInviteCode: (serverId) => {
        const newCode = `invite-${uuidv4().slice(0, 8)}`;
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId ? { ...s, inviteCode: newCode } : s
          ),
        }));
        return newCode;
      },

      addChannel: (serverId, name, type, isTemporary) => {
        const cleanName = name.trim().replace(/^#/, "").toLowerCase().replace(/\s+/g, "-");
        const server = get().servers.find((s) => s.id === serverId);

        if (server) {
          const existingChannel = server.channels.find(
            (c) => c.name.trim().replace(/^#/, "").toLowerCase() === cleanName && c.type === type
          );

          if (existingChannel) {
            if (isTemporary === false && existingChannel.isTemporary) {
              set((state) => ({
                servers: state.servers.map((s) =>
                  s.id === serverId
                    ? {
                        ...s,
                        channels: s.channels.map((c) =>
                          c.id === existingChannel.id
                            ? { ...c, isTemporary: false }
                            : c
                        ),
                      }
                    : s
                ),
              }));
              return { ...existingChannel, isTemporary: false };
            }
            return existingChannel;
          }
        }

        const newChannel: Channel = {
          id: `channel-${uuidv4().slice(0, 8)}`,
          name: cleanName,
          type,
          profileId: get().currentProfile.id,
          serverId,
          isTemporary,
        };

        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId
              ? { ...s, channels: [...s.channels, newChannel] }
              : s
          ),
        }));

        return newChannel;
      },

      updateChannel: (serverId, channelId, name, type) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId
              ? {
                  ...s,
                  channels: s.channels.map((c) =>
                    c.id === channelId
                      ? { ...c, name: name.toLowerCase().replace(/\s+/g, "-"), type }
                      : c
                  ),
                }
              : s
          ),
        }));
      },

      updateChannelTopic: (serverId, channelId, topic) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId
              ? {
                  ...s,
                  channels: s.channels.map((c) =>
                    c.id === channelId ? { ...c, topic } : c
                  ),
                }
              : s
          ),
        }));
      },

      updateChannelTopicByName: (serverId, channelName, topic) => {
        const cleanName = channelName.replace(/^#/, "").toLowerCase();
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId
              ? {
                  ...s,
                  channels: s.channels.map((c) =>
                    c.name.toLowerCase() === cleanName ? { ...c, topic } : c
                  ),
                }
              : s
          ),
        }));
      },

      updateChannelKey: (serverId, channelId, key) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId
              ? {
                  ...s,
                  channels: s.channels.map((c) =>
                    c.id === channelId || c.name.toLowerCase() === channelId.toLowerCase().replace(/^#/, "")
                      ? { ...c, key: key || undefined }
                      : c
                  ),
                }
              : s
          ),
        }));
      },

      deleteChannel: (serverId, channelId) => {
        const state = get();
        const server = state.servers.find((s) => s.id === serverId);
        const channel = server?.channels.find((c) => c.id === channelId);

        if (server && channel) {
          invoke("part_channel", {
            serverId: server.id,
            channel: channel.name,
          }).catch((err) => {
            console.error("Failed to send PART to IRC server:", err);
          });
        }

        set((state) => {
          const nextMessages = { ...state.messages };
          delete nextMessages[channelId];

          return {
            servers: state.servers.map((s) =>
              s.id === serverId
                ? { ...s, channels: s.channels.filter((c) => c.id !== channelId) }
                : s
            ),
            messages: nextMessages,
          };
        });
      },

      setChannelTemporary: (serverId, channelName, isTemporary) => {
        const cleanChan = channelName.trim().replace(/^#/, "").toLowerCase();
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId
              ? {
                  ...s,
                  channels: s.channels.map((c) =>
                    c.name.toLowerCase().replace(/^#/, "") === cleanChan
                      ? { ...c, isTemporary }
                      : c
                  ),
                }
              : s
          ),
        }));
      },

      removeMember: (serverId, memberId) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId
              ? { ...s, members: s.members.filter((m) => m.id !== memberId) }
              : s
          ),
        }));
      },

      addServerMember: (serverId, name, realname) => {
        let resultMember: Member | undefined;
        set((state) => {
          const s = state.servers.find(s => s.id === serverId);
          if (!s) return state;

          const exists = s.members.find(m => m.profile.name.toLowerCase() === name.toLowerCase());
          if (exists) {
            if (realname && !exists.profile.realname) {
              exists.profile.realname = realname;
            }
            resultMember = exists;
            return state;
          }

          const currentProfile = state.currentProfile;
          const isOurNick = s.nicknames?.includes(name) || name === currentProfile.name;
          if (isOurNick) {
            let updatedSelf: Member | undefined;
            const updatedMembers = s.members.map((m) => {
              if (m.profileId === currentProfile.id || m.id.startsWith("member-")) {
                const updated = {
                  ...m,
                  profile: {
                    ...m.profile,
                    name,
                    realname: realname || s.realname || m.profile.realname,
                  },
                };
                if (!updatedSelf) updatedSelf = updated;
                return updated;
              }
              return m;
            });
            resultMember = updatedSelf;
            return {
              servers: state.servers.map((serv) =>
                serv.id === serverId
                  ? { ...serv, members: updatedMembers }
                  : serv
              ),
            };
          }

          const mockMember: Member = {
            id: `irc-${name}`,
            profileId: `profile-${name}`,
            profile: {
              id: `profile-${name}`,
              userId: `user-${name}`,
              name: name,
              realname: realname || "",
              imageUrl: "",
              email: `${name}@irc.local`,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            serverId: serverId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          resultMember = mockMember;

          return {
            servers: state.servers.map((serv) =>
              serv.id === serverId
                ? { ...serv, members: [...serv.members, mockMember] }
                : serv
            ),
          };
        });
        return resultMember;
      },

      removeServerMember: (serverId, name) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId
              ? { ...s, members: s.members.filter(m => m.profile.name !== name) }
              : s
          ),
        }));
      },

      channelMembers: {},
      channelOps: {},
      channelUserModes: {},
      channelModes: {},

      updateChannelOps: (serverId, channelName, ops) => {
        const cleanChan = channelName ? channelName.trim().replace(/^#/, "").toLowerCase() : "";
        set((state) => {
          const targetServer = state.servers.find((s) => s.id === serverId);
          if (!targetServer || !cleanChan) return state;

          const targetChannel = targetServer.channels.find(
            (c) => c.name.toLowerCase().replace(/^#/, "") === cleanChan
          );

          if (!targetChannel) return state;

          const chId = targetChannel.id;
          const currentUserModes = { ...(state.channelUserModes[chId] || {}) };
          const opsSet = new Set(ops.map((o) => o.toLowerCase()));

          // Sync channelUserModes 'o' mode with ops list
          Object.keys(currentUserModes).forEach((lowerNick) => {
            const userModes = new Set(currentUserModes[lowerNick] || []);
            if (opsSet.has(lowerNick)) {
              userModes.add("o");
            } else {
              userModes.delete("o");
            }
            currentUserModes[lowerNick] = Array.from(userModes);
          });

          ops.forEach((opNick) => {
            const lower = opNick.toLowerCase();
            const userModes = new Set(currentUserModes[lower] || []);
            userModes.add("o");
            currentUserModes[lower] = Array.from(userModes);
          });

          return {
            channelOps: {
              ...state.channelOps,
              [chId]: ops,
            },
            channelUserModes: {
              ...state.channelUserModes,
              [chId]: currentUserModes,
            },
          };
        });
      },

      updateChannelModes: (serverId, channelName, modeString, isFullListing = false) => {
        const cleanChan = channelName ? channelName.trim().replace(/^#/, "").toLowerCase() : "";
        if (!cleanChan || !modeString) return;

        set((state) => {
          const targetServer = state.servers.find((s) => s.id === serverId);
          if (!targetServer) return state;

          const targetChannel = targetServer.channels.find(
            (c) => c.name.toLowerCase().replace(/^#/, "") === cleanChan
          );

          if (!targetChannel) return state;

          const chId = targetChannel.id;
          const currentFlags = isFullListing ? new Set<string>() : new Set(state.channelModes[chId] || []);
          const existingOps = state.channelOps[chId] || [];
          const currentUserModes = { ...(state.channelUserModes[chId] || {}) };

          // Map lower-cased nick -> original nick casing for ops
          const opsMap = new Map<string, string>();
          existingOps.forEach((op) => opsMap.set(op.toLowerCase(), op));

          const tokens = modeString.trim().split(/\s+/).filter(Boolean);

          let tokenIdx = 0;
          while (tokenIdx < tokens.length) {
            const currentToken = tokens[tokenIdx];

            if (currentToken.startsWith("+") || currentToken.startsWith("-")) {
              let sign: "+" | "-" = "+";
              tokenIdx++;

              for (let i = 0; i < currentToken.length; i++) {
                const char = currentToken[i];
                if (char === "+") {
                  sign = "+";
                } else if (char === "-") {
                  sign = "-";
                } else {
                  const isUserStatusMode = ["o", "h", "a", "q", "v"].includes(char);
                  const isParamAlwaysMode = ["k", "b", "e", "I"].includes(char);
                  const isParamOnPlusMode = char === "l";

                  const requiresArg =
                    isUserStatusMode || isParamAlwaysMode || (isParamOnPlusMode && sign === "+");

                  let targetArg: string | undefined = undefined;
                  if (requiresArg && tokenIdx < tokens.length) {
                    if (!tokens[tokenIdx].startsWith("+") && !tokens[tokenIdx].startsWith("-")) {
                      targetArg = tokens[tokenIdx++];
                    }
                  }

                  if (isUserStatusMode && targetArg) {
                    const lower = targetArg.toLowerCase();

                    if (["o", "h", "a", "q"].includes(char)) {
                      if (sign === "+") {
                        opsMap.set(lower, targetArg);
                      } else {
                        opsMap.delete(lower);
                      }
                    }

                    const userModes = new Set(currentUserModes[lower] || []);
                    if (sign === "+") {
                      userModes.add(char);
                    } else {
                      userModes.delete(char);
                    }
                    currentUserModes[lower] = Array.from(userModes);
                  } else if (char === "k") {
                    if (sign === "+") {
                      currentFlags.add("k");
                    } else {
                      currentFlags.delete("k");
                    }
                  } else if (char === "l") {
                    if (sign === "+") {
                      currentFlags.add("l");
                    } else {
                      currentFlags.delete("l");
                    }
                  } else if (!isParamAlwaysMode) {
                    if (sign === "+") {
                      currentFlags.add(char);
                    } else {
                      currentFlags.delete(char);
                    }
                  }
                }
              }
            } else {
              tokenIdx++;
            }
          }

          const newOps = Array.from(opsMap.values());
          const updatedFlags = Array.from(currentFlags);
          const isInviteOnly = currentFlags.has("i");

          const updatedServers = state.servers.map((s) =>
            s.id === serverId
              ? {
                  ...s,
                  channels: s.channels.map((c) =>
                    c.id === chId
                      ? {
                          ...c,
                          isTemporary: isInviteOnly,
                          modes: updatedFlags,
                        }
                      : c
                  ),
                }
              : s
          );

          return {
            servers: updatedServers,
            channelModes: {
              ...state.channelModes,
              [chId]: updatedFlags,
            },
            channelOps: {
              ...state.channelOps,
              [chId]: newOps,
            },
            channelUserModes: {
              ...state.channelUserModes,
              [chId]: currentUserModes,
            },
          };
        });
      },

      updateChannelMembers: (serverId, channelName, users, eventType) => {
        // Ensure all users exist as server members (stripping prefixes like @, +, etc.)
        users.forEach((u) => {
          if (u && u.trim()) {
            const cleanNick = u.trim().replace(/^[~&@%+]+/, "");
            get().addServerMember(serverId, cleanNick);
          }
        });

        const cleanChan = channelName ? channelName.trim().replace(/^#/, "").toLowerCase() : "";

        set((state) => {
          const targetServer = state.servers.find((s) => s.id === serverId);
          if (!targetServer) return state;

          const updatedChannelMembers = { ...state.channelMembers };
          const updatedChannelOps = { ...state.channelOps };
          const updatedChannelUserModes = { ...state.channelUserModes };

          if (cleanChan) {
            const targetChannel = targetServer.channels.find(
              (c) => c.name.toLowerCase().replace(/^#/, "") === cleanChan
            );

            if (targetChannel) {
              const chId = targetChannel.id;
              const currentUsers = updatedChannelMembers[chId] || [];
              const currentUserModes = { ...(updatedChannelUserModes[chId] || {}) };

              if (eventType === "NAMES") {
                const newOps: string[] = [];
                const newChannelUserModes: Record<string, string[]> = {};

                const plainUsers = users.map((u) => {
                  const prefixMatch = u.match(/^([~&@%+]+)/);
                  const nick = prefixMatch ? u.substring(prefixMatch[1].length) : u;
                  const prefixes = prefixMatch ? prefixMatch[1] : "";

                  const modes: string[] = [];
                  if (prefixes.includes("~")) modes.push("q");
                  if (prefixes.includes("&")) modes.push("a");
                  if (prefixes.includes("@")) modes.push("o");
                  if (prefixes.includes("%")) modes.push("h");
                  if (prefixes.includes("+")) modes.push("v");

                  newChannelUserModes[nick.toLowerCase()] = modes;

                  if (modes.some((m) => ["o", "h", "a", "q"].includes(m))) {
                    newOps.push(nick);
                  }

                  return nick;
                });
                updatedChannelMembers[chId] = Array.from(new Set(plainUsers));
                updatedChannelUserModes[chId] = newChannelUserModes;
                updatedChannelOps[chId] = newOps;
              } else if (eventType === "JOIN") {
                const plainUsers = users.map((u) => u.trim().replace(/^[~&@%+]+/, ""));
                updatedChannelMembers[chId] = Array.from(new Set([...currentUsers, ...plainUsers]));
              } else if (eventType === "PART") {
                const toRemove = new Set(users.map((u) => u.toLowerCase()));
                updatedChannelMembers[chId] = currentUsers.filter((u) => !toRemove.has(u.toLowerCase()));
                if (updatedChannelOps[chId]) {
                  updatedChannelOps[chId] = updatedChannelOps[chId].filter((u) => !toRemove.has(u.toLowerCase()));
                }
                users.forEach((u) => delete currentUserModes[u.toLowerCase()]);
                updatedChannelUserModes[chId] = currentUserModes;
              }
            }
          }

          if (eventType === "QUIT") {
            const toRemove = new Set(users.map((u) => u.toLowerCase()));
            targetServer.channels.forEach((c) => {
              if (updatedChannelMembers[c.id]) {
                updatedChannelMembers[c.id] = updatedChannelMembers[c.id].filter(
                  (u) => !toRemove.has(u.toLowerCase())
                );
              }
              if (updatedChannelOps[c.id]) {
                updatedChannelOps[c.id] = updatedChannelOps[c.id].filter(
                  (u) => !toRemove.has(u.toLowerCase())
                );
              }
              if (updatedChannelUserModes[c.id]) {
                const newModes = { ...updatedChannelUserModes[c.id] };
                users.forEach((u) => delete newModes[u.toLowerCase()]);
                updatedChannelUserModes[c.id] = newModes;
              }
            });
          }

          return {
            channelMembers: updatedChannelMembers,
            channelOps: updatedChannelOps,
            channelUserModes: updatedChannelUserModes,
          };
        });
      },

      loadChatHistory: async (type, chatId, serverId, target) => {
        const requestedKey = chatKey(type, chatId);
        const requestToken = get().historyLoadToken + 1;

        // Reset the sliding window: only the active chat is buffered in memory and the native
        // log is the source of truth. Offsetless (optimistic/local-only) messages are preserved.
        // For same-chat reloads (e.g. jumping to latest), keep existing items until the new page arrives.
        set((state) => {
          const isSameChat = state.activeChatKey === requestedKey;
          const currentMsgs = (
            ((type === "channel" ? state.messages[chatId] : state.directMessages[chatId]) || []) as (Message | DirectMessage)[]
          );
          const pending = (isSameChat && state.historyWindow.pendingLive) ? state.historyWindow.pendingLive : [];
          const preservedLive = dedupById([
            ...currentMsgs.filter((m) => m.offset === undefined),
            ...pending,
          ]);
          return {
            activeChatKey: requestedKey,
            historyLoadToken: requestToken,
            historyWindow: {
              key: requestedKey,
              serverId,
              type,
              chatId,
              target,
              olderCursor: null,
              newerCursor: null,
              hasOlder: false,
              hasNewer: false,
              loadingOlder: false,
              loadingNewer: false,
              pendingLive: [],
              ready: false,
            },
            messages: type === "channel" ? (isSameChat ? state.messages : { [chatId]: preservedLive as Message[] }) : {},
            directMessages: type === "conversation" ? (isSameChat ? state.directMessages : { [chatId]: preservedLive as DirectMessage[] }) : {},
          };
        });

        try {
          const page = await invoke<LogPage>("load_log_page", {
            serverId,
            channel: target,
            before: null,
          });
          const current = get();
          if (current.activeChatKey !== requestedKey || current.historyLoadToken !== requestToken) {
            return;
          }

          const server = current.servers.find((item) => item.id === serverId);
          const fetched = mapLogEntries(page.entries, server, serverId, type, chatId);
          const existing = ((type === "channel"
            ? current.messages[chatId]
            : current.directMessages[chatId]) || []) as (Message | DirectMessage)[];
          const fetchedIds = new Set(fetched.map((m) => m.id));
          const keptLive = dedupOffsetlessAgainstFetched(existing, fetched).filter((m) => !fetchedIds.has(m.id));
          const combined = trimWindow([...fetched, ...keptLive]);
          const newestOffset = lastLogOffset(combined);

          applyWindow(set, type, chatId, combined, {
            hasOlder: page.nextOffset !== null,
            olderCursor: page.nextOffset,
            hasNewer: false,
            newerCursor: newestOffset,
            ready: true,
          });
        } catch (error) {
          console.error(`Failed to load IRC history for ${target}:`, error);
          const current = get();
          if (current.activeChatKey !== requestedKey || current.historyLoadToken !== requestToken) return;
          applyWindow(set, type, chatId,
            ((type === "channel"
              ? current.messages[chatId]
              : current.directMessages[chatId]) || []) as (Message | DirectMessage)[],
            { ready: true });
        }
      },

      loadOlderHistory: async (type, chatId, serverId, target) => {
        const state = get();
        const { historyWindow } = state;
        const requestedKey = chatKey(type, chatId);
        if (
          state.activeChatKey !== requestedKey ||
          historyWindow.key !== requestedKey ||
          historyWindow.loadingOlder ||
          !historyWindow.hasOlder ||
          historyWindow.olderCursor === null
        ) {
          return false;
        }

        set((s) => ({ historyWindow: { ...s.historyWindow, loadingOlder: true } }));

        try {
          const page = await invoke<LogPage>("load_log_page", {
            serverId,
            channel: target,
            before: historyWindow.olderCursor,
          });
          const current = get();
          if (
            current.activeChatKey !== requestedKey ||
            current.historyWindow.key !== requestedKey ||
            current.historyWindow.olderCursor !== historyWindow.olderCursor
          ) {
            return false;
          }

          const server = current.servers.find((item) => item.id === serverId);
          const older = mapLogEntries(page.entries, server, serverId, type, chatId);
          const existing = ((type === "channel"
            ? current.messages[chatId]
            : current.directMessages[chatId]) || []) as (Message | DirectMessage)[];

          const merged = dedupById([...older, ...existing]);
          const wasTrimmed = merged.length > MAX_HISTORY_WINDOW;
          const trimmedCount = wasTrimmed ? merged.length - MAX_HISTORY_WINDOW : 0;
          // While reading older history, keep the OLDEST messages and drop the newest chunk
          // (the dropped tail can be re-fetched with loadNewerHistory when returning to the
          // bottom). trimWindow() slices from the end, so it must NOT be used here.
          const combined = wasTrimmed ? merged.slice(0, MAX_HISTORY_WINDOW) : merged;
          const newestOffset = lastLogOffset(combined);
          const oldestOffset = firstLogOffset(combined);

          applyWindow(set, type, chatId, combined, {
            loadingOlder: false,
            hasOlder: page.nextOffset !== null,
            olderCursor: page.nextOffset ?? oldestOffset,
            // If the buffer was trimmed, we definitely have newer messages in the transcript
            hasNewer: wasTrimmed ? true : current.historyWindow.hasNewer,
            newerCursor: wasTrimmed ? newestOffset : current.historyWindow.newerCursor,
            ready: true,
          });
          return true;
        } catch (error) {
          console.error(`Failed to load older IRC history for ${target}:`, error);
          const current = get();
          if (current.activeChatKey !== requestedKey || current.historyWindow.key !== requestedKey) return false;
          set((s) => ({ historyWindow: { ...s.historyWindow, loadingOlder: false } }));
          return false;
        }
      },

      loadNewerHistory: async (type, chatId, serverId, target) => {
        const state = get();
        const { historyWindow } = state;
        const requestedKey = chatKey(type, chatId);
        if (
          state.activeChatKey !== requestedKey ||
          historyWindow.key !== requestedKey ||
          historyWindow.loadingNewer ||
          !historyWindow.hasNewer ||
          historyWindow.newerCursor === null
        ) {
          return false;
        }

        set((s) => ({ historyWindow: { ...s.historyWindow, loadingNewer: true } }));

        try {
          const page = await invoke<LogPage>("load_log_page", {
            serverId,
            channel: target,
            after: historyWindow.newerCursor,
          });
          const current = get();
          if (
            current.activeChatKey !== requestedKey ||
            current.historyWindow.key !== requestedKey ||
            current.historyWindow.newerCursor !== historyWindow.newerCursor
          ) {
            return false;
          }

          const server = current.servers.find((item) => item.id === serverId);
          const fetched = mapLogEntries(page.entries, server, serverId, type, chatId);
          const existing = ((type === "channel"
            ? current.messages[chatId]
            : current.directMessages[chatId]) || []) as (Message | DirectMessage)[];

          const merged = dedupById([...existing, ...fetched]);
          const wasTrimmed = merged.length > MAX_HISTORY_WINDOW;
          const trimmedCount = wasTrimmed ? merged.length - MAX_HISTORY_WINDOW : 0;
          // While moving forward toward the tail, keep the NEWEST messages and drop the oldest
          const combined = trimWindow(merged);
          const oldestOffset = firstLogOffset(combined);
          const newestOffset = lastLogOffset(combined);
          const isAtLogTail = page.nextOffset === null;

          applyWindow(set, type, chatId, combined, {
            loadingNewer: false,
            hasOlder: wasTrimmed ? true : current.historyWindow.hasOlder,
            olderCursor: wasTrimmed ? oldestOffset : current.historyWindow.olderCursor,
            hasNewer: !isAtLogTail,
            newerCursor: isAtLogTail ? newestOffset : page.nextOffset,
            ready: true,
          });

          if (isAtLogTail) {
            const afterState = get();
            const pending = afterState.historyWindow.pendingLive || [];
            if (pending.length > 0) {
              const items = ((type === "channel"
                ? afterState.messages[chatId]
                : afterState.directMessages[chatId]) || []) as (Message | DirectMessage)[];
              const fetchedIds = new Set(items.map((m) => m.id));
              const stillPending = pending.filter((m) => !fetchedIds.has(m.id));
              if (stillPending.length > 0) {
                applyWindow(set, type, chatId, trimWindow([...items, ...stillPending]), { pendingLive: [] });
              } else {
                set((s) => ({ historyWindow: { ...s.historyWindow, pendingLive: [] } }));
              }
            }
          }

          return true;
        } catch (error) {
          console.error(`Failed to load newer IRC history for ${target}:`, error);
          const current = get();
          if (current.activeChatKey !== requestedKey || current.historyWindow.key !== requestedKey) return false;
          set((s) => ({ historyWindow: { ...s.historyWindow, loadingNewer: false } }));
          return false;
        }
      },

      jumpToLatest: async (type, chatId, serverId, target) => {
        const requestedKey = chatKey(type, chatId);
        const state = get();
        if (state.activeChatKey !== requestedKey || state.historyWindow.key !== requestedKey) return;

        await get().loadChatHistory(type, chatId, serverId, target);
      },

      clearHistoryLoading: () => set((state) => ({
        historyWindow: { ...state.historyWindow, loadingOlder: false, loadingNewer: false },
      })),

      addMessage: (channelId, member, content, fileUrl, isSystem) => {
        const key = chatKey("channel", channelId);
        const state = get();
        const activeMsgs = state.activeChatKey === key ? (state.messages[channelId] || []) : [];
        const lastMsg = activeMsgs[activeMsgs.length - 1];
        if (
          isSystem &&
          lastMsg &&
          lastMsg.isSystem &&
          lastMsg.content === content &&
          new Date().getTime() - new Date(lastMsg.createdAt).getTime() < 3000
        ) {
          return lastMsg;
        }

        const newMessage: Message = {
          id: `msg-${uuidv4().slice(0, 8)}`,
          content,
          fileUrl: fileUrl || null,
          memberId: member.id,
          member,
          channelId,
          deleted: false,
          isSystem,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        // Bounded memory: only the active chat window is buffered; inactive chats stay in the native log.
        if (state.activeChatKey !== key) {
          return newMessage;
        }

        const win = state.historyWindow.key === key ? state.historyWindow : null;
        if (win?.hasNewer) {
          // Reading older history: queue the live message instead of mutating the window.
          set((s) => {
            if (s.activeChatKey !== key) return {};
            const nextPending = [...s.historyWindow.pendingLive, newMessage].slice(-MAX_PENDING_LIVE);
            return {
              historyWindow: {
                ...s.historyWindow,
                pendingLive: nextPending,
              },
            };
          });
        } else {
          set((state2) => {
            if (state2.activeChatKey !== key) return {};
            const nextMsgs = trimWindow([...(state2.messages[channelId] || []), newMessage]) as Message[];
            return {
              messages: {
                ...state2.messages,
                [channelId]: nextMsgs,
              },
            };
          });
        }

        return newMessage;
      },

      addPendingInvite: (serverId, channelName, inviter) => {
        const cleanChan = channelName.trim().replace(/^#/, "");
        set((state) => {
          const current = state.pendingInvites[serverId] || [];
          const exists = current.some(
            (i) => i.channelName.toLowerCase() === cleanChan.toLowerCase()
          );
          if (exists) return state;

          const newInvite: PendingInvite = {
            id: `invite-${uuidv4().slice(0, 8)}`,
            serverId,
            channelName: cleanChan,
            inviter,
            createdAt: new Date().toISOString(),
          };

          return {
            pendingInvites: {
              ...state.pendingInvites,
              [serverId]: [...current, newInvite],
            },
          };
        });
      },

      removePendingInvite: (serverId, channelName) => {
        const cleanChan = channelName.trim().replace(/^#/, "");
        set((state) => {
          const current = state.pendingInvites[serverId] || [];
          return {
            pendingInvites: {
              ...state.pendingInvites,
              [serverId]: current.filter(
                (i) => i.channelName.toLowerCase() !== cleanChan.toLowerCase()
              ),
            },
          };
        });
      },

      acceptPendingInvite: async (serverId, channelName) => {
        const cleanChan = channelName.trim().replace(/^#/, "");
        get().removePendingInvite(serverId, cleanChan);
        get().setPendingJoin(serverId, cleanChan, undefined);

        try {
          await invoke("join_channel", {
            serverId,
            channel: cleanChan,
            password: null,
          });
        } catch (err) {
          console.error("Failed to join channel from invite:", err);
        }
      },

      ignorePendingInvite: (serverId, channelName) => {
        get().removePendingInvite(serverId, channelName);
      },

      deleteMessage: (channelId, messageId) => {
        set((state) => ({
          messages: {
            ...state.messages,
            [channelId]: (state.messages[channelId] || []).map((m) =>
              m.id === messageId ? { ...m, content: "This message has been deleted.", deleted: true } : m
            ),
          },
        }));
      },

      openConversation: (serverId, memberId) => {
        set((state) => {
          const server = state.servers.find((s) => s.id === serverId);
          if (server) {
            const currentProfile = state.currentProfile;
            const currentMember = server.members.find(
              (m) =>
                m.profileId === currentProfile.id ||
                m.profile?.id === currentProfile.id ||
                (server.nicknames && server.nicknames.includes(m.profile?.name)) ||
                m.id.startsWith("member-")
            );
            if (currentMember && currentMember.id === memberId) {
              return state;
            }
          }

          const current = state.activeConversations[serverId] || [];
          if (current.includes(memberId)) return state;
          return {
            activeConversations: {
              ...state.activeConversations,
              [serverId]: [...current, memberId],
            },
          };
        });
      },

      closeConversation: (serverId, memberId) => {
        set((state) => {
          const current = state.activeConversations[serverId] || [];
          return {
            activeConversations: {
              ...state.activeConversations,
              [serverId]: current.filter((id) => id !== memberId),
            },
          };
        });
      },

      addDirectMessage: (conversationId, member, content, fileUrl) => {
        const newDm: DirectMessage = {
          id: `dm-${uuidv4().slice(0, 8)}`,
          content,
          fileUrl: fileUrl || null,
          memberId: member.id,
          member,
          conversationId,
          deleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const key = chatKey("conversation", conversationId);
        const state = get();

        // Bounded memory: only the active conversation window is buffered.
        if (state.activeChatKey !== key) {
          return newDm;
        }

        const win = state.historyWindow.key === key ? state.historyWindow : null;
        if (win?.hasNewer) {
          // Reading older history: queue the live message instead of mutating the window.
          set((s) => {
            if (s.activeChatKey !== key) return {};
            const nextPending = [...s.historyWindow.pendingLive, newDm].slice(-MAX_PENDING_LIVE);
            return {
              historyWindow: {
                ...s.historyWindow,
                pendingLive: nextPending,
              },
            };
          });
        } else {
          set((state2) => {
            if (state2.activeChatKey !== key) return {};
            const nextDms = trimWindow([...(state2.directMessages[conversationId] || []), newDm]) as DirectMessage[];
            return {
              directMessages: {
                ...state2.directMessages,
                [conversationId]: nextDms,
              },
            };
          });
        }

        return newDm;
      },

      deleteDirectMessage: (conversationId, messageId) => {
        set((state) => ({
          directMessages: {
            ...state.directMessages,
            [conversationId]: (state.directMessages[conversationId] || []).map((m) =>
              m.id === messageId ? { ...m, content: "This message has been deleted.", deleted: true } : m
            ),
          },
        }));
      },
    }),
    {
      name: "diirc-store",
      version: 5,
      partialize: (state) => ({
        ...state,
        messages: {},
        directMessages: {},
        activeChatKey: null,
        historyLoadToken: 0,
        historyWindow: EMPTY_HISTORY_WINDOW,
        servers: state.servers.map((s) => ({
          ...s,
          channels: s.channels.filter((c) => !c.isTemporary),
        })),
      }),
      migrate: (persistedState: any) => {
        if (!persistedState || !Array.isArray(persistedState.servers)) {
          return {
            servers: [],
            messages: {},
            directMessages: {},
            activeChatKey: null,
            historyLoadToken: 0,
            historyWindow: EMPTY_HISTORY_WINDOW,
          };
        }
        const currentProfileId = persistedState.currentProfile?.id || MOCK_PROFILE.id;

        const sanitizedServers = persistedState.servers.map((s: any) => {
          const nicks = s.nicknames || (s.nickname ? [s.nickname] : ["ReactUser"]);
          const primaryNick = nicks[0] || "ReactUser";

          const members = (Array.isArray(s.members) ? s.members : []).map((m: any) => {
            if (m.profileId === currentProfileId || m.id?.startsWith("member-")) {
              return {
                ...m,
                profile: {
                  ...m.profile,
                  name: primaryNick,
                },
              };
            }
            return m;
          });

          return {
            ...s,
            host: s.host || "127.0.0.1",
            port: s.port || 6667,
            nicknames: nicks,
            channels: Array.isArray(s.channels) ? s.channels : [],
            members,
            useTls: s.useTls ?? false,
            autoJoinChannels: Array.isArray(s.autoJoinChannels) ? s.autoJoinChannels : ["general", "test"],
          };
        });
        return {
          ...persistedState,
          servers: sanitizedServers,
          messages: {},
          directMessages: {},
          activeChatKey: null,
          historyLoadToken: 0,
          historyWindow: EMPTY_HISTORY_WINDOW,
        };
      }
    }
  )
);
