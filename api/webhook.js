import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_TOKEN = "miTokenSeguro2026";

// ============================================
// HELPERS
// ============================================
function cleanText(text) {
  return String(text || "").trim();
}

function normalizeText(text) {
  return cleanText(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// ============================================
// ENVIAR MENSAJE
// ============================================
async function enviarMensaje(userId, to, message) {
  try {
    const { data: config } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .single();
    
    if (!config?.phone_number_id || !config?.permanent_token) {
      console.log("❌ No hay configuración de WhatsApp");
      return false;
    }
    
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.permanent_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message },
      }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error("Error Meta:", error);
      return false;
    }
    
    await supabase.from("received_messages").insert({
      user_id: userId,
      platform: "whatsapp",
      from_number: to,
      message: message,
      message_type: "out_text",
      created_at: new Date().toISOString(),
    });
    
    console.log(`✅ Mensaje enviado a ${to}`);
    return true;
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    return false;
  }
}

// ============================================
// OBTENER ENTRENAMIENTO (PRIORIDAD #1)
// ============================================
async function getTrainingData(userId) {
  const { data } = await supabase
    .from("training_data")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true);
  
  return data || [];
}

// ============================================
// BUSCAR RESPUESTA EN ENTRENAMIENTO (MATCH EXACTO)
// ============================================
function buscarRespuestaEnEntrenamiento(trainingData, mensaje) {
  if (!trainingData || trainingData.length === 0) return null;
  
  const mensajeNorm = normalizeText(mensaje);
  
  for (const item of trainingData) {
    // Verificar ejemplos
    if (item.examples && Array.isArray(item.examples)) {
      for (const ejemplo of item.examples) {
        const ejemploNorm = normalizeText(ejemplo);
        // Buscar coincidencia parcial o exacta
        if (mensajeNorm.includes(ejemploNorm) || ejemploNorm.includes(mensajeNorm)) {
          console.log(`✅ Entrenamiento匹配: "${item.intent}" -> "${ejemplo}"`);
          return item.response;
        }
      }
    }
    
    // Verificar intent directamente
    const intentNorm = normalizeText(item.intent || "");
    if (intentNorm && mensajeNorm.includes(intentNorm)) {
      console.log(`✅ Entrenamiento匹配 por intent: "${item.intent}"`);
      return item.response;
    }
  }
  
  return null;
}

// ============================================
// OBTENER TRIGGERS
// ============================================
async function getTriggers(userId) {
  const { data } = await supabase
    .from("triggers")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true);
  return data || [];
}

// ============================================
// VERIFICAR TRIGGERS
// ============================================
async function verificarTriggers(userId, fromNumber, mensaje) {
  const triggers = await getTriggers(userId);
  const mensajeNorm = normalizeText(mensaje);
  
  for (const trigger of triggers) {
    const condition = normalizeText(trigger.condition);
    if (mensajeNorm.includes(condition)) {
      console.log(`🎯 Trigger activado: "${trigger.name}"`);
      await enviarMensaje(userId, fromNumber, trigger.response);
      return true;
    }
  }
  return false;
}

// ============================================
// OBTENER CONFIG IA
// ============================================
async function getIAConfig(userId) {
  const { data } = await supabase
    .from("chat_ia_gemini")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();
  return data;
}

// ============================================
// OBTENER HISTORIAL
// ============================================
async function getConversationHistory(userId, fromNumber, limit = 6) {
  const { data } = await supabase
    .from("received_messages")
    .select("message, message_type, created_at")
    .eq("user_id", userId)
    .eq("from_number", fromNumber)
    .order("created_at", { ascending: false })
    .limit(limit);
  
  if (!data || data.length === 0) return [];
  
  const history = data.reverse();
  const formatted = [];
  for (const msg of history) {
    const role = msg.message_type && msg.message_type.startsWith("out_") ? "assistant" : "user";
    formatted.push({ role: role, content: cleanText(msg.message || "").substring(0, 300) });
  }
  return formatted;
}

