import { useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useMockStore, getServerSelfMember, getServerActiveNick } from "@/lib/mock-store";
import { useModalStore } from "@/hooks/use-modal-store";
import { useDraftStore } from "@/hooks/use-draft-store";
import { Server, ChannelType } from "@/types";
import { extractFlag } from "@/lib/flag-tips";
import {
  resolveEffectiveNotificationSettings,
  triggerIncomingNotification,
  clearNotificationGroup,
} from "@/lib/notification-service";
import { IrcMultilineAccumulator } from "@/lib/irc-multiline-accumulator";

interface IrcMessagePayload {
  serverId?: string;
  server_id?: string;
  sender: string;
  content: string;
  channel: string;
  isSystem?: boolean;
  is_system?: boolean;
  timestamp?: string;
}

interface IrcUserEventPayload {
  server_id: string;
  channel: string;
  users: string[];
  event_type: string;
}

interface IrcUserHostEventPayload {
  server_id: string;
  nick: string;
  host: string;
  realname?: string;
}

export const IrcProvider = ({ children }: { children: React.ReactNode }) => {
  const addMessage = useMockStore((state) => state.addMessage);
  const currentProfile = useMockStore((state) => state.currentProfile);
  const servers = useMockStore((state) => state.servers);
  const addServerMember = useMockStore((state) => state.addServerMember);
  const removeServerMember = useMockStore((state) => state.removeServerMember);
  const updateChannelMembers = useMockStore((state) => state.updateChannelMembers);
  const setIrcConnected = useMockStore((state) => state.setIrcConnected);
  const activeChatKey = useMockStore((state) => state.activeChatKey);
  const navigate = useNavigate();
  const connectedConfigsRef = useRef<Map<string, string>>(new Map());
  const connectingRef = useRef<Set<string>>(new Set());
  const attemptsRef = useRef<Map<string, number>>(new Map());
  const nextReconnectTimeRef = useRef<Map<string, number>>(new Map());

  // Clear notifications & unreads for active chat when switched or focused
  useEffect(() => {
    if (activeChatKey) {
      useMockStore.getState().clearUnread(activeChatKey);
      const parts = activeChatKey.split(":");
      if (parts.length >= 2) {
        const type = parts[0];
        const chatId = parts[1];
        const store = useMockStore.getState();
        for (const server of store.servers) {
          if (type === "channel" && server.channels.some((c) => c.id === chatId)) {
            clearNotificationGroup(`chan:${server.id}:${chatId}`);
            break;
          }
          if (type === "conversation") {
            clearNotificationGroup(`dm:${server.id}:${chatId}`);
          }
        }
      }
    }
  }, [activeChatKey]);

  useEffect(() => {
    const handleFocus = () => {
      const store = useMockStore.getState();
      if (store.activeChatKey) {
        store.clearUnread(store.activeChatKey);
      }
    };

    window.addEventListener("focus", handleFocus);

    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        appWindow.listen("tauri://focus", handleFocus).then((fn) => {
          unlisten = fn;
        });
      })
      .catch(() => {});

    return () => {
      window.removeEventListener("focus", handleFocus);
      if (unlisten) unlisten();
    };
  }, []);

  // Listen for notification click events from OS (Linux D-Bus / Web)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => {
        listen<string>("notification_clicked", (event) => {
          const tag = event.payload;
          if (!tag) return;

          const parts = tag.split(":");
          if (parts.length >= 3) {
            const kind = parts[0];
            const serverId = parts[1];
            const targetId = parts[2];

            const store = useMockStore.getState();
            const server = store.servers.find((s) => s.id === serverId);
            if (!server) return;

            if (kind === "chan") {
              const channel = server.channels.find(
                (c) => c.id === targetId || c.name.toLowerCase() === targetId.toLowerCase()
              );
              if (channel) {
                navigate(`/servers/${serverId}/channels/${channel.id}`);
              }
            } else if (kind === "dm") {
              const member = server.members.find((m) => m.id === targetId);
              if (member) {
                store.openConversation(serverId, member.id);
                navigate(`/servers/${serverId}/conversations/${member.id}`);
              }
            }
            clearNotificationGroup(tag);
          }
        })
          .then((un) => {
            unlisten = un;
          })
          .catch(console.error);
      })
      .catch(console.error);

    return () => {
      unlisten?.();
    };
  }, [navigate]);

  const attemptConnect = useCallback(async (server: Server) => {
    if (connectingRef.current.has(server.id)) return;
    connectingRef.current.add(server.id);

    const nicks = server.nicknames && server.nicknames.length > 0 
      ? server.nicknames 
      : [server.nicknames?.[0] || currentProfile.name.replace(/\s+/g, "") || "ReactUser"];
    const channels = server.channels.map((c) => c.key ? `${c.name} ${c.key}` : c.name);

    try {
      await invoke("connect_irc", {
        params: {
          serverId: server.id,
          host: server.host || "127.0.0.1",
          port: server.port || 6667,
          nicknames: nicks,
          realname: server.realname || "",
          password: server.password || "",
          channels: server.channels.map(c => ({
            name: c.name,
            password: c.key || null
          })),
          useTls: server.useTls || false,
          parseLegacyZncTimestamps: server.parseLegacyZncTimestamps || false,
        }
      });
      console.log(`Initiated IRC connection for server ${server.name} (${server.id}) with nicks:`, nicks);
    } catch (error) {
      console.error(`Failed to connect IRC for server ${server.name}:`, error);
      const errMsg = error instanceof Error ? error.message : String(error);
      setIrcConnected(server.id, false, errMsg);
    } finally {
      connectingRef.current.delete(server.id);
    }
  }, [currentProfile.name, setIrcConnected]);

  // Connect / Reconnect servers to IRC when server configs or list change
  useEffect(() => {
    const currentServerIds = new Set(servers.map((s) => s.id));

    // Cleanup disconnected servers
    connectedConfigsRef.current.forEach(async (_, serverId) => {
      if (!currentServerIds.has(serverId)) {
        connectedConfigsRef.current.delete(serverId);
        setIrcConnected(serverId, false);
        try {
          await invoke("disconnect_irc", { serverId });
        } catch (e) {
          console.error(`Failed to disconnect removed server ${serverId}:`, e);
        }
      }
    });

    servers.forEach(async (server) => {
      // Respect autoConnect setting on startup/config load
      if (server.autoConnect === false) return;

      const nicks = server.nicknames && server.nicknames.length > 0 
        ? server.nicknames 
        : [server.nicknames?.[0] || currentProfile.name.replace(/\s+/g, "") || "ReactUser"];

      const configHash = JSON.stringify({
        host: server.host || "127.0.0.1",
        port: server.port || 6667,
        nicks,
        realname: server.realname || "",
        password: server.password || "",
        useTls: server.useTls || false,
      });

      const prevHash = connectedConfigsRef.current.get(server.id);

      // If configuration hasn't changed, skip
      if (prevHash === configHash) return;

      // Update stored hash
      connectedConfigsRef.current.set(server.id, configHash);

      if (prevHash) {
        console.log(`Config changed for IRC server ${server.name} (${server.id}), reconnecting...`);
        try {
          await invoke("disconnect_irc", { serverId: server.id });
        } catch (e) {
          console.error(`Failed to disconnect before reconnecting:`, e);
        }
        await new Promise((res) => setTimeout(res, 400));
      }

      await attemptConnect(server);
    });
  }, [servers, attemptConnect, setIrcConnected]);

  // Track which servers have been synced
  const syncedServersRef = useRef<Set<string>>(new Set());

  // Sync active Conversations with non-empty log files on disk
  useEffect(() => {
    servers.forEach(async (server) => {
      if (syncedServersRef.current.has(server.id)) return;
      syncedServersRef.current.add(server.id);
      
      try {
        const loggedNicks = await invoke<string[]>("list_logged_conversations", {
          serverId: server.id,
        });
        useMockStore.getState().syncActiveConversationsWithDisk(server.id, loggedNicks);
      } catch (err) {
        console.error(`Failed to sync conversations with disk for ${server.name}:`, err);
        // If it fails, allow it to retry later by removing from the set
        syncedServersRef.current.delete(server.id);
      }
    });
  }, [servers]);

  // Auto-reconnect loop with exponential backoff & error throttling for disconnected servers
  useEffect(() => {
    const interval = setInterval(() => {
      const { ircConnectedServers, ircConnectionErrors, servers: currentServers } = useMockStore.getState();
      const now = Date.now();

      currentServers.forEach((server) => {
        // Skip if server auto-reconnect is disabled
        if (server.autoReconnect === false) return;

        // Skip if already connected or currently connecting
        if (ircConnectedServers[server.id] || connectingRef.current.has(server.id)) {
          attemptsRef.current.delete(server.id);
          nextReconnectTimeRef.current.delete(server.id);
          return;
        }

        // Check if server is blocked by rate-limiting
        const activeErr = ircConnectionErrors[server.id];
        if (activeErr && (activeErr.toLowerCase().includes("too many times") || activeErr.toLowerCase().includes("rate limit"))) {
          return;
        }

        // Backoff cooldown check
        const nextTime = nextReconnectTimeRef.current.get(server.id) || 0;
        if (now < nextTime) return;

        const currentAttempts = attemptsRef.current.get(server.id) || 0;
        // Exponential backoff: 15s, 30s, 60s, 120s, max 300s (5 min)
        const backoffMs = Math.min(15000 * Math.pow(2, currentAttempts), 300000);

        attemptsRef.current.set(server.id, currentAttempts + 1);
        nextReconnectTimeRef.current.set(server.id, now + backoffMs);

        console.log(`Auto-reconnecting to IRC server ${server.name} (attempt ${currentAttempts + 1}, backoff ${backoffMs / 1000}s)...`);
        attemptConnect(server);
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [attemptConnect]);

  const multilineAccumulatorRef = useRef<IrcMultilineAccumulator | null>(null);

  const processIncomingPayload = useCallback(async (payload: IrcMessagePayload) => {
    const { sender, channel } = payload;
    const rawContent = payload.content;
    const content = rawContent ? rawContent.replace(/\u0085/g, "\n") : "";
    const serverId = payload.serverId || payload.server_id;
    const isSystem = payload.isSystem ?? payload.is_system;

    if (!serverId) return;

    const activeServers = useMockStore.getState().servers;
    const targetServer = activeServers.find((s) => s.id === serverId);
    
    if (!targetServer) return;

    const isChannelMsg = channel.startsWith("#") || channel.startsWith("&");
    const msgTimestamp = payload.timestamp;
    const isDummySender = sender === "***" || sender === "System" || !sender || !sender.trim();
    const effectiveIsSystem = Boolean(isSystem || isDummySender);

    if (isDummySender && !isChannelMsg) {
      const store = useMockStore.getState();
      const targetChan = targetServer.channels.find((c) => `channel:${c.id}` === store.activeChatKey) || targetServer.channels[0];
      if (targetChan) {
        const dummyMember = {
          id: `irc-${sender || "System"}`,
          profileId: `profile-${sender || "System"}`,
          profile: {
            id: `profile-${sender || "System"}`,
            userId: `user-${sender || "System"}`,
            name: sender || "System",
            imageUrl: "",
            email: "system@irc.local",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          serverId: targetServer.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        addMessage(targetChan.id, dummyMember as any, content, null, true, msgTimestamp);
      }
      return;
    }

    if (!isChannelMsg) {
      // Private Message (PM)
      const store = useMockStore.getState();
      if (isSystem || sender === "System") {
        const targetNick = channel;
        const targetMember = store.addServerMember(targetServer.id, targetNick);
        const currentMember = getServerSelfMember(targetServer, store.currentProfile.id);

        if (targetMember && currentMember) {
          const conversationId = [currentMember.id, targetMember.id].sort().join("-");
          const systemMember = {
            id: "system",
            profileId: "system",
            profile: {
              id: "system",
              userId: "system",
              name: "System",
              imageUrl: "",
              email: "system@irc.local",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            serverId: targetServer.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          const lowerContent = content.toLowerCase();
          const isSendError =
            lowerContent.includes("cannot send message") ||
            lowerContent.startsWith("error:") ||
            lowerContent.includes("no such nick") ||
            lowerContent.includes("cannot send to user") ||
            lowerContent.includes("user not online");

          if (isSendError) {
            const restoredContent = store.removeLastDirectMessageFromMember(
              conversationId,
              currentMember.id
            );
            if (restoredContent) {
              useDraftStore.getState().setDraft(conversationId, {
                content: restoredContent,
                attachedImages: [],
              });
              window.dispatchEvent(
                new CustomEvent("restore_unsent_message", {
                  detail: { id: conversationId, content: restoredContent },
                })
              );
            }

            invoke("delete_last_log_entry", {
              serverId: targetServer.id,
              target: targetNick,
              sender: currentMember.profile.name,
            })
              .then(() => {
                invoke<string[]>("list_logged_conversations", {
                  serverId: targetServer.id,
                })
                  .then((loggedNicks) => {
                    store.syncActiveConversationsWithDisk(targetServer.id, loggedNicks);
                  })
                  .catch(console.error);
              })
              .catch(console.error);
          }

          store.addDirectMessage(conversationId, systemMember as any, content, null, true, msgTimestamp);
          store.openConversation(targetServer.id, targetMember.id);
          if (!isSendError) {
            store.addToHistoricalConversations(targetServer.id, targetMember.id);
          }
        }
        return;
      }

      const currentMember = getServerSelfMember(targetServer, store.currentProfile.id);
      const isSelf =
        (targetServer.nicknames && targetServer.nicknames.some((n) => n.toLowerCase() === sender.toLowerCase())) ||
        (currentMember?.profile?.name && currentMember.profile.name.toLowerCase() === sender.toLowerCase());

      const otherNick = isSelf ? channel : sender;
      let otherMember = store.addServerMember(targetServer.id, otherNick);

      if (otherMember && currentMember) {
        const conversationId = [currentMember.id, otherMember.id].sort().join("-");
        const authorMember = isSelf ? currentMember : otherMember;

        store.addDirectMessage(conversationId, authorMember, content, null, false, msgTimestamp);
        store.openConversation(targetServer.id, otherMember.id);
        store.addToHistoricalConversations(targetServer.id, otherMember.id);

        if (!isSelf) {
          const activeKey = store.activeChatKey;
          const isCurrentChat =
            activeKey === `conversation:${targetServer.id}:${otherMember.id}` ||
            activeKey === `conversation:${targetServer.id}:${conversationId}` ||
            activeKey === `conversation:${otherMember.id}` ||
            activeKey === `conversation:${conversationId}`;
          let isWindowFocused = typeof document !== "undefined" && document.hasFocus();
          
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const appWindow = getCurrentWindow();
            isWindowFocused = await appWindow.isFocused();
          } catch (e) {
            // Fallback to document.hasFocus()
          }

          if (!isCurrentChat || !isWindowFocused) {
            store.markUnread(`conversation:${targetServer.id}:${conversationId}`, true);
          }

          if (!isCurrentChat || !isWindowFocused) {
            const globalNotif = store.notificationSettings;
            const serverNotif = targetServer.notificationSettings;
            const conversationNotif = store.conversationNotificationSettings[conversationId];

            const effectiveSettings = resolveEffectiveNotificationSettings(
              globalNotif,
              serverNotif,
              conversationNotif,
              true
            );

            if (effectiveSettings.shouldNotify()) {
              triggerIncomingNotification({
                title: `${sender} (Private Message)`,
                body: content,
                sender,
                tag: `dm:${targetServer.id}:${otherMember.id}`,
                effectiveSettings,
              });
            }
          }
        }
      }
      return;
    }

    const cleanName = channel.replace(/^#/, "").toLowerCase();
    const targetChannel = targetServer.channels.find(
      (c) => c.name.toLowerCase() === cleanName
    );

    if (isSystem || sender === "System") {
      const lowerContent = content.toLowerCase();
      const isSendError =
        lowerContent.includes("cannot send") ||
        lowerContent.startsWith("error:") ||
        lowerContent.includes("permission denied") ||
        lowerContent.includes("banned");

      if (isSendError && targetChannel) {
        const store = useMockStore.getState();
        const currentMember = targetServer.members.find(
          (m) => m.profileId === store.currentProfile.id
        ) || targetServer.members[0];

        if (currentMember) {
          const restoredContent = store.removeLastMessageFromChannel(
            targetChannel.id,
            currentMember.id
          );
          if (restoredContent) {
            useDraftStore.getState().setDraft(targetChannel.id, {
              content: restoredContent,
              attachedImages: [],
            });
            window.dispatchEvent(
              new CustomEvent("restore_unsent_message", {
                detail: { id: targetChannel.id, content: restoredContent },
              })
            );
          }
          invoke("delete_last_log_entry", {
            serverId: targetServer.id,
            target: targetChannel.name.startsWith("#") ? targetChannel.name : `#${targetChannel.name}`,
            sender: currentMember.profile.name,
          }).catch(console.error);
        }
      }
    }

    const mockMember = {
      id: `irc-${sender}`,
      profileId: `profile-${sender}`,
      profile: {
        id: `profile-${sender}`,
        userId: `user-${sender}`,
        name: sender,
        imageUrl: "",
        email: `${sender}@irc.local`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      serverId: targetServer.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (targetChannel) {
      addMessage(targetChannel.id, mockMember as any, content, null, effectiveIsSystem, msgTimestamp);
    } else if (targetServer.channels.length > 0) {
      addMessage(targetServer.channels[0].id, mockMember as any, content, null, effectiveIsSystem, msgTimestamp);
    }

    // Trigger notification for channel message
    const store = useMockStore.getState();
    const isSelf =
      sender.toLowerCase() === store.currentProfile.name.toLowerCase() ||
      (targetServer.nicknames && targetServer.nicknames.some((n) => n.toLowerCase() === sender.toLowerCase())) ||
      targetServer.members.some(
        (m) =>
          (m.profileId === store.currentProfile.id || m.profile?.id === store.currentProfile.id) &&
          m.profile?.name?.toLowerCase() === sender.toLowerCase()
      );

    if (!isSystem && sender !== "System" && !isSelf) {
      const activeKey = store.activeChatKey;
      const isCurrentChat = targetChannel && activeKey === `channel:${targetChannel.id}`;
      let isWindowFocused = typeof document !== "undefined" && document.hasFocus();
      
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        isWindowFocused = await appWindow.isFocused();
      } catch (e) {
        // Fallback to document.hasFocus()
      }

      const ourNick = targetServer.nicknames?.[0] || store.currentProfile.name;
      const escapedNick = ourNick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hasMention = new RegExp(`\\b${escapedNick}\\b`, "i").test(content);

      if (!isCurrentChat || !isWindowFocused) {
        if (targetChannel?.id) {
          store.markUnread(`channel:${targetChannel.id}`, hasMention);
        }
      }

      if (!isCurrentChat || !isWindowFocused) {
        const globalNotif = store.notificationSettings;
        const serverNotif = targetServer.notificationSettings;
        const channelNotif = targetChannel?.notificationSettings;

        const effectiveSettings = resolveEffectiveNotificationSettings(
          globalNotif,
          serverNotif,
          channelNotif,
          false
        );

        if (effectiveSettings.shouldNotify(hasMention)) {
          triggerIncomingNotification({
            title: `${sender} (${targetChannel?.name || channel})`,
            body: content,
            sender,
            tag: `chan:${targetServer.id}:${targetChannel?.id || channel}`,
            effectiveSettings,
          });
        }
      }
    }
  }, [addMessage]);

  if (!multilineAccumulatorRef.current) {
    multilineAccumulatorRef.current = new IrcMultilineAccumulator((sId, target, senderNick, lines, isValid) => {
      if (isValid) {
        processIncomingPayload({
          serverId: sId,
          channel: target,
          sender: senderNick,
          content: lines.join("\n"),
          isSystem: false,
        });
      } else {
        for (const line of lines) {
          processIncomingPayload({
            serverId: sId,
            channel: target,
            sender: senderNick,
            content: line,
            isSystem: false,
          });
        }
      }
    });
  }

  // Listen for incoming messages across all connected IRC servers
  useEffect(() => {
    let isCancelled = false;
    let unlistenFn: (() => void) | null = null;

    const setupListener = async () => {
      try {
        const unlisten = await listen<IrcMessagePayload>("irc_message", async (event) => {
          processIncomingPayload(event.payload);
        });

        if (isCancelled) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      } catch (error) {
        console.error("Failed to setup IRC listener:", error);
      }
    };

    setupListener();

    let unlistenUsersFn: (() => void) | null = null;
    const setupUsersListener = async () => {
      try {
        const unlistenUsers = await listen<IrcUserEventPayload>("irc_user_event", (event) => {
          const { server_id, channel, users, event_type } = event.payload;
          setTimeout(() => {
            updateChannelMembers(server_id, channel, users, event_type as any);
          }, 100);

          if (event_type === "JOIN") {
            const store = useMockStore.getState();
            const pending = store.pendingJoin;
            const cleanChan = channel.replace(/^#/, "");

            if (
              pending &&
              pending.serverId === server_id &&
              pending.channelName.toLowerCase() === cleanChan.toLowerCase()
            ) {
              const activeServer = store.servers.find(s => s.id === server_id);
              const existing = activeServer?.channels.find(c => c.name.toLowerCase() === cleanChan.toLowerCase());
              
              if (!existing) {
                const newChan = store.addChannel(server_id, cleanChan, ChannelType.TEXT);
                if (pending.password) {
                  store.updateChannelKey(server_id, newChan.id, pending.password);
                }
                store.setPendingJoin(null, null);
                if (newChan?.id) {
                  navigate(`/servers/${server_id}/channels/${newChan.id}`);
                }
              } else {
                if (pending.password) {
                  store.updateChannelKey(server_id, existing.id, pending.password);
                }
                store.setPendingJoin(null, null);
                navigate(`/servers/${server_id}/channels/${existing.id}`);
              }
            }
          }
        });

        if (isCancelled) {
          unlistenUsers();
        } else {
          unlistenUsersFn = unlistenUsers;
        }
      } catch (error) {
        console.error("Failed to setup IRC users listener:", error);
      }
    };

    setupUsersListener();

    let unlistenHostFn: (() => void) | null = null;
    const setupHostListener = async () => {
      try {
        const unlistenHost = await listen<IrcUserHostEventPayload>("irc_user_host_event", (event) => {
          const { server_id, nick, host, realname } = event.payload;
          if (server_id && nick && host) {
            useMockStore.getState().addServerMember(server_id, nick, realname, host);
          }
        });

        if (isCancelled) {
          unlistenHost();
        } else {
          unlistenHostFn = unlistenHost;
        }
      } catch (error) {
        console.error("Failed to setup IRC host listener:", error);
      }
    };

    setupHostListener();

    let unlistenStatusFn: (() => void) | null = null;
    const setupStatusListener = async () => {
      try {
        const unlistenStatus = await listen<{ server_id: string; connected: boolean; error?: string }>(
          "irc_status",
          (event) => {
            const { server_id, connected, error } = event.payload;
            setIrcConnected(server_id, connected, error || null);
            if (connected) {
              attemptsRef.current.delete(server_id);
              nextReconnectTimeRef.current.delete(server_id);
            } else {
              connectedConfigsRef.current.delete(server_id);
            }
          }
        );

        if (isCancelled) {
          unlistenStatus();
        } else {
          unlistenStatusFn = unlistenStatus;
        }
      } catch (error) {
        console.error("Failed to setup IRC status listener:", error);
      }
    };

    setupStatusListener();

    let unlistenWelcomeNickFn: (() => void) | null = null;
    const setupWelcomeNickListener = async () => {
      try {
        const unlistenWelcomeNick = await listen<{ server_id: string; welcome_nick: string }>(
          "irc_welcome_nick",
          (event) => {
            const { server_id, welcome_nick } = event.payload;
            if (server_id && welcome_nick) {
              useMockStore.getState().setServerActiveNick(server_id, welcome_nick);
            }
          }
        );

        if (isCancelled) {
          unlistenWelcomeNick();
        } else {
          unlistenWelcomeNickFn = unlistenWelcomeNick;
        }
      } catch (error) {
        console.error("Failed to setup IRC welcome nick listener:", error);
      }
    };

    setupWelcomeNickListener();

    let unlistenNickChangeFn: (() => void) | null = null;
    const setupNickChangeListener = async () => {
      try {
        const unlistenNickChange = await listen<{ server_id: string; old_nick: string; new_nick: string }>(
          "irc_nick_change",
          (event) => {
            const { server_id, old_nick, new_nick } = event.payload;
            if (server_id && old_nick && new_nick) {
              useMockStore.getState().handleNickChange(server_id, old_nick, new_nick);
            }
          }
        );

        if (isCancelled) {
          unlistenNickChange();
        } else {
          unlistenNickChangeFn = unlistenNickChange;
        }
      } catch (error) {
        console.error("Failed to setup IRC nick change listener:", error);
      }
    };

    setupNickChangeListener();

    let unlistenTopicFn: (() => void) | null = null;
    const setupTopicListener = async () => {
      try {
        const unlistenTopic = await listen<{ server_id: string; channel: string; topic: string }>(
          "irc_topic_event",
          (event) => {
            const { server_id, channel, topic } = event.payload;
            useMockStore.getState().updateChannelTopicByName(server_id, channel, topic);
          }
        );

        if (isCancelled) {
          unlistenTopic();
        } else {
          unlistenTopicFn = unlistenTopic;
        }
      } catch (error) {
        console.error("Failed to setup IRC topic listener:", error);
      }
    };

    setupTopicListener();

    let unlistenOpsFn: (() => void) | null = null;
    const setupOpsListener = async () => {
      try {
        const unlistenOps = await listen<{ server_id: string; channel: string; ops: string[] }>(
          "irc_ops_event",
          (event) => {
            const { server_id, channel, ops } = event.payload;
            useMockStore.getState().updateChannelOps(server_id, channel, ops);
          }
        );

        if (isCancelled) {
          unlistenOps();
        } else {
          unlistenOpsFn = unlistenOps;
        }
      } catch (error) {
        console.error("Failed to setup IRC ops listener:", error);
      }
    };

    setupOpsListener();

    let unlistenTopicErrorFn: (() => void) | null = null;
    const setupTopicErrorListener = async () => {
      try {
        const unlistenTopicError = await listen<{ server_id: string; channel: string; error: string }>(
          "irc_topic_error",
          (event) => {
            const { server_id, channel, error } = event.payload;
            const chanName = channel ? `#${channel.replace(/^#/, "")}` : "this channel";

            if (server_id && channel) {
              invoke("refresh_channel_names", { serverId: server_id, channel }).catch(() => {});
            }

            useModalStore.getState().onOpen("ircError", {
              title: "Permission Denied",
              description: `Cannot perform operation on ${chanName}: ${error || "You do not have channel operator (@) permissions."}`,
            });
          }
        );

        if (isCancelled) {
          unlistenTopicError();
        } else {
          unlistenTopicErrorFn = unlistenTopicError;
        }
      } catch (error) {
        console.error("Failed to setup IRC topic error listener:", error);
      }
    };

    setupTopicErrorListener();

    let unlistenBadKeyFn: (() => void) | null = null;
    const setupBadKeyListener = async () => {
      try {
        const unlistenBadKey = await listen<{ server_id: string; channel: string; error: string }>(
          "irc_bad_channel_key",
          (event) => {
            const { server_id, channel, error } = event.payload;
            const cleanChan = channel.replace(/^#/, "");

            // We purposefully do NOT delete the channel here, because if they had it
            // in their sidebar, we don't want to wipe their history just because the key was wrong or changed.
            
            const store = useMockStore.getState();
            const pending = store.pendingJoin;
            let isWrongPassword = false;
            if (pending && pending.serverId === server_id && pending.channelName.toLowerCase() === cleanChan.toLowerCase()) {
              isWrongPassword = !!pending.password;
              store.setPendingJoin(null, null);
            }

            useModalStore.getState().onOpen("joinChannelPassword", {
              serverId: server_id,
              channelName: cleanChan,
              errorMessage: isWrongPassword ? "Incorrect password." : (error || "Cannot join channel (+k): Password required."),
            });
          }
        );

        if (isCancelled) {
          unlistenBadKey();
        } else {
          unlistenBadKeyFn = unlistenBadKey;
        }
      } catch (error) {
        console.error("Failed to setup IRC bad channel key listener:", error);
      }
    };

    setupBadKeyListener();

    let unlistenInviteOnlyFn: (() => void) | null = null;
    const setupInviteOnlyListener = async () => {
      try {
        const unlistenInviteOnly = await listen<{ server_id: string; channel: string; error: string }>(
          "irc_invite_only",
          (event) => {
            const { server_id, channel, error } = event.payload;
            const cleanChan = channel.replace(/^#/, "");
            const formattedChan = channel.startsWith("#") || channel.startsWith("&") ? channel : `#${channel}`;

            const store = useMockStore.getState();
            store.setChannelTemporary(server_id, cleanChan, true);

            const pending = store.pendingJoin;
            if (
              pending &&
              pending.serverId === server_id &&
              pending.channelName.toLowerCase() === cleanChan.toLowerCase()
            ) {
              store.setPendingJoin(null, null);
            }

            useModalStore.getState().onOpen("ircError", {
              title: "Cannot join channel",
              description: `Cannot join ${formattedChan}: ${error || "Cannot join channel (+i)"}.`,
            });
          }
        );

        if (isCancelled) {
          unlistenInviteOnly();
        } else {
          unlistenInviteOnlyFn = unlistenInviteOnly;
        }
      } catch (error) {
        console.error("Failed to setup IRC invite-only listener:", error);
      }
    };

    let unlistenInvitedFn: (() => void) | null = null;
    const setupInvitedListener = async () => {
      try {
        const unlistenInvited = await listen<{ server_id: string; channel: string; inviter: string }>(
          "irc_invited",
          (event) => {
            const { server_id, channel, inviter } = event.payload;
            useMockStore.getState().addPendingInvite(server_id, channel, inviter);
          }
        );

        if (isCancelled) {
          unlistenInvited();
        } else {
          unlistenInvitedFn = unlistenInvited;
        }
      } catch (error) {
        console.error("Failed to setup IRC invited listener:", error);
      }
    };

    setupInvitedListener();

    let unlistenModeFn: (() => void) | null = null;
    const setupModeListener = async () => {
      try {
        const unlistenMode = await listen<{ server_id: string; channel: string; modes: string; set_by?: string; is_full_listing?: boolean }>(
          "irc_mode_event",
          (event) => {
            const { server_id, channel, modes, is_full_listing } = event.payload;
            useMockStore.getState().updateChannelModes(server_id, channel, modes, is_full_listing);
          }
        );

        if (isCancelled) {
          unlistenMode();
        } else {
          unlistenModeFn = unlistenMode;
        }
      } catch (error) {
        console.error("Failed to setup IRC mode listener:", error);
      }
    };

    setupModeListener();

    let unlistenModeErrorFn: (() => void) | null = null;
    const setupModeErrorListener = async () => {
      try {
        const unlistenModeError = await listen<{ server_id: string; channel: string; error: string }>(
          "irc_mode_error",
          (event) => {
            const { server_id, channel, error } = event.payload;
            const chanName = channel ? (channel.startsWith("#") || channel.startsWith("&") ? channel : `#${channel}`) : "this channel";

            if (server_id && channel) {
              const chanTarget = channel.startsWith("#") || channel.startsWith("&") ? channel : `#${channel}`;
              invoke("send_mode", {
                serverId: server_id,
                target: chanTarget,
                mode: null,
                params: null,
              }).catch(() => {});
            }

            const extractedFlag = extractFlag(error);
            useModalStore.getState().onOpen("ircError", {
              title: "Channel mode error",
              description: `Cannot set mode on ${chanName}: ${error || "Server does not support this mode flag or permission was denied."}`,
              flag: extractedFlag || undefined,
            });
          }
        );

        if (isCancelled) {
          unlistenModeError();
        } else {
          unlistenModeErrorFn = unlistenModeError;
        }
      } catch (error) {
        console.error("Failed to setup IRC mode error listener:", error);
      }
    };

    setupModeErrorListener();

    let unlistenMotdFn: (() => void) | null = null;
    const setupMotdListener = async () => {
      try {
        const unlistenMotd = await listen<{ server_id: string; motd: string[] }>(
          "irc_motd_event",
          (event) => {
            const { server_id, motd } = event.payload;
            const store = useMockStore.getState();
            store.setServerMotd(server_id, motd);
          }
        );

        if (isCancelled) {
          unlistenMotd();
        } else {
          unlistenMotdFn = unlistenMotd;
        }
      } catch (error) {
        console.error("Failed to setup IRC MOTD listener:", error);
      }
    };

    setupMotdListener();

    let unlistenAwayFn: (() => void) | null = null;
    const setupAwayListener = async () => {
      try {
        const unlistenAway = await listen<{ server_id: string; nick: string; away: boolean; reason?: string }>(
          "irc_away_event",
          (event) => {
            const { server_id, nick, away, reason } = event.payload;
            const store = useMockStore.getState();
            store.setUserAway(server_id, nick, away, reason);

            const server = store.servers.find((s) => s.id === server_id);
            const ourNick = server ? getServerActiveNick(server) : store.currentProfile.name;
            if (nick.toLowerCase() === ourNick.toLowerCase()) {
              store.setSelfAway(server_id, away);
            }
          }
        );

        if (isCancelled) {
          unlistenAway();
        } else {
          unlistenAwayFn = unlistenAway;
        }
      } catch (error) {
        console.error("Failed to setup IRC away listener:", error);
      }
    };

    setupAwayListener();

    return () => {
      isCancelled = true;
      if (unlistenFn) unlistenFn();
      if (unlistenUsersFn) unlistenUsersFn();
      if (unlistenHostFn) unlistenHostFn();
      if (unlistenStatusFn) unlistenStatusFn();
      if (unlistenWelcomeNickFn) unlistenWelcomeNickFn();
      if (unlistenNickChangeFn) unlistenNickChangeFn();
      if (unlistenTopicFn) unlistenTopicFn();
      if (unlistenOpsFn) unlistenOpsFn();
      if (unlistenTopicErrorFn) unlistenTopicErrorFn();
      if (unlistenBadKeyFn) unlistenBadKeyFn();
      if (unlistenInviteOnlyFn) unlistenInviteOnlyFn();
      if (unlistenInvitedFn) unlistenInvitedFn();
      if (unlistenModeFn) unlistenModeFn();
      if (unlistenModeErrorFn) unlistenModeErrorFn();
      if (unlistenMotdFn) unlistenMotdFn();
      if (unlistenAwayFn) unlistenAwayFn();
    };
  }, [addMessage, addServerMember, removeServerMember, setIrcConnected]);

  return <>{children}</>;
};
