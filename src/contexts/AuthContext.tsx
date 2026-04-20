import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  role: "admin" | "seller" | "pending" | "banned" | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<"admin" | "seller" | "pending" | "banned" | null>(null);
  const [loading, setLoading] = useState(true);

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
        return;
      }
      
      console.log("✅ DATA RECEIVED:", data);
      console.log("✅ ROLE VALUE:", data?.role);
      
      if (data?.role) {
        setRole(data.role as "admin" | "seller" | "pending" | "banned");
      } else {
        setRole("pending");
      }
    } catch (err) {
      console.error("❌ Exception fetching role:", err);
      setRole("pending");
    }
  };

  useEffect(() => {
    console.log("🚀 AuthProvider mounted");
    
    const timeoutId = setTimeout(() => {
      if (loading) {
        console.log("⚠️ Forzando fin de carga después de 5 segundos");
        setLoading(false);
      }
    }, 5000);
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log("📢 Auth event:", event);
        console.log("📢 Session user:", session?.user?.email);
        
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await fetchRole(session.user.id);
        } else {
          setRole(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        console.log("🎯 Initial session:", session?.user?.email);
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await fetchRole(session.user.id);
        } else {
          setRole(null);
        }
        setLoading(false);
      })
      .catch((error) => {
        console.error("❌ Error getting session:", error);
        setLoading(false);
      });

    return () => {
      console.log("🔚 AuthProvider unmounting");
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
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
    
    localStorage.removeItem('supabase.auth.token');
    sessionStorage.clear();
    
    window.location.href = '/login';
  };

  console.log("📌 Current state - role:", role, "loading:", loading);

  return (
    <AuthContext.Provider value={{ user, session, role, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
