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
    .map((line) => clean(line))
    .filter((line) => line.length > 3);
}

function extractProductNameFromLine(line: string): string {
  const cleaned = line
    .replace(/^[-•\s]+/, "")
    .replace(/[💙🦶🎯💰🔥✨]/g, "")
    .trim();
  const parts = cleaned.split(/—|-{2,}|–/);
  return clean(parts[0] || cleaned);
}

function detectProduct(text: string, training: string, previousProduct?: string) {
  const msg = normalize(text);
  const lines = getPriceLines(training);

  let bestProduct = "";
  let bestScore = 0;

  for (const line of lines) {
    const name = extractProductNameFromLine(line);
    const n = normalize(name);
    if (!n || n.length < 3) continue;

    const words = n.split(" ").filter((w) => w.length >= 4);
    let score = 0;

    if (msg.includes(n)) score += 20;
    for (const w of words) {
      if (msg.includes(w)) score += 4;
    }

    if (score > bestScore) {
      bestScore = score;
      bestProduct = name;
    }
  }

  if (bestScore >= 4) return bestProduct;
  return clean(previousProduct || "");
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
    /\b(si|sí|quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|ok|dale)\b/.test(m) ||
    /\b\d+\s*(unidad|unidades|u)\b/.test(m)
  );
}

