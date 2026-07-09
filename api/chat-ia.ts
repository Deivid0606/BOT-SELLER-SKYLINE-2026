import { createClient } from "@supabase/supabase-js";

/**
 * CHAT IA VENDEDOR AUTÓNOMO V4 - Training Only
 * 
 * MODIFICACIONES PRINCIPALES:
 * 1. TODO se guía por el entrenamiento de CADA VENDEDOR
 * 2. Cada vendedor carga su COPY + PRODUCTO como desea
 * 3. La IA responde basándose en el entrenamiento, mejorándolo
 * 4. NO se usan plantillas fijas ni estructuras predefinidas
 * 5. La IA se adapta al formato que el vendedor haya cargado
 * 6. Responde 100% de acuerdo al producto del entrenamiento
 */

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const clean = (v: any) => String(v || "").trim();
const normalize = (v: any) => clean(v).toLowerCase().replace(/\s+/g, " ").trim();

type ProductInfo = {
  name: string;
  description: string;
  price?: string;
  category?: string;
  features?: string[];
  salesCopy: string;
  rawTraining: string;
};

type TrainingData = {
  products: ProductInfo[];
  bankData: string;
  cities: string[];
  catalogUrl: string;
  raw: string;
};

function makeOrderId(fromNumber: string) {
  const safeFrom = clean(fromNumber).replace(/\D/g, "").slice(-8) || "chat";
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${Date.now()}-${safeFrom}-${rand}`;
}

function parseTrainingFromText(text: string): TrainingData {
  const products: ProductInfo[] = [];
  let bankData = "";
  const cities: string[] = [];
  let catalogUrl = "";

  // Dividir en bloques de productos (cada vendedor tiene su formato)
  const blocks = text.split(/\n\s*\n\s*\n/).filter(b => b.trim());

  for (const block of blocks) {
    // Detectar si es un producto (cualquier formato)
    const hasProductIndicators = 
      /\b(producto|product|articulo|artículo|oferta|promo|precio|venta|copy|descripcion|caracteristicas)\b/i.test(block);
    
    if (!hasProductIndicators) {
      // Puede ser datos bancarios o cobertura
      if (/\b(banco|transferencia|cuenta|alias|pago|titular|ci)\b/i.test(block)) {
        bankData += block + "\n";
      }
      if (/\b(ciudad|zona|cobertura|envio|envío|delivery)\b/i.test(block)) {
        const cityMatches = block.match(/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s*[A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]*/g);
        if (cityMatches) cities.push(...cityMatches);
      }
      if (/\b(catalogo|catálogo|https?:\/\/)\b/i.test(block)) {
        const url = block.match(/https?:\/\/[^\s]+/i);
        if (url) catalogUrl = url[0];
      }
      continue;
    }

    // Extraer nombre del producto (cualquier formato que el vendedor use)
    const namePatterns = [
      /producto\s*[:\-]\s*([^\n]+)/i,
      /product\s*[:\-]\s*([^\n]+)/i,
      /^(?:PRODUCTO|PRODUCT|OFERTA|PROMO)\s*[:\-]?\s*([^\n]+)/im,
      /^([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑ\s]{3,})(?:\n|$)/m,
      /📦\s*([^\n]+)/,
      /🔥\s*([^\n]+)/,
      /💰\s*([^\n]+)/
    ];

    let productName = "";
    for (const pattern of namePatterns) {
      const match = block.match(pattern);
      if (match) {
        productName = clean(match[1]);
        break;
      }
    }

    // Si no se encontró nombre, tomar primera línea no vacía
    if (!productName) {
      const lines = block.split("\n").filter(l => clean(l));
      if (lines.length > 0) productName = clean(lines[0]);
    }

    // Precio (puede estar en cualquier formato)
    const pricePatterns = [
      /(?:precio|price|valor|costo)\s*[:\-]?\s*([\d\.,\s]+)\s*(?:gs|guaran[ií]es|\$)/i,
      /([\d\.,\s]+)\s*(?:gs|guaran[ií]es|\$)/i,
      /💲\s*([\d\.,]+)/,
      /💰\s*([\d\.,]+)/
    ];

    let price = "";
    for (const pattern of pricePatterns) {
      const match = block.match(pattern);
      if (match) {
        price = clean(match[1]);
        break;
      }
    }

    // Descripción, características o copy de venta (todo el bloque)
    const salesCopy = block;

    products.push({
      name: productName || "Producto sin nombre",
      description: block,
      price: price || "",
      salesCopy: salesCopy,
      rawTraining: block
    });
  }

  // Si no se encontraron productos estructurados, tomar todo el texto como un solo producto
  if (products.length === 0 && text.trim()) {
    products.push({
      name: "Producto del vendedor",
      description: text,
      salesCopy: text,
      rawTraining: text
    });
  }

  return {
    products,
    bankData: bankData || "Datos bancarios no configurados",
    cities: [...new Set(cities.filter(c => c.length > 2))],
    catalogUrl: catalogUrl,
    raw: text
  };
}

function findRelevantProduct(text: string, training: TrainingData): ProductInfo | null {
  const userMessage = normalize(text);
  if (!userMessage) return training.products[0] || null;

  // Buscar producto más relevante por palabras clave
  let bestProduct: ProductInfo | null = null;
  let bestScore = 0;

  for (const product of training.products) {
    let score = 0;
    const productText = normalize(product.name + " " + product.description + " " + product.salesCopy);
    
    // Palabras del mensaje que coinciden con el producto
    const words = userMessage.split(/\s+/);
    for (const word of words) {
      if (word.length < 3) continue;
      if (productText.includes(word)) score += 10;
      if (product.name.toLowerCase().includes(word)) score += 20;
    }

    // Palabras clave de interés
    const interestKeywords = ["quiero", "comprar", "precio", "cuanto", "info", "información", "producto", "oferta", "promo"];
    for (const kw of interestKeywords) {
      if (userMessage.includes(kw)) score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  // Si no hay coincidencia fuerte, tomar el primer producto
  if (!bestProduct || bestScore < 5) {
    return training.products[0] || null;
  }

  return bestProduct;
}

function getTrainingForPrompt(training: TrainingData, product: ProductInfo | null) {
  if (!product) return training.raw;

  // Usar SOLO el entrenamiento del producto específico si existe
  return product.salesCopy || training.raw;
}

function buildSystemPrompt(training: TrainingData, product: ProductInfo | null, userMessage: string) {
  const trainingText = getTrainingForPrompt(training, product);
  
  return `
Eres un vendedor experto de WhatsApp. Tu único conocimiento es el entrenamiento que el vendedor te ha proporcionado.

ENTRENAMIENTO DEL VENDEDOR:
${trainingText}

INSTRUCCIONES IMPORTANTES:
1. Responde EXCLUSIVAMENTE basándote en el entrenamiento del vendedor
2. Si el vendedor cargó un copy de venta, úsalo como base y mejóralo si es posible
3. NO inventes información que no esté en el entrenamiento
4. NO uses plantillas predefinidas - cada respuesta debe ser natural y personalizada
5. Si el cliente pregunta por un producto, usa el entrenamiento de ESE producto
6. Sé cálido, profesional y persuasivo como el vendedor original
7. Mantén el estilo, tono y formato que el vendedor usa en su entrenamiento
8. Si no encuentras información en el entrenamiento, indícalo honestamente

PRODUCTOS DISPONIBLES (según entrenamiento):
${training.products.map(p => `- ${p.name}`).join("\n")}

DATOS BANCARIOS:
${training.bankData}

CIUDADES CON COBERTURA:
${training.cities.length ? training.cities.join(", ") : "Según entrenamiento"}

${training.catalogUrl ? `CATÁLOGO: ${training.catalogUrl}` : ""}

RESPONDE COMO EL VENDEDOR, USANDO EL FORMATO Y ESTILO DE SU ENTRENAMIENTO.`;
}

function buildFallbackResponse(training: TrainingData) {
  if (training.products.length === 0) {
    return "¡Hola! 😊 ¿En qué puedo ayudarte hoy?";
  }

  const product = training.products[0];
  return `¡Hola! Te cuento sobre nuestros productos:\n\n${product.salesCopy}\n\n¿Qué te interesa? 😊`;
}

async function callGemini({
  apiKey,
  model,
  system,
  contents,
  temperature,
  maxTokens,
}: any) {
  const body: any = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95,
      topK: 40,
    },
  };

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await r.json();

  if (!r.ok) {
    console.error("❌ Gemini:", JSON.stringify(data).slice(0, 800));
    return "";
  }

  return clean(
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("") || ""
  );
}

async function getAllTrainingData(userId: string) {
  const { data, error } = await supabase
    .from("training_data")
    .select("id, intent, examples, response, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("❌ training_data:", error);
    return [];
  }

  return data || [];
}

function buildTrainingText(items: any[]) {
  return items
    .map((i) => {
      const examples = Array.isArray(i.examples) ? i.examples.join("\n") : "";
      return `${i.intent || ""}\n${examples}\n${i.response || ""}`;
    })
    .join("\n\n---\n\n");
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      user_id,
      message,
      from_number,
      context,
      history,
    } = req.body;

    const texto = clean(message);
    const fromNumber = clean(from_number);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto) return res.status(400).json({ error: "Falta message" });

    // Obtener configuración de IA
    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({ response: "⚠️ La IA no está configurada o desactivada." });
    }

    // Obtener entrenamiento del vendedor
    const allTraining = await getAllTrainingData(user_id);
    const trainingText = buildTrainingText(allTraining);
    
    // Parsear el entrenamiento del vendedor (cualquier formato)
    const training = parseTrainingFromText(trainingText);
    
    // Encontrar el producto relevante para el mensaje
    const relevantProduct = findRelevantProduct(texto, training);

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    // Construir el sistema prompt basado en el entrenamiento
    const system = buildSystemPrompt(training, relevantProduct, texto);

    // Construir historial
    const contents = (history || [])
      .slice(-10)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    // Mensaje del usuario
    contents.push({
      role: "user",
      parts: [{ text: texto }],
    });

    // Llamar a Gemini
    let aiResponse = await callGemini({
      apiKey,
      model,
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.6,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
    });

    // Si no hay respuesta, usar fallback
    if (!aiResponse) {
      aiResponse = buildFallbackResponse(training);
    }

    return res.json({
      response: aiResponse,
      context: {
        ...(context || {}),
        last_topic: relevantProduct?.name || null,
        used_training: true,
        training_source: relevantProduct ? "specific_product" : "general",
        updated_at: new Date().toISOString(),
      },
      debug: true ? {
        products_found: training.products.length,
        product_used: relevantProduct?.name || "ninguno",
        training_length: trainingText.length,
      } : undefined,
    });

  } catch (error: any) {
    console.error("❌ chat-ia-vendedor-v4:", error);
    return res.status(500).json({
      error: error.message || "Error interno",
    });
  }
}
