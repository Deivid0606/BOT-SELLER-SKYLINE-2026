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

function limitText(text: string, max = 12000): string {
  return text.length > max ? text.slice(0, max) : text;
}

function parseTraining(fullText: string) {
  const t = fullText || "";

  const get = (start: string, end?: string) => {
    const s = t.indexOf(start);
    if (s === -1) return "";
    const e = end ? t.indexOf(end, s + start.length) : -1;
    return t.substring(s, e !== -1 ? e : t.length).trim();
  };

  return {
    rules: get("🎯 REGLAS DE ORO", "🎯 DETECCIÓN DE CIUDADES"),
    cities: get("🎯 DETECCIÓN DE CIUDADES", "💬 SALUDO INICIAL"),
    greeting: get("💬 SALUDO INICIAL", "🟢 RESPUESTA DIRECTA"),
    coverage: get("🟢 RESPUESTA DIRECTA", "🔴 RESPUESTA DIRECTA"),
    noCoverage: get("🔴 RESPUESTA DIRECTA", "🎯 PLANTILLAS"),
    prices: get("💰 LISTA DE PRECIOS", "📋 PROCESAMIENTO DE PEDIDOS"),
    orders: get("📋 PROCESAMIENTO DE PEDIDOS", "💳 FORMAS DE PAGO"),
    payments: get("💳 FORMAS DE PAGO", "🎧 MANEJO DE AUDIOS"),
    delivery: get("🚚 TIEMPOS DE ENTREGA", "💰 LISTA DE PRECIOS"),
    closing: get("🔁 CIERRE OBLIGATORIO", "📋 EJEMPLOS PRÁCTICOS"),
    finalRules: get("✅ REGLAS FINALES"),
    raw: t,
  };
}

function buildDynamicContext(msg: string, sections: any) {
  const m = normalize(msg);
  let ctx = "";

  ctx += `REGLAS:\n${sections.rules}\n\n`;

  if (m.includes("hola") || m.includes("buenas") || m.length <= 8) {
    ctx += `SALUDO:\n${sections.greeting}\n\n`;
  }

  if (
    m.includes("precio") ||
    m.includes("cuanto") ||
    m.includes("cuesta") ||
    m.includes("valor") ||
    m.includes("costo")
  ) {
    ctx += `PRECIOS:\n${sections.prices}\n\n`;
  }

  if (
    m.includes("de ") ||
    m.includes("soy de") ||
    m.includes("ciudad") ||
    m.includes("capiata") ||
    m.includes("luque") ||
    m.includes("ita") ||
    m.includes("asuncion") ||
    m.includes("cde") ||
    m.includes("central")
  ) {
    ctx += `CIUDADES:\n${sections.cities}\n\n`;
    ctx += `CON COBERTURA:\n${sections.coverage}\n\n`;
    ctx += `SIN COBERTURA:\n${sections.noCoverage}\n\n`;
  }

  ctx += `PEDIDOS:\n${sections.orders}\n\n`;
  ctx += `PAGOS:\n${sections.payments}\n\n`;
  ctx += `ENTREGA:\n${sections.delivery}\n\n`;
  ctx += `CIERRE:\n${sections.closing}\n\n`;
  ctx += `REGLAS FINALES:\n${sections.finalRules}\n\n`;

  const finalCtx = ctx.trim();
  return finalCtx || sections.raw || "";
}

function getPriceLines(training: string): string[] {
  const sections = parseTraining(training);
  const prices = sections.prices || training;
  return prices
    .split("\n")
    .map((line) => clean(line))
    .filter((line) => line.length > 3);
}

