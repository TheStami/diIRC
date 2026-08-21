import { useState, useEffect, useMemo, memo } from "react";
import { Member, Profile } from "@/types";
import { Reply } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { UserAvatar } from "@/components/user-avatar";
import { UserHoverCard, getMemberDisplayName } from "@/components/user-hover-card";
import { ActionTooltip } from "@/components/action-tooltip";
import { cn } from "@/lib/utils";
import { useMockStore } from "@/lib/mock-store";
import { ChatItemAttachment } from "./chat-item-attachment";
import { LinkPreview } from "./link-preview";

import { isMediaUrl, subscribeImageCache } from "@/lib/image-utils";
import { openExternalUrl } from "@/lib/system-utils";
import { MarkdownRenderer } from "@/lib/markdown/markdown-renderer";
import { extractUrlsFromMarkdownText, stripTrailingPunct, hasMarkdownSyntax } from "@/lib/markdown/markdown-utils";

interface ChatItemProps {
  id: string;
  content: string;
  member: Member & {
    profile: Profile;
  };
  timestamp: string;
  compactTime?: string;
  fileUrl: string | null;
  deleted: boolean;
  currentMember: Member;
  channelId?: string;
  conversationId?: string;
  compact?: boolean;
  isSystem?: boolean;
  onContentSizeChange?: () => void;
}


