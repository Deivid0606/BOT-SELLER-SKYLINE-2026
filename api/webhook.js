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
  "patita": { nombre: "Patita Lavarropas", precio: 98000, promo8u: 159000 },
  "cocedor": { nombre: "Cocedor de Huevos Automático", precio: 127900 },
  "karseell": { nombre: "Karseell Collagen", precio: 109000 },
  "veneno": { nombre: "Veneno de Abeja", precio: 145000, promo2x: 249900 },
  "linterna": { nombre: "Linterna Potente", precio: 189000 },
  "intercomunicador": { nombre: "Intercomunicador para Casco", precio: 169000, promo2x: 269000 },
  "alarma": { nombre: "Alarma Antirrobo", precio: 148900 },
  "drone": { nombre: "DRONE", precio: 279900 },
  "dron": { nombre: "DRONE", precio: 279900 },
  "tobillera": { nombre: "Tobillera de Compresión", precio: 109000, par: 159000 },
  "rodillera": { nombre: "Rodillera de Compresión", precio: 109000, promo2x: 159900 },
  "medias": { nombre: "Medias Terapéuticas", precio2p: 120000 },
  "clip nasal": { nombre: "Clip Nasal Anti-Ronquidos", precio: 95000 },
  "ortopiex": { nombre: "Plantilla Ortopiex 5D", precio: 159000 },
  "royalbee": { nombre: "RoyalBee Wax", precio: 120000, promo2x: 169000 },
  "wild tornado": { nombre: "WILD TORNADO", precio: 179900 },
  "hongo": { nombre: "Hongo Antihongos Pro+", precio: 99000, promo2x1: 159000 },
  "huevera": { nombre: "Huevera en forma de Gallinita", precio: 127900 },
  "aspirador": { nombre: "Aspirador portátil Powerson", precio: 129900 },
  "mini aspiradora": { nombre: "Mini Aspiradora", precio: 129900 },
  "raf pro": { nombre: "Procesador de Alimentos RAF PRO", precio: 189900 },
};

// ============================================
// CIUDADES CON COBERTURA
// ============================================
const CIUDADES = {
  "asuncion": "Asunción", "asun": "Asunción",
  "capiatá": "Capiatá", "capiata": "Capiatá", "c@piata": "Capiatá",
  "luque": "Luque", "lque": "Luque",
  "san lorenzo": "San Lorenzo", "sanlo": "San Lorenzo",
  "lambaré": "Lambaré", "lambare": "Lambaré",
  "fernando de la mora": "Fernando de la Mora", "fdm": "Fernando de la Mora",
  "ciudad del este": "Ciudad del Este", "cde": "Ciudad del Este",
  "presidente franco": "Presidente Franco", "pte franco": "Presidente Franco",
  "hernandarias": "Hernandarias", "hernadarias": "Hernandarias",
  "limpio": "Limpio", "ita": "Itá", "itaugua": "Itauguá",
  "aregua": "Areguá", "villa elisa": "Villa Elisa",
  "mariano roque alonso": "Mariano Roque Alonso", "mra": "Mariano Roque Alonso",
  "nemby": "Ñemby", "ypane": "Ypané", "villa hayes": "Villa Hayes",
  "san antonio": "San Antonio", 
  "altos": "Altos", "caacupe": "Caacupé", "ypacarai": "Ypacaraí",
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
  const lower = normalizeText(text);
  for (const [alias, ciudad] of Object.entries(CIUDADES)) {
    if (lower.includes(normalizeText(alias))) {
      return ciudad;
    }
  }
  return null;
}

function detectarCantidad(text) {
  const lower = normalizeText(text);
  if (lower.includes("2") || lower.includes("dos")) return 2;
  if (lower.includes("3") || lower.includes("tres")) return 3;
  if (lower.includes("4") || lower.includes("cuatro")) return 4;
  if (lower.includes("5") || lower.includes("cinco")) return 5;
  return 1;
}

