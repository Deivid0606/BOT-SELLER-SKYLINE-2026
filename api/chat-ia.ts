// api/chat-ia.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

const CATALOG_URL = "https://cat-logomegatodo-com.vercel.app/";

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
// 🧠 GUARDRAILS DETERMINÍSTICOS
// =======================================================

function hasExplicitProductMention(text: string): boolean {
  const n = normalize(text);
  const buyIndicators = /\b(quiero|comprar|llevo|dame|mandame|reservar|apartar|me\s+interesa|necesito|busco|me\s+gustaría|el\s+destapa|la\s+raqueta|el\s+veneno|las\s+plantillas|la\s+peladora|el\s+afilador|el\s+kit|la\s+máquina|el\s+nebulizador|la\s+tabla|el\s+destapa|la\s+cañeria)\b/i;
  const productNames = /\b(veneno|abeja|crema|plantilla|plantillas|ortopiex|ortoflex|5d|pelador|peladora|papas|afilador|cuchillo|cuchillos|vital|honey|perfume|asad|soporte|lavarropas|almohadilla|almohadillas|patitas|antideslizantes|maquina|máquina|pororo|popcorn|pochoclo|palomita|palomitas|nebulizador|tabla|picar|marmol|mármol|raqueta|electrica|flayes|mosquitos|moscas|destapa|cañeria|tornado|desagüe|cañería)\b/.test(n);
  return buyIndicators.test(n) || productNames;
}

