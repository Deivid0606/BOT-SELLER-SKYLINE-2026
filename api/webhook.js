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
// OBTENER TODO LO NECESARIO DE LA BD
// ============================================
async function getTriggers(userId) {
  const { data } = await supabase
    .from("triggers")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true);
  return data || [];
}

async function getTrainingData(userId) {
  const { data } = await supabase
    .from("training_data")
    .select("intent, examples, response")
    .eq("user_id", userId)
    .eq("is_active", true);
  return data || [];
}

async function getIAConfig(userId) {
  const { data } = await supabase
    .from("chat_ia_gemini")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();
  return data;
}

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
async function callGemini(apiKey, model, systemInstruction, message, history) {
  const contents = [];
  
  for (const msg of history) {
    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    });
  }
  
  contents.push({
    role: "user",
    parts: [{ text: message }]
  });
  
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 300 },
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
// CONSTRUIR SYSTEM PROMPT CON ENTRENAMIENTO
// ============================================
function buildSystemPrompt(trainingData, hasActiveOrder, orderData = null) {
  let trainingText = "";
  
  if (trainingData && trainingData.length > 0) {
    trainingText = "INSTRUCCIONES ESPECÍFICAS DE ENTRENAMIENTO:\n\n";
    for (const item of trainingData) {
      trainingText += `Intención: ${item.intent}\n`;
      if (item.examples && item.examples.length > 0) {
        trainingText += `Ejemplos: ${item.examples.join(", ")}\n`;
      }
      trainingText += `Respuesta: ${item.response}\n\n`;
    }
  }
  
  let estadoPedido = "";
  if (hasActiveOrder && orderData) {
    estadoPedido = `
ESTADO DEL PEDIDO ACTUAL:
- Producto: ${orderData.product || "No definido"}
- Cliente: ${orderData.customer_name || "No definido"}
- Ciudad: ${orderData.city || "No definido"}
- Dirección: ${orderData.address || "No definido"}
- Paso actual: ${orderData.status || "inicial"}

REGLAS ESTRICTAS PARA EL PEDIDO:
1. Si ya tienes el NOMBRE del cliente, NO lo vuelvas a pedir
2. Si ya tienes la CIUDAD, NO la vuelvas a pedir
3. Si ya tienes la DIRECCIÓN, NO la vuelvas a pedir
4. Pide UN SOLO dato por vez, el que falta
5. Cuando tengas todos los datos (nombre, ciudad, dirección), confirma el pedido
`;
  }
  
  return `${trainingText}

${estadoPedido}

${!trainingText ? `Eres ARACELI, vendedora de MEGA TODO STORE.

REGLAS BÁSICAS:
- Responde en español, cálido y natural
- Pregunta la ciudad primero
- Luego pregunta qué producto quiere
- Luego pide nombre y dirección
- Confirma el pedido al final
- NUNCA digas "no tengo información"` : ""}

CATÁLOGO: https://cat-logomegatodo-com.vercel.app/`;
}

// ============================================
// PROCESAR MENSAJE PRINCIPAL
// ============================================
async function procesarMensaje(message, token, userId, fromNumber) {
  try {
    if (message.type !== "text") {
      await enviarMensaje(userId, fromNumber, "📝 Por favor escribí tu mensaje para ayudarte mejor.");
      return;
    }
    
    const texto = cleanText(message.text?.body || "");
    if (!texto) return;
    
    console.log(`📩 ${fromNumber}: ${texto}`);
    
    // Guardar mensaje entrante
    await supabase.from("received_messages").insert({
      user_id: userId,
      platform: "whatsapp",
      from_number: fromNumber,
      message: texto,
      message_type: "in_text",
      created_at: new Date().toISOString(),
    });
    
    // ============================================
    // 1. CARGAR TRIGGERS Y VERIFICAR
    // ============================================
    const triggers = await getTriggers(userId);
    const textoLower = normalizeText(texto);
    
    for (const trigger of triggers) {
      if (textoLower.includes(normalizeText(trigger.condition))) {
        console.log(`✅ Trigger: ${trigger.name}`);
        await enviarMensaje(userId, fromNumber, trigger.response);
        return;
      }
    }
    
    // ============================================
    // 2. CARGAR CONFIGURACIÓN DE IA
    // ============================================
    const iaConfig = await getIAConfig(userId);
    
    if (!iaConfig || !iaConfig.api_key) {
      console.log("⚠️ IA no configurada");
      await enviarMensaje(userId, fromNumber, 
        "🛍️ *MEGA TODO STORE*\n\n¡Hola! Soy Araceli 😊\n\n¿De qué ciudad sos? 📍\n\n📋 Catálogo: https://cat-logomegatodo-com.vercel.app/");
      return;
    }
    
    // ============================================
    // 3. CARGAR ENTRENAMIENTO E HISTORIAL
    // ============================================
    const [trainingData, history] = await Promise.all([
      getTrainingData(userId),
      getConversationHistory(userId, fromNumber, 8)
    ]);
    
    // ============================================
    // 4. VERIFICAR SI HAY ORDEN ACTIVA
    // ============================================
    const { data: ordenActiva } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", fromNumber)
      .in("status", ["esperando_nombre", "esperando_ciudad", "esperando_direccion"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    
    // ============================================
    // 5. CONSTRUIR SYSTEM PROMPT
    // ============================================
    const systemPrompt = buildSystemPrompt(trainingData, !!ordenActiva, ordenActiva);
    
    // ============================================
    // 6. LLAMAR A GEMINI
    // ============================================
    const respuestaIA = await callGemini(
      iaConfig.api_key,
      iaConfig.model || "gemini-2.0-flash",
      systemPrompt,
      texto,
      history
    );
    
    // ============================================
    // 7. ENVIAR RESPUESTA
    // ============================================
    if (respuestaIA) {
      await enviarMensaje(userId, fromNumber, respuestaIA);
    } else {
      await enviarMensaje(userId, fromNumber, 
        "🛍️ *MEGA TODO STORE*\n\n¿De qué ciudad sos? 📍\n\n📋 Catálogo: https://cat-logomegatodo-com.vercel.app/");
    }
    
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
      console.log("📨 POST recibido");
      
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
          
          if (!config?.user_id) {
            console.log("⚠️ Config no encontrada");
            continue;
          }
          
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
