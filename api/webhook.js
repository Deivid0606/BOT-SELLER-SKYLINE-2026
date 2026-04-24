// api/webhook.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";

const clean = (t) => String(t || "").trim();

// ✅ Normaliza texto para comparar palabras clave: minúsculas + sin tildes
const normalize = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

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
            text: { body: parte, preview_url: false },
          }),
        }
      );
      const raw = await response.text();
      if (!response.ok) {
        console.log("📤 Meta error:", response.status, raw);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.error("❌ Error enviarMensaje:", err);
    return false;
  }
}

// ✅ Envía multimedia por la API oficial de WhatsApp Cloud (link)
async function enviarMedia(userId, to, mediaUrl, mediaType = "image", caption = "") {
  try {
    const { data: config } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (!config?.phone_number_id || !config?.permanent_token || !mediaUrl) return false;

    const type = mediaType === "video" ? "video" : "image"; // gif → image animada
    const payload = {
      messaging_product: "whatsapp",
      to,
      type,
      [type]: caption ? { link: mediaUrl, caption } : { link: mediaUrl },
    };

    const response = await fetch(
      `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.permanent_token.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.log("📤 Media error:", await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("❌ enviarMedia error:", err);
    return false;
  }
}

async function getContexto(userId, from) {
  try {
    const { data } = await supabase
      .from("chat_context")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", from)
      .maybeSingle();
    return data || {};
  } catch {
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
    await supabase.from("chat_context").upsert(payload, {
      onConflict: "user_id,from_number",
    });
  } catch (err) {
    console.error("❌ saveContexto error:", err);
  }
}

async function getHistory(userId, from) {
  try {
    const { data } = await supabase
      .from("inbox_messages")
      .select("message, created_at, message_type")
      .eq("user_id", userId)
      .eq("sender_id", from)
      .order("created_at", { ascending: false })
      .limit(14);
    return (data || [])
      .reverse()
      .map((m) => ({
        role: (m.message_type || "").startsWith("out_") ? "assistant" : "user",
        content: clean(m.message),
      }))
      .filter((m) => m.content);
  } catch {
    return [];
  }
}

async function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  try {
    const { data } = await supabase
      .from("inbox_messages")
      .select("id")
      .eq("wa_message_id", messageId)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

async function saveReceivedMessage({
  userId,
  from,
  message,
  messageType,
  mediaUrl = null,
  waMessageId = null,
}) {
  try {
    const isOutgoing = (messageType || "").startsWith("out_");
    const payload = {
      user_id: userId,
      source: "whatsapp",
      platform: "whatsapp",
      sender_id: from,
      sender_name: from,
      from_number: from,
      message,
      message_type: messageType || "text",
      media_url_text: mediaUrl,
      is_read: !!isOutgoing,
      is_processed: !!isOutgoing,
      ...(waMessageId ? { wa_message_id: waMessageId } : {}),
    };
    await supabase.from("inbox_messages").insert(payload);
  } catch (err) {
    console.error("❌ saveReceivedMessage error:", err);
  }
}

// ─────────────────────────────────────────────────────────
// ✅ NUEVO: Evaluador de disparadores
// Devuelve true si un disparador hizo match y respondió
// (en ese caso NO se debe llamar a Gemini)
// ─────────────────────────────────────────────────────────
async function evaluarDisparadores({ userId, from, texto }) {
  try {
    const { data: triggers, error } = await supabase
      .from("triggers")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);

    if (error) {
      console.log("❌ Error leyendo triggers:", error);
      return false;
    }
    if (!triggers || triggers.length === 0) return false;

    const textoNorm = normalize(texto);

    for (const trig of triggers) {
      const tipo = (trig.type || "").toLowerCase();
      const cond = normalize(trig.condition || "");
      if (!cond) continue;

      let match = false;
      if (tipo.includes("palabra") || tipo === "keyword" || tipo === "palabra clave") {
        // Match si el mensaje contiene la palabra clave
        match = textoNorm.includes(cond);
      } else if (tipo === "exact" || tipo.includes("exacto")) {
        match = textoNorm === cond;
      } else {
        // Default: contiene
        match = textoNorm.includes(cond);
      }

      if (!match) continue;
      console.log(`🎯 Disparador MATCH: "${trig.name}" (cond: "${trig.condition}")`);

      // ─── No repetir plantilla ───
      if (trig.no_repeat) {
        const { data: yaEnviado } = await supabase
          .from("inbox_messages")
          .select("id")
          .eq("user_id", userId)
          .eq("sender_id", from)
          .eq("message_type", "out_text")
          .ilike("message", `%${trig.template || trig.name}%`)
          .limit(1)
          .maybeSingle();
        if (yaEnviado) {
          console.log("⏭️ no_repeat: ya se envió antes");
          continue;
        }
      }

      // ─── Límite de envíos ───
      if (trig.send_limit && trig.send_limit !== "" && trig.send_limit !== "∞") {
        const limite = parseInt(trig.send_limit, 10);
        if (!isNaN(limite) && limite > 0) {
          const { count } = await supabase
            .from("trigger_log")
            .select("*", { count: "exact", head: true })
            .eq("trigger_id", trig.id);
          if ((count || 0) >= limite) {
            console.log("⏭️ send_limit alcanzado");
            continue;
          }
        }
      }

      // ─── Cargar plantilla asociada ───
      let plantilla = null;
      if (trig.template) {
        const { data: tpl } = await supabase
          .from("templates")
          .select("*")
          .eq("user_id", userId)
          .eq("name", trig.template)
          .maybeSingle();
        plantilla = tpl;
      }

      // Mensaje a enviar: plantilla.content o trig.response
      const mensajeFinal = clean(plantilla?.content || trig.response || "");

      // ─── Delay ───
      const delayMin = parseInt(trig.delay, 10) || 0;
      if (delayMin > 0) {
        // En serverless no podemos esperar minutos. Lo dejamos en cola si tienes tabla,
        // si no, ignoramos el delay y enviamos ahora. Recomendado: tabla scheduled_messages.
        console.log(`⏰ Delay configurado: ${delayMin} min (enviando inmediato en serverless)`);
      }

      // ─── Enviar texto ───
      if (mensajeFinal) {
        const sent = await enviarMensaje(userId, from, mensajeFinal);
        if (sent) {
          await saveReceivedMessage({
            userId,
            from,
            message: mensajeFinal,
            messageType: "out_text",
          });
        }
      }

      // ─── Enviar multimedia de la plantilla ───
      if (plantilla) {
        const medias = [];
        if (Array.isArray(plantilla.media_urls)) {
          for (const u of plantilla.media_urls) if (u) medias.push({ url: u, type: "image" });
        }
        if (plantilla.media_url) {
          medias.push({ url: plantilla.media_url, type: plantilla.media_type || "image" });
        }
        for (const m of medias) {
          await enviarMedia(userId, from, m.url, m.type);
          await saveReceivedMessage({
            userId,
            from,
            message: `[${m.type}] ${m.url}`,
            messageType: `out_${m.type}`,
            mediaUrl: m.url,
          });
        }
      }

      // ─── Etiqueta automática ───
      if (trig.auto_tag) {
        try {
          await supabase.from("contact_tags").upsert(
            {
              user_id: userId,
              contact_number: from,
              tag: trig.auto_tag,
            },
            { onConflict: "user_id,contact_number,tag" }
          );
        } catch (e) {
          console.log("⚠️ auto_tag error (tabla puede no existir):", e.message);
        }
      }

      // ─── Log del disparador (best-effort) ───
      try {
        await supabase.from("trigger_log").insert({
          trigger_id: trig.id,
          user_id: userId,
          from_number: from,
          sent_at: new Date().toISOString(),
        });
      } catch (e) {
        // tabla opcional
      }

      // ─── Incrementar usage_count de la plantilla ───
      if (plantilla?.id) {
        try {
          await supabase
            .from("templates")
            .update({ usage_count: (plantilla.usage_count || 0) + 1 })
            .eq("id", plantilla.id);
        } catch {}
      }

      // ─── Guardar contexto ───
      await saveContexto(userId, from, { last_trigger: trig.name });

      // ✅ Match procesado → cortar flujo, NO llamar a Gemini
      return true;
    }

    return false;
  } catch (err) {
    console.error("❌ evaluarDisparadores error:", err);
    return false;
  }
}

async function llamarChatIA({ req, userId, texto, from, ctx, history }) {
  const host = req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  if (!host) throw new Error("No se detectó host");

  const url = `${protocol}://${host}/api/chat-ia`;
  const resIA = await fetch(url, {
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
  const raw = await resIA.text();
  let data = {};
  try { data = JSON.parse(raw); } catch { throw new Error("chat-ia no devolvió JSON"); }
  if (!resIA.ok) throw new Error(data?.error || `chat-ia error ${resIA.status}`);
  return data;
}

async function procesar(req, message, userId, from) {
  try {
    if (message.type !== "text") return;

    const texto = clean(message.text?.body || "");
    if (!texto) return;

    console.log("━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📩 WhatsApp recibido:", from, texto);

    if (await isDuplicateMessage(message.id)) {
      console.log("⚠️ Duplicado ignorado");
      return;
    }

    await saveReceivedMessage({
      userId,
      from,
      message: texto,
      messageType: "text",
      waMessageId: message.id || null,
    });

    // ✅ 1) PRIMERO evaluar disparadores
    const disparado = await evaluarDisparadores({ userId, from, texto });
    if (disparado) {
      console.log("✅ Disparador atendió el mensaje. No se llama a Gemini.");
      return;
    }

    // ✅ 2) Si nada matcheó → Gemini
    const ctx = await getContexto(userId, from);
    const history = await getHistory(userId, from);

    let data = {};
    try {
      data = await llamarChatIA({ req, userId, texto, from, ctx, history });
    } catch (err) {
      console.error("❌ chat-ia error:", err);
      await enviarMensaje(userId, from, "⚠️ Disculpá, hubo un error momentáneo. Escribime nuevamente.");
      return;
    }

    if (data?.context) await saveContexto(userId, from, data.context);

    if (data?.response) {
      const sent = await enviarMensaje(userId, from, data.response);
      if (sent) {
        await saveReceivedMessage({
          userId, from,
          message: data.response,
          messageType: "out_text",
        });
      }
      return;
    }

    const fallback = "👋 Hola! ¿En qué puedo ayudarte hoy?\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/";
    await enviarMensaje(userId, from, fallback);
    await saveReceivedMessage({ userId, from, message: fallback, messageType: "out_text" });
  } catch (err) {
    console.error("❌ procesar error:", err);
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
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Token inválido");
  }

  if (req.method === "POST") {
    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return res.status(404).send("Not WhatsApp");

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
            console.log("❌ No user_id para phoneId:", phoneId);
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
