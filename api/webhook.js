import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_TOKEN = "miTokenSeguro2026";

// ============================================
// HELPERS
// ============================================
function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value) {
  return String(value || "").trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLocationText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/@/g, "a")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CIUDADES_COBERTURA = [
  "asuncion",
  "asun",
  "hernandarias",
  "hernadarias",
  "ernadaria",
  "ita",
  "ciudad del este",
  "cuidad del este",
  "ciudad del es",
  "ciudad del",
  "cde",
  "fdo de la mora",
  "fernando de la mora",
  "fdm",
  "lambare",
  "lambaree",
  "luque",
  "lque",
  "santa rita",
  "san alberto",
  "nemby",
  "presidente franco",
  "pte franco",
  "pdte franco",
  "ypane",
  "ypanee",
  "villa hayes",
  "capiata",
  "capita",
  "capia",
  "capiataa",
  "altos",
  "caacupe",
  "ypacarai",
  "san lorenzo",
  "sanlo",
  "slz",
  "villa elisa",
  "mariano roque alonso",
  "mra",
  "limpio",
  "aregua",
  "itaugua",
  "itauguaa",
  "nueva italia",
  "villeta",
  "j augusto saldivar",
  "jas",
  "saldivar",
  "san antonio",
  "san anotonio",
  "san antoni",
  "loma pyta",
  "sajonia",
  "minga guazu",
  "minga",
  "colonia yguazu",
  "juan leon mallorquin",
  "encarnacion",
  "concepcion",
  "san estanislao",
  "santani",
  "coronel oviedo",
  "caaguazu",
  "paraguari",
  "yaguaron",
  "atyra",
  "piribebuy",
  "tobati",
  "emboscada",
  "loma grande",
  "benjamin aceval",
  "remansito"
];

const ZONAS_AMBIGUAS = {
  central:
    "📍 ¿De qué ciudad de Central sos? 😊\nPodés decirme por ejemplo: San Lorenzo, Luque, Capiatá, Areguá, Itá, Itauguá, Ñemby, Villa Elisa, Mariano Roque Alonso o Limpio.",
  "alto parana":
    "📍 ¿Ciudad del Este, Presidente Franco o Hernandarias? 😊",
  "presidente hayes":
    "📍 ¿Villa Hayes, Benjamín Aceval o Remansito? 😊",
};

const NO_CIUDADES = ["km 10", "monday", "multiplaza"];

function detectCoverageCity(text) {
  const normalized = normalizeLocationText(text);

  for (const bad of NO_CIUDADES) {
    if (normalized.includes(bad)) {
      return { type: "ignore", value: bad };
    }
  }

  for (const [zone, reply] of Object.entries(ZONAS_AMBIGUAS)) {
    if (normalized.includes(zone)) {
      return { type: "ambiguous", value: zone, reply };
    }
  }

  const sorted = [...CIUDADES_COBERTURA].sort((a, b) => b.length - a.length);

  for (const city of sorted) {
    if (normalized.includes(city)) {
      return { type: "coverage", value: city };
    }
  }

  return null;
}

