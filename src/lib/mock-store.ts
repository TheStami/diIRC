import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { 
  Server, 
  Channel, 
  Member, 
  Message, 
  DirectMessage, 
  Profile, 
  ChannelType,
  LogPage
} from "@/types";
import { 
  INITIAL_SERVERS, 
  INITIAL_MESSAGES, 
  INITIAL_DIRECT_MESSAGES, 
  MOCK_PROFILE 
} from "./mock-data";
import { v4 as uuidv4 } from "uuid";
import { ImageUploadConfig, UrlAuthRule } from "./upload/types";

export const MAX_MESSAGES_IN_MEMORY = 500;

const chatKey = (type: "channel" | "conversation", id: string) => `${type}:${id}`;

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

  return {
    id: `log-${uuidv4().slice(0, 12)}`,
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
}

export type StatusDisplayMode = "always" | "on_error" | "disabled";

interface MockState {
  currentProfile: Profile;
  servers: Server[];
  messages: Record<string, Message[]>;
  directMessages: Record<string, DirectMessage[]>;
  activeChatKey: string | null;
  historyLoadToken: number;
  historyNextOffset: number | null;
  historyHasMore: boolean;
  compactMode: boolean;
  enableCommandSuggestions: boolean;
  enableLinkPreviews: boolean;
  enableWebPagePreviews: boolean;
  linkPreviewApiUrl: string;
  uploadConfig: ImageUploadConfig;
  urlAuthRules: UrlAuthRule[];
  ircConnectedServers: Record<string, boolean>;
  statusDisplayMode: StatusDisplayMode;

  // Connection Actions
  setIrcConnected: (serverId: string, isConnected: boolean) => void;
  setStatusDisplayMode: (mode: StatusDisplayMode) => void;

  // Settings Actions
  setCompactMode: (enabled: boolean) => void;
  setEnableCommandSuggestions: (enabled: boolean) => void;
  setEnableLinkPreviews: (enabled: boolean) => void;
  setEnableWebPagePreviews: (enabled: boolean) => void;
  setLinkPreviewApiUrl: (url: string) => void;
  setUploadConfig: (config: ImageUploadConfig) => void;
  addUrlAuthRule: (rule: Omit<UrlAuthRule, "id">) => void;
  removeUrlAuthRule: (id: string) => void;

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

  // Member Actions
  removeMember: (serverId: string, memberId: string) => void;
  addServerMember: (serverId: string, name: string, realname?: string) => Member | undefined;
  removeServerMember: (serverId: string, name: string) => void;
  channelMembers: Record<string, string[]>;
  channelOps: Record<string, string[]>;
  updateChannelMembers: (serverId: string, channelName: string, users: string[], eventType: "NAMES" | "JOIN" | "PART" | "QUIT") => void;
  updateChannelOps: (serverId: string, channelName: string, ops: string[]) => void;

