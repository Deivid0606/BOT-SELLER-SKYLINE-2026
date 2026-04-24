import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Check, RefreshCw, Search, Trash2 } from "lucide-react";

type Order = {
  id: string;
  phone: string | null;
  customer_name: string | null;
  product: string | null;
  quantity: number | null;
  total: number | null;
  status: string;
  address: string | null;
  notes: string | null;
  created_at: string;
};

const STATUS_VISIBLE = ["confirmed", "confirm_pending", "pending"];

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "confirmed" | "confirm_pending">("all");

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
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const confirm = async (id: string) => {
    const { error } = await supabase
      .from("orders")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido confirmado");
    load();
  };

  const remove = async (id: string) => {
    if (!confirm_dialog()) return;
    const { error } = await supabase.from("orders").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Pedido eliminado");
    load();
  };

  const filtered = orders.filter((o) => {
    if (filter !== "all" && o.status !== filter) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (o.phone ?? "").toLowerCase().includes(s) ||
      (o.customer_name ?? "").toLowerCase().includes(s) ||
      (o.product ?? "").toLowerCase().includes(s)
    );
  });

  const badge = (status: string) => {
    if (status === "confirmed") return <Badge className="bg-green-600">Confirmado</Badge>;
    if (status === "confirm_pending") return <Badge className="bg-yellow-500">Pendiente confirmar</Badge>;
    return <Badge variant="secondary">{status}</Badge>;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 w-64"
              placeholder="Buscar tel/cliente/producto"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
            Todos
          </Button>
          <Button variant={filter === "confirmed" ? "default" : "outline"} size="sm" onClick={() => setFilter("confirmed")}>
            Confirmados
          </Button>
          <Button
            variant={filter === "confirm_pending" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("confirm_pending")}
          >
            Pendientes
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-1" /> Refrescar
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-muted-foreground">Cargando...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No hay pedidos con ese filtro.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((o) => (
            <Card key={o.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">
                  {o.customer_name || "Sin nombre"} · {o.phone || "—"}
                </CardTitle>
                {badge(o.status)}
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-sm">
                  <strong>Producto:</strong> {o.product || "—"} {o.quantity ? `(x${o.quantity})` : ""}
                </div>
                {o.total != null && (
                  <div className="text-sm"><strong>Total:</strong> ${o.total}</div>
                )}
                {o.address && <div className="text-sm"><strong>Dirección:</strong> {o.address}</div>}
                {o.notes && <div className="text-sm text-muted-foreground">{o.notes}</div>}
                <div className="text-xs text-muted-foreground">
                  {new Date(o.created_at).toLocaleString()}
                </div>
                <div className="flex gap-2 pt-2">
                  {o.status !== "confirmed" && (
                    <Button size="sm" onClick={() => confirm(o.id)}>
                      <Check className="w-4 h-4 mr-1" /> Confirmar
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={() => remove(o.id)}>
                    <Trash2 className="w-4 h-4 mr-1" /> Eliminar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function confirm_dialog() {
  return window.confirm("¿Eliminar este pedido?");
}
