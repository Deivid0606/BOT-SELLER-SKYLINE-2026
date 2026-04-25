import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Check,
  RefreshCw,
  Search,
  Trash2,
  MessageSquare,
  Receipt,
  Banknote,
  CreditCard,
  ExternalLink,
} from "lucide-react";

type Order = {
  id: string;
  user_id: string;
  phone: string | null;
  from_number: string | null;
  customer_name: string | null;
  product: string | null;
  quantity: number | null;
  total_amount: string | null;
  status: string | null;
  address: string | null;
  city: string | null;
  metodo_pago: string | null;
  comprobante_url: string | null;
  razon_estado: string | null;
  detected_by_ai: boolean | null;
  created_at: string;
};

// Solo mostramos pedidos reales (los que crea el detector o vos manualmente).
// Ignoramos los "collecting_*" que son basura de un flujo viejo.
const STATUS_VISIBLE = [
  "confirmado",
  "pendiente",
  "confirmed",
  "pending",
  "confirm_pending",
];

type FilterType = "all" | "confirmado" | "pendiente";

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .in("status", STATUS_VISIBLE)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      toast.error("Error cargando pedidos: " + error.message);
    } else {
      setOrders((data ?? []) as Order[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const ch = supabase
      .channel("orders-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => load()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const confirmarPedido = async (id: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ status: "confirmado", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido confirmado");
    load();
  };

  const eliminarPedido = async (id: string) => {
    if (!window.confirm("¿Eliminar este pedido?")) return;
    const { error } = await supabase.from("orders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido eliminado");
    load();
  };

  const isConfirmado = (status: string | null) => {
    const s = (status || "").toLowerCase();
    return s === "confirmado" || s === "confirmed";
  };

  const isPendiente = (status: string | null) => {
    const s = (status || "").toLowerCase();
    return s === "pendiente" || s === "pending" || s === "confirm_pending";
  };

  const filtered = orders.filter((o) => {
    if (filter === "confirmado" && !isConfirmado(o.status)) return false;
    if (filter === "pendiente" && !isPendiente(o.status)) return false;

    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (o.phone ?? "").toLowerCase().includes(s) ||
      (o.from_number ?? "").toLowerCase().includes(s) ||
      (o.customer_name ?? "").toLowerCase().includes(s) ||
      (o.product ?? "").toLowerCase().includes(s) ||
      (o.city ?? "").toLowerCase().includes(s)
    );
  });

  const renderStatusBadge = (status: string | null) => {
    if (isConfirmado(status)) {
      return (
        <Badge className="bg-green-500/20 text-green-300 border-green-500/40">
          <Check className="w-3 h-3 mr-1" />
          Confirmado
        </Badge>
      );
    }
    if (isPendiente(status)) {
      return (
        <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40">
          Pendiente
        </Badge>
      );
    }
    return <Badge variant="outline">{status || "—"}</Badge>;
  };

  const renderMetodoPago = (metodo: string | null) => {
    if (!metodo) return null;
    const m = metodo.toLowerCase();
    if (m.includes("efectivo")) {
      return (
        <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40">
          <Banknote className="w-3 h-3 mr-1" />
          Efectivo
        </Badge>
      );
    }
    if (m.includes("transfer")) {
      return (
        <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40">
          <CreditCard className="w-3 h-3 mr-1" />
          Transferencia
        </Badge>
      );
    }
    return <Badge variant="outline">{metodo}</Badge>;
  };

  const irAlChat = (phone: string | null) => {
    if (!phone) {
      toast.error("Este pedido no tiene número de contacto");
      return;
    }
    // Ajustá esta ruta si tu inbox usa otra (ej: /inbox?chat=...)
    navigate(`/inbox?phone=${encodeURIComponent(phone)}`);
  };

  return (
    <div className="p-6 space-y-4">
      {/* Header con filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Pedidos</h1>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar tel/cliente/producto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 w-72"
            />
          </div>

          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            Todos
          </Button>
          <Button
            size="sm"
            variant={filter === "confirmado" ? "default" : "outline"}
            onClick={() => setFilter("confirmado")}
          >
            Confirmados
          </Button>
          <Button
            size="sm"
            variant={filter === "pendiente" ? "default" : "outline"}
            onClick={() => setFilter("pendiente")}
          >
            Pendientes
          </Button>
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Refrescar
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Cargando...
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No hay pedidos con ese filtro.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((o) => {
            const phoneShow = o.phone || o.from_number || "—";
            return (
              <Card key={o.id} className="hover:border-primary/40 transition">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-base flex flex-wrap items-center gap-2">
                      <span>{o.customer_name || "Sin nombre"}</span>
                      <span className="text-muted-foreground text-sm font-normal">
                        · {phoneShow}
                      </span>
                      {o.detected_by_ai && (
                        <Badge
                          variant="outline"
                          className="text-[10px] uppercase tracking-wider"
                        >
                          Auto
                        </Badge>
                      )}
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {renderStatusBadge(o.status)}
                      {renderMetodoPago(o.metodo_pago)}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2 text-sm">
                  <p>
                    <span className="text-muted-foreground">Producto:</span>{" "}
                    <span className="font-medium">{o.product || "—"}</span>
                    {o.quantity ? (
                      <span className="text-muted-foreground"> (x{o.quantity})</span>
                    ) : null}
                  </p>

                  {o.total_amount && (
                    <p>
                      <span className="text-muted-foreground">Total:</span>{" "}
                      <span className="font-semibold">{o.total_amount}</span>
                    </p>
                  )}

                  {(o.city || o.address) && (
                    <p>
                      <span className="text-muted-foreground">Ubicación:</span>{" "}
                      {[o.city, o.address].filter(Boolean).join(" — ")}
                    </p>
                  )}

                  {o.comprobante_url && (
                    <p className="flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-blue-400" />
                      <a
                        href={o.comprobante_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        Ver comprobante
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </p>
                  )}

                  {o.razon_estado && (
                    <p className="text-xs text-muted-foreground italic">
                      {o.razon_estado}
                    </p>
                  )}

                  <p className="text-xs text-muted-foreground">
                    {new Date(o.created_at).toLocaleString()}
                  </p>

                  <div className="flex flex-wrap gap-2 pt-2">
                    {!isConfirmado(o.status) && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => confirmarPedido(o.id)}
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Confirmar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => irAlChat(phoneShow === "—" ? null : phoneShow)}
                    >
                      <MessageSquare className="w-4 h-4 mr-1" />
                      Ver chat
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => eliminarPedido(o.id)}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Eliminar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