function isLocationOnlyMessage(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (hasExplicitProductMention(text)) return false;
  const cityMatch = extractCityFromText(n);
  if (!cityMatch) return false;
  const noProductWords = !/\b(quiero|comprar|raqueta|veneno|plantilla|pelador|afilador|kit|máquina|nebulizador|tabla|pororo|vital|perfume|soporte|lavarropas|almohadilla|patitas|destapa|cañeria|tornado|desagüe)\b/i.test(n);
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

function buildCoverageOnlyResponse(city: string): string {
  const tipo = getTipoCobertura(city);
  if (tipo === "con_cobertura") {
    return `✅ ¡Genial! ${city} tiene cobertura 🟢

🚚 **Envío GRATIS** a tu domicilio
💵 **Pagás al recibir** (efectivo, transferencia o QR)

¿Cuál producto te interesa? ✨`;
  }
  if (tipo === "sin_cobertura") {
    return `ℹ️ ${city} no tiene cobertura de delivery 🔴

🚚 **Envío por encomienda** (transportadora: TSI / NASA / Occidental / MG Express)
💵 **Pago anticipado por transferencia**

¿Cuál producto te interesa? ✨`;
  }
  return `😊 ¡Hola! ¿Cuál producto te interesa? ✨`;
}

function buildWaitingPaymentResponse(order: any): string {
  return `✅ ¡Gracias ${order.customer_name ? order.customer_name.split(" ")[0] : ""}! 🤗

Ya registré tu pedido:

📦 ${formatProductWithShoeSize(order.product, order.shoe_size)}
📍 ${order.city}
📞 ${order.phone}

📲 Ahora solo falta que me envíes el **comprobante de transferencia** y confirmamos tu envío por encomienda 🚚✨

📲 DATOS PARA TRANSFERENCIA:
   Titular: DAVID AGUSTIN ALCARAZ AGUILAR
   Banco Familiar · Cuenta: 81-4981442
   Alias: 0994130022`;
}

function isInformationRequest(text: string): boolean {
  const n = normalize(text);
  const infoWords = /\b(informaci[oó]n|info|más info|mas info|quiero saber|consultar|dudas?|más datos|mas datos|detalles|más detalles|mas detalles|explicame|qué es|que es|cómo funciona|como funciona)\b/i;
  const productWords = /\b(veneno|abeja|crema|plantilla|ortopiex|ortoflex|5d|pelador|peladora|afilador|vital|honey|perfume|asad|soporte|lavarropas|almohadilla|cuchillo|raqueta|electrica|flayes|destapa|cañeria|tornado)\b/i;
  if (productWords.test(n)) return false;
  return infoWords.test(n);
}

function isCatalogQuery(text: string): boolean {
  const n = normalize(text);
  const catalogWords = /\b(cat[aá]logo|productos|qu[eé] venden|tienen|stock|catálogo|precios|catalogo)\b/i;
  const greetingWords = /\b(hola|buenas|buen día|saludos)\b/i;
  const productWords = /\b(plantilla|ortopiex|pelador|afilador|veneno|vital|perfume|soporte|pororo|maquina|máquina|nebulizador|tabla|raqueta|destapa|cañeria|tornado)\b/i;
  return (catalogWords.test(n) || greetingWords.test(n)) && !productWords.test(n);
}

function isNewConversation(text: string, history: any[]): boolean {
  const n = normalize(text);
  const hasProductMention = /\b(me interesa|quiero|comprar|necesito|busco|el destapa|la raqueta|el veneno|las plantillas)\b/i.test(n);
  const newConversationMarkers = /\b(creo que guardo|mensaje antiguo|chat viejo|conversación anterior|pedido anterior|viejo mensaje|lo tengo guardado|tengo un mensaje|mensaje guardado|chat pasado|nuevo pedido|empezar de nuevo|borrar pedido|reiniciar)\b/i;
  const noHistory = !history || history.length === 0;
  const mentionsOldMessage = newConversationMarkers.test(n);
  
  if (hasProductMention && !noHistory) {
    console.log("🆕 Cliente mencionó producto - tratando como nueva conversación");
    return true;
  }
  
  return noHistory || mentionsOldMessage;
}

function isProductInquiry(text: string): boolean {
  const n = normalize(text);
  const inquiryWords = /\b(qu[eé] es|cómo funciona|para qu[eé] sirve|características|beneficios|tiene|informaci[oó]n|info|cu[aá]nto cuesta|precio|valor|costo|dime|contame|explicame)\b/i;
  const productWords = /\b(veneno|abeja|plantilla|ortopiex|pelador|afilador|vital|perfume|soporte|lavarropas|ortoflex|5d|cuchillo|pororo|maquina|máquina|nebulizador|tabla|raqueta|destapa|cañeria|tornado)\b/i;
  const buyWords = /\b(quiero|comprar|llevo|dame|mandame|agregame|reservar|apartar|me interesa)\b/i;
  return inquiryWords.test(n) && productWords.test(n) && !buyWords.test(n);
}

function isProductName(text: string): boolean {
  const n = normalize(text);
  const productNames = [
    "veneno de abeja", "crema de abeja", "abeja",
    "plantillas ortopiex", "ortopiex", "plantillas", "ortoflex", "5d",
    "peladora automatica", "pelador automatico", "pelador", "peladora",
    "maquina para hacer pororo", "maquina pororo", "pororo", "popcorn", "pochoclo", "palomitas",
    "nebulizador", "nebulizador portatil", "tabla de picar", "tabla de marmol",
    "afilador de cuchillos", "afilador", "cuchillos", "sharpener",
    "vital honey vip", "vital honey",
    "perfume asad", "asad",
    "almohadillas antivibracion", "soporte para lavarropas", "lavarropas", "kit x4 patitas", "patitas antideslizantes",
    "raqueta electrica", "raqueta para insectos", "flayes pro", "raqueta flayes",
    "destapa cañerias", "destapa cañerias tornado", "tornado destapa cañerias", "desagüe", "wild tornado"
  ];
  const normalizedText = n;
  return productNames.some(p => normalizedText.includes(p) || p.includes(normalizedText));
}

function isShoeProductText(text: string): boolean {
  const n = normalize(text);
  return /\b(plantilla|plantillas|ortopiex|ortoflex|5d)\b/.test(n);
}

function productRequiresSize(product: string): boolean {
  return isShoeProductText(product);
}

function getDefaultShoeProductName(): string {
  return "PLANTILLAS ORTOPIEX 5D®";
}

function isOnlyShoeVariantText(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  if (isShoeProductText(n)) return false;
  return (/\b(calce|talle|numero|nro|num|medida)\b/.test(n) || /^\d{2}$/.test(n));
}

function extractShoeSizeFromText(text: string): number {
  const n = normalize(text);
  const explicit = n.match(/\b(?:talle|numero|nro|num|uso|calzo|soy|en|del|de|para)\s*(\d{2})\b/);
  const plain = n.match(/^\s*(\d{2})\s*$/);
  const value = explicit ? Number(explicit[1]) : plain ? Number(plain[1]) : 0;
  return value >= 20 && value <= 50 ? value : 0;
}

function isPackReferenceText(text: string): boolean {
  const n = normalize(text);
  return /\b(kit\sx\s4|kit\s+por\s+4|pack\sx\s4|pack\s+por\s+4|x\s4|4\sunidades\s*(incluidas|incluido)?|las\s4\sunidades|kit\sx4|patitas\s+antideslizantes|kit\s+antivibracion)\b/.test(n);
}

function isAntiVibrationKit(text: string): boolean {
  const n = normalize(text);
  return /\b(almohadillas?\s+antivibracion|almohadillas?\s+antivibraci[oó]n|soporte\s+para\s+lavarropas|soporte\s+antivibracion|patitas?\s+antideslizantes|kit\s+x4\s+patitas|kit\s+antivibracion|lavarropas\s+camina|heladera\s+vibra)\b/.test(n);
}

function isInvalidProductCandidate(name: string): boolean {
  const n = normalize(name);
  if (!n) return true;
  if (isOnlyShoeVariantText(name)) return true;
  if (/^(calce|talle|numero|nro|num|número|medida)$/.test(n)) return true;

  const invalidExact = [
    "1 unidad", "2 unidades", "3 unidades", "4 unidades",
    "unidad", "unidades", "cantidad", "precio", "total",
    "envio gratis", "pago al recibir", "calce", "talle",
    "numero", "nro", "num", "número", "medida",
  ];

  if (invalidExact.includes(n)) return true;
  if (n.includes("cliente envia nueva informacion") || n.includes("cuando el cliente") || n.includes("nueva informacion")) return true;
  if (/^\d+\s*(unidad|unidades|u|kit|kits)$/.test(n)) return true;
  if (/^\d+\s*(unidad|unidades).[",].\d+\s*(unidad|unidades)/.test(n)) return true;
  if (/^(si|sí|ok|dale|listo|quiero|confirmo|gracias)$/.test(n)) return true;
  if (/^\d+\squiero$/.test(n)) return true;
  if (/^quiero\s\d+$/.test(n)) return true;
  if (/\b\d+\squiero\b/.test(n)) return true;
  if (/\bquiero\s\d+\b/.test(n)) return true;
  if (/\bquiero\s*(calce|talle|numero|nro|num)\b/.test(n)) return true;
  if (/^\d+\s*(quiero|llevo|dame|mandame)/.test(n)) return true;
  if ((n.match(/\bquiero\b/g) || []).length >= 2) return true;

  return false;
}

function isInvalidCartProduct(name: string): boolean {
  const raw = clean(name);
  const n = normalize(raw);

  if (!n) return true;
  if (isOnlyShoeVariantText(name)) return true;
  if (/^(calce|talle|numero|nro|num|número|medida)$/.test(n)) return true;
  if (n.length < 4) return true;

  if (/^(cliente|nombre|contacto|telefono|teléfono|ubicacion|ubicación|direccion|dirección)\b/i.test(raw)) return true;
  if (n.includes("cliente envia nueva informacion") || n.includes("cuando el cliente") || n.includes("nueva informacion")) return true;
  if (/\b(quiero|cantidad|total|precio|delivery|envio|envío|pago al recibir|contra entrega)\b/.test(n)) return true;
  if (/^x\d+$/.test(n)) return true;
  if (/^\d+\s*(unidad|unidades|u|kit|kits)$/.test(n)) return true;
  if (/^kit\sx\s4\sunidades$/.test(n)) return true;
  if (/^pack\sx\s4\sunidades$/.test(n)) return true;
  if (/\d+\s*(unidad|unidades).(\d+\s(unidad|unidades))/.test(n)) return true;
  if (/^\d+\squiero$/.test(n)) return true;
  if (/^quiero\s\d+$/.test(n)) return true;
  if (/\b\d+\squiero\b/.test(n)) return true;
  if (/\bquiero\s\d+\b/.test(n)) return true;
  if (/^\d+\s*(quiero|llevo|dame|mandame)/.test(n)) return true;

  return false;
}

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

function getTipoCobertura(city: string): "con_cobertura" | "sin_cobertura" | "" {
  if (!city) return "";
  const c = normalize(city);
  if (/\b(cruce\s+san\s+alberto|cruse\s+san\s+alberto|san\s+alberto|pedro\s+juan\s+caballero|pjc)\b/.test(c)) return "sin_cobertura";
  return ZONAS_COBERTURA.some((z) => normalize(z) === c) ? "con_cobertura" : "sin_cobertura";
}

function extractBankReceiverFromTraining(training: string): string {
  const titular =
    training.match(/titular\s*[:-]\s*([^\n\r]+)/i)?.[1] ||
    training.match(/a nombre de\s*[:-]?\s*([^\n\r]+)/i)?.[1] ||
    "";
  return clean(titular).replace(/[✅📲💳]/g, "").trim();
}

function getPriceLines(training: string): string[] {
  return training.split("\n").map((l) => clean(l)).filter((l) => l.length > 3);
}

function extractProductNameFromLine(line: string): string {
  const c = line.replace(/^[-•\s]+/, "").replace(/[💙🦶🎯💰🔥✨⭐✅]/g, "").trim();
  const parts = c.split(/—|-{2,}|–/);
  return clean(parts[0] || c);
}

function getAntiVibrationProductName(): string {
  return "Kit Antivibración x4 Patitas Antideslizantes";
}

function getDestapaCañeriasProductName(): string {
  return "Destapa Cañerías Tornado";
}

// =======================================================
// 🧮 CÁLCULO DE TOTALES
// =======================================================

function parseGsAmount(text: string): number {
  const match = clean(text).match(/(\d{1,3}(?:\.\d{3})+|\d{4,})/);
  if (!match) return 0;
  return Number(match[1].replace(/\./g, ""));
}

function calculateTotal(product: string, quantity: number, training: string): number | null {
  if (!product || !quantity || quantity < 1) return null;

  const p = normalize(product);
  const lines = training.split("\n").map((l) => clean(l)).filter(Boolean);
  
  let bestMatch: { price: number; isPromo: boolean; promoQty: number; score: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nLine = normalize(line);
    
    let matchScore = 0;
    if (nLine.includes(p)) matchScore = 100;
    else {
      const productWords = p.split(" ").filter(w => w.length >= 4);
      for (const word of productWords) {
        if (nLine.includes(word)) matchScore += 20;
      }
    }
    
    if (matchScore === 0) continue;
    
    const searchWindow = lines.slice(i, Math.min(lines.length, i + 5));
    
    for (const searchLine of searchWindow) {
      const amount = parseGsAmount(searchLine);
      if (!amount) continue;
      
      const promoMatch = normalize(searchLine).match(/(\d+)\s*(?:x|unidades|uds?)\s*(?:por\s*)?/i);
      let promoQty = 0;
      let isExactPromo = false;
      
      if (promoMatch) {
        promoQty = parseInt(promoMatch[1]);
        isExactPromo = (promoQty === quantity);
      }
      
      const isUnitPrice = !promoMatch || promoQty === 1;
      
      let finalScore = matchScore;
      if (isExactPromo) finalScore += 100;
      else if (isUnitPrice && quantity === 1) finalScore += 50;
      else if (isUnitPrice) finalScore += 20;
      
      if (!bestMatch || finalScore > bestMatch.score) {
        bestMatch = {
          price: amount,
          isPromo: isExactPromo,
          promoQty: promoQty,
          score: finalScore
        };
      }
    }
  }
  
  if (bestMatch) {
    if (bestMatch.isPromo) return bestMatch.price;
    return bestMatch.price * quantity;
  }
  
  console.warn(`⚠️ No se encontró precio para: "${product}", cantidad: ${quantity}`);
  return null;
}

function getProductPrice(product: string, quantity: number, training: string): number | null {
  return calculateTotal(product, quantity, training);
}

// =======================================================
// 🎯 DETECCIÓN DE PRODUCTO - VERSIÓN ULTRA MEJORADA
// =======================================================

// 🆕 Función PRIORITARIA para detectar "destapa cañería" ANTES que cualquier otra cosa
function isDestapaCañeriasRequest(text: string): boolean {
  const n = normalize(text);
  
  // Patrones específicos para destapa cañerías
  const patterns = [
    "destapa cañeria",
    "destapa cañería", 
    "destapa caneria",
    "destapa canería",
    "wild tornado",
    "tornado destapa",
    "desague",
    "desagüe",
    "cañeria tapada",
    "cañería tapada",
    "agua tarda",
    "tuberia tapada",
    "tubería tapada",
    "me interesa el destapa",
    "el destapa cañería",
    "destapa canerias",
    "destapa cañerias",
    "cañeria",
    "cañería",
    "tapa cañerias",
    "tapa cañerías"
  ];
  
  for (const pattern of patterns) {
    if (n.includes(pattern)) {
      console.log(`🎯 DESTAPA CAÑERÍAS detectado por patrón: "${pattern}"`);
      return true;
    }
  }
  
  return false;
}

function canonicalProductFromText(text: string, training?: string): string {
  const n = normalize(text);
  
  // 🔥 PRIORIDAD MÁXIMA: Detectar destapa cañerías primero
  if (isDestapaCañeriasRequest(text)) {
    return getDestapaCañeriasProductName();
  }
  
  // Raqueta
  if (/\b(raqueta|electrica|flayes|mosquitos|moscas|insectos)\b/.test(n)) {
    return "Raqueta Eléctrica para Insectos";
  }
  
  // Veneno de abeja
  if (/\b(veneno|abeja|crema\s+de\s+abeja)\b/.test(n)) {
    return "Veneno de Abeja";
  }
  
  // Plantillas
  if (/\b(plantilla|plantillas|ortopiex|ortoflex)\b/.test(n)) {
    return getDefaultShoeProductName();
  }
  
  // Pelador
  if (/\b(pelador|peladora|pelar\s+papas)\b/.test(n)) {
    return "Peladora Automática";
  }
  
  // Pororo
  if (/\b(pororo|popcorn|pochoclo|palomitas)\b/.test(n)) {
    return "Máquina para hacer Pororo";
  }
  
  // Nebulizador
  if (/\b(nebulizador)\b/.test(n)) {
    return "Nebulizador portátil";
  }
  
  // Afilador
  if (/\b(afilador|cuchillo|cuchillos|sharpener)\b/.test(n)) {
    return "Afilador de Cuchillos";
  }
  
  // Vital Honey
  if (/\b(vital\s+honey)\b/.test(n)) {
    return "Vital Honey VIP";
  }
  
  // Perfume Asad
  if (/\b(perfume\s+asad|asad)\b/.test(n)) {
    return "Perfume Asad";
  }
  
  // Kit antivibración
  if (/\b(kit\s+antivibracion|patitas\s+antideslizantes|soporte\s+para\s+lavarropas)\b/.test(n)) {
    return getAntiVibrationProductName();
  }
  
  // Tabla de picar (solo si NO es destapa cañerías)
  if (/\b(tabla\s+de\s+picar|tabla\s+de\s+marmol|tabla\s+picar)\b/.test(n) && !isDestapaCañeriasRequest(text)) {
    return "Tabla de Picar de Mármol";
  }
  
  return "";
}

function detectProductRaw(
  text: string,
  training: string,
  prev?: string,
  lastAssistantMessage?: string,
  lastUserProduct?: string
) {
  const msg = normalize(text);
  
  // 🔥 PRIMERO: Verificar si es destapa cañerías
  if (isDestapaCañeriasRequest(text)) {
    return getDestapaCañeriasProductName();
  }
  
  // Segundo: canonicalProductFromText
  const canonical = canonicalProductFromText(text);
  if (canonical) return canonical;
  
  // Detección por palabras clave
  if (msg.includes("destapa") || msg.includes("cañeria") || msg.includes("tornado") ||
      msg.includes("desagüe") || msg.includes("tuberia") || msg.includes("agua tarda") ||
      msg.includes("cañería") || msg.includes("tapa cañerias") || msg.includes("wild tornado")) {
    return getDestapaCañeriasProductName();
  }
  
  if (msg.includes("raqueta") || msg.includes("electrica") || msg.includes("flayes") ||
      msg.includes("mosquitos") || msg.includes("moscas")) {
    return "Raqueta Eléctrica para Insectos";
  }
  
  if (msg.includes("veneno") || msg.includes("abeja") || msg.includes("crema de abeja")) {
    return "Veneno de Abeja";
  }
  
  if (msg.includes("plantilla") || msg.includes("ortopiex") || msg.includes("ortoflex")) {
    return getDefaultShoeProductName();
  }
  
  if (msg.includes("pelador") || msg.includes("peladora") || msg.includes("pelar papas")) {
    return "Peladora Automática";
  }
  
  if (msg.includes("pororo") || msg.includes("popcorn") || msg.includes("pochoclo")) {
    return "Máquina para hacer Pororo";
  }
  
  if (msg.includes("nebulizador")) {
    return "Nebulizador portátil";
  }
  
  if (msg.includes("afilador") || msg.includes("cuchillo")) {
    return "Afilador de Cuchillos";
  }
  
  if (msg.includes("vital honey")) {
    return "Vital Honey VIP";
  }
  
  if (msg.includes("perfume asad") || msg.includes("asad")) {
    return "Perfume Asad";
  }
  
  if (msg.includes("kit antivibracion") || msg.includes("patitas antideslizantes")) {
    return getAntiVibrationProductName();
  }
  
  const trainingLines = training.split("\n").map(l => normalize(l)).filter(Boolean);
  
  let bestMatch = "";
  let bestScore = 0;
  
  for (const line of trainingLines) {
    let productName = line;
    const priceMatch = line.match(/(\d{1,3}(?:\.\d{3})+|\d{4,})\s*(?:Gs|₲|\$)/i);
    if (priceMatch) {
      productName = line.substring(0, priceMatch.index).trim();
    }
    productName = productName.split(/[—–\-|•·]/)[0].trim();
    
    if (productName.length < 3) continue;
    
    const pn = normalize(productName);
    let score = 0;
    if (msg.includes(pn)) score += 50;
    const productWords = pn.split(" ").filter(w => w.length >= 3);
    for (const w of productWords) {
      if (msg.includes(w)) score += 10;
    }
    if (pn.includes(msg) && msg.length >= 4) score += 20;
    
    if (score > bestScore && score >= 5) {
      bestScore = score;
      bestMatch = productName;
    }
  }
  
  return bestMatch || "";
}

function sameProduct(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  
  if (na === nb) return true;
  
  // Caso especial para destapa cañerías
  const isDestapa = (s: string) => 
    s.includes("destapa") || s.includes("cañeria") || s.includes("tornado") || s.includes("desagüe");
  
  if (isDestapa(na) && isDestapa(nb)) return true;
  
  const isTabla = (s: string) => s.includes("tabla") && (s.includes("picar") || s.includes("marmol"));
  if (isTabla(na) && isTabla(nb)) return true;
  
  return na.includes(nb) || nb.includes(na);
}

function detectProductRespectingActive(
  text: string,
  training: string,
  activeProduct: string | null,
  lastAssistantMessage?: string,
  lastUserProduct?: string
): string {
  const msg = normalize(text);
  
  // 🔥 REGLA DE ORO: Si el cliente pide destapa cañerías, eso es lo que importa
  if (isDestapaCañeriasRequest(text)) {
    console.log(`🔥 CLIENTE PIDIÓ DESTAPA CAÑERÍAS - Ignorando producto activo: "${activeProduct}"`);
    return getDestapaCañeriasProductName();
  }
  
  const detectedProduct = canonicalProductFromText(text);
  
  if (detectedProduct && activeProduct && !sameProduct(detectedProduct, activeProduct)) {
    console.log(`🔄 CLIENTE CAMBIÓ DE PRODUCTO: "${activeProduct}" → "${detectedProduct}"`);
    return detectedProduct;
  }
  
  if (detectedProduct) {
    console.log(`🎯 Producto detectado: "${detectedProduct}"`);
    return detectedProduct;
  }
  
  const explicitNewProductRequest = /\b(quiero|comprar|llevo|dame|mandame|mejor|otro|cambiame|en lugar de|en vez de)\s+(la\s+)?(raqueta|veneno|abeja|plantilla|peladora|afilador|kit|máquina|nebulizador|tabla|pororo|vital|perfume|soporte|lavarropas|almohadilla|patitas|destapa|cañeria|tornado|desagüe)\b/i.test(msg);
  
  if (activeProduct && !explicitNewProductRequest) {
    console.log(`🔄 Manteniendo producto activo: "${activeProduct}"`);
    return activeProduct;
  }
  
  const detected = detectProductRaw(text, training, lastAssistantMessage, lastUserProduct);
  if (detected && !isInvalidProductCandidate(detected)) {
    return detected;
  }
  
  return activeProduct || "";
}

function isPriceIntent(text: string) {
  const m = normalize(text);
  return m.includes("precio") || m.includes("cuanto") || m.includes("cuesta") || m.includes("valor") || m.includes("costo");
}

function isBuyIntent(text: string) {
  const m = normalize(text);

  if (isInformationRequest(text) || isCatalogQuery(text) || isProductInquiry(text)) return false;

  const graciasPattern = /\b(gracias|very nice|muy lindo|excelente|bien|okey|oka|perfecto|hermoso|genial|buenisimo)\b/i;
  if (graciasPattern.test(m)) return false;

  const soloQuieroPattern = /^\s*(quiero|si|sí|dale|ok|listo|confirmo|compro|reservo)\s*$/i;
  if (soloQuieroPattern.test(m)) return true;

  return (
    /\b(quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmar|mandame|dame)\s+\d+\b/.test(m) ||
    /\b\d+\s*(unidad|unidades|u)\b/.test(m) ||
    /^\d+$/.test(m)
  );
}

function getLastAssistantMessage(history: any[]) {
  if (!Array.isArray(history)) return "";
  const last = history
    .filter((h: any) => h?.role === "assistant" || h?.role === "model")
    .slice(-1)[0];
  return clean(last?.content);
}

function botWasAskingQuantity(history: any[]) {
  const lastAssistantMessage = normalize(getLastAssistantMessage(history));
  return (
    lastAssistantMessage.includes("cuantas unidades") ||
    lastAssistantMessage.includes("cuantos unidades") ||
    lastAssistantMessage.includes("cantidad") ||
    lastAssistantMessage.includes("cuantas queres") ||
    lastAssistantMessage.includes("cuantas te gustaria") ||
    lastAssistantMessage.includes("cuántas unidades") ||
    lastAssistantMessage.includes("Respondé con el número")
  );
}

function botWasAskingCity(history: any[]): boolean {
  const lastAssistantMessage = normalize(getLastAssistantMessage(history));
  return (
    lastAssistantMessage.includes("qué ciudad") ||
    lastAssistantMessage.includes("para qué ciudad") ||
    lastAssistantMessage.includes("ciudad querés") ||
    lastAssistantMessage.includes("a qué ciudad") ||
    lastAssistantMessage.includes("ciudad lo enviamos")
  );
}

function botWasAskingShoeSize(history: any[]) {
  const lastAssistantMessage = normalize(getLastAssistantMessage(history));
  return (
    lastAssistantMessage.includes("que calce") ||
    lastAssistantMessage.includes("qué calce") ||
    lastAssistantMessage.includes("calce te gustaria") ||
    lastAssistantMessage.includes("calce te gustaría") ||
    lastAssistantMessage.includes("que talle") ||
    lastAssistantMessage.includes("qué talle") ||
    lastAssistantMessage.includes("talle te gustaria") ||
    lastAssistantMessage.includes("talle te gustaría") ||
    lastAssistantMessage.includes("numero te gustaria") ||
    lastAssistantMessage.includes("nro te gustaria") ||
    lastAssistantMessage.includes("disponible del 35") ||
    lastAssistantMessage.includes("disponibles del 35")
  );
}

function extractData(
  msg: string,
  currentStep?: string,
  forceQuantityMode = false,
  forceShoeSizeMode = false
) {
  const text = clean(msg);
  const norm = normalize(text);

  if (isInformationRequest(text) || isCatalogQuery(text) || isProductInquiry(text)) {
    return { quantity: 0, shoe_size: "", city: "", name: "", phone: "", address: "" };
  }

  const phone = text.match(/(?:09\d{8}|\+595\d{9})/)?.[0] || "";
  const isPackReference = isPackReferenceText(text);

  const shoeSizeMatch = norm.match(/\b(?:talle|numero|nro|num|uso|calzo|soy|en|del|de|para)\s*(\d{2})\b/);
  const explicitShoeSize = shoeSizeMatch ? Number(shoeSizeMatch[1]) : 0;

  const waitingForShoeSize =
    forceShoeSizeMode ||
    currentStep === "collecting_shoe_size" ||
    currentStep === "esperando_calce" ||
    currentStep === "collecting_calce";

  const onlyShoeSizeMatch = waitingForShoeSize ? norm.match(/^\s*(\d{2})\s*$/) : null;
  const implicitShoeSize = onlyShoeSizeMatch ? Number(onlyShoeSizeMatch[1]) : 0;

  const shoe_size =
    explicitShoeSize >= 20 && explicitShoeSize <= 50 ? explicitShoeSize :
    implicitShoeSize >= 20 && implicitShoeSize <= 50 ? implicitShoeSize : 0;

  const isShoeSizeMessage = shoe_size >= 20 && shoe_size <= 50;

  let quantity = 0;

  if (
    !isShoeSizeMessage &&
    !waitingForShoeSize &&
    (forceQuantityMode || currentStep === "collecting_quantity" || currentStep === "esperando_cantidad")
  ) {
    const onlyNumber = norm.match(/^\s*(\d{1,3})\s*$/);
    if (onlyNumber) {
      const num = Number(onlyNumber[1]);
      if (num >= 1 && num <= 999) quantity = num;
    }
  }

  if (!forceQuantityMode && currentStep !== "collecting_quantity" && currentStep !== "esperando_cantidad") {
    quantity = 0;
  }

  if (!quantity && !isShoeSizeMessage && !waitingForShoeSize) {
    const q1 = norm.match(/\b(\d{1,3})\s*(unidad|unidades|u)\b/);
    if (q1) quantity = Number(q1[1]);

    const q2 = norm.match(/^(quiero|llevo|compro|reservo|dame|mandame)\s+(\d{1,3})$/i);
    if (!quantity && q2) quantity = Number(q2[2]);
  }

  if (isPackReference && (currentStep === "collecting_quantity" || currentStep === "esperando_cantidad")) {
    quantity = 1;
  }

  const cityAliases: Record<string, string> = {
    "cruce san alberto": "Cruce San Alberto", "cruse san alberto": "Cruce San Alberto", "san alberto": "San Alberto",
    asuncion: "Asunción", capiata: "Capiatá", capilata: "Capiatá", kapiata: "Capiatá",
    cde: "Ciudad del Este", "ciudad del este": "Ciudad del Este", luque: "Luque",
    ita: "Itá", lambare: "Lambaré", "san lorenzo": "San Lorenzo", sanlo: "San Lorenzo",
    "san lorenso": "San Lorenzo", fdm: "Fernando de la Mora", "fernando de la mora": "Fernando de la Mora",
    nemby: "Ñemby", ñemby: "Ñemby", ypane: "Ypané", limpio: "Limpio",
    "villa elisa": "Villa Elisa", hernandarias: "Hernandarias", "presidente franco": "Presidente Franco",
    "pte franco": "Presidente Franco", aregua: "Areguá", areguá: "Areguá",
    sanber: "San Bernardino", "san ber": "San Bernardino", "san bernardino": "San Bernardino",
    pjc: "Pedro Juan Caballero", "pedro juan": "Pedro Juan Caballero",
    "pedro juan caballero": "Pedro Juan Caballero",
  };

  let city = "";
  for (const [k, v] of Object.entries(cityAliases)) {
    if (new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)) {
      city = v;
      break;
    }
  }

  const address = text.match(/(?:dirección|dir|ubicacion|ubicación)\s*[:-]?\s*(.+)/i)?.[1] || "";

  let name = "";

  const invalidName =
    norm.includes("unidad") || norm.includes("unidades") ||
    norm.includes("precio") || norm.includes("delivery") ||
    norm.includes("envio") || norm.includes("envío") ||
    norm.includes("ubicacion") || norm.includes("ubicación") ||
    norm.includes("direccion") || norm.includes("dirección") ||
    norm.includes("calce") || norm.includes("talle") ||
    norm.includes("numero") || norm.includes("nro") ||
    norm.includes("veneno") || norm.includes("abeja") ||
    norm.includes("plantilla") || norm.includes("crema") ||
    norm.includes("ortopiex") || norm.includes("pelador") ||
    norm.includes("afilador") || norm.includes("vital") ||
    norm.includes("perfume") || norm.includes("soporte") ||
    norm.includes("lavarropas") || norm.includes("cuchillo") ||
    norm.includes("5d") || norm.includes("ortoflex") ||
    norm.includes("pororo") || norm.includes("maquina") ||
    norm.includes("nebulizador") || norm.includes("tabla") ||
    norm.includes("patitas") || norm.includes("antideslizantes") ||
    norm.includes("kit") || norm.includes("raqueta") ||
    norm.includes("destapa") || norm.includes("cañeria") || norm.includes("tornado");

  const nameMatch = text.match(/(?:me\s+llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,80})/i)?.[1];

  if (nameMatch && !invalidName && !isProductName(nameMatch)) {
    name = clean(nameMatch).replace(/de\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/i, "").trim();
  }

  if (!name && phone) {
    const possibleName = normalize(text)
      .replace(normalize(phone), " ")
      .replace(/\b(tel|tef|telefono|teléfono|cel|celular|nro|numero|número|contacto)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const titleName = possibleName
      .split(" ")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    if (titleName.length >= 5 && /^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(titleName) && !isProductName(titleName)) {
      name = titleName;
    }
  }

  if (
    !name && !invalidName && !/\d/.test(text) &&
    /^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s\.]{5,80}$/.test(text) &&
    !city && !phone && !quantity &&
    !norm.includes("hola") && !norm.includes("si") &&
    !isProductName(text)
  ) {
    name = clean(text.replace(/[.]+/g, " ").replace(/\s+/g, " "));
  }

  return {
    quantity,
    shoe_size: isShoeSizeMessage ? shoe_size : "",
    city,
    name,
    phone,
    address: clean(address),
  };
}

function safeQuantity(value: any): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const match = raw.match(/^\d{1,3}$/);
  if (!match) return 0;
  const n = Number(match[0]);
  if (!Number.isFinite(n) || n < 1 || n > 999) return 0;
  return n;
}

