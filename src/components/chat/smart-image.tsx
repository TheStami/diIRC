import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ImageOff, ImageIcon } from "lucide-react";

interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  className?: string;
  containerClassName?: string;
  aspectRatio?: number;
  showIconPlaceholder?: boolean;
  onImageLoad?: () => void;
  onImageError?: () => void;
}

// Bounded proxy cache to avoid duplicate base64 strings in RAM (LRU, ~25 entries)
const MAX_PROXY_CACHE = 8;
const proxyCache = new Map<string, string>();
const pendingProxy = new Map<string, Promise<string>>();

function getCachedProxy(url: string): string | undefined {
  const v = proxyCache.get(url);
  if (v !== undefined) {
    proxyCache.delete(url);
    proxyCache.set(url, v);
  }
  return v;
}

function setProxyCache(url: string, dataUrl: string) {
  if (proxyCache.has(url)) proxyCache.delete(url);
  proxyCache.set(url, dataUrl);
  if (proxyCache.size > MAX_PROXY_CACHE) {
    const first = proxyCache.keys().next().value as string | undefined;
    if (first !== undefined) proxyCache.delete(first);
  }
}

export function clearProxyCache() {
  proxyCache.clear();
  pendingProxy.clear();
}

async function fetchViaProxy(url: string): Promise<string> {
  const cached = getCachedProxy(url);
  if (cached) return cached;
  const pending = pendingProxy.get(url);
  if (pending) return pending;
  const promise = invoke<string>("fetch_image_proxy", { url }).then((dataUrl) => {
    // Guard against huge images (~8MB base64 ~ 11MB string) - skip caching if too large
    if (dataUrl.length < 3_000_000) {
      setProxyCache(url, dataUrl);
    }
    return dataUrl;
  }).finally(() => {
    pendingProxy.delete(url);
  });
  pendingProxy.set(url, promise);
  return promise;
}

const SmartImageInner: React.FC<SmartImageProps> = ({
  src,
  alt,
  className,
  containerClassName,
  aspectRatio: initialAspectRatio,
  showIconPlaceholder = true,
  onImageLoad,
  onImageError,
  style,
  ...props
}) => {
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [ratio, setRatio] = useState<number | undefined>(initialAspectRatio);
  // resolvedSrc is either the original URL or a proxied data: URL
  const [resolvedSrc, setResolvedSrc] = useState<string>(src);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Check if browser already has the image decoded (cache / 304 case)
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      if (img.naturalHeight) {
        setRatio(img.naturalWidth / img.naturalHeight);
      }
      setIsLoaded(true);
      onImageLoad?.();
    }
    // If naturalWidth === 0 while complete, wait for onError to fire
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setRatio(img.naturalWidth / img.naturalHeight);
    }
    setIsLoaded(true);
    onImageLoad?.();
  };

  const handleError = async () => {
    // If we already tried the proxy (resolvedSrc is a data: URL), give up
    if (resolvedSrc !== src) {
      setHasError(true);
      setIsLoaded(true);
      onImageError?.();
      return;
    }

    // Try fetching via Rust backend to bypass CORP / Referer restrictions (with LRU coalescing)
    try {
      const dataUrl = await fetchViaProxy(src);
      if (!mountedRef.current) return;
      setResolvedSrc(dataUrl);
    } catch {
      if (!mountedRef.current) return;
      setHasError(true);
      setIsLoaded(true);
      onImageError?.();
    }
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-zinc-100 dark:bg-zinc-800/50 rounded-lg flex items-center justify-center transition-all duration-200",
        containerClassName
      )}
      style={{
        aspectRatio: ratio ? `${ratio}` : undefined,
        minHeight: !isLoaded && !ratio ? "160px" : undefined,
        ...style,
      }}
    >
      {/* Skeleton Loading State */}
      {!isLoaded && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
          <Skeleton className="w-full h-full absolute inset-0" />
          {showIconPlaceholder && (
            <ImageIcon className="w-6 h-6 text-zinc-400 dark:text-zinc-500 animate-pulse z-20" />
          )}
        </div>
      )}

      {/* Error State Placeholder */}
      {hasError ? (
        <div className="flex flex-col items-center justify-center p-4 text-zinc-400 dark:text-zinc-500 gap-1.5 text-xs text-center w-full h-full min-h-[120px] bg-zinc-100 dark:bg-zinc-900/60 rounded-lg border border-zinc-200 dark:border-zinc-800">
          <ImageOff className="w-6 h-6 opacity-60" />
          <span>Failed to load image</span>
        </div>
      ) : (
        /* Actual Image with Fade-in Effect */
        <img
          ref={imgRef}
          src={resolvedSrc}
          alt={alt}
          onLoad={handleLoad}
          onError={handleError}
          referrerPolicy="no-referrer"
          className={cn(
            "transition-opacity duration-300 block",
            isLoaded ? "opacity-100" : "opacity-0 absolute inset-0 w-full h-full object-cover",
            className
          )}
          {...props}
        />
      )}
    </div>
  );
};

// Wrap with key=src so that React fully remounts the component when src changes.
// This avoids all state-reset race conditions.
export const SmartImage: React.FC<SmartImageProps> = (props) => (
  <SmartImageInner key={props.src} {...props} />
);
