const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".ico",
  ".tiff",
  ".avif",
];

const VIDEO_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mov",
  ".ogg",
  ".m4v",
  ".mkv",
];

const KNOWN_IMAGE_HOSTS = [
  "images.unsplash.com",
  "i.imgur.com",
  "imgur.com",
  "litter.catbox.moe",
  "files.catbox.moe",
  "postimg.cc",
  "i.postimg.cc",
  "i.ibb.co",
  "ibb.co",
  "cdn.discordapp.com",
  "media.discordapp.net",
  "prnt.sc",
  "gyazo.com",
  "media.tenor.com",
  "i.giphy.com",
];

// Bounded reactive cache for dynamically verified image and video URLs (LRU, prevents unbounded RAM)
const MAX_VERIFIED_IMAGES = 200;
const MAX_VERIFIED_VIDEOS = 100;
const MAX_UNVERIFIED = 300;
const MAX_CONCURRENT_CHECKS = 4;

const verifiedImageUrlsCache = new Set<string>();
const verifiedVideoUrlsCache = new Set<string>();
const unverifiedUrlsCache = new Set<string>();

// Coalesce concurrent checks for same URL
const pendingChecks = new Map<string, Promise<"image" | "video" | null>>();
let activeChecks = 0;
const checkQueue: Array<() => void> = [];

function addWithLimit(set: Set<string>, url: string, limit: number) {
  if (set.has(url)) {
    set.delete(url);
    set.add(url);
    return;
  }
  if (set.size >= limit) {
    const first = set.values().next().value as string | undefined;
    if (first !== undefined) set.delete(first);
  }
  set.add(url);
}

export function clearImageCaches() {
  verifiedImageUrlsCache.clear();
  verifiedVideoUrlsCache.clear();
  unverifiedUrlsCache.clear();
  pendingChecks.clear();
}

type MediaCacheListener = () => void;
const listeners = new Set<MediaCacheListener>();

export function subscribeImageCache(listener: MediaCacheListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function runNextQueued() {
  if (activeChecks >= MAX_CONCURRENT_CHECKS) return;
  const next = checkQueue.shift();
  if (next) {
    activeChecks++;
    next();
  }
}

/**
 * Synchronously checks if a URL points to an image file or has been verified as image.
 */
export function isImageUrl(url: string): boolean {
  if (!url) return false;

  if (verifiedImageUrlsCache.has(url)) {
    return true;
  }
  
  // Clean URL of query parameters and hashes for extension matching
  const cleanUrl = url.split("?")[0].split("#")[0].toLowerCase();

  // Check extension
  if (IMAGE_EXTENSIONS.some((ext) => cleanUrl.endsWith(ext))) {
    return true;
  }

  // Check known image hosting services
  const lowerUrl = url.toLowerCase();
  if (KNOWN_IMAGE_HOSTS.some((host) => lowerUrl.includes(host))) {
    return true;
  }

  // Check query parameters (e.g. ?format=jpg, ?ext=png)
  try {
    const parsedUrl = new URL(url);
    const format = parsedUrl.searchParams.get("format") || parsedUrl.searchParams.get("ext");
    if (format && IMAGE_EXTENSIONS.some((ext) => ext.slice(1) === format.toLowerCase())) {
      return true;
    }
  } catch (_) {
    // Ignore invalid URL parsing
  }

  return false;
}

/**
 * Synchronously checks if a URL points to a video file or has been verified as video.
 */
export function isVideoUrl(url: string): boolean {
  if (!url) return false;

  if (verifiedVideoUrlsCache.has(url)) {
    return true;
  }

  const cleanUrl = url.split("?")[0].split("#")[0].toLowerCase();
  if (VIDEO_EXTENSIONS.some((ext) => cleanUrl.endsWith(ext))) {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    const format = parsedUrl.searchParams.get("format") || parsedUrl.searchParams.get("ext");
    if (format && VIDEO_EXTENSIONS.some((ext) => ext.slice(1) === format.toLowerCase())) {
      return true;
    }
  } catch (_) {}

  return false;
}

/**
 * Synchronously checks if a URL points to either an image or a video file.
 */
export function isMediaUrl(url: string): boolean {
  return isImageUrl(url) || isVideoUrl(url);
}

/**
 * Asynchronously checks if a URL points to an image resource.
 */
export function checkIsImageUrlAsync(url: string): Promise<boolean> {
  return checkIsMediaUrlAsync(url).then((res) => res === "image");
}

/**
 * Asynchronously checks if a URL points to a media resource ("image" | "video" | null).
 * Caches the result and notifies subscribers if a new media URL is verified.
 */
export function checkIsMediaUrlAsync(url: string): Promise<"image" | "video" | null> {
  if (!url) return Promise.resolve(null);

  if (isImageUrl(url)) return Promise.resolve("image");
  if (isVideoUrl(url)) return Promise.resolve("video");
  if (unverifiedUrlsCache.has(url)) return Promise.resolve(null);

  const existing = pendingChecks.get(url);
  if (existing) return existing;

  const promise = new Promise<"image" | "video" | null>((resolve) => {
    const finalize = (value: "image" | "video" | null) => {
      pendingChecks.delete(url);
      activeChecks = Math.max(0, activeChecks - 1);
      runNextQueued();
      resolve(value);
    };

    const exec = () => {
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 5000) : null;

      const fetchPromise = controller
        ? fetch(url, { method: "HEAD", referrerPolicy: "no-referrer", signal: controller.signal } as RequestInit)
        : fetch(url, { method: "HEAD", referrerPolicy: "no-referrer" } as RequestInit);

      fetchPromise
        .then((res) => {
          if (timeoutId) clearTimeout(timeoutId);
          const contentType = res.headers.get("content-type");
          const isSuccessOrCached = res.ok || res.status === 304;

          if (isSuccessOrCached && contentType) {
            if (contentType.startsWith("image/")) {
              addWithLimit(verifiedImageUrlsCache, url, MAX_VERIFIED_IMAGES);
              notifyListeners();
              finalize("image");
              return;
            }
            if (contentType.startsWith("video/")) {
              addWithLimit(verifiedVideoUrlsCache, url, MAX_VERIFIED_VIDEOS);
              notifyListeners();
              finalize("video");
              return;
            }
          }
          probeWithMediaElements(url, finalize);
        })
        .catch(() => {
          if (timeoutId) clearTimeout(timeoutId);
          probeWithMediaElements(url, finalize);
        });
    };

    if (activeChecks < MAX_CONCURRENT_CHECKS) {
      activeChecks++;
      exec();
    } else {
      checkQueue.push(() => {
        activeChecks++;
        exec();
      });
    }
  });

  pendingChecks.set(url, promise);
  return promise;
}

