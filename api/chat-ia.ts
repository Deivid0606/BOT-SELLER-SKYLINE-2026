import { createClient } from "@supabase/supabase-js";

// =======================================================
// 🔌 CONFIGURACIÓN E INICIALIZACIÓN
// =======================================================
const supabase = createClient(
  process.env.SUPABASE_URL as string, 
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const CATALOG_URL = "https://cat-logomegatodo-com.vercel.app/";

// =======================================================
// 🧹 NORMALIZACIÓN Y LIMPIEZA
// =======================================================
const clean = (t: any): string => String(t || "").trim();

const normalize = (t: string): string =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// =======================================================
// 🧠 PRODUCTOS RECONOCIDOS Y CONSTANTES
// =======================================================
const TORNADO_PRODUCT = "Destapa Cañerías Tornado";
const TORNADO_PRICE = 159900;

function getTornadoProductName(): string {
  return TORNADO_PRODUCT;
}

function getAntiVibrationProductName(): string {
  return "Kit Antivibración x4 Patitas Antideslizantes";
}

function getDefaultShoeProductName(): string {
  return "PLANTILLAS ORTOPIEX 5D®";
}

// =======================================================
// 🎯 GUARDRAILS DETERMINÍSTICOS NUEVOS (REPARACIÓN DEL BUCLE)
// =======================================================

/**
 * Detecta si el mensaje contiene la estructura de datos finales de entrega
 * (Nombre, Teléfono paraguayo y Dirección/Ubicación)
 */
function isFullContactDataIntent(text: string): boolean {
  const n = normalize(text);
  const raw = clean(text);

  // 1. Detectar si hay un número de teléfono celular paraguayo (09xx xxx xxx o similar)
  const hasPhone = /(09\d{8}|\+595\d{9}|\b9\d{7}\b)/.test(n.replace(/\s+/g, ""));

  // 2. Detectar palabras clave típicas de direcciones o referencias en Paraguay
  const hasAddressWords = /\b(calle|avenida|avda|av|ruta|km|casi|esquina|entre|barrio|bo|compania|compañia|casa|nro|numero|frente|detras|lado|esq|maps|google)\b/i.test(n);

  // 3. Si tiene teléfono y texto suficiente (ej. Nombre + Dirección), es un delivery estructurado
  if (hasPhone && raw.length > 20) {
    return true;
  }
  
  return hasPhone && hasAddressWords;
}

// =======================================================
// 🧠 EXTRACCIÓN DE CANTIDAD - CUALQUIER FORMATO
// =======================================================
function extractQuantityFromAnyText(text: string): { quantity: number; isPromo: boolean } {
  const n = normalize(text);
  
  if (/\b(la\s+promo|promo|2x|2\s*unidades\s+promo)\b/i.test(n)) {
    return { quantity: 2, isPromo: true };
  }
  
  const wordMap: Record<string, number> = {
    "una": 1, "un": 1, "uno": 1,
    "dos": 2, "dos unidades": 2,
    "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10
  };
  
  for (const [word, qty] of Object.entries(wordMap)) {
    if (n.includes(word)) {
      return { quantity: qty, isPromo: false };
    }
  }
  
  const numberMatch = n.match(/\b(\d{1,3})\b/);
  if (numberMatch) {
    const qty = parseInt(numberMatch[1], 10);
    if (qty >= 1 && qty <= 999) {
      return { quantity: qty, isPromo: false };
    }
  }
  
  return { quantity: 0, isPromo: false };
}

function isUserRespondingWithQuantity(text: string, previousStep: string, history: any[]): boolean {
  const n = normalize(text);
  const quantityResult = extractQuantityFromAnyText(text);
  
  if (quantityResult.quantity > 0) return true;
  if (previousStep === "collecting_quantity") return true;
  if (botWasAskingQuantity(history)) return true;
  if (/\b(si|sí|quiero|dale|ok|listo|confirmo)\b/i.test(n) && botWasAskingQuantity(history)) return true;
  
  return false;
}

// =======================================================
// 🧠 INTENCIONES Y VALIDACIONES DETALLADAS
// =======================================================
function hasExplicitProductMention(text: string): boolean {
  const n = normalize(text);
  const buyIndicators = /\b(quiero|comprar|llevo|dame|mandame|reservar|apartar|la\s+raqueta|el\s+veneno|las\s+plantillas|la\s+peladora|el\s+afilador|el\s+kit|la\s+máquina|el\s+nebulizador|la\s+tabla|tornado|destapa|quiero\s+\d+)\b/i;
  const productNames = /\b(veneno|abeja|crema|plantilla|plantillas|ortopiex|ortoflex|5d|pelador|peladora|papas|afilador|cuchillo|cuchillos|vital|honey|perfume|asad|soporte|lavarropas|almohadilla|almohadillas|patitas|antideslizantes|maquina|máquina|pororo|popcorn|pochoclo|palomita|palomitas|nebulizador|tabla|picar|marmol|mármol|raqueta|electrica|flayes|mosquitos|moscas|tornado|destapa|cañeria|cañería|tuberia|desagüe)\b/.test(n);
  return buyIndicators.test(n) || productNames;
}

function isLocationOnlyMessage(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (hasExplicitProductMention(text)) return false;
  const cityMatch = extractCityFromText(n);
  if (!cityMatch) return false;
  const noProductWords = !/\b(quiero|comprar|raqueta|veneno|plantilla|pelador|afilador|kit|máquina|nebulizador|tabla|pororo|vital|perfume|soporte|lavarropas|almohadilla|patitas|tornado|destapa)\b/i.test(n);
  return noProductWords;
}

function isOriginQuestion(text: string): boolean {
  const n = normalize(text);
  return /\b(de\s+donde\s+es|de\s+donde\s+son|donde\s+estan|donde\s+queda|son\s+de\s+donde|ubicacion\s+de\s+ustedes|ubicación\s+de\s+ustedes)\b/.test(n);
}

function isNeutralReply(text: string): boolean {
  const n = normalize(text);
  return /^(te\s+aviso|despues\s+veo|despues\s+te\s+aviso|voy\s+a\s+ver|voy\s+a\s+pensar|cualquier\s+cosa|gracias|ok|dale|esta\s+bien|está\s+bien)$/i.test(n);
}

function isConfirmIntent(text: string): boolean {
  const n = normalize(text);
  return /\b(confirmo|confirmar|si|sí|dale|ok|listo|cerrar|finalizar|acepto|está bien|esta bien|de acuerdo)\b/i.test(n) &&
         !/\b(agregar|sumar|añadir|otro|también|además|mas|más)\b/i.test(n);
}

function isAddMoreIntent(text: string): boolean {
  const n = normalize(text);
  return (
    /\b(tambien|también|agrega|agregame|sumame|suma|sumá|inclui|incluí|añadi|añadí|mas|más|otro|otra|además|y también|y el|y la|y los|y las)\b/.test(n) ||
    /\by\s+(la|el|los|las)\b/.test(n) ||
    /\b(agregar|sumar|añadir)\b/.test(n)
  );
}

// =======================================================
// 🗺️ COBERTURA LOGÍSTICA DE CIUDADES (PARAGUAY)
// =======================================================
function extractCityFromText(text: string): string {
  const norm = normalize(text);
  const cityAliases: Record<string, string> = {
    "cruce san alberto": "Cruce San Alberto",
    "cruse san alberto": "Cruce San Alberto",
    "san alberto": "San Alberto",
    asuncion: "Asunción", capiata: "Capiatá", capilata: "Capiatá", kapiata: "Capiatá",
    cde: "Ciudad del Este", "ciudad del este": "Ciudad del Este", luque: "Luque",
    ita: "Itá", lambare: "Lambaré", "san lorenzo": "San Lorenzo", sanlo: "San Lorenzo",
    "san lorenso": "San Lorenzo", fdm: "Fernando de la Mora", "fernando de la mora": "Fernando de la Mora",
    nemby: "Ñemby", ñemby: "Ñemby", ypane: "Ypané", limpio: "Limpio",
    "villa elisa": "Villa Elisa", hernandarias: "Hernandarias", "presidente franco": "Presidente Franco",
    "pte franco": "Presidente Franco", aregua: "Areguá", areguá: "Areguá",
    sanber: "San Bernardino", "san ber": "San Bernardino", "san bernardino": "San Bernardino",
    pjc: "Pedro Juan Caballero", "pedro juan": "Pedro Juan Caballero", "pedro juan caballero": "Pedro Juan Caballero",
  };

  for (const [k, v] of Object.entries(cityAliases)) {
    if (new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)) return v;
  }
  return "";
}

