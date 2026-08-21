import { useMemo } from "react";
import { useMockStore } from "@/lib/mock-store";

interface ChatQueryProps {
  queryKey?: string;
  paramKey: "channelId" | "conversationId";
  paramValue: string;
}

export const useChatQuery = ({
  paramKey,
  paramValue
}: ChatQueryProps) => {
  const items = useMockStore((state) =>
    paramKey === "channelId"
      ? state.messages[paramValue] || []
      : state.directMessages[paramValue] || []
  );

  const newerCursor = useMockStore((state) => state.historyWindow.newerCursor);
  const hasNewer = useMockStore((state) => state.historyWindow.hasNewer);
  const loadingNewer = useMockStore((state) => state.historyWindow.loadingNewer);

  // Memoize the return so `data.pages[0].items` keeps a STABLE reference between
  // renders (the store arrays are already reference-stable). Without this, `data`
  // is a fresh object every render, `items` in ChatMessages gets a new array each
  // time, and the virtualizer/layout effect remeasure loops or misses updates.
  return useMemo(
    () => ({
      data: {
        pages: [
          {
            items,
            nextCursor: newerCursor,
          }
        ]
      },
      fetchNextPage: () => {},
      hasNextPage: hasNewer,
      isFetchingNextPage: loadingNewer,
      status: "success" as "success" | "loading" | "error",
    }),
    [items, newerCursor, hasNewer, loadingNewer]
  );
};

