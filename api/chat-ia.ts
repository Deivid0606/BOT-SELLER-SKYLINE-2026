// api/chat-ia.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

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

  return (
    /\b(calce|talle|numero|nro|num|medida)\b/.test(n) ||
    /^\d{2}$/.test(n)
  );
}

function extractShoeSizeFromText(text: string): number {
  const n = normalize(text);

  const explicit = n.match(
    /\b(?:calce|talle|numero|nro|num|uso|calzo|soy|en|del|de|para)\s*(\d{2})\b/
  );

  const plain = n.match(/^\s*(\d{2})\s*$/);
  const value = explicit ? Number(explicit[1]) : plain ? Number(plain[1]) : 0;

  return value >= 20 && value <= 50 ? value : 0;
}

function isPackReferenceText(text: string): boolean {
  const n = normalize(text);
  return /\b(kit\s*x\s*4|kit\s+por\s+4|pack\s*x\s*4|pack\s+por\s+4|x\s*4|4\s*unidades\s*(incluidas|incluido)?|las\s*4\s*unidades)\b/.test(n);
}

function isInvalidProductCandidate(name: string): boolean {
  const n = normalize(name);
  if (!n) return true;
  if (isOnlyShoeVariantText(name)) return true;
  if (/^(calce|talle|numero|nro|num|número|medida)$/.test(n)) return true;

  const invalidExact = [
    "1 unidad",
    "2 unidades",
    "3 unidades",
    "4 unidades",
    "unidad",
    "unidades",
    "cantidad",
    "precio",
    "total",
    "envio gratis",
    "pago al recibir",
    "calce",
    "talle",
    "numero",
    "nro",
    "num",
    "número",
    "medida",
  ];

  if (invalidExact.includes(n)) return true;
  if (/^\d+\s*(unidad|unidades|u|kit|kits)$/.test(n)) return true;
  if (/^\d+\s*(unidad|unidades).*[\",].*\d+\s*(unidad|unidades)/.test(n)) return true;
  if (/^(si|sí|ok|dale|listo|quiero|confirmo|gracias)$/.test(n)) return true;

  if (/^\d+\s*quiero$/.test(n)) return true;
  if (/^quiero\s*\d+$/.test(n)) return true;
  if (/\b\d+\s*quiero\b/.test(n)) return true;
  if (/\bquiero\s*\d+\b/.test(n)) return true;
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
  if (/^kit\s*x\s*4\s*unidades$/.test(n)) return true;
  if (/^pack\s*x\s*4\s*unidades$/.test(n)) return true;

  if (/\d+\s*(unidad|unidades).*(\d+\s*(unidad|unidades))/.test(n)) return true;

  if (/^\d+\s*quiero$/.test(n)) return true;
  if (/^quiero\s*\d+$/.test(n)) return true;
  if (/\b\d+\s*quiero\b/.test(n)) return true;
  if (/\bquiero\s*\d+\b/.test(n)) return true;
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
  return ZONAS_COBERTURA.some((z) => normalize(z) === c)
    ? "con_cobertura"
    : "sin_cobertura";
}

function extractBankReceiverFromTraining(training: string): string {
  const titular =
    training.match(/titular\s*[:\-]\s*([^\n\r]+)/i)?.[1] ||
    training.match(/a nombre de\s*[:\-]?\s*([^\n\r]+)/i)?.[1] ||
    "";

  return clean(titular).replace(/[✅📲💳]/g, "").trim();
}

function getPriceLines(training: string): string[] {
  return training
    .split("\n")
    .map((l) => clean(l))
    .filter((l) => l.length > 3);
}

function extractProductNameFromLine(line: string): string {
  const c = line
    .replace(/^[-•\s]+/, "")
    .replace(/[💙🦶🎯💰🔥✨⭐✅]/g, "")
    .trim();

  const parts = c.split(/—|-{2,}|–/);
  return clean(parts[0] || c);
}

function detectProduct(
  text: string,
  training: string,
  prev?: string,
  lastAssistantMessage?: string
) {
  const msg = normalize(text);
  const lines = getPriceLines(training);

  // 🔥 DETECCIÓN PRIORITARIA DE PRODUCTOS
  if (msg.includes("veneno") || msg.includes("abeja") || msg.includes("crema de abeja") || msg.includes("creama")) {
    return "Veneno de Abeja";
  }

  if (msg.includes("plantilla") || msg.includes("ortopiex") || msg.includes("ortoflex") || msg.includes("5d")) {
    return getDefaultShoeProductName();
  }

  // 🔥 CORREGIDO: Detección de Pelador/Peladora - múltiples variantes
  if (msg.includes("pelador") || 
      msg.includes("peladora") || 
      msg.includes("pelar papas") || 
      msg.includes("pelador de papas") ||
      msg.includes("peladora de papas") ||
      msg.includes("pelador automatico") ||
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

  const segments = n
    .split(/\b(?:y|tambien|también|ademas|además|agrega|agregame|sumame|suma|sumá|inclui|incluí|añadi|añadí|mas|más)\b/g)
    .map((x) => x.trim())
    .filter(Boolean);

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
  return (
    m.includes("precio") ||
    m.includes("cuanto") ||
    m.includes("cuesta") ||
    m.includes("valor") ||
    m.includes("costo")
  );
}

function isCasualReply(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  const casualExact = [
    "gracias",
    "muchas gracias",
    "ok gracias",
    "bueno gracias",
    "muy lindo",
    "lindo",
    "hermoso",
    "hermosa",
    "que lindo",
    "que hermoso",
    "esta lindo",
    "esta muy lindo",
    "me gusta",
    "genial",
    "excelente",
    "buenisimo",
    "buenísimo",
    "perfecto gracias",
    "dale gracias",
  ];

  if (casualExact.includes(n)) return true;

  const onlyThanksOrCompliment =
    /^(gracias|muchas gracias|muy lindo|lindo|hermoso|hermosa|genial|excelente|buenisimo|buenísimo)(\s+[a-záéíóúñ]+){0,2}$/.test(n);

  return onlyThanksOrCompliment &&
    !/\b(quiero|llevo|compro|comprar|agendar|reservar|mandame|dame|unidad|unidades|direccion|dirección|ubicacion|ubicación|telefono|teléfono|celular|calle|casa|barrio)\b/.test(n);
}

function hasFullCustomerName(name: any): boolean {
  const raw = clean(name);
  const n = normalize(raw);
  if (!raw || isCasualReply(raw)) return false;
  if (/\d/.test(raw)) return false;
  if (/\b(gracias|lindo|hermoso|ok|dale|listo|si|sí|quiero|precio|delivery|envio|envío|direccion|dirección|ubicacion|ubicación|telefono|teléfono|celular)\b/.test(n)) return false;

  const words = raw
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => /^[a-zA-ZÁÉÍÓÚáéíóúÑñ]{2,}$/.test(w));

  return words.length >= 2;
}

function hasMinimumOrderDataToPersist(order: any): boolean {
  const items = getCartItems(order);
  return !!(
    (order?.product || items.length) &&
    (safeQuantity(order?.quantity) > 0 || items.length) &&
    Number(order?.total_amount || cartGrandTotal(items) || 0) > 0
  );
}

function hasRealCustomerData(order: any, tipoCobertura?: string): boolean {
  if (!hasMinimumOrderDataToPersist(order)) return false;
  if (!order?.city) return false;
  if (!hasFullCustomerName(order?.customer_name)) return false;
  if (!order?.phone) return false;

  if (tipoCobertura === "sin_cobertura") return true;

  return !!clean(order?.address);
}

function isBuyIntent(text: string) {
  if (isCasualReply(text)) return false;

  const m = normalize(text);

  // Palabras suaves como "ok", "dale" o "listo" solo cuentan como compra
  // si vienen con una señal real de pedido. Así evitamos ventas falsas.
  const strongBuyIntent =
    /\b(quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|confirmar|mandame|dame)\b/.test(m);

  const quantityIntent =
    /\b\d+\s*(unidad|unidades|u)\b/.test(m) ||
    /\b(una|uno|dos|tres|cuatro|cinco)\s*(unidad|unidades)?\b/.test(m);

  const shortConfirmation =
    /^(si|sí|ok|dale|listo)$/.test(m);

  return strongBuyIntent || quantityIntent || shortConfirmation || /^\d+$/.test(m);
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
    lastAssistantMessage.includes("cuantas te gustaria")
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

  const phone = text.match(/(?:09\d{8}|\+595\d{9})/)?.[0] || "";
  const isPackReference = isPackReferenceText(text);

  const shoeSizeMatch = norm.match(
    /\b(?:calce|talle|numero|nro|num|uso|calzo|soy|en|del|de|para)\s*(\d{2})\b/
  );

  const explicitShoeSize = shoeSizeMatch ? Number(shoeSizeMatch[1]) : 0;

  const waitingForShoeSize =
    forceShoeSizeMode ||
    currentStep === "collecting_shoe_size" ||
    currentStep === "esperando_calce" ||
    currentStep === "collecting_calce";

  const onlyShoeSizeMatch = waitingForShoeSize
    ? norm.match(/^\s*(\d{2})\s*$/)
    : null;

  const implicitShoeSize = onlyShoeSizeMatch ? Number(onlyShoeSizeMatch[1]) : 0;

  const shoe_size =
    explicitShoeSize >= 20 && explicitShoeSize <= 50
      ? explicitShoeSize
      : implicitShoeSize >= 20 && implicitShoeSize <= 50
      ? implicitShoeSize
      : 0;

  const isShoeSizeMessage = shoe_size >= 20 && shoe_size <= 50;

  let quantity = 0;

  if (isShoeSizeMessage) {
    quantity = 1;
  }

  if (isPackReference) {
    quantity = 1;
  }

  if (
    !isShoeSizeMessage &&
    !waitingForShoeSize &&
    (
      forceQuantityMode ||
      currentStep === "collecting_quantity" ||
      currentStep === "esperando_cantidad"
    )
  ) {
    const onlyNumber = norm.match(/^\s*(\d{1,3})\s*$/);
    if (onlyNumber) {
      const num = Number(onlyNumber[1]);
      if (num >= 1 && num <= 999) quantity = num;
    }
  }

  if (!quantity && !isShoeSizeMessage) {
    const q1 = norm.match(/\b(\d{1,3})\s*(unidad|unidades|u)\b/);
    if (q1) quantity = Number(q1[1]);
  }

  if (
    !quantity &&
    !isShoeSizeMessage &&
    /\b(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/.test(norm)
  ) {
    const words: Record<string, number> = {
      uno: 1,
      una: 1,
      dos: 2,
      tres: 3,
      cuatro: 4,
      cinco: 5,
      seis: 6,
      siete: 7,
      ocho: 8,
      nueve: 9,
      diez: 10,
    };

    for (const [word, num] of Object.entries(words)) {
      if (new RegExp(`\\b${word}\\b`).test(norm)) {
        quantity = num;
        break;
      }
    }
  }

  if (!quantity && !isShoeSizeMessage) {
    const looksLikeQuantity =
      /\b(quiero|llevo|mandame|dame|solo|solamente|nomas|nomás|unidad|unidades|u)\b/.test(norm);

    if (looksLikeQuantity) {
      const q2 = norm.match(/\b(\d{1,3})\b/);
      if (q2) {
        const num = Number(q2[1]);
        if (num >= 1 && num <= 999) quantity = num;
      }
    }
  }

  const cityAliases: Record<string, string> = {
    asuncion: "Asunción",
    capiata: "Capiatá",
    capilata: "Capiatá",
    kapiata: "Capiatá",
    cde: "Ciudad del Este",
    "ciudad del este": "Ciudad del Este",
    luque: "Luque",
    ita: "Itá",
    lambare: "Lambaré",
    "san lorenzo": "San Lorenzo",
    sanlo: "San Lorenzo",
    "san lorenso": "San Lorenzo",
    fdm: "Fernando de la Mora",
    "fernando de la mora": "Fernando de la Mora",
    nemby: "Ñemby",
    ñemby: "Ñemby",
    ypane: "Ypané",
    limpio: "Limpio",
    "villa elisa": "Villa Elisa",
    hernandarias: "Hernandarias",
    "presidente franco": "Presidente Franco",
    "pte franco": "Presidente Franco",
    aregua: "Areguá",
    areguá: "Areguá",
    sanber: "San Bernardino",
    "san ber": "San Bernardino",
    "san bernardino": "San Bernardino",
    pjc: "Pedro Juan Caballero",
    "pedro juan": "Pedro Juan Caballero",
    "pedro juan caballero": "Pedro Juan Caballero",
  };

  let city = "";

  for (const [k, v] of Object.entries(cityAliases)) {
    if (new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)) {
      city = v;
      break;
    }
  }

  const address =
    text.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)?.[1] || "";

  let name = "";

  const invalidName =
    isCasualReply(text) ||
    /\d/.test(text) ||
    norm.includes("unidad") ||
    norm.includes("unidades") ||
    norm.includes("precio") ||
    norm.includes("delivery") ||
    norm.includes("envio") ||
    norm.includes("envío") ||
    norm.includes("ubicacion") ||
    norm.includes("ubicación") ||
    norm.includes("direccion") ||
    norm.includes("dirección") ||
    norm.includes("calce") ||
    norm.includes("talle") ||
    norm.includes("numero") ||
    norm.includes("nro");

  const nameMatch = text.match(
    /(?:soy|me llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,60})/i
  )?.[1];

  if (nameMatch && !invalidName) {
    name = clean(nameMatch).replace(/de\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/i, "").trim();
  } else if (
    !invalidName &&
    /^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,60}$/.test(text) &&
    hasFullCustomerName(text) &&
    !city &&
    !phone &&
    !quantity &&
    !norm.includes("hola") &&
    !norm.includes("si")
  ) {
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

function safeQuantity(value: any): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const match = raw.match(/^\d{1,3}$/);
  if (!match) return 0;

  const n = Number(match[0]);
  if (!Number.isFinite(n) || n < 1 || n > 999) return 0;

  return n;
}

