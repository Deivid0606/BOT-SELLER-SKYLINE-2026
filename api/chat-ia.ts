// api/chat-ia.ts
// ✅ CORREGIDO: SIEMPRE pregunta CIUDAD primero, con correcciones de cantidad y total

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const CATALOG_URL = "https://cat-logomegatodo-com.vercel.app/";
const clean = (t: any): string => String(t || "").trim();

const normalize = (t: string): string =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ═══════════════════════════════════════════════════════════
// OBTENER TODOS LOS ENTRENAMIENTOS DEL USUARIO
// ═══════════════════════════════════════════════════════════

async function getAllTrainingData(userId: string) {
  try {
    const { data, error } = await supabase
      .from("training_data")
      .select("id, intent, examples, response, is_active")
      .eq("user_id", userId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Error obteniendo training_data:", error);
      return [];
    }

    console.log(`📚 Entrenamientos cargados: ${data?.length || 0} para usuario ${userId}`);
    return data || [];
  } catch (err) {
    console.error("❌ getAllTrainingData error:", err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// BUSCAR COINCIDENCIA EN ENTRENAMIENTOS POR FRASE
// ═══════════════════════════════════════════════════════════

function findMatchingTraining(trainingItems: any[], message: string) {
  if (!trainingItems || trainingItems.length === 0) return null;
  
  const msg = normalize(message);
  
  for (const item of trainingItems) {
    if (!item.examples || !Array.isArray(item.examples)) continue;
    
    for (const example of item.examples) {
      const ex = normalize(example);
      if (!ex) continue;
      
      if (msg.includes(ex) || ex.includes(msg) || 
          msg.includes(ex.substring(0, 10)) ||
          ex.includes(msg.substring(0, 10))) {
        console.log(`🎯 Match de entrenamiento: "${item.intent}" → "${example}"`);
        return {
          intent: item.intent,
          response: item.response,
          matched_example: example,
          all_examples: item.examples
        };
      }
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// CONSTRUIR CONTEXTO DE ENTRENAMIENTO PARA GEMINI
// ═══════════════════════════════════════════════════════════

function buildTrainingContext(trainingItems: any[]) {
  if (!trainingItems || trainingItems.length === 0) {
    return "";
  }

  let context = "\n\n## 📚 ENTRENAMIENTO DEL NEGOCIO:\n";
  context += "Estos son los conocimientos específicos que el dueño ha entrenado:\n\n";

  for (const item of trainingItems) {
    const examplesList = item.examples?.map((ex: string) => `  • "${ex}"`).join("\n") || "";
    context += `### ${item.intent}\n`;
    context += `**Respuesta:** ${item.response}\n`;
    context += `**Frases clave:**\n${examplesList}\n\n`;
  }

  context += "⚠️ **IMPORTANTE:** Cuando un cliente use una frase similar a las frases clave, " +
             "DEBES usar la respuesta de entrenamiento correspondiente.\n\n";

  return context;
}

// ═══════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES
// ═══════════════════════════════════════════════════════════

function getPriceLines(training: string): string[] {
  return training
    .split("\n")
    .map((l) => clean(l))
    .filter((l) => l.length > 3);
}

function extractProductNameFromLine(line: string): string {
  const c = line.replace(/^[-•\s]+/, "").replace(/[💙🦶🎯💰🔥✨]/g, "").trim();
  const parts = c.split(/—|-{2,}|–/);
  return clean(parts[0] || c);
}

function detectProduct(text: string, training: string, prev?: string) {
  const msg = normalize(text);
  const lines = getPriceLines(training);
  let best = "";
  let bestScore = 0;
  for (const line of lines) {
    const name = extractProductNameFromLine(line);
    const n = normalize(name);
    if (!n || n.length < 3) continue;
    const words = n.split(" ").filter((w) => w.length >= 4);
    let score = 0;
    if (msg.includes(n)) score += 20;
    for (const w of words) if (msg.includes(w)) score += 4;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  if (bestScore >= 4) return best;
  return clean(prev || "");
}

// ✅ FUNCIÓN NUEVA: Verificar y corregir producto detectado
function ensureCorrectProduct(text: string, training: string, currentProduct: string): string {
  const textLower = text.toLowerCase();
  
  // Detectar nebulizador por contexto
  if (textLower.includes('nebulizador') || textLower.includes('respir') || 
      textLower.includes('tos') || textLower.includes('congest') || 
      textLower.includes('frio') || textLower.includes('resfrio')) {
    // Buscar nebulizador en el entrenamiento
    const lines = getPriceLines(training);
    for (const line of lines) {
      if (line.toLowerCase().includes('nebulizador')) {
        return extractProductNameFromLine(line);
      }
    }
    return 'Nebulizador Portátil';
  }
  
  // Si el producto actual es nebulizador pero se perdió, restaurarlo
  if (currentProduct && currentProduct.toLowerCase().includes('nebulizador')) {
    return currentProduct;
  }
  
  // Detectar otros productos comunes
  const productAliases: Record<string, string> = {
    'destapa': 'Destapa Cañerías Tornado',
    'tornado': 'Destapa Cañerías Tornado',
    'abeja': 'Crema de Veneno de Abeja',
    'veneno': 'Crema de Veneno de Abeja',
    'olla': 'Limpiador de Ollas y Carbonilla',
    'carbonilla': 'Limpiador de Ollas y Carbonilla',
    'peladora': 'Peladora Automática',
    'perfume': 'Perfume Asad',
    'asad': 'Perfume Asad',
    'marmol': 'Tabla de Picar de Mármol',
    'tabla': 'Tabla de Picar de Mármol',
    'raqueta': 'Raqueta para Insectos',
    'insecto': 'Raqueta para Insectos',
    'afilador': 'Afilador de Cuchillos',
    'plantilla': 'Plantillas Ortopiex 5D',
    'ortopiex': 'Plantillas Ortopiex 5D',
    'almohadilla': 'Almohadillas Antivibración',
    'antivibracion': 'Almohadillas Antivibración',
  };
  
  for (const [key, value] of Object.entries(productAliases)) {
    if (textLower.includes(key)) {
      return value;
    }
  }
  
  // Usar detección normal si nada coincide
  const detected = detectProduct(text, training, currentProduct);
  return detected || currentProduct;
}

function isPriceIntent(text: string) {
  const m = normalize(text);
  return (
    m.includes("precio") ||
    m.includes("cuanto") ||
    m.includes("cuesta") ||
    m.includes("valor") ||
    m.includes("costo")
  );
}

function isBuyIntent(text: string) {
  const m = normalize(text);
  return (
    /\b(si|sí|quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|confirmar|ok|dale|listo)\b/.test(
      m
    ) || /\b\d+\s*(unidad|unidades|u)\b/.test(m)
  );
}

function extractData(msg: string) {
  const text = clean(msg);
  const norm = normalize(text);
  const phone = text.match(/(?:09\d{8}|\+595\d{9})/)?.[0] || "";
  
  let quantity = 0;

  const q1 = norm.match(/\b(\d+)\s*(unidad|unidades|u)\b/);
  if (q1) quantity = Number(q1[1]);

  if (!quantity) {
    const onlyNumber = norm.match(/^\d+$/);
    if (onlyNumber) {
      quantity = Number(onlyNumber[0]);
    }
  }

  if (!quantity && /\buno\b|\buna\b/.test(norm)) quantity = 1;
  if (!quantity && /\bdos\b/.test(norm)) quantity = 2;
  if (!quantity && /\btres\b/.test(norm)) quantity = 3;
  if (!quantity && /\bcuatro\b/.test(norm)) quantity = 4;
  if (!quantity && /\bcinco\b/.test(norm)) quantity = 5;

  const cityAliases: Record<string, string> = {
    asuncion: "Asunción",
    capiata: "Capiatá",
    cde: "Ciudad del Este",
    "ciudad del este": "Ciudad del Este",
    luque: "Luque",
    ita: "Itá",
    lambare: "Lambaré",
    "san lorenzo": "San Lorenzo",
    fdm: "Fernando de la Mora",
    "fernando de la mora": "Fernando de la Mora",
    nemby: "Ñemby",
    ypane: "Ypané",
    limpio: "Limpio",
    "villa elisa": "Villa Elisa",
    hernandarias: "Hernandarias",
    "presidente franco": "Presidente Franco",
    "pte franco": "Presidente Franco",
    aregua: "Areguá",
    "areguá": "Areguá",
    vallemi: "Vallemí",
    "valle mi": "Vallemí",
    concepción: "Concepción",
    concepcion: "Concepción",
    "san antonio": "San Antonio",
  };

  let city = "";
  for (const [k, v] of Object.entries(cityAliases)) {
    if (new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)) {
      city = v;
      break;
    }
  }

  const address =
    text.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)?.[1] ||
    "";

  let name = "";
  const nameMatch =
    text.match(/(?:soy|me llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,60})/i)?.[1];
  if (nameMatch) {
    name = clean(nameMatch).replace(/de\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/i, "").trim();
  } else if (
    /^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,60}$/.test(text) &&
    !city &&
    !phone &&
    !norm.includes("precio") &&
    !norm.includes("hola") &&
    !norm.includes("si")
  ) {
    name = text;
  }

  return { quantity, city, name, phone, address: clean(address) };
}

function mergeOrderData(old: any, ext: any, product: string) {
  return {
    product: product || old?.product || "",
    quantity:
      ext.quantity > 0
        ? ext.quantity
        : old?.quantity > 0
        ? old.quantity
        : 1,
    city: ext.city || old?.city || "",
    customer_name: ext.name || old?.customer_name || "",
    phone: ext.phone || old?.phone || "",
    address: ext.address || old?.address || "",
  };
}

const PRODUCT_PRICES: Record<string, number> = {
  "Nebulizador Portátil": 129900,
  "Destapa Cañerías Tornado": 159900,
  "Veneno de Abeja": 145000,
  "Crema de Veneno de Abeja": 145000,
  "Limpiador de Ollas y Carbonilla": 149900,
  "Peladora Automática": 179900,
  "Perfume Asad": 169900,
  "Tabla de Picar de Mármol": 169900,
  "Raqueta para Insectos": 119900,
  "Afilador de Cuchillos": 99000,
  "Plantillas Ortopiex 5D": 159000,
  "Almohadillas Antivibración": 98000,
};

function calculateCorrectTotal(productName: string, quantity: number): string {
  const matchedKey = Object.keys(PRODUCT_PRICES).find(
    key => key.toLowerCase() === productName.toLowerCase() ||
           productName.toLowerCase().includes(key.toLowerCase()) ||
           key.toLowerCase().includes(productName.toLowerCase())
  );
  const unitPrice = matchedKey ? PRODUCT_PRICES[matchedKey] : 0;
  const correctTotal = unitPrice * quantity;
  return correctTotal.toLocaleString('es-ES');
}

function getUnitPrice(productName: string): number {
  const matchedKey = Object.keys(PRODUCT_PRICES).find(
    key => key.toLowerCase() === productName.toLowerCase() ||
           productName.toLowerCase().includes(key.toLowerCase()) ||
           key.toLowerCase().includes(productName.toLowerCase())
  );
  return matchedKey ? PRODUCT_PRICES[matchedKey] : 0;
}

// ✅ FUNCIÓN CORREGIDA: Fix quantity and total
function fixQuantityAndTotal(response: string, expectedQty: number, productName: string): string {
  if (!productName || expectedQty < 1) return response;
  
  let fixed = response;
  
  // 1. CORREGIR CANTIDAD en todas sus formas
  const quantityRegexes = [
    { pattern: /Cantidad:\s*\d+\s*(?:unidad|unidades)?/gi, replacement: `Cantidad: ${expectedQty} ${expectedQty === 1 ? 'unidad' : 'unidades'}` },
    { pattern: /cantidad:\s*\d+\s*(?:unidad|unidades)?/gi, replacement: `cantidad: ${expectedQty} ${expectedQty === 1 ? 'unidad' : 'unidades'}` },
    { pattern: /\b(\d+)\s*(?:unidad|unidades)\b/gi, replacement: `${expectedQty} ${expectedQty === 1 ? 'unidad' : 'unidades'}` },
    { pattern: /unidad(?:es)?:\s*\d+/gi, replacement: `unidades: ${expectedQty}` },
  ];
  
  for (const { pattern, replacement } of quantityRegexes) {
    if (pattern.test(fixed)) {
      fixed = fixed.replace(pattern, replacement);
    }
  }
  
  // Si aún hay números sueltos que parecen cantidades, corregirlos
  if (expectedQty > 0 && expectedQty !== 1) {
    fixed = fixed.replace(/\b1\s*(?:u\.?|unidad)/gi, `${expectedQty} unidades`);
  }
  
  // 2. CALCULAR TOTAL CORRECTO usando PRECIO REAL
  const unitPrice = getUnitPrice(productName);
  if (unitPrice > 0) {
    const correctTotal = unitPrice * expectedQty;
    const formattedTotal = correctTotal.toLocaleString('es-ES');
    
    // Corregir TOTAL en todos los formatos posibles
    const totalPatterns = [
      /Total:\s*[\d\.\,]+\s*Gs/gi,
      /total:\s*[\d\.\,]+\s*Gs/gi,
      /💰\s*Total:\s*[\d\.\,]+\s*Gs/gi,
      /\b[\d\.\,]+\s*Gs\b(?!.*(?:precio|valor))/gi
    ];
    
    let totalFixed = false;
    for (const pattern of totalPatterns) {
      if (pattern.test(fixed)) {
        fixed = fixed.replace(pattern, `💰 Total: ${formattedTotal} Gs`);
        totalFixed = true;
        break;
      }
    }
    
    // Si no encontró ningún total, agregarlo al final
    if (!totalFixed && fixed.includes(productName)) {
      fixed += `\n\n💰 Total: ${formattedTotal} Gs`;
    }
  }
  
  // 3. CORREGIR PRODUCTO si está mal nombrado
  const productKeywords = productName.toLowerCase().split(' ').filter(w => w.length > 3);
  const currentProductMatch = fixed.match(/Producto:\s*([^\n]+)/i);
  if (currentProductMatch) {
    const currentProduct = currentProductMatch[1].toLowerCase();
    const isCorrect = productKeywords.some(kw => currentProduct.includes(kw));
    if (!isCorrect) {
      fixed = fixed.replace(/Producto:\s*[^\n]+/i, `✅ Producto: ${productName}`);
    }
  }
  
  return fixed;
}

// ✅ FUNCIÓN CORREGIDA: Inject correct total
function injectCorrectTotal(response: string, productName: string, quantity: number): string {
  if (!productName || quantity < 1) return response;
  
  const unitPrice = getUnitPrice(productName);
  if (!unitPrice) return response;
  
  const correctTotal = unitPrice * quantity;
  const formattedTotal = correctTotal.toLocaleString('es-ES');
  
  let fixed = response;
  
  // Corregir cualquier mención de precio que esté mal
  const pricePatterns = [
    /(?<!\w)129\.900\s*Gs(?=\s|$)/g,
    /(?<!\w)159\.900\s*Gs(?=\s|$)/g,
    /(?<!\w)149\.900\s*Gs(?=\s|$)/g,
    /por solo\s*[\d\.\,]+\s*Gs/g,
    /\$\s*[\d\.\,]+/g,
  ];
  
  for (const pattern of pricePatterns) {
    if (pattern.test(fixed)) {
      // Reemplazar precios incorrectos
      fixed = fixed.replace(pattern, `${formattedTotal} Gs`);
    }
  }
  
  // Asegurar que el total final sea correcto
  const totalRegex = /(?:💰\s*)?Total:\s*[\d\.\,]+\s*Gs/gi;
  if (totalRegex.test(fixed)) {
    fixed = fixed.replace(totalRegex, `💰 Total: ${formattedTotal} Gs`);
  }
  
  // Si menciona el precio unitario, mostrarlo correctamente
  if (fixed.includes('129.900')) {
    fixed = fixed.replace(/129\.900/g, unitPrice.toLocaleString('es-ES'));
  }
  
  return fixed;
}

function nextStep(o: any) {
  if (!o.product) return "selling";
  if (!o.city) return "collecting_city";
  if (!o.customer_name) return "collecting_name";
  if (!o.phone) return "collecting_phone";
  if (!o.address) return "collecting_address";
  return "confirm_order";
}

async function safeUpsertOrder(
  userId: string,
  from: string,
  order: any,
  confirm = false
) {
  try {
    if (!order?.product) return null;
    if (!from) {
      console.error("❌ safeUpsertOrder: from_number vacío, abortando");
      return null;
    }

    const { data: existing, error: findErr } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", from)
      .in("status", [
        "draft",
        "collecting_name",
        "collecting_city",
        "collecting_phone",
        "collecting_address",
        "confirm_pending",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) {
      console.error("❌ findOrder:", findErr);
      return null;
    }

    const step = nextStep(order);
    const finalStatus =
      confirm && step === "confirm_order"
        ? "confirmed"
        : step === "confirm_order"
        ? "confirm_pending"
        : step;

    const payload: any = {
      user_id: userId,
      from_number: from,
      phone: order.phone || from,
      product: order.product || null,
      producto: order.product || null,
      customer_name: order.customer_name || null,
      city: order.city || null,
      ciudad: order.city || null,
      address: order.address || null,
      quantity: order.quantity || 1,
      total_amount: order.total_amount || null,
      status: finalStatus,
      fecha: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error } = await supabase
        .from("orders")
        .update(payload)
        .eq("id", existing.id);
      if (error) console.error("❌ updateOrder:", error);
      return existing.id;
    }

    const { data, error } = await supabase
      .from("orders")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("❌ insertOrder:", error);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.error("❌ safeUpsertOrder:", e);
    return null;
  }
}

async function fetchMediaAsBase64(
  url: string
): Promise<{ data: string; mime: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error("❌ fetchMedia:", r.status, url.slice(0, 80));
      return null;
    }
    const mime = r.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await r.arrayBuffer());
    return { data: buf.toString("base64"), mime: mime.split(";")[0].trim() };
  } catch (e) {
    console.error("❌ fetchMediaAsBase64:", e);
    return null;
  }
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
  if (String(model).includes("2.5")) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

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

  const c = data?.candidates?.[0];
  const text = clean(
    c?.content?.parts?.map((p: any) => p.text || "").join("") || ""
  );
  console.log("🧠 finishReason:", c?.finishReason, "len:", text.length);
  return text;
}

