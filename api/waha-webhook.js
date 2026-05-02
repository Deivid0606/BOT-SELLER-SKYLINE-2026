// api/waha-webhook.js - VERSIÓN FINAL 100% FUNCIONAL
// ✅ QR recibe mensajes ✅ Responde automáticamente ✅ Usa el mismo chat-ia que Meta

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

// Obtener userId (siempre funciona)
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
  
  // Fallback: tu user_id
  return "c206b0dc-7c6a-4dee-a91e-3e9ffafe5048";
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  try {
    const body = req.body;
    const event = body?.event;
    const payload = body?.payload || {};

    console.log(`📡 WAHA event: ${event}`);

    // Evento: mensaje entrante
    if (event === "message" || event === "message.any") {
      // Ignorar mensajes propios
      if (payload.fromMe) {
        console.log("📌 Mensaje propio, ignorado");
        return res.status(200).send("OK");
      }

      const mensaje = payload.body || "";
      const from = payload.from || "";

      if (!mensaje) {
        console.log("⚠️ Mensaje sin texto, ignorado");
        return res.status(200).send("OK");
      }

      const numeroLimpio = from.replace(/@c\.us$|@lid$/, "");
      console.log(`📨 QR: ${numeroLimpio} dijo: "${mensaje}"`);

      // Obtener userId
      const userId = await getUserId();
      console.log(`👤 userId: ${userId}`);

      // 🔥 LLAMAR A CHAT-IA (el mismo que usa Meta)
      const vercelUrl = process.env.VERCEL_URL || req.headers.host || "bot-seller-skyline-2026.vercel.app";
      const chatIaUrl = `https://${vercelUrl}/api/chat-ia`;

      console.log(`📡 Llamando a chat-ia: ${chatIaUrl}`);

      const iaResponse = await fetch(chatIaUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          from_number: numeroLimpio,
          message: mensaje,
          context: null,
          history: [],
        }),
      });

      const iaData = await iaResponse.json();
      const respuesta = iaData.response;

      if (respuesta) {
        console.log(`💬 Respondiendo: "${respuesta.slice(0, 80)}..."`);
        await enviarPorWAHA(from, respuesta);
      } else {
        console.log("⚠️ No se generó respuesta de chat-ia");
      }

      return res.status(200).send("OK");
    }

    // Evento: estado de sesión (solo log)
    if (event === "session.status") {
      console.log(`📊 Estado sesión: ${payload.status}`);
      return res.status(200).send("OK");
    }

    // Otros eventos: ignorar
    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.status(200).send("OK");
  }
}