function getTipoCobertura(city: string): "con_cobertura" | "sin_cobertura" | "" {
  if (!city) return "";
  const c = normalize(city);
  if (/\b(cruce\s+san\s+alberto|cruse\s+san\s+alberto|san\s+alberto|pedro\s+juan\s+caballero|pjc)\b/.test(c)) return "sin_cobertura";

  const ZONAS_COBERTURA = [
    "Altos", "Areguá", "Asunción", "Atyrá", "Benjamín Aceval", "Caacupé",
    "Capiatá", "Ciudad del Este", "Colonia Yguazú", "Emboscada", "Eusebio Ayala",
    "Fernando de la Mora", "Guarambaré", "Hernandarias", "Itá",
    "Itacurubí de la Cordillera", "Itauguá", "J. Augusto Saldívar",
    "Juan León Mallorquín", "Lambaré", "Limpio", "Loma Grande", "Luque",
    "Mariano Roque Alonso", "Minga Guazú", "Nueva Italia", "Ñemby", "Paraguarí",
    "Pirayú", "Piribebuy", "Presidente Franco", "Puerto Presidente Franco",
    "Remansito", "San Alberto", "San Antonio", "San Bernardino", "San Lorenzo",
    "Santa Rita", "Tobatí", "Villa Elisa", "Villa Hayes", "Villarrica",
    "Villeta", "Yaguarón", "Yguazú", "Ypacaraí", "Ypané",
  ];

  return ZONAS_COBERTURA.some((z) => normalize(z) === c) ? "con_cobertura" : "sin_cobertura";
}

