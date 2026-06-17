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

  const toDateInput = (value: string | null) => {
    if (!value) return "";
    return value.includes("T") ? value.split("T")[0] : value.substring(0, 10);
  };

  const toTimestamp = (value: string | null) => {
    if (!value) return null;
    if (value.includes("T")) return value;
    return `${value}T00:00:00`;
  };

  const fetchUsers = async () => {
    setLoading(true);

    const { data: rolesData, error: rolesError } = await supabase
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

    const rolesList = rolesData || [];
    const userIds = rolesList.map((r: any) => r.user_id);

    let profiles: any[] = [];

    if (userIds.length > 0) {
      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .in("user_id", userIds);

      if (profilesError) {
        toast({
          title: "Error",
          description: profilesError.message,
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      profiles = profilesData || [];
    }

    const profileMap: Record<string, any> = {};
    profiles.forEach((p: any) => {
      profileMap[p.user_id || p.id] = p;
    });

    const merged: ManagedUser[] = rolesList.map((r: any) => {
      const p = profileMap[r.user_id] || {};

      return {
        id: p.id || r.user_id,
        user_id: r.user_id,
        display_name: r.full_name || p.full_name || p.username || null,
        avatar_url: p.avatar_url || null,
        approved: p.approved ?? false,
        active: p.active ?? p.is_active ?? true,
        active_from: p.active_from ?? null,
        active_until: p.active_until ?? null,
        inactive_message:
          p.inactive_message || p.blocked_message || p.block_message || null,
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

  const getValue = (user: ManagedUser, field: keyof ManagedUser) => {
    const edit = getEdit(user.user_id) as any;
    return edit[field] !== undefined ? edit[field] : user[field];
  };

  const hasChanges = (userId: string) => Object.keys(getEdit(userId)).length > 0;

  const saveUser = async (user: ManagedUser) => {
    setSaving(user.user_id);

    const edits = getEdit(user.user_id);

    if (Object.keys(edits).length === 0) {
      setSaving(null);
      return;
    }

    const payload = {
      approved: edits.approved !== undefined ? edits.approved : user.approved,
      active: edits.active !== undefined ? edits.active : user.active,
      is_active: edits.active !== undefined ? edits.active : user.active,
      active_from: toTimestamp(
        edits.active_from !== undefined ? edits.active_from : user.active_from
      ),
      active_until: toTimestamp(
        edits.active_until !== undefined ? edits.active_until : user.active_until
      ),
      inactive_message:
        edits.inactive_message !== undefined
          ? edits.inactive_message
          : user.inactive_message,
      blocked_message:
        edits.inactive_message !== undefined
          ? edits.inactive_message
          : user.inactive_message,
      block_message:
        edits.inactive_message !== undefined
          ? edits.inactive_message
          : user.inactive_message,
      updated_at: new Date().toISOString(),
    };

    let { data, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("user_id", user.user_id)
      .select()
      .maybeSingle();

    if (!data && !error) {
      const insertPayload = {
        id: user.user_id,
        user_id: user.user_id,
        username: user.email,
        full_name: user.display_name,
        ...payload,
      };

      const insertResult = await supabase
        .from("profiles")
        .insert(insertPayload)
        .select()
        .single();

      data = insertResult.data;
      error = insertResult.error;
    }

    console.log("[saveUser] result:", { data, error, payload });

    if (error) {
      toast({
        title: "Error al guardar",
        description: error.message,
        variant: "destructive",
      });
      setSaving(null);
      return;
    }

    setUsers((prev) =>
      prev.map((u) =>
        u.user_id === user.user_id
          ? {
              ...u,
              approved: payload.approved,
              active: payload.active,
              active_from: payload.active_from,
              active_until: payload.active_until,
              inactive_message: payload.inactive_message,
            }
          : u
      )
    );

    setEditState((prev) => {
      const next = { ...prev };
      delete next[user.user_id];
      return next;
    });

    toast({
      title: "✅ Guardado",
      description: `Usuario ${
        user.display_name || user.email || "sin nombre"
      } actualizado`,
    });

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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <ShieldAlert className="h-12 w-12 text-destructive mx-auto" />
          <p className="text-muted-foreground">
            No tenés permisos para acceder a esta página.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="h-8 w-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Gestión de Usuarios</h1>
        <span className="text-sm text-muted-foreground">
          {users.length} usuarios
        </span>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, email o rol..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="space-y-3">
        {filtered.map((user) => {
          const isExpanded = expandedUser === user.user_id;
          const approved = getValue(user, "approved") as boolean;
          const active = getValue(user, "active") as boolean;
          const activeFrom = getValue(user, "active_from") as string | null;
          const activeUntil = getValue(user, "active_until") as string | null;
          const inactiveMessage = getValue(
            user,
            "inactive_message"
          ) as string | null;
          const changed = hasChanges(user.user_id);

          return (
            <motion.div
              key={user.user_id}
              layout
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-accent/30 transition"
                onClick={() =>
                  setExpandedUser(isExpanded ? null : user.user_id)
                }
              >
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                  {(user.display_name || user.email || "?")[0].toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">
                    {user.display_name || "Sin nombre"}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {user.email || "—"} · Registrado:{" "}
                    {format(new Date(user.created_at), "dd MMM yyyy", {
                      locale: es,
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {user.role && (
                    <span className="text-[10px] uppercase font-semibold px-2 py-1 rounded bg-muted text-muted-foreground">
                      {user.role.toUpperCase()}
                    </span>
                  )}

                  <span
                    className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                      approved
                        ? "bg-green-500/10 text-green-600"
                        : "bg-yellow-500/10 text-yellow-600"
                    }`}
                  >
                    {approved ? (
                      <UserCheck className="h-3 w-3" />
                    ) : (
                      <UserX className="h-3 w-3" />
                    )}
                    {approved ? "Aprobado" : "Pendiente"}
                  </span>

                  <span
                    className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
                      active
                        ? "bg-green-500/10 text-green-600"
                        : "bg-red-500/10 text-red-600"
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

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-border"
                  >
                    <div className="p-4 space-y-4 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {approved ? (
                            <UserCheck className="h-5 w-5 text-green-600" />
                          ) : (
                            <UserX className="h-5 w-5 text-yellow-600" />
                          )}
                          <div>
                            <div className="font-medium text-sm">
                              Aprobar usuario
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {approved
                                ? "El usuario puede usar el sistema"
                                : "El usuario NO puede acceder al sistema"}
                            </div>
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

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {active ? (
                            <Power className="h-5 w-5 text-green-600" />
                          ) : (
                            <PowerOff className="h-5 w-5 text-red-600" />
                          )}
                          <div>
                            <div className="font-medium text-sm">
                              Sistema activo
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {active
                                ? "El bot responde mensajes"
                                : "El bot NO responde mensajes"}
                            </div>
                          </div>
                        </div>

                        <Switch
                          checked={active}
                          onCheckedChange={() => toggleActive(user)}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <Calendar className="h-5 w-5 text-primary" />
                          <div>
                            <div className="font-medium text-sm">
                              Período de actividad
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Define desde cuándo y hasta cuándo la app estará
                              activa para este usuario
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pl-8">
                          <div>
                            <label className="text-xs text-muted-foreground">
                              Desde
                            </label>
                            <Input
                              type="date"
                              value={toDateInput(activeFrom)}
                              onChange={(e) =>
                                updateEdit(user.user_id, {
                                  active_from: e.target.value || null,
                                })
                              }
                              className="text-sm"
                            />
                          </div>

                          <div>
                            <label className="text-xs text-muted-foreground">
                              Hasta
                            </label>
                            <Input
                              type="date"
                              value={toDateInput(activeUntil)}
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

                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <MessageSquareWarning className="h-5 w-5 text-primary" />
                          <div>
                            <div className="font-medium text-sm">
                              Mensaje de bloqueo
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Mensaje que verá el usuario cuando su cuenta esté
                              inactiva o fuera del período
                            </div>
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
