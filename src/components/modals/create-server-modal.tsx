import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFieldArray } from "react-hook-form";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

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
import { Plus, Trash } from "lucide-react";
import { useModal } from "@/hooks/use-modal-store";
import { useMockStore } from "@/lib/mock-store";
import {
  CustomCommandsFields,
  normalizeCustomCommandsFromForm,
} from "@/components/server/custom-commands-fields";

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

export const CreateServerModal = () => {
  const { isOpen, onClose, type } = useModal();
  const navigate = useNavigate();
  const addServer = useMockStore((state) => state.addServer);
  const currentProfile = useMockStore((state) => state.currentProfile);

  const isModalOpen = isOpen && type === "createServer";

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      host: "127.0.0.1",
      port: 6667,
      nicknames: [{ value: currentProfile.name.replace(/\s+/g, "") || "ReactUser" }],
      username: "",
      realname: "",
      password: "",
      useTls: false,
      autoConnect: true,
      autoReconnect: true,
      parseLegacyZncTimestamps: false,
      customCommands: [],
    }
  });

  const { fields: nickFields, append: appendNick, remove: removeNick } = useFieldArray({
    name: "nicknames",
    control: form.control,
  });

  useEffect(() => {
    if (isModalOpen) {
      form.reset({
        name: "",
        host: "127.0.0.1",
        port: 6667,
        nicknames: [{ value: currentProfile.name.replace(/\s+/g, "") || "ReactUser" }],
        realname: "",
        password: "",
        useTls: false,
        autoConnect: true,
        autoReconnect: true,
        parseLegacyZncTimestamps: false,
        legacyReply: false,
        customCommands: [],
      });
    }
  }, [isModalOpen, form, currentProfile]);

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const nickArray = values.nicknames
        .map(n => n.value.trim())
        .filter(Boolean);

      const newServer = addServer({
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
      });

      form.reset();
      onClose();
      navigate(`/servers/${newServer.id}`);
    } catch (error) {
      console.log(error);
    }
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={handleClose}>
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="bg-white dark:bg-[#313338] text-zinc-900 dark:text-zinc-100 p-0 overflow-hidden max-w-md max-h-[90vh] flex flex-col border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-xl"
      >
        <DialogHeader className="pt-6 px-6 space-y-1 shrink-0">
          <DialogTitle className="text-2xl text-center font-bold text-zinc-900 dark:text-zinc-100">
            Add IRC server
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400 text-xs sm:text-sm">
            Configure host, port, and nickname to connect to your IRC server.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
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
                      placeholder="e.g. Local Ergo or Libera Chat"
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
                              form.setValue('port', parseInt(p) || 6667);
                              setTimeout(() => {
                                document.getElementById("port-input")?.focus();
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
                          id="port-input"
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
                          form.setValue("port", 6697);
                        } else if (!checked && form.getValues("port") === 6697) {
                          form.setValue("port", 6667);
                        }
                      }}
                      disabled={isLoading}
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
                      disabled={isLoading}
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
                      disabled={isLoading}
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
                      disabled={isLoading}
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
                      disabled={isLoading}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            </div>

            <DialogFooter className="bg-zinc-100/90 dark:bg-[#2b2d31] border-t border-zinc-200 dark:border-zinc-800/80 px-6 py-4 flex items-center justify-between shrink-0">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={isLoading}
                className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white"
              >
                Cancel
              </Button>
              <Button variant="primary" disabled={isLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-6 shadow-sm">
                Connect & add
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
