import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VERIFY_TOKEN = "miTokenSeguro2026";

// ============================================
// CATÁLOGO DE PRECIOS (VIGENTE)
// ============================================
const PRODUCTOS = {
  "afilador de cuchillos y tijeras": { precio: 99000, promo2x: 129900, nombre: "Afilador de Cuchillos y Tijeras" },
  "niveladoras lavarropas": { precio: 98000, nombre: "Niveladoras Lavarropas" },
  "soporte de lavarropas": { precio: 98000, nombre: "Soporte de Lavarropas" },
  "patita lavarropas": { precio: 98000, promo8u: 159000, nombre: "Patita Lavarropas" },
  "cocedor de huevos automático": { precio: 127900, nombre: "Cocedor de Huevos Automático" },
  "karseell collagen": { precio: 109000, nombre: "Karseell Collagen" },
  "veneno de abeja": { precio: 145000, promo2x: 249900, nombre: "Veneno de Abeja" },
  "linterna potente": { precio: 189000, nombre: "Linterna Potente" },
  "intercomunicador para casco": { precio: 169000, promo2x: 269000, nombre: "Intercomunicador para Casco" },
  "alarma antirrobo": { precio: 148900, nombre: "Alarma Antirrobo" },
  "drone": { precio: 279900, nombre: "DRONE" },
  "dron": { precio: 279900, nombre: "DRONE" },
  "tobillera de compresión": { precio: 109000, par: 159000, nombre: "Tobillera de Compresión" },
  "cinta facial": { precio: 139900, nombre: "Cinta Facial" },
  "luces navideñas solar": { precio10m: 139900, precio30m: 179900, nombre: "Luces Navideñas Solar" },
  "plumero limpiaflex": { precio: 99000, promo2x: 129900, nombre: "Plumero LimpiaFlex" },
  "rejilla autoadhesiva": { precio: 99000, nombre: "Rejilla Autoadhesiva" },
  "huevera en forma de gallinita": { precio: 127900, nombre: "Huevera en forma de Gallinita" },
  "wild tornado": { precio: 179900, nombre: "WILD TORNADO" },
  "destapador": { precio: 179900, nombre: "WILD TORNADO" },
  "base flexible p/ muebles": { precio: 139900, nombre: "Base Flexible p/ Muebles" },
  "aspirador portátil powerson": { precio: 129900, nombre: "Aspirador portátil Powerson" },
  "hongo antihongos pro+": { precio: 99000, promo2x1: 159000, nombre: "Hongo Antihongos Pro+" },
  "strikeforce encendedor eterno": { precio: 169900, nombre: "StrikeForce Encendedor eterno" },
  "mini aspiradora": { precio: 129900, nombre: "Mini Aspiradora" },
  "procesador de alimentos raf pro": { precio: 189900, nombre: "Procesador de Alimentos RAF PRO" },
  "raf pro": { precio: 189900, nombre: "Procesador de Alimentos RAF PRO" },
  "rodillera de compresión": { precio: 109000, promo2x: 159900, nombre: "Rodillera de Compresión" },
  "medias terapéuticas": { precio2p: 120000, precio4p: 240000, precio6p: 359000, nombre: "Medias Terapéuticas" },
  "pack bienestar": { precio: 120000, nombre: "Pack Bienestar" },
  "clip nasal anti-ronquidos": { precio: 95000, nombre: "Clip Nasal Anti-Ronquidos" },
  "plantilla ortopiex 5d": { precio: 159000, nombre: "Plantilla Ortopiex 5D" },
  "ortopiex": { precio: 159000, nombre: "Plantilla Ortopiex 5D" },
  "royalbee wax": { precio: 120000, promo2x: 169000, nombre: "RoyalBee Wax" },
  "restaurador royalbee wax": { precio: 120000, promo2x: 169000, nombre: "RoyalBee Wax" },
};

