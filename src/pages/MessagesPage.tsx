import { motion } from "framer-motion";
import { Mail, Search } from "lucide-react";

type ReceivedMessage = { from: string; text: string; time: string; read: boolean };
const mockMessages: ReceivedMessage[] = [];

export default function MessagesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Mensajes Recibidos</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input className="bg-secondary/50 border border-border rounded-lg pl-8 pr-3 py-2 text-xs w-60 placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="Buscar mensajes..." />
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
        {mockMessages.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Mail className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Aún no hay mensajes recibidos</p>
          </div>
        ) : (
          mockMessages.map((msg, i) => (
            <div key={i} className={`px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer flex items-center gap-4 ${!msg.read ? "bg-primary/[0.03]" : ""}`}>
              {!msg.read && <div className="h-2 w-2 rounded-full bg-primary shrink-0" />}
              {msg.read && <div className="h-2 w-2 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold">{msg.from}</span>
                  <span className="text-[10px] text-muted-foreground">{msg.time}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.text}</p>
              </div>
            </div>
          ))
        )}
      </motion.div>
    </div>
  );
}
