import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Send,
  Pause,
  Trash2,
  Bot,
  Image,
  Smile,
  FileText,
  X,
  Filter,
  CalendarDays,
  Tag,
  Megaphone,
  Play,
  Music,
  Video as VideoIcon,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

const COMMON_EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇",
  "🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚",
  "😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩",
  "🥳","😏","😒","😞","😔","😟","😕","🙁","☹️","😣",
  "😖","😫","😩","🥺","😢","😭","😤","😠","😡","🤬",
  "🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗",
  "🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯",
  "😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐",
  "🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈",
  "👿","👹","👺","🤡","💩","👻","💀","☠️","👽","👾",
  "🤖","🎃","😺","😸","😹","😻","😼","😽","🙀","😿",
  "😾","🙈","🙉","🙊","💋","💌","💘","💝","💖","💗",
  "💓","💞","💕","💟","❣️","💔","❤️","🧡","💛","💚",
  "💙","💜","🤎","🖤","🤍","💯","💢","💥","💫","💦",
  "💨","🕳️","💣","💬","👋","🤚","✋","🖖","👌","🤌",
  "🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕",
  "👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌",
];

type DbMessage = {
  id: string;
  user_id: string | null;
  platform: string | null;
  from_number: string | null;
  message: string | null;
  message_type: string | null;
  media_url: string | null;
  is_processed: boolean | null;
  created_at?: string;
};

type Chat = {
  number: string;
  lastMsg: string;
  time: string;
  date: string;
  unread: number;
  tag?: string;
};

type Message = {
  id: string;
  from: "in" | "out";
  text: string;
  time: string;
  date: string;
  badge?: string;
  mediaUrl?: string;
  mediaType?: string;
};

type FullTemplate = {
  id: string;
  name: string;
  content: string;
  media_url: string | null;
  media_type: string | null;
  variables: any;
};

type DbTag = { id: string; name: string; color: string };

function isOutgoingType(type?: string | null) {
  return !!type && type.startsWith("out_");
}

function getDisplayType(type?: string | null) {
  if (!type) return undefined;
  if (type.startsWith("out_")) return type.replace("out_", "");
  return type;
}

function formatMessageTime(date: Date) {
  return format(date, "HH:mm");
}

function formatMessageDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