// =======================================================
// 📦 CONSTRÚCTORES DE RESPUESTAS PLANTILLAS
// =======================================================
function formatProductWithShoeSize(product: string, shoeSize?: any): string {
  return shoeSize ? `${product} (Calce: ${shoeSize})` : product;
}

function buildCoverageOnlyResponse(city: string): string {
  const tipo = getTipoCobertura(city);
  if (tipo === "con_cobertura") {
    return `✅ Perfecto 😊 ${city} tiene ENVÍO GRATIS contra-entrega 🚚\n\n¿Cuál producto te interesa? ✨`;
  }
  if (tipo === "sin_cobertura") {
    return `ℹ️ ${city} no entra dentro de nuestra zona de contra-entrega 😊\n\nPero sí hacemos envíos seguros por:\n🚚 TSI / NASA / Occidental / MG Express / Multienvíos\n\n¿Cuál producto te interesa? ✨`;
  }
  return `Perfecto 😊 ¿Cuál producto te interesa? ✨`;
}

function buildCityQuestionResponse(product: string, shoeSize?: any): string {
  const productName = formatProductWithShoeSize(product, shoeSize);
  return `🔥 Perfecto 😊\n\nMe confirmaste que querés ${productName}.\n\n📍 ¿Para qué CIUDAD querés el envío?\n\n(Ejemplo: Asunción, Capiatá, Luque, San Lorenzo, Fernando de la Mora...)`;
}

