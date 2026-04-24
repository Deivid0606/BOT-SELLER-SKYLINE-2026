import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";

// ================= HELPERS =================
const clean = (t) => String(t || "").trim();

// ================= ENVIAR =================
async function enviarMensaje(userId, to, text) {
  const { data: config } = await supabase
    .from("whatsapp_config")
    .select("phone_number_id, permanent_token")
    .eq("user_id", userId)
    .single();

  if (!config?.phone_number_id || !config?.permanent_token) {
    console.log("❌ Sin config WhatsApp");
    return;
  }

  // dividir mensajes largos (WhatsApp corta)
  const partes = [];
  const max = 900;
  const msg = clean(text);
  for (let i = 0; i < msg.length; i += max) {
    partes.push(msg.substring(i, i + max));
  }

  for (const p of partes) {
    await fetch(
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
          text: { body: p },
        }),
      }
    );
  }
}

// ================= CONTEXTO =================
async function getContexto(userId, from) {
  const { data } = await supabase
    .from("chat_context")
    .select("*")
    .eq("user_id", userId)
    .eq("from_number", from)
    .single();

  return data || {};
}

async function saveContexto(userId, from, ctx) {
  await supabase.from("chat_context").upsert(
    {
      user_id: userId,
      from_number: from,
      ...ctx,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,from_number" }
  );
}

// ================= HISTORIAL =================
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
      content: clean(m.message).slice(0, 200),
    }));
}

// ================= MAIN =================
async function procesar(message, userId, from) {
  if (message.type !== "text") return;

  const texto = clean(message.text.body || "");
  if (!texto) return;

  console.log("📩", from, "→", texto);

  // guardar en inbox (entrada)
  await supabase.from("inbox_messages").insert({
    user_id: userId,
    source: "in",
    sender_id: from,
    message: texto,
  });

  // contexto + historial
  const ctx = await getContexto(userId, from);
  const history = await getHistory(userId, from);

  // ======== LLAMADA AL CEREBRO (chat-ia) ========
  const resIA = await fetch(`${process.env.BASE_URL}/api/chat-ia`, {
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

  const data = await resIA.json();

  if (data?.response) {
    await enviarMensaje(userId, from, data.response);

    // guardar salida en inbox
    await supabase.from("inbox_messages").insert({
      user_id: userId,
      source: "out",
      sender_id: from,
      message: data.response,
    });

    // guardar contexto actualizado si vino
    if (data.context) {
      await saveContexto(userId, from, data.context);
    }

    return;
  }

  // fallback duro
  await enviarMensaje(
    userId,
    from,
    "👋 Hola! ¿En qué puedo ayudarte hoy?"
  );
}

// ================= WEBHOOK =================
export default async function handler(req, res) {
  // verificación
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // eventos
  if (req.method === "POST") {
    try {
      const body = req.body;

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const phoneId = value?.metadata?.phone_number_id;

          const { data: config } = await supabase
            .from("whatsapp_config")
            .select("user_id")
            .eq("phone_number_id", phoneId)
            .single();

          if (!config?.user_id) continue;

          for (const msg of value.messages || []) {
            await procesar(msg, config.user_id, msg.from);
          }
        }
      }

      return res.sendStatus(200);
    } catch (e) {
      console.error("❌ webhook error:", e);
      return res.sendStatus(500);
    }
  }

  return res.sendStatus(405);
}
