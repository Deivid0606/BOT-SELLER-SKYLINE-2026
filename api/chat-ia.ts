import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// ================= HELPERS =================
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
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

// ================= PARSER DE ENTRENAMIENTO =================
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
    plantillas: get("🎯 PLANTILLAS", "🚚 TIEMPOS DE ENTREGA"),
    delivery: get("🚚 TIEMPOS DE ENTREGA", "💰 LISTA DE PRECIOS"),
    prices: get("💰 LISTA DE PRECIOS", "📋 PROCESAMIENTO DE PEDIDOS"),
    orders: get("📋 PROCESAMIENTO DE PEDIDOS", "💳 FORMAS DE PAGO"),
    payments: get("💳 FORMAS DE PAGO", "🎧 MANEJO DE AUDIOS"),
    audio: get("🎧 MANEJO DE AUDIOS", "💬 FAQ"),
    faq: get("💬 FAQ", "🔁 CIERRE OBLIGATORIO"),
    closing: get("🔁 CIERRE OBLIGATORIO", "📋 EJEMPLOS PRÁCTICOS"),
    examples: get("📋 EJEMPLOS PRÁCTICOS", "✅ REGLAS FINALES"),
    finalRules: get("✅ REGLAS FINALES"),
    raw: t,
  };
}

function hasParsedContent(sections: any): boolean {
  return Boolean(
    sections.rules ||
    sections.cities ||
    sections.prices ||
    sections.orders ||
    sections.finalRules
  );
}

// ================= CONTEXTO DINÁMICO =================
function buildContextSections(msg: string, sections: any): string {
  const m = normalize(msg);
  let ctx = "";

  ctx += `🧠 REGLAS PRINCIPALES:\n${sections.rules}\n\n`;

  if (
    m.includes("hola") ||
    m.includes("buenas") ||
    m.includes("buen dia") ||
    m.length <= 8
  ) {
    ctx += `💬 SALUDO:\n${sections.greeting}\n\n`;
  }

  if (
    m.includes("precio") ||
    m.includes("cuanto") ||
    m.includes("cuesta") ||
    m.includes("valor") ||
    m.includes("costo") ||
    m.includes("gs")
  ) {
    ctx += `💰 LISTA DE PRECIOS:\n${sections.prices}\n\n`;
  }

  if (
    m.includes("de ") ||
    m.includes("soy de") ||
    m.includes("ciudad") ||
    m.includes("capiata") ||
    m.includes("luque") ||
    m.includes("cde") ||
    m.includes("asuncion") ||
    m.includes("san lorenzo") ||
    m.includes("lambare") ||
    m.includes("central")
  ) {
    ctx += `📍 CIUDADES Y COBERTURA:\n${sections.cities}\n\n`;
    ctx += `🟢 CON COBERTURA:\n${sections.coverage}\n\n`;
    ctx += `🔴 SIN COBERTURA:\n${sections.noCoverage}\n\n`;
  }

  if (
    m.includes("plantilla") ||
    m.includes("ortopiex") ||
    m.includes("calce")
  ) {
    ctx += `🎯 PLANTILLAS ORTOPIEX:\n${sections.plantillas}\n\n`;
  }

  if (
    m.includes("pedido") ||
    m.includes("direccion") ||
    m.includes("dirección") ||
    m.includes("nombre") ||
    m.includes("telefono") ||
    m.includes("teléfono")
  ) {
    ctx += `📋 PEDIDOS:\n${sections.orders}\n\n`;
  }

  if (
    m.includes("pago") ||
    m.includes("transferencia") ||
    m.includes("qr") ||
    m.includes("tarjeta") ||
    m.includes("cuota")
  ) {
    ctx += `💳 FORMAS DE PAGO:\n${sections.payments}\n\n`;
  }

  if (
    m.includes("entrega") ||
    m.includes("delivery") ||
    m.includes("cuando llega") ||
    m.includes("envio") ||
    m.includes("envío")
  ) {
    ctx += `🚚 ENTREGA:\n${sections.delivery}\n\n`;
  }

  ctx += `💬 FAQ:\n${sections.faq}\n\n`;
  ctx += `🔁 CIERRE OBLIGATORIO:\n${sections.closing}\n\n`;
  ctx += `✅ REGLAS FINALES:\n${sections.finalRules}\n\n`;

  return ctx;
}

// ================= PEDIDOS =================
async function getOpenOrder(userId: string, phone: string) {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .or(`from_number.eq.${phone},phone.eq.${phone}`)
      .in("status", [
        "draft",
        "collecting_name",
        "collecting_city",
        "collecting_address",
        "waiting_exact_address",
        "confirm_pending",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("❌ Error getOpenOrder:", error);
      return null;
    }

    return data || null;
  } catch (e) {
    console.error("❌ getOpenOrder catch:", e);
    return null;
  }
}