function buildQuantityAfterCityResponse(product: string, city: string, shoeSize?: any): string {
  const productName = formatProductWithShoeSize(product, shoeSize);

  if (normalize(product).includes("tornado") || normalize(product).includes("destapa")) {
    return `✅ ¡Perfecto! ${city} tiene ENVÍO GRATIS contra-entrega 🚚\n\n🔥 ${productName}:\n• 1 unidad → 159.900 Gs\n\n💵 Pagás al recibir sin problema 😊\n\n⚠️ El precio promocional es válido solo si confirmás tus datos ahora mismo.\n\n🔥 ¿Cuántas unidades te gustaría llevar? ✨`;
  }

  if (normalize(product).includes("kit antivibracion") || normalize(product).includes("patitas antideslizantes")) {
    return `✅ Perfecto, enviamos a ${city} 😊\n\n📦 ${productName}\n\n¿Cuántos KITS querés? (Cada kit incluye 4 patitas)\n\nEjemplos:\n• 1 kit\n• 2 kits\n• 3 kits\n\nRespondé con el número (1, 2, 3...)`;
  }

  return `✅ Perfecto, enviamos a ${city} 😊\n\n📦 ${productName}\n\n¿Cuántas UNIDADES querés?\n\nEjemplos:\n• 1 unidad\n• 2 unidades (consultar si hay promo)\n• 3 unidades\n\nRespondé con el número (1, 2, 3...)`;
}

// =======================================================
// 🧠 DETECCIÓN AVANZADA DE PRODUCTOS DEL CATÁLOGO
// =======================================================
function detectProductRespectingActive(
  text: string,
  training: string,
  activeProduct: string | null,
  lastAssistantMessage?: string,
  lastUserProduct?: string
): string {
  const msg = normalize(text);

  if (/^\d{1,3}$/.test(msg)) {
    return activeProduct || "";
  }

  if (isPriceIntent(text) || isProductInquiry(text)) {
    return activeProduct || "";
  }

  const explicitNewProductRequest = /\b(quiero|comprar|llevo|dame|mandame|mejor|otro|cambiame|en lugar de|en vez de)\s+(la\s+)?(raqueta|veneno|abeja|plantilla|peladora|afilador|kit|máquina|nebulizador|tabla|pororo|vital|perfume|soporte|lavarropas|almohadilla|patitas|tornado|destapa)\b/i.test(msg);

  if (activeProduct && !explicitNewProductRequest) {
    return activeProduct;
  }

  if (explicitNewProductRequest) {
    const newProduct = detectProductRaw(text, training, lastAssistantMessage, lastUserProduct);
    if (newProduct && !isInvalidProductCandidate(newProduct)) {
      return newProduct;
    }
  }

  const detected = detectProductRaw(text, training, lastAssistantMessage, lastUserProduct);
  if (detected && !isInvalidProductCandidate(detected)) {
    return detected;
  }

  return activeProduct || "";
}

