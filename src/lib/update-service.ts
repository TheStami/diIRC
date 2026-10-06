import { invoke } from "@tauri-apps/api/core";
import { Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMockStore } from "@/lib/mock-store";
import tauriConfig from "../../src-tauri/tauri.conf.json";

export interface UpdateProgress {
  status: "idle" | "checking" | "backing_up" | "downloading" | "installing" | "ready" | "error";
  downloadedBytes: number;
  totalBytes: number;
  percentage: number;
  errorMessage?: string;
  isDebFallback?: boolean;
}

export type UpdateChannelId = "official" | "skipahead";
/** `default` = the channel this build was released on (see BUILD_UPDATE_CHANNEL). */
export type UpdateSourceMode = UpdateChannelId | "custom" | "default";

export interface UpdateChannel {
  id: UpdateChannelId;
  label: string;
  description: string;
  endpoint: string;
  /** Minisign public key the channel's releases are signed with. */
  pubkey: string;
  releasesUrl: string;
}

export const UPDATE_CHANNELS: Record<UpdateChannelId, UpdateChannel> = {
  official: {
    id: "official",
    label: "Official",
    description: "Stable releases from the original diIRC project.",
    endpoint: tauriConfig.plugins.updater.endpoints[0],
    pubkey: tauriConfig.plugins.updater.pubkey,
    releasesUrl: "https://github.com/TheStami/diIRC/releases/latest",
  },
  skipahead: {
    id: "skipahead",
    label: "Skipahead",
    description: "Early community builds with features not yet in the official release.",
    endpoint: "https://github.com/M455YN/diIRC/releases/latest/download/latest.json",
    pubkey:
      "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEVBNUYyMjlFOTA2Mjc3OUYKUldTZmQyS1FuaUpmNms1NDVoTUNOOGt4c3cxY0psa1VNR2ZPRyt3UWpSV2Jjb1RIR1pXdDdGSzQK",
    releasesUrl: "https://github.com/M455YN/diIRC/releases/latest",
  },
};

/** Channel this build is published on; used when the user keeps the default source. */
export const BUILD_UPDATE_CHANNEL: UpdateChannelId = "official";

export const GITHUB_RELEASES_URL = UPDATE_CHANNELS.official.releasesUrl;
/** @deprecated Prefer UPDATE_CHANNELS.official.endpoint */
export const DEFAULT_UPDATE_ENDPOINT = UPDATE_CHANNELS.official.endpoint;

/** Check if running inside Tauri context */
export const isTauriEnvironment = (): boolean => {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
};

export const resolveUpdateChannelId = (mode: UpdateSourceMode | undefined): UpdateChannelId | "custom" =>
  !mode || mode === "default" ? BUILD_UPDATE_CHANNEL : mode;

interface ResolvedUpdateSource {
  endpoint: string;
  pubkey: string | null;
  releasesUrl: string;
}

/** Endpoint + signing key for the currently selected update source. */
export const getActiveUpdateSource = (): ResolvedUpdateSource => {
  const { updateSourceMode, customUpdateUrl, customUpdatePubkey } = useMockStore.getState();
  const channelId = resolveUpdateChannelId(updateSourceMode);
  if (channelId === "custom" && customUpdateUrl?.trim()) {
    return {
      endpoint: customUpdateUrl.trim(),
      pubkey: customUpdatePubkey?.trim() || null,
      releasesUrl: GITHUB_RELEASES_URL,
    };
  }
  const channel = UPDATE_CHANNELS[channelId === "custom" ? BUILD_UPDATE_CHANNEL : channelId];
  return { endpoint: channel.endpoint, pubkey: channel.pubkey, releasesUrl: channel.releasesUrl };
};

/** @deprecated Prefer getActiveUpdateSource().endpoint */
export const getActiveUpdateEndpoint = (): string | undefined => {
  const { updateSourceMode, customUpdateUrl } = useMockStore.getState();
  if (updateSourceMode === "custom" && customUpdateUrl?.trim()) {
    return customUpdateUrl.trim();
  }
  return undefined;
};

/** Perform update check */
export const checkForAppUpdate = async (overrideEndpoint?: string): Promise<Update | null> => {
  if (!isTauriEnvironment()) {
    console.warn("Update check skipped: Not running in Tauri desktop environment.");
    return null;
  }
  try {
    const source = getActiveUpdateSource();
    const metadata = await invoke<any>("check_app_update", {
      endpoint: overrideEndpoint ?? source.endpoint,
      pubkey: source.pubkey,
      // After switching channels, offer that channel's latest build even if it is not newer.
      allowAnyVersion: useMockStore.getState().updateChannelSwitchPending,
    });
    if (!metadata) {
      return null;
    }
    return new Update(metadata);
  } catch (error) {
    console.error("Error checking for updates:", error);
    throw error;
  }
};

/** Download and install update with progress callback */
export const installAppUpdate = async (
  update: Update,
  onProgress?: (progress: UpdateProgress) => void
): Promise<void> => {
  let downloadedBytes = 0;
  let totalBytes = 0;

  try {
    // 1. Create a full app data backup before starting update
    onProgress?.({
      status: "backing_up",
      downloadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
    });

    try {
      const backupPath = await invoke<string>("create_app_backup");
      console.log("App backup successfully created at:", backupPath);
    } catch (backupErr) {
      console.error("Warning: Failed to create app backup before update:", backupErr);
    }

    // 2. Download and install update
    onProgress?.({
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
    });

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength || 0;
        onProgress?.({
          status: "downloading",
          downloadedBytes: 0,
          totalBytes,
          percentage: 0,
        });
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        const percentage = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
        onProgress?.({
          status: "downloading",
          downloadedBytes,
          totalBytes,
          percentage,
        });
      } else if (event.event === "Finished") {
        onProgress?.({
          status: "installing",
          downloadedBytes,
          totalBytes: downloadedBytes,
          percentage: 100,
        });
      }
    });

    onProgress?.({
      status: "ready",
      downloadedBytes,
      totalBytes: downloadedBytes,
      percentage: 100,
    });

    useMockStore.getState().setUpdateChannelSwitchPending(false);

    // Relaunch app to apply update
    await relaunch();
  } catch (error: any) {
    const errStr = String(error?.message || error || "");
    console.error("Failed to install update:", error);

    // Check if error is specifically related to Debian / Linux system package manager (.deb)
    const isLinuxPlatform = typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent);
    const isDebOrPermissionError =
      isLinuxPlatform &&
      (errStr.includes("Permission denied") ||
        errStr.includes("dpkg") ||
        errStr.includes("usr") ||
        errStr.includes("read-only") ||
        errStr.includes("operation not permitted") ||
        errStr.includes("deb"));

    onProgress?.({
      status: "error",
      downloadedBytes: 0,
      totalBytes: 0,
      percentage: 0,
      errorMessage: errStr || "Failed to download or install update.",
      isDebFallback: isDebOrPermissionError,
    });
    throw error;
  }
};

/** Open GitHub releases page in external browser */
export const openGitHubReleases = async (): Promise<void> => {
  const { releasesUrl } = getActiveUpdateSource();
  try {
    await openUrl(releasesUrl);
  } catch {
    window.open(releasesUrl, "_blank");
  }
};
