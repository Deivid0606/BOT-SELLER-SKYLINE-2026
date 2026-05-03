// api/waha-webhook.js — v3 FINAL
// Recibe eventos de WAHA (QR) y los procesa usando la misma lógica
// que webhook.js (Meta API), reutilizando procesar() y enviarMensaje().
//
// WAHA envía eventos con formato distinto al de Meta, así que aquí
// adaptamos el payload antes de llamar a la lógica compartida.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = (process.env.WAHA_BASE_URL || "").replace(/\/$/, "");
const WAHA_API_KEY = process.env.WAHA_API_KEY || "";

// ─────────────────────────────────────────────
// Enviar mensaje por WAHA (con session + api key)
// ─────────────────────────────────────────────
async function enviarPorWAHA(chatId, texto) {
  try {
    // WAHA requiere el formato "numero@c.us"
    const chatIdFormateado =
      chatId.includes("@c.us") || chatId.includes("@lid")
        ? chatId
        : `${chatId}@c.us`;

    // Dividir mensajes largos (mismo límite que webhook.js)
    const MAX = 3500;
    const partes = [];
    let remaining = texto;
    while (remaining.length > MAX) {
      let cut = remaining.lastIndexOf("\n\n", MAX);
      if (cut < MAX * 0.5) cut = remaining.lastIndexOf("\n", MAX);
      if (cut < MAX * 0.5) cut = remaining.lastIndexOf(". ", MAX);
      if (cut < MAX * 0.5) cut = remaining.lastIndexOf(" ", MAX);
      if (cut <= 0) cut = MAX;
      partes.push(remaining.substring(0, cut).trim());
      remaining = remaining.substring(cut).trim();
    }
    if (remaining) partes.push(remaining);

    for (const parte of partes) {
      const response = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // ✅ FIX: WAHA requiere X-Api-Key en TODOS los requests
          "X-Api-Key": WAHA_API_KEY,
        },
        body: JSON.stringify({
          // ✅ FIX: WAHA requiere el campo "session"
          session: "default",
          chatId: chatIdFormateado,
          text: parte,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`❌ WAHA sendText error [${response.status}]:`, err);
        return false;
      }
    }

    console.log(`✅ Mensaje WAHA enviado a ${chatIdFormateado}`);
    return true;
  } catch (error) {
    console.error("❌ enviarPorWAHA error:", error.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// Obtener user_id del dueño de la sesión activa
// ─────────────────────────────────────────────
async function getUserId() {
  const { data: session } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("session_name", "default")
    .eq("status", "connected")
    .maybeSingle();

  if (session?.user_id) return session.user_id;

  // Fallback: cualquier sesión existente (conectada o no)
  const { data: fallback } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("session_name", "default")
    .maybeSingle();

  return fallback?.user_id || null;
}

// ─────────────────────────────────────────────
// Guardar mensaje — usa la misma tabla que webhook.js (inbox_messages)
// para que el historial sea compartido entre ambos canales
// ─────────────────────────────────────────────
async function saveMessage({ userId, from, message, messageType = "text", mediaUrl = null }) {
  try {
    const numero = String(from).replace(/@c\.us$|@lid$/, "");
    await supabase.from("inbox_messages").insert({
      user_id: userId,
      source: "whatsapp_qr",
      platform: "whatsapp",
      sender_id: numero,       // mismo campo que usa webhook.js
      sender_name: numero,
      from_number: numero,
      message,
      message_type: messageType,
      media_url: mediaUrl || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ saveMessage error:", err.message);
  }
}

// ─────────────────────────────────────────────
// Leer/guardar contexto de conversación (igual que webhook.js)
// ─────────────────────────────────────────────
async function getContexto(userId, from) {
  const numero = String(from).replace(/@c\.us$|@lid$/, "");
  const { data } = await supabase
    .from("chat_context")       // misma tabla que webhook.js
    .select("*")
    .eq("user_id", userId)
    .eq("from_number", numero)
    .maybeSingle();
  return data || {};
}

async function saveContexto(userId, from, ctx = {}) {
  const numero = String(from).replace(/@c\.us$|@lid$/, "");
  await supabase.from("chat_context").upsert(
    {
      user_id: userId,
      from_number: numero,
      last_topic: ctx?.last_topic || null,
      last_trigger: ctx?.last_trigger || null,
      current_product: ctx?.current_product || null,
      step: ctx?.step || null,
      order_data: ctx?.order_data || {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,from_number" }
  );
}

async function getHistory(userId, from) {
  const numero = String(from).replace(/@c\.us$|@lid$/, "");
  const { data } = await supabase
    .from("inbox_messages")
    .select("message, message_type, created_at")
    .eq("user_id", userId)
    .eq("sender_id", numero)
    .order("created_at", { ascending: false })
    .limit(20);

  // ✅ chat-ia.ts espera { role: "user"|"assistant", content: string }
  return (data || [])
    .reverse()
    .filter((h) => h.message && h.message_type !== "image" && h.message_type !== "audio")
    .map((h) => ({
      role: (h.message_type || "").startsWith("out_") ? "assistant" : "user",
      content: String(h.message),
    }));
}

// ─────────────────────────────────────────────
// Evaluar disparadores (triggers) igual que webhook.js
// ─────────────────────────────────────────────
async function evaluarDisparadores({ userId, from, texto }) {
  try {
    const normalize = (t) =>
      String(t || "").trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const { data: triggers } = await supabase
      .from("triggers")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);

    if (!triggers?.length) return false;

    const textoNorm = normalize(texto);

    for (const trigger of triggers) {
      const keywords = (trigger.keywords || []).map(normalize);
      const matched = keywords.some((kw) => textoNorm.includes(kw));
      if (!matched) continue;

      console.log(`🎯 Trigger "${trigger.name}" activado`);

      // Enviar respuesta del trigger
      if (trigger.response_text) {
        await enviarPorWAHA(from, trigger.response_text);
        await saveMessage({ userId, from, message: trigger.response_text, messageType: "out_text" });
      }

      // Enviar imagen del trigger si tiene
      if (trigger.media_url) {
        await enviarImagenWAHA(from, trigger.media_url, trigger.media_caption || "");
      }

      return true;
    }
    return false;
  } catch (err) {
    console.error("❌ evaluarDisparadores error:", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// Enviar imagen por WAHA
// ─────────────────────────────────────────────
async function enviarImagenWAHA(chatId, imageUrl, caption = "") {
  try {
    const chatIdFormateado = chatId.includes("@") ? chatId : `${chatId}@c.us`;
    await fetch(`${WAHA_BASE_URL}/api/sendImage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": WAHA_API_KEY,
      },
      body: JSON.stringify({
        session: "default",
        chatId: chatIdFormateado,
        file: { url: imageUrl },
        caption,
      }),
    });
  } catch (err) {
    console.error("❌ enviarImagenWAHA error:", err.message);
  }
}

// ─────────────────────────────────────────────
// Llamar a chat-ia con el contexto completo
// ─────────────────────────────────────────────
async function llamarChatIA({ host, userId, from, texto, ctx, history, mediaUrl = null, mediaType = null }) {
  const chatIaUrl = `https://${host}/api/chat-ia`;

  const body = {
    user_id: userId,
    from_number: from.replace(/@c\.us$|@lid$/, ""),
    message: texto,
    context: ctx,
    history,
  };

  if (mediaUrl) {
    body.media_url = mediaUrl;
    body.media_type = mediaType;
  }

  const response = await fetch(chatIaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`chat-ia error ${response.status}: ${err}`);
  }

  return await response.json();
}

// ─────────────────────────────────────────────
// Procesar mensaje entrante completo
// ─────────────────────────────────────────────
async function procesarMensaje({ host, userId, from, texto, mediaUrl = null, mediaType = null }) {
  const numero = from.replace(/@c\.us$|@lid$/, "");

  // 1. Guardar mensaje entrante
  await saveMessage({
    userId,
    from: numero,
    message: texto || (mediaType ? `[${mediaType}]` : ""),
    messageType: mediaType || "text",
  });

  // 2. Evaluar triggers (solo para texto)
  if (!mediaUrl && texto) {
    const disparado = await evaluarDisparadores({ userId, from, texto });
    if (disparado) {
      console.log("✅ Trigger manejó el mensaje.");
      return;
    }
  }

  // 3. Obtener contexto e historial
  const ctx = await getContexto(userId, numero);
  const history = await getHistory(userId, numero);

  // 4. Llamar a chat-ia
  let data = {};
  try {
    data = await llamarChatIA({ host, userId, from, texto, ctx, history, mediaUrl, mediaType });
  } catch (err) {
    console.error("❌ chat-ia error:", err.message);
    const fallback = "⚠️ Disculpá, hubo un error momentáneo. Escribime nuevamente.";
    await enviarPorWAHA(from, fallback);
    await saveMessage({ userId, from: numero, message: fallback, messageType: "out_text" });
    return;
  }

  // 5. Guardar contexto actualizado
  if (data?.context) await saveContexto(userId, numero, data.context);

  // 6. Enviar respuesta
  const respuesta = data?.response;
  if (respuesta) {
    await enviarPorWAHA(from, respuesta);
    await saveMessage({ userId, from: numero, message: respuesta, messageType: "out_text" });
    console.log(`💬 Respondido a ${numero}: "${respuesta.slice(0, 80)}..."`);
  } else {
    console.log("⚠️ chat-ia no generó respuesta:", data);
  }
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  // Responder a WAHA inmediatamente (evita retries por timeout)
  res.status(200).send("OK");

  try {
    const body = req.body;
    const event = body?.event;
    const payload = body?.payload || {};

    console.log(`📡 WAHA evento: ${event}`, JSON.stringify(payload).slice(0, 200));

    // ── Actualizar estado de sesión en Supabase ──
    if (event === "session.status") {
      const wahaStatus = payload.status;
      const statusMap = {
        STARTING: "starting",
        SCAN_QR_CODE: "pending_qr",
        WORKING: "connected",
        STOPPED: "disconnected",
        FAILED: "failed",
      };
      const dbStatus = statusMap[wahaStatus] || "disconnected";

      await supabase
        .from("whatsapp_qr_sessions")
        .update({ status: dbStatus, last_event_at: new Date().toISOString() })
        .eq("session_name", "default");

      console.log(`📊 Sesión WAHA: ${wahaStatus} → ${dbStatus}`);
      return;
    }

    // ── Procesar mensajes entrantes ──
    if (event === "message" || event === "message.any") {
      // Ignorar mensajes propios
      if (payload.fromMe) {
        console.log("📌 Mensaje propio, ignorado.");
        return;
      }

      const from = payload.from || "";
      const texto = payload.body || "";
      const host = req.headers.host || "bot-seller-skyline-2026.vercel.app";

      if (!from) {
        console.log("⚠️ Mensaje sin 'from', ignorado.");
        return;
      }


      // Ignorar mensajes ACK/notificaciones sin cuerpo ni media
      const hasText = texto && texto.trim().length > 0;
      const hasMedia = payload.hasMedia && payload.media?.url;
      if (!hasText && !hasMedia) {
        console.log(`📌 Sin contenido (tipo: ${payload.type || "unknown"}), ignorado.`);
        return;
      }
      // Obtener user_id del dueño de la sesión
      const userId = await getUserId();
      if (!userId) {
        console.error("❌ No se encontró user_id para la sesión WAHA.");
        return;
      }

      console.log(`📨 WAHA: ${from.replace(/@c\.us$/, "")} → "${texto.slice(0, 80)}"`);

      // Detectar tipo de mensaje
      const tipoMsg = payload.type || "text";
      let mediaUrl = null;
      let mediaType = null;

      if (tipoMsg === "image" && payload.media?.url) {
        mediaUrl = payload.media.url;
        mediaType = "image";
      } else if (tipoMsg === "audio" && payload.media?.url) {
        mediaUrl = payload.media.url;
        mediaType = "audio";
      } else if (tipoMsg === "video" && payload.media?.url) {
        mediaUrl = payload.media.url;
        mediaType = "video";
      }

      // Procesar en background (ya respondimos 200 a WAHA)
      procesarMensaje({ host, userId, from, texto, mediaUrl, mediaType }).catch((err) =>
        console.error("❌ procesarMensaje background error:", err.message)
      );

      return;
    }

    console.log(`ℹ️ Evento WAHA no manejado: ${event}`);
  } catch (err) {
    console.error("❌ waha-webhook handler error:", err.message);
  }
}
