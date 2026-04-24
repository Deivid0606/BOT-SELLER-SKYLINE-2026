import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// ================= HELPERS =================
const clean = (t: any) => String(t || "").trim();

const normalize = (t: string) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ================= LIMITADOR =================
function limitText(text: string, max = 6000) {
  return text.length > max ? text.slice(0, max) : text;
}

// ================= PARSE TRAINING =================
function parseTraining(fullText: string) {
  const t = fullText || "";

  const get = (start: string, end?: string) => {
    const s = t.indexOf(start);
    if (s === -1) return "";
    const e = end ? t.indexOf(end, s) : -1;
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
    faq: get("💬 FAQ", "🔁 CIERRE OBLIGATORIO"),
    closing: get("🔁 CIERRE OBLIGATORIO", "📋 EJEMPLOS PRÁCTICOS"),
    raw: t,
  };
}

// ================= CONTEXTO DINÁMICO =================
function buildContextSections(msg: string, sections: any) {
  const m = msg.toLowerCase();
  let ctx = "";

  ctx += `🧠 REGLAS:\n${sections.rules}\n\n`;

  if (m.includes("hola") || m.length < 6) {
    ctx += `💬 SALUDO:\n${sections.greeting}\n\n`;
  }

  if (m.includes("precio") || m.includes("cuesta")) {
    ctx += `💰 PRECIOS:\n${sections.prices}\n\n`;
  }

  if (m.match(/\b(de|soy|ciudad|capiata|luque|cde|asuncion)\b/)) {
    ctx += `📍 CIUDADES:\n${sections.cities}\n\n`;
    ctx += `🟢 COBERTURA:\n${sections.coverage}\n\n`;
    ctx += `🔴 SIN COBERTURA:\n${sections.noCoverage}\n\n`;
  }

  if (m.includes("direccion") || m.includes("pedido")) {
    ctx += `📋 PEDIDOS:\n${sections.orders}\n\n`;
  }

  if (m.includes("pago") || m.includes("transferencia")) {
    ctx += `💳 PAGOS:\n${sections.payments}\n\n`;
  }

  ctx += `🔁 CIERRE:\n${sections.closing}\n\n`;

  return ctx;
}

// ================= PEDIDOS =================
async function getOpenOrder(user_id: string, phone: string) {
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", user_id)
    .eq("from_number", phone)
    .in("status", ["draft", "collecting_name", "collecting_city", "collecting_address"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data;
}

function extractData(msg: string) {
  return {
    name: msg.match(/soy\s+([a-zA-Z\s]+)/i)?.[1],
    city: msg.match(/de\s+([a-zA-Z\s]+)/i)?.[1],
    address: msg.match(/direccion\s+(.+)/i)?.[1],
  };
}

function isComplete(o: any) {
  return o?.product && o?.customer_name && o?.city && o?.address;
}

// ================= GEMINI =================
async function callGemini({ apiKey, model, system, contents, temperature, maxTokens }: any) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );

  const data = await res.json();
  return clean(data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

// ================= MAIN =================
export default async function handler(req: any, res: any) {
  try {
    const { user_id, message, from_number, context, history } = req.body;

    const texto = clean(message);

    // ================= CARGAR ENTRENAMIENTO =================
    const { data: trainingRow } = await supabase
      .from("training_data")
      .select("response")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .limit(1)
      .single();

    const fullText = trainingRow?.response || "";

    // ================= PARSE =================
    const sections = parseTraining(fullText);

    // ================= CONTEXTO DINÁMICO =================
    const dynamicContext = buildContextSections(texto, sections);

    // ================= SYSTEM =================
    const system = `
${limitText(dynamicContext)}

⚠️ REGLAS CRÍTICAS:
- RESPONDER SOLO con esta información
- NO inventar productos ni precios
- SIEMPRE vender
- SIEMPRE cerrar con pregunta
- NO responder genérico
`;

    // ================= PEDIDOS =================
    let order = await getOpenOrder(user_id, from_number);
    const data = extractData(texto);

    if (order && (data.name || data.city || data.address)) {
      await supabase.from("orders").update({
        ...(data.name && { customer_name: data.name }),
        ...(data.city && { city: data.city }),
        ...(data.address && { address: data.address }),
      }).eq("id", order.id);
    }

    if (order && isComplete(order)) {
      return res.json({
        response: `✅ Pedido listo

📦 ${order.product}
👤 ${order.customer_name}
📍 ${order.city}
🏠 ${order.address}

¿Confirmamos tu pedido?`,
      });
    }

    // ================= IA =================
    const { data: ia } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .single();

    if (ia?.api_key && ia?.is_active) {
      const contents = (history || []).map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      }));

      contents.push({
        role: "user",
        parts: [{ text: texto }],
      });

      const r = await callGemini({
        apiKey: ia.api_key,
        model: ia.model || "gemini-2.5-flash",
        system,
        contents,
        temperature: ia.temperature ?? 0.4,
        maxTokens: ia.max_tokens ?? 300,
      });

      if (r) return res.json({ response: r });
    }

    // ================= FALLBACK =================
    return res.json({
      response: "👋 Hola! ¿Qué producto te interesa?",
    });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "error interno" });
  }
}