const ChatItemInner = ({
  id,
  content,
  member,
  timestamp,
  compactTime,
  fileUrl,
  deleted,
  currentMember,
  channelId,
  conversationId,
  compact = false,
  isSystem = false,
  onContentSizeChange,
}: ChatItemProps) => {
  const params = useParams();
  const navigate = useNavigate();

  const compactMode = useMockStore((state) => state.compactMode);
  const enableLinkPreviews = useMockStore((state) => state.enableLinkPreviews);
  const enableMarkdown = useMockStore((state) => state.enableMarkdown ?? true);

  const [, setCacheTick] = useState(0);
  useEffect(() => {
    return subscribeImageCache(() => {
      setCacheTick((prev) => prev + 1);
    });
  }, []);

  const onMemberClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const activeServers = useMockStore.getState().servers;
    const serverId = params?.serverId || activeServers[0]?.id;
    if (!serverId) return;

    if (currentMember.id === member.id || currentMember.profile.name.toLowerCase() === member.profile.name.toLowerCase()) {
      return;
    }

    const server = activeServers.find((s) => s.id === serverId) || activeServers[0];
    if (!server) return;

    let targetMember = server.members.find(
      (m) => m.id === member.id || m.profile.name.toLowerCase() === member.profile.name.toLowerCase()
    );

    if (!targetMember) {
      targetMember = useMockStore.getState().addServerMember(server.id, member.profile.name);
    }

    if (!targetMember) return;

    useMockStore.getState().openConversation(server.id, targetMember.id);
    navigate(`/servers/${server.id}/conversations/${targetMember.id}`);
  };

  const urlRegex = /(https?:\/\/[^\s]+)/g;

  const renderContentWithLinks = (text: string) => {
    if (deleted) return text;
    const parts = text.split(urlRegex);
    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        if (enableLinkPreviews && isMediaUrl(part)) {
          // Hide raw media (image or video) URL text because it will be rendered as a media card below
          return null;
        }
        return (
          <button
            key={index}
            type="button"
            onClick={() => openExternalUrl(part)}
            className="text-indigo-500 dark:text-indigo-400 hover:underline break-all inline text-left p-0 bg-transparent border-none font-normal"
          >
            {part}
          </button>
        );
      }
      return part;
    });
  };

  const isAction = typeof content === "string" && /^\x01ACTION ([\s\S]*)\x01?$/i.test(content.trim());
  const actionText = isAction
    ? content.trim().replace(/^\x01ACTION /i, "").replace(/\x01$/, "").trim()
    : content;

  // Check if there is any visible text remaining after hiding image URLs
  const textToEvaluate = isAction ? actionText : content;

  // Markdown vs legacy rendering — only when markdown chars present
  const shouldUseMarkdown = enableMarkdown && !deleted && !isSystem && !isAction && hasMarkdownSyntax(textToEvaluate);

  let renderedElements: any = null;
  let hasVisibleText = false;
  let extractedUrls: string[] = [];

  if (shouldUseMarkdown) {
    // Extract URLs excluding code blocks/inline code
    const markdownUrls = enableLinkPreviews && !fileUrl ? extractUrlsFromMarkdownText(textToEvaluate) : [];
    extractedUrls = markdownUrls;
    // Determine visible text after stripping media URLs (if previews enabled)
    const trimmed = textToEvaluate.trim();
    if (trimmed.length === 0) {
      hasVisibleText = false;
    } else if (enableLinkPreviews && extractedUrls.length === 1 && trimmed === extractedUrls[0] && isMediaUrl(extractedUrls[0])) {
      // Single media URL only — hide markdown text (preview will show)
      hasVisibleText = false;
    } else if (enableLinkPreviews) {
      // Check if remaining text after removing media URLs is non-empty
      let stripped = textToEvaluate;
      extractedUrls.forEach((u) => {
        if (isMediaUrl(u)) stripped = stripped.split(u).join(" ");
      });
      // Also strip code blocks for visibility check? Keep as visible
      hasVisibleText = stripped.trim().length > 0;
      // If stripped is empty but there were non-media URLs, still visible (markdown links)
      if (!hasVisibleText && extractedUrls.some((u) => !isMediaUrl(u))) {
        hasVisibleText = true;
      }
      // If no media urls, default to true if trimmed not empty
      if (extractedUrls.length === 0) hasVisibleText = trimmed.length > 0;
    } else {
      hasVisibleText = trimmed.length > 0;
    }
    // For markdown we don't need renderedElements array, but keep flag
    renderedElements = hasVisibleText ? true : null;
  } else {
    renderedElements = renderContentWithLinks(textToEvaluate);
    hasVisibleText = Array.isArray(renderedElements)
      ? renderedElements.some((item) => item !== null && typeof item === "string" ? item.trim().length > 0 : item !== null)
      : Boolean(renderedElements);
    extractedUrls = enableLinkPreviews && !deleted && !fileUrl
      ? Array.from(new Set(textToEvaluate.match(urlRegex) || []))
      : [];
    if (extractedUrls.length > 0) {
      extractedUrls = Array.from(new Set(extractedUrls.map((u: string) => stripTrailingPunct(u))));
    }
  }

  const servers = useMockStore((state) => state.servers);
  const activeServer = servers.find((s) => s.id === params?.serverId) || servers[0];
  const displayName = getMemberDisplayName(member, activeServer);

  if (isSystem) {
    return (
      <div className="relative group flex items-center hover:bg-black/5 px-4 py-1 transition w-full">
        <div className="w-10 flex justify-center shrink-0">
          <ActionTooltip label={timestamp}>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono select-none">
              {compactTime}
            </span>
          </ActionTooltip>
        </div>
        <p className="text-sm text-zinc-500 italic ml-2">
          {content}
        </p>
      </div>
    );
  }

  return (
    <div className={cn(
      "relative group flex items-center hover:bg-black/5 px-4 transition w-full",
      compact ? "py-[2px]" : "pt-2.5 pb-[2px]"
    )}>
      <div className="group flex gap-x-2 items-start w-full">
        {!compactMode && !compact ? (
          <UserHoverCard member={member} server={activeServer} side="right">
            <div onClick={onMemberClick} className="cursor-pointer hover:drop-shadow-md transition shrink-0">
              <UserAvatar src={member.profile.imageUrl} name={displayName} className="h-10 w-10 md:h-10 md:w-10" />
            </div>
          </UserHoverCard>
        ) : !compactMode && compact ? (
          <div className="w-10 h-5 flex items-center justify-center shrink-0">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 hidden group-hover:block select-none font-mono">
              {compactTime}
            </span>
          </div>
        ) : null}
        <div className="flex flex-col w-full">
          {!compact && (
            <div className="flex items-center gap-x-2">
              {!isAction && (
                <div className="flex items-center">
                  <UserHoverCard member={member} server={activeServer} side="right">
                    <p onClick={onMemberClick} className="font-semibold text-sm hover:underline cursor-pointer text-zinc-800 dark:text-zinc-100">
                      {displayName}
                    </p>
                  </UserHoverCard>
                </div>
              )}
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                {timestamp}
              </span>
            </div>
          )}

          {fileUrl && (
            <ChatItemAttachment
              fileUrl={fileUrl}
              content={content}
              onContentSizeChange={onContentSizeChange}
            />
          )}

          {!fileUrl && (
            <div className="space-y-1">
              {(hasVisibleText || deleted) && (
                isAction ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-300 italic">
                    <span className="font-bold text-indigo-500 dark:text-indigo-400 not-italic mr-1.5">*</span>
                    <UserHoverCard member={member} server={activeServer} side="right">
                      <span onClick={onMemberClick} className="font-semibold not-italic hover:underline cursor-pointer text-zinc-800 dark:text-zinc-100 mr-1.5">
                        {displayName}
                      </span>
                    </UserHoverCard>
                    <span>{renderContentWithLinks(actionText)}</span>
                  </p>
                ) : shouldUseMarkdown ? (
                  <div className={cn(
                    "text-sm text-zinc-600 dark:text-zinc-300",
                    deleted && "italic text-zinc-500 dark:text-zinc-400 text-xs mt-1"
                  )}>
                    <MarkdownRenderer content={content} onContentSizeChange={onContentSizeChange} compact={compact} />
                  </div>
                ) : (
                  <p className={cn(
                    "text-sm text-zinc-600 dark:text-zinc-300",
                    deleted && "italic text-zinc-500 dark:text-zinc-400 text-xs mt-1"
                  )}>
                    {renderContentWithLinks(content)}
                  </p>
                )
              )}
              {extractedUrls.map((url) => (
                <LinkPreview
                  key={url}
                  url={url}
                  onContentSizeChange={onContentSizeChange}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="hidden group-hover:flex items-center gap-x-2 absolute p-1 -top-2 right-5 bg-white dark:bg-zinc-800 border rounded-sm">
        <ActionTooltip label="Answer">
          <Reply
            className="cursor-pointer ml-auto w-4 h-4 text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition"
          />
        </ActionTooltip>
      </div>
    </div>
  );
};

export const ChatItem = memo(ChatItemInner, (prev, next) =>
  prev.id === next.id &&
  prev.content === next.content &&
  prev.deleted === next.deleted &&
  prev.fileUrl === next.fileUrl &&
  prev.isSystem === next.isSystem &&
  prev.compact === next.compact &&
  prev.timestamp === next.timestamp &&
  prev.compactTime === next.compactTime &&
  prev.member?.id === next.member?.id &&
  prev.currentMember?.id === next.currentMember?.id &&
  prev.onContentSizeChange === next.onContentSizeChange
);
