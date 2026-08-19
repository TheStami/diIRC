import { useEffect, useState } from "react";

type ChatScrollProps = {
  chatRef: React.RefObject<HTMLDivElement>;
  bottomRef: React.RefObject<HTMLDivElement>;
  shouldLoadMore: boolean;
  loadMore: () => void;
  count: number;
  chatId?: string;
};

export const useChatScroll = ({
  chatRef,
  bottomRef,
  shouldLoadMore,
  loadMore,
  count,
  chatId,
}: ChatScrollProps) => {
  const [hasInitialized, setHasInitialized] = useState(false);

  // Reset initialized state when channel/conversation ID changes
  useEffect(() => {
    setHasInitialized(false);
  }, [chatId]);

  useEffect(() => {
    const topDiv = chatRef?.current;

    const handleScroll = () => {
      const scrollTop = topDiv?.scrollTop;

      if (scrollTop === 0 && shouldLoadMore) {
        loadMore();
      }
    };

    topDiv?.addEventListener("scroll", handleScroll);

    return () => {
      topDiv?.removeEventListener("scroll", handleScroll);
    };
  }, [shouldLoadMore, loadMore, chatRef]);

  useEffect(() => {
    const bottomDiv = bottomRef?.current;
    const topDiv = chatRef.current;

    if (!topDiv && !bottomDiv) return;

    const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
      if (topDiv) {
        topDiv.scrollTop = topDiv.scrollHeight;
      }
      bottomDiv?.scrollIntoView({ behavior });
    };

    if (!hasInitialized) {
      setHasInitialized(true);
      scrollToBottom("auto");
      const timer1 = setTimeout(() => scrollToBottom("auto"), 50);
      const timer2 = setTimeout(() => scrollToBottom("auto"), 150);
      const timer3 = setTimeout(() => scrollToBottom("auto"), 300);
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    } else {
      const distanceFromBottom = topDiv
        ? topDiv.scrollHeight - topDiv.scrollTop - topDiv.clientHeight
        : 0;

      if (distanceFromBottom <= 100) {
        const timer = setTimeout(() => {
          scrollToBottom("smooth");
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [bottomRef, chatRef, count, hasInitialized, chatId]);
};