function mergeOrderData(old: any, ext: any, product: string): any {
  const newQuantity = safeQuantity(ext?.quantity);
  const oldQuantity = safeQuantity(old?.quantity);

  const finalQuantity = newQuantity > 0 ? newQuantity : oldQuantity;

  return {
    product: product || old?.product || "",
    quantity: finalQuantity,
    shoe_size: ext.shoe_size || old?.shoe_size || "",
    city: ext.city || old?.city || "",
    customer_name: ext.name || old?.customer_name || "",
    phone: ext.phone || old?.phone || "",
    address: ext.address || old?.address || "",
  };
}

function formatGs(amount: any): string {
  const n = Number(amount || 0);
  if (!n) return "0";
  return n.toLocaleString("de-DE");
}

function formatProductWithShoeSize(product: string, shoeSize?: any): string {
  const size = String(shoeSize || "").trim();
  if (!size) return clean(product);

  const p = clean(product);
  const n = normalize(p);

  if (n.includes("plantilla") || n.includes("ortopiex") || n.includes("ortoflex")) {
    return `${p} - Calce ${size}`;
  }

  return p;
}

type CartItem = { product: string; quantity: number; total: number; shoe_size?: any };

function isAddMoreIntent(text: string): boolean {
  const m = normalize(text);
  return (
    /\b(tambien|también|agrega|agregame|sumame|suma|sumá|inclui|incluí|añadi|añadí|mas|más)\b/.test(m) ||
    /\by\s+(la|el|los|las)\b/.test(m)
  );
}

