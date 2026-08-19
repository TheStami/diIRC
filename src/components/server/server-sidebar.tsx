import { ChannelType } from "@/types";
import { Hash, User } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useMockStore } from "@/lib/mock-store";
import { getMemberDisplayName } from "@/components/user-hover-card";
import { ServerHeader } from "./server-header";
import { ServerSearch } from "./server-search";
import { ServerSection } from "./server-section";
import { ServerChannel } from "./server-channel";
import { ServerConversation } from "./server-conversation";

interface ServerSidebarProps {
  serverId: string;
}

const iconMap = {
  [ChannelType.TEXT]: <Hash className="mr-2 h-4 w-4" />,
};

export const ServerSidebar = ({
  serverId
}: ServerSidebarProps) => {
  const currentProfile = useMockStore((state) => state.currentProfile);
  const servers = useMockStore((state) => state.servers);
  const activeConversations = useMockStore((state) => state.activeConversations);

  const [splitPercent, setSplitPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const server = servers.find((s) => s.id === serverId) || servers[0];

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.height === 0) return;
      const offsetY = e.clientY - rect.top;
      const newPercent = (offsetY / rect.height) * 100;
      const clamped = Math.min(Math.max(newPercent, 20), 80);
      setSplitPercent(clamped);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
  };

  if (!server) {
    return null;
  }

  const channels = server.channels || [];
  const textChannels = channels.filter((channel) => channel.type === ChannelType.TEXT);

  const currentMember = server.members.find(
    (m) =>
      m.profileId === currentProfile?.id ||
      m.profile?.id === currentProfile?.id ||
      (server.nicknames && server.nicknames.includes(m.profile?.name)) ||
      m.id.startsWith("member-")
  );

  const otherMembers = (server.members || []).filter(
    (m) =>
      m.id !== currentMember?.id &&
      m.profileId !== currentProfile?.id &&
      m.profile?.name?.toLowerCase() !== server.nicknames?.[0]?.toLowerCase() &&
      !m.id.startsWith("self-")
  );

  const activeMemberIds = (activeConversations[server.id] || []).filter(
    (memberId) => memberId !== currentMember?.id
  );
  const pmMembers = activeMemberIds
    .map((memberId) => server.members.find((m) => m.id === memberId))
    .filter((m): m is NonNullable<typeof m> => !!m);

  return (
    <div className="flex flex-col h-full text-primary w-full dark:bg-[#2B2D31] bg-[#F2F3F5] overflow-hidden select-none">
      <ServerHeader server={server} />

      <div ref={containerRef} className="flex flex-col flex-1 overflow-hidden relative">
        {/* Top Section: Channels */}
        <div style={{ height: `${splitPercent}%` }} className="flex flex-col min-h-0">
          <ScrollArea className="flex-1 px-3">
            <div className="mt-2">
              <ServerSearch
                serverId={server.id}
                data={[
                  {
                    label: "Text channels",
                    type: "channel",
                    data: textChannels?.map((channel) => ({
                      id: channel.id,
                      name: channel.name,
                      icon: iconMap[channel.type],
                    }))
                  },
                  {
                    label: "Members",
                    type: "member",
                    data: otherMembers?.map((member) => {
                      const displayName = getMemberDisplayName(member, server);
                      const nickname = member.profile?.name;
                      const nameWithNick =
                        displayName && nickname && displayName !== nickname
                          ? `${displayName} (${nickname})`
                          : displayName || nickname || "User";

                      return {
                        id: member.id,
                        name: nameWithNick,
                        icon: <User className="mr-2 h-4 w-4" />,
                      };
                    })
                  }
                ]}
              />
            </div>
            <Separator className="bg-zinc-200 dark:bg-zinc-700 rounded-md my-2" />
            {[
              { label: "Text channels", type: ChannelType.TEXT, channels: textChannels, alwaysShow: true },
            ].map((section) => (section.alwaysShow || !!section.channels?.length) && (
              <div key={section.type} className="mb-2">
                <ServerSection
                  sectionType="channels"
                  channelType={section.type}
                  label={section.label}
                  server={server}
                />
                <div className="space-y-[2px]">
                  {section.channels.map((channel) => (
                    <ServerChannel
                      key={channel.id}
                      channel={channel}
                      server={server}
                    />
                  ))}
                </div>
              </div>
            ))}
          </ScrollArea>
        </div>

        {/* Draggable Divider Handle */}
        <div
          onMouseDown={handleDividerMouseDown}
          className="h-2 flex items-center justify-center cursor-row-resize hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50 transition group shrink-0 border-y border-zinc-200 dark:border-zinc-800/60"
          title="Drag to resize panels"
        >
          <div className="w-10 h-[3px] bg-zinc-300 dark:bg-zinc-600 group-hover:bg-indigo-500 rounded transition" />
        </div>

        {/* Bottom Section: Private Messages */}
        <div style={{ height: `${100 - splitPercent}%` }} className="flex flex-col min-h-0">
          <div className="px-3 pt-2">
            <div className="flex items-center justify-between py-1">
              <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
                Private messages ({pmMembers.length})
              </p>
            </div>
          </div>
          <ScrollArea className="flex-1 px-3">
            {pmMembers.length > 0 ? (
              <div className="space-y-[2px]">
                {pmMembers.map((member) => (
                  <ServerConversation
                    key={member.id}
                    member={member}
                    server={server}
                  />
                ))}
              </div>
            ) : (
              <div className="text-xs text-zinc-400 dark:text-zinc-500 italic px-2 py-3">
                No active private messages
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};
