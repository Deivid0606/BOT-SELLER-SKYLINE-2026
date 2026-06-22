// api/chat-ia.ts
// ✅ VERSIÓN CORREGIDA: Flujo estricto, sin confusiones, precios correctos

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
// PRECIOS DE PRODUCTOS (FUENTE DE VERDAD)
// ═══════════════════════════════════════════════════════════

const PRODUCT_PRICES: Record<string, number> = {
  "Nebulizador Portátil": 169900,
  "Destapa Cañerías Tornado": 159900,
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

// ═══════════════════════════════════════════════════════════
// OBTENER ENTRENAMIENTOS
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

    console.log(`📚 Entrenamientos cargados: ${data?.length || 0}`);
    return data || [];
  } catch (err) {
    console.error("❌ getAllTrainingData error:", err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// EXTRACCIÓN DE DATOS (MEJORADA)
// ═══════════════════════════════════════════════════════════

function extractData(msg: string) {
  const text = clean(msg);
  const norm = normalize(text);

  // --- TELÉFONO ---
  const phone = text.match(/(?:09\d{8}|\+595\d{9})/)?.[0] || "";

  // --- CANTIDAD ---
  let quantity = 0;
  const q1 = norm.match(/\b(\d+)\s*(unidad|unidades|u)\b/);
  if (q1) quantity = Number(q1[1]);

  if (!quantity) {
    const onlyNumber = norm.match(/^\d+$/);
    if (onlyNumber) quantity = Number(onlyNumber[0]);
  }

  if (!quantity && /\buno\b|\buna\b/.test(norm)) quantity = 1;
  if (!quantity && /\bdos\b/.test(norm)) quantity = 2;
  if (!quantity && /\btres\b/.test(norm)) quantity = 3;
  if (!quantity && /\bcuatro\b/.test(norm)) quantity = 4;
  if (!quantity && /\bcinco\b/.test(norm)) quantity = 5;

  // --- CIUDAD (SOLO NOMBRES DE CIUDADES REALES) ---
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
    vallemi: "Vallemí",
    concepción: "Concepción",
    concepcion: "Concepción",
  };

  let city = "";
  for (const [k, v] of Object.entries(cityAliases)) {
    if (new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)) {
      city = v;
      break;
    }
  }

  // --- DIRECCIÓN (MEJORADA: detecta barrio, calle, etc.) ---
  let address = "";
  const addressPatterns = [
    /(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i,
    /(?:barrio|calle|avenida|av\.?|km|manzana|mza|casa|edificio)\s+[a-zA-Z0-9\s\.\-]+/i,
  ];

  for (const pattern of addressPatterns) {
    const match = text.match(pattern);
    if (match) {
      address = clean(match[0] || match[1] || "");
      break;
    }
  }

  // Si el texto contiene palabras de dirección, extraer toda la línea
  if (!address) {
    const addrKeywords = ["barrio", "calle", "avenida", "av", "km", "manzana", "mza"];
    if (addrKeywords.some(k => norm.includes(k))) {
      address = text;
    }
  }

  // --- NOMBRE ---
  let name = "";
  const nameMatch = text.match(/(?:soy|me llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,60})/i)?.[1];
  if (nameMatch) {
    name = clean(nameMatch).replace(/de\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/i, "").trim();
  } else if (
    /^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,60}$/.test(text) &&
    !city &&
    !phone &&
    !norm.includes("precio") &&
    !norm.includes("hola") &&
    !norm.includes("si") &&
    !addrKeywords.some(k => norm.includes(k))
  ) {
    name = text;
  }

  return { quantity, city, name, phone, address };
}

// ═══════════════════════════════════════════════════════════
// DETECCIÓN DE PRODUCTO (SOLO SI HAY CIUDAD)
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
  
  // ❌ NO detectar como producto si es dirección
  const addressKeywords = ["barrio", "calle", "avenida", "av", "km", "manzana", "mza", "casa", "edificio"];
  if (addressKeywords.some(k => msg.includes(k))) {
    return clean(prev || "");
  }

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
  
  return bestScore >= 4 ? best : clean(prev || "");
}

// ═══════════════════════════════════════════════════════════
// PRECIOS Y TOTALES (CORREGIDOS)
// ═══════════════════════════════════════════════════════════

function getUnitPrice(productName: string): number {
  const matchedKey = Object.keys(PRODUCT_PRICES).find(
    key => key.toLowerCase() === productName.toLowerCase() ||
           productName.toLowerCase().includes(key.toLowerCase()) ||
           key.toLowerCase().includes(productName.toLowerCase())
  );
  return matchedKey ? PRODUCT_PRICES[matchedKey] : 0;
}