function getCartItems(order: any): CartItem[] {
  const rawItems = Array.isArray(order?.items) ? order.items : [];

  const items: CartItem[] = rawItems
    .map((i: any) => {
      const quantity = safeQuantity(i?.quantity);
      const total = Number(i?.total || i?.total_amount || 0);
      return {
        product: clean(i?.product),
        quantity,
        total: Number.isFinite(total) ? total : 0,
        shoe_size: i?.shoe_size || i?.shoeSize || "",
      };
    })
    .filter(
      (i: CartItem) => i.product && i.quantity > 0 && !isInvalidCartProduct(i.product)
    );

  if (!items.length && order?.product && !isInvalidCartProduct(order.product) && safeQuantity(order?.quantity) > 0) {
    items.push({
      product: clean(order.product),
      quantity: safeQuantity(order.quantity),
      total: Number(order.total_amount || 0),
      shoe_size: order?.shoe_size || "",
    });
  }

  return items;
}

function cartGrandTotal(items: CartItem[]): number {
  return items.reduce((acc, i) => acc + Number(i.total || 0), 0);
}

function cartTotalQuantity(items: CartItem[]): number {
  return items.reduce((acc, i) => acc + safeQuantity(i.quantity), 0);
}

function addOrReplaceCartItem(
  items: CartItem[],
  product: string,
  quantity: number,
  total: number,
  mode: "add" | "replace" = "replace",
  shoeSize: any = ""
): CartItem[] {
  const cleanProduct = clean(product);
  const q = safeQuantity(quantity);
  const t = Number(total || 0);

  if (!cleanProduct || q < 1 || isInvalidCartProduct(cleanProduct)) return items;

  const next = [...items];
  const idx = next.findIndex((i) => sameProduct(i.product, cleanProduct));

  if (idx >= 0) {
    if (mode === "add") {
      const newQty = safeQuantity(next[idx].quantity) + q;
      next[idx] = {
        product: next[idx].product,
        quantity: newQty,
        total: Number(next[idx].total || 0) + t,
        shoe_size: shoeSize || next[idx].shoe_size || "",
      };
    } else {
      next[idx] = {
        product: cleanProduct,
        quantity: q,
        total: t,
        shoe_size: shoeSize || next[idx].shoe_size || "",
      };
    }
    return next;
  }

  next.push({ product: cleanProduct, quantity: q, total: t, shoe_size: shoeSize || "" });
  return next;
}

function normalizeOrderWithItems(order: any, training: string): any {
  let items = getCartItems(order);

  items = items.map((i) => {
    const qty = safeQuantity(i.quantity);
    const recalculated = calculateTotal(i.product, qty, training);
    return {
      product: i.product,
      quantity: qty,
      total: recalculated !== null ? recalculated : Number(i.total || 0),
      shoe_size: i.shoe_size || "",
    };
  });

  const total = cartGrandTotal(items);
  const qty = cartTotalQuantity(items);
  const summaryProduct = items.map((i) => `${i.product} x${i.quantity}`).join(" + ");

  return {
    ...(order || {}),
    items,
    product: order?.product || items[items.length - 1]?.product || summaryProduct || "",
    shoe_size: order?.shoe_size || "",
    quantity: order?.quantity ? safeQuantity(order.quantity) : qty,
    total_amount: total || Number(order?.total_amount || 0),
  };
}

function buildItemsLines(items: CartItem[]): string {
  return items
    .map((i) => `📦 ${formatProductWithShoeSize(i.product, i.shoe_size)} x${i.quantity} → ${formatGs(i.total)} Gs`)
    .join("\n");
}

function buildCartSummaryResponse(order: any, tipoCobertura: string) {
  const items = getCartItems(order);
  const total = cartGrandTotal(items) || Number(order?.total_amount || 0);

  const lines = items.length
    ? buildItemsLines(items)
    : `📦 ${formatProductWithShoeSize(order.product, order.shoe_size)}\n🔢 Cantidad: ${order.quantity}`;

  let promoNote = "";
  if (order.quantity === 2) {
    promoNote = `🎯 ¡APROVECHASTE LA PROMO! 🎯\n\n`;
  }

  if (tipoCobertura === "con_cobertura") {
    return `${promoNote}🔥 ¡Perfecto! Tu pedido quedó así 🤗

${lines}

💰 Total: ${formatGs(total)} Gs

🚚 **ENVÍO GRATIS** a ${order.city}
💵 **Pagás al recibir** (efectivo, transferencia o QR)

📎 Ahora solo me falta tu información:

✅ Nombre y apellido
✅ Dirección exacta o ubicación
✅ Número de celular

📲 En cuanto reciba tus datos, agendamos tu entrega ✨`;
  } else {
    return `${promoNote}🔥 ¡Perfecto! Tu pedido quedó así 🤗

${lines}

💰 Total: ${formatGs(total)} Gs

🚚 **ENVÍO POR ENCOMIENDA** (transportadora)
   ${order.city} - TSI / NASA / Occidental / MG Express

💵 **PAGO ANTICIPADO por transferencia**

📲 **DATOS PARA TRANSFERENCIA:**
   Titular: DAVID AGUSTIN ALCARAZ AGUILAR
   Banco Familiar · Cuenta: 81-4981442
   Alias: 0994130022

📎 Enviame:
✅ Comprobante de transferencia
✅ Nombre completo
✅ Teléfono

y confirmamos tu envío 🚚✨`;
  }
}