function calcularPrecio(producto, cantidad = 1) {
  if (!producto) return null;
  if (cantidad === 2 && producto.promo2x) return producto.promo2x;
  if (cantidad === 2 && producto.par) return producto.par;
  if (producto.precio) return producto.precio * cantidad;
  return producto.precio || null;
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
    
    const result = await response.json();
    
    if (!response.ok) {
      console.error("Error Meta:", result);
      return false;
    }
    
    // Guardar mensaje enviado
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
// ORDENES
// ============================================
async function getOrdenActiva(userId, fromNumber) {
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", userId)
    .eq("from_number", fromNumber)
    .in("status", ["esperando_nombre", "esperando_ciudad", "esperando_direccion"])
    .order("created_at", { ascending: false })
    .limit(1);
  
  return data?.[0] || null;
}

async function crearOrden(userId, fromNumber, producto, cantidad) {
  const precio = calcularPrecio(producto, cantidad);
  
  const { data, error } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      from_number: fromNumber,
      product: producto.nombre,
      quantity: cantidad,
      total_amount: precio,
      status: "esperando_nombre",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  
  if (error) {
    console.error("Error creando orden:", error);
    return null;
  }
  return data;
}

async function actualizarOrden(id, datos) {
  const { data, error } = await supabase
    .from("orders")
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  
  if (error) {
    console.error("Error actualizando orden:", error);
    return null;
  }
  return data;
}

async function confirmarOrden(userId, fromNumber, orden) {
  const mensaje = `✅ *PEDIDO CONFIRMADO* ✅
━━━━━━━━━━━━━━━━━━━━━━
✅ Producto: ${orden.product}
✅ Cliente: ${orden.customer_name}
✅ Ciudad: ${orden.city}
✅ Dirección: ${orden.address}
✅ Cantidad: ${orden.quantity} u.

💰 Total: ${formatGs(orden.total_amount)} Gs
🚚 Envío GRATIS · Pagás al recibir

¡Gracias por elegir Mega Todo Store! 💜✨

📋 Catálogo: https://cat-logomegatodo-com.vercel.app/`;
  
  await enviarMensaje(userId, fromNumber, mensaje);
  await actualizarOrden(orden.id, { status: "completado" });
}

// ============================================
// DISPARADORES (TRIGGERS)
// ============================================
async function procesarDisparadores(userId, fromNumber, message) {
  try {
    const { data: triggers, error } = await supabase
      .from("triggers")
      .select("*")
      .eq("user_id", userId)
      .eq("active", true);
    
    if (error) {
      console.error("Error cargando triggers:", error);
      return null;
    }
    
    if (!triggers || triggers.length === 0) {
      console.log("No hay triggers activos");
      return null;
    }
    
    const messageLower = normalizeText(message);
    
    for (const trigger of triggers) {
      const condition = normalizeText(trigger.condition);
      if (condition && messageLower.includes(condition)) {
        console.log(`✅ Trigger activado: ${trigger.name}`);
        
        const responseText = trigger.response;
        if (responseText) {
          await enviarMensaje(userId, fromNumber, responseText);
        }
        
        return trigger;
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error en procesarDisparadores:", error);
    return null;
  }
}

// ============================================
// IA GEMINI
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

async function generarRespuestaIA(userId, message, fromNumber, ordenActiva) {
  const config = await getIAConfig(userId);
  if (!config?.api_key) {
    console.log("⚠️ IA no configurada");
    return null;
  }
  
  // Contexto del pedido
  let contextoPedido = "";
  if (ordenActiva) {
    contextoPedido = `
ESTADO ACTUAL DEL PEDIDO:
- Producto: ${ordenActiva.product || "No definido"}
- Cliente: ${ordenActiva.customer_name || "No definido"}
- Ciudad: ${ordenActiva.city || "No definido"} 
- Dirección: ${ordenActiva.address || "No definido"}
- Estado: ${ordenActiva.status}

REGLAS ESTRICTAS:
1. Si ya tienes el NOMBRE, NO lo pidas de nuevo
2. Si ya tienes la CIUDAD, NO la pidas de nuevo
3. Si ya tienes la DIRECCIÓN, NO la pidas de nuevo
4. Pide SOLO el siguiente dato que falta
`;
  }
  
  const systemPrompt = `Eres ARACELI, vendedora amable de Mega Todo Store.

${contextoPedido}

PRECIOS CORRECTOS:
${Object.entries(PRODUCTOS).map(([k, v]) => `- ${v.nombre}: ${formatGs(v.precio)}`).join("\n")}

CIUDADES CON ENVÍO GRATIS: Asunción, Capiatá, Luque, San Lorenzo, Lambaré, Fernando de la Mora, Ciudad del Este, Presidente Franco, Hernandarias, Limpio.

Reglas:
- Responde en español, cálido y natural
- Máximo 2 oraciones por mensaje
- Si preguntan precio, da el precio y pregunta si quiere comprar
- Si dicen "sí" o "quiero", pide el siguiente dato
- NUNCA repitas preguntas
- NUNCA inventes precios`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.api_key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: message }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 250 },
      }),
    });
    
    const data = await response.json();
    const respuesta = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    
    if (respuesta) {
      console.log(`🤖 IA responde: ${respuesta.substring(0, 100)}...`);
    }
    
    return respuesta;
  } catch (error) {
    console.error("Error IA:", error);
    return null;
  }
}

