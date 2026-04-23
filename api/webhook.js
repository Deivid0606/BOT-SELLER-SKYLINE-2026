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
  "veneno de abeja": { nombre: "Veneno de Abeja", precio: 145000, promo2x: 249900 },
  "linterna": { nombre: "Linterna Potente", precio: 189000 },
  "intercomunicador": { nombre: "Intercomunicador para Casco", precio: 169000, promo2x: 269000 },
  "alarma": { nombre: "Alarma Antirrobo", precio: 148900 },
  "drone": { nombre: "DRONE", precio: 279900 },
  "dron": { nombre: "DRONE", precio: 279900 },
  "tobillera": { nombre: "Tobillera de Compresión", precio: 109000, par: 159000 },
  "rodillera": { nombre: "Rodillera de Compresión", precio: 109000, promo2x: 159900 },
  "medias": { nombre: "Medias Terapéuticas", precio2p: 120000, precio4p: 240000, precio6p: 359000 },
  "clip nasal": { nombre: "Clip Nasal Anti-Ronquidos", precio: 95000 },
  "ortopiex": { nombre: "Plantilla Ortopiex 5D", precio: 159000 },
  "plantilla": { nombre: "Plantilla Ortopiex 5D", precio: 159000 },
  "royalbee": { nombre: "RoyalBee Wax", precio: 120000, promo2x: 169000 },
  "wild tornado": { nombre: "WILD TORNADO", precio: 179900 },
  "hongo": { nombre: "Hongo Antihongos Pro+", precio: 99000, promo2x1: 159000 },
  "huevera": { nombre: "Huevera en forma de Gallinita", precio: 127900 },
  "aspiradora": { nombre: "Aspirador portátil Powerson", precio: 129900 },
  "mini aspiradora": { nombre: "Mini Aspiradora", precio: 129900 },
  "raf pro": { nombre: "Procesador de Alimentos RAF PRO", precio: 189900 },
  "strikeforce": { nombre: "StrikeForce Encendedor eterno", precio: 169900 },
  "luces": { nombre: "Luces Navideñas Solar", precio10m: 139900, precio30m: 179900 },
  "cinta facial": { nombre: "Cinta Facial", precio: 139900 },
  "rejilla": { nombre: "Rejilla Autoadhesiva", precio: 99000 },
  "base flexible": { nombre: "Base Flexible p/ Muebles", precio: 139900 },
};

// ============================================
// CIUDADES CON COBERTURA
// ============================================
const CIUDADES = {
  "asuncion": "Asunción",
  "asun": "Asunción",
  "capiatá": "Capiatá", "capiata": "Capiatá", "capiataa": "Capiatá", "c@piata": "Capiatá", "capia": "Capiatá",
  "luque": "Luque", "lque": "Luque",
  "san lorenzo": "San Lorenzo", "sanlo": "San Lorenzo", "slz": "San Lorenzo",
  "lambaré": "Lambaré", "lambare": "Lambaré", "lambaree": "Lambaré",
  "fernando de la mora": "Fernando de la Mora", "fdm": "Fernando de la Mora",
  "ciudad del este": "Ciudad del Este", "cde": "Ciudad del Este",
  "presidente franco": "Presidente Franco", "pte franco": "Presidente Franco",
  "hernandarias": "Hernandarias", "hernadarias": "Hernandarias",
  "limpie": "Limpio", "limpio": "Limpio",
  "ita": "Itá",
  "itaugua": "Itauguá", "itauguaa": "Itauguá",
  "aregua": "Areguá",
  "villa elisa": "Villa Elisa",
  "mariano roque alonso": "Mariano Roque Alonso", "mra": "Mariano Roque Alonso",
  "nemby": "Ñemby",
  "ypane": "Ypané", "ypanee": "Ypané",
  "villa hayes": "Villa Hayes",
  "san antonio": "San Antonio", "san anotonio": "San Antonio", "san antoni": "San Antonio",
  "j augusto saldivar": "J. Augusto Saldívar", "jas": "J. Augusto Saldívar", "saldivar": "J. Augusto Saldívar",
  "altos": "Altos",
  "caacupe": "Caacupé",
  "ypacarai": "Ypacaraí",
  "villeta": "Villeta",
  "nueva italia": "Nueva Italia",
  "minga guazu": "Minga Guazú", "minga": "Minga Guazú",
  "santa rita": "Santa Rita",
  "san alberto": "San Alberto",
  "encarnacion": "Encarnación",
  "concepcion": "Concepción",
  "coronel oviedo": "Coronel Oviedo",
  "caaguazu": "Caaguazú",
  "paraguari": "Paraguarí",
  "yaguaron": "Yaguarón",
  "atyra": "Atyrá",
  "piribebuy": "Piribebuy",
  "tobati": "Tobatí",
  "emboscada": "Emboscada",
  "loma grande": "Loma Grande",
  "benjamin aceval": "Benjamín Aceval",
  "remansito": "Remansito",
};

// ============================================
// HELPERS
// ============================================
function cleanText(text) {
  return String(text || "").trim().toLowerCase();
}