function buildAddedItemResponse(order: any, tipoCobertura: string) {
  return buildCartSummaryResponse(order, tipoCobertura);
}

function buildOrderSummaryResponse(order: any, tipoCobertura: string) {
  const items = getCartItems(order);
  if (items.length > 1) return buildCartSummaryResponse(order, tipoCobertura);
  return buildCartSummaryResponse(order, tipoCobertura);
}

function buildProductResponse(product: string, training: string): string {
  const unitPrice = getProductPrice(product, 1, training);
  
  if (unitPrice === null) {
    return `🤗 ¡Gracias por tu interés en ${product}!

⚠️ Estoy verificando el precio en el sistema, dame un segundito...

📍 Mientras tanto, ¿a qué ciudad te gustaría recibirlo? Así voy preparando todo 🚚`;
  }
  
  const promoPrice = getProductPrice(product, 2, training);
  
  let response = `🤗 ¡Qué buena elección! ${product} es uno de nuestros favoritos ⭐

💰 Precio especial: ${formatGs(unitPrice)} Gs`;
  
  if (promoPrice !== null && promoPrice !== unitPrice * 2) {
    const savings = unitPrice * 2 - promoPrice;
    response += `\n🔥 PROMO 2x → ${formatGs(promoPrice)} Gs (ahorrás ${formatGs(savings)} Gs)`;
  }
  
  response += `\n\n⚠️ STOCK LIMITADO - Solo quedan unidades para envíos de HOY.

📍 ¿A qué ciudad te gustaría recibirlo? 😊

Te explico cómo funciona según tu ubicación:

🟢 **Ciudades con cobertura** → Envío GRATIS · Pagás al recibir
🔴 **Otras ciudades** → Envío por encomienda · Pago anticipado

Escribime tu ciudad y te confirmo cómo llega tu pedido 🚚✨`;
  
  return response;
}

function buildQuantityAfterCityResponse(product: string, city: string, training: string, shoeSize?: any): string {
  const productName = formatProductWithShoeSize(product, shoeSize);
  const unitPrice = getProductPrice(product, 1, training);
  const tipoCobertura = getTipoCobertura(city);
  
  if (unitPrice === null) {
    return `✅ ¡Gracias! ${city} registrada 📍

📦 ${productName}

⚠️ Estoy verificando el precio en el sistema, dame un segundo...

${tipoCobertura === "con_cobertura" ? 
  `🟢 **${city} tiene cobertura** → Envío GRATIS · Pagás al recibir` : 
  `🔴 **${city} NO tiene cobertura** → Envío por encomienda · Pago anticipado por transferencia`}

📍 ¿Cuántas unidades querés? (1, 2, 3...)`;
  }
  
  const promoPrice = getProductPrice(product, 2, training);
  let priceInfo = `💰 ${formatGs(unitPrice)} Gs`;
  if (promoPrice !== null && promoPrice !== unitPrice * 2) {
    priceInfo += `\n🔥 PROMO 2x → ${formatGs(promoPrice)} Gs`;
  }
  
  if (tipoCobertura === "con_cobertura") {
    return `✅ ¡Perfecto! **${city}** tiene cobertura 🟢

📦 ${productName}
${priceInfo}

🚚 **Envío GRATIS** a tu domicilio
💵 **Pagás al recibir** (efectivo, transferencia o QR)

💡 Tip: La mayoría lleva 2 unidades porque rinde muchísimo y el stock es limitado.

🔥 ¿Cuántas unidades querés llevar?

Respondé con el número (1, 2, 3...) ✨`;
  } else {
    return `ℹ️ **${city}** no tiene cobertura de delivery 🔴

📦 ${productName}
${priceInfo}

🚚 **Envío por encomienda** (transportadora: TSI / NASA / Occidental / MG Express)
💵 **Pago anticipado por transferencia**

📲 **DATOS PARA TRANSFERENCIA:**
   Titular: DAVID AGUSTIN ALCARAZ AGUILAR
   Banco Familiar · Cuenta: 81-4981442
   Alias: 0994130022

🔥 ¿Cuántas unidades querés llevar?

Respondé con el número (1, 2, 3...) y te preparo el total ✨`;
  }
}

function handleProductSelection(product: string, training: string, shoeSize?: any) {
  const newOrder = {
    product: product,
    quantity: 0,
    shoe_size: shoeSize || "",
    city: "",
    customer_name: "",
    phone: "",
    address: "",
    items: [],
    total_amount: 0,
  };
  
  const productResponse = buildProductResponse(product, training);
  
  return {
    response: productResponse,
    order: newOrder,
    step: "collecting_city"
  };
}

function nextStep(order: any, tipoCobertura?: string, currentStatus?: string) {
  if (currentStatus === "confirmed") return "already_confirmed";
  
  const items = getCartItems(order);
  
  if (!order.product && !items.length) return "selling";
  
  if (!order.city || order.city === "") return "collecting_city";
  
  const hasValidQuantity = safeQuantity(order.quantity) > 0;
  if (!hasValidQuantity && !items.length) return "collecting_quantity";
  
  if (tipoCobertura === "sin_cobertura") {
    if (!order.customer_name) return "collecting_name";
    if (!order.phone) return "collecting_phone";
    return "waiting_payment_proof";
  }
  
  if (!order.customer_name) return "collecting_name";
  if (!order.phone) return "collecting_phone";
  if (!order.address) return "collecting_address";
  
  return "confirm_order";
}

async function safeUpsertOrder(
  userId: string,
  from: string,
  order: any,
  confirm = false,
  forcedStatus?: string
) {
  try {
    const orderItems = getCartItems(order);
    if (!order?.product && !orderItems.length) return null;
    if (!from) return null;

    const { data: existing, error: findErr } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", userId)
      .eq("from_number", from)
      .in("status", [
        "draft", "collecting_name", "collecting_city", "collecting_quantity",
        "collecting_phone", "collecting_address", "waiting_payment_proof",
        "payment_verified", "confirm_pending",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) {
      console.error("❌ findOrder:", findErr);
      return null;
    }

    if (existing?.status === "confirmed") {
      console.log("✅ Pedido ya confirmado, no se actualiza");
      return existing.id;
    }

    const tipoCobertura = getTipoCobertura(order.city);
    const step = nextStep(order, tipoCobertura, existing?.status);

    const finalStatus =
      forcedStatus ||
      (confirm && step === "confirm_order"
        ? "confirmed"
        : step === "confirm_order"
        ? "confirm_pending"
        : step === "already_confirmed"
        ? "confirmed"
        : step);

    const payload: any = {
      user_id: userId,
      from_number: from,
      phone: order.phone || from,
      product:
        orderItems.length > 1
          ? orderItems.map((i) => `${i.product} x${i.quantity}`).join(" + ")
          : formatProductWithShoeSize(
              order.product || orderItems[0]?.product || "",
              order.shoe_size
            ) || null,
      producto:
        orderItems.length > 1
          ? orderItems.map((i) => `${i.product} x${i.quantity}`).join(" + ")
          : formatProductWithShoeSize(
              order.product || orderItems[0]?.product || "",
              order.shoe_size
            ) || null,
      customer_name: order.customer_name || null,
      city: order.city || null,
      ciudad: order.city || null,
      address: order.address || null,
      quantity: orderItems.length ? cartTotalQuantity(orderItems) : order.quantity || null,
      total_amount: orderItems.length
        ? cartGrandTotal(orderItems)
        : order.total_amount || null,
      status: finalStatus,
      fecha: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error } = await supabase.from("orders").update(payload).eq("id", existing.id);
      if (error) console.error("❌ updateOrder:", error);
      return existing.id;
    }

    const { data, error } = await supabase.from("orders").insert(payload).select("id").single();
    if (error) {
      console.error("❌ insertOrder:", error);
      return null;
    }

    return data?.id || null;
  } catch (e) {
    console.error("❌ safeUpsertOrder:", e);
    return null;
  }
}

async function fetchMediaAsBase64(url: string): Promise<{ data: string; mime: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      console.error("❌ fetchMedia:", r.status, url.slice(0, 80));
      return null;
    }
    const mime = r.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await r.arrayBuffer());
    return { data: buf.toString("base64"), mime: mime.split(";")[0].trim() };
  } catch (e) {
    console.error("❌ fetchMediaAsBase64:", e);
    return null;
  }
}

async function callGemini({ apiKey, model, system, contents, temperature, maxTokens }: any) {
  const body: any = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95,
      topK: 40,
    },
  };

  if (String(model).includes("2.5")) {
    body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const data = await r.json();

  if (!r.ok) {
    console.error("❌ Gemini:", JSON.stringify(data).slice(0, 800));
    return "";
  }

  const c = data?.candidates?.[0];
  const text = clean(c?.content?.parts?.map((p: any) => p.text || "").join("") || "");

  console.log("🧠 finishReason:", c?.finishReason, "len:", text.length);

  return text;
}

