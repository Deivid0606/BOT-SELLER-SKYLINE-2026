// api/webhook.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GRAPH = "https://graph.facebook.com/v21.0";

export default async function handler(req, res) {
  // ===== Verificación del webhook (GET) =====
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Buscar el token en whatsapp_config
    const { data: cfg } = await supabase
      .from("whatsapp_config")
      .select("webhook_token")
      .eq("webhook_token", token)
      .maybeSingle();

    if (mode === "subscribe" && cfg) {
      console.log("✅ Webhook verificado");
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    // Si no es un mensaje (puede ser status, etc.) → 200 OK y salir
    if (!message) {
      return res.status(200).json({ ok: true, skipped: "no message" });
    }

    const phoneNumberId = value?.metadata?.phone_number_id;
    const fromNumber = message.from;
    const waMessageId = message.id;
    const messageType = message.type; // text, image, audio, etc.

    // ===== 1) Resolver user_id desde whatsapp_config =====
    const { data: waConfig, error: waErr } = await supabase
      .from("whatsapp_config")
      .select("user_id, permanent_token, phone_number_id")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();

    if (waErr || !waConfig) {
      console.error("❌ No se encontró whatsapp_config para", phoneNumberId, waErr);
      return res.status(200).json({ ok: true, skipped: "no config" });
    }

    const userId = waConfig.user_id;
    const accessToken = waConfig.permanent_token;

    // ===== 2) Extraer texto según tipo =====
    let textIn = "";
    let mediaUrl = null;

    if (messageType === "text") {
      textIn = message.text?.body || "";
    } else if (messageType === "interactive") {
      textIn =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "";
    } else if (messageType === "button") {
      textIn = message.button?.text || "";
    } else if (messageType === "image" || messageType === "audio" || messageType === "video" || messageType === "document") {
      textIn = `[${messageType}]`;
      mediaUrl = message[messageType]?.id || null;
    } else {
      textIn = `[${messageType}]`;
    }

    // ===== 3) Idempotencia: ¿ya procesamos este wa_message_id? =====
    const { data: existing } = await supabase
      .from("inbox_messages")
      .select("id")
      .eq("wa_message_id", waMessageId)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({ ok: true, skipped: "duplicate" });
    }

    // ===== 4) Guardar mensaje entrante en inbox_messages =====
    await supabase.from("inbox_messages").insert({
      user_id: userId,
      source: "whatsapp",
      platform: "whatsapp",
      sender_id: fromNumber,
      from_number: fromNumber,
      message: textIn,
      message_type: messageType,
      wa_message_id: waMessageId,
      media_url_text: mediaUrl,
      is_read: false,
      is_processed: false,
    });

    // ===== 5) ¿Está pausada la IA para este número? =====
    const { data: convSettings } = await supabase
      .from("conversation_settings")
      .select("ai_paused, force_ai")
      .eq("phone", fromNumber)
      .maybeSingle();

    if (convSettings?.ai_paused && !convSettings?.force_ai) {
      console.log("⏸️ IA pausada para", fromNumber);
      return res.status(200).json({ ok: true, skipped: "ai paused" });
    }

    // ===== 6) ¿auto_respond activo en bot_config? =====
    const { data: botCfg } = await supabase
      .from("bot_config")
      .select("auto_respond, default_response")
      .eq("user_id", userId)
      .maybeSingle();

    if (botCfg && botCfg.auto_respond === false && !convSettings?.force_ai) {
      console.log("⏸️ auto_respond OFF para user", userId);
      return res.status(200).json({ ok: true, skipped: "auto_respond off" });
    }

    // ===== 7) Cargar contexto de la conversación =====
    const { data: ctx } = await supabase
      .from("chat_context")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", fromNumber)
      .maybeSingle();

    // ===== 8) Llamar a tu endpoint de IA (chat-ia) =====
    let replyText = botCfg?.default_response || "📋 Gracias por tu mensaje, te responderemos pronto.";

    try {
      const aiResp = await fetch(`https://${req.headers.host}/api/chat-ia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textIn,
          user_id: userId,
          from_number: fromNumber,
          context: ctx || {},
        }),
      });

      if (aiResp.ok) {
        const aiData = await aiResp.json();
        replyText = aiData.response || replyText;

        // Guardar contexto actualizado
        if (aiData.context) {
          await supabase.from("chat_context").upsert(
            {
              user_id: userId,
              from_number: fromNumber,
              ...aiData.context,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,from_number" }
          );
        }
      } else {
        console.error("⚠️ chat-ia respondió", aiResp.status);
      }
    } catch (e) {
      console.error("⚠️ Error llamando chat-ia:", e.message);
    }

    // ===== 9) Enviar respuesta a WhatsApp =====
    const sendResp = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: fromNumber,
        type: "text",
        text: { body: replyText },
      }),
    });

    const sendData = await sendResp.json();
    if (!sendResp.ok) {
      console.error("❌ Error enviando a WhatsApp:", sendData);
    }

    // ===== 10) Guardar respuesta saliente =====
    await supabase.from("inbox_messages").insert({
      user_id: userId,
      source: "whatsapp",
      platform: "whatsapp",
      sender_id: "bot",
      from_number: fromNumber,
      message: replyText,
      message_type: "text",
      wa_message_id: sendData?.messages?.[0]?.id || null,
      is_read: true,
      is_processed: true,
    });

    // Marcar el entrante como procesado
    await supabase
      .from("inbox_messages")
      .update({ is_processed: true })
      .eq("wa_message_id", waMessageId);

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("❌ webhook fatal:", error);
    // SIEMPRE devolver 200 a Meta para que no reintente infinitamente
    return res.status(200).json({ ok: false, error: error.message });
  }
}