function formatGs(value) {
  if (!value) return "Consultar";
  return `${value.toLocaleString("es-PY")} Gs`;
}

function detectarProducto(text) {
  const lower = cleanText(text);
  for (const [key, data] of Object.entries(PRODUCTOS)) {
    if (lower.includes(key)) {
      return { ...data, clave: key };
    }
  }
  return null;
}

function detectarCiudad(text) {
  const lower = cleanText(text);
  for (const [alias, ciudad] of Object.entries(CIUDADES)) {
    if (lower.includes(alias)) {
      return ciudad;
    }
  }
  return null;
}

function detectarCantidad(text) {
  const lower = cleanText(text);
  if (lower.includes("2") || lower.includes("dos")) return 2;
  if (lower.includes("3") || lower.includes("tres")) return 3;
  if (lower.includes("4") || lower.includes("cuatro")) return 4;
  if (lower.includes("5") || lower.includes("cinco")) return 5;
  if (lower.includes("6") || lower.includes("seis")) return 6;
  return 1;
}

function calcularPrecio(producto, cantidad = 1) {
  if (!producto) return null;
  
  if (cantidad === 2 && producto.promo2x) return producto.promo2x;
  if (cantidad === 2 && producto.par) return producto.par;
  if (cantidad === 2 && producto.promo2x1) return producto.promo2x1;
  if (producto.precio) return producto.precio * cantidad;
  if (producto.precio2p && cantidad === 2) return producto.precio2p;
  if (producto.precio4p && cantidad === 4) return producto.precio4p;
  if (producto.precio6p && cantidad === 6) return producto.precio6p;
  if (producto.precio10m) return producto.precio10m;
  if (producto.precio30m) return producto.precio30m;
  
  return producto.precio || null;
}

// ============================================
// FUNCIONES DE ORDEN
// ============================================
async function getPedidoActivo(userId, fromNumber) {
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", userId)
    .eq("from_number", fromNumber)
    .in("status", ["esperando_nombre", "esperando_ciudad", "esperando_direccion", "confirmar"])
    .order("created_at", { ascending: false })
    .limit(1);
  
  return data?.[0] || null;
}

