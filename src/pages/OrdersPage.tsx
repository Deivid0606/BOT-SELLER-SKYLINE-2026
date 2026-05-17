// CAMBIOS:
// 1. "Desde" muestra SIEMPRE el número real del chat (from_number)
// 2. Productos múltiples soportados con items[]
// 3. Cada producto muestra nombre + cantidad + monto
// 4. Total separado abajo
// 5. Se evita que textos largos rompan la card
// 6. Compatible con pedidos viejos y nuevos

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
  ShoppingCart,
  DollarSign,
  Calendar,
  Clock,
  User,
  MapPin,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type OrderItem = {
  product?: string;
  name?: string;
  quantity?: number;
  amount?: number;
  price?: number;
};

type Order = {
  id: string;
  user_id: string;
  customer_name: string | null;
  phone: string | null;
  from_number: string | null;

  product: string | null;
  quantity: number | null;

  items?: OrderItem[] | string | null;

  total_amount: string | null;
  city: string | null;
  address: string | null;
  status: string;
  metodo_pago: string | null;
  comprobante_url: string | null;
  detected_by_ai: boolean | null;
  created_at: string;
};

const ECOMMERCE_URL = "https://www.el-ecommercedcanpgroup.com";

const HIDDEN_STATUSES = [
  "collecting_name",
  "collecting_city",
  "collecting_address",
  "collecting_phone",
];

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: any }
> = {
  confirmado: {
    label: "Confirmado",
    color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    icon: Check,
  },

  confirmed: {
    label: "Confirmado",
    color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    icon: Check,
  },

  pendiente: {
    label: "Pendiente",
    color: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    icon: Clock,
  },

  pending: {
    label: "Pendiente",
    color: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    icon: Clock,
  },

  cargado: {
    label: "Cargado",
    color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    icon: Package,
  },

  cancelado: {
    label: "Cancelado",
    color: "border-red-500/40 bg-red-500/10 text-red-400",
    icon: XCircle,
  },

  droppx: {
    label: "Droppx",
    color: "border-blue-500/40 bg-blue-500/10 text-blue-400",
    icon: Truck,
  },
};

const FILTERS = [
  { id: "all", label: "Todos", icon: Package },
  { id: "confirmados", label: "Confirmados", icon: Check },
  { id: "cargados", label: "Cargados", icon: Package },
  { id: "cancelados", label: "Cancelados", icon: XCircle },
  { id: "droppx", label: "Droppx", icon: Truck },
];