const MAX_DIRECT_ORDER_QUANTITY = 20;

function safeDirectOrderQuantity(value: any): number {
  const q = safeQuantity(value);
  if (!q) return 0;

  // Protección anti contexto corrupto: evita que "1" termine como "11", "111", etc.
  // Si querés permitir mayoristas, subí este límite.
  if (q > MAX_DIRECT_ORDER_QUANTITY) return 0;

  return q;
}

function mergeOrderData(old: any, ext: any, product: string, replaceQuantity = false): any {
  const oldQuantity = safeQuantity(old?.quantity);
  const newQuantity = safeQuantity(ext?.quantity);

  // 🔥 IMPORTANTE:
  // Si el cliente responde una cantidad nueva, REEMPLAZA la anterior.
  // Nunca sumamos ni concatenamos cantidades del contexto.
  const finalQuantity =
    replaceQuantity && newQuantity > 0
      ? newQuantity
      : oldQuantity;

  return {
    product: product || old?.product || "",
    quantity: finalQuantity,
    shoe_size: ext?.shoe_size || old?.shoe_size || "",
    city: ext?.city || old?.city || "",
    customer_name: ext?.name || old?.customer_name || "",
    phone: ext?.phone || old?.phone || "",
    address: ext?.address || old?.address || "",
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

  const protectedCatalog = [
    {
      keys: ["veneno de abeja", "crema de abeja", "creama de abeja", "abeja"],
      unit: 145000,
      promos: { 2: 249900 } as Record<number, number>,
    },
    {
      keys: ["peladora automatica", "pelador automatico", "peladora", "pelador"],
      unit: 189900,
      promos: {} as Record<number, number>,
    },
    {
      keys: ["afilador de cuchillos", "afilador", "cuchillos", "sharpener"],
      unit: 99000,
      promos: { 2: 129900 } as Record<number, number>,
    },
    {
      keys: ["vital honey vip", "vital honey"],
      unit: 169900,
      promos: { 2: 289900 } as Record<number, number>,
    },
    {
      keys: ["perfume asad", "asad"],
      unit: 169900,
      promos: {} as Record<number, number>,
    },
    {
      keys: ["plantillas ortopiex", "ortopiex", "plantillas"],
      unit: 159000,
      promos: {} as Record<number, number>,
    },
    {
      keys: [
        "almohadillas antivibracion",
        "almohadillas antivibración",
        "soportes antivibracion",
        "soportes antivibración",
        "patitas antideslizantes",
        "kit x4 patitas antideslizantes",
        "kit x 4 patitas antideslizantes",
        "soporte para lavarropas",
        "lavarropas"
      ],
      unit: 98000,
      promos: {} as Record<number, number>,
    },
  ];

  for (const item of protectedCatalog) {
    if (item.keys.some((k) => p.includes(normalize(k)) || normalize(k).includes(p))) {
      if (item.promos[quantity]) return item.promos[quantity];
      return item.unit * quantity;
    }
  }

  const lines = training.split("\n").map((l) => clean(l)).filter(Boolean);
  let unitPrice = 0;
  let promoPrice = 0;

  for (let i = 0; i < lines.length; i++) {
    const current = normalize(lines[i]);
    if (!current.includes(p) && !p.includes(current)) continue;

    const window = lines.slice(i, i + 6);

    for (const line of window) {
      const nLine = normalize(line);
      const amount = parseGsAmount(line);
      if (!amount) continue;

      if (quantity === 2 && /(2x|2\s*unidades|promo\s*2|2\s*cajas)/i.test(nLine)) {
        promoPrice = amount;
        break;
      }

      if (!unitPrice && /(1\s*unidad|1\s*caja|precio|gs|g\.)/i.test(nLine)) {
        unitPrice = amount;
      }
    }

    if (promoPrice) return promoPrice;
    if (unitPrice) return unitPrice * quantity;
  }

  return null;
}

type CartItem = {
  product: string;
  quantity: number;
  total: number;
  shoe_size?: any;
};

function isAddMoreIntent(text: string): boolean {
  const m = normalize(text);
  return /\b(tambien|también|agrega|agregame|sumame|suma|sumá|inclui|incluí|añadi|añadí|mas|más)\b/.test(m) ||
    /\by\s+(la|el|los|las)\b/.test(m);
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
    .filter((i: CartItem) => i.product && i.quantity > 0 && !isInvalidCartProduct(i.product));

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

  return `🔥 Perfecto 😊

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

  return `🔥 Perfecto 😊

Tu pedido queda así:

📦 ${formatProductWithShoeSize(order.product, order.shoe_size)}
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

function nextStep(o: any, tipoCobertura?: string) {
  const items = getCartItems(o);
  if (!o.product && !items.length) return "selling";
  if (!o.city) return "collecting_city";
  if (o.product && !safeQuantity(o.quantity)) return "collecting_quantity";
  if (!safeQuantity(o.quantity) && !items.length) return "collecting_quantity";

  if (tipoCobertura === "sin_cobertura") {
    if (!o.customer_name) return "collecting_name";
    if (!o.phone) return "collecting_phone";
    return "waiting_payment_proof";
  }

  if (!o.customer_name) return "collecting_name";
  if (!o.phone) return "collecting_phone";
  if (!o.address) return "collecting_address";

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
        "draft",
        "collecting_name",
        "collecting_city",
        "collecting_quantity",
        "collecting_phone",
        "collecting_address",
        "waiting_payment_proof",
        "payment_verified",
        "confirm_pending",
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) {
      console.error("❌ findOrder:", findErr);
      return null;
    }

    const tipoCobertura = getTipoCobertura(order.city);
    const step = nextStep(order, tipoCobertura);

    const canConfirmOrder = hasRealCustomerData(order, tipoCobertura);

    const finalStatus =
      forcedStatus ||
      (confirm && step === "confirm_order" && canConfirmOrder
        ? "confirmed"
        : step === "confirm_order" && canConfirmOrder
        ? "confirm_pending"
        : step === "confirm_order"
        ? "collecting_address"
        : step);

    const payload: any = {
      user_id: userId,
      from_number: from,
      phone: order.phone || from,
      product: orderItems.length > 1 ? orderItems.map((i) => `${i.product} x${i.quantity}`).join(" + ") : formatProductWithShoeSize(order.product || orderItems[0]?.product || "", order.shoe_size) || null,
      producto: orderItems.length > 1 ? orderItems.map((i) => `${i.product} x${i.quantity}`).join(" + ") : formatProductWithShoeSize(order.product || orderItems[0]?.product || "", order.shoe_size) || null,
      customer_name: order.customer_name || null,
      city: order.city || null,
      ciudad: order.city || null,
      address: order.address || null,
      quantity: orderItems.length ? cartTotalQuantity(orderItems) : order.quantity || null,
      total_amount: orderItems.length ? cartGrandTotal(orderItems) : order.total_amount || null,
      status: finalStatus,
      fecha: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error } = await supabase
        .from("orders")
        .update(payload)
        .eq("id", existing.id);

      if (error) console.error("❌ updateOrder:", error);
      return existing.id;
    }

    const { data, error } = await supabase
      .from("orders")
      .insert(payload)
      .select("id")
      .single();

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

async function fetchMediaAsBase64(
  url: string
): Promise<{ data: string; mime: string } | null> {
  try {
    const r = await fetch(url);

    if (!r.ok) {
      console.error("❌ fetchMedia:", r.status, url.slice(0, 80));
      return null;
    }

    const mime = r.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await r.arrayBuffer());

    return {
      data: buf.toString("base64"),
      mime: mime.split(";")[0].trim(),
    };
  } catch (e) {
    console.error("❌ fetchMediaAsBase64:", e);
    return null;
  }
}

