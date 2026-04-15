import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  UserCheck, UserX, Power, PowerOff, Calendar, MessageSquareWarning,
  ChevronDown, ChevronUp, Search, Shield, ShieldAlert, Save
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
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Fetch roles for all users
    const userIds = profiles?.map((p) => p.user_id) || [];
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", userIds);

    const roleMap: Record<string, string> = {};
    roles?.forEach((r) => (roleMap[r.user_id] = r.role));

    const merged: ManagedUser[] = (profiles || []).map((p) => ({
      id: p.id,
      user_id: p.user_id,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      approved: (p as any).approved ?? false,
      active: (p as any).active ?? true,
      active_from: (p as any).active_from,
      active_until: (p as any).active_until,
      inactive_message: (p as any).inactive_message,
      created_at: p.created_at,
      role: roleMap[p.user_id] || null,
      email: p.display_name, // fallback since we can't access auth.users
    }));

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

    const updates: any = {};
    if (edits.approved !== undefined) updates.approved = edits.approved;
    if (edits.active !== undefined) updates.active = edits.active;
    if (edits.active_from !== undefined) updates.active_from = edits.active_from || null;
    if (edits.active_until !== undefined) updates.active_until = edits.active_until || null;
    if (edits.inactive_message !== undefined) updates.inactive_message = edits.inactive_message || null;

    if (Object.keys(updates).length === 0) {
      setSaving(null);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("user_id", user.user_id);

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "✅ Guardado", description: `Usuario ${user.display_name || "sin nombre"} actualizado` });
      setEditState((prev) => {
        const next = { ...prev };
        delete next[user.user_id];
        return next;
      });
      fetchUsers();
    }
    setSaving(null);
  };

  const toggleApproval = async (user: ManagedUser) => {
    const newVal = !(getEdit(user.user_id)?.approved ?? user.approved);
    updateEdit(user.user_id, { approved: newVal });
  };

  const toggleActive = (user: ManagedUser) => {
    const newVal = !(getEdit(user.user_id)?.active ?? user.active);
    updateEdit(user.user_id, { active: newVal });
  };

  const getValue = (user: ManagedUser, field: keyof ManagedUser) => {
    const edit = getEdit(user.user_id);
    return edit[field] !== undefined ? edit[field] : user[field];
  };

  const hasChanges = (userId: string) => Object.keys(getEdit(userId)).length > 0;

  const filtered = users.filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (u.display_name || "").toLowerCase().includes(s) ||
      (u.role || "").toLowerCase().includes(s)
    );
  });

  if (role !== "admin") {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">No tenés permisos para acceder a esta página.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Gestión de Usuarios</h1>
        <span className="text-xs text-muted-foreground">{users.length} usuarios</span>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar usuario..."
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
              className="bg-card border border-border rounded-xl overflow-hidden"
            >
              {/* Header row */}
              <div
                className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-secondary/30 transition-colors"
                onClick={() => setExpandedUser(isExpanded ? null : user.user_id)}
              >
                {/* Avatar */}
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex items-center justify-center text-primary font-bold text-sm shrink-0">
                  {(user.display_name || "?")[0].toUpperCase()}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user.display_name || "Sin nombre"}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Registrado: {format(new Date(user.created_at), "dd MMM yyyy", { locale: es })}
                  </p>
                </div>

                {/* Status badges */}
                <div className="flex items-center gap-2">
                  {user.role && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      user.role === "admin"
                        ? "bg-primary/12 text-primary border border-primary/20"
                        : "bg-secondary text-muted-foreground border border-border"
                    }`}>
                      {user.role.toUpperCase()}
                    </span>
                  )}

                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                    approved
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}>
                    {approved ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                    {approved ? "Aprobado" : "Pendiente"}
                  </span>

                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${
                    active
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      : "bg-red-500/10 text-red-400 border border-red-500/20"
                  }`}>
                    {active ? <Power className="h-3 w-3" /> : <PowerOff className="h-3 w-3" />}
                    {active ? "Activo" : "Inactivo"}
                  </span>
                </div>

                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </div>

              {/* Expanded panel */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 pt-2 border-t border-border space-y-5">
                      {/* Aprobar / Rechazar */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Shield className="h-4 w-4 text-primary" />
                          <div>
                            <p className="text-sm font-medium">Aprobar usuario</p>
                            <p className="text-[10px] text-muted-foreground">
                              {approved ? "El usuario puede usar el sistema" : "El usuario NO puede acceder al sistema"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            size="sm"
                            variant={approved ? "destructive" : "default"}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleApproval(user);
                            }}
                            className="text-xs"
                          >
                            {approved ? (
                              <><UserX className="h-3.5 w-3.5 mr-1" /> Rechazar</>
                            ) : (
                              <><UserCheck className="h-3.5 w-3.5 mr-1" /> Aprobar</>
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Encender / Apagar */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {active ? (
                            <Power className="h-4 w-4 text-emerald-400" />
                          ) : (
                            <PowerOff className="h-4 w-4 text-red-400" />
                          )}
                          <div>
                            <p className="text-sm font-medium">Sistema activo</p>
                            <p className="text-[10px] text-muted-foreground">
                              {active ? "El bot responde mensajes" : "El bot NO responde mensajes"}
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
                        <div className="flex items-center gap-3">
                          <Calendar className="h-4 w-4 text-primary" />
                          <div>
                            <p className="text-sm font-medium">Período de actividad</p>
                            <p className="text-[10px] text-muted-foreground">
                              Define desde cuándo y hasta cuándo la app estará activa para este usuario
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-muted-foreground mb-1 block">Desde</label>
                            <Input
                              type="date"
                              value={activeFrom || ""}
                              onChange={(e) =>
                                updateEdit(user.user_id, { active_from: e.target.value || null })
                              }
                              className="text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground mb-1 block">Hasta</label>
                            <Input
                              type="date"
                              value={activeUntil || ""}
                              onChange={(e) =>
                                updateEdit(user.user_id, { active_until: e.target.value || null })
                              }
                              className="text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Mensaje personalizado */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <MessageSquareWarning className="h-4 w-4 text-amber-400" />
                          <div>
                            <p className="text-sm font-medium">Mensaje de bloqueo</p>
                            <p className="text-[10px] text-muted-foreground">
                              Mensaje que verá el usuario cuando su cuenta esté inactiva o fuera del período
                            </p>
                          </div>
                        </div>
                        <Textarea
                          placeholder="Ej: Tu cuenta ha sido suspendida. Contacta al administrador para más información."
                          value={inactiveMessage || ""}
                          onChange={(e) =>
                            updateEdit(user.user_id, { inactive_message: e.target.value })
                          }
                          rows={3}
                          className="text-sm"
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