function extractData(msg: string) {
  const text = clean(msg);

  const name =
    text.match(/(?:soy|me llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,60})/i)?.[1];

  const city =
    text.match(/(?:soy de|de|ciudad)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,40})/i)?.[1];

  const phone =
    text.match(/(?:09\d{8}|\+595\d{9})/)?.[0];

  const address =
    text.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)?.[1];

  return {
    name: clean(name),
    city: clean(city),
    phone: clean(phone),
    address: clean(address),
  };
}

function isComplete(order: any) {
  return Boolean(
    clean(order?.product) &&
    clean(order?.customer_name) &&
    clean(order?.city) &&
    clean(order?.address)
  );
}

// ================= GEMINI =================
async function callGemini({
  apiKey,
  model,
  system,
  contents,
  temperature,
  maxTokens,
}: any) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: system }],
        },
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
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

// ================= MAIN =================
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { user_id, message, from_number, context, history } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: "Faltan user_id o message" });
    }

    const texto = clean(message);

    console.log("🧠 CHAT-IA RECIBIÓ:", texto);

    // ================= CONFIG IA =================
    const { data: iaConfig, error: configError } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (configError) {
      console.error("❌ Error config IA:", configError);
    }

    if (!iaConfig?.api_key) {
      return res.json({
        response: "⚠️ La IA no está configurada o está desactivada.",
      });
    }

    // ================= ENTRENAMIENTO PRINCIPAL =================
    const { data: trainingRow, error: trainingError } = await supabase
      .from("training_data")
      .select("id, intent, response, is_active")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (trainingError) {
      console.error("❌ Error training:", trainingError);
    }

    const fullTraining = clean(trainingRow?.response);

    if (!fullTraining) {
      return res.json({
        response:
          "⚠️ No encontré entrenamiento activo. Cargá el entrenamiento para que pueda responder correctamente.",
      });
    }

    const sections = parseTraining(fullTraining);

    let dynamicContext = "";

    if (hasParsedContent(sections)) {
      dynamicContext = buildContextSections(texto, sections);
      console.log("✅ Usando entrenamiento por secciones");
    } else {
      dynamicContext = fullTraining;
      console.log("⚠️ Parser no detectó secciones, usando entrenamiento completo");
    }

    // ================= PEDIDO ABIERTO =================
    const openOrder = from_number ? await getOpenOrder(user_id, from_number) : null;
    const extracted = extractData(texto);

    if (openOrder && (extracted.name || extracted.city || extracted.address || extracted.phone)) {
      await supabase
        .from("orders")
        .update({
          ...(extracted.name && { customer_name: extracted.name }),
          ...(extracted.city && { city: extracted.city }),
          ...(extracted.address && { address: extracted.address }),
          ...(extracted.phone && { phone: extracted.phone }),
          updated_at: new Date().toISOString(),
        })
        .eq("id", openOrder.id);
    }

    // ================= SYSTEM FINAL =================
    const system = `
${limitText(dynamicContext, 12000)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO ACTUAL DEL CLIENTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Número del cliente: ${from_number || "sin número"}
Último tema: ${context?.last_topic || "ninguno"}
Último disparador: ${context?.last_trigger || "ninguno"}
Pedido abierto: ${openOrder ? JSON.stringify(openOrder) : "ninguno"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS ABSOLUTAS DE RESPUESTA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Tu nombre es Araceli Galeano si el entrenamiento lo indica.
2. Respondé SOLO usando el entrenamiento activo.
3. No inventes productos, precios, descuentos, disponibilidad ni formas de pago.
4. Si hay precio en el entrenamiento, usalo exactamente.
5. Si no encontrás el producto o precio, mandá el catálogo oficial.
6. No digas "no entiendo" ni "no puedo ayudarte"; guiá la venta.
7. Si detectás ciudad, seguí directo según cobertura.
8. Si el cliente pasa todos los datos, confirmá pedido sin repreguntar.
9. Si no indica cantidad, asumí 1.
10. Respuesta corta, clara y vendedora.
11. Cerrá con pregunta o siguiente paso.
`.trim();

    // ================= HISTORIAL =================
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

    const response = await callGemini({
      apiKey: iaConfig.api_key,
      model: iaConfig.model || "gemini-2.5-flash",
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.25,
      maxTokens: iaConfig.max_tokens ?? 500,
    });

    if (!response) {
      return res.json({
        response:
          "📋 Te invito a revisar nuestro catálogo oficial con todos los productos y precios actualizados:\n\nhttps://cat-logomegatodo-com.vercel.app/",
      });
    }

    return res.status(200).json({
      response,
      context: {
        ...context,
        last_topic: context?.last_topic || trainingRow?.intent || "ENTRENAMIENTO",
        updated_at: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("❌ chat-ia error:", error);
    return res.status(500).json({
      error: error.message || "Error interno",
    });
  }
}