function formatCityName(city) {
  const map = {
    asuncion: "Asunción",
    asun: "Asunción",
    hernandarias: "Hernandarias",
    hernadarias: "Hernandarias",
    ernadaria: "Hernandarias",
    ita: "Itá",
    "ciudad del este": "Ciudad del Este",
    "cuidad del este": "Ciudad del Este",
    "ciudad del es": "Ciudad del Este",
    "ciudad del": "Ciudad del Este",
    cde: "Ciudad del Este",
    "fdo de la mora": "Fernando de la Mora",
    fdm: "Fernando de la Mora",
    "fernando de la mora": "Fernando de la Mora",
    lambare: "Lambaré",
    lambaree: "Lambaré",
    luque: "Luque",
    lque: "Luque",
    "santa rita": "Santa Rita",
    "san alberto": "San Alberto",
    nemby: "Ñemby",
    "presidente franco": "Presidente Franco",
    "pte franco": "Presidente Franco",
    "pdte franco": "Presidente Franco",
    ypane: "Ypané",
    ypanee: "Ypané",
    "villa hayes": "Villa Hayes",
    capiata: "Capiatá",
    capita: "Capiatá",
    capia: "Capiatá",
    capiataa: "Capiatá",
    altos: "Altos",
    caacupe: "Caacupé",
    ypacarai: "Ypacaraí",
    "san lorenzo": "San Lorenzo",
    sanlo: "San Lorenzo",
    slz: "San Lorenzo",
    "villa elisa": "Villa Elisa",
    "mariano roque alonso": "Mariano Roque Alonso",
    mra: "Mariano Roque Alonso",
    limpio: "Limpio",
    aregua: "Areguá",
    itaugua: "Itauguá",
    itauguaa: "Itauguá",
    "nueva italia": "Nueva Italia",
    villeta: "Villeta",
    "j augusto saldivar": "J. Augusto Saldívar",
    jas: "J. Augusto Saldívar",
    saldivar: "J. Augusto Saldívar",
    "san antonio": "San Antonio",
    "san anotonio": "San Antonio",
    "san antoni": "San Antonio",
    "loma pyta": "Loma Pytá",
    sajonia: "Asunción",
    "minga guazu": "Minga Guazú",
    minga: "Minga Guazú",
    "colonia yguazu": "Colonia Yguazú",
    "juan leon mallorquin": "Juan León Mallorquín",
    encarnacion: "Encarnación",
    concepcion: "Concepción",
    "san estanislao": "San Estanislao (Santaní)",
    santani: "San Estanislao (Santaní)",
    "coronel oviedo": "Coronel Oviedo",
    caaguazu: "Caaguazú",
    paraguari: "Paraguarí",
    yaguaron: "Yaguarón",
    atyra: "Atyrá",
    piribebuy: "Piribebuy",
    tobati: "Tobatí",
    emboscada: "Emboscada",
    "loma grande": "Loma Grande",
    "benjamin aceval": "Benjamín Aceval",
    remansito: "Remansito",
  };

  return map[city] || city;
}

function buildTopicFromTrigger(trigger, responseText) {
  return (
    cleanText(trigger?.template) ||
    cleanText(responseText) ||
    cleanText(trigger?.response) ||
    cleanText(trigger?.name) ||
    cleanText(trigger?.condition) ||
    null
  );
}

function isFollowUpMessage(text) {
  const normalized = normalizeText(text);

  const followUps = [
    "quiero",
    "si",
    "sí",
    "como hago",
    "cómo hago",
    "precio",
    "cuanto",
    "cuánto",
    "me interesa",
    "quiero comprar",
    "como compro",
    "cómo compro",
    "pedido",
    "comprar",
    "info",
    "mas info",
    "más info",
    "disponible",
    "ok",
    "dale",
    "uno",
    "dos",
    "promo",
    "confirmo",
    "envíame",
    "me quedo",
  ];

  return followUps.some((item) => normalized.includes(item));
}

function detectQuantity(text) {
  const normalized = normalizeText(text);

  if (
    normalized.includes(" 5 ") ||
    normalized.includes("cinco") ||
    normalized.startsWith("5")
  ) return 5;

  if (
    normalized.includes(" 4 ") ||
    normalized.includes("cuatro") ||
    normalized.startsWith("4")
  ) return 4;

  if (
    normalized.includes(" 3 ") ||
    normalized.includes("tres") ||
    normalized.startsWith("3")
  ) return 3;

  if (
    normalized.includes(" 2 ") ||
    normalized.includes("dos") ||
    normalized.startsWith("2")
  ) return 2;

  return 1;
}

function extractGsAmount(text) {
  const value = cleanText(text);
  if (!value) return null;

  const match = value.match(/(\d{1,3}(?:[.,]\d{3})+|\d+)\s*gs/i);
  if (!match) return null;

  let amount = match[1].replace(/,/g, ".");
  if (!amount.toLowerCase().includes("gs")) {
    amount = `${amount} Gs`;
  }

  return amount;
}

function simplifyProductName(context) {
  const text = cleanText(context);
  if (!text) return "Producto";

  const productoMatch = text.match(/producto\s*:\s*(.+)/i);
  if (productoMatch?.[1]) {
    return cleanText(productoMatch[1]);
  }

  const firstLine = text.split("\n").map(cleanText).find(Boolean);
  return firstLine || "Producto";
}