async function analyzeImageWithGemini({
  apiKey,
  model,
  imageBase64,
  mime,
  caption,
  productList,
}: any): Promise<{
  kind: "payment_proof" | "product" | "other";
  transcript: string;
}> {
  const system = `
Sos un clasificador. Recibís una IMAGEN enviada por un cliente de WhatsApp a una tienda paraguaya (Mega Todo Store).
Devolvé EXCLUSIVAMENTE un JSON válido con esta forma:
{"kind":"payment_proof"|"product"|"other","transcript":"..."}

Reglas para "kind":
- "payment_proof" → si la imagen es captura/foto de transferencia bancaria, billetera (Tigo Money, Personal Pay, Ueno, Zimple), depósito, comprobante de pago, ticket bancario.
- "product" → si la imagen muestra un producto/envase (ej. crema, frasco, suplemento, etc.) o el cliente pregunta sobre él.
- "other" → cualquier otra cosa.

"transcript": describí brevemente en español lo que ves (máx 200 chars). Si es comprobante: monto, banco/billetera, fecha si se ve. Si es producto: qué producto parece y rasgos visibles.

Caption del cliente (puede estar vacío): "${clean(caption) || "(vacío)"}"
Catálogo de productos (referencia): ${productList.slice(0, 800)}

NO devuelvas texto fuera del JSON.
`.trim();

  const contents = [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: mime, data: imageBase64 } },
        { text: caption ? `Caption: ${caption}` : "Analizá la imagen." },
      ],
    },
  ];

  const raw = await callGemini({
    apiKey,
    model,
    system,
    contents,
    temperature: 0.1,
    maxTokens: 512,
  });

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no json");
    const parsed = JSON.parse(match[0]);
    const kind =
      parsed.kind === "payment_proof" ||
      parsed.kind === "product" ||
      parsed.kind === "other"
        ? parsed.kind
        : "other";
    return { kind, transcript: clean(parsed.transcript) };
  } catch {
    console.warn("⚠️ analyzeImage no parseó JSON, raw:", raw.slice(0, 200));
    return { kind: "other", transcript: clean(raw).slice(0, 200) };
  }
}

