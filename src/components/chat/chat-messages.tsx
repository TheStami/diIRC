import { useEffect, useLayoutEffect, useRef, useCallback, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { ArrowDownToLine, Loader2, ServerCrash } from "lucide-react";
import { Member, Message } from "@/types";

import { useChatQuery } from "@/hooks/use-chat-query";
import { useChatSocket } from "@/hooks/use-chat-socket";
import { useMockStore, formatMessageDate } from "@/lib/mock-store";

import { ChatWelcome } from "./chat-welcome";
import { ChatItem } from "./chat-item";
import { clearProxyCache } from "./smart-image";

const DATE_FORMAT = "d MMM yyyy, HH:mm";
const TIME_FORMAT = "HH:mm";
const HISTORY_EDGE_TRIGGER_PX = 150;
const HISTORY_LOAD_COOLDOWN_MS = 600;

interface ChatMessagesProps {
  name: string;
  member: Member;
  chatId: string;
  serverId: string;
  paramKey: "channelId" | "conversationId";
  paramValue: string;
  type: "channel" | "conversation";
}

export const ChatMessages = ({
  name,
  member,
  chatId,
  serverId,
  paramKey,
  paramValue,
  type,
}: ChatMessagesProps) => {
  const queryKey = `chat:${chatId}`;
  const addKey = `chat:${chatId}:messages`;
  const updateKey = `chat:${chatId}:messages:update`;
  const chatRef = useRef<HTMLDivElement>(null);
  const rowElementsRef = useRef(new Map<string, HTMLDivElement>());
  const shouldStickToBottomRef = useRef(true);
  const hasInitializedRef = useRef(false);
  const isLoadingOlderRef = useRef(false);
  const isLoadingNewerRef = useRef(false);
  const lastOlderLoadTimeRef = useRef(0);
  const lastNewerLoadTimeRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const jumpingToLatestRef = useRef(false);
  const anchorRef = useRef<{
    id: string;
    screenY: number;
    scrollHeight: number;
    scrollTop: number;
    itemsCount: number;
    firstItemId?: string;
    lastItemId?: string;
    reason: string;
  } | null>(null);
  const remeasureCallbacksRef = useRef(new Map<string, () => void>());
  const layoutFrameRef = useRef<number | null>(null);
  const loadChatHistory = useMockStore((state) => state.loadChatHistory);
  const loadOlderHistory = useMockStore((state) => state.loadOlderHistory);
  const loadNewerHistory = useMockStore((state) => state.loadNewerHistory);
  const jumpToLatest = useMockStore((state) => state.jumpToLatest);
  const clearHistoryLoading = useMockStore((state) => state.clearHistoryLoading);
  const windowReady = useMockStore((state) => state.historyWindow.ready);
  const hasOlder = useMockStore((state) => state.historyWindow.hasOlder);
  const olderCursor = useMockStore((state) => state.historyWindow.olderCursor);
  const hasNewer = useMockStore((state) => state.historyWindow.hasNewer);
  const newerCursor = useMockStore((state) => state.historyWindow.newerCursor);
  const loadingOlder = useMockStore((state) => state.historyWindow.loadingOlder);
  const loadingNewer = useMockStore((state) => state.historyWindow.loadingNewer);
  const pendingLiveCount = useMockStore((state) => state.historyWindow.pendingLive.length);
  const dateFormatPreset = useMockStore((state) => state.dateFormatPreset) || "d MMM yyyy, HH:mm";
  const customDateFormat = useMockStore((state) => state.customDateFormat) || "yyyy/MM/dd HH:mm";
  const [atBottom, setAtBottom] = useState(true);
  const lastSeenBottomMessageIdRef = useRef<string | null>(null);
  const unreadAccumulatorRef = useRef<number>(0);

  const {
    data,
    status,
  } = useChatQuery({
    queryKey,
    paramKey,
    paramValue,
  });
  useChatSocket({ queryKey, addKey, updateKey });

  const items = useMemo(() => data?.pages.flatMap((page) => page.items as Message[]) || [], [data?.pages]);
  const historyTarget = type === "channel" && !name.startsWith("#") ? `#${name}` : name;
  const hasWelcome = windowReady && !hasOlder && olderCursor === null;
  const totalCount = items.length + (hasWelcome ? 1 : 0);

  useEffect(() => {
    if (atBottom && !hasNewer && items.length > 0) {
      const newId = items[items.length - 1].id;
      const prevId = lastSeenBottomMessageIdRef.current;
      if (prevId !== newId) {
        lastSeenBottomMessageIdRef.current = newId;
        unreadAccumulatorRef.current = 0;
      }
    }
  }, [items, atBottom, hasNewer, chatId]);

  const newMessagesAtTail = useMemo(() => {
    if (atBottom || !lastSeenBottomMessageIdRef.current || items.length === 0) return 0;
    const lastSeenIndex = items.findIndex((m) => m.id === lastSeenBottomMessageIdRef.current);
    if (lastSeenIndex !== -1) {
      const count = Math.max(0, items.length - 1 - lastSeenIndex);
      unreadAccumulatorRef.current = count;
      return count;
    }
    // If lastSeenId was trimmed because older chunks moved the window into the past (hasNewer === true),
    // preserve the accumulated unread messages from the tail.
    return unreadAccumulatorRef.current;
  }, [items, atBottom, chatId, pendingLiveCount]);

  const newMessagesCount = newMessagesAtTail + pendingLiveCount;
  const showJumpToLatest = (items.length > 0 && !atBottom) || hasNewer || pendingLiveCount > 0;

  const virtualizer = useVirtualizer({
    count: totalCount,
    getScrollElement: () => chatRef.current,
    getItemKey: (index) => {
      if (hasWelcome && index === 0) return "__welcome__";
      const msgIndex = hasWelcome ? index - 1 : index;
      const msg = items[msgIndex];
      return msg?.id ?? index;
    },
    estimateSize: (index) => {
      if (hasWelcome && index === 0) return 160;
      const msgIndex = hasWelcome ? index - 1 : index;
      const msg = items[msgIndex];
      if (!msg) return 48;
      if (msg.fileUrl) return 260;
      const content = msg.content || "";
      if (/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=))/i.test(content)) return 280;
      if (/(?:https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|mp4|webm|mov|ogg))/i.test(content)) return 260;
      if (/https?:\/\/[^\s]+/i.test(content)) return 140;

      const prev = items[msgIndex - 1];
      const isSameAuthor = prev && prev.member?.id === msg.member?.id;
      const isWithin5Min = prev && (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 300000);
      const isCompact = Boolean(isSameAuthor && isWithin5Min && !prev.deleted && !prev.isSystem && !msg.isSystem);

      if (content.length > 200 || content.includes("\n")) {
        const lineCount = (content.match(/\n/g) || []).length + 1;
        return isCompact ? Math.min(24 + lineCount * 20, 200) : Math.min(48 + lineCount * 20, 240);
      }
      return isCompact ? 24 : 48;
    },
    overscan: 10,
    useAnimationFrameWithResizeObserver: true,
  });

  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  const markProgrammaticScroll = useCallback((durationMs = 160) => {
    programmaticScrollUntilRef.current = Math.max(
      programmaticScrollUntilRef.current,
      performance.now() + durationMs,
    );
  }, []);

  const pinToBottom = useCallback((behavior: "auto" | "smooth" = "auto", _reason = "default") => {
    const element = chatRef.current;
    if (!element) return;
    markProgrammaticScroll(180);
    element.scrollTop = element.scrollHeight;
    virtualizer.scrollToEnd({ behavior });
  }, [markProgrammaticScroll, virtualizer]);

  const registerRowElement = useCallback((element: HTMLDivElement | null, id: string) => {
    if (element) {
      rowElementsRef.current.set(id, element);
      virtualizer.measureElement(element);
    } else {
      rowElementsRef.current.delete(id);
    }
  }, [virtualizer]);

  const captureAnchor = useCallback((reason = "manual") => {
    const element = chatRef.current;
    if (!element || shouldStickToBottomRef.current || items.length === 0) return;
    const containerRect = element.getBoundingClientRect();
    const paddingTop = parseFloat(getComputedStyle(element).paddingTop) || 0;
    let found = false;
    for (const msg of items) {
      const rowEl = rowElementsRef.current.get(msg.id);
      if (rowEl) {
        const rect = rowEl.getBoundingClientRect();
        if (rect.bottom > containerRect.top + paddingTop + 2) {
          anchorRef.current = {
            id: msg.id,
            screenY: rect.top - containerRect.top - paddingTop,
            scrollHeight: element.scrollHeight,
            scrollTop: element.scrollTop,
            itemsCount: items.length,
            firstItemId: items[0]?.id,
            lastItemId: items[items.length - 1]?.id,
            reason,
          };
          found = true;
          break;
        }
      }
    }
    if (!found && items.length > 0) {
      const firstMsg = items[0];
      anchorRef.current = {
        id: firstMsg.id,
        screenY: 0,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        itemsCount: items.length,
        firstItemId: items[0]?.id,
        lastItemId: items[items.length - 1]?.id,
        reason,
      };
    }
  }, [items]);

  const triggerLoadOlder = useCallback(() => {
    const element = chatRef.current;
    if (
      !element
      || hasOlder === false
      || olderCursor === null
      || isLoadingOlderRef.current
      || items.length === 0
    ) {
      return;
    }

    const now = performance.now();
    if (now - lastOlderLoadTimeRef.current < HISTORY_LOAD_COOLDOWN_MS) {
      return;
    }

    isLoadingOlderRef.current = true;
    lastOlderLoadTimeRef.current = now;
    captureAnchor("triggerLoadOlder");

    const fallbackTimer = setTimeout(() => {
      isLoadingOlderRef.current = false;
      lastOlderLoadTimeRef.current = performance.now();
      clearHistoryLoading();
    }, 5000);

    void loadOlderHistory(type, chatId, serverId, historyTarget).then((loaded: boolean) => {
      clearTimeout(fallbackTimer);
      isLoadingOlderRef.current = false;
      lastOlderLoadTimeRef.current = performance.now();
      if (!loaded) {
        anchorRef.current = null;
      }
    });
  }, [hasOlder, olderCursor, items.length, loadOlderHistory, clearHistoryLoading, type, chatId, serverId, historyTarget, captureAnchor]);

  const triggerLoadNewer = useCallback(() => {
    const element = chatRef.current;
    if (
      !element
      || hasNewer === false
      || newerCursor === null
      || isLoadingNewerRef.current
    ) {
      return;
    }

    const now = performance.now();
    if (now - lastNewerLoadTimeRef.current < HISTORY_LOAD_COOLDOWN_MS) {
      return;
    }

    isLoadingNewerRef.current = true;
    lastNewerLoadTimeRef.current = now;
    if (!shouldStickToBottomRef.current) {
      captureAnchor("triggerLoadNewer");
    }

    const fallbackTimer = setTimeout(() => {
      isLoadingNewerRef.current = false;
      lastNewerLoadTimeRef.current = performance.now();
      clearHistoryLoading();
    }, 5000);

    void loadNewerHistory(type, chatId, serverId, historyTarget).then((loaded: boolean) => {
      clearTimeout(fallbackTimer);
      isLoadingNewerRef.current = false;
      lastNewerLoadTimeRef.current = performance.now();
      if (!loaded) {
        anchorRef.current = null;
      }
    });
  }, [hasNewer, newerCursor, loadNewerHistory, clearHistoryLoading, type, chatId, serverId, historyTarget, captureAnchor]);

  const handleChatScroll = useCallback(() => {
    const element = chatRef.current;
    if (!element) return;

    if (jumpingToLatestRef.current) {
      shouldStickToBottomRef.current = true;
      setAtBottom(true);
      return;
    }

    const canScroll = element.scrollHeight > element.clientHeight + 5;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const isAtBottom = !hasNewer && (!canScroll || distanceFromBottom < 30);

    shouldStickToBottomRef.current = isAtBottom;
    setAtBottom((prev) => (prev === isAtBottom ? prev : isAtBottom));

    if (isAtBottom) {
      anchorRef.current = null;
      if (items.length > 0) {
        lastSeenBottomMessageIdRef.current = items[items.length - 1].id;
        unreadAccumulatorRef.current = 0;
      }
    }

    const programmaticRemaining = Math.max(0, programmaticScrollUntilRef.current - performance.now());
    const isProgrammatic = programmaticRemaining > 0;

    if (!isProgrammatic && canScroll) {
      if (element.scrollTop <= HISTORY_EDGE_TRIGGER_PX) {
        triggerLoadOlder();
      } else if (distanceFromBottom <= HISTORY_EDGE_TRIGGER_PX) {
        triggerLoadNewer();
      }
    }
  }, [triggerLoadOlder, triggerLoadNewer, items, chatId, hasNewer]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const element = chatRef.current;
    if (!element) return;

    const canScroll = element.scrollHeight > element.clientHeight + 5;
    const wasSticking = shouldStickToBottomRef.current;
    if (e.deltaY < 0 && wasSticking && canScroll) {
      shouldStickToBottomRef.current = false;
      setAtBottom(false);
      jumpingToLatestRef.current = false;
      programmaticScrollUntilRef.current = 0;
    }

    const programmaticRemaining = Math.max(0, programmaticScrollUntilRef.current - performance.now());
    const isProgrammatic = programmaticRemaining > 0;

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;

    if (!isProgrammatic && canScroll) {
      if (e.deltaY < 0 && element.scrollTop <= HISTORY_EDGE_TRIGGER_PX) {
        triggerLoadOlder();
      } else if (e.deltaY > 0 && distanceFromBottom <= HISTORY_EDGE_TRIGGER_PX) {
        triggerLoadNewer();
      }
    }
  }, [triggerLoadOlder, triggerLoadNewer, items.length, chatId]);

  useEffect(() => {
    hasInitializedRef.current = false;
    shouldStickToBottomRef.current = true;
    isLoadingOlderRef.current = false;
    isLoadingNewerRef.current = false;
    anchorRef.current = null;
    lastSeenBottomMessageIdRef.current = null;
    unreadAccumulatorRef.current = 0;
    rowElementsRef.current.clear();
    remeasureCallbacksRef.current.clear();
    setAtBottom(true);
    clearProxyCache();
    void loadChatHistory(
      type,
      chatId,
      serverId,
      historyTarget,
    );
  }, [chatId, historyTarget, loadChatHistory, serverId, type]);

  useLayoutEffect(() => {
    const element = chatRef.current;
    if (!element) return;

    const canScroll = element.scrollHeight > element.clientHeight + 5;
    if (!canScroll && !hasNewer) {
      shouldStickToBottomRef.current = true;
      setAtBottom(true);
    }

    if (shouldStickToBottomRef.current && totalCount > 0) {
      pinToBottom("auto", "useLayoutEffect (stickToBottom)");
      anchorRef.current = null;
      return;
    }

    if (!anchorRef.current) return;

    const anchor = anchorRef.current;
    const currentFirstId = items[0]?.id;
    const currentLastId = items[items.length - 1]?.id;
    const currentScrollTop = element.scrollTop;
    const currentScrollHeight = element.scrollHeight;
    const scrollHeightDelta = currentScrollHeight - anchor.scrollHeight;

    if (
      anchor.firstItemId === currentFirstId &&
      anchor.lastItemId === currentLastId &&
      anchor.itemsCount === items.length &&
      Math.abs(scrollHeightDelta) < 1
    ) {
      return;
    }

    anchorRef.current = null;

    let appliedScrollTop = currentScrollTop;

    const anchorIndex = items.findIndex((m) => m.id === anchor.id);
    if (anchorIndex !== -1) {
      const targetVirtualIndex = hasWelcome ? anchorIndex + 1 : anchorIndex;
      const targetOffsetResult = virtualizer.getOffsetForIndex(targetVirtualIndex, "start");
      const targetOffset = targetOffsetResult ? targetOffsetResult[0] : undefined;

      if (typeof targetOffset === "number" && !isNaN(targetOffset)) {
        appliedScrollTop = Math.max(0, targetOffset - anchor.screenY);
        markProgrammaticScroll(200);
        element.scrollTop = appliedScrollTop;
      } else if (scrollHeightDelta > 0) {
        appliedScrollTop = anchor.scrollTop + scrollHeightDelta;
        markProgrammaticScroll(200);
        element.scrollTop = appliedScrollTop;
      }
    } else if (scrollHeightDelta > 0) {
      appliedScrollTop = anchor.scrollTop + scrollHeightDelta;
      markProgrammaticScroll(200);
      element.scrollTop = appliedScrollTop;
    }

    const rowEl = rowElementsRef.current.get(anchor.id);
    let fineDelta: number | undefined;
    if (rowEl) {
      const containerRect = element.getBoundingClientRect();
      const paddingTop = parseFloat(getComputedStyle(element).paddingTop) || 0;
      const currentScreenY = rowEl.getBoundingClientRect().top - containerRect.top - paddingTop;
      fineDelta = currentScreenY - anchor.screenY;
      if (Math.abs(fineDelta) > 0.5) {
        markProgrammaticScroll(200);
        element.scrollTop += fineDelta;
      }
    }
  }, [items, totalCount, pinToBottom, markProgrammaticScroll, virtualizer, hasWelcome]);

  useEffect(() => {
    if (totalCount === 0) return;

    if (!hasInitializedRef.current) {
      const pinInitial = (step: string) => {
        if (chatRef.current && !hasInitializedRef.current) {
          pinToBottom("auto", `initialMountSequence (${step})`);
        }
      };

      pinInitial("immediate");
      const raf1 = requestAnimationFrame(() => pinInitial("raf1"));
      const raf2 = requestAnimationFrame(() =>
        requestAnimationFrame(() => pinInitial("raf2"))
      );
      const timer1 = setTimeout(() => pinInitial("timer60ms"), 60);
      const timer2 = setTimeout(() => pinInitial("timer180ms"), 180);
      const timer3 = setTimeout(() => {
        pinInitial("timer350ms");
        hasInitializedRef.current = true;
      }, 350);

      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
  }, [totalCount, pinToBottom]);

  useEffect(() => {
    if (totalCount === 0) return;

    const refreshLayout = (e: Event) => {
      if (!shouldStickToBottomRef.current) return;

      if (layoutFrameRef.current !== null) {
        cancelAnimationFrame(layoutFrameRef.current);
      }
      layoutFrameRef.current = requestAnimationFrame(() => {
        layoutFrameRef.current = null;
        pinToBottom("auto", `windowEvent (${e.type})`);
      });
    };

    window.addEventListener("focus", refreshLayout);
    window.addEventListener("resize", refreshLayout);
    document.addEventListener("visibilitychange", refreshLayout);

    return () => {
      window.removeEventListener("focus", refreshLayout);
      window.removeEventListener("resize", refreshLayout);
      document.removeEventListener("visibilitychange", refreshLayout);
      if (layoutFrameRef.current !== null) {
        cancelAnimationFrame(layoutFrameRef.current);
        layoutFrameRef.current = null;
      }
    };
  }, [totalCount, pinToBottom]);

  const getRemeasureCallback = useCallback((messageId: string) => {
    let cb = remeasureCallbacksRef.current.get(messageId);
    if (!cb) {
      cb = () => {
        const element = rowElementsRef.current.get(messageId);
        if (!element) return;

        if (shouldStickToBottomRef.current) {
          virtualizer.measureElement(element);
          pinToBottom("auto", `remeasure on ${messageId}`);
          return;
        }

        virtualizer.measureElement(element);
      };
      remeasureCallbacksRef.current.set(messageId, cb);
    }
    return cb;
  }, [pinToBottom, virtualizer]);

  const handleJumpToLatest = useCallback(() => {
    jumpingToLatestRef.current = true;
    programmaticScrollUntilRef.current = performance.now() + 10000;
    shouldStickToBottomRef.current = true;
    anchorRef.current = null;
    setAtBottom(true);
    if (items.length > 0) {
      lastSeenBottomMessageIdRef.current = items[items.length - 1].id;
    }
    if (hasNewer || pendingLiveCount > 0) {
      void jumpToLatest(type, chatId, serverId, historyTarget).then(() => {
        shouldStickToBottomRef.current = true;
        anchorRef.current = null;
        pinToBottom("auto", "handleJumpToLatest post-load");
        setTimeout(() => {
          jumpingToLatestRef.current = false;
          programmaticScrollUntilRef.current = 0;
        }, 500);
      });
    } else {
      pinToBottom("auto", "handleJumpToLatest direct-scroll");
      setTimeout(() => {
        jumpingToLatestRef.current = false;
        programmaticScrollUntilRef.current = 0;
      }, 500);
    }
  }, [hasNewer, pendingLiveCount, items, jumpToLatest, type, chatId, serverId, historyTarget, pinToBottom]);

  if (status === "loading") {
    return (
      <div className="flex flex-col flex-1 justify-center items-center">
        <Loader2 className="h-7 w-7 text-zinc-500 animate-spin my-4" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Loading messages...</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col flex-1 justify-center items-center">
        <ServerCrash className="h-7 w-7 text-zinc-500 my-4" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Something went wrong!</p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div
        ref={chatRef}
        onScroll={handleChatScroll}
        onWheel={handleWheel}
        className="flex-1 min-h-0 flex flex-col py-4 overflow-y-auto overflow-x-hidden discord-scrollbar-chat"
      >
        <div
          className="relative w-full shrink-0"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            if (hasWelcome && virtualRow.index === 0) {
              return (
                <div
                  key="__welcome__"
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <ChatWelcome type={type} name={name} />
                </div>
              );
            }

            const messageIndex = hasWelcome ? virtualRow.index - 1 : virtualRow.index;
            const message = items[messageIndex];
            if (!message) return null;

            const prevMessage = items[messageIndex - 1];
            const isSameAuthor = prevMessage?.member?.id === message.member?.id;
            const isWithinTimeLimit = prevMessage
              && new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() < 300000;
            const isCompact = Boolean(
              isSameAuthor
              && isWithinTimeLimit
              && !prevMessage.deleted
              && !message.fileUrl
              && !prevMessage.isSystem
              && !message.isSystem,
            );

            return (
              <div
                key={message.id}
                data-index={virtualRow.index}
                ref={(element) => registerRowElement(element, message.id)}
                className="absolute left-0 top-0 w-full flow-root"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <ChatItem
                  id={message.id}
                  currentMember={member}
                  member={message.member}
                  content={message.content}
                  fileUrl={message.fileUrl || null}
                  deleted={message.deleted}
                  timestamp={formatMessageDate(message.createdAt, dateFormatPreset, customDateFormat)}
                  compactTime={format(new Date(message.createdAt), TIME_FORMAT)}
                  channelId={paramKey === "channelId" ? paramValue : undefined}
                  conversationId={paramKey === "conversationId" ? paramValue : undefined}
                  compact={isCompact}
                  isSystem={message.isSystem}
                  onContentSizeChange={getRemeasureCallback(message.id)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {loadingOlder && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-black/70 dark:bg-black/60 text-white text-xs px-3 py-1.5 pointer-events-none">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading older...
        </div>
      )}

      {loadingNewer && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-black/70 dark:bg-black/60 text-white text-xs px-3 py-1.5 pointer-events-none">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading newer...
        </div>
      )}

      {showJumpToLatest && (
        <button
          onClick={handleJumpToLatest}
          className="absolute bottom-4 right-4 z-10 flex items-center gap-2 rounded-full bg-[#5865F2] hover:bg-[#4752C4] text-white text-xs font-semibold px-3 py-2 shadow-lg transition-all transform active:scale-95 cursor-pointer animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <ArrowDownToLine className="h-4 w-4" />
          <span>Jump to latest</span>
          {newMessagesCount > 0 && (
            <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold leading-none">
              {newMessagesCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
};
