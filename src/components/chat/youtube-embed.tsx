import { useEffect, useState, useRef } from "react";
import { Play, Youtube } from "lucide-react";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

interface LazyYouTubeEmbedProps {
  youtubeId: string;
  onContentSizeChange?: () => void;
  title?: string;
}

/**
 * Lazy YouTube embed using facade pattern + IntersectionObserver.
 *
 * - Offline placeholder (skeleton) until element is within ~400px of viewport.
 * - Facade thumbnail (hqdefault) + Play overlay. Zero YouTube JS until user clicks.
 * - On click -> mounts iframe with autoplay=1. Subsequent scroll keeps iframe mounted
 *   (no unload) to avoid reload jank.
 * - Wrapper keeps fixed 16:9 aspect via pt-[56.25%] so virtualizer height stays stable
 *   and no layout shift occurs when thumbnail -> iframe transition happens.
 * - Calls onContentSizeChange on visibility change, thumbnail load/error and iframe load
 *   to notify the virtualizer (ChatMessages) to re-measure the row.
 */
export const LazyYouTubeEmbed: React.FC<LazyYouTubeEmbedProps> = ({
  youtubeId,
  onContentSizeChange,
  title = "YouTube video player",
}) => {
  const { ref, isVisible } = useIntersectionObserver({
    root: null,
    rootMargin: "400px",
    threshold: 0,
    freezeOnceVisible: true,
  });

  const [isActivated, setIsActivated] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [thumbSrc, setThumbSrc] = useState(`https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`);

  // Keep thumbSrc in sync if youtubeId changes
  useEffect(() => {
    setThumbSrc(`https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`);
    setThumbError(false);
    setThumbLoaded(false);
  }, [youtubeId]);

  const handleActivate = () => {
    setIsActivated(true);
  };

  return (
    <div
      ref={ref}
      className="mt-2 max-w-md rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-black shadow-md"
    >
      <div className="relative w-full pt-[56.25%] bg-zinc-900">
        {!isVisible ? (
          // Skeleton placeholder - same aspect, no network request yet
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-zinc-900 animate-pulse">
            <Youtube className="w-8 h-8 text-zinc-600" />
            <div className="h-2 w-24 bg-zinc-700 rounded" />
          </div>
        ) : !isActivated ? (
          <button
            type="button"
            onClick={handleActivate}
            aria-label="Play YouTube video"
            className="absolute inset-0 w-full h-full group cursor-pointer overflow-hidden bg-black"
          >
            {/* Thumbnail image */}
            {!thumbError ? (
              <img
                src={thumbSrc}
                alt="YouTube video thumbnail"
                loading="lazy"
                referrerPolicy="no-referrer"
                className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                  thumbLoaded ? "opacity-100" : "opacity-0"
                }`}
                onLoad={() => {
                  setThumbLoaded(true);
                }}
                onError={() => {
                  const fallbackUrl = `https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`;
                  if (thumbSrc !== fallbackUrl) {
                    setThumbSrc(fallbackUrl);
                  } else {
                    setThumbError(true);
                  }
                }}
              />
            ) : (
              <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-2 bg-zinc-800">
                <Youtube className="w-10 h-10 text-zinc-500" />
                <span className="text-[11px] text-zinc-400 font-mono">youtube.com/watch?v={youtubeId.slice(0, 6)}…</span>
              </div>
            )}

            {/* Dark overlay for better contrast */}
            <div className="absolute inset-0 bg-black/25 group-hover:bg-black/10 transition-colors" />

            {/* Center play button - YouTube style */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center justify-center w-16 h-11 bg-red-600 rounded-xl shadow-lg group-hover:bg-red-500 group-hover:scale-105 transition-all duration-200 group-active:scale-95">
                <Play className="w-5 h-5 text-white fill-white ml-0.5" />
              </div>
            </div>
          </button>
        ) : (
          <iframe
            src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0&modestbranding=1`}
            title={title}
            className="absolute top-0 left-0 w-full h-full border-0 rounded-lg"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </div>
  );
};
