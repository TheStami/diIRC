import React, { useState, useEffect } from "react";
import { ExternalLink, Globe } from "lucide-react";
import { useMockStore } from "@/lib/mock-store";
import { isImageUrl, isVideoUrl, checkIsMediaUrlAsync, subscribeImageCache } from "@/lib/image-utils";
import { useModal } from "@/hooks/use-modal-store";
import { ImageContextMenu } from "@/components/image-context-menu";
import { openExternalUrl } from "@/lib/system-utils";
import { SmartImage } from "@/components/chat/smart-image";
import { LazyYouTubeEmbed } from "@/components/chat/youtube-embed";

interface LinkPreviewProps {
  url: string;
  onContentSizeChange?: () => void;
}

interface OpenGraphData {
  title?: string;
  description?: string;
  image?: string;
  publisher?: string;
  logo?: string;
}

// Bounded LRU cache for OpenGraph metadata (prevents unbounded RAM growth)
const MAX_OG_CACHE = 80;
const ogCache = new Map<string, OpenGraphData | null>();

function setOgCache(url: string, data: OpenGraphData | null) {
  if (ogCache.has(url)) ogCache.delete(url);
  ogCache.set(url, data);
  if (ogCache.size > MAX_OG_CACHE) {
    const first = ogCache.keys().next().value as string | undefined;
    if (first !== undefined) ogCache.delete(first);
  }
}

function getOgCache(url: string): OpenGraphData | null | undefined {
  const v = ogCache.get(url);
  if (v !== undefined) {
    ogCache.delete(url);
    ogCache.set(url, v);
  }
  return v;
}

export function clearOgCache() {
  ogCache.clear();
}

