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
      .limit(4);

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
        content: String(msg.message || "").slice(0, 120),
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
// Usa columna phone
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
    const updated = await updateOrder(openOrder.id, {
      city: text,
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
// TRAINING
// ============================================
async function getTrainingContext(userId) {
  try {
    const { data, error } = await supabase
      .from("training_data")
      .select("intent, examples, response")
      .eq("user_id", userId)
      .eq("is_active", true)
      .limit(3);

    if (error) {
      console.error("Error cargando training_data:", error);
      return "No hay entrenamiento adicional cargado.";
    }

    if (!data || data.length === 0) {
      return "No hay entrenamiento adicional cargado.";
    }

    return data
      .map((row, index) => {
        const intent = cleanText(row.intent) || `Intent ${index + 1}`;
        const response = cleanText(row.response) || "Sin respuesta definida";
        const examples = safeArray(row.examples)
          .map((ex) => cleanText(ex))
          .filter(Boolean)
          .slice(0, 1);

        return [
          `Intent: ${intent}`,
          examples.length ? `Ejemplo: ${examples.join(" | ")}` : null,
          `Respuesta ideal: ${response}`,
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");
  } catch (error) {
    console.error("Error armando training context:", error);
    return "No hay entrenamiento adicional cargado.";
  }
}

// ============================================
// ARMAR MENSAJES IA
// ============================================
function buildAIMessages({
  systemInstruction,
  trainingContext,
  history,
  currentMessage,
  context,
}) {
  const contextBlock = [
    context?.last_topic ? `Producto o tema actual: ${cleanText(context.last_topic).slice(0, 120)}` : null,
    context?.last_trigger ? `Último disparador activado: ${cleanText(context.last_trigger).slice(0, 80)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const compactInstruction = cleanText(systemInstruction).slice(0, 280);
  const compactTraining = String(trainingContext || "").slice(0, 500);

  const systemPrompt = `
${compactInstruction || "Eres un asistente de ventas para una tienda online."}

Reglas:
- Responde siempre en español.
- Mantén continuidad con el historial.
- Si hay producto o contexto activo, continúa sobre eso.
- No reinicies la conversación ni saludes otra vez.
- Responde breve, clara y orientada a venta.
- Pide solo el siguiente dato necesario.
- No inventes precios, stock ni beneficios.

Entrenamiento:
${compactTraining || "Sin entrenamiento adicional."}

Contexto actual:
${contextBlock || "Sin contexto guardado."}
  `.trim();

  const messages = [{ role: "system", content: systemPrompt }];

  for (const item of history || []) {
    if (!item?.content) continue;
    if (item.role !== "user" && item.role !== "assistant") continue;

    messages.push({
      role: item.role,
      content: String(item.content).slice(0, 120),
    });
  }

  messages.push({
    role: "user",
    content: cleanText(currentMessage).slice(0, 180),
  });

  return messages;
}

// ============================================
// IA TEXTO
// ============================================
async function generateAIReply(userId, message, fromNumber) {
  try {
    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) return null;

    const history = await getRecentConversation(userId, fromNumber);
    const context = await getChatContext(userId, fromNumber);
    const trainingContext = await getTrainingContext(userId);

    const systemInstruction =
      cleanText(iaConfig.system_instruction) ||
      "Eres un asistente de ventas para una tienda online. Responde como vendedor profesional, amable, persuasivo y manteniendo el contexto.";

    const model = cleanText(iaConfig.model) || "openai/gpt-4o-mini";
    const temperature =
      typeof iaConfig.temperature === "number" ? iaConfig.temperature : 0.4;
    const maxTokens =
      typeof iaConfig.max_tokens === "number" ? iaConfig.max_tokens : 50;

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

// ============================================
// IA IMAGEN
// ============================================
async function analyzeImageWithAI(userId, imageUrl, fromNumber) {
  try {
    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) return null;

    const context = await getChatContext(userId, fromNumber);
    const trainingContext = await getTrainingContext(userId);

    const systemInstruction =
      cleanText(iaConfig.system_instruction) ||
      "Eres un asistente de ventas para una tienda online.";

    const compactInstruction = systemInstruction.slice(0, 220);
    const compactTraining = trainingContext.slice(0, 300);
    const compactContext = context?.last_topic
      ? cleanText(context.last_topic).slice(0, 100)
      : "Sin contexto guardado.";

    const prompt = `
${compactInstruction}

Analiza la imagen enviada por el cliente.
- Si la imagen muestra un producto, descríbelo y responde como vendedor.
- Si la imagen parece relacionada con el producto actual del chat, continúa sobre ese producto.
- Si no se entiende bien la imagen, pide otra foto más clara.
- Responde siempre en español.
- Sé breve y útil.

Entrenamiento:
${compactTraining}

Contexto actual:
${compactContext}
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
        max_tokens: 50,
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
// Requiere OPENAI_API_KEY en Vercel
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

    // ============================================
    // IMAGEN
    // ============================================
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

    // ============================================
    // AUDIO
    // ============================================
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

    // Solo texto desde acá
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
