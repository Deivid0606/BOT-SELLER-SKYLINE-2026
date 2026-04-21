import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Mail, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type ReceivedMessage = {
  id: string;
  from: string;
  text: string;
  time: string;
  read: boolean;
  type: string;
};

type DbMessage = {
  id: string;
  from_number: string | null;
  message: string | null;
  message_type: string | null;
  is_processed: boolean | null;
};

export default function MessagesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMessages = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("received_messages")
      .select("id, from_number, message, message_type, is_processed")
      .order("id", { ascending: false });

    if (error) {
      console.error("Error cargando mensajes recibidos:", error);
      setMessages([]);
      setLoading(false);
      return;
    }

    const formatted: ReceivedMessage[] = ((data || []) as DbMessage[]).map((msg) => ({
      id: msg.id,
      from: msg.from_number || "Sin número",
      text: msg.message || "",
      time: "Ahora",
      read: !!msg.is_processed,
      type: msg.message_type || "text",
    }));

    setMessages(formatted);
    setLoading(false);
  };

  useEffect(() => {
    loadMessages();

    const channel = supabase
      .channel("messages_page_realtime")
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
  }, []);

  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;

      return (
        msg.from.toLowerCase().includes(q) ||
        msg.text.toLowerCase().includes(q) ||
        msg.type.toLowerCase().includes(q)
      );
    });
  }, [messages, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">
          Mensajes Recibidos
        </h1>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            className="bg-secondary/50 border border-border rounded-lg pl-8 pr-3 py-2 text-xs w-60 placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
            placeholder="Buscar mensajes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border"
      >
        {loading ? (
          <div className="px-4 py-12 text-center">
            <p className="text-xs text-muted-foreground">Cargando mensajes...</p>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Mail className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">
              Aún no hay mensajes recibidos
            </p>
          </div>
        ) : (
          filteredMessages.map((msg) => (
            <div
              key={msg.id}
              className={`px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer flex items-center gap-4 ${
                !msg.read ? "bg-primary/[0.03]" : ""
              }`}
            >
              {!msg.read ? (
                <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
              ) : (
                <div className="h-2 w-2 shrink-0" />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs font-bold">{msg.from}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {msg.time}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {msg.text}
                </p>

                <div className="mt-1">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {msg.type}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </motion.div>
    </div>
  );
}