async function crearPedido(userId, fromNumber, producto, cantidad) {
  const precioTotal = calcularPrecio(producto, cantidad);
  
  const { data, error } = await supabase
    .from("orders")
    .insert({
      user_id: userId,
      from_number: fromNumber,
      product: producto.nombre,
      quantity: cantidad,
      total_amount: precioTotal,
      status: "esperando_nombre",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  
  return error ? null : data;
}

async function actualizarPedido(id, datos) {
  const { data, error } = await supabase
    .from("orders")
    .update({ ...datos, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  
  return error ? null : data;
}

// ============================================
// RESPUESTAS
// ============================================
async function enviarMensaje(userId, to, message) {
  try {
    const { data: config } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .single();
    
    if (!config?.phone_number_id || !config?.permanent_token) return null;
    
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
    
    await supabase.from("received_messages").insert({
      user_id: userId,
      platform: "whatsapp",
      from_number: to,
      message: message,
      message_type: "out_text",
      created_at: new Date().toISOString(),
    });
    
    return response.ok;
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    return false;
  }
}

// ============================================
// CONFIRMAR PEDIDO
// ============================================
async function confirmarPedido(userId, fromNumber, pedido) {
  const producto = PRODUCTOS[cleanText(pedido.product).toLowerCase()] || { nombre: pedido.product };
  const total = pedido.total_amount || calcularPrecio(producto, pedido.quantity);
  
  const mensaje = `✅ *PEDIDO CONFIRMADO* ✅
━━━━━━━━━━━━━━━━━━━━━━
✅ Producto: ${pedido.product}
✅ Cliente: ${pedido.customer_name}
✅ Ciudad: ${pedido.city}
✅ Dirección: ${pedido.address}
✅ Cantidad: ${pedido.quantity} u.
✅ Teléfono: ${pedido.from_number}

💰 *Total: ${formatGs(total)} Gs*
🚚 Envío GRATIS · Pagás al recibir

¡Gracias por elegir Mega Todo Store! 💜✨

📋 Catálogo: https://cat-logomegatodo-com.vercel.app/`;
  
  await enviarMensaje(userId, fromNumber, mensaje);
  await actualizarPedido(pedido.id, { status: "completado" });
}

// ============================================
// PROCESAR MENSAJE PRINCIPAL
// ============================================
async function procesarMensaje(message, token, userId, fromNumber) {
  if (message.type !== "text") {
    await enviarMensaje(userId, fromNumber, "📝 Por favor escribí tu mensaje para poder ayudarte mejor.");
    return;
  }
  
  const texto = cleanText(message.text?.body || "");
  if (!texto) return;
  
  console.log(`📩 ${fromNumber}: ${texto}`);
  
  // ============================================
  // 1. BUSCAR PEDIDO ACTIVO
  // ============================================
  let pedidoActivo = await getPedidoActivo(userId, fromNumber);
  
  // ============================================
  // 2. CIUDAD (RESPUESTA DIRECTA)
  // ============================================
  const ciudad = detectarCiudad(texto);
  if (ciudad && !pedidoActivo) {
    await enviarMensaje(userId, fromNumber, 
      `✅ *Perfecto!* 😊\n\n${ciudad} tiene *ENVÍO GRATIS* contra-entrega 🚚\n💵 Pagás al recibir SIN moverte de casa\n\n🏪 Somos Mega Todo Store - tienda oficial\n\n¿Qué producto te gustaría pedir? 📝\n\n📋 Catálogo: https://cat-logomegatodo-com.vercel.app/`);
    return;
  }
  
  // ============================================
  // 3. PRECIO
  // ============================================
  const esPrecio = texto.includes("precio") || texto.includes("cuanto") || texto.includes("cuesta");
  const productoPrecio = detectarProducto(texto);
  
  if (esPrecio && productoPrecio) {
    let mensajePrecio = `💰 *${productoPrecio.nombre}*\n\n`;
    mensajePrecio += `✅ 1 unidad: ${formatGs(productoPrecio.precio)}\n`;
    if (productoPrecio.promo2x) mensajePrecio += `🔥 2 unidades: ${formatGs(productoPrecio.promo2x)}\n`;
    if (productoPrecio.par) mensajePrecio += `👟 Par (2 und): ${formatGs(productoPrecio.par)}\n`;
    mensajePrecio += `\n🚚 *ENVÍO GRATIS* contra-entrega\n💵 Pagás al recibir\n\n¿Te interesa? 😊`;
    
    await enviarMensaje(userId, fromNumber, mensajePrecio);
    return;
  }
  
  // ============================================
  // 4. PRODUCTO (INICIAR NUEVO PEDIDO)
  // ============================================
  const producto = detectarProducto(texto);
  const esCompra = texto.includes("quiero") || texto.includes("comprar") || texto.includes("me interesa") || texto.includes("si") || texto === "si" || texto === "sí";
  
  if (producto && (esCompra || !pedidoActivo)) {
    const cantidad = detectarCantidad(texto);
    const precio = calcularPrecio(producto, cantidad);
    
    const nuevoPedido = await crearPedido(userId, fromNumber, producto, cantidad);
    
    if (nuevoPedido) {
      await enviarMensaje(userId, fromNumber, 
        `🛍️ *${producto.nombre}* - ${formatGs(precio)} Gs\n\n✅ ¡Excelente elección!\n\n📝 Para agendar tu pedido, pasame tu *nombre completo*.`);
    }
    return;
  }
  
  // ============================================
  // 5. FLUJO DEL PEDIDO (si existe pedido activo)
  // ============================================
  if (pedidoActivo) {
    // Esperando NOMBRE
    if (pedidoActivo.status === "esperando_nombre" && !pedidoActivo.customer_name) {
      await actualizarPedido(pedidoActivo.id, { customer_name: texto, status: "esperando_ciudad" });
      await enviarMensaje(userId, fromNumber, `🙌 Gracias *${texto}*!\n\nAhora pasame tu *ciudad* 📍`);
      return;
    }
    
    // Esperando CIUDAD
    if (pedidoActivo.status === "esperando_ciudad" && !pedidoActivo.city) {
      const ciudadPedido = detectarCiudad(texto);
      if (ciudadPedido) {
        await actualizarPedido(pedidoActivo.id, { city: ciudadPedido, status: "esperando_direccion" });
        await enviarMensaje(userId, fromNumber, `✅ *${ciudadPedido}* tiene envío gratis 🚚\n\nAhora pasame tu *dirección exacta* 📍`);
      } else {
        await enviarMensaje(userId, fromNumber, `📍 ¿Podés decirme tu ciudad? Ej: "San Lorenzo", "Luque", "Capiatá"`);
      }
      return;
    }
    
    // Esperando DIRECCIÓN
    if (pedidoActivo.status === "esperando_direccion" && !pedidoActivo.address) {
      if (texto.length > 5) {
        const pedidoActualizado = await actualizarPedido(pedidoActivo.id, { address: texto, status: "confirmar" });
        if (pedidoActualizado) {
          await confirmarPedido(userId, fromNumber, pedidoActualizado);
        }
      } else {
        await enviarMensaje(userId, fromNumber, `📍 Pasame tu dirección completa (calle y número) para coordinar la entrega.`);
      }
      return;
    }
  }
  
  // ============================================
  // 6. MENSAJE POR DEFECTO (SALUDO)
  // ============================================
  await enviarMensaje(userId, fromNumber, 
    `🛍️ *MEGA TODO STORE*\n\n¡Hola! Soy Araceli 😊\n\nPara empezar, ¿de qué ciudad sos? 📍\nAsí te confirmo si tenemos *envío GRATIS* contra-entrega en tu zona.\n\n📋 Catálogo completo: https://cat-logomegatodo-com.vercel.app/`);
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
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Token inválido");
  }
  
  if (req.method === "POST") {
    try {
      const body = req.body;
      
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
      console.error("Error:", error);
      return res.status(500).json({ error: "Error interno" });
    }
  }
  
  return res.status(405).send("Method Not Allowed");
}
