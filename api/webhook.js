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

function normalizeLocationText(text) {
  return normalizeForSearch(text).replace(/@/g, "a");
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

function looksLikeGoogleMaps(text) {
  const t = String(text || "").toLowerCase();
  return (
    t.includes("google.com/maps") ||
    t.includes("maps.app.goo.gl") ||
    t.includes("goo.gl/maps") ||
    t.includes("https://maps") ||
    t.includes("ubicacion:") ||
    t.includes("ubicación:")
  );
}

function isDetailedAddress(text) {
  const raw = cleanText(text);
  const normalized = normalizeForSearch(raw);

  if (!raw) return false;
  if (looksLikeGoogleMaps(raw)) return true;

  const words = normalized.split(" ").filter(Boolean);
  const hasNumber = /\d/.test(raw);
  const hasReferenceWords =
    normalized.includes("casi") ||
    normalized.includes("frente") ||
    normalized.includes("esquina") ||
    normalized.includes("al lado") ||
    normalized.includes("cerca") ||
    normalized.includes("entre") ||
    normalized.includes("referencia");

  return words.length >= 4 && (hasNumber || hasReferenceWords);
}

function formatGs(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return "A confirmar";
  return `${num.toLocaleString("es-PY")} Gs`;
}

// ============================================
// PRODUCTOS ACTIVOS
// ============================================
const PRODUCT_CATALOG = [
  { name: "Afilador de Cuchillos y Tijeras", aliases: ["afilador", "afilador de cuchillos", "afilador de cuchillos y tijeras"] },
  { name: "Veneno de Abeja", aliases: ["veneno de abeja", "crema de veneno de abeja", "abeja"] },
  { name: "DRONE", aliases: ["dron", "drone"] },
  { name: "Linterna Potente", aliases: ["linterna", "linterna potente"] },
  { name: "Mini Aspiradora", aliases: ["mini aspiradora", "aspiradora pequeña", "aspiradora"] },
  { name: "Procesador de Alimentos RAF PRO", aliases: ["raf pro", "procesador raf", "procesador de alimentos", "raf"] },
  { name: "Plantillas Ortopiex 5D", aliases: ["ortopiex", "plantillas ortopiex", "plantillas", "plantillas ortopedicas"] },
  { name: "Medias Terapéuticas", aliases: ["medias terapeuticas", "medias compresion", "pack bienestar"] },
  { name: "Rodillera de Compresión", aliases: ["rodillera", "rodillera de compresion"] },
  { name: "Tobillera de Compresión", aliases: ["tobillera", "tobillera de compresion"] },
  { name: "Karseell Collagen", aliases: ["karseell", "karseell collagen"] },
  { name: "Cocedor de Huevos Automático", aliases: ["cocedor de huevos", "huevos automatico", "cocedor"] },
  { name: "Plumero LimpiaFlex", aliases: ["plumero", "plumero limpiaflex", "limpiaflex"] },
  { name: "Niveladoras Lavarropas", aliases: ["niveladora lavarropas", "niveladoras lavarropas", "soporte de lavarropas", "patita lavarropas", "patitas lavarropas", "niveladora", "lavarropas"] },
  { name: "Aspirador portátil Powerson", aliases: ["powerson", "aspirador portatil", "aspirador portátil"] },
  { name: "Alarma Antirrobo", aliases: ["alarma antirrobo", "alarma"] },
  { name: "Intercomunicador para Casco", aliases: ["intercomunicador", "intercomunicador casco"] },
  { name: "Clip Nasal Anti-Ronquidos", aliases: ["clip nasal", "anti ronquidos", "antironquidos", "ronquidos"] },
  { name: "Huevera en forma de Gallinita", aliases: ["huevera", "gallinita"] },
  { name: "WILD TORNADO", aliases: ["wild tornado", "destapador"] },
  { name: "Base Flexible p/ Muebles", aliases: ["base flexible", "muebles"] },
  { name: "Hongo Antihongos Pro+", aliases: ["hongo antihongos", "antihongos"] },
  { name: "StrikeForce Encendedor eterno", aliases: ["strikeforce", "encendedor eterno"] },
  { name: "RoyalBee Wax", aliases: ["royalbee", "royalbee wax"] },
];

function detectProductFromText(text) {
  const normalized = normalizeForSearch(text);
  if (!normalized) return null;

  const sorted = [...PRODUCT_CATALOG].sort((a, b) => Math.max(...b.aliases.map(x => x.length)) - Math.max(...a.aliases.map(x => x.length)));

  for (const product of sorted) {
    for (const alias of product.aliases) {
      if (normalized.includes(normalizeForSearch(alias))) return product.name;
    }
  }
  return null;
}

// ============================================
// CIUDADES
// ============================================
const CIUDADES_COBERTURA = [
  "asuncion", "asun", "hernandarias", "hernadarias", "ernadaria", "ita", "ciudad del este", "cuidad del este",
  "ciudad del es", "ciudad del", "cde", "fdo de la mora", "fernando de la mora", "fdm", "lambare", "lambaree",
  "luque", "lque", "santa rita", "san alberto", "nemby", "presidente franco", "pte franco", "pdte franco",
  "ypane", "ypanee", "villa hayes", "capiata", "capita", "capia", "capiataa", "altos", "caacupe", "ypacarai",
  "san lorenzo", "sanlo", "slz", "villa elisa", "mariano roque alonso", "mra", "limpio", "aregua", "itaugua",
  "itauguaa", "nueva italia", "villeta", "j augusto saldivar", "jas", "saldivar", "san antonio", "san anotonio",
  "san antoni", "loma pyta", "sajonia", "minga guazu", "minga", "colonia yguazu", "juan leon mallorquin",
  "encarnacion", "concepcion", "san estanislao", "santani", "coronel oviedo", "caaguazu", "paraguari", "yaguaron",
  "atyra", "piribebuy", "tobati", "emboscada", "loma grande", "benjamin aceval", "remansito"
];

const ZONAS_AMBIGUAS = {
  central: "📍 ¿De qué ciudad de Central sos? 😊\nPodés decirme por ejemplo: San Lorenzo, Luque, Capiatá, Areguá, Itá, Itauguá, Ñemby, Villa Elisa, Mariano Roque Alonso o Limpio.",
  "alto parana": "📍 ¿Ciudad del Este, Presidente Franco o Hernandarias? 😊",
  "presidente hayes": "📍 ¿Villa Hayes, Benjamín Aceval o Remansito? 😊"
};

const NO_CIUDADES = ["km 10", "monday", "multiplaza"];

function detectCoverageCity(text) {
  const normalized = normalizeLocationText(text);
  for (const bad of NO_CIUDADES) if (normalized.includes(bad)) return { type: "ignore", value: bad };
  for (const [zone, reply] of Object.entries(ZONAS_AMBIGUAS)) if (normalized.includes(zone)) return { type: "ambiguous", value: zone, reply };
  const sorted = [...CIUDADES_COBERTURA].sort((a, b) => b.length - a.length);
  for (const city of sorted) if (normalized.includes(city)) return { type: "coverage", value: city };
  return null;
}

function formatCityName(city) {
  const map = {
    asuncion: "Asunción", asun: "Asunción", hernandarias: "Hernandarias", hernadarias: "Hernandarias",
    ernadaria: "Hernandarias", ita: "Itá", "ciudad del este": "Ciudad del Este", "cuidad del este": "Ciudad del Este",
    "ciudad del es": "Ciudad del Este", "ciudad del": "Ciudad del Este", cde: "Ciudad del Este",
    "fdo de la mora": "Fernando de la Mora", fdm: "Fernando de la Mora", "fernando de la mora": "Fernando de la Mora",
    lambare: "Lambaré", lambaree: "Lambaré", luque: "Luque", lque: "Luque", "santa rita": "Santa Rita",
    "san alberto": "San Alberto", nemby: "Ñemby", "presidente franco": "Presidente Franco", "pte franco": "Presidente Franco",
    "pdte franco": "Presidente Franco", ypane: "Ypané", ypanee: "Ypané", "villa hayes": "Villa Hayes",
    capiata: "Capiatá", capita: "Capiatá", capia: "Capiatá", capiataa: "Capiatá", altos: "Altos", caacupe: "Caacupé",
    ypacarai: "Ypacaraí", "san lorenzo": "San Lorenzo", sanlo: "San Lorenzo", slz: "San Lorenzo", "villa elisa": "Villa Elisa",
    "mariano roque alonso": "Mariano Roque Alonso", mra: "Mariano Roque Alonso", limpio: "Limpio", aregua: "Areguá",
    itaugua: "Itauguá", itauguaa: "Itauguá", "nueva italia": "Nueva Italia", villeta: "Villeta", "j augusto saldivar": "J. Augusto Saldívar",
    jas: "J. Augusto Saldívar", saldivar: "J. Augusto Saldívar", "san antonio": "San Antonio", "san anotonio": "San Antonio",
    "san antoni": "San Antonio", "loma pyta": "Loma Pytá", sajonia: "Asunción", "minga guazu": "Minga Guazú",
    minga: "Minga Guazú", "colonia yguazu": "Colonia Yguazú", "juan leon mallorquin": "Juan León Mallorquín",
    encarnacion: "Encarnación", concepcion: "Concepción", "san estanislao": "San Estanislao (Santaní)", santani: "San Estanislao (Santaní)",
    "coronel oviedo": "Coronel Oviedo", caaguazu: "Caaguazú", paraguari: "Paraguarí", yaguaron: "Yaguarón",
    atyra: "Atyrá", piribebuy: "Piribebuy", tobati: "Tobatí", emboscada: "Emboscada", "loma grande": "Loma Grande",
    "benjamin aceval": "Benjamín Aceval", remansito: "Remansito"
  };
  return map[city] || city;
}

// ============================================
// PEDIDO / INTENCIÓN
// ============================================
function isFollowUpMessage(text) {
  const normalized = normalizeText(text);
  const followUps = ["quiero", "si", "sí", "como hago", "cómo hago", "precio", "cuanto", "cuánto", "me interesa",
    "quiero comprar", "como compro", "cómo compro", "pedido", "comprar", "info", "mas info", "más info",
    "disponible", "ok", "dale", "uno", "dos", "promo", "confirmo", "enviame", "envíame", "me quedo", "1 unidad", "2 unidades"];
  return followUps.some(item => normalized.includes(item));
}

function detectQuantity(text) {
  const normalized = normalizeText(text);
  if (normalized === "1" || normalized.includes("1 unidad") || normalized.includes("uno") || normalized.startsWith("1")) return 1;
  if (normalized === "2" || normalized.includes("2 unidades") || normalized.includes("dos") || normalized.startsWith("2")) return 2;
  if (normalized === "3" || normalized.includes("3 unidades") || normalized.includes("tres") || normalized.startsWith("3")) return 3;
  if (normalized === "4" || normalized.includes("4 unidades") || normalized.includes("cuatro") || normalized.startsWith("4")) return 4;
  if (normalized === "5" || normalized.includes("5 unidades") || normalized.includes("cinco") || normalized.startsWith("5")) return 5;
  return 1;
}

function detectPhoneFromText(text, fallbackPhone = "") {
  const raw = String(text || "");
  const compact = raw.replace(/[^\d+]/g, "");
  const match = compact.match(/(?:\+595|595|0)?9\d{8}/) || raw.match(/(?:\+595|595|0)?9\d{8}/);
  return match?.[0] ? match[0].replace(/\s+/g, "") : cleanText(fallbackPhone) || null;
}

function extractCustomerDataFromText(text, fallbackPhone = "") {
  const raw = cleanText(text);
  const cityDetection = detectCoverageCity(raw);
  const city = cityDetection?.type === "coverage" ? formatCityName(cityDetection.value) : null;
  const phone = detectPhoneFromText(raw, fallbackPhone);
  const quantity = detectQuantity(raw);
  let customerName = null;
  let address = null;

  if (city) {
    const rawLower = raw.toLowerCase();
    const cityLower = city.toLowerCase();
    const idx = rawLower.indexOf(cityLower);
    if (idx >= 0) {
      const beforeCity = raw.slice(0, idx).trim();
      const afterCity = raw.slice(idx + city.length).trim();
      customerName = cleanText(beforeCity.replace(phone || "", "").replace(/\bcantidad\b.*$/i, "").trim()) || null;
      address = cleanText(afterCity.replace(phone || "", "").replace(/\bcantidad\b[:\s-]*\d+\b/i, "").trim()) || null;
    }
  }

  if (!customerName) {
    const withoutPhone = raw.replace(phone || "", "").trim();
    const parts = withoutPhone.split(/\s{2,}|,/).map(x => cleanText(x)).filter(Boolean);
    if (parts.length) customerName = parts[0];
  }

  return { customer_name: customerName || null, city: city || null, address: address || null, phone: phone || null, quantity: quantity || 1 };
}

function isOrderComplete(order) {
  return !!(cleanText(order?.product) && cleanText(order?.customer_name) && cleanText(order?.city) && cleanText(order?.address) && cleanText(order?.phone) && Number(order?.quantity || 0) > 0);
}

function buildConfirmedOrderMessage(order) {
  const product = cleanText(order?.product) || "Producto";
  const customerName = cleanText(order?.customer_name) || "Cliente";
  const city = cleanText(order?.city) || "Ciudad";
  const address = cleanText(order?.address) || "Dirección";
  const phone = cleanText(order?.phone) || "Sin teléfono";
  const quantity = Number(order?.quantity || 1);
  const total = cleanText(order?.total_amount) || "A confirmar";

  return `✅ PEDIDO CONFIRMADO
━━━━━━━━━━━━━━━━━━━━━━
✅ Producto: ${product}
✅ Cliente: ${customerName}
✅ Ubicación: ${city} — ${address}
✅ Contacto: ${phone}
✅ Cantidad: ${quantity} u.

💰 Total: ${total}
🚚 Envío GRATIS · Pagás al recibir
⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

🔗 Catálogo: https://cat-logomegatodo-com.vercel.app/`;
}

// ============================================
// CONFIRMACIÓN ROBUSTA CON RETRY
// ============================================
async function sendRobustOrderConfirmation(userId, fromNumber, order) {
  try {
    const confirmationMessage = buildConfirmedOrderMessage(order);
    
    const { error: saveError } = await supabase.from("order_confirmations").insert({
      user_id: userId, order_id: order.id, to_number: fromNumber,
      message: confirmationMessage, status: "pending", created_at: new Date().toISOString()
    });
    if (saveError) console.error("Error guardando backup:", saveError);
    
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await sendWhatsAppMessage(userId, fromNumber, confirmationMessage);
        if (result) {
          await supabase.from("orders").update({ order_confirmation_sent: true, order_confirmation_sent_at: new Date().toISOString(), status: "confirmed" }).eq("id", order.id);
          await supabase.from("order_confirmations").update({ status: "sent", sent_at: new Date().toISOString() }).eq("order_id", order.id);
          await sendWhatsAppMessage(userId, fromNumber, `🎉 ¡Gracias por tu compra, ${cleanText(order.customer_name) || "cliente"}! 💜\n\nTu pedido ya está confirmado. En 24-48hs hábiles recibirás tu producto.`);
          return true;
        }
        lastError = "No response from Meta API";
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      } catch (err) { lastError = err.message; }
    }
    
    await supabase.from("order_confirmations").update({ status: "failed", error: lastError, retry_count: (order.retry_count || 0) + 1 }).eq("order_id", order.id);
    await supabase.from("orders").update({ last_error: lastError, retry_count: (order.retry_count || 0) + 1 }).eq("id", order.id);
    return false;
  } catch (error) { console.error("Error fatal en confirmación:", error); return false; }
}

