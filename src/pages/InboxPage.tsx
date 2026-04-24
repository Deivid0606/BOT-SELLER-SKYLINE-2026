<contenido>


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
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇",
  "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙", "😚",
  "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩",
  "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣",
  "😖", "😫", "😩", "🥺", "😢", "😭", "😤", "😠", "😡", "🤬",
  "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤗",
  "🤔", "🤭", "🤫", "🤥", "😶", "😐", "😑", "😬", "🙄", "😯",
  "😦", "😧", "😮", "😲", "🥱", "😴", "🤤", "😪", "😵", "🤐",
  "🥴", "🤢", "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈",
  "👿", "👹", "👺", "🤡", "💩", "👻", "💀", "☠️", "👽", "👾",
  "🤖", "🎃", "😺", "😸", "😹", "😻", "😼", "😽", "🙀", "😿",
  "😾", "🙈", "🙉", "🙊", "💋", "💌", "💘", "💝", "💖", "💗",
  "💓", "💞", "💕", "💟", "❣️", "💔", "❤️", "🧡", "💛", "💚",
  "💙", "💜", "🤎", "🖤", "🤍", "💯", "💢", "💥", "💫", "💦",
  "💨", "🕳️", "💣", "💬", "👋", "🤚", "✋", "🖖", "👌", "🤌",
  "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕",
  "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌",
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
  adSource?: {
    type: string;
    label: string;
    adId: string;
    adPreview: string;
  };
};

type FullTemplate = {
  id: string;
  name: string;
  content: string;
  media_url: string | null;
  media_type: string | null;
  variables: any;
};

const allTags = ["venta", "confirmado", "prospecto", "consulta", "venta web"];

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