// Nombre canónico de productos para búsqueda
const NOMBRES_PRODUCTOS = Object.keys(PRODUCTOS);

// ============================================
// CIUDADES CON COBERTURA
// ============================================
const CIUDADES_COBERTURA = new Set([
  "asuncion", "asun", "hernandarias", "hernadarias", "ernadaria", "ita", "ciudad del este", "cuidad del este",
  "ciudad del es", "ciudad del", "cde", "fdo de la mora", "fernando de la mora", "fdm", "lambare", "lambaree",
  "luque", "lque", "santa rita", "san alberto", "nemby", "presidente franco", "pte franco", "pdte franco",
  "ypane", "ypanee", "villa hayes", "capiata", "capita", "capia", "capiataa", "altos", "caacupe", "ypacarai",
  "san lorenzo", "sanlo", "slz", "villa elisa", "mariano roque alonso", "mra", "limpio", "aregua", "itaugua",
  "itauguaa", "nueva italia", "villeta", "j augusto saldivar", "jas", "saldivar", "san antonio", "san anotonio",
  "san antoni", "loma pyta", "sajonia", "minga guazu", "minga", "colonia yguazu", "juan leon mallorquin",
  "encarnacion", "concepcion", "san estanislao", "santani", "coronel oviedo", "caaguazu", "paraguari", "yaguaron",
  "atyra", "piribebuy", "tobati", "emboscada", "loma grande", "benjamin aceval", "remansito"
]);

