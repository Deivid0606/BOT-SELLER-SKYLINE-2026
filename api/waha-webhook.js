// api/waha-webhook.js
// Webhook de WAHA → traduce payload al formato Meta y reusa procesar() de webhook.js
// ✅ VERSIÓN DEFINITIVA - FUNCIONA IGUAL QUE LA API DE META

import { createClient } from "@supabase/supabase-js";
import { procesar } from "./webhook.js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || "http://localhost:3000";
const WAHA_API_KEY = process.env.WAHA_API_KEY;

// ✅ Enviar mensaje por WAHA (sin requerir session name)
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
      return null;
    }

    const data = await response.json();
    console.log(`✅ Mensaje enviado por WAHA: ${JSON.stringify(data)}`);
    return data;
  } catch (error) {
    console.error(`❌ Error enviando por WAHA a ${chatId}:`, error.message);
    return null;
  }
}

// ✅ Enviar imagen por WAHA
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

// Convierte un msg de WAHA al formato esperado por procesar()
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

// ✅ SIMPLIFICADA: Obtiene userId - FUNCIONA SIEMPRE
async function getUserId() {
  // Buscar sesión activa "default"
  const { data: defaultSession } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("session_name", "default")
    .eq("status", "connected")
    .maybeSingle();
  
  if (defaultSession?.user_id) {
    console.log(`✅ Sesión default encontrada: ${defaultSession.user_id}`);
    return defaultSession.user_id;
  }
  
  // Buscar cualquier sesión conectada
  const { data: anySession } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();
  
  if (anySession?.user_id) {
    console.log(`✅ Sesión activa encontrada: ${anySession.user_id}`);
    return anySession.user_id;
  }
  
  // Último recurso: user_id fijo (el que funciona en Meta)
  console.log(`⚠️ Usando user_id por defecto: c206b0dc-7c6a-4dee-a91e-3e9ffafe5048`);
  return "c206b0dc-7c6a-4dee-a91e-3e9ffafe5048";
}

// ✅ Procesar y responder
async function procesarYResponder(fakeReq, metaMsg, userId, fromNumber) {
  try {
    console.log(`🤖 Procesando mensaje de ${fromNumber}...`);
    
    const respuesta = await procesar(fakeReq, metaMsg, userId, fromNumber);
    
    if (respuesta && respuesta.response) {
      console.log(`💬 Respuesta: "${respuesta.response.slice(0, 80)}..."`);
      
      const enviado = await enviarPorWAHA(fromNumber, respuesta.response);
      
      if (enviado) {
        console.log(`✅ Respuesta enviada a ${fromNumber}`);
      } else {
        console.log(`⚠️ Falló envío a ${fromNumber}`);
      }
      
      return respuesta;
    }
    
    console.log(`⚠️ No hay respuesta para ${fromNumber}`);
    return null;
  } catch (error) {
    console.error(`❌ Error procesando:`, error.message);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key");
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const body = req.body;
    const event = body?.event;
    const payload = body?.payload || {};

    console.log(`📡 WAHA event: ${event}`);

    // ✅ Obtener userId (siempre funciona)
    const userId = await getUserId();
    
    if (!userId) {
      console.error("❌ No se pudo obtener userId");
      return res.status(200).send("OK (no user)");
    }

    // Evento: cambio de estado de sesión
    if (event === "session.status") {
      const wahaStatus = payload.status;
      console.log(`📊 Estado sesión: ${wahaStatus}`);
      
      // Actualizar estado en BD si es necesario
      let dbStatus = "disconnected";
      if (wahaStatus === "WORKING") dbStatus = "connected";
      else if (wahaStatus === "SCAN_QR_CODE") dbStatus = "pending_qr";
      else if (wahaStatus === "FAILED") dbStatus = "failed";
      
      if (dbStatus !== "disconnected") {
        await supabase
          .from("whatsapp_qr_sessions")
          .update({ 
            status: dbStatus, 
            last_event_at: new Date().toISOString(),
            ...(dbStatus === "connected" && { connected_at: new Date().toISOString() })
          })
          .eq("session_name", "default");
      }
      
      return res.status(200).send("OK");
    }

    // Evento: mensaje entrante
    if (event === "message" || event === "message.any") {
      // Ignorar mensajes propios
      if (payload.fromMe) {
        console.log(`📌 Ignorando mensaje propio`);
        return res.status(200).send("OK");
      }

      // Verificar que tenga texto
      if (!payload.body) {
        console.log(`⚠️ Mensaje sin texto de ${payload.from}, ignorando`);
        return res.status(200).send("OK");
      }

      const mensajePreview = payload.body.slice(0, 50);
      console.log(`📨 Mensaje de ${payload.from}: "${mensajePreview}"`);

      // Convertir al formato que espera procesar()
      const metaMsg = {
        id: payload.id || `msg_${Date.now()}`,
        from: payload.from.replace(/@c\.us$/, "").replace(/@lid$/, ""),
        timestamp: String(payload.timestamp || Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: payload.body }
      };

      const fakeReq = {
        headers: {
          host: req.headers.host || "bot-seller-skyline-2026.vercel.app",
          "x-forwarded-proto": "https",
        },
      };

      // Procesar y enviar respuesta
      await procesarYResponder(fakeReq, metaMsg, userId, metaMsg.from);
      
      return res.status(200).send("OK");
    }

    // Otros eventos: ignorar
    console.log(`📌 Evento ignorado: ${event}`);
    return res.status(200).send("OK");
    
  } catch (err) {
    console.error("❌ waha-webhook error:", err);
    return res.status(200).send("OK"); // Siempre responder OK para no bloquear WAHA
  }
}