function detectProductRaw(
  text: string,
  training: string,
  prev?: string,
  lastAssistantMessage?: string,
  lastUserProduct?: string
): string {
  const msg = normalize(text);

  if (/^\d{1,3}$/.test(msg)) return "";

  if (msg.includes("tornado") || msg.includes("destapa") || msg.includes("cañeria") ||
      msg.includes("cañería") || msg.includes("tuberia") || msg.includes("tubería") ||
      msg.includes("desagüe") || msg.includes("desague") || msg.includes("wild tornado")) {
    return getTornadoProductName();
  }

  if (isAntiVibrationKit(text) || isPackReferenceText(text) ||
      msg.includes("soporte lavarropas") || msg.includes("almohadillas antivibracion") ||
      msg.includes("patitas antideslizantes") || msg.includes("kit x4")) {
    return getAntiVibrationProductName();
  }

  if (msg.includes("raqueta") || msg.includes("electrica") || msg.includes("flayes") ||
      msg.includes("mosquitos") || msg.includes("moscas") || msg.includes("insectos")) {
    return "Raqueta Eléctrica para Insectos";
  }

  if (msg.includes("veneno") || msg.includes("abeja") || msg.includes("crema de abeja")) {
    return "Veneno de Abeja";
  }

  if (msg.includes("plantilla") || msg.includes("ortopiex") || msg.includes("ortoflex") || msg.includes("5d")) {
    return getDefaultShoeProductName();
  }

  if (msg.includes("pelador") || msg.includes("peladora") || msg.includes("pelar papas")) {
    return "Peladora Automática";
  }

  if (msg.includes("pororo") || msg.includes("popcorn") || msg.includes("pochoclo") || msg.includes("palomita")) {
    return "Máquina para hacer Pororo";
  }

  if (msg.includes("nebulizador")) return "Nebulizador portátil";

  if ((msg.includes("tabla") && msg.includes("picar")) || msg.includes("tabla de marmol")) {
    return "Tabla de Picar de Mármol";
  }

  if (msg.includes("afilador") || msg.includes("cuchillo") || msg.includes("sharpener")) {
    return "Afilador de Cuchillos";
  }

  if (msg.includes("vital honey")) return "Vital Honey VIP";
  if (msg.includes("perfume asad") || msg.includes("asad")) return "Perfume Asad";

  const lines = getPriceLines(training);
  let best = "";
  let bestScore = 0;

  for (const line of lines) {
    const name = extractProductNameFromLine(line);
    if (isInvalidProductCandidate(name)) continue;
    const n = normalize(name);
    if (!n || n.length < 3) continue;

    const words = n.split(" ").filter((w) => w.length >= 4);
    const msgWords = msg.split(" ").filter((w) => w.length >= 4);

    let score = 0;
    if (msg.includes(n)) score += 50;
    if (n.includes(msg) && msg.length >= 4) score += 20;
    for (const w of words) { if (msg.includes(w)) score += 10; }
    for (const mw of msgWords) { if (n.includes(mw)) score += 8; }

    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }

  return bestScore >= 5 ? best : "";
}

function canonicalProductFromText(text: string): string {
  const n = normalize(text);
  if (/\b(tornado|destapa|cañeria|cañería|tuberia|tubería|desagüe|desague|wild\s+tornado)\b/.test(n)) return getTornadoProductName();
  if (/\b(raqueta|electrica|flayes|mosquitos|moscas|insectos)\b/.test(n)) return "Raqueta Eléctrica para Insectos";
  if (/\b(crema\s+de\s+abeja|creama\s+de\s+abeja|veneno\s+de\s+abeja)\b/.test(n)) return "Veneno de Abeja";
  if (/\b(pelador|peladora|pelar\s+papas|pelador\s+de\s+papas|peladora\s+automatica)\b/.test(n)) return "Peladora Automática";
  if (/\b(soporte\s+para\s+lavarropas|lavarropas|almohadillas\s+antivibracion|patitas\s+antideslizantes|kit\s+antivibracion)\b/.test(n)) return getAntiVibrationProductName();
  if (/\b(plantilla|plantillas|ortopiex|ortoflex)\b/.test(n)) return getDefaultShoeProductName();
  if (/\b(afilador|afilador\s+de\s+cuchillos|cuchillos)\b/.test(n)) return "Afilador de Cuchillos";
  if (/\b(vital\s+honey|vital\s+honey\s+vip)\b/.test(n)) return "Vital Honey VIP";
  if (/\b(perfume\s+asad|asad)\b/.test(n)) return "Perfume Asad";
  return "";
}

function uniqueProducts(products: string[]): string[] {
  const out: string[] = [];
  for (const p of products.map(clean).filter(Boolean)) {
    if (isInvalidCartProduct(p)) continue;
    if (!out.some((x) => sameProduct(x, p))) out.push(p);
  }
  return out;
}

