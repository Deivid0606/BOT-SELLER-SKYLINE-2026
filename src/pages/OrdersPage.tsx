// ORDERS PAGE — DASHBOARD OSCURO CORPORATIVO (v4)
// Mejoras V4: dashboard comercial, productos/unidades vendidos, cargados,
// comprobantes recuperables desde orders o inbox_messages,
// observaciones/factura destacadas y tarjetas premium.

import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

import { toast } from "sonner";

import {
  Check,
  CheckCircle2,
  RefreshCw,
  Search,
  Trash2,
  Package,
  PackageCheck,
  XCircle,
  Truck,
  MessageSquare,
  ReceiptText,
  ShoppingCart,
  Calendar,
  Clock,
  User,
  MapPin,
  Eye,
  ExternalLink,
  PieChart as PieChartIcon,
  Boxes,
  Banknote,
  FileCheck2,
  TrendingUp,
  ClipboardList,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

/* ============================================================
   TYPES
   ============================================================ */

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
  observation?: string | null;
  observacion?: string | null;
  preferred_delivery_date?: string | null;
  preferred_delivery_time?: string | null;
  payment_note?: string | null;
  payment_proof_received?: boolean | null;
  payment_proof_verified?: boolean | null;
  payment_holder_name?: string | null;
  payment_amount?: number | string | null;
  payment_operation_number?: string | null;
};

type ChatMessage = {
  id: string;
  direction: "in" | "out";
  body: string;
  created_at: string;
  media_url?: string | null;
  message_type?: string | null;
};

/* ============================================================
   CONSTANTS
   ============================================================ */

const ECOMMERCE_URL = "https://www.el-ecommercedcanpgroup.com";

