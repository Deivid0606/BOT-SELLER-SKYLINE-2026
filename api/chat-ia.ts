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
// 🧠 PRODUCTOS RECONOCIDOS
// =======================================================
const TORNADO_PRODUCT = "Destapa Cañerías Tornado";
const TORNADO_PRICE = 159900;

function getTornadoProductName(): string {
  return TORNADO_PRODUCT;
}

// =======================================================
// 🧠 GUARDRAILS DETERMINÍSTICOS
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
    return `✅ Perfecto 😊 ${city} tiene ENVÍO GRATIS contra-entrega 🚚\n\n¿Cuál producto te interesa? ✨`;
  }
  if (tipo === "sin_cobertura") {
    return `ℹ️ ${city} no entra dentro de nuestra zona de contra-entrega 😊\n\nPero sí hacemos envíos seguros por:\n🚚 TSI / NASA / Occidental / MG Express / Multienvíos\n\n¿Cuál producto te interesa? ✨`;
  }
  return `Perfecto 😊 ¿Cuál producto te interesa? ✨`;
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

function buildCityQuestionResponse(product: string, shoeSize?: any): string {
  const productName = formatProductWithShoeSize(product, shoeSize);
  return `🔥 Perfecto 😊

Me confirmaste que querés ${productName}.

📍 ¿Para qué CIUDAD querés el envío?

(Ejemplo: Asunción, Capiatá, Luque, San Lorenzo, Fernando de la Mora...)`;
}