async function analyzeImageWithGemini({
  apiKey, model, imageBase64, mime, caption, productList, expectedReceiverName,
}: any): Promise<{
  kind: "payment_proof" | "product" | "other";
  transcript: string;
  amount: string;
  receiverName: string;
  matchedProduct: string;
  productName: string;
  productPrice: string;
  promoText: string;
}> {
  const system = `Sos un clasificador visual de productos y comprobantes para una tienda de WhatsApp en Paraguay.

Devolvé EXCLUSIVAMENTE un JSON válido:
{
  "kind": "payment_proof" | "product" | "other",
  "transcript": "descripción breve",
  "amount": "monto si es comprobante, ejemplo 345.900",
  "receiverName": "nombre de quien recibió el pago si aparece",
  "matchedProduct": "nombre del producto si coincide con el catálogo",
  "productName": "nombre genérico del producto visto en la imagen",
  "productPrice": "precio visible si aparece en la imagen, ejemplo 129.900",
  "promoText": "promoción visible si aparece, ejemplo PROMO 2 UNIDADES"
}

REGLAS IMPORTANTES:

Si ves transferencia, banco, comprobante, destinatario, nro de comprobante o monto enviado → kind = "payment_proof".

Si es comprobante, extraé amount y receiverName.

El receptor esperado según entrenamiento es: "${expectedReceiverName || "no especificado"}".

Si el receptor aparece parecido al esperado, devolvé el nombre esperado del entrenamiento.

Si ves un producto físico, artículo, herramienta, máquina, envase, caja, frasco, accesorio o promo comercial → kind = "product".

Si es producto, NUNCA lo clasifiques como comprobante aunque tenga precio, números o texto de promo.

Si ves un afilador de cuchillos, sharpener, herramienta negra/roja con ranuras para cuchillos → productName = "Afilador de Cuchillos".

Si ves un destapa cañerías, desagüe, líquido para tuberías, botella negra/roja con texto "Destapa Cañerías" → productName = "Destapa Cañerías Tornado".

Si ves una imagen con texto "PROMO 2 UNIDADES 129.900Gs" y un producto físico → kind = "product", productPrice = "129.900", promoText = "PROMO 2 UNIDADES".

Si ves un pelador de papas, pelador automático, peladora de verduras → productName = "Peladora Automática".

Si el producto no está en catálogo, igual identificá el productName genérico visual.

matchedProduct solo va si encontrás coincidencia clara con el catálogo.

Si no estás seguro, usá kind = "other".

Caption del cliente: "${clean(caption) || "(vacío)"}"

Catálogo / entrenamiento:
${productList.slice(0, 5000)}

NO devuelvas texto fuera del JSON.`.trim();

  const contents = [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: mime, data: imageBase64 } },
        { text: caption ? `Caption: ${caption}` : "Analizá la imagen." },
      ],
    },
  ];

  const raw = await callGemini({ apiKey, model, system, contents, temperature: 0.02, maxTokens: 900 });

  try {
    const match = raw.match(/{[\s\S]*}/);
    if (!match) throw new Error("no json");

    const parsed = JSON.parse(match[0]);
    const kind =
      parsed.kind === "payment_proof" || parsed.kind === "product" || parsed.kind === "other"
        ? parsed.kind
        : "other";

    return {
      kind,
      transcript: clean(parsed.transcript),
      amount: clean(parsed.amount),
      receiverName: clean(parsed.receiverName),
      matchedProduct: clean(parsed.matchedProduct),
      productName: clean(parsed.productName),
      productPrice: clean(parsed.productPrice),
      promoText: clean(parsed.promoText),
    };
  } catch {
    console.warn("⚠️ analyzeImage no parseó JSON:", raw.slice(0, 200));
    return {
      kind: "other",
      transcript: clean(raw).slice(0, 200),
      amount: "", receiverName: "", matchedProduct: "",
      productName: "", productPrice: "", promoText: "",
    };
  }
}

async function transcribeAudioWithGemini({ apiKey, model, audioBase64, mime }: any): Promise<string> {
  const system =
    "Transcribí el audio al español tal cual lo dijo el hablante. Devolvé SOLO la transcripción en texto plano.";

  const contents = [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: mime, data: audioBase64 } },
        { text: "Transcribí este audio." },
      ],
    },
  ];

  const txt = await callGemini({ apiKey, model, system, contents, temperature: 0.1, maxTokens: 1024 });
  return clean(txt);
}

// =======================================================
// 🚀 HANDLER PRINCIPAL
// =======================================================