// ============================================
// HELPERS
// ============================================
function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalizeForSearch(text) {
  return cleanText(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizePyPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  let d = digits;
  if (d.startsWith("595")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length > 9) d = d.slice(-9);
  return d;
}

function formatGs(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "A confirmar";
  return `${num.toLocaleString("es-PY")} Gs`;
}

// ============================================
// DETECCIÓN DE PRODUCTO
// ============================================
function detectarProducto(text) {
  const normalized = normalizeForSearch(text);
  if (!normalized) return null;
  
  // Buscar coincidencia exacta o parcial
  for (const [key, data] of Object.entries(PRODUCTOS)) {
    if (normalized.includes(key) || key.split(" ").some(p => normalized.includes(p))) {
      return data;
    }
  }
  return null;
}

function getPrecioProducto(productoData, cantidad = 1) {
  if (!productoData) return null;
  
  // Promociones especiales según cantidad
  if (cantidad === 2 && productoData.promo2x) return productoData.promo2x;
  if (cantidad === 2 && productoData.promo2x1) return productoData.promo2x1;
  if (productoData.precio) return productoData.precio * cantidad;
  if (productoData.precio2p && cantidad === 2) return productoData.precio2p;
  if (productoData.precio4p && cantidad === 4) return productoData.precio4p;
  if (productoData.precio6p && cantidad === 6) return productoData.precio6p;
  if (productoData.par && cantidad === 2) return productoData.par;
  
  return productoData.precio || null;
}

// ============================================
// DETECCIÓN DE CIUDAD
// ============================================
function normalizarCiudad(text) {
  let normalized = normalizeForSearch(text);
  
  // Correcciones específicas
  const correcciones = {
    "c@piata": "capiatá",
    "capiataa": "capiatá",
    "capia": "capiatá",
    "lque": "luque",
    "san anotonio": "san antonio",
    "san antoni": "san antonio",
    "pdte franco": "presidente franco",
    "pte franco": "presidente franco",
    "fdm": "fernando de la mora",
    "mra": "mariano roque alonso",
    "sanlo": "san lorenzo",
    "slz": "san lorenzo",
    "jas": "j augusto saldivar",
    "itauguaa": "itaugua",
    "lambaree": "lambaré",
    "ypanee": "ypané",
  };
  
  for (const [error, correcto] of Object.entries(correcciones)) {
    if (normalized.includes(error)) {
      normalized = correcto;
      break;
    }
  }
  
  // Verificar si es una ciudad con cobertura
  for (const ciudad of CIUDADES_COBERTURA) {
    if (normalized.includes(ciudad)) {
      // Formatear nombre bonito
      const mapaNombres = {
        "asuncion": "Asunción", "ciudad del este": "Ciudad del Este", "cde": "Ciudad del Este",
        "fernando de la mora": "Fernando de la Mora", "fdm": "Fernando de la Mora",
        "presidente franco": "Presidente Franco", "san lorenzo": "San Lorenzo",
        "mariano roque alonso": "Mariano Roque Alonso", "j augusto saldivar": "J. Augusto Saldívar",
        "san antonio": "San Antonio", "minga guazu": "Minga Guazú", "caacupe": "Caacupé",
        "ypacarai": "Ypacaraí", "villa hayes": "Villa Hayes", "benjamin aceval": "Benjamín Aceval"
      };
      return mapaNombres[ciudad] || ciudad.charAt(0).toUpperCase() + ciudad.slice(1);
    }
  }
  
  // Zonas ambiguas
  if (normalized.includes("central")) return { type: "ambiguous", reply: "📍 ¿De qué ciudad de Central sos? 😊\nPodés decirme: San Lorenzo, Luque, Capiatá, Areguá, Itá, Itauguá, Ñemby, Villa Elisa, Mariano Roque Alonso o Limpio." };
  if (normalized.includes("alto parana")) return { type: "ambiguous", reply: "📍 ¿Ciudad del Este, Presidente Franco o Hernandarias? 😊" };
  if (normalized.includes("presidente hayes")) return { type: "ambiguous", reply: "📍 ¿Villa Hayes, Benjamín Aceval o Remansito? 😊" };
  
  return null;
}

// ============================================
// DETECCIÓN DE INTENCIÓN
// ============================================
function isPreguntandoPrecio(text) {
  const normalized = normalizeText(text);
  const keywords = ["precio", "cuanto cuesta", "cuánto cuesta", "costo", "valor", "sale", "cuanto vale", "precio de"];
  return keywords.some(kw => normalized.includes(kw));
}

function isIntencionCompra(text) {
  const normalized = normalizeText(text);
  const keywords = ["quiero", "comprar", "pedido", "me interesa", "si", "sí", "ok", "dale", "confirmo", "1", "2"];
  return keywords.some(kw => normalized.includes(kw));
}

function detectarCantidad(text) {
  const normalized = normalizeText(text);
  if (normalized.includes("2") || normalized.includes("dos") || normalized.includes("2 unidades")) return 2;
  if (normalized.includes("3") || normalized.includes("tres") || normalized.includes("3 unidades")) return 3;
  if (normalized.includes("4") || normalized.includes("cuatro") || normalized.includes("4 unidades")) return 4;
  if (normalized.includes("5") || normalized.includes("cinco") || normalized.includes("5 unidades")) return 5;
  if (normalized.includes("6") || normalized.includes("seis") || normalized.includes("6 unidades")) return 6;
  if (normalized.includes("8") || normalized.includes("ocho") || normalized.includes("8 unidades")) return 8;
  return 1;
}

// ============================================
// RESPUESTAS DIRECTAS
// ============================================
async function responderPrecio(userId, fromNumber, productoData, productoNombre) {
  const precioNormal = productoData.precio ? formatGs(productoData.precio) : null;
  const precioPromo2x = productoData.promo2x ? formatGs(productoData.promo2x) : null;
  const precioPar = productoData.par ? formatGs(productoData.par) : null;
  
  let mensaje = `💰 *${productoData.nombre}*`;
  
  if (precioNormal) mensaje += `\n✅ 1 unidad: ${precioNormal}`;
  if (precioPromo2x) mensaje += `\n🔥 2 unidades: ${precioPromo2x}`;
  if (precioPar) mensaje += `\n👟 Par (2 unidades): ${precioPar}`;
  
  mensaje += `\n\n🚚 *ENVÍO GRATIS* contra-entrega\n💵 Pagás al recibir\n\n¿Te interesa llevarlo? 😊
  
📋 Catálogo completo: https://cat-logomegatodo-com.vercel.app/`;
  
  await sendWhatsAppMessage(userId, fromNumber, mensaje);
}

async function responderConCobertura(userId, fromNumber, ciudad, productoData = null) {
  let mensaje = `✅ Perfecto! 😊 *${ciudad}* tiene ENVÍO GRATIS contra-entrega 🚚\n💵 Pagás al recibir SIN moverte de casa\n🏪 Somos Mega Todo Store - tienda oficial con cientos de entregas exitosas ✅\n\n`;
  
  if (productoData) {
    const precio = getPrecioProducto(productoData, 1);
    mensaje += `📦 *${productoData.nombre}* - ${formatGs(precio)}\n\n`;
  }
  
  mensaje += `¿Te parece si te agendo ahora mismo? ¿Nombre y teléfono? 📝`;
  
  await sendWhatsAppMessage(userId, fromNumber, mensaje);
}

async function responderSinCobertura(userId, fromNumber, ciudad, productoData = null) {
  let mensaje = `ℹ️ *${ciudad}* no está dentro de la zona de contra-entrega 💳\n😄 Pero no te preocupes, enviamos con transportadoras seguras:\n🚚 TSI / NASA / Occidental / MG Express / Multienvíos\n\n📦 En esa ciudad el pedido se hace con pago anticipado\n💳 ¿Querés que te pase los datos para reservarte? 🙌`;
  
  await sendWhatsAppMessage(userId, fromNumber, mensaje);
}

async function confirmarPedido(userId, fromNumber, datos) {
  const producto = datos.producto?.nombre || datos.producto || "Producto";
  const cliente = datos.customer_name || "Cliente";
  const ciudad = datos.city || "Ciudad";
  const direccion = datos.address || "Dirección";
  const telefono = datos.from_number || fromNumber;
  const cantidad = datos.quantity || 1;
  const total = datos.total_amount || getPrecioProducto(datos.producto, cantidad);
  
  const mensaje = `✅ PEDIDO CONFIRMADO
━━━━━━━━━━━━━━━━━━━━━━
✅ Producto: ${producto}
✅ Cliente: ${cliente}
✅ Ubicación: ${ciudad} — ${direccion}
✅ Contacto: ${telefono}
✅ Cantidad: ${cantidad} u.

💰 Total: ${formatGs(total)}
🚚 Envío GRATIS · Pagás al recibir
⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

📋 Catálogo completo: https://cat-logomegatodo-com.vercel.app/`;
  
  await sendWhatsAppMessage(userId, fromNumber, mensaje);
}

// ============================================
// WHATSAPP
// ============================================
async function sendWhatsAppMessage(userId, to, message) {
  try {
    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("phone_number_id, permanent_token")
      .eq("user_id", userId)
      .single();
    
    if (configError || !config?.phone_number_id || !config?.permanent_token) return null;
    
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.permanent_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    });
    
    const result = await response.json().catch(() => ({}));
    
    if (!response.ok) {
      console.error("Error enviando a Meta:", result);
      return null;
    }
    
    await supabase.from("received_messages").insert({
      user_id: userId,
      platform: "whatsapp",
      from_number: to,
      message,
      message_type: "out_text",
      is_processed: true,
      created_at: new Date().toISOString(),
    });
    
    return result;
  } catch (error) {
    console.error("Error enviando mensaje:", error);
    return null;
  }
}