function buildQuantityAfterCityResponse(product: string, city: string, shoeSize?: any): string {
  const productName = formatProductWithShoeSize(product, shoeSize);
  
  if (normalize(product).includes("tornado") || normalize(product).includes("destapa")) {
    return `✅ ¡Perfecto! ${city} tiene ENVÍO GRATIS contra-entrega 🚚

🔥 ${productName}:
• 1 unidad → 159.900 Gs

💵 Pagás al recibir sin problema 😊

⚠️ El precio promocional es válido solo si confirmás tus datos ahora mismo.

🔥 ¿Cuántas unidades te gustaría llevar? ✨`;
  }
  
  if (
    normalize(product).includes("kit antivibracion") ||
    normalize(product).includes("patitas antideslizantes")
  ) {
    return `✅ Perfecto, enviamos a ${city} 😊

📦 ${productName}

¿Cuántos KITS querés? (Cada kit incluye 4 patitas)

Ejemplos:
• 1 kit
• 2 kits
• 3 kits

Respondé con el número (1, 2, 3...)`;
  }
  
  return `✅ Perfecto, enviamos a ${city} 😊

📦 ${productName}

¿Cuántas UNIDADES querés?

Ejemplos:
• 1 unidad
• 2 unidades (consultar si hay promo)
• 3 unidades

Respondé con el número (1, 2, 3...)`;
}

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
) {
  const msg = normalize(text);
  
  if (/^\d{1,3}$/.test(msg)) {
    return "";
  }

  if (msg.includes("tornado") || msg.includes("destapa") || msg.includes("cañeria") || 
      msg.includes("cañería") || msg.includes("tuberia") || msg.includes("tubería") || 
      msg.includes("desagüe") || msg.includes("desague") || msg.includes("quiero 1") ||
      msg.includes("quiero1") || msg.includes("wild tornado")) {
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

  if (msg.includes("nebulizador")) {
    return "Nebulizador portátil";
  }

  if ((msg.includes("tabla") && msg.includes("picar")) || msg.includes("tabla de marmol")) {
    return "Tabla de Picar de Mármol";
  }

  if (msg.includes("afilador") || msg.includes("cuchillo") || msg.includes("sharpener")) {
    return "Afilador de Cuchillos";
  }

  if (msg.includes("vital honey")) {
    return "Vital Honey VIP";
  }

  if (msg.includes("perfume asad") || msg.includes("asad")) {
    return "Perfume Asad";
  }

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

  if (/\b(tornado|destapa|cañeria|cañería|tuberia|tubería|desagüe|desague|quiero\s+1|quiero1|wild\s+tornado)\b/.test(n)) {
    return getTornadoProductName();
  }

  if (/\b(raqueta|electrica|flayes|mosquitos|moscas|insectos)\b/.test(n)) return "Raqueta Eléctrica para Insectos";
  if (/\b(crema\s+de\s+abeja|creama\s+de\s+abeja|veneno\s+de\s+abeja)\b/.test(n)) return "Veneno de Abeja";
  if (/\b(pelador|peladora|pelar\s+papas|pelador\s+de\s+papas|peladora\s+automatica)\b/.test(n)) return "Peladora Automática";
  if (/\b(soporte\s+para\s+lavarropas|lavarropas|almohadillas\s+antivibracion|almohadillas\s+antivibraci[oó]n|patitas\s+antideslizantes|kit\s+x4\s+patitas|kit\s+antivibracion)\b/.test(n)) return getAntiVibrationProductName();
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

function isInformationRequest(text: string): boolean {
  const n = normalize(text);
  const infoWords = /\b(informaci[oó]n|info|más info|mas info|quiero saber|consultar|dudas?|más datos|mas datos|detalles|más detalles|mas detalles|explicame|qué es|que es|cómo funciona|como funciona)\b/i;
  const productWords = /\b(veneno|abeja|crema|plantilla|ortopiex|ortoflex|5d|pelador|peladora|afilador|vital|honey|perfume|asad|soporte|lavarropas|almohadilla|cuchillo|raqueta|electrica|flayes|tornado|destapa)\b/i;
  if (productWords.test(n)) return false;
  return infoWords.test(n);
}

function isCatalogQuery(text: string): boolean {
  const n = normalize(text);
  const catalogWords = /\b(cat[aá]logo|productos|qu[eé] venden|tienen|stock|catálogo|precios|catalogo)\b/i;
  const greetingWords = /\b(hola|buenas|buen día|saludos)\b/i;
  const productWords = /\b(plantilla|ortopiex|pelador|afilador|veneno|vital|perfume|soporte|pororo|maquina|máquina|nebulizador|tabla|raqueta|tornado|destapa)\b/i;
  return (catalogWords.test(n) || greetingWords.test(n)) && !productWords.test(n);
}

function isProductInquiry(text: string): boolean {
  const n = normalize(text);
  const inquiryWords = /\b(qu[eé] es|cómo funciona|para qu[eé] sirve|características|beneficios|tiene|informaci[oó]n|info|cu[aá]nto cuesta|precio|valor|costo|dime|contame|explicame)\b/i;
  const productWords = /\b(veneno|abeja|plantilla|ortopiex|pelador|afilador|vital|perfume|soporte|lavarropas|ortoflex|5d|cuchillo|pororo|maquina|máquina|nebulizador|tabla|raqueta|tornado|destapa)\b/i;
  const buyWords = /\b(quiero|comprar|llevo|dame|mandame|agregame|reservar|apartar)\b/i;
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
    "destapa cañerias tornado", "tornado", "destapa cañerías", "wild tornado"
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

function isValidProductString(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = clean(s);
  if (!trimmed) return false;
  if (isInvalidProductCandidate(trimmed)) return false;
  if (trimmed.includes("?")) return false;
  if (trimmed.includes("¿")) return false;
  const lower = trimmed.toLowerCase();
  if (lower.includes("asistente")) return false;
  if (lower.includes("cuántas") || lower.includes("cuantas")) return false;
  if (lower.includes("cuántos") || lower.includes("cuantos")) return false;
  if (lower.includes("unidades te") || lower.includes("unidad te")) return false;
  if (lower.includes("gustaría") || lower.includes("gustaria")) return false;
  if (lower.includes("para qué") || lower.includes("para que ciudad")) return false;
  if (lower.includes("ciudad querés") || lower.includes("ciudad queres")) return false;
  if (lower.includes("respondé con") || lower.includes("responde con")) return false;
  if (lower.includes("ejemplo:") || lower.includes("ejemplos:")) return false;
  if (trimmed.length > 100) return false;
  return true;
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
    lastAssistantMessage.includes("responde con el numero") ||
    lastAssistantMessage.includes("cuántas unidades te gustaría llevar")
  );
}

function botWasAskingCity(history: any[]): boolean {
  const lastAssistantMessage = normalize(getLastAssistantMessage(history));
  return (
    lastAssistantMessage.includes("qué ciudad") ||
    lastAssistantMessage.includes("para qué ciudad") ||
    lastAssistantMessage.includes("ciudad querés") ||
    lastAssistantMessage.includes("ciudad para el envío") ||
    lastAssistantMessage.includes("para que ciudad") ||
    lastAssistantMessage.includes("ciudad queres") ||
    lastAssistantMessage.includes("ciudad queres el envio") ||
    lastAssistantMessage.includes("para qué ciudad sería el envío")
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

// =======================================================
// 🔥 FUNCIÓN EXTRACTDATA MEJORADA - RECONOCE NOMBRE, DIRECCIÓN, TELÉFONO
// =======================================================
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

  // 🔥 Extraer teléfono (prioridad alta)
  const phone = text.match(/(?:09\d{8}|\+595\d{9}|\d{10})/)?.[0] || "";
  
  // 🔥 Extraer ciudad
  let city = extractCityFromText(norm);
  
  // 🔥 Extraer dirección (líneas que no son nombre, ciudad, teléfono)
  let address = "";
  
  // 🔥 Extraer nombre mejorado
  let name = "";

  // Patrón para nombre completo (dos palabras con mayúscula inicial o todo mayúsculas)
  const namePatterns = [
    /(?:me\s+llamo|nombre|soy|mi nombre es)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/i,
    /^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ]+)$/,
    /^([A-Z]{3,}\s+[A-Z]{3,})$/,
    /^([A-Z][a-z]+\s+[A-Z][a-z]+)$/,
  ];
  
  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1] && !isProductName(match[1]) && match[1].length < 50) {
      name = clean(match[1]);
      break;
    }
  }
  
  // Si el texto completo es un nombre simple (sin números, no muy largo)
  if (!name && !/\d/.test(text) && text.length < 40 && text.length > 5 && text.includes(" ")) {
    const words = text.split(" ");
    if (words.length === 2 && words[0].length > 2 && words[1].length > 2) {
      name = text;
    }
  }
  
  // 🔥 Extraer dirección (después de limpiar nombre y teléfono)
  let tempText = text;
  if (name) tempText = tempText.replace(name, "");
  if (phone) tempText = tempText.replace(phone, "");
  if (city) tempText = tempText.replace(new RegExp(city, "i"), "");
  
  const addressMatch = tempText.match(/([A-ZÁÉÍÓÚÑa-záéíóúñ0-9\s,.#\-]{5,})/);
  if (addressMatch && addressMatch[1].trim().length > 5 && !isProductName(addressMatch[1])) {
    address = clean(addressMatch[1]);
  }
  
  // Si no hay nombre pero hay dirección, la dirección no es el nombre
  if (!name && address && address.length > 10 && !address.includes(" ")) {
    address = "";
  }

  // 🔥 Extraer cantidad
  let quantity = 0;
  
  // Si estamos en modo cantidad o el step lo requiere
  if (forceQuantityMode || currentStep === "collecting_quantity" || currentStep === "esperando_cantidad") {
    const onlyNumber = norm.match(/^\s*(\d{1,3})\s*$/);
    if (onlyNumber) {
      quantity = Number(onlyNumber[1]);
    } else {
      const qMatch = norm.match(/\b(\d{1,3})\s*(unidad|unidades|u)\b/);
      if (qMatch) quantity = Number(qMatch[1]);
    }
  }
  
  // Si el mensaje dice "1 UNIDAD" o similar
  if (!quantity && /\b1\s*unidad\b/i.test(text)) {
    quantity = 1;
  }
  if (!quantity && /\b2\s*unidades\b/i.test(text)) {
    quantity = 2;
  }
  if (!quantity && /\b3\s*unidades\b/i.test(text)) {
    quantity = 3;
  }

  // 🔥 Extraer talle/zapato
  let shoe_size = 0;
  const shoeSizeMatch = norm.match(/\b(?:talle|numero|nro|num|uso|calzo|soy|en|del|de|para)\s*(\d{2})\b/);
  if (shoeSizeMatch) {
    const size = Number(shoeSizeMatch[1]);
    if (size >= 20 && size <= 50) shoe_size = size;
  }

  return {
    quantity: Math.min(quantity, 999),
    shoe_size: shoe_size,
    city: city,
    name: name,
    phone: phone,
    address: address,
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

function parseGsAmount(text: string): number {
  const match = clean(text).match(/(\d{1,3}(?:\.\d{3})+|\d{4,})/);
  if (!match) return 0;
  return Number(match[1].replace(/\./g, ""));
}

function calculateTotal(product: string, quantity: number, training: string): number | null {
  if (!product || !quantity || quantity < 1) return null;

  const p = normalize(product);
  
  if (p.includes("tornado") || p.includes("destapa")) {
    return TORNADO_PRICE * quantity;
  }

  const lines = training.split("\n").map((l) => clean(l)).filter(Boolean);

  let bestMatchScore = 0;
  let bestUnitPrice = 0;
  let bestPromoPrice = 0;

  for (let i = 0; i < lines.length; i++) {
    const current = normalize(lines[i]);

    let matchScore = 0;
    if (current.includes(p)) matchScore += 10;
    else if (p.includes(current) && current.length >= 5) matchScore += 5;
    else {
      const productWords = p.split(" ").filter((w) => w.length >= 4);
      for (const w of productWords) {
        if (current.includes(w)) matchScore += 2;
      }
    }

    if (matchScore === 0) continue;

    const window = lines.slice(i, i + 8);
    let foundUnit = 0;
    let foundPromo = 0;

    for (const line of window) {
      const nLine = normalize(line);
      const amount = parseGsAmount(line);
      if (!amount) continue;

      if (
        quantity === 2 &&
        /(2x|2\s*unidades|promo\s*2|2\s*cajas|2\s*unidad)/i.test(nLine) &&
        !foundPromo
      ) {
        foundPromo = amount;
        continue;
      }

      if (!foundUnit) {
        foundUnit = amount;
      }
    }

    if (matchScore > bestMatchScore) {
      bestMatchScore = matchScore;
      bestUnitPrice = foundUnit;
      bestPromoPrice = foundPromo;
    }
  }

  if (bestPromoPrice && quantity === 2) return bestPromoPrice;
  if (bestUnitPrice) return bestUnitPrice * quantity;

  return null;
}

type CartItem = { product: string; quantity: number; total: number; shoe_size?: any };

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
      total: recalculated || Number(i.total || 0),
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
  const tipoEnvio =
    tipoCobertura === "sin_cobertura"
      ? "Envío por transportadora / encomienda"
      : "Envío GRATIS contra-entrega";

  const lines = items.length
    ? buildItemsLines(items)
    : `📦 ${formatProductWithShoeSize(order.product, order.shoe_size)}\n🔢 Cantidad: ${order.quantity}`;

  let promoNote = "";
  if (order.quantity === 2) {
    promoNote = `\n\n🎯 ¡APROVECHA LA PROMO! 🎯`;
  }

  return `${promoNote}🔥 Perfecto 😊

Tu pedido queda así:

${lines}

💰 Total: ${formatGs(total)} Gs

🚚 ${tipoEnvio}

📎 Pasame TODO JUNTO en un solo mensaje:

✅ nombre y apellido
✅ dirección exacta o ubicación por Google Maps
✅ número de celular

📲 Si no enviás número, utilizaremos automáticamente el mismo número desde el que estás escribiendo 😊

y agendamos tu entrega ✨`;
}

function buildAddedItemResponse(order: any, tipoCobertura: string) {
  return buildCartSummaryResponse(order, tipoCobertura);
}

function buildOrderSummaryResponse(order: any, tipoCobertura: string) {
  const items = getCartItems(order);
  if (items.length > 1) return buildCartSummaryResponse(order, tipoCobertura);

  const total = Number(order?.total_amount || 0);
  const tipoEnvio =
    tipoCobertura === "sin_cobertura"
      ? "Envío por transportadora / encomienda"
      : "Envío GRATIS contra-entrega";

  let promoNote = "";
  if (order.quantity === 2) {
    promoNote = `🎯 ¡APROVECHA LA PROMO! 🎯\n\n`;
  }

  const displayProduct = order.product || items[0]?.product || "";
  const finalProductName = normalize(displayProduct).includes("tornado") ? getTornadoProductName() : displayProduct;

  return `${promoNote}🔥 Perfecto 😊

Tu pedido queda así:

📦 ${formatProductWithShoeSize(finalProductName, order.shoe_size)}
🔢 Cantidad: ${order.quantity}
💰 Total: ${formatGs(total)} Gs

🚚 ${tipoEnvio}

📎 Pasame TODO JUNTO en un solo mensaje:

✅ nombre y apellido
✅ dirección exacta o ubicación por Google Maps
✅ número de celular

📲 Si no enviás número, utilizaremos automáticamente el mismo número desde el que estás escribiendo 😊

y agendamos tu entrega ✨`;
}

function nextStep(order: any, tipoCobertura?: string, wasConfirmed?: boolean): string {
  if (wasConfirmed) return "confirmed_already";
  
  const items = getCartItems(order);
  
  if (!order.product && !items.length) return "selling";
  if (!order.city) return "collecting_city";
  
  const hasValidQuantity = safeQuantity(order.quantity) > 0;
  if (!hasValidQuantity && !items.length) return "collecting_quantity";
  
  // 🔥 Si ya tenemos nombre, dirección y teléfono, pasar a confirmación
  const hasName = order.customer_name && order.customer_name.length > 3;
  const hasAddress = order.address && order.address.length > 5;
  const hasPhone = order.phone && order.phone.length > 8;
  
  if (tipoCobertura === "sin_cobertura") {
    if (!hasName) return "collecting_name";
    if (!hasPhone) return "collecting_phone";
    return "waiting_payment_proof";
  }
  
  // Para cobertura normal, si tenemos todos los datos → confirmar pedido
  if (hasName && hasPhone && hasAddress) {
    return "confirm_order";
  }
  
  if (!hasName) return "collecting_name";
  if (!hasPhone) return "collecting_phone";
  if (!hasAddress) return "collecting_address";
  
  return "confirm_order";
}

function handleProductSelection(product: string, shoeSize?: any) {
  const newOrder = {
    product: product,
    quantity: 0,
    shoe_size: shoeSize || "",
    city: "",
    customer_name: "",
    phone: "",
    address: "",
    items: [],
    total_amount: product === getTornadoProductName() ? TORNADO_PRICE : 0,
    confirmed: false,
    confirm_count: 0,
  };
  
  return {
    response: buildCityQuestionResponse(product, shoeSize),
    order: newOrder,
    step: "collecting_city"
  };
}

function safeProductName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = clean(name);
  if (!isValidProductString(trimmed)) return null;
  return trimmed;
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
        "payment_verified", "confirm_pending", "confirmed",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) {
      console.error("❌ findOrder:", findErr);
      return null;
    }

    const tipoCobertura = getTipoCobertura(order.city);
    const step = nextStep(order, tipoCobertura, order.confirmed);

    const finalStatus =
      forcedStatus ||
      (confirm && step === "confirm_order"
        ? "confirmed"
        : step === "confirm_order"
        ? "confirm_pending"
        : step);

    const rawProductName =
      orderItems.length > 1
        ? orderItems.map((i) => `${i.product} x${i.quantity}`).join(" + ")
        : formatProductWithShoeSize(
            order.product || orderItems[0]?.product || "",
            order.shoe_size
          ) || null;

    const validatedProductName = safeProductName(rawProductName);

    const payload: any = {
      user_id: userId,
      from_number: from,
      phone: order.phone || from,
      product: validatedProductName,
      producto: validatedProductName,
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

Si ves una imagen con texto "TORNADO", "WILD TORNADO", "Destapa Cañerías" → productName = "Destapa Cañerías Tornado", productPrice = "159.900"

Si ves un afilador de cuchillos → productName = "Afilador de Cuchillos".
Si ves un pelador de papas → productName = "Peladora Automática".

Si el producto no está en catálogo, igual identificá el productName genérico.

matchedProduct solo va si encontrás coincidencia clara con el catálogo.

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

function isNewConversation(text: string, history: any[]): boolean {
  const n = normalize(text);
  const newConversationMarkers = /\b(creo que guardo|mensaje antiguo|chat viejo|conversación anterior|pedido anterior|viejo mensaje|lo tengo guardado|tengo un mensaje|mensaje guardado|chat pasado|nuevo pedido|empezar de nuevo|borrar pedido|reiniciar)\b/i;
  const noHistory = !history || history.length === 0;
  const mentionsOldMessage = newConversationMarkers.test(n);
  return noHistory || mentionsOldMessage;
}

// =======================================================
// 🚀 HANDLER PRINCIPAL
// =======================================================
export default async function handler(req: any, res: any) {
  console.log("🔥 VERSION FINAL - TORNADO FIX + EXTRACCIÓN DE DATOS MEJORADA");

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

    if (!isValidProductString(lastUserProduct)) {
      lastUserProduct = "";
    }

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
          if (norm.includes("tornado") || norm.includes("destapa")) { lastUserProduct = getTornadoProductName(); break; }
          if (norm.includes("raqueta")) { lastUserProduct = "Raqueta Eléctrica para Insectos"; break; }
          if (norm.includes("veneno") || norm.includes("abeja")) { lastUserProduct = "Veneno de Abeja"; break; }
          if (norm.includes("plantilla") || norm.includes("ortopiex")) { lastUserProduct = getDefaultShoeProductName(); break; }
          if (norm.includes("pelador")) { lastUserProduct = "Peladora Automática"; break; }
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
        confirmed: false, confirm_count: 0,
      };
      console.log("🔄 Conversación nueva detectada - Pedido reiniciado");
    } else {
      oldOrder = normalizeOrderWithItems(context?.order_data || {}, fullTraining);
      if (oldOrder?.product && !isValidProductString(oldOrder.product)) {
        console.warn(`⚠️ Producto inválido en oldOrder: "${oldOrder.product}" — limpiando`);
        oldOrder.product = "";
      }
      oldOrder.confirmed = context?.order_data?.confirmed || false;
      oldOrder.confirm_count = context?.order_data?.confirm_count || 0;
    }

    const previousStep = clean(context?.step);
    const previousTipoCobertura = clean(context?.tipo_cobertura);

    // =======================================================
    // 🔥 DETECCIÓN DE TORNADO
    // =======================================================
    let product = "";
    const isTornadoMessage = normalize(texto).includes("tornado") || 
                             normalize(texto).includes("destapa") ||
                             normalize(texto).includes("quiero 1") ||
                             normalize(texto).includes("quiero1") ||
                             (mediaUrl && mediaType === "image");
    
    if (mediaUrl && mediaType === "image" && (texto.toLowerCase().includes("tornado") || texto.toLowerCase().includes("destapa") || texto === "QUIERO 1" || texto === "")) {
      product = getTornadoProductName();
      console.log("🔥 TORNADO DETECTADO por imagen + mensaje");
    } else {
      product = detectProductRespectingActive(
        texto,
        fullTraining,
        oldOrder?.product || lastUserProduct,
        getLastAssistantMessage(history || []),
        lastUserProduct
      );
    }
    
    if (!product && (normalize(texto).includes("tornado") || normalize(texto).includes("destapa"))) {
      product = getTornadoProductName();
      console.log("🔥 TORNADO DETECTADO por palabra clave");
    }
    
    if (product && !isInvalidProductCandidate(product) && isValidProductString(product)) {
      lastUserProduct = product;
    }

    // =======================================================
    // 🔥 SI ES TORNADO Y NO TIENE CIUDAD → PREGUNTAR CIUDAD
    // =======================================================
    if ((product === getTornadoProductName() || isTornadoMessage) && (!oldOrder?.city || oldOrder?.product !== getTornadoProductName())) {
      const newOrder = {
        product: getTornadoProductName(),
        quantity: 0,
        shoe_size: "",
        city: "",
        customer_name: "",
        phone: "",
        address: "",
        items: [],
        total_amount: TORNADO_PRICE,
        confirmed: false,
        confirm_count: 0,
      };
      
      await safeUpsertOrder(user_id, fromNumber, newOrder, false);
      
      return res.json({
        response: `🔥 Perfecto 😊

Me confirmaste que querés ${getTornadoProductName()}.

📍 ¿Para qué CIUDAD querés el envío?

(Ejemplo: Asunción, Capiatá, Luque, San Lorenzo, Fernando de la Mora...)`,
        context: {
          ...(context || {}),
          current_product: getTornadoProductName(),
          last_user_product: getTornadoProductName(),
          step: "collecting_city",
          tipo_cobertura: null,
          order_data: newOrder,
          last_topic: getTornadoProductName(),
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    const activeProductForLocation = product || oldOrder?.product;
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

    if (isOriginQuestion(texto)) {
      return res.json({
        response: `Somos de Asunción, Paraguay 😊\nHacemos envíos a todo el país 🚚\n\n¿Cuál producto te interesa? ✨`,
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
    const isOneUnidad = /1\s*unidad/i.test(texto);

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
    
    const isQuantityReply = (isOnlyNumber || isOneUnidad) && !isPureShoeSizeReply && !isPriceIntent(texto) &&
      (wasAskingQuantity || previousStep === "collecting_quantity");

    const wantsAddMore = isAddMoreIntent(texto);
    const wantsConfirm = isConfirmIntent(texto);
    
    // 🔥 Extraer datos con la función mejorada
    let extracted = extractData(texto, previousStep, isQuantityReply, isPureShoeSizeReply);
    
    console.log("📝 DATOS EXTRAÍDOS:", {
      name: extracted.name,
      phone: extracted.phone,
      address: extracted.address,
      city: extracted.city,
      quantity: extracted.quantity
    });

    const isAlreadyConfirmed = oldOrder.confirmed === true;
    
    if (isAlreadyConfirmed && !wantsAddMore) {
      return res.json({
        response: `✅ ¡Perfecto ${oldOrder.customer_name?.split(" ")[0] || ""}! Tu pedido YA ESTÁ CONFIRMADO 😊

📦 ${formatProductWithShoeSize(oldOrder.product, oldOrder.shoe_size)} x${oldOrder.quantity}
📍 ${oldOrder.city}
📞 ${oldOrder.phone}

🚚 Lo estaremos enviando dentro de las próximas 24 horas hábiles.

✨ ¡Gracias por tu compra!`,
        context: {
          ...(context || {}),
          step: "confirmed",
          confirm_count: oldOrder.confirm_count,
          order_data: oldOrder,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    // 🔥 NUEVO PRODUCTO (no Tornado porque ya se manejó)
    if (product && !wantsAddMore && !isQuantityReply && !isPureShoeSizeReply && !isCityReply && product !== getTornadoProductName()) {
      const productChanged = !oldOrder?.product || !sameProduct(product, oldOrder.product);
      
      if (productChanged) {
        const { response, order: newOrder, step: newStep } = handleProductSelection(product, extracted.shoe_size);
        
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

    // 🔥 RESPUESTA DE CIUDAD
    if ((isCityReply || (previousStep === "collecting_city" && extracted.city)) && (product || oldOrder?.product)) {
      const finalProduct = product || oldOrder?.product || "";
      const city = extracted.city || extractCityFromText(texto);
      
      if (city && finalProduct) {
        let orderData = {
          product: finalProduct,
          quantity: 0,
          shoe_size: extracted.shoe_size || oldOrder?.shoe_size || "",
          city: city,
          customer_name: extracted.name || oldOrder?.customer_name || "",
          phone: extracted.phone || oldOrder?.phone || "",
          address: extracted.address || oldOrder?.address || "",
          items: oldOrder?.items || [],
          total_amount: finalProduct === getTornadoProductName() ? TORNADO_PRICE : oldOrder?.total_amount || 0,
          confirmed: false,
          confirm_count: 0,
        };
        
        await safeUpsertOrder(user_id, fromNumber, orderData, false);
        
        return res.json({
          response: buildQuantityAfterCityResponse(finalProduct, city, extracted.shoe_size),
          context: {
            ...(context || {}),
            current_product: finalProduct,
            last_user_product: finalProduct,
            step: "collecting_quantity",
            tipo_cobertura: getTipoCobertura(city),
            order_data: orderData,
            last_topic: finalProduct,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
    }

    // 🔥 RESPUESTA DE CANTIDAD
    if (isQuantityReply && (oldOrder?.product || product) && (extracted.quantity > 0 || isOneUnidad)) {
      const finalProduct = oldOrder?.product || product || "";
      const quantity = extracted.quantity || (isOneUnidad ? 1 : 0);
      
      let orderData = {
        product: finalProduct,
        quantity: quantity,
        shoe_size: extracted.shoe_size || oldOrder?.shoe_size || "",
        city: oldOrder?.city || extracted.city || "",
        customer_name: extracted.name || oldOrder?.customer_name || "",
        phone: extracted.phone || oldOrder?.phone || "",
        address: extracted.address || oldOrder?.address || "",
        items: oldOrder?.items || [],
        total_amount: 0,
        confirmed: false,
        confirm_count: oldOrder?.confirm_count || 0,
      };
      
      const total = calculateTotal(finalProduct, quantity, fullTraining);
      if (total) orderData.total_amount = total;
      
      console.log("📦 PRODUCTO FINAL (cantidad):", finalProduct);
      console.log("💰 TOTAL:", total);
      
      await safeUpsertOrder(user_id, fromNumber, orderData, false);
      
      // 🔥 Si ya tenemos nombre, dirección y teléfono, ir directo a confirmación
      const hasAllData = orderData.customer_name && orderData.phone && orderData.address;
      
      if (hasAllData) {
        return res.json({
          response: buildOrderSummaryResponse(orderData, getTipoCobertura(orderData.city)),
          context: {
            ...(context || {}),
            current_product: finalProduct,
            last_user_product: finalProduct,
            step: "confirm_order",
            tipo_cobertura: getTipoCobertura(orderData.city),
            order_data: orderData,
            last_topic: finalProduct,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
      
      return res.json({
        response: buildOrderSummaryResponse(orderData, getTipoCobertura(orderData.city)),
        context: {
          ...(context || {}),
          current_product: finalProduct,
          last_user_product: finalProduct,
          step: "confirm_order",
          tipo_cobertura: getTipoCobertura(orderData.city),
          order_data: orderData,
          last_topic: finalProduct,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    // ========== PROCESAMIENTO DE MEDIA ==========
    if (mediaUrl && mediaType === "image" && !texto) {
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

        if (analysis.kind === "product" && (analysis.productName?.toLowerCase().includes("tornado") || analysis.matchedProduct?.toLowerCase().includes("tornado"))) {
          const newOrder = {
            product: getTornadoProductName(),
            quantity: 0,
            shoe_size: "",
            city: "",
            customer_name: "",
            phone: "",
            address: "",
            items: [],
            total_amount: TORNADO_PRICE,
            confirmed: false,
            confirm_count: 0,
          };
          
          await safeUpsertOrder(user_id, fromNumber, newOrder, false);
          
          return res.json({
            response: `🔥 Perfecto 😊

Me confirmaste que querés ${getTornadoProductName()}.

📍 ¿Para qué CIUDAD querés el envío?

(Ejemplo: Asunción, Capiatá, Luque, San Lorenzo, Fernando de la Mora...)`,
            context: {
              ...(context || {}),
              current_product: getTornadoProductName(),
              last_user_product: getTornadoProductName(),
              step: "collecting_city",
              tipo_cobertura: null,
              order_data: newOrder,
              last_topic: getTornadoProductName(),
              updated_at: new Date().toISOString(),
            },
            is_payment_proof: false,
          });
        }
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
      } else {
        texto = texto || "Te mandé un audio pero no pudiste descargarlo.";
      }
    }

    if (!texto) texto = "(mensaje sin texto)";

    // 🔥 Extraer datos nuevamente por si hay datos en el texto original
    if (!extracted.name || !extracted.phone || !extracted.address) {
      const newExtracted = extractData(texto, previousStep, isQuantityReply, isPureShoeSizeReply);
      extracted = { ...extracted, ...newExtracted };
    }

    const finalProduct = product || oldOrder?.product || "";

    let orderData = {
      product: finalProduct,
      quantity: extracted.quantity || oldOrder?.quantity || 0,
      shoe_size: extracted.shoe_size || oldOrder?.shoe_size || "",
      city: extracted.city || oldOrder?.city || "",
      customer_name: extracted.name || oldOrder?.customer_name || "",
      phone: extracted.phone || oldOrder?.phone || "",
      address: extracted.address || oldOrder?.address || "",
      items: oldOrder?.items || [],
      total_amount: oldOrder?.total_amount || 0,
      confirmed: oldOrder?.confirmed || false,
      confirm_count: oldOrder?.confirm_count || 0,
    };

    if (orderData.product && orderData.quantity > 0) {
      const calculated = calculateTotal(orderData.product, orderData.quantity, fullTraining);
      if (calculated) orderData.total_amount = calculated;
    }

    const finalTipoCobertura = getTipoCobertura(orderData.city) || previousTipoCobertura || "";
    let step = nextStep(orderData, finalTipoCobertura, orderData.confirmed);

    // 🔥 Si ya tenemos todos los datos, ir a confirmación
    const hasName = orderData.customer_name && orderData.customer_name.length > 3;
    const hasAddress = orderData.address && orderData.address.length > 5;
    const hasPhone = orderData.phone && orderData.phone.length > 8;
    
    if (hasName && hasPhone && hasAddress && orderData.city && orderData.quantity > 0 && step !== "confirmed_already") {
      step = "confirm_order";
    }

    // 🔥 MANEJO DE CONFIRMACIÓN
    if (step === "confirm_order" || wantsConfirm) {
      let confirmCount = orderData.confirm_count || 0;
      
      if (wantsConfirm) {
        confirmCount++;
        
        if (confirmCount === 1) {
          orderData.confirmed = true;
          orderData.confirm_count = confirmCount;
          
          await safeUpsertOrder(user_id, fromNumber, orderData, true, "confirmed");
          
          return res.json({
            response: `✅ ¡PEDIDO CONFIRMADO! ${orderData.customer_name?.split(" ")[0] || ""} 😊

📦 ${formatProductWithShoeSize(orderData.product, orderData.shoe_size)} x${orderData.quantity}
📍 ${orderData.city}
💰 Total: ${formatGs(orderData.total_amount)} Gs
📞 ${orderData.phone}
📍 Dirección: ${orderData.address}

🚚 Envío GRATIS contra-entrega

✨ Tu pedido ya está en proceso. En las próximas 24 horas hábiles lo estaremos enviando.

¡Gracias por comprar con Mega Todo Store! 🎯`,
            context: {
              ...(context || {}),
              current_product: orderData.product,
              last_user_product: orderData.product,
              step: "confirmed",
              confirm_count: confirmCount,
              tipo_cobertura: finalTipoCobertura,
              order_data: { ...orderData, confirmed: true, confirm_count: confirmCount },
              last_topic: orderData.product,
              updated_at: new Date().toISOString(),
            },
            is_payment_proof: false,
          });
        } else if (confirmCount === 2 && wantsAddMore) {
          return res.json({
            response: `🔥 Perfecto ${orderData.customer_name?.split(" ")[0] || ""} 😊

Tu pedido actual es:
📦 ${formatProductWithShoeSize(orderData.product, orderData.shoe_size)} x${orderData.quantity}

¿Qué otro producto querés AGREGAR?`,
            context: {
              ...(context || {}),
              step: "adding_more_products",
              confirm_count: confirmCount,
              order_data: orderData,
              updated_at: new Date().toISOString(),
            },
            is_payment_proof: false,
          });
        } else if (confirmCount >= 2) {
          return res.json({
            response: `✅ ${orderData.customer_name?.split(" ")[0] || ""}, tu pedido YA ESTÁ CONFIRMADO.`,
            context: {
              ...(context || {}),
              step: "confirmed",
              confirm_count: confirmCount,
              order_data: { ...orderData, confirmed: true },
              updated_at: new Date().toISOString(),
            },
            is_payment_proof: false,
          });
        }
      }
      
      if (!wantsConfirm && step === "confirm_order" && !orderData.confirmed) {
        return res.json({
          response: buildOrderSummaryResponse(orderData, finalTipoCobertura),
          context: {
            ...(context || {}),
            current_product: orderData.product,
            last_user_product: orderData.product,
            step: "awaiting_confirmation",
            confirm_count: orderData.confirm_count,
            tipo_cobertura: finalTipoCobertura,
            order_data: orderData,
            last_topic: orderData.product,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
    }

    if (step !== "confirm_order" && step !== "confirmed_already" && !wantsConfirm) {
      await safeUpsertOrder(user_id, fromNumber, orderData, false);
    }

    let cleanHistory = Array.isArray(history) ? history : [];
    if (isQuantityReply || isPureShoeSizeReply) cleanHistory = [];

    const system = `
Sos el asistente de ventas de Mega Todo Store. Respondé SIEMPRE siguiendo el entrenamiento oficial del usuario.

REGLA FUNDAMENTAL: Los precios los sacás SIEMPRE del entrenamiento.

FLUJO DE VENTAS:
1. Producto → preguntar CIUDAD
2. Ciudad → preguntar CANTIDAD
3. Cantidad → pedir DATOS (nombre, dirección, teléfono)
4. Con todos los datos → mostrar resumen y pedir CONFIRMACIÓN

PRODUCTOS:
- Destapa Cañerías Tornado - Precio: 159.900 Gs
- Peladora Automática - Precio: 99.000 Gs

═══════════════════════════════════
ENTRENAMIENTO:
═══════════════════════════════════
${fullTraining}

ESTADO ACTUAL:
Producto: ${orderData.product || "ninguno"}
Ciudad: ${orderData.city || "pendiente"}
Cantidad: ${orderData.quantity || "pendiente"}
Nombre: ${orderData.customer_name || "pendiente"}
Teléfono: ${orderData.phone || "pendiente"}
Dirección: ${orderData.address || "pendiente"}
Paso: ${step}

Español paraguayo, con emojis.`;

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
      order_data: orderData,
      last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
      updated_at: new Date().toISOString(),
    };

    return res.json({
      response: response || `📋 Te invito a revisar nuestro catálogo:\n${CATALOG_URL}`,
      context: newContext,
      is_payment_proof: isPaymentProof,
    });

  } catch (error: any) {
    console.error("❌ chat-ia:", error);
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
