import { motion } from "framer-motion";
import { 
  GraduationCap, Plus, Trash2, BookOpen, Loader2, RefreshCw, 
  ImagePlus, X, Copy, Settings, Package, Sparkles, Brain,
  Info, AlertCircle, CheckCircle2, Zap, Shield, MessageSquare
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ProductItem {
  id: string;
  image: string;
  copy: string;
  nombre_canonico: string;
  alias: string[];
  precio_1: number;
  precio_2?: number;
  nota_promo?: string;
  requiere_calce?: boolean;
  calces_disponibles?: string;
}

interface TrainingItem {
  id: string;
  intent: string;
  examples: string[];
  response: string;
  is_active: boolean;
  created_at: string;
  image_urls?: string[];
  products?: ProductItem[];
  // Nuevos campos para el entrenamiento completo
  reglas_emergencia?: string;
  reglas_parser?: string;
  cobertura_ciudades?: string[];
  formas_pago?: string;
  mensaje_bienvenida?: string;
  mensaje_despedida?: string;
  datos_transferencia?: {
    titular: string;
    ci: string;
    entidad: string;
    cuenta: string;
    alias: string;
  };
}

const MAX_IMAGES = 3;
const IMAGE_BUCKET = "training-images";

export default function TrainingPage() {
  const { user } = useAuth();
  const [trainingData, setTrainingData] = useState<TrainingItem[]>([]);
  
  // Estado del formulario
  const [intent, setIntent] = useState("");
  const [examples, setExamples] = useState("");
  const [response, setResponse] = useState("");
  const [products, setProducts] = useState<ProductItem[]>([
    { 
      id: crypto.randomUUID(), 
      image: "", 
      copy: "",
      nombre_canonico: "",
      alias: [],
      precio_1: 0,
      precio_2: undefined,
      nota_promo: "",
      requiere_calce: false,
      calces_disponibles: ""
    }
  ]);
  
  // Campos del entrenamiento
  const [reglasEmergencia, setReglasEmergencia] = useState("");
  const [reglasParser, setReglasParser] = useState("");
  const [coberturaCiudades, setCoberturaCiudades] = useState("");
  const [formasPago, setFormasPago] = useState("");
  const [mensajeBienvenida, setMensajeBienvenida] = useState("");
  const [mensajeDespedida, setMensajeDespedida] = useState("");
  const [datosTransferencia, setDatosTransferencia] = useState({
    titular: "",
    ci: "",
    entidad: "",
    cuenta: "",
    alias: ""
  });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"entrenamiento" | "productos">("entrenamiento");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingProductIdRef = useRef<string>("");

  const loadTrainingData = async () => {
    if (!user) {
      setTrainingData([]);
      return;
    }

    setLoading(true);

    const { data, error } = await supabase
      .from("training_data")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Error cargando:", error);
    } else {
      const formattedData = data?.map(item => ({
        ...item,
        products: item.products || []
      })) || [];
      setTrainingData(formattedData);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (user) {
      loadTrainingData();
    } else {
      setTrainingData([]);
    }
  }, [user?.id]);

  const refreshData = async () => {
    setRefreshing(true);
    await loadTrainingData();
    setRefreshing(false);
  };

  const uploadImage = async (file: File, productId: string) => {
    if (!user) {
      alert("Debes iniciar sesión");
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    if (!allowedTypes.includes(file.type)) {
      alert("Solo se permiten imágenes JPG, PNG o WEBP");
      return;
    }

    const maxSizeMb = 5;
    if (file.size > maxSizeMb * 1024 * 1024) {
      alert(`La imagen no puede pesar más de ${maxSizeMb}MB`);
      return;
    }

    setUploadingProductId(productId);

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}-${productId}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, { upsert: false });

      if (uploadError) {
        console.error("❌ Error subiendo imagen:", uploadError);
        alert("Error al subir la imagen: " + uploadError.message);
        return;
      }

      const { data: pub } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
      const publicUrl = pub?.publicUrl;

      if (!publicUrl) {
        alert("No se pudo obtener la URL de la imagen");
        return;
      }

      setProducts(prev => 
        prev.map(p => 
          p.id === productId ? { ...p, image: publicUrl } : p
        )
      );
    } catch (err: any) {
      console.error("❌ Error inesperado subiendo imagen:", err);
      alert("Error inesperado al subir la imagen: " + err.message);
    } finally {
      setUploadingProductId(null);
    }
  };

  const handlePickImage = (productId: string) => {
    pendingProductIdRef.current = productId;
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file, pendingProductIdRef.current);
    e.target.value = "";
  };

  const handleRemoveImage = (productId: string) => {
    setProducts(prev => 
      prev.map(p => 
        p.id === productId ? { ...p, image: "" } : p
      )
    );
  };

  const handleProductChange = (productId: string, field: keyof ProductItem, value: any) => {
    setProducts(prev => 
      prev.map(p => 
        p.id === productId ? { ...p, [field]: value } : p
      )
    );
  };

  const addProduct = () => {
    setProducts(prev => [
      ...prev,
      { 
        id: crypto.randomUUID(), 
        image: "", 
        copy: "",
        nombre_canonico: "",
        alias: [],
        precio_1: 0,
        precio_2: undefined,
        nota_promo: "",
        requiere_calce: false,
        calces_disponibles: ""
      }
    ]);
  };

  const removeProduct = (productId: string) => {
    if (products.length <= 1) {
      alert("Debe haber al menos un producto");
      return;
    }
    setProducts(prev => prev.filter(p => p.id !== productId));
  };

  const handleSave = async () => {
    if (!user) {
      alert("Debes iniciar sesión");
      return;
    }

    if (!intent.trim()) {
      alert("Por favor completa el Tema / Categoría");
      return;
    }

    // Verificar que todos los productos tengan nombre y precio
    const hasInvalidProduct = products.some(p => !p.nombre_canonico.trim() || p.precio_1 <= 0);
    if (hasInvalidProduct) {
      alert("Todos los productos deben tener Nombre Canónico y Precio");
      return;
    }

    const examplesArray = examples
      .split('\n')
      .filter(ex => ex.trim())
      .map(ex => ex.trim());

    const ciudadesArray = coberturaCiudades
      .split('\n')
      .filter(c => c.trim())
      .map(c => c.trim());

    setSaving(true);

    try {
      const trainingData = {
        user_id: user.id,
        intent: intent.trim(),
        examples: examplesArray,
        response: response.trim(),
        products: products,
        reglas_emergencia: reglasEmergencia.trim(),
        reglas_parser: reglasParser.trim(),
        cobertura_ciudades: ciudadesArray,
        formas_pago: formasPago.trim(),
        mensaje_bienvenida: mensajeBienvenida.trim(),
        mensaje_despedida: mensajeDespedida.trim(),
        datos_transferencia: datosTransferencia,
        is_active: true
      };

      if (editingId) {
        const { error } = await supabase
          .from("training_data")
          .update({
            ...trainingData,
            updated_at: new Date().toISOString()
          })
          .eq("id", editingId)
          .eq("user_id", user.id);

        if (error) {
          console.error("❌ Error al actualizar:", error);
          alert("Error al actualizar: " + error.message);
        } else {
          alert("✅ Datos actualizados correctamente");
          resetForm();
          await loadTrainingData();
        }
      } else {
        const { error } = await supabase
          .from("training_data")
          .insert(trainingData);

        if (error) {
          console.error("❌ Error al guardar:", error);
          alert("Error al guardar: " + error.message);
        } else {
          alert("✅ Datos guardados correctamente");
          resetForm();
          await loadTrainingData();
        }
      }
    } catch (err: any) {
      console.error("❌ Error inesperado:", err);
      alert("Error inesperado: " + err.message);
    }

    setSaving(false);
  };

  const handleEdit = (item: TrainingItem) => {
    setIntent(item.intent);
    setExamples(item.examples.join('\n'));
    setResponse(item.response || "");
    setProducts(item.products || []);
    setReglasEmergencia(item.reglas_emergencia || "");
    setReglasParser(item.reglas_parser || "");
    setCoberturaCiudades((item.cobertura_ciudades || []).join('\n'));
    setFormasPago(item.formas_pago || "");
    setMensajeBienvenida(item.mensaje_bienvenida || "");
    setMensajeDespedida(item.mensaje_despedida || "");
    setDatosTransferencia(item.datos_transferencia || {
      titular: "",
      ci: "",
      entidad: "",
      cuenta: "",
      alias: ""
    });
    setEditingId(item.id);
    setActiveTab("entrenamiento");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Eliminar este dato de entrenamiento?")) return;

    setLoading(true);
    const { error } = await supabase
      .from("training_data")
      .delete()
      .eq("id", id)
      .eq("user_id", user?.id);

    if (error) {
      console.error("Error al eliminar:", error);
      alert("Error al eliminar: " + error.message);
    } else {
      alert("✅ Dato eliminado");
      await loadTrainingData();
    }
    setLoading(false);
  };

  const resetForm = () => {
    setIntent("");
    setExamples("");
    setResponse("");
    setProducts([{ 
      id: crypto.randomUUID(), 
      image: "", 
      copy: "",
      nombre_canonico: "",
      alias: [],
      precio_1: 0,
      precio_2: undefined,
      nota_promo: "",
      requiere_calce: false,
      calces_disponibles: ""
    }]);
    setReglasEmergencia("");
    setReglasParser("");
    setCoberturaCiudades("");
    setFormasPago("");
    setMensajeBienvenida("");
    setMensajeDespedida("");
    setDatosTransferencia({
      titular: "",
      ci: "",
      entidad: "",
      cuenta: "",
      alias: ""
    });
    setEditingId(null);
    setActiveTab("entrenamiento");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading text-gradient">🧩 Entrenamiento Mega Todo Store</h1>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Usuario: {user?.email || "No autenticado"} • ID: {user?.id?.substring(0, 8) || "---"}...
          </p>
        </div>
        <button
          onClick={refreshData}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 text-xs bg-secondary/50 border border-border rounded-lg hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Cargando..." : "Recargar"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-lg p-5 space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-secondary/30 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("entrenamiento")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                activeTab === "entrenamiento" 
                  ? "bg-primary text-primary-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Brain className="h-3.5 w-3.5" />
              Entrenamiento
            </button>
            <button
              onClick={() => setActiveTab("productos")}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-all ${
                activeTab === "productos" 
                  ? "bg-primary text-primary-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              Catálogo ({products.length})
            </button>
          </div>

          {activeTab === "entrenamiento" ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Settings className="h-3 w-3" />
                  Tema / Categoría
                </label>
                <input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  placeholder="ej. Productos disponibles, Precios, Envíos"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  Frases de ejemplo (una por línea)
                </label>
                <textarea
                  value={examples}
                  onChange={(e) => setExamples(e.target.value)}
                  placeholder="cuánto cuesta?&#10;precio del producto&#10;valor final"
                  rows={3}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm font-mono resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  El bot usará estas frases para identificar la intención
                </p>
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  Reglas de Emergencia
                </label>
                <textarea
                  value={reglasEmergencia}
                  onChange={(e) => setReglasEmergencia(e.target.value)}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[100px] resize-y font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  placeholder="Reglas de cantidad, límites, etc."
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  Reglas del Parser
                </label>
                <textarea
                  value={reglasParser}
                  onChange={(e) => setReglasParser(e.target.value)}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[100px] resize-y font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  placeholder="Cómo interpretar mensajes, detectar productos, etc."
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Cobertura - Ciudades (una por línea)
                </label>
                <textarea
                  value={coberturaCiudades}
                  onChange={(e) => setCoberturaCiudades(e.target.value)}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[100px] resize-y font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  placeholder="asuncion&#10;fernando de la mora&#10;luque"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Ciudades con envío gratis contra-entrega
                </p>
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <CreditCard className="h-3 w-3" />
                  Formas de Pago
                </label>
                <input
                  value={formasPago}
                  onChange={(e) => setFormasPago(e.target.value)}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  placeholder="QR, Débito, Transferencia, Efectivo al recibir"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  Mensaje de Bienvenida
                </label>
                <textarea
                  value={mensajeBienvenida}
                  onChange={(e) => setMensajeBienvenida(e.target.value)}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[80px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  placeholder="Hola! Bienvenido a Mega Todo Store..."
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  Mensaje de Despedida / Cierre
                </label>
                <textarea
                  value={mensajeDespedida}
                  onChange={(e) => setMensajeDespedida(e.target.value)}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[80px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  placeholder="¡Gracias por tu compra!..."
                />
              </div>

              <div className="border-t border-border pt-4">
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Banknote className="h-3 w-3" />
                  Datos para Transferencia
                </label>
                <div className="grid grid-cols-1 gap-2 mt-1">
                  <input
                    value={datosTransferencia.titular}
                    onChange={(e) => setDatosTransferencia(prev => ({ ...prev, titular: e.target.value }))}
                    placeholder="Titular"
                    className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  />
                  <input
                    value={datosTransferencia.ci}
                    onChange={(e) => setDatosTransferencia(prev => ({ ...prev, ci: e.target.value }))}
                    placeholder="CI"
                    className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  />
                  <input
                    value={datosTransferencia.entidad}
                    onChange={(e) => setDatosTransferencia(prev => ({ ...prev, entidad: e.target.value }))}
                    placeholder="Entidad (Ej: ueno bank)"
                    className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  />
                  <input
                    value={datosTransferencia.cuenta}
                    onChange={(e) => setDatosTransferencia(prev => ({ ...prev, cuenta: e.target.value }))}
                    placeholder="N° de cuenta"
                    className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  />
                  <input
                    value={datosTransferencia.alias}
                    onChange={(e) => setDatosTransferencia(prev => ({ ...prev, alias: e.target.value }))}
                    placeholder="Alias"
                    className="bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground flex items-center gap-1">
                  <BookOpen className="h-3 w-3" />
                  Información de Entrenamiento (Respuesta Modelo)
                </label>
                <textarea
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[150px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  placeholder="Escribe la información que la IA debe conocer…"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Productos */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground flex items-center gap-1">
                    <Package className="h-3 w-3" />
                    Productos ({products.length})
                  </label>
                  <button
                    type="button"
                    onClick={addProduct}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Añadir producto
                  </button>
                </div>

                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                  {products.map((product, index) => (
                    <div key={product.id} className="border border-border rounded-lg p-3 space-y-3 relative">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Producto #{index + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeProduct(product.id)}
                          className="text-destructive hover:text-destructive/80 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Imagen */}
                      <div>
                        <label className="text-[10px] text-muted-foreground">Imagen</label>
                        <div className="mt-1 aspect-video rounded-lg border border-dashed border-border bg-secondary/30 overflow-hidden flex items-center justify-center group max-w-[200px]">
                          {uploadingProductId === product.id ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          ) : product.image ? (
                            <div className="relative w-full h-full">
                              <img src={product.image} alt={`Producto ${index + 1}`} className="w-full h-full object-cover" />
                              <button
                                type="button"
                                onClick={() => handleRemoveImage(product.id)}
                                className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20"
                              >
                                <X className="h-3 w-3 text-destructive" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handlePickImage(product.id)}
                              className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary transition-colors w-full h-full justify-center"
                            >
                              <ImagePlus className="h-5 w-5" />
                              <span className="text-[9px]">Subir imagen</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Copy del producto */}
                      <div>
                        <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <Copy className="h-3 w-3" />
                          Copy / Mensaje de Venta
                        </label>
                        <textarea
                          value={product.copy}
                          onChange={(e) => handleProductChange(product.id, "copy", e.target.value)}
                          className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[80px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                          placeholder="🔥 Descripción del producto con emojis..."
                        />
                      </div>

                      {/* Datos del producto */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground">Nombre Canónico</label>
                          <input
                            value={product.nombre_canonico}
                            onChange={(e) => handleProductChange(product.id, "nombre_canonico", e.target.value)}
                            className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                            placeholder="Ej: Procesador de Alimentos Premium RAF PRO"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Alias (separados por coma)</label>
                          <input
                            value={product.alias.join(', ')}
                            onChange={(e) => handleProductChange(product.id, "alias", e.target.value.split(',').map(a => a.trim()).filter(Boolean))}
                            className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                            placeholder="procesador, proce, raf pro"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Precio 1</label>
                          <input
                            type="number"
                            value={product.precio_1 || ''}
                            onChange={(e) => handleProductChange(product.id, "precio_1", Number(e.target.value))}
                            className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                            placeholder="169900"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Precio 2 (Promo)</label>
                          <input
                            type="number"
                            value={product.precio_2 || ''}
                            onChange={(e) => handleProductChange(product.id, "precio_2", e.target.value ? Number(e.target.value) : undefined)}
                            className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                            placeholder="249900"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] text-muted-foreground">Nota Promo</label>
                          <input
                            value={product.nota_promo || ''}
                            onChange={(e) => handleProductChange(product.id, "nota_promo", e.target.value)}
                            className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                            placeholder="PROMO 2x"
                          />
                        </div>
                        <div className="col-span-2 flex items-center gap-4">
                          <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={product.requiere_calce || false}
                              onChange={(e) => handleProductChange(product.id, "requiere_calce", e.target.checked)}
                              className="rounded border-border"
                            />
                            Requiere Calce/Talle
                          </label>
                          {product.requiere_calce && (
                            <input
                              value={product.calces_disponibles || ''}
                              onChange={(e) => handleProductChange(product.id, "calces_disponibles", e.target.value)}
                              className="flex-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                              placeholder="35,36,37,38,39,40,41,42,43,44,45,46"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/jpg"
            className="hidden"
            onChange={handleFileSelected}
          />

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? "Guardando..." : (editingId ? "Actualizar" : "Guardar")}
            </button>
            {editingId && (
              <button
                onClick={resetForm}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-sm font-medium border border-border hover:bg-secondary/80 transition-colors"
              >
                Cancelar
              </button>
            )}
          </div>
        </motion.div>

        {/* Lista de entrenamientos */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-heading font-semibold text-sm flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Entrenamientos Guardados
            </h3>
            <span className="text-[10px] text-muted-foreground">
              {trainingData.length} item{trainingData.length !== 1 ? 's' : ''}
            </span>
          </div>
          {loading ? (
            <div className="px-4 py-12 text-center">
              <Loader2 className="h-8 w-8 text-muted-foreground/40 animate-spin mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Cargando...</p>
            </div>
          ) : trainingData.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <GraduationCap className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Aún no hay datos de entrenamiento</p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {trainingData.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleEdit(item)}
                  className="px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer flex items-center gap-3 group"
                >
                  {item.products && item.products.length > 0 && item.products[0].image ? (
                    <img
                      src={item.products[0].image}
                      alt=""
                      className="h-8 w-8 rounded object-cover shrink-0 border border-border"
                    />
                  ) : (
                    <GraduationCap className="h-4 w-4 text-primary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.intent}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground/60">
                        {item.products?.length || 0} productos
                      </span>
                      {item.examples && item.examples.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60">
                          • {item.examples.length} ejemplos
                        </span>
                      )}
                      {item.cobertura_ciudades && item.cobertura_ciudades.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60">
                          • {item.cobertura_ciudades.length} ciudades
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 rounded"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

// Iconos faltantes
const CreditCard = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="M2 10h20" />
  </svg>
);

const Banknote = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M6 12h.01M18 12h.01" />
  </svg>
);
