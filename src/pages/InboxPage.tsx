import { useEffect, useMemo, useState } from "react";
import { Send, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

type DbMessage = {
  id: string;
  user_id: string | null;
  platform: string | null;
  from_number: string | null;
  message: string | null;
  message_type: string | null;
  is_processed: boolean | null;
};

export default function InboxPage() {
  const { user } = useAuth();

  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  // =========================
  // CARGAR MENSAJES
  // =========================
  const loadMessages = async () => {
    const { data, error } = await supabase
      .from("received_messages")
      .select("*")
      .order("id", { ascending: false });

    if (error) {
      console.error(error);
      return;
    }

    setMessages(data || []);
  };

  useEffect(() => {
    loadMessages();

    const channel = supabase
      .channel("realtime-messages")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "received_messages" },
        () => loadMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // =========================
  // AGRUPAR CHATS
  // =========================
  const chats = useMemo(() => {
    const map = new Map<string, DbMessage[]>();

    messages.forEach((msg) => {
      const num = msg.from_number || "sin_numero";
      if (!map.has(num)) map.set(num, []);
      map.get(num)!.push(msg);
    });

    return Array.from(map.entries());
  }, [messages]);

  // =========================
  // MENSAJES DEL CHAT ACTUAL
  // =========================
  const currentMessages = useMemo(() => {
    if (!selectedNumber) return [];

    return messages
      .filter((m) => m.from_number === selectedNumber)
      .slice()
      .reverse();
  }, [messages, selectedNumber]);

  // =========================
  // ENVIAR MENSAJE (CORREGIDO)
  // =========================
  const handleSend = async () => {
    if (!selectedNumber) {
      toast({
        title: "Selecciona un chat",
        variant: "destructive",
      });
      return;
    }

    if (!input.trim()) return;

    try {
      setSending(true);

      const res = await fetch("/api/send-whatsapp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: user?.id,
          to: selectedNumber,
          message: input,
        }),
      });

      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text);
      }

      if (!res.ok) {
        throw new Error(data?.error || "Error al enviar");
      }

      setInput("");
      await loadMessages();

      toast({
        title: "Mensaje enviado ✅",
      });
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error al enviar",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid grid-cols-[300px_1fr] h-full">

      {/* LISTA DE CHATS */}
      <div className="border-r border-border p-3">
        <div className="mb-3 flex items-center gap-2">
          <Search size={14} />
          <input
            className="w-full bg-transparent text-xs outline-none"
            placeholder="Buscar..."
          />
        </div>

        {chats.map(([number, msgs]) => (
          <div
            key={number}
            onClick={() => setSelectedNumber(number)}
            className={`p-2 cursor-pointer rounded ${
              selectedNumber === number ? "bg-primary/10" : ""
            }`}
          >
            <div className="text-xs font-bold">{number}</div>
            <div className="text-xs text-muted-foreground truncate">
              {msgs[0]?.message}
            </div>
          </div>
        ))}
      </div>

      {/* CHAT */}
      <div className="flex flex-col">

        {/* MENSAJES */}
        <div className="flex-1 p-4 overflow-y-auto space-y-2">
          {currentMessages.map((msg) => (
            <div
              key={msg.id}
              className={`max-w-[70%] px-3 py-2 rounded ${
                msg.message_type?.startsWith("out")
                  ? "ml-auto bg-primary text-white"
                  : "bg-secondary"
              }`}
            >
              {msg.message}
            </div>
          ))}
        </div>

        {/* INPUT */}
        <div className="p-3 border-t border-border flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="flex-1 bg-secondary/30 px-3 py-2 rounded outline-none text-sm"
            placeholder="Escribe tu mensaje..."
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />

          <button
            onClick={handleSend}
            disabled={sending}
            className="bg-primary px-3 rounded text-white flex items-center justify-center"
          >
            <Send size={16} />
          </button>
        </div>

      </div>
    </div>
  );
}