// Convierte hex → rgba con opacidad para fondos suaves
function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace("#", "");
  const bigint = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function InboxPage() {
  const { user } = useAuth();

  const [selectedChatNumber, setSelectedChatNumber] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterDateFrom, setFilterDateFrom] = useState<Date | undefined>(new Date());
  const [filterDateTo, setFilterDateTo] = useState<Date | undefined>(new Date());
  const [showFilters, setShowFilters] = useState(false);

  const [dbMessages, setDbMessages] = useState<DbMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<FullTemplate[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ file: File; preview: string; type: string } | null>(null);
  const [selectedTemplateMedia, setSelectedTemplateMedia] = useState<{ url: string; type: string } | null>(null);

  const [allTags, setAllTags] = useState<DbTag[]>([]);
  const [contactTagsMap, setContactTagsMap] = useState<Record<string, string[]>>({});
  const [convoTagsMap, setConvoTagsMap] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Helper: obtener color de una etiqueta por nombre
  const getTagColor = (name?: string) => {
    if (!name) return "#64748B";
    return allTags.find(t => t.name === name)?.color || "#64748B";
  };

  const loadAllTags = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("tags")
      .select("id, name, color")
      .eq("user_id", user.id)
      .order("name");
    setAllTags((data || []) as DbTag[]);
  };

  const loadAssignments = async () => {
    if (!user) return;
    const { data: assigns } = await supabase
      .from("contact_tags")
      .select("contact_id, tags(name)")
      .eq("user_id", user.id);
    const map: Record<string, string[]> = {};
    (assigns || []).forEach((a: any) => {
      const tagName = a.tags?.name;
      if (!tagName) return;
      if (!map[a.contact_id]) map[a.contact_id] = [];
      map[a.contact_id].push(tagName);
    });
    setContactTagsMap(map);

    const { data: convos } = await supabase
      .from("conversation_settings")
      .select("phone, tag");
    const cmap: Record<string, string> = {};
    (convos || []).forEach((c: any) => {
      if (c.phone && c.tag) cmap[c.phone] = c.tag;
    });
    setConvoTagsMap(cmap);
  };

  useEffect(() => {
    const loadTemplates = async () => {
      if (!user) return;
      const { data, error } = await supabase
        .from("templates")
        .select("id, name, content, media_url, media_type, variables")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error cargando plantillas:", error);
        return;
      }
      setAvailableTemplates((data || []) as FullTemplate[]);
    };
    loadTemplates();
    loadAllTags();
    loadAssignments();
  }, [user]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojis(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectTemplate = (template: FullTemplate) => {
    setMessageInput(template.content || "");
    if (template.media_url && template.media_type) {
      setSelectedTemplateMedia({ url: template.media_url, type: template.media_type });
      setSelectedFile(null);
    } else {
      setSelectedTemplateMedia(null);
    }
    setShowTemplates(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = file.type.startsWith("video/") ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({
        title: "Archivo muy grande",
        description: `El archivo no puede superar ${maxSize / (1024 * 1024)}MB`,
        variant: "destructive",
      });
      return;
    }

    const fileType = file.type.startsWith("image/") ? "image" :
                     file.type.startsWith("video/") ? "video" :
                     file.type.startsWith("audio/") ? "audio" : "document";

    setSelectedFile({ file, preview: URL.createObjectURL(file), type: fileType });
    setSelectedTemplateMedia(null);
    e.target.value = "";
  };

  const addEmoji = (emoji: string) => {
    setMessageInput(prev => prev + emoji);
    setShowEmojis(false);
  };

  // Carga mensajes del rango de fechas seleccionado (por defecto hoy).
  const loadMessages = async (from_date?: Date, to_date?: Date) => {
    if (!user) {
      setDbMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const startDate = from_date ?? filterDateFrom ?? new Date();
    const endDate = to_date ?? filterDateTo ?? startDate;

    const rangeStart = new Date(startDate);
    rangeStart.setHours(0, 0, 0, 0);
    const rangeEnd = new Date(endDate);
    rangeEnd.setHours(23, 59, 59, 999);

    const PAGE_SIZE = 1000;
    let allMessages: DbMessage[] = [];
    let offset = 0;
    let keepGoing = true;

    try {
      while (keepGoing) {
        const { data, error } = await supabase
          .from("received_messages")
          .select("*")
          .eq("user_id", user.id)
          .gte("created_at", rangeStart.toISOString())
          .lte("created_at", rangeEnd.toISOString())
          .order("created_at", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) {
          console.error("Error cargando mensajes:", error);
          keepGoing = false;
          break;
        }

        const batch = (data || []) as DbMessage[];
        allMessages = allMessages.concat(batch);

        if (batch.length < PAGE_SIZE) {
          keepGoing = false;
        } else {
          offset += PAGE_SIZE;
        }
      }
    } catch (err) {
      console.error("Error cargando mensajes:", err);
    }

    setDbMessages(allMessages);
    setLoading(false);
  };

  useEffect(() => {
    loadMessages(filterDateFrom, filterDateTo);
    const channel = supabase
      .channel("received_messages_realtime_inbox_pro")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "received_messages" },
        () => { loadMessages(filterDateFrom, filterDateTo); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, filterDateFrom, filterDateTo]);

  const chatSearchIndex = useMemo(() => {
    const idx = new Map<string, string>();
    for (const msg of dbMessages) {
      const number = msg.from_number || "Sin número";
      const prev = idx.get(number) || "";
      idx.set(number, prev + " " + (msg.message || "").toLowerCase());
    }
    return idx;
  }, [dbMessages]);

  const chats = useMemo<Chat[]>(() => {
    const grouped = new Map<string, DbMessage[]>();
    for (const msg of dbMessages) {
      const number = msg.from_number || "Sin número";
      if (!grouped.has(number)) grouped.set(number, []);
      grouped.get(number)!.push(msg);
    }

    return Array.from(grouped.entries()).map(([number, messages]) => {
      const ordered = [...messages].sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
      });
      const last = ordered[0];
      const lastDate = last?.created_at ? new Date(last.created_at) : new Date();

      const ct = contactTagsMap[number];
      const tag = (ct && ct.length > 0) ? ct[0] : convoTagsMap[number];

      return {
        number,
        lastMsg: last?.message || "",
        time: format(lastDate, "HH:mm"),
        date: format(lastDate, "yyyy-MM-dd"),
        unread: messages.filter((m) => !m.is_processed && !isOutgoingType(m.message_type)).length,
        tag,
      };
    });
  }, [dbMessages, contactTagsMap, convoTagsMap]);

  const filteredChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return chats.filter((chat) => {
      if (q) {
        const numberMatch = chat.number.toLowerCase().includes(q);
        const lastMsgMatch = chat.lastMsg.toLowerCase().includes(q);
        const historyMatch = (chatSearchIndex.get(chat.number) || "").includes(q);
        if (!numberMatch && !lastMsgMatch && !historyMatch) return false;
      }

      if (filterTag) {
        const tagsForChat = contactTagsMap[chat.number] || [];
        const hasTag = tagsForChat.includes(filterTag) || chat.tag === filterTag;
        if (!hasTag) return false;
      }
      if (filterDateFrom || filterDateTo) {
        const chatDate = chat.date;
        if (filterDateFrom && chatDate < format(filterDateFrom, "yyyy-MM-dd")) return false;
        if (filterDateTo && chatDate > format(filterDateTo, "yyyy-MM-dd")) return false;
      }

      return true;
    });
  }, [chats, searchQuery, filterTag, filterDate, contactTagsMap, chatSearchIndex]);

  const selectedNumber = selectedChatNumber;

  const selectedChatData = useMemo(() => {
    if (!selectedNumber) return null;
    return filteredChats.find((chat) => chat.number === selectedNumber) || null;
  }, [filteredChats, selectedNumber]);

  const currentMessages = useMemo<Message[]>(() => {
    if (!selectedNumber) return [];
    const chatMessages = dbMessages.filter((msg) => msg.from_number === selectedNumber);

    const sortedMessages = [...chatMessages].sort((a, b) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateA - dateB;
    });

    return sortedMessages.map((msg) => {
      let mediaType = msg.message_type || "";
      const mediaUrl = msg.media_url;
      const msgDate = msg.created_at ? new Date(msg.created_at) : new Date();

      if (mediaType.includes("image")) mediaType = "image";
      else if (mediaType.includes("video")) mediaType = "video";
      else if (mediaType.includes("audio")) mediaType = "audio";
      else if (mediaUrl) {
        const ext = mediaUrl.split(".").pop()?.toLowerCase();
        if (ext === "mp3" || ext === "ogg" || ext === "wav") mediaType = "audio";
        else if (ext === "mp4" || ext === "webm") mediaType = "video";
        else if (ext === "jpg" || ext === "png" || ext === "jpeg" || ext === "gif") mediaType = "image";
      }

      return {
        id: msg.id,
        from: isOutgoingType(msg.message_type) ? "out" : "in",
        text: msg.message || "",
        time: formatMessageTime(msgDate),
        date: formatMessageDate(msgDate),
        badge: getDisplayType(msg.message_type),
        mediaUrl: msg.media_url || undefined,
        mediaType: mediaType || undefined,
      };
    });
  }, [dbMessages, selectedNumber]);

  useEffect(() => {
    if (filteredChats.length === 0) {
      if (selectedChatNumber !== null) setSelectedChatNumber(null);
      return;
    }

    const selectedExists = filteredChats.some((chat) => chat.number === selectedChatNumber);
    if (!selectedChatNumber || !selectedExists) {
      setSelectedChatNumber(filteredChats[0].number);
    }
  }, [filteredChats, selectedChatNumber]);

  useEffect(() => {
    const markAsProcessed = async () => {
      if (!selectedNumber) return;
      const idsToUpdate = dbMessages
        .filter((msg) => msg.from_number === selectedNumber && !msg.is_processed && !isOutgoingType(msg.message_type))
        .map((msg) => msg.id);

      if (idsToUpdate.length === 0) return;

      const { error } = await supabase
        .from("received_messages")
        .update({ is_processed: true })
        .in("id", idsToUpdate);

      if (error) {
        console.error("Error marcando mensajes como leídos:", error);
      } else {
        setDbMessages((prev) =>
          prev.map((msg) => (idsToUpdate.includes(msg.id) ? { ...msg, is_processed: true } : msg))
        );
      }
    };
    markAsProcessed();
  }, [selectedNumber, dbMessages]);

  const clearFilters = () => {
    setFilterTag(null);
    setFilterDateFrom(new Date());
    setFilterDateTo(new Date());
  };

  const hasActiveFilters = !!(filterTag || filterDateFrom || filterDateTo);

  // ============================================================
  // 🔧 FUNCIÓN CORREGIDA - NO BLOQUEA SI NO HAY tenant_id
  // ============================================================
  const handleSendMessage = async () => {
    if (!selectedNumber) {
      toast({ title: "Selecciona un chat", description: "Primero selecciona un chat para responder.", variant: "destructive" });
      return;
    }

    if (!user?.id) {
      toast({ title: "Sesión inválida", description: "Vuelve a iniciar sesión para enviar mensajes.", variant: "destructive" });
      return;
    }

    if (!messageInput.trim() && !selectedFile && !selectedTemplateMedia) {
      toast({ title: "Mensaje vacío", description: "Escribe un mensaje, selecciona un archivo o una plantilla.", variant: "destructive" });
      return;
    }

    try {
      setSending(true);

      // ✅ Obtener perfil sin romper si no existe tenant_id
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("tenant_id, connection_type")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        console.warn("⚠️ No se pudo leer profiles, se enviará solo con user_id:", profileError);
      }

      const textToSend = messageInput.trim();
      let mediaUrl: string | null = null;
      let mediaType: string | null = null;

      if (selectedFile) {
        const fileExt = selectedFile.file.name.split(".").pop();
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;
        const folder = selectedFile.type === "image" ? "images" : selectedFile.type === "video" ? "videos" : "others";
        const filePath = `${folder}/${fileName}`;

        const { error: uploadError } = await supabase.storage.from("templates-media").upload(filePath, selectedFile.file);
        if (uploadError) throw new Error(`Error subiendo archivo: ${uploadError.message}`);

        const { data: { publicUrl } } = supabase.storage.from("templates-media").getPublicUrl(filePath);
        mediaUrl = publicUrl;
        mediaType = selectedFile.type;
      } else if (selectedTemplateMedia) {
        mediaUrl = selectedTemplateMedia.url;
        mediaType = selectedTemplateMedia.type;
      }

      // ✅ Payload flexible: manda tenant_id si existe, pero NO bloquea si está vacío
      const payload: any = {
        user_id: user.id,
        tenant_id: profile?.tenant_id ?? null,
        connection_type: profile?.connection_type ?? null,
        to: selectedNumber,
        message: textToSend,
      };

      if (mediaUrl && mediaType) {
        payload.media_url = mediaUrl;
        payload.media_type = mediaType;
      }

      console.log("📤 Enviando mensaje con payload:", {
        ...payload,
        message: payload.message?.substring(0, 50),
      });

      const response = await fetch("/api/send-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const rawText = await response.text();
      let result: any = {};

      try {
        result = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(rawText || "La API devolvió una respuesta inválida");
      }

      if (!response.ok) {
        throw new Error(result?.error || "No se pudo enviar el mensaje");
      }

      setMessageInput("");
      setSelectedFile(null);
      setSelectedTemplateMedia(null);
      await loadMessages();

      toast({ title: "✅ Mensaje enviado", description: "La respuesta se envió correctamente por WhatsApp." });
    } catch (error: any) {
      console.error("Error enviando mensaje:", error);
      toast({ title: "Error al enviar", description: error?.message || "No se pudo enviar el mensaje.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };
  // ============================================================

  const handlePauseAI = async () => {
    if (!selectedNumber) return;
    const { data: existing } = await supabase
      .from("conversation_settings")
      .select("ai_paused")
      .eq("phone", selectedNumber)
      .maybeSingle();
    const next = !(existing?.ai_paused ?? false);
    const { error } = await supabase
      .from("conversation_settings")
      .upsert({ phone: selectedNumber, ai_paused: next }, { onConflict: "phone" });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: next ? "🔇 IA pausada" : "🔊 IA reactivada" });
  };

  const handleForceAI = async () => {
    if (!selectedNumber) return;
    const { error } = await supabase
      .from("conversation_settings")
      .upsert({ phone: selectedNumber, ai_paused: false, force_ai: true }, { onConflict: "phone" });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "🤖 IA forzada", description: "Responderá el próximo mensaje." });
  };

  const handleDeleteChat = async () => {
    if (!selectedNumber) return;
    if (!window.confirm(`¿Eliminar todos los mensajes de ${selectedNumber}?`)) return;
    const { error } = await supabase.from("received_messages").delete().eq("from_number", selectedNumber);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "🗑️ Conversación eliminada" });
    await loadMessages();
    setSelectedChatNumber(null);
  };

  const handleClearChat = async () => {
    if (!selectedNumber) return;
    if (!window.confirm(`¿Limpiar mensajes de ${selectedNumber}?`)) return;
    const { error } = await supabase.from("received_messages").delete().eq("from_number", selectedNumber);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "🧹 Chat limpiado" });
    await loadMessages();
  };

  const assignTagToContact = async (contactId: string, tagName: string) => {
    if (!user || !contactId || !tagName) return;
    const tag = allTags.find((t) => t.name === tagName);
    if (!tag) { console.warn(`⚠️ Etiqueta "${tagName}" no existe en tabla tags`); return; }
    const { error } = await supabase
      .from("contact_tags")
      .upsert(
        { contact_id: contactId, tag_id: tag.id, user_id: user.id },
        { onConflict: "contact_id,tag_id,user_id" }
      );
    if (error) console.error("contact_tags upsert error:", error);
    else await loadAssignments();
  };

  const handleMarkSale = async (saleType: "normal" | "web") => {
    if (!selectedNumber) return;
    const tag = saleType === "normal" ? "venta normal cargada" : "venta web cargada";
    const { error } = await supabase
      .from("conversation_settings")
      .upsert({ phone: selectedNumber, tag, sale_type: saleType }, { onConflict: "phone" });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await assignTagToContact(selectedNumber, tag);
    toast({ title: saleType === "normal" ? "✏️ Venta Normal marcada" : "🌐 Venta Web marcada" });
  };

  const handleSetTag = async (tag: string) => {
    if (!selectedNumber || !tag) return;
    const { error } = await supabase
      .from("conversation_settings")
      .upsert({ phone: selectedNumber, tag }, { onConflict: "phone" });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    await assignTagToContact(selectedNumber, tag);
    toast({ title: `🏷️ Etiqueta: ${tag}` });
  };

  const renderMedia = (mediaUrl?: string, mediaType?: string, messageText?: string) => {
    if (!mediaUrl) return null;

    if (mediaType === "image" || mediaUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)) {
      return (
        <div className="mb-2">
          <img
            src={mediaUrl}
            alt="media"
            className="rounded-lg max-w-full max-h-64 cursor-pointer hover:opacity-90 transition-opacity"
            onClick={() => window.open(mediaUrl, "_blank")}
          />
        </div>
      );
    }
    if (mediaType === "video" || mediaUrl.match(/\.(mp4|webm|mov)/i)) {
      return (
        <div className="mb-2">
          <video src={mediaUrl} controls className="rounded-lg max-w-full max-h-64" />
        </div>
      );
    }
    if (mediaType === "audio" || mediaUrl.match(/\.(mp3|ogg|wav|m4a)/i)) {
      return (
        <div className="mb-2">
          <div className="flex items-center gap-2 bg-secondary/30 rounded-lg p-2">
            <Music className="w-4 h-4 text-muted-foreground" />
            <audio src={mediaUrl} controls className="flex-1 h-8" />
          </div>
          {messageText && <p className="text-sm mt-1">{messageText}</p>}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex h-[calc(100dvh-48px)] max-h-[calc(100dvh-48px)] min-h-0 bg-background overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="border-b border-border/40 px-6 py-4 flex items-center gap-3 shrink-0">
          <div className="w-1 h-10 bg-primary rounded-full" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Inbox Profesional</h1>
            <p className="text-xs text-muted-foreground">WhatsApp Business integrado</p>
          </div>
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-success/10 text-success border border-success/20">
            {filteredChats.length} activos
          </span>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="border-b border-border/40 px-6 py-3 flex items-center gap-3 shrink-0">
              <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-xs font-semibold text-primary">
                {selectedChatData?.number?.slice(-2) || "--"}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium">
                  {selectedChatData?.number || "Sin chat seleccionado"}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={handlePauseAI} className="p-2 rounded-lg hover:bg-secondary/60" title="Pausar/reanudar IA">
                  <Pause className="w-4 h-4 text-muted-foreground" />
                </button>
                <button onClick={handleForceAI} className="p-2 rounded-lg hover:bg-secondary/60" title="Forzar IA">
                  <Bot className="w-4 h-4 text-muted-foreground" />
                </button>
                <button onClick={handleDeleteChat} className="p-2 rounded-lg hover:bg-destructive/10" title="Eliminar conversación">
                  <Trash2 className="w-4 h-4 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            </div>

            <div className="border-b border-border/40 px-6 py-2.5 flex items-center gap-2 flex-wrap shrink-0">
              <button onClick={() => handleMarkSale("normal")} className="text-[11px] px-3 py-1.5 rounded-lg bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-all font-medium">
                ✏️ Venta Normal
              </button>
              <button onClick={() => handleMarkSale("web")} className="text-[11px] px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-all font-medium">
                🌐 Venta Web
              </button>
              <button onClick={handleClearChat} className="text-[11px] px-3 py-1.5 rounded-lg bg-secondary/40 text-foreground border border-border/40 hover:bg-secondary/60 transition-all font-medium">
                🧹 Limpiar
              </button>

              <select
                onChange={(e) => { if (e.target.value) { handleSetTag(e.target.value); e.target.value = ""; } }}
                defaultValue=""
                className="ml-auto text-[11px] bg-secondary/40 border border-border/40 rounded-lg px-2.5 py-1.5 text-muted-foreground focus:outline-none focus:border-primary/30"
              >
                <option value="">Etiquetar...</option>
                {allTags.map((t) => (
                  <option key={t.id} value={t.name} style={{ backgroundColor: hexToRgba(t.color, 0.2), color: t.color }}>
                    ● {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4 space-y-3">
              {loading ? (
                <p className="text-sm text-muted-foreground text-center">Cargando mensajes...</p>
              ) : currentMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center">No hay mensajes para este chat.</p>
              ) : (
                currentMessages.map((msg, idx) => {
                  const prevDate = idx > 0 ? currentMessages[idx - 1].date : null;
                  const showDateSeparator = idx === 0 || msg.date !== prevDate;
                  return (
                    <div key={msg.id}>
                      {showDateSeparator && (
                        <div className="flex justify-center my-3">
                          <span className="text-[10px] px-3 py-1 rounded-full bg-secondary/50 text-muted-foreground">
                            {format(new Date(msg.date), "EEEE, d 'de' MMMM yyyy", { locale: es })}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${msg.from === "out" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${msg.from === "out" ? "bg-primary text-primary-foreground" : "bg-secondary/60"}`}>
                          {renderMedia(msg.mediaUrl, msg.mediaType, msg.text)}
                          {msg.text && msg.mediaType !== "audio" && (
                            <p className="text-sm whitespace-pre-wrap break-words">{msg.text}</p>
                          )}
                          <div className="flex items-center gap-1.5 mt-1 text-[10px] opacity-70">
                            <span>{msg.time}</span>
                            {msg.badge && <span className="px-1.5 py-0.5 rounded bg-black/10">{msg.badge}</span>}
                            {msg.from === "out" && <span>✓✓</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="border-t border-border/40 p-4 shrink-0">
              {selectedFile && (
                <div className="mb-2 flex items-center gap-2 bg-secondary/40 rounded-lg p-2">
                  <div className="flex items-center gap-2 flex-1 text-xs">
                    {selectedFile.type === "image" && <Image className="w-4 h-4" />}
                    {selectedFile.type === "video" && <VideoIcon className="w-4 h-4" />}
                    <span>{selectedFile.file.name}</span>
                  </div>
                  <button onClick={() => setSelectedFile(null)} className="p-1 hover:bg-destructive/20 rounded">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {selectedTemplateMedia && !selectedFile && (
                <div className="mb-2 flex items-center gap-2 bg-secondary/40 rounded-lg p-2">
                  <div className="flex items-center gap-2 flex-1 text-xs">
                    {selectedTemplateMedia.type === "image" && <Image className="w-4 h-4" />}
                    {selectedTemplateMedia.type === "video" && <VideoIcon className="w-4 h-4" />}
                    <span>Multimedia de plantilla</span>
                  </div>
                  <button onClick={() => setSelectedTemplateMedia(null)} className="p-1 hover:bg-destructive/20 rounded">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              <div className="relative" ref={emojiPickerRef}>
                {showEmojis && (
                  <div className="absolute bottom-14 left-0 z-50 bg-card border border-border rounded-xl shadow-xl p-3 w-80 max-h-64 overflow-y-auto">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-semibold">Emojis</span>
                      <button onClick={() => setShowEmojis(false)} className="p-1 rounded hover:bg-secondary/60">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="grid grid-cols-10 gap-1">
                      {COMMON_EMOJIS.map((emoji) => (
                        <button key={emoji} onClick={() => addEmoji(emoji)} className="text-xl p-1 hover:bg-primary/10 rounded">
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {showTemplates && (
                <div className="absolute bottom-20 left-6 z-50 bg-card border border-border rounded-xl shadow-xl w-80 max-h-80 overflow-y-auto">
                  <div className="flex justify-between items-center px-4 py-2 border-b border-border/30">
                    <span className="text-sm font-semibold">📋 Plantillas</span>
                    <button onClick={() => setShowTemplates(false)} className="p-1 rounded-lg hover:bg-secondary/60">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div>
                    {availableTemplates.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No hay plantillas. Crealas en Plantillas.</p>
                    ) : (
                      availableTemplates.map((tpl) => (
                        <button
                          key={tpl.id}
                          onClick={() => handleSelectTemplate(tpl)}
                          className="w-full text-left px-4 py-3 hover:bg-primary/5 border-b border-border/20 last:border-0"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            {tpl.media_type === "image" && <Image className="w-3 h-3" />}
                            {tpl.media_type === "video" && <VideoIcon className="w-3 h-3" />}
                            {tpl.media_type === "audio" && <Music className="w-3 h-3" />}
                            <span className="text-sm font-medium">{tpl.name}</span>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">{tpl.content || "Sin contenido"}</p>
                          {tpl.media_url && <p className="text-[10px] text-primary mt-1">📎 Con multimedia</p>}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 min-w-0">
                <input ref={fileInputRef} type="file" hidden onChange={handleFileSelect} accept="image/*,video/*,audio/*" />
                <button onClick={() => fileInputRef.current?.click()} className="p-2.5 rounded-xl hover:bg-secondary/50 text-muted-foreground hover:text-foreground" title="Subir archivo">
                  <Image className="w-4 h-4" />
                </button>
                <button onClick={() => setShowEmojis(!showEmojis)} className={`p-2.5 rounded-xl ${showEmojis ? "bg-primary/10 text-primary" : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"}`} title="Emojis">
                  <Smile className="w-4 h-4" />
                </button>
                <button onClick={() => setShowTemplates(!showTemplates)} className={`p-2.5 rounded-xl ${showTemplates ? "bg-primary/10 text-primary" : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"}`} title="Plantillas">
                  <FileText className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  placeholder="Escribe tu mensaje aquí..."
                  className="flex-1 min-w-0 bg-secondary/40 border border-border/40 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/40"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !sending) handleSendMessage(); }}
                />
                <button onClick={handleSendMessage} disabled={sending} className="p-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* SIDEBAR DE CHATS */}
          <div className="w-80 border-l border-border/40 flex flex-col min-h-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 shrink-0">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold">Chats Recientes</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`p-1.5 rounded-lg relative ${showFilters || hasActiveFilters ? "bg-primary/10 text-primary" : "hover:bg-secondary/60 text-muted-foreground"}`}
                    title="Filtros"
                  >
                    <Filter className="w-3.5 h-3.5" />
                    {hasActiveFilters && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />}
                  </button>
                  <span className="text-[11px] text-muted-foreground">{filteredChats.length}</span>
                </div>
              </div>

              <AnimatePresence>
                {showFilters && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-3">
                    <div className="space-y-3 p-3 bg-secondary/20 rounded-lg">
                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
                          <Tag className="w-3 h-3" /> Etiqueta
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {allTags.map((tag) => {
                            const active = filterTag === tag.name;
                            return (
                              <button
                                key={tag.id}
                                onClick={() => setFilterTag(active ? null : tag.name)}
                                className="text-[10px] px-2.5 py-1 rounded-lg border transition-all"
                                style={{
                                  backgroundColor: active ? hexToRgba(tag.color, 0.25) : hexToRgba(tag.color, 0.1),
                                  color: tag.color,
                                  borderColor: active ? tag.color : hexToRgba(tag.color, 0.3),
                                  fontWeight: active ? 600 : 400,
                                }}
                              >
                                ● {tag.name}
                              </button>
                            );
                          })}
                          {allTags.length === 0 && (
                            <span className="text-[10px] text-muted-foreground">No hay etiquetas. Creá en pestaña Etiquetas.</span>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground uppercase mb-1.5">
                          <CalendarDays className="w-3 h-3" /> Rango de fechas
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-10 shrink-0">Desde</span>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="flex-1 text-[11px] px-3 py-1.5 rounded-lg bg-secondary/40 border border-border/40 text-left text-muted-foreground hover:bg-secondary/60">
                                  {filterDateFrom ? format(filterDateFrom, "d MMM yyyy", { locale: es }) : "Fecha inicio..."}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={filterDateFrom}
                                  onSelect={(d) => {
                                    setFilterDateFrom(d);
                                    if (d && filterDateTo && d > filterDateTo) setFilterDateTo(d);
                                  }}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground w-10 shrink-0">Hasta</span>
                            <Popover>
                              <PopoverTrigger asChild>
                                <button className="flex-1 text-[11px] px-3 py-1.5 rounded-lg bg-secondary/40 border border-border/40 text-left text-muted-foreground hover:bg-secondary/60">
                                  {filterDateTo ? format(filterDateTo, "d MMM yyyy", { locale: es }) : "Fecha fin..."}
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={filterDateTo}
                                  onSelect={(d) => {
                                    setFilterDateTo(d);
                                    if (d && filterDateFrom && d < filterDateFrom) setFilterDateFrom(d);
                                  }}
                                  disabled={(d) => filterDateFrom ? d < filterDateFrom : false}
                                  initialFocus
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>
                      </div>

                      {hasActiveFilters && (
                        <button onClick={clearFilters} className="w-full text-[10px] py-1.5 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20">
                          ✕ Limpiar filtros
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Buscar por nombre, número o texto..."
                  className="w-full pl-9 pr-3 py-2 text-xs bg-secondary/40 border border-border/40 rounded-lg focus:outline-none focus:border-primary/40"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {filteredChats.map((chat) => {
                const tagColor = getTagColor(chat.tag);
                return (
                  <button
                    key={chat.number}
                    onClick={() => setSelectedChatNumber(chat.number)}
                    className={`w-full text-left px-4 py-3.5 border-b border-border/20 hover:bg-secondary/30 transition-all ${
                      selectedChatNumber === chat.number ? "bg-primary/5 border-l-2 border-l-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-semibold text-primary">
                          {chat.number.slice(-2)}
                        </div>
                        <span className="text-xs font-medium truncate">{chat.number}</span>
                      </div>
                      {chat.tag && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded border"
                          style={{
                            backgroundColor: hexToRgba(tagColor, 0.15),
                            color: tagColor,
                            borderColor: hexToRgba(tagColor, 0.3),
                          }}
                        >
                          {chat.tag}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-muted-foreground truncate flex-1">{chat.lastMsg}</p>
                      {chat.unread > 0 && (
                        <span className="ml-2 text-[9px] min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          {chat.unread}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {chat.date} · {chat.time}
                    </p>
                  </button>
                );
              })}
              {filteredChats.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-8 px-4">
                  No se encontraron chats con los filtros aplicados
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
