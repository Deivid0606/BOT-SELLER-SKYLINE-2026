import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserCheck,
  UserX,
  Power,
  PowerOff,
  Calendar,
  MessageSquareWarning,
  ChevronDown,
  ChevronUp,
  Search,
  Shield,
  ShieldAlert,
  Save,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type ManagedUser = {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  approved: boolean;
  active: boolean;
  active_from: string | null;
  active_until: string | null;
  inactive_message: string | null;
  created_at: string;
  role: string | null;
  email: string | null;
};

export default function AdminUsersPage() {
  const { role } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [editState, setEditState] = useState<Record<string, Partial<ManagedUser>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);

    const { data: roles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id, role, email, full_name, created_at")
      .order("created_at", { ascending: true });

    if (rolesError) {
      toast({
        title: "Error",
        description: rolesError.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const userIds = (roles || []).map((r: any) => r.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("*")
      .in("user_id", userIds);

    const profileMap: Record<string, any> = {};
    profiles?.forEach((p: any) => (profileMap[p.user_id] = p));

    const merged: ManagedUser[] = (roles || []).map((r: any) => {
      const p = profileMap[r.user_id] || {};
      return {
        id: p.id || r.user_id,
        user_id: r.user_id,
        display_name: r.full_name || p.display_name || null,
        avatar_url: p.avatar_url || null,
        approved: p.approved ?? false,
        active: p.active ?? true,
        active_from: p.active_from ?? null,
        active_until: p.active_until ?? null,
        inactive_message: p.inactive_message ?? null,
        created_at: r.created_at,
        role: r.role,
        email: r.email,
      };
    });

    setUsers(merged);
    setLoading(false);
  };

  const getEdit = (userId: string) => editState[userId] || {};

  const updateEdit = (userId: string, changes: Partial<ManagedUser>) => {
    setEditState((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], ...changes },
    }));
  };

  const saveUser = async (user: ManagedUser) => {
    setSaving(user.user_id);
    const edits = getEdit(user.user_id);

    if (Object.keys(edits).length === 0) {
      setSaving(null);
      return;
    }

    const payload: any = {
      user_id: user.user_id,
      id: user.user_id,
      approved: edits.approved !== undefined ? edits.approved : user.approved,
      active: edits.active !== undefined ? edits.active : user.active,
      active_from:
        edits.active_from !== undefined ? edits.active_from : user.active_from,
      active_until:
        edits.active_until !== undefined ? edits.active_until : user.active_until,
      inactive_message:
        edits.inactive_message !== undefined
          ? edits.inactive_message
          : user.inactive_message,
    };

    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "user_id" });

    if (error) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "✅ Guardado",
        description: `Usuario ${user.display_name || user.email || "sin nombre"} actualizado`,
      });
      setEditState((prev) => {
        const next = { ...prev };
        delete next[user.user_id];
        return next;
      });
      fetchUsers();
    }
    setSaving(null);
  };

  const toggleApproval = (user: ManagedUser) => {
    const newVal = !(getEdit(user.user_id)?.approved ?? user.approved);
    updateEdit(user.user_id, { approved: newVal });
  };

  const toggleActive = (user: ManagedUser) => {
    const newVal = !(getEdit(user.user_id)?.active ?? user.active);
    updateEdit(user.user_id, { active: newVal });
  };

  const getValue = (user: ManagedUser, field: keyof ManagedUser) => {
    const edit = getEdit(user.user_id) as any;
    return edit[field] !== undefined ? edit[field] : user[field];
  };

  const hasChanges = (userId: string) => Object.keys(getEdit(userId)).length > 0;

  const filtered = users.filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (u.display_name || "").toLowerCase().includes(s) ||
      (u.email || "").toLowerCase().includes(s) ||
      (u.role || "").toLowerCase().includes(s)
    );
  });

  if (role !== "admin") {
    return (
      <div className="p-8">
        <p className="text-center text-muted-foreground">
          No tenés permisos para acceder a esta página.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="h-8 w-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Gestión de Usuarios</h1>
        <span className="text-sm text-muted-foreground">{users.length} usuarios</span>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, email o rol..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Users list */}
      <div className="space-y-3">
        {filtered.map((user) => {
          const isExpanded = expandedUser === user.user_id;
          const approved = getValue(user, "approved") as boolean;
          const active = getValue(user, "active") as boolean;
          const activeFrom = getValue(user, "active_from") as string | null;
          const activeUntil = getValue(user, "active_until") as string | null;
          const inactiveMessage = getValue(user, "inactive_message") as string | null;
          const changed = hasChanges(user.user_id);

          return (
            <motion.div
              key={user.user_id}
              layout
              className="border rounded-lg bg-card overflow-hidden"
            >
              {/* Header row */}
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-accent/50"
                onClick={() => setExpandedUser(isExpanded ? null : user.user_id)}
              >
                {/* Avatar */}
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-semibold text-primary">
                  {(user.display_name || user.email || "?")[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {user.display_name || "Sin nombre"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user.email || "—"} · Registrado:{" "}
                    {format(new Date(user.created_at), "dd MMM yyyy", { locale: es })}
                  </p>
                </div>

                {/* Status badges */}
                <div className="flex items-center gap-2">
                  {user.role && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-muted text-muted-foreground">
                      {user.role.toUpperCase()}
                    </span>
                  )}

                  <span
                    className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                      approved
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-amber-500/10 text-amber-600"
                    }`}
                  >
                    {approved ? (
                      <Shield className="h-3 w-3" />
                    ) : (
                      <ShieldAlert className="h-3 w-3" />
                    )}
                    {approved ? "Aprobado" : "Pendiente"}
                  </span>

                  <span
                    className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                      active
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-rose-500/10 text-rose-600"
                    }`}
                  >
                    {active ? (
                      <Power className="h-3 w-3" />
                    ) : (
                      <PowerOff className="h-3 w-3" />
                    )}
                    {active ? "Activo" : "Inactivo"}
                  </span>
                </div>

                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Expanded panel */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t overflow-hidden"
                  >
                    <div className="p-4 space-y-6">
                      {/* Aprobar / Rechazar */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          {approved ? (
                            <UserCheck className="h-5 w-5 text-emerald-600 mt-0.5" />
                          ) : (
                            <UserX className="h-5 w-5 text-amber-600 mt-0.5" />
                          )}
                          <div>
                            <p className="font-medium text-sm">Aprobar usuario</p>
                            <p className="text-xs text-muted-foreground">
                              {approved
                                ? "El usuario puede usar el sistema"
                                : "El usuario NO puede acceder al sistema"}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant={approved ? "outline" : "default"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleApproval(user);
                          }}
                          className="text-xs gap-1"
                        >
                          {approved ? (
                            <>
                              <UserX className="h-3 w-3" /> Rechazar
                            </>
                          ) : (
                            <>
                              <UserCheck className="h-3 w-3" /> Aprobar
                            </>
                          )}
                        </Button>
                      </div>

                      {/* Encender / Apagar */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          {active ? (
                            <Power className="h-5 w-5 text-emerald-600 mt-0.5" />
                          ) : (
                            <PowerOff className="h-5 w-5 text-rose-600 mt-0.5" />
                          )}
                          <div>
                            <p className="font-medium text-sm">Sistema activo</p>
                            <p className="text-xs text-muted-foreground">
                              {active
                                ? "El bot responde mensajes"
                                : "El bot NO responde mensajes"}
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={active}
                          onCheckedChange={() => toggleActive(user)}
                        />
                      </div>

                      {/* Rango de fechas */}
                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <Calendar className="h-5 w-5 text-primary mt-0.5" />
                          <div>
                            <p className="font-medium text-sm">Período de actividad</p>
                            <p className="text-xs text-muted-foreground">
                              Define desde cuándo y hasta cuándo la app estará activa para este usuario
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 pl-8">
                          <div>
                            <label className="text-xs text-muted-foreground">Desde</label>
                            <Input
                              type="date"
                              value={activeFrom ? activeFrom.substring(0, 10) : ""}
                              onChange={(e) =>
                                updateEdit(user.user_id, {
                                  active_from: e.target.value || null,
                                })
                              }
                              className="text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Hasta</label>
                            <Input
                              type="date"
                              value={activeUntil ? activeUntil.substring(0, 10) : ""}
                              onChange={(e) =>
                                updateEdit(user.user_id, {
                                  active_until: e.target.value || null,
                                })
                              }
                              className="text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Mensaje personalizado */}
                      <div className="space-y-2">
                        <div className="flex items-start gap-3">
                          <MessageSquareWarning className="h-5 w-5 text-amber-600 mt-0.5" />
                          <div>
                            <p className="font-medium text-sm">Mensaje de bloqueo</p>
                            <p className="text-xs text-muted-foreground">
                              Mensaje que verá el usuario cuando su cuenta esté inactiva o fuera del período
                            </p>
                          </div>
                        </div>
                        <Textarea
                          value={inactiveMessage || ""}
                          onChange={(e) =>
                            updateEdit(user.user_id, {
                              inactive_message: e.target.value,
                            })
                          }
                          rows={3}
                          className="text-sm"
                          placeholder="Ej: Tu cuenta está temporalmente desactivada. Contactá al administrador."
                        />
                      </div>

                      {/* Save button */}
                      {changed && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex justify-end"
                        >
                          <Button
                            onClick={(e) => {
                              e.stopPropagation();
                              saveUser(user);
                            }}
                            disabled={saving === user.user_id}
                            className="gap-2"
                          >
                            {saving === user.user_id ? (
                              <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                            Guardar cambios
                          </Button>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
