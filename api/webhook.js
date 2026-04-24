import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";

const clean = (t) => String(t || "").trim();

async function enviarMensaje(userId, to, text) {
  try {
    const { data: config, error } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !config?.phone_number_id || !config?.permanent_token) {
      console.log("❌ Sin config WhatsApp:", error);
      return false;
    }

    const msg = clean(text);
    if (!msg) return false;

    const partes = [];
    const max = 900;

    for (let i = 0; i < msg.length; i += max) {
      partes.push(msg.substring(i, i + max));
    }

    for (const parte of partes) {
      const response = await fetch(
        `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.permanent_token.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "text",
            text: { body: parte },
          }),
        }
      );

      const raw = await response.text();
      console.log("📤 Meta status:", response.status);
      console.log("📤 Meta response:", raw);

      if (!response.ok) return false;
    }

    return true;
  } catch (err) {
    console.error("❌ Error enviarMensaje:", err);
    return false;
  }
}

async function getContexto(userId, from) {
  try {
    const { data, error } = await supabase
      .from("chat_context")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", from)
      .maybeSingle();

    if (error) {
      console.log("❌ Error leyendo contexto:", error);
      return {};
    }

    return data || {};
  } catch (err) {
    console.error("❌ getContexto error:", err);
    return {};
  }
}

async function saveContexto(userId, from, ctx = {}) {
  try {
    const payload = {
      user_id: userId,
      from_number: from,
      last_topic: ctx?.last_topic || null,
      last_trigger: ctx?.last_trigger || null,
      current_product: ctx?.current_product || null,
      step: ctx?.step || null,
      order_data: ctx?.order_data || {},
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("chat_context").upsert(payload, {
      onConflict: "user_id,from_number",
    });

    if (error) console.log("❌ Error guardando contexto:", error);
    else console.log("✅ Contexto guardado");
  } catch (err) {
    console.error("❌ saveContexto error:", err);
  }
}

async function getHistory(userId, from) {
  try {
    const { data, error } = await supabase
      .from("inbox_messages")
      .select("message, created_at, source")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .order("created_at", { ascending: false })
      .limit(14);

    if (error) {
      console.log("❌ Error leyendo historial:", error);
      return [];
    }

    return (data || [])
      .reverse()
      .map((m) => ({
        role: m.source === "out" ? "assistant" : "user",
        content: clean(m.message).slice(0, 500),
      }))
      .filter((m) => m.content);
  } catch (err) {
    console.error("❌ getHistory error:", err);
    return [];
  }
}

async function isDuplicateMessage(messageId) {
  if (!messageId) return false;

  try {
    const { data, error } = await supabase
      .from("inbox_messages")
      .select("id")
      .eq("wa_message_id", messageId)
      .maybeSingle();

    if (error) {
      console.log("⚠️ No se pudo verificar duplicado:", error);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error("❌ isDuplicateMessage error:", err);
    return false;
  }
}

async function saveInboxMessage({
  userId,
  source,
  from,
  message,
  waMessageId = null,
}) {
  try {
    const payload = {
      user_id: userId,
      source,
      sender_id: from,
      message,
      ...(waMessageId ? { wa_message_id: waMessageId } : {}),
    };

    const { error } = await supabase.from("inbox_messages").insert(payload);

    if (error) {
      console.log("❌ Error guardando inbox:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("❌ saveInboxMessage error:", err);
    return false;
  }
}

async function llamarChatIA({ req, userId, texto, from, ctx, history }) {
  const host = req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";

  if (!host) {
    throw new Error("No se detectó host para construir URL");
  }

  const url = `${protocol}://${host}/api/chat-ia`;

  console.log("🌐 URL CHAT-IA FINAL:", url);
  console.log("📡 Llamando chat-ia con:", texto);

  const resIA = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      message: texto,
      from_number: from,
      context: ctx || {},
      history: history || [],
    }),
  });

  const raw = await resIA.text();

  console.log("🧠 chat-ia status:", resIA.status);
  console.log("🧠 chat-ia raw:", raw);

  let data = {};

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("chat-ia no devolvió JSON válido");
  }

  if (!resIA.ok) {
    throw new Error(data?.error || `chat-ia error ${resIA.status}`);
  }

  return data;
}

async function procesar(req, message, userId, from) {
  try {
    if (message.type !== "text") {
      console.log("⚠️ Mensaje no texto ignorado:", message.type);
      return;
    }

    const texto = clean(message.text?.body || "");
    if (!texto) return;

    console.log("━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📩 WhatsApp recibido:", from, texto);
    console.log("🆔 WA message id:", message.id || "sin id");

    if (await isDuplicateMessage(message.id)) {
      console.log("⚠️ Mensaje duplicado ignorado:", message.id);
      return;
    }

    await saveInboxMessage({
      userId,
      source: "in",
      from,
      message: texto,
      waMessageId: message.id || null,
    });

    const ctx = await getContexto(userId, from);
    const history = await getHistory(userId, from);

    let data = {};

    try {
      data = await llamarChatIA({
        req,
        userId,
        texto,
        from,
        ctx,
        history,
      });
    } catch (err) {
      console.error("❌ Error llamando chat-ia:", err);

      await enviarMensaje(
        userId,
        from,
        "⚠️ Disculpá, hubo un error momentáneo. Escribime nuevamente por favor."
      );

      return;
    }

    if (data?.context) {
      await saveContexto(userId, from, data.context);
    }

    if (data?.response) {
      const sent = await enviarMensaje(userId, from, data.response);

      if (sent) {
        await saveInboxMessage({
          userId,
          source: "out",
          from,
          message: data.response,
        });
      }

      return;
    }

    const fallback =
      "👋 Hola! ¿En qué puedo ayudarte hoy?\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/";

    await enviarMensaje(userId, from, fallback);

    await saveInboxMessage({
      userId,
      source: "out",
      from,
      message: fallback,
    });
  } catch (err) {
    console.error("❌ procesar error:", err);

    await enviarMensaje(
      userId,
      from,
      "⚠️ Disculpá, hubo un error procesando tu mensaje. Escribime nuevamente por favor."
    );
  }
}

export default async function handler(req, res) {
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
      console.log("✅ Webhook verificado");
      return res.status(200).send(challenge);
    }

    return res.status(403).send("Token inválido");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;

      console.log("📥 WEBHOOK BODY:", JSON.stringify(body).slice(0, 2500));

      if (body.object !== "whatsapp_business_account") {
        return res.status(404).send("Not WhatsApp");
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const phoneId = value?.metadata?.phone_number_id;

          if (!phoneId) {
            console.log("⚠️ Sin phone_number_id");
            continue;
          }

          const { data: config, error } = await supabase
            .from("whatsapp_config")
            .select("user_id")
            .eq("phone_number_id", phoneId)
            .maybeSingle();

          if (error || !config?.user_id) {
            console.log("❌ No encontré user_id para phoneId:", phoneId, error);
            continue;
          }

          for (const msg of value.messages || []) {
            await procesar(req, msg, config.user_id, msg.from);
          }
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    } catch (e) {
      console.error("❌ webhook error:", e);
      return res.status(500).json({ error: "Error interno" });
    }
  }

  return res.status(405).send("Method Not Allowed");
}
