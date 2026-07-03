import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText,
  Plus,
  Trash2,
  Eye,
  Upload,
  X,
  Image,
  Video,
  Sparkles,
  Phone,
  GripVertical,
  Edit2,
  Check,
  Copy,
  MessageSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

type MediaFile = {
  file: File;
  preview: string;
  type: "image" | "video" | "gif";
  mediaType: string;
};

// 👇 SIMPLIFICADO: Solo texto y emoji
type TemplateButton = {
  id: string;
  label: string;  // Lo que ve el cliente
  emoji?: string; // Emoji opcional
};

type SavedTemplate = {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  content: string | null;
  variables: any;
  platform: string | null;
  is_active: boolean | null;
  usage_count: number | null;
  created_at: string;
  updated_at: string;
  media_url: string | null;
  media_type: string | null;
  media_file_name: string | null;
  buttons?: TemplateButton[];
};

export default function TemplatesPage() {
  const { user } = useAuth();

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [images, setImages] = useState<MediaFile[]>([]);
  const [video, setVideo] = useState<MediaFile | null>(null);
  const [gif, setGif] = useState<MediaFile | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingButtonId, setEditingButtonId] = useState<string | null>(null);
  const [isAddingButton, setIsAddingButton] = useState(false);

  // 👇 Estado para botones - SIMPLIFICADO
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  
  // 👇 Formulario simplificado
  const [buttonForm, setButtonForm] = useState<Omit<TemplateButton, 'id'>>({
    label: '',
    emoji: '💬'
  });

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);

  // Emojis predefinidos para los botones
  const availableEmojis = [
    '💬', '👍', '👋', '🛠️', '💰', 'ℹ️', '📦', '🚀', '⭐', 
    '❤️', '🔧', '📄', '❓', '💻', '📱', '📊', '🎯', '🏷️',
    '🎉', '✨', '🔥', '💡', '🔔', '📌', '📍', '🎈', '🎁'
  ];

  // Subir archivo a Supabase Storage
  const uploadFile = async (file: File, folder: string): Promise<string | null> => {
    if (!user) return null;
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/${Date.now()}.${fileExt}`;
    const filePath = `${folder}/${fileName}`;
    
    const { error } = await supabase.storage
      .from('templates-media')
      .upload(filePath, file);
    
    if (error) {
      console.error("Error subiendo archivo:", error);
      toast({ title: "Error al subir archivo", description: error.message, variant: "destructive" });
      return null;
    }
    
    const { data: { publicUrl } } = supabase.storage
      .from('templates-media')
      .getPublicUrl(filePath);
    
    return publicUrl;
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 3 - images.length;
    
    const validFiles = files.filter(file => {
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "Archivo muy grande", description: `${file.name} excede 5MB`, variant: "destructive" });
        return false;
      }
      return true;
    });
    
    const toAdd = validFiles.slice(0, remaining).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: "image" as const,
      mediaType: file.type,
    }));
    setImages((prev) => [...prev, ...toAdd]);
    e.target.value = "";
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 16 * 1024 * 1024) {
        toast({ title: "Video muy grande", description: "El video no puede superar 16MB", variant: "destructive" });
        e.target.value = "";
        return;
      }
      setVideo({ file, preview: URL.createObjectURL(file), type: "video", mediaType: file.type });
    }
    e.target.value = "";
  };

  const handleGifUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "GIF muy grande", description: "El GIF no puede superar 5MB", variant: "destructive" });
        e.target.value = "";
        return;
      }
      setGif({ file, preview: URL.createObjectURL(file), type: "gif", mediaType: file.type });
    }
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  // ========== FUNCIONES PARA BOTONES SIMPLIFICADAS ==========
  
  // Agregar nuevo botón
  const handleAddButton = () => {
    if (!buttonForm.label.trim()) {
      toast({ title: "Falta etiqueta", description: "Escribe un texto para el botón", variant: "destructive" });
      return;
    }
    
    if (editingButtonId) {
      // Editar botón existente
      setButtons(prev => prev.map(btn => 
        btn.id === editingButtonId 
          ? { ...buttonForm, id: editingButtonId }
          : btn
      ));
      toast({ title: "✅ Botón actualizado" });
    } else {
      // Agregar nuevo botón
      const newButton: TemplateButton = {
        ...buttonForm,
        id: `btn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
      setButtons(prev => [...prev, newButton]);
      toast({ title: "✅ Botón agregado" });
    }
    
    resetButtonForm();
  };

  // Eliminar botón
  const handleRemoveButton = (id: string) => {
    setButtons(prev => prev.filter(btn => btn.id !== id));
    toast({ title: "🗑️ Botón eliminado" });
  };

  // Editar botón (cargar en formulario)
  const handleEditButton = (button: TemplateButton) => {
    setButtonForm({
      label: button.label,
      emoji: button.emoji || '💬'
    });
    setEditingButtonId(button.id);
    setIsAddingButton(true);
  };

  // Cancelar edición/agregado
  const resetButtonForm = () => {
    setButtonForm({
      label: '',
      emoji: '💬'
    });
    setEditingButtonId(null);
    setIsAddingButton(false);
  };

  // Duplicar botón
  const handleDuplicateButton = (button: TemplateButton) => {
    const newButton: TemplateButton = {
      id: `btn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      label: `${button.label} (copia)`,
      emoji: button.emoji
    };
    setButtons(prev => [...prev, newButton]);
    toast({ title: "📋 Botón duplicado" });
  };

  // Mover botón (arriba/abajo)
  const handleMoveButton = (id: string, direction: 'up' | 'down') => {
    const index = buttons.findIndex(btn => btn.id === id);
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === buttons.length - 1)
    ) return;
    
    const newButtons = [...buttons];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    [newButtons[index], newButtons[newIndex]] = [newButtons[newIndex], newButtons[index]];
    setButtons(newButtons);
  };

  // ========== GUARDAR PLANTILLA ==========
  const handleSaveTemplate = async () => {
    if (!user) {
      toast({ title: "Debes iniciar sesión", variant: "destructive" });
      return;
    }

    if (!templateName.trim()) {
      toast({ title: "Falta nombre", description: "Escribe un nombre para la plantilla", variant: "destructive" });
      return;
    }

    setSaving(true);

    const uploadedImageUrls: string[] = [];
    let videoUrl = null;
    let gifUrl = null;

    for (const image of images) {
      const url = await uploadFile(image.file, 'images');
      if (url) {
        uploadedImageUrls.push(url);
      }
    }

    if (video) {
      videoUrl = await uploadFile(video.file, 'videos');
    }

    if (gif) {
      gifUrl = await uploadFile(gif.file, 'gifs');
    }

    const mainMediaUrl = uploadedImageUrls.length > 0 ? uploadedImageUrls[0] : (videoUrl || gifUrl);
    const mainMediaType = uploadedImageUrls.length > 0 ? 'image' : (video ? 'video' : (gif ? 'gif' : null));

    const variables = {
      media: {
        imageCount: images.length,
        hasVideo: !!video,
        hasGif: !!gif,
        imageUrls: uploadedImageUrls,
        videoUrl: videoUrl,
        gifUrl: gifUrl,
      },
      // 👇 Guardamos los botones (solo texto y emoji)
      buttons: buttons,
    };

    const payload = {
      user_id: user.id,
      name: templateName.trim(),
      category: "whatsapp",
      content: templateMessage,
      variables,
      platform: "whatsapp",
      is_active: true,
      updated_at: new Date().toISOString(),
      media_url: mainMediaUrl,
      media_type: mainMediaType,
      media_file_name: images.length > 0 ? images[0]?.file.name : (video?.file.name || gif?.file.name),
    };

    let error = null;

    if (templateId) {
      const result = await supabase
        .from("templates")
        .update(payload)
        .eq("id", templateId)
        .eq("user_id", user.id);
      error = result.error;
    } else {
      const result = await supabase.from("templates").insert({
        ...payload,
        usage_count: 0,
      });
      error = result.error;
    }

    if (error) {
      console.error("Error guardando plantilla:", error);
      toast({ title: "Error", description: error.message || "No se pudo guardar la plantilla", variant: "destructive" });
      setSaving(false);
      return;
    }

    toast({ title: "✅ Guardado", description: templateId ? "Plantilla actualizada correctamente" : "Plantilla guardada correctamente" });

    await loadTemplates();
    resetEditor();
    setSaving(false);
  };

  const handleDeleteTemplate = async () => {
    if (!user) return;

    if (!templateId) {
      toast({
        title: "Selecciona una plantilla",
        description: "Primero selecciona una plantilla guardada para eliminar",
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase
      .from("templates")
      .delete()
      .eq("id", templateId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error eliminando plantilla:", error);
      toast({
        title: "Error",
        description: "No se pudo eliminar la plantilla",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "🗑️ Eliminada",
      description: "Plantilla eliminada correctamente",
    });

    resetEditor();
    await loadTemplates();
  };

  const resetEditor = () => {
    setTemplateId(null);
    setTemplateName("");
    setTemplateMessage("");
    setImages([]);
    setVideo(null);
    setGif(null);
    setButtons([]);
    setShowPreview(false);
    resetButtonForm();
  };

  const loadTemplates = async () => {
    if (!user) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("templates")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error cargando plantillas:", error);
      toast({
        title: "Error",
        description: "No se pudieron cargar las plantillas",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setTemplates((data || []) as SavedTemplate[]);
    setLoading(false);
  };

  useEffect(() => {
    loadTemplates();
  }, [user]);

  // ========== SELECCIONAR PLANTILLA ==========
  const handleSelectSavedTemplate = (tpl: SavedTemplate) => {
    setTemplateId(tpl.id);
    setTemplateName(tpl.name || "");
    setTemplateMessage(tpl.content || "");
    
    // 👇 Cargar botones SIMPLIFICADOS
    if (tpl.variables?.buttons) {
      setButtons(tpl.variables.buttons as TemplateButton[]);
    } else {
      setButtons([]);
    }
    
    // Cargar imágenes
    const savedImageUrls = tpl.variables?.media?.imageUrls || [];
    if (savedImageUrls.length > 0) {
      const loadedImages: MediaFile[] = savedImageUrls.map((url: string, index: number) => ({
        file: new File([], `imagen_${index}.jpg`),
        preview: url,
        type: "image",
        mediaType: "image/png",
      }));
      setImages(loadedImages);
    } else if (tpl.media_url && tpl.media_type === 'image') {
      setImages([{
        file: new File([], tpl.media_file_name || 'imagen.jpg'),
        preview: tpl.media_url,
        type: "image",
        mediaType: "image/png",
      }]);
    } else {
      setImages([]);
    }
    
    // Cargar video
    const savedVideoUrl = tpl.variables?.media?.videoUrl;
    if (savedVideoUrl) {
      setVideo({
        file: new File([], 'video.mp4'),
        preview: savedVideoUrl,
        type: "video",
        mediaType: "video/mp4",
      });
    } else {
      setVideo(null);
    }
    
    // Cargar GIF
    const savedGifUrl = tpl.variables?.media?.gifUrl;
    if (savedGifUrl) {
      setGif({
        file: new File([], 'gif.gif'),
        preview: savedGifUrl,
        type: "gif",
        mediaType: "image/gif",
      });
    } else {
      setGif(null);
    }
    
    setShowPreview(true);
  };

  const hasContent =
    !!templateName || !!templateMessage || images.length > 0 || !!video || !!gif || buttons.length > 0;

  const previewTime = useMemo(() => {
    return new Date().toLocaleTimeString("es", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Plantillas</h1>
        <button
          onClick={loadTemplates}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-sm border border-border hover:bg-secondary/80 transition-colors"
        >
          Recargar
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Formulario */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:col-span-1 bg-card border border-border rounded-lg p-5 space-y-4 max-h-[800px] overflow-y-auto"
        >
          <div>
            <label className="text-xs text-muted-foreground">Nombre</label>
            <input
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="ej. BIENVENIDA"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Mensaje</label>
            <textarea
              value={templateMessage}
              onChange={(e) => setTemplateMessage(e.target.value)}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[120px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder="Texto de la plantilla…"
            />
          </div>

          {/* ========== SECCIÓN DE BOTONES SIMPLIFICADA ========== */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> Botones de respuesta ({buttons.length}/5)
              </label>
              {buttons.length < 5 && !isAddingButton && (
                <button
                  onClick={() => setIsAddingButton(true)}
                  className="text-[10px] px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Agregar
                </button>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              El cliente verá estos botones como opciones rápidas. La IA interpretará su selección.
            </p>

            {/* Lista de botones existentes */}
            <AnimatePresence>
              {buttons.map((btn, index) => (
                <motion.div
                  key={btn.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="flex items-center gap-2 bg-secondary/30 rounded-lg p-2 border border-border group"
                >
                  <span className="text-lg">{btn.emoji || '💬'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{btn.label}</p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleMoveButton(btn.id, 'up')}
                      disabled={index === 0}
                      className="p-1 hover:bg-secondary rounded disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMoveButton(btn.id, 'down')}
                      disabled={index === buttons.length - 1}
                      className="p-1 hover:bg-secondary rounded disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleEditButton(btn)}
                      className="p-1 hover:bg-secondary rounded text-blue-500"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleDuplicateButton(btn)}
                      className="p-1 hover:bg-secondary rounded text-green-500"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleRemoveButton(btn.id)}
                      className="p-1 hover:bg-secondary rounded text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Formulario para agregar/editar botón - SIMPLIFICADO */}
            <AnimatePresence>
              {(isAddingButton || editingButtonId) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-secondary/30 rounded-lg p-3 space-y-2 overflow-hidden"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Emoji</span>
                    <select
                      value={buttonForm.emoji || '💬'}
                      onChange={(e) => setButtonForm({ ...buttonForm, emoji: e.target.value })}
                      className="flex-1 bg-background border border-border rounded-lg px-2 py-1 text-sm"
                    >
                      {availableEmojis.map((emoji) => (
                        <option key={emoji} value={emoji}>{emoji}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <input
                      value={buttonForm.label}
                      onChange={(e) => setButtonForm({ ...buttonForm, label: e.target.value })}
                      className="w-full bg-background border border-border rounded-lg px-3 py-1 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                      placeholder="Texto del botón (ej. Quiero soporte)"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleAddButton}
                      className="flex-1 px-3 py-1 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
                    >
                      {editingButtonId ? 'Actualizar' : 'Agregar'}
                    </button>
                    <button
                      onClick={resetButtonForm}
                      className="px-3 py-1 rounded-lg bg-secondary text-sm hover:bg-secondary/80 transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="space-y-3">
            <label className="text-xs text-muted-foreground font-medium">
              Archivos multimedia
            </label>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Image className="h-3 w-3" /> Imágenes ({images.length}/3)
                </span>
                {images.length < 3 && (
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="text-[10px] px-2 py-1 rounded bg-secondary border border-border hover:bg-secondary/80 transition-colors flex items-center gap-1"
                  >
                    <Upload className="h-3 w-3" /> Subir
                  </button>
                )}
              </div>

              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={handleImageUpload}
              />

              <AnimatePresence>
                {images.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex gap-2 flex-wrap"
                  >
                    {images.map((img, i) => (
                      <motion.div
                        key={i}
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        className="relative w-16 h-16 rounded-lg overflow-hidden border border-border group"
                      >
                        <img
                          src={img.preview}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                        <button
                          onClick={() => removeImage(i)}
                          className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="h-3 w-3 text-destructive" />
                        </button>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Video className="h-3 w-3" /> Video ({video ? "1" : "0"}/1)
                </span>
                {!video && (
                  <button
                    onClick={() => videoInputRef.current?.click()}
                    className="text-[10px] px-2 py-1 rounded bg-secondary border border-border hover:bg-secondary/80 transition-colors flex items-center gap-1"
                  >
                    <Upload className="h-3 w-3" /> Subir
                  </button>
                )}
              </div>

              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/webm,video/quicktime"
                className="hidden"
                onChange={handleVideoUpload}
              />

              <AnimatePresence>
                {video && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="relative rounded-lg overflow-hidden border border-border w-fit group"
                  >
                    <video src={video.preview} className="h-16 rounded-lg" controls />
                    <button
                      onClick={() => setVideo(null)}
                      className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-destructive" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> GIF ({gif ? "1" : "0"}/1)
                </span>
                {!gif && (
                  <button
                    onClick={() => gifInputRef.current?.click()}
                    className="text-[10px] px-2 py-1 rounded bg-secondary border border-border hover:bg-secondary/80 transition-colors flex items-center gap-1"
                  >
                    <Upload className="h-3 w-3" /> Subir
                  </button>
                )}
              </div>

              <input
                ref={gifInputRef}
                type="file"
                accept="image/gif"
                className="hidden"
                onChange={handleGifUpload}
              />

              <AnimatePresence>
                {gif && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="relative w-16 h-16 rounded-lg overflow-hidden border border-border group"
                  >
                    <img src={gif.preview} alt="" className="w-full h-full object-cover" />
                    <button
                      onClick={() => setGif(null)}
                      className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-destructive" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowPreview(true)}
              disabled={!hasContent}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary text-sm font-medium border border-border hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Eye className="h-4 w-4" /> Vista previa
            </button>

            <button
              onClick={handleSaveTemplate}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> {templateId ? "Actualizar" : "Guardar"}
            </button>

            <button
              onClick={handleDeleteTemplate}
              disabled={!templateId}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-4 w-4" /> Eliminar
            </button>
          </div>
        </motion.div>

        {/* Vista previa con botones */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="lg:col-span-1 bg-card border border-border rounded-lg overflow-hidden flex flex-col"
        >
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            <h3 className="font-heading font-semibold text-sm">Vista Previa</h3>
            {buttons.length > 0 && (
              <span className="ml-auto text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                {buttons.length} botones
              </span>
            )}
          </div>

          <div
            className="flex-1 p-4 flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--secondary)) 0%, hsl(var(--background)) 100%)",
            }}
          >
            <div className="w-full max-w-[320px]">
              <div className="rounded-2xl border-2 border-border bg-background overflow-hidden shadow-lg">
                <div className="bg-[#075e54] px-3 py-2 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    <Phone className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="text-white text-xs font-bold">Skyline Bot</p>
                    <p className="text-white/60 text-[10px]">en línea</p>
                  </div>
                </div>

                <div
                  className="min-h-[300px] p-3 space-y-2"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23808080' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")",
                  }}
                >
                  <AnimatePresence mode="wait">
                    {hasContent ? (
                      <motion.div
                        key="message"
                        initial={{ opacity: 0, scale: 0.95, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="max-w-[85%] ml-auto"
                      >
                        {(images.length > 0 || video || gif) && (
                          <div className="bg-[#dcf8c6] rounded-t-lg rounded-bl-lg overflow-hidden">
                            {images.length > 0 && (
                              <div
                                className={`grid gap-0.5 ${
                                  images.length === 1
                                    ? "grid-cols-1"
                                    : images.length === 2
                                    ? "grid-cols-2"
                                    : "grid-cols-2"
                                }`}
                              >
                                {images.map((img, i) => (
                                  <img
                                    key={i}
                                    src={img.preview}
                                    alt=""
                                    className={`w-full object-cover ${
                                      images.length === 3 && i === 0
                                        ? "col-span-2 max-h-32"
                                        : "max-h-24"
                                    }`}
                                  />
                                ))}
                              </div>
                            )}
                            {video && (
                              <video src={video.preview} className="w-full max-h-36" controls />
                            )}
                            {gif && (
                              <img
                                src={gif.preview}
                                alt=""
                                className="w-full max-h-28 object-cover"
                              />
                            )}
                          </div>
                        )}

                        <div
                          className={`bg-[#dcf8c6] px-3 py-2 ${
                            images.length > 0 || video || gif ? "" : "rounded-t-lg rounded-bl-lg"
                          } ${
                            !(images.length > 0 || video || gif)
                              ? "rounded-t-lg rounded-bl-lg"
                              : "rounded-b-lg rounded-bl-lg"
                          }`}
                        >
                          {templateName && (
                            <p className="text-[10px] font-bold text-[#075e54] mb-1">
                              {templateName}
                            </p>
                          )}
                          <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                            {templateMessage || "..."}
                          </p>
                          
                          {/* ========== BOTONES EN VISTA PREVIA ========== */}
                          {buttons.length > 0 && (
                            <div className="mt-3 flex flex-col gap-1.5">
                              {buttons.map((btn) => (
                                <div
                                  key={btn.id}
                                  className="bg-white rounded-lg px-3 py-1.5 border border-[#25D366] text-[#075e54] text-xs font-medium flex items-center gap-2 hover:bg-[#25D366]/5 transition-colors cursor-pointer"
                                >
                                  <span className="text-base">{btn.emoji || '💬'}</span>
                                  <span>{btn.label}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          
                          <p className="text-[9px] text-gray-500 text-right mt-1">
                            {previewTime} ✓✓
                          </p>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="flex items-center justify-center h-full min-h-[260px]"
                      >
                        <p className="text-xs text-muted-foreground text-center">
                          Escribe un nombre y mensaje
                          <br />
                          para ver la vista previa
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Lista de plantillas */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:col-span-1 bg-card border border-border rounded-lg overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-heading font-semibold text-sm">Lista de Plantillas</h3>
            <span className="text-[10px] text-muted-foreground">{templates.length} plantillas</span>
          </div>

          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8 px-4">
              Cargando plantillas...
            </p>
          ) : templates.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8 px-4">
              Aún no hay plantillas guardadas
            </p>
          ) : (
            <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
              {templates.map((tpl) => {
                const hasButtons = tpl.variables?.buttons && tpl.variables.buttons.length > 0;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => handleSelectSavedTemplate(tpl)}
                    className={`px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer ${
                      templateId === tpl.id ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {tpl.media_type === 'image' && <Image className="h-4 w-4 text-primary shrink-0" />}
                      {tpl.media_type === 'video' && <Video className="h-4 w-4 text-primary shrink-0" />}
                      {(!tpl.media_type) && <FileText className="h-4 w-4 text-primary shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold">{tpl.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {tpl.content || "Sin contenido"}
                        </p>
                      </div>
                    </div>
                    {hasButtons && (
                      <div className="mt-1 flex gap-1 flex-wrap">
                        <span className="text-[9px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                          {tpl.variables.buttons.length} botones de respuesta
                        </span>
                      </div>
                    )}
                    <Eye className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
