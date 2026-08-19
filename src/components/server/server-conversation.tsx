import { Member, Profile, Server } from "@/types";
import { X } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { UserHoverCard, getMemberDisplayName } from "@/components/user-hover-card";
import { ActionTooltip } from "@/components/action-tooltip";
import { useMockStore } from "@/lib/mock-store";

interface ServerConversationProps {
  member: Member & { profile: Profile };
  server: Server;
}

export const ServerConversation = ({
  member,
  server,
}: ServerConversationProps) => {
  const params = useParams();
  const navigate = useNavigate();
  const closeConversation = useMockStore((state) => state.closeConversation);

  const isSelected = params?.memberId === member.id;
  const displayName = getMemberDisplayName(member, server);

  const onClick = () => {
    navigate(`/servers/${server.id}/conversations/${member.id}`);
  };

  const onClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeConversation(server.id, member.id);
    if (isSelected) {
      const defaultChannel = server.channels.find((c) => c.name === "general") || server.channels[0];
      if (defaultChannel) {
        navigate(`/servers/${server.id}/channels/${defaultChannel.id}`);
      } else {
        navigate(`/servers/${server.id}`);
      }
    }
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  const onAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      onClose(e);
    }
  };

  return (
    <button
      onClick={onClick}
      onMouseDown={onMouseDown}
      onAuxClick={onAuxClick}
      className={cn(
        "group px-2 py-2 rounded-md flex items-center gap-x-2 w-full hover:bg-zinc-700/10 dark:hover:bg-zinc-700/50 transition mb-1",
        isSelected && "bg-zinc-700/20 dark:bg-zinc-700"
      )}
    >
      <div className="flex items-center gap-x-2 overflow-hidden flex-1">
        <UserAvatar
          src={member.profile.imageUrl}
          name={displayName}
          className="h-7 w-7 md:h-7 md:w-7"
        />
        <p
          className={cn(
            "line-clamp-1 font-semibold text-sm text-zinc-500 group-hover:text-zinc-600 dark:text-zinc-400 dark:group-hover:text-zinc-300 transition text-left",
            isSelected && "text-primary dark:text-zinc-200 dark:group-hover:text-white"
          )}
        >
          {displayName}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-x-2 shrink-0">
        <ActionTooltip label="Close PM">
          <X
            onClick={onClose}
            className="hidden group-hover:block w-4 h-4 text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 transition"
          />
        </ActionTooltip>
      </div>
    </button>
  );
};