function extractData(msg: string) {
  const text = clean(msg);
  const norm = normalize(text);

  const phone = text.match(/(?:09\d{8}|\+595\d{9})/)?.[0] || "";

  let quantity = 0;
  const q1 = norm.match(/\b(\d+)\s*(unidad|unidades|u)\b/);
  if (q1) quantity = Number(q1[1]);
  if (!quantity && /\buno\b|\buna\b/.test(norm)) quantity = 1;
  if (!quantity && /\bdos\b/.test(norm)) quantity = 2;

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
  };

  let city = "";
  for (const [key, value] of Object.entries(cityAliases)) {
    const pattern = new RegExp(`\\b${key.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (pattern.test(norm)) {
      city = value;
      break;
    }
  }

  const address =
    text.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)?.[1] || "";

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

function mergeOrderData(oldData: any, extracted: any, product: string) {
  return {
    product: product || oldData?.product || "",
    quantity: extracted.quantity || oldData?.quantity || 1,
    city: extracted.city || oldData?.city || "",
    customer_name: extracted.name || oldData?.customer_name || "",
    phone: extracted.phone || oldData?.phone || "",
    address: extracted.address || oldData?.address || "",
  };
}

function nextStep(order: any) {
  if (!order.product) return "selling";
  if (!order.city) return "collecting_city";
  if (!order.customer_name) return "collecting_name";
  if (!order.phone) return "collecting_phone";
  if (!order.address) return "collecting_address";
  return "confirm_order";
}

async function safeUpsertOrder(userId: string, from: string, order: any) {
  try {
    if (!order?.product) return null;

    const { data: existing, error: findError } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .or(`from_number.eq.${from},phone.eq.${from}`)
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

    if (findError) {
      console.error("❌ Error buscando order:", findError);
      return null;
    }

    const step = nextStep(order);

    const payload = {
      user_id: userId,
      from_number: from,
      phone: order.phone || from,
      product: order.product || null,
      customer_name: order.customer_name || null,
      city: order.city || null,
      address: order.address || null,
      quantity: order.quantity || 1,
      status: step === "confirm_order" ? "confirm_pending" : step,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error } = await supabase.from("orders").update(payload).eq("id", existing.id);
      if (error) console.error("❌ Error actualizando order:", error);
      return existing.id;
    }

    const { data, error } = await supabase
      .from("orders")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error("❌ Error creando order:", error);
      return null;
    }

    return data?.id || null;
  } catch (e) {
    console.error("❌ safeUpsertOrder falló:", e);
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

  // Para Gemini 2.5: desactivar "thinking" para no gastar tokens pensando
  if (String(model).includes("2.5")) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

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
    console.error("❌ Gemini error:", JSON.stringify(data).slice(0, 1000));
    return "";
  }

  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const text = clean(
    candidate?.content?.parts?.map((p: any) => p.text || "").join("") || ""
  );

  console.log("🧠 Gemini finishReason:", finishReason, "| len:", text.length);

  if (finishReason === "MAX_TOKENS") {
    console.warn("⚠️ Respuesta truncada por MAX_TOKENS");
  }

  return text;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { user_id, message, from_number, context, history } = req.body;
    const texto = clean(message);

    console.log("🧠 CHAT-IA EJECUTADO:", texto);

    if (!user_id || !texto) {
      return res.status(400).json({ error: "Faltan user_id o message" });
    }

    const { data: iaConfig, error: iaError } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (iaError) console.error("❌ IA config error:", iaError);

    if (!iaConfig?.api_key) {
      return res.json({ response: "⚠️ La IA no está configurada o está desactivada." });
    }

    const { data: trainingRow, error: trainingError } = await supabase
      .from("training_data")
      .select("id, intent, response, updated_at")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (trainingError) console.error("❌ Training error:", trainingError);

    const fullTraining = clean(trainingRow?.response);

    if (!fullTraining) {
      return res.json({ response: "⚠️ No encontré entrenamiento activo." });
    }

    const oldOrderData = context?.order_data || {};
    const product = detectProduct(
      texto,
      fullTraining,
      context?.current_product || oldOrderData?.product
    );

    const extracted = extractData(texto);
    const orderData = mergeOrderData(oldOrderData, extracted, product);
    const step = nextStep(orderData);

    const wantsToBuy = isBuyIntent(texto);
    const asksPrice = isPriceIntent(texto);
    const hasOrderData =
      !!extracted.quantity ||
      !!extracted.city ||
      !!extracted.name ||
      !!extracted.phone ||
      !!extracted.address;

    const shouldCollectOrder =
      !!orderData.product &&
      (wantsToBuy || hasOrderData || context?.step?.startsWith("collecting"));

    if (shouldCollectOrder) {
      await safeUpsertOrder(user_id, from_number, orderData);
    }

    // ✅ ENTRENAMIENTO COMPLETO al system prompt (sin filtros por keywords)
    const system = `
Sos el asistente de ventas de Mega Todo Store. Respondé SIEMPRE siguiendo el entrenamiento de abajo al pie de la letra: tono, emojis, plantillas, precios, ciudades con cobertura, formato de cierre. NO inventes precios ni datos. NO cambies el estilo del entrenamiento.

═══════════════════════════════════
ENTRENAMIENTO OFICIAL (FUENTE DE VERDAD):
═══════════════════════════════════
${fullTraining}
═══════════════════════════════════

ESTADO ACTUAL DEL CLIENTE (memoria real):
- Producto en interés: ${orderData.product || "ninguno aún"}
- Cantidad: ${orderData.quantity || 1}
- Ciudad: ${orderData.city || "pendiente"}
- Nombre: ${orderData.customer_name || "pendiente"}
- Teléfono: ${orderData.phone || "pendiente"}
- Dirección: ${orderData.address || "pendiente"}
- Paso del flujo: ${step}
- Intención detectada: ${wantsToBuy ? "QUIERE COMPRAR" : asksPrice ? "PREGUNTA PRECIO" : "CONSULTA"}

REGLAS DE EJECUCIÓN:
1. Usá EXACTAMENTE las plantillas, emojis y tono del entrenamiento.
2. Si el cliente solo pregunta precio → respondé con el precio del entrenamiento + cierre con CTA, NO pidas datos todavía.
3. Si el cliente quiere comprar o ya pasó datos → seguí el flujo de pedido pidiendo SOLO el dato que falta (siguiente paso: ${step}).
4. Si están todos los datos (paso "confirm_order") → confirmá el pedido con la plantilla del entrenamiento.
5. NO repitas el saludo si ya hubo conversación previa.
6. NO cambies de producto si ya hay uno en interés, salvo que el cliente lo pida claramente.
7. Cerrá SIEMPRE con el siguiente paso o CTA según el entrenamiento.
8. Catálogo oficial (usalo cuando corresponda): ${CATALOG_URL}
9. Respondé en español paraguayo, natural, con emojis del entrenamiento.
10. NUNCA respondas vacío. Si no sabés algo, ofrecé el catálogo.
`.trim();

    const contents = (history || [])
      .slice(-12)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    contents.push({
      role: "user",
      parts: [{ text: texto }],
    });

    let response = await callGemini({
      apiKey: iaConfig.api_key,
      model: iaConfig.model || "gemini-2.5-flash",
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.3,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
    });

    // Reintento con más tokens si vino vacío
    if (!response) {
      console.warn("⚠️ Respuesta vacía, reintentando con más tokens...");
      response = await callGemini({
        apiKey: iaConfig.api_key,
        model: iaConfig.model || "gemini-2.5-flash",
        system,
        contents,
        temperature: 0.3,
        maxTokens: 3072,
      });
    }

    const newContext = {
      ...context,
      current_product: orderData.product || context?.current_product || null,
      step: shouldCollectOrder ? step : "selling",
      order_data: orderData,
      last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
      updated_at: new Date().toISOString(),
    };

    return res.json({
      response: response || `📋 Te invito a revisar nuestro catálogo oficial:\n${CATALOG_URL}`,
      context: newContext,
    });
  } catch (error: any) {
    console.error("❌ chat-ia error:", error);
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