const HIDDEN_STATUSES = [
  "collecting_name",
  "collecting_city",
  "collecting_address",
  "collecting_phone",
];

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: any; ring: string; chip: string }
> = {
  confirmado: {
    label: "Confirmado",
    color: "#10b981",
    icon: Check,
    ring: "ring-emerald-500/30",
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  pendiente: {
    label: "Pendiente",
    color: "#f59e0b",
    icon: Clock,
    ring: "ring-amber-500/30",
    chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  cargado: {
    label: "Cargado",
    color: "#3b82f6",
    icon: Package,
    ring: "ring-blue-500/30",
    chip: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  },
  entregado: {
    label: "Entregado",
    color: "#22c55e",
    icon: PackageCheck,
    ring: "ring-green-500/30",
    chip: "bg-green-500/15 text-green-300 border-green-500/30",
  },
  cancelado: {
    label: "Cancelado",
    color: "#ef4444",
    icon: XCircle,
    ring: "ring-red-500/30",
    chip: "bg-red-500/15 text-red-300 border-red-500/30",
  },
  droppx: {
    label: "Droppx",
    color: "#8b5cf6",
    icon: Truck,
    ring: "ring-purple-500/30",
    chip: "bg-purple-500/15 text-purple-300 border-purple-500/30",
  },
};

const FILTERS = [
  { id: "all", label: "Todos", count: "total" },
  { id: "confirmados", label: "Confirmados", count: "confirmados" },
  { id: "cargados", label: "Cargados", count: "cargados" },
  { id: "entregados", label: "Entregados", count: "entregados" },
  { id: "droppx", label: "Droppx", count: "droppx" },
  { id: "cancelados", label: "Cancelados", count: "cancelados" },
] as const;

const CHART_COLORS = ["#10b981", "#3b82f6", "#22c55e", "#8b5cf6", "#ef4444", "#f59e0b"];
const TOP_CITIES = ["Asunción", "Ciudad del Este", "Pedro Juan Caballero", "Luque", "San Lorenzo"];

/* ============================================================
   HELPERS
   ============================================================ */

function parseCurrencyValue(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let raw = String(value).trim().replace(/\s/g, "").replace(/gs\.?/gi, "").replace(/[^0-9,.-]/g, "");
  if (!raw) return 0;
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    raw = lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = raw.length - lastComma - 1;
    raw = decimals > 0 && decimals <= 2 ? raw.replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const dotCount = (raw.match(/\./g) || []).length;
    const decimals = raw.length - lastDot - 1;
    if (dotCount > 1 || decimals === 3) raw = raw.replace(/\./g, "");
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(value: string | number | null | undefined) {
  return Math.round(parseCurrencyValue(value)).toLocaleString("es-PY");
}

function localDateInputValue(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localDateBoundary(v: string, end = false) {
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
  return date.toISOString();
}

function formatDateShort(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  const time = date.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Hoy · ${time}`;
  if (diffDays === 1) return `Ayer · ${time}`;
  if (diffDays < 7) return `Hace ${diffDays} días · ${time}`;
  return `${date.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" })} · ${time}`;
}

function normalizeStatus(s: string) {
  if (s === "confirmed") return "confirmado";
  if (s === "pending") return "pendiente";
  if (s === "delivered") return "entregado";
  if (s === "cancelled" || s === "canceled") return "cancelado";
  return s;
}

function getOrderItems(order: Order): OrderItem[] {
  try {
    if (Array.isArray(order.items)) return order.items;
    if (typeof order.items === "string" && order.items.trim()) {
      const p = JSON.parse(order.items);
      return Array.isArray(p) ? p : [];
    }
  } catch {}
  return [];
}

const clean = (v: unknown) => String(v ?? "").trim();

function isGenericProductLabel(v: string | null | undefined) {
  const n = clean(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(oferta hoy|oferta|promo|promocion|producto|productos|articulo|item|sin producto)$/.test(n);
}

function getResolvedOrderItems(order: Order): OrderItem[] {
  const items = getOrderItems(order)
    .map((i) => ({
      ...i,
      product: clean(i.product || i.name),
      quantity: Number(i.quantity || 1),
      amount: Number(i.amount || i.price || 0),
    }))
    .filter((i) => i.product && !isGenericProductLabel(i.product));
  if (items.length) return items;
  const p = clean(order.product);
  if (p && !isGenericProductLabel(p)) {
    return [{ product: p, quantity: Number(order.quantity || 1), amount: Number(order.total_amount || 0) }];
  }
  return [];
}

function getPrimaryProductName(o: Order) {
  const items = getResolvedOrderItems(o);
  if (items.length === 1) return clean(items[0].product);
  if (items.length > 1) return items.map((i) => clean(i.product)).filter(Boolean).join(" + ");
  return "Producto sin identificar";
}

function getOrderObservation(order: Order): string {
  const values = [
    order.observation,
    order.observacion,
    order.payment_note,
    order.preferred_delivery_date,
    order.preferred_delivery_time,
  ]
    .map(clean)
    .filter(Boolean);
  const unique: string[] = [];
  for (const v of values)
    for (const p of v.split(/\s*\|\s*/g).map(clean).filter(Boolean))
      if (!unique.some((u) => u.toLowerCase() === p.toLowerCase())) unique.push(p);
  return unique.join(" | ");
}

function isPrepaidOrder(order: Order) {
  const paymentText = clean(`${order.metodo_pago || ""} ${order.payment_note || ""} ${order.observation || ""} ${order.observacion || ""}`).toLowerCase();
  return Boolean(order.comprobante_url) || Boolean(order.payment_proof_received) || Boolean(order.payment_proof_verified) || /\b(anticipado|transferencia|transportadora|comprobante|pago previo)\b/.test(paymentText);
}

function getPaymentSummary(order: Order) {
  return [
    order.payment_proof_verified ? "Pago verificado" : "",
    order.payment_holder_name ? `Titular: ${order.payment_holder_name}` : "",
    order.payment_amount ? `Monto: ${formatCurrency(order.payment_amount)} Gs` : "",
    order.payment_operation_number ? `Operación: ${order.payment_operation_number}` : "",
  ].filter(Boolean).join(" · ");
}

function totalUnitsFromOrders(orders: Order[]) {
  return orders.reduce((sum, order) => {
    if (normalizeStatus(order.status) === "cancelado") return sum;
    const items = getResolvedOrderItems(order);
    return sum + (items.reduce((s, item) => s + Number(item.quantity || 1), 0) || Number(order.quantity || 0));
  }, 0);
}

function productRankingFromOrders(orders: Order[]) {
  const ranking = new Map<string, { product: string; units: number; orders: number }>();
  for (const order of orders) {
    if (normalizeStatus(order.status) === "cancelado") continue;
    const items = getResolvedOrderItems(order);
    const resolved = items.length ? items : [{ product: getPrimaryProductName(order), quantity: Number(order.quantity || 1) }];
    for (const item of resolved) {
      const product = clean(item.product) || "Producto sin identificar";
      const key = product.toLowerCase();
      const previous = ranking.get(key) || { product, units: 0, orders: 0 };
      previous.units += Number(item.quantity || 1);
      previous.orders += 1;
      ranking.set(key, previous);
    }
  }
  return Array.from(ranking.values()).sort((a,b)=>b.units-a.units || b.orders-a.orders).slice(0,5);
}

function formatPhoneNumber(phone: string | null): string {
  if (!phone) return "";
  let c = phone.replace(/[^0-9]/g, "");
  if (c.startsWith("0")) c = c.substring(1);
  if (!c.startsWith("595")) c = "595" + c;
  return c;
}

function getPhoneVariants(phone: string | null | undefined): string[] {
  const raw = clean(phone);
  const digits = raw.replace(/\D/g, "");
  const international = formatPhoneNumber(raw || null);
  const local =
    international.startsWith("595") && international.length > 3
      ? `0${international.slice(3)}`
      : digits.startsWith("0")
        ? digits
        : digits
          ? `0${digits}`
          : "";

  const withoutCountry =
    international.startsWith("595") ? international.slice(3) : digits.replace(/^0/, "");

  return Array.from(
    new Set(
      [
        raw,
        digits,
        international,
        local,
        withoutCountry,
        `${international}@c.us`,
        `${international}@s.whatsapp.net`,
        `${digits}@c.us`,
        `${digits}@s.whatsapp.net`,
      ]
        .map(clean)
        .filter(Boolean)
    )
  );
}

async function getCurrentUser() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

function orderMatchesDateFilter(o: Order, f: string, from: string, to: string) {
  if (f === "all") return true;
  const t = new Date(o.created_at).getTime();
  if (!Number.isFinite(t)) return false;
  const between = (a: string, b: string) =>
    t >= new Date(a).getTime() && t <= new Date(b).getTime();
  if (f === "today") {
    const d = localDateInputValue();
    return between(localDateBoundary(d), localDateBoundary(d, true));
  }
  if (f === "yesterday") {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const d = localDateInputValue(y);
    return between(localDateBoundary(d), localDateBoundary(d, true));
  }
  if (f === "week") {
    const w = new Date();
    w.setDate(w.getDate() - 6);
    return t >= new Date(localDateBoundary(localDateInputValue(w))).getTime();
  }
  if (f === "month") {
    const m = new Date();
    m.setMonth(m.getMonth() - 1);
    return t >= new Date(localDateBoundary(localDateInputValue(m))).getTime();
  }
  if (f === "custom" && from && to) return between(localDateBoundary(from), localDateBoundary(to, true));
  return true;
}

/* ============================================================
   PAGE
   ============================================================ */

export default function OrdersPage() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>("confirmados");
  const [dateFilter, setDateFilter] = useState("today");
  const [dateFrom, setDateFrom] = useState(() => localDateInputValue());
  const [dateTo, setDateTo] = useState(() => localDateInputValue());
  const [userId, setUserId] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState("all");

  // Vista previa del chat
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [previewMessages, setPreviewMessages] = useState<ChatMessage[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [proofOrder, setProofOrder] = useState<Order | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [proofLoading, setProofLoading] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => u && setUserId(u.id));
  }, []);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q;
    if (error) {
      toast.error("Error cargando pedidos");
    } else {
      const filtered = (data || []).filter((o: Order) => !HIDDEN_STATUSES.includes(o.status));
      const unique = filtered.reduce((acc: Order[], cur: Order) => {
        if (!acc.some((i) => i.id === cur.id)) acc.push(cur);
        return acc;
      }, []);
      setOrders(unique);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId) loadOrders();
  }, [loadOrders, userId]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel("orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `user_id=eq.${userId}` },
        () => loadOrders()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadOrders]);

  async function updateStatus(order: Order, newStatus: string) {
    const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", order.id);
    if (error) toast.error("Error actualizando pedido");
    else {
      toast.success(`Pedido marcado como ${STATUS_CONFIG[newStatus]?.label || newStatus}`);
      loadOrders();
    }
  }

  async function deleteOrder(id: string) {
    if (!confirm("¿Eliminar este pedido?")) return;
    const { error } = await supabase.from("orders").delete().eq("id", id);
    if (error) toast.error("Error eliminando pedido");
    else {
      toast.success("Pedido eliminado");
      loadOrders();
    }
  }

  function openChat(phone: string | null) {
    if (!phone) return toast.error("No hay número de teléfono");
    const p = formatPhoneNumber(phone);
    if (!p || p.length < 10) return toast.error("Número inválido");
    navigate(`/inbox?phone=${encodeURIComponent(p)}`);
  }

  async function openPreview(order: Order) {
    // Abrimos el modal inmediatamente para que el usuario vea que respondió el clic.
    setPreviewOrder(order);
    setPreviewMessages([]);
    setPreviewLoading(true);

    try {
      const variants = getPhoneVariants(order.from_number || order.phone);

      if (!userId) {
        throw new Error("No se pudo identificar al usuario actual.");
      }

      if (!variants.length) {
        throw new Error("El pedido no tiene un número de WhatsApp válido.");
      }

      // El webhook guarda todos los mensajes en inbox_messages.
      // sender_id conserva el identificador/número original del chat.
      const { data, error } = await supabase
        .from("inbox_messages")
        .select("id, sender_id, from_number, message, message_type, media_url_text, created_at")
        .eq("user_id", userId)
        .in("sender_id", variants)
        .order("created_at", { ascending: true })
        .limit(300);

      if (error) throw error;

      const normalizedMessages: ChatMessage[] = (data || []).map((row: any) => {
        const messageType = clean(row.message_type).toLowerCase();
        const isOutgoing = messageType.startsWith("out_");

        return {
          id: String(row.id),
          direction: isOutgoing ? "out" : "in",
          body: clean(row.message),
          created_at: row.created_at,
          media_url: clean(row.media_url_text) || null,
          message_type: messageType,
        };
      });

      setPreviewMessages(normalizedMessages);
    } catch (error: any) {
      console.error("Error cargando vista previa:", error);
      toast.error(error?.message || "No se pudo cargar la conversación");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function openPaymentProof(order: Order) {
    setProofOrder(order);
    setProofUrl("");
    setProofLoading(true);
    try {
      if (clean(order.comprobante_url)) {
        setProofUrl(clean(order.comprobante_url));
        return;
      }
      if (!userId) throw new Error("No se pudo identificar al usuario actual.");
      const variants = getPhoneVariants(order.from_number || order.phone);
      if (!variants.length) throw new Error("El pedido no tiene un número válido.");
      const { data, error } = await supabase
        .from("inbox_messages")
        .select("id, sender_id, from_number, message, message_type, media_url_text, created_at")
        .eq("user_id", userId)
        .in("sender_id", variants)
        .not("media_url_text", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const candidate = (data || []).find((row: any) => {
        const type = clean(row.message_type).toLowerCase();
        const body = clean(row.message).toLowerCase();
        const url = clean(row.media_url_text);
        return !type.startsWith("out_") && url && (/\\b(comprobante|transferencia|pago|deposito|depósito)\\b/.test(body) || /image|document|pdf/.test(type) || /\\.(png|jpe?g|webp|pdf)(?:\\?|$)/i.test(url));
      });
      if (!candidate?.media_url_text) throw new Error("No encontré un comprobante guardado en el pedido ni en el chat.");
      setProofUrl(clean(candidate.media_url_text));
    } catch (error: any) {
      console.error("Error buscando comprobante:", error);
      toast.error(error?.message || "No se pudo abrir el comprobante");
    } finally {
      setProofLoading(false);
    }
  }

  function openEcommerce(order: Order) {
    const realChatNumber = order.from_number || order.phone || "";
    const params = new URLSearchParams({
      view: "create-order",
      nombre: order.customer_name || "",
      telefono: realChatNumber,
      ciudad: order.city || "",
      calle: order.address || "",
      producto: getPrimaryProductName(order),
      cantidad: String(
        getResolvedOrderItems(order).reduce((s, i) => s + Number(i.quantity || 1), 0) ||
          order.quantity ||
          1
      ),
      total: order.total_amount || "",
      pago: order.metodo_pago || "",
      observacion: getOrderObservation(order),
      origen: "seller-skyline",
    });
    window.open(`${ECOMMERCE_URL}/?${params.toString()}`, "_blank");
  }

  /* --------- DERIVED --------- */

  const periodOrders = useMemo(
    () => orders.filter((o) => orderMatchesDateFilter(o, dateFilter, dateFrom, dateTo)),
    [orders, dateFilter, dateFrom, dateTo]
  );
  const allConfirmedOrders = useMemo(
    () => orders.filter((o) => normalizeStatus(o.status) === "confirmado"),
    [orders]
  );

  const stats = useMemo(
    () => ({
      total: periodOrders.length,
      confirmados: periodOrders.filter((o) => normalizeStatus(o.status) === "confirmado").length,
      cargados: periodOrders.filter((o) => normalizeStatus(o.status) === "cargado").length,
      entregados: periodOrders.filter((o) => normalizeStatus(o.status) === "entregado").length,
      cancelados: periodOrders.filter((o) => normalizeStatus(o.status) === "cancelado").length,
      droppx: periodOrders.filter((o) => normalizeStatus(o.status) === "droppx").length,
      ingresos: periodOrders.filter((o) => normalizeStatus(o.status) !== "cancelado").reduce((s, o) => s + parseCurrencyValue(o.total_amount), 0),
      unidadesVendidas: totalUnitsFromOrders(periodOrders),
      pagosAnticipados: periodOrders.filter(isPrepaidOrder).length,
    }),
    [periodOrders]
  );

  const productRanking = useMemo(() => productRankingFromOrders(periodOrders), [periodOrders]);

  const filterCounts = {
    total: periodOrders.length,
    confirmados: allConfirmedOrders.length,
    cargados: stats.cargados,
    entregados: stats.entregados,
    cancelados: stats.cancelados,
    droppx: stats.droppx,
  };

  const pieData = [
    { name: "Confirmados", value: stats.confirmados, color: CHART_COLORS[0] },
    { name: "Cargados", value: stats.cargados, color: CHART_COLORS[1] },
    { name: "Entregados", value: stats.entregados, color: CHART_COLORS[2] },
    { name: "Droppx", value: stats.droppx, color: CHART_COLORS[3] },
    { name: "Cancelados", value: stats.cancelados, color: CHART_COLORS[4] },
  ].filter((i) => i.value > 0);

  const listBase = activeFilter === "confirmados" ? allConfirmedOrders : periodOrders;

  const filteredOrders = listBase.filter((order) => {
    const term = search.toLowerCase();
    const status = normalizeStatus(order.status);
    const matchesSearch =
      !search ||
      order.customer_name?.toLowerCase().includes(term) ||
      order.phone?.toLowerCase().includes(term) ||
      order.from_number?.toLowerCase().includes(term) ||
      getPrimaryProductName(order).toLowerCase().includes(term) ||
      getOrderObservation(order).toLowerCase().includes(term) ||
      order.city?.toLowerCase().includes(term);
    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "confirmados" && status === "confirmado") ||
      (activeFilter === "cargados" && status === "cargado") ||
      (activeFilter === "entregados" && status === "entregado") ||
      (activeFilter === "cancelados" && status === "cancelado") ||
      (activeFilter === "droppx" && status === "droppx");
    const matchesCity =
      selectedCity === "all" || order.city?.toLowerCase().includes(selectedCity.toLowerCase());
    return matchesSearch && matchesFilter && matchesCity;
  });

  /* ============================================================
     RENDER
     ============================================================ */

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a0612] via-[#0d0818] to-[#0a0612] text-white">
      <div className="mx-auto max-w-[1600px] space-y-6 p-6">
        {/* HEADER */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
              Panel de Pedidos
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Gestión operativa de pedidos, pagos y despacho
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400">
            <RefreshCw className="h-3 w-3" />
            Actualizado: {new Date().toLocaleTimeString()}
          </div>
        </div>

        {/* DASHBOARD COMERCIAL */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard title="Pedidos" value={stats.total} subtitle={`${stats.confirmados} confirmados`} accent="from-violet-500 to-purple-500" icon={ClipboardList} />
          <MetricCard title="Unidades vendidas" value={stats.unidadesVendidas} subtitle="Sin cancelados" accent="from-cyan-500 to-blue-500" icon={Boxes} />
          <MetricCard title="Cargados" value={stats.cargados} subtitle="Listos para despacho" accent="from-blue-500 to-indigo-500" icon={Package} />
          <MetricCard title="Entregados" value={stats.entregados} subtitle={`${stats.total ? Math.round((stats.entregados / stats.total) * 100) : 0}% del período`} accent="from-green-500 to-emerald-500" icon={PackageCheck} />
          <MetricCard title="Ingresos" value={`${formatCurrency(stats.ingresos)} Gs`} subtitle="Sin cancelados" accent="from-emerald-500 to-teal-500" icon={Banknote} />
          <MetricCard title="Pagos anticipados" value={stats.pagosAnticipados} subtitle="Con comprobante" accent="from-amber-500 to-orange-500" icon={FileCheck2} />
        </div>

        {productRanking.length > 0 && (
          <Card className="overflow-hidden border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.02] shadow-xl shadow-black/20">
            <CardHeader className="border-b border-white/5 pb-3"><CardTitle className="flex items-center gap-2 text-base text-white"><TrendingUp className="h-4 w-4 text-cyan-400" />Productos más vendidos</CardTitle></CardHeader>
            <CardContent className="p-4"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {productRanking.map((item, index) => (
                <div key={item.product} className="rounded-xl border border-white/10 bg-black/20 p-3 transition hover:border-cyan-400/30 hover:bg-white/[0.05]">
                  <div className="flex items-start justify-between gap-2"><span className="rounded-lg bg-cyan-500/10 px-2 py-1 text-xs font-bold text-cyan-300">#{index + 1}</span><span className="text-lg font-bold text-white">{item.units}</span></div>
                  <p className="mt-3 line-clamp-2 text-sm font-medium text-zinc-100">{item.product}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">{item.orders} {item.orders === 1 ? "pedido" : "pedidos"} · {item.units} unidades</p>
                </div>
              ))}
            </div></CardContent>
          </Card>
        )}

        {/* GRÁFICO */}
        {pieData.length > 0 && (
          <Card className="border-white/10 bg-white/[0.03] backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-white">
                <PieChartIcon className="h-4 w-4 text-violet-400" />
                Distribución de estados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-2">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {pieData.map((e, i) => (
                          <Cell key={i} fill={e.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {pieData.map((i) => (
                    <div
                      key={i.name}
                      className="flex items-center justify-between rounded-lg border border-white/5 bg-white/5 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: i.color }}
                        />
                        <span className="text-sm text-zinc-300">{i.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-white">{i.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* FILTROS RÁPIDOS */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => {
            const count = filterCounts[f.count as keyof typeof filterCounts] || 0;
            const active = activeFilter === f.id;
            return (
              <Button
                key={f.id}
                size="sm"
                variant="ghost"
                onClick={() => setActiveFilter(f.id)}
                className={`h-8 rounded-full border text-xs transition-all ${
                  active
                    ? "border-violet-400/50 bg-violet-600/30 text-white shadow-lg shadow-violet-900/30"
                    : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {f.label}
                <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold">
                  {count}
                </span>
              </Button>
            );
          })}
        </div>

        {/* SEARCH + FILTROS */}
        <Card className="border-white/10 bg-white/[0.03]">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <Input
                  placeholder="Buscar cliente, teléfono, producto, ciudad..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="border-white/10 bg-white/5 pl-9 text-sm text-white placeholder:text-zinc-500"
                />
              </div>
              <Select value={selectedCity} onValueChange={setSelectedCity}>
                <SelectTrigger className="h-9 w-[180px] border-white/10 bg-white/5 text-sm text-white">
                  <MapPin className="mr-1 h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las ciudades</SelectItem>
                  {TOP_CITIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="h-9 w-[180px] border-white/10 bg-white/5 text-sm text-white">
                  <Calendar className="mr-1 h-3.5 w-3.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoy</SelectItem>
                  <SelectItem value="yesterday">Ayer</SelectItem>
                  <SelectItem value="week">Últimos 7 días</SelectItem>
                  <SelectItem value="month">Último mes</SelectItem>
                  <SelectItem value="custom">Rango personalizado</SelectItem>
                  <SelectItem value="all">Todo el tiempo</SelectItem>
                </SelectContent>
              </Select>
              {dateFilter === "custom" && (
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-9 w-[145px] border-white/10 bg-white/5 text-xs text-white [color-scheme:dark]"
                  />
                  <span className="text-xs text-zinc-500">a</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-9 w-[145px] border-white/10 bg-white/5 text-xs text-white [color-scheme:dark]"
                  />
                </div>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={loadOrders}
                className="ml-auto h-9 border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Refrescar
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-zinc-500">
          Mostrando <span className="font-semibold text-white">{filteredOrders.length}</span> de{" "}
          {listBase.length} pedidos
        </p>

        {/* LISTA */}
        {loading ? (
          <div className="flex h-64 items-center justify-center text-zinc-500">
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Cargando pedidos...
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-zinc-500">
            <Package className="mb-2 h-8 w-8" />
            <p className="text-sm">No hay pedidos que coincidan con los filtros</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                onPreview={() => openPreview(order)}
                onChat={() => openChat(order.from_number || order.phone)}
                onEcommerce={() => openEcommerce(order)}
                onProof={() => openPaymentProof(order)}
                onDelete={() => deleteOrder(order.id)}
                onStatus={(s) => updateStatus(order, s)}
              />
            ))}
          </div>
        )}
      </div>

      {/* MODAL VISTA PREVIA CHAT */}
      <Dialog open={!!previewOrder} onOpenChange={(o) => !o && setPreviewOrder(null)}>
        <DialogContent className="z-[100] max-h-[92vh] w-[calc(100vw-24px)] max-w-2xl overflow-hidden border-white/10 bg-[#0d0818] p-0 text-white shadow-2xl">
          <DialogHeader className="border-b border-white/10 p-4">
            <DialogTitle className="flex items-center gap-2 text-white">
              <MessageSquare className="h-4 w-4 text-violet-400" />
              Chat con {previewOrder?.customer_name || previewOrder?.from_number || "cliente"}
            </DialogTitle>
            <DialogDescription className="text-zinc-400">
              Vista previa de la conversación ·{" "}
              {formatPhoneNumber(previewOrder?.from_number || previewOrder?.phone || "")}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[65vh] max-h-[520px] px-4 py-4">
            {previewLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Cargando conversación...
              </div>
            ) : previewMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-sm text-zinc-500">
                <MessageSquare className="mb-2 h-8 w-8 opacity-40" />
                No se encontraron mensajes guardados para este número
              </div>
            ) : (
              <div className="space-y-3">
                {previewMessages.map((m) => {
                  const isIn = m.direction === "in";
                  return (
                    <div key={m.id} className={`flex ${isIn ? "justify-start" : "justify-end"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                          isIn
                            ? "rounded-bl-sm bg-white/10 text-zinc-100"
                            : "rounded-br-sm bg-violet-600 text-white"
                        }`}
                      >
                        {m.media_url && (
                          <img
                            src={m.media_url}
                            alt="Archivo enviado en el chat"
                            className="mb-2 max-h-64 w-full rounded-lg object-contain"
                            loading="lazy"
                          />
                        )}
                        {m.body ? (
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        ) : !m.media_url ? (
                          <em className="opacity-60">[Mensaje sin texto]</em>
                        ) : null}
                        <p
                          className={`mt-1 text-[10px] ${
                            isIn ? "text-zinc-400" : "text-violet-100/80"
                          }`}
                        >
                          {new Date(m.created_at).toLocaleString("es-PY", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
          <div className="flex justify-end gap-2 border-t border-white/10 p-3">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPreviewOrder(null)}
              className="text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              Cerrar
            </Button>
            <Button
              size="sm"
              onClick={() =>
                previewOrder && openChat(previewOrder.from_number || previewOrder.phone)
              }
              className="bg-violet-600 text-white hover:bg-violet-500"
            >
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir chat completo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!proofOrder} onOpenChange={(open) => !open && setProofOrder(null)}>
        <DialogContent className="z-[110] max-h-[94vh] w-[calc(100vw-24px)] max-w-3xl overflow-hidden border-white/10 bg-[#0d0818] p-0 text-white shadow-2xl">
          <DialogHeader className="border-b border-white/10 p-4"><DialogTitle className="flex items-center gap-2"><ReceiptText className="h-4 w-4 text-amber-400" />Comprobante de pago</DialogTitle><DialogDescription className="text-zinc-400">{proofOrder?.customer_name || "Cliente"} · {formatCurrency(proofOrder?.total_amount)} Gs</DialogDescription></DialogHeader>
          <div className="max-h-[72vh] overflow-auto bg-black/30 p-4">
            {proofLoading ? <div className="flex h-72 items-center justify-center text-zinc-400"><RefreshCw className="mr-2 h-5 w-5 animate-spin" />Buscando comprobante...</div> : proofUrl ? (/\.pdf(?:\?|$)/i.test(proofUrl) ? <iframe src={proofUrl} title="Comprobante" className="h-[68vh] w-full rounded-xl border border-white/10 bg-white" /> : <img src={proofUrl} alt="Comprobante de pago" className="mx-auto max-h-[68vh] max-w-full rounded-xl border border-white/10 object-contain shadow-2xl" />) : <div className="flex h-72 flex-col items-center justify-center text-center text-zinc-500"><ReceiptText className="mb-3 h-10 w-10 opacity-40" /><p>No se encontró un comprobante guardado.</p></div>}
          </div>
          {proofOrder && <div className="space-y-2 border-t border-white/10 p-4">{getPaymentSummary(proofOrder) && <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs text-emerald-200">{getPaymentSummary(proofOrder)}</p>}<div className="flex justify-end gap-2">{proofUrl && <Button size="sm" variant="outline" onClick={() => window.open(proofUrl, "_blank")} className="border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"><ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir original</Button>}<Button size="sm" variant="ghost" onClick={() => setProofOrder(null)} className="text-zinc-400 hover:bg-white/10 hover:text-white">Cerrar</Button></div></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================================================
   ORDER CARD (rediseñada)
   ============================================================ */

function OrderCard({
  order,
  onPreview,
  onChat,
  onEcommerce,
  onProof,
  onDelete,
  onStatus,
}: {
  order: Order;
  onPreview: () => void;
  onChat: () => void;
  onEcommerce: () => void;
  onProof: () => void;
  onDelete: () => void;
  onStatus: (status: string) => void;
}) {
  const status = normalizeStatus(order.status);
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pendiente;
  const Icon = cfg.icon;
  const items = getResolvedOrderItems(order);
  const observation = getOrderObservation(order);
  const chatNumber = order.from_number || order.phone || "";
  const totalItems =
    items.reduce((s, i) => s + Number(i.quantity || 1), 0) || order.quantity || 1;
  const prepaid = isPrepaidOrder(order);
  const paymentSummary = getPaymentSummary(order);

  return (
    <Card
      className={`group relative overflow-hidden rounded-2xl border-white/10 bg-gradient-to-br from-[#171321] via-[#12101a] to-[#0d0b13] shadow-lg shadow-black/20 ring-1 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-2xl hover:shadow-black/50 ${cfg.ring}`}
    >
      {/* Barra superior de color según estado */}
      <div className="h-1 w-full" style={{ background: cfg.color }} />

      <CardContent className="space-y-4 p-5">
        {/* HEADER: fecha + estado + ojito */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Clock className="h-3 w-3" />
              <span>{formatDateShort(order.created_at)}</span>
            </div>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              Desde <span className="font-mono text-zinc-300">{chatNumber || "—"}</span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Badge className={`gap-1 border ${cfg.chip}`}>
              <Icon className="h-3 w-3" /> {cfg.label}
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              onClick={onPreview}
              title="Vista previa del chat"
              className="h-8 w-8 rounded-full text-zinc-400 hover:bg-white/10 hover:text-white"
            >
              <Eye className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* PRECIO destacado bajo la fecha */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-black/40 to-black/20 p-4 shadow-inner">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] uppercase tracking-wider text-zinc-500">Total</span>
            <span className="text-[11px] text-zinc-500">
              {totalItems} {totalItems === 1 ? "unidad" : "unidades"}
            </span>
          </div>
          <p className="mt-0.5 text-2xl font-bold tracking-tight text-white">
            {formatCurrency(order.total_amount)}{" "}
            <span className="text-sm font-medium text-zinc-500">Gs</span>
          </p>
        </div>

        {prepaid && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2">
            <div className="min-w-0"><p className="flex items-center gap-1.5 text-xs font-semibold text-amber-300"><ReceiptText className="h-3.5 w-3.5" />Pago anticipado</p><p className="mt-0.5 truncate text-[11px] text-amber-100/60">{paymentSummary || "Comprobante asociado al pedido"}</p></div>
            <Button size="sm" variant="outline" onClick={onProof} className="shrink-0 border-amber-500/30 bg-amber-500/10 text-xs text-amber-200 hover:bg-amber-500/20 hover:text-amber-100"><Eye className="mr-1 h-3.5 w-3.5" />Ver</Button>
          </div>
        )}

        {/* QUÉ COMPRÓ */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
            <ShoppingCart className="h-3 w-3" /> Qué compró
          </div>
          {items.length > 0 ? (
            <ul className="space-y-1.5">
              {items.slice(0, 3).map((it, i) => (
                <li
                  key={i}
                  className="flex items-start justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5"
                >
                  <span className="text-sm text-white">{it.product || "Producto"}</span>
                  <span className="shrink-0 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] text-zinc-300">
                    x{it.quantity || 1}
                  </span>
                </li>
              ))}
              {items.length > 3 && (
                <li className="text-[11px] text-zinc-500">+{items.length - 3} más</li>
              )}
            </ul>
          ) : (
            <p className="text-sm text-zinc-400">{getPrimaryProductName(order)}</p>
          )}
        </div>

        {/* CLIENTE + CIUDAD */}
        <div className="grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-center gap-2 text-zinc-300">
            <User className="h-3.5 w-3.5 text-zinc-500" />
            <span className="truncate">{order.customer_name || "Sin nombre"}</span>
          </div>
          {order.city && (
            <div className="flex items-center gap-2 text-zinc-400">
              <MapPin className="h-3.5 w-3.5 text-zinc-500" />
              <span className="truncate">
                {order.city}
                {order.address ? ` · ${order.address}` : ""}
              </span>
            </div>
          )}
        </div>

        {/* OBSERVACIÓN / FACTURA */}
        <div className={`rounded-xl border p-3 ${observation ? "border-amber-500/20 bg-amber-500/[0.06]" : "border-white/5 bg-white/[0.02]"}`}>
          <div className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${observation ? "text-amber-300" : "text-zinc-500"}`}><MessageSquare className="h-3 w-3" />Observación / factura</div>
          <p className={`text-xs leading-relaxed ${observation ? "text-amber-100/90" : "text-zinc-600"}`}>{observation || "Sin observaciones adicionales"}</p>
        </div>

        <Separator className="bg-white/10" />

        {/* ACCIONES DE ESTADO */}
        <div className="grid grid-cols-2 gap-2">
          {status !== "entregado" && (
            <Button
              size="sm"
              onClick={() => onStatus("entregado")}
              className="bg-green-600 text-white hover:bg-green-500"
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Entregado
            </Button>
          )}
          {status !== "cancelado" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatus("cancelado")}
              className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200"
            >
              <XCircle className="mr-1 h-3.5 w-3.5" /> Cancelar
            </Button>
          )}
          {status !== "cargado" && status !== "entregado" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatus("cargado")}
              className="border-blue-500/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200"
            >
              <Package className="mr-1 h-3.5 w-3.5" /> Cargar
            </Button>
          )}
          {status !== "droppx" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onStatus("droppx")}
              className="border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 hover:text-purple-200"
            >
              <Truck className="mr-1 h-3.5 w-3.5" /> Droppx
            </Button>
          )}
        </div>

        {/* ACCIONES SECUNDARIAS */}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onEcommerce}
            className="flex-1 border border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            <ShoppingCart className="mr-1 h-3.5 w-3.5" /> Ecommerce
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onChat}
            className="flex-1 border border-white/10 bg-white/5 text-xs text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            <MessageSquare className="mr-1 h-3.5 w-3.5" /> Chat
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            className="h-8 w-8 border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>


      </CardContent>
    </Card>
  );
}

/* ============================================================
   METRIC CARD
   ============================================================ */

function MetricCard({ title, value, subtitle, accent, icon: Icon }: { title: string; value: string | number; subtitle: string; accent: string; icon?: any; }) {
  return (
    <Card className="group relative overflow-hidden rounded-2xl border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:border-white/20">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accent}`} />
      <CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] uppercase tracking-wider text-zinc-500">{title}</p><p className="mt-2 text-2xl font-bold tracking-tight text-white">{value}</p></div>{Icon && <div className={`rounded-xl bg-gradient-to-br ${accent} p-2 text-white shadow-lg opacity-90`}><Icon className="h-4 w-4" /></div>}</div><p className="mt-2 text-[11px] text-zinc-500">{subtitle}</p></CardContent>
    </Card>
  );
}