function calculateTotal(productName: string, quantity: number): string {
  const unitPrice = getUnitPrice(productName);
  const total = unitPrice * (quantity || 1);
  return total.toLocaleString('es-ES');
}

// ═══════════════════════════════════════════════════════════
// MERGE DE DATOS DEL PEDIDO
// ═══════════════════════════════════════════════════════════

function mergeOrderData(old: any, ext: any, product: string) {
  return {
    product: product || old?.product || "",
    quantity: ext.quantity > 0 ? ext.quantity : (old?.quantity > 0 ? old.quantity : 1),
    city: ext.city || old?.city || "",
    customer_name: ext.name || old?.customer_name || "",
    phone: ext.phone || old?.phone || "",
    address: ext.address || old?.address || "",
  };
}

function nextStep(o: any) {
  if (!o.product) return "selling";
  if (!o.city) return "collecting_city";
  if (!o.customer_name) return "collecting_name";
  if (!o.phone) return "collecting_phone";
  if (!o.address) return "collecting_address";
  return "confirm_order";
}

// ═══════════════════════════════════════════════════════════
// GUARDAR PEDIDO EN DB
// ═══════════════════════════════════════════════════════════

async function safeUpsertOrder(
  userId: string,
  from: string,
  order: any,
  confirm = false
) {
  try {
    if (!order?.product) return null;
    if (!from) return null;

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

// ═══════════════════════════════════════════════════════════
// GEMINI: IMAGEN, AUDIO, CHAT
// ═══════════════════════════════════════════════════════════

async function fetchMediaAsBase64(url: string) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = r.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await r.arrayBuffer());
    return { data: buf.toString("base64"), mime: mime.split(";")[0].trim() };
  } catch (e) {
    console.error("❌ fetchMediaAsBase64:", e);
    return null;
  }
}

async function callGemini({ apiKey, model, system, contents, temperature, maxTokens }: any) {
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
  const text = clean(c?.content?.parts?.map((p: any) => p.text || "").join("") || "");
  return text;
}

async function analyzeImageWithGemini({ apiKey, model, imageBase64, mime, caption, productList }: any) {
  const system = `
Sos un clasificador. Recibís una IMAGEN enviada por un cliente de WhatsApp.
Devolvé EXCLUSIVAMENTE un JSON:
{"kind":"payment_proof"|"product"|"other","transcript":"..."}

Reglas:
- "payment_proof" → comprobante de transferencia, billetera, depósito
- "product" → foto de producto/envase
- "other" → cualquier otra cosa

Catálogo: ${productList.slice(0, 800)}
`.trim();

  const contents = [{
    role: "user",
    parts: [
      { inlineData: { mimeType: mime, data: imageBase64 } },
      { text: caption ? `Caption: ${caption}` : "Analizá la imagen." }
    ]
  }];

  const raw = await callGemini({ apiKey, model, system, contents, temperature: 0.1, maxTokens: 512 });
  
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no json");
    const parsed = JSON.parse(match[0]);
    return { 
      kind: parsed.kind === "payment_proof" || parsed.kind === "product" ? parsed.kind : "other",
      transcript: clean(parsed.transcript) 
    };
  } catch {
    return { kind: "other", transcript: clean(raw).slice(0, 200) };
  }
}

async function transcribeAudioWithGemini({ apiKey, model, audioBase64, mime }: any): Promise<string> {
  const system = "Transcribí el audio al español. Devolvé SOLO la transcripción.";
  const contents = [{
    role: "user",
    parts: [
      { inlineData: { mimeType: mime, data: audioBase64 } },
      { text: "Transcribí este audio." }
    ]
  }];
  return await callGemini({ apiKey, model, system, contents, temperature: 0.1, maxTokens: 1024 });
}