// ============================================
// ORDERS
// ============================================
async function getOpenOrder(userId, fromNumber) {
  try {
    const normalizedIncoming = normalizePyPhone(fromNumber);
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .in("status", ["draft", "collecting_name", "collecting_city", "collecting_address"])
      .order("created_at", { ascending: false })
      .limit(20);
    
    if (error || !data?.length) return null;
    
    // Solo pedidos de últimos 30 minutos
    const recentOrders = data.filter(order => {
      const orderDate = new Date(order.created_at);
      const minutesDiff = (Date.now() - orderDate) / 1000 / 60;
      return minutesDiff < 30;
    });
    
    const exact = recentOrders.find(row => normalizePyPhone(row.from_number) === normalizedIncoming);
    return exact || recentOrders[0] || null;
  } catch { return null; }
}

async function updateOrder(orderId, payload = {}) {
  try {
    const { data, error } = await supabase
      .from("orders")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .select("*")
      .single();
    return error ? null : data;
  } catch { return null; }
}

async function createOrderDraft(userId, fromNumber, payload = {}) {
  try {
    const { data, error } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        from_number: fromNumber,
        product: payload.product?.nombre || payload.product || null,
        customer_name: payload.customer_name || null,
        city: payload.city || null,
        address: payload.address || null,
        quantity: payload.quantity || 1,
        total_amount: payload.total_amount || null,
        status: payload.status || "collecting_name",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    return error ? null : data;
  } catch { return null; }
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
async function procesarMensaje(message, token, userId, fromNumber) {
  try {
    const type = message.type;
    let contenido = "";
    
    if (type === "text") {
      contenido = cleanText(message.text?.body || "");
    } else if (type === "audio") {
      await sendWhatsAppMessage(userId, fromNumber, "¡Gracias por tu audio! 👌 Entendí tu consulta. ¿Podés escribirnos tu mensaje para ayudarte mejor? 🎧");
      return;
    } else {
      return;
    }
    
    if (!contenido) return;
    
    console.log(`📩 Mensaje de ${fromNumber}: ${contenido}`);
    
    // ============================================
    // 1. DETECTAR CIUDAD (PRIMERO)
    // ============================================
    const ciudadInfo = normalizarCiudad(contenido);
    
    if (ciudadInfo && typeof ciudadInfo === 'string') {
      // Ciudad con cobertura detectada
      await responderConCobertura(userId, fromNumber, ciudadInfo);
      return;
    }
    
    if (ciudadInfo?.type === "ambiguous") {
      await sendWhatsAppMessage(userId, fromNumber, ciudadInfo.reply);
      return;
    }
    
    // ============================================
    // 2. DETECTAR PRODUCTO Y PRECIO
    // ============================================
    const productoDetectado = detectarProducto(contenido);
    const preguntaPrecio = isPreguntandoPrecio(contenido);
    
    if (preguntaPrecio && productoDetectado) {
      await responderPrecio(userId, fromNumber, productoDetectado, productoDetectado.nombre);
      return;
    }
    
    if (preguntaPrecio && !productoDetectado) {
      await sendWhatsAppMessage(userId, fromNumber, 
        "💰 Te invito a revisar nuestro catálogo oficial con todos los productos y precios actualizados:\n\n📋 https://cat-logomegatodo-com.vercel.app/\n\n¿Qué producto te interesa? 😊");
      return;
    }
    
    // ============================================
    // 3. MANEJO DE PEDIDO EXISTENTE
    // ============================================
    const openOrder = await getOpenOrder(userId, fromNumber);
    const intencionCompra = isIntencionCompra(contenido);
    
    if (openOrder) {
      // Continuar con el flujo del pedido
      if (openOrder.status === "collecting_name" && !openOrder.customer_name) {
        const updated = await updateOrder(openOrder.id, { customer_name: contenido, status: "collecting_city" });
        if (updated) {
          await sendWhatsAppMessage(userId, fromNumber, `Perfecto 🙌 Ahora pasame tu ciudad.`);
        }
        return;
      }
      
      if (openOrder.status === "collecting_city" && !openOrder.city) {
        const ciudadInfo2 = normalizarCiudad(contenido);
        if (ciudadInfo2 && typeof ciudadInfo2 === 'string') {
          const updated = await updateOrder(openOrder.id, { city: ciudadInfo2, status: "collecting_address" });
          if (updated) {
            await sendWhatsAppMessage(userId, fromNumber, `Genial 😊 Ahora pasame tu dirección exacta 📍`);
          }
        } else {
          await sendWhatsAppMessage(userId, fromNumber, `¿Podés decirme tu ciudad? 😊`);
        }
        return;
      }
      
      if (openOrder.status === "collecting_address") {
        const updated = await updateOrder(openOrder.id, { address: contenido, status: "draft" });
        if (updated && updated.customer_name && updated.city && updated.address) {
          const productoData = detectarProducto(updated.product);
          const total = getPrecioProducto(productoData, updated.quantity || 1);
          await updateOrder(openOrder.id, { total_amount: total });
          await confirmarPedido(userId, fromNumber, { ...updated, producto: productoData, total_amount: total });
        } else {
          await sendWhatsAppMessage(userId, fromNumber, `Gracias 📍 Ahora confirmamos tu pedido.`);
        }
        return;
      }
      
      if (openOrder.status === "draft" && openOrder.customer_name && openOrder.city && openOrder.address) {
        await confirmarPedido(userId, fromNumber, openOrder);
        return;
      }
    }
    
    // ============================================
    // 4. INICIAR NUEVO PEDIDO (si hay intención o producto)
    // ============================================
    if (intencionCompra && productoDetectado) {
      const total = getPrecioProducto(productoDetectado, 1);
      const newOrder = await createOrderDraft(userId, fromNumber, {
        product: productoDetectado,
        quantity: detectarCantidad(contenido),
        total_amount: total,
        status: "collecting_name"
      });
      
      if (newOrder) {
        await sendWhatsAppMessage(userId, fromNumber, 
          `🎯 *${productoDetectado.nombre}* - ${formatGs(total)}\n\n✅ ¡Excelente elección!\n\n📝 Para agendar tu pedido, pasame tu *nombre completo*.`);
      }
      return;
    }
    
    if (productoDetectado && !intencionCompra) {
      const total = getPrecioProducto(productoDetectado, 1);
      await sendWhatsAppMessage(userId, fromNumber, 
        `🛍️ *${productoDetectado.nombre}* - ${formatGs(total)}\n🚚 Envío GRATIS contra-entrega\n💵 Pagás al recibir\n\n¿Te interesa llevarlo? 😊`);
      return;
    }
    
    // ============================================
    // 5. SALUDO INICIAL O MENSAJE NO DETECTADO
    // ============================================
    await sendWhatsAppMessage(userId, fromNumber, 
      `🛍️ *MEGA TODO STORE* - Envío a todo Paraguay 🚚

¡Hola! Soy Araceli 😊
Para ayudarte mejor, ¿de qué ciudad sos? 📍
Así te confirmo si tenemos envío contra-entrega en tu zona.

📋 Catálogo completo: https://cat-logomegatodo-com.vercel.app/`);
    
  } catch (err) {
    console.error("❌ Error procesando mensaje:", err);
  }
}

// ============================================
// WEBHOOK HANDLER
// ============================================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
    return res.status(403).send("Token inválido");
  }
  
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return res.status(404).send("Not WhatsApp event");
      
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id;
          if (!phoneNumberId) continue;
          
          const { data: config, error: configError } = await supabase
            .from("whatsapp_config")
            .select("user_id, permanent_token, phone_number_id")
            .eq("phone_number_id", phoneNumberId)
            .single();
          
          if (configError || !config?.user_id) continue;
          
          const userId = config.user_id;
          const token = config.permanent_token;
          
          if (value.messages) {
            for (const message of value.messages) {
              await procesarMensaje(message, token, userId, message.from);
            }
          }
        }
      }
      
      return res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("❌ Error en webhook:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
  
  return res.status(405).send("Method Not Allowed");
}
