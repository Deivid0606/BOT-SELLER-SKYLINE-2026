import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Plus, Trash2, Eye, Upload, X, Image, Video, Sparkles, Phone } from "lucide-react";

const mockTemplates: { name: string; preview: string }[] = [];

type MediaFile = {
  file: File;
  preview: string;
  type: "image" | "video" | "gif";
};

export default function TemplatesPage() {
  const [templateName, setTemplateName] = useState("");
  const [templateMessage, setTemplateMessage] = useState("");
  const [images, setImages] = useState<MediaFile[]>([]);
  const [video, setVideo] = useState<MediaFile | null>(null);
  const [gif, setGif] = useState<MediaFile | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 3 - images.length;
    const toAdd = files.slice(0, remaining).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: "image" as const,
    }));
    setImages((prev) => [...prev, ...toAdd]);
    e.target.value = "";
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideo({ file, preview: URL.createObjectURL(file), type: "video" });
    }
    e.target.value = "";
  };

  const handleGifUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setGif({ file, preview: URL.createObjectURL(file), type: "gif" });
    }
    e.target.value = "";
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const hasContent = templateName || templateMessage || images.length > 0 || video || gif;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-heading text-gradient">Plantillas</h1>
        <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-sm border border-border hover:bg-secondary/80 transition-colors">
          Recargar
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editor */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="lg:col-span-1 bg-card border border-border rounded-lg p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground">Nombre</label>
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="ej. BIENVENIDA" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Mensaje</label>
            <textarea value={templateMessage} onChange={(e) => setTemplateMessage(e.target.value)} className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[120px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50" placeholder="Texto de la plantilla…" />
          </div>

          {/* Media uploads */}
          <div className="space-y-3">
            <label className="text-xs text-muted-foreground font-medium">Archivos multimedia</label>

            {/* Images (up to 3) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Image className="h-3 w-3" /> Imágenes ({images.length}/3)</span>
                {images.length < 3 && (
                  <button onClick={() => imageInputRef.current?.click()} className="text-[10px] px-2 py-1 rounded bg-secondary border border-border hover:bg-secondary/80 transition-colors flex items-center gap-1">
                    <Upload className="h-3 w-3" /> Subir
                  </button>
                )}
              </div>
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleImageUpload} />
              <AnimatePresence>
                {images.length > 0 && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2 flex-wrap">
                    {images.map((img, i) => (
                      <motion.div key={i} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border group">
                        <img src={img.preview} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => removeImage(i)} className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <X className="h-3 w-3 text-destructive" />
                        </button>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Video (1) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Video className="h-3 w-3" /> Video ({video ? "1" : "0"}/1)</span>
                {!video && (
                  <button onClick={() => videoInputRef.current?.click()} className="text-[10px] px-2 py-1 rounded bg-secondary border border-border hover:bg-secondary/80 transition-colors flex items-center gap-1">
                    <Upload className="h-3 w-3" /> Subir
                  </button>
                )}
              </div>
              <input ref={videoInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleVideoUpload} />
              <AnimatePresence>
                {video && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative rounded-lg overflow-hidden border border-border w-fit group">
                    <video src={video.preview} className="h-16 rounded-lg" controls />
                    <button onClick={() => setVideo(null)} className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <X className="h-3 w-3 text-destructive" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* GIF (1) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Sparkles className="h-3 w-3" /> GIF ({gif ? "1" : "0"}/1)</span>
                {!gif && (
                  <button onClick={() => gifInputRef.current?.click()} className="text-[10px] px-2 py-1 rounded bg-secondary border border-border hover:bg-secondary/80 transition-colors flex items-center gap-1">
                    <Upload className="h-3 w-3" /> Subir
                  </button>
                )}
              </div>
              <input ref={gifInputRef} type="file" accept="image/gif" className="hidden" onChange={handleGifUpload} />
              <AnimatePresence>
                {gif && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border group">
                    <img src={gif.preview} alt="" className="w-full h-full object-cover" />
                    <button onClick={() => setGif(null)} className="absolute top-0.5 right-0.5 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus className="h-4 w-4" /> Guardar
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-destructive/10 text-destructive text-sm border border-destructive/20 hover:bg-destructive/20 transition-colors">
              <Trash2 className="h-4 w-4" /> Eliminar
            </button>
          </div>
        </motion.div>

        {/* Preview (WhatsApp-style) */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="lg:col-span-1 bg-card border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Eye className="h-4 w-4 text-primary" />
            <h3 className="font-heading font-semibold text-sm">Vista Previa</h3>
          </div>

          {/* WhatsApp mockup */}
          <div className="flex-1 p-4 flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(var(--secondary)) 0%, hsl(var(--background)) 100%)" }}>
            <div className="w-full max-w-[320px]">
              {/* Phone frame */}
              <div className="rounded-2xl border-2 border-border bg-background overflow-hidden shadow-lg">
                {/* WhatsApp header */}
                <div className="bg-[#075e54] px-3 py-2 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    <Phone className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="text-white text-xs font-bold">Skyline Bot</p>
                    <p className="text-white/60 text-[10px]">en línea</p>
                  </div>
                </div>

                {/* Chat area */}
                <div className="min-h-[300px] p-3 space-y-2" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23808080' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }}>
                  <AnimatePresence mode="wait">
                    {hasContent ? (
                      <motion.div
                        key="message"
                        initial={{ opacity: 0, scale: 0.95, y: 8 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="max-w-[85%] ml-auto"
                      >
                        {/* Media preview in bubble */}
                        {(images.length > 0 || video || gif) && (
                          <div className="bg-[#dcf8c6] rounded-t-lg rounded-bl-lg overflow-hidden">
                            {images.length > 0 && (
                              <div className={`grid gap-0.5 ${images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-2"}`}>
                                {images.map((img, i) => (
                                  <img key={i} src={img.preview} alt="" className={`w-full object-cover ${images.length === 3 && i === 0 ? "col-span-2 max-h-32" : "max-h-24"}`} />
                                ))}
                              </div>
                            )}
                            {video && (
                              <video src={video.preview} className="w-full max-h-36" controls />
                            )}
                            {gif && (
                              <img src={gif.preview} alt="" className="w-full max-h-28 object-cover" />
                            )}
                          </div>
                        )}

                        {/* Text bubble */}
                        <div className={`bg-[#dcf8c6] px-3 py-2 ${images.length > 0 || video || gif ? "" : "rounded-t-lg rounded-bl-lg"} ${!(images.length > 0 || video || gif) ? "rounded-t-lg rounded-bl-lg" : "rounded-b-lg rounded-bl-lg"}`}>
                          {templateName && (
                            <p className="text-[10px] font-bold text-[#075e54] mb-1">{templateName}</p>
                          )}
                          <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed">
                            {templateMessage || "..."}
                          </p>
                          <p className="text-[9px] text-gray-500 text-right mt-1">
                            {new Date().toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} ✓✓
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
                          Escribe un nombre y mensaje<br />para ver la vista previa
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* List */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="lg:col-span-1 bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="font-heading font-semibold text-sm">Lista de Plantillas</h3>
          </div>
          {mockTemplates.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8 px-4">Aún no hay plantillas guardadas</p>
          ) : (
            <div className="divide-y divide-border">
              {mockTemplates.map((tpl) => (
                <div key={tpl.name} className="px-4 py-3 hover:bg-secondary/30 transition-colors cursor-pointer flex items-center gap-3">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold">{tpl.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{tpl.preview}</p>
                  </div>
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
