import { Channel, Member, Server } from "@/types";
import { UserAvatar } from "@/components/user-avatar";
import { UserHoverCard, getMemberDisplayName } from "@/components/user-hover-card";
import { useNavigate } from "react-router-dom";
import { useMockStore } from "@/lib/mock-store";
import { cn } from "@/lib/utils";
import { UserRoleIcon, getHighestChannelRole } from "@/components/user-role-icon";

interface ChatMembersSidebarProps {
  server: Server;
  channel?: Channel;
}

export const ChatMembersSidebar = ({
  server,
  channel
}: ChatMembersSidebarProps) => {
  const navigate = useNavigate();
  const openConversation = useMockStore((state) => state.openConversation);
  const currentProfile = useMockStore((state) => state.currentProfile);
  const channelMembersMap = useMockStore((state) => state.channelMembers);
  const channelUserModesMap = useMockStore((state) => state.channelUserModes);
  const ircConnectedServers = useMockStore((state) => state.ircConnectedServers);

  const isConnected = !!ircConnectedServers[server.id];

  // Nasz nick pochodzi zawsze z ustawień serwera (server.nicknames[0])
  // i tworzymy syntetyczny wpis na podstawie currentProfile + nicku IRC
  const ourNick = server.nicknames?.[0] || currentProfile.name;
  // Szukamy faktycznego membera pasującego do naszego nicku lub profileId
  const selfMemberFromStore = server.members.find(
    (m) =>
      m.profileId === currentProfile.id ||
      m.profile.name.toLowerCase() === ourNick.toLowerCase()
  );
  // Zawsze wyświetlamy siebie – jeśli nie ma w store (np. server jeszcze się ładuje),
  // budujemy syntetyczny wpis z naszych danych
  const selfMember: Member = selfMemberFromStore ?? {
    id: `self-${server.id}`,
    profileId: currentProfile.id,
    profile: {
      ...currentProfile,
      name: ourNick,
    },
    serverId: server.id,
  };

  // Wykluczamy siebie z listy pozostałych na podstawie nicku i profileId
  const selfNickLower = selfMember.profile.name.toLowerCase();
  const isNotSelf = (m: Member) =>
    m.profileId !== currentProfile.id &&
    m.profile.name.toLowerCase() !== selfNickLower;

  // Ustalamy listę pozostałych użytkowników do wyświetlenia:
  // jeśli channelMembers ma wpis dla tego kanału – filtrujemy, w p.p. pokazujemy wszystkich
  let otherMembers: Member[];
  if (channel) {
    const channelUserNicks = channelMembersMap[channel.id];
    if (channelUserNicks && channelUserNicks.length > 0) {
      const channelUsersSet = new Set(channelUserNicks.map((u) => u.toLowerCase()));
      otherMembers = server.members.filter(
        (m) => channelUsersSet.has(m.profile.name.toLowerCase()) && isNotSelf(m)
      );
    } else {
      otherMembers = server.members.filter(isNotSelf);
    }
  } else {
    otherMembers = server.members.filter(isNotSelf);
  }

  otherMembers = otherMembers.sort((a, b) => {
    const nameA = getMemberDisplayName(a, server);
    const nameB = getMemberDisplayName(b, server);
    return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
  });

  const totalCount = 1 + otherMembers.length;

  const onMemberClick = (memberId: string) => {
    if (selfMember?.id === memberId) return;
    openConversation(server.id, memberId);
    navigate(`/servers/${server.id}/conversations/${memberId}`);
  };

  const renderMember = (member: Member, isSelf: boolean = false) => {
    const displayName = getMemberDisplayName(member, server);
    const userModes = channel ? channelUserModesMap[channel.id]?.[member.profile.name.toLowerCase()] || [] : [];
    const highestRole = getHighestChannelRole(userModes);

    return (
      <UserHoverCard member={member} server={server} channel={channel} side="left">
        <div
          onClick={() => onMemberClick(member.id)}
          className="group px-2 py-1 flex items-center gap-x-2 w-full hover:bg-zinc-700/10 dark:hover:bg-zinc-700/50 transition cursor-pointer rounded-md"
        >
          <UserAvatar 
            src={member.profile.imageUrl}
            name={displayName}
            className="h-8 w-8 md:h-8 md:w-8"
          />
          <div className="flex flex-col overflow-hidden">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate">
              {displayName}
            </p>
          </div>
          {highestRole && (
            <UserRoleIcon role={highestRole} showTooltip={false} className="ml-auto" />
          )}
        </div>
      </UserHoverCard>
    );
  };

  return (
    <div className="h-full w-60 bg-[#F2F3F5] dark:bg-[#2B2D31] flex flex-col pt-4 px-2 overflow-y-auto overflow-x-hidden discord-scrollbar-ghost hidden md:flex shrink-0 border-l border-zinc-200 dark:border-zinc-800">
      <div className="mb-6">
        <h3 className="uppercase text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 px-2">
          Users — {totalCount}
        </h3>
        <div className={cn("space-y-[2px] transition-all duration-300", !isConnected && "grayscale opacity-60 pointer-events-none")}>
          {selfMember && (
            <>
              <div key={selfMember.id} className="pointer-events-auto">{renderMember(selfMember, true)}</div>
              <div className="my-1.5 border-b border-zinc-200 dark:border-zinc-700/60 pointer-events-none" />
            </>
          )}
          {otherMembers.map((member) => (
            <div key={member.id}>{renderMember(member, false)}</div>
          ))}
        </div>
      </div>
    </div>
  );
};