// ═══════════════════════════════════════════════════════════
// HANDLER PRINCIPAL (100% CORREGIDO)
// ═══════════════════════════════════════════════════════════

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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

    console.log("🧠 CHAT-IA:", texto || "(sin texto)", "from:", fromNumber);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto && !mediaUrl) return res.status(400).json({ error: "Faltan message o media" });

    // ─── 1. CONFIGURACIÓN IA ───
    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({ response: "⚠️ La IA no está configurada o desactivada." });
    }

    // ─── 2. ENTRENAMIENTOS ───
    const allTraining = await getAllTrainingData(user_id);
    const combinedTraining = allTraining
      .map(t => `${t.intent}\n${t.response}`)
      .join("\n---\n");

    // ─── 3. PROCESAR MEDIA ───
    let isPaymentProof = false;

    if (mediaUrl && mediaType === "image") {
      const fetched = await fetchMediaAsBase64(mediaUrl);
      if (fetched) {
        const mime = mimeHint || fetched.mime || "image/jpeg";
        const analysis = await analyzeImageWithGemini({
          apiKey: iaConfig.api_key,
          model: iaConfig.model || "gemini-2.5-flash",
          imageBase64: fetched.data,
          mime,
          caption: texto,
          productList: combinedTraining,
        });

        if (analysis.kind === "payment_proof") {
          isPaymentProof = true;
          return res.json({
            response: `¡Perfecto! 🙏 Recibí tu comprobante. Ya estamos verificando el pago y enseguida te confirmamos el envío 🚚✨`,
            is_payment_proof: true,
            context: { ...(context || {}), updated_at: new Date().toISOString() }
          });
        }
      }
    }

    if (mediaUrl && mediaType === "audio") {
      const fetched = await fetchMediaAsBase64(mediaUrl);
      if (fetched) {
        const mime = mimeHint || fetched.mime || "audio/ogg";
        const transcript = await transcribeAudioWithGemini({
          apiKey: iaConfig.api_key,
          model: iaConfig.model || "gemini-2.5-flash",
          audioBase64: fetched.data,
          mime,
        });
        texto = transcript || texto || "Te mandé un audio.";
      }
    }

    if (!texto) texto = "(mensaje sin texto)";

    // ─── 4. ESTADO ACTUAL DEL PEDIDO ───
    const oldOrder = context?.order_data || {};
    const hasCity = oldOrder?.city || context?.city;
    
    // 📍 REGLA #1: SIEMPRE PREGUNTAR CIUDAD PRIMERO
    if (!hasCity) {
      const extracted = extractData(texto);
      
      if (extracted.city) {
        // ✅ El cliente ya dijo la ciudad
        const orderData = mergeOrderData(oldOrder, extracted, "");
        orderData.city = extracted.city;
        
        await safeUpsertOrder(user_id, fromNumber, orderData, false);
        
        return res.json({
          response: `📝 Perfecto! Tu pedido es para ${extracted.city}. Ahora, ¿me podés decir tu NOMBRE completo para el pedido?`,
          context: {
            ...context,
            city: extracted.city,
            order_data: orderData,
            step: "collecting_name",
            updated_at: new Date().toISOString()
          },
          step: "collecting_name"
        });
      }
      
      // ❌ No dijo ciudad, preguntar
      return res.json({
        response: `📍 ¡Hola! Para comenzar con tu pedido, necesito saber ¿para qué CIUDAD sería el envío? 😊`,
        context: {
          ...context,
          step: "collecting_city",
          awaiting_city: true,
          updated_at: new Date().toISOString()
        }
      });
    }

    // ─── 5. YA TENEMOS CIUDAD → FLUJO NORMAL ───
    const extracted = extractData(texto);
    
    // 🔍 Detectar producto (SOLO si no es dirección)
    const product = detectProduct(texto, combinedTraining, context?.current_product || oldOrder?.product);
    
    // 📝 Merge de datos
    let orderData = mergeOrderData(oldOrder, extracted, product);
    
    // 🔒 Proteger: si el texto parece dirección, NO sobrescribir producto
    const addrKeywords = ["barrio", "calle", "avenida", "av", "km", "manzana", "mza"];
    if (addrKeywords.some(k => normalize(texto).includes(k))) {
      orderData.product = oldOrder?.product || context?.current_product || "";
      // Extraer dirección de forma más agresiva
      if (!orderData.address) {
        orderData.address = texto;
      }
    }

    // 📊 Calcular total correcto
    const unitPrice = getUnitPrice(orderData.product);
    const total = unitPrice * (orderData.quantity || 1);
    orderData.total_amount = total;

    // 🚶 Determinar paso
    let step = nextStep(orderData);
    
    // Si el cliente quiere comprar, forzar flujo
    const wantsToBuy = /\b(si|sí|quiero|llevo|comprar|compro|reservar|agendar|confirmo|ok|dale|listo)\b/.test(normalize(texto));
    
    if (wantsToBuy && orderData.product && !orderData.city) {
      step = "collecting_city";
    }
    
    if (wantsToBuy && orderData.product && !orderData.customer_name) {
      step = "collecting_name";
    }

    console.log("📍 Paso:", step);
    console.log("📦 Producto:", orderData.product);
    console.log("🏙️ Ciudad:", orderData.city);
    console.log("💰 Total:", total);

    // ─── 6. GUARDAR EN DB ───
    const isConfirming = step === "confirm_order" && wantsToBuy;
    await safeUpsertOrder(user_id, fromNumber, orderData, isConfirming);

    // ─── 7. CONSTRUIR SYSTEM PARA GEMINI ───
    const system = `
Sos el asistente de ventas de Mega Todo Store.

═══════════════════════════════════
ENTRENAMIENTOS:
═══════════════════════════════════
${allTraining.map(t => `### ${t.intent}\n${t.response}\nFrases: ${t.examples?.join(", ")}`).join("\n---\n") || "Sin entrenamiento específico."}
═══════════════════════════════════

