import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ImageIcon, MapPin, X, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Order = {
  id: string;
  phone: string;
  product: string;
  customer_name: string;
  city: string;
  address: string;
  quantity: number;
  total_amount: string;
  status: string;
  created_at: string;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [viewingImage, setViewingImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 🔥 CARGAR PEDIDOS
  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "confirmed")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error cargando pedidos:", error);
      setLoading(false);
      return;
    }

    setOrders(data || []);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gradient">
          Pedidos Confirmados
        </h1>
      </div>

      {/* LOADING */}
      {loading && (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <p className="text-sm text-muted-foreground">Cargando pedidos...</p>
        </div>
      )}

      {/* VACÍO */}
      {!loading && orders.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-12 text-center">
          <p className="text-sm text-muted-foreground">
            Aún no hay pedidos confirmados
          </p>
        </div>
      )}

      {/* LISTA */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {orders.map((order, i) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-card border border-border rounded-lg p-4"
          >
            <p className="text-[10px] text-muted-foreground">📞 Cliente</p>
            <p className="font-mono text-xs font-bold mb-2">
              {order.phone}
            </p>

            <p className="font-bold text-sm">{order.product}</p>
            <p className="text-[10px] text-muted-foreground">
              {new Date(order.created_at).toLocaleString()}
            </p>

            <div className="mt-3 space-y-1 text-xs">
              <p>
                <b>Cliente:</b> {order.customer_name}
              </p>
              <p>
                <b>Ciudad:</b> {order.city}
              </p>
              <p>
                <b>Dirección:</b> {order.address}
              </p>
              <p>
                <b>Cantidad:</b> {order.quantity}
              </p>
              <p>
                <b>Total:</b>{" "}
                <span className="font-bold">{order.total_amount}</span>
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
