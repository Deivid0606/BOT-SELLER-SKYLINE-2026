// api/chat-ia.ts
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

  // 1 UNIDAD / 2 UNIDADES / 3 U
  const q1 = norm.match(/\b(\d+)\s*(unidad|unidades|u)\b/);
  if (q1) quantity = Number(q1[1]);

  // SOLO UN NÚMERO: "1", "2", "3"
  if (!quantity) {
    const onlyNumber = norm.match(/^\d+$/);
    if (onlyNumber) {
      quantity = Number(onlyNumber[0]);
    }
  }

  // TEXTO
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

// ───────── CORRECTOR DE TOTAL Y CANTIDAD ─────────
const PRODUCT_PRICES: Record<string, number> = {
  "Nebulizador Portátil": 169900,
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
  const unitPrice = PRODUCT_PRICES[productName] || 0;
  const correctTotal = unitPrice * quantity;
  return correctTotal.toLocaleString('es-ES');
}

function fixQuantityAndTotal(response: string, expectedQty: number, productName: string): string {
  let fixed = response;
  
  const correctTotal = calculateCorrectTotal(productName, expectedQty);
  const unitPrice = PRODUCT_PRICES[productName] || 0;
  const unitPriceFormatted = unitPrice.toLocaleString('es-ES');
  
  // Patrones para corregir cantidad
  const quantityPatterns = [
    { pattern: /Cantidad:\s*11\b/gi, replacement: "Cantidad: 1" },
    { pattern: /cantidad:\s*11\b/gi, replacement: "cantidad: 1" },
    { pattern: /Cantidad:\s*22\b/gi, replacement: "Cantidad: 2" },
    { pattern: /cantidad:\s*22\b/gi, replacement: "cantidad: 2" },
    { pattern: /Cantidad:\s*33\b/gi, replacement: "Cantidad: 3" },
    { pattern: /cantidad:\s*33\b/gi, replacement: "cantidad: 3" },
    { pattern: /\b11\s*(unidad|unidades)\b/gi, replacement: `1 ${expectedQty === 1 ? 'unidad' : 'unidad'}` },
    { pattern: /\b22\s*(unidad|unidades)\b/gi, replacement: "2 unidades" },
    { pattern: /\b33\s*(unidad|unidades)\b/gi, replacement: "3 unidades" },
  ];
  
  for (const { pattern, replacement } of quantityPatterns) {
    if (pattern.test(fixed)) {
      fixed = fixed.replace(pattern, replacement);
      console.log("🔧 Corregido patrón cantidad:", pattern);
    }
  }
  
  // Patrones para corregir totales incorrectos (para cantidad 1)
  const wrongTotals = [
    /Total:\s*1\.868\.900\s*Gs/gi,
    /Total:\s*1,868,900\s*Gs/gi,
    /Total:\s*1\.699\.000\s*Gs/gi,
    /Total:\s*1,699,000\s*Gs/gi,
    /Total:\s*339\.800\s*Gs/gi,
    /Total:\s*339,800\s*Gs/gi,
    /Total:\s*509\.700\s*Gs/gi,
    /Total:\s*509,700\s*Gs/gi,
    /Total:\s*679\.600\s*Gs/gi,
    /Total:\s*679,600\s*Gs/gi,
  ];
  
  for (const wrongTotal of wrongTotals) {
    if (wrongTotal.test(fixed)) {
      fixed = fixed.replace(wrongTotal, `Total: ${correctTotal} Gs`);
      console.log("🔧 Corregido total incorrecto");
    }
  }
  
  // Si la cantidad es 1, forzar que el total sea el precio unitario
  if (expectedQty === 1) {
    const unitPriceTotalPattern = /Total:\s*[\d\.\,]+\s*Gs/gi;
    const currentTotalMatch = fixed.match(unitPriceTotalPattern);
    if (currentTotalMatch && !currentTotalMatch[0].includes(correctTotal)) {
      fixed = fixed.replace(unitPriceTotalPattern, `Total: ${correctTotal} Gs`);
      console.log("🔧 Corrección forzada de total para cantidad 1");
    }
  }
  
  // Si aún hay "11" en el contexto de cantidad, forzar corrección
  if (fixed.includes("11") && (fixed.includes("Cantidad") || fixed.includes("cantidad"))) {
    fixed = fixed.replace(/\b11\b/g, String(expectedQty));
    console.log("🔧 Corrección forzada: 11 →", expectedQty);
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

// ───────── MEDIA HELPERS ─────────

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

// ───────── GEMINI ─────────

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

// Llama a Gemini con imagen y le pide JSON: kind + transcript
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

// Transcribe audio con Gemini
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

// ───────── HANDLER ─────────

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

    const { data: trainingRow } = await supabase
      .from("training_data")
      .select("id, intent, response, updated_at")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fullTraining = clean(trainingRow?.response);
    if (!fullTraining)
      return res.json({ response: "⚠️ No encontré entrenamiento activo." });

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
          productList: fullTraining,
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

    // ─── FLUJO DE VENTA NORMAL ───
    const oldOrder = context?.order_data || {};
    const product = detectProduct(
      texto,
      fullTraining,
      context?.current_product || oldOrder?.product
    );

    const extracted = extractData(texto);
    const orderData = mergeOrderData(oldOrder, extracted, product);
    
    const wantsToBuy = isBuyIntent(texto);
    const asksPrice = isPriceIntent(texto);
    
    // ─── FUERZA PREGUNTA DE CIUDAD ───
    let step = nextStep(orderData);
    
    if (wantsToBuy && orderData.product && !orderData.city) {
      step = "collecting_city";
      console.log("📍 Forzando pregunta de ciudad (cliente quiere comprar sin ciudad)");
    }
    
    if (orderData.product && !orderData.city && (wantsToBuy || texto.includes("quiero") || texto.includes("compro"))) {
      step = "collecting_city";
      console.log("📍 Forzando pregunta de ciudad (nuevo producto, cliente dijo quiero)");
    }
    
    // Detectar ciudad en frases como "asuncion es"
    const cityDetectionPatterns = [
      { pattern: /asuncion\s+es/i, city: "Asunción" },
      { pattern: /san\s+lorenzo\s+es/i, city: "San Lorenzo" },
      { pattern: /luque\s+es/i, city: "Luque" },
      { pattern: /capiat[áa]\s+es/i, city: "Capiatá" },
    ];
    
    for (const { pattern, city: detectedCity } of cityDetectionPatterns) {
      if (pattern.test(texto) && !orderData.city) {
        orderData.city = detectedCity;
        step = nextStep(orderData);
        console.log(`📍 Ciudad detectada automáticamente: ${detectedCity}`);
        break;
      }
    }
    
    const hasOrderData =
      !!extracted.quantity ||
      !!extracted.city ||
      !!extracted.name ||
      !!extracted.phone ||
      !!extracted.address;

    const shouldCollect =
      !!orderData.product &&
      (wantsToBuy || hasOrderData || context?.step?.startsWith("collecting") || step === "collecting_city");

    const isConfirming = step === "confirm_order" && wantsToBuy;

    if (shouldCollect) {
      await safeUpsertOrder(user_id, fromNumber, orderData, isConfirming);
    }

    console.log("📊 Cantidad extraída y asignada:", orderData.quantity);
    console.log("📍 Paso actual:", step);
    console.log("📍 Ciudad en orderData:", orderData.city);
    console.log("📍 Producto:", orderData.product);

    const system = `
Sos el asistente de ventas de Mega Todo Store. Respondé SIEMPRE siguiendo el entrenamiento al pie de la letra: tono, emojis, plantillas, precios, ciudades con cobertura, formato de cierre. NO inventes precios ni datos.

═══════════════════════════════════
ENTRENAMIENTO OFICIAL (FUENTE DE VERDAD):
═══════════════════════════════════
${fullTraining}
═══════════════════════════════════

ESTADO ACTUAL DEL CLIENTE:
- Producto: ${orderData.product || "ninguno"}
- Cantidad: ${orderData.quantity || 1}
- Ciudad: ${orderData.city || "pendiente"}
- Nombre: ${orderData.customer_name || "pendiente"}
- Teléfono: ${orderData.phone || "pendiente"}
- Dirección: ${orderData.address || "pendiente"}
- Paso: ${step}
- Intención: ${wantsToBuy ? "QUIERE COMPRAR" : asksPrice ? "PREGUNTA PRECIO" : "CONSULTA"}

REGLAS:
1. Usá EXACTAMENTE plantillas, emojis y tono del entrenamiento.
2. Si solo pregunta precio → respondé con el precio + CTA, NO pidas datos todavía.
3. Si quiere comprar o ya pasó datos → pedí SOLO el dato que falta (siguiente: ${step}).
4. Si están todos los datos (paso "confirm_order") → confirmá con plantilla ✅ PEDIDO CONFIRMADO.
5. NO repitas saludo si ya hubo conversación.
6. NO cambies de producto salvo que el cliente lo pida.
7. Cerrá SIEMPRE con siguiente paso o CTA.
8. Catálogo: ${CATALOG_URL}
9. Español paraguayo, natural, con emojis.
10. NUNCA respondas vacío.
11. Si el mensaje viene de una FOTO o AUDIO transcripto, respondé naturalmente como si el cliente te hubiera escrito eso mismo.
12. IMPORTANTE: Cuando el cliente dice "1", la cantidad es UNO (1), no once (11). El total debe ser PRECIO × CANTIDAD.
13. IMPORTANTE: Si el cliente dice "quiero" después de ver un producto y NO ha dicho su ciudad, DEBES preguntar "📍 ¿Para qué ciudad sería el envío?" antes de pedir cualquier otro dato.
14. IMPORTANTE: Usa precios reales del catálogo. Para Nebulizador Portátil: 169.900 Gs por unidad.
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
