import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type Role = "admin" | "seller" | "pending" | "banned" | null;

type AuthContextType = {
  user: User | null;
  session: Session | null;
  role: Role;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  loading: true,
  signOut: async () => {},
  refreshSession: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);

  // Ref para acceder al user actual desde callbacks sin stale closure
  const userRef = useRef<User | null>(null);
  userRef.current = user;

  const fetchRole = useCallback(async (userId: string) => {
    console.log("🔍 Fetching role for:", userId);
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("❌ Error fetching role:", error);
        setRole("pending");
        return;
      }

      const nextRole = (data?.role as Role) || "pending";
      console.log("✅ Role:", nextRole);
      setRole(nextRole);
    } catch (err) {
      console.error("❌ Exception fetching role:", err);
      setRole("pending");
    }
  }, []);

  const applySession = useCallback(
    async (newSession: Session | null) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        await fetchRole(newSession.user.id);
      } else {
        setRole(null);
      }
    },
    [fetchRole]
  );

  const refreshSession = useCallback(async () => {
    console.log("🔄 Refrescando sesión...");
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.error("❌ Error refrescando sesión:", error);
        // Si el refresh falla, la sesión está muerta → forzar logout limpio
        if (error.message?.toLowerCase().includes("refresh")) {
          await supabase.auth.signOut();
          setSession(null);
          setUser(null);
          setRole(null);
        }
        return;
      }
      if (data.session) {
        await applySession(data.session);
        console.log("✅ Sesión refrescada");
      }
    } catch (err) {
      console.error("❌ Exception refrescando sesión:", err);
    }
  }, [applySession]);

  useEffect(() => {
    console.log("🚀 AuthProvider mounted");
    let cancelled = false;

    // 1) Listener PRIMERO (captura SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (cancelled) return;
      console.log("📢 Auth event:", event, "user:", newSession?.user?.email);
      await applySession(newSession);
      setLoading(false);
    });

    // 2) Sesión inicial DESPUÉS
    supabase.auth
      .getSession()
      .then(async ({ data: { session: initial } }) => {
        if (cancelled) return;
        console.log("🎯 Initial session:", initial?.user?.email ?? "(none)");
        await applySession(initial);
        setLoading(false);
      })
      .catch((error) => {
        console.error("❌ Error getting session:", error);
        if (!cancelled) setLoading(false);
      });

    // 3) Re-validar al volver a la pestaña (token puede estar expirado)
    const onVisibility = () => {
      if (document.visibilityState === "visible" && userRef.current) {
        console.log("👁️ Pestaña visible → refresh");
        refreshSession();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // 4) Refresh proactivo cada 25 min (Supabase JWT dura 1h por default)
    const interval = setInterval(() => {
      if (userRef.current) {
        refreshSession();
      }
    }, 25 * 60 * 1000);

    return () => {
      console.log("🔚 AuthProvider unmounting");
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }

    setRole(null);
    setUser(null);
    setSession(null);
    setLoading(false);

    // Limpiar storage
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {
      console.log("No se pudo limpiar storage");
    }

    // Limpiar caché del Service Worker / navegador
    if ("caches" in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch (e) {
        console.log("No se pudo limpiar caché");
      }
    }

    // Hard redirect (rompe cualquier estado en memoria)
    window.location.replace("/auth");
  };

  return (
    <AuthContext.Provider value={{ user, session, role, loading, signOut, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}
