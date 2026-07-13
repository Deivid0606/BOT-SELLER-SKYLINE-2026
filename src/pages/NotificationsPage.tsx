import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, CheckCircle2, ExternalLink, RefreshCw, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type OrderRow = {
  id: string;
  user_id?: string | null;
  customer_name?: string | null;
  phone?: string | null;
  from_number?: string | null;
  product?: string | null;
  total_amount?: string | number | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type Notification = {
  id: string;
  orderId: string;
  title: string;
  body: string;
  number: string;
  time: string;
  createdAt: string;
  isRead: boolean;
};

const CONFIRMED_STATUSES = new Set(["confirmado", "confirmed"]);

function normalize(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isConfirmedStatus(status: unknown) {
  return CONFIRMED_STATUSES.has(normalize(status));
}

function normalizePhone(phone: string | null | undefined) {
  const digits = String(phone ?? "").replace(/\D/g, "");

  if (!digits) return "";

  if (digits.startsWith("595") && digits.length >= 12) {
    return `0${digits.slice(3)}`;
  }

  if (digits.startsWith("9") && digits.length === 9) {
    return `0${digits}`;
  }

  return digits;
}

function formatCurrency(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";

  let raw = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/gs\.?/gi, "")
    .replace(/[^0-9,.-]/g, "");

  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");

  if (lastDot >= 0 && lastComma >= 0) {
    raw =
      lastComma > lastDot
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = raw.length - lastComma - 1;
    raw =
      decimals > 0 && decimals <= 2
        ? raw.replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (lastDot >= 0) {
    const dotCount = (raw.match(/\./g) || []).length;
    const decimals = raw.length - lastDot - 1;

    if (dotCount > 1 || decimals === 3) {
      raw = raw.replace(/\./g, "");
    }
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return "";

  return Math.round(parsed).toLocaleString("es-PY", {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function formatRelativeTime(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMinutes < 1) return "Ahora";
  if (diffMinutes < 60) return `Hace ${diffMinutes} min`;
  if (diffHours < 24) return `Hace ${diffHours} h`;
  if (diffDays === 1) return "Ayer";

  return date.toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function orderToNotification(order: OrderRow): Notification {
  const number = normalizePhone(order.from_number || order.phone);
  const customer = String(order.customer_name || "Cliente").trim();
  const product = String(order.product || "Producto").trim();
  const total = formatCurrency(order.total_amount);
  const createdAt = order.updated_at || order.created_at || new Date().toISOString();

  return {
    id: `order-${order.id}`,
    orderId: order.id,
    title: "Nueva venta confirmada",
    body: `${customer} confirmó ${product}${total ? ` por ${total} Gs` : ""}.`,
    number,
    time: formatRelativeTime(createdAt),
    createdAt,
    isRead: false,
  };
}

function mergeNotification(
  current: Notification[],
  incoming: Notification
): Notification[] {
  const previous = current.find((item) => item.id === incoming.id);

  const merged = {
    ...incoming,
    isRead: previous?.isRead ?? incoming.isRead,
  };

  return [merged, ...current.filter((item) => item.id !== incoming.id)].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export default function NotificationsPage() {
  const navigate = useNavigate();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  );

  const loadNotifications = useCallback(async () => {
    if (!userId) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .select(
        "id,user_id,customer_name,phone,from_number,product,total_amount,status,created_at,updated_at"
      )
      .eq("user_id", userId)
      .in("status", ["confirmado", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Error cargando notificaciones:", error);
      setLoading(false);
      return;
    }

    const mapped = (data || [])
      .filter((order: OrderRow) => isConfirmedStatus(order.status))
      .map(orderToNotification);

    setNotifications((current) =>
      mapped.map((notification) => ({
        ...notification,
        isRead:
          current.find((item) => item.id === notification.id)?.isRead ?? false,
      }))
    );

    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUserId(data.user?.id || null);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;

    loadNotifications();

    const channel = supabase
      .channel(`confirmed-orders-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newOrder = payload.new as OrderRow | undefined;
          const oldOrder = payload.old as OrderRow | undefined;

          if (newOrder && isConfirmedStatus(newOrder.status)) {
            setNotifications((current) =>
              mergeNotification(current, orderToNotification(newOrder))
            );
            return;
          }

          if (
            oldOrder?.id &&
            isConfirmedStatus(oldOrder.status) &&
            newOrder &&
            !isConfirmedStatus(newOrder.status)
          ) {
            setNotifications((current) =>
              current.filter((item) => item.orderId !== oldOrder.id)
            );
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, loadNotifications]);

  function openChat(notification: Notification) {
    setNotifications((current) =>
      current.map((item) =>
        item.id === notification.id ? { ...item, isRead: true } : item
      )
    );

    if (!notification.number) {
      navigate("/inbox");
      return;
    }

    navigate(`/inbox?phone=${encodeURIComponent(notification.number)}`);
  }

  function markAllAsRead() {
    setNotifications((current) =>
      current.map((notification) => ({ ...notification, isRead: true }))
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-gradient font-heading text-2xl font-bold">
            Notificaciones
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Ventas confirmadas recibidas en tiempo real.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllAsRead}
              className="rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary/80"
            >
              Marcar leídas
            </button>
          )}

          <button
            type="button"
            onClick={loadNotifications}
            disabled={loading || !userId}
            className="rounded-md border border-border bg-secondary p-2 text-muted-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
            aria-label="Actualizar notificaciones"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>

          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} nueva${unreadCount === 1 ? "" : "s"}`
              : `${notifications.length} notif`}
          </span>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-lg border border-border bg-card divide-y divide-border"
      >
        {loading ? (
          <div className="flex items-center justify-center px-4 py-12 text-muted-foreground">
            <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
            <span className="text-xs">Cargando notificaciones...</span>
          </div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Bell className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              Aún no hay ventas confirmadas
            </p>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {notifications.map((notification) => (
              <motion.button
                type="button"
                key={notification.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, height: 0 }}
                onClick={() => openChat(notification)}
                className={`block w-full px-4 py-4 text-left transition-colors hover:bg-secondary/30 ${
                  notification.isRead ? "" : "bg-emerald-500/5"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <div
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                        notification.isRead
                          ? "bg-secondary text-muted-foreground"
                          : "bg-emerald-500/15 text-emerald-500"
                      }`}
                    >
                      {notification.isRead ? (
                        <ShoppingCart className="h-4 w-4" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-muted-foreground">
                          {notification.time}
                        </p>

                        {!notification.isRead && (
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        )}
                      </div>

                      <p className="mt-0.5 text-sm font-bold">
                        {notification.title}
                      </p>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {notification.body}
                      </p>

                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        Chat: {notification.number || "Número no disponible"}
                      </p>
                    </div>
                  </div>

                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground transition-colors group-hover:bg-secondary/80">
                    Abrir
                    <ExternalLink className="h-3 w-3" />
                  </span>
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        )}
      </motion.div>
    </div>
  );
}
