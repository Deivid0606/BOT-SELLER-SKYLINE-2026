import { motion } from "framer-motion";
import { 
  GraduationCap, Plus, Trash2, BookOpen, Loader2, RefreshCw, 
  ImagePlus, X, Copy, Sparkles, Zap, Package as PackageIcon, Key, CreditCard, MapPin, Building2, UserRound, Hash
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface ProductItem {
  id: string;
  image?: string; // compatibilidad con registros viejos
  images?: string[]; // ✅ hasta 3 imágenes propias del producto
  copy: string;
  palabra_clave: string;
  alias: string[];
}

interface PaymentData {
  titular: string;
  cedula: string;
  banco: string;
  numero_cuenta: string;
  alias: string;
}

interface CoverageCity {
  id: string;
  canonical: string;
  aliases: string[];
}

const EMPTY_PAYMENT_DATA: PaymentData = {
  titular: "",
  cedula: "",
  banco: "",
  numero_cuenta: "",
  alias: "",
};

const normalizeLine = (value: string) => value.replace(/\r/g, "").trim();

function stripStructuredSections(training: string): string {
  return training
    .replace(
      /(?:^|\n)\s*DATOS_BANCARIOS\s*:?\s*\n[\s\S]*?(?=\n\s*(?:FIN_DATOS_BANCARIOS|ZONAS CON COBERTURA|ZONAS SIN COBERTURA|⚙️ INSTRUCCIÓN FINAL)|\s*$)/i,
      "\n"
    )
    .replace(/(?:^|\n)\s*FIN_DATOS_BANCARIOS\s*:?\s*/gi, "\n")
    .replace(
      /(?:^|\n)\s*ZONAS CON COBERTURA\s*:?\s*\n[\s\S]*?(?=\n\s*(?:ZONAS SIN COBERTURA|⚙️ INSTRUCCIÓN FINAL)|\s*$)/i,
      "\n"
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildPaymentSection(payment: PaymentData): string {
  const lines = [
    payment.titular && `Titular: ${normalizeLine(payment.titular)}`,
    payment.cedula && `CI: ${normalizeLine(payment.cedula)}`,
    payment.banco && `Banco: ${normalizeLine(payment.banco)}`,
    payment.numero_cuenta && `Número de cuenta: ${normalizeLine(payment.numero_cuenta)}`,
    payment.alias && `Alias: ${normalizeLine(payment.alias)}`,
  ].filter(Boolean);

  if (!lines.length) return "";

  return `DATOS_BANCARIOS
${lines.join("\n")}
FIN_DATOS_BANCARIOS`;
}

function buildCoverageSection(cities: CoverageCity[]): string {
  const cleanCities = cities
    .map((city) => ({
      canonical: normalizeLine(city.canonical),
      aliases: Array.from(
        new Set(city.aliases.map(normalizeLine).filter(Boolean))
      ),
    }))
    .filter((city) => city.canonical);

  if (!cleanCities.length) return "";

  const blocks = cleanCities.map((city) => {
    const aliases = city.aliases.length
      ? `\n✅ ${city.aliases.join(", ")}`
      : "";
    return `📍 ${city.canonical}${aliases}`;
  });

  return `ZONAS CON COBERTURA

${blocks.join("\n\n")}`;
}

function mergeStructuredTraining(
  baseTraining: string,
  payment: PaymentData,
  coverageCities: CoverageCity[]
): string {
  const base = stripStructuredSections(baseTraining);
  const sections = [
    base,
    buildPaymentSection(payment),
    buildCoverageSection(coverageCities),
  ].filter(Boolean);

  return sections.join("\n\n").trim();
}

function parsePaymentData(training: string): PaymentData {
  const block =
    training.match(
      /(?:^|\n)\s*DATOS_BANCARIOS\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:FIN_DATOS_BANCARIOS|ZONAS CON COBERTURA|ZONAS SIN COBERTURA|⚙️ INSTRUCCIÓN FINAL)|\s*$)/i
    )?.[1] || "";

  const pick = (regex: RegExp) => normalizeLine(block.match(regex)?.[1] || "");

  return {
    titular: pick(/^\s*Titular\s*[:\-]\s*(.+)$/im),
    cedula: pick(/^\s*(?:CI|Cédula|Cedula)\s*[:\-]\s*(.+)$/im),
    banco: pick(/^\s*Banco\s*[:\-]\s*(.+)$/im),
    numero_cuenta: pick(
      /^\s*(?:Número de cuenta|Numero de cuenta|Nro\.? de cuenta|Cuenta)\s*[:\-]\s*(.+)$/im
    ),
    alias: pick(/^\s*Alias\s*[:\-]\s*(.+)$/im),
  };
}

function parseCoverageCities(training: string): CoverageCity[] {
  const section =
    training.match(
      /(?:^|\n)\s*ZONAS CON COBERTURA\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:ZONAS SIN COBERTURA|⚙️ INSTRUCCIÓN FINAL)|\s*$)/i
    )?.[1] || "";

  if (!section.trim()) return [];

  return section
    .split(/📍\s*/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block
        .split(/\r?\n/g)
        .map((line) => normalizeLine(line))
        .filter(Boolean);

      const canonical = lines[0] || "";
      const aliasLine = lines.find((line) => /^[✅✔]/.test(line)) || "";
      const aliases = aliasLine
        .replace(/^[✅✔]\s*/, "")
        .split(",")
        .map(normalizeLine)
        .filter(Boolean);

      return {
        id: crypto.randomUUID(),
        canonical,
        aliases,
      };
    })
    .filter((city) => city.canonical);
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
  entrenamiento_completo?: string;
}

