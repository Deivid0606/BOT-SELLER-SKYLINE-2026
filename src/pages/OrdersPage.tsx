import { motion } from "framer-motion";
import { Search, Filter } from "lucide-react";

const mockOrders = [
  { id: "1", number: "+595 981 234 567", product: "iPhone 15 Pro Max 256GB", name: "Carlos López", city: "Asunción", address: "Av. España 1234", phone: "+595981234567", quantity: "1", total: "Gs. 6.500.000", status: "pending", date: "2024-01-15" },
  { id: "2", number: "+595 972 345 678", product: "Samsung Galaxy S24 Ultra", name: "María García", city: "Ciudad del Este", address: "Calle Monseñor 456", phone: "+595972345678", quantity: "2", total: "Gs. 11.000.000", status: "loaded", date: "2024-01-14" },
  { id: "3", number: "+595 961 456 789", product: "AirPods Pro 2", name: "Juan Martínez", city: "Encarnación", address: "Ruta 1 km 370", phone: "+595961456789", quantity: "1", total: "Gs. 1.200.000", status: "dropi", date: "2024-01-13" },
  { id: "4", number: "+595 983 567 890", product: "iPad Air M2", name: "Ana Benítez", city: "Luque", address: "Barrio San Isidro", phone: "+595983567890", quantity: "1", total: "Gs. 4.800.000", status: "canceled", date: "2024-01-12" },
];

const statusConfig: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending: { label: "Pendiente", color: "text-warning", bg: "bg-warning/10", border: "border-warning/20" },
  loaded: { label: "Cargado", color: "text-success", bg: "bg-success/10", border: "border-success/20" },
  dropi: { label: "Cargado a Dropi", color: "text-primary", bg: "bg-primary/10", border: "border-primary/20" },
  canceled: { label: "Cancelado", color: "text-destructive", bg: "bg-destructive/10", border: "border-destructive/20" },
};

export default function OrdersPage() {
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
    </div>
  );
}
