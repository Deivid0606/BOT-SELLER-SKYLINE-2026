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
  fullTraining: string;
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

  // Buscar CATALOGO_PRODUCTOS
  const catalogMatch = text.match(/CATALOGO_PRODUCTOS([\s\S]*?)(?:FIN_CATALOGO_PRODUCTOS|$)/i);
  const catalogText = catalogMatch ? catalogMatch[1] : text;

  // Dividir en productos dentro del catálogo
  const productBlocks = catalogText.split(/\n\s*\n/).filter(b => b.trim());

  for (const block of productBlocks) {
    // Buscar producto con formato estructurado
    const productMatch = block.match(/^PRODUCTO:\s*(.+)$/im);
    const canonicalMatch = block.match(/^NOMBRE_CANONICO:\s*(.+)$/im);
    const aliasMatch = block.match(/^ALIAS:\s*(.+)$/im);
    const price1Match = block.match(/^PRECIO_1:\s*(\d+)/im);
    const messageMatch = block.match(/^MENSAJE_VENTA:\s*([\s\S]*?)(?=^[A-Z_]+:|$)/im);

    if (productMatch) {
      const name = clean(productMatch[1]);
      const canonical = clean(canonicalMatch?.[1] || name);
      const price = price1Match ? clean(price1Match[1]) : "";
      const salesCopy = messageMatch ? clean(messageMatch[1]) : block;

      products.push({
        name: canonical || name,
        description: block,
        price: price,
        salesCopy: salesCopy || block,
        rawTraining: block
      });
    }
  }

  // Si no se encontraron productos estructurados, buscar en todo el texto
  if (products.length === 0) {
    // Buscar menciones de productos por palabras clave
    const productKeywords = ['producto', 'oferta', 'promo', 'precio', 'venta'];
    const lines = text.split('\n').filter(l => l.trim());
    
    for (const line of lines) {
      const hasKeyword = productKeywords.some(kw => line.toLowerCase().includes(kw));
      if (hasKeyword && line.length > 20) {
        // Intentar extraer nombre y precio
        const nameMatch = line.match(/^[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑ\s]{3,}/);
        const priceMatch = line.match(/\b(\d{5,})\b/);
        
        products.push({
          name: nameMatch ? clean(nameMatch[0]) : "Producto del vendedor",
          description: line,
          price: priceMatch ? clean(priceMatch[1]) : "",
          salesCopy: line,
          rawTraining: line
        });
      }
    }
  }

  // Extraer ciudades
  const citySection = text.match(/(?:ZONAS CON COBERTURA|CIUDADES)([\s\S]*?)(?:ZONAS SIN COBERTURA|$)/i);
  if (citySection) {
    const cityLines = citySection[1].match(/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s*[A-ZÁÉÍÓÚÑ]?[a-záéíóúñ]*/g);
    if (cityLines) cities.push(...cityLines);
  }

  // Extraer datos bancarios
  const bankMatch = text.match(/DATOS_(?:BANCARIOS|TRANSFERENCIA)([\s\S]*?)(?:FIN_DATOS|$)/i);
  if (bankMatch) bankData = clean(bankMatch[1]);

  // Extraer URL de catálogo
  const urlMatch = text.match(/(?:CATALOGO_URL|URL_CATALOGO)\s*:\s*(https?:\/\/[^\s]+)/i);
  if (urlMatch) catalogUrl = urlMatch[1];

  // Si no hay productos, usar todo el entrenamiento como un solo producto
  if (products.length === 0 && text.trim()) {
    products.push({
      name: "Productos del vendedor",
      description: text,
      salesCopy: text,
      rawTraining: text
    });
  }

  return {
    products,
    bankData: bankData || "Datos bancarios según entrenamiento",
    cities: [...new Set(cities.filter(c => c.length > 2))],
    catalogUrl: catalogUrl || "",
    raw: text,
    fullTraining: text
  };
}

function findRelevantProduct(text: string, training: TrainingData): ProductInfo | null {
  const userMessage = normalize(text);
  if (!userMessage || training.products.length === 0) return null;

  // Si el mensaje menciona un producto específico
  let bestProduct: ProductInfo | null = null;
  let bestScore = 0;

  for (const product of training.products) {
    let score = 0;
    const productText = normalize(product.name + " " + product.description + " " + product.salesCopy);
    
    // Palabras del mensaje
    const words = userMessage.split(/\s+/);
    for (const word of words) {
      if (word.length < 3) continue;
      if (productText.includes(word)) score += 10;
      if (product.name.toLowerCase().includes(word)) score += 20;
      if (word.length > 4 && productText.includes(word)) score += 5;
    }

    // Si el producto está en el mensaje
    if (userMessage.includes(product.name.toLowerCase())) score += 30;

    if (score > bestScore) {
      bestScore = score;
      bestProduct = product;
    }
  }

  // Si hay un producto con alta puntuación o es el único
  if (bestProduct && bestScore > 10) return bestProduct;
  
  // Si solo hay un producto, devolverlo
  if (training.products.length === 1) return training.products[0];
  
  // Si el mensaje es genérico, devolver el primer producto
  const genericKeywords = ['hola', 'buenas', 'producto', 'catálogo', 'catalogo', 'oferta', 'promo'];
  if (genericKeywords.some(kw => userMessage.includes(kw))) {
    return training.products[0];
  }

  return null;
}

