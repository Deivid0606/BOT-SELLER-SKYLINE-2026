import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { LogIn, UserPlus, Mail, Lock, Eye, EyeOff, User } from "lucide-react";

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/");
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;

        if (data.session) {
          navigate("/");
          return;
        }

        const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
        if (!loginError) {
          navigate("/");
          return;
        }

        setIsLogin(true);
        setPassword("");
        setMessage("Cuenta creada. Ahora inicia sesión.");
      }
    } catch (err: any) {
      setError(err.message || "Error inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent/5 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-8">
          <motion.h1 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="text-4xl font-bold font-heading text-gradient tracking-tight"
          >
            SELLER SKYLINE
          </motion.h1>
          <p className="text-sm text-muted-foreground mt-2 tracking-wide">
            {isLogin ? "Inicia sesión en tu cuenta" : "Crea tu cuenta"}
          </p>
        </div>

        <div className="glass glass-border rounded-2xl p-7 shadow-pro">
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
                <label className="text-[11px] text-muted-foreground mb-1.5 block uppercase tracking-wider font-medium">Nombre completo</label>
                <div className="relative group">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-secondary/40 border border-border/60 rounded-xl pl-10 pr-4 py-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 focus:bg-secondary/60 transition-all duration-200"
                    placeholder="Tu nombre"
                    required
                  />
                </div>
              </motion.div>
            )}

            <div>
              <label className="text-[11px] text-muted-foreground mb-1.5 block uppercase tracking-wider font-medium">Email</label>
              <div className="relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-secondary/40 border border-border/60 rounded-xl pl-10 pr-4 py-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 focus:bg-secondary/60 transition-all duration-200"
                  placeholder="tu@email.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground mb-1.5 block uppercase tracking-wider font-medium">Contraseña</label>
              <div className="relative group">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-secondary/40 border border-border/60 rounded-xl pl-10 pr-11 py-3 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 focus:bg-secondary/60 transition-all duration-200"
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-destructive bg-destructive/8 border border-destructive/15 rounded-xl px-4 py-3">
                {error}
              </motion.div>
            )}
            {message && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-success bg-success/8 border border-success/15 rounded-xl px-4 py-3">
                {message}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 disabled:opacity-50
                bg-gradient-to-r from-primary to-accent text-primary-foreground
                hover:shadow-[0_0_24px_hsl(239,84%,67%,0.3)] hover:-translate-y-0.5
                active:translate-y-0 active:shadow-none"
            >
              {loading ? (
                <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              ) : isLogin ? (
                <><LogIn className="h-4 w-4" /> Iniciar sesión</>
              ) : (
                <><UserPlus className="h-4 w-4" /> Registrarse</>
              )}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              onClick={() => { setIsLogin(!isLogin); setError(""); setMessage(""); }}
              className="text-xs text-muted-foreground hover:text-primary transition-colors duration-200"
            >
              {isLogin ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Inicia sesión"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