async function callGemini({
  apiKey,
  model,
  system,
  contents,
  temperature,
  maxTokens,
}: any) {
  const body: any = {
    systemInstruction: {
      parts: [{ text: system }],
    },
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      topP: 0.95,
      topK: 40,
    },
  };

  if (String(model).includes("2.5")) {
    body.generationConfig.thinkingConfig = {
      thinkingBudget: 0,
    };
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

  const text = clean(
    c?.content?.parts?.map((p: any) => p.text || "").join("") || ""
  );

  console.log("🧠 finishReason:", c?.finishReason, "len:", text.length);

  return text;
}

async function analyzeImageWithGemini({
  apiKey,
  model,
  imageBase64,
  mime,
  caption,
  productList,
  expectedReceiverName,
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
  const system = `
Sos un clasificador visual de productos y comprobantes para una tienda de WhatsApp en Paraguay.

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
- Si ves transferencia, banco, comprobante, destinatario, nro de comprobante o monto enviado → kind = "payment_proof".
- Si es comprobante, extraé amount y receiverName.
- El receptor esperado según entrenamiento es: "${expectedReceiverName || "no especificado"}".
- Si el receptor aparece parecido al esperado, devolvé el nombre esperado del entrenamiento.
- Si ves un producto físico, artículo, herramienta, máquina, envase, caja, frasco, accesorio o promo comercial → kind = "product".
- Si es producto, NUNCA lo clasifiques como comprobante aunque tenga precio, números o texto de promo.
- Si ves un afilador de cuchillos, sharpener, herramienta negra/roja con ranuras para cuchillos → productName = "Afilador de Cuchillos".
- Si ves una imagen con texto "PROMO 2 UNIDADES 129.900Gs" y un producto físico → kind = "product", productPrice = "129.900", promoText = "PROMO 2 UNIDADES".
- Si ves un pelador de papas, pelador automático, peladora de verduras → productName = "Peladora Automática".
- Si el producto no está en catálogo, igual identificá el productName genérico visual.
- matchedProduct solo va si encontrás coincidencia clara con el catálogo.
- Si no estás seguro, usá kind = "other".

Caption del cliente: "${clean(caption) || "(vacío)"}"

Catálogo / entrenamiento:
${productList.slice(0, 5000)}

NO devuelvas texto fuera del JSON.
`.trim();

  const contents = [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType: mime,
            data: imageBase64,
          },
        },
        {
          text: caption ? `Caption: ${caption}` : "Analizá la imagen.",
        },
      ],
    },
  ];

  const raw = await callGemini({
    apiKey,
    model,
    system,
    contents,
    temperature: 0.02,
    maxTokens: 900,
  });

  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no json");

    const parsed = JSON.parse(match[0]);

    const kind =
      parsed.kind === "payment_proof" ||
      parsed.kind === "product" ||
      parsed.kind === "other"
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
      amount: "",
      receiverName: "",
      matchedProduct: "",
      productName: "",
      productPrice: "",
      promoText: "",
    };
  }
}

