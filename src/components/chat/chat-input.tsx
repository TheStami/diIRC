import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Paperclip, Loader2, X, FileIcon, Command } from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
import { readFile } from "@tauri-apps/plugin-fs";
import { useNavigate } from "react-router-dom";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useModal } from "@/hooks/use-modal-store";
import { EmojiPicker } from "@/components/emoji-picker";
import { Member } from "@/types";
import { useMockStore, getServerSelfMember, getServerActiveNick } from "@/lib/mock-store";
import { getHighestChannelRole } from "@/components/user-role-icon";
import { uploadImage } from "@/lib/upload/services";
import { ImageContextMenu } from "@/components/image-context-menu";
import { isMediaUrl } from "@/lib/image-utils";
import { commandRegistry, expandCustomCommand, listSlashSuggestions } from "@/lib/commands/command-system";
import { useDraftStore, AttachedImage } from "@/hooks/use-draft-store";
import { formatCompatReply, replyTagOverheadBytes, useReplyStore } from "@/hooks/use-reply-store";

export const getIrcByteCount = (text: string): number => {
  if (!text) return 0;
  const ircMessage = text.replace(/\r?\n/g, "\u0085");
  return new TextEncoder().encode(ircMessage).length;
};

export const getIrcMaxMessageBytes = (
  target: string,
  nick?: string,
  username?: string,
  host?: string
): number => {
  const defaultNick = nick || "user";
  const defaultUser = username || defaultNick;
  const defaultHost = host || "localhost";
  const rawPrefix = `:${defaultNick}!${defaultUser}@${defaultHost} PRIVMSG ${target} :\r\n`;
  const overhead = new TextEncoder().encode(rawPrefix).length;
  return Math.max(0, 512 - overhead);
};

interface ChatInputProps {
  query: Record<string, string>;
  name: string;
  type: "conversation" | "channel";
}

const formSchema = z.object({
  content: z.string().optional().default(""),
});

