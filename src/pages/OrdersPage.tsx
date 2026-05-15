import { useEffect, useState, useCallback, useMemo } from "react";
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
  Filter,
  ChevronDown,
  ChevronUp,
  Calendar,
  DollarSign,
  MapPin,
  Phone,
  User,
  ClipboardList,
  CreditCard,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any; bgColor: string }> = {
  confirmado: {
    label: "Confirmado",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/25",
    icon: Check,
  },
  confirmed: {
    label: "Confirmado",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10 border-emerald-500/25",
    icon: Check,
  },
  pendiente: {
    label: "Pendiente",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/25",
    icon: RefreshCw,
  },
  pending: {
    label: "Pendiente",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10 border-amber-500/25",
    icon: RefreshCw,
  },
  cargado: {
    label: "Cargado",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10 border-blue-500/25",
    icon: Package,
  },
  cancelado: {
    label: "Cancelado",
    color: "text-red-400",
    bgColor: "bg-red-500/10 border-red-500/25",
    icon: XCircle,
  },
  droppx: {
    label: "Droppx",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10 border-purple-500/25",
    icon: Truck,
  },
};

const FILTERS = [
  { key: "todos", label: "Todos", icon: ClipboardList },
  { key: "confirmados", label: "Confirmados", icon: Check },
  { key: "pendientes", label: "Pendientes", icon: RefreshCw },
  { key: "cargados", label: "Cargados", icon: Package },
  { key: "cancelados", label: "Cancelados", icon: XCircle },
  { key: "droppx", label: "Droppx", icon: Truck },
] as const;

function InfoRow({ icon: Icon, label, value, highlight = false }: { icon: any; label: string; value: string | number | null | undefined; highlight?: boolean }) {
  return (
    <div className="group flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted/30">
      <div className="shrink-0 mt-0.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-sm font-medium leading-tight break-words ${highlight ? "text-foreground font-bold" : "text-foreground/90"}`}>
          {value || "—"}
        </p>
      </div>
    </div>
  );
}

