import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_TOKEN = "miTokenSeguro2026";

// ============================================
// CATÁLOGO DE PRECIOS
// ============================================
const PRODUCTOS = {
  "afilador": { nombre: "Afilador de Cuchillos y Tijeras", precio: 99000, promo2x: 129900 },
  "plumero": { nombre: "Plumero LimpiaFlex", precio: 99000, promo2x: 129900 },
  "limpiaflex": { nombre: "Plumero LimpiaFlex", precio: 99000, promo2x: 129900 },
  "niveladora": { nombre: "Niveladoras Lavarropas", precio: 98000 },
  "cocedor": { nombre: "Cocedor de Huevos Automático", precio: 127900 },
  "karseell": { nombre: "Karseell Collagen", precio: 109000 },
  "veneno": { nombre: "Veneno de Abeja", precio: 145000, promo2x: 249900 },
  "linterna": { nombre: "Linterna Potente", precio: 189000 },
  "drone": { nombre: "DRONE", precio: 279900 },
  "rodillera": { nombre: "Rodillera de Compresión", precio: 109000, promo2x: 159900 },
  "ortopiex": { nombre: "Plantilla Ortopiex 5D", precio: 159000 },
};

// ============================================
// HELPERS
// ============================================
function cleanText(text) {
  return String(text || "").trim();
}