export default async function handler(req: any, res: any) {
  console.log("🔥 VERSION FINAL - CON SOLUCIONES PARA AMBOS PROBLEMAS");
  console.log("🔥 PROBLEMA 1: Evita confirmaciones múltiples");
  console.log("🔥 PROBLEMA 2: Detecta correctamente 'destapa cañería' y nuevos productos");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { user_id, message, from_number, context, history, media_url, media_type, mime_type } =
      req.body;

    let texto = clean(message);
    const fromNumber = clean(from_number);
    const mediaUrl = clean(media_url);
    const mediaType = clean(media_type);
    const mimeHint = clean(mime_type);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto && !mediaUrl) return res.status(400).json({ error: "Faltan message o media" });

    // 🔥 VERIFICACIÓN URGENTE: Si el cliente pide "destapa cañería", RESPONDER ESO
    if (isDestapaCañeriasRequest(texto)) {
      console.log("🚨 CLIENTE PIDIÓ DESTAPA CAÑERÍAS - Respondeiendo inmediatamente");
      
      const destapaProduct = getDestapaCañeriasProductName();
      const unitPrice = getProductPrice(destapaProduct, 1, fullTraining);
      
      return res.json({
        response: `🤗 ¡Qué buena elección! ${destapaProduct} es uno de nuestros favoritos ⭐

💰 Precio especial: ${formatGs(unitPrice || 159900)} Gs

⚠️ STOCK LIMITADO - Solo quedan unidades para envíos de HOY.

📍 ¿A qué ciudad te gustaría recibirlo? 😊

Te explico cómo funciona según tu ubicación:

🟢 **Ciudades con cobertura** → Envío GRATIS · Pagás al recibir
🔴 **Otras ciudades** → Envío por encomienda · Pago anticipado

Escribime tu ciudad y te confirmo cómo llega tu pedido 🚚✨`,
        context: {
          current_product: destapaProduct,
          last_user_product: destapaProduct,
          step: "collecting_city",
          tipo_cobertura: null,
          order_data: {
            product: destapaProduct,
            quantity: 0,
            city: "",
            customer_name: "",
            phone: "",
            address: "",
            items: [],
            total_amount: 0,
          },
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({ response: "⚠️ La IA no está configurada o desactivada." });
    }

    const { data: trainingRow } = await supabase
      .from("training_data")
      .select("id, intent, response, updated_at")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fullTraining = clean(trainingRow?.response);

    if (!fullTraining) {
      return res.json({ response: "⚠️ No encontré entrenamiento activo." });
    }

    const expectedReceiverName = extractBankReceiverFromTraining(fullTraining);
    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    let lastUserProduct = context?.last_user_product || "";

    if (!lastUserProduct && Array.isArray(history)) {
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.role === "user") {
          const userText = clean(msg.content);
          const detected = canonicalProductFromText(userText);
          if (detected && !isInvalidProductCandidate(detected)) {
            lastUserProduct = detected;
            break;
          }
          const norm = normalize(userText);
          if (norm.includes("destapa") || norm.includes("cañeria") || norm.includes("tornado")) { lastUserProduct = getDestapaCañeriasProductName(); break; }
          if (norm.includes("raqueta")) { lastUserProduct = "Raqueta Eléctrica para Insectos"; break; }
          if (norm.includes("veneno") || norm.includes("abeja")) { lastUserProduct = "Veneno de Abeja"; break; }
          if (norm.includes("plantilla") || norm.includes("ortopiex")) { lastUserProduct = getDefaultShoeProductName(); break; }
          if (norm.includes("pelador") || norm.includes("peladora")) { lastUserProduct = "Peladora Automática"; break; }
          if (norm.includes("pororo") || norm.includes("popcorn") || norm.includes("pochoclo")) { lastUserProduct = "Máquina para hacer Pororo"; break; }
          if (norm.includes("nebulizador")) { lastUserProduct = "Nebulizador portátil"; break; }
          if (norm.includes("tabla") && (norm.includes("picar") || norm.includes("marmol"))) { lastUserProduct = "Tabla de Picar de Mármol"; break; }
          if (isAntiVibrationKit(userText)) { lastUserProduct = getAntiVibrationProductName(); break; }
        }
      }
    }

    const isNewChat = isNewConversation(texto, history || []);

    let oldOrder;
    if (isNewChat) {
      oldOrder = {
        product: "", quantity: 0, shoe_size: "", city: "",
        customer_name: "", phone: "", address: "", items: [], total_amount: 0,
      };
      console.log("🔄 Conversación nueva detectada - Pedido reiniciado");
    } else {
      oldOrder = normalizeOrderWithItems(context?.order_data || {}, fullTraining);
    }

    const previousStep = clean(context?.step);
    const previousTipoCobertura = clean(context?.tipo_cobertura);
    const previousStatus = context?.order_data?.status || oldOrder?.status || "";

    const productInMessage = canonicalProductFromText(texto);
    const storedProduct = context?.current_product || context?.order_data?.product || oldOrder?.product || "";
    
    if (productInMessage && storedProduct && !sameProduct(productInMessage, storedProduct) && !isNewChat) {
      console.log(`🚨 CONFLICTO DE PRODUCTO DETECTADO!`);
      console.log(`   Guardado: "${storedProduct}"`);
      console.log(`   Cliente pide: "${productInMessage}"`);
      console.log(`   → REINICIANDO conversación para este producto`);
      
      const resetOrder = {
        product: productInMessage,
        quantity: 0,
        shoe_size: "",
        city: "",
        customer_name: "",
        phone: "",
        address: "",
        items: [],
        total_amount: 0,
      };
      
      return res.json({
        response: buildProductResponse(productInMessage, fullTraining),
        context: {
          current_product: productInMessage,
          last_user_product: productInMessage,
          step: "collecting_city",
          tipo_cobertura: null,
          order_data: resetOrder,
          reset_reason: "cliente pidió producto diferente",
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (isOriginQuestion(texto)) {
      return res.json({
        response: `🤗 ¡Somos de Asunción, Paraguay! 😊

Hacemos envíos a todo el país 🚚

¿Cuál producto te interesa? ✨`,
        context: {
          ...(context || {}),
          step: previousStep || "selling",
          order_data: oldOrder,
          current_product: oldOrder?.product || context?.current_product || null,
          last_user_product: lastUserProduct || null,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    const currentActiveProduct = 
      oldOrder?.product ||
      context?.current_product ||
      lastUserProduct ||
      null;
    
    console.log(`🎯 Producto activo actual: "${currentActiveProduct}"`);
    console.log(`📝 Mensaje del cliente: "${texto}"`);
    
    let product = detectProductRespectingActive(
      texto,
      fullTraining,
      currentActiveProduct,
      getLastAssistantMessage(history || []),
      lastUserProduct
    );
    
    console.log(`✅ Producto final detectado: "${product}"`);
    
    if (product && !isInvalidProductCandidate(product)) {
      lastUserProduct = product;
    }

    const activeProductForLocation = product || currentActiveProduct;
    const locationOnlyCity = isLocationOnlyMessage(texto) ? extractCityFromText(texto) : "";

    if (locationOnlyCity && !activeProductForLocation) {
      const coverageOrder = { ...(oldOrder || {}), city: locationOnlyCity };
      return res.json({
        response: buildCoverageOnlyResponse(locationOnlyCity),
        context: {
          ...(context || {}),
          step: "selling",
          tipo_cobertura: getTipoCobertura(locationOnlyCity) || null,
          order_data: coverageOrder,
          current_product: null,
          last_user_product: null,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (isNeutralReply(texto)) {
      return res.json({
        response: "😊 Perfecto, cualquier duda escribime nomás. Estoy para ayudarte ✨",
        context: {
          ...(context || {}),
          step: previousStep || "selling",
          order_data: oldOrder,
          current_product: oldOrder?.product || context?.current_product || null,
          last_user_product: lastUserProduct || oldOrder?.product || null,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    let isPaymentProof = false;

    const lastAssistantMessage = getLastAssistantMessage(history || []);
    const wasAskingCity = botWasAskingCity(history || []);
    const wasAskingQuantity = botWasAskingQuantity(history || []);
    const wasAskingShoeSize = botWasAskingShoeSize(history || []);

    const isOnlyNumber = /^\s*\d{1,3}\s*$/.test(texto);

    const shoeSizeFromText = extractShoeSizeFromText(texto);
    const shoeProductContext = isShoeProductText(
      [oldOrder?.product, context?.current_product, context?.last_topic, lastAssistantMessage, product]
        .filter(Boolean)
        .join(" ")
    );

    const isPureShoeSizeReply =
      shoeSizeFromText > 0 &&
      !!(oldOrder?.product || context?.current_product || shoeProductContext || product) &&
      (wasAskingShoeSize ||
        previousStep === "collecting_shoe_size" ||
        previousStep === "esperando_calce" ||
        previousStep === "collecting_calce" ||
        shoeProductContext ||
        productRequiresSize(String(oldOrder?.product || context?.current_product || product || "")));

    const isCityReply = !product && !isOnlyNumber && extractCityFromText(texto) && 
      (wasAskingCity || previousStep === "collecting_city");
    
    const isQuantityReply = isOnlyNumber && !isPureShoeSizeReply && !isPriceIntent(texto) &&
      (wasAskingQuantity || previousStep === "collecting_quantity");

    const wantsAddMore = isAddMoreIntent(texto);
    
    let extracted = extractData(texto, previousStep, isQuantityReply, isPureShoeSizeReply);

    if (product && oldOrder?.product && !sameProduct(product, oldOrder.product) && !wantsAddMore) {
      console.log(`🔄 Cliente cambió de "${oldOrder.product}" a "${product}" - Reiniciando pedido`);
      
      const newOrder = {
        product: product,
        quantity: 0,
        shoe_size: extracted.shoe_size || "",
        city: "",
        customer_name: "",
        phone: "",
        address: "",
        items: [],
        total_amount: 0,
      };
      
      await safeUpsertOrder(user_id, fromNumber, newOrder, false);
      
      return res.json({
        response: buildProductResponse(product, fullTraining),
        context: {
          ...(context || {}),
          current_product: product,
          last_user_product: product,
          step: "collecting_city",
          tipo_cobertura: null,
          order_data: newOrder,
          last_topic: product,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (product && !wantsAddMore && !isQuantityReply && !isPureShoeSizeReply && !isCityReply) {
      const isNewProductSelection = !oldOrder?.product || !sameProduct(product, oldOrder.product);
      
      if (isNewProductSelection) {
        const { response, order: newOrder, step: newStep } = handleProductSelection(product, fullTraining, extracted.shoe_size);
        
        await safeUpsertOrder(user_id, fromNumber, newOrder, false);
        
        return res.json({
          response: response,
          context: {
            ...(context || {}),
            current_product: product,
            last_user_product: product,
            step: newStep,
            tipo_cobertura: null,
            order_data: newOrder,
            last_topic: product,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
    }

    if ((isCityReply || (previousStep === "collecting_city" && extracted.city)) && product) {
      const city = extracted.city || extractCityFromText(texto);
      
      if (city) {
        let orderData = {
          product: product,
          quantity: 0,
          shoe_size: extracted.shoe_size || "",
          city: city,
          customer_name: "",
          phone: "",
          address: "",
          items: [],
          total_amount: 0,
        };
        
        await safeUpsertOrder(user_id, fromNumber, orderData, false);
        
        return res.json({
          response: buildQuantityAfterCityResponse(product, city, fullTraining, extracted.shoe_size),
          context: {
            ...(context || {}),
            current_product: product,
            last_user_product: product,
            step: "collecting_quantity",
            tipo_cobertura: getTipoCobertura(city),
            order_data: orderData,
            last_topic: product,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
    }

    if ((isQuantityReply || (previousStep === "collecting_quantity" && extracted.quantity > 0)) && product) {
      let orderData = {
        product: product,
        quantity: extracted.quantity || (previousStep === "collecting_quantity" && /^\d+$/.test(texto) ? parseInt(texto) : 0),
        shoe_size: extracted.shoe_size || "",
        city: oldOrder?.city || context?.order_data?.city || "",
        customer_name: "",
        phone: "",
        address: "",
        items: [],
        total_amount: 0,
      };
      
      if (orderData.quantity === 0 && /^\d+$/.test(texto)) {
        orderData.quantity = parseInt(texto);
      }
      
      if (!orderData.city || orderData.city === "") {
        return res.json({
          response: `📍 ¡Genial! ¿A qué ciudad lo enviamos? 😊

Te explico cómo funciona según tu ubicación:

🟢 **Ciudades con cobertura** → Envío GRATIS · Pagás al recibir
🔴 **Otras ciudades** → Envío por encomienda · Pago anticipado

Escribime tu ciudad y te confirmo cómo llega tu pedido 🚚✨`,
          context: {
            ...(context || {}),
            current_product: product,
            last_user_product: product,
            step: "collecting_city",
            tipo_cobertura: null,
            order_data: { ...orderData, city: "" },
            last_topic: product,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
      
      const total = calculateTotal(product, orderData.quantity, fullTraining);
      if (total !== null) {
        orderData.total_amount = total;
      } else {
        console.warn(`⚠️ No se pudo calcular total para ${product} x${orderData.quantity}`);
      }
      
      await safeUpsertOrder(user_id, fromNumber, orderData, false);
      
      return res.json({
        response: buildOrderSummaryResponse(orderData, getTipoCobertura(orderData.city)),
        context: {
          ...(context || {}),
          current_product: product,
          last_user_product: product,
          step: nextStep(orderData, getTipoCobertura(orderData.city), previousStatus),
          tipo_cobertura: getTipoCobertura(orderData.city),
          order_data: orderData,
          last_topic: product,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    // ========== PROCESAMIENTO DE MEDIA ==========
    if (mediaUrl && mediaType === "image") {
      const fetched = await fetchMediaAsBase64(mediaUrl);

      if (fetched) {
        const mime = mimeHint || fetched.mime || "image/jpeg";

        const analysis = await analyzeImageWithGemini({
          apiKey, model,
          imageBase64: fetched.data,
          mime,
          caption: texto,
          productList: fullTraining,
          expectedReceiverName,
        });

        console.log("🖼️ Vision:", analysis);

        if (analysis.kind === "payment_proof") {
          isPaymentProof = true;
          const isWaitingPaymentProof =
            getTipoCobertura(oldOrder?.city) === "sin_cobertura" &&
            previousStep === "waiting_payment_proof";

          await safeUpsertOrder(
            user_id, fromNumber, oldOrder, false,
            isWaitingPaymentProof ? "payment_verified" : undefined
          );

          const amountText = analysis.amount ? ` por Gs. ${analysis.amount}` : "";
          const receiver = analysis.receiverName || expectedReceiverName || "nuestro titular";

          return res.json({
            response: `✅ ¡Perfecto! 🙏 Recibimos tu comprobante${amountText} a nombre de ${receiver}.

Ya estamos verificando el pago ✅

Una vez verificado, dentro de las próximas 24 horas te estaremos enviando tu comprobante de envío 🚚✨

¡Gracias por confiar en Mega Todo Store! 💜`,
            is_payment_proof: true,
            context: {
              ...(context || {}),
              current_product: oldOrder?.product || context?.current_product || null,
              last_user_product: lastUserProduct || oldOrder?.product || null,
              step: isWaitingPaymentProof ? "payment_verified" : previousStep || "selling",
              tipo_cobertura: getTipoCobertura(oldOrder?.city) || previousTipoCobertura || null,
              order_data: oldOrder,
              last_topic: "payment_verified",
              payment_amount: analysis.amount || null,
              payment_receiver: receiver,
              updated_at: new Date().toISOString(),
            },
          });
        }

        if (analysis.kind === "product") {
          const productSignal = [
            analysis.matchedProduct,
            analysis.productName,
            analysis.transcript,
            analysis.promoText,
          ]
            .filter(Boolean)
            .join(" ");

          const catalogProduct = detectProductRaw(productSignal, fullTraining, "", lastUserProduct);
          const visualProduct = catalogProduct || analysis.matchedProduct || analysis.productName || "";
          product = visualProduct || product;
          const hasVisiblePrice = !!analysis.productPrice;

          if (!catalogProduct && visualProduct && hasVisiblePrice) {
            const promoLine = analysis.promoText
              ? `🔥 ${analysis.promoText} → ${analysis.productPrice} Gs`
              : `💰 Precio: ${analysis.productPrice} Gs`;

            return res.json({
              response: `🤗 ¡Sí! Es ${visualProduct}.

${promoLine}

📍 ¿A qué ciudad te gustaría recibirlo? 😊

Te explico cómo funciona según tu ubicación:

🟢 **Ciudades con cobertura** → Envío GRATIS · Pagás al recibir
🔴 **Otras ciudades** → Envío por encomienda · Pago anticipado

Escribime tu ciudad y te confirmo cómo llega tu pedido 🚚✨`,
              context: {
                ...(context || {}),
                current_product: visualProduct,
                last_user_product: visualProduct,
                step: "collecting_city",
                tipo_cobertura: previousTipoCobertura || null,
                order_data: { ...(oldOrder || {}), product: visualProduct, city: "" },
                last_topic: visualProduct,
                updated_at: new Date().toISOString(),
              },
              is_payment_proof: false,
            });
          }

          texto = `El cliente envió una FOTO DE PRODUCTO.
Descripción detectada: ${analysis.transcript || "producto no identificado"}
Producto visual detectado: ${visualProduct || "no identificado"}
Producto del catálogo detectado: ${catalogProduct || "no encontrado"}
Precio visible en imagen: ${analysis.productPrice || "no visible"}
Promo visible en imagen: ${analysis.promoText || "no visible"}

Respondé de manera cálida y amigable. Si hay producto del catálogo, mostrá su precio y preguntá por la CIUDAD.
Si no hay producto claro, pedí amablemente que te diga qué producto le interesa.`;
        } else {
          texto =
            texto ||
            `El cliente envió una imagen. Descripción: ${analysis.transcript || "imagen no identificada"}. Pedile amablemente que te diga qué producto le interesa o si es un comprobante de pago.`;
        }
      } else {
        texto = texto || "Te mandé una imagen pero no pudiste descargarla.";
      }
    }

    if (mediaUrl && mediaType === "audio") {
      const fetched = await fetchMediaAsBase64(mediaUrl);

      if (fetched) {
        const mime = mimeHint || fetched.mime || "audio/ogg";
        const transcript = await transcribeAudioWithGemini({
          apiKey, model, audioBase64: fetched.data, mime,
        });
        texto = transcript || texto || "Te mandé un audio.";

        const audioHasProduct = !!detectProductRaw(texto, fullTraining, "", lastUserProduct);
        const audioExtracted = extractData(texto, previousStep, false, false);
        const audioHasUsefulData = !!(
          audioExtracted.quantity || audioExtracted.city ||
          audioExtracted.name || audioExtracted.phone || audioExtracted.address
        );

        if (!isBuyIntent(texto) && !audioHasProduct && !audioHasUsefulData) {
          return res.json({
            response:
              "🎤 ¡Escuché tu audio! 😊 ¿Podrías decirme qué producto te interesa o qué necesitás exactamente? Así te ayudo mejor 🤗",
            context: {
              ...(context || {}),
              step: previousStep || "selling",
              order_data: oldOrder,
              current_product: oldOrder?.product || context?.current_product || null,
              last_user_product: lastUserProduct || oldOrder?.product || null,
              updated_at: new Date().toISOString(),
            },
            is_payment_proof: false,
          });
        }
      } else {
        texto = texto || "Te mandé un audio pero no pudiste descargarla.";
      }
    }

    if (!texto) texto = "(mensaje sin texto)";

    extracted = extractData(texto, previousStep, isQuantityReply, isPureShoeSizeReply);

    let orderData = {
      product: product || oldOrder?.product || "",
      quantity: extracted.quantity || oldOrder?.quantity || 0,
      shoe_size: extracted.shoe_size || oldOrder?.shoe_size || "",
      city: extracted.city || oldOrder?.city || "",
      customer_name: extracted.name || oldOrder?.customer_name || "",
      phone: extracted.phone || oldOrder?.phone || "",
      address: extracted.address || oldOrder?.address || "",
      items: oldOrder?.items || [],
      total_amount: oldOrder?.total_amount || 0,
    };

    if (orderData.product && orderData.quantity > 0 && (!orderData.city || orderData.city === "")) {
      return res.json({
        response: `📍 ¡Genial! ¿A qué ciudad lo enviamos? 😊

Te explico cómo funciona según tu ubicación:

🟢 **Ciudades con cobertura** → Envío GRATIS · Pagás al recibir
🔴 **Otras ciudades** → Envío por encomienda · Pago anticipado

Escribime tu ciudad y te confirmo cómo llega tu pedido 🚚✨`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          last_user_product: orderData.product,
          step: "collecting_city",
          tipo_cobertura: null,
          order_data: { ...orderData, city: "" },
          last_topic: orderData.product,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (orderData.product && orderData.quantity > 0) {
      const calculated = calculateTotal(orderData.product, orderData.quantity, fullTraining);
      if (calculated !== null) {
        orderData.total_amount = calculated;
      }
    }

    const finalTipoCobertura = getTipoCobertura(orderData.city) || previousTipoCobertura || "";
    const currentStatus = previousStatus || "";
    let step = nextStep(orderData, finalTipoCobertura, currentStatus);

    if (step === "already_confirmed" || currentStatus === "confirmed") {
      return res.json({
        response: `✅ Tu pedido ya está confirmado, ${orderData.customer_name?.split(" ")[0] || "cliente"} 😊

📦 Producto: ${orderData.product}
📍 Entrega: ${orderData.city} — ${orderData.address || "pendiente"}

El delivery se comunicará contigo. Si necesitas modificar algo, decime nomás ✨

¿Te interesa algún otro producto de nuestro catálogo? 👇

👉 ${CATALOG_URL}`,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          last_user_product: orderData.product,
          step: "confirmed",
          tipo_cobertura: finalTipoCobertura,
          order_data: orderData,
          last_topic: orderData.product,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (step === "confirm_order" && currentStatus !== "confirmed") {
      await safeUpsertOrder(user_id, fromNumber, orderData, true);
      
      const confirmResponse = finalTipoCobertura === "con_cobertura" 
        ? `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${orderData.product}
✅ Cliente: ${orderData.customer_name}
✅ Ubicación: ${orderData.city} — ${orderData.address}
✅ Contacto: ${orderData.phone}
✅ Cantidad: ${orderData.quantity} u.
💰 Total: ${formatGs(orderData.total_amount)} Gs

🚚 **ENVÍO GRATIS** · **Pagás al recibir**

📦 Tu pedido queda agendado. El delivery se comunicará contigo al llegar a tu zona.

⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

💵 Podés pagar en EFECTIVO o TRANSFERENCIA al delivery cuando recibas tu producto.

¡Gracias por tu compra! 🛍️✨

Te dejo nuestro catálogo completo 👇

👉 ${CATALOG_URL}

Podés pedir cualquier producto con el mismo proceso rápido y seguro. ¡Te esperamos! 💜`
        : `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${orderData.product}
✅ Cliente: ${orderData.customer_name}
✅ Ciudad: ${orderData.city}
✅ Contacto: ${orderData.phone}
✅ Cantidad: ${orderData.quantity} u.
💰 Total: ${formatGs(orderData.total_amount)} Gs

🚚 **ENVÍO POR ENCOMIENDA**

📎 Una vez confirmado tu pago, te enviaremos el comprobante de envío.

💵 **DATOS PARA TRANSFERENCIA:**
   Titular: DAVID AGUSTIN ALCARAZ AGUILAR
   Banco Familiar · Cuenta: 81-4981442
   Alias: 0994130022

📲 Enviame el comprobante y confirmamos tu envío 🚚✨

¡Gracias por tu compra! 🛍️✨

Te dejo nuestro catálogo completo 👇

👉 ${CATALOG_URL}

Podés pedir cualquier producto con el mismo proceso rápido y seguro. ¡Te esperamos! 💜`;

      return res.json({
        response: confirmResponse,
        context: {
          ...(context || {}),
          current_product: orderData.product,
          last_user_product: orderData.product,
          step: "confirmed",
          tipo_cobertura: finalTipoCobertura,
          order_data: { ...orderData, status: "confirmed" },
          last_topic: orderData.product,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    await safeUpsertOrder(user_id, fromNumber, orderData, false);

    let cleanHistory = Array.isArray(history) ? history : [];
    if (isQuantityReply || isPureShoeSizeReply) cleanHistory = [];

    const system = `
Sos el asistente de ventas de Mega Todo Store, una tienda paraguaya. Tu nombre es Araceli Galeano.

REGLA FUNDAMENTAL: Los precios los sacás SIEMPRE del entrenamiento. NUNCA inventes ni asumas precios.

FLUJO DE VENTAS (RESPETAR ESTRICTAMENTE):
1. Cliente dice producto → preguntar CIUDAD (explicando los dos métodos de envío)
2. Cliente responde ciudad → verificar cobertura y preguntar CANTIDAD
3. Cliente responde cantidad → mostrar resumen y pedir datos de envío

TONO DE VOZ:
- Cálido, amigable, como una vendedora de barrio
- Usá emojis 🤗 😊 ✨ 🔥 💜
- Tratá al cliente de "vos" o "tú" como sea más natural
- Mostrá entusiasmo por los productos
- Creá urgencia con "stock limitado", "oferta válida hoy"

═══════════════════════════════════
ENTRENAMIENTO OFICIAL DEL USUARIO:
═══════════════════════════════════
${fullTraining}
═══════════════════════════════════

ESTADO ACTUAL DEL CLIENTE:

Producto: ${orderData.product || "ninguno"}
Ciudad: ${orderData.city || "pendiente"}
Cantidad: ${orderData.quantity || "pendiente"}
Paso actual: ${step}

REGLAS:
- Si paso es collecting_city → preguntar CIUDAD
- Si paso es collecting_quantity → preguntar CANTIDAD con ejemplos
- Si paso es collecting_name → pedir nombre
- Si paso es collecting_phone → pedir teléfono
- Si paso es collecting_address → pedir dirección

⚠️ IMPORTANTE: NUNCA asumas que sabes la ciudad. SIEMPRE pregúntala.`;

    const contents = cleanHistory
      .slice(-8)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    contents.push({ role: "user", parts: [{ text: texto }] });

    let response = await callGemini({
      apiKey,
      model,
      system,
      contents,
      temperature: iaConfig.temperature ?? 0.3,
      maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
    });

    if (!response) {
      response = await callGemini({
        apiKey, model, system, contents, temperature: 0.3, maxTokens: 3072,
      });
    }

    const newContext = {
      ...(context || {}),
      current_product: orderData.product || context?.current_product || null,
      last_user_product: lastUserProduct || orderData.product || null,
      step: step,
      tipo_cobertura: finalTipoCobertura || null,
      order_data: { ...orderData, status: step === "confirm_order" ? "confirm_pending" : step },
      last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
      updated_at: new Date().toISOString(),
    };

    return res.json({
      response: response || `🤗 ¡Hola! Te invito a revisar nuestro catálogo:\n${CATALOG_URL}\n\n¿Qué producto te interesa? ✨`,
      context: newContext,
      is_payment_proof: isPaymentProof,
    });

  } catch (error: any) {
    console.error("❌ chat-ia:", error);
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