function detectMultipleProducts(text: string, training: string): string[] {
  const raw = clean(text);
  const n = normalize(raw);
  const found: string[] = [];

  const fullMatch = canonicalProductFromText(raw);
  if (fullMatch) found.push(fullMatch);

  const segments = n
    .split(/\b(?:tambien|también|ademas|además|agrega|agregame|sumame|suma|sumá|inclui|incluí|añadi|añadí|mas|más)\b/g)
    .map((x) => x.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const protectedProduct = canonicalProductFromText(segment);
    if (protectedProduct) found.push(protectedProduct);

    const catalogProduct = detectProductRaw(segment, training, "");
    if (catalogProduct && !isInvalidProductCandidate(catalogProduct)) {
      found.push(catalogProduct);
    }
  }

  return uniqueProducts(found);
}

function sameProduct(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// =======================================================
// 📋 FILTROS DE TEXTO Y AUXILIARES DE PARSEO
// =======================================================
function isPriceIntent(text: string): boolean {
  const m = normalize(text);
  return m.includes("precio") || m.includes("cuanto") || m.includes("cuesta") || m.includes("valor") || m.includes("costo");
}

function isBuyIntent(text: string): boolean {
  const m = normalize(text);
  if (isInformationRequest(text) || isCatalogQuery(text) || isProductInquiry(text)) return false;
  if (/\b(gracias|very nice|muy lindo|excelente|bien|okey|oka|perfecto|hermoso|genial|buenisimo)\b/i.test(m)) return false;
  if (/^\s*(quiero|si|sí|dale|ok|listo|confirmo|compro|reservo)\s*$/i.test(m)) return true;
  return (
    /\b(quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmar|mandame|dame)\s+\d+\b/.test(m) ||
    /\b\d+\s*(unidad|unidades|u)\b/.test(m) ||
    /^\d+$/.test(m)
  );
}

function isInformationRequest(text: string): boolean {
  const n = normalize(text);
  if (/\b(si|sí|quiero|compro|reservo|confirmo|dale|ok|listo)\b/.test(n)) return false;
  if (/^\d{1,3}$/.test(n)) return false;
  if (/\b(quiero|comprar|llevo|dame|mandame)\s+\d+\b/.test(n)) return false;
  const infoWords = /\b(informaci[oó]n|info|más info|mas info|quiero saber|consultar|dudas?|detalles|explicame|qué es|que es)\b/i;
  const productWords = /\b(veneno|abeja|crema|plantilla|ortopiex|pelador|afilador|vital|perfume|soporte|tornado|destapa)\b/i;
  if (productWords.test(n)) return false;
  return infoWords.test(n);
}

function isCatalogQuery(text: string): boolean {
  const n = normalize(text);
  return /\b(cat[aá]logo|productos|qu[eé] venden|tienen|stock|catálogo|precios|catalogo)\b/i.test(n) && 
         !/\b(plantilla|pelador|afilador|veneno|tornado|destapa)\b/i.test(n);
}

function isProductInquiry(text: string): boolean {
  const n = normalize(text);
  const inquiryWords = /\b(qu[eé] es|cómo funciona|para qu[eé] sirve|características|informaci[oó]n|info|cu[aá]nto cuesta|precio)\b/i;
  const productWords = /\b(veneno|abeja|plantilla|ortopiex|pelador|afilador|vital|perfume|soporte|tornado|destapa)\b/i;
  return inquiryWords.test(n) && productWords.test(n) && !/\b(quiero|comprar|llevo)\b/i.test(n);
}

function isProductName(text: string): boolean {
  const n = normalize(text);
  const productNames = ["veneno de abeja", "plantillas ortopiex", "peladora", "pororo", "nebulizador", "afilador", "vital honey", "perfume asad", "patitas antideslizantes", "raqueta electrica", "destapa cañerias tornado"];
  return productNames.some(p => n.includes(p) || p.includes(n));
}

function isShoeProductText(text: string): boolean {
  return /\b(plantilla|plantillas|ortopiex|ortoflex|5d)\b/.test(normalize(text));
}

function productRequiresSize(product: string): boolean {
  return isShoeProductText(product);
}

function isOnlyShoeVariantText(text: string): boolean {
  const n = normalize(text);
  if (!n || isShoeProductText(n)) return false;
  return (/\b(calce|talle|numero|nro|num|medida)\b/.test(n) || /^\d{2}$/.test(n));
}

function extractShoeSizeFromText(text: string): number {
  const n = normalize(text);
  const explicit = n.match(/\b(talle|numero|nro|num|calzo|soy)\s*(\d{2})\b/);
  const plain = n.match(/^\s*(\d{2})\s*$/);
  const value = explicit ? Number(explicit[1]) : plain ? Number(plain[1]) : 0;
  return value >= 20 && value <= 50 ? value : 0;
}

function isPackReferenceText(text: string): boolean {
  return /\b(kit\sx\s4|pack\sx\s4|x\s4|4\sunidades|kit\sx4|patitas\s+antideslizantes)\b/.test(normalize(text));
}

function isAntiVibrationKit(text: string): boolean {
  return /\b(almohadillas?\s+antivibracion|soporte\s+para\s+lavarropas|patitas?\s+antideslizantes|kit\s+antivibracion)\b/.test(normalize(text));
}

function getPriceLines(training: string): string[] {
  return training.split("\n").map((l) => clean(l)).filter((l) => l.length > 3);
}

function extractProductNameFromLine(line: string): string {
  const c = line.replace(/^[-•\s]+/, "").replace(/[💙🦶🎯💰🔥✨⭐✅]/g, "").trim();
  const parts = c.split(/—|-{2,}|–/);
  return clean(parts[0] || c);
}

// =======================================================
// 🚫 POLÍTICAS DE EXCLUSIÓN E INVALIDACIÓN
// =======================================================
function isInvalidProductCandidate(name: string): boolean {
  const n = normalize(name);
  if (!n || isOnlyShoeVariantText(name)) return true;
  if (/^(calce|talle|numero|nro|num|número|medida)$/.test(n)) return true;
  const invalidExact = ["1 unidad", "2 unidades", "unidad", "unidades", "precio", "total", "envio gratis"];
  if (invalidExact.includes(n)) return true;
  if (/^\d+\s*(unidad|unidades|u|kit|kits)$/.test(n)) return true;
  if (/^(si|sí|ok|dale|listo|quiero|confirmo|gracias)$/.test(n)) return true;
  return false;
}

function isInvalidCartProduct(name: string): boolean {
  const raw = clean(name);
  const n = normalize(raw);
  if (!n || n.length < 4 || isOnlyShoeVariantText(name)) return true;
  if (/\b(quiero|cantidad|total|precio|delivery|envio)\b/.test(n)) return true;
  return false;
}

// =======================================================
// ⏳ DETECCIÓN DE CONTEXTO EN HISTORIAL DEL BOT
// =======================================================
function getLastAssistantMessage(history: any[]): string {
  if (!Array.isArray(history)) return "";
  const last = history.filter((h: any) => h?.role === "assistant" || h?.role === "model").slice(-1)[0];
  return clean(last?.content);
}

function botWasAskingQuantity(history: any[]): boolean {
  const last = normalize(getLastAssistantMessage(history));
  return last.includes("cuantas unidades") || last.includes("cantidad") || last.includes("cuantas te gustaria") || last.includes("responde con el numero");
}

function botWasAskingCity(history: any[]): boolean {
  const last = normalize(getLastAssistantMessage(history));
  return last.includes("que ciudad") || last.includes("para que ciudad") || last.includes("ciudad queres");
}

function botWasAskingShoeSize(history: any[]): boolean {
  const last = normalize(getLastAssistantMessage(history));
  return last.includes("que calce") || last.includes("que talle") || last.includes("numero te gustaria");
}

// =======================================================
// ⚙️ CONTROLADOR PRINCIPAL DEL FLUJO DE TRABAJO (STATE MACHINE)
// =======================================================
export async function handleWhatsAppMessage(
  userId: string, 
  userText: string, 
  history: any[], 
  trainingData: string
): Promise<string> {
  
  const currentText = clean(userText);
  
  // 🚨 1. GUARDRAIL DE ÉXITO: Detectar si el usuario está enviando los datos finales de entrega
  if (isFullContactDataIntent(currentText)) {
    
    // Aquí puedes extraer datos con expresiones regulares si lo necesitas
    // Ej: const phone = currentText.match(/(09\d{8})/)?.[0];
    
    // Guardar el pedido en Supabase
    await supabase.from("orders").insert([
      { 
        user_id: userId, 
        raw_delivery_data: currentText, 
        status: "pending_delivery",
        created_at: new Date()
      }
    ]);

    // Actualizar el estado del flujo del usuario a 'completed' para liberar la cola
    await supabase.from("user_states").update({ current_step: "completed" }).eq("user_id", userId);

    return `¡Espectacular! Ya tengo agendados todos tus datos correctamente. 🚚✨\n\nEl repartidor se va a estar comunicando contigo a tu número celular antes de llegar para coordinar la entrega en tu domicilio.\n\n¡Muchas gracias por tu compra! ❤️`;
  }

  // -----------------------------------------------------------------------------------
  // ⚡ 2. Evaluación de Estados del Embudo de Ventas (Flujo normal)
  // -----------------------------------------------------------------------------------
  
  // Obtener estado anterior guardado en Base de Datos
  const { data: stateData } = await supabase.from("user_states").select("*").eq("user_id", userId).single();
  let previousStep = stateData?.current_step || "idle";
  let activeProduct = stateData?.active_product || null;

  // Detectar producto dinámicamente si se menciona
  const detectedProduct = detectProductRespectingActive(currentText, trainingData, activeProduct, getLastAssistantMessage(history));
  
  if (detectedProduct && detectedProduct !== activeProduct) {
    activeProduct = detectedProduct;
    await supabase.from("user_states").upsert({ user_id: userId, active_product: activeProduct });
  }

  // A) Si el Bot estaba esperando la Ciudad
  if (botWasAskingCity(history) || previousStep === "collecting_city") {
    const city = extractCityFromText(currentText);
    if (city) {
      await supabase.from("user_states").update({ current_step: "collecting_quantity", city: city }).eq("user_id", userId);
      return buildQuantityAfterCityResponse(activeProduct || TORNADO_PRODUCT, city);
    }
  }

  // B) Si el Bot estaba esperando la Cantidad
  if (isUserRespondingWithQuantity(currentText, previousStep, history)) {
    const qtyResult = extractQuantityFromAnyText(currentText);
    const finalQty = qtyResult.quantity || 1;
    
    await supabase.from("user_states").update({ current_step: "collecting_data", quantity: finalQty }).eq("user_id", userId);

    return `🔥 Perfecto 😊\n\nTu pedido queda así:\n\n📦 ${activeProduct || TORNADO_PRODUCT}\n🔢 Cantidad: ${finalQty}\n💰 Total: ${(finalQty * TORNADO_PRICE).toLocaleString('es-PY')} Gs\n\n🚚 Envío GRATIS contra-entrega\n\n📎 Pasame *TODO JUNTO en un solo mensaje*:\n\n✅ nombre y apellido\n✅ dirección exacta o ubicación por Google Maps\n✅ número de celular\n\ny agendamos tu entrega ✨`;
  }

  // C) Flujo inicial o por defecto (Si entra saludando o queriendo comprar)
  if (isBuyIntent(currentText) && activeProduct) {
    await supabase.from("user_states").update({ current_step: "collecting_city" }).eq("user_id", userId);
    return buildCityQuestionResponse(activeProduct);
  }

  // Respuesta de fallback nativa (Plantilla de Re-recolección segura)
  return `¡Hola! Para ayudarte a agendar tu compra de ${activeProduct || "nuestros productos"},\n¿me podrías confirmar para qué *Ciudad* necesitás el envío? 📦📍`;
}