export const LinkPreview: React.FC<LinkPreviewProps> = ({ url, onContentSizeChange }) => {
  const { onOpen } = useModal();
  const linkPreviewApiUrl = useMockStore((state) => state.linkPreviewApiUrl);
  const enableWebPagePreviews = useMockStore((state) => state.enableWebPagePreviews);

  const [ogData, setOgData] = useState<OpenGraphData | null>(getOgCache(url) ?? null);
  const [loading, setLoading] = useState<boolean>(!ogCache.has(url));
  const [error, setError] = useState<boolean>(false);
  const [dynamicIsImage, setDynamicIsImage] = useState<boolean>(isImageUrl(url));
  const [dynamicIsVideo, setDynamicIsVideo] = useState<boolean>(isVideoUrl(url));

  // Listen to global media cache updates
  useEffect(() => {
    return subscribeImageCache(() => {
      if (isImageUrl(url)) setDynamicIsImage(true);
      if (isVideoUrl(url)) setDynamicIsVideo(true);
    });
  }, [url]);

  // 1. Helper: Detect Direct Image URLs
  const isImage = (link: string) => dynamicIsImage || isImageUrl(link);

  // 2. Helper: Detect Direct Video URLs
  const isVideo = (link: string) => dynamicIsVideo || isVideoUrl(link);

  // 3. Helper: Detect YouTube URLs and extract video ID
  const getYouTubeId = (link: string): string | null => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = link.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  const youtubeId = getYouTubeId(url);
  const isDirectImage = isImage(url);
  const isDirectVideo = isVideo(url);

  // Perform async probe for extensionless image & video URLs
  useEffect(() => {
    if (isDirectImage || isDirectVideo || youtubeId) {
      return;
    }
    let isMounted = true;
    checkIsMediaUrlAsync(url).then((res) => {
      if (isMounted && res) {
        if (res === "image") setDynamicIsImage(true);
        if (res === "video") setDynamicIsVideo(true);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [url, isDirectImage, isDirectVideo, youtubeId]);

  useEffect(() => {
    // Skip external API fetch if link is direct image, video, or YouTube
    if (isDirectImage || isDirectVideo || youtubeId) {
      setLoading(false);
      return;
    }

    if (!enableWebPagePreviews) {
      setLoading(false);
      return;
    }

    if (ogCache.has(url)) {
      setOgData(getOgCache(url) ?? null);
      setLoading(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    setLoading(true);

    const fetchMetadata = async () => {
      try {
        const baseUrl = (linkPreviewApiUrl || "https://api.microlink.io").replace(/\/$/, "");
        const requestUrl = `${baseUrl}?url=${encodeURIComponent(url)}`;
        const res = await fetch(requestUrl, { signal: controller.signal });

        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const json = await res.json();
        
        // Support standard Microlink JSON response format
        let extracted: OpenGraphData | null = null;
        if (json?.data) {
          extracted = {
            title: json.data.title || undefined,
            description: json.data.description || undefined,
            image: json.data.image?.url || json.data.logo?.url || undefined,
            publisher: json.data.publisher || json.data.siteName || undefined,
            logo: json.data.logo?.url || undefined,
          };
        } else if (json?.title || json?.description || json?.image) {
          // Fallback for custom self-hosted simple OpenGraph JSON microservices
          extracted = {
            title: json.title,
            description: json.description,
            image: json.image?.url || json.image,
            publisher: json.publisher || json.site_name,
            logo: json.logo,
          };
        }

        if (isMounted) {
          setOgCache(url, extracted);
          setOgData(extracted);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          if ((err as any)?.name === "AbortError") return;
          setOgCache(url, null);
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchMetadata();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [url, linkPreviewApiUrl, isDirectImage, isDirectVideo, youtubeId]);

  // A) Render Direct Image Preview
  if (isDirectImage) {
    return (
      <div className="mt-2 w-fit max-w-md rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800/80 group relative shadow-sm">
        <ImageContextMenu url={url}>
          <button
            type="button"
            onClick={() => onOpen("imagePreview", { url })}
            className="block relative cursor-zoom-in text-left w-full h-full"
          >
            <SmartImage
              src={url}
              alt="Embedded Content"
              className="max-h-[320px] max-w-full w-auto h-auto object-contain rounded-lg transition hover:opacity-95 block"
              loading="lazy"
              onImageLoad={onContentSizeChange}
              onImageError={onContentSizeChange}
            />
          </button>
        </ImageContextMenu>
      </div>
    );
  }

  // B) Render Direct Video Preview
  if (isDirectVideo) {
    return (
      <div className="mt-2 max-w-md w-full aspect-video rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black flex items-center justify-center">
        <video
          src={url}
          controls
          className="max-h-[320px] w-full h-full object-contain rounded-lg"
          preload="metadata"
          onLoadedMetadata={onContentSizeChange}
        />
      </div>
    );
  }

  // C) Render YouTube Lazy Facade (IntersectionObserver + click-to-load)
  // Replaces eager iframe which caused scroll jank with many embeds. See youtube-embed.tsx
  if (youtubeId) {
    return <LazyYouTubeEmbed youtubeId={youtubeId} onContentSizeChange={onContentSizeChange} />;
  }

  // D) Render Skeleton Loader for Web Page Preview
  if (loading) {
    return (
      <div className="mt-2 max-w-md rounded-md bg-zinc-100 dark:bg-[#2b2d31] border-l-4 border-l-indigo-500/50 p-3 space-y-2 border border-zinc-200 dark:border-zinc-800/80 animate-pulse">
        <div className="h-3 bg-zinc-300 dark:bg-zinc-700/60 rounded w-1/4" />
        <div className="h-4 bg-zinc-300 dark:bg-zinc-700/60 rounded w-3/4" />
        <div className="h-3 bg-zinc-200 dark:bg-zinc-800 rounded w-full" />
      </div>
    );
  }

  // E) If web page previews disabled, network error, or no OpenGraph data found, do not render card
  if (!enableWebPagePreviews || error || !ogData || (!ogData.title && !ogData.description && !ogData.image)) {
    return null;
  }

  // F) Render Discord-Style Rich OpenGraph Card
  let domain = "";
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    domain = url;
  }

  return (
    <div className="mt-2 max-w-md rounded-md bg-zinc-100 dark:bg-[#2b2d31] border-l-4 border-l-indigo-500 p-3.5 flex flex-col gap-y-2 border border-zinc-200/80 dark:border-zinc-800/80 shadow-sm text-xs group transition hover:border-zinc-300 dark:hover:border-zinc-700">
      {/* Publisher / Domain Header */}
      <div className="flex items-center gap-x-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {ogData.logo ? (
          <img src={ogData.logo} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
        ) : (
          <Globe className="w-3.5 h-3.5 text-zinc-400" />
        )}
        <span>{ogData.publisher || domain}</span>
      </div>

      {/* Title */}
      {ogData.title && (
        <button
          type="button"
          onClick={() => openExternalUrl(url)}
          className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline text-sm leading-snug flex items-center gap-x-1.5 text-left"
        >
          <span>{ogData.title}</span>
          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition shrink-0" />
        </button>
      )}

      {/* Description */}
      {ogData.description && (
        <p className="text-zinc-600 dark:text-zinc-300 text-xs leading-relaxed line-clamp-3">
          {ogData.description}
        </p>
      )}

      {/* Preview Image */}
      {ogData.image && (
        <div className="mt-1 w-fit max-w-full rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700/60 max-h-[220px]">
          <ImageContextMenu url={ogData.image}>
            <button
              type="button"
              onClick={() => onOpen("imagePreview", { url: ogData.image })}
              className="block cursor-zoom-in text-left w-full h-full"
            >
              <SmartImage
                src={ogData.image}
                alt={ogData.title || "Link preview image"}
                className="w-full h-full max-h-[220px] object-contain transition hover:scale-[1.01] block"
                loading="lazy"
                onImageLoad={onContentSizeChange}
                onImageError={onContentSizeChange}
              />
            </button>
          </ImageContextMenu>
        </div>
      )}
    </div>
  );
};
