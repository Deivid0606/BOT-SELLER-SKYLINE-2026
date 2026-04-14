import { motion } from "framer-motion";
import { Bell } from "lucide-react";

const mockNotifications = [
  { id: 1, title: "Nuevo pedido confirmado", body: "Carlos López confirmó pedido de iPhone 15 Pro Max", number: "+595981234567", time: "14:32" },
  { id: 2, title: "Pago recibido", body: "Transferencia recibida de María García por Gs. 11.000.000", number: "+595972345678", time: "14:15" },
  { id: 3, title: "Cliente solicita ayuda", body: "Juan Martínez pregunta por estado de envío", number: "+595961456789", time: "13:50" },
];

export default function NotificationsPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Notificaciones</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-muted-foreground border border-border">{mockNotifications.length} notif</span>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg overflow-hidden divide-y divide-border">
        {mockNotifications.map((n) => (
          <div key={n.id} className="px-4 py-4 hover:bg-secondary/30 transition-colors cursor-pointer">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{n.time}</p>
                <p className="text-sm font-bold mt-0.5">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
                <p className="text-[10px] text-muted-foreground font-mono mt-1">Chat: {n.number}</p>
              </div>
              <button className="shrink-0 text-xs px-3 py-1.5 rounded-md bg-secondary border border-border text-muted-foreground hover:bg-secondary/80 transition-colors">
                Abrir
              </button>
            </div>
          </div>
        ))}
      </motion.div>
    </div>
  );
}