// ============================================
// LLAMAR A GEMINI CON ENTRENAMIENTO
// ============================================
async function callGemini(apiKey, model, trainingData, message, history) {
  // Construir system prompt CON el entrenamiento
  let trainingSection = "INSTRUCCIONES PRIORITARIAS (RESPONDER EXACTAMENTE ASÍ):\n\n";
  
  for (const item of trainingData) {
    trainingSection += `Si el cliente dice algo como: "${item.examples?.join('", "') || item.intent}"\n`;
    trainingSection += `Debes responder EXACTAMENTE: "${item.response}"\n\n`;
  }
  
  trainingSection += `REGLAS OBLIGATORIAS:
1. PRIORIZA LAS RESPUESTAS DEL ENTRENAMIENTO SOBRE TODO
2. Si el mensaje del cliente coincide con algún ejemplo, usa ESA respuesta exacta
3. NO inventes respuestas, usa el entrenamiento
4. Sé amable y profesional
5. Catálogo: https://cat-logomegatodo-com.vercel.app/`;

  const contents = [];
  for (const msg of history) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    });
  }
  contents.push({ role: "user", parts: [{ text: message }] });
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: trainingSection }] },
        contents: contents,
        generationConfig: { temperature: 0.5, maxOutputTokens: 300 },
      }),
    }
  );
  
  const data = await response.json();
  if (!response.ok) {
    console.error("Error Gemini:", data);
    return null;
  }
  return cleanText(data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

// ============================================
// PROCESAR MENSAJE PRINCIPAL
// ============================================
async function procesarMensaje(message, token, userId, fromNumber) {
  try {
    if (message.type !== "text") {
      await enviarMensaje(userId, fromNumber, "📝 Por favor escribí tu mensaje.");
      return;
    }
    
    const texto = cleanText(message.text?.body || "");
    if (!texto) return;
    
    console.log(`📩 ${fromNumber}: "${texto}"`);
    
    // Guardar mensaje
    await supabase.from("received_messages").insert({
      user_id: userId,
      platform: "whatsapp",
      from_number: fromNumber,
      message: texto,
      message_type: "in_text",
      created_at: new Date().toISOString(),
    });
    
    // ============================================
    // 1. VERIFICAR TRIGGERS (prioridad 1)
    // ============================================
    const triggerActivado = await verificarTriggers(userId, fromNumber, texto);
    if (triggerActivado) return;
    
    // ============================================
    // 2. CARGAR ENTRENAMIENTO (prioridad 2)
    // ============================================
    const trainingData = await getTrainingData(userId);
    console.log(`📚 Entrenamiento cargado: ${trainingData.length} reglas`);
    
    // 3. BUSCAR RESPUESTA EXACTA EN ENTRENAMIENTO
    const respuestaEntrenamiento = buscarRespuestaEnEntrenamiento(trainingData, texto);
    if (respuestaEntrenamiento) {
      console.log(`✅ Usando respuesta de entrenamiento`);
      await enviarMensaje(userId, fromNumber, respuestaEntrenamiento);
      return;
    }
    
    // ============================================
    // 4. SI HAY ENTRENAMIENTO PERO NO MATCH, USAR IA
    // ============================================
    const iaConfig = await getIAConfig(userId);
    
    if (iaConfig?.api_key && trainingData.length > 0) {
      console.log(`🤖 Llamando a Gemini con entrenamiento (${trainingData.length} reglas)`);
      const history = await getConversationHistory(userId, fromNumber, 6);
      const respuestaIA = await callGemini(
        iaConfig.api_key,
        iaConfig.model || "gemini-2.0-flash",
        trainingData,
        texto,
        history
      );
      
      if (respuestaIA) {
        await enviarMensaje(userId, fromNumber, respuestaIA);
        return;
      }
    }
    
    // ============================================
    // 5. MENSAJE POR DEFECTO (si nada funciona)
    // ============================================
    await enviarMensaje(userId, fromNumber, 
      `🛍️ *MEGA TODO STORE*\n\n¡Hola! Soy Araceli 😊\n\n¿De qué ciudad sos? 📍\n\n📋 Catálogo: https://cat-logomegatodo-com.vercel.app/`);
    
  } catch (error) {
    console.error("❌ Error:", error);
    await enviarMensaje(userId, fromNumber, "⚠️ Hubo un error. Por favor escribí tu mensaje nuevamente.");
  }
}

// ============================================
// WEBHOOK HANDLER
// ============================================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  
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
      if (body.object !== "whatsapp_business_account") {
        return res.status(404).send("Not WhatsApp");
      }
      
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id;
          
          if (!phoneNumberId) continue;
          
          const { data: config } = await supabase
            .from("whatsapp_config")
            .select("user_id, permanent_token")
            .eq("phone_number_id", phoneNumberId)
            .single();
          
          if (!config?.user_id) continue;
          
          if (value.messages) {
            for (const message of value.messages) {
              await procesarMensaje(message, config.permanent_token, config.user_id, message.from);
            }
          }
        }
      }
      
      return res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("❌ Error POST:", error);
      return res.status(500).json({ error: "Error interno" });
    }
  }
  
  return res.status(405).send("Method Not Allowed");
}
