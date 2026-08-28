import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash, Bell, Volume2, Monitor, Clock, ScrollText, Sparkles } from "lucide-react";
import { useModal } from "@/hooks/use-modal-store";
import { useMockStore } from "@/lib/mock-store";
import {
  NotificationOverrideValue,
  SoundPreset,
  ChannelNotificationOverrideValue,
  DmNotificationOverrideValue,
  ServerMotdDisplayPolicy,
  ServerUserDisplayNameMode,
} from "@/types";
import { NotificationSettingsFields } from "@/components/notifications/notification-settings-fields";
import { CustomCommandsFields, normalizeCustomCommandsFromForm } from "@/components/server/custom-commands-fields";

const formSchema = z.object({
  name: z.string().min(1, { message: "Server name is required." }),
  host: z.string().min(1, { message: "Server address is required." }),
  port: z.coerce.number().min(1).max(65535),
  nicknames: z.array(
    z.object({
      value: z.string()
        .min(1, { message: "Nickname is required." })
        .refine((val) => !/\s/.test(val), { message: "Nickname cannot contain spaces." }),
    })
  ).min(1),
  username: z.string().optional(),
  realname: z.string().optional(),
  password: z.string().optional(),
  useTls: z.boolean().default(false),
  autoConnect: z.boolean().default(true),
  autoReconnect: z.boolean().default(true),
  parseLegacyZncTimestamps: z.boolean().default(false),
  legacyReply: z.boolean().default(false),
  customCommands: z.array(
    z.object({
      trigger: z.string(),
      message: z.string(),
      description: z.string().optional().default(""),
      suggestions: z.string().optional().default(""),
    })
  ).default([]),
});