function OrderSkeleton() {
  return (
    <Card className="overflow-hidden border-border/70">
      <CardContent className="p-0">
        <div className="border-b border-border/60 bg-muted/20 px-4 py-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-5 w-32 mb-1" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20 rounded-md" />
          </div>
        </div>
        <div className="p-4 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
          <div className="flex gap-2 pt-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"todos" | "confirmados" | "pendientes" | "cargados" | "cancelados" | "droppx">("todos");
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [stats, setStats] = useState({ total: 0, confirmados: 0, pendientes: 0, cargados: 0, cancelados: 0, droppx: 0 });

  const load = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Error cargando pedidos: " + error.message);
    } else {
      const visibleOrders = (data || []).filter((o: Order) => !HIDDEN_STATUSES.includes(o.status));
      setOrders(visibleOrders);
      
      // Update stats
      const newStats = {
        total: visibleOrders.length,
        confirmados: visibleOrders.filter((o: Order) => o.status === "confirmado" || o.status === "confirmed").length,
        pendientes: visibleOrders.filter((o: Order) => o.status === "pendiente" || o.status === "pending").length,
        cargados: visibleOrders.filter((o: Order) => o.status === "cargado").length,
        cancelados: visibleOrders.filter((o: Order) => o.status === "cancelado").length,
        droppx: visibleOrders.filter((o: Order) => o.status === "droppx").length,
      };
      setStats(newStats);
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
        throw new Error(`Etiqueta "${labelName}" no encontrada. Créala en Etiquetas.`);
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

      toast.success(`✅ ${labelName}`, {
        description: `Pedido #${order.id.slice(0, 8)} marcado correctamente`,
      });
      load();
    } catch (err: any) {
      toast.error("Error al actualizar", {
        description: err.message,
      });
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("orders").delete().eq("id", id);

    if (error) {
      toast.error("Error al eliminar", {
        description: error.message,
      });
    } else {
      toast.success("Pedido eliminado", {
        description: "El pedido ha sido eliminado permanentemente",
      });
      setOrderToDelete(null);
      load();
    }
  }

  function irAlChat(phone: string | null) {
    if (!phone) {
      toast.error("No se puede abrir el chat", {
        description: "Este pedido no tiene número de teléfono asociado",
      });
      return;
    }
    navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
  }

  const toggleExpand = (orderId: string) => {
    setExpandedOrders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
    });
  };

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      const tel = o.phone || o.from_number || "";
      const searchLower = search.toLowerCase();

      const matchSearch =
        !search ||
        o.customer_name?.toLowerCase().includes(searchLower) ||
        tel.includes(search) ||
        o.product?.toLowerCase().includes(searchLower) ||
        o.city?.toLowerCase().includes(searchLower) ||
        o.address?.toLowerCase().includes(searchLower);

      const matchFilter =
        filter === "todos" ||
        (filter === "confirmados" && (o.status === "confirmado" || o.status === "confirmed")) ||
        (filter === "pendientes" && (o.status === "pendiente" || o.status === "pending")) ||
        (filter === "cargados" && o.status === "cargado") ||
        (filter === "cancelados" && o.status === "cancelado") ||
        (filter === "droppx" && o.status === "droppx");

      return matchSearch && matchFilter;
    });
  }, [orders, search, filter]);

  const getInitials = (name: string | null) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map(n => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatCurrency = (amount: string | null) => {
    if (!amount) return "—";
    return new Intl.NumberFormat("es-PY", {
      style: "currency",
      currency: "PYG",
      minimumFractionDigits: 0,
    }).format(Number(amount));
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
        <div className="container mx-auto px-4 py-6 md:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8 space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Gestión de Pedidos
                </h1>
                <p className="text-muted-foreground mt-1">
                  Administra y da seguimiento a todos tus pedidos
                </p>
              </div>

              <Button
                onClick={load}
                disabled={loading}
                variant="outline"
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Actualizar
              </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {FILTERS.map((stat) => {
                const count = stats[stat.key as keyof typeof stats] || 0;
                const Icon = stat.icon;
                const isActive = filter === stat.key;
                return (
                  <Card
                    key={stat.key}
                    className={`cursor-pointer transition-all hover:scale-105 ${
                      isActive ? "ring-2 ring-primary ring-offset-2" : ""
                    }`}
                    onClick={() => setFilter(stat.key)}
                  >
                    <CardContent className="p-3 text-center">
                      <Icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                      <p className="text-2xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground capitalize">{stat.label}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Search and Filters */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre, teléfono, producto o ciudad..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              
              <div className="flex gap-2">
                <Tabs value={filter} onValueChange={(v) => setFilter(v as any)} className="w-full sm:w-auto">
                  <TabsList className="grid w-full grid-cols-3 sm:grid-cols-6">
                    {FILTERS.map((f) => (
                      <TabsTrigger key={f.key} value={f.key} className="text-xs sm:text-sm">
                        {f.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            </div>
          </div>

          {/* Orders Grid */}
          {loading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <OrderSkeleton key={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                <p className="text-muted-foreground">No se encontraron pedidos</p>
                <p className="text-sm text-muted-foreground/70 mt-1">
                  {search ? "Intenta con otros términos de búsqueda" : "No hay pedidos para mostrar"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((order, index) => {
                const cfg = STATUS_CONFIG[order.status] || {
                  label: order.status,
                  color: "text-gray-400",
                  bgColor: "bg-gray-500/10 border-gray-500/25",
                  icon: Check,
                };
                const Icon = cfg.icon;
                const isExpanded = expandedOrders.has(order.id);
                const phoneNumber = order.phone || order.from_number;
                const fecha = new Date(order.created_at).toLocaleString("es-PY", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });

                return (
                  <Card
                    key={order.id}
                    className="group overflow-hidden border-border/70 bg-card/50 backdrop-blur-sm transition-all duration-200 hover:shadow-lg hover:border-primary/30"
                  >
                    <CardContent className="p-0">
                      {/* Header */}
                      <div className="relative border-b border-border/60 bg-gradient-to-r from-muted/10 to-muted/5 px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <Avatar className="h-10 w-10 ring-2 ring-primary/20">
                              <AvatarFallback className="bg-primary/10 text-primary font-bold">
                                {getInitials(order.customer_name)}
                              </AvatarFallback>
                            </Avatar>
                            
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate font-semibold">
                                  {order.customer_name || "Cliente"}
                                </p>
                                {order.detected_by_ai && (
                                  <Badge variant="outline" className="gap-1 text-[10px]">
                                    <Bot className="h-3 w-3" />
                                    IA
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <Calendar className="h-3 w-3 text-muted-foreground" />
                                <p className="text-xs text-muted-foreground">{fecha}</p>
                              </div>
                            </div>
                          </div>

                          <Badge className={`${cfg.bgColor} shrink-0 gap-1.5 rounded-full px-3 py-1`}>
                            <Icon className="h-3.5 w-3.5" />
                            <span className="text-xs font-medium">{cfg.label}</span>
                          </Badge>
                        </div>

                        {/* Expand/Collapse Button */}
                        <button
                          onClick={() => toggleExpand(order.id)}
                          className="absolute bottom-0 right-4 translate-y-1/2 rounded-full bg-background p-1 shadow-md transition-all hover:scale-110"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                      </div>

                      {/* Content */}
                      <ScrollArea className={`transition-all duration-300 ${isExpanded ? "max-h-[600px]" : "max-h-[320px]"}`}>
                        <div className="p-4 space-y-3">
                          {/* Contact Info */}
                          <div className="rounded-xl bg-muted/30 p-3 space-y-2">
                            <InfoRow icon={User} label="Cliente" value={order.customer_name} />
                            <InfoRow icon={Phone} label="Teléfono" value={phoneNumber} />
                            {order.from_number && order.from_number !== order.phone && (
                              <InfoRow icon={MessageSquare} label="Contacto inicial" value={order.from_number} />
                            )}
                          </div>

                          {/* Location */}
                          <div className="rounded-xl bg-muted/30 p-3 space-y-2">
                            <InfoRow icon={MapPin} label="Ciudad" value={order.city} />
                            <InfoRow icon={MapPin} label="Dirección" value={order.address} />
                          </div>

                          {/* Product Info */}
                          <div className="rounded-xl bg-muted/30 p-3 space-y-2">
                            <InfoRow icon={Package} label="Producto" value={order.product} />
                            <InfoRow icon={Package} label="Cantidad" value={`${order.quantity || 1} unidad(es)`} />
                            <InfoRow icon={DollarSign} label="Total" value={formatCurrency(order.total_amount)} highlight />
                          </div>

                          {/* Payment */}
                          <div className="rounded-xl bg-muted/30 p-3">
                            <InfoRow icon={CreditCard} label="Método de pago" value={order.metodo_pago} />
                          </div>
                        </div>
                      </ScrollArea>

                      {/* Actions */}
                      <div className="border-t border-border/60 bg-muted/10 p-3">
                        <div className="flex flex-wrap gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => irAlChat(phoneNumber)}
                                className="flex-1"
                              >
                                <MessageSquare className="mr-2 h-4 w-4" />
                                Chat
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Ver conversación</TooltipContent>
                          </Tooltip>

                          {order.comprobante_url && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a
                                  href={order.comprobante_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex flex-1 items-center justify-center rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
                                >
                                  <ReceiptText className="mr-2 h-4 w-4" />
                                  Comprobante
                                </a>
                              </TooltipTrigger>
                              <TooltipContent>Ver comprobante de pago</TooltipContent>
                            </Tooltip>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="default" className="flex-1">
                                <Package className="mr-2 h-4 w-4" />
                                Estado
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              {order.status !== "cargado" && (
                                <DropdownMenuItem onClick={() => setOrderStatus(order, "cargado")}>
                                  <Package className="mr-2 h-4 w-4 text-blue-500" />
                                  Marcar Cargado
                                </DropdownMenuItem>
                              )}
                              {order.status !== "droppx" && (
                                <DropdownMenuItem onClick={() => setOrderStatus(order, "droppx")}>
                                  <Truck className="mr-2 h-4 w-4 text-purple-500" />
                                  Marcar Droppx
                                </DropdownMenuItem>
                              )}
                              {order.status !== "cancelado" && (
                                <DropdownMenuItem onClick={() => setOrderStatus(order, "cancelado")} className="text-red-600">
                                  <XCircle className="mr-2 h-4 w-4" />
                                  Cancelar
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => setOrderToDelete(order)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Eliminar pedido</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!orderToDelete} onOpenChange={() => setOrderToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar Pedido</DialogTitle>
            <DialogDescription>
              ¿Estás seguro de que deseas eliminar este pedido? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {orderToDelete && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p><strong>Cliente:</strong> {orderToDelete.customer_name || "Sin nombre"}</p>
              <p><strong>Producto:</strong> {orderToDelete.product || "Sin producto"}</p>
              <p><strong>Total:</strong> {formatCurrency(orderToDelete.total_amount)}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => orderToDelete && remove(orderToDelete.id)}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
