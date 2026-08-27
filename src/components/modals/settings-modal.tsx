import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useModal } from "@/hooks/use-modal-store";
import { useMockStore } from "@/lib/mock-store";
import { ImageUploadProvider, LitterboxTime } from "@/lib/upload/types";
import {
  Settings,
  EyeOff,
  Link2,
  Server,
  Globe,
  UploadCloud,
  AlertTriangle,
  Key,
  Plus,
  Trash2,
  Activity,
  Command,
  FileText,
  LogOut,
  Calendar,
  Bell,
  Volume2,
  Play,
  Monitor,
  DownloadCloud,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Sparkles,
  MessageSquare,
  ArrowUpDown,
  ScrollText,
  ExternalLink,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { StatusDisplayMode, formatMessageDate } from "@/lib/mock-store";
import { MotdDisplayPolicy } from "@/types";
import { playNotificationSound, SoundPreset } from "@/lib/notification-sound";
import { requestDesktopNotificationPermission } from "@/lib/notification-service";
import { NotificationSettingsFields } from "@/components/notifications/notification-settings-fields";
import { checkForAppUpdate } from "@/lib/update-service";
import { Update } from "@tauri-apps/plugin-updater";
import tauriConfig from "../../../src-tauri/tauri.conf.json";

export const SettingsModal = () => {
  const { isOpen, onClose, type, onOpen } = useModal();
  const compactMode = useMockStore((state) => state.compactMode);
  const setCompactMode = useMockStore((state) => state.setCompactMode);

  const confirmLeaveChannel = useMockStore((state) => state.confirmLeaveChannel ?? true);
  const setConfirmLeaveChannel = useMockStore((state) => state.setConfirmLeaveChannel);

  const enableCommandSuggestions = useMockStore((state) => state.enableCommandSuggestions ?? true);
  const setEnableCommandSuggestions = useMockStore((state) => state.setEnableCommandSuggestions);

  const enableLinkPreviews = useMockStore((state) => state.enableLinkPreviews);
  const setEnableLinkPreviews = useMockStore((state) => state.setEnableLinkPreviews);

  const enableWebPagePreviews = useMockStore((state) => state.enableWebPagePreviews);
  const setEnableWebPagePreviews = useMockStore((state) => state.setEnableWebPagePreviews);

  const enableMarkdown = useMockStore((state) => state.enableMarkdown ?? true);
  const setEnableMarkdown = useMockStore((state) => state.setEnableMarkdown);

  const linkPreviewApiUrl = useMockStore((state) => state.linkPreviewApiUrl);
  const setLinkPreviewApiUrl = useMockStore((state) => state.setLinkPreviewApiUrl);

  const uploadConfig = useMockStore((state) => state.uploadConfig);
  const setUploadConfig = useMockStore((state) => state.setUploadConfig);

  const urlAuthRules = useMockStore((state) => state.urlAuthRules);
  const addUrlAuthRule = useMockStore((state) => state.addUrlAuthRule);
  const removeUrlAuthRule = useMockStore((state) => state.removeUrlAuthRule);

  const statusDisplayMode = useMockStore((state) => state.statusDisplayMode) || "always";
  const setStatusDisplayMode = useMockStore((state) => state.setStatusDisplayMode);

  const dateFormatPreset = useMockStore((state) => state.dateFormatPreset) || "d MMM yyyy, HH:mm";
  const setDateFormatPreset = useMockStore((state) => state.setDateFormatPreset);

  const customDateFormat = useMockStore((state) => state.customDateFormat) || "yyyy/MM/dd HH:mm";
  const setCustomDateFormat = useMockStore((state) => state.setCustomDateFormat);

  const notificationSettings = useMockStore((state) => state.notificationSettings) || {
    soundEnabled: true,
    soundPreset: "chime",
    popupEnabled: true,
    taskbarHighlightEnabled: true,
  };
  const setGlobalNotificationSettings = useMockStore((state) => state.setGlobalNotificationSettings);

  const autoUpdateMode = useMockStore((state) => state.autoUpdateMode) || "ask";
  const setAutoUpdateMode = useMockStore((state) => state.setAutoUpdateMode);

  const sortDmByUnread = useMockStore((state) => state.sortDmByUnread ?? true);
  const setSortDmByUnread = useMockStore((state) => state.setSortDmByUnread);

  const dmSortOrder = useMockStore((state) => state.dmSortOrder ?? "opening");
  const setDmSortOrder = useMockStore((state) => state.setDmSortOrder);

  const globalMotdPolicy = useMockStore((state) => state.globalMotdPolicy) || "on_change";
  const setGlobalMotdPolicy = useMockStore((state) => state.setGlobalMotdPolicy);

  const [checkStatus, setCheckStatus] = useState<"idle" | "checking" | "upToDate" | "available" | "error">("idle");
  const [foundUpdate, setFoundUpdate] = useState<Update | null>(null);
  const [checkErrorMsg, setCheckErrorMsg] = useState<string | null>(null);

  const handleManualCheckUpdates = async () => {
    setCheckStatus("checking");
    setCheckErrorMsg(null);
    try {
      const update = await checkForAppUpdate();
      if (update && update.available) {
        setFoundUpdate(update);
        setCheckStatus("available");
      } else {
        setFoundUpdate(null);
        setCheckStatus("upToDate");
      }
    } catch (err: any) {
      setFoundUpdate(null);
      setCheckStatus("error");
      setCheckErrorMsg(err?.message || String(err));
    }
  };

  const handleOpenUpdateModal = () => {
    if (!foundUpdate) return;
    const currentVersion = tauriConfig.version || "0.1.7";
    onOpen("updateAvailable", {
      updateInfo: {
        currentVersion,
        version: foundUpdate.version,
        body: foundUpdate.body,
        date: foundUpdate.date,
      },
      updateRef: foundUpdate,
    } as any);
  };

  // New URL Rule Form State
  const [newRulePrefix, setNewRulePrefix] = useState("");
  const [newRuleHeaderName, setNewRuleHeaderName] = useState("Authorization");
  const [newRuleHeaderValue, setNewRuleHeaderValue] = useState("");

  const isModalOpen = isOpen && type === "settings";

  const handleClose = () => {
    onClose();
  };

  const handleTestSound = () => {
    playNotificationSound(notificationSettings.soundPreset || "chime");
  };

  const handleTogglePopup = async (checked: boolean) => {
    setGlobalNotificationSettings({ popupEnabled: checked });
    if (checked) {
      await requestDesktopNotificationPermission();
    }
  };

  const handleProviderChange = (provider: ImageUploadProvider) => {
    setUploadConfig({
      ...uploadConfig,
      provider,
    });
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRulePrefix || !newRuleHeaderName || !newRuleHeaderValue) return;
    addUrlAuthRule({
      urlPrefix: newRulePrefix,
      headerName: newRuleHeaderName,
      headerValue: newRuleHeaderValue,
    });
    setNewRulePrefix("");
    setNewRuleHeaderValue("");
  };

  const handleOpenConfigFile = async () => {
    try {
      await invoke("open_config_file");
    } catch (err) {
      console.error("Failed to open configuration file:", err);
    }
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-white dark:bg-[#313338] text-zinc-900 dark:text-zinc-100 p-0 overflow-hidden sm:max-w-xl border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-xl">
        <DialogHeader className="pt-6 px-6 space-y-1">
          <DialogTitle className="text-2xl text-center font-bold text-zinc-900 dark:text-zinc-100 flex items-center justify-center gap-x-2">
            <Settings className="w-6 h-6 text-indigo-500" />
            Settings
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400 text-xs sm:text-sm">
            Manage application preferences, notifications, image servers, and authorization rules.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {/* SECTION: GLOBAL NOTIFICATIONS */}
          <NotificationSettingsFields
            mode="global"
            values={{
              channelNotifications: notificationSettings.channelNotifications || "mentions",
              dmNotifications: notificationSettings.dmNotifications || "all",
              sound: notificationSettings.soundEnabled,
              soundPreset: notificationSettings.soundPreset || "chime",
              dmSoundPreset: notificationSettings.dmSoundPreset || "chime",
              customSoundUrl: notificationSettings.customSoundUrl,
              customDmSoundUrl: notificationSettings.customDmSoundUrl,
              soundCooldown: notificationSettings.soundCooldownMs ?? 2500,
              popup: notificationSettings.popupEnabled,
              taskbar: notificationSettings.taskbarHighlightEnabled,
            }}
            onChange={(field, val) => {
              if (field === "channelNotifications") setGlobalNotificationSettings({ channelNotifications: val });
              else if (field === "dmNotifications") setGlobalNotificationSettings({ dmNotifications: val });
              else if (field === "sound") setGlobalNotificationSettings({ soundEnabled: Boolean(val) });
              else if (field === "soundPreset") setGlobalNotificationSettings({ soundPreset: val });
              else if (field === "dmSoundPreset") setGlobalNotificationSettings({ dmSoundPreset: val });
              else if (field === "customSoundUrl") setGlobalNotificationSettings({ customSoundUrl: val });
              else if (field === "customDmSoundUrl") setGlobalNotificationSettings({ customDmSoundUrl: val });
              else if (field === "soundCooldown") setGlobalNotificationSettings({ soundCooldownMs: Number(val) });
              else if (field === "popup") setGlobalNotificationSettings({ popupEnabled: Boolean(val) });
              else if (field === "taskbar") setGlobalNotificationSettings({ taskbarHighlightEnabled: Boolean(val) });
            }}
          />

          {/* SECTION: AUTOMATIC UPDATES */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 space-y-4 shadow-sm transition">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-x-2">
                <DownloadCloud className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                <label className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Software updates
                </label>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                v{tauriConfig.version || "0.1.7"}
              </span>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Select automatic check and download preferences for new releases.
            </p>

            {/* Mode selector */}
            <div className="grid grid-cols-1 gap-2">
              <label
                className={`flex items-start gap-x-3 p-3 rounded-lg border cursor-pointer transition text-xs ${autoUpdateMode === "auto"
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-900 dark:text-indigo-100 font-semibold"
                  : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1e1f22] text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                  }`}
              >
                <input
                  type="radio"
                  name="autoUpdateMode"
                  value="auto"
                  checked={autoUpdateMode === "auto"}
                  onChange={() => setAutoUpdateMode("auto")}
                  className="mt-0.5 accent-indigo-500 cursor-pointer"
                />
                <div>
                  <div className="font-bold flex items-center gap-x-1.5">
                    🚀 Automatic update on startup
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-normal mt-0.5">
                    Check for new versions on app startup and notify when update is ready.
                  </div>
                </div>
              </label>

              <label
                className={`flex items-start gap-x-3 p-3 rounded-lg border cursor-pointer transition text-xs ${autoUpdateMode === "ask"
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-900 dark:text-indigo-100 font-semibold"
                  : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1e1f22] text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                  }`}
              >
                <input
                  type="radio"
                  name="autoUpdateMode"
                  value="ask"
                  checked={autoUpdateMode === "ask"}
                  onChange={() => setAutoUpdateMode("ask")}
                  className="mt-0.5 accent-indigo-500 cursor-pointer"
                />
                <div>
                  <div className="font-bold flex items-center gap-x-1.5">
                    ❓ Ask about update on startup (Popup prompt)
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-normal mt-0.5">
                    Show a dialog when a new version is detected with options: "Update now" or "Remind me later".
                  </div>
                </div>
              </label>

              <label
                className={`flex items-start gap-x-3 p-3 rounded-lg border cursor-pointer transition text-xs ${autoUpdateMode === "disabled"
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-900 dark:text-rose-100 font-semibold"
                  : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-[#1e1f22] text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-600"
                  }`}
              >
                <input
                  type="radio"
                  name="autoUpdateMode"
                  value="disabled"
                  checked={autoUpdateMode === "disabled"}
                  onChange={() => setAutoUpdateMode("disabled")}
                  className="mt-0.5 accent-rose-500 cursor-pointer"
                />
                <div>
                  <div className="font-bold flex items-center gap-x-1.5 text-zinc-800 dark:text-zinc-200">
                    ⛔ Disable automatic updates
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-normal mt-0.5">
                    Application will not check for updates automatically on startup.
                  </div>
                </div>
              </label>
            </div>

            {/* Check / Update action row */}
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700/60 flex items-center justify-between gap-x-3">
              <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                {checkStatus === "idle" && (
                  <span className="text-zinc-500">Installed version: v{tauriConfig.version || "0.1.7"}</span>
                )}
                {checkStatus === "checking" && (
                  <span className="flex items-center gap-x-1.5 text-indigo-500 font-semibold">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Checking for updates...
                  </span>
                )}
                {checkStatus === "upToDate" && (
                  <span className="flex items-center gap-x-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    diIRC is up to date (v{tauriConfig.version || "0.1.7"})
                  </span>
                )}
                {checkStatus === "available" && (
                  <span className="flex items-center gap-x-1.5 text-indigo-600 dark:text-indigo-400 font-bold">
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                    New version v{foundUpdate?.version} is available!
                  </span>
                )}
                {checkStatus === "error" && (
                  <span className="text-rose-500 text-[11px] block truncate max-w-[240px]">
                    Error: {checkErrorMsg || "Failed to connect to update server."}
                  </span>
                )}
              </div>

              <div className="shrink-0">
                {checkStatus === "available" ? (
                  <Button
                    size="sm"
                    onClick={handleOpenUpdateModal}
                    className="text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-x-1.5 shadow-sm"
                  >
                    <DownloadCloud className="w-3.5 h-3.5" />
                    Update now (v{foundUpdate?.version})
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={checkStatus === "checking"}
                    onClick={handleManualCheckUpdates}
                    className="text-xs font-semibold border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-x-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checkStatus === "checking" ? "animate-spin" : ""}`} />
                    Check for updates
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Configuration File (TOML) */}
          <div className="flex flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 shadow-sm transition">
            <div className="space-y-0.5 pr-4">
              <div className="flex items-center gap-x-2">
                <FileText className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Configuration file
                </label>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Edit application configuration directly in your system default editor (TOML format).
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenConfigFile}
              className="text-xs font-semibold border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-x-1.5 shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open configuration file
            </Button>
          </div>

          {/* Compact Mode */}
          <div className="flex flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 shadow-sm transition">
            <div className="space-y-0.5 pr-4">
              <div className="flex items-center gap-x-2">
                <EyeOff className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer">
                  Compact mode
                </label>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Hide all user avatars in the chat window.
              </p>
            </div>
            <Switch
              checked={compactMode}
              onCheckedChange={(checked) => setCompactMode(checked)}
            />
          </div>

          {/* Confirm Before Leaving Channel */}
          <div className="flex flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 shadow-sm transition">
            <div className="space-y-0.5 pr-4">
              <div className="flex items-center gap-x-2">
                <LogOut className="w-4 h-4 text-rose-500 dark:text-rose-400" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer">
                  Confirm before leaving channel
                </label>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Show a confirmation dialog when leaving a channel.
              </p>
            </div>
            <Switch
              checked={confirmLeaveChannel}
              onCheckedChange={(checked) => setConfirmLeaveChannel(checked)}
            />
          </div>

          {/* Slash Command Autocomplete */}
          <div className="flex flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 shadow-sm transition">
            <div className="space-y-0.5 pr-4">
              <div className="flex items-center gap-x-2">
                <Command className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer">
                  Slash command autocomplete
                </label>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Show suggestions popup when typing / in chat.
              </p>
            </div>
            <Switch
              checked={enableCommandSuggestions}
              onCheckedChange={(checked) => setEnableCommandSuggestions(checked)}
            />
          </div>

          {/* Markdown Rendering */}
          <div className="flex flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 shadow-sm transition">
            <div className="space-y-0.5 pr-4">
              <div className="flex items-center gap-x-2">
                <FileText className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer">
                  Markdown rendering
                </label>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Render <span className="font-mono">**bold**</span> <span className="font-mono">*italic*</span> <span className="font-mono">__underline__</span> <span className="font-mono">~~strike~~</span> <span className="font-mono">`code`</span> <span className="font-mono">```block```</span> <span className="font-mono">&gt;quote</span> <span className="font-mono">||spoiler||</span> and links.
              </p>
            </div>
            <Switch
              checked={enableMarkdown}
              onCheckedChange={(checked) => setEnableMarkdown(checked)}
            />
          </div>

          {/* Sort Private Messages by Unread */}
          <div className="flex flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 shadow-sm transition">
            <div className="space-y-0.5 pr-4">
              <div className="flex items-center gap-x-2">
                <MessageSquare className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer">
                  Sort private messages by unread
                </label>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Move private messages with unread messages to the top of the list.
              </p>
            </div>
            <Switch
              checked={sortDmByUnread}
              onCheckedChange={(checked) => setSortDmByUnread(checked)}
            />
          </div>

          {/* Base Private Message Sorting */}
          <div className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 space-y-3 shadow-sm transition">
            <div className="flex items-center gap-x-2">
              <ArrowUpDown className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
              <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Sort private messages
              </label>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Choose base sorting order for active private messages.
            </p>
            <select
              value={dmSortOrder}
              onChange={(e) => setDmSortOrder(e.target.value as "opening" | "alphabetical")}
              className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="opening">By opening order</option>
              <option value="alphabetical">Alphabetical</option>
            </select>
          </div>

          {/* Status Indicator Display Mode */}
          <div className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 space-y-3 shadow-sm transition">
            <div className="flex items-center gap-x-2">
              <Activity className="w-4 h-4 text-emerald-500" />
              <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Connection status indicator
              </label>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Configure when the connection status badge (IRC, resource server, internet) is displayed.
            </p>
            <select
              value={statusDisplayMode}
              onChange={(e) => setStatusDisplayMode(e.target.value as StatusDisplayMode)}
              className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="always">Always show</option>
              <option value="on_error">Only on error</option>
              <option value="disabled">Disabled (hidden)</option>
            </select>
          </div>

          {/* Message of the day (MOTD) */}
          <div className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 space-y-3 shadow-sm transition">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-x-2">
                <ScrollText className="w-4 h-4 text-indigo-500" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Message of the day (MOTD)
                </label>
              </div>
              <Switch
                checked={globalMotdPolicy !== "never"}
                onCheckedChange={(checked) => {
                  setGlobalMotdPolicy(checked ? "on_change" : "never");
                }}
              />
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Choose when to automatically display server MOTD popups upon connecting or joining.
            </p>
            {globalMotdPolicy !== "never" && (
              <select
                value={globalMotdPolicy}
                onChange={(e) => setGlobalMotdPolicy(e.target.value as MotdDisplayPolicy)}
                className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="on_change">Only when changed (recommended)</option>
                <option value="always">Always show on connect</option>
                <option value="never">Never show automatically (all servers)</option>
              </select>
            )}
          </div>

          {/* Date Display Format */}
          <div className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 space-y-3 shadow-sm transition">
            <div className="flex items-center gap-x-2">
              <Calendar className="w-4 h-4 text-indigo-500" />
              <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Date display format
              </label>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Choose how timestamps are displayed in chat messages.
            </p>
            <select
              value={dateFormatPreset}
              onChange={(e) => setDateFormatPreset(e.target.value)}
              className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="d MMM yyyy, HH:mm">Default (20 Aug 2026, 23:30)</option>
              <option value="yyyy-MM-dd HH:mm:ss">ISO 8601 (2026-08-20 23:30:00)</option>
              <option value="MM/dd/yyyy, h:mm a">US format (08/20/2026, 11:30 PM)</option>
              <option value="dd.MM.yyyy HH:mm">European format (20.08.2026 23:30)</option>
              <option value="HH:mm:ss">Time only (23:30:00)</option>
              <option value="custom">Custom format</option>
            </select>

            {dateFormatPreset === "custom" && (
              <div className="space-y-1 pt-1">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Custom format pattern
                </label>
                <Input
                  value={customDateFormat}
                  onChange={(e) => setCustomDateFormat(e.target.value)}
                  placeholder="e.g. yyyy/MM/dd HH:mm"
                  className="bg-white dark:bg-[#1e1f22] border-zinc-300 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                />
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Uses tokens based on <a href="https://unicode.org/reports/tr35/tr35-dates.html#Date_Format_Patterns" target="_blank" rel="noreferrer" className="text-indigo-500 hover:underline">Unicode Technical Standard #35 date format patterns</a> (e.g. yyyy/MM/dd HH:mm).
                </p>
              </div>
            )}

            <div className="pt-1 text-xs text-zinc-500 dark:text-zinc-400 font-mono flex items-center justify-between border-t border-zinc-200 dark:border-zinc-700/50 mt-1">
              <span className="font-sans text-[11px]">Preview:</span>
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                {formatMessageDate(new Date(), dateFormatPreset, customDateFormat)}
              </span>
            </div>
          </div>

          {/* Switch 1: Enable Link Previews (All embeds) */}
          <div className="flex flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 shadow-sm transition">
            <div className="space-y-0.5 pr-4">
              <div className="flex items-center gap-x-2">
                <Link2 className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer">
                  Link previews (embeds)
                </label>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Show media previews (images, videos, YouTube, websites) in chat.
              </p>
            </div>
            <Switch
              checked={enableLinkPreviews}
              onCheckedChange={(checked) => setEnableLinkPreviews(checked)}
            />
          </div>

          {/* Switch 2: Web Page Metadata API Previews */}
          {enableLinkPreviews && (
            <div className="flex flex-row items-center justify-between rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 shadow-sm transition">
              <div className="space-y-0.5 pr-4">
                <div className="flex items-center gap-x-2">
                  <Globe className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
                  <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 cursor-pointer">
                    Fetch web page metadata (API)
                  </label>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Use API to fetch title, description, and thumbnails for web pages. Direct images don't use the API.
                </p>
              </div>
              <Switch
                checked={enableWebPagePreviews}
                onCheckedChange={(checked) => setEnableWebPagePreviews(checked)}
              />
            </div>
          )}

          {/* Custom Link Preview API Endpoint Input */}
          {enableLinkPreviews && enableWebPagePreviews && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 space-y-2 shadow-sm transition">
              <div className="flex items-center gap-x-2">
                <Server className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Preview API endpoint
                </label>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Open-Source metadata API URL for fetching web page previews.
              </p>
              <Input
                value={linkPreviewApiUrl}
                onChange={(e) => setLinkPreviewApiUrl(e.target.value)}
                placeholder="https://api.microlink.io"
                className="bg-white dark:bg-[#1e1f22] border-zinc-300 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 text-xs mt-2 focus-visible:ring-indigo-500"
              />
            </div>
          )}

          {/* SECTION: IMAGE UPLOADER SERVER */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 space-y-4 shadow-sm transition">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-x-2">
                <UploadCloud className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
                <label className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Image upload provider
                </label>
              </div>
              {uploadConfig.provider === "litterbox" && (
                <span className="text-xs px-2 py-0.5 font-bold rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  Temporary hosting
                </span>
              )}
              {uploadConfig.provider === "pomf" && (
                <span className="text-xs px-2 py-0.5 font-bold rounded bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30">
                  POMF hosting
                </span>
              )}
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Select a service for uploading images pasted from clipboard or files. A direct link will be sent to the IRC chat.
            </p>

            {/* Provider Selection Dropdown */}
            <select
              value={uploadConfig.provider}
              onChange={(e) => handleProviderChange(e.target.value as ImageUploadProvider)}
              className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="disabled">🚫 Disabled (Upload disabled)</option>
              <option value="litterbox" className="text-amber-600 font-bold">
                ⚠️ Litterbox (public, expiration 1h - 72h)
              </option>
              <option value="pomf" className="text-indigo-600 font-bold">
                🐱 POMF / Pomf.cat (public)
              </option>
            </select>

            {/* Litterbox Warning & Retention Config */}
            {uploadConfig.provider === "litterbox" && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 space-y-2 text-xs text-amber-600 dark:text-amber-400">
                <div className="flex items-center gap-x-1.5 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  Information (Litterbox temporary):
                </div>
                <p className="text-[11px] leading-relaxed opacity-90">
                  Images expire automatically after the selected duration. They remain public until deleted.
                </p>

                <div className="pt-1 flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    Retention duration:
                  </label>
                  <select
                    value={uploadConfig.litterboxTime || "24h"}
                    onChange={(e) =>
                      setUploadConfig({ ...uploadConfig, litterboxTime: e.target.value as LitterboxTime })
                    }
                    className="bg-white dark:bg-[#1e1f22] border border-amber-500/40 rounded px-2 py-1 text-xs font-semibold text-zinc-900 dark:text-zinc-100"
                  >
                    <option value="1h">1 hour</option>
                    <option value="12h">12 hours</option>
                    <option value="24h">24 hours (default)</option>
                    <option value="72h">72 hours (3 days)</option>
                  </select>
                </div>
              </div>
            )}

            {/* POMF Configuration */}
            {uploadConfig.provider === "pomf" && (
              <div className="space-y-3 pt-1">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    POMF server address (upload URL)
                  </label>
                  <Input
                    value={uploadConfig.pomfUrl || ""}
                    onChange={(e) => setUploadConfig({ ...uploadConfig, pomfUrl: e.target.value })}
                    placeholder="https://pomf.cat/upload.php"
                    className="bg-white dark:bg-[#1e1f22] border-zinc-300 dark:border-zinc-700 text-xs"
                  />
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Leave default address <code className="text-indigo-400">https://pomf.cat/upload.php</code> or enter your custom POMF instance address.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* SECTION: READING AUTHORIZATION (URL RULES) */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-4 space-y-3 shadow-sm transition">
            <div className="flex items-center gap-x-2">
              <Key className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
              <label className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                Image read authorization (URL headers)
              </label>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Define HTTP headers (e.g., tokens) to be sent when fetching and previewing images from specified URL prefixes.
            </p>

            {/* List of rules */}
            {urlAuthRules.length > 0 ? (
              <div className="space-y-2">
                {urlAuthRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-white dark:bg-[#1e1f22] border border-zinc-200 dark:border-zinc-700/80 text-xs"
                  >
                    <div className="space-y-0.5 overflow-hidden pr-2">
                      <div className="font-bold text-indigo-500 truncate">{rule.urlPrefix}</div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono">
                        {rule.headerName}: {rule.headerValue.slice(0, 15)}...
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeUrlAuthRule(rule.id)}
                      className="h-7 w-7 text-rose-500 hover:bg-rose-500/10 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-400 dark:text-zinc-500 italic">No read authorization rules configured.</p>
            )}

            {/* Form to add new rule */}
            <form onSubmit={handleAddRule} className="pt-2 space-y-2 border-t border-zinc-200 dark:border-zinc-700/60">
              <div className="space-y-1">
                <Input
                  value={newRulePrefix}
                  onChange={(e) => setNewRulePrefix(e.target.value)}
                  placeholder="URL Prefix (e.g. https://private-host.org/)"
                  className="bg-white dark:bg-[#1e1f22] border-zinc-300 dark:border-zinc-700 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={newRuleHeaderName}
                  onChange={(e) => setNewRuleHeaderName(e.target.value)}
                  placeholder="Header (Authorization / X-Api-Key)"
                  className="bg-white dark:bg-[#1e1f22] border-zinc-300 dark:border-zinc-700 text-xs font-mono"
                />
                <Input
                  value={newRuleHeaderValue}
                  onChange={(e) => setNewRuleHeaderValue(e.target.value)}
                  placeholder="Value (Bearer token / key)"
                  className="bg-white dark:bg-[#1e1f22] border-zinc-300 dark:border-zinc-700 text-xs font-mono"
                />
              </div>
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="w-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> Add authorization rule
              </Button>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