const MAX_IMAGES = 3;
const IMAGE_BUCKET = "training-images";

const normalizeProductImages = (product: ProductItem) => {
  const urls = Array.isArray(product.images) ? product.images : [];
  const legacy = product.image ? [product.image] : [];
  return Array.from(new Set([...urls, ...legacy].filter(Boolean))).slice(0, MAX_IMAGES);
};

const normalizeProductItem = (product: ProductItem): ProductItem => {
  const images = normalizeProductImages(product);
  return {
    ...product,
    images,
    image: images[0] || "",
  };
};


function normalizeCoverageKey(value: string): string {
  return normalizeLine(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBulkCoverageInput(input: string): CoverageCity[] {
  const raw = input.replace(/\r/g, "").trim();
  if (!raw) return [];

  const parsed: CoverageCity[] = [];

  const addCity = (canonicalValue: string, aliasValues: string[]) => {
    const canonical = normalizeLine(
      canonicalValue
        .replace(/^[📍✅✔•\-]+\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
    );

    if (!canonical) return;

    const aliases = Array.from(
      new Map(
        [canonical, ...aliasValues]
          .map((value) =>
            normalizeLine(
              value
                .replace(/^[📍✅✔•\-]+\s*/, "")
                .replace(/^alias(?:es)?\s*[:\-]\s*/i, "")
            )
          )
          .filter(Boolean)
          .map((value) => [normalizeCoverageKey(value), value])
      ).values()
    );

    parsed.push({
      id: crypto.randomUUID(),
      canonical,
      aliases,
    });
  };

  // Formato principal:
  // 📍 Ciudad
  // ✅ alias 1, alias 2
  if (/📍/.test(raw)) {
    raw
      .split(/(?=📍\s*)/g)
      .map((block) => block.trim())
      .filter(Boolean)
      .forEach((block) => {
        const lines = block
          .split("\n")
          .map(normalizeLine)
          .filter(Boolean);

        const canonicalLine =
          lines.find((line) => /^📍/.test(line)) || lines[0] || "";

        const canonical = canonicalLine.replace(/^📍\s*/, "");
        const aliasLines = lines
          .filter((line) => /^[✅✔]/.test(line) || /^alias(?:es)?\s*[:\-]/i.test(line))
          .flatMap((line) =>
            line
              .replace(/^[✅✔]\s*/, "")
              .replace(/^alias(?:es)?\s*[:\-]\s*/i, "")
              .split(/[,;|]/g)
              .map(normalizeLine)
              .filter(Boolean)
          );

        addCity(canonical, aliasLines);
      });
  } else {
    // Formatos alternativos:
    // Ciudad del Este | CDE, Cdad del Este
    // Ciudad del Este: CDE, Cdad del Este
    // Ciudad del Este
    raw
      .split("\n")
      .map(normalizeLine)
      .filter(Boolean)
      .forEach((line) => {
        let canonical = line;
        let aliasPart = "";

        if (line.includes("|")) {
          const parts = line.split("|");
          canonical = parts.shift() || "";
          aliasPart = parts.join(",");
        } else {
          const colon = line.match(/^([^:]{2,80})\s*:\s*(.+)$/);
          if (colon) {
            canonical = colon[1];
            aliasPart = colon[2];
          }
        }

        const aliases = aliasPart
          .split(/[,;|]/g)
          .map(normalizeLine)
          .filter(Boolean);

        addCity(canonical, aliases);
      });
  }

  // Unificar ciudades repetidas y combinar alias.
  const merged = new Map<string, CoverageCity>();

  for (const city of parsed) {
    const key = normalizeCoverageKey(city.canonical);
    if (!key) continue;

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, city);
      continue;
    }

    const aliases = Array.from(
      new Map(
        [...existing.aliases, ...city.aliases]
          .map((alias) => [normalizeCoverageKey(alias), alias])
          .filter(([key]) => Boolean(key))
      ).values()
    );

    merged.set(key, { ...existing, aliases });
  }

  return Array.from(merged.values());
}


function mergeCoverageCities(
  current: CoverageCity[],
  incoming: CoverageCity[]
): CoverageCity[] {
  const merged = new Map<string, CoverageCity>();

  for (const city of [...current, ...incoming]) {
    const canonical = normalizeLine(city.canonical);
    const key = normalizeCoverageKey(canonical);
    if (!key) continue;

    const existing = merged.get(key);
    const aliases = Array.from(
      new Map(
        [
          canonical,
          ...(existing?.aliases || []),
          ...(city.aliases || []),
        ]
          .map(normalizeLine)
          .filter(Boolean)
          .map((alias) => [normalizeCoverageKey(alias), alias])
          .filter(([aliasKey]) => Boolean(aliasKey))
      ).values()
    );

    merged.set(key, {
      id: existing?.id || city.id || crypto.randomUUID(),
      canonical: existing?.canonical || canonical,
      aliases,
    });
  }

  return Array.from(merged.values()).sort((a, b) =>
    a.canonical.localeCompare(b.canonical, "es")
  );
}

function coverageCitiesToBulkText(cities: CoverageCity[]): string {
  return cities
    .filter((city) => normalizeLine(city.canonical))
    .map((city) => {
      const aliases = city.aliases
        .filter(
          (alias) =>
            normalizeCoverageKey(alias) !== normalizeCoverageKey(city.canonical)
        )
        .join(", ");

      return `📍 ${city.canonical}${aliases ? `\n✅ ${aliases}` : ""}`;
    })
    .join("\n\n");
}

export default function TrainingPage() {
  const { user } = useAuth();
  const [trainingData, setTrainingData] = useState<TrainingItem[]>([]);
  
  // Estado del formulario
  const [intent, setIntent] = useState("");
  const [examples, setExamples] = useState("");
  const [entrenamientoCompleto, setEntrenamientoCompleto] = useState("");
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [mostrarCatalogo, setMostrarCatalogo] = useState(false);
  const [paymentData, setPaymentData] = useState<PaymentData>(EMPTY_PAYMENT_DATA);
  const [coverageCities, setCoverageCities] = useState<CoverageCity[]>([]);
  const [bulkCoverageText, setBulkCoverageText] = useState("");
  const [mostrarPagos, setMostrarPagos] = useState(true);
  const [mostrarCobertura, setMostrarCobertura] = useState(true);
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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
        prev.map(p => {
          if (p.id !== productId) return p;

          const currentImages = normalizeProductImages(p);
          if (currentImages.length >= MAX_IMAGES) {
            alert(`Cada producto puede tener máximo ${MAX_IMAGES} imágenes`);
            return p;
          }

          const nextImages = Array.from(new Set([...currentImages, publicUrl])).slice(0, MAX_IMAGES);
          return { ...p, images: nextImages, image: nextImages[0] || "" };
        })
      );
    } catch (err: any) {
      console.error("❌ Error inesperado subiendo imagen:", err);
      alert("Error inesperado al subir la imagen: " + err.message);
    } finally {
      setUploadingProductId(null);
    }
  };

  const handlePickImage = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product && normalizeProductImages(product).length >= MAX_IMAGES) {
      alert(`Cada producto puede tener máximo ${MAX_IMAGES} imágenes`);
      return;
    }

    pendingProductIdRef.current = productId;
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadImage(file, pendingProductIdRef.current);
    e.target.value = "";
  };

  const handleRemoveImage = (productId: string, imageUrl: string) => {
    setProducts(prev => 
      prev.map(p => {
        if (p.id !== productId) return p;
        const nextImages = normalizeProductImages(p).filter(img => img !== imageUrl);
        return { ...p, images: nextImages, image: nextImages[0] || "" };
      })
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
        images: [],
        copy: "",
        palabra_clave: "",
        alias: []
      }
    ]);
    setMostrarCatalogo(true);
  };

  const removeProduct = (productId: string) => {
    if (products.length <= 1) {
      setProducts([]);
      setMostrarCatalogo(false);
      return;
    }
    setProducts(prev => prev.filter(p => p.id !== productId));
  };


  const handlePaymentChange = (field: keyof PaymentData, value: string) => {
    setPaymentData((prev) => ({ ...prev, [field]: value }));
  };


  const processBulkCoverage = () => {
    const parsedCities = parseBulkCoverageInput(bulkCoverageText);

    if (!parsedCities.length) {
      alert("No se encontraron ciudades válidas en el texto pegado.");
      return;
    }

    const result = mergeCoverageCities(coverageCities, parsedCities);
    setCoverageCities(result);
    setBulkCoverageText(coverageCitiesToBulkText(result));

    alert(`✅ ${result.length} zonas listas para guardar.`);
  };

  const replaceWithBulkCoverage = () => {
    const parsedCities = parseBulkCoverageInput(bulkCoverageText);

    if (!parsedCities.length) {
      alert("No se encontraron ciudades válidas en el texto pegado.");
      return;
    }

    const result = parsedCities.sort((a, b) =>
      a.canonical.localeCompare(b.canonical, "es")
    );

    setCoverageCities(result);
    setBulkCoverageText(coverageCitiesToBulkText(result));
    alert(`✅ Lista reemplazada con ${result.length} zonas.`);
  };

  const exportCoverageToEditor = () => {
    setBulkCoverageText(coverageCitiesToBulkText(coverageCities));
  };

  const clearCoverageCities = () => {
    if (!confirm("¿Eliminar todas las zonas cargadas?")) return;
    setCoverageCities([]);
    setBulkCoverageText("");
  };

  const addCoverageCity = () => {
    setCoverageCities((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        canonical: "",
        aliases: [],
      },
    ]);
    setMostrarCobertura(true);
  };

  const updateCoverageCity = (
    id: string,
    field: "canonical" | "aliases",
    value: string | string[]
  ) => {
    setCoverageCities((prev) =>
      prev.map((city) =>
        city.id === id ? { ...city, [field]: value } : city
      )
    );
  };

  const removeCoverageCity = (id: string) => {
    setCoverageCities((prev) => prev.filter((city) => city.id !== id));
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

    // V4: al guardar, procesamos automáticamente todo lo pegado en
    // la carga masiva. Ya no es obligatorio presionar antes
    // “Procesar y agregar”.
    const pastedCoverage = bulkCoverageText.trim()
      ? parseBulkCoverageInput(bulkCoverageText)
      : [];

    const finalCoverageCities = bulkCoverageText.trim()
      ? mergeCoverageCities([], pastedCoverage)
      : mergeCoverageCities([], coverageCities);

    if (bulkCoverageText.trim() && !finalCoverageCities.length) {
      alert(
        "No se pudieron interpretar las zonas pegadas. Revisá el formato antes de guardar."
      );
      return;
    }

    setCoverageCities(finalCoverageCities);
    setBulkCoverageText(coverageCitiesToBulkText(finalCoverageCities));

    const finalTraining = mergeStructuredTraining(
      entrenamientoCompleto,
      paymentData,
      finalCoverageCities
    );

    if (!finalTraining.trim()) {
      alert("Por favor completa el Entrenamiento");
      return;
    }

    // Verificación antes de enviar a Supabase: lo que guardamos debe poder
    // leerse nuevamente con la misma cantidad de ciudades.
    const verifiedCoverage = parseCoverageCities(finalTraining);

    if (verifiedCoverage.length !== finalCoverageCities.length) {
      console.error("❌ Verificación de cobertura fallida", {
        esperadas: finalCoverageCities.length,
        recuperadas: verifiedCoverage.length,
        finalTraining,
      });
      alert(
        `No se pudo verificar la lista de cobertura. Esperadas: ${finalCoverageCities.length}; recuperadas: ${verifiedCoverage.length}.`
      );
      return;
    }

    // Validar productos si existen
    if (products.length > 0) {
      const hasEmptyCopy = products.some(p => !p.copy.trim());
      if (hasEmptyCopy) {
        alert("Todos los productos deben tener información (copy)");
        return;
      }
      
      const hasEmptyKeyword = products.some(p => !p.palabra_clave.trim());
      if (hasEmptyKeyword) {
        alert("Todos los productos deben tener una palabra clave");
        return;
      }

      // Verificar que no haya palabras clave duplicadas
      const palabrasClave = products.map(p => p.palabra_clave.toLowerCase().trim());
      const duplicados = palabrasClave.filter((item, index) => palabrasClave.indexOf(item) !== index);
      if (duplicados.length > 0) {
        alert(`Palabras clave duplicadas: ${duplicados.join(', ')}. Cada producto debe tener una palabra clave única.`);
        return;
      }
    }

    const examplesArray = examples
      .split('\n')
      .filter(ex => ex.trim())
      .map(ex => ex.trim());

    const normalizedProducts = products.map(normalizeProductItem);
    const imageUrls = normalizedProducts.flatMap(p => normalizeProductImages(p));

    setSaving(true);

    try {
      const trainingData = {
        user_id: user.id,
        intent: intent.trim(),
        examples: examplesArray,
        response: finalTraining,
        image_urls: imageUrls,
        products: normalizedProducts.length > 0 ? normalizedProducts : [],
        entrenamiento_completo: finalTraining,
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
          alert(`✅ Datos actualizados y verificados. ${verifiedCoverage.length} zonas con cobertura guardadas.`);
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
          alert(`✅ Datos guardados y verificados. ${verifiedCoverage.length} zonas con cobertura guardadas.`);
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
    const storedTraining = item.entrenamiento_completo || item.response || "";
    setEntrenamientoCompleto(stripStructuredSections(storedTraining));
    setPaymentData(parsePaymentData(storedTraining));
    const parsedCoverage = parseCoverageCities(storedTraining);
    setCoverageCities(parsedCoverage);
    setBulkCoverageText(coverageCitiesToBulkText(parsedCoverage));
    setProducts((item.products || []).map(normalizeProductItem));

    if (
      /ZONAS CON COBERTURA/i.test(storedTraining) &&
      parsedCoverage.length === 0
    ) {
      console.error(
        "❌ El registro contiene ZONAS CON COBERTURA, pero no se pudieron interpretar."
      );
      alert(
        "El registro contiene una sección de cobertura, pero no se pudo leer. Volvé a guardar con esta versión."
      );
    }
    setMostrarCatalogo(item.products && item.products.length > 0);
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
    setEntrenamientoCompleto("");
    setProducts([]);
    setMostrarCatalogo(false);
    setPaymentData(EMPTY_PAYMENT_DATA);
    setCoverageCities([]);
    setBulkCoverageText("");
    setMostrarPagos(true);
    setMostrarCobertura(true);
    setEditingId(null);
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
          <div>
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
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
              🧩 Entrenamiento Completo
            </label>
            <textarea
              value={entrenamientoCompleto}
              onChange={(e) => setEntrenamientoCompleto(e.target.value)}
              className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[400px] resize-y font-mono placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
              placeholder={`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 REGLA DE EMERGENCIA — CANTIDAD (LEER PRIMERO)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUANDO EL CLIENTE ESCRIBE UN NÚMERO SOLO:
"1" → cantidad = 1 (NUNCA 11, NUNCA 111)
...`}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Usá este campo para reglas, comportamiento y respuestas generales. Las ciudades y datos bancarios se cargan abajo.
            </p>
          </div>

          {/* Catálogo de Productos - Opcional */}
          <div className="border-t border-border pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <PackageIcon className="h-3 w-3" />
                📦 Catálogo de Productos {products.length > 0 && `(${products.length})`}
                <span className="text-[10px] text-muted-foreground/60 ml-1">(opcional)</span>
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

            {products.length === 0 ? (
              <div 
                className="border border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-secondary/30 transition-colors"
                onClick={addProduct}
              >
                <PackageIcon className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  Haz clic para agregar tu primer producto<br />
                  <span className="text-[10px] text-muted-foreground/60">(opcional)</span>
                </p>
              </div>
            ) : (
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

                    {/* 🔑 PALABRA CLAVE */}
                    <div>
                      <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Key className="h-3 w-3" />
                        Palabra Clave <span className="text-destructive">*</span>
                      </label>
                      <input
                        value={product.palabra_clave}
                        onChange={(e) => handleProductChange(product.id, "palabra_clave", e.target.value)}
                        className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                        placeholder="Ej: procesador, veneno, limpiador"
                      />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Palabra única que activa este producto. El bot enviará SOLO este producto cuando el cliente escriba esta palabra.
                      </p>
                    </div>

                    {/* 🔗 ALIAS */}
                    <div>
                      <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <PackageIcon className="h-3 w-3" />
                        Aliases (separados por coma)
                      </label>
                      <input
                        value={product.alias.join(', ')}
                        onChange={(e) => handleProductChange(product.id, "alias", e.target.value.split(',').map(a => a.trim()).filter(Boolean))}
                        className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                        placeholder="proce, procesadora, raf pro"
                      />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Palabras alternativas que también activarán SOLO este producto
                      </p>
                    </div>

                    {/* Imágenes */}
                    <div>
                      <label className="text-[10px] text-muted-foreground">
                        Imágenes del Producto ({normalizeProductImages(product).length}/{MAX_IMAGES})
                      </label>
                      <div className="mt-1 grid grid-cols-3 gap-2 max-w-[420px]">
                        {normalizeProductImages(product).map((imageUrl, imgIndex) => (
                          <div
                            key={imageUrl}
                            className="aspect-video rounded-lg border border-border bg-secondary/30 overflow-hidden flex items-center justify-center group relative"
                          >
                            <img src={imageUrl} alt={`Producto ${index + 1} imagen ${imgIndex + 1}`} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => handleRemoveImage(product.id, imageUrl)}
                              className="absolute top-1 right-1 p-1 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/20"
                            >
                              <X className="h-3 w-3 text-destructive" />
                            </button>
                          </div>
                        ))}

                        {normalizeProductImages(product).length < MAX_IMAGES && (
                          <div className="aspect-video rounded-lg border border-dashed border-border bg-secondary/30 overflow-hidden flex items-center justify-center group">
                            {uploadingProductId === product.id ? (
                              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Podés subir hasta {MAX_IMAGES} imágenes para este producto. El bot enviará las imágenes del producto correcto.
                      </p>
                    </div>

                    {/* Copy del producto */}
                    <div>
                      <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Copy className="h-3 w-3" />
                        Copy / Mensaje de Venta <span className="text-destructive">*</span>
                      </label>
                      <textarea
                        value={product.copy}
                        onChange={(e) => handleProductChange(product.id, "copy", e.target.value)}
                        className="w-full mt-1 bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm min-h-[80px] resize-y placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                        placeholder={`🔥 ¡Cociná más rápido y sin esfuerzo!
Con el Procesador de Alimentos Premium RAF PRO® preparás tus comidas en segundos...`}
                      />
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Este es el mensaje que el bot enviará cuando se active con la palabra clave
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>


          {/* Datos de pago estructurados */}
          <div className="border-t border-border pt-4">
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMostrarPagos((prev) => !prev)}
                className="flex items-center gap-2 text-xs font-medium text-foreground"
              >
                <CreditCard className="h-4 w-4 text-primary" />
                💳 Datos de pago
              </button>
              <span className="text-[10px] text-muted-foreground">
                Usados solo para envíos con pago anticipado
              </span>
            </div>

            {mostrarPagos && (
              <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-secondary/20 p-3 md:grid-cols-2">
                <div>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <UserRound className="h-3 w-3" />
                    Titular
                  </label>
                  <input
                    value={paymentData.titular}
                    onChange={(e) => handlePaymentChange("titular", e.target.value)}
                    placeholder="Alexis Fabián Jara Amarilla"
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    Cédula
                  </label>
                  <input
                    value={paymentData.cedula}
                    onChange={(e) => handlePaymentChange("cedula", e.target.value)}
                    placeholder="5.496.374"
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Building2 className="h-3 w-3" />
                    Banco
                  </label>
                  <input
                    value={paymentData.banco}
                    onChange={(e) => handlePaymentChange("banco", e.target.value)}
                    placeholder="Banco Familiar"
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <CreditCard className="h-3 w-3" />
                    Número de cuenta
                  </label>
                  <input
                    value={paymentData.numero_cuenta}
                    onChange={(e) => handlePaymentChange("numero_cuenta", e.target.value)}
                    placeholder="123456789"
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Key className="h-3 w-3" />
                    Alias
                  </label>
                  <input
                    value={paymentData.alias}
                    onChange={(e) => handlePaymentChange("alias", e.target.value)}
                    placeholder="5496374"
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm focus:border-primary/50 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Zonas con cobertura — carga masiva */}
          <div className="border-t border-border pt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setMostrarCobertura((prev) => !prev)}
                className="flex items-center gap-2 text-xs font-medium text-foreground"
              >
                <MapPin className="h-4 w-4 text-primary" />
                📍 Zonas con contra-entrega
                {coverageCities.length > 0 && ` (${coverageCities.length})`}
              </button>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={exportCoverageToEditor}
                  className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary/70"
                >
                  Ver lista cargada
                </button>
                <button
                  type="button"
                  onClick={clearCoverageCities}
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[10px] text-destructive transition-colors hover:bg-destructive/20"
                >
                  Limpiar todo
                </button>
              </div>
            </div>

            {mostrarCobertura && (
              <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        Carga masiva de zonas
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        Pegá toda tu lista. Al presionar Guardar o Actualizar también se procesa automáticamente.
                      </p>
                    </div>
                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
                      {bulkCoverageText.trim()
                        ? parseBulkCoverageInput(bulkCoverageText).length
                        : coverageCities.length} detectadas
                    </span>
                  </div>

                  <textarea
                    value={bulkCoverageText}
                    onChange={(e) => setBulkCoverageText(e.target.value)}
                    rows={14}
                    className="w-full resize-y rounded-lg border border-border bg-secondary/50 px-3 py-2 font-mono text-xs leading-relaxed placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                    placeholder={`📍 Asunción
✅ ASU, Asuncion, Capital

📍 Ciudad del Este
✅ CDE, Cdad del Este, Ciudad Este

📍 Fernando de la Mora
✅ FDM, Fdo de la Mora`}
                  />

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={processBulkCoverage}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <Zap className="h-3.5 w-3.5" />
                      Procesar y agregar
                    </button>

                    <button
                      type="button"
                      onClick={replaceWithBulkCoverage}
                      className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-medium transition-colors hover:bg-secondary/80"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Reemplazar lista actual
                    </button>
                  </div>

                  <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
                    <strong className="text-foreground">Formatos aceptados:</strong>
                    <br />
                    <span>📍 Ciudad + ✅ alias separados por coma</span>
                    <br />
                    <span>Ciudad | alias 1, alias 2</span>
                    <br />
                    <span>Ciudad: alias 1, alias 2</span>
                    <br />
                    <span>Una ciudad por línea, aunque no tenga alias</span>
                  </div>
                </div>

                {coverageCities.length > 0 && (
                  <div className="rounded-lg border border-border bg-secondary/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-medium">
                        Vista previa de zonas procesadas
                      </p>
                      <span className="text-[10px] text-muted-foreground">
                        Mostrando {Math.min(coverageCities.length, 12)} de{" "}
                        {coverageCities.length}
                      </span>
                    </div>

                    <div className="grid max-h-[340px] grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                      {coverageCities.slice(0, 12).map((city) => (
                        <div
                          key={city.id}
                          className="rounded-md border border-border/70 bg-background/40 p-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-foreground">
                                📍 {city.canonical}
                              </p>
                              <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                                {city.aliases.length
                                  ? city.aliases.join(", ")
                                  : "Sin alias"}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeCoverageCity(city.id)}
                              className="shrink-0 text-destructive/70 hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {coverageCities.length > 12 && (
                      <p className="mt-2 text-center text-[10px] text-muted-foreground">
                        Hay {coverageCities.length - 12} zonas adicionales guardadas.
                      </p>
                    )}
                  </div>
                )}

                <p className="text-[10px] text-muted-foreground">
                  Solo cargá ciudades con contra-entrega. Toda localidad válida que no aparezca aquí será tratada como envío por transportadora con pago anticipado.
                </p>
              </div>
            )}
          </div>

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
                      {item.products && item.products.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60">
                          {item.products.length} productos
                        </span>
                      )}
                      {item.examples && item.examples.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60">
                          {item.examples.length} ejemplos
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

// Icono MessageSquare personalizado
const MessageSquare = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
