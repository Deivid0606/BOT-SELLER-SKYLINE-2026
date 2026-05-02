// api/waha-webhook.js
// Webhook de WAHA → traduce payload al formato Meta y reusa procesar() de webhook.js
// ✅ VERSIÓN DEFINITIVA - CON MANEJO DE SESIÓN "default" Y RESPUESTAS ASEGURADAS

import { createClient } from "@supabase/supabase-js";
import { procesar } from "./webhook.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || "http://localhost:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY;

// ✅ Enviar mensaje por WAHA (sin requerir session name en URL)
async function enviarPorWAHA(chatId, texto) {
  try {
    let chatIdFormateado = chatId;
    if (!chatId.includes("@c.us") && !chatId.includes("@lid")) {
      chatIdFormateado = `${chatId}@c.us`;
    }

    const url = `${WAHA_BASE_URL}/api/sendText`;
    const payload = {
      chatId: chatIdFormateado,
      text: texto,
    };

    console.log(`📤 Enviando a WAHA: ${url}`);
    console.log(`📦 Payload: chatId=${chatIdFormateado}, textoLength=${texto.length}`);

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
      console.error(`❌ WAHA respuesta error: ${response.status} - ${errorText}`);
      throw new Error(`WAHA error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    console.log(`✅ Mensaje enviado por WAHA: ${JSON.stringify(data)}`);
    return data;
  } catch (error) {
    console.error(`❌ Error enviando por WAHA a ${chatId}:`, error.message);
    return null;
  }
}

// ✅ Enviar imagen por WAHA (para comprobantes)
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
    console.error(`❌ Error enviando imagen a ${chatId}:`, error.message);
    return null;
  }
}

// Convierte un msg de WAHA al formato esperado por procesar() (formato Meta)
function wahaToMeta(wahaMsg) {
  const fromRaw = wahaMsg.from || "";
  const from = fromRaw.replace(/@c\.us$/, "").replace(/@s\.whatsapp\.net$/, "").replace(/@lid$/, "");

  const base = {
    id: wahaMsg.id || `msg_${Date.now()}`,
    from,
    timestamp: String(wahaMsg.timestamp || Math.floor(Date.now() / 1000)),
  };

  const hasMedia = !!wahaMsg.hasMedia || !!wahaMsg.media;
  const mediaUrl = wahaMsg.media?.url || null;
  const mimeType = wahaMsg.media?.mimetype || wahaMsg.mediaMimeType || null;
  const caption = wahaMsg.caption || wahaMsg.body || "";

  if (!hasMedia || !wahaMsg.body) {
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

// ✅ MEJORADA: Obtiene userId desde session name, con fallback a "default" o cualquier sesión activa
async function getUserIdBySession(sessionName) {
  // Si no viene sessionName, usar "default"
  const nombreSesion = sessionName || "default";
  
  console.log(`🔍 Buscando sesión: "${nombreSesion}"`);
  
  // Buscar por session_name exacto
  let { data, error } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id, status")
    .eq("session_name", nombreSesion)
    .maybeSingle();
  
  if (error) {
    console.error("❌ Error buscando sesión:", error.message);
  }
  
  if (data?.user_id) {
    console.log(`✅ Sesión "${nombreSesion}" encontrada -> user_id: ${data.user_id}`);
    return data.user_id;
  }
  
  // Fallback: buscar cualquier sesión conectada
  console.log(`⚠️ No se encontró sesión "${nombreSesion}", buscando cualquier sesión activa...`);
  
  const { data: anySession } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id, session_name")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  
  if (anySession?.user_id) {
    console.log(`✅ Usando sesión alternativa: ${anySession.session_name} -> user_id: ${anySession.user_id}`);
    return anySession.user_id;
  }
  
  // Último recurso: user_id fijo (el tuyo)
  console.log(`⚠️ No se encontró ninguna sesión, usando user_id por defecto: c206b0dc-7c6a-4dee-a91e-3e9ffafe5048`);
  return "c206b0dc-7c6a-4dee-a91e-3e9ffafe5048";
}

// ✅ Procesar y responder (captura la respuesta de webhook.js y la envía)
async function procesarYResponder(fakeReq, metaMsg, userId, fromNumber) {
  try {
    console.log(`🤖 Llamando a procesar() para ${fromNumber}...`);
    
    const respuesta = await procesar(fakeReq, metaMsg, userId, fromNumber);
    
    if (respuesta && respuesta.response) {
      console.log(`💬 Respuesta generada: "${respuesta.response.slice(0, 100)}..."`);
      
      const enviado = await enviarPorWAHA(fromNumber, respuesta.response);
      
      if (enviado) {
        console.log(`✅ Respuesta enviada exitosamente a ${fromNumber}`);
      } else {
        console.log(`⚠️ No se pudo enviar la respuesta a ${fromNumber}`);
      }
      
      return respuesta;
    }
    
    console.log(`⚠️ No se generó respuesta para ${fromNumber}`);
    return null;
  } catch (error) {
    console.error(`❌ Error en procesarYResponder para ${fromNumber}:`, error.message);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const apiKey = req.headers["x-api-key"] || req.headers["x-webhook-key"];
  if (WAHA_API_KEY && apiKey && apiKey !== WAHA_API_KEY) {
    console.log("❌ WAHA webhook: API key inválida");
    return res.status(401).send("Unauthorized");
  }

  try {
    const body = req.body;
    const event = body?.event;
    const sessionName = body?.session || body?.payload?.session || "default";
    const payload = body?.payload || {};

    console.log(`📡 WAHA event: ${event} | session: ${sessionName}`);

    const userId = await getUserIdBySession(sessionName);
    if (!userId) {
      console.log(`⚠️ No se pudo obtener userId para sesión: ${sessionName}`);
      return res.status(200).send("OK (no user)");
    }

    // ─── EVENTO: cambio de estado de sesión ───
    if (event === "session.status") {
      const wahaStatus = payload.status;
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

    // ─── EVENTO: mensaje entrante ───
    if (event === "message" || event === "message.any") {
      if (payload.fromMe) {
        console.log(`📌 Ignorando mensaje propio de ${payload.from}`);
        return res.status(200).send("OK (fromMe)");
      }

      const mensajePreview = payload.body?.slice(0, 50) || (payload.media ? "[media]" : "(vacio)");
      console.log(`📨 Mensaje de ${payload.from}: ${mensajePreview}`);

      const metaMsg = wahaToMeta(payload);

      const fakeReq = {
        headers: {
          host: req.headers.host || "localhost",
          "x-forwarded-proto": req.headers["x-forwarded-proto"] || "https",
        },
      };

      // Procesar y enviar respuesta
      await procesarYResponder(fakeReq, metaMsg, userId, metaMsg.from);
      
      return res.status(200).send("OK");
    }

    console.log(`📌 Evento ignorado: ${event}`);
    return res.status(200).send("OK (ignored)");
    
  } catch (err) {
    console.error("❌ waha-webhook error:", err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
}