function buildConfirmedOrderMessage(order) {
  const product = cleanText(order?.product) || "Producto";
  const customerName = cleanText(order?.customer_name) || "Cliente";
  const city = cleanText(order?.city) || "Ciudad";
  const address = cleanText(order?.address) || "Dirección";
  const phone = cleanText(order?.phone) || "Sin teléfono";
  const quantity = Number(order?.quantity || 1);
  const total = cleanText(order?.total_amount) || "A confirmar";

  return `✅ PEDIDO CONFIRMADO
━━━━━━━━━━━━━━━━━━━━━━
✅ Producto: ${product}
✅ Cliente: ${customerName}
✅ Ubicación: ${city} — ${address}
✅ Contacto: ${phone}
✅ Cantidad: ${quantity} u.

💰 Total: ${total}
🚚 Envío GRATIS · Pagás al recibir
⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

🔗 Te invito a revisar nuestro catálogo oficial: https://cat-logomegatodo-com.vercel.app/`;
}

// ============================================
// CONFIG IA
// ============================================
async function getIAConfig(userId) {
  try {
    const { data, error } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      console.error("❌ No hay configuración IA:", error);
      return null;
    }

    if (!data.is_active || !cleanText(data.api_key)) {
      console.error("❌ IA inactiva o sin api_key");
      return null;
    }

    return data;
  } catch (error) {
    console.error("❌ Error cargando config IA:", error);
    return null;
  }
}

// ============================================
// HISTORIAL
// ============================================
async function getRecentConversation(userId, fromNumber) {
  try {
    const { data, error } = await supabase
      .from("received_messages")
      .select("message, message_type, created_at")
      .eq("user_id", userId)
      .eq("from_number", fromNumber)
      .order("created_at", { ascending: false })
      .limit(2);

    if (error) {
      console.error("Error obteniendo historial:", error);
      return [];
    }

    return [...(data || [])]
      .reverse()
      .map((msg) => ({
        role:
          msg.message_type && String(msg.message_type).startsWith("out_")
            ? "assistant"
            : "user",
        content: String(msg.message || "").slice(0, 100),
      }))
      .filter((item) => cleanText(item.content));
  } catch (error) {
    console.error("Error obteniendo historial reciente:", error);
    return [];
  }
}