function extractProductNameFromLine(line: string): string {
  const cleaned = line
    .replace(/^[-•\s]+/, "")
    .replace(/[💙🦶🎯]/g, "")
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
    if (!n) continue;

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
  if (!quantity && /\buno\b|\buna\b|\b1\b/.test(norm)) quantity = 1;
  if (!quantity && /\bdos\b|\b2\b/.test(norm)) quantity = 2;

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
    name = clean(nameMatch)
      .replace(/de\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/i, "")
      .trim();
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

  return {
    quantity,
    city,
    name,
    phone,
    address: clean(address),
  };
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

function missingQuestion(step: string, product: string) {
  if (step === "collecting_city") {
    return `Perfecto 😊 Para avanzar con tu pedido de ${product}, ¿de qué ciudad sos? 📍`;
  }

  if (step === "collecting_name") {
    return `Excelente 😊 ${product} queda disponible. ¿Me pasás tu nombre completo para agendar? 📝`;
  }

  if (step === "collecting_phone") {
    return `Genial 🙌 Ahora pasame tu número de teléfono para coordinar la entrega 📲`;
  }

  if (step === "collecting_address") {
    return `Perfecto 😊 Solo me falta tu dirección exacta para completar el pedido 🏠`;
  }

  return "";
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
    console.error("❌ safeUpsertOrder falló, sigo respondiendo:", e);
    return null;
  }
}

async function callGemini({ apiKey, model, system, contents, temperature, maxTokens }: any) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("❌ Gemini error:", data);
    return "";
  }

  return clean(
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("\n") || ""
  );
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
      return res.json({
        response: "⚠️ No encontré entrenamiento activo.",
      });
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
      !!extracted.quantity || !!extracted.city || !!extracted.name || !!extracted.phone || !!extracted.address;

    const shouldCollectOrder =
      !!orderData.product && (wantsToBuy || hasOrderData || context?.step?.startsWith("collecting"));

    if (shouldCollectOrder) {
      await safeUpsertOrder(user_id, from_number, orderData);
    }

    const sections = parseTraining(fullTraining);
    const dynamicContext = buildDynamicContext(texto, sections) || fullTraining;

    const system = `
${limitText(dynamicContext, 12000)}

MEMORIA REAL DEL CLIENTE:
Producto actual: ${orderData.product || "ninguno"}
Cantidad: ${orderData.quantity || 1}
Ciudad: ${orderData.city || "pendiente"}
Nombre: ${orderData.customer_name || "pendiente"}
Teléfono: ${orderData.phone || "pendiente"}
Dirección: ${orderData.address || "pendiente"}
Paso actual: ${step}

REGLAS:
- Usá la memoria real del cliente antes que el historial.
- Si el cliente solo consulta precio, respondé precio y no pidas datos todavía.
- Si el cliente dice que quiere comprar o pasa datos, seguí el flujo de pedido.
- Si falta un dato, pedí SOLO ese dato.
- Si están todos los datos, confirmá el pedido.
- No inventes precios: usá la lista del entrenamiento.
- No cambies de producto si ya hay producto actual.
- Cerrá con siguiente paso.
- Catálogo oficial: ${CATALOG_URL}
`.trim();

    let response = "";

    if (shouldCollectOrder && step !== "confirm_order") {
      const q = missingQuestion(step, orderData.product);
      if (q) response = q;
    }

    if (shouldCollectOrder && step === "confirm_order") {
      response = `✅ PEDIDO CONFIRMADO
━━━━━━━━━━━━━━━━━━━━━━
✅ Producto: ${orderData.product}
✅ Cliente: ${orderData.customer_name}
✅ Ubicación: ${orderData.city} — ${orderData.address}
✅ Contacto: ${orderData.phone}
✅ Cantidad: ${orderData.quantity || 1} u.

🚚 Envío GRATIS · Pagás al recibir
⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

📋 Catálogo:
${CATALOG_URL}`;
    }

    if (!response) {
      const contents = (history || [])
        .slice(-10)
        .filter((h: any) => clean(h?.content))
        .map((h: any) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: clean(h.content).slice(0, 500) }],
        }));

      contents.push({
        role: "user",
        parts: [{ text: texto }],
      });

      response = await callGemini({
        apiKey: iaConfig.api_key,
        model: iaConfig.model || "gemini-2.5-flash",
        system,
        contents,
        temperature: iaConfig.temperature ?? 0.25,
        maxTokens: iaConfig.max_tokens ?? 500,
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
