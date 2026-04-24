import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";
const BASE_URL = process.env.BASE_URL || "https://bot-seller-skyline-2026.vercel.app";

const clean = (t) => String(t || "").trim();

async function enviarMensaje(userId, to, text) {
  const { data: config, error } = await supabase
    .from("whatsapp_config")
    .select("phone_number_id, permanent_token")
    .eq("user_id", userId)
    .single();

  if (error || !config?.phone_number_id || !config?.permanent_token) {
    console.log("❌ Sin config WhatsApp:", error);
    return false;
  }

  const partes = [];
  const msg = clean(text);
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
}

async function getContexto(userId, from) {
  const { data } = await supabase
    .from("chat_context")
    .select("*")
    .eq("user_id", userId)
    .eq("from_number", from)
    .maybeSingle();

  return data || {};
}

async function saveContexto(userId, from, ctx) {
  const { error } = await supabase.from("chat_context").upsert(
    {
      user_id: userId,
      from_number: from,
      last_topic: ctx?.last_topic || null,
      last_trigger: ctx?.last_trigger || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,from_number" }
  );

  if (error) console.log("❌ Error guardando contexto:", error);
}

async function getHistory(userId, from) {
  const { data } = await supabase
    .from("inbox_messages")
    .select("message, created_at, source")
    .eq("user_id", userId)
    .eq("sender_id", from)
    .order("created_at", { ascending: false })
    .limit(12);

  return (data || [])
    .reverse()
    .map((m) => ({
      role: m.source === "out" ? "assistant" : "user",
      content: clean(m.message).slice(0, 500),
    }));
}

async function procesar(message, userId, from) {
  if (message.type !== "text") return;

  const texto = clean(message.text?.body || "");
  if (!texto) return;

  console.log("━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📩 WhatsApp recibido:", from, texto);

  await supabase.from("inbox_messages").insert({
    user_id: userId,
    source: "in",
    sender_id: from,
    message: texto,
  });

  const ctx = await getContexto(userId, from);
  const history = await getHistory(userId, from);

  console.log("BASE_URL:", BASE_URL);
  console.log("📡 Llamando chat-ia con:", texto);

  const resIA = await fetch(`${BASE_URL}/api/chat-ia`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId,
      message: texto,
      from_number: from,
      context: ctx,
      history,
    }),
  });

  const rawIA = await resIA.text();

  console.log("🧠 chat-ia status:", resIA.status);
  console.log("🧠 chat-ia raw:", rawIA);

  let data = {};
  try {
    data = JSON.parse(rawIA);
  } catch {
    console.log("❌ chat-ia no devolvió JSON válido");
  }

  if (data?.response) {
    const sent = await enviarMensaje(userId, from, data.response);

    if (sent) {
      await supabase.from("inbox_messages").insert({
        user_id: userId,
        source: "out",
        sender_id: from,
        message: data.response,
      });
    }

    if (data.context) {
      await saveContexto(userId, from, data.context);
    }

    return;
  }

  const fallback = "👋 Hola! ¿En qué puedo ayudarte hoy?";
  await enviarMensaje(userId, from, fallback);

  await supabase.from("inbox_messages").insert({
    user_id: userId,
    source: "out",
    sender_id: from,
    message: fallback,
  });
}

export default async function handler(req, res) {
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

      console.log("📥 WEBHOOK BODY:", JSON.stringify(body).slice(0, 2000));

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
            .single();

          if (error || !config?.user_id) {
            console.log("❌ No encontré user_id para phoneId:", phoneId, error);
            continue;
          }

          for (const msg of value.messages || []) {
            await procesar(msg, config.user_id, msg.from);
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