  // Message Actions
  loadChatHistory: (type: "channel" | "conversation", chatId: string, serverId: string, target: string) => Promise<void>;
  loadOlderHistory: (type: "channel" | "conversation", chatId: string, serverId: string, target: string) => Promise<boolean>;
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
      historyNextOffset: null,
      historyHasMore: false,
      pendingJoin: null,
      setPendingJoin: (serverId, channelName, password) => {
        if (!serverId || !channelName) {
          set({ pendingJoin: null });
        } else {
          set({ pendingJoin: { serverId, channelName: channelName.replace(/^#/, ""), password } });
        }
      },
      activeConversations: {},
      compactMode: false,
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
      statusDisplayMode: "always",

      setIrcConnected: (serverId: string, isConnected: boolean) =>
        set((state) => ({
          ircConnectedServers: {
            ...state.ircConnectedServers,
            [serverId]: isConnected,
          },
        })),

      setStatusDisplayMode: (mode: StatusDisplayMode) => set({ statusDisplayMode: mode }),

      setCompactMode: (enabled: boolean) => set({ compactMode: enabled }),
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

              const updatedMembers = s.members.map((m) => {
                if (m.profileId === get().currentProfile.id || m.id.startsWith("member-")) {
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
                realname: optionsOrName.realname ?? s.realname,
                password: optionsOrName.password ?? s.password,
                useTls: optionsOrName.useTls ?? s.useTls,
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

      updateChannelOps: (serverId, channelName, ops) => {
        const cleanChan = channelName ? channelName.trim().replace(/^#/, "").toLowerCase() : "";
        set((state) => {
          const targetServer = state.servers.find((s) => s.id === serverId);
          if (!targetServer || !cleanChan) return state;

          const targetChannel = targetServer.channels.find(
            (c) => c.name.toLowerCase().replace(/^#/, "") === cleanChan
          );

          if (!targetChannel) return state;

          return {
            channelOps: {
              ...state.channelOps,
              [targetChannel.id]: ops,
            },
          };
        });
      },

      updateChannelMembers: (serverId, channelName, users, eventType) => {
        // Ensure all users exist as server members
        users.forEach((u) => {
          if (u && u.trim()) {
            get().addServerMember(serverId, u.trim());
          }
        });

        const cleanChan = channelName ? channelName.trim().replace(/^#/, "").toLowerCase() : "";

        set((state) => {
          const targetServer = state.servers.find((s) => s.id === serverId);
          if (!targetServer) return state;

          const updatedChannelMembers = { ...state.channelMembers };

          if (cleanChan) {
            const targetChannel = targetServer.channels.find(
              (c) => c.name.toLowerCase().replace(/^#/, "") === cleanChan
            );

            if (targetChannel) {
              const chId = targetChannel.id;
              const currentUsers = updatedChannelMembers[chId] || [];

              if (eventType === "NAMES") {
                updatedChannelMembers[chId] = Array.from(new Set(users));
              } else if (eventType === "JOIN") {
                updatedChannelMembers[chId] = Array.from(new Set([...currentUsers, ...users]));
              } else if (eventType === "PART") {
                const toRemove = new Set(users.map((u) => u.toLowerCase()));
                updatedChannelMembers[chId] = currentUsers.filter((u) => !toRemove.has(u.toLowerCase()));
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
            });
          }

          return { channelMembers: updatedChannelMembers };
        });
      },

      loadChatHistory: async (type, chatId, serverId, target) => {
        const requestedKey = chatKey(type, chatId);
        const requestToken = get().historyLoadToken + 1;
        set({
          activeChatKey: requestedKey,
          historyLoadToken: requestToken,
          historyNextOffset: null,
          historyHasMore: false,
          messages: {},
          directMessages: {},
        });

        try {
          const page = await invoke<LogPage>("load_log_page", {
            serverId,
            channel: target,
            before: null,
          });
          const state = get();
          if (state.activeChatKey !== requestedKey || state.historyLoadToken !== requestToken) return;

          const server = state.servers.find((item) => item.id === serverId);
          const messages = mapLogEntries(page.entries, server, serverId, type, chatId);

          if (type === "channel") {
            set({
              messages: { [chatId]: messages as Message[] },
              historyNextOffset: page.nextOffset,
              historyHasMore: page.nextOffset !== null,
            });
          } else {
            set({
              directMessages: { [chatId]: messages as DirectMessage[] },
              historyNextOffset: page.nextOffset,
              historyHasMore: page.nextOffset !== null,
            });
          }
        } catch (error) {
          console.error(`Failed to load IRC history for ${target}:`, error);
        }
      },

      loadOlderHistory: async (type, chatId, serverId, target) => {
        const requestedKey = chatKey(type, chatId);
        const state = get();
        if (
          state.activeChatKey !== requestedKey
          || !state.historyHasMore
          || state.historyNextOffset === null
        ) {
          return false;
        }

        const requestToken = state.historyLoadToken;

        try {
          const page = await invoke<LogPage>("load_log_page", {
            serverId,
            channel: target,
            before: state.historyNextOffset,
          });
          const current = get();
          if (current.activeChatKey !== requestedKey || current.historyLoadToken !== requestToken) {
            return false;
          }

          const server = current.servers.find((item) => item.id === serverId);
          const olderMessages = mapLogEntries(page.entries, server, serverId, type, chatId);
          const currentMessages = type === "channel"
            ? current.messages[chatId] || []
            : current.directMessages[chatId] || [];
          const combinedMessages = [...olderMessages, ...currentMessages].slice(-MAX_MESSAGES_IN_MEMORY);
          const hasMore = page.nextOffset !== null && combinedMessages.length < MAX_MESSAGES_IN_MEMORY;

          if (type === "channel") {
            set({
              messages: { [chatId]: combinedMessages as Message[] },
              historyNextOffset: page.nextOffset,
              historyHasMore: hasMore,
            });
          } else {
            set({
              directMessages: { [chatId]: combinedMessages as DirectMessage[] },
              historyNextOffset: page.nextOffset,
              historyHasMore: hasMore,
            });
          }

          return olderMessages.length > 0;
        } catch (error) {
          console.error(`Failed to load older IRC history for ${target}:`, error);
          return false;
        }
      },

      addMessage: (channelId, member, content, fileUrl, isSystem) => {
        const existingMsgs = get().messages[channelId] || [];
        const lastMsg = existingMsgs[existingMsgs.length - 1];
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

        if (get().activeChatKey === chatKey("channel", channelId)) {
          set((state) => ({
            messages: {
              [channelId]: [...(state.messages[channelId] || []), newMessage].slice(-MAX_MESSAGES_IN_MEMORY),
            },
          }));
        }

        return newMessage;
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

        set((state) => ({
          directMessages: {
            ...state.directMessages,
            [conversationId]: [...(state.directMessages[conversationId] || []), newDm].slice(-MAX_MESSAGES_IN_MEMORY),
          },
        }));

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
      version: 4,
      partialize: (state) => ({
        ...state,
        messages: {},
        directMessages: {},
        activeChatKey: null,
        historyLoadToken: 0,
        historyNextOffset: null,
        historyHasMore: false,
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
            historyNextOffset: null,
            historyHasMore: false,
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
          historyNextOffset: null,
          historyHasMore: false,
        };
      }
    }
  )
);