export default function InboxPage() {
  const { user } = useAuth();

  const [selectedChat, setSelectedChat] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [showEmojis, setShowEmojis] = useState(false);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState<Date | undefined>(undefined);
  const [showFilters, setShowFilters] = useState(false);

  const [dbMessages, setDbMessages] = useState<DbMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<FullTemplate[]>([]);
  const [selectedFile, setSelectedFile] = useState<{ file: File; preview: string; type: string } | null>(null);
  const [selectedTemplateMedia, setSelectedTemplateMedia] = useState<{ url: string; type: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

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
      
      if (data && data.length > 0) {
        setAvailableTemplates(data as FullTemplate[]);
      } else {
        setAvailableTemplates([]);
      }
    };
    loadTemplates();
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
      setSelectedTemplateMedia({
        url: template.media_url,
        type: template.media_type
      });
      setSelectedFile(null);
    } else {
      setSelectedTemplateMedia(null);
    }
    setShowTemplates(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const maxSize = file.type.startsWith('video/') ? 16 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast({ 
        title: "Archivo muy grande", 
        description: `El archivo no puede superar ${maxSize / (1024 * 1024)}MB`, 
        variant: "destructive" 
      });
      return;
    }
    
    const fileType = file.type.startsWith('image/') ? 'image' : 
                     file.type.startsWith('video/') ? 'video' : 
                     file.type.startsWith('audio/') ? 'audio' : 'document';
    
    setSelectedFile({
      file,
      preview: URL.createObjectURL(file),
      type: fileType
    });
    setSelectedTemplateMedia(null);
    e.target.value = "";
  };

  const addEmoji = (emoji: string) => {
    setMessageInput(prev => prev + emoji);
    setShowEmojis(false);
  };

  const loadMessages = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("received_messages")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error cargando mensajes:", error);
      setDbMessages([]);
      setLoading(false);
      return;
    }

    setDbMessages((data || []) as DbMessage[]);
    setLoading(false);
  };

  useEffect(() => {
    loadMessages();

    const channel = supabase
      .channel("received_messages_realtime_inbox_pro")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "received_messages" },
        () => {
          loadMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

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

      return {
        number,
        lastMsg: last?.message || "",
        time: format(lastDate, "HH:mm"),
        date: format(lastDate, "yyyy-MM-dd"),
        unread: messages.filter((m) => !m.is_processed && !isOutgoingType(m.message_type)).length,
      };
    });
  }, [dbMessages]);

  const filteredChats = useMemo(() => {
    return chats.filter((chat) => {
      if (
        searchQuery &&
        !chat.number.includes(searchQuery) &&
        !chat.lastMsg.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }

      if (filterTag && chat.tag !== filterTag) return false;
      if (filterDate && chat.date !== format(filterDate, "yyyy-MM-dd")) return false;

      return true;
    });
  }, [chats, searchQuery, filterTag, filterDate]);

  const selectedNumber = filteredChats[selectedChat]?.number;

  const currentMessages = useMemo<Message[]>(() => {
    if (!selectedNumber) return [];

    const chatMessages = dbMessages.filter((msg) => msg.from_number === selectedNumber);
    
    // Ordenar por fecha (más antiguo primero para orden cronológico correcto)
    const sortedMessages = [...chatMessages].sort((a, b) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateA - dateB;
    });
    
    return sortedMessages.map((msg) => {
      let mediaType = msg.message_type || '';
      let mediaUrl = msg.media_url;
      const msgDate = msg.created_at ? new Date(msg.created_at) : new Date();
      
      if (mediaType.includes('image')) mediaType = 'image';
      else if (mediaType.includes('video')) mediaType = 'video';
      else if (mediaType.includes('audio')) mediaType = 'audio';
      else if (mediaUrl) {
        const ext = mediaUrl.split('.').pop()?.toLowerCase();
        if (ext === 'mp3' || ext === 'ogg' || ext === 'wav') mediaType = 'audio';
        else if (ext === 'mp4' || ext === 'webm') mediaType = 'video';
        else if (ext === 'jpg' || ext === 'png' || ext === 'jpeg' || ext === 'gif') mediaType = 'image';
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
    if (selectedChat >= filteredChats.length) {
      setSelectedChat(0);
    }
  }, [filteredChats.length, selectedChat]);

  useEffect(() => {
    const markAsProcessed = async () => {
      if (!selectedNumber) return;

      const idsToUpdate = dbMessages
        .filter(
          (msg) =>
            msg.from_number === selectedNumber &&
            !msg.is_processed &&
            !isOutgoingType(msg.message_type)
        )
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
          prev.map((msg) =>
            idsToUpdate.includes(msg.id) ? { ...msg, is_processed: true } : msg
          )
        );
      }
    };

    markAsProcessed();
  }, [selectedNumber, dbMessages]);

  const clearFilters = () => {
    setFilterTag(null);
    setFilterDate(undefined);
  };

  const hasActiveFilters = !!(filterTag || filterDate);

  const handleSendMessage = async () => {
    if (!selectedNumber) {
      toast({
        title: "Selecciona un chat",
        description: "Primero selecciona un chat para responder.",
        variant: "destructive",
      });
      return;
    }

    if (!messageInput.trim() && !selectedFile && !selectedTemplateMedia) {
      toast({
        title: "Mensaje vacío",
        description: "Escribe un mensaje, selecciona un archivo o una plantilla.",
        variant: "destructive",
      });
      return;
    }

    try {
      setSending(true);

      const textToSend = messageInput.trim();
      
      let mediaUrl = null;
      let mediaType = null;
      
      if (selectedFile) {
        const fileExt = selectedFile.file.name.split('.').pop();
        const fileName = `${user?.id}/${Date.now()}.${fileExt}`;
        const folder = selectedFile.type === 'image' ? 'images' : 
                       selectedFile.type === 'video' ? 'videos' : 'others';
        const filePath = `${folder}/${fileName}`;
        
        const { error: uploadError } = await supabase.storage
          .from('templates-media')
          .upload(filePath, selectedFile.file);
        
        if (uploadError) {
          throw new Error(`Error subiendo archivo: ${uploadError.message}`);
        }
        
        const { data: { publicUrl } } = supabase.storage
          .from('templates-media')
          .getPublicUrl(filePath);
        
        mediaUrl = publicUrl;
        mediaType = selectedFile.type;
      } else if (selectedTemplateMedia) {
        mediaUrl = selectedTemplateMedia.url;
        mediaType = selectedTemplateMedia.type;
      }
      
      const payload: any = {
        user_id: user?.id ?? null,
        to: selectedNumber,
        message: textToSend,
      };
      
      if (mediaUrl && mediaType) {
        payload.media_url = mediaUrl;
        payload.media_type = mediaType;
      }

      const response = await fetch("/api/send-whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

      toast({
        title: "✅ Mensaje enviado",
        description: "La respuesta se envió correctamente por WhatsApp.",
      });
    } catch (error: any) {
      console.error("Error enviando mensaje:", error);
      toast({
        title: "Error al enviar",
        description: error?.message || "No se pudo enviar el mensaje.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const renderMedia = (mediaUrl?: string, mediaType?: string, messageText?: string) => {
    if (!mediaUrl) return null;
    
    if (mediaType === 'image' || mediaUrl.match(/\.(jpg|jpeg|png|webp|gif)/i)) {
      return (
        <div className="mt-2 rounded-lg overflow-hidden">
          <img 
            src={mediaUrl} 
            alt="Imagen" 
            className="max-w-full max-h-48 rounded-lg object-cover cursor-pointer"
            onClick={() => window.open(mediaUrl, '_blank')}
          />
        </div>
      );
    }
    
    if (mediaType === 'video' || mediaUrl.match(/\.(mp4|webm|mov)/i)) {
      return (
        <div className="mt-2 rounded-lg overflow-hidden">
          <video 
            src={mediaUrl} 
            controls 
            className="max-w-full max-h-48 rounded-lg"
            controlsList="nodownload"
          />
        </div>
      );
    }
    
    if (mediaType === 'audio' || mediaUrl.match(/\.(mp3|ogg|wav|m4a)/i)) {
      return (
        <div className="mt-2 rounded-lg overflow-hidden bg-secondary/30 p-3">
          <div className="flex items-center gap-3">
            <Music className="w-5 h-5 text-primary" />
            <audio 
              src={mediaUrl} 
              controls 
              className="flex-1 h-10"
              controlsList="nodownload"
            />
          </div>
          {messageText && (
            <p className="text-xs text-muted-foreground mt-2">{messageText}</p>
          )}
        </div>
      );
    }
    
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-accent" />
          <div>
            <h1 className="text-xl font-bold font-heading">Inbox Profesional</h1>
            <p className="text-[11px] text-muted-foreground">WhatsApp Business integrado</p>
          </div>
          <span className="text-[11px] px-2.5 py-1 rounded-full bg-success/10 text-success border border-success/20 font-medium font-mono">
            {filteredChats.length} activos
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 h-[calc(100vh-180px)]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass glass-border rounded-xl flex flex-col overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 bg-secondary/20">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary font-mono">
                {filteredChats[selectedChat]?.number?.slice(-2) || "--"}
              </div>
              <div>
                <span className="font-heading font-bold text-sm">
                  {filteredChats[selectedChat]?.number || "Sin chat seleccionado"}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button className="p-2 rounded-lg hover:bg-secondary/60 transition-all duration-200 text-muted-foreground hover:text-foreground" title="Pausar IA">
                <Pause className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-primary/10 transition-all duration-200 text-muted-foreground hover:text-primary" title="Forzar IA">
                <Bot className="h-4 w-4" />
              </button>
              <button className="p-2 rounded-lg hover:bg-destructive/10 transition-all duration-200 text-muted-foreground hover:text-destructive" title="Eliminar">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-border/30 bg-secondary/10">
            <button className="text-[11px] px-3 py-1.5 rounded-lg bg-success/8 text-success border border-success/15 hover:bg-success/15 transition-all duration-200 font-medium">
              ✏️ Venta Normal
            </button>
            <button className="text-[11px] px-3 py-1.5 rounded-lg bg-primary/8 text-primary border border-primary/15 hover:bg-primary/15 transition-all duration-200 font-medium">
              🌐 Venta Web
            </button>
            <button className="text-[11px] px-3 py-1.5 rounded-lg bg-destructive/8 text-destructive border border-destructive/15 hover:bg-destructive/15 transition-all duration-200 font-medium">
              🧹 Limpiar
            </button>
            <select className="ml-auto text-[11px] bg-secondary/40 border border-border/40 rounded-lg px-2.5 py-1.5 text-muted-foreground focus:outline-none focus:border-primary/30 transition-colors">
              <option>Etiquetar...</option>
              <option>venta normal cargada</option>
              <option>venta web cargada</option>
              <option>prospecto</option>
              <option>consulta</option>
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-[hsl(198,19%,18%)]">
            {loading ? (
              <div className="text-sm text-muted-foreground">Cargando mensajes...</div>
            ) : currentMessages.length === 0 ? (
              <div className="text-sm text-muted-foreground">No hay mensajes para este chat.</div>
            ) : (
              currentMessages.map((msg, idx) => {
                const prevDate = idx > 0 ? currentMessages[idx - 1].date : null;
                const showDateSeparator = idx === 0 || msg.date !== prevDate;
                return (
                  <div key={msg.id}>
                    {showDateSeparator && (
                      <div className="flex items-center justify-center my-3">
                        <span className="text-[10px] px-4 py-1.5 rounded-full glass glass-border text-muted-foreground font-medium">
                          {format(new Date(msg.date), "EEEE, d 'de' MMMM yyyy", { locale: es })}
                        </span>
                      </div>
                    )}
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`flex ${msg.from === "out" ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`max-w-[75%] px-4 py-3 text-sm whitespace-pre-line ${
                        msg.from === "out"
                          ? "bg-gradient-to-br from-[hsl(160,80%,16%)] to-[hsl(165,70%,22%)] border border-[hsl(160,60%,26%/0.4)] rounded-2xl rounded-br-md shadow-lg"
                          : "glass glass-border rounded-2xl rounded-bl-md"
                      }`}>
                        {renderMedia(msg.mediaUrl, msg.mediaType, msg.text)}
                        {msg.text && msg.mediaType !== 'audio' && (
                          <div className="leading-relaxed">{msg.text}</div>
                        )}
                        <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/60">
                          <span>{msg.time}</span>
                          {msg.badge && (
                            <span className="px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[9px] font-semibold font-mono">
                              {msg.badge}
                            </span>
                          )}
                          {msg.from === "out" && <span className="text-success/60">✓✓</span>}
                        </div>
                      </div>
                    </motion.div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-border/30 p-4 bg-secondary/10 space-y-2 relative">
            {selectedFile && (
              <div className="mb-2 p-2 bg-primary/10 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedFile.type === 'image' && <Image className="h-4 w-4 text-primary" />}
                  {selectedFile.type === 'video' && <VideoIcon className="h-4 w-4 text-primary" />}
                  <span className="text-xs truncate max-w-[200px]">{selectedFile.file.name}</span>
                </div>
                <button onClick={() => setSelectedFile(null)} className="p-1 hover:bg-destructive/20 rounded">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            
            {selectedTemplateMedia && !selectedFile && (
              <div className="mb-2 p-2 bg-primary/10 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedTemplateMedia.type === 'image' && <Image className="h-4 w-4 text-primary" />}
                  {selectedTemplateMedia.type === 'video' && <VideoIcon className="h-4 w-4 text-primary" />}
                  <span className="text-xs">Multimedia de plantilla</span>
                </div>
                <button onClick={() => setSelectedTemplateMedia(null)} className="p-1 hover:bg-destructive/20 rounded">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <AnimatePresence>
              {showEmojis && (
                <motion.div
                  ref={emojiPickerRef}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-full left-0 mb-2 glass glass-border rounded-xl shadow-pro overflow-hidden z-10 w-64"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-secondary/20">
                    <span className="text-xs font-heading font-bold">Emojis</span>
                    <button onClick={() => setShowEmojis(false)} className="p-1 rounded hover:bg-secondary/60">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="grid grid-cols-8 gap-1 p-2 max-h-[200px] overflow-y-auto">
                    {COMMON_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => addEmoji(emoji)}
                        className="text-xl p-1 hover:bg-primary/10 rounded transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {showTemplates && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute bottom-full left-0 right-0 mx-4 mb-2 glass glass-border rounded-xl shadow-pro overflow-hidden z-10"
                >
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30 bg-secondary/20">
                    <span className="text-xs font-heading font-bold">📋 Plantillas</span>
                    <button onClick={() => setShowTemplates(false)} className="p-1 rounded-lg hover:bg-secondary/60">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {availableTemplates.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-muted-foreground text-center">
                        No hay plantillas disponibles. Crea una en Plantillas.
                      </div>
                    ) : (
                      availableTemplates.map((tpl) => (
                        <button
                          key={tpl.id}
                          onClick={() => handleSelectTemplate(tpl)}
                          className="w-full text-left px-4 py-3 hover:bg-primary/5 border-b border-border/20 last:border-0 transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {tpl.media_type === 'image' && <Image className="h-3 w-3 text-primary" />}
                            {tpl.media_type === 'video' && <VideoIcon className="h-3 w-3 text-primary" />}
                            {tpl.media_type === 'audio' && <Music className="h-3 w-3 text-primary" />}
                            <span className="text-[10px] font-bold text-primary font-mono tracking-wider">
                              {tpl.name}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{tpl.content || "Sin contenido"}</p>
                          {tpl.media_url && (
                            <p className="text-[9px] text-primary/60 mt-1">📎 Con multimedia</p>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 rounded-xl hover:bg-secondary/50 transition-all duration-200 text-muted-foreground hover:text-foreground"
                title="Subir archivo"
              >
                <Image className="h-4 w-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*,audio/*"
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                onClick={() => setShowEmojis(!showEmojis)}
                className={`p-2.5 rounded-xl transition-all duration-200 ${
                  showEmojis ? "bg-primary/10 text-primary" : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                }`}
                title="Emojis"
              >
                <Smile className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className={`p-2.5 rounded-xl transition-all duration-200 ${
                  showTemplates ? "bg-primary/10 text-primary shadow-sm" : "hover:bg-secondary/50 text-muted-foreground hover:text-foreground"
                }`}
                title="Plantillas"
              >
                <FileText className="h-4 w-4" />
              </button>
              <input
                className="flex-1 bg-secondary/30 border border-border/40 rounded-xl px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 focus:bg-secondary/50 transition-all duration-200"
                placeholder="Escribe tu mensaje aquí..."
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !sending) {
                    handleSendMessage();
                  }
                }}
              />
              <button
                onClick={handleSendMessage}
                disabled={sending}
                className="p-2.5 rounded-xl bg-gradient-to-r from-primary to-accent text-primary-foreground hover:shadow-[0_0_16px_hsl(239,84%,67%,0.3)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass glass-border rounded-xl flex flex-col overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border/30">
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-heading font-bold text-sm">Chats Recientes</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`p-1.5 rounded-lg transition-all duration-200 relative ${
                    showFilters || hasActiveFilters ? "bg-primary/10 text-primary" : "hover:bg-secondary/60 text-muted-foreground"
                  }`}
                  title="Filtros"
                >
                  <Filter className="h-3.5 w-3.5" />
                  {hasActiveFilters && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary shadow-[0_0_6px_hsl(239,84%,67%,0.5)]" />
                  )}
                </button>
                <span className="text-[11px] px-2 py-0.5 rounded-lg bg-secondary/60 text-muted-foreground border border-border/30 font-mono">
                  {filteredChats.length}
                </span>
              </div>
            </div>

            <AnimatePresence>
              {showFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2.5 pb-2.5">
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mb-1.5 uppercase tracking-wider">
                        <Tag className="h-3 w-3" /> Etiqueta
                      </label>
                      <div className="flex flex-wrap gap-1">
                        {allTags.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                            className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all duration-200 ${
                              filterTag === tag
                                ? "bg-primary/15 text-primary border-primary/25 shadow-sm"
                                : "bg-secondary/30 text-muted-foreground border-border/30 hover:bg-secondary/50"
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium flex items-center gap-1 mb-1.5 uppercase tracking-wider">
                        <CalendarDays className="h-3 w-3" /> Fecha
                      </label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            className={cn(
                              "w-full text-left text-xs px-3 py-2 rounded-lg border transition-all duration-200",
                              filterDate
                                ? "bg-primary/10 text-primary border-primary/25"
                                : "bg-secondary/30 text-muted-foreground border-border/30 hover:bg-secondary/50"
                            )}
                          >
                            {filterDate ? format(filterDate, "d 'de' MMMM yyyy", { locale: es }) : "Seleccionar fecha..."}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                          <Calendar
                            mode="single"
                            selected={filterDate}
                            onSelect={setFilterDate}
                            initialFocus
                            className="p-3 pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    {hasActiveFilters && (
                      <button
                        onClick={clearFilters}
                        className="text-[10px] text-destructive hover:underline font-medium"
                      >
                        ✕ Limpiar filtros
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="w-full bg-secondary/30 border border-border/30 rounded-xl pl-8 pr-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-all duration-200"
                placeholder="Buscar chat..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredChats.map((chat, i) => (
              <button
                key={chat.number}
                onClick={() => setSelectedChat(i)}
                className={`w-full text-left px-4 py-3.5 border-b border-border/20 transition-all duration-200 hover:bg-secondary/30 ${
                  selectedChat === i ? "bg-primary/5 border-l-2 border-l-primary" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full bg-secondary/60 border border-border/30 flex items-center justify-center text-[10px] font-bold text-muted-foreground font-mono">
                      {chat.number.slice(-2)}
                    </div>
                    <span className="font-mono text-xs font-bold">{chat.number}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5 ml-9.5">
                  <span className="text-xs text-muted-foreground truncate max-w-[180px]">{chat.lastMsg}</span>
                  {chat.unread > 0 && (
                    <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground text-[10px] font-bold shadow-[0_0_8px_hsl(239,84%,67%,0.3)]">
                      {chat.unread}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground/40 mt-1 ml-9.5 font-mono">
                  {chat.date} · {chat.time}
                </div>
              </button>
            ))}
            {filteredChats.length === 0 && (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No se encontraron chats con los filtros aplicados
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}



