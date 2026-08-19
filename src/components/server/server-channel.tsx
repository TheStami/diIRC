import { 
  Channel, 
  ChannelType, 
  Server
} from "@/types";
import { Hash, X, KeyRound, Lock } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";
import { ActionTooltip } from "@/components/action-tooltip";
import { ModalType, useModal } from "@/hooks/use-modal-store";
import { useMockStore } from "@/lib/mock-store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ServerChannelProps {
  channel: Channel;
  server: Server;
}

const iconMap = {
  [ChannelType.TEXT]: Hash,
};

export const ServerChannel = ({
  channel,
  server
}: ServerChannelProps) => {
  const { onOpen } = useModal();
  const params = useParams();
  const navigate = useNavigate();

  const currentProfile = useMockStore((state) => state.currentProfile);
  const channelOpsMap = useMockStore((state) => state.channelOps);

  const ourNick = server?.nicknames?.[0] || currentProfile.name;
  const isServerOwner = server?.profileId === currentProfile.id;
  const isChannelOwner = channel?.profileId === currentProfile.id;

  const channelOps = channelOpsMap[channel.id] || [];
  const isChannelOp = channelOps.some(
    (opNick) => opNick.toLowerCase() === ourNick.toLowerCase()
  );

  const Icon = iconMap[channel.type];

  const onClick = () => {
    navigate(`/servers/${params?.serverId}/channels/${channel.id}`);
  };

  const onAction = (e: React.MouseEvent, action: ModalType) => {
    e.stopPropagation();
    onOpen(action, { channel, server });
  };

  const isSelected = params?.channelId === channel.id;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "group px-2 py-2 rounded-md flex items-center gap-x-2 w-full hover:bg-zinc-700/10 dark:hover:bg-zinc-700/50 transition mb-1",
            isSelected && "bg-zinc-700/20 dark:bg-zinc-700"
          )}
        >
          <Icon className="flex-shrink-0 w-5 h-5 text-zinc-500 dark:text-zinc-400" />
          <p className={cn(
            "line-clamp-1 font-semibold text-sm text-zinc-500 group-hover:text-zinc-600 dark:text-zinc-400 dark:group-hover:text-zinc-300 transition",
            isSelected && "text-primary dark:text-zinc-200 dark:group-hover:text-white"
          )}>
            {channel.name}
          </p>
          {channel.key && (
            <ActionTooltip label="Password protected">
              <Lock className="w-3.5 h-3.5 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
            </ActionTooltip>
          )}
          <div className="ml-auto flex items-center gap-x-2">
            <ActionTooltip label="Leave">
              <X
                onClick={(e) => onAction(e, "deleteChannel")}
                className="hidden group-hover:block w-4 h-4 text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 transition"
              />
            </ActionTooltip>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56 bg-white dark:bg-[#111214] text-zinc-900 dark:text-zinc-100 border-zinc-200 dark:border-zinc-800">
        {isChannelOp ? (
          <ContextMenuItem
            onSelect={() => setTimeout(() => onOpen("setChannelPassword", { server, channel }), 0)}
            className="cursor-pointer flex items-center gap-x-2"
          >
            <KeyRound className="w-4 h-4" />
            Set / remove password
          </ContextMenuItem>
        ) : (
          <TooltipProvider>
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <div className="w-full">
                  <ContextMenuItem disabled className="opacity-50 cursor-not-allowed flex items-center gap-x-2">
                    <KeyRound className="w-4 h-4" />
                    Set / remove password
                  </ContextMenuItem>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p className="text-xs font-medium">You must be a channel operator</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};