// ============================================
// CONTEXTO
// ============================================
async function getChatContext(userId, fromNumber) {
  try {
    const { data, error } = await supabase
      .from("chat_context")
      .select("last_topic, last_trigger, updated_at")
      .eq("user_id", userId)
      .eq("from_number", fromNumber)
      .maybeSingle();

    if (error) {
      console.error("Error obteniendo contexto del chat:", error);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error("Error obteniendo chat_context:", error);
    return null;
  }
}

async function saveChatContext(userId, fromNumber, payload = {}) {
  try {
    const { error } = await supabase.from("chat_context").upsert(
      {
        user_id: userId,
        from_number: fromNumber,
        last_topic: payload.last_topic || null,
        last_trigger: payload.last_trigger || null,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "user_id,from_number",
      }
    );

    if (error) {
      console.error("Error guardando contexto:", error);
    }
  } catch (error) {
    console.error("Error en saveChatContext:", error);
  }
}

// ============================================
// ORDERS
// ============================================
async function getOpenOrder(userId, phone) {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .eq("phone", phone)
      .in("status", ["draft", "collecting_name", "collecting_city", "collecting_address"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Error obteniendo order abierta:", error);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error("Error en getOpenOrder:", error);
    return null;
  }
}

async function createOrderDraft(userId, phone, payload = {}) {
  try {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        phone,
        product: payload.product || null,
        customer_name: payload.customer_name || null,
        city: payload.city || null,
        address: payload.address || null,
        quantity: payload.quantity || 1,
        total_amount: payload.total_amount || null,
        status: payload.status || "collecting_name",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error) {
      console.error("Error creando borrador de pedido:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error en createOrderDraft:", error);
    return null;
  }
}

async function updateOrder(orderId, payload = {}) {
  try {
    const { data, error } = await supabase
      .from("orders")
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select("*")
      .single();

    if (error) {
      console.error("Error actualizando pedido:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Error en updateOrder:", error);
    return null;
  }
}

function isOrderComplete(order) {
  return !!(
    cleanText(order?.product) &&
    cleanText(order?.customer_name) &&
    cleanText(order?.city) &&
    cleanText(order?.address) &&
    cleanText(order?.phone) &&
    Number(order?.quantity || 0) > 0
  );
}

async function startOrderFlow(userId, fromNumber, context, message) {
  const existingOrder = await getOpenOrder(userId, fromNumber);
  if (existingOrder) return existingOrder;

  const quantity = detectQuantity(message);
  const totalAmount =
    extractGsAmount(context?.last_topic) ||
    extractGsAmount(context?.last_trigger) ||
    "A confirmar";
  const product =
    cleanText(context?.last_trigger) ||
    simplifyProductName(context?.last_topic);

  return await createOrderDraft(userId, fromNumber, {
    product,
    quantity,
    total_amount: totalAmount,
    status: "collecting_name",
  });
}

async function handleOrderDataCollection(userId, fromNumber, incomingText) {
  const openOrder = await getOpenOrder(userId, fromNumber);
  if (!openOrder) return false;

  const text = cleanText(incomingText);
  if (!text) return true;

  if (openOrder.status === "collecting_name") {
    const updated = await updateOrder(openOrder.id, {
      customer_name: text,
      status: "collecting_city",
    });

    if (updated) {
      await sendWhatsAppMessage(
        userId,
        fromNumber,
        "Perfecto 🙌 Ahora pasame tu ciudad."
      );
    }

    return true;
  }

  if (openOrder.status === "collecting_city") {
    const detection = detectCoverageCity(text);
    const finalCity =
      detection?.type === "coverage" ? formatCityName(detection.value) : text;

    const updated = await updateOrder(openOrder.id, {
      city: finalCity,
      status: "collecting_address",
    });

    if (updated) {
      await sendWhatsAppMessage(
        userId,
        fromNumber,
        "Genial 😊 Ahora pasame tu dirección exacta."
      );
    }

    return true;
  }

  if (openOrder.status === "collecting_address") {
    const updated = await updateOrder(openOrder.id, {
      address: text,
      status: "draft",
    });

    if (!updated) return true;

    if (isOrderComplete(updated)) {
      const confirmationText = buildConfirmedOrderMessage(updated);
      const sent = await sendWhatsAppMessage(userId, fromNumber, confirmationText);

      if (sent) {
        await updateOrder(updated.id, {
          status: "confirmed",
        });
      }
    } else {
      await sendWhatsAppMessage(
        userId,
        fromNumber,
        "Me faltan algunos datos para confirmar tu pedido."
      );
    }

    return true;
  }

  return false;
}

// ============================================
// TRAINING / IA
// ============================================
function tokenizeText(text) {
  return Array.from(
    new Set(
      cleanText(text)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3)
    )
  );
}

function scoreTrainingRow(row, currentMessage, context) {
  const query = [
    cleanText(currentMessage),
    cleanText(context?.last_topic),
    cleanText(context?.last_trigger),
  ]
    .filter(Boolean)
    .join(" ");

  const keywords = tokenizeText(query);
  if (!keywords.length) return 0;

  const intent = cleanText(row.intent).toLowerCase();
  const response = cleanText(row.response).toLowerCase();
  const examples = safeArray(row.examples)
    .map((ex) => cleanText(ex).toLowerCase())
    .filter(Boolean);

  let score = 0;

  for (const keyword of keywords) {
    if (intent.includes(keyword)) score += 4;
    if (response.includes(keyword)) score += 2;
    if (examples.some((ex) => ex.includes(keyword))) score += 3;
  }

  return score;
}

function selectRelevantTrainingRows(rows, currentMessage, context) {
  if (!rows || rows.length === 0) return [];

  const ranked = rows
    .map((row, index) => ({
      row,
      index,
      score: scoreTrainingRow(row, currentMessage, context),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const relevant = ranked
    .filter((item) => item.score > 0)
    .slice(0, 2)
    .map((item) => item.row);

  if (relevant.length > 0) return relevant;

  return rows.slice(0, 1);
}

async function getTrainingContext(userId, currentMessage, context) {
  try {
    const { data, error } = await supabase
      .from("training_data")
      .select("intent, examples, response")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (error) {
      console.error("Error cargando training_data:", error);
      return "Sin entrenamiento adicional.";
    }

    if (!data || data.length === 0) {
      return "Sin entrenamiento adicional.";
    }

    const relevantRows = selectRelevantTrainingRows(data, currentMessage, context);

    return relevantRows
      .map((row, index) => {
        const intent = cleanText(row.intent) || `Intent ${index + 1}`;
        const response = cleanText(row.response) || "Sin respuesta definida";
        const examples = safeArray(row.examples)
          .map((ex) => cleanText(ex))
          .filter(Boolean)
          .slice(0, 1);

        return [
          `Intent: ${intent}`,
          examples.length ? `Ejemplo: ${examples[0]}` : null,
          `Respuesta ideal: ${response}`,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n")
      .slice(0, 220);
  } catch (error) {
    console.error("Error armando training context:", error);
    return "Sin entrenamiento adicional.";
  }
}

function buildAIMessages({
  systemInstruction,
  trainingContext,
  history,
  currentMessage,
  context,
}) {
  const contextBlock = [
    context?.last_topic ? `Tema: ${cleanText(context.last_topic).slice(0, 80)}` : null,
    context?.last_trigger ? `Trigger: ${cleanText(context.last_trigger).slice(0, 50)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `
${cleanText(systemInstruction).slice(0, 160) || "Eres un asistente de ventas."}
Reglas:
- Responde en español.
- Sé breve y clara.
- Mantén el contexto.
- No inventes precios ni stock.
- Si ya hay producto activo, seguí sobre ese producto.

Entrenamiento:
${trainingContext || "Sin entrenamiento."}

Contexto:
${contextBlock || "Sin contexto."}
  `.trim();

  const messages = [{ role: "system", content: systemPrompt }];

  for (const item of history || []) {
    if (!item?.content) continue;
    if (item.role !== "user" && item.role !== "assistant") continue;

    messages.push({
      role: item.role,
      content: String(item.content).slice(0, 100),
    });
  }

  messages.push({
    role: "user",
    content: cleanText(currentMessage).slice(0, 120),
  });

  return messages;
}

async function generateAIReply(userId, message, fromNumber) {
  try {
    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) return null;

    const history = await getRecentConversation(userId, fromNumber);
    const context = await getChatContext(userId, fromNumber);
    const trainingContext = await getTrainingContext(userId, message, context);

    const systemInstruction =
      cleanText(iaConfig.system_instruction) ||
      "Eres un asistente de ventas para una tienda online.";

    const model = cleanText(iaConfig.model) || "openai/gpt-4o-mini";
    const temperature =
      typeof iaConfig.temperature === "number" ? iaConfig.temperature : 0.4;
    const maxTokens =
      typeof iaConfig.max_tokens === "number" ? iaConfig.max_tokens : 30;

    const messages = buildAIMessages({
      systemInstruction,
      trainingContext,
      history,
      currentMessage: cleanText(message),
      context,
    });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${iaConfig.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("❌ Error OpenRouter texto:", data);
      return null;
    }

    const botResponse = cleanText(data?.choices?.[0]?.message?.content);
    if (!botResponse) return null;

    console.log("✅ IA generó respuesta:", botResponse.slice(0, 120));
    return botResponse;
  } catch (error) {
    console.error("❌ Error generando respuesta IA:", error);
    return null;
  }
}

async function analyzeImageWithAI(userId, imageUrl, fromNumber) {
  try {
    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) return null;

    const context = await getChatContext(userId, fromNumber);
    const trainingContext = await getTrainingContext(userId, "[imagen]", context);

    const systemInstruction =
      cleanText(iaConfig.system_instruction) ||
      "Eres un asistente de ventas para una tienda online.";

    const prompt = `
${cleanText(systemInstruction).slice(0, 120)}

Analiza la imagen enviada por el cliente.
- Responde en español.
- Sé breve y orientado a venta.
- Si no se entiende, pedí otra foto.

Entrenamiento:
${String(trainingContext).slice(0, 120)}

Contexto:
${context?.last_topic ? cleanText(context.last_topic).slice(0, 60) : "Sin contexto"}
    `.trim();

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${iaConfig.api_key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        temperature: 0.3,
        max_tokens: 30,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("❌ Error OpenRouter imagen:", data);
      return null;
    }

    return cleanText(data?.choices?.[0]?.message?.content) || null;
  } catch (error) {
    console.error("❌ Error analizando imagen:", error);
    return null;
  }
}

// ============================================
// TRANSCRIBIR AUDIO
// ============================================
async function transcribeAudioFromUrl(audioUrl) {
  try {
    if (!openAiApiKey) {
      console.error("❌ Falta OPENAI_API_KEY para transcripción");
      return null;
    }

    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      console.error("❌ No se pudo descargar audio para transcribir");
      return null;
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const blob = new Blob([audioBuffer], { type: "audio/mpeg" });

    const formData = new FormData();
    formData.append("file", blob, "audio.mp3");
    formData.append("model", "whisper-1");
    formData.append("language", "es");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
      },
      body: formData,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("❌ Error transcribiendo audio:", data);
      return null;
    }

    return cleanText(data?.text) || null;
  } catch (error) {
    console.error("❌ Error en transcribeAudioFromUrl:", error);
    return null;
  }
}

// ============================================
// ENVIAR WHATSAPP
// ============================================
async function sendWhatsAppMessage(userId, to, message) {
  try {
    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .single();

    if (configError) {
      console.error("Error cargando whatsapp_config:", configError);
      return null;
    }

    if (!config?.phone_number_id || !config?.permanent_token) {
      console.error("Falta phone_number_id o permanent_token");
      return null;
    }

    const response = await fetch(
      `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.permanent_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message },
        }),
      }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Error enviando a Meta:", result);
      return null;
    }

    await supabase.from("received_messages").insert({
      user_id: userId,
      platform: "whatsapp",
      from_number: to,
      message,
      message_type: "out_text",
      is_processed: true,
      created_at: new Date().toISOString(),
    });

    return result;
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    return null;
  }
}

// ============================================
// DISPARADORES
// ============================================
async function procesarDisparadores(userId, fromNumber, message) {
  try {
    const { data: triggers, error } = await supabase
      .from("triggers")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);

    if (error) {
      console.error("Error cargando triggers:", error);
      return null;
    }

    if (!triggers || triggers.length === 0) return null;

    const messageLower = normalizeText(message);

    for (const trigger of triggers) {
      const condition = normalizeText(trigger.condition);
      if (!condition) continue;

      if (messageLower.includes(condition)) {
        console.log(`🎯 Disparador encontrado: ${trigger.name}`);

        let responseText = trigger.response || "";

        if (trigger.template && trigger.template !== "Ninguna") {
          const { data: template, error: tplError } = await supabase
            .from("templates")
            .select("content")
            .eq("name", trigger.template)
            .eq("user_id", userId)
            .single();

          if (tplError) {
            console.error("Error cargando plantilla del trigger:", tplError);
          }

          if (template?.content) {
            responseText = template.content;
          }
        }

        if (responseText) {
          await sendWhatsAppMessage(userId, fromNumber, responseText);
        }

        await saveChatContext(userId, fromNumber, {
          last_topic: buildTopicFromTrigger(trigger, responseText),
          last_trigger: trigger.name || null,
        });

        return {
          ...trigger,
          responseText,
        };
      }
    }

    return null;
  } catch (error) {
    console.error("Error procesando disparadores:", error);
    return null;
  }
}

// ============================================
// DESCARGAR MEDIA
// ============================================
async function downloadAndUploadMedia(mediaId, token) {
  try {
    const mediaUrlResponse = await fetch(
      `https://graph.facebook.com/v22.0/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!mediaUrlResponse.ok) return null;

    const mediaData = await mediaUrlResponse.json();
    if (!mediaData.url) return null;

    const fileResponse = await fetch(mediaData.url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!fileResponse.ok) return null;

    const fileBuffer = await fileResponse.arrayBuffer();

    let mediaType = "document";
    let fileExt = "bin";
    const mimeType = mediaData.mime_type || "application/octet-stream";

    if (mimeType.includes("image")) {
      mediaType = "image";
      fileExt = mimeType.split("/")[1] || "jpg";
    } else if (mimeType.includes("video")) {
      mediaType = "video";
      fileExt = mimeType.split("/")[1] || "mp4";
    } else if (mimeType.includes("audio")) {
      mediaType = "audio";
      fileExt = mimeType.split("/")[1] || "mp3";
    }

    const fileName = `incoming/${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 10)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("templates-media")
      .upload(fileName, Buffer.from(fileBuffer), {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Error subiendo media a storage:", uploadError);
      return null;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("templates-media").getPublicUrl(fileName);

    return { url: publicUrl, type: mediaType };
  } catch (error) {
    console.error("Error en downloadAndUploadMedia:", error);
    return null;
  }
}

// ============================================
// PROCESAR MENSAJE
// ============================================
async function procesarMensaje(message, token, userId, fromNumber) {
  try {
    const type = message.type;
    let contenido = "";
    let mediaUrl = null;
    let mediaType = null;
    let mediaId = null;
    const now = new Date().toISOString();

    if (type === "text") {
      contenido = cleanText(message.text?.body || "");
      console.log("🔥 WEBHOOK RECIBIÓ MENSAJE:", contenido, "de", fromNumber);
    } else if (type === "image") {
      mediaId = message.image?.id;
      contenido = "[Imagen]";
    } else if (type === "video") {
      mediaId = message.video?.id;
      contenido = "[Video]";
    } else if (type === "audio") {
      mediaId = message.audio?.id;
      contenido = "[Audio]";
    } else {
      contenido = "[Mensaje no soportado]";
    }

    if (mediaId && token) {
      const mediaResult = await downloadAndUploadMedia(mediaId, token);
      if (mediaResult) {
        mediaUrl = mediaResult.url;
        mediaType = mediaResult.type;
      }
    }

    await supabase.from("received_messages").insert({
      user_id: userId,
      platform: "whatsapp",
      from_number: fromNumber,
      message: contenido,
      message_type: type,
      media_url: mediaUrl,
      media_type: mediaType,
      is_processed: false,
      created_at: now,
    });

    console.log(`📝 Mensaje guardado de ${fromNumber}: ${contenido.substring(0, 80)}`);

    if (type === "image" && mediaUrl) {
      const imageReply = await analyzeImageWithAI(userId, mediaUrl, fromNumber);

      if (imageReply) {
        await sendWhatsAppMessage(userId, fromNumber, imageReply);
      } else {
        await sendWhatsAppMessage(
          userId,
          fromNumber,
          "Recibí tu imagen 📸, pero no pude analizarla bien. Probá mandarme otra foto más clara."
        );
      }

      return;
    }

    if (type === "audio" && mediaUrl) {
      const transcript = await transcribeAudioFromUrl(mediaUrl);

      if (!transcript) {
        await sendWhatsAppMessage(
          userId,
          fromNumber,
          openAiApiKey
            ? "Recibí tu audio 🎙️, pero no pude transcribirlo. Probá mandarlo otra vez."
            : "Recibí tu audio 🎙️, pero la transcripción todavía no está configurada en el servidor."
        );
        return;
      }

      console.log(`🎙️ Audio transcripto: ${transcript}`);

      await supabase.from("received_messages").insert({
        user_id: userId,
        platform: "whatsapp",
        from_number: fromNumber,
        message: `[Transcripción de audio] ${transcript}`,
        message_type: "audio_transcript",
        is_processed: true,
        created_at: new Date().toISOString(),
      });

      const handledOrderFromAudio = await handleOrderDataCollection(
        userId,
        fromNumber,
        transcript
      );
      if (handledOrderFromAudio) return;

      const existingContextFromAudio = await getChatContext(userId, fromNumber);
      const followUpFromAudio = isFollowUpMessage(transcript);

      const triggerFromAudio = await procesarDisparadores(userId, fromNumber, transcript);
      if (triggerFromAudio) return;

      const cityDetectionAudio = detectCoverageCity(transcript);
      if (cityDetectionAudio?.type === "ambiguous") {
        await sendWhatsAppMessage(userId, fromNumber, cityDetectionAudio.reply);
        return;
      }

      if (followUpFromAudio && existingContextFromAudio?.last_topic) {
        const order = await startOrderFlow(
          userId,
          fromNumber,
          existingContextFromAudio,
          transcript
        );

        if (order) {
          await sendWhatsAppMessage(
            userId,
            fromNumber,
            `¡Genial! 😊 Para confirmar tu pedido de *${cleanText(order.product) || "tu producto"}* pasame tu *nombre completo*.`
          );
          return;
        }
      }

      const audioReply = await generateAIReply(userId, transcript, fromNumber);

      if (audioReply) {
        await sendWhatsAppMessage(userId, fromNumber, audioReply);
      }

      return;
    }

    if (type !== "text" || !contenido) return;

    const handledOrder = await handleOrderDataCollection(userId, fromNumber, contenido);
    if (handledOrder) {
      console.log(`🧾 Mensaje usado para completar pedido de ${fromNumber}`);
      return;
    }

    const existingContext = await getChatContext(userId, fromNumber);
    const followUp = isFollowUpMessage(contenido);

    const triggerResult = await procesarDisparadores(userId, fromNumber, contenido);
    if (triggerResult) {
      console.log(`✅ Respuesta enviada por trigger: ${triggerResult.name}`);
      return;
    }

    const cityDetection = detectCoverageCity(contenido);

    if (cityDetection?.type === "ambiguous") {
      await sendWhatsAppMessage(userId, fromNumber, cityDetection.reply);
      return;
    }

    if (cityDetection?.type === "coverage") {
      const cityName = formatCityName(cityDetection.value);

      await saveChatContext(userId, fromNumber, {
        last_topic: existingContext?.last_topic || cityName,
        last_trigger: "ciudad_cobertura",
      });

      await sendWhatsAppMessage(
        userId,
        fromNumber,
        `✅ Perfecto 😊 ${cityName} tiene ENVÍO GRATIS contra-entrega 🚚
💵 Pagás al recibir SIN moverte de casa

¿Te parece si te agendo ahora mismo? ¿Nombre y teléfono? 📝

📋 Catálogo:
https://cat-logomegatodo-com.vercel.app/`
      );
      return;
    }

    if (followUp && existingContext?.last_topic) {
      const order = await startOrderFlow(userId, fromNumber, existingContext, contenido);

      if (order) {
        await sendWhatsAppMessage(
          userId,
          fromNumber,
          `¡Genial! 😊 Para confirmar tu pedido de *${cleanText(order.product) || "tu producto"}* pasame tu *nombre completo*.`
        );
        return;
      }
    }

    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) {
      console.log(`⚠️ IA inactiva o sin api_key para user ${userId}`);
      return;
    }

    console.log(`🤖 IA activa, respondiendo a ${fromNumber}`);

    const aiResponse = await generateAIReply(userId, contenido, fromNumber);

    if (!aiResponse) {
      console.log(`⚠️ La IA no devolvió respuesta para ${fromNumber}`);
      return;
    }

    const sendResult = await sendWhatsAppMessage(userId, fromNumber, aiResponse);

    if (sendResult) {
      await saveChatContext(userId, fromNumber, {
        last_topic: existingContext?.last_topic || contenido,
        last_trigger: existingContext?.last_trigger || null,
      });
    }
  } catch (err) {
    console.error("❌ Error procesando mensaje:", err);
  }
}

// ============================================
// HANDLER
// ============================================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Token inválido");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;

      if (body.object !== "whatsapp_business_account") {
        return res.status(404).send("Not WhatsApp event");
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id;

          if (!phoneNumberId) {
            console.error("❌ No llegó phone_number_id en metadata");
            continue;
          }

          const { data: config, error: configError } = await supabase
            .from("whatsapp_config")
            .select("user_id, permanent_token, phone_number_id")
            .eq("phone_number_id", phoneNumberId)
            .single();

          if (configError || !config?.user_id) {
            console.error(
              "❌ No se encontró configuración para ese phone_number_id",
              configError
            );
            continue;
          }

          const userId = config.user_id;
          const token = config.permanent_token;

          if (value.messages) {
            for (const message of value.messages) {
              const fromNumber = message.from;
              await procesarMensaje(message, token, userId, fromNumber);
            }
          }
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("❌ Error en webhook:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }

  return res.status(405).send("Method Not Allowed");
}
