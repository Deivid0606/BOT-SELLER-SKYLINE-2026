// api/waha-webhook.js
// Webhook de WAHA → traduce payload al formato Meta y reusa procesar() de webhook.js
// AHORA CON ENVÍO DE RESPUESTAS INCLUIDO ✅

import { createClient } from "@supabase/supabase-js";
import { procesar } from "./webhook.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || "http://localhost:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY;

// ✅ NUEVA FUNCIÓN: Enviar mensaje por WAHA
async function enviarPorWAHA(chatId, texto) {
  try {
    // WAHA espera chatId con @c.us o @lid
    let chatIdFormateado = chatId;
    if (!chatId.includes("@c.us") && !chatId.includes("@lid")) {
      chatIdFormateado = `${chatId}@c.us`;
    }

    const url = `${WAHA_BASE_URL}/api/sendText`;
    const payload = {
      chatId: chatIdFormateado,
      text: texto,
    };

    console.log(`📤 Enviando a WAHA: ${url}`, { chatId: chatIdFormateado, textoLength: texto.length });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(WAHA_API_KEY && { "X-Api-Key": WAHA_API_KEY }),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`WAHA error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(`✅ Mensaje enviado por WAHA: ${data.id || "ok"}`);
    return data;
  } catch (error) {
    console.error(`❌ Error enviando por WAHA a ${chatId}:`, error);
    throw error;
  }
}

// ✅ NUEVA FUNCIÓN: Enviar imagen por WAHA (para comprobantes)
async function enviarImagenPorWAHA(chatId, imageUrl, caption = "") {
  try {
    let chatIdFormateado = chatId;
    if (!chatId.includes("@c.us") && !chatId.includes("@lid")) {
      chatIdFormateado = `${chatId}@c.us`;
    }

    const url = `${WAHA_BASE_URL}/api/sendImage`;
    const payload = {
      chatId: chatIdFormateado,
      image: imageUrl,
      caption: caption,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(WAHA_API_KEY && { "X-Api-Key": WAHA_API_KEY }),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`WAHA image error ${response.status}`);
    }

    console.log(`✅ Imagen enviada por WAHA a ${chatIdFormateado}`);
    return await response.json();
  } catch (error) {
    console.error(`❌ Error enviando imagen a ${chatId}:`, error);
    throw error;
  }
}

// Convierte un msg de WAHA al formato esperado por procesar() (formato Meta)
function wahaToMeta(wahaMsg) {
  // wahaMsg.from = "595981XXXXXX@c.us" → "595981XXXXXX"
  const fromRaw = wahaMsg.from || "";
  const from = fromRaw.replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "");

  const base = {
    id: wahaMsg.id,
    from,
    timestamp: String(wahaMsg.timestamp || Math.floor(Date.now() / 1000)),
  };

  const hasMedia = !!wahaMsg.hasMedia || !!wahaMsg.media;
  const mediaUrl = wahaMsg.media?.url || null;
  const mimeType = wahaMsg.media?.mimetype || wahaMsg.mediaMimeType || null;
  const caption = wahaMsg.caption || wahaMsg.body || "";

  // Detectar tipo
  if (!hasMedia) {
    return { ...base, type: "text", text: { body: wahaMsg.body || "" } };
  }

  if (mimeType?.startsWith("image/")) {
    return {
      ...base,
      type: "image",
      image: { id: wahaMsg.id, mime_type: mimeType, caption, _waha_url: mediaUrl },
    };
  }
  if (mimeType?.startsWith("audio/")) {
    return {
      ...base,
      type: "audio",
      audio: { id: wahaMsg.id, mime_type: mimeType, _waha_url: mediaUrl },
    };
  }
  if (mimeType?.startsWith("video/")) {
    return {
      ...base,
      type: "video",
      video: { id: wahaMsg.id, mime_type: mimeType, caption, _waha_url: mediaUrl },
    };
  }
  return {
    ...base,
    type: "document",
    document: {
      id: wahaMsg.id,
      mime_type: mimeType || "application/octet-stream",
      filename: wahaMsg.media?.filename || "archivo",
      caption,
      _waha_url: mediaUrl,
    },
  };
}

// ✅ NUEVA FUNCIÓN: Procesar y responder (captura la respuesta)
async function procesarYResponder(fakeReq, metaMsg, userId, fromNumber) {
  try {
    // Llamar al procesador original (webhook.js)
    const respuesta = await procesar(fakeReq, metaMsg, userId, fromNumber);
    
    // 🔥 CRÍTICO: procesar() debe devolver la respuesta generada
    // Si no devuelve nada, necesitamos interceptar la respuesta
    if (respuesta && respuesta.response) {
      console.log(`💬 Respuesta generada para ${fromNumber}: ${respuesta.response.slice(0, 100)}...`);
      
      // Enviar respuesta por WAHA
      await enviarPorWAHA(fromNumber, respuesta.response);
      
      // Si hay imagen de comprobante, enviarla también
      if (respuesta.is_payment_proof && respuesta.image_url) {
        await enviarImagenPorWAHA(fromNumber, respuesta.image_url, "Comprobante recibido ✅");
      }
      
      return respuesta;
    }
    
    console.warn(`⚠️ No se generó respuesta para ${fromNumber}`);
    return null;
  } catch (error) {
    console.error(`❌ Error procesando mensaje de ${fromNumber}:`, error);
    throw error;
  }
}

async function getUserIdBySession(sessionName) {
  const { data } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("session_name", sessionName)
    .maybeSingle();
  return data?.user_id || null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Validar API key (WAHA puede mandarla como header)
  const apiKey = req.headers["x-api-key"] || req.headers["x-webhook-key"];
  if (WAHA_API_KEY && apiKey && apiKey !== WAHA_API_KEY) {
    console.log("❌ WAHA webhook: API key inválida");
    return res.status(401).send("Unauthorized");
  }

  try {
    const body = req.body;
    const event = body?.event;
    const sessionName = body?.session;
    const payload = body?.payload || {};

    console.log(`📡 WAHA event: ${event} | session: ${sessionName}`);

    if (!sessionName) return res.status(400).send("Missing session");

    const userId = await getUserIdBySession(sessionName);
    if (!userId) {
      console.log(`⚠️ WAHA: sesión ${sessionName} no asociada a ningún usuario`);
      return res.status(200).send("OK (no user)");
    }

    // ─── EVENTO: cambio de estado de sesión ───
    if (event === "session.status") {
      const wahaStatus = payload.status; // STARTING | SCAN_QR_CODE | WORKING | FAILED | STOPPED
      let dbStatus = "disconnected";
      if (wahaStatus === "STARTING") dbStatus = "starting";
      else if (wahaStatus === "SCAN_QR_CODE") dbStatus = "pending_qr";
      else if (wahaStatus === "WORKING") dbStatus = "connected";
      else if (wahaStatus === "FAILED") dbStatus = "failed";
      else if (wahaStatus === "STOPPED") dbStatus = "disconnected";

      const update = {
        status: dbStatus,
        last_event_at: new Date().toISOString(),
      };
      if (dbStatus === "connected") {
        update.connected_at = new Date().toISOString();
        update.connected_phone = payload.me?.id?.replace(/@c\.us$/, "") || null;
        update.last_qr = null;
      }
      if (dbStatus === "disconnected" || dbStatus === "failed") {
        update.last_qr = null;
        update.connected_phone = null;
      }
      await supabase
        .from("whatsapp_qr_sessions")
        .update(update)
        .eq("session_name", sessionName);

      console.log(`✅ Sesión ${sessionName} ahora está: ${dbStatus}`);
      return res.status(200).send("OK");
    }

    // ─── EVENTO: mensaje entrante (AHORA CON RESPUESTA) ───
    if (event === "message" || event === "message.any") {
      // Ignorar mensajes propios (fromMe)
      if (payload.fromMe) {
        console.log(`📌 Ignorando mensaje propio de ${payload.from}`);
        return res.status(200).send("OK (fromMe)");
      }

      console.log(`📨 Procesando mensaje de ${payload.from}: ${payload.body?.slice(0, 100) || "(media)"}`);

      const metaMsg = wahaToMeta(payload);

      // Inyectar req mínimo para que procesar() pueda llamar a chat-ia
      const fakeReq = {
        headers: {
          host: req.headers.host,
          "x-forwarded-proto": req.headers["x-forwarded-proto"] || "https",
        },
      };

      // ✅ AHORA SÍ: Procesar Y ENVIAR RESPUESTA
      await procesarYResponder(fakeReq, metaMsg, userId, metaMsg.from);
      
      return res.status(200).send("OK");
    }

    // Otros eventos: ignorar silenciosamente
    return res.status(200).send("OK (ignored)");
  } catch (err) {
    console.error("❌ waha-webhook error:", err);
    return res.status(500).json({ error: "Error interno" });
  }
}
