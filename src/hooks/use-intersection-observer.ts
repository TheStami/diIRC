import { useEffect, useRef, useState } from "react";

interface UseIntersectionObserverOptions extends IntersectionObserverInit {
  freezeOnceVisible?: boolean;
}

/**
 * Lightweight IntersectionObserver hook for lazy-loading heavy embeds.
 * - Returns a ref to attach to the container and a boolean isVisible.
 * - Once visible, it stays visible (freezeOnceVisible=true by default) to avoid
 *   mounting/unmounting loops when scrolling back and forth.
 * - Falls back to visible=true when IntersectionObserver is unavailable
 *   (SSR, old WebView, tests).
 * - rootMargin defaults to 400px so thumbnails start loading slightly before
 *   they enter the viewport (smooth scroll experience).
 */
export function useIntersectionObserver(
  options: UseIntersectionObserverOptions = {}
): { ref: React.RefObject<HTMLDivElement>; isVisible: boolean } {
  const { root = null, rootMargin = "400px", threshold = 0, freezeOnceVisible = true } = options;

  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // No observer available (tests / older WebView) -> treat as visible
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setIsVisible(true);
      return;
    }

    // Already visible and frozen -> no need to observe again
    if (isVisible && freezeOnceVisible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (freezeOnceVisible) {
            observer.unobserve(entry.target);
          }
        } else if (!freezeOnceVisible) {
          setIsVisible(false);
        }
      },
      { root, rootMargin, threshold }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [root, rootMargin, threshold, freezeOnceVisible, isVisible]);

  return { ref, isVisible };
}