async function transcribeAudioWithGemini({
  apiKey,
  model,
  audioBase64,
  mime,
}: any): Promise<string> {
  const system =
    "Transcribí el audio al español tal cual lo dijo el hablante. Devolvé SOLO la transcripción en texto plano, sin comillas ni comentarios.";

  const contents = [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: mime, data: audioBase64 } },
        { text: "Transcribí este audio." },
      ],
    },
  ];

  const txt = await callGemini({
    apiKey,
    model,
    system,
    contents,
    temperature: 0.1,
    maxTokens: 1024,
  });
  return clean(txt);
}

// ═══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL - CON SOLUCIÓN DE CIUDAD SIEMPRE PRIMERO
// ═══════════════════════════════════════════════════════════

export default async function handler(req: any, res: any) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const {
      user_id,
      message,
      from_number,
      context,
      history,
      media_url,
      media_type,
      mime_type,
    } = req.body;

    let texto = clean(message);
    const fromNumber = clean(from_number);
    const mediaUrl = clean(media_url);
    const mediaType = clean(media_type);
    const mimeHint = clean(mime_type);

    console.log(
      "🧠 CHAT-IA:",
      texto || "(sin texto)",
      "from:",
      fromNumber,
      mediaType ? `media=${mediaType}` : ""
    );

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber)
      return res.status(400).json({ error: "Falta from_number" });
    if (!texto && !mediaUrl)
      return res.status(400).json({ error: "Faltan message o media" });

    // ─── ✅ NUEVO: SIEMPRE PREGUNTAR CIUDAD PRIMERO ───
    // Verificar si ya tenemos la ciudad en el contexto
    const oldOrder = context?.order_data || {};
    const hasCity = oldOrder?.city || context?.city;
    
    // Si NO hay ciudad registrada, FORZAR pregunta de ciudad
    if (!hasCity) {
      console.log("📍 FORZANDO pregunta de ciudad (siempre primero)");
      
      // Verificar si el mensaje actual CONTIENE una ciudad (para extraerla)
      const extracted = extractData(texto);
      if (extracted.city) {
        // Si el cliente ya dijo la ciudad, actualizamos y seguimos
        const orderData = mergeOrderData(oldOrder, extracted, "");
        const newContext = {
          ...context,
          city: extracted.city,
          order_data: orderData,
          step: "collecting_name",
          updated_at: new Date().toISOString(),
        };
        
        // Guardar en base de datos
        await safeUpsertOrder(user_id, fromNumber, orderData, false);
        
        // Preguntar siguiente dato (nombre)
        return res.json({
          response: `📝 Perfecto! Tu pedido es para ${extracted.city}. Ahora, ¿me podés decir tu NOMBRE completo para el pedido?`,
          context: newContext,
          step: "collecting_name",
        });
      }
      
      // Si NO hay ciudad y el cliente NO dijo ciudad, preguntar
      return res.json({
        response: `📍 ¡Hola! Para comenzar con tu pedido, necesito saber ¿para qué CIUDAD sería el envío? 😊`,
        context: {
          ...context,
          step: "collecting_city",
          awaiting_city: true,
          updated_at: new Date().toISOString(),
        },
      });
    }

    // ─── SI YA HAY CIUDAD, CONTINUAR CON EL FLUJO NORMAL ───
    
    // ─── 1. OBTENER CONFIGURACIÓN IA ───
    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key)
      return res.json({
        response: "⚠️ La IA no está configurada o desactivada.",
      });

    // ─── 2. OBTENER TODOS LOS ENTRENAMIENTOS DEL USUARIO ───
    const allTraining = await getAllTrainingData(user_id);

    // ─── 3. BUSCAR COINCIDENCIA DIRECTA EN ENTRENAMIENTOS ───
    let trainingMatch = null;
    if (texto && allTraining.length > 0) {
      trainingMatch = findMatchingTraining(allTraining, texto);
      if (trainingMatch) {
        console.log(`🎯 Match directo: "${trainingMatch.intent}"`);
        return res.json({
          response: trainingMatch.response,
          context: {
            ...(context || {}),
            last_topic: trainingMatch.intent,
            matched_training: true,
            updated_at: new Date().toISOString(),
          },
          matched_training: true,
          intent: trainingMatch.intent,
        });
      }
    }

    // ─── 4. CONSTRUIR CONTEXTO DE ENTRENAMIENTO PARA GEMINI ───
    const trainingContext = buildTrainingContext(allTraining);
    
    // También usar el texto combinado de todos los entrenamientos para detección de productos
    const combinedTraining = allTraining
      .map(t => `${t.intent}\n${t.response}`)
      .join("\n---\n");

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    let isPaymentProof = false;
    let imageNote = "";

    // ─── IMAGEN ───
    if (mediaUrl && mediaType === "image") {
      const fetched = await fetchMediaAsBase64(mediaUrl);
      if (fetched) {
        const mime = mimeHint || fetched.mime || "image/jpeg";
        const analysis = await analyzeImageWithGemini({
          apiKey,
          model,
          imageBase64: fetched.data,
          mime,
          caption: texto,
          productList: combinedTraining,
        });

        console.log("🖼️ Vision:", analysis.kind, "|", analysis.transcript);

        if (analysis.kind === "payment_proof") {
          isPaymentProof = true;
          const replyPago = `¡Perfecto! 🙏 Recibí tu comprobante (${
            analysis.transcript || "transferencia"
          }). Ya estamos verificando el pago y enseguida te confirmamos el envío 🚚✨`;
          return res.json({
            response: replyPago,
            is_payment_proof: true,
            context: {
              ...(context || {}),
              last_topic: "comprobante",
              updated_at: new Date().toISOString(),
            },
          });
        } else if (analysis.kind === "product") {
          imageNote = `[el cliente envió una FOTO. Descripción: ${analysis.transcript}]`;
          texto = texto
            ? `${texto}\n${imageNote}`
            : `Mandé una foto. ${analysis.transcript}`;
        } else {
          imageNote = `[el cliente envió una imagen: ${analysis.transcript}]`;
          texto = texto || `Te mandé una imagen. ${analysis.transcript}`;
        }
      } else {
        texto = texto || "Te mandé una imagen pero no pudiste descargarla.";
      }
    }

    // ─── AUDIO ───
    if (mediaUrl && mediaType === "audio") {
      const fetched = await fetchMediaAsBase64(mediaUrl);
      if (fetched) {
        const mime = mimeHint || fetched.mime || "audio/ogg";
        const transcript = await transcribeAudioWithGemini({
          apiKey,
          model,
          audioBase64: fetched.data,
          mime,
        });
        console.log("🎙️ Transcripción:", transcript.slice(0, 200));
        texto = transcript || texto || "Te mandé un audio.";
      } else {
        texto = texto || "Te mandé un audio pero no pudiste descargarlo.";
      }
    }

    if (!texto) texto = "(mensaje sin texto)";

    // ─── FLUJO DE VENTA NORMAL (usando entrenamiento combinado) ───
    // ✅ DETECCIÓN DE PRODUCTO CORREGIDA
    let detectedProduct = detectProduct(texto, combinedTraining, context?.current_product || oldOrder?.product);
    // Forzar corrección si el contexto indica nebulizador
    detectedProduct = ensureCorrectProduct(texto, combinedTraining, detectedProduct);
    
    const orderData = mergeOrderData(oldOrder, extractData(texto), detectedProduct);
    
    const wantsToBuy = isBuyIntent(texto);
    const asksPrice = isPriceIntent(texto);
    
    let step = nextStep(orderData);
    
    // Si el cliente quiere comprar y falta ciudad, forzar pregunta de ciudad
    if (wantsToBuy && orderData.product && !orderData.city) {
      step = "collecting_city";
      console.log("📍 Forzando pregunta de ciudad");
    }
    
    if (orderData.product && !orderData.city && (wantsToBuy || texto.includes("quiero") || texto.includes("compro"))) {
      step = "collecting_city";
      console.log("📍 Forzando pregunta de ciudad (cliente dijo quiero)");
    }
    
    const hasOrderData =
      !!extractData(texto).quantity ||
      !!extractData(texto).city ||
      !!extractData(texto).name ||
      !!extractData(texto).phone ||
      !!extractData(texto).address;

    const shouldCollect =
      !!orderData.product &&
      (wantsToBuy || hasOrderData || context?.step?.startsWith("collecting") || step === "collecting_city");

    const isConfirming = step === "confirm_order" && wantsToBuy;

    if (shouldCollect) {
      await safeUpsertOrder(user_id, fromNumber, orderData, isConfirming);
    }

    console.log("📊 Cantidad extraída:", orderData.quantity);
    console.log("📍 Paso actual:", step);
    console.log("📍 Ciudad:", orderData.city);
    console.log("📍 Producto:", orderData.product);

    // ─── CONSTRUIR SYSTEM CON TODOS LOS ENTRENAMIENTOS ───
    const system = `
Sos el asistente de ventas de Mega Todo Store. Respondé SIEMPRE siguiendo el entrenamiento al pie de la letra.

═══════════════════════════════════
ENTRENAMIENTOS DEL NEGOCIO (FUENTE DE VERDAD):
═══════════════════════════════════
${trainingContext || "No hay entrenamiento específico."}
═══════════════════════════════════

REGLAS IMPORTANTES:
1. Usá EXACTAMENTE las respuestas del entrenamiento cuando el cliente pregunte sobre esos temas.
2. NO inventes precios ni datos que no estén en el entrenamiento.
3. Si el cliente pregunta algo que NO está en el entrenamiento, usá tu conocimiento general.
4. Usá tono amable, profesional, con emojis, en español paraguayo.
5. Si es un comprobante de pago, confirmá recepción y que estás procesando el pedido.
6. Usá el catálogo: ${CATALOG_URL}

ESTADO ACTUAL DEL CLIENTE:
- Producto: ${orderData.product || "ninguno"}
- Cantidad: ${orderData.quantity || 1}
- Ciudad: ${orderData.city || "pendiente"}
- Nombre: ${orderData.customer_name || "pendiente"}
- Teléfono: ${orderData.phone || "pendiente"}
- Dirección: ${orderData.address || "pendiente"}
- Paso: ${step}
- Intención: ${wantsToBuy ? "QUIERE COMPRAR" : asksPrice ? "PREGUNTA PRECIO" : "CONSULTA"}

⚠️ MUY IMPORTANTE:
- Si el cliente quiere comprar y falta ciudad → preguntá "📍 ¿Para qué ciudad sería el envío?"
- Si todos los datos están completos → usá la plantilla de confirmación ✅
`.trim();

    const contents = (history || [])
      .slice(-12)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    contents.push({ role: "user", parts: [{ text: texto }] });

    let response = await callGemini({
      apiKey,
      model,
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.3,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
    });

    if (!response) {
      console.warn("⚠️ Vacío, reintentando...");
      response = await callGemini({
        apiKey,
        model,
        system,
        contents,
        temperature: 0.3,
        maxTokens: 3072,
      });
    }

    // ─── CORRECCIÓN FORZADA DE CANTIDAD Y TOTAL ───
    response = fixQuantityAndTotal(response, orderData.quantity, orderData.product);
    response = injectCorrectTotal(response, orderData.product, orderData.quantity);
    console.log("📝 Respuesta después de corrección:", response.substring(0, 300));

    const newContext = {
      ...context,
      current_product: orderData.product || context?.current_product || null,
      step: shouldCollect ? step : "selling",
      order_data: orderData,
      last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
      updated_at: new Date().toISOString(),
    };

    return res.json({
      response:
        response || `📋 Te invito a revisar nuestro catálogo:\n${CATALOG_URL}`,
      context: newContext,
      is_payment_proof: isPaymentProof,
    });
  } catch (error: any) {
    console.error("❌ chat-ia:", error);
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
