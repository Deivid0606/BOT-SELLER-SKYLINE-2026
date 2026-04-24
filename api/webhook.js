import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";
const clean = (t) => String(t || "").trim();

function splitMessage(text, max = 3500) {
  const msg = clean(text);
  if (msg.length <= max) return [msg];
  const parts = [];
  let remaining = msg;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf(". ", max);
    if (cut < max * 0.5) cut = remaining.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    parts.push(remaining.substring(0, cut).trim());
    remaining = remaining.substring(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts.filter((p) => p.length > 0);
}

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

    const partes = splitMessage(msg, 3500);
    console.log(`📤 Enviando ${partes.length} parte(s)`);

    for (const parte of partes) {
      const r = await fetch(
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
            text: { body: parte, preview_url: false },
          }),
        }
      );
      const raw = await r.text();
      console.log("📤 Meta status:", r.status);
      if (!r.ok) {
        console.log("📤 Meta resp:", raw);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error("❌ enviarMensaje:", err);
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
    if (error) console.log("❌ getContexto:", error);
    return data || {};
  } catch (err) {
    console.error("❌ getContexto:", err);
    return {};
  }
}

async function saveContexto(userId, from, ctx = {}) {
  try {
    const { error } = await supabase.from("chat_context").upsert(
      {
        user_id: userId,
        from_number: from,
        last_topic: ctx?.last_topic || null,
        last_trigger: ctx?.last_trigger || null,
        current_product: ctx?.current_product || null,
        step: ctx?.step || null,
        order_data: ctx?.order_data || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,from_number" }
    );
    if (error) console.log("❌ saveContexto:", error);
  } catch (err) {
    console.error("❌ saveContexto:", err);
  }
}

// ✅ Lee historial desde inbox_messages
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
      console.log("❌ getHistory:", error);
      return [];
    }

    return (data || [])
      .reverse()
      .map((m) => ({
        role: m.source === "out" ? "assistant" : "user",
        content: clean(m.message),
      }))
      .filter((m) => m.content);
  } catch (err) {
    console.error("❌ getHistory:", err);
    return [];
  }
}

// ✅ Guarda en inbox_messages (la tabla real)
async function saveInboxMessage({
  userId,
  from,
  message,
  source, // "in" | "out"
  mediaUrl = null,
}) {
  try {
    const payload = {
      user_id: userId,
      source,
      sender_id: from,
      message: message || null,
      media_url: mediaUrl ? [mediaUrl] : null,
      is_read: source === "out" ? true : false,
    };

    const { error } = await supabase.from("inbox_messages").insert(payload);
    if (error) console.log("❌ saveInboxMessage:", error);
    return !error;
  } catch (err) {
    console.error("❌ saveInboxMessage:", err);
    return false;
  }
}

async function llamarChatIA({ req, userId, texto, from, ctx, history }) {
  const host = req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  if (!host) throw new Error("No host");

  const url = `${protocol}://${host}/api/chat-ia`;
  console.log("🌐 chat-ia URL:", url);

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      message: texto,
      from_number: from,
      context: ctx || {},
      history: history || [],
    }),
  });

  const raw = await r.text();
  console.log("🧠 chat-ia status:", r.status, "len:", raw.length);

  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("chat-ia no devolvió JSON");
  }
  if (!r.ok) throw new Error(data?.error || `chat-ia error ${r.status}`);
  return data;
}

async function procesar(req, message, userId, from) {
  try {
    if (message.type !== "text") return;
    const texto = clean(message.text?.body || "");
    if (!texto) return;

    console.log("━━━━━━━━━━━━━━");
    console.log("📩 IN:", from, texto);

    // Guardar entrante
    await saveInboxMessage({ userId, from, message: texto, source: "in" });

    const ctx = await getContexto(userId, from);
    const history = await getHistory(userId, from);

    let data = {};
    try {
      data = await llamarChatIA({ req, userId, texto, from, ctx, history });
    } catch (err) {
      console.error("❌ chat-ia:", err);
      const errMsg =
        "⚠️ Disculpá, hubo un error momentáneo. Escribime nuevamente por favor.";
      await enviarMensaje(userId, from, errMsg);
      await saveInboxMessage({ userId, from, message: errMsg, source: "out" });
      return;
    }

    if (data?.context) await saveContexto(userId, from, data.context);

    if (data?.response) {
      const sent = await enviarMensaje(userId, from, data.response);
      if (sent) {
        await saveInboxMessage({
          userId,
          from,
          message: data.response,
          source: "out",
        });
      }
      return;
    }

    const fallback =
      "👋 Hola! ¿En qué puedo ayudarte?\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/";
    await enviarMensaje(userId, from, fallback);
    await saveInboxMessage({ userId, from, message: fallback, source: "out" });
  } catch (err) {
    console.error("❌ procesar:", err);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

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
      console.log("📥 BODY:", JSON.stringify(body).slice(0, 1500));

      if (body.object !== "whatsapp_business_account") {
        return res.status(404).send("Not WhatsApp");
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const phoneId = value?.metadata?.phone_number_id;
          if (!phoneId) continue;

          const { data: config, error } = await supabase
            .from("whatsapp_config")
            .select("user_id")
            .eq("phone_number_id", phoneId)
            .maybeSingle();

          if (error || !config?.user_id) {
            console.log("❌ Sin user_id para phoneId:", phoneId);
            continue;
          }

          for (const msg of value.messages || []) {
            await procesar(req, msg, config.user_id, msg.from);
          }
        }
      }

      return res.status(200).send("EVENT_RECEIVED");
    } catch (e) {
      console.error("❌ webhook:", e);
      return res.status(500).json({ error: "Error interno" });
    }
  }

  return res.status(405).send("Method Not Allowed");
}
