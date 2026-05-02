// api/waha-webhook.js - VERSIÓN FINAL 100% FUNCIONAL
// ✅ QR recibe mensajes ✅ Responde automáticamente ✅ Números normales (sin @lid)

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || "http://localhost:3000";

// Enviar mensaje por WAHA
async function enviarPorWAHA(chatId, texto) {
  try {
    let chatIdFormateado = chatId;
    if (!chatId.includes("@c.us") && !chatId.includes("@lid")) {
      chatIdFormateado = `${chatId}@c.us`;
    }

    const response = await fetch(`${WAHA_BASE_URL}/api/sendText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId: chatIdFormateado,
        text: texto,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("❌ WAHA error:", error);
      return false;
    }

    console.log(`✅ Mensaje enviado a ${chatIdFormateado}`);
    return true;
  } catch (error) {
    console.error("❌ Error enviando:", error.message);
    return false;
  }
}

// Obtener userId
async function getUserId() {
  const { data: session } = await supabase
    .from("whatsapp_qr_sessions")
    .select("user_id")
    .eq("session_name", "default")
    .eq("status", "connected")
    .maybeSingle();
  
  if (session?.user_id) {
    return session.user_id;
  }
  return "c206b0dc-7c6a-4dee-a91e-3e9ffafe5048";
}

// Limpiar número para guardar en BD (número normal)
function limpiarNumero(from) {
  // Si es @lid (ID largo estilo 123906065187008@lid)
  if (from.includes("@lid")) {
    // Extraer solo los números del ID largo
    const match = from.match(/(\d+)/);
    if (match) {
      return match[1]; // Devuelve solo los dígitos
    }
    return from.replace("@lid", "");
  }
  // Si es @c.us (número normal)
  if (from.includes("@c.us")) {
    return from.replace("@c.us", "");
  }
  // Si viene sin sufijo, devolver igual
  return from;
}

// Limpiar ID para enviar respuesta (mantener @lid o @c.us)
function limpiarIdParaRespuesta(from) {
  // Si ya tiene @lid o @c.us, devolver igual
  if (from.includes("@lid") || from.includes("@c.us")) {
    return from;
  }
  // Si es número normal, agregar @c.us
  if (/^\d+$/.test(from)) {
    return `${from}@c.us`;
  }
  return from;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const body = req.body;
    const event = body?.event;
    const payload = body?.payload || {};

    console.log(`📡 WAHA event: ${event}`);

    if (event === "message" || event === "message.any") {
      if (payload.fromMe) {
        console.log("📌 Mensaje propio, ignorado");
        return res.status(200).send("OK");
      }

      const mensaje = payload.body || "";
      const fromOriginal = payload.from || "";

      if (!mensaje) {
        console.log("⚠️ Mensaje sin texto, ignorado");
        return res.status(200).send("OK");
      }

      // 🔥 Limpiar el número para guardar en BD (número normal)
      const numeroNormal = limpiarNumero(fromOriginal);
      
      console.log(`📨 QR Mensaje de: ${fromOriginal}`);
      console.log(`📨 Número normal para BD: ${numeroNormal}`);
      console.log(`📨 Mensaje: "${mensaje}"`);

      const userId = await getUserId();
      console.log(`👤 userId: ${userId}`);

      // Llamar a chat-ia con número normal
      const vercelUrl = process.env.VERCEL_URL || req.headers.host || "bot-seller-skyline-2026.vercel.app";
      const chatIaUrl = `https://${vercelUrl}/api/chat-ia`;

      console.log(`📡 Llamando a chat-ia: ${chatIaUrl}`);

      const iaResponse = await fetch(chatIaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          from_number: numeroNormal,  // Enviamos número normal
          message: mensaje,
          context: null,
          history: [],
        }),
      });

      const iaData = await iaResponse.json();
      const respuesta = iaData.response;

      if (respuesta) {
        console.log(`💬 Respuesta generada: "${respuesta.slice(0, 80)}..."`);
        // Enviar respuesta usando el ID original (con @lid o @c.us)
        await enviarPorWAHA(fromOriginal, respuesta);
      } else {
        console.log("⚠️ No se generó respuesta - chat-ia respondió:", JSON.stringify(iaData));
      }

      return res.status(200).send("OK");
    }

    if (event === "session.status") {
      console.log(`📊 Estado sesión: ${payload.status}`);
      return res.status(200).send("OK");
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.status(200).send("OK");
  }
}
