import { Settings } from "lucide-react";

import { ScrollArea } from "@/components/ui/scroll-area";
import { ModeToggle } from "@/components/mode-toggle";
import { Separator } from "@/components/ui/separator";
import { ActionTooltip } from "@/components/action-tooltip";
import { useMockStore } from "@/lib/mock-store";
import { useModal } from "@/hooks/use-modal-store";

import { NavigationAction } from "./navigation-action";
import { NavigationItem } from "./navigation-item";

export const NavigationSidebar = () => {
  const servers = useMockStore((state) => state.servers);
  const { onOpen } = useModal();

  return (
    <div
      className="space-y-4 flex flex-col items-center h-full text-primary w-full dark:bg-[#1E1F22] bg-[#E3E5E8] py-3"
    >
      <NavigationAction />
      <Separator
        className="h-[2px] bg-zinc-300 dark:bg-zinc-700 rounded-md w-10 mx-auto"
      />
      <ScrollArea className="flex-1 w-full no-scrollbar">
        {servers.map((server) => (
          <div key={server.id} className="mb-4">
            <NavigationItem
              id={server.id}
              name={server.name}
              imageUrl={server.imageUrl}
            />
          </div>
        ))}
      </ScrollArea>
      <div className="pb-3 mt-auto flex items-center flex-col gap-y-4">
        <ModeToggle />
        <ActionTooltip side="right" align="center" label="Settings">
          <button
            onClick={() => onOpen("settings")}
            className="group flex items-center justify-center"
          >
            <div className="flex mx-3 h-[48px] w-[48px] rounded-[24px] group-hover:rounded-[16px] transition-all overflow-hidden items-center justify-center bg-background dark:bg-neutral-700 group-hover:bg-indigo-500">
              <Settings className="text-zinc-500 dark:text-zinc-400 group-hover:text-white transition" size={24} />
            </div>
          </button>
        </ActionTooltip>
      </div>
    </div>
  );
};