// ============================================
// EXTRACCIÓN MÚLTIPLE DE DATOS
// ============================================
async function extractMultipleDataFromText(text, fromNumber, userId) {
  const raw = cleanText(text);
  const result = { customer_name: null, city: null, address: null, phone: null, quantity: null };
  result.phone = detectPhoneFromText(raw, fromNumber);
  const cityDetection = detectCoverageCity(raw);
  if (cityDetection?.type === "coverage") result.city = formatCityName(cityDetection.value);
  result.quantity = detectQuantity(raw);
  if (isDetailedAddress(raw) || looksLikeGoogleMaps(raw)) result.address = raw;
  
  let remainingText = raw;
  if (result.phone) remainingText = remainingText.replace(result.phone, "");
  if (result.city) remainingText = remainingText.replace(new RegExp(result.city, "i"), "");
  if (result.address) remainingText = remainingText.replace(result.address, "");
  if (result.quantity) remainingText = remainingText.replace(String(result.quantity), "");
  
  const cleanupWords = ["quiero", "comprar", "pedido", "para", "mi", "nombre", "soy", "me llamo", "teléfono", "celular"];
  for (const word of cleanupWords) remainingText = remainingText.replace(new RegExp(`\\b${word}\\b`, "gi"), "");
  const nameMatch = remainingText.match(/^[\p{L}\s]{3,30}$/u);
  if (nameMatch) result.customer_name = cleanText(nameMatch[0]);
  return result;
}

