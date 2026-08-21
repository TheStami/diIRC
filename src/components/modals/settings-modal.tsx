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
  ShieldCheck,
  Activity,
  Command,
  FileText,
  LogOut,
  Calendar
} from "lucide-react";
import { StatusDisplayMode, formatMessageDate } from "@/lib/mock-store";

export const SettingsModal = () => {
  const { isOpen, onClose, type } = useModal();
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

  // New URL Rule Form State
  const [newRulePrefix, setNewRulePrefix] = useState("");
  const [newRuleHeaderName, setNewRuleHeaderName] = useState("Authorization");
  const [newRuleHeaderValue, setNewRuleHeaderValue] = useState("");

  const isModalOpen = isOpen && type === "settings";

  const handleClose = () => {
    onClose();
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

  return (
    <Dialog open={isModalOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-white dark:bg-[#313338] text-zinc-900 dark:text-zinc-100 p-0 overflow-hidden max-w-lg border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-xl">
        <DialogHeader className="pt-6 px-6 space-y-1">
          <DialogTitle className="text-2xl text-center font-bold text-zinc-900 dark:text-zinc-100 flex items-center justify-center gap-x-2">
            <Settings className="w-6 h-6 text-indigo-500" />
            Settings
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400 text-xs sm:text-sm">
            Manage application preferences, image servers, and authorization rules.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-6 space-y-5 max-h-[75vh] overflow-y-auto">
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
