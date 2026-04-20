import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ImageIcon, MapPin, X, ExternalLink } from "lucide-react";

type Order = { id: string; number: string; product: string; name: string; city: string; address: string; phone: string; quantity: string; total: string; status: string; date: string; paymentType: string; transferImage: string | null; locationUrl: string | null };
const mockOrders: Order[] = [];

const statusConfig: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: "Pendiente", color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" },
  loaded: { label: "Cargado", color: "text-success", bg: "bg-success/10", border: "border-success/20" },
  dropi: { label: "Cargado a Dropi", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  canceled: { label: "Cancelado", color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
};

export default function OrdersPage() {
  const [viewingImage, setViewingImage] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Pedidos Confirmados</h1>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input className="bg-secondary/50 border border-border rounded-lg pl-8 pr-3 py-2 text-xs w-60 placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="Buscar pedidos..." />
          </div>
          <select className="text-xs bg-secondary border border-border rounded-lg px-3 py-2 text-muted-foreground">
            <option value="">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="loaded">Cargado</option>
            <option value="dropi">Dropi</option>
            <option value="canceled">Cancelado</option>
          </select>
        </div>
      </div>

      {mockOrders.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <p className="text-sm text-muted-foreground">Aún no hay pedidos confirmados</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {mockOrders.map((order, i) => {
          const st = statusConfig[order.status];
          return (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="bg-card border border-border rounded-lg p-4 relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 right-0 h-[3px] ${order.status === "pending" ? "bg-warning" : order.status === "loaded" ? "bg-success" : order.status === "dropi" ? "bg-primary" : "bg-destructive"}`} />
              
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">📞 Desde</p>
                  <p className="font-mono text-xs font-bold">{order.number}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.bg} ${st.color} ${st.border} border font-medium`}>
                  {st.label}
                </span>
              </div>

              <p className="font-bold text-sm">{order.product}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{order.date}</p>

              <div className="mt-3 space-y-1 text-xs">
                <p><span className="font-medium">Cliente:</span> <span className="text-muted-foreground">{order.name}</span></p>
                <p><span className="font-medium">Ciudad:</span> <span className="text-muted-foreground">{order.city}</span></p>
                <p><span className="font-medium">Dirección:</span> <span className="text-muted-foreground">{order.address}</span></p>
                <p><span className="font-medium">Cant:</span> <span className="text-muted-foreground">{order.quantity}</span></p>
                <p><span className="font-medium">Total:</span> <span className="text-foreground font-bold">{order.total}</span></p>
                <p><span className="font-medium">Pago:</span> <span className="text-muted-foreground">{order.paymentType === "transfer" ? "💳 Transferencia" : "💵 Efectivo"}</span></p>
              </div>

              {/* Transfer image & Location links */}
              <div className="flex gap-2 mt-3">
                {order.transferImage && (
                  <button
                    onClick={() => setViewingImage(order.transferImage)}
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors font-medium"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    Ver comprobante
                  </button>
                )}
                {order.locationUrl && (
                  <a
                    href={order.locationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[10px] px-2.5 py-1.5 rounded-md bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors font-medium"
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    Ver ubicación
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>

              <div className="flex gap-1.5 mt-3 flex-wrap">
                <button className="text-[10px] px-2 py-1 rounded-md bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20 transition-colors">🟡 Pendiente</button>
                <button className="text-[10px] px-2 py-1 rounded-md bg-success/10 text-success border border-success/20 hover:bg-success/20 transition-colors">✅ Cargado</button>
                <button className="text-[10px] px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors">🚚 Dropi</button>
                <button className="text-[10px] px-2 py-1 rounded-md bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20 transition-colors">❌ Cancel</button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Image lightbox */}
      <AnimatePresence>
        {viewingImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setViewingImage(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-lg w-full bg-card border border-border rounded-xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Comprobante de transferencia</span>
                </div>
                <button onClick={() => setViewingImage(null)} className="p-1 rounded-lg hover:bg-secondary transition-colors">
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
              <div className="p-4">
                <img src={viewingImage} alt="Comprobante de transferencia" className="w-full rounded-lg border border-border" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