// ============================================
// ORDERS
// ============================================
async function getOpenOrder(userId, phone) {
  try {
    const normalizedIncoming = normalizePyPhone(phone);
    const { data, error } = await supabase.from("orders").select("*").eq("user_id", userId)
      .in("status", ["draft", "collecting_name", "collecting_city", "collecting_address", "waiting_exact_address"])
      .order("created_at", { ascending: false }).limit(20);
    if (error || !data?.length) return null;
    const exact = data.find(row => normalizePyPhone(row.phone) === normalizedIncoming);
    return exact || data[0] || null;
  } catch { return null; }
}

async function createOrderDraft(userId, phone, payload = {}) {
  try {
    const { data, error } = await supabase.from("orders").insert({
      user_id: userId, phone, product: payload.product || null, customer_name: payload.customer_name || null,
      city: payload.city || null, address: payload.address || null, quantity: payload.quantity || 1,
      total_amount: payload.total_amount || null, status: payload.status || "collecting_name",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).select("*").single();
    return error ? null : data;
  } catch { return null; }
}

async function updateOrder(orderId, payload = {}) {
  try {
    const { data, error } = await supabase.from("orders").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", orderId).select("*").single();
    return error ? null : data;
  } catch { return null; }
}

async function startOrderFlow(userId, fromNumber, context, message) {
  const existingOrder = await getOpenOrder(userId, fromNumber);
  if (existingOrder) return existingOrder;
  const product = cleanText(context?.last_topic);
  if (!product) return null;
  const quantity = detectQuantity(message);
  const totalAmount = await getCalculatedTotal(userId, product, quantity);
  return await createOrderDraft(userId, fromNumber, { product, quantity, total_amount: totalAmount, status: "collecting_name" });
}

async function getCalculatedTotal(userId, product, quantity) {
  try {
    const q = Number(quantity || 1);
    const { data, error } = await supabase.rpc("calculate_order_total", { p_user_id: userId, p_product: product, p_quantity: q });
    if (!error && data) return formatGs(data);
    const { data: row } = await supabase.from("product_prices").select("unit_price, promo_price, promo_quantity").eq("user_id", userId).eq("product", product).eq("is_active", true).limit(1).maybeSingle();
    if (!row?.unit_price) return "A confirmar";
    if (row.promo_price && row.promo_quantity && q === Number(row.promo_quantity)) return formatGs(row.promo_price);
    return formatGs(Number(row.unit_price) * Math.max(q, 1));
  } catch { return "A confirmar"; }
}

// ============================================
// HANDLE ORDER DATA COLLECTION (MEJORADA)
// ============================================
async function handleOrderDataCollection(userId, fromNumber, incomingText) {
  const openOrder = await getOpenOrder(userId, fromNumber);
  if (!openOrder) return false;
  const text = cleanText(incomingText);
  if (!text) return true;
  
  const extracted = await extractMultipleDataFromText(text, fromNumber, userId);
  const merged = {
    customer_name: extracted.customer_name || openOrder.customer_name || null,
    city: extracted.city || openOrder.city || null,
    address: extracted.address || openOrder.address || null,
    phone: extracted.phone || openOrder.phone || cleanText(fromNumber),
    quantity: extracted.quantity || openOrder.quantity || 1
  };
  
  const recalculatedTotal = await getCalculatedTotal(userId, openOrder.product, merged.quantity);
  const hasNewCustomerName = extracted.customer_name && !openOrder.customer_name;
  const hasNewCity = extracted.city && !openOrder.city;
  const hasNewAddress = extracted.address && !openOrder.address;
  
  // Caso 1: Todo en un solo mensaje (nombre + ciudad + dirección)
  if (merged.customer_name && merged.city && merged.address && openOrder.status === "collecting_name") {
    const updated = await updateOrder(openOrder.id, { customer_name: merged.customer_name, city: merged.city, address: merged.address, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, status: "draft" });
    if (updated && isOrderComplete(updated)) { await sendRobustOrderConfirmation(userId, fromNumber, updated); return true; }
  }
  
  // Caso 2: Nombre + Ciudad juntos
  if (hasNewCustomerName && hasNewCity && openOrder.status === "collecting_name") {
    const updated = await updateOrder(openOrder.id, { customer_name: merged.customer_name, city: merged.city, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, status: "collecting_address" });
    if (updated) { await sendWhatsAppMessage(userId, fromNumber, `Perfecto ${merged.customer_name}! 🙌 Ya tengo tu ciudad: ${merged.city}\n\nAhora pasame tu dirección exacta 📍`); return true; }
  }
  
  // Caso 3: Ciudad + Dirección juntos
  if (hasNewCity && hasNewAddress && openOrder.status === "collecting_city") {
    const updated = await updateOrder(openOrder.id, { city: merged.city, address: merged.address, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, status: "draft" });
    if (updated && isOrderComplete(updated)) { await sendRobustOrderConfirmation(userId, fromNumber, updated); return true; }
  }
  
  // Caso 4: Estado waiting_exact_address con dirección válida
  if (openOrder.status === "waiting_exact_address" && (isDetailedAddress(text) || looksLikeGoogleMaps(text))) {
    const updated = await updateOrder(openOrder.id, { address: text, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, status: "draft" });
    if (updated && isOrderComplete(updated)) { await sendRobustOrderConfirmation(userId, fromNumber, updated); return true; }
  }
  
  // Caso 5: Si ya tenemos casi todo pero falta dirección detallada
  if (merged.customer_name && merged.city && merged.phone && merged.address && !isDetailedAddress(merged.address) && !looksLikeGoogleMaps(merged.address)) {
    const updated = await updateOrder(openOrder.id, { customer_name: merged.customer_name, city: merged.city, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, address: merged.address, status: "waiting_exact_address" });
    if (updated) { await sendWhatsAppMessage(userId, fromNumber, `Perfecto 🙌 Ya tengo casi todo.\n\n✅ Nombre: ${cleanText(updated.customer_name)}\n✅ Ciudad: ${cleanText(updated.city)}\n✅ Teléfono: ${cleanText(updated.phone)}\n\nAhora pasame por favor tu *calle exacta* o tu *ubicación de Google Maps* 📍 para cerrar el pedido.`); return true; }
  }
  
  // Flujo paso a paso NORMAL
  if (openOrder.status === "collecting_name") {
    const updated = await updateOrder(openOrder.id, { customer_name: text, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, status: "collecting_city" });
    if (updated) { await sendWhatsAppMessage(userId, fromNumber, "Perfecto 🙌 Ahora pasame tu ciudad."); return true; }
  }
  
  if (openOrder.status === "collecting_city") {
    const detection = detectCoverageCity(text);
    const finalCity = detection?.type === "coverage" ? formatCityName(detection.value) : text;
    const updated = await updateOrder(openOrder.id, { city: finalCity, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, status: "collecting_address" });
    if (updated) { await sendWhatsAppMessage(userId, fromNumber, "Genial 😊 Ahora pasame tu dirección exacta o tu ubicación de Google Maps 📍."); return true; }
  }
  
  if (openOrder.status === "collecting_address") {
    if (!isDetailedAddress(text) && !looksLikeGoogleMaps(text)) {
      const updated = await updateOrder(openOrder.id, { address: text, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, status: "waiting_exact_address" });
      if (updated) { await sendWhatsAppMessage(userId, fromNumber, "Te entendí 👍 pero para cerrar bien el pedido pasame por favor tu *calle exacta* o tu *ubicación de Google Maps* 📍."); return true; }
    }
    const updated = await updateOrder(openOrder.id, { address: text, phone: merged.phone, quantity: merged.quantity, total_amount: recalculatedTotal, status: "draft" });
    if (updated && isOrderComplete(updated)) { await sendRobustOrderConfirmation(userId, fromNumber, updated); return true; }
    else if (updated) { await sendWhatsAppMessage(userId, fromNumber, "Me faltan algunos datos para confirmar tu pedido."); return true; }
  }
  
  return false;
}

// ============================================
// CONFIG IA
// ============================================
async function getIAConfig(userId) {
  try {
    const { data, error } = await supabase.from("chat_ia_gemini").select("*").eq("user_id", userId).single();
    if (error || !data) return null;
    if (!data.is_active || !cleanText(data.api_key)) return null;
    return data;
  } catch { return null; }
}

// ============================================
// CONTEXTO
// ============================================
async function getChatContext(userId, fromNumber) {
  try {
    const { data, error } = await supabase.from("chat_context").select("last_topic, last_trigger, updated_at").eq("user_id", userId).eq("from_number", fromNumber).maybeSingle();
    return error ? null : data || null;
  } catch { return null; }
}

async function saveChatContext(userId, fromNumber, payload = {}) {
  try {
    await supabase.from("chat_context").upsert({ user_id: userId, from_number: fromNumber, last_topic: payload.last_topic || null, last_trigger: payload.last_trigger || null, updated_at: new Date().toISOString() }, { onConflict: "user_id,from_number" });
  } catch (error) { console.error("Error en saveChatContext:", error); }
}

// ============================================
// HISTORIAL
// ============================================
async function getRecentConversation(userId, fromNumber) {
  try {
    const { data, error } = await supabase.from("received_messages").select("message, message_type, created_at").eq("user_id", userId).eq("from_number", fromNumber).order("created_at", { ascending: false }).limit(4);
    if (error) return [];
    return [...(data || [])].reverse().map(msg => ({ role: msg.message_type && String(msg.message_type).startsWith("out_") ? "assistant" : "user", content: String(msg.message || "").slice(0, 180) })).filter(item => cleanText(item.content));
  } catch { return []; }
}

// ============================================
// SYSTEM PROMPT MEJORADO
// ============================================
function buildGeminiSystemInstruction(systemInstruction, trainingContext, context, orderState = null) {
  const productActive = cleanText(context?.last_topic);
  let currentStep = "none";
  if (orderState) {
    if (orderState.status === "collecting_name") currentStep = "nombre";
    else if (orderState.status === "collecting_city") currentStep = "ciudad";
    else if (orderState.status === "collecting_address") currentStep = "dirección";
    else if (orderState.status === "waiting_exact_address") currentStep = "dirección exacta";
    else if (orderState.status === "draft" && !isOrderComplete(orderState)) currentStep = "completar datos";
    else if (orderState.status === "draft" && isOrderComplete(orderState)) currentStep = "confirmar pedido";
  }
  
  return `${cleanText(systemInstruction) || "Eres un asistente de ventas profesional y persuasivo."}

╔══════════════════════════════════════════════════════════════╗
║                    REGLAS OBLIGATORIAS                       ║
╠══════════════════════════════════════════════════════════════╣
║ 1. RESPONDE COMO HUMANO: cálido, entusiasta, sin parecer bot║
║ 2. MANTÉN EL FLUJO: sigue conversación, no repreguntes datos║
║ 3. UN SOLO DATO POR VEZ: pide nombre → ciudad → dirección   ║
║ 4. SI EL CLIENTE DA VARIOS DATOS JUNTOS → extráelos y avanza║
║ 5. NUNCA digas "no tengo información" o respuestas genéricas ║
║ 6. CIERRA SIEMPRE con pregunta clara de siguiente paso      ║
╚══════════════════════════════════════════════════════════════╝

📌 CONTEXTO ACTUAL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔹 Producto activo: ${productActive || "ninguno (pregunta qué interesa)"}
🔹 Paso actual: ${currentStep}
🔹 Estado del pedido: ${orderState?.status || "no_order"}

💰 POLÍTICA DE PRECIOS:
- Envío GRATIS a todo Paraguay
- Pago CONTRA ENTREGA (pagás al recibir)
- Todos los precios son finales

🎯 OBJETIVO INMEDIATO:
${currentStep === "nombre" ? "Pregunta amablemente el NOMBRE COMPLETO del cliente." :
  currentStep === "ciudad" ? "Pregunta la CIUDAD (solo ciudades con cobertura)." :
  currentStep === "dirección" ? "Pide DIRECCIÓN EXACTA o ubicación de Google Maps." :
  currentStep === "dirección exacta" ? "El cliente dio dirección vaga. Pide EXPLÍCITAMENTE calle y número." :
  currentStep === "confirmar pedido" ? "El pedido está completo. PREGUNTA: '¿Confirmamos el pedido?' antes de enviar resumen." :
  `Ofrece el producto ${productActive || "del catálogo"} y pregúntale si quiere comprar hoy.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 ENTRENAMIENTO PERSONALIZADO:
${trainingContext || "Sin entrenamiento adicional."}

REGLAS DE RESPUESTA:
- Máximo 2 oraciones por mensaje (excepto confirmación)
- Siempre termina con una pregunta que avance la venta
- Usa emojis moderadamente (😊, ✅, 📍, 🚚)

¡VENDES CON SEGUIMIENTO FLUIDO Y NATURAL!`.trim();
}

async function getTrainingContext(userId, currentMessage, context) {
  try {
    const { data, error } = await supabase.from("training_data").select("intent, examples, response").eq("user_id", userId).eq("is_active", true);
    if (error || !data || data.length === 0) return "Sin entrenamiento adicional.";
    const query = normalizeForSearch([currentMessage, context?.last_topic, context?.last_trigger].filter(Boolean).join(" "));
    const scored = data.map((row, index) => {
      const haystack = normalizeForSearch(`${row.intent || ""} ${safeArray(row.examples).join(" ")} ${row.response || ""}`);
      let score = 0;
      for (const token of query.split(/\s+/)) if (token.length >= 3) { if (haystack.includes(token)) score += 1; if (normalizeForSearch(row.intent || "").includes(token)) score += 3; }
      return { row, index, score };
    }).sort((a, b) => b.score - a.score || a.index - b.index);
    const relevant = scored.filter(x => x.score > 0).slice(0, 4).map(x => x.row);
    const finalRows = relevant.length ? relevant : data.slice(0, 2);
    return finalRows.map((row, index) => { const intent = cleanText(row.intent) || `Intent ${index + 1}`; const response = cleanText(row.response) || "Sin respuesta definida"; const examples = safeArray(row.examples).map(ex => cleanText(ex)).filter(Boolean).slice(0, 2); return [`Intent: ${intent}`, examples.length ? `Ejemplos: ${examples.join(" | ")}` : null, `Respuesta ideal: ${response}`].filter(Boolean).join("\n"); }).join("\n\n").slice(0, 1500);
  } catch { return "Sin entrenamiento adicional."; }
}

// ============================================
// GEMINI
// ============================================
function buildGeminiContents(history, currentMessage) {
  const contents = [];
  for (const item of history || []) if (item?.content && (item.role === "user" || item.role === "assistant")) contents.push({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: String(item.content).slice(0, 180) }] });
  contents.push({ role: "user", parts: [{ text: cleanText(currentMessage).slice(0, 250) }] });
  return contents;
}

async function callGeminiText({ apiKey, model, systemInstruction, contents, temperature, maxOutputTokens }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: systemInstruction }] }, contents, generationConfig: { temperature, maxOutputTokens } }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { console.error("❌ Error Gemini texto:", data); return null; }
  const text = data?.candidates?.[0]?.content?.parts?.map(part => cleanText(part?.text)).filter(Boolean).join("\n") || "";
  return cleanText(text) || null;
}

async function generateAIReply(userId, message, fromNumber) {
  try {
    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) return null;
    const history = await getRecentConversation(userId, fromNumber);
    const context = await getChatContext(userId, fromNumber);
    const openOrder = await getOpenOrder(userId, fromNumber);
    const trainingContext = await getTrainingContext(userId, message, context);
    const systemInstruction = cleanText(iaConfig.system_instruction) || "Eres un asistente de ventas para una tienda online.";
    const model = cleanText(iaConfig.model) || "gemini-2.5-flash";
    const temperature = typeof iaConfig.temperature === "number" ? iaConfig.temperature : 0.4;
    const maxOutputTokens = typeof iaConfig.max_tokens === "number" ? iaConfig.max_tokens : 300;
    const contents = buildGeminiContents(history, message);
    const finalSystemInstruction = buildGeminiSystemInstruction(systemInstruction, trainingContext, context, openOrder);
    return await callGeminiText({ apiKey: cleanText(iaConfig.api_key), model, systemInstruction: finalSystemInstruction, contents, temperature, maxOutputTokens });
  } catch (error) { console.error("❌ Error generando respuesta Gemini:", error); return null; }
}

async function analyzeImageWithAI(userId, imageUrl, fromNumber) {
  try {
    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) return null;
    const response = await fetch(imageUrl, { method: "GET" });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanText(iaConfig.model) || "gemini-2.5-flash")}:generateContent?key=${encodeURIComponent(cleanText(iaConfig.api_key))}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: `Analiza la imagen y responde como vendedor. Si es un producto, descríbelo y ofrece ayuda para comprarlo. Responde en español de forma cálida y breve.` }] }, contents: [{ role: "user", parts: [{ text: "¿Qué producto es este y cómo puedo ayudar al cliente a comprarlo?" }, { inlineData: { mimeType, data: base64 } }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 150 } }) });
    const data = await geminiResponse.json().catch(() => ({}));
    if (!geminiResponse.ok) { console.error("❌ Error Gemini imagen:", data); return null; }
    const text = data?.candidates?.[0]?.content?.parts?.map(part => cleanText(part?.text)).filter(Boolean).join("\n") || "";
    return cleanText(text) || null;
  } catch (error) { console.error("❌ Error analizando imagen con Gemini:", error); return null; }
}

async function transcribeAudioFromUrl(audioUrl, userId, fromNumber) {
  try {
    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) return null;
    const response = await fetch(audioUrl, { method: "GET" });
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "audio/ogg";
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanText(iaConfig.model) || "gemini-2.5-flash")}:generateContent?key=${encodeURIComponent(cleanText(iaConfig.api_key))}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: "Transcribe el audio al español exactamente como lo dice el cliente. Devuelve SOLO la transcripción en texto plano, sin comentarios adicionales." }] }, contents: [{ role: "user", parts: [{ text: "Transcribe este audio:" }, { inlineData: { mimeType, data: base64 } }] }], generationConfig: { temperature: 0, maxOutputTokens: 300 } }) });
    const data = await geminiResponse.json().catch(() => ({}));
    if (!geminiResponse.ok) { console.error("❌ Error Gemini audio:", data); return null; }
    const text = data?.candidates?.[0]?.content?.parts?.map(part => cleanText(part?.text)).filter(Boolean).join("\n") || "";
    return cleanText(text) || null;
  } catch (error) { console.error("❌ Error en transcribeAudioFromUrl:", error); return null; }
}

// ============================================
// TRIGGERS
// ============================================
async function procesarDisparadores(userId, fromNumber, message) {
  try {
    const { data: triggers, error } = await supabase.from("triggers").select("*").eq("user_id", userId).eq("active", true);
    if (error || !triggers || triggers.length === 0) return null;
    const messageLower = normalizeText(message);
    const existingContext = await getChatContext(userId, fromNumber);
    const detectedProductInMessage = detectProductFromText(message);
    for (const trigger of triggers) {
      const condition = normalizeText(trigger.condition);
      if (!condition || !messageLower.includes(condition)) continue;
      let responseText = trigger.response || "";
      if (responseText) await sendWhatsAppMessage(userId, fromNumber, responseText);
      const finalProduct = detectedProductInMessage || cleanText(existingContext?.last_topic) || null;
      await saveChatContext(userId, fromNumber, { last_topic: finalProduct, last_trigger: trigger.name || null });
      return { ...trigger, responseText, finalProduct };
    }
    return null;
  } catch (error) { console.error("Error procesando disparadores:", error); return null; }
}

// ============================================
// WHATSAPP
// ============================================
async function sendWhatsAppMessage(userId, to, message) {
  try {
    const { data: config, error: configError } = await supabase.from("whatsapp_config").select("phone_number_id, permanent_token").eq("user_id", userId).single();
    if (configError || !config?.phone_number_id || !config?.permanent_token) return null;
    const response = await fetch(`https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`, { method: "POST", headers: { Authorization: `Bearer ${config.permanent_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: message } }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { console.error("Error enviando a Meta:", result); return null; }
    await supabase.from("received_messages").insert({ user_id: userId, platform: "whatsapp", from_number: to, message, message_type: "out_text", is_processed: true, created_at: new Date().toISOString() });
    return result;
  } catch (error) { console.error("Error enviando mensaje:", error); return null; }
}