function formatCurrency(value: string | number | null | undefined) {
  if (!value) return "0";

  const num = typeof value === "string"
    ? parseFloat(value)
    : value;

  if (isNaN(num)) return "0";

  return num.toLocaleString("es-PY", {
    maximumFractionDigits: 0,
  });
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();

  const diffHours = Math.floor(
    (now.getTime() - date.getTime()) /
      (1000 * 60 * 60)
  );

  if (diffHours < 1) return "Hace unos momentos";

  if (diffHours < 24)
    return `Hace ${diffHours} horas`;

  return date.toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeStatus(status: string) {
  if (status === "confirmed") return "confirmado";
  if (status === "pending") return "pendiente";

  return status;
}

export default function OrdersPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  const loadOrders = useCallback(async () => {
    setLoading(true);

    let query = supabase
      .from("orders")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    const { data, error } = await query;

    if (error) {
      toast.error("Error cargando pedidos");
    } else {
      setOrders(
        (data || []).filter(
          (o: Order) =>
            !HIDDEN_STATUSES.includes(o.status)
        )
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadOrders();

    const channel = supabase
      .channel("orders")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        () => loadOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadOrders]);

  async function updateStatus(
    order: Order,
    newStatus: string
  ) {
    const { error } = await supabase
      .from("orders")
      .update({
        status: newStatus,
      })
      .eq("id", order.id);

    if (error) {
      toast.error("Error actualizando");
    } else {
      toast.success("Pedido actualizado");
      loadOrders();
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm("¿Eliminar pedido?")) return;

    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Error eliminando");
    } else {
      toast.success("Pedido eliminado");
      loadOrders();
    }
  }

  function openChat(phone: string | null) {
    if (!phone) {
      toast.error("No hay número");
      return;
    }

    navigate(
      `/inbox?phone=${encodeURIComponent(phone)}`
    );
  }

  function openEcommerce(order: Order) {
    const realChatNumber =
      order.from_number ||
      order.phone ||
      "";

    const params = new URLSearchParams({
      view: "create-order",

      nombre: order.customer_name || "",
      telefono: realChatNumber,
      ciudad: order.city || "",
      calle: order.address || "",

      producto: order.product || "",
      cantidad: String(order.quantity || 1),

      total: order.total_amount || "",

      pago: order.metodo_pago || "",

      observacion: `Producto: ${
        order.product || "Sin producto"
      }`,

      origen: "seller-skyline",
    });

    window.open(
      `${ECOMMERCE_URL}/?${params.toString()}`,
      "_blank"
    );
  }

  const filteredOrders = orders.filter((order) => {
    const searchTerm = search.toLowerCase();

    return (
      !search ||
      order.customer_name
        ?.toLowerCase()
        .includes(searchTerm) ||
      order.phone
        ?.toLowerCase()
        .includes(searchTerm) ||
      order.from_number
        ?.toLowerCase()
        .includes(searchTerm) ||
      order.product
        ?.toLowerCase()
        .includes(searchTerm) ||
      order.city
        ?.toLowerCase()
        .includes(searchTerm)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-6xl flex-col px-4 py-10">

        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold">
            Pedidos
          </h1>

          <p className="mt-2 text-sm text-muted-foreground">
            Panel operativo de pedidos
          </p>
        </div>

        <Card className="mb-6">
          <CardContent className="p-4">

            <div className="relative w-full">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />

              <Input
                placeholder="Buscar..."
                value={search}
                onChange={(e) =>
                  setSearch(e.target.value)
                }
                className="pl-9"
              />
            </div>

          </CardContent>
        </Card>

        {loading ? (
          <div className="text-center py-10">
            Cargando...
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-5xl gap-4 sm:grid-cols-2 xl:grid-cols-3">

            {filteredOrders.map((order) => {

              const status = normalizeStatus(
                order.status
              );

              const config =
                STATUS_CONFIG[status] ||
                STATUS_CONFIG.pendiente;

              const Icon = config.icon;

              const chatNumber =
                order.from_number ||
                order.phone ||
                "";

              let orderItems: OrderItem[] = [];

              try {
                orderItems = Array.isArray(order.items)
                  ? order.items
                  : order.items
                  ? JSON.parse(order.items)
                  : [];
              } catch {
                orderItems = [];
              }

              return (
                <Card
                  key={order.id}
                  className="overflow-hidden rounded-2xl"
                >
                  <CardContent className="p-5">

                    <div className="mb-4 flex items-start justify-between gap-3">

                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          Desde
                        </p>

                        <p
                          className="break-all font-mono text-sm font-semibold"
                          title={chatNumber}
                        >
                          {chatNumber || "—"}
                        </p>
                      </div>

                      <Badge
                        className={`${config.color} shrink-0`}
                      >
                        <Icon className="mr-1 h-3 w-3" />
                        {config.label}
                      </Badge>
                    </div>

                    {/* PRODUCTOS */}

                    <div className="mb-4">

                      <p className="mb-2 text-xs text-muted-foreground">
                        Productos
                      </p>

                      {orderItems.length > 0 ? (
                        <div className="space-y-2">

                          {orderItems.map(
                            (item, index) => (
                              <div
                                key={index}
                                className="rounded-xl bg-muted/40 p-3"
                              >

                                <p className="break-words font-semibold">
                                  {item.product ||
                                    item.name ||
                                    "Producto"}
                                </p>

                                <p className="mt-1 text-xs text-muted-foreground">
                                  Cantidad:{" "}
                                  {item.quantity || 1}
                                </p>

                                <p className="text-xs font-semibold text-emerald-500">
                                  Monto:{" "}
                                  {formatCurrency(
                                    item.amount ||
                                      item.price ||
                                      0
                                  )}{" "}
                                  Gs
                                </p>

                              </div>
                            )
                          )}

                        </div>
                      ) : (
                        <div className="rounded-xl bg-muted/40 p-3">

                          <p className="break-words font-semibold">
                            {order.product ||
                              "Producto"}
                          </p>

                          <p className="mt-1 text-xs text-muted-foreground">
                            Cantidad:{" "}
                            {order.quantity || 1}
                          </p>

                        </div>
                      )}
                    </div>

                    {/* CLIENTE */}

                    <div className="mb-3 space-y-2 text-sm">

                      <div className="flex items-center gap-2 text-muted-foreground">
                        <User className="h-3.5 w-3.5 shrink-0" />

                        <span className="min-w-0 truncate">
                          {order.customer_name ||
                            "Sin nombre"}
                        </span>
                      </div>

                      {order.city && (
                        <div className="flex items-center gap-2 text-muted-foreground">

                          <MapPin className="h-3.5 w-3.5 shrink-0" />

                          <span className="min-w-0 truncate">
                            {order.city}
                          </span>

                        </div>
                      )}

                    </div>

                    {/* TOTAL */}

                    <div className="mb-3 flex items-center justify-between gap-2">

                      <span className="font-semibold text-emerald-500">
                        Total:{" "}
                        {formatCurrency(
                          order.total_amount
                        )}{" "}
                        Gs
                      </span>

                      <span className="text-xs text-muted-foreground">
                        {formatDate(order.created_at)}
                      </span>

                    </div>

                    {/* DIRECCIÓN */}

                    {order.address && (
                      <div className="mb-3 rounded-xl bg-muted/50 p-3">

                        <p className="text-xs text-muted-foreground">
                          Dirección
                        </p>

                        <p className="break-words text-sm">
                          {order.address}
                        </p>

                      </div>
                    )}

                    {/* BOTONES */}

                    <div className="mt-4 flex gap-2">

                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-xl"
                        onClick={() =>
                          openEcommerce(order)
                        }
                      >
                        <ShoppingCart className="mr-2 h-3.5 w-3.5" />
                        Ecommerce
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 rounded-xl"
                        onClick={() =>
                          openChat(chatNumber)
                        }
                      >
                        <MessageSquare className="mr-2 h-3.5 w-3.5" />
                        Chat
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="px-3 text-red-500"
                        onClick={() =>
                          deleteOrder(order.id)
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>

                    </div>

                    {/* ACCIONES */}

                    <div className="mt-3 flex flex-wrap gap-1">

                      {status !== "cargado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-emerald-500"
                          onClick={() =>
                            updateStatus(
                              order,
                              "cargado"
                            )
                          }
                        >
                          <Package className="mr-1 h-3 w-3" />
                          Cargado
                        </Button>
                      )}

                      {status !== "droppx" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-blue-500"
                          onClick={() =>
                            updateStatus(
                              order,
                              "droppx"
                            )
                          }
                        >
                          <Truck className="mr-1 h-3 w-3" />
                          Droppx
                        </Button>
                      )}

                      {status !== "cancelado" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-red-500"
                          onClick={() =>
                            updateStatus(
                              order,
                              "cancelado"
                            )
                          }
                        >
                          <XCircle className="mr-1 h-3 w-3" />
                          Cancelar
                        </Button>
                      )}

                    </div>

                    {/* COMPROBANTE */}

                    {order.comprobante_url && (
                      <a
                        href={order.comprobante_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ReceiptText className="h-3 w-3" />
                        Ver comprobante
                      </a>
                    )}

                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