export const ChatInput = ({
  query,
  name,
  type,
}: ChatInputProps) => {
  const addMessage = useMockStore((state) => state.addMessage);
  const addDirectMessage = useMockStore((state) => state.addDirectMessage);
  const servers = useMockStore((state) => state.servers);
  const currentProfile = useMockStore((state) => state.currentProfile);
  const uploadConfig = useMockStore((state) => state.uploadConfig);
  const ircConnectedServers = useMockStore((state) => state.ircConnectedServers);
  const enableCommandSuggestions = useMockStore((state) => state.enableCommandSuggestions ?? true);
  const { onOpen } = useModal();
  const navigate = useNavigate();

  const activeId = query?.channelId || query?.conversationId;

  const setDraft = useDraftStore((state) => state.setDraft);
  const getDraft = useDraftStore((state) => state.getDraft);
  const clearDraft = useDraftStore((state) => state.clearDraft);
  const pendingReply = useReplyStore((state) =>
    activeId ? state.pendingByChatId[activeId] : undefined
  );
  const clearPendingReply = useReplyStore((state) => state.clearPending);
  const rememberSentReply = useReplyStore((state) => state.rememberSent);

  const initialDraft = activeId ? getDraft(activeId) : { content: "", attachedImages: [] };

  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(initialDraft.attachedImages || []);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [showCommands, setShowCommands] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(true);

  const channelModesMap = useMockStore((state) => state.channelModes);
  const channelUserModesMap = useMockStore((state) => state.channelUserModes);
  
  const currentChannelModes = (type === "channel" && activeId) ? (channelModesMap[activeId] || []) : [];
  const isModerated = currentChannelModes.includes("m");

  const activeServer = query?.serverId ? servers.find((s) => s.id === query.serverId) : (servers[0] || null);

  let currentMember = activeServer ? getServerSelfMember(activeServer, currentProfile.id) : undefined;

  const primaryNick = activeServer ? getServerActiveNick(activeServer) : undefined;
  if (primaryNick && currentMember) {
    currentMember = {
      ...currentMember,
      profile: {
        ...currentMember.profile,
        name: primaryNick,
      },
    };
  }

  const currentUserModes = (type === "channel" && activeId && currentMember) ? (channelUserModesMap[activeId]?.[currentMember.profile.name.toLowerCase()] || []) : [];
  const hasVoiceOrHigher = getHighestChannelRole(currentUserModes) !== null;

  const isMuted = type === "channel" && isModerated && !hasVoiceOrHigher;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      content: initialDraft.content || "",
    }
  });

  const prevActiveIdRef = useRef<string | undefined>(undefined);
  const isSwitchingRef = useRef<boolean>(false);
  const attachedImagesRef = useRef(attachedImages);
  attachedImagesRef.current = attachedImages;

  const isIrcConnected = activeServer ? !!ircConnectedServers[activeServer.id] : true;
  const isUploading = attachedImages.some((img) => img.isUploading);
  const isLoading = isUploading || !isIrcConnected || isMuted;
  const isInputDisabled = !isIrcConnected || isMuted;

  const focusInput = useCallback(() => {
    textareaRef.current?.focus();
    setTimeout(() => {
      textareaRef.current?.focus();
      form.setFocus("content");
    }, 0);
  }, [form]);

  useEffect(() => {
    if (!activeId) return;

    isSwitchingRef.current = true;

    const prevId = prevActiveIdRef.current;
    if (prevId && prevId !== activeId) {
      const currentContent = form.getValues("content") || "";
      setDraft(prevId, {
        content: currentContent,
        attachedImages: attachedImagesRef.current,
      });
    }

    const draft = getDraft(activeId);
    form.reset({ content: draft.content || "" });
    setAttachedImages(draft.attachedImages || []);

    prevActiveIdRef.current = activeId;

    focusInput();

    const timer = setTimeout(() => {
      isSwitchingRef.current = false;
    }, 0);
    return () => clearTimeout(timer);
  }, [activeId, form, getDraft, setDraft, focusInput]);

  const content = form.watch("content") || "";

  const targetName = type === "channel" ? (name.startsWith("#") ? name : `#${name}`) : name;
  const currentNick = primaryNick || currentMember?.profile?.name || "You";
  const serverHost = activeServer?.host || "localhost";
  const serverUser = activeServer?.realname || currentNick;

  const maxBytes = getIrcMaxMessageBytes(targetName, currentNick, serverUser, serverHost);
  const wireBytesFor = useCallback(
    (text: string) => {
      if (!pendingReply || text.trim().startsWith("/")) {
        return getIrcByteCount(text);
      }
      const tagBytes = replyTagOverheadBytes(pendingReply.msgid);
      if (activeServer?.legacyReply) {
        const bodyBudget = Math.max(0, maxBytes - tagBytes);
        const wire = formatCompatReply(
          pendingReply.nick,
          pendingReply.preview,
          text,
          bodyBudget
        );
        return getIrcByteCount(wire) + tagBytes;
      }
      return getIrcByteCount(text) + tagBytes;
    },
    [pendingReply, maxBytes, activeServer?.legacyReply]
  );
  const currentBytes = wireBytesFor(content);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasteText = e.clipboardData.getData("text");
    if (!pasteText) return;

    const textarea = e.currentTarget;
    const selectionStart = textarea.selectionStart ?? 0;
    const selectionEnd = textarea.selectionEnd ?? 0;
    const currentVal = form.getValues("content") || "";

    const nextVal = currentVal.slice(0, selectionStart) + pasteText + currentVal.slice(selectionEnd);
    const nextBytes = wireBytesFor(nextVal);

    if (nextBytes > maxBytes) {
      e.preventDefault();
      onOpen("ircError", {
        title: "Message length limit exceeded",
        description: `Pasted message exceeds the maximum allowed limit of ${maxBytes} bytes (attempted paste size: ${nextBytes} bytes).`,
      });
    }
  };

  useEffect(() => {
    if (!activeId || isSwitchingRef.current) return;
    if (prevActiveIdRef.current !== activeId) return;

    setDraft(activeId, {
      content: content || "",
      attachedImages: attachedImages,
    });
  }, [content, attachedImages, activeId, setDraft]);

  useEffect(() => {
    const handleRestore = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string; content: string }>;
      if (customEvent.detail && customEvent.detail.id === activeId) {
        form.setValue("content", customEvent.detail.content);
        focusInput();
      }
    };
    const handleFocusInput = (e: Event) => {
      const customEvent = e as CustomEvent<{ chatId?: string }>;
      if (!customEvent.detail?.chatId || customEvent.detail.chatId === activeId) {
        focusInput();
      }
    };
    window.addEventListener("restore_unsent_message", handleRestore);
    window.addEventListener("focus_chat_input", handleFocusInput);
    return () => {
      window.removeEventListener("restore_unsent_message", handleRestore);
      window.removeEventListener("focus_chat_input", handleFocusInput);
    };
  }, [activeId, form, focusInput]);

  useEffect(() => {
    if (enableCommandSuggestions && isFocused && content?.startsWith("/")) {
      const active = query?.serverId
        ? servers.find((s) => s.id === query.serverId)
        : servers[0];
      const items = listSlashSuggestions(content, active?.customCommands);
      if (items.length > 0) {
        setShowCommands(true);
        setSelectedCommandIndex(0);
      } else {
        setShowCommands(false);
      }
    } else {
      setShowCommands(false);
    }
  }, [content, enableCommandSuggestions, isFocused, query?.serverId, servers]);

  const filteredCommands = (() => {
    if (!content?.startsWith("/")) return [];
    const active = query?.serverId
      ? servers.find((s) => s.id === query.serverId)
      : servers[0];
    return listSlashSuggestions(content, active?.customCommands);
  })();

  const removeAttachment = useCallback((id: string) => {
    setAttachedImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const clearAllAttachments = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
  }, []);

  const processFileUpload = useCallback(async (file: File) => {
    if (uploadConfig.provider === "disabled") {
      setUploadError("Uploading is disabled in settings. Enable an upload provider in Settings.");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    const id = `img-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const previewUrl = URL.createObjectURL(file);

    setAttachedImages((prev) => [
      ...prev,
      {
        id,
        previewUrl,
        name: file.name,
        isUploading: true,
      },
    ]);
    setUploadError(null);

    try {
      const url = await uploadImage(file, uploadConfig);
      setAttachedImages((prev) =>
        prev.map((item) => (item.id === id ? { ...item, url, isUploading: false } : item))
      );
      focusInput();
    } catch (err: any) {
      console.error("Upload error:", err);
      setUploadError(err?.message || "Failed to upload file.");
      setAttachedImages((prev) => prev.filter((item) => item.id !== id));
      URL.revokeObjectURL(previewUrl);
      setTimeout(() => setUploadError(null), 5000);
    }
  }, [uploadConfig, focusInput]);

  const processFilePathUpload = useCallback(async (filePath: string) => {
    if (uploadConfig.provider === "disabled") {
      setUploadError("Uploading is disabled in settings. Enable an upload provider in Settings.");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    try {
      const fileBytes = await readFile(filePath);
      const fileName = filePath.split(/[/\\]/).pop() || "file";
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      const mimeMap: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp",
        svg: "image/svg+xml",
        ico: "image/x-icon",
        mp4: "video/mp4",
        webm: "video/webm",
        mov: "video/quicktime",
        m4v: "video/x-m4v",
        mkv: "video/x-matroska",
        mp3: "audio/mpeg",
        wav: "audio/wav",
        ogg: "audio/ogg",
        pdf: "application/pdf",
        zip: "application/zip",
        rar: "application/vnd.rar",
        "7z": "application/x-7z-compressed",
        tar: "application/x-tar",
        gz: "application/gzip",
        txt: "text/plain",
        json: "application/json",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      };
      const mimeType = mimeMap[ext] || "application/octet-stream";

      const file = new File([fileBytes], fileName, { type: mimeType });
      await processFileUpload(file);
    } catch (err: any) {
      console.error("File path upload error:", err);
      setUploadError(err?.message || "Failed to upload file.");
      setTimeout(() => setUploadError(null), 5000);
    }
  }, [uploadConfig, processFileUpload]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach((img) => {
        if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
      });
    };
  }, []);

  const lastPasteTimeRef = useRef<number>(0);

  const processClipboardPaste = useCallback(async (pastedFile?: File) => {
    if (uploadConfig.provider === "disabled") return;

    const now = Date.now();
    if (now - lastPasteTimeRef.current < 300) return;
    lastPasteTimeRef.current = now;

    if (pastedFile) {
      await processFileUpload(pastedFile);
      return;
    }

    try {
      const clipImage = await readImage();
      if (!clipImage) return;

      const size = await clipImage.size();
      const rgbaData = await clipImage.rgba();
      if (!rgbaData || rgbaData.length === 0 || !size.width || !size.height) return;

      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const imgData = ctx.createImageData(size.width, size.height);
      imgData.data.set(rgbaData);
      ctx.putImageData(imgData, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const file = new File([blob], `clipboard-${Date.now()}.png`, { type: "image/png" });

      await processFileUpload(file);
    } catch (err: any) {
      console.debug("Clipboard paste (no image file):", err?.message);
    }
  }, [uploadConfig, processFileUpload]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupDragDrop = async () => {
      try {
        const appWindow = getCurrentWebviewWindow();
        unlisten = await appWindow.onDragDropEvent((event) => {
          if (event.payload.type === "drop") {
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              paths.forEach((path) => processFilePathUpload(path));
            }
          }
        });
      } catch (err) {
        console.error("Failed to setup drag-drop listener:", err);
      }
    };

    setupDragDrop();

    return () => {
      if (unlisten) unlisten();
    };
  }, [processFilePathUpload]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === "file") {
          const file = items[i].getAsFile();
          if (file) {
            processClipboardPaste(file);
            break;
          }
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "v") {
        setTimeout(() => {
          processClipboardPaste();
        }, 50);
      }
    };

    window.addEventListener("paste", handlePaste);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("paste", handlePaste);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [processClipboardPaste]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => processFileUpload(file));
    if (e.target) {
      e.target.value = "";
    }
  };

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const newHeight = Math.min(ta.scrollHeight, 120);
    ta.style.height = `${newHeight}px`;
  }, []);

  const createCommandContext = useCallback((onInputUpdated?: () => void) => {
    const activeServer = query?.serverId ? servers.find((s) => s.id === query.serverId) : (servers[0] || null);
    if (!activeServer) return null;

    const senderMember: Member = currentMember
      ? {
          ...currentMember,
          profile: {
            ...currentMember.profile,
            name: primaryNick || currentMember.profile.name,
          },
        }
      : {
          id: `self-${activeServer.id}`,
          profileId: currentProfile.id,
          profile: {
            ...currentProfile,
            name: primaryNick || currentProfile.name,
          },
          serverId: activeServer.id,
        };

    return {
      serverId: activeServer.id,
      channelName: name,
      channelId: query?.channelId,
      conversationId: query?.conversationId,
      targetMemberId: query?.targetMemberId,
      type,
      currentMember: senderMember,
      activeServer,
      addMessage,
      addDirectMessage,
      navigate,
      setInputContent: (newContent: string, cursorPosition?: number) => {
        if (onInputUpdated) onInputUpdated();
        form.setValue("content", newContent);
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            if (typeof cursorPosition === "number") {
              textareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
            }
          }
          autoResize();
        }, 0);
      },
    };
  }, [
    query,
    servers,
    currentMember,
    primaryNick,
    currentProfile,
    name,
    type,
    addMessage,
    addDirectMessage,
    navigate,
    form,
    autoResize,
  ]);

  const onCommandSelect = (insert: string) => {
    const trimmedInsert = insert.trim();
    if (trimmedInsert === "/code") {
      const currentContent = form.getValues("content") || "";
      let args = "";
      if (currentContent.toLowerCase().startsWith(`/code`)) {
        args = currentContent.slice(5).trim();
      }
      const ctx = createCommandContext();
      if (ctx) {
        commandRegistry.execute(`/code ${args}`, ctx);
      }
      setShowCommands(false);
      return;
    }

    form.setValue("content", insert);
    form.setFocus("content");
    setShowCommands(false);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCommandIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCommandIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      } else if (e.key === "Tab") {
        e.preventDefault();
        onCommandSelect(filteredCommands[selectedCommandIndex].insert);
        return;
      } else if (e.key === "Enter") {
        const selected = filteredCommands[selectedCommandIndex];
        if (content.trim() !== selected.insert.trim()) {
          e.preventDefault();
          onCommandSelect(selected.insert);
          return;
        }
        setShowCommands(false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
    }

    if (e.key === "Escape" && pendingReply && activeId) {
      e.preventDefault();
      clearPendingReply(activeId);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      const hasText = Boolean((form.getValues("content") || "").trim());
      const hasReadyImage = attachedImages.some((img) => !img.isUploading && img.url);
      if (!hasText && !hasReadyImage) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      form.handleSubmit(onSubmit)();
      return;
    }
  };

  useEffect(() => {
    autoResize();
  }, [content, autoResize]);

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    const textContent = values.content?.trim() || "";
    const readyImages = attachedImages.filter((img) => !img.isUploading && img.url);
    const replyTarget = activeId ? useReplyStore.getState().getPending(activeId) : undefined;

    if (attachedImages.some((img) => img.isUploading)) return;
    if (!textContent && readyImages.length === 0) return;

    const linesToSend: string[] = [];
    if (textContent) {
      linesToSend.push(textContent);
    }
    readyImages.forEach((img) => {
      if (img.url) linesToSend.push(img.url);
    });

    try {
      const activeServer = query?.serverId ? servers.find((s) => s.id === query.serverId) : servers[0];
      if (!activeServer) return;

      const isConnected = !!ircConnectedServers[activeServer.id];
      if (!isConnected) {
        onOpen("ircError");
        return;
      }

      const senderMember: Member = currentMember
        ? {
            ...currentMember,
            profile: {
              ...currentMember.profile,
              name: primaryNick || currentMember.profile.name,
            },
          }
        : {
            id: `self-${activeServer.id}`,
            profileId: currentProfile.id,
            profile: {
              ...currentProfile,
              name: primaryNick || currentProfile.name,
            },
            serverId: activeServer.id,
          };

      if (textContent.startsWith("/")) {
        let inputUpdated = false;
        const ctx = createCommandContext(() => {
          inputUpdated = true;
        });

        if (ctx) {
          const isHandled = await commandRegistry.execute(textContent, ctx);

          if (isHandled) {
            for (const img of readyImages) {
              if (img.url) {
                if (type === "channel" && query?.channelId) {
                  await invoke("send_message", {
                    serverId: activeServer.id,
                    channel: name.startsWith("#") ? name : `#${name}`,
                    message: img.url,
                    replyToMsgid: null,
                  replyNick: null,
                  replyPreview: null,
                  replyParentOffset: null,
                  }).catch((e) => console.error(e));
                  addMessage(query.channelId, senderMember, img.url);
                } else if (type === "conversation" && query?.conversationId) {
                  await invoke("send_message", {
                    serverId: activeServer.id,
                    channel: name,
                    message: img.url,
                    replyToMsgid: null,
                  replyNick: null,
                  replyPreview: null,
                  replyParentOffset: null,
                  }).catch((e) => console.error(e));
                  addDirectMessage(query.conversationId, senderMember, img.url);
                  if (query.targetMemberId) {
                    useMockStore.getState().addToHistoricalConversations(activeServer.id, query.targetMemberId);
                  }
                }
              }
            }
            if (!inputUpdated) {
              if (activeId) {
                clearDraft(activeId);
                clearPendingReply(activeId);
              }
              form.reset({ content: "" });
              clearAllAttachments();
              form.setFocus("content");
            }
            return;
          }

        }

        const expanded = expandCustomCommand(textContent, activeServer.customCommands);
        if (expanded !== null) {
          linesToSend.length = 0;
          linesToSend.push(expanded);
          readyImages.forEach((img) => {
            if (img.url) linesToSend.push(img.url);
          });
        }
      }

      if (activeId) {
        clearDraft(activeId);
        clearPendingReply(activeId);
      }
      form.reset({ content: "" });
      clearAllAttachments();
      focusInput();

      for (const line of linesToSend) {
        const targetName = type === "channel" ? (name.startsWith("#") ? name : `#${name}`) : name;

        const isReplyLineLocal =
          Boolean(replyTarget) &&
          Boolean(textContent) &&
          line === linesToSend[0] &&
          !textContent.startsWith("/");
        const replyMeta = isReplyLineLocal && replyTarget
          ? {
              replyToMsgid: replyTarget.msgid,
              replyTo: {
                messageId: replyTarget.messageId,
                nick: replyTarget.nick,
                preview: replyTarget.preview,
                msgid: replyTarget.msgid,
              },
            }
          : undefined;

        if (type === "channel" && query?.channelId) {
          const created = addMessage(query.channelId, senderMember, line, null, false, replyMeta);
          if (isReplyLineLocal && replyTarget) {
            rememberSentReply(created.id, replyTarget);
          }
        } else if (type === "conversation" && query?.conversationId) {
          const created = addDirectMessage(query.conversationId, senderMember, line, null, false, replyMeta);
          if (isReplyLineLocal && replyTarget) {
            rememberSentReply(created.id, replyTarget);
          }
          if (query.targetMemberId) {
            useMockStore.getState().addToHistoricalConversations(activeServer.id, query.targetMemberId);
          }
        }

        // Format message for IRC: replace newlines with NEL character (ASCII C1 Hex 85 / \u0085)
        const ircMessage = line.replace(/\r?\n/g, "\u0085");

        try {
          await invoke("send_message", {
            serverId: activeServer.id,
            channel: targetName,
            message: ircMessage,
            replyToMsgid: isReplyLineLocal ? replyTarget?.msgid ?? null : null,
          replyNick: isReplyLineLocal ? replyTarget?.nick ?? null : null,
          replyPreview: isReplyLineLocal ? replyTarget?.preview ?? null : null,
          replyParentOffset:
            isReplyLineLocal && replyTarget?.parentOffset != null
              ? replyTarget.parentOffset
              : null,
          legacyReply: activeServer.legacyReply ?? false,
          });
        } catch (err: any) {
          console.error("Failed to send message via Tauri IRC:", err);
          if (type === "channel" && query?.channelId) {
            useMockStore.getState().removeLastMessageFromChannel(query.channelId, senderMember.id);
          } else if (type === "conversation" && query?.conversationId) {
            useMockStore.getState().removeLastDirectMessageFromMember(query.conversationId, senderMember.id);
          }
          await invoke("delete_last_log_entry", {
            serverId: activeServer.id,
            target: targetName,
            sender: senderMember.profile.name,
          }).catch(() => {});
          form.setValue("content", textContent);
          return;
        }
      }

      // Safety net: make sure the composer regains keyboard focus once the
      // async send finishes (e.g. if anything grabbed focus mid-send).
      form.setFocus("content");
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} autoComplete="off">
        <input
          ref={fileInputRef}
          type="file"
          accept="*"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <div className="relative p-4 pb-6">
                  {pendingReply && (
                    <div className="mb-2 flex items-center gap-x-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2">
                      <div className="w-0.5 self-stretch rounded-full bg-indigo-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-indigo-500 dark:text-indigo-400">
                          Replying to {pendingReply.nick}
                        </p>
                        <p className="text-xs italic text-zinc-500 dark:text-zinc-400 truncate">
                          {pendingReply.preview}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => activeId && clearPendingReply(activeId)}
                        className="h-6 w-6 rounded-md text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 flex items-center justify-center transition"
                        title="Cancel reply"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {attachedImages.length > 0 && (
                    <div className="flex items-center gap-x-3 mb-2 overflow-x-auto pb-2 pt-1 px-1">
                      {attachedImages.map((img) => {
                        const isMedia = isMediaUrl(img.name);
                        return (
                          <div
                            key={img.id}
                            className="p-2 bg-zinc-200/90 dark:bg-zinc-800/90 rounded-xl flex items-center gap-x-3 relative group border border-zinc-300/80 dark:border-zinc-700/80 shadow-md transition-all"
                          >
                            <ImageContextMenu url={img.url || img.previewUrl} filename={img.name}>
                              <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-black/10 shrink-0 border border-zinc-300 dark:border-zinc-700 flex items-center justify-center">
                                {isMedia ? (
                                  <img
                                    src={img.previewUrl}
                                    alt={img.name}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <FileIcon className="w-7 h-7 text-indigo-500 dark:text-indigo-400" />
                                )}
                                {img.isUploading && (
                                  <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px] flex items-center justify-center">
                                    <Loader2 className="w-5 h-5 animate-spin text-white" />
                                  </div>
                                )}
                              </div>
                            </ImageContextMenu>
                            <div className="flex flex-col pr-5 max-w-[150px]">
                              <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                                {img.name}
                              </span>
                              <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                {img.isUploading ? "Uploading..." : "Ready"}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeAttachment(img.id)}
                              className="absolute -top-2 -right-2 h-6 w-6 bg-rose-500 hover:bg-rose-600 text-white rounded-full flex items-center justify-center transition shadow-lg z-10"
                              title="Remove attachment"
                            >
                              <X className="w-3.5 h-3.5 stroke-[2.5]" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {showCommands && filteredCommands.length > 0 && (
                    <div className="absolute bottom-full left-4 mb-2 w-80 bg-white dark:bg-[#2b2d31] border border-zinc-200 dark:border-zinc-800 rounded-md shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                      <div className="px-3 py-2 text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider bg-zinc-50 dark:bg-[#232428] border-b border-zinc-200 dark:border-zinc-800">
                        Commands matching {content?.startsWith("/") ? content.split(/\s/)[0] : "/"}
                      </div>
                      <div className="max-h-60 overflow-y-auto p-1">
                        {filteredCommands.map((cmd, idx) => (
                          <div
                            key={`${cmd.insert}-${idx}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              onCommandSelect(cmd.insert);
                            }}
                            className={`flex items-center gap-x-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                              idx === selectedCommandIndex
                                ? "bg-zinc-100 dark:bg-zinc-700/50"
                                : "hover:bg-zinc-100 dark:hover:bg-zinc-700/30"
                            }`}
                          >
                            <div className="bg-indigo-100 dark:bg-indigo-500/20 p-2 rounded-md shrink-0">
                              <Command className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                                {cmd.label}
                              </span>
                              <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                                {cmd.description}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="relative flex flex-col">
                    <Textarea
                      disabled={isInputDisabled}
                      autoFocus
                      className="min-h-[44px] max-h-[120px] w-full bg-zinc-200/90 dark:bg-zinc-700/75 border-none focus-visible:ring-0 focus-visible:ring-offset-0 text-zinc-600 dark:text-zinc-200 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 py-3 pr-36 resize-none overflow-y-auto disabled:opacity-60 disabled:cursor-not-allowed"
                      placeholder={
                        !isIrcConnected
                          ? "Disconnected from IRC server"
                          : isMuted
                          ? "You do not have permission to send messages in this moderated channel"
                          : isUploading
                          ? "Uploading files..."
                          : pendingReply
                          ? `Reply to ${pendingReply.nick}`
                          : `Message ${type === "conversation" ? name : "#" + name}`
                      }
                      rows={1}
                      {...field}
                      onChange={(e) => {
                        const newVal = e.target.value;
                        const bytes = wireBytesFor(newVal);
                        if (bytes <= maxBytes) {
                          field.onChange(e);
                        }
                      }}
                      onPaste={handlePaste}
                      ref={(e) => {
                        field.ref(e);
                        // @ts-ignore
                        textareaRef.current = e;
                      }}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                      onKeyDown={handleInputKeyDown}
                      onInput={autoResize}
                    />

                    <div className="absolute right-3 bottom-2 z-10 flex items-center gap-x-2">
                      <div
                        className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded transition-colors select-none ${
                          currentBytes >= maxBytes
                            ? "bg-rose-500 text-white font-bold shadow-sm"
                            : "bg-zinc-300/60 dark:bg-zinc-800/80 text-zinc-500 dark:text-zinc-400"
                        }`}
                        title={`IRC message byte limit: ${currentBytes} / ${maxBytes} bytes`}
                      >
                        {currentBytes}/{maxBytes}
                      </div>

                      <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => fileInputRef.current?.click()}
                        className="h-7 w-7 text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition flex items-center justify-center rounded-md hover:bg-zinc-300/50 dark:hover:bg-zinc-600/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Attach files (System dialog)"
                      >
                        {isUploading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                        ) : (
                          <Paperclip className="w-4 h-4" />
                        )}
                      </button>

                      <EmojiPicker
                        disabled={isLoading}
                        onChange={(emoji: string) => {
                          const currentVal = field.value || "";
                          const newText = `${currentVal ? currentVal + " " : ""}${emoji}`;
                          const bytes = wireBytesFor(newText);
                          if (bytes <= maxBytes) {
                            field.onChange(newText);
                            form.setFocus("content");
                          } else {
                            onOpen("ircError", {
                              title: "Message length limit exceeded",
                              description: `Adding this emoji would exceed the maximum allowed message limit of ${maxBytes} bytes.`,
                            });
                          }
                        }}
                      />
                    </div>
                  </div>

                  {uploadError && (
                    <div className="mt-1 text-[11px] font-semibold text-rose-500 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 truncate max-w-[80%]">
                      ⚠️ {uploadError}
                    </div>
                  )}
                </div>
              </FormControl>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
};