// ============================================
// PROCESAR MENSAJE
// ============================================
async function procesarMensaje(message, token, userId, fromNumber) {
  try {
    const type = message.type;
    let contenido = "";
    let mediaUrl = null;
    let mediaType = null;
    let mediaId = null;
    const now = new Date().toISOString();

    if (type === "text") contenido = cleanText(message.text?.body || "");
    else if (type === "image") { mediaId = message.image?.id; contenido = "[Imagen]"; }
    else if (type === "video") { mediaId = message.video?.id; contenido = "[Video]"; }
    else if (type === "audio") { mediaId = message.audio?.id; contenido = "[Audio]"; }
    else contenido = "[Mensaje no soportado]";

    if (mediaId && token) {
      try {
        const mediaUrlResponse = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (mediaUrlResponse.ok) {
          const mediaData = await mediaUrlResponse.json();
          if (mediaData.url) {
            const fileResponse = await fetch(mediaData.url, { headers: { Authorization: `Bearer ${token}` } });
            if (fileResponse.ok) {
              const fileBuffer = await fileResponse.arrayBuffer();
              let fileExt = "bin";
              const mimeType = mediaData.mime_type || "application/octet-stream";
              if (mimeType.includes("image")) fileExt = mimeType.split("/")[1] || "jpg";
              else if (mimeType.includes("video")) fileExt = mimeType.split("/")[1] || "mp4";
              else if (mimeType.includes("audio")) fileExt = mimeType.split("/")[1] || "ogg";
              const fileName = `incoming/${Date.now()}_${Math.random().toString(36).substring(2, 10)}.${fileExt}`;
              const { error: uploadError } = await supabase.storage.from("templates-media").upload(fileName, Buffer.from(fileBuffer), { contentType: mimeType, upsert: false });
              if (!uploadError) {
                const { data: { publicUrl } } = supabase.storage.from("templates-media").getPublicUrl(fileName);
                mediaUrl = publicUrl;
                mediaType = mimeType.includes("image") ? "image" : mimeType.includes("video") ? "video" : mimeType.includes("audio") ? "audio" : "document";
              }
            }
          }
        }
      } catch (err) { console.error("Error descargando media:", err); }
    }

    await supabase.from("received_messages").insert({ user_id: userId, platform: "whatsapp", from_number: fromNumber, message: contenido, message_type: type, media_url: mediaUrl, media_type: mediaType, is_processed: false, created_at: now });

    if (type === "image" && mediaUrl) {
      const imageReply = await analyzeImageWithAI(userId, mediaUrl, fromNumber);
      await sendWhatsAppMessage(userId, fromNumber, imageReply || "Recibí tu imagen 📸, pero no pude analizarla bien. Probá mandarme otra foto más clara.");
      return;
    }

    if (type === "audio" && mediaUrl) {
      const transcript = await transcribeAudioFromUrl(mediaUrl, userId, fromNumber);
      if (!transcript) { await sendWhatsAppMessage(userId, fromNumber, "Recibí tu audio 🎙️, pero no pude transcribirlo. Probá mandarlo otra vez."); return; }
      await supabase.from("received_messages").insert({ user_id: userId, platform: "whatsapp", from_number: fromNumber, message: `[Transcripción de audio] ${transcript}`, message_type: "audio_transcript", is_processed: true, created_at: new Date().toISOString() });
      const existingContextFromAudio = await getChatContext(userId, fromNumber);
      const detectedProductFromAudio = detectProductFromText(transcript) || cleanText(existingContextFromAudio?.last_topic);
      if (detectedProductFromAudio) await saveChatContext(userId, fromNumber, { last_topic: detectedProductFromAudio, last_trigger: existingContextFromAudio?.last_trigger || null });
      const handledOrderFromAudio = await handleOrderDataCollection(userId, fromNumber, transcript);
      if (handledOrderFromAudio) return;
      const triggerFromAudio = await procesarDisparadores(userId, fromNumber, transcript);
      if (triggerFromAudio) return;
      const cityDetectionAudio = detectCoverageCity(transcript);
      if (cityDetectionAudio?.type === "ambiguous") { await sendWhatsAppMessage(userId, fromNumber, cityDetectionAudio.reply); return; }
      if (cityDetectionAudio?.type === "coverage") { await sendWhatsAppMessage(userId, fromNumber, `✅ Perfecto 😊 ${formatCityName(cityDetectionAudio.value)} tiene ENVÍO GRATIS contra-entrega 🚚\n💵 Pagás al recibir SIN moverte de casa\n\n¿Te parece si te agendo ahora mismo? ¿Nombre y teléfono? 📝\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/`); return; }
      const followUpFromAudio = isFollowUpMessage(transcript);
      const freshContextAudio = await getChatContext(userId, fromNumber);
      if (followUpFromAudio && freshContextAudio?.last_topic) { const order = await startOrderFlow(userId, fromNumber, freshContextAudio, transcript); if (order) { await sendWhatsAppMessage(userId, fromNumber, `¡Genial! 😊 Para confirmar tu pedido de *${cleanText(order.product)}* pasame tu *nombre completo*.`); return; } }
      const audioReply = await generateAIReply(userId, transcript, fromNumber);
      if (audioReply) await sendWhatsAppMessage(userId, fromNumber, audioReply);
      return;
    }

    if (type !== "text" || !contenido) return;

    const existingContext = await getChatContext(userId, fromNumber);
    const explicitProductInMessage = detectProductFromText(contenido);
    if (explicitProductInMessage) await saveChatContext(userId, fromNumber, { last_topic: explicitProductInMessage, last_trigger: existingContext?.last_trigger || null });

    const handledOrder = await handleOrderDataCollection(userId, fromNumber, contenido);
    if (handledOrder) return;

    const triggerResult = await procesarDisparadores(userId, fromNumber, contenido);
    if (triggerResult) return;

    const cityDetection = detectCoverageCity(contenido);
    if (cityDetection?.type === "ambiguous") { await sendWhatsAppMessage(userId, fromNumber, cityDetection.reply); return; }
    if (cityDetection?.type === "coverage") { await sendWhatsAppMessage(userId, fromNumber, `✅ Perfecto 😊 ${formatCityName(cityDetection.value)} tiene ENVÍO GRATIS contra-entrega 🚚\n💵 Pagás al recibir SIN moverte de casa\n\n¿Te parece si te agendo ahora mismo? ¿Nombre y teléfono? 📝\n\n📋 Catálogo:\nhttps://cat-logomegatodo-com.vercel.app/`); return; }

    const freshContext = await getChatContext(userId, fromNumber);
    const followUp = isFollowUpMessage(contenido);
    if (followUp && freshContext?.last_topic) { const order = await startOrderFlow(userId, fromNumber, freshContext, contenido); if (order) { await sendWhatsAppMessage(userId, fromNumber, `¡Genial! 😊 Para confirmar tu pedido de *${cleanText(order.product)}* pasame tu *nombre completo*.`); return; } }

    const iaConfig = await getIAConfig(userId);
    if (!iaConfig) return;
    const aiResponse = await generateAIReply(userId, contenido, fromNumber);
    if (!aiResponse) return;
    const sendResult = await sendWhatsAppMessage(userId, fromNumber, aiResponse);
    if (sendResult) await saveChatContext(userId, fromNumber, { last_topic: explicitProductInMessage || cleanText(freshContext?.last_topic) || null, last_trigger: cleanText(freshContext?.last_trigger) || null });
  } catch (err) { console.error("❌ Error procesando mensaje:", err); }
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") { const mode = req.query["hub.mode"]; const token = req.query["hub.verify_token"]; const challenge = req.query["hub.challenge"]; if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge); return res.status(403).send("Token inválido"); }
  if (req.method === "POST") {
    try {
      const body = req.body;
      if (body.object !== "whatsapp_business_account") return res.status(404).send("Not WhatsApp event");
      for (const entry of body.entry || []) for (const change of entry.changes || []) { const value = change.value; const phoneNumberId = value?.metadata?.phone_number_id; if (!phoneNumberId) continue; const { data: config, error: configError } = await supabase.from("whatsapp_config").select("user_id, permanent_token, phone_number_id").eq("phone_number_id", phoneNumberId).single(); if (configError || !config?.user_id) continue; const userId = config.user_id; const token = config.permanent_token; if (value.messages) for (const message of value.messages) await procesarMensaje(message, token, userId, message.from); }
      return res.status(200).send("EVENT_RECEIVED");
    } catch (error) { console.error("❌ Error en webhook:", error); return res.status(500).json({ error: "Internal Server Error" }); }
  }
  return res.status(405).send("Method Not Allowed");
}
