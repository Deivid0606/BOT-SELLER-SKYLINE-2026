import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Check,
  RefreshCw,
  Search,
  Trash2,
  Package,
  XCircle,
  Truck,
  MessageSquare,
  ReceiptText,
  Bot,
  Phone,
  MapPin,
  User,
  Calendar,
  DollarSign,
} from "lucide-react";

type Order = {
  id: string;
  user_id: string;
  customer_name: string | null;
  phone: string | null;
  from_number: string | null;
  product: string | null;
  quantity: number | null;
  total_amount: string | null;
  city: string | null;
  address: string | null;
  status: string;
  metodo_pago: string | null;
  comprobante_url: string | null;
  detected_by_ai: boolean | null;
  created_at: string;
};

const HIDDEN_STATUSES = [
  "collecting_name",
  "collecting_city",
  "collecting_address",
  "collecting_phone",
];

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  confirmado: {
    label: "Confirmado",
    color: "bg-green-500 text-white",
    icon: Check,
  },
  confirmed: {
    label: "Confirmado",
    color: "bg-green-500 text-white",
    icon: Check,
  },
  pendiente: {
    label: "Pendiente",
    color: "bg-yellow-500 text-white",
    icon: RefreshCw,
  },
  pending: {
    label: "Pendiente",
    color: "bg-yellow-500 text-white",
    icon: RefreshCw,
  },
  cargado: {
    label: "Cargado",
    color: "bg-blue-500 text-white",
    icon: Package,
  },
  cancelado: {
    label: "Cancelado",
    color: "bg-red-500 text-white",
    icon: XCircle,
  },
  droppx: {
    label: "Droppx",
    color: "bg-purple-500 text-white",
    icon: Truck,
  },
};

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("todos");

  const load = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Error cargando pedidos: " + error.message);
    } else {
      setOrders((data || []).filter((o: Order) => !HIDDEN_STATUSES.includes(o.status)));
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();

    const ch = supabase
      .channel("orders-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  async function setOrderStatus(order: Order, newStatus: "cargado" | "cancelado" | "droppx") {
    const labelMap: Record<string, string> = {
      cargado: "PEDIDO CARGADO",
      cancelado: "PEDIDO CANCELADO",
      droppx: "PEDIDO A DROPPX",
    };

    const labelName = labelMap[newStatus];
    const phone = order.phone || order.from_number;

    try {
      const { error: e1 } = await supabase
        .from("orders")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", order.id);

      if (e1) throw e1;

      const { data: pedidoTags } = await supabase
        .from("tags")
        .select("id, name")
        .eq("user_id", order.user_id)
        .in("name", ["PEDIDO CARGADO", "PEDIDO CANCELADO", "PEDIDO A DROPPX"]);

      const newTag = pedidoTags?.find((t) => t.name === labelName);

      if (!newTag) {
        throw new Error(`Etiqueta "${labelName}" no encontrada. Creala en Etiquetas.`);
      }

      if (phone) {
        const oldPedidoTagIds = pedidoTags?.map((t) => t.id) || [];

        if (oldPedidoTagIds.length > 0) {
          await supabase
            .from("contact_tags")
            .delete()
            .eq("contact_id", phone)
            .in("tag_id", oldPedidoTagIds);
        }

        await supabase.from("contact_tags").insert({
          contact_id: phone,
          tag_id: newTag.id,
          user_id: order.user_id,
        });
      }

      toast.success(`✅ ${labelName}`);
      load();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar este pedido?")) return;

    const { error } = await supabase.from("orders").delete().eq("id", id);

    if (error) toast.error(error.message);
    else {
      toast.success("Pedido eliminado");
      load();
    }
  }

  function irAlChat(phone: string | null) {
    if (!phone) {
      toast.error("Este pedido no tiene teléfono");
      return;
    }
    navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
  }

  const getStatusCount = (status: string) => {
    if (status === "confirmados") return orders.filter(o => o.status === "confirmado" || o.status === "confirmed").length;
    if (status === "pendientes") return orders.filter(o => o.status === "pendiente" || o.status === "pending").length;
    if (status === "cargados") return orders.filter(o => o.status === "cargado").length;
    if (status === "cancelados") return orders.filter(o => o.status === "cancelado").length;
    if (status === "droppx") return orders.filter(o => o.status === "droppx").length;
    return orders.length;
  };

  const filtered = orders.filter((o) => {
    const tel = o.phone || o.from_number || "";
    const matchSearch =
      !search ||
      o.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      tel.includes(search) ||
      o.product?.toLowerCase().includes(search.toLowerCase()) ||
      o.city?.toLowerCase().includes(search.toLowerCase());

    const matchFilter =
      filter === "todos" ||
      (filter === "confirmados" && (o.status === "confirmado" || o.status === "confirmed")) ||
      (filter === "pendientes" && (o.status === "pendiente" || o.status === "pending")) ||
      (filter === "cargados" && o.status === "cargado") ||
      (filter === "cancelados" && o.status === "cancelado") ||
      (filter === "droppx" && o.status === "droppx");

    return matchSearch && matchFilter;
  });

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString("es-PY", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="text-sm text-gray-500 mt-1">Gestioná todos los pedidos de tus clientes</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          {[
            { key: "todos", label: "Todos", color: "bg-gray-500" },
            { key: "pendientes", label: "Pendientes", color: "bg-yellow-500" },
            { key: "confirmados", label: "Confirmados", color: "bg-green-500" },
            { key: "cargados", label: "Cargados", color: "bg-blue-500" },
            { key: "droppx", label: "Droppx", color: "bg-purple-500" },
            { key: "cancelados", label: "Cancelados", color: "bg-red-500" },
          ].map((stat) => (
            <button
              key={stat.key}
              onClick={() => setFilter(stat.key)}
              className={`bg-white rounded-lg p-3 text-center shadow-sm border transition-all ${
                filter === stat.key ? "border-blue-500 ring-2 ring-blue-500 ring-opacity-50" : "border-gray-200"
              }`}
            >
              <div className={`text-2xl font-bold ${stat.color.replace("bg-", "text-")}`}>
                {getStatusCount(stat.key)}
              </div>
              <div className="text-xs text-gray-600 mt-1">{stat.label}</div>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Buscar por nombre, teléfono o producto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Orders List */}
        {loading ? (
          <div className="text-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin mx-auto text-gray-400" />
            <p className="text-gray-500 mt-2">Cargando pedidos...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <Package className="h-12 w-12 mx-auto text-gray-300" />
            <p className="text-gray-500 mt-3">No hay pedidos para mostrar</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((order) => {
              const cfg = STATUS_CONFIG[order.status] || {
                label: order.status,
                color: "bg-gray-500 text-white",
                icon: Check,
              };
              const Icon = cfg.icon;
              const phoneNumber = order.phone || order.from_number;

              return (
                <div key={order.id} className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  {/* Header */}
                  <div className="p-4 border-b border-gray-100 flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900">{order.customer_name || "Cliente"}</h3>
                        {order.detected_by_ai && (
                          <Badge variant="outline" className="text-xs">
                            <Bot className="h-3 w-3 mr-1" />
                            Auto
                          </Badge>
                        )}
                        <Badge className={cfg.color}>
                          <Icon className="h-3 w-3 mr-1" />
                          {cfg.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(order.created_at)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Package className="h-3 w-3" />
                          {order.product || "Producto"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="p-4 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex items-start gap-2">
                        <User className="h-4 w-4 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-gray-500">Cliente</p>
                          <p className="text-sm text-gray-900">{order.customer_name || "—"}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-start gap-2">
                        <Phone className="h-4 w-4 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-gray-500">Teléfono</p>
                          <p className="text-sm text-gray-900">{phoneNumber || "—"}</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-gray-500">Ubicación</p>
                          <p className="text-sm text-gray-900">
                            {order.city && order.address ? `${order.city}, ${order.address}` : order.city || order.address || "—"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-start gap-2">
                        <DollarSign className="h-4 w-4 text-gray-400 mt-0.5" />
                        <div>
                          <p className="text-xs text-gray-500">Total</p>
                          <p className="text-sm font-semibold text-gray-900">
                            {order.total_amount ? `${Number(order.total_amount).toLocaleString()} Gs` : "—"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {order.metodo_pago && (
                      <div className="text-xs text-gray-600 mt-2 pt-2 border-t border-gray-100">
                        <span className="font-medium">Pago:</span> {order.metodo_pago}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="bg-gray-50 px-4 py-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => irAlChat(phoneNumber)}>
                      <MessageSquare className="h-4 w-4 mr-1" />
                      Chat
                    </Button>

                    {order.comprobante_url && (
                      <a
                        href={order.comprobante_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center px-3 py-1 text-sm font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50"
                      >
                        <ReceiptText className="h-4 w-4 mr-1" />
                        Comprobante
                      </a>
                    )}

                    {order.status !== "cargado" && (
                      <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => setOrderStatus(order, "cargado")}>
                        <Package className="h-4 w-4 mr-1" />
                        Cargado
                      </Button>
                    )}

                    {order.status !== "droppx" && (
                      <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => setOrderStatus(order, "droppx")}>
                        <Truck className="h-4 w-4 mr-1" />
                        Droppx
                      </Button>
                    )}

                    {order.status !== "cancelado" && (
                      <Button size="sm" variant="outline" className="border-red-300 text-red-600 hover:bg-red-50" onClick={() => setOrderStatus(order, "cancelado")}>
                        <XCircle className="h-4 w-4 mr-1" />
                        Cancelar
                      </Button>
                    )}

                    <Button size="sm" variant="destructive" onClick={() => remove(order.id)}>
                      <Trash2 className="h-4 w-4 mr-1" />
                      Eliminar
                    </Button>

                    <Button size="sm" variant="ghost" onClick={load}>
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
