import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
      .limit(12);

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
        content: msg.message || "",
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
// TRAINING
// ============================================
async function getTrainingContext(userId) {
  try {
    const { data, error } = await supabase
      .from("training_data")
      .select("intent, examples, response")
      .eq("user_id", userId)
      .eq("is_active", true);

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
          .filter(Boolean);

        return [
          `Intent: ${intent}`,
          examples.length ? `Ejemplos: ${examples.join(" | ")}` : null,
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
    context?.last_topic ? `Producto o tema actual: ${context.last_topic}` : null,
    context?.last_trigger
      ? `Último disparador activado: ${context.last_trigger}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = `
${systemInstruction || "Eres un asistente de ventas para una tienda online."}

REGLAS OBLIGATORIAS:
- Responde siempre en español.
- Mantén continuidad total con el historial del chat.
- Si el cliente viene hablando de un producto, NO cambies de producto ni reinicies la conversación.
- Si el cliente dice "quiero", "quiero comprar", "sí", "como hago", "cómo hago", "precio", "me interesa", "dame más info", asume que sigue hablando del último producto activo.
- Si existe CONTEXTO ACTUAL DEL CHAT, úsalo como prioridad.
- Si hubo disparador, continúa vendiendo ESE producto.
- No saludes de nuevo si la conversación ya está iniciada.
- No respondas genérico tipo "¿en qué producto estás interesado?" si ya hay contexto.
- Responde corto, claro y con intención de cierre.
- Si el cliente quiere comprar, guía el pedido de forma concreta.
- Pedí solo el siguiente dato necesario para avanzar.
- No inventes precios, stock ni beneficios que no estén en historial, entrenamiento o contexto.

OBJETIVO:
Cerrar la venta o avanzar la conversación comercial sin perder el hilo.

ENTRENAMIENTO DISPONIBLE:
${trainingContext}

CONTEXTO ACTUAL DEL CHAT:
${contextBlock || "Sin contexto guardado."}
  `.trim();

  const messages = [{ role: "system", content: systemPrompt }];

  for (const item of history || []) {
    if (!item?.content) continue;
    if (item.role !== "user" && item.role !== "assistant") continue;

    messages.push({
      role: item.role,
      content: item.content,
    });
  }

  messages.push({
    role: "user",
    content: currentMessage,
  });

  return messages;
}

// ============================================
// RESPUESTA IA DIRECTA EN WEBHOOK
// ============================================
async function generateAIReply(userId, message, fromNumber) {
  try {
    const { data: iaConfig, error: iaError } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (iaError || !iaConfig) {
      console.error("❌ No hay configuración IA:", iaError);
      return null;
    }

    if (!iaConfig.is_active || !cleanText(iaConfig.api_key)) {
      console.error("❌ IA inactiva o sin api_key");
      return null;
    }

    const history = await getRecentConversation(userId, fromNumber);
    const context = await getChatContext(userId, fromNumber);
    const trainingContext = await getTrainingContext(userId);

    const systemInstruction =
      cleanText(iaConfig.system_instruction) ||
      "Eres un asistente de ventas para una tienda online. Responde como vendedor profesional, amable, persuasivo y manteniendo el contexto.";

    const model = cleanText(iaConfig.model) || "openai/gpt-3.5-turbo";
    const temperature =
      typeof iaConfig.temperature === "number" ? iaConfig.temperature : 0.4;

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
        max_tokens: 350,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("❌ Error OpenRouter desde webhook:", data);
      return null;
    }

    const botResponse = cleanText(data?.choices?.[0]?.message?.content);

    if (!botResponse) {
      console.error("❌ La IA no devolvió contenido");
      return null;
    }

    console.log("✅ IA generó respuesta:", botResponse.slice(0, 120));
    return botResponse;
  } catch (error) {
    console.error("❌ Error generando respuesta IA:", error);
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
// FOLLOW UP
// ============================================
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
  ];

  return followUps.some((item) => normalized.includes(item));
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

    if (type !== "text" || !contenido) return;

    const existingContext = await getChatContext(userId, fromNumber);
    const followUp = isFollowUpMessage(contenido);

    // 1. Intentar trigger primero
    const triggerResult = await procesarDisparadores(userId, fromNumber, contenido);

    // 2. Si hubo trigger, termina este turno
    if (triggerResult) {
      console.log(`✅ Respuesta enviada por trigger: ${triggerResult.name}`);
      return;
    }

    // 3. IA directa
    const { data: iaConfig, error: iaError } = await supabase
      .from("chat_ia_gemini")
      .select("is_active, api_key")
      .eq("user_id", userId)
      .single();

    if (iaError) {
      console.error("❌ Error consultando configuración IA:", iaError);
      return;
    }

    if (!iaConfig?.is_active || !iaConfig?.api_key) {
      console.log(`⚠️ IA inactiva o sin api_key para user ${userId}`);
      return;
    }

    if (followUp && existingContext?.last_topic) {
      console.log(
        `🧠 Follow-up detectado para ${fromNumber} sobre tema: ${existingContext.last_topic}`
      );
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
