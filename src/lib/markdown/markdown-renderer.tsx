import React, { useMemo, useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";
import { markdownSanitizeSchema } from "./markdown-config";
import { remarkSpoiler, remarkUnderline } from "./remark-plugins";
import { openExternalUrl } from "@/lib/system-utils";
import { cn } from "@/lib/utils";
import { isSafeHref } from "./markdown-utils";
import { isMediaUrl } from "@/lib/image-utils";
import { useMockStore } from "@/lib/mock-store";

interface MarkdownRendererProps {
  content: string;
  onContentSizeChange?: () => void;
  className?: string;
  compact?: boolean;
}

// Spoiler component — hidden until clicked
const SpoilerInline: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed((v) => !v)}
      title={revealed ? "Click to hide" : "Click to reveal spoiler"}
      className={cn(
        "rounded px-1 py-0.5 cursor-pointer select-none transition",
        revealed
          ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
          : "bg-zinc-800 dark:bg-zinc-900 text-transparent hover:text-zinc-400 dark:hover:text-zinc-500"
      )}
    >
      <span className={cn(revealed ? "opacity-100" : "opacity-0 hover:opacity-20")}>{children}</span>
    </span>
  );
};

const Underline: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <u className="underline decoration-zinc-400 dark:decoration-zinc-500 underline-offset-2">{children}</u>;
};

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  onContentSizeChange,
  className,
  compact = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const enableLinkPreviews = useMockStore((s) => s.enableLinkPreviews);

  useEffect(() => {
    if (!onContentSizeChange) return;
    const el = containerRef.current;
    if (!el) return;
    onContentSizeChange();
    const ro = new ResizeObserver(() => onContentSizeChange());
    ro.observe(el);
    return () => ro.disconnect();
  }, [content, onContentSizeChange]);

  const remarkPlugins = useMemo(() => [remarkSpoiler, remarkUnderline, remarkGfm, remarkBreaks], []);
  const rehypePlugins = useMemo(() => [[rehypeSanitize, markdownSanitizeSchema] as any], []);

  if (!content || !content.trim()) return null;

  const components: any = {
    p: ({ children }: any) => <p className="my-1 text-zinc-600 dark:text-zinc-300 leading-6">{children}</p>,
    strong: ({ children }: any) => <strong className="font-bold text-zinc-900 dark:text-zinc-100">{children}</strong>,
    em: ({ children }: any) => <em className="italic">{children}</em>,
    del: ({ children }: any) => <del className="line-through opacity-80 decoration-2">{children}</del>,
    code: ({ children, className: _className, ...props }: any) => {
      const isBlock = String(_className || "").includes("language-") || props.inline === false;
      const childStr = String(children);
      const hasNewline = childStr.includes("\n");
      if (isBlock || hasNewline) {
        return <code className={cn("font-mono text-[13px]", _className)} {...props}>{children}</code>;
      }
      return (
        <code
          className="bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[13px] font-mono border border-zinc-200 dark:border-zinc-700 text-rose-600 dark:text-rose-300"
          {...props}
        >
          {children}
        </code>
      );
    },
    pre: ({ children }: any) => (
      <pre className="bg-zinc-900 dark:bg-[#1e1f22] text-zinc-100 p-3 rounded-md overflow-x-auto my-2 border border-zinc-800 text-[13px] font-mono leading-5 whitespace-pre-wrap break-words">
        {children}
      </pre>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-3 py-1 my-2 italic bg-zinc-50 dark:bg-zinc-800/40 rounded-r text-zinc-600 dark:text-zinc-300">
        {children}
      </blockquote>
    ),
    ul: ({ children }: any) => <ul className="list-disc ml-6 my-1 space-y-0.5 marker:text-zinc-400">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal ml-6 my-1 space-y-0.5 marker:text-zinc-400">{children}</ol>,
    li: ({ children }: any) => <li className="leading-6">{children}</li>,
    h1: ({ children }: any) => <h1 className="text-xl font-bold mt-3 mb-1 text-zinc-900 dark:text-zinc-100 border-b border-zinc-200 dark:border-zinc-700 pb-1">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-lg font-bold mt-3 mb-1 text-zinc-900 dark:text-zinc-100">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-base font-bold mt-2 mb-1 text-zinc-900 dark:text-zinc-100">{children}</h3>,
    h4: ({ children }: any) => <h4 className="text-sm font-bold mt-2 mb-1 text-zinc-900 dark:text-zinc-100">{children}</h4>,
    h5: ({ children }: any) => <h5 className="text-sm font-semibold mt-2 mb-1 text-zinc-800 dark:text-zinc-200">{children}</h5>,
    h6: ({ children }: any) => <h6 className="text-xs font-semibold uppercase tracking-wide mt-2 mb-1 text-zinc-600 dark:text-zinc-400">{children}</h6>,
    a: ({ href, children }: any) => {
      const safe = href ? isSafeHref(href) : false;
      if (!safe || !href) {
        return <span className="text-zinc-600 dark:text-zinc-300">{children}</span>;
      }
      if (enableLinkPreviews && isMediaUrl(href)) {
        return null;
      }
      return (
        <button
          type="button"
          onClick={() => openExternalUrl(href)}
          className="text-indigo-500 dark:text-indigo-400 hover:underline break-all inline text-left p-0 bg-transparent border-none font-normal"
          title={href}
        >
          {children}
        </button>
      );
    },
    hr: () => <hr className="my-2 border-zinc-200 dark:border-zinc-700" />,
    img: ({ src, alt }: any) => {
      if (!src || !isSafeHref(src)) return null;
      return (
        <img
          src={src}
          alt={alt || "image"}
          loading="lazy"
          className="max-w-full h-auto rounded-md border border-zinc-200 dark:border-zinc-700 my-2"
          onLoad={onContentSizeChange}
          onError={onContentSizeChange}
        />
      );
    },
    spoiler: ({ children }: any) => <SpoilerInline>{children}</SpoilerInline>,
    underline: ({ children }: any) => <Underline>{children}</Underline>,
    u: ({ children }: any) => <Underline>{children}</Underline>,
    input: (props: any) => {
      if (props.type === "checkbox") {
        return <input type="checkbox" checked={!!props.checked} disabled className="mr-2 align-middle" {...props} />;
      }
      return <input {...props} />;
    },
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "markdown-root text-sm leading-6 break-words",
        compact ? "space-y-0" : "space-y-1",
        className
      )}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