export const EditServerModal = () => {
  const { isOpen, onClose, type, data } = useModal();
  const updateServer = useMockStore((state) => state.updateServer);

  const isModalOpen = isOpen && type === "editServer";
  const { server: initialServer } = data;

  const server = useMockStore((state) =>
    state.servers.find((s) => s.id === initialServer?.id)
  ) || initialServer;

  const globalNotif = useMockStore((state) => state.notificationSettings);
  const globalMotdPolicy = useMockStore((state) => state.globalMotdPolicy) || "on_change";
  const serverMotdPolicies = useMockStore((state) => state.serverMotdPolicies);
  const setServerMotdPolicy = useMockStore((state) => state.setServerMotdPolicy);
  const setGlobalMotdPolicy = useMockStore((state) => state.setGlobalMotdPolicy);

  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [motdPolicyOverride, setMotdPolicyOverride] = useState<ServerMotdDisplayPolicy>("default");
  const [displayNameModeOverride, setDisplayNameModeOverride] = useState<ServerUserDisplayNameMode>("default");
  const [channelNotificationsOverride, setChannelNotificationsOverride] = useState<ChannelNotificationOverrideValue>("default");
  const [dmNotificationsOverride, setDmNotificationsOverride] = useState<DmNotificationOverrideValue>("default");
  const [soundOverride, setSoundOverride] = useState<NotificationOverrideValue>("default");
  const [popupOverride, setPopupOverride] = useState<NotificationOverrideValue>("default");
  const [taskbarOverride, setTaskbarOverride] = useState<NotificationOverrideValue>("default");
  const [soundCooldownOverride, setSoundCooldownOverride] = useState<"default" | number>("default");
  const [soundPresetOverride, setSoundPresetOverride] = useState<"default" | SoundPreset>("default");
  const [dmSoundPresetOverride, setDmSoundPresetOverride] = useState<"default" | SoundPreset>("default");
  const [customSoundUrlOverride, setCustomSoundUrlOverride] = useState<string | undefined>(undefined);
  const [customDmSoundUrlOverride, setCustomDmSoundUrlOverride] = useState<string | undefined>(undefined);

  const inheritedChannelNotifStr =
    globalNotif?.channelNotifications === "all"
      ? "All messages"
      : globalNotif?.channelNotifications === "off"
      ? "Disabled"
      : "Mentions only";
  const inheritedDmNotifStr = globalNotif?.dmNotifications === "off" ? "Disabled" : "Enabled";
  const inheritedSoundStr = globalNotif?.soundEnabled ? "Enabled" : "Muted";
  const inheritedPopupStr = globalNotif?.popupEnabled ? "Enabled" : "Off";
  const inheritedTaskbarStr = globalNotif?.taskbarHighlightEnabled ? "Enabled" : "Off";
  const inheritedCooldownSec = ((globalNotif?.soundCooldownMs ?? 3000) / 1000).toFixed(1);
  const inheritedSoundPresetStr = globalNotif?.soundPreset || "chime";
  const inheritedDmSoundPresetStr = globalNotif?.dmSoundPreset || "chime";

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      host: "127.0.0.1",
      port: 6667,
      nicknames: [{ value: "ReactUser" }],
      realname: "",
      password: "",
      useTls: false,
      autoConnect: true,
      autoReconnect: true,
      customCommands: [],
    }
  });

  const { fields: nickFields, append: appendNick, remove: removeNick } = useFieldArray({
    name: "nicknames",
    control: form.control,
  });

  useEffect(() => {
    if (server && isModalOpen) {
      const defaultNicks = server.nicknames && server.nicknames.length > 0 
        ? server.nicknames.map(n => ({ value: n }))
        : [{ value: server.nicknames?.[0] || "ReactUser" }];

      setChannelNotificationsOverride(server.notificationSettings?.channelNotifications || "default");
      setDmNotificationsOverride(server.notificationSettings?.dmNotifications || "default");
      setSoundOverride(server.notificationSettings?.sound || "default");
      setPopupOverride(server.notificationSettings?.popup || "default");
      setTaskbarOverride(server.notificationSettings?.taskbar || "default");
      setSoundCooldownOverride(server.notificationSettings?.soundCooldown ?? "default");
      setSoundPresetOverride(server.notificationSettings?.soundPreset || "default");
      setDmSoundPresetOverride(server.notificationSettings?.dmSoundPreset || "default");
      setCustomSoundUrlOverride(server.notificationSettings?.customSoundUrl);
      setCustomDmSoundUrlOverride(server.notificationSettings?.customDmSoundUrl);
      setMotdPolicyOverride(
        server.id && serverMotdPolicies[server.id]
          ? serverMotdPolicies[server.id]
          : server.motdPolicy || "default"
      );
      setDisplayNameModeOverride(server.displayNameMode || "default");

      form.reset({
        name: server.name || "",
        host: server.host || "127.0.0.1",
        port: server.port || 6667,
        nicknames: defaultNicks,
        username: server.username || "",
        realname: server.realname || "",
        password: server.password || "",
        useTls: server.useTls ?? false,
        autoConnect: server.autoConnect ?? true,
        autoReconnect: server.autoReconnect ?? true,
        parseLegacyZncTimestamps: server.parseLegacyZncTimestamps ?? false,
        legacyReply: server.legacyReply ?? false,
        customCommands: (server.customCommands || []).map((c) => ({
          trigger: c.trigger,
          message: c.message,
          description: c.description || "",
          suggestions: (c.suggestions || []).join(", "),
        })),
      });
    }
  }, [server, isModalOpen, form]);

  const isLoading = form.formState.isSubmitting;

  const saveServer = async (values: z.infer<typeof formSchema>) => {
    if (!server?.id) return;
    try {
      const nickArray = values.nicknames
        .map(n => n.value.trim())
        .filter(Boolean);

      updateServer(server.id, {
        name: values.name,
        host: values.host,
        port: values.port,
        nicknames: nickArray,
        username: values.username || "",
        realname: values.realname || "",
        password: values.password || "",
        useTls: values.useTls,
        autoConnect: values.autoConnect,
        autoReconnect: values.autoReconnect,
        parseLegacyZncTimestamps: values.parseLegacyZncTimestamps,
        legacyReply: values.legacyReply,
        customCommands: normalizeCustomCommandsFromForm(values.customCommands),
        motdPolicy: motdPolicyOverride,
        displayNameMode: displayNameModeOverride,
        notificationSettings: {
          channelNotifications: channelNotificationsOverride,
          dmNotifications: dmNotificationsOverride,
          sound: soundOverride,
          popup: popupOverride,
          taskbar: taskbarOverride,
          soundCooldown: soundCooldownOverride,
          soundPreset: soundPresetOverride,
          dmSoundPreset: dmSoundPresetOverride,
          customSoundUrl: customSoundUrlOverride,
          customDmSoundUrl: customDmSoundUrlOverride,
        },
      });

      setServerMotdPolicy(server.id, motdPolicyOverride);
      setConfirmCloseOpen(false);
      form.reset();
      onClose();
    } catch (error) {
      console.log(error);
    }
  };

  const onFormSubmit = async (values: z.infer<typeof formSchema>) => {
    await saveServer(values);
  };

  const handleAttemptClose = () => {
    if (form.formState.isDirty) {
      setConfirmCloseOpen(true);
    } else {
      handleForceClose();
    }
  };

  const handleForceClose = () => {
    setConfirmCloseOpen(false);
    form.reset();
    onClose();
  };

  return (
    <>
      <Dialog open={isModalOpen} onOpenChange={handleAttemptClose}>
        <DialogContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="bg-white dark:bg-[#313338] text-zinc-900 dark:text-zinc-100 p-0 overflow-hidden sm:max-w-lg max-h-[90vh] flex flex-col border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-xl"
        >
          <DialogHeader className="pt-6 px-6 space-y-1 shrink-0">
            <DialogTitle className="text-2xl text-center font-bold text-zinc-900 dark:text-zinc-100">
              Edit server settings
            </DialogTitle>
            <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400 text-xs sm:text-sm">
              Update connection parameters and configuration for your IRC server.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onFormSubmit)} className="flex flex-col flex-1 min-h-0">
              <div className="space-y-4 flex-1 overflow-y-auto px-6 py-2 min-h-0">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-600 dark:text-zinc-300 tracking-wider">
                      Server name
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        className="bg-zinc-100 dark:bg-[#1e1f22] border border-zinc-300/80 dark:border-zinc-700/60 focus-visible:ring-2 focus-visible:ring-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-medium h-10"
                        placeholder="e.g. Local Ergo"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <FormField
                    control={form.control}
                    name="host"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="uppercase text-xs font-bold text-zinc-600 dark:text-zinc-300 tracking-wider">
                          Host / address
                        </FormLabel>
                        <FormControl>
                          <Input
                            disabled={isLoading}
                            className="bg-zinc-100 dark:bg-[#1e1f22] border border-zinc-300/80 dark:border-zinc-700/60 focus-visible:ring-2 focus-visible:ring-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-medium h-10"
                            placeholder="127.0.0.1"
                            {...field}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val.includes(':')) {
                                const [h, p] = val.split(':');
                                field.onChange(h);
                                form.setValue('port', parseInt(p) || 6667, { shouldDirty: true });
                                setTimeout(() => {
                                  document.getElementById("edit-port-input")?.focus();
                                }, 0);
                              } else {
                                field.onChange(val);
                              }
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="col-span-1">
                  <FormField
                    control={form.control}
                    name="port"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="uppercase text-xs font-bold text-zinc-600 dark:text-zinc-300 tracking-wider">
                          Port
                        </FormLabel>
                        <FormControl>
                          <Input
                            id="edit-port-input"
                            type="number"
                            disabled={isLoading}
                            className="bg-zinc-100 dark:bg-[#1e1f22] border border-zinc-300/80 dark:border-zinc-700/60 focus-visible:ring-2 focus-visible:ring-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-medium h-10"
                            placeholder="6667"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-600 dark:text-zinc-300 tracking-wider">
                      Password (optional)
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        disabled={isLoading}
                        className="bg-zinc-100 dark:bg-[#1e1f22] border border-zinc-300/80 dark:border-zinc-700/60 focus-visible:ring-2 focus-visible:ring-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-medium h-10 w-full"
                        placeholder="Optional"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-600 dark:text-zinc-300 tracking-wider">
                      Username (optional)
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        className="bg-zinc-100 dark:bg-[#1e1f22] border border-zinc-300/80 dark:border-zinc-700/60 focus-visible:ring-2 focus-visible:ring-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-medium h-10 w-full"
                        placeholder="Ident (defaults to primary nickname)"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="realname"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-600 dark:text-zinc-300 tracking-wider">
                      Real name (optional)
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        className="bg-zinc-100 dark:bg-[#1e1f22] border border-zinc-300/80 dark:border-zinc-700/60 focus-visible:ring-2 focus-visible:ring-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-medium h-10 w-full"
                        placeholder="e.g. John Doe"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-col gap-2">
                <FormLabel className="uppercase text-xs font-bold text-zinc-600 dark:text-zinc-300 tracking-wider flex items-center justify-between">
                  Nicknames
                  <Plus 
                    className="w-4 h-4 cursor-pointer text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100 transition" 
                    onClick={() => appendNick({ value: "" })} 
                  />
                </FormLabel>
                {nickFields.map((field, index) => (
                  <FormField
                    key={field.id}
                    control={form.control}
                    name={`nicknames.${index}.value`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <div className="flex items-center gap-2">
                            <Input
                              disabled={isLoading}
                              className="bg-zinc-100 dark:bg-[#1e1f22] border border-zinc-300/80 dark:border-zinc-700/60 focus-visible:ring-2 focus-visible:ring-indigo-500 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 font-medium h-10"
                              placeholder={index === 0 ? "ReactUser" : "Fallback nick"}
                              {...field}
                            />
                            {index > 0 && (
                              <Trash 
                                className="w-4 h-4 cursor-pointer text-zinc-400 hover:text-rose-500 transition shrink-0" 
                                onClick={() => removeNick(index)} 
                              />
                            )}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>

              <CustomCommandsFields control={form.control} disabled={isLoading} />

              <FormField
                control={form.control}
                name="useTls"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border border-zinc-300/80 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-3.5 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 cursor-pointer">
                        Use TLS / SSL
                      </FormLabel>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Encrypt connection via TLS/SSL (default port 6697)
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          if (checked && form.getValues("port") === 6667) {
                            form.setValue("port", 6697, { shouldDirty: true });
                          } else if (!checked && form.getValues("port") === 6697) {
                            form.setValue("port", 6667, { shouldDirty: true });
                          }
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="autoConnect"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border border-zinc-300/80 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-3.5 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 cursor-pointer">
                        Auto-connect on startup
                      </FormLabel>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Automatically connect to this server when application starts
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="autoReconnect"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border border-zinc-300/80 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-3.5 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 cursor-pointer">
                        Auto-reconnect on disconnect
                      </FormLabel>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Automatically attempt to reconnect if connection drops
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="parseLegacyZncTimestamps"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border border-zinc-300/80 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-3.5 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 cursor-pointer">
                        Parse legacy ZNC timestamps
                      </FormLabel>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Extract timestamps formatted as [HH:MM:SS] from older bouncers without IRCv3 server-time support
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="legacyReply"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-xl border border-zinc-300/80 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-3.5 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm font-semibold text-zinc-900 dark:text-zinc-200 cursor-pointer">
                        Legacy reply compatibility
                      </FormLabel>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Append quoted reply snippet to outgoing messages for older IRC clients without IRCv3 reply support (e.g. HexChat)
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* SECTION: MOTD POLICY */}
              <div className="flex flex-col rounded-xl border border-zinc-300/80 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-3.5 space-y-2.5 shadow-sm">
                <div className="flex items-center gap-x-2">
                  <ScrollText className="w-4 h-4 text-indigo-500" />
                  <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                    Message of the day (MOTD)
                  </label>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Configure when to automatically display this server's MOTD on connect or join.
                </p>
                <select
                  value={motdPolicyOverride}
                  onChange={(e) => {
                    const val = e.target.value as ServerMotdDisplayPolicy;
                    if (val === "never_globally") {
                      setGlobalMotdPolicy("never");
                      setMotdPolicyOverride("never_globally");
                    } else {
                      setMotdPolicyOverride(val);
                    }
                  }}
                  className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="default">
                    Default (Use global setting: {globalMotdPolicy === "always" ? "Always" : globalMotdPolicy === "never" ? "Don't show again (all servers)" : "When changed"})
                  </option>
                  <option value="on_change">Only when changed</option>
                  <option value="always">Always show on connect</option>
                  <option value="never">Don't show again (this server)</option>
                  <option value="never_globally">Don't show again (all servers)</option>
                </select>
              </div>

              {/* SECTION: DISPLAY NAME MODE OVERRIDE */}
              <div className="flex flex-col rounded-xl border border-zinc-300/80 dark:border-zinc-700/60 bg-zinc-50 dark:bg-[#2b2d31] p-3.5 space-y-2.5 shadow-sm">
                <div className="flex items-center gap-x-2">
                  <Sparkles className="w-4 h-4 text-indigo-500" />
                  <label className="text-sm font-semibold text-zinc-900 dark:text-zinc-200">
                    User display name format
                  </label>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Select how member names are displayed for this server.
                </p>
                <select
                  value={displayNameModeOverride}
                  onChange={(e) => setDisplayNameModeOverride(e.target.value as ServerUserDisplayNameMode)}
                  className="w-full bg-white dark:bg-[#1e1f22] border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="default">
                    Default (Use app setting)
                  </option>
                  <option value="nickname">Nickname</option>
                  <option value="realname">RealName</option>
                  <option value="username">Username</option>
                </select>
              </div>

              {/* SECTION: SERVER NOTIFICATION OVERRIDES */}
              <NotificationSettingsFields
                mode="server"
                values={{
                  channelNotifications: channelNotificationsOverride,
                  dmNotifications: dmNotificationsOverride,
                  sound: soundOverride,
                  soundPreset: soundPresetOverride,
                  dmSoundPreset: dmSoundPresetOverride,
                  customSoundUrl: customSoundUrlOverride,
                  customDmSoundUrl: customDmSoundUrlOverride,
                  soundCooldown: soundCooldownOverride,
                  popup: popupOverride,
                  taskbar: taskbarOverride,
                }}
                inherited={{
                  channelNotificationsStr: inheritedChannelNotifStr,
                  dmNotificationsStr: inheritedDmNotifStr,
                  soundStr: inheritedSoundStr,
                  soundPresetStr: inheritedSoundPresetStr,
                  dmSoundPresetStr: inheritedDmSoundPresetStr,
                  cooldownSec: inheritedCooldownSec,
                  popupStr: inheritedPopupStr,
                  taskbarStr: inheritedTaskbarStr,
                }}
                onChange={(field, val) => {
                  if (field === "channelNotifications") setChannelNotificationsOverride(val);
                  else if (field === "dmNotifications") setDmNotificationsOverride(val);
                  else if (field === "sound") setSoundOverride(val);
                  else if (field === "soundPreset") setSoundPresetOverride(val);
                  else if (field === "dmSoundPreset") setDmSoundPresetOverride(val);
                  else if (field === "customSoundUrl") setCustomSoundUrlOverride(val);
                  else if (field === "customDmSoundUrl") setCustomDmSoundUrlOverride(val);
                  else if (field === "soundCooldown") setSoundCooldownOverride(val);
                  else if (field === "popup") setPopupOverride(val);
                  else if (field === "taskbar") setTaskbarOverride(val);
                }}
              />
              </div>

              <DialogFooter className="bg-zinc-100/90 dark:bg-[#2b2d31] border-t border-zinc-200 dark:border-zinc-800/80 px-6 py-4 flex items-center justify-between shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleAttemptClose}
                  disabled={isLoading}
                  className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
                >
                  Cancel
                </Button>
                <Button variant="primary" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 shadow-sm">
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Confirmation Modal */}
      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="bg-white dark:bg-[#313338] text-zinc-900 dark:text-zinc-100 p-0 overflow-hidden max-w-sm border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl z-[60] animate-in fade-in-0 zoom-in-95 duration-200"
        >
          <div className="pt-6 px-6 flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 dark:bg-amber-500/20 text-amber-500 flex items-center justify-center border border-amber-500/20 shadow-inner animate-pulse">
              <Plus className="w-6 h-6 rotate-45" />
            </div>
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-xl font-bold text-zinc-900 dark:text-zinc-100 text-center">
                Unsaved changes
              </DialogTitle>
              <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400 text-xs sm:text-sm leading-relaxed">
                You have unsaved changes to server settings for <span className="font-semibold text-indigo-600 dark:text-indigo-400">{server?.name}</span>. Do you want to save them before exiting?
              </DialogDescription>
            </DialogHeader>
          </div>
          <DialogFooter className="bg-zinc-100/90 dark:bg-[#2b2d31] border-t border-zinc-200 dark:border-zinc-800/80 px-6 py-4 flex items-center justify-end gap-x-2 mt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmCloseOpen(false)}
              disabled={isLoading}
              className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white text-xs font-medium transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleForceClose}
              disabled={isLoading}
              className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-medium transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
            >
              Discard changes
            </Button>
            <Button
              type="button"
              onClick={form.handleSubmit(saveServer)}
              disabled={isLoading}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-4 shadow-sm text-xs transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]"
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
