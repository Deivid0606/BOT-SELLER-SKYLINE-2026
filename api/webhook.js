import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_TOKEN = "miTokenSeguro2026";

// ============================================
// HELPERS
// ============================================
function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "https://bot-seller-skyline-2026.vercel.app";
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

// ============================================
// FUNCIÓN: Obtener historial reciente
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
      .filter((item) => item.content.trim());
  } catch (error) {
    console.error("Error obteniendo historial reciente:", error);
    return [];
  }
}

// ============================================
// FUNCIÓN: Obtener contexto del chat
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

// ============================================
// FUNCIÓN: Guardar contexto del chat
// ============================================
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
// FUNCIÓN: Obtener respuesta de IA
// ============================================
async function getAIResponse(userId, message, fromNumber) {
  try {
    const history = await getRecentConversation(userId, fromNumber);
    const context = await getChatContext(userId, fromNumber);

    const apiUrl = `${getBaseUrl()}/api/chat-ia`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: userId,
        message,
        from_number: fromNumber,
        history,
        context,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Error /api/chat-ia:", data);
      return null;
    }

    return data.response || null;
  } catch (error) {
    console.error("Error obteniendo respuesta IA:", error);
    return null;
  }
}

// ============================================
// FUNCIÓN: Enviar mensaje por WhatsApp
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
// FUNCIÓN: Procesar disparadores por palabras clave
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
          last_topic: trigger.template || trigger.name || trigger.condition || null,
          last_trigger: trigger.name || null,
        });

        return trigger;
      }
    }

    return null;
  } catch (error) {
    console.error("Error procesando disparadores:", error);
    return null;
  }
}

// ============================================
// FUNCIÓN: Descargar multimedia y subir a Supabase Storage
// ============================================
async function downloadAndUploadMedia(mediaId, token) {
  try {
    const mediaUrlResponse = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

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
      .upload(fileName, Buffer.from(fileBuffer), { contentType: mimeType });

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
// FUNCIÓN: Detectar si mensaje debe seguir contexto
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
  ];

  return followUps.some((item) => normalized.includes(item));
}

// ============================================
// FUNCIÓN: Procesar mensaje entrante
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
      contenido = message.text?.body || "";
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

    if (type !== "text" || !contenido.trim()) return;

    // 1. Primero intentar trigger
    const triggerResult = await procesarDisparadores(userId, fromNumber, contenido);

    // 2. Si hubo trigger, ya respondió. Terminamos.
    if (triggerResult) {
      console.log(`✅ Respuesta enviada por trigger: ${triggerResult.name}`);
      return;
    }

    // 3. Si no hubo trigger, usar IA
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

    console.log(`🤖 IA activa, respondiendo a ${fromNumber}`);

    const aiResponse = await getAIResponse(userId, contenido, fromNumber);

    if (!aiResponse) {
      console.log(`⚠️ La IA no devolvió respuesta para ${fromNumber}`);
      return;
    }

    const sendResult = await sendWhatsAppMessage(userId, fromNumber, aiResponse);

    if (sendResult) {
      const existingContext = await getChatContext(userId, fromNumber);

      // Mantener el tema previo si existe, o usar el último mensaje
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
// HANDLER PRINCIPAL
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
            console.error("❌ No se encontró configuración para ese phone_number_id", configError);
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
