import { motion } from "framer-motion";
import { GraduationCap, Plus, Trash2, BookOpen, Loader2, RefreshCw, ImagePlus, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface TrainingItem {
  id: string;
  intent: string;
  examples: string[];
  response: string;
  is_active: boolean;
  created_at: string;
  image_urls?: string[];
}

const MAX_IMAGES = 3;
const IMAGE_BUCKET = "training-images";

export default function TrainingPage() {
  const { user } = useAuth();
  const [trainingData, setTrainingData] = useState<TrainingItem[]>([]);
  const [intent, setIntent] = useState("");
  const [examples, setExamples] = useState("");
  const [response, setResponse] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSlotRef = useRef<number>(0);

  const loadTrainingData = async () => {
    if (!user) {
      console.log("⚠️ No hay usuario autenticado");
      setTrainingData([]);
      return;
    }

    console.log(`🔍 Cargando entrenamiento para: ${user.email} (${user.id})`);
    setLoading(true);

    const { data, error } = await supabase
      .from("training_data")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Error cargando:", error);
    } else {
      console.log(`✅ ${data?.length || 0} entrenamientos cargados para ${user.email}`);
      setTrainingData(data || []);
    }
    setLoading(false);
  };

  // ✅ CORREGIDO: Usar user?.id como dependencia
  useEffect(() => {
    if (user) {
      loadTrainingData();
    } else {
      setTrainingData([]);
    }
  }, [user?.id]); // ← Solo cambia cuando el ID cambia

  const refreshData = async () => {
    setRefreshing(true);
    await loadTrainingData();
    setRefreshing(false);
  };

  // ✅ NUEVO: subir una imagen al bucket "training-images" y devolver su URL pública
  const uploadImage = async (file: File, slotIndex: number) => {
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

    setUploadingIndex(slotIndex);

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${Date.now()}-${slotIndex}.${ext}`;

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

      setImages((prev) => {
        const next = [...prev];
        next[slotIndex] = publicUrl;
        return next.slice(0, MAX_IMAGES);
      });
    } catch (err: any) {
      console.error("❌ Error inesperado subiendo imagen:", err);
      alert("Error inesperado al subir la imagen: " + err.message);
    } finally {
      setUploadingIndex(null);
    }
  };

  const handlePickImage = (slotIndex: number) => {
    pendingSlotRef.current = slotIndex;
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file, pendingSlotRef.current);
    e.target.value = "";
  };

  const handleRemoveImage = (slotIndex: number) => {
    setImages((prev) => prev.filter((_, i) => i !== slotIndex));
  };

  const handleSave = async () => {
    if (!user) {
      alert("Debes iniciar sesión");
      return;
    }

    console.log(`📝 Guardando entrenamiento para: ${user.email} (${user.id})`);

    if (!intent.trim()) {
      alert("Por favor completa el Tema / Categoría");
      return;
    }
    if (!response.trim()) {
      alert("Por favor completa la información de entrenamiento");
      return;
    }

    const examplesArray = examples
      .split('\n')
      .filter(ex => ex.trim())
      .map(ex => ex.trim());

    setSaving(true);

    try {
      if (editingId) {
        const { error } = await supabase
          .from("training_data")
          .update({
            intent: intent.trim(),
            examples: examplesArray,
            response: response.trim(),
            image_urls: images,
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
          .insert({
            user_id: user.id,
            intent: intent.trim(),
            examples: examplesArray,
            response: response.trim(),
            image_urls: images,
            is_active: true
          });

        if (error) {
          console.error("❌ Error al guardar:", error);
          alert("Error al guardar: " + error.message);
        } else {
          console.log("✅ Datos guardados para usuario:", user.id);
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
    setResponse(item.response);
    setExamples(item.examples.join('\n'));
    setImages(Array.isArray(item.image_urls) ? item.image_urls.slice(0, MAX_IMAGES) : []);
    setEditingId(item.id);
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
    setImages([]);
    setEditingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-heading text-gradient">Entrenamiento IA</h1>
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
          <div>
            <label className="text-xs text-muted-foreground">Tema / Categoría</label>
            <input
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="ej. Productos disponibles, Precios, Envíos"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Frases de ejemplo (una por línea)</label>
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
            <label className="text-xs text-muted-foreground">Información de entrenamiento</label>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[150px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="Escribe la información que la IA debe conocer…"
            />
          </div>

          {/* ✅ NUEVO: Cuadritos de imágenes (hasta 3) */}
          <div>
            <label className="text-xs text-muted-foreground">
              Imágenes del producto ({images.length}/{MAX_IMAGES})
            </label>
            <p className="text-[10px] text-muted-foreground/70 mb-2">
              El bot las manda junto con el copy de este producto. JPG, PNG o WEBP, hasta 5MB c/u.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: MAX_IMAGES }).map((_, i) => {
                const url = images[i];
                const isUploading = uploadingIndex === i;
                return (
                  <div
                    key={i}
                    className="relative aspect-square rounded-lg border border-dashed border-border bg-secondary/30 overflow-hidden flex items-center justify-center group"
                  >
                    {isUploading ? (
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    ) : url ? (
                      <>
                        <img src={url} alt={`Imagen ${i + 1}`} className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(i)}
                          className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20"
                          title="Quitar imagen"
                        >
                          <X className="h-3 w-3 text-destructive" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePickImage(i)}
                        className="flex flex-col items-center gap-1 text-muted-foreground hover:text-primary transition-colors w-full h-full justify-center"
                      >
                        <ImagePlus className="h-5 w-5" />
                        <span className="text-[9px]">Subir</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/jpg"
              className="hidden"
              onChange={handleFileSelected}
            />
          </div>

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

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-heading font-semibold text-sm">Datos de Entrenamiento</h3>
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
              <BookOpen className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Aún no hay datos de entrenamiento</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {trainingData.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleEdit(item)}
                  className="px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer flex items-center gap-3 group"
                >
                  {Array.isArray(item.image_urls) && item.image_urls[0] ? (
                    <img
                      src={item.image_urls[0]}
                      alt=""
                      className="h-8 w-8 rounded object-cover shrink-0 border border-border"
                    />
                  ) : (
                    <GraduationCap className="h-4 w-4 text-primary shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.intent}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.response.substring(0, 60)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.examples.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/60">
                          {item.examples.length} ejemplo{item.examples.length !== 1 ? 's' : ''}
                        </p>
                      )}
                      {Array.isArray(item.image_urls) && item.image_urls.length > 0 && (
                        <p className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                          <ImagePlus className="h-2.5 w-2.5" />
                          {item.image_urls.length}
                        </p>
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
