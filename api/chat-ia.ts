// api/chat-ia.ts

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string);

const CATALOG_URL = "https://cat-logomegatodo-com.vercel.app/";

const clean = (t: any): string => String(t || "").trim();

const normalize = (t: string): string => clean(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();

// 🔥 NUEVA FUNCIÓN: Detecta si el cliente solo pide información general
function isInformationRequest(text: string): boolean {
  const n = normalize(text);
  
  // Palabras que indican solicitud de información
  const infoWords = /\b(informaci[oó]n|info|más info|mas info|quiero saber|consultar|dudas?|más datos|mas datos|detalles|más detalles|mas detalles|explicame|explicame|qué es|que es|cómo funciona|como funciona)\b/i;
  
  // Palabras que indican un producto específico (SI tiene estas, NO es solo info)
  const productWords = /\b(plantilla|ortopiex|ortoflex|5d|pelador|peladora|afilador|veneno|abeja|crema|vital|honey|perfume|asad|soporte|lavarropas|almohadilla|antivibracion|cuchillo|sharpener|vital honey)\b/i;
  
  // Si tiene palabras de producto, NO es solo información
  if (productWords.test(n)) {
    return false;
  }
  
  // Si tiene palabras de información y NO tiene palabras de producto
  return infoWords.test(n);
}

// 🔥 NUEVA FUNCIÓN: Detecta si es una consulta de catálogo/presentación
function isCatalogQuery(text: string): boolean {
  const n = normalize(text);
  const catalogWords = /\b(cat[aá]logo|productos|qu[eé] venden|qu[eé] ofrecen|tienen|stock|disponible|catálogo|productos|precios|catalogo)\b/i;
  const greetingWords = /\b(hola|buenas|buen día|buenas tardes|buenas noches|saludos|qué tal|que tal)\b/i;
  
  return (catalogWords.test(n) || (greetingWords.test(n) && !productWords.test(n)));
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
  return /\b(kit\sx\s4|kit\s+por\s+4|pack\sx\s4|pack\s+por\s+4|x\s4|4\sunidades\s*(incluidas|incluido)?|las\s4\sunidades)\b/.test(n);
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
  return ZONAS_COBERTURA.some((z) => normalize(z) === c) ? "con_cobertura" : "sin_cobertura";
}

function extractBankReceiverFromTraining(training: string): string {
  const titular = training.match(/titular\s*[:-]\s*([^\n\r]+)/i)?.[1] ||
                  training.match(/a nombre de\s*[:-]?\s*([^\n\r]+)/i)?.[1] || "";
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

// 🔥 FUNCIÓN CORREGIDA: Detecta producto SOLO si realmente lo pide
function detectProduct(text: string, training: string, prev?: string, lastAssistantMessage?: string) {
  const msg = normalize(text);
  
  // 🔥 NUEVO: Si solo pide información general, NO detectar producto
  if (isInformationRequest(text) || isCatalogQuery(text)) {
    console.log("ℹ️ El cliente solo pide información general, no se detecta producto");
    return "";
  }
  
  const lines = getPriceLines(training);

  if (msg.includes("veneno") || msg.includes("abeja") || msg.includes("crema de abeja") || msg.includes("creama")) {
    return "Veneno de Abeja";
  }

  if (msg.includes("plantilla") || msg.includes("ortopiex") || msg.includes("ortoflex") || msg.includes("5d")) {
    return getDefaultShoeProductName();
  }

  if (msg.includes("pelador") || msg.includes("peladora") || msg.includes("pelar papas") ||
      msg.includes("pelador de papas") || msg.includes("peladora de papas") || msg.includes("pelador automatico") ||
      msg.includes("peladora automatica")) {
    return "Peladora Automática";
  }

  if (msg.includes("afilador") || msg.includes("cuchillo") || msg.includes("sharpener")) {
    return "Afilador de Cuchillos";
  }

  if (msg.includes("vital honey") || msg.includes("vital honey vip")) {
    return "Vital Honey VIP";
  }

  if (msg.includes("perfume asad") || msg.includes("asad")) {
    return "Perfume Asad";
  }

  if (msg.includes("soporte lavarropas") || msg.includes("lavarropas") || msg.includes("almohadillas antivibracion")) {
    return "Almohadillas Antivibración y soporte para lavarropas";
  }

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

    for (const w of words) {
      if (msg.includes(w)) score += 10;
    }

    for (const mw of msgWords) {
      if (n.includes(mw)) score += 8;
    }

    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }

  if (bestScore >= 5) return best;

  if (lastAssistantMessage) {
    const assistantNorm = normalize(lastAssistantMessage);
    let assistantBest = "";
    let assistantScore = 0;

    for (const line of lines) {
      const name = extractProductNameFromLine(line);
      if (isInvalidProductCandidate(name)) continue;
      const n = normalize(name);
      if (!n || n.length < 3) continue;

      let score = 0;
      if (assistantNorm.includes(n)) score += 50;

      const words = n.split(" ").filter((w) => w.length >= 4);
      for (const w of words) {
        if (assistantNorm.includes(w)) score += 10;
      }

      if (score > assistantScore) {
        assistantScore = score;
        assistantBest = name;
      }
    }

    if (assistantScore >= 10) return assistantBest;
  }

  return clean(prev || "");
}

function canonicalProductFromText(text: string): string {
  const n = normalize(text);

  if (/\b(crema\s+de\s+abeja|creama\s+de\s+abeja|veneno\s+de\s+abeja)\b/.test(n)) {
    return "Veneno de Abeja";
  }

  if (/\b(pelador|peladora|pelar\s+papas|pelador\s+de\s+papas|peladora\s+automatica)\b/.test(n)) {
    return "Peladora Automática";
  }

  if (/\b(soporte\s+para\s+lavarropas|lavarropas|almohadillas\s+antivibracion|almohadillas\s+antivibración|patitas\s+antideslizantes)\b/.test(n)) {
    return "Almohadillas Antivibración y soporte para lavarropas";
  }

  if (/\b(plantilla|plantillas|ortopiex|ortoflex)\b/.test(n)) {
    return getDefaultShoeProductName();
  }

  if (/\b(afilador|afilador\s+de\s+cuchillos|cuchillos)\b/.test(n)) {
    return "Afilador de Cuchillos";
  }

  if (/\b(vital\s+honey|vital\s+honey\s+vip)\b/.test(n)) {
    return "Vital Honey VIP";
  }

  if (/\b(perfume\s+asad|asad)\b/.test(n)) {
    return "Perfume Asad";
  }

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

  const segments = n.split(/\b(?:tambien|también|ademas|además|agrega|agregame|sumame|suma|sumá|inclui|incluí|añadi|añadí|mas|más)\b/g).map((x) => x.trim()).filter(Boolean);

  for (const segment of segments) {
    const protectedProduct = canonicalProductFromText(segment);
    if (protectedProduct) found.push(protectedProduct);

    const catalogProduct = detectProduct(segment, training, "");
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
  return (m.includes("precio") || m.includes("cuanto") || m.includes("cuesta") || m.includes("valor") || m.includes("costo"));
}

// 🔥 FUNCIÓN CORREGIDA: No confunde "quiero información" con compra
function isBuyIntent(text: string) {
  const m = normalize(text);
  
  // 🔥 NUEVO: Si pide información, NO es intención de compra
  if (isInformationRequest(text) || isCatalogQuery(text)) {
    return false;
  }
  
  const graciasPattern = /\b(gracias|very nice|muy lindo|excelente|bien|okey|oka|perfecto|hermoso|genial|buenisimo)\b/i;
  if (graciasPattern.test(m)) return false;
  
  // "QUIERO" solo es intención si va seguido de un producto específico
  const quieroConProductoPattern = /\bquiero\s+(?:comprar\s+)?(?:una?\s+)?(?:el\s+)?(?:la\s+)?(?:los\s+)?(?:las\s+)?(?:un\s+)?(?:una\s+)?(plantilla|ortopiex|pelador|afilador|veneno|crema|vital|perfume|soporte|lavarropas)/i;
  if (quieroConProductoPattern.test(m)) return true;
  
  const soloQuieroPattern = /^\s*(quiero|si|sí|dale|ok|listo|confirmo|compro|reservo)\s*$/i;
  if (soloQuieroPattern.test(m)) {
    return true;
  }
  
  return (/\b(quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmar|mandame|dame)\s+\d+\b/.test(m) ||
    /\b\d+\s*(unidad|unidades|u)\b/.test(m) ||
    /^\d+$/.test(m));
}

function getLastAssistantMessage(history: any[]) {
  if (!Array.isArray(history)) return "";
  const last = history.filter((h: any) => h?.role === "assistant" || h?.role === "model").slice(-1)[0];
  return clean(last?.content);
}

function botWasAskingQuantity(history: any[]) {
  const lastAssistantMessage = normalize(getLastAssistantMessage(history));
  return (lastAssistantMessage.includes("cuantas unidades") ||
    lastAssistantMessage.includes("cuantos unidades") ||
    lastAssistantMessage.includes("cantidad") ||
    lastAssistantMessage.includes("cuantas queres") ||
    lastAssistantMessage.includes("cuantas te gustaria"));
}

function botWasAskingShoeSize(history: any[]) {
  const lastAssistantMessage = normalize(getLastAssistantMessage(history));
  return (lastAssistantMessage.includes("que calce") ||
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
    lastAssistantMessage.includes("disponibles del 35"));
}

// 🔥 FUNCIÓN CORREGIDA: Limpia extracciones falsas en consultas de info
function extractData(msg: string, currentStep?: string, forceQuantityMode = false, forceShoeSizeMode = false) {
  const text = clean(msg);
  const norm = normalize(text);
  
  // 🔥 NUEVO: Si es solo consulta de info, limpiar extracciones falsas
  if (isInformationRequest(text) || isCatalogQuery(text)) {
    return {
      quantity: 0,
      shoe_size: "",
      city: "",
      name: "",
      phone: "",
      address: "",
    };
  }

  const phone = text.match(/(?:09\d{8}|\+595\d{9})/)?.[0] || "";
  const isPackReference = isPackReferenceText(text);

  const shoeSizeMatch = norm.match(/\b(?:talle|numero|nro|num|uso|calzo|soy|en|del|de|para)\s*(\d{2})\b/);
  const explicitShoeSize = shoeSizeMatch ? Number(shoeSizeMatch[1]) : 0;

  const waitingForShoeSize = forceShoeSizeMode ||
    currentStep === "collecting_shoe_size" ||
    currentStep === "esperando_calce" ||
    currentStep === "collecting_calce";

  const onlyShoeSizeMatch = waitingForShoeSize ? norm.match(/^\s*(\d{2})\s*$/) : null;
  const implicitShoeSize = onlyShoeSizeMatch ? Number(onlyShoeSizeMatch[1]) : 0;

  const shoe_size = (explicitShoeSize >= 20 && explicitShoeSize <= 50) ? explicitShoeSize :
                    (implicitShoeSize >= 20 && implicitShoeSize <= 50) ? implicitShoeSize : 0;

  const isShoeSizeMessage = shoe_size >= 20 && shoe_size <= 50;

  let quantity = 0;

  if (!isShoeSizeMessage && !waitingForShoeSize &&
      (forceQuantityMode || currentStep === "collecting_quantity" || currentStep === "esperando_cantidad")) {
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
  }

  if (isPackReference && (currentStep === "collecting_quantity" || currentStep === "esperando_cantidad")) {
    quantity = 1;
  }

  const cityAliases: Record<string, string> = {
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

  const invalidName = /\d/.test(text) ||
    norm.includes("unidad") || norm.includes("unidades") ||
    norm.includes("precio") || norm.includes("delivery") || norm.includes("envio") || norm.includes("envío") ||
    norm.includes("ubicacion") || norm.includes("ubicación") || norm.includes("direccion") || norm.includes("dirección") ||
    norm.includes("calce") || norm.includes("talle") || norm.includes("numero") || norm.includes("nro");

  const nameMatch = text.match(/(?:me llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,60})/i)?.[1];

  if (nameMatch && !invalidName) {
    name = clean(nameMatch).replace(/de\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/i, "").trim();
  } else if (!invalidName && /^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,60}$/.test(text) &&
             !city && !phone && !quantity && !norm.includes("hola") && !norm.includes("si")) {
    name = text;
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

// ... el resto del código permanece igual (safeQuantity, mergeOrderData, formatGs, etc.)
// ... incluyendo todas las funciones de carrito, órdenes, y el handler principal