// ============================================
// PROCESAR MENSAJE PRINCIPAL
// ============================================
async function procesarMensaje(message, token, userId, fromNumber) {
  try {
    // Solo procesar mensajes de texto
    if (message.type !== "text") {
      await enviarMensaje(userId, fromNumber, "📝 Por favor escribí tu mensaje para poder ayudarte mejor.");
      return;
    }
    
    const texto = cleanText(message.text?.body || "");
    if (!texto) return;
    
    console.log(`📩 Mensaje de ${fromNumber}: "${texto}"`);
    
    // ============================================
    // 1. BUSCAR DISPARADORES (TRIGGERS)
    // ============================================
    const triggerActivado = await procesarDisparadores(userId, fromNumber, texto);
    if (triggerActivado) {
      console.log(`✅ Trigger "${triggerActivado.name}" ejecutado, no continuar`);
      return;
    }
    
    // ============================================
    // 2. BUSCAR ORDEN ACTIVA
    // ============================================
    let ordenActiva = await getOrdenActiva(userId, fromNumber);
    
    // ============================================
    // 3. DETECTAR CIUDAD (si no hay orden activa)
    // ============================================
    const ciudad = detectarCiudad(texto);
    if (ciudad && !ordenActiva) {
      await enviarMensaje(userId, fromNumber, 
        `✅ *Perfecto!* 😊\n\n${ciudad} tiene *ENVÍO GRATIS* contra-entrega 🚚\n💵 Pagás al recibir SIN moverte de casa\n\n🛍️ ¿Qué producto te gustaría pedir?\n\n📋 Catálogo: https://cat-logomegatodo-com.vercel.app/`);
      return;
    }
    
    // ============================================
    // 4. PREGUNTA DE PRECIO
    // ============================================
    const producto = detectarProducto(texto);
    const preguntaPrecio = /precio|cuanto|cuesta|costo|valor/i.test(texto);
    
    if (preguntaPrecio && producto) {
      let respuestaPrecio = `💰 *${producto.nombre}*\n\n✅ 1 unidad: ${formatGs(producto.precio)}`;
      if (producto.promo2x) respuestaPrecio += `\n🔥 2 unidades: ${formatGs(producto.promo2x)}`;
      respuestaPrecio += `\n\n🚚 *ENVÍO GRATIS* contra-entrega\n💵 Pagás al recibir\n\n¿Te interesa llevarlo? 😊`;
      await enviarMensaje(userId, fromNumber, respuestaPrecio);
      return;
    }
    
    // ============================================
    // 5. INICIAR NUEVA ORDEN (si hay producto y quiere comprar)
    // ============================================
    const intencionCompra = /quiero|comprar|me interesa|si|sí|ok|dale|confirmo/i.test(texto);
    
    if (producto && intencionCompra && !ordenActiva) {
      const cantidad = detectarCantidad(texto);
      const nuevaOrden = await crearOrden(userId, fromNumber, producto, cantidad);
      
      if (nuevaOrden) {
        await enviarMensaje(userId, fromNumber, 
          `🛍️ *${producto.nombre}* - ${formatGs(calcularPrecio(producto, cantidad))} Gs\n\n✅ ¡Excelente elección!\n\n📝 Para agendar tu pedido, pasame tu *nombre completo*.`);
      }
      return;
    }
    
    // ============================================
    // 6. FLUJO DE ORDEN ACTIVA
    // ============================================
    if (ordenActiva) {
      // Estado: esperando nombre
      if (ordenActiva.status === "esperando_nombre" && !ordenActiva.customer_name) {
        if (texto.length > 2 && !detectarProducto(texto) && !detectarCiudad(texto)) {
          await actualizarOrden(ordenActiva.id, { 
            customer_name: texto, 
            status: "esperando_ciudad"
          });
          await enviarMensaje(userId, fromNumber, `🙌 Gracias *${texto}*!\n\nAhora pasame tu *ciudad* 📍`);
        } else {
          await enviarMensaje(userId, fromNumber, `📝 Pasame tu *nombre completo* para agendar tu pedido.`);
        }
        return;
      }
      
      // Estado: esperando ciudad
      if (ordenActiva.status === "esperando_ciudad" && !ordenActiva.city) {
        const ciudadOrden = detectarCiudad(texto);
        if (ciudadOrden) {
          await actualizarOrden(ordenActiva.id, { 
            city: ciudadOrden, 
            status: "esperando_direccion"
          });
          await enviarMensaje(userId, fromNumber, `✅ *${ciudadOrden}* tiene envío gratis 🚚\n\nAhora pasame tu *dirección exacta* (calle y número) 📍`);
        } else {
          await enviarMensaje(userId, fromNumber, `📍 ¿Podés decirme tu ciudad? Ej: "San Lorenzo", "Luque", "Capiatá"`);
        }
        return;
      }
      
      // Estado: esperando dirección
      if (ordenActiva.status === "esperando_direccion" && !ordenActiva.address) {
        if (texto.length > 5) {
          const ordenActualizada = await actualizarOrden(ordenActiva.id, { 
            address: texto, 
            status: "confirmando"
          });
          if (ordenActualizada) {
            await confirmarOrden(userId, fromNumber, ordenActualizada);
          }
        } else {
          await enviarMensaje(userId, fromNumber, `📍 Pasame tu *dirección completa* (calle, número, referencia) para coordinar la entrega.`);
        }
        return;
      }
    }
    
    // ============================================
    // 7. RESPONDER CON IA (si no aplicó nada anterior)
    // ============================================
    const respuestaIA = await generarRespuestaIA(userId, texto, fromNumber, ordenActiva);
    
    if (respuestaIA) {
      await enviarMensaje(userId, fromNumber, respuestaIA);
    } else {
      // Mensaje por defecto si la IA no responde
      await enviarMensaje(userId, fromNumber, 
        `🛍️ *MEGA TODO STORE*\n\n¡Hola! Soy Araceli 😊\n\n¿De qué ciudad sos? 📍\nAsí te confirmo si tenemos *envío GRATIS* contra-entrega.\n\n📋 Catálogo: https://cat-logomegatodo-com.vercel.app/`);
    }
    
  } catch (error) {
    console.error("❌ Error procesando mensaje:", error);
    await enviarMensaje(userId, fromNumber, "⚠️ Hubo un error, por favor escribí tu mensaje nuevamente.");
  }
}

// ============================================
// WEBHOOK HANDLER
// ============================================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  // Verificación del webhook (GET)
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    
    console.log("🔐 Verificación webhook - mode:", mode, "token:", token);
    
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verificado correctamente");
      return res.status(200).send(challenge);
    }
    
    console.log("❌ Token inválido para verificación");
    return res.status(403).send("Token inválido");
  }
  
  // Recepción de mensajes (POST)
  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("📨 Webhook POST recibido");
      
      if (body.object !== "whatsapp_business_account") {
        return res.status(404).send("Not WhatsApp event");
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
            console.log("⚠️ No se encontró configuración para phone_number_id:", phoneNumberId);
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
      console.error("❌ Error en webhook POST:", error);
      return res.status(500).json({ error: "Error interno" });
    }
  }
  
  return res.status(405).send("Method Not Allowed");
}