function probeWithMediaElements(url: string, resolve: (val: "image" | "video" | null) => void) {
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  let resolved = false;
  let timeoutId: number | undefined;

  const cleanup = () => {
    img.onload = null;
    img.onerror = null;
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    img.src = "";
  };

  const handleSuccess = () => {
    if (resolved) return;
    resolved = true;
    cleanup();
    addWithLimit(verifiedImageUrlsCache, url, MAX_VERIFIED_IMAGES);
    notifyListeners();
    resolve("image");
  };

  const handleError = () => {
    if (resolved) return;
    resolved = true;
    cleanup();
    probeWithVideoElement(url, resolve);
  };

  img.onload = handleSuccess;
  img.onerror = handleError;
  img.src = url;

  // Timeout fallback to avoid hanging
  timeoutId = window.setTimeout(() => {
    if (!resolved) handleError();
  }, 4000);

  if (img.complete) {
    if (img.naturalWidth > 0) {
      handleSuccess();
    } else if (img.naturalWidth === 0 && img.src) {
      window.clearTimeout(timeoutId);
      handleError();
    }
  }
}

function probeWithVideoElement(url: string, resolve: (val: "image" | "video" | null) => void) {
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  let resolved = false;
  let timeoutId: number | undefined;

  const cleanup = () => {
    video.onloadedmetadata = null;
    video.onerror = null;
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    video.removeAttribute("src");
    video.load();
  };

  video.onloadedmetadata = () => {
    if (resolved) return;
    resolved = true;
    cleanup();
    addWithLimit(verifiedVideoUrlsCache, url, MAX_VERIFIED_VIDEOS);
    notifyListeners();
    resolve("video");
  };
  video.onerror = () => {
    if (resolved) return;
    resolved = true;
    cleanup();
    addWithLimit(unverifiedUrlsCache, url, MAX_UNVERIFIED);
    resolve(null);
  };
  video.src = url;

  timeoutId = window.setTimeout(() => {
    if (!resolved) {
      resolved = true;
      cleanup();
      addWithLimit(unverifiedUrlsCache, url, MAX_UNVERIFIED);
      resolve(null);
    }
  }, 4000);
}