DATOS DEL CLIENTE:
- Producto: ${orderData.product || "ninguno"}
- Cantidad: ${orderData.quantity || 1}
- Precio unitario: ${unitPrice ? `${unitPrice.toLocaleString('es-ES')} Gs` : "pendiente"}
- Total: ${total ? `${total.toLocaleString('es-ES')} Gs` : "pendiente"}
- Ciudad: ${orderData.city || "pendiente"}
- Nombre: ${orderData.customer_name || "pendiente"}
- Teléfono: ${orderData.phone || "pendiente"}
- Dirección: ${orderData.address || "pendiente"}
- Paso: ${step}

REGLAS:
1. ✅ SIEMPRE seguí el flujo paso a paso: ciudad → nombre → teléfono → dirección → confirmación.
2. ✅ NO muestres los datos del pedido hasta que TODOS estén completos.
3. ✅ Cuando todos los datos estén completos, MOSTRÁ el resumen del pedido UNA SOLA VEZ.
4. ✅ Usá tono amable, profesional, con emojis.
5. ✅ Catálogo: ${CATALOG_URL}
6. ❌ NO inventes precios.
7. ❌ NO confundas "barrio" con producto.

RESPUESTA ESPERADA SEGÚN EL PASO:
- collecting_city: "📍 ¿Para qué ciudad sería el envío?"
- collecting_name: "📝 ¿Me podés decir tu NOMBRE completo?"
- collecting_phone: "📱 ¿Tu número de teléfono?"
- collecting_address: "📍 ¿Dirección completa?"
- confirm_order: Mostrar resumen del pedido con todos los datos y el total.
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
      apiKey: iaConfig.api_key,
      model: iaConfig.model || "gemini-2.5-flash",
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.3,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
    });

    if (!response) {
      response = await callGemini({
        apiKey: iaConfig.api_key,
        model: iaConfig.model || "gemini-2.5-flash",
        system,
        contents,
        temperature: 0.3,
        maxTokens: 3072,
      });
    }

    // ─── 8. CORREGIR TOTAL EN RESPUESTA ───
    if (response && orderData.product) {
      const correctTotal = total.toLocaleString('es-ES');
      const totalPattern = /(?:💰\s*)?Total:\s*[\d\.\,]+\s*Gs/gi;
      if (totalPattern.test(response)) {
        response = response.replace(totalPattern, `💰 Total: ${correctTotal} Gs`);
      }
      
      // Corregir cantidad si está mal
      const qtyPattern = /Cantidad:\s*\d+/gi;
      if (qtyPattern.test(response)) {
        response = response.replace(qtyPattern, `Cantidad: ${orderData.quantity || 1}`);
      }
    }

    const newContext = {
      ...context,
      current_product: orderData.product || context?.current_product || null,
      step: step,
      order_data: orderData,
      has_city: true,
      updated_at: new Date().toISOString(),
    };

    // ─── 9. SI ES CONFIRMACIÓN, MOSTRAR RESUMEN COMPLETO ───
    if (step === "confirm_order" && isConfirming) {
      const resumen = `✅ **PEDIDO CONFIRMADO**

✅ **Producto:** ${orderData.product}
✅ **Cliente:** ${orderData.customer_name}
✅ **Ubicación:** ${orderData.city} — ${orderData.address}
✅ **Contacto:** ${orderData.phone}
✅ **Cantidad:** ${orderData.quantity} u.
💰 **Total:** ${total.toLocaleString('es-ES')} Gs

🚚 Envío GRATIS · Pagás al recibir

¡Gracias por elegir Mega Todo Store! 💜✨

Te dejo nuestro catálogo completo 👇
👉 ${CATALOG_URL}`;
      
      return res.json({
        response: resumen,
        context: newContext,
        order_confirmed: true,
        is_payment_proof: isPaymentProof,
      });
    }

    return res.json({
      response: response || `📋 Te invito a revisar nuestro catálogo:\n${CATALOG_URL}`,
      context: newContext,
      is_payment_proof: isPaymentProof,
      step: step,
    });

  } catch (error: any) {
    console.error("❌ chat-ia:", error);
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