async function transcribeAudioWithGemini({
  apiKey,
  model,
  audioBase64,
  mime,
}: any): Promise<string> {
  const system =
    "Transcribí el audio al español tal cual lo dijo el hablante. Devolvé SOLO la transcripción en texto plano.";

  const contents = [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            mimeType: mime,
            data: audioBase64,
          },
        },
        { text: "Transcribí este audio." },
      ],
    },
  ];

  const txt = await callGemini({
    apiKey,
    model,
    system,
    contents,
    temperature: 0.1,
    maxTokens: 1024,
  });

  return clean(txt);
}

export default async function handler(req: any, res: any) {
  console.log("🔥 VERSION FINAL - PELADOR DE PAPAS DETECTADO CORRECTAMENTE");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      user_id,
      message,
      from_number,
      context,
      history,
      media_url,
      media_type,
      mime_type,
    } = req.body;

    let texto = clean(message);
    const fromNumber = clean(from_number);
    const mediaUrl = clean(media_url);
    const mediaType = clean(media_type);
    const mimeHint = clean(mime_type);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });

    if (!texto && !mediaUrl) {
      return res.status(400).json({ error: "Faltan message o media" });
    }

    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({
        response: "⚠️ La IA no está configurada o desactivada.",
      });
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
      return res.json({
        response: "⚠️ No encontré entrenamiento activo.",
      });
    }

    const expectedReceiverName = extractBankReceiverFromTraining(fullTraining);

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    const oldOrder = normalizeOrderWithItems(context?.order_data || {}, fullTraining);
    const previousStep = clean(context?.step);
    const previousTipoCobertura = clean(context?.tipo_cobertura);

    let isPaymentProof = false;

    const lastAssistantMessage = getLastAssistantMessage(history || []);
    const wasAskingQuantity = botWasAskingQuantity(history || []);
    const wasAskingShoeSize = botWasAskingShoeSize(history || []);

    const isOnlyNumber = /^\s*\d{1,3}\s*$/.test(texto);

    const shoeSizeFromText = extractShoeSizeFromText(texto);
    const shoeProductContext = isShoeProductText(
      [oldOrder?.product, context?.current_product, context?.last_topic, lastAssistantMessage].filter(Boolean).join(" ")
    );

    const isPureShoeSizeReply =
      shoeSizeFromText > 0 &&
      !!(oldOrder?.product || context?.current_product || shoeProductContext) &&
      (
        wasAskingShoeSize ||
        previousStep === "collecting_shoe_size" ||
        previousStep === "esperando_calce" ||
        previousStep === "collecting_calce" ||
        shoeProductContext ||
        productRequiresSize(String(oldOrder?.product || context?.current_product || ""))
      );

    const isPureQuantityReply =
      isOnlyNumber &&
      !isPureShoeSizeReply &&
      !!oldOrder?.product &&
      !!oldOrder?.city &&
      (
        wasAskingQuantity ||
        previousStep === "collecting_quantity" ||
        previousStep === "esperando_cantidad"
      );

    const wantsAddMore = isAddMoreIntent(texto);
    console.log(`🔥 wantsAddMore: ${wantsAddMore}, texto: ${texto}`);

    let product;
    
    if (wantsAddMore) {
      product = detectProduct(
        texto,
        fullTraining,
        null,
        lastAssistantMessage
      );
      console.log(`🔥 Producto adicional detectado: ${product}`);
    } 
    else if (isPureQuantityReply && (context?.current_product || oldOrder?.product)) {
      product = context?.current_product || oldOrder?.product;
      console.log(`🔥 Cantidad reply - Producto forzado: ${product}`);
    } 
    else if (isPureShoeSizeReply && (context?.current_product || oldOrder?.product)) {
      product = context?.current_product || oldOrder?.product;
      console.log(`🔥 Calce reply - Producto forzado: ${product}`);
    } 
    else {
      product = detectProduct(
        texto,
        fullTraining,
        context?.current_product || oldOrder?.product,
        lastAssistantMessage
      );
    }

    let extracted = extractData(texto, previousStep, isPureQuantityReply, isPureShoeSizeReply);

    if (isPackReferenceText(texto) && (previousStep === "collecting_quantity" || previousStep === "esperando_cantidad")) {
      extracted.quantity = safeQuantity(oldOrder?.quantity) || 1;
      extracted.name = "";
      extracted.address = "";
      product = oldOrder?.product || context?.current_product || product;
    }

    if (isPureQuantityReply) {
      const exactQuantity = safeDirectOrderQuantity(texto);
      extracted.quantity = exactQuantity;
      extracted.name = "";
      extracted.address = "";
      product = context?.current_product || oldOrder?.product || product;
      console.log(`✅ Cantidad exacta detectada: ${exactQuantity} para producto: ${product}`);
    }

    if (isPureShoeSizeReply) {
      const exactShoeSize = shoeSizeFromText;
      extracted.quantity = 1;
      extracted.shoe_size = exactShoeSize;
      extracted.name = "";
      extracted.address = "";
      product = context?.current_product || oldOrder?.product || product;
      console.log(`✅ Calce exacto detectado: ${exactShoeSize} para producto: ${product}`);
    }

    const mediaOrder = mergeOrderData(
      oldOrder,
      extracted,
      product,
      isPureQuantityReply || safeQuantity(extracted.quantity) > 0
    );

    // ========== PROCESAMIENTO DE MEDIA (IMAGEN/AUDIO) ==========
    if (mediaUrl && mediaType === "image") {
      const fetched = await fetchMediaAsBase64(mediaUrl);

      if (fetched) {
        const mime = mimeHint || fetched.mime || "image/jpeg";

        const analysis = await analyzeImageWithGemini({
          apiKey,
          model,
          imageBase64: fetched.data,
          mime,
          caption: texto,
          productList: fullTraining,
          expectedReceiverName,
        });

        console.log("🖼️ Vision:", analysis);

        if (analysis.kind === "payment_proof") {
          isPaymentProof = true;
          const isWaitingPaymentProof = getTipoCobertura(mediaOrder?.city) === "sin_cobertura" && previousStep === "waiting_payment_proof";

          await safeUpsertOrder(
            user_id,
            fromNumber,
            mediaOrder,
            false,
            isWaitingPaymentProof ? "payment_verified" : undefined
          );

          const amountText = analysis.amount ? ` por Gs. ${analysis.amount}` : "";
          const receiver = analysis.receiverName || expectedReceiverName || "nuestro titular";

          return res.json({
            response: `¡Perfecto! 🙏 Recibimos tu comprobante${amountText} a nombre de ${receiver}.

Ya estamos verificando el pago ✅

Una vez verificado, dentro de las próximas 24 horas te estaremos enviando tu comprobante de encomienda 🚚✨`,
            is_payment_proof: true,
            context: {
              ...(context || {}),
              current_product: mediaOrder?.product || context?.current_product || null,
              step: isWaitingPaymentProof ? "payment_verified" : previousStep || "selling",
              tipo_cobertura: getTipoCobertura(mediaOrder?.city) || previousTipoCobertura || null,
              order_data: mediaOrder,
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
          ].filter(Boolean).join(" ");

          const catalogProduct = detectProduct(productSignal, fullTraining, "");
          const visualProduct = catalogProduct || analysis.matchedProduct || analysis.productName || "";
          product = visualProduct || product;
          const hasVisiblePrice = !!analysis.productPrice;

          if (!catalogProduct && visualProduct && hasVisiblePrice) {
            const promoLine = analysis.promoText ? `🔥 ${analysis.promoText} → ${analysis.productPrice} Gs` : `💰 Precio: ${analysis.productPrice} Gs`;

            return res.json({
              response: `Sí 😊 es ${visualProduct}.

${promoLine}

📍 ¿Para qué ciudad sería el envío?`,
              context: {
                ...(context || {}),
                current_product: visualProduct,
                step: "collecting_city",
                tipo_cobertura: previousTipoCobertura || null,
                order_data: { ...(mediaOrder || {}), product: visualProduct },
                last_topic: visualProduct,
                updated_at: new Date().toISOString(),
              },
              is_payment_proof: false,
            });
          }

          texto = `
El cliente envió una FOTO DE PRODUCTO.
Descripción detectada: ${analysis.transcript || "producto no identificado"}
Producto visual detectado: ${visualProduct || "no identificado"}
Producto del catálogo detectado: ${catalogProduct || "no encontrado"}
Precio visible en imagen: ${analysis.productPrice || "no visible"}
Promo visible en imagen: ${analysis.promoText || "no visible"}

Si hay producto del catálogo detectado, respondé con su nombre, precio exacto del entrenamiento, promoción si existe y preguntá para qué ciudad sería el envío.
Si no hay producto del catálogo pero hay producto visual y precio visible, respondé con ese producto y precio visible.
Si no hay precio visible ni producto seguro, pedí el nombre del producto.
`.trim();
        } else {
          texto = texto || `El cliente envió una imagen. Descripción: ${analysis.transcript || "imagen no identificada"}. Si no corresponde a producto ni comprobante, pedí más detalle.`;
        }
      } else {
        texto = texto || "Te mandé una imagen pero no pudiste descargarla.";
      }
    }

    if (mediaUrl && mediaType === "audio") {
      const fetched = await fetchMediaAsBase64(mediaUrl);

      if (fetched) {
        const mime = mimeHint || fetched.mime || "audio/ogg";
        const transcript = await transcribeAudioWithGemini({ apiKey, model, audioBase64: fetched.data, mime });
        texto = transcript || texto || "Te mandé un audio.";
      } else {
        texto = texto || "Te mandé un audio pero no pudiste descargarlo.";
      }
    }

    if (!texto) texto = "(mensaje sin texto)";

    extracted = extractData(texto, previousStep, isPureQuantityReply, isPureShoeSizeReply);

    if (isPackReferenceText(texto) && (previousStep === "collecting_quantity" || previousStep === "esperando_cantidad")) {
      extracted.quantity = safeQuantity(oldOrder?.quantity) || 1;
      extracted.name = "";
      extracted.address = "";
      product = oldOrder?.product || context?.current_product || product;
    }

    if (isPureQuantityReply) {
      const exactQuantity = safeDirectOrderQuantity(message);
      extracted.quantity = exactQuantity;
      product = context?.current_product || oldOrder?.product || product;
      console.log(`✅ Reforzando cantidad exacta: ${exactQuantity} para producto: ${product}`);
    }

    if (isPureShoeSizeReply) {
      const exactShoeSize = shoeSizeFromText;
      extracted.quantity = 1;
      extracted.shoe_size = exactShoeSize;
      product = context?.current_product || oldOrder?.product || product;
      console.log(`✅ Reforzando calce exacto: ${exactShoeSize} para producto: ${product}`);
    }

    if (!isPureQuantityReply && !isPureShoeSizeReply && !wantsAddMore) {
      product = detectProduct(
        texto,
        fullTraining,
        product || context?.current_product || oldOrder?.product,
        lastAssistantMessage
      );
    }

    if (isPackReferenceText(texto) && (previousStep === "collecting_quantity" || previousStep === "esperando_cantidad")) {
      product = oldOrder?.product || context?.current_product || product;
    }

    const productChanged = !!product && !!oldOrder?.product && !sameProduct(product, oldOrder.product);
    const baseOrder = oldOrder;
    const effectivePreviousStep = previousStep;
    const effectivePreviousTipoCobertura = previousTipoCobertura;

    let orderData = mergeOrderData(
      baseOrder,
      extracted,
      product,
      isPureQuantityReply || safeQuantity(extracted.quantity) > 0
    );

    if (productChanged && !safeQuantity(extracted.quantity)) {
      orderData.quantity = 0;
      orderData.total_amount = 0;
    }

    orderData.quantity = isPureQuantityReply
      ? safeDirectOrderQuantity(extracted.quantity)
      : safeQuantity(orderData.quantity);

    if (!orderData.quantity && isPureQuantityReply) {
      orderData.quantity = 1;
      extracted.quantity = 1;
    }

    // 🔥 protección final anti cantidades absurdas por contexto/historial
    if (orderData.quantity > MAX_DIRECT_ORDER_QUANTITY) {
      orderData.quantity = 1;
      extracted.quantity = 1;
    }

    if (orderData.shoe_size) {
      const preservedShoeProduct = isShoeProductText(oldOrder?.product || "")
        ? oldOrder.product
        : isShoeProductText(context?.current_product || "")
        ? context.current_product
        : getDefaultShoeProductName();

      const shoeQty = safeQuantity(orderData.quantity) || safeQuantity(oldOrder?.quantity) || 1;
      const shoeTotal = calculateTotal(preservedShoeProduct, shoeQty, fullTraining) || 159000 * shoeQty;

      orderData.product = preservedShoeProduct;
      product = preservedShoeProduct;
      orderData.quantity = shoeQty;
      orderData.total_amount = shoeTotal;
      orderData.items = [{ product: preservedShoeProduct, quantity: shoeQty, total: shoeTotal, shoe_size: orderData.shoe_size }];
    }

    if (isInvalidProductCandidate(orderData.product) && (oldOrder?.product || context?.current_product)) {
      orderData.product = oldOrder?.product || context?.current_product;
    }

    const calculatedTotal = calculateTotal(orderData.product, orderData.quantity, fullTraining);
    if (calculatedTotal) {
      orderData.total_amount = calculatedTotal;
    }

    const asksPriceNow = isPriceIntent(texto);
    const productsToAdd = wantsAddMore ? detectMultipleProducts(texto, fullTraining) : [];
    const hasProductsToAdd = productsToAdd.length > 0;

    const isFreshProductSearch =
      !!product &&
      !wantsAddMore &&
      !isPureQuantityReply &&
      !isPackReferenceText(texto) &&
      !effectivePreviousStep.startsWith("collecting") &&
      effectivePreviousStep !== "esperando_cantidad" &&
      effectivePreviousStep !== "waiting_payment_proof";

    // Si el cliente acaba de responder solo la cantidad (ej: "1"), empezamos limpio
    // para no arrastrar cantidades viejas del carrito/contexto.
    let cartItems = isFreshProductSearch || isPureQuantityReply ? [] : getCartItems(oldOrder);

    if (product && (effectivePreviousStep === "collecting_quantity" || effectivePreviousStep === "esperando_cantidad")) {
      cartItems = cartItems.filter((i) => sameProduct(i.product, product));
    }

    if (isFreshProductSearch) {
      orderData.items = [];
      orderData.customer_name = "";
      orderData.phone = "";
      orderData.address = "";
      orderData.quantity = safeQuantity(extracted.quantity);
      orderData.total_amount = 0;
    }

    // 🔥 MANEJO DE AGREGADO DE PRODUCTOS
    if (wantsAddMore && (product || hasProductsToAdd)) {
      console.log(`🔥 Procesando agregado de producto: product=${product}, hasProductsToAdd=${hasProductsToAdd}, productsToAdd=${JSON.stringify(productsToAdd)}`);
      
      if (hasProductsToAdd) {
        for (const pToAdd of productsToAdd) {
          if (!pToAdd || isInvalidCartProduct(pToAdd)) continue;
          if (isShoeProductText(pToAdd) && orderData.shoe_size) continue;

          const itemQty = extracted.quantity > 0 ? extracted.quantity : 1;
          const itemTotal = calculateTotal(pToAdd, itemQty, fullTraining);
          
          console.log(`🔥 Agregando producto: ${pToAdd}, cantidad: ${itemQty}, total: ${itemTotal}`);
          
          if (itemTotal) {
            cartItems = addOrReplaceCartItem(
              cartItems,
              pToAdd,
              itemQty,
              itemTotal,
              "add",
              ""
            );
          }
        }
      } 
      else if (product && !isInvalidCartProduct(product)) {
        const itemQty = extracted.quantity > 0 ? extracted.quantity : 1;
        const itemTotal = calculateTotal(product, itemQty, fullTraining);
        
        console.log(`🔥 Agregando producto único: ${product}, cantidad: ${itemQty}, total: ${itemTotal}`);
        
        if (itemTotal) {
          cartItems = addOrReplaceCartItem(
            cartItems,
            product,
            itemQty,
            itemTotal,
            "add",
            ""
          );
        }
      }

      orderData.items = cartItems;
      orderData.total_amount = cartGrandTotal(cartItems);
      orderData.quantity = cartTotalQuantity(cartItems);
      orderData.product = cartItems.map((i) => `${formatProductWithShoeSize(i.product, i.shoe_size)} x${i.quantity}`).join(" + ");
      product = cartItems[cartItems.length - 1]?.product || product;
      
      console.log(`🔥 Carrito después de agregar: ${JSON.stringify(cartItems)}`);
    }

    if (!hasProductsToAdd && wantsAddMore && product && !orderData.quantity) {
      orderData.quantity = 1;
      const totalForOne = calculateTotal(product, 1, fullTraining);
      if (totalForOne) orderData.total_amount = totalForOne;
    }

    const shouldTouchCart =
      !!product &&
      !hasProductsToAdd &&
      safeQuantity(orderData.quantity) > 0 &&
      !asksPriceNow &&
      (isBuyIntent(texto) || wantsAddMore || isPureQuantityReply || isPureShoeSizeReply || safeQuantity(extracted.quantity) > 0);

    if (shouldTouchCart && !wantsAddMore) {
      const itemTotal = calculateTotal(product, safeQuantity(orderData.quantity), fullTraining) || Number(orderData.total_amount || 0);

      cartItems = addOrReplaceCartItem(
        cartItems,
        product,
        safeQuantity(orderData.quantity),
        itemTotal,
        "replace",
        orderData.shoe_size || ""
      );
    }

    orderData.items = cartItems;
    if (cartItems.length) {
      orderData.total_amount = cartGrandTotal(cartItems);
    }

    if (orderData.shoe_size) {
      const preservedShoeProduct = isShoeProductText(orderData.product || "") ? orderData.product : getDefaultShoeProductName();
      const shoeQty = safeQuantity(orderData.quantity) || safeQuantity(oldOrder?.quantity) || 1;
      const shoeTotal = calculateTotal(preservedShoeProduct, shoeQty, fullTraining) || 159000 * shoeQty;
      orderData.product = preservedShoeProduct;
      product = preservedShoeProduct;
      orderData.quantity = shoeQty;
      orderData.total_amount = shoeTotal;
      orderData.items = [{ product: preservedShoeProduct, quantity: shoeQty, total: shoeTotal, shoe_size: orderData.shoe_size }];
    }

    const finalTipoCobertura = getTipoCobertura(orderData.city) || effectivePreviousTipoCobertura || "";
    const step = nextStep(orderData, finalTipoCobertura);

    if (orderData.shoe_size && orderData.product && orderData.quantity === 1 && !orderData.city) {
      const totalForShoe = calculateTotal(orderData.product, 1, fullTraining);
      if (totalForShoe) orderData.total_amount = totalForShoe;

      await safeUpsertOrder(user_id, fromNumber, orderData, false);

      return res.json({
        response: `🔥 Perfecto 😊

Tu pedido queda así:

📦 ${formatProductWithShoeSize(orderData.product, orderData.shoe_size)}
🔢 Cantidad: 1
💰 Total: ${formatGs(orderData.total_amount)} Gs

🚚 Envío GRATIS

¿Para qué ciudad sería el envío?`,
        context: {
          ...(context || {}),
          current_product: orderData.product || context?.current_product || null,
          step: "collecting_city",
          tipo_cobertura: finalTipoCobertura || null,
          order_data: orderData,
          last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    const casualReply = isCasualReply(texto);
    const wantsToBuy = !casualReply && isBuyIntent(texto);
    const asksPrice = isPriceIntent(texto);
    const hasOrderData = !!extracted.quantity || !!extracted.city || !!extracted.name || !!extracted.phone || !!extracted.address;
    const canPersistDraft = hasMinimumOrderDataToPersist(orderData) && !casualReply;
    const canConfirmOrder = hasRealCustomerData(orderData, finalTipoCobertura);
    const shouldCollect =
      canPersistDraft &&
      (wantsToBuy ||
        hasOrderData ||
        effectivePreviousStep.startsWith("collecting") ||
        effectivePreviousStep === "esperando_cantidad" ||
        effectivePreviousStep === "waiting_payment_proof" ||
        isPureQuantityReply ||
        isPureShoeSizeReply);
    const isConfirming = canConfirmOrder && step === "confirm_order" && wantsToBuy && !wantsAddMore;

    if (casualReply) {
      return res.json({
        response: `😊 Gracias. Para agendar tu pedido, pasame TODO JUNTO en un solo mensaje:

✅ nombre y apellido
✅ dirección exacta o ubicación por Google Maps
✅ número de celular

Así lo dejamos listo para envío 🚚✨`,
        context: {
          ...(context || {}),
          current_product: orderData.product || context?.current_product || null,
          step: effectivePreviousStep || step || "selling",
          tipo_cobertura: finalTipoCobertura || previousTipoCobertura || null,
          order_data: {
            ...orderData,
            customer_name: hasFullCustomerName(orderData.customer_name) ? orderData.customer_name : "",
          },
          last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (wantsAddMore && (product || hasProductsToAdd) && orderData.items?.length) {
      await safeUpsertOrder(user_id, fromNumber, orderData, false);

      return res.json({
        response: buildAddedItemResponse(orderData, finalTipoCobertura),
        context: {
          ...(context || {}),
          current_product: orderData.product || product || context?.current_product || null,
          step: nextStep(orderData, finalTipoCobertura),
          tipo_cobertura: finalTipoCobertura || null,
          order_data: orderData,
          last_topic: orderData.product || product || context?.last_topic || "ENTRENAMIENTO",
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (isPackReferenceText(texto) && orderData.quantity > 0 && orderData.product && (effectivePreviousStep === "collecting_quantity" || effectivePreviousStep === "esperando_cantidad")) {
      const exactTotal = calculateTotal(orderData.product, 1, fullTraining);
      orderData.quantity = 1;
      if (exactTotal) orderData.total_amount = exactTotal;
      orderData.items = addOrReplaceCartItem([], orderData.product, 1, orderData.total_amount, "replace");

      await safeUpsertOrder(user_id, fromNumber, orderData, false);

      return res.json({
        response: buildOrderSummaryResponse(orderData, finalTipoCobertura),
        context: {
          ...(context || {}),
          current_product: orderData.product || context?.current_product || null,
          step: nextStep(orderData, finalTipoCobertura),
          tipo_cobertura: finalTipoCobertura || null,
          order_data: orderData,
          last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (isPureQuantityReply && orderData.quantity > 0 && orderData.product && orderData.city) {
      orderData.quantity = safeDirectOrderQuantity(orderData.quantity) || 1;
      const exactTotal = calculateTotal(orderData.product, orderData.quantity, fullTraining);
      if (exactTotal) orderData.total_amount = exactTotal;
      orderData.items = addOrReplaceCartItem([], orderData.product, orderData.quantity, orderData.total_amount, "replace", orderData.shoe_size || "");

      await safeUpsertOrder(user_id, fromNumber, orderData, false);

      return res.json({
        response: buildOrderSummaryResponse(orderData, finalTipoCobertura),
        context: {
          ...(context || {}),
          current_product: orderData.product || context?.current_product || null,
          step: nextStep(orderData, finalTipoCobertura),
          tipo_cobertura: finalTipoCobertura || null,
          order_data: orderData,
          last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    const invalidCustomerName = !!orderData.customer_name && !hasFullCustomerName(orderData.customer_name);
    if (invalidCustomerName) orderData.customer_name = "";

    if (orderData.product && orderData.city && orderData.quantity && orderData.total_amount && !orderData.customer_name && step === "collecting_name") {
      await safeUpsertOrder(user_id, fromNumber, orderData, false);

      return res.json({
        response: `Perfecto 😊 ya tengo:

📦 ${formatProductWithShoeSize(orderData.product, orderData.shoe_size)}
🔢 Cantidad: ${orderData.quantity}
📍 Ciudad: ${orderData.city}
💰 Total: ${formatGs(orderData.total_amount)} Gs

Ahora pasame tu nombre y apellido para agendar el pedido 🙏`,
        context: {
          ...(context || {}),
          current_product: orderData.product || context?.current_product || null,
          step: "collecting_name",
          tipo_cobertura: finalTipoCobertura || null,
          order_data: { ...orderData, customer_name: "" },
          last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }

    if (shouldCollect) {
      await safeUpsertOrder(user_id, fromNumber, orderData, isConfirming);
    }

    const justAnsweredQuantity = !!orderData.product && !!orderData.city && !!orderData.quantity && !!orderData.total_amount && (isPureQuantityReply || effectivePreviousStep === "collecting_quantity" || effectivePreviousStep === "esperando_cantidad") && step !== "confirm_order" && finalTipoCobertura !== "sin_cobertura";

    if (justAnsweredQuantity) {
      const deterministicResponse = buildOrderSummaryResponse(orderData, finalTipoCobertura);
      const deterministicContext = {
        ...(context || {}),
        current_product: orderData.product || context?.current_product || null,
        step,
        tipo_cobertura: finalTipoCobertura || null,
        order_data: orderData,
        last_topic: orderData.product || context?.last_topic || "ENTRENAMIENTO",
        updated_at: new Date().toISOString(),
      };

      return res.json({
        response: deterministicResponse,
        context: deterministicContext,
        is_payment_proof: false,
      });
    }

    let cleanHistory = Array.isArray(history) ? history : [];
    if (isPureQuantityReply || isPureShoeSizeReply) cleanHistory = [];

    const system = `
Sos el asistente de ventas de Mega Todo Store. Respondé SIEMPRE siguiendo el entrenamiento oficial del usuario.
NO inventes precios si no hay precio visible ni precio en entrenamiento.
NO muestres variables internas.

═══════════════════════════════════
ENTRENAMIENTO OFICIAL DEL USUARIO:
═══════════════════════════════════
${fullTraining}
═══════════════════════════════════

ESTADO ACTUAL DEL CLIENTE:
- Producto activo: ${orderData.product || "ninguno"}
- Cantidad producto activo: ${orderData.quantity || "pendiente"}
- Calce/talle: ${orderData.shoe_size || "pendiente"}
- Carrito: ${getCartItems(orderData).length ? buildItemsLines(getCartItems(orderData)) : "vacío"}
- Total calculado: ${orderData.total_amount ? formatGs(orderData.total_amount) + " Gs" : "pendiente"}
- Ciudad: ${orderData.city || "pendiente"}
- Tipo de cobertura: ${finalTipoCobertura || "pendiente"}
- Nombre: ${orderData.customer_name || "pendiente"}
- Teléfono: ${orderData.phone || "pendiente"}
- Dirección: ${orderData.address || "pendiente"}
- Titular esperado para transferencia: ${expectedReceiverName || "pendiente"}
- Paso anterior: ${effectivePreviousStep || "ninguno"}
- Paso actual: ${step}
- Última pregunta del bot: ${lastAssistantMessage || "ninguna"}
- Producto cambió respecto al pedido anterior: ${productChanged ? "SÍ" : "NO"}
- Intención: ${wantsToBuy ? "QUIERE COMPRAR" : asksPrice ? "PREGUNTA PRECIO" : "CONSULTA"}

REGLAS TÉCNICAS (MUY IMPORTANTES):
1. Si el cliente respondió con un número SOLO (ej: "1", "2", "3"), esa es la cantidad EXACTA. NUNCA la concatenes.
2. Si la cantidad es 1, debe ser 1, NO 11, NO 1 unidad, NO nada más.
3. Si el paso actual es collecting_quantity y el cliente responde un número, usá ESE número exacto.
4. Si el paso actual es collecting_name, pedí nombre completo.
5. Si el paso actual es collecting_phone, pedí teléfono.
6. Si el tipo de cobertura es sin_cobertura, NO pidas dirección exacta.
7. Si el tipo de cobertura es sin_cobertura y ya tenés nombre y teléfono, pedí comprobante de transferencia.
8. Si el paso actual es collecting_address, pedí dirección exacta SOLO si tiene cobertura.
9. Si el paso actual es confirm_order, confirmá el pedido con la plantilla del entrenamiento.
10. No repitas saludo si ya hubo conversación.
11. No cambies de producto salvo que el cliente lo pida.
12. Cerrá siempre con el siguiente paso.
13. Catálogo: ${CATALOG_URL}
14. Español paraguayo natural, con emojis.
15. Pedro Juan Caballero / PJC es SIN COBERTURA.
16. Si el cliente dice "también", "tambien", "agrega", "sumá", "y la", "y el", "mas", "más", NO confirmes todavía: agregá el producto al carrito y mostrá el resumen completo.
17. Si hay varios productos, mostrá todos los items con subtotales y el total general.
18. Nunca borres items anteriores salvo que el cliente pida cancelar o cambiar.
19. Si el cliente inicia con otro producto nuevo y NO dice también/agrega/sumá, empezá pedido nuevo y no arrastres carrito viejo.
20. Si el cliente responde "Kit x 4 unidades", "x4" o "las 4 unidades", significa 1 kit, no 4 kits.
21. Si preguntaste "qué calce" o "qué talle" y el cliente responde solo "35", "36", "37", etc., eso es CALCE/TALLE, NO cantidad. Cantidad = 1.
22. Si el cliente dice "QUIERO CALCE 37", "talle 42" o "número 39", ese número es CALCE/TALLE, no cantidad. La cantidad debe ser 1.
23. Para "Veneno de Abeja" o "Crema de Abeja", la PROMO 2 unidades cuesta 249.900 Gs (NO 290.000 Gs).
24. Cuando el cliente dice "TAMBIEN QUIERO UN PELADOR DE PAPAS" o "MAS EL VENENO DE ABEJA", debe AGREGAR ese producto al carrito existente, NO reemplazar.
25. "Pelador de papas", "peladora de papas", "pelador automático" = "Peladora Automática" con precio 189.900 Gs.
26. Si el cliente dice solo "gracias", "muy lindo", "hermoso", "genial" o un cumplido, NO confirmes venta, NO lo uses como nombre y pedí los datos completos.
27. Solo se puede confirmar/agendar pedido cuando haya nombre y apellido reales, teléfono y dirección/ubicación si tiene cobertura.
`.trim();

    const contents = cleanHistory.slice(-8).filter((h: any) => clean(h?.content)).map((h: any) => ({
      role: h.role === "assistant" ? "model" : "user",
      parts: [{ text: clean(h.content) }],
    }));

    const currentUserText = isPureShoeSizeReply
      ? `El cliente respondió EXACTAMENTE "${texto}" que es el CALCE/TALLE ${orderData.shoe_size}. NO es cantidad. La cantidad debe ser 1 par.`
      : isPureQuantityReply
      ? `El cliente respondió EXACTAMENTE "${texto}" que es la cantidad ${orderData.quantity}. NO es 11 ni ninguna otra concatenación. Usá ESA cantidad exacta.`
      : wantsAddMore
      ? `El cliente quiere AGREGAR más productos al carrito. Texto: "${texto}". Detecta el producto adicional y responde mostrando el resumen actualizado del carrito.`
      : texto;

    contents.push({
      role: "user",
      parts: [{ text: currentUserText }],
    });

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
        apiKey,
        model,
        system,
        contents,
        temperature: 0.3,
        maxTokens: 3072,
      });
    }

    const newContext = {
      ...(context || {}),
      current_product: orderData.product || context?.current_product || null,
      step: shouldCollect ? step : effectivePreviousStep === "payment_verified" ? "payment_verified" : "selling",
      tipo_cobertura: finalTipoCobertura || null,
      order_data: orderData,
      last_topic: effectivePreviousStep === "payment_verified" ? "payment_verified" : step === "waiting_payment_proof" ? "comprobante" : orderData.product || context?.last_topic || "ENTRENAMIENTO",
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