function buildSystemPrompt(training: TrainingData, product: ProductInfo | null, userMessage: string): string {
  // Si hay un producto específico, usar su entrenamiento
  const specificTraining = product ? product.salesCopy : "";
  
  // Construir el prompt
  return `
Eres un vendedor experto de WhatsApp para Mega Todo Store / One Store.

TU ENTRENAMIENTO COMPLETO:
${training.fullTraining}

${product ? `
PRODUCTO RELEVANTE PARA ESTA CONSULTA:
${product.salesCopy}
` : ''}

INSTRUCCIONES ESTRICTAS:
1. RESPONDE EXCLUSIVAMENTE BASÁNDOTE EN EL ENTRENAMIENTO DEL VENDEDOR
2. NO INVENTES información que no esté en el entrenamiento
3. SI EL CLIENTE PREGUNTA POR UN PRODUCTO, USA LA INFORMACIÓN DE ESE PRODUCTO DEL ENTRENAMIENTO
4. SÉ NATURAL, CÁLIDO Y PROFESIONAL
5. USA EL ESTILO Y TONO DEL ENTRENAMIENTO
6. SI EL ENTRENAMIENTO TIENE UN COPY DE VENTA, ÚSALO COMO BASE
7. NO REPITAS EL ENTRENAMIENTO TEXTUALMENTE - RESPONDE DE FORMA NATURAL
8. PREGUNTA SIEMPRE LA CIUDAD DESPUÉS DE PRESENTAR UN PRODUCTO

${training.cities.length > 0 ? `CIUDADES CON COBERTURA: ${training.cities.join(", ")}` : ''}
${training.bankData ? `DATOS BANCARIOS: ${training.bankData}` : ''}
${training.catalogUrl ? `CATÁLOGO: ${training.catalogUrl}` : ''}

RESPONDE COMO UN VENDEDOR HUMANO, USANDO EL ENTRENAMIENTO COMO BASE DE CONOCIMIENTO.`;
}

function buildFallbackResponse(training: TrainingData, product: ProductInfo | null): string {
  if (!product && training.products.length === 0) {
    return "¡Hola! 😊 ¿En qué puedo ayudarte hoy? Contame qué producto te interesa.";
  }

  const prod = product || training.products[0];
  if (!prod) return "¡Hola! 😊 ¿Qué producto te interesa hoy?";

  // Usar el copy de venta del producto si existe
  if (prod.salesCopy && prod.salesCopy.length > 20) {
    // Limpiar el copy y hacerlo más conversacional
    let response = prod.salesCopy;
    // Si el copy no tiene saludo, agregarlo
    if (!response.match(/hola|buen|saludos/i)) {
      response = `¡Hola! 😊 ${response}`;
    }
    // Agregar pregunta de ciudad si no la tiene
    if (!response.match(/ciudad|envío|delivery/i)) {
      response += "\n\n📍 ¿Para qué ciudad sería el envío? 😊";
    }
    return response;
  }

  return `¡Hola! 😊 Te cuento sobre ${prod.name}${prod.price ? `, su precio es ${prod.price} Gs` : ''}. ¿Qué te gustaría saber? 📍 ¿Para qué ciudad sería el envío?`;
}

async function callGemini({
  apiKey,
  model,
  system,
  contents,
  temperature,
  maxTokens,
}: any): Promise<string> {
  try {
    const body: any = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: temperature || 0.6,
        maxOutputTokens: maxTokens || 2048,
        topP: 0.95,
        topK: 40,
      },
    };

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Gemini API Error:", JSON.stringify(data, null, 2));
      return "";
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("") || "";

    return clean(text);
  } catch (error) {
    console.error("❌ Gemini call error:", error);
    return "";
  }
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
    
    // Parsear el entrenamiento
    const training = parseTrainingFromText(trainingText);
    
    // Encontrar el producto relevante
    const relevantProduct = findRelevantProduct(texto, training);

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    // Construir el sistema prompt
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
      temperature: iaConfig.temperature ?? 0.65,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 1024),
    });

    // Si no hay respuesta de Gemini o es muy corta, usar fallback
    if (!aiResponse || aiResponse.length < 10) {
      console.log("⚠️ Gemini no respondió, usando fallback");
      aiResponse = buildFallbackResponse(training, relevantProduct);
    }

    // Limpiar la respuesta
    const cleanResponse = clean(aiResponse)
      .replace(/\n{3,}/g, "\n\n")
      .slice(0, 4000);

    // Verificar que no esté devolviendo el entrenamiento crudo
    if (cleanResponse.includes("ENTRENAMIENTO") || cleanResponse.includes("CATALOGO_PRODUCTOS")) {
      console.log("⚠️ Respuesta contiene entrenamiento crudo, usando fallback");
      aiResponse = buildFallbackResponse(training, relevantProduct);
    }

    return res.json({
      response: aiResponse || buildFallbackResponse(training, relevantProduct),
      context: {
        ...(context || {}),
        last_topic: relevantProduct?.name || null,
        used_training: true,
        product_found: !!relevantProduct,
        updated_at: new Date().toISOString(),
      },
      debug: true ? {
        products_found: training.products.length,
        product_used: relevantProduct?.name || "ninguno",
        ai_response_length: aiResponse?.length || 0,
      } : undefined,
    });

  } catch (error: any) {
    console.error("❌ chat-ia-vendedor-v4:", error);
    return res.status(500).json({
      error: error.message || "Error interno",
    });
  }
}
