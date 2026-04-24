import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
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

// 🧹 Limpia tokens corruptos / expirados que dejan la app en pantalla negra
function clearAuthStorage() {
  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith("sb-") || k.includes("supabase")) {
        localStorage.removeItem(k);
      }
    });
    Object.keys(sessionStorage).forEach((k) => {
      if (k.startsWith("sb-") || k.includes("supabase")) {
        sessionStorage.removeItem(k);
      }
    });
  } catch (e) {
    console.log("⚠️ No se pudo limpiar storage:", e);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);

  // refs para evitar stale closures dentro de setInterval / listeners
  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const fetchRole = async (userId: string) => {
    console.log("🔍 FETCHING ROLE for:", userId);
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

      console.log("✅ ROLE VALUE:", data?.role);
      setRole((data?.role as Role) ?? "pending");
    } catch (err) {
      console.error("❌ Exception fetching role:", err);
      setRole("pending");
    }
  };

  const refreshSession = async () => {
    console.log("🔄 Refrescando sesión...");
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.error("❌ Error refrescando sesión:", error);
        // Token roto → limpiar y mandar a /auth
        clearAuthStorage();
        setSession(null);
        setUser(null);
        setRole(null);
        return;
      }
      if (data.session) {
        setSession(data.session);
        setUser(data.session.user);
        await fetchRole(data.session.user.id);
        console.log("✅ Sesión refrescada correctamente");
      }
    } catch (err) {
      console.error("❌ Exception refrescando sesión:", err);
    }
  };

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

    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}

    if ("caches" in window) {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map((name) => caches.delete(name)));
      } catch {
        console.log("No se pudo limpiar caché");
      }
    }

    window.location.replace("/auth");
  };

  useEffect(() => {
    console.log("🚀 AuthProvider mounted");

    let cancelled = false;

    // ⏱️ Failsafe: si en 4s no terminamos de cargar, soltamos la pantalla
    const timeoutId = setTimeout(() => {
      if (!cancelled) {
        console.log("⚠️ Forzando fin de carga (timeout 4s)");
        setLoading(false);
      }
    }, 4000);

    // 1) Listener PRIMERO (evita race condition)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.log("📢 Auth event:", event, newSession?.user?.email);

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        // no await acá, así el loading no se queda colgado si la query tarda
        fetchRole(newSession.user.id);
      } else {
        setRole(null);
      }
      setLoading(false);
    });

    // 2) Después chequeamos sesión existente
    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error("❌ getSession error:", error);
          clearAuthStorage();
          if (!cancelled) {
            setSession(null);
            setUser(null);
            setRole(null);
            setLoading(false);
          }
          return;
        }

        const s = data.session;
        console.log("🎯 Initial session:", s?.user?.email ?? "(none)");

        if (cancelled) return;

        setSession(s);
        setUser(s?.user ?? null);

        if (s?.user) {
          await fetchRole(s.user.id);
        } else {
          setRole(null);
        }
        setLoading(false);
      } catch (err) {
        console.error("❌ Exception getting session:", err);
        clearAuthStorage();
        if (!cancelled) {
          setSession(null);
          setUser(null);
          setRole(null);
          setLoading(false);
        }
      }
    })();

    // 3) Refresh cada 25 minutos (usa userRef, NO el state capturado)
    const interval = setInterval(() => {
      if (userRef.current) refreshSession();
    }, 25 * 60 * 1000);

    // 4) Al volver a la pestaña, refrescar
    const onVisibility = () => {
      if (document.visibilityState === "visible" && userRef.current) {
        refreshSession();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      console.log("🔚 AuthProvider unmounting");
      cancelled = true;
      clearTimeout(timeoutId);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      subscription.unsubscribe();
    };
  }, []);

  console.log("📌 state - role:", role, "loading:", loading);

  return (
    <AuthContext.Provider value={{ user, session, role, loading, signOut, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}