function normalizeText(text) {
  return cleanText(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatGs(value) {
  if (!value) return "Consultar";
  return `${value.toLocaleString("es-PY")} Gs`;
}

function detectarProducto(text) {
  const lower = normalizeText(text);
  for (const [key, data] of Object.entries(PRODUCTOS)) {
    if (lower.includes(normalizeText(key))) {
      return { ...data, key };
    }
  }
  return null;
}

function detectarCiudad(text) {
  const ciudades = {
    "asuncion": "Asunción", "asun": "Asunción",
    "capiatá": "Capiatá", "capiata": "Capiatá",
    "luque": "Luque", "lque": "Luque",
    "san lorenzo": "San Lorenzo", "sanlo": "San Lorenzo",
    "lambaré": "Lambaré",
    "fernando de la mora": "Fernando de la Mora", "fdm": "Fernando de la Mora",
    "ciudad del este": "Ciudad del Este", "cde": "Ciudad del Este",
    "presidente franco": "Presidente Franco", "pte franco": "Presidente Franco",
    "hernandarias": "Hernandarias",
    "limpio": "Limpio",
  };
  
  const lower = normalizeText(text);
  for (const [alias, ciudad] of Object.entries(ciudades)) {
    if (lower.includes(alias)) {
      return ciudad;
    }
  }
  return null;
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
// CONTEXTO DEL CHAT (MEMORIA)
// ============================================
async function getContexto(userId, fromNumber) {
  const { data } = await supabase
    .from("chat_context")
    .select("*")
    .eq("user_id", userId)
    .eq("from_number", fromNumber)
    .single();
  
  return data;
}

async function saveContexto(userId, fromNumber, datos) {
  const { error } = await supabase
    .from("chat_context")
    .upsert({
      user_id: userId,
      from_number: fromNumber,
      last_topic: datos.last_topic,
      last_trigger: datos.last_trigger,
      current_product: datos.current_product,
      waiting_for: datos.waiting_for,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,from_number" });
  
  if (error) console.error("Error guardando contexto:", error);
}

// ============================================
// PROCESAR MENSAJE PRINCIPAL (CON MEMORIA)
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
    
    // OBTENER CONTEXTO ACTUAL
    let contexto = await getContexto(userId, fromNumber);
    console.log(`📋 Contexto actual:`, contexto);
    
    // ============================================
    // 1. DETECTAR SI ES RESPUESTA "SI" O "NO"
    // ============================================
    const esSi = /^(si|sí|sii|siii|ok|dale|confirmo|quiero)$/i.test(texto);
    const esNo = /^(no|nop|nada|no quiero)$/i.test(texto);
    
    // Si está esperando confirmación y dice SI
    if (contexto?.waiting_for === "confirmacion_compra" && esSi) {
      const producto = contexto.current_product;
      if (producto) {
        const precio = PRODUCTOS[normalizeText(producto)]?.precio || 99000;
        await enviarMensaje(userId, fromNumber, 
          `🎉 *Excelente!* 🎉\n\n✅ *${producto}* - ${formatGs(precio)} Gs\n🚚 Envío GRATIS contra-entrega\n\n📝 Para agendar tu pedido, pasame tu *nombre completo*.`);
        
        // Actualizar contexto: ahora esperando nombre
        await saveContexto(userId, fromNumber, {
          last_topic: producto,
          current_product: producto,
          waiting_for: "nombre",
          last_trigger: null
        });
        return;
      }
    }
    
    // Si esperando nombre
    if (contexto?.waiting_for === "nombre" && texto.length > 2 && !detectarProducto(texto)) {
      await saveContexto(userId, fromNumber, {
        ...contexto,
        customer_name: texto,
        waiting_for: "ciudad"
      });
      await enviarMensaje(userId, fromNumber, `🙌 Gracias *${texto}*!\n\nAhora pasame tu *ciudad* 📍`);
      return;
    }
    
    // Si esperando ciudad
    if (contexto?.waiting_for === "ciudad") {
      const ciudad = detectarCiudad(texto);
      if (ciudad) {
        await saveContexto(userId, fromNumber, {
          ...contexto,
          city: ciudad,
          waiting_for: "direccion"
        });
        await enviarMensaje(userId, fromNumber, `✅ *${ciudad}* tiene envío gratis 🚚\n\nAhora pasame tu *dirección exacta* 📍`);
        return;
      } else {
        await enviarMensaje(userId, fromNumber, `📍 ¿Podés decirme tu ciudad? Ej: "San Lorenzo", "Luque", "Capiatá"`);
        return;
      }
    }
    
    // Si esperando dirección
    if (contexto?.waiting_for === "direccion" && texto.length > 5) {
      await enviarMensaje(userId, fromNumber, 
        `✅ *PEDIDO CONFIRMADO* ✅
━━━━━━━━━━━━━━━━━━━━━━
✅ Producto: ${contexto.current_product}
✅ Cliente: ${contexto.customer_name}
✅ Ciudad: ${contexto.city}
✅ Dirección: ${texto}

💰 Total: ${formatGs(PRODUCTOS[normalizeText(contexto.current_product)]?.precio || 99000)} Gs
🚚 Envío GRATIS · Pagás al recibir

¡Gracias por elegir Mega Todo Store! 💜✨`);
      
      // Limpiar contexto después de confirmar
      await saveContexto(userId, fromNumber, {
        last_topic: null,
        current_product: null,
        waiting_for: null
      });
      return;
    }
    
    // ============================================
    // 2. DETECTAR PRODUCTO Y PRECIO
    // ============================================
    const producto = detectarProducto(texto);
    const preguntaPrecio = /precio|cuanto|cuesta|costo|valor/i.test(texto);
    
    if (preguntaPrecio && producto) {
      let respuesta = `💰 *${producto.nombre}*\n\n✅ 1 unidad: ${formatGs(producto.precio)}`;
      if (producto.promo2x) respuesta += `\n🔥 2 unidades: ${formatGs(producto.promo2x)}`;
      respuesta += `\n\n🚚 *ENVÍO GRATIS* contra-entrega\n💵 Pagás al recibir\n\n¿Te interesa llevarlo? 😊`;
      
      await enviarMensaje(userId, fromNumber, respuesta);
      
      // Guardar contexto: esperando respuesta SI/NO
      await saveContexto(userId, fromNumber, {
        last_topic: producto.nombre,
        current_product: producto.nombre,
        waiting_for: "confirmacion_compra",
        last_trigger: null
      });
      return;
    }
    
    // ============================================
    // 3. SALUDO INICIAL O RESET
    // ============================================
    const esSaludo = /^(hola|buenas|hey|que tal|buen día|buenas tardes|buenas noches)$/i.test(texto);
    
    if (esSaludo || !contexto) {
      await enviarMensaje(userId, fromNumber, 
        `🛍️ *MEGA TODO STORE*\n\n¡Hola! Soy Araceli 😊\n\n¿De qué ciudad sos? 📍\nAsí te confirmo si tenemos *envío GRATIS* contra-entrega.\n\n📋 Catálogo: https://cat-logomegatodo-com.vercel.app/`);
      
      await saveContexto(userId, fromNumber, {
        last_topic: null,
        current_product: null,
        waiting_for: null
      });
      return;
    }
    
    // ============================================
    // 4. MENSAJE POR DEFECTO
    // ============================================
    await enviarMensaje(userId, fromNumber, 
      `🛍️ *MEGA TODO STORE*\n\n¿En qué puedo ayudarte? 😊\n\nPodés preguntarme:\n💰 Precios de productos\n🚚 Envío gratis\n📝 Cómo comprar\n\n📋 Catálogo: https://cat-logomegatodo-com.vercel.app/`);
    
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
