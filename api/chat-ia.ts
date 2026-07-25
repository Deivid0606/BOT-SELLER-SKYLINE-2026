import { createClient } from "@supabase/supabase-js";

/**
 * V126: clasificación estricta de nombre, ciudad y referencia; reconoce ciudades con ruta/km/barrio, bloquea frases conversacionales como nombres y trata la ubicación postergada como opcional.
 * V125: si falta un nombre real, el comprobante válido usa el nombre del pagador como cliente; bloquea nombres que sean productos y evita prometer transportadoras no autorizadas.
 * CHAT IA VENDEDOR AUTÓNOMO V115 - Mega Todo Store / One Store
 * 
 * V121: evita interpretar errores de escritura de "precio" como ciudades; Gemini mantiene toda respuesta normal.
 * V124: confirmaciones numéricas de precio nunca se guardan como dirección ni completan el pedido.
 * V122: preguntas sobre entrega/horario las responde Gemini desde el entrenamiento, sin mensaje fijo ni loop.
 * V116: TODA respuesta visible la redacta Gemini, excepto cierres, comprobantes y detección automática del celular.
 * V114: conserva la cantidad elegida antes de la ciudad y evita usar titulares publicitarios como nombre del producto.
 * V118: todas las respuestas normales las redacta Gemini; solo cierre, comprobantes y detección del celular permanecen fijos.
 * V118: evita confundir frases conversacionales como “si no estoy en casa” con una dirección y no repite el cierre al guardar observaciones.
 * V113: preserva cantidades al cambiar/confirmar ciudad, evita guardar 1 unidad por defecto y responde el catálogo en postventa.
 * V120: devuelve obligatoriamente el resultado visible del análisis del comprobante antes de continuar el flujo.
 * V119 histórico reemplazado por V125: el pagador completa el nombre solo cuando todavía no existe un nombre válido del cliente.
 * V118: conserva comprobantes aunque cambie el order_id interno, nunca exige dirección para transportadora y fuerza el cierre fijo correcto.
 * V112: detecta ciudades en frases con errores como “Yo estoi en Caacupe”, bloquea nombres y direcciones contaminadas.
 * V110: confirma comprobantes pendientes para revisión manual cuando destinatario y monto son válidos.
 * V109: impide usar ciudades como nombre del cliente.
 * V108 histórico: valida destinatario bancario y admite PDF sin texto de estado; V125 usa el pagador como cliente únicamente si falta un nombre válido.
 * V107: verifica titular, monto y estado del comprobante antes de confirmar pagos anticipados.
 * V106: conserva el precio total del pack fijo y evita multiplicarlo por la cantidad.
 * V105: detecta ofertas únicas de varias unidades como pack fijo y no pregunta cantidad.
 * V104: respeta ubicación opcional y sincroniza cantidad/promoción antes de confirmar.
 * V103: después de recibir la ciudad muestra promociones y exige cantidad antes del nombre.
 * V102: evita que una cantidad elegida se borre cuando luego llega el nombre.
 * V101: exige cantidad explícita salvo pack fijo y valida nombre + apellido reales.
 * V99: respeta dinámicamente si la dirección/ubicación es opcional según el entrenamiento del usuario.
 *
 * V100: evita heredar productos/cantidades de chats viejos y vuelve a pedir cantidad en cada venta nueva.
 *
 * V99: permite dirección opcional según el entrenamiento de cada usuario.
 *
 * V98: acepta cantidad + ciudad + nombre en un mismo mensaje y evita respuestas genéricas por errores parciales.
 *
 * V97: corrige consultas de factura, evita guardarlas como observación y protege
 * cobertura/envío para no confundir el precio del producto con el costo del delivery.
 *
 * V96: lee y aplica todos los entrenamientos activos por usuario (reglas, cobertura y banco).
 *
 * V60 COMPLETA: integra correcciones de precio, cobertura, fechas, direcciones y carrito multiproducto.
 *
 * Mantiene el fix que evita repetir el copy cuando el cliente
 * pregunta "precio" después de ya haber visto el producto.
 * 
 * Soluciona:
 * - Cliente: "Hola. ¿Precio de las plantillas porfa?" → Muestra copy completo
 * - Cliente: "precio" → ✅ SOLO muestra precio + avanza (NO repite copy)
 * - Cliente: "precio porfa" → ✅ SOLO muestra precio + avanza (NO repite copy)
 * 
 * ✔️ Funciona con TODOS los productos del catálogo
 * ✔️ Detecta si el copy ya fue enviado en la conversación
 * ✔️ No se queda en bucle
 * ✔️ Venta fluida y natural
 */

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const clean = (v: any) => String(v || "").trim();

const normalize = (v: any) =>
  clean(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ñ/g, "n")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type ProductItem = {
  product: string;
  canonical: string;
  aliases: string[];
  price1: number;
  price2?: number;
  price3?: number;
  fixedPackQuantity?: number;
  salesCopy?: string;
  images?: string[];
  palabra_clave?: string;
};

type OfferItem = {
  product: string;
  quantity: number;
  total: number;
  label?: string;
  source?: "template" | "catalog" | "context";
  fixed_quantity?: boolean;
};

type TemplatePricing = {
  product: string;
  price1?: number;
  offers: OfferItem[];
  raw?: string;
  fixed_quantity?: boolean;
};

type BankData = {
  titular?: string;
  ci?: string;
  entidad?: string;
  banco?: string;
  cuenta?: string;
  alias?: string;
  raw?: string;
};

type TrainingSections = {
  general: string;
  coverage: string;
  banking: string;
  combined: string;
  totalItems: number;
  generalItems: number;
  coverageItems: number;
  bankingItems: number;
};

type ParsedTraining = {
  products: ProductItem[];
  cities: { alias: string; canonical: string; covered: boolean }[];
  catalogUrl: string;
  bankData: BankData | null;

  // Texto completo combinado. Se conserva para compatibilidad del parser.
  raw: string;

  // Entrenamientos separados del usuario actual.
  // generalTraining se envía a Gemini y puede contener uno o muchos registros.
  generalTraining: string;
  coverageTraining: string;
  bankingTraining: string;

  trainingStats: {
    totalItems: number;
    generalItems: number;
    coverageItems: number;
    bankingItems: number;
  };
};

type OrderData = {
  order_id?: string;
  product: string;
  quantity: number;
  city: string;
  customer_name: string;
  address: string;
  phone: string;
  locked_offer?: OfferItem | null;
  payment_proof_received?: boolean;
  payment_proof_verified?: boolean;
  payment_holder_name?: string;
  payment_amount?: number;
  payment_operation_number?: string;
  payment_status_text?: string;
  payment_verification_error?: string;
  payment_recipient_name?: string;
  payment_recipient_document?: string;
  payment_recipient_account?: string;
  payment_recipient_alias?: string;
  payment_recipient_bank?: string;
  payment_recipient_matched?: boolean;
  payment_proof_mime?: string;
  payment_manual_review_required?: boolean;
  payment_manual_review_reason?: string;
  observation?: string;
  preferred_delivery_date?: string;
  preferred_delivery_time?: string;
  payment_note?: string;
};

type ConversationState = {
  order: OrderData;
  step: string;
  productInfo: ProductItem | null;
  coverage: boolean | null;
  total: number;
  missing: string[];
  hardInstruction: string;
  // Se calcula desde el entrenamiento general del usuario.
  addressOptional: boolean;
};

function encontrarProductoPorPalabraClave(mensaje: string, products: ProductItem[]): ProductItem | null {
  if (!products || products.length === 0) return null;

  const msg = normalize(mensaje);
  if (!msg) return null;

  let best: ProductItem | null = null;
  let bestScore = 0;

  for (const producto of products) {
    const candidates = [
      producto.palabra_clave || "",
      producto.product || "",
      producto.canonical || "",
      ...(producto.aliases || []),
    ]
      .flatMap((x) => splitKeywordAliases(x))
      .map(normalize)
      .filter((x) => x.length >= 3 && !isGenericProductWord(x));

    for (const c of Array.from(new Set(candidates))) {
      let score = 0;
      if (msg === c) score = 1000;
      else if (msg.includes(c)) score = 800 + c.length;
      else if (c.includes(msg) && msg.length >= 4) score = 500 + msg.length;

      if (score > bestScore) {
        bestScore = score;
        best = producto;
      }
    }
  }

  return bestScore >= 500 ? best : null;
}

function makeOrderId(fromNumber: string) {
  const safeFrom = clean(fromNumber).replace(/\D/g, "").slice(-8) || "chat";
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${Date.now()}-${safeFrom}-${rand}`;
}

function emptyOrder(orderId?: string): OrderData {
  return {
    order_id: orderId || "",
    product: "",
    quantity: 0,
    city: "",
    customer_name: "",
    address: "",
    phone: "",
    locked_offer: null,
    payment_proof_received: false,
    payment_proof_verified: false,
    payment_holder_name: "",
    payment_amount: 0,
    payment_operation_number: "",
    payment_status_text: "",
    payment_verification_error: "",
    payment_recipient_name: "",
    payment_recipient_document: "",
    payment_recipient_account: "",
    payment_recipient_alias: "",
    payment_recipient_bank: "",
    payment_recipient_matched: false,
    payment_proof_mime: "",
    payment_manual_review_required: false,
    payment_manual_review_reason: "",
    observation: "",
    preferred_delivery_date: "",
    preferred_delivery_time: "",
    payment_note: "",
  };
}

function sanitizeQuantity(q: any) {
  const n = Number(q);
  if (!Number.isFinite(n)) return 0;
  if (n < 1) return 0;
  if (n > 100) return 100;
  return n;
}

function formatGs(n: number) {
  return Number(n || 0).toLocaleString("es-PY");
}

function parseNumberGs(raw: string) {
  return Number(clean(raw).replace(/[^\d]/g, "") || 0);
}

function isPriceQuery(text: string) {
  const m = normalize(text);
  if (!m) return false;

  // Preguntas técnicas como "cuánto es el tiempo de cocción" no son precio.
  const technicalQuestion =
    /\b(tiempo|coccion|duracion|minutos?|horas?|agua|cantidad de agua|temperatura|medida|capacidad|funciona|usar|uso|modo)\b/.test(m);

  // V121: reconoce errores frecuentes al escribir "precio" para impedir que
  // mensajes como "presio" se interpreten como ciudad, nombre o dirección.
  const explicitPriceWord =
    /\b(precio|presio|presyo|prezio|preio|prcio|pecio|prescio|precios|presios|valor|costo|cuesta|cuestan|sale|vale)\b/.test(m);

  const explicitPricePhrase =
    /\b(cuanto cuesta|cuanto sale|cuanto vale|cual es el precio|que precio|precio porfa|precio por favor|presio porfa|presio por favor|prezio porfa|prezio por favor)\b/.test(m);

  // V123: también reconoce confirmaciones numéricas del precio aunque el
  // cliente no escriba la palabra “precio”. Ejemplos:
  // “Ya 98000 los 4 verdad”, “159.000 por 8, cierto?”, “son 98 mil no?”.
  const numericPriceConfirmation =
    /(?:^|\b)(?:\d{1,3}(?:[.\s]\d{3})+|\d{4,7}|\d{2,3}\s*mil)(?:\b|$)/.test(m) &&
    /\b(verdad|cierto|correcto|asi es|es asi|no|nomás|nomas|por|los|las|unidad|unidades|u|gs|guaranies|guaraníes)\b/.test(m);

  if (technicalQuestion && !explicitPriceWord && !explicitPricePhrase && !numericPriceConfirmation) return false;

  return explicitPriceWord || explicitPricePhrase || numericPriceConfirmation;
}

function isBuyIntent(text: string) {
  const m = normalize(text);
  return /\b(si|sí|quiero|llevo|comprar|compro|reservar|reserva|agendar|agendame|confirmo|confirmar|ok|dale|listo|me interesa|lo quiero|quiero ese|quiero eso|ese quiero)\b/.test(m);
}

function isGenericBuyReply(text: string) {
  const m = normalize(text);
  if (!m) return false;

  const exact = [
    "quiero", "si", "sí", "si quiero", "lo quiero", "quiero comprar",
    "quiero llevar", "me interesa", "comprar", "compro", "dale",
    "ok", "listo", "confirmo", "reservar", "reservame", "agendar",
    "agendame", "quiero ese", "quiero eso", "ese quiero", "ese",
  ];

  if (exact.includes(m)) return true;

  return /^(si\s+)?(quiero|lo quiero|me interesa|comprar|compro|dale|ok|listo|confirmo|ese quiero|quiero ese|quiero eso)$/.test(m);
}

function isAffirmative(text: string) {
  const m = normalize(text);
  return /^(si|sí|sii|siii|ok|dale|listo|correcto|asi es|así es|confirmo|exacto|eso|ese|quiero)$/.test(m);
}

function hasExplicitQuantity(text: string) {
  return extractQuantity(text) > 0;
}

async function getAllTrainingData(userId: string) {
  const { data, error } = await supabase
    .from("training_data")
    .select("id, intent, examples, response, is_active, image_urls, products, entrenamiento_completo")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("❌ training_data:", error);
    return [];
  }

  return data || [];
}

function getTrainingBody(item: any): string {
  return (
    clean(item?.entrenamiento_completo) ||
    clean(item?.response) ||
    ""
  );
}

function trainingItemText(item: any): string {
  const intent = clean(item?.intent || "");
  const examples = Array.isArray(item?.examples)
    ? item.examples.map(clean).filter(Boolean).join("\n")
    : "";
  const body = getTrainingBody(item);

  return [
    intent ? `TEMA / CATEGORÍA: ${intent}` : "",
    examples ? `FRASES DE EJEMPLO:\n${examples}` : "",
    body ? `ENTRENAMIENTO COMPLETO:\n${body}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function classifyTrainingItem(item: any): "general" | "coverage" | "banking" {
  const intent = normalize(item?.intent || "");
  const body = normalize(getTrainingBody(item));

  // Primero datos bancarios para que una frase como "sin cobertura se paga por
  // transferencia" dentro de las reglas generales no clasifique mal la tarjeta.
  const bankingByTitle =
    /\b(informacion bancaria|datos bancarios|datos para transferencia|datos de transferencia|cuenta bancaria)\b/.test(intent);
  const bankingByStructure =
    /\b(titular|beneficiario)\b/.test(body) &&
    /\b(cuenta|nro de cuenta|numero de cuenta|alias)\b/.test(body) &&
    /\b(banco|entidad)\b/.test(body);

  if (bankingByTitle || bankingByStructure) return "banking";

  const coverageByTitle =
    /\b(zona|zonas|ciudad|ciudades)\b/.test(intent) &&
    /\bcobertura\b/.test(intent);
  const coverageByHeader =
    /\b(zonas? con cobertura|zonas? de cobertura|lista completa por ciudad)\b/.test(body);

  if (coverageByTitle || coverageByHeader) return "coverage";

  // Todo registro activo que no sea banco ni cobertura se considera una regla
  // general. Así el usuario puede tener 1, 3, 10 o más entrenamientos separados.
  return "general";
}

function buildTrainingSections(items: any[]): TrainingSections {
  const generalParts: string[] = [];
  const coverageParts: string[] = [];
  const bankingParts: string[] = [];

  for (const item of items || []) {
    const fullText = trainingItemText(item);

    // Las tarjetas que contienen exclusivamente productos pueden no tener texto.
    // Sus productos se siguen leyendo desde productsFromVisualCatalog().
    if (!fullText) continue;

    const category = classifyTrainingItem(item);
    if (category === "banking") bankingParts.push(fullText);
    else if (category === "coverage") coverageParts.push(fullText);
    else generalParts.push(fullText);
  }

  const joinAll = (parts: string[]) =>
    parts
      .filter(Boolean)
      .join("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n")
      .trim();

  const general = joinAll(generalParts);
  const coverage = joinAll(coverageParts);
  const banking = joinAll(bankingParts);

  // El parser recibe las tres secciones. Gemini recibe generalTraining por
  // separado para aplicar TODAS las reglas comerciales del usuario.
  const combined = [general, coverage, banking]
    .filter(Boolean)
    .join("\n\n---\n\n")
    .trim();

  return {
    general,
    coverage,
    banking,
    combined,
    totalItems: (items || []).length,
    generalItems: generalParts.length,
    coverageItems: coverageParts.length,
    bankingItems: bankingParts.length,
  };
}

// Compatibilidad con cualquier llamada antigua dentro del proyecto.
function buildTrainingText(items: any[]) {
  return buildTrainingSections(items).combined;
}

function normalizeProductImages(input: any): string[] {
  const rawImages: any[] = [];

  if (Array.isArray(input?.images)) rawImages.push(...input.images);
  if (Array.isArray(input?.image_urls)) rawImages.push(...input.image_urls);
  if (Array.isArray(input?.imagenes)) rawImages.push(...input.imagenes);
  if (Array.isArray(input?.media_urls)) rawImages.push(...input.media_urls);

  if (typeof input?.image === "string") rawImages.push(input.image);
  if (typeof input?.image_url === "string") rawImages.push(input.image_url);
  if (typeof input?.imagen === "string") rawImages.push(input.imagen);

  return Array.from(
    new Set(
      rawImages
        .map((u) => clean(u))
        .filter((u) => /^https?:\/\//i.test(u))
    )
  ).slice(0, 3);
}

function attachProductImages(products: ProductItem[], rawItems: any[]) {
  for (const item of rawItems) {
    const urls = normalizeProductImages({ image_urls: item?.image_urls });
    if (!urls.length) continue;

    const rowText = normalize(
      `${item?.intent || ""}\n${Array.isArray(item?.examples) ? item.examples.join("\n") : ""}\n${item?.response || ""}`
    );
    if (!rowText) continue;

    for (const product of products) {
      if (product.images?.length) continue;
      const names = [product.canonical, product.product, ...product.aliases]
        .map(normalize)
        .filter((n) => n.length >= 4);
      if (names.some((n) => rowText.includes(n))) {
        product.images = urls;
      }
    }
  }
}

function splitKeywordAliases(value: any): string[] {
  return clean(value)
    .split(/[,:;|\/\\]+/g)
    .map(clean)
    .filter(Boolean);
}

function isGenericProductLabel(value: any): boolean {
  const n = normalize(value);
  if (!n) return true;
  return (
    isGenericMarketingPhrase(n) ||
    /^(oferta(?: de)? hoy|precio de hoy|promo(?:cion)?|promocion|promocion especial|promoción especial|plumero promocion especial|plumero promoción especial|usalas con|usala con|usalo con|usas con|producto|articulo|item|stock limitado|quedan pocos|llevate \d+|\d+ por \d+)$/.test(n)
  );
}

function visualProductNameFromKeyword(keyword: string, copy: string, aliases: string[]) {
  // V65: el nombre del producto nunca puede salir de una línea comercial
  // como “Oferta HOY”. Primero intentamos recuperar un nombre descriptivo
  // real del copy y luego usamos aliases/palabra clave seguros.
  const fromCopy = extractProductNameFromCopy(copy);
  if (fromCopy && !isGenericProductLabel(fromCopy)) return toTitleCase(fromCopy);

  const aliasParts = aliases
    .flatMap((a) => splitKeywordAliases(a))
    .map(clean)
    .filter((a) => {
      const n = normalize(a);
      return (
        n.length >= 3 &&
        !isGenericProductWord(a) &&
        !isGenericProductLabel(a) &&
        !/^(usa|usas|usala|usalo|usalas|lleva|llevate|aprovecha|aprovechá|compra|comprá|pedi|pedí)\b/.test(n)
      );
    });

  const descriptiveAlias = aliasParts
    .slice()
    .sort((a, b) => normalize(b).length - normalize(a).length)
    .find((a) => normalize(a).split(/\s+/).length >= 2);
  if (descriptiveAlias) return toTitleCase(descriptiveAlias);

  const firstAlias = aliasParts.find(Boolean);
  if (firstAlias) return toTitleCase(firstAlias);

  const firstKeyword = splitKeywordAliases(keyword)
    .find((k) => normalize(k).length >= 3 && !isGenericProductLabel(k)) || keyword;
  return toTitleCase(firstKeyword);
}

function productsFromVisualCatalog(items: any[]): ProductItem[] {
  const result: ProductItem[] = [];
  const seen = new Set<string>();

  for (const item of items || []) {
    const list = Array.isArray(item?.products) ? item.products : [];

    for (const p of list) {
      const keyword = clean(p?.palabra_clave || p?.keyword || "");
      const copy = clean(p?.copy || p?.salesCopy || p?.mensaje || "");
      const productImages = normalizeProductImages(p);

      const aliasFrontend = Array.isArray(p?.alias)
        ? p.alias.map(clean).filter(Boolean)
        : typeof p?.alias === "string"
          ? p.alias.split(",").map(clean).filter(Boolean)
          : [];

      const aliasesBackend = Array.isArray(p?.aliases)
        ? p.aliases.map(clean).filter(Boolean)
        : typeof p?.aliases === "string"
          ? p.aliases.split(",").map(clean).filter(Boolean)
          : [];

      if (!keyword || !copy) continue;

      const keywordParts = splitKeywordAliases(keyword);
      const allAliases = Array.from(new Set([
        keyword,
        ...keywordParts,
        ...aliasFrontend,
        ...aliasesBackend,
      ].map(clean).filter(Boolean)));

      const canonical = visualProductNameFromKeyword(keyword, copy, allAliases);
      const key = normalize(`${canonical}|${keyword}|${productImages.join("|")}`);
      if (seen.has(key)) continue;
      seen.add(key);

      const { offers, fixedQuantity } = parseRawOffers(copy, canonical);
      const sortedOffers = offers.slice().sort((a, b) => a.quantity - b.quantity);
      const price1 = fixedQuantity
        ? (sortedOffers.find((o) => o.fixed_quantity)?.total || sortedOffers[0]?.total || 0)
        : (sortedOffers.find((o) => o.quantity === 1)?.total || sortedOffers[0]?.total || 0);
      const price2 = fixedQuantity ? undefined : sortedOffers.find((o) => o.quantity === 2)?.total;
      const price3 = fixedQuantity ? undefined : sortedOffers.find((o) => o.quantity === 3)?.total;
      const fixedPackQuantity = fixedQuantity
        ? (sortedOffers.find((o) => o.fixed_quantity)?.quantity || sortedOffers[0]?.quantity || undefined)
        : undefined;

      if (price1 < 10000) {
        console.error("❌ Precio inválido en catálogo visual", {
          keyword,
          canonical,
          copy: copy.slice(0, 300),
          offers: sortedOffers,
        });
        continue;
      }

      result.push({
        product: canonical,
        canonical,
        aliases: allAliases,
        price1,
        price2,
        price3,
        fixedPackQuantity,
        salesCopy: copy,
        images: productImages,
        palabra_clave: keyword,
      });
    }
  }

  return result;
}

function normalizeCopyForDedup(copy: string) {
  return normalize(copy).slice(0, 220);
}

function mergeProductsByPriority(primary: ProductItem[], secondary: ProductItem[]) {
  const merged: ProductItem[] = [];
  const seenKeys = new Set<string>();
  const seenCopies: string[] = [];

  const isDuplicateCopy = (copyNorm: string) => {
    if (!copyNorm) return false;
    return seenCopies.some(
      (c) => c && (c === copyNorm || c.includes(copyNorm) || copyNorm.includes(c))
    );
  };

  for (const product of [...primary, ...secondary]) {
    const names = [product.palabra_clave, product.canonical, product.product, ...(product.aliases || [])]
      .flatMap((x) => splitKeywordAliases(x || ""))
      .map(normalize)
      .filter(Boolean);

    const key = names.find((n) => n.length >= 3) || normalize(product.canonical || product.product);
    const copyNorm = normalizeCopyForDedup(product.salesCopy || "");

    if (key && seenKeys.has(key)) continue;
    if (copyNorm.length >= 40 && isDuplicateCopy(copyNorm)) continue;

    if (key) seenKeys.add(key);
    if (copyNorm.length >= 40) seenCopies.push(copyNorm);
    merged.push(product);
  }

  return merged;
}

function parseCatalogUrl(training: string) {
  const explicit =
    training.match(/CATALOGO_URL\s*:\s*(https?:\/\/\S+)/i)?.[1] ||
    training.match(/URL_CATALOGO\s*:\s*(https?:\/\/\S+)/i)?.[1] ||
    training.match(/(?:cat[aá]logo|catalogo).*?(https?:\/\/\S+)/i)?.[1] ||
    "";

  return clean(explicit).replace(/[)\].,;]+$/, "");
}

function parseBankData(training: string): BankData | null {
  const explicitBlock =
    training.match(/(?:^|\n)\s*(?:DATOS_BANCARIOS|DATOS_TRANSFERENCIA|DATOS PARA TRANSFERENCIA|DATOS DE TRANSFERENCIA)\s*:?\s*\n([\s\S]*?)(?=\n\s*(?:FIN_DATOS_BANCARIOS|FIN_DATOS_TRANSFERENCIA|CATALOGO_PRODUCTOS|LISTA COMPLETA POR CIUDAD|ZONAS CON COBERTURA|ZONAS SIN COBERTURA|---)|$)/i)?.[1] || "";

  const raw = clean(explicitBlock || training);
  if (!raw) return null;

  const dangerousValue = (v: string) => {
    const n = normalize(v);
    return (
      !v ||
      v.length > 120 ||
      v.includes("→") ||
      /\b(ciudad del este|cde|cdad del este|zona|zonas|cobertura|asuncion|asunción|san lorenzo|luque|chaco)\b/.test(n)
    );
  };

  const lines = raw
    .split(/\r?\n/g)
    .map((line) => clean(line.replace(/^[^a-zA-ZÁÉÍÓÚáéíóúÑñ0-9#°Nn]+/, "")))
    .filter(Boolean);

  const getLine = (patterns: RegExp[], validator?: (v: string) => string) => {
    for (const line of lines) {
      for (const pattern of patterns) {
        const m = line.match(pattern);
        if (!m?.[1]) continue;
        const value = clean(m[1]);
        const finalValue = validator ? validator(value) : value;
        if (finalValue && !dangerousValue(finalValue)) return finalValue;
      }
    }
    return "";
  };

  const onlyDigitsValue = (v: string) => {
    const m = clean(v).match(/\d[\d.\-\s]{3,}/);
    return m ? clean(m[0]) : "";
  };

  const normalBankValue = (v: string) => {
    const value = clean(v).replace(/\s+/g, " ");
    return dangerousValue(value) ? "" : value;
  };

  const titular = getLine([/^Titular\s*[:\-]\s*(.+)$/i], normalBankValue);
  const ci = getLine([/^(?:CI|Cédula|Cedula)\s*[:\-]\s*(.+)$/i], onlyDigitsValue);
  const entidad = getLine([/^Entidad\s*[:\-]\s*(.+)$/i], normalBankValue);
  const banco = getLine([/^Banco\s*[:\-]\s*(.+)$/i], normalBankValue);
  let cuenta = getLine([
    /^(?:N[°ºo]?\s*de\s*cuenta|Nro\.?\s*de\s*cuenta|Numero\s*de\s*cuenta|Número\s*de\s*cuenta|Cuenta)\s*[:\-]\s*(.+)$/i,
  ], normalBankValue);
  const alias = getLine([/^Alias\s*[:\-]\s*(.+)$/i], normalBankValue);

  if (cuenta && banco && normalize(cuenta).startsWith(normalize(banco))) {
    const safeBank = banco.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cuenta = clean(cuenta.replace(new RegExp(`^${safeBank}\\s*:?\\s*`, "i"), ""));
  }

  const parsed: BankData = { titular, ci, entidad, banco, cuenta, alias, raw: explicitBlock ? clean(explicitBlock) : "" };
  const hasUsefulData = !!(parsed.titular || parsed.ci || parsed.entidad || parsed.banco || parsed.cuenta || parsed.alias);
  return hasUsefulData ? parsed : null;
}

function isGenericMarketingPhrase(normCanonical: string) {
  const words = normCanonical.split(" ").filter(Boolean);
  const genericWords = new Set([
    "oferta", "ofertas", "promo", "promos", "promocion", "promoción",
    "descuento", "descuentos", "gratis", "hoy", "ahora", "antes",
    "stock", "limitado", "limitada", "envio", "envío", "delivery",
    "pagas", "pagás", "recibir", "unidad", "unidades", "solo",
    "solamente", "precio", "precios", "valido", "válido", "valida", "válida",
  ]);
  return words.length > 0 && words.every((w) => genericWords.has(w));
}

function extractProductNameFromCopy(text: string): string {
  const raw = clean(text);
  if (!raw) return "";

  const accept = (value: any) => {
    const candidate = clean(value).replace(/^[^a-zA-ZÁÉÍÓÚáéíóúÑñ0-9]+/, "").replace(/[.,:;!?]+$/, "");
    if (!candidate || isGenericProductLabel(candidate)) return "";
    const candidateNorm = normalize(candidate);

    // V114: un gancho publicitario o una pregunta no puede convertirse en el
    // nombre del producto. Ej.: “¿TU CUCHILLO NO CORTA NI MANTECA?” debe
    // resolverse luego como “Afilador Alemán”, no guardarse como producto.
    const looksLikeAdvertisingHook =
      /[?¿]/.test(clean(value)) ||
      /^(tu|tus|su|sus|el|la)\s+.+\b(no|nunca|todavia|todavía|ya no)\b/.test(candidateNorm) ||
      /\b(no corta|no funciona|estas cansado|estás cansado|te cuesta|problema|sufris|sufrís|perdes|perdés tiempo)\b/.test(candidateNorm);

    if (
      looksLikeAdvertisingHook ||
      /^(olvidate|olvídate|recupera|recuperá|aprovecha|aprovechá|cocina|cociná|respira|respirá|camina|caminá|deja|dejá)\b/.test(candidateNorm)
    ) {
      return "";
    }
    const words = candidate.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 10) return "";
    return toTitleCase(candidate);
  };

  // Ej.: “Con el Procesador de Alimentos Premium RAF PRO® preparás...”
  const introPatterns = [
    /\bcon\s+(?:el|la|los|las)\s+(.{3,100}?)(?=\s+(?:preparas|preparás|podes|podés|vas a|te permite|permite|ideal para|logras|lográs|conseguis|conseguís)\b)/i,
    /\b(?:este|esta|el|la)\s+(.{3,90}?)(?=\s+(?:sirve|ayuda|permite|es ideal|cuenta con|tiene)\b)/i,
    /^\s*([^\n]{3,90}?)(?:\s*[–—-]\s*|\n)/,
  ];
  for (const pattern of introPatterns) {
    const candidate = accept(raw.match(pattern)?.[1]);
    if (candidate) return candidate;
  }

  const simpleQtyName = raw.match(/^\s*\d+\s+([A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñÑ]{2,30})s?\s*:\s*(?:Gs\.?|₲)?\s*\d/im);
  const simpleCandidate = accept(simpleQtyName?.[1]);
  if (simpleCandidate) return simpleCandidate;

  const afterQty = raw.match(
    /\b\d+\s+((?:[A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]*\s*){1,5})\s*(?:por|a|solo|solamente)\s+(?:solo\s+)?(?:[Gg][Ss]\.?)?\s*\d/
  );
  const qtyCandidate = accept(afterQty?.[1]);
  if (qtyCandidate) return qtyCandidate;

  const lines = raw.split(/\n|[!?.]\s+/).map(clean).filter(Boolean);
  for (const line of lines) {
    if (/\b(oferta|promo|precio|antes|hoy|stock|quedan|llevate|llevá|gs)\b/i.test(normalize(line))) continue;
    const title = line.match(/(?:^|\b)([A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]+(?:\s+(?:de|del|para|con|y|en|Premium|Pro|PRO|RAF|[A-ZÁÉÍÓÚÑ][a-zA-ZÁÉÍÓÚñ®'’.]+)){1,8})/);
    const candidate = accept(title?.[1]);
    if (candidate) return candidate;
  }

  return "";
}
function autoDetectProductsFromTraining(_training: string, _existing: ProductItem[]): ProductItem[] {
  return [];
}

function parseTraining(training: string): ParsedTraining {
  const products: ProductItem[] = [];
  const cities: { alias: string; canonical: string; covered: boolean }[] = [];

  const catalog =
    training.match(/CATALOGO_PRODUCTOS([\s\S]*?)FIN_CATALOGO_PRODUCTOS/i)?.[1] || "";

  const productBlocks = catalog
    .split(/(?=PRODUCTO:\s*)/i)
    .map((b) => b.trim())
    .filter((b) => /^PRODUCTO:\s*/i.test(b));

  for (const block of productBlocks) {
    const product = clean(block.match(/^PRODUCTO:\s*(.+)$/im)?.[1]);
    const canonical = clean(block.match(/^NOMBRE_CANONICO:\s*(.+)$/im)?.[1]) || product;

    const aliasRaw = clean(block.match(/^ALIAS:\s*(.+)$/im)?.[1]);
    const aliases = aliasRaw ? aliasRaw.split(",").map(clean).filter(Boolean) : [];

    const price1 = Number(clean(block.match(/^PRECIO_1:\s*(\d+)/im)?.[1]) || 0);
    const price2 = Number(clean(block.match(/^PRECIO_2:\s*(\d+)/im)?.[1]) || 0);
    const price3 = Number(clean(block.match(/^PRECIO_3:\s*(\d+)/im)?.[1]) || 0);
    const salesCopy = clean(block.match(/^MENSAJE_VENTA:\s*([\s\S]*)$/im)?.[1]) || undefined;
    const packFijoRaw = Number(clean(block.match(/^PACK_FIJO:\s*(\d+)/im)?.[1]) || 0);
    const fixedPackQuantity = packFijoRaw > 1 ? packFijoRaw : undefined;
    
    const palabraClave = clean(block.match(/^PALABRA_CLAVE:\s*(.+)$/im)?.[1]);

    if (product && canonical && price1 > 0) {
      products.push({
        product,
        canonical,
        aliases: Array.from(new Set([product, canonical, ...aliases])),
        price1,
        price2: fixedPackQuantity ? undefined : price2 || undefined,
        price3: fixedPackQuantity ? undefined : price3 || undefined,
        fixedPackQuantity,
        salesCopy,
        palabra_clave: palabraClave || undefined,
      });
    }
  }

  const autoProducts = autoDetectProductsFromTraining(training, products);
  products.push(...autoProducts);

  const addCity = (alias: string, canonical?: string, covered = true) => {
    const a = clean(alias);
    const c = clean(canonical || alias);
    if (!a || a.length < 2) return;
    cities.push({ alias: a, canonical: c, covered });
  };

  const parseCityBlocks = (section: string, defaultCovered: boolean) => {
    const cityBlocks = clean(section).split(/📍\s*/g).filter(Boolean);

    for (const block of cityBlocks) {
      const lines = block.split("\n").map(clean).filter(Boolean);
      const canonical = clean(lines[0]);
      if (!canonical || canonical.length < 2) continue;

      const blockNorm = normalize(block);
      const explicitlyNotCovered =
        /\b(sin cobertura|fuera de cobertura|transportadora|pago anticipado|no contra entrega|sin contra entrega)\b/.test(blockNorm);
      const covered = explicitlyNotCovered ? false : defaultCovered;

      addCity(canonical, canonical, covered);

      const variantsLine = lines.find((line) => /^[✅✔]/.test(line));
      if (variantsLine) {
        variantsLine
          .replace(/^[✅✔]\s*/, "")
          .split(",")
          .map(clean)
          .filter(Boolean)
          .forEach((variant) => addCity(variant, canonical, covered));
      }
    }
  };

  // Lista completa personalizada: cada bloque puede declarar explícitamente
  // "sin cobertura", "transportadora" o "pago anticipado".
  const completeCitySection =
    training.match(/LISTA COMPLETA POR CIUDAD([\s\S]*?)⚙️ INSTRUCCIÓN FINAL/i)?.[1] || "";
  if (completeCitySection) parseCityBlocks(completeCitySection, true);

  // Secciones explícitas del entrenamiento.
  const coveredSection =
    training.match(/ZONAS CON COBERTURA([\s\S]*?)(?:ZONAS SIN COBERTURA|⚙️ INSTRUCCIÓN FINAL|$)/i)?.[1] || "";
  const uncoveredSection =
    training.match(/ZONAS SIN COBERTURA([\s\S]*?)(?:⚙️ INSTRUCCIÓN FINAL|$)/i)?.[1] || "";

  parseCityBlocks(coveredSection, true);
  parseCityBlocks(uncoveredSection, false);

  const parseSimpleCityList = (section: string, covered: boolean) => {
    clean(section)
      .split(/\r?\n|,/g)
      .map((line) => clean(line.replace(/^[📍✅✔❌🚚💳\-•]+\s*/, "")))
      .filter((line) => {
        const n = normalize(line);
        if (!line || line.length < 3 || line.length > 80) return false;
        if (/\b(pago|transportadora|contra entrega|cobertura|envio|envío|delivery|anticipado)\b/.test(n)) return false;
        return /^[a-zA-ZÁÉÍÓÚáéíóúÑñ0-9.\-\s]+$/.test(line);
      })
      .forEach((city) => addCity(city, city, covered));
  };

  parseSimpleCityList(coveredSection, true);
  parseSimpleCityList(uncoveredSection, false);

  const cityMap = new Map<string, { alias: string; canonical: string; covered: boolean }>();
  for (const c of cities) {
    const key = normalize(c.alias);
    if (!key) continue;
    const existing = cityMap.get(key);
    if (!existing || c.covered === false) cityMap.set(key, c);
  }

  return {
    products,
    cities: Array.from(cityMap.values()),
    catalogUrl: parseCatalogUrl(training),
    bankData: parseBankData(training),
    raw: training,
    generalTraining: "",
    coverageTraining: "",
    bankingTraining: "",
    trainingStats: {
      totalItems: 0,
      generalItems: 0,
      coverageItems: 0,
      bankingItems: 0,
    },
  };
}

function getProductInfo(productName: string, parsed: ParsedTraining) {
  const p = normalize(productName);
  if (!p) return null;

  return (
    parsed.products.find((item) => {
      const names = [item.product, item.canonical, ...item.aliases].map(normalize);
      return names.some((n) => n === p || n.includes(p) || p.includes(n));
    }) || null
  );
}

function isGenericProductWord(word: string) {
  const w = normalize(word);
  return /^(unidad|unidades|u|und|unds|pack|combo|promo|promocion|promoción|oferta|ofertas|profesional|profesionales|producto|productos|precio|especial|gratis|delivery|envio|envío|pago|recibir|central|pais|país|solo|solamente|antes|ahora|black|friday|x\d+|\d+x\d+)$/.test(w);
}

function singularizeProductWord(word: string) {
  let w = normalize(word);
  if (w.length > 5 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("s")) w = w.slice(0, -1);
  return w;
}

function detectProduct(text: string, parsed: ParsedTraining, prev?: string) {
  const msg = normalize(text);
  const prevOk = getProductInfo(prev || "", parsed);

  if (!msg) return prevOk?.canonical || "";

  const msgWords = msg
    .split(/\s+/)
    .map(singularizeProductWord)
    .filter((w) => w.length >= 4 && !isGenericProductWord(w));

  let best: ProductItem | null = null;
  let bestScore = 0;

  for (const p of parsed.products) {
    for (const alias of p.aliases) {
      const a = normalize(alias);
      if (!a || a.length < 3) continue;

      let score = 0;
      if (msg === a) score += 100;
      if (msg.includes(a)) score += 80;
      if (a.includes(msg) && msg.length >= 4) score += 50;

      const aliasWords = a
        .split(/\s+/)
        .map(singularizeProductWord)
        .filter((w) => w.length >= 4 && !isGenericProductWord(w));

      const matched = Array.from(new Set(aliasWords)).filter((w) =>
        msgWords.some((mw) => mw === w || (mw.length >= 4 && w.length >= 4 && (mw.startsWith(w) || w.startsWith(mw))))
      );

      if (matched.length > 0) {
        score += matched.length * 30;
        if (aliasWords.length > 0 && matched.length >= Math.ceil(aliasWords.length * 0.5)) {
          score += 25;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  if (best && bestScore >= 30) return best.canonical;
  return prevOk?.canonical || "";
}


function detectProductsMentioned(text: string, parsed: ParsedTraining): ProductItem[] {
  const msg = normalize(text);
  if (!msg) return [];

  const found: ProductItem[] = [];
  const seen = new Set<string>();

  for (const product of parsed.products || []) {
    const candidates = [
      product.palabra_clave || "",
      product.product || "",
      product.canonical || "",
      ...(product.aliases || []),
    ]
      .flatMap((value) => splitKeywordAliases(value))
      .map(normalize)
      .filter((value) => value.length >= 4 && !isGenericProductWord(value));

    const matches = Array.from(new Set(candidates)).some((candidate) => {
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(msg);
    });

    if (!matches) continue;

    const key = normalize(product.canonical || product.product);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    found.push(product);
  }

  return found;
}

function buildMultipleProductsClarification(products: ProductItem[], currentCity: string): string {
  const names = products.map((p) => p.canonical || p.product).filter(Boolean);
  if (names.length < 2) return "";

  const joined = names.length === 2
    ? `${names[0]} y ${names[1]}`
    : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;

  return `¡Perfecto! Podemos prepararte ${joined}. 😊\n\nPara registrar correctamente las cantidades, decime cuántas unidades querés de cada producto.\n\nEjemplo: “1 ${names[0]} y 1 ${names[1]}”.${currentCity ? `\n\n📍 Mantengo la ciudad de envío: ${currentCity}.` : ""}`;
}


type MultiCartItem = {
  product: string;
  quantity: number;
  unit_price: number;
  total: number;
};

function getMultiCartFromContext(context: any, parsed: ParsedTraining): MultiCartItem[] {
  const raw = Array.isArray(context?.multi_product_cart) ? context.multi_product_cart : [];
  const result: MultiCartItem[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const info = getProductInfo(item?.product || "", parsed);
    if (!info) continue;
    const key = normalize(info.canonical);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const quantity = sanitizeQuantity(item?.quantity || 0);
    const total = quantity > 0 ? calculateTotal(info.canonical, quantity, parsed, null) : 0;
    result.push({
      product: info.canonical,
      quantity,
      unit_price: info.price1 || 0,
      total,
    });
  }

  return result;
}

function createMultiCart(products: ProductItem[]): MultiCartItem[] {
  return products.map((p) => ({
    product: p.canonical,
    quantity: 0,
    unit_price: p.price1 || 0,
    total: 0,
  }));
}

function productOffersText(product: ProductItem): string {
  const offers: string[] = [];
  if (product.fixedPackQuantity && product.price1) {
    offers.push(`🔥 ${product.fixedPackQuantity} unidad${product.fixedPackQuantity > 1 ? "es" : ""}: ${formatGs(product.price1)} Gs`);
  } else {
    if (product.price1) offers.push(`🔥 1 unidad: ${formatGs(product.price1)} Gs`);
    if (product.price2) offers.push(`🔥 2 unidades: ${formatGs(product.price2)} Gs`);
    if (product.price3) offers.push(`🔥 3 unidades: ${formatGs(product.price3)} Gs`);
  }
  return offers.join("\n");
}

function shortProductBenefit(product: ProductItem): string {
  const raw = clean(product.salesCopy || "");
  if (!raw) return "Disponible para agregar al mismo pedido.";

  const lines = raw
    .split(/\r?\n/g)
    .map((line) => clean(line.replace(/^[^a-zA-ZÁÉÍÓÚáéíóúÑñ0-9]+/, "")))
    .filter(Boolean)
    .filter((line) => {
      const n = normalize(line);
      if (/\b(gs|precio|oferta|antes|hoy|stock|envio|envío|delivery|whatsapp|escribi|escribí|pedi|pedí)\b/.test(n)) return false;
      if (/^\d+\s*(?:unidad|unidades|par|pares)?\b/.test(n)) return false;
      return line.length >= 18;
    });

  const preferred = lines.find((line) => /\b(ideal|ayuda|sirve|permite|pica|pela|afila|absorbe|reduce|limpia|protege|alivia|procesa|tritura)\b/i.test(normalize(line))) || lines[0];
  if (!preferred) return "Disponible para agregar al mismo pedido.";

  const sentence = preferred.replace(/[.!?]+$/, "");
  return sentence.length > 105 ? `${sentence.slice(0, 102).trim()}...` : `${sentence}.`;
}

function buildMultipleProductsInformation(products: ProductItem[], currentCity: string): string {
  const sections = products.map((p) => {
    return `📦 *${p.canonical}*\n${shortProductBenefit(p)}\n${productOffersText(p)}`;
  });

  const examples = products.map((p) => `1 ${p.canonical}`).join(" y ");
  return `¡Claro! Tenemos estos productos disponibles 😊\n\n${sections.join("\n\n")}\n\n🛒 Podés llevarlos en un solo pedido.\n¿Cuántos querés de cada uno?\nEjemplo: “${examples}”.${currentCity ? `\n\n📍 Envío a: ${currentCity}.` : ""}`;
}

function extractQuantityForNamedProduct(text: string, product: ProductItem): number {
  const n = normalize(text);
  if (!n) return 0;

  const aliases = [product.canonical, product.product, product.palabra_clave || "", ...(product.aliases || [])]
    .flatMap((v) => splitKeywordAliases(v))
    .map(normalize)
    .filter((v) => v.length >= 3 && !isGenericProductWord(v))
    .sort((a, b) => b.length - a.length);

  for (const alias of Array.from(new Set(aliases))) {
    const e = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = n.match(new RegExp(`\\b(\\d{1,3}|un|uno|una|dos|tres|cuatro|cinco)\\s+(?:unidad(?:es)?\\s+de\\s+)?${e}\\b`, "i"));
    const after = n.match(new RegExp(`\\b${e}\\s*[:x-]?\\s*(\\d{1,3}|un|uno|una|dos|tres|cuatro|cinco)\\b`, "i"));
    const token = before?.[1] || after?.[1];
    if (!token) continue;
    const words: Record<string, number> = { un:1, uno:1, una:1, dos:2, tres:3, cuatro:4, cinco:5 };
    return sanitizeQuantity(words[normalize(token)] || Number(token));
  }
  return 0;
}

function applyQuantitiesToMultiCart(text: string, cart: MultiCartItem[], parsed: ParsedTraining): MultiCartItem[] {
  const updated = cart.map((item) => ({ ...item }));
  for (const item of updated) {
    const info = getProductInfo(item.product, parsed);
    if (!info) continue;
    const quantity = extractQuantityForNamedProduct(text, info);
    if (quantity > 0) {
      item.quantity = quantity;
      item.total = calculateTotal(info.canonical, quantity, parsed, null);
      item.unit_price = info.price1 || 0;
    }
  }

  // Si queda un solo producto sin cantidad y el mensaje es únicamente una cantidad,
  // se asigna a ese producto pendiente.
  const pending = updated.filter((i) => i.quantity <= 0);
  const genericQty = extractQuantity(text);
  if (pending.length === 1 && genericQty > 0) {
    const info = getProductInfo(pending[0].product, parsed);
    if (info) {
      pending[0].quantity = genericQty;
      pending[0].total = calculateTotal(info.canonical, genericQty, parsed, null);
      pending[0].unit_price = info.price1 || 0;
    }
  }

  return updated;
}

function multiCartSummary(cart: MultiCartItem[]) {
  const lines = cart.map((item) => `📦 ${item.product}\n🔢 Cantidad: ${item.quantity}\n💰 Subtotal: ${formatGs(item.total)} Gs`);
  const total = cart.reduce((sum, item) => sum + Number(item.total || 0), 0);
  return `${lines.join("\n\n")}\n\n💵 Total del pedido: ${formatGs(total)} Gs`;
}

function multiCartMissingQuantities(cart: MultiCartItem[]) {
  return cart.filter((i) => i.quantity <= 0).map((i) => i.product);
}

async function saveMultiProductOrders(
  userId: string,
  fromNumber: string,
  cart: MultiCartItem[],
  common: OrderData,
  parsed: ParsedTraining,
  groupId: string
) {
  for (let index = 0; index < cart.length; index++) {
    const item = cart[index];
    const child: OrderData = {
      ...common,
      order_id: `${groupId}-${index + 1}`,
      product: item.product,
      quantity: item.quantity,
      locked_offer: null,
      observation: mergeUniqueText(common.observation, `Pedido multiproducto ${groupId}`),
    };
    await safeUpsertOrder(userId, fromNumber, child, parsed, true);
  }
}

function detectProductStrict(text: string, parsed: ParsedTraining): string {
  const msg = normalize(text);
  if (!msg) return "";

  let best: ProductItem | null = null;
  let bestScore = 0;

  for (const p of parsed.products) {
    for (const alias of p.aliases) {
      const a = normalize(alias);
      if (!a || a.length < 3) continue;

      const aliasWordCount = a.split(/\s+/).filter(Boolean).length;
      let score = 0;

      if (msg === a) {
        score = 1000;
      } else if (aliasWordCount >= 2 && msg.includes(a)) {
        score = 900;
      } else if (aliasWordCount >= 2 && a.includes(msg) && msg.length >= 4) {
        score = 850;
      }

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }

  return bestScore >= 850 && best ? best.canonical : "";
}

function isPlausibleOfferForProduct(offer: OfferItem | null | undefined, product: ProductItem | null | undefined): boolean {
  if (!offer || !product) return false;

  const copy = normalize(product.salesCopy || "");
  if (!copy) return true;

  if (offer.fixed_quantity) {
    const qtyStr = String(offer.quantity);
    const totalDigits = String(offer.total || "").replace(/\D/g, "");

    const qtyMentioned = new RegExp(`\\b${qtyStr}\\b`).test(copy);
    const totalMentioned = totalDigits.length >= 4 && copy.includes(totalDigits);

    if (!qtyMentioned && !totalMentioned) return false;
  }

  return true;
}


function isProductEffectivenessQuestion(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!n) return false;

  return (
    /\b(funciona|funcionara|funcionará|sirve|servira|servirá|anda|andara|andará|resulta|resultado|resultados|efectivo|efectiva)\b/.test(n) ||
    /\b(sera cierto|será cierto|sera verdad|será verdad|de verdad funciona|realmente funciona|realmente sirve|si funciona|si sirve|da resultado|da resultados)\b/.test(n) ||
    /^(sera|será)\s*,?\s*(anda|funciona|sirve|cierto|verdad)\s*\??$/.test(n) ||
    /^(anda|funciona|sirve)\s+de\s+verdad\s*\??$/.test(n)
  );
}

function buildProductEffectivenessResponse(state: ConversationState): string {
  // V116: deshabilitado. La explicación del producto sale del entrenamiento vía Gemini.
  return "";
  /*
  const product =
    clean(state.productInfo?.canonical) ||
    clean(state.order.product) ||
    "este producto";

  const copy = clean(state.productInfo?.salesCopy || "");

  const usefulLines = copy
    .split(/\r?\n/g)
    .map((line) =>
      clean(
        line
          .replace(/^[^a-zA-ZÁÉÍÓÚáéíóúÑñ0-9]+/, "")
          .replace(/\s+/g, " ")
      )
    )
    .filter(Boolean)
    .filter((line) => {
      const n = normalize(line);

      if (line.length < 12 || line.length > 170) return false;

      if (
        /\b(gs|precio|precios|oferta|promo|promocion|promoción|antes|hoy|stock|quedan|envio|envío|delivery|whatsapp|escribi|escribí|pedi|pedí|comprá|compra|garantia|garantía|devolvemos|unidad|unidades)\b/.test(n)
      ) {
        return false;
      }

      return /\b(ayuda|sirve|permite|ideal|diseñado|disenado|reduce|alivia|absorbe|soporte|protege|limpia|atrapa|afila|filo|tritura|pica|procesa|mezcla|hidrata|rejuvenece|corrige|mejora|respira|vapor|calienta|elimina|fortalece|comodidad|impacto|postura|arco|dolor|resultado|funciona)\b/.test(n);
    });

  const uniqueBenefits: string[] = [];
  for (const line of usefulLines) {
    const normalizedLine = normalize(line);
    if (
      !uniqueBenefits.some((existing) => {
        const normalizedExisting = normalize(existing);
        return (
          normalizedExisting === normalizedLine ||
          normalizedExisting.includes(normalizedLine) ||
          normalizedLine.includes(normalizedExisting)
        );
      })
    ) {
      uniqueBenefits.push(line.replace(/[.!?]+$/, ""));
    }

    if (uniqueBenefits.length >= 3) break;
  }

  let explanation = "";

  if (uniqueBenefits.length > 0) {
    explanation =
      `Sí 😊 El ${product} está diseñado para cumplir la función explicada en la publicación.\n\n` +
      `${uniqueBenefits.map((benefit) => `✅ ${benefit}`).join("\n")}\n\n` +
      `El resultado depende de usarlo correctamente y de cada caso particular.`;
  } else if (copy) {
    explanation =
      `Sí 😊 El ${product} funciona para el uso explicado en la publicación. ` +
      `Está pensado para brindar los beneficios indicados en su descripción cuando se utiliza correctamente.`;
  } else {
    explanation =
      `Sí 😊 El ${product} está diseñado para cumplir la función indicada. ` +
      `El resultado depende del uso correcto y de cada caso particular.`;
  }

  let continuation = "";

  if (!clean(state.order.city)) {
    continuation =
      "😊 Para confirmar la cobertura y la modalidad de entrega, ¿me indicás por favor de qué ciudad sos? 📍";
  } else if (
    !state.order.quantity &&
    !state.order.locked_offer?.fixed_quantity
  ) {
    continuation = "¿Cuántas unidades querés llevar? 😊";
  } else if (!clean(state.order.customer_name)) {
    continuation = "Para continuar, pasame tu nombre y apellido. 😊";
  } else if (!state.addressOptional && !clean(state.order.address)) {
    continuation = "Ahora solo me falta la calle o dirección exacta para la entrega. 📍";
  }

  return `${explanation}${continuation ? `\n\n${continuation}` : ""}`;
  */
}

function isQuestionLikeMessage(text: string) {
  const raw = clean(text);
  const n = normalize(raw);
  if (!n) return false;

  return (
    isProductEffectivenessQuestion(raw) ||
    /[?¿]/.test(raw) ||
    /\b(?:pero\s+)?(?:de\s+)?d(?:o|oi|ó)nde\s+son(?:\s+ustedes)?\b/.test(n) ||
    /\b(donde estan|donde queda|donde se encuentran|quienes son|como funciona|como se usa|como es|que incluye|que trae|cuanto tarda|cuando llega|tienen garantia|hay garantia|es original|hacen envios|hacen envio|tienen delivery|cuentan con delivery|hay delivery|realizan delivery|envian|aceptan transferencia|como pago|formas de pago|puedo pagar|tienen local|tienen tienda|tienen sucursal|de donde traen|de donde viene|de donde es el producto|hay stock|tienen stock|queda stock|que colores|que color|hay colores|que medidas|que medida|que talles|que talle|se puede cambiar|hacen cambios|tiene devolucion|tienen devolucion|aceptan cuotas|se puede pagar en cuotas|emiten factura|dan factura|tiene manual|viene con manual|es recargable|usa pilas|que material es|de que material es)\b/.test(n) ||
    /^(que|como|cuando|donde|por que|porque|cual|cuales|quien|quienes|cuanto|cuantos|cuanta|cuantas)\b/.test(n) ||
    /\b(?:seria|sería)\s+(?:cuanto|cuánto|cuantos|cuántos)\b/.test(n) ||
    /\b(?:es|seria|sería)\s+por\s+(?:calce|calse|talle|talla|par)\b/.test(n)
  );
}


function isAmbiguousProductRejection(text: string, currentProduct: string): boolean {
  const n = normalize(text);
  if (!n || !currentProduct) return false;
  return /\b(no estoy interesad[oa]|ya no quiero|no me interesa|no quiero)\b/.test(n);
}

function buildMissingDataContinuation(state: ConversationState): string {
  const missing: string[] = [];

  if (!clean(state.order.city)) {
    return "📍 ¿Para qué ciudad sería el envío?";
  }

  if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) {
    return "¿Cuántas unidades querés llevar?";
  }

  if (!clean(state.order.customer_name)) missing.push("nombre y apellido");
  if (state.coverage !== false && !state.addressOptional && !clean(state.order.address)) {
    missing.push("dirección o ubicación");
  }

  if (!missing.length) return "";
  if (missing.length === 1) return `Para completar el pedido me falta tu ${missing[0]}.`;

  return `Para completar el pedido también me faltan:\n${missing.map((item) => `✅ ${item}`).join("\n")}`;
}

function buildInvoiceQuestionResponse(state: ConversationState): string {
  const continuation = buildMissingDataContinuation(state);

  return `✅ Sí, contamos con factura legal 😊

Podés enviarme tu RUC y razón social o tu número de cédula para agregarla al pedido.${continuation ? `\n\n${continuation}` : ""}`;
}

function sanitizeCoverageAndShippingResponse(
  response: string,
  state: ConversationState
): string {
  const raw = clean(response);
  if (!raw) return raw;

  const n = normalize(raw);
  const totalDigits = String(state.total || "").replace(/\D/g, "");

  if (state.coverage === true && state.order.city) {
    const saysPaidShipping =
      /\b(envio|delivery|entrega|flete)\b[\s\S]{0,45}\b(costo|cuesta|sale|vale|pagar)\b/.test(n) ||
      /\b(costo|cuesta|sale|vale)\b[\s\S]{0,45}\b(envio|delivery|entrega|flete)\b/.test(n);

    const usesOrderTotalAsShipping =
      totalDigits.length >= 4 &&
      n.includes(totalDigits) &&
      /\b(envio|delivery|entrega|flete)\b/.test(n);

    if (saysPaidShipping || usesOrderTotalAsShipping) {
      const continuation = buildMissingDataContinuation(state);
      return `✅ Tenemos envío GRATIS contra entrega en ${state.order.city} 🚚

Pagás solamente el producto cuando lo recibís 😊${continuation ? `\n\n${continuation}` : ""}`;
    }
  }

  if (state.coverage === false && /\b(envio gratis|delivery gratis|contra entrega|pagas al recibir|pagás al recibir)\b/.test(n)) {
    const continuation = buildMissingDataContinuation(state);
    return `📦 Para ${state.order.city || "tu ciudad"} el envío se realiza por transportadora y el pago del producto es anticipado.${continuation ? `\n\n${continuation}` : ""}`;
  }

  return raw;
}

function buildDeterministicBusinessQuestionResponse(text: string, state: ConversationState) {
  const n = normalize(text);
  if (!n) return "";

  if (isInvoiceQuestion(text)) {
    return buildInvoiceQuestionResponse(state);
  }

  if (isAmbiguousProductRejection(text, state.order.product || "")) {
    return `Entiendo 😊 Solo para confirmar: ¿ya no querés continuar con ${state.order.product}?`;
  }

  if (isProductEffectivenessQuestion(text)) {
    return buildProductEffectivenessResponse(state);
  }

  if (isDeliveryCostQuestion(text)) {
    return buildDeliveryCostResponse(state);
  }

  const asksDeliveryAvailability =
    /\b(cuentan con delivery|tienen delivery|hay delivery|hacen envios|hacen envio|realizan delivery|envian a domicilio|entregan a domicilio)\b/.test(n);

  if (asksDeliveryAvailability) {
    const continuation = state.order.city
      ? state.order.quantity
        ? !state.order.customer_name
          ? "Para continuar, pasame tu nombre y apellido."
          : !state.order.address
            ? "Ahora pasame la dirección exacta o ubicación para la entrega."
            : ""
        : "¿Cuántas unidades querés llevar?"
      : "📍 ¿Para qué ciudad sería el envío?";

    return `¡Claro que sí! Contamos con delivery 😊${continuation ? `\n\n${continuation}` : ""}`;
  }

  if (isPayOnDeliveryRequest(text)) {
    return buildPayOnDeliveryResponse(state);
  }

  if (isPaymentInformationQuestion(text)) {
    let continuation = "";
    if (!state.order.city) continuation = "📍 ¿Para qué ciudad sería el envío?";
    else if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) continuation = "¿Cuántas unidades querés llevar?";
    else if (!state.order.customer_name) continuation = "Para continuar, pasame tu nombre y apellido.";
    else if (!state.addressOptional && !state.order.address) continuation = "Ahora pasame la dirección exacta o ubicación.";
    

    if (state.coverage === false && state.order.city) {
      return `📍 Para ${state.order.city} el envío es por transportadora.

💳 En este caso el pago es anticipado por transferencia.
📎 Para confirmar el pedido necesitamos la foto o PDF del comprobante.`;
    }

    return `💵 Podés pagar en efectivo o por transferencia al delivery cuando recibís tu pedido. 😊${continuation ? `\n\n${continuation}` : ""}`;
  }

  const asksOrigin =
    /\b(?:pero\s+)?(?:de\s+)?d(?:o|oi|ó)nde\s+son(?:\s+ustedes)?\b/.test(n) ||
    /\bde que ciudad son\b/.test(n) ||
    /\bubicacion de ustedes\b/.test(n);

  if (!asksOrigin) return "";

  let continuation = "";
  if (!state.order.city) {
    continuation = "📍 ¿Para qué ciudad sería el envío?";
  } else if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) {
    continuation = "¿Cuántas unidades querés llevar?";
  } else if (!state.order.customer_name) {
    continuation = "Para continuar, pasame tu nombre y apellido.";
  } else if (state.coverage !== false && !state.addressOptional && !state.order.address) {
    continuation = "Ahora pasame la dirección exacta o ubicación para la entrega.";
  }

  return `Somos de Asunción y hacemos envíos a todo el país. 😊${continuation ? `\n\n${continuation}` : ""}`;
}

function exactKnownCity(text: string, parsed: ParsedTraining): string {
  const n = normalize(text);
  if (!n) return "";

  const hardExact: Record<string, string> = {
    asuncion: "Asunción",
    asu: "Asunción",
    "fernando de la mora": "Fernando de la Mora",
    "fdo de la mora": "Fernando de la Mora",
    "fndo de la mora": "Fernando de la Mora",
    "san lorenzo": "San Lorenzo",
    luque: "Luque",
    lambare: "Lambaré",
    "mariano roque alonso": "Mariano Roque Alonso",
    mra: "Mariano Roque Alonso",
    cde: "Ciudad del Este",
    "ciudad del este": "Ciudad del Este",
    "cdad del este": "Ciudad del Este",
  };
  if (hardExact[n]) return hardExact[n];

  const found = parsed.cities.find((c) => {
    const alias = normalize(c.alias);
    const canonical = normalize(c.canonical);
    return n === alias || n === canonical;
  });

  return found?.canonical || "";
}


function extractSizeOrVariant(text: string): string {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return "";

  const match = raw.match(
    /\b(?:calce|calse|talle|talla|numero|número|nro|medida)\s*[:#-]?\s*(\d{1,3}(?:[.,]\d+)?)\b/i
  );

  if (!match?.[1]) return "";
  return `Calce/talle solicitado: ${clean(match[1])}`;
}

function isOnlyPurchaseWithSize(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(calce|calse|talle|talla|numero|número|nro|medida)\s*\d{1,3}\b/.test(n) &&
    !/\b(calle|avda|avenida|ruta|km|barrio|casa|frente|esquina|manzana|mz|lote|edificio|piso|ubicacion|ubicación|direccion|dirección)\b/.test(n)
  );
}

function isClearlyNotCityMessage(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!n) return true;

  // Confirmaciones, negaciones y respuestas conversacionales nunca son ciudades.
  if (/^(si|sii|siii|sip|si asi es|sii asi es|siii asi es|asi es|correcto|exacto|esa es|es esa|ok|ok gracias|dale|listo|no|nop|gracias|muchas gracias|mil gracias|perfecto|esta bien|está bien)$/i.test(n)) return true;

  // Consultas comerciales o sobre el origen nunca deben pasar al detector de ciudad.
  if (/\b(cuentan con delivery|tienen delivery|hay delivery|hacen envios|hacen envio|realizan delivery|de donde traen|de donde viene|de donde es|ustedes de donde|donde son ustedes)\b/.test(n)) return true;

  // Preguntas escritas sin signos o con errores frecuentes.
  if (/\b(seria|sería|cuanto|cuánto|cuantos|cuántos|precio|costo|valor|sale|cuesta)\b/.test(n)) return true;

  // Consultas de funcionamiento o resultado nunca son ciudades.
  if (isProductEffectivenessQuestion(raw)) return true;

  // Cantidades, teléfonos, números de casa, talles y calces.
  if (extractQuantity(raw) > 0 || extractPhone(raw)) return true;
  if (/\b(nro|numero|número|talle|talla|calce|calse|medida|par|pares)\b/.test(n)) return true;
  if (/\d/.test(raw) && !/^\s*[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+\s*$/.test(raw)) return true;

  // Direcciones, ubicaciones y referencias no deben reemplazar una ciudad ya capturada.
  if (/\b(calle|avda|avenida|ruta|km|barrio|bsrrio|bario|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|dpto|referencia|ubicacion|ubicación|direccion|dirección)\b/.test(n)) return true;
  if (/maps\.app|google\.com\/maps/i.test(raw)) return true;

  // Frases normales del proceso comercial que no son localidades.
  if (/^(es|seria|sería|quiero|quiero uno|quiero una|quiero dos|quiero 1|quiero 2|necesito|prefiero|puede|podria|podría|tengo|uso|calzo|mi talle|hice mi pedido|ya hice mi pedido|ya pedi|ya pedí|realice mi pedido|realicé mi pedido|tengo un pedido|mi pedido)\b/.test(n)) return true;

  // Estados o comentarios del pedido nunca son ciudades.
  if (/\b(hice mi pedido|ya hice el pedido|ya pedi|ya pedí|mi pedido|pedido realizado|pedido confirmado|quiero cambiar|quiero modificar)\b/.test(n)) return true;

  return false;
}

function isPlausibleBareCityCandidate(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || isClearlyNotCityMessage(raw) || isQuestionLikeMessage(raw)) return false;
  if (isTemporalDeliveryExpression(raw)) return false;
  if (detectProductsMentioned && false) return false; // referencia intencionalmente inactiva; el catálogo se valida en detectCity.

  const words = n.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return false;
  if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(raw)) return false;
  if (raw.length < 3 || raw.length > 60) return false;
  return true;
}


function isCompleteMultiwordLocality(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return false;
  if (isClearlyNotCityMessage(raw) || isQuestionLikeMessage(raw) || isTemporalDeliveryExpression(raw)) return false;
  if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(raw)) return false;

  const words = n.split(/\s+/).filter(Boolean);
  // Una localidad completa como “Santa Rosa del Aguaray” no necesita
  // confirmación. Se conserva literalmente y luego se evalúa cobertura exacta.
  return words.length >= 3 && words.length <= 6;
}

function canonicalizeStoredCity(value: string, parsed: ParsedTraining): string {
  const raw = clean(value);
  const n = normalize(raw);
  if (!raw || !n) return "";

  const ordered = [...(parsed.cities || [])].sort(
    (a, b) => Math.max(normalize(b.alias).length, normalize(b.canonical).length) - Math.max(normalize(a.alias).length, normalize(a.canonical).length)
  );

  for (const city of ordered) {
    const names = Array.from(new Set([city.alias, city.canonical].map(normalize).filter(Boolean)));
    for (const name of names) {
      if (n === name) return city.canonical;
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(n)) return city.canonical;
    }
  }

  // Un valor viejo o contaminado que no existe en el entrenamiento se elimina.
  return "";
}


/* ============================================================
   V126 — CLASIFICACIÓN ESTRICTA DE DATOS
   ============================================================ */

function isDeferredLocationMessage(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    (
      /\b(?:te|le|les)?\s*(?:envio|enviare|mandare|paso|pasare|comparto|compartire)\s+(?:la\s+)?ubicacion\b/.test(n) &&
      /\b(?:despues|mas tarde|cuando|una vez|al llegar|cuando llegue|cuando este|cuando me contacten|cuando contacte|delivery)\b/.test(n)
    ) ||
    /\b(?:ubicacion|direccion|referencia)\s+(?:la\s+)?(?:envio|mando|paso|comparto)\s+(?:despues|mas tarde|cuando)\b/.test(n) ||
    /\b(?:cuando|una vez)\s+(?:este|llegue|vuelva)\s+(?:a|en)\s+(?:mi\s+)?casa\b/.test(n) ||
    /\b(?:le|te)\s+(?:paso|envio|mando)\s+(?:al|cuando llegue el|cuando me escriba el)\s+delivery\b/.test(n) ||
    /\b(?:a coordinar|coordino|coordinamos)\s+con\s+(?:el\s+)?delivery\b/.test(n) ||
    /\b(?:todavia|ahora)\s+no\s+(?:estoy|tengo)\s+(?:en\s+)?(?:mi\s+)?casa\b/.test(n)
  );
}

function isConversationalLocationPhrase(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /^(?:ahi|ai|aca|aqui)\s+(?:esta|es|queda|seria)\b/.test(n) ||
    /\b(?:ahi|ai|aca|aqui)\s+(?:esta|es|queda)\s*(?:el\s+)?km\b/.test(n) ||
    /\b(?:cuando este en mi casa|cuando llegue a casa|una vez este en casa)\b/.test(n) ||
    isDeferredLocationMessage(text)
  );
}

function configuredCityInsideMessage(text: string, parsed: ParsedTraining): string {
  const n = normalize(text);
  if (!n) return "";

  const ordered = [...(parsed.cities || [])].sort(
    (a, b) =>
      Math.max(normalize(b.alias).length, normalize(b.canonical).length) -
      Math.max(normalize(a.alias).length, normalize(a.canonical).length)
  );

  for (const city of ordered) {
    const names = Array.from(
      new Set([city.alias, city.canonical].map(normalize).filter(Boolean))
    ).sort((a, b) => b.length - a.length);

    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(n)) {
        return city.canonical;
      }
    }
  }

  return "";
}

function extractReferenceAfterKnownCity(
  text: string,
  city: string,
  parsed: ParsedTraining
): string {
  let raw = clean(text);
  const canonical = clean(city || configuredCityInsideMessage(raw, parsed));
  if (!raw || !canonical) return "";

  const cityEntry = (parsed.cities || []).find(
    (c) => normalize(c.canonical) === normalize(canonical)
  );

  const names = Array.from(
    new Set(
      [
        canonical,
        cityEntry?.alias || "",
        cityEntry?.canonical || "",
      ].map(clean).filter(Boolean)
    )
  ).sort((a, b) => b.length - a.length);

  for (const name of names) {
    const parts = name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const cityRe = new RegExp(`(?:^|\\b)${parts.join("\\s+")}(?:\\b|$)`, "i");
    if (cityRe.test(raw)) {
      raw = raw.replace(cityRe, " ");
      break;
    }
  }

  raw = clean(raw)
    .replace(/^(?:soy\s+de|estoy\s+en|vivo\s+en|seria\s+para|sería\s+para|para|en)\s+/i, "")
    .replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, "");

  if (!raw) return "";

  const n = normalize(raw);
  const hasReferenceCue =
    /\b(?:ex\s+ruta|ruta|km|kilometro|kilómetro|barrio|zona|centro|compania|compañia|fraccion|fracción|calle|avenida|avda|esquina|casi|frente|lado|referencia|numero|nro|manzana|mz|lote)\b/.test(n);

  if (!hasReferenceCue) return "";
  if (isDeferredLocationMessage(raw)) return "";

  return raw;
}

function isStrictStandaloneCustomerName(
  text: string,
  city: string,
  parsed?: ParsedTraining
): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  const words = raw.split(/\s+/).filter(Boolean);

  if (!raw || words.length < 2 || words.length > 5) return false;
  if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ'’.\-\s]+$/.test(raw)) return false;
  if (/\d/.test(raw)) return false;
  if (isQuestionLikeMessage(raw) || isPoliteClosingOrAcknowledgement(raw)) return false;
  if (isDeferredLocationMessage(raw) || isConversationalLocationPhrase(raw)) return false;
  if (city && normalize(city) === n) return false;
  if (parsed && configuredCityInsideMessage(raw, parsed)) return false;
  if (parsed && isContaminatedCustomerName(raw, parsed)) return false;

  const forbidden =
    /\b(?:ahi|ai|aca|aqui|esta|este|queda|quedo|casa|calle|avenida|avda|ruta|km|kilometro|barrio|zona|centro|esquina|frente|lado|ubicacion|direccion|referencia|delivery|envio|precio|producto|unidad|unidades|quiero|necesito|despues|luego|cuando|gracias|hola|buenas|perfecto|correcto|efectivo|transferencia)\b/;

  return !forbidden.test(n);
}

function detectCity(text: string, parsed: ParsedTraining, prev?: string) {
  const raw = clean(text);
  const previous = canonicalizeStoredCity(prev || "", parsed);

  if (!raw) return previous;

  // V121: una consulta de precio, incluso con errores ortográficos comunes,
  // nunca puede convertirse en ciudad. Esta validación no genera mensajes:
  // únicamente conserva el estado para que Gemini responda normalmente.
  if (isPriceQuery(raw)) return previous;

  // V126: una ciudad configurada dentro de una frase siempre gana.
  // Ejemplos: "Capiatá ex ruta 1", "Luque zona aeropuerto".
  const configuredInsideMessage = configuredCityInsideMessage(raw, parsed);
  if (configuredInsideMessage) return configuredInsideMessage;

  // PRIMERO: una coincidencia exacta del entrenamiento siempre gana,
  // incluso si contiene números, por ejemplo "Campo 9".
  const exactCity = exactKnownCity(raw, parsed);
  if (exactCity) return exactCity;

  const explicitKnownCity = extractExplicitKnownCityFromSentence(raw, parsed);
  if (explicitKnownCity) return explicitKnownCity;

  // V112: primero extraer una declaración explícita, incluso con errores
  // frecuentes: "Yo estoi en Caacupe", "toy en Luque", "stoy en Capiata".
  const earlyStatement = extractCityStatement(raw);
  if (earlyStatement) {
    const earlyKnown = exactKnownCity(earlyStatement, parsed);
    if (earlyKnown) return earlyKnown;

    const earlyConfigured = extractExplicitKnownCityFromSentence(
      earlyStatement,
      parsed
    );
    if (earlyConfigured) return earlyConfigured;

    const earlyWords = normalize(earlyStatement).split(/\s+/).filter(Boolean);
    const validEarlyLocality =
      earlyWords.length >= 1 &&
      earlyWords.length <= 6 &&
      earlyStatement.length >= 3 &&
      earlyStatement.length <= 70 &&
      /^[a-zA-ZÁÉÍÓÚáéíóúÑñ0-9.\-\s]+$/.test(earlyStatement) &&
      /[a-zA-ZÁÉÍÓÚáéíóúÑñ]/.test(earlyStatement);

    if (validEarlyLocality) return toTitleCase(earlyStatement);
  }

  // Nunca convertir respuestas comerciales, cantidades, agradecimientos,
  // nombres, preguntas o productos en una ciudad.
  if (
    isClearlyNotCityMessage(raw) ||
    isQuestionLikeMessage(raw) ||
    detectProductsMentioned(raw, parsed).length > 0 ||
    isBuyIntent(raw) ||
    isGenericBuyReply(raw)
  ) {
    return previous;
  }

  const statement = extractCityStatement(raw);
  const candidate = clean(statement || raw);

  if (!candidate) return previous;

  const exactStatement = exactKnownCity(candidate, parsed);
  if (exactStatement) return exactStatement;

  const configuredInsideStatement = extractExplicitKnownCityFromSentence(candidate, parsed);
  if (configuredInsideStatement) return configuredInsideStatement;

  const normalizedCandidate = normalize(candidate);
  const words = normalizedCandidate.split(/\s+/).filter(Boolean);

  // Una localidad fuera de cobertura puede no estar en el entrenamiento.
  // Se acepta únicamente cuando tiene forma clara de localidad.
  // Admite ejemplos como "Campo 9", "Santa Rosa del Aguaray"
  // o "25 de Diciembre".
  const validLocalityShape =
    words.length >= 1 &&
    words.length <= 6 &&
    candidate.length >= 3 &&
    candidate.length <= 70 &&
    /^[a-zA-ZÁÉÍÓÚáéíóúÑñ0-9.\-\s]+$/.test(candidate) &&
    /[a-zA-ZÁÉÍÓÚáéíóúÑñ]/.test(candidate);

  if (!validLocalityShape) return previous;

  // Bloqueo final de expresiones que tienen forma de texto pero no de localidad.
  if (
    /^(quiero|quiero uno|quiero una|quiero dos|quiero 1|quiero 2|uno|una|dos|tres|cuatro|cinco|2x1|2 x 1)$/i.test(normalizedCandidate) ||
    /\b(gracias|pedido|precio|presio|presyo|prezio|preio|prcio|pecio|prescio|precios|presios|producto|promo|promocion|promoción|unidad|unidades|comprar|compro|quiero|necesito|delivery|envio|envío)\b/.test(normalizedCandidate)
  ) {
    return previous;
  }

  return toTitleCase(candidate);
}

function hasCoverage(city: string, parsed: ParsedTraining) {
  const c = normalize(city);
  if (!c) return false;

  // V82: solamente las ciudades cargadas en el entrenamiento tienen
  // contra-entrega. Toda localidad válida no configurada usa pago anticipado.

  const configured = parsed.cities.find((item) => {
    const alias = normalize(item.alias);
    const canonical = normalize(item.canonical);
    return c === alias || c === canonical;
  });

  return configured ? configured.covered !== false : false;
}

function isTemporalDeliveryExpression(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(hoy|manana|mañana|pasado manana|pasado mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|fin de semana|quincena|fin de mes|principio de mes|inicio de mes|proximo mes|próximo mes|mes que viene)\b/.test(n) ||
    /\b(?:para|el|este|proximo|próximo)\s+(?:el\s+)?(?:lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/.test(n) ||
    /\b(?:a|para|hasta|desde)\s+(?:fin|fines|principio|inicio)\s+de\s+(?:mes|semana)\b/.test(n) ||
    /\b(?:a las|desde las|hasta las|despues de|después de|antes de)\s+\d{1,2}(?::\d{2})?\s*(?:hs|hrs|am|pm)?\b/.test(n) ||
    /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(n) ||
    /\b\d{1,2}\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.test(n)
  );
}

function extractCityStatement(text: string): string {
  const raw = clean(text);
  const norm = normalize(raw);

  if (!raw || raw.length < 3 || /^[\p{Emoji}\s]+$/u.test(raw)) return "";
  if (/^\p{Emoji}/u.test(raw)) return "";

  const onlyGreeting =
    /^(hola|holaa|ola|buenas|buenos dias|buenos días|buen dia|buen día|hi|hey|buenas noches|buenas tardes|saludos|ok|dale|si|sí|no|gracias|de nada|listo|perfecto)[\s!.]*$/i;

  if (onlyGreeting.test(norm)) return "";

  // Una fecha u horario de entrega nunca debe convertirse en ciudad.
  // Ej.: "quiero para fin de mes", "puede ser para el sábado".
  if (isTemporalDeliveryExpression(norm)) return "";

  // La validación contra productos se realiza también en detectCity, donde
  // está disponible el catálogo completo. Aquí bloqueamos coordinaciones
  // evidentes de artículos para que el patrón genérico "para ..." no las tome.
  if (/\b(y|con|ademas|además)\b/.test(norm) && /\b(quiero|llevo|producto|productos|unidad|unidades)\b/.test(norm)) return "";

  const patterns: RegExp[] = [
    /\bsoy\s+de\s+la\s+ciudad\s+de\s+(.+)$/i,
    /\bsoy\s+de\s+(.+)$/i,
    /\bsoi\s+de\s+(.+)$/i,
    /\bsoy\s+d\s+(.+)$/i,
    /\bvivo\s+en\s+(.+)$/i,
    /\b(?:yo\s+)?(?:estoy|estoi|toy|stoy)\s+en\s+(.+)$/i,
    /\b(?:yo\s+)?me\s+encuentro\s+en\s+(.+)$/i,
    /\b(?:yo\s+)?(?:vivo|resido)\s+en\s+(.+)$/i,
    /\bya\s+(?:estoy|estoi|toy|stoy)\s+en\s+(.+)$/i,
    /\bde\s+la\s+ciudad\s+de\s+(.+)$/i,
    /\bciudad\s+de\s+(.+)$/i,
    /\bmi\s+ciudad\s+(?:es|seria|sería)\s+(.+)$/i,
    /^(.+?)\s+(?:es|seria|sería)\s+mi\s+ciudad$/i,
    /\bpara\s+la\s+ciudad\s+de\s+(.+)$/i,
    /\b(?:quiero|necesito|seria|sería)\s+para\s+(.+)$/i,
    /\bpara\s+env[ií]o\s+a\s+(.+)$/i,
    /\bpara\s+enviar\s+a\s+(.+)$/i,
    /\benv[ií]o\s+a\s+(.+)$/i,
    /\bdelivery\s+a\s+(.+)$/i,
    /\bpara\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = norm.match(pattern);
    if (!match?.[1]) continue;

    let candidate = clean(match[1]);

    candidate = candidate
      .replace(/\b(quiero|qiero|kiero|me interesa|precio|cuanto|cuánto|consulta|comprar|compro|llevo|delivery|envio|envío|por favor|xfa|porfa|gracias|y quiero|y necesito|necesito|del producto|la crema|el producto)\b.*$/gi, "")
      .replace(/\b(mi nombre es|me llamo|soy)\b.*$/gi, "")
      .replace(/\b(09\d{6,}|5959\d{6,}|\+5959\d{6,})\b.*$/gi, "")
      .replace(/[.,!?;:]+$/g, "")
      .trim();

    const words = normalize(candidate).split(/\s+/).filter(Boolean);

    if (
      candidate.length >= 3 &&
      words.length <= 5 &&
      !/^\d+$/.test(candidate) &&
      !isTemporalDeliveryExpression(candidate) &&
      !looksLikeSentenceNotCity(candidate)
    ) {
      return candidate;
    }
  }

  return "";
}

function extractQuantity(text: string) {
  const m = normalize(text);
  if (!m) return 0;

  const wordMap: Record<string, number> = {
    un: 1,
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

  if (/^(?:09\d{6,}|5959\d{6,}|\+5959\d{6,})$/.test(clean(text))) return 0;

  const onlyNumber = m.match(/^(\d{1,3})\s*(?:unidad|unidades|u|und|unds|pieza|piezas)?$/);
  if (onlyNumber && !m.startsWith("09")) return sanitizeQuantity(Number(onlyNumber[1]));

  const q1 = m.match(/\b(\d{1,3})\s*(unidad|unidades|u|und|unds|piezas|pieza)\b/);
  if (q1 && !q1[1].startsWith("09")) return sanitizeQuantity(Number(q1[1]));

  const q2 = m.match(/\b(quiero|kiero|qiero|llevo|dame|mandame|mándame|reservame|resérvame|solo|solamente|serian|serían|seria|sería|quiero llevar|voy a llevar|me llevo)\s+(\d{1,3})\b/);
  if (q2) return sanitizeQuantity(Number(q2[2]));

  const q3 = m.match(/\b(\d{1,3})\s+(quiero|llevo|dame|mandame|mándame|seria|sería|serian|serían)\b/);
  if (q3 && !q3[1].startsWith("09")) return sanitizeQuantity(Number(q3[1]));

  for (const [word, num] of Object.entries(wordMap)) {
    const unitRegex = new RegExp(`\\b${word}\\s*(unidad|unidades|u\\b|und\\b|unds\\b|piezas|pieza|producto|productos|crema|cremas|item|items|ítem|ítems)\\b`);
    if (unitRegex.test(m)) return sanitizeQuantity(num);
  }

  for (const [word, num] of Object.entries(wordMap)) {
    const intentWordRegex = new RegExp(`\\b(quiero|kiero|qiero|llevo|dame|mandame|mándame|reservame|resérvame|solo|solamente|seria|sería|serian|serían|quiero llevar|voy a llevar|me llevo|pasame|pásame|envíame|enviame)\\s+${word}\\b`);
    if (intentWordRegex.test(m)) return sanitizeQuantity(num);
  }

  for (const [word, num] of Object.entries(wordMap)) {
    const casualRegex = new RegExp(`\\b(?:solo\\s+|solamente\\s+)?${word}\\s*(?:nomas|nomás|no mas|no más)?\\b`);
    if (casualRegex.test(m)) return sanitizeQuantity(num);
  }

  if (m.split(/\s+/).length <= 2) {
    for (const [word, num] of Object.entries(wordMap)) {
      if (new RegExp(`^${word}(?:\\s+(?:nomas|nomás|no mas|no más))?$`).test(m)) {
        return sanitizeQuantity(num);
      }
    }
  }

  return 0;
}


function senderPhoneFallback(fromNumber: string): string {
  const digits = clean(fromNumber).replace(/\D/g, "");
  if (!digits) return "";

  // WhatsApp suele entregar números paraguayos como 5959XXXXXXXX.
  // Para mostrar/guardar el formato local lo convertimos a 09XXXXXXXX.
  if (/^5959\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^9\d{8}$/.test(digits)) return `0${digits}`;
  if (/^09\d{8}$/.test(digits)) return digits;

  // Para números internacionales de otros países conservamos todos los dígitos.
  return digits;
}

function extractPhone(text: string) {
  const raw = clean(text);
  const tokens = raw.split(/\s+/).filter(Boolean);

  const fullPattern = /^(?:09\d{8}|\+5959\d{8}|5959\d{8})$/;

  for (const t of tokens) {
    const compactToken = t.replace(/[.\-]/g, "");
    if (fullPattern.test(compactToken)) return compactToken.replace(/^\+/, "");
  }

  for (let i = 0; i < tokens.length; i++) {
    if (!/^\d+$/.test(tokens[i]) || !tokens[i].startsWith("09")) continue;
    let acc = tokens[i];
    for (let j = i + 1; j < tokens.length && acc.length < 10; j++) {
      if (!/^\d+$/.test(tokens[j])) break;
      if (acc.length + tokens[j].length > 11) break;
      acc += tokens[j];
    }
    if (/^09\d{8,9}$/.test(acc)) return acc;
  }

  return "";
}

function looksLikePriceMention(text: string) {
  const raw = clean(text);
  if (!raw) return false;
  return /\d{1,3}(?:[.,]\d{3})+/.test(raw) || /\b\d{4,7}\b/.test(raw);
}

function parsePriceMentions(text: string): number[] {
  const raw = clean(text);
  const matches = raw.match(/\d{1,3}(?:[.,]\d{3})+|\b\d{4,7}\b/g) || [];
  return matches
    .map((m) => Number(m.replace(/[.,]/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 10000 && n <= 10000000);
}

function extractQuantityFromPriceMention(
  text: string,
  productInfo: ProductItem | null,
  templatePricing: TemplatePricing | null
): number {
  if (!productInfo) return 0;

  const mentioned = parsePriceMentions(text);
  if (!mentioned.length) return 0;

  const candidateOffers: { quantity: number; total: number }[] = [];

  if (productInfo.price1) candidateOffers.push({ quantity: 1, total: productInfo.price1 });
  if (productInfo.price2) candidateOffers.push({ quantity: 2, total: productInfo.price2 });
  if (productInfo.price3) candidateOffers.push({ quantity: 3, total: productInfo.price3 });
  if (productInfo.fixedPackQuantity && productInfo.price1) {
    candidateOffers.push({ quantity: productInfo.fixedPackQuantity, total: productInfo.price1 });
  }

  if (templatePricing && normalize(templatePricing.product) === normalize(productInfo.canonical)) {
    for (const o of templatePricing.offers || []) {
      candidateOffers.push({ quantity: o.quantity, total: o.total });
    }
  }

  for (const price of mentioned) {
    const match = candidateOffers.find((o) => o.total === price);
    if (match) return match.quantity;
  }

  return 0;
}

function toTitleCase(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}


function looksLikeAddressSupplement(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!n || isQuestionLikeMessage(raw)) return false;

  // Frases conversacionales sobre quién recibe o paga NO son direcciones.
  if (
    /\b(si|por si|cuando)\s+(?:yo\s+)?no\s+(?:estoy|este|esté|voy a estar)\s+en\s+casa\b/.test(n) ||
    /\b(dejar|dejo|dejare|dejaré|dar|doy)\s+(?:la\s+)?(?:plata|dinero|efectivo)\s+a\s+alguien\b/.test(n) ||
    /\b(alguien|otra persona|familiar|vecino|encargado)\b[\s\S]{0,50}\b(paga|pague|recibe|reciba)\b/.test(n)
  ) {
    return false;
  }

  const strongAddressCue =
    /\b(calle|avda|avenida|ruta|km|barrio|bario|bsrrio|bo|esquina|numero|nro|manzana|mz|lote|edificio|piso|departamento|porteria|portería|referencia)\b/.test(n) ||
    /^(?:b+a?r+r?i?o|bsrrio|bo)\s+[a-z]/.test(n) ||
    /\b(entre calles?|al lado de|frente a|cerca de|detras de|detrás de)\b/.test(n);

  // “casa” por sí sola es demasiado ambigua; exige estructura de ubicación.
  const structuredHomeAddress =
    /\b(?:mi casa|casa)\s+(?:queda|esta|está|es|sobre|en|frente|al lado|cerca)\b/.test(n) ||
    /\b(?:frente|lado|esquina|cerca|detras|detrás)\s+(?:de\s+)?(?:la\s+)?casa\b/.test(n);

  return strongAddressCue || structuredHomeAddress;
}

function mergeAddressSupplement(currentAddress: string, supplement: string): string {
  const current = clean(currentAddress);
  const extra = clean(supplement);
  if (!current) return extra;
  if (!extra) return current;

  const currentNorm = normalize(current);
  const extraNorm = normalize(extra);

  if (currentNorm === extraNorm || currentNorm.includes(extraNorm)) return current;
  if (extraNorm.includes(currentNorm)) return extra;

  return `${current} — ${extra}`;
}

function isIdentityDocumentText(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw) return false;

  return (
    /\b(ci|cedula|cédula|documento|ruc)\b/.test(n) ||
    /^\s*\d{1,3}(?:[.\s]\d{3}){1,2}(?:[-\s]\d)?\s*$/.test(raw) ||
    /^\s*\d{5,9}-\d\s*$/.test(raw)
  );
}

function isDeliveryTimingMessage(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return false;

  return (
    isTemporalDeliveryExpression(raw) ||
    /\b(hoy|manana|mañana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(n) ||
    /\b(hasta|desde|antes|despues|después|a las|hora|horario)\b[\s\S]{0,30}\b\d{1,2}(?::\d{2})?\s*(?:hs|hrs|am|pm)?\b/.test(n)
  );
}

function isInvoiceQuestion(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return false;

  const mentionsInvoice =
    /\b(factura|factura legal|facturar|facturacion|facturación|credito fiscal|crédito fiscal)\b/.test(n);

  if (!mentionsInvoice) return false;

  // Una pregunta o consulta general sobre factura NO es un dato fiscal.
  return (
    /[?¿]/.test(raw) ||
    /\b(tienen|tenes|tenés|dan|emiten|hacen|incluye|con|hay|pueden|se puede|quiero|necesito)\b[\s\S]{0,35}\bfactura\b/.test(n) ||
    /\bfactura\b[\s\S]{0,35}\b(tienen|dan|emiten|legal|incluye|hay|pueden|se puede)\b/.test(n)
  );
}

function isInvoiceOrTaxDataMessage(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return false;

  return (
    /\b(factura|factura legal|con factura|sin factura|facturar|facturacion|facturación|comprobante legal|credito fiscal|crédito fiscal)\b/.test(n) ||
    /\b(ruc|razon social|razón social|nombre de factura|datos para factura|datos de facturacion|datos de facturación)\b/.test(n) ||
    /\bfactura\s+(?:a|al)\s+nombre\s+de\b/.test(n) ||
    /\b(?:mi|el)\s+ruc\s+(?:es|seria|sería)?\s*[:#-]?\s*\d/.test(n)
  );
}

function isStandaloneTaxOrIdentityData(text: string): boolean {
  const raw = clean(text);
  if (!raw) return false;

  return (
    /^(?:ruc|ci|cedula|cédula|documento)\s*[:#-]?\s*\d[\d.\-\s]{4,}$/i.test(raw) ||
    /^(?:razon social|razón social)\s*[:#-]\s*.+$/i.test(raw) ||
    /^\d{5,9}-\d$/.test(raw.replace(/[.\s]/g, ""))
  );
}


function isPoliteClosingOrAcknowledgement(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /^(?:bueno\s+)?(?:muchas|muchisimas|muchísimas)?\s*gracias(?:\s+(?:igualmente|por todo|por la atencion|por la atención))?$/i.test(n) ||
    /^(?:ok|okay|dale|listo|perfecto|bueno|genial|excelente|joya|esta bien|está bien)\s*,?\s*gracias$/i.test(n) ||
    /^(?:gracias|muchas gracias|muchisimas gracias|muchísimas gracias|bueno gracias|gracias igualmente|de acuerdo gracias|todo bien gracias)$/i.test(n) ||
    /^(?:ok|okay|dale|listo|perfecto|bueno|genial|excelente|joya|👍|👌|🙏)$/i.test(n)
  );
}


function isPayOnDeliveryRequest(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(pago|pagar|abona|abono|quiero pagar|puedo pagar)\b[\s\S]{0,45}\b(cuando llegue|cuando me llegue|cuando entreguen|cuando me entreguen|al recibir|contra entrega|en la entrega)\b/.test(n) ||
    /\b(al recibir|contra entrega|cuando llegue|cuando entreguen|cuando me entreguen)\b[\s\S]{0,45}\b(pago|pagar|efectivo|transferencia)\b/.test(n) ||
    /^(pago cuando me entreguen|pago al recibir|quiero pagar al recibir|contra entrega)$/i.test(n)
  );
}

function buildPayOnDeliveryResponse(state: ConversationState): string {
  const city = clean(state.order.city);

  if (!city) {
    return "😊 Para confirmarte si podés pagar al recibir, primero indicame de qué ciudad sos. 📍";
  }

  if (state.coverage === true) {
    const continuation = !state.order.customer_name
      ? "\n\nAhora solo necesito tu nombre y apellido."
      : !state.order.address
        ? "\n\nAhora solo me falta la calle o dirección exacta para la entrega."
        : "";

    return `✅ Sí, para ${city} podés pagar cuando recibís tu pedido, en efectivo o por transferencia al delivery.${continuation}`;
  }

  return `📍 Para ${city} el envío se realiza por transportadora y no contamos con pago contra entrega.

💳 Para este destino el pago es anticipado por transferencia.
📎 Después del pago, enviame la foto o PDF del comprobante para confirmar el pedido.`;
}

function isPaymentInformationQuestion(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(como|cómo|cual|cuál|que|qué)\b[\s\S]{0,35}\b(pago|pagar|transferencia|efectivo|contra entrega)\b/.test(n) ||
    /\b(tengo que|se puede|puedo|debo)\b[\s\S]{0,30}\b(pagar|hacer transferencia|transferir)\b/.test(n) ||
    /\b(formas?|metodos?|métodos?)\s+de\s+pago\b/.test(n)
  );
}

function isDeliveryCostQuestion(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(delivery|envio|envío|entrega|flete|transportadora|encomienda)\b[\s\S]{0,40}\b(cuanto|cuánto|costo|cuesta|sale|paga|pagar|gratis)\b/.test(n) ||
    /\b(cuanto|cuánto|costo|cuesta|sale|paga|pagar)\b[\s\S]{0,40}\b(delivery|envio|envío|entrega|flete|transportadora|encomienda)\b/.test(n) ||
    /\b(el|la)?\s*(delivery|envio|envío)\s+es\s+gratis\b/.test(n)
  );
}

function buildDeliveryCostResponse(state: ConversationState): string {
  const city = clean(state.order.city);
  if (!city) {
    return "🚚 Para confirmarte el costo del envío, decime primero tu ciudad.";
  }

  if (state.coverage === true) {
    return `🚚 El delivery a ${city} es GRATIS 😊\nPagás solamente el producto cuando lo recibís.`;
  }

  return `🚚 Hasta ${city} enviamos por transportadora.\n\nEl costo de la encomienda lo define la transportadora según el destino y no está incluido en el precio del producto.\n\nPara este tipo de envío trabajamos con pago anticipado.`;
}

function extractExplicitKnownCityFromSentence(text: string, parsed: ParsedTraining): string {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return "";

  // Respaldo determinístico para Asunción y área metropolitana.
  // Se ejecuta antes de cualquier análisis difuso o de precio.
  const hardKnownCities: Array<[RegExp, string]> = [
    [/\b(asuncion|asu)\b/i, "Asunción"],
    [/\b(fernando de la mora|fdo de la mora|fndo de la mora|fdo dela mora|fndo dela mora)\b/i, "Fernando de la Mora"],
    [/\bsan lorenzo\b/i, "San Lorenzo"],
    [/\bluque\b/i, "Luque"],
    [/\b(lambare)\b/i, "Lambaré"],
    [/\b(mariano roque alonso|mra)\b/i, "Mariano Roque Alonso"],
    [/\b(cde|ciudad del este|cdad del este)\b/i, "Ciudad del Este"],
  ];

  for (const [pattern, canonical] of hardKnownCities) {
    if (pattern.test(n)) return canonical;
  }

  // V66: detecta ciudad conocida en frases naturales, tanto antes como
  // después del indicador de ciudad.
  // Ejemplos: "soy de Areguá", "quiero para Areguá",
  // "Areguá es mi ciudad", "mi ciudad es Areguá".
  const hasCityContext =
    /\b(soy de|soi de|vivo en|estoy en|resido en|mi ciudad es|mi ciudad seria|mi ciudad sería|para|para la ciudad de|quiero para|necesito para|envio a|envío a|delivery a|mandar a|enviar a|entrega en|entrega a)\b/.test(n) ||
    /\b(es|seria|sería)\s+mi\s+ciudad\b/.test(n) ||
    /\bmi\s+ciudad\b/.test(n);

  if (!hasCityContext) return "";

  const ordered = [...(parsed.cities || [])].sort(
    (a, b) =>
      Math.max(normalize(b.alias).length, normalize(b.canonical).length) -
      Math.max(normalize(a.alias).length, normalize(a.canonical).length)
  );

  for (const city of ordered) {
    const aliases = Array.from(new Set([city.alias, city.canonical].map(normalize).filter(Boolean)));

    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const cityRegex = new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i");
      if (cityRegex.test(n)) return city.canonical;
    }
  }

  return "";
}

function splitCompositeMessage(text: string): string[] {
  return clean(text)
    .split(/(?:\r?\n|[.!?]+\s+|;\s*)/g)
    .map(clean)
    .filter(Boolean);
}

function extractCompositeAddress(text: string, detectedCity: string, phone: string, name: string): string {
  const pieces = splitCompositeMessage(text);
  const selected: string[] = [];

  for (const piece of pieces) {
    const n = normalize(piece);
    if (!n) continue;
    if (isPaymentInformationQuestion(piece)) continue;
    if (isInvoiceOrTaxDataMessage(piece) || isStandaloneTaxOrIdentityData(piece)) continue;
    if (isDeliveryTimingMessage(piece)) continue;
    if (isPoliteClosingOrAcknowledgement(piece)) continue;
    if (phone && piece.includes(phone)) continue;
    if (name && normalize(piece).includes(normalize(name))) continue;

    const locationCue =
      /\b(barrio|bario|bsrrio|calle|avenida|avda|ruta|km|casa|edificio|piso|departamento|dpto|manzana|mz|lote|puerto|compania|compañia|colonia|fraccion|fracción|asentamiento|zona|referencia|cerca|cuadra|ferreteria|ferretería|bodega|supermercado|iglesia|escuela|colegio|plaza|hospital|farmacia|frente|esquina|al lado|detras|detrás)\b/.test(n) ||
      /-?\d{2}\.\d{3,}\s*,\s*-?\d{2}\.\d{3,}/.test(piece);

    if (!locationCue) continue;

    let cleanedPiece = clean(piece)
      .replace(/^\s*(?:yo\s+)?(?:soy|vivo|estoy)\s+(?:de|en)\s+/i, "")
      .replace(/^\s*(?:mi\s+)?(?:direccion|dirección|ubicacion|ubicación|referencia)\s*(?:es|:|-)?\s*/i, "");

    if (detectedCity) {
      const cityPattern = detectedCity
        .split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      cleanedPiece = cleanedPiece.replace(new RegExp(`^${cityPattern}\\s*[,;-]?\\s*`, "i"), "");
    }

    if (cleanedPiece && !selected.some((x) => normalize(x) === normalize(cleanedPiece))) {
      selected.push(cleanedPiece);
    }
  }

  return selected.join(" — ");
}

function isExplicitNameCorrection(text: string): boolean {
  const n = normalize(text);
  return /\b(mi nombre correcto es|corregir nombre|cambiar el nombre a|cambia el nombre a|el pedido es para|poner a nombre de)\b/.test(n);
}

/**
 * V64: una declaración de procedencia nunca puede ser un nombre de cliente.
 * Ejemplos bloqueados: "Soy de Areguá", "Vivo en Luque",
 * "Estoy en Asunción" y "Para San Lorenzo" cuando el texto es solo ciudad.
 */
function isLocationDeclarationInsteadOfName(text: string, parsed?: ParsedTraining): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!n) return false;

  if (/^(?:hola\s+)?(?:yo\s+)?(?:soy|soi|vivo|resido|estoy|somos)\s+(?:de|en)\b/.test(n)) {
    return true;
  }

  if (/^(?:mi\s+)?(?:ciudad|localidad|zona)\s+(?:(?:es|seria|sería)\b|de\s+)/.test(n)) {
    return true;
  }

  if (/^(?:la\s+)?ciudad\s+de\s+/.test(n)) return true;

  if (!parsed) return false;

  const city = canonicalizeStoredCity(raw, parsed);
  const cityNorm = normalize(city);
  const known = parsed.cities.some((item) => {
    const alias = normalize(item.alias);
    const canonical = normalize(item.canonical);
    return cityNorm === alias || cityNorm === canonical;
  });

  if (!known) return false;

  if (n === cityNorm) return true;
  if (/^(?:para|de|desde|hacia)\s+/.test(n) && n.includes(cityNorm)) return true;

  return false;
}

function isContaminatedCustomerName(value: string, parsed: ParsedTraining): boolean {
  const raw = clean(value);
  const n = normalize(raw);
  if (!n) return true;

  // V101: para cerrar un pedido se requiere nombre y apellido reales.
  // Nunca aceptar textos de interfaz o frases tomadas del propio bot.
  const nameWords = raw.split(/\s+/).map(clean).filter(Boolean);
  if (nameWords.length < 2 || nameWords.length > 5) return true;
  if (/\d/.test(raw)) return true;
  if (/\b(nombre|apellido|nombre y apellido|tu nombre|cliente|usuario|contacto|y apellido)\b/.test(n)) return true;
  if (/^(?:y\s+)?apellido$/.test(n)) return true;
  if (/\b(quiero|me interesa|pedido|producto|cantidad|unidad|unidades|precio|delivery|envio|factura|direccion|ubicacion)\b/.test(n)) return true;

  if (isLocationDeclarationInsteadOfName(raw, parsed)) return true;

  if (/^(?:soy|soi|vivo|resido|estoy|somos)\s+(?:de|en)\b/.test(n)) return true;
  if (/^(?:la\s+)?ciudad\s+de\s+/.test(n)) return true;
  if (/^(?:para|de|desde)\s+(?:la\s+)?(?:ciudad\s+de\s+)?/.test(n)) {
    const city = canonicalizeStoredCity(raw, parsed);
    if (normalize(city) !== n) return true;
  }

  // V69: bloquea nombres contaminados que mezclan ciudad con una frase
  // conversacional o pregunta. Ej.: "ASUNCION ESTOY YO CUANTO ES EL DELIVERY".
  const containsKnownCity = parsed.cities.some((city) => {
    const aliases = Array.from(new Set([city.alias, city.canonical].map(normalize).filter(Boolean)));
    return aliases.some((alias) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(n);
    });
  });

  if (
    containsKnownCity &&
    /\b(estoy|soy|vivo|resido|yo|cuanto|cuesta|sale|delivery|envio|entrega|donde|como|gratis)\b/.test(n)
  ) {
    return true;
  }

  return parsed.cities.some((city) => {
    const alias = normalize(city.alias);
    const canonical = normalize(city.canonical);
    return n === alias || n === canonical || n === `soy de ${alias}` || n === `soy de ${canonical}` || n === `vivo en ${alias}` || n === `vivo en ${canonical}` || n === `estoy en ${alias}` || n === `estoy en ${canonical}`;
  });
}


function isInvalidCustomerNameForOrder(
  value: string,
  city: string,
  parsed: ParsedTraining
): boolean {
  const raw = clean(value);
  const n = normalize(raw);
  const cityNorm = normalize(city);

  if (!raw || isContaminatedCustomerName(raw, parsed)) return true;

  // V124: el nombre del producto o cualquiera de sus alias nunca puede ser
  // utilizado como nombre del cliente. Ej.: "Afilador de cuchillo".
  const matchesProductName = parsed.products.some((product) => {
    const productNames = [
      product.product,
      product.canonical,
      product.palabra_clave,
      ...(product.aliases || []),
    ]
      .flatMap((item) => splitKeywordAliases(clean(item)))
      .map(normalize)
      .filter(Boolean);

    return productNames.some((productName) =>
      n === productName ||
      n === `el ${productName}` ||
      n === `la ${productName}`
    );
  });

  if (matchesProductName) return true;

  if (
    /\b(noo+|nop+|qro|kiero|quiero|voia|voy|poder|solo|solamente|pra|prfavor|porfa|favor|combo|promo|crema|producto|para mi)\b/.test(n) ||
    /^(yo|no|noo+|nop+|n|qro|kiero|quiero|solo|solamente)\b/.test(n)
  ) {
    return true;
  }

  if (
    cityNorm &&
    (
      n === cityNorm ||
      n === `soy de ${cityNorm}` ||
      n === `vivo en ${cityNorm}` ||
      n === `estoy en ${cityNorm}`
    )
  ) {
    return true;
  }

  return parsed.cities.some((item) => {
    const aliases = [item.alias, item.canonical].map(normalize).filter(Boolean);
    return aliases.some((alias) => n === alias);
  });
}

function isPendingTransferStatus(value: string): boolean {
  const n = normalize(value);
  if (!n) return false;

  return /\b(pendiente|en proceso|procesando|solicitamos el envio|solicitado el envio|acreditacion dependera|pendiente de acreditacion|por acreditar|en revision|esperando acreditacion|transferencia enviada)\b/.test(n);
}


/**
 * V111: separa nombre cuando ciudad + dirección + cliente llegan en una sola línea.
 * Ej.: "AREGUA CABAALLERO CASI RCA DE COLOMBIA MARTA CABALLERO"
 *      ciudad=Areguá, dirección=Caballero casi Rca. de Colombia,
 *      cliente=Marta Caballero.
 */
function extractTrailingNameFromCompositeLine(
  text: string,
  detectedCity: string,
  phone: string,
  parsed?: ParsedTraining
): string {
  let raw = stripPhoneFromAddress(clean(text), phone);
  if (!raw || /[?¿]/.test(raw)) return "";

  // Retirar la ciudad detectada, aunque esté al principio de la línea.
  const cityNames = Array.from(new Set([
    detectedCity,
    ...(parsed?.cities || []).flatMap((c) => [c.alias, c.canonical]),
  ].map(clean).filter(Boolean))).sort((a, b) => b.length - a.length);

  for (const cityName of cityNames) {
    const escaped = normalize(cityName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const normalizedRaw = normalize(raw);
    const match = normalizedRaw.match(new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i"));
    if (!match || match.index == null) continue;

    // Usamos los tokens normalizados para quitar solo la primera coincidencia.
    const cityTokens = normalize(cityName).split(/\s+/).filter(Boolean);
    const rawTokens = raw.split(/\s+/).filter(Boolean);
    const normalizedTokens = rawTokens.map(normalize);
    for (let i = 0; i <= normalizedTokens.length - cityTokens.length; i++) {
      if (cityTokens.every((token, j) => normalizedTokens[i + j] === token)) {
        rawTokens.splice(i, cityTokens.length);
        raw = rawTokens.join(" ");
        break;
      }
    }
    break;
  }

  raw = clean(raw).replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "");
  const n = normalize(raw);
  const addressCue = /\b(calle|callejon|avenida|avda|ruta|km|barrio|bario|bsrrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|porteria|referencia|rca|republica|cai|colombia)\b/;
  if (!addressCue.test(n)) return "";

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return "";

  const forbiddenNameWord = /^(calle|avenida|avda|ruta|km|barrio|bario|bsrrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|porteria|referencia|rca|republica|cai|colombia|de|del|la|el)$/i;

  // El nombre suele estar al final. Probamos 2, 3 y 4 palabras, priorizando 2.
  for (const size of [2, 3, 4]) {
    if (tokens.length <= size) continue;
    const candidateTokens = tokens.slice(-size);
    const candidate = candidateTokens.join(" ");
    const candidateNorm = normalize(candidate);

    if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(candidate)) continue;
    if (candidateTokens.some((w) => forbiddenNameWord.test(normalize(w)))) continue;
    if (/\b(precio|delivery|envio|producto|unidad|gracias|quiero|comprar)\b/.test(candidateNorm)) continue;
    if (parsed && isContaminatedCustomerName(candidate, parsed)) continue;
    if (detectedCity && candidateNorm === normalize(detectedCity)) continue;

    const addressPart = tokens.slice(0, -size).join(" ");
    if (!addressCue.test(normalize(addressPart))) continue;

    return toTitleCase(candidate);
  }

  return "";
}

function extractName(text: string, detectedCity: string, phone: string, parsed?: ParsedTraining, allowImplicitName = false) {
  const normalizedRawNameInput = normalize(text);
  if (/\b(hice mi pedido|ya hice mi pedido|mi pedido|pedido confirmado|pedido realizado)\b/.test(normalizedRawNameInput)) return "";

  const raw = clean(text);
  if (!raw) return "";

  // V112: respuestas conversacionales, rechazos, pedidos y frases abreviadas
  // nunca son nombres. Evita guardar “Noo Yo”, “Yo qro”, “N voia”, etc.
  if (
    /\b(?:noo+|nop+|nono|n\s+vo(?:y|i)a?|no\s+voy|yo\s+qro|yo\s+quiero|qro|kiero|pra\s+m|para\s+mi|porfa|prfavor|favor|combo|promo)\b/.test(
      normalizedRawNameInput
    ) ||
    /^(?:no+|noo+|nop+|n|yo|qro|kiero|quiero|solo|solamente)(?:\s+|$)/.test(
      normalizedRawNameInput
    )
  ) {
    return "";
  }

  // V98: extrae primero un nombre declarado explícitamente aunque el mismo
  // mensaje también contenga cantidad y ciudad. Ejemplo:
  // “quiero uno para Capiatá, mi nombre es David Alcaraz”.
  const explicitNameInMixedMessage = raw.match(
    /\b(?:mi nombre es|me llamo|nombre)\s*[:,-]?\s*([a-zA-ZÁÉÍÓÚáéíóúÑñ]+(?:\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ]+){1,4})(?=\s*(?:[,.;]|$))/i
  )?.[1];

  if (explicitNameInMixedMessage) {
    const candidate = clean(explicitNameInMixedMessage);
    const words = candidate.split(/\s+/).filter(Boolean);
    const candidateNorm = normalize(candidate);
    const forbiddenExplicitName =
      words.length < 2 ||
      words.length > 5 ||
      /\d/.test(candidate) ||
      /\b(calle|avenida|avda|barrio|ciudad|delivery|envio|precio|producto|unidad|unidades)\b/.test(candidateNorm) ||
      isDeferredLocationMessage(candidate) ||
      isConversationalLocationPhrase(candidate) ||
      (parsed ? isContaminatedCustomerName(candidate, parsed) : false);

    if (!forbiddenExplicitName) return toTitleCase(candidate);
  }

  // V126: frases conversacionales o de ubicación nunca son nombres.
  if (isDeferredLocationMessage(raw) || isConversationalLocationPhrase(raw)) return "";

  // Los nombres implícitos solo se aceptan cuando el flujo está esperando nombre.
  if (!allowImplicitName) return "";
  if (!isStrictStandaloneCustomerName(raw, detectedCity, parsed)) return "";

  const trailingCompositeName = extractTrailingNameFromCompositeLine(
    raw,
    detectedCity,
    phone,
    parsed
  );
  if (trailingCompositeName) return trailingCompositeName;

  if (isPoliteClosingOrAcknowledgement(raw)) return "";
  if (isPaymentInformationQuestion(raw)) return "";
  if (isQuestionLikeMessage(raw)) return "";
  if (/^(?:si|sii|siii|sip|asi es|correcto|exacto)\b/.test(normalize(raw))) return "";
  if (/\b(?:ustedes de donde|de donde traen|de donde viene|cuentan con delivery|tienen delivery|hay delivery)\b/.test(normalize(raw))) return "";
  // La cantidad solo bloquea nombres implícitos. Los explícitos ya fueron
  // extraídos arriba de forma segura.
  if (extractQuantity(raw) > 0) return "";
  if (looksLikeAddressSupplement(raw)) return "";
  if (isIdentityDocumentText(raw)) return "";
  if (isDeliveryTimingMessage(raw)) return "";
  if (isInvoiceOrTaxDataMessage(raw) || isStandaloneTaxOrIdentityData(raw)) return "";
  if (/^(?:la\s+)?ciudad\s+de\s+/i.test(normalize(raw))) return "";
  if (isLocationDeclarationInsteadOfName(raw, parsed)) return "";

  // V95: abreviaturas de calles, avenidas y referencias nunca son nombres.
  if (
    /^(?:fdo|fdo\.|fndo|av|av\.|avda|rca|gral|mcal)\s+(?:de\s+)?/i.test(raw) ||
    /\b(pinedo|padres jesuitas|jesuitas)\b/i.test(normalize(raw))
  ) {
    return "";
  }

  // V93: una frase que contiene una ciudad conocida y no declara nombre
  // nunca puede convertirse en cliente. Ej.: "En Ciudad del Este".
  if (
    parsed &&
    extractExplicitKnownCityFromSentence(raw, parsed) &&
    !/\b(mi nombre es|me llamo|soy)\b/.test(normalize(raw))
  ) {
    return "";
  }

  // V69: cualquier mensaje que contenga una ciudad conocida junto con una
  // consulta de delivery o una declaración de ubicación no puede ser nombre.
  // Esto evita guardar "ASUNCION ESTOY" como cliente.
  if (parsed) {
    const n = normalize(raw);
    const containsKnownCity = parsed.cities.some((city) => {
      const aliases = Array.from(new Set([city.alias, city.canonical].map(normalize).filter(Boolean)));
      return aliases.some((alias) => {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`, "i").test(n);
      });
    });

    if (
      containsKnownCity &&
      /\b(estoy|soy|vivo|resido|yo|cuanto|cuesta|sale|delivery|envio|entrega|gratis|donde|como)\b/.test(n)
    ) {
      return "";
    }
  }

  // Mensajes mixtos como "quiero uno para Asunción Roberto Lpetti el precio..."
  // no deben convertirse completos en nombre. Solo aceptamos correcciones
  // explícitas o dejamos el nombre pendiente para pedirlo de forma segura.
  if (
    parsed &&
    extractExplicitKnownCityFromSentence(raw, parsed) &&
    (looksLikePriceMention(raw) || extractQuantity(raw) > 0 || /\b(quiero|quisiera|llevo|para)\b/.test(normalize(raw)))
  ) {
    const explicitMixed = raw.match(/\b(?:mi nombre es|me llamo|nombre)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ]+(?:\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ]+){1,4})/i)?.[1];
    return explicitMixed ? toTitleCase(clean(explicitMixed)) : "";
  }

  const isMultiLine = raw.includes("\n");
  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

  if (parsed && !isMultiLine && !extractPhone(raw)) {
    const normRaw = normalize(raw);
    const isOnlyCity = parsed.cities.some((c) => {
      const a = normalize(c.alias);
      const cn = normalize(c.canonical);
      return a && (normRaw === a || normRaw === cn);
    });
    if (isOnlyCity) return "";
  }

  const forbidden = [
    "quiero", "comprar", "me interesa", "precio", "delivery",
    "envio", "ok", "dale", "si", "hola", "buenas", "gracias",
    "cuanto", "cuando", "dia", "llega", "llego", "pedido",
    "cancelar", "no", "nebulizador", "raqueta", "que",
    "estado", "seguimiento", "ya", "fue", "como", "donde",
    "unidad", "unidades", "und", "unds", "una unidad", "dos unidades",
    "una", "uno", "dos", "tres", "cuatro", "cinco",
    "traen", "trae", "traes", "mandan", "manda", "mandas",
    "cdo", "xq", "xfa", "xfavor", "porfavor", "porfa",
    "me", "te", "se", "lo", "la", "les", "nos",
    "para", "con", "por", "del", "mas",
    "bueno muchas gracias", "muchisimas gracias", "muchísimas gracias",
    "bueno gracias", "gracias igualmente", "ok gracias", "dale gracias",
    "listo gracias", "perfecto gracias", "esta bien gracias", "está bien gracias",
  ];

  const questionVerbs =
    /\b(traen|trae|mandan|llegan|llega|entrega|viene|vienen|cuesta|cobran|demora|tarda)\b/;

  const isValidNameLine = (line: string): boolean => {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);
    const words = cleaned.split(/\s+/).filter(Boolean);

    if (isPoliteClosingOrAcknowledgement(cleaned)) return false;
    if (isPaymentInformationQuestion(cleaned)) return false;
    if (isLocationDeclarationInsteadOfName(cleaned, parsed)) return false;
    if (parsed && isContaminatedCustomerName(cleaned, parsed)) return false;
    if (words.length < 2 || words.length > 5) return false;
    if (/\d/.test(cleaned)) return false;
    if (!/^[a-zA-ZÁÉÍÓÚáéíóúÑñ\s]+$/.test(cleaned)) return false;
    if (cleaned.length < 4 || cleaned.length > 60) return false;
    if (/\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|esquina|casi|san pedro|santa|bario|pinedo|padres jesuitas|jesuitas)\b/i.test(normLine)) return false;
    if (/\b(noo+|nop+|qro|kiero|quiero|voia|voy|poder|solo|solamente|pra|prfavor|porfa|favor|combo|promo|crema|producto|para mi)\b/i.test(normLine)) return false;
    if (/^(yo|no|noo+|nop+|n|qro|kiero|quiero|solo|solamente)\b/i.test(normLine)) return false;
    if (/^(fdo|fdo\.|fndo|av|av\.|avda|rca|gral|mcal)\b/i.test(normLine)) return false;
    if (/\b(?:fdo|fdo\.|fndo)\s+de\b/i.test(normLine)) return false;
    if (questionVerbs.test(normLine)) return false;
    if (detectedCity && normalize(cleaned) === normalize(detectedCity)) return false;
    if (forbidden.some((f) => normLine === normalize(f) || normLine.startsWith(normalize(f) + " ") || normLine.endsWith(" " + normalize(f)))) return false;
    if (words[0].length === 1) return false;
    if (/^(y |ese |esta |este |eso |esa |aqui |ahi |ya |igual |listo |ok |dale )/i.test(normLine)) return false;
    if (/\b(este es|ese es|eso es|este soy|soy yo|ese soy)\b/.test(normLine)) return false;
    return true;
  };

  const explicit = raw.match(/(?:mi nombre correcto es|cambiar el nombre a|cambia el nombre a|el pedido es para|poner a nombre de|me llamo|mi nombre es|nombre)\s*[:,-]?\s*([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{5,80})/i)?.[1];
  if (explicit) {
    const explicitClean = clean(explicit)
      .split(/\b(?:calle|callejon|callejón|avda|avenida|ruta|km|barrio|casa|frente|esquina|rca|republica|república)\b/i)[0];
    if (isValidNameLine(explicitClean)) return toTitleCase(explicitClean);
  }

  // V83: permite extraer el nombre aunque después venga inmediatamente
  // la dirección, sin depender del orden de los datos.
  const nameBeforeAddress = raw.match(
    /^\s*([a-zA-ZÁÉÍÓÚáéíóúÑñ]+(?:\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ]+){1,3})\s+(?=(?:calle|callejon|callejón|avda|avenida|ruta|km|barrio|casa|frente|esquina|rca|republica|república|[a-zA-ZÁÉÍÓÚáéíóúÑñ]+\s+(?:cai|casi))\b)/i
  )?.[1];
  if (nameBeforeAddress && isValidNameLine(nameBeforeAddress)) {
    return toTitleCase(clean(nameBeforeAddress));
  }

  const beforeSoy = raw.match(/^([a-zA-ZÁÉÍÓÚáéíóúÑñ]+(?:\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ]+){1,4})\s+soy\b/i)?.[1];
  if (beforeSoy && isValidNameLine(beforeSoy)) return toTitleCase(clean(beforeSoy));

  if (isMultiLine) {
    for (const line of lines) {
      const cleaned = clean(line);
      if (/\d{7,}/.test(cleaned)) continue;
      if (/\b(calle|avda|avenida|ruta|km|barrio|bo|casa|frente|esquina|casi|rca|colombia|republica|nro|manzana)\b/i.test(normalize(cleaned))) continue;
      if (isValidNameLine(cleaned)) return toTitleCase(cleaned);
    }
    return "";
  }

  if (isValidNameLine(raw)) return toTitleCase(raw);

  if (!isMultiLine) {
    const tokens = raw.split(/\s+/).filter(Boolean);
    const leadingWords: string[] = [];
    for (const t of tokens) {
      if (/\d/.test(t)) break;
      leadingWords.push(t);
    }
    if (leadingWords.length >= 2) {
      const candidate = leadingWords.slice(0, 2).join(" ");
      if (isValidNameLine(candidate)) return toTitleCase(candidate);
    }
  }

  return "";
}

function stripPhoneFromAddress(value: string, phone?: string): string {
  let result = clean(value);
  if (!result) return "";

  // Retira teléfonos paraguayos aun cuando vienen separados por espacios,
  // puntos, guiones o acompañados por “mi celular”, “teléfono”, etc.
  result = result.replace(/\b(?:mi\s+)?(?:celular|telefono|teléfono|tel|cel)(?:\s+(?:no|nro|numero|número))?\s*[:.#-]?\s*(?:\+?595\s*)?0?9\d(?:[\s.-]*\d){7,8}\b/gi, " ");
  result = result.replace(/\b(?:\+?595\s*)?0?9\d(?:[\s.-]*\d){7,8}\b/g, " ");

  if (phone) {
    const digits = clean(phone).replace(/\D/g, "");
    if (digits.length >= 9) {
      const flexible = digits.split("").map((d) => `${d}[\\s.-]*`).join("");
      result = result.replace(new RegExp(flexible, "g"), " ");
    }
  }

  return result
    .replace(/\b(?:mi\s+)?(?:celular|telefono|teléfono|tel|cel)(?:\s+(?:no|nro|numero|número))?\s*[:.#-]?\s*$/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s,;.-]+$/g, "")
    .trim();
}

function extractAddress(text: string, detectedCity: string, phone: string, name: string, parsed?: ParsedTraining) {
  if (isOnlyPurchaseWithSize(text)) {
    return "";
  }

  const raw = clean(text);
  const rawNorm = normalize(raw);

  // V126: una ubicación postergada no es una dirección.
  if (isDeferredLocationMessage(raw)) return "";

  // Ciudad + ruta/km/barrio/zona: guardar solo la referencia.
  if (parsed) {
    const cityInMessage = detectedCity || configuredCityInsideMessage(raw, parsed);
    const cityReference = extractReferenceAfterKnownCity(raw, cityInMessage, parsed);
    if (cityReference) return stripPhoneFromAddress(cityReference, phone);
  }

  // V123: una consulta o confirmación de precio jamás puede ser dirección,
  // aunque contenga varios números o más de tres palabras.
  if (isPriceQuery(raw)) return "";

  if (/^\d+\s*(unidad|unidades|u|und|unds)?$/i.test(raw)) return "";
  if (/^\d+$/.test(raw)) return "";

  const hasRealAddressCue =
    /\b(direccion|dirección|dir|ubicacion|ubicación|calle|callejon|callejón|avda|avenida|ruta|km|barrio|bario|bsrrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|dpto|porteria|portería|referencia|rca|republica|república|colombia)\b/.test(
      rawNorm
    ) ||
    raw.includes("maps.app") ||
    raw.includes("google.com/maps") ||
    /-?\d{2}\.\d{3,}\s*,\s*-?\d{2}\.\d{3,}/.test(raw);

  // V112: una consulta, rechazo, cantidad o frase comercial sin señales reales
  // de ubicación jamás debe agregarse a la dirección.
  if (
    !hasRealAddressCue &&
    (
      isQuestionLikeMessage(raw) ||
      isBuyIntent(raw) ||
      isGenericBuyReply(raw) ||
      extractQuantity(raw) > 0 ||
      /\b(precio|farmacia|cuanto|cuánto|qro|kiero|quiero|noo+|nop+|voia|voy|poder|solo|pra\s+m|para\s+mi|porfa|prfavor|combo|promo)\b/.test(rawNorm)
    )
  ) {
    return "";
  }
  if (isIdentityDocumentText(raw)) return "";
  if (isDeliveryTimingMessage(raw)) return "";
  if (isInvoiceOrTaxDataMessage(raw) || isStandaloneTaxOrIdentityData(raw)) return "";

  const lines = raw.split("\n").filter((l) => clean(l).length > 0);

  const explicit = raw.match(/(?:direccion|dirección|dir|ubicacion|ubicación)\s*[:\-]?\s*(.+)/i)?.[1];
  if (explicit) return stripPhoneFromAddress(explicit, phone);

  if (raw.includes("maps.app") || raw.includes("google.com/maps")) return raw;

  const compositeAddress = extractCompositeAddress(raw, detectedCity, phone, name);
  if (compositeAddress) return compositeAddress;

  // V83: nombre y dirección pueden llegar juntos y en cualquier orden.
  // Ej.: "David Alcaraz caaballero cai rca de colombia".
  // Si ya se detectó el nombre, se toma como dirección el resto del mensaje.
  if (name) {
    const escapedName = name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+");

    let remainder = raw.replace(new RegExp(`(?:^|\\b)${escapedName}(?:\\b|$)`, "i"), " ");


    if (detectedCity) {
      const escapedCity = detectedCity
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      remainder = remainder.replace(new RegExp(`(?:^|\\b)${escapedCity}(?:\\b|$)`, "i"), " ");
    }
    remainder = stripPhoneFromAddress(remainder, phone)
      .replace(/\s{2,}/g, " ")
      .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "")
      .trim();

    const remainderNorm = normalize(remainder);
    const hasAddressSignal =
      /\b(calle|callejon|callejón|avda|avenida|ruta|km|barrio|bario|bsrrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|porteria|portería|referencia|rca|republica|república|cai|colombia)\b/.test(remainderNorm) ||
      remainder.split(/\s+/).filter(Boolean).length >= 3;

    if (
      hasAddressSignal &&
      remainder.length >= 6 &&
      !isQuestionLikeMessage(remainder) &&
      !isPoliteClosingOrAcknowledgement(remainder) &&
      !isOnlyPurchaseWithSize(remainder) &&
      !isBuyIntent(remainder)
    ) {
      return remainder;
    }
  }

  for (const line of lines) {
    const cleaned = clean(line);
    const normLine = normalize(cleaned);

    if (/\b(calle|callejon|callejón|avda|avenida|ruta|km|barrio|bario|bsrrio|bo|casa|frente|lado|esquina|casi|numero|nro|manzana|mz|lote|edificio|piso|departamento|porteria|portería|referencia|rca|republica|república|cai|colombia)\b/i.test(normLine) || looksLikeAddressSupplement(cleaned)) {
      if (name && normalize(cleaned).includes(normalize(name))) continue;
      if (phone && cleaned.includes(phone)) continue;
      return stripPhoneFromAddress(cleaned, phone);
    }
  }

  if (/\d/.test(raw) && raw.length >= 8 && !isQuestionLikeMessage(raw)) {
    let remaining = raw;

    if (name) {
      const namePattern = name
        .split(/\s+/)
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s*");
      remaining = remaining.replace(new RegExp(namePattern, "i"), "").trim();
    }

    if (phone) {
      const phonePattern = phone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      remaining = remaining.replace(new RegExp(phonePattern, "g"), "").trim();
    }

    const wordsToRemove = ["soy", "me llamo", "mi nombre es", "nombre", "teléfono", "celular", "cel", "mi", "es"];
    for (const word of wordsToRemove) {
      remaining = remaining.replace(new RegExp(`\\b${word}\\b`, "gi"), "").trim();
    }

    remaining = stripPhoneFromAddress(remaining, phone);
    if (remaining.length >= 5) return remaining;
  }

  return "";
}

function mergeUniqueText(oldValue: any, newValue: any) {
  const oldText = clean(oldValue);
  const newText = clean(newValue);
  if (!oldText) return newText;
  if (!newText) return oldText;

  const pieces = oldText
    .split(/\s*\|\s*/g)
    .map(clean)
    .filter(Boolean);

  const exists = pieces.some((p) => normalize(p) === normalize(newText) || normalize(p).includes(normalize(newText)) || normalize(newText).includes(normalize(p)));
  if (!exists) pieces.push(newText);
  return pieces.join(" | ");
}

function hasOrderObservation(order: Partial<OrderData> | null | undefined) {
  return Boolean(
    clean(order?.observation) ||
    clean(order?.preferred_delivery_date) ||
    clean(order?.preferred_delivery_time) ||
    clean(order?.payment_note)
  );
}

function observationLines(order: Partial<OrderData> | null | undefined) {
  const values = [
    clean(order?.observation),
    clean(order?.payment_note),
    clean(order?.preferred_delivery_date),
    clean(order?.preferred_delivery_time),
  ].filter(Boolean);

  const unique: string[] = [];
  for (const value of values) {
    const parts = value.split(/\s*\|\s*/g).map(clean).filter(Boolean);
    for (const part of parts) {
      const normalizedPart = normalize(part);
      const alreadyIncluded = unique.some((existing) => {
        const normalizedExisting = normalize(existing);
        return (
          normalizedExisting === normalizedPart ||
          normalizedExisting.includes(normalizedPart) ||
          normalizedPart.includes(normalizedExisting)
        );
      });
      if (!alreadyIncluded) unique.push(part);
    }
  }

  return unique.length ? [`📝 Observación: ${unique.join(" | ")}`] : [];
}

function observationBlock(order: Partial<OrderData> | null | undefined) {
  const lines = observationLines(order);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

function isDeliveryTimingQuestion(text: string): boolean {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return false;
  return (
    /[?¿]/.test(raw) && /\b(hoy|manana|mañana|cuando|cuándo|que hora|qué hora|horario|entrega|llega|llegaria|llegaría|demora|tarda|tiempo)\b/.test(n)
  ) || /^(?:seria|sería|puede ser|llega|entregan|entrega)\s+(?:hoy|manana|mañana)\b/.test(n);
}

function isConfirmedDeliveryPreference(text: string): boolean {
  const n = normalize(text);
  if (!n || isDeliveryTimingQuestion(text)) return false;
  return (
    /\b(me queda bien|prefiero|quiero recibir|necesito recibir|anota|anotá|dejame|déjame|agendame|agéndame|puede ser|que sea)\b[\s\S]{0,80}\b(hoy|manana|mañana|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/.test(n) ||
    /\b(hoy|manana|mañana)\b[\s\S]{0,80}\b(me queda bien|me sirve|estare|estaré|puedo recibir|prefiero)\b/.test(n)
  );
}

function buildDeliveryTimingQuestionResponse(text: string, order: OrderData): string {
  const n = normalize(text);
  const requested = /\bmanana|mañana\b/.test(n) ? "mañana" : /\bhoy\b/.test(n) ? "hoy" : "la fecha consultada";
  const product = clean(order.product) ? ` de ${order.product}` : "";
  return `🚚 No podemos asegurar una hora exacta porque depende de la ruta del delivery. Tu pedido${product} se coordina según disponibilidad y el delivery te contacta antes de llegar.\n\n¿Querés que anote como preferencia de entrega para ${requested}?`;
}

function extractOrderObservation(text: string): Partial<OrderData> {
  const sizeVariant = extractSizeOrVariant(text);
  if (sizeVariant) {
    return { observation: sizeVariant };
  }

  const raw = clean(text);
  const n = normalize(raw);
  if (!raw || !n) return {};

  const obs: Partial<OrderData> = {};

  // V65: una pregunta sobre fecha/hora no se guarda como instrucción.
  // Solo se registra cuando el cliente confirma una preferencia real.
  if (isDeliveryTimingQuestion(raw)) return {};

  // Las preguntas informativas de pago se responden, pero no son observaciones.
  const paymentInfoQuestion = isPaymentInformationQuestion(raw);

  // V97: una PREGUNTA sobre factura se responde, pero no se guarda como observación.
  // Solo se conservan datos fiscales reales enviados por el cliente.
  const invoiceQuestion = isInvoiceQuestion(raw);
  const hasExplicitFiscalData =
    isStandaloneTaxOrIdentityData(raw) ||
    (/\b(ruc|razon social|razón social|cedula|cédula|ci)\b/.test(n) && /\d{5,}/.test(raw)) ||
    /^(?:razon social|razón social|nombre para factura)\s*[:#-]\s*.+$/i.test(raw);

  if (!invoiceQuestion && hasExplicitFiscalData) {
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  const dateWords = "hoy|manana|mañana|pasado|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo|fin de semana|quincena|fin de mes|[0-3]?\\d(?:\\/|-)[0-1]?\\d|[0-3]?\\d\\s*(?:de)?\\s*(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";
  const hourWords = "de manana|de mañana|de tarde|de noche|a la manana|a la mañana|a la tarde|a la noche|despues de|después de|antes de|hasta las|desde las|a las|mediodia|mediodía|tarde nomas|tarde nomás|manana nomas|mañana nomás|noche nomas|noche nomás|\\b\\d{1,2}(?::\\d{2})?\\s*(?:hs|hrs|pm|am)?\\b";

  if (!paymentInfoQuestion && /\b(no tengo plata|no tengo efectivo|no tengo dinero|sin plata|sin efectivo|ahora no tengo|cobro|cobrare|cobraré|cuando cobre|cuando cobro|cobrar|sueldo|salario|quincena|fin de mes|este mes|mes que viene|proximo mes|próximo mes|te pago|pago el|pagar el|voy a pagar|pago cuando|pagar cuando|recién cobro|recien cobro)\b/.test(n)) {
    obs.payment_note = raw;
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  const deliveryDateRegex = new RegExp(`\\b(recibir|recibo|recibirlo|entregar|entrega|traer|traigan|llevar|mandar|mandame|enviar|envio|envío|delivery|para)\\b[\\s\\S]{0,80}\\b(${dateWords})\\b`, "i");
  const dateOnlyIntentRegex = new RegExp(`\\b(quiero|necesito|puede ser|seria|sería|me sirve|agendar|reservar|dejar)\\b[\\s\\S]{0,80}\\b(${dateWords})\\b`, "i");
  if ((deliveryDateRegex.test(n) || dateOnlyIntentRegex.test(n)) && isConfirmedDeliveryPreference(raw)) {
    obs.preferred_delivery_date = raw;
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  const timeRegex = new RegExp(`\\b(${hourWords})\\b`, "i");
  if (timeRegex.test(n) && /\b(recibir|entregar|traer|llevar|mandar|enviar|delivery|estoy|puedo|solo|solamente|pasar|llegar|horario|hora|a las|despues|después|antes|hasta|desde|manana|mañana|tarde|noche)\b/.test(n)) {
    obs.preferred_delivery_time = raw;
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  const explicitCoordination = /\b(llamar antes|avisar antes|avisen antes|avisame antes|avísame antes|te aviso|yo aviso|les aviso|aviso luego|despues te aviso|después te aviso|avisar|coordinar|coordinamos|porteria|portería|guardia|dejar con|retira|retirar)\b/.test(n);
  const absenceCoordination = /\b(no estoy|no voy a estar|estoy solo|solo estoy)\b/.test(n) && /\b(casa|domicilio|direccion|dirección|entrega|delivery|recibir|horario|hora)\b/.test(n);
  if (explicitCoordination || absenceCoordination) {
    obs.observation = mergeUniqueText(obs.observation, raw);
  }

  return obs;
}

function mergeOrderObservation(oldOrder: Partial<OrderData>, patch: Partial<OrderData>) {
  return {
    observation: mergeUniqueText(oldOrder?.observation, patch?.observation),
    preferred_delivery_date: mergeUniqueText(oldOrder?.preferred_delivery_date, patch?.preferred_delivery_date),
    preferred_delivery_time: mergeUniqueText(oldOrder?.preferred_delivery_time, patch?.preferred_delivery_time),
    payment_note: mergeUniqueText(oldOrder?.payment_note, patch?.payment_note),
  };
}

function sanitizeOldOrder(old: any, parsed: ParsedTraining): OrderData {
  let productInfo = getProductInfo(old?.product || "", parsed);

  // V65: si una versión anterior guardó “Oferta HOY”, intentamos recuperar
  // el producto real desde locked_offer o dejamos el campo vacío para que el
  // producto actual/historial lo reponga; nunca confirmamos el genérico.
  if (isGenericProductLabel(old?.product)) {
    productInfo = getProductInfo(old?.locked_offer?.product || "", parsed);
  }
  const nameNorm = normalize(old?.customer_name || "");

  const forbiddenNames = [
    "quiero", "cuando", "dia", "llega", "llego", "pedido", "cancelar",
    "no", "raqueta", "nebulizador", "que", "estado", "seguimiento",
    "ya fue", "que dia llega mi pedido", "no raqueta",
    "y apellido", "nombre y apellido", "apellido", "tu nombre", "cliente", "usuario", "contacto",
  ];

  const isInvalidName =
    forbiddenNames.some((f) => nameNorm.includes(normalize(f))) ||
    nameNorm.split(" ").length > 5 ||
    isContaminatedCustomerName(clean(old?.customer_name || ""), parsed);

  const oldCity = clean(old?.city || "");
  const sanitizedCity = isQuestionLikeMessage(oldCity) || looksLikeSentenceNotCity(oldCity)
    ? ""
    : oldCity;

  return {
    order_id: clean(old?.order_id || ""),
    product: productInfo?.canonical || "",
    quantity: sanitizeQuantity(old?.quantity || 0),
    city: sanitizedCity,
    customer_name:
      old?.customer_name && nameNorm !== "quiero" && !isInvalidName
        ? clean(old.customer_name)
        : "",
    phone: clean(old?.phone || ""),
    address: clean(old?.address || ""),
    locked_offer: old?.locked_offer || null,
    payment_proof_received: !!old?.payment_proof_received,
    payment_proof_verified: !!old?.payment_proof_verified,
    payment_holder_name: clean(old?.payment_holder_name || ""),
    payment_amount: Number(old?.payment_amount || 0),
    payment_operation_number: clean(old?.payment_operation_number || ""),
    payment_status_text: clean(old?.payment_status_text || ""),
    payment_verification_error: clean(old?.payment_verification_error || ""),
    payment_recipient_name: clean(old?.payment_recipient_name || ""),
    payment_recipient_document: clean(old?.payment_recipient_document || ""),
    payment_recipient_account: clean(old?.payment_recipient_account || ""),
    payment_recipient_alias: clean(old?.payment_recipient_alias || ""),
    payment_recipient_bank: clean(old?.payment_recipient_bank || ""),
    payment_recipient_matched: !!old?.payment_recipient_matched,
    payment_proof_mime: clean(old?.payment_proof_mime || ""),
    payment_manual_review_required: !!old?.payment_manual_review_required,
    payment_manual_review_reason: clean(old?.payment_manual_review_reason || ""),
    observation: clean(old?.observation || old?.observacion || ""),
    preferred_delivery_date: clean(old?.preferred_delivery_date || ""),
    preferred_delivery_time: clean(old?.preferred_delivery_time || ""),
    payment_note: clean(old?.payment_note || ""),
  } as OrderData;
}

function mergeOrderData(old: OrderData, ext: any, product: string): OrderData {
  return {
    order_id: ext.order_id || old.order_id || "",
    product: !isGenericProductLabel(product)
      ? product
      : (!isGenericProductLabel(old.product) ? old.product : ""),
    quantity: ext.quantity > 0 ? sanitizeQuantity(ext.quantity) : sanitizeQuantity(old.quantity || 0),
    city: ext.city || old.city || "",
    // V64: un nombre válido se protege, pero un valor contaminado por ciudad
    // se reemplaza automáticamente cuando llega el nombre real.
    customer_name:
      old.customer_name && !ext.explicit_name_correction && !ext.old_name_is_contaminated
        ? old.customer_name
        : (ext.name || (ext.old_name_is_contaminated ? "" : old.customer_name) || ""),
    phone: ext.phone || old.phone || "",
    address: ext.address
      ? mergeAddressSupplement(old.address || "", ext.address)
      : old.address || "",
    locked_offer: ext.locked_offer !== undefined ? ext.locked_offer : old.locked_offer || null,
    payment_proof_received: ext.payment_proof_received !== undefined ? !!ext.payment_proof_received : !!old.payment_proof_received,
    payment_proof_verified: ext.payment_proof_verified !== undefined ? !!ext.payment_proof_verified : !!old.payment_proof_verified,
    payment_holder_name: clean(ext.payment_holder_name || old.payment_holder_name || ""),
    payment_amount: Number(ext.payment_amount || old.payment_amount || 0),
    payment_operation_number: clean(ext.payment_operation_number || old.payment_operation_number || ""),
    payment_status_text: clean(ext.payment_status_text || old.payment_status_text || ""),
    payment_verification_error: clean(ext.payment_verification_error || old.payment_verification_error || ""),
    payment_recipient_name: clean(ext.payment_recipient_name || old.payment_recipient_name || ""),
    payment_recipient_document: clean(ext.payment_recipient_document || old.payment_recipient_document || ""),
    payment_recipient_account: clean(ext.payment_recipient_account || old.payment_recipient_account || ""),
    payment_recipient_alias: clean(ext.payment_recipient_alias || old.payment_recipient_alias || ""),
    payment_recipient_bank: clean(ext.payment_recipient_bank || old.payment_recipient_bank || ""),
    payment_recipient_matched:
      ext.payment_recipient_matched !== undefined
        ? !!ext.payment_recipient_matched
        : !!old.payment_recipient_matched,
    payment_proof_mime: clean(ext.payment_proof_mime || old.payment_proof_mime || ""),
    payment_manual_review_required:
      ext.payment_manual_review_required !== undefined
        ? !!ext.payment_manual_review_required
        : !!old.payment_manual_review_required,
    payment_manual_review_reason: clean(
      ext.payment_manual_review_reason || old.payment_manual_review_reason || ""
    ),
    ...mergeOrderObservation(old, ext || {}),
  };
}

function calculateTotal(productName: string, quantity: number, parsed: ParsedTraining, lockedOffer?: OfferItem | null) {
  const p = getProductInfo(productName, parsed);
  if (!p) return 0;

  const q = sanitizeQuantity(quantity);

  // V106: una oferta bloqueada representa el total completo de la promoción.
  if (
    lockedOffer &&
    normalize(lockedOffer.product) === normalize(p.canonical) &&
    sanitizeQuantity(lockedOffer.quantity) === q &&
    lockedOffer.total > 0 &&
    isPlausibleOfferForProduct(lockedOffer, p)
  ) {
    return lockedOffer.total;
  }

  // V106: en un pack fijo, price1 guarda el precio TOTAL del pack, no el
  // precio por unidad. Ej.: 2 unidades por 99.000 => total 99.000.
  if (
    p.fixedPackQuantity &&
    sanitizeQuantity(p.fixedPackQuantity) === q &&
    p.price1 > 0
  ) {
    return p.price1;
  }

  if (q === 2 && p.price2) return p.price2;
  if (q === 3 && p.price3) return p.price3;

  return p.price1 * q;
}

function getCatalogOffer(product: ProductItem, quantity: number): OfferItem | null {
  const q = sanitizeQuantity(quantity);

  // V106: si coincide con un pack fijo, devolver el precio TOTAL del pack.
  if (
    product.fixedPackQuantity &&
    sanitizeQuantity(product.fixedPackQuantity) === q &&
    product.price1 > 0
  ) {
    return {
      product: product.canonical,
      quantity: q,
      total: product.price1,
      label: `${q} unidades por ${formatGs(product.price1)} Gs`,
      source: "catalog",
      fixed_quantity: true,
    };
  }

  if (q === 2 && product.price2) {
    return { product: product.canonical, quantity: 2, total: product.price2, source: "catalog" };
  }
  if (q === 3 && product.price3) {
    return { product: product.canonical, quantity: 3, total: product.price3, source: "catalog" };
  }
  return null;
}

function getCatalogFixedPackOffer(product: ProductItem | null): OfferItem | null {
  if (!product?.fixedPackQuantity || !product.price1) return null;
  return {
    product: product.canonical,
    quantity: product.fixedPackQuantity,
    total: product.price1,
    label: `${product.fixedPackQuantity} unidades por ${formatGs(product.price1)} Gs`,
    source: "catalog",
    fixed_quantity: true,
  };
}

function detectOfferFromText(text: string, parsed: ParsedTraining): OfferItem | null {
  const raw = clean(text);
  const m = normalize(raw);
  if (!m) return null;

  const product = detectProduct(raw, parsed, "");
  if (!product) return null;

  const qtyByWord: Record<string, number> = {
    uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  };

  let quantity = 0;
  const qNum =
    m.match(/\b(\d+)\s*(?:x|por|unidades|unidad|u|und|unds|piezas|pieza)\b/) ||
    m.match(/\b(\d+)\s*(?:afiladores|productos|items|ítems)\b/);

  if (qNum) quantity = sanitizeQuantity(Number(qNum[1]));

  if (!quantity) {
    for (const [word, num] of Object.entries(qtyByWord)) {
      if (new RegExp(`\\b${word}\\b`).test(m)) {
        quantity = num;
        break;
      }
    }
  }

  const priceMatch =
    raw.match(/(?:por|a solo|solo|promo|oferta)[^\d]*(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i) ||
    raw.match(/(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)/i);

  const total = priceMatch ? parseNumberGs(priceMatch[1]) : 0;

  if (product && quantity > 0 && total > 0) {
    return { product, quantity, total, label: `${quantity} por ${formatGs(total)} Gs`, source: "template" };
  }

  return null;
}

function looksLikeCustomerDataOrAddress(text: string) {
  const n = normalize(text);
  return /\b(calle|avda|avenida|ruta|km|barrio|esquina|casi|numero|nro|manzana|mz|lote|direccion|dirección|ubicacion|ubicación|telefono|teléfono|celular)\b/.test(n);
}

function isSafeTemplatePricingMessage(text: string) {
  const raw = clean(text);
  const n = normalize(raw);

  if (!raw) return false;
  if (looksLikeCustomerDataOrAddress(raw)) return false;

  return (
    /\b(oferta|ofertas|promo|promocion|promoción|precio promocional|precio|antes|solo hoy|stock limitado|ultimas unidades|últimas unidades|pack|combo|no se vende por unidad|unicamente|únicamente|solo pack)\b/.test(n) ||
    raw.includes("🔥") ||
    raw.includes("💰") ||
    raw.includes("→")
  );
}

function isFixedPackText(text: string) {
  const raw = clean(text);
  const n = normalize(raw);

  const explicitFixed =
    /\b(no se vende por unidad|no vendemos por unidad|solo pack|solo por pack|pack fijo|combo fijo|unicamente por el pack|únicamente por el pack|promocion valida unicamente|promoción válida únicamente|valida unicamente por el pack|válida únicamente por el pack)\b/.test(n);

  const structuredFixed =
    /producto\s*:/i.test(raw) &&
    /cantidad\s*:\s*\d+/i.test(raw) &&
    /precio\s*:\s*(?:gs\.?\s*)?\d/i.test(raw);

  return explicitFixed || structuredFixed;
}

function sanitizeCopyForOfferParsing(raw: string) {
  return clean(raw)
    .split(/\r?\n/g)
    .filter((line) => {
      const n = normalize(line);
      if (!n) return true;
      if (/\b(ultimos?|quedan|stock|disponibles?|restan?)\b/.test(n)) return false;
      if (/\b(talle|talles|calce|numero|numeros)\b/.test(n) && /\b\d{2}\s*(?:al|a|hasta|-)\s*\d{2}\b/.test(n)) return false;
      if (/\b\d{2}\s*(?:al|a|hasta|-)\s*\d{2}\b/.test(n) && !/(?:gs|guarani|guaranies)/.test(n)) return false;
      if (/\b(farmacia|antes|precio normal|precio regular|valor normal)\b/.test(n)) return false;
      if (/\b\d[\d.]*\s+(?:paraguayos|clientes|personas|compradores)\b/.test(n)) return false;
      return true;
    })
    .join("\n");
}

function parseRawOffers(raw: string, product: string): { offers: OfferItem[]; fixedQuantity: boolean } {
  const fixedQuantity = isFixedPackText(raw);
  const pricingRaw = sanitizeCopyForOfferParsing(raw);
  const offers: OfferItem[] = [];

  const addOffer = (quantity: number, total: number, fixed = false) => {
    const q = sanitizeQuantity(quantity);
    const t = Number(total || 0);

    if (!q || !t || t < 10000 || t > 10000000) return;

    offers.push({
      product,
      quantity: q,
      total: t,
      label: `${q} unidad${q > 1 ? "es" : ""} por ${formatGs(t)} Gs`,
      source: "template",
      fixed_quantity: fixed,
    });
  };

  const structuredQty = pricingRaw.match(/cantidad\s*:\s*(\d+)\s*(?:unidad|unidades|u|und|unds|piezas|pieza)?/i);
  const structuredPrice = pricingRaw.match(/precio\s*:\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i);

  if (structuredQty && structuredPrice) {
    addOffer(Number(structuredQty[1]), parseNumberGs(structuredPrice[1]), true);
  }

  const explicitPackPatterns = [
    /^[^0-9\n]{0,20}(\d+)\s+[a-zA-ZÁÉÍÓÚáéíóúÑñ]{3,40}s?\s*[:=]\s*(?:gs\.?\s*)?(\d[\d. ]{3,})(?:\s*(?:gs|guaran[ií]es))?/gim,
    /\b(?:pack|combo)\s*(?:de)?\s*(\d+)[^\n\r]{0,100}?(?:=|por|a|solo|solamente|→|➜|➡|->)\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/gi,
    /\b(\d+)\s*(?:unidades|unidad|u|und|unds|piezas|pieza|productos)?[^\n\r]{0,100}?(?:por|a|solo|solamente|=|→|➜|➡|->)\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/gi,
    /(?:^|\n|\*)\s*(\d+)\s*(?:unidad|unidades|u|und|unds)?\s*(?:→|➜|➡|->|-|:|=|por|x|a)?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/gi,
  ];

  for (const pattern of explicitPackPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(pricingRaw)) !== null) {
      const quantity = Number(match[1]);
      const total = parseNumberGs(match[2]);
      addOffer(quantity, total, fixedQuantity || quantity > 1 && isFixedPackText(raw));
    }
  }

  const singlePricePatterns = [
    /(?:^|\n)[^\n]{0,20}\bhoy\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i,
    /precio\s*promocional\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i,
    /oferta\s*(?:hoy)?\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i,
    /(?:precio|valor|sale|cuesta)\s*[:\-]?\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i,
  ];

  if (!fixedQuantity) {
    for (const pattern of singlePricePatterns) {
      const m = pricingRaw.match(pattern);
      if (m) {
        addOffer(1, parseNumberGs(m[1]), false);
        break;
      }
    }
  }

  if (fixedQuantity && !offers.some((o) => o.fixed_quantity)) {
    const qMatch =
      pricingRaw.match(/\b(?:pack|combo)\s*(?:de)?\s*(\d+)\b/i) ||
      pricingRaw.match(/\b(\d+)\s*(?:unidades|unidad|u|und|unds|piezas|pieza)\b/i);

    const pMatch =
      pricingRaw.match(/(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i);

    if (qMatch && pMatch) {
      addOffer(Number(qMatch[1]), parseNumberGs(pMatch[1]), true);
    }
  }

  // V105: si el copy contiene una sola oferta real y esa oferta es de
  // más de una unidad, se trata como un pack fijo aunque no diga literalmente
  // “solo pack”. Ejemplo: “2 unidades por 99.000 Gs”.
  const uniqueByQuantity = new Map<number, OfferItem>();
  for (const offer of offers) {
    const previous = uniqueByQuantity.get(offer.quantity);
    if (!previous || offer.fixed_quantity) uniqueByQuantity.set(offer.quantity, offer);
  }

  const uniqueOffers = Array.from(uniqueByQuantity.values());
  const inferredSinglePack =
    uniqueOffers.length === 1 &&
    uniqueOffers[0].quantity > 1;

  const finalFixedQuantity = fixedQuantity || inferredSinglePack;
  const finalOffers = uniqueOffers.map((offer) => ({
    ...offer,
    fixed_quantity: finalFixedQuantity ? true : !!offer.fixed_quantity,
  }));

  return { offers: finalOffers, fixedQuantity: finalFixedQuantity };
}

function detectTemplatePricingFromText(text: string, parsed: ParsedTraining, strict = false): TemplatePricing | null {
  const raw = clean(text);
  if (!isSafeTemplatePricingMessage(raw)) return null;

  const product = strict ? detectProductStrict(raw, parsed) : detectProduct(raw, parsed, "");
  if (!product) return null;

  const { offers, fixedQuantity } = parseRawOffers(raw, product);

  const unique = new Map<number, OfferItem>();
  for (const offer of offers) {
    const previous = unique.get(offer.quantity);
    if (!previous || offer.fixed_quantity || offer.source === "template") {
      unique.set(offer.quantity, offer);
    }
  }

  const uniqueOffers = Array.from(unique.values()).sort((a, b) => a.quantity - b.quantity);
  if (!uniqueOffers.length) return null;

  const hasFixed = uniqueOffers.some((o) => o.fixed_quantity) || fixedQuantity;

  return {
    product,
    price1: hasFixed ? undefined : uniqueOffers.find((o) => o.quantity === 1)?.total,
    offers: uniqueOffers.map((o) => ({ ...o, fixed_quantity: hasFixed ? true : o.fixed_quantity })),
    raw,
    fixed_quantity: hasFixed,
  };
}

function isStructuredSalesTemplateMessage(text: string) {
  const raw = clean(text);
  if (!raw) return false;

  return (
    /producto\s*:/i.test(raw) &&
    /cantidad\s*:\s*\d+/i.test(raw) &&
    /precio\s*:\s*(?:gs\.?\s*)?\d/i.test(raw)
  );
}

function hasTemplateBuyIntent(text: string) {
  const n = normalize(text);
  return /\b(quiero|confirmar|quiero confirmar|me interesa|comprar|compro|reservar|reservame|agendar|agendame|lo quiero)\b/.test(n);
}

function detectStructuredTemplatePricingFallback(text: string, parsed: ParsedTraining, strict = false): TemplatePricing | null {
  const raw = clean(text);
  if (!isStructuredSalesTemplateMessage(raw)) return null;

  const productLine = clean(raw.match(/producto\s*:\s*(.+)$/im)?.[1]);
  const qtyLine = raw.match(/cantidad\s*:\s*(\d+)\s*(?:unidad|unidades|u|und|unds|piezas|pieza)?/i);
  const priceLine = raw.match(/precio\s*:\s*(?:gs\.?\s*)?(\d[\d. ]{3,})\s*(?:gs|guaran[ií]es)?/i);

  const product = strict
    ? detectProductStrict(productLine || raw, parsed)
    : detectProduct(productLine || raw, parsed, "");
  const quantity = qtyLine ? sanitizeQuantity(Number(qtyLine[1])) : 0;
  const total = priceLine ? parseNumberGs(priceLine[1]) : 0;

  if (!product || !quantity || !total || total < 10000 || total > 10000000) return null;

  const offer: OfferItem = {
    product,
    quantity,
    total,
    label: `${quantity} unidad${quantity > 1 ? "es" : ""} por ${formatGs(total)} Gs`,
    source: "template",
    fixed_quantity: true,
  };

  return {
    product,
    price1: quantity === 1 ? total : undefined,
    offers: [offer],
    raw,
    fixed_quantity: true,
  };
}

function detectTemplatePricingSmart(text: string, parsed: ParsedTraining, strict = false): TemplatePricing | null {
  return detectTemplatePricingFromText(text, parsed, strict) || detectStructuredTemplatePricingFallback(text, parsed, strict);
}

function isNewPastedTemplatePurchase(text: string, parsed: ParsedTraining) {
  const raw = clean(text);
  if (!raw) return false;

  const pricing = detectTemplatePricingSmart(raw, parsed);
  if (pricing) return true;

  return (
    hasTemplateBuyIntent(raw) &&
    (isStructuredSalesTemplateMessage(raw) || isSafeTemplatePricingMessage(raw)) &&
    /(?:gs\.?|guaran[ií]es|\d[\d.\s]{3,})/i.test(raw)
  );
}


function getHistoryText(item: any): string {
  return clean(
    item?.message ||
    item?.body ||
    item?.text ||
    item?.content ||
    item?.response ||
    ""
  );
}

function isIncomingHistoryItem(item: any): boolean {
  // V101: jamás recuperar nombre, ciudad o datos desde mensajes del bot.
  const role = normalize(item?.role || item?.sender_role || item?.author || "");
  if (role === "assistant" || role === "model" || role === "bot" || role === "system") return false;
  if (role === "user" || role === "customer" || role === "cliente") return true;

  const direction = normalize(item?.direction || item?.message_type || item?.type || "");
  if (!direction) return false;

  return (
    direction === "in" ||
    direction === "incoming" ||
    direction === "received" ||
    direction.startsWith("in ") ||
    direction.startsWith("in_") ||
    direction.includes("received")
  );
}

function recoverRecentCityFromHistory(history: any[], parsed: ParsedTraining): string {
  const list = Array.isArray(history) ? history.slice(-50).reverse() : [];

  for (const item of list) {
    if (!isIncomingHistoryItem(item)) continue;

    const value = getHistoryText(item);
    if (!value) continue;

    const exact = exactKnownCity(value, parsed);
    if (exact) return exact;

    const explicit = extractExplicitKnownCityFromSentence(value, parsed);
    if (explicit) return explicit;
  }

  return "";
}

function recoverRecentValidNameFromHistory(
  history: any[],
  city: string,
  phone: string,
  parsed: ParsedTraining
): string {
  // V126: nunca inferir nombres desde frases antiguas.
  // Solo recuperar declaraciones explícitas.
  const list = Array.isArray(history) ? history.slice(-30).reverse() : [];

  for (const item of list) {
    if (!isIncomingHistoryItem(item)) continue;

    const value = getHistoryText(item);
    if (!value) continue;

    const n = normalize(value);
    const explicit =
      /\b(?:mi nombre es|me llamo|nombre\s*:)\b/.test(n) ||
      /^soy\s+[a-záéíóúñ]+\s+[a-záéíóúñ]+(?:\s+[a-záéíóúñ]+){0,3}$/i.test(n);

    if (!explicit) continue;

    const candidate = extractName(value, city, phone, parsed, true);

    if (
      candidate &&
      isStrictStandaloneCustomerName(candidate, city, parsed) &&
      !isContaminatedCustomerName(candidate, parsed)
    ) {
      return candidate;
    }
  }

  return "";
}

function getTemplatePricingFromHistory(history: any[], parsed: ParsedTraining): TemplatePricing | null {
  const recentMessages = (history || []).slice(-30).reverse();

  for (const item of recentMessages) {
    const content = clean(item?.content || item?.message || item?.text || item?.body || "");
    if (!content) continue;
    if (isConfirmedOrderMessage(content)) continue;
    if (isCatalogCopyHistoryMessage(content, parsed)) continue;

    const looksLikeTemplate =
      isStructuredSalesTemplateMessage(content) ||
      isRealSalesTemplateMessage(content) ||
      isSafeTemplatePricingMessage(content);

    if (!looksLikeTemplate) continue;

    const pricing = detectTemplatePricingSmart(content, parsed, true);
    if (pricing) return pricing;
  }

  return null;
}

function getTemplateOfferForQuantity(templatePricing: TemplatePricing | null, product: string, quantity: number): OfferItem | null {
  if (!templatePricing || !product || normalize(templatePricing.product) !== normalize(product)) return null;
  const q = sanitizeQuantity(quantity);
  return templatePricing.offers.find((o) => o.quantity === q) || null;
}

function getTemplatePrice1(templatePricing: TemplatePricing | null, product: string) {
  if (!templatePricing || !product || normalize(templatePricing.product) !== normalize(product)) return 0;
  return templatePricing.price1 || templatePricing.offers.find((o) => o.quantity === 1)?.total || 0;
}

function getFixedTemplateOffer(templatePricing: TemplatePricing | null, product: string): OfferItem | null {
  if (!templatePricing || !product || normalize(templatePricing.product) !== normalize(product)) return null;
  if (!templatePricing.fixed_quantity) return null;

  const fixed =
    templatePricing.offers.find((o) => o.fixed_quantity) ||
    templatePricing.offers.sort((a, b) => b.quantity - a.quantity)[0];

  return fixed || null;
}

function getProductFromLastPromotion(history: any[], parsed: ParsedTraining) {
  const templatePricing = getTemplatePricingFromHistory(history, parsed);
  const templateProduct = getProductInfo(templatePricing?.product || "", parsed);
  if (templateProduct) return templateProduct;

  const recentMessages = (history || [])
    .slice(-20)
    .reverse()
    .filter((h: any) => clean(h?.content));

  for (const item of recentMessages) {
    const content = clean(item?.content);
    if (!isRealSalesTemplateMessage(content) && !isPromotionLikeMessage(content) && !isSafeTemplatePricingMessage(content)) continue;

    const contentNorm = normalize(content);
    if (!contentNorm) continue;

    const sortedProducts = [...parsed.products].sort(
      (a, b) => normalize(b.canonical).length - normalize(a.canonical).length
    );

    for (const product of sortedProducts) {
      const names = [product.canonical, product.product, ...product.aliases]
        .map(normalize)
        .filter((x) => x.length >= 4)
        .sort((a, b) => b.length - a.length);

      if (names.some((n) => contentNorm.includes(n))) return product;
    }
  }

  return null;
}

function getOfferFromLastPromotion(history: any[], parsed: ParsedTraining): OfferItem | null {
  const templatePricing = getTemplatePricingFromHistory(history, parsed);
  if (!templatePricing) return null;

  const fixed = getFixedTemplateOffer(templatePricing, templatePricing.product);
  if (fixed) return fixed;

  return templatePricing.offers
    .filter((o) => o.quantity > 1)
    .sort((a, b) => b.quantity - a.quantity)[0] || templatePricing.offers[0] || null;
}

function isPromotionLikeMessage(text: string) {
  const c = clean(text);
  const n = normalize(c);
  return (
    c.includes("🔥") ||
    c.includes("🚨") ||
    c.includes("👉") ||
    /\b(oferta|ofertas|promo|promocion|promoción|ultimas unidades|últimas unidades|garantia|garantía|solo hoy|escribi quiero|escribí quiero|unidades)\b/.test(n)
  );
}

function isConfirmedOrderMessage(text: string) {
  const n = normalize(text);
  return /\b(pedido confirmado|tu pedido ya quedo confirmado|tu pedido ya quedó confirmado|pedido ya quedo confirmado|pedido ya quedó confirmado|gracias por tu compra|queda agendado|quedo agendado|quedó agendado)\b/.test(n);
}

function isRealSalesTemplateMessage(text: string) {
  const c = clean(text);
  const n = normalize(c);
  if (!c) return false;
  if (isConfirmedOrderMessage(c)) return false;
  if (/\b(factura legal|ruc|razon social|razón social|cedula|cédula|proxima ronda de envios|próxima ronda de envíos|delivery te confirma)\b/.test(n)) return false;

  const hasSalesCue =
    c.includes("👉") ||
    c.includes("🔥") ||
    c.includes("💰") ||
    /\b(stock limitado|precio promocional|promocion especial|promoción especial|antes|ahora|escribi quiero|escribí quiero|te lo reservamos|envio gratis|envío gratis|pago al recibir)\b/.test(n);

  const hasPrice = /(?:gs\.?|guaran[ií]es|\d[\d.\s]{3,})/i.test(c);
  return hasSalesCue && hasPrice;
}

function getLastRealSalesTemplatePricing(history: any[], parsed: ParsedTraining): TemplatePricing | null {
  const recentMessages = (history || []).slice(-30).reverse();

  for (const item of recentMessages) {
    const content = clean(item?.content || item?.message || item?.text || item?.body || "");
    if (!content) continue;
    if (isConfirmedOrderMessage(content)) continue;
    if (isCatalogCopyHistoryMessage(content, parsed)) continue;
    if (!isRealSalesTemplateMessage(content) && !isSafeTemplatePricingMessage(content) && !isStructuredSalesTemplateMessage(content)) continue;

    const pricing = detectTemplatePricingSmart(content, parsed, true);
    if (pricing) return pricing;
  }

  return null;
}

function getLastRealSalesTemplateProduct(history: any[], parsed: ParsedTraining) {
  const pricing = getLastRealSalesTemplatePricing(history, parsed);
  if (pricing?.product) {
    const productInfo = getProductInfo(pricing.product, parsed);
    if (productInfo) return productInfo;
  }

  const recentMessages = (history || []).slice(-30).reverse();

  for (const item of recentMessages) {
    const content = clean(item?.content || item?.message || item?.text || item?.body || "");
    if (!content) continue;
    if (isCatalogCopyHistoryMessage(content, parsed)) continue;
    if (!isRealSalesTemplateMessage(content)) continue;

    const product = detectProduct(content, parsed, "");
    const productInfo = getProductInfo(product, parsed);
    if (productInfo) return productInfo;
  }

  return null;
}

function historyText(item: any) {
  return clean(item?.content || item?.message || item?.text || item?.body || "");
}

function wasProductCopyAlreadySent(history: any[], productInfo: ProductItem | null): boolean {
  const copy = clean(productInfo?.salesCopy || "");
  if (!copy) return false;

  return (history || []).some((item: any) => {
    const content = historyText(item);
    if (!content) return false;
    return content === copy || content.startsWith(copy) || content.includes(copy);
  });
}

// ✅ FIX V46: detecta de forma robusta si el copy de ESTE producto ya fue enviado.
// Tolera distintos nombres de rol y respuestas que agregan la pregunta de ciudad al final.
function wasCopyAlreadySentInThisConversation(history: any[], productInfo: ProductItem | null): boolean {
  const copy = clean(productInfo?.salesCopy || "");
  if (!copy) return false;

  const normalizedCopy = normalize(copy);
  const copyFingerprint = normalizedCopy
    .split(/\s+/)
    .slice(0, 18)
    .join(" ");

  return (history || [])
    .slice(-20)
    .some((item: any) => {
      const role = normalize(
        item?.role ||
        item?.sender_type ||
        item?.type ||
        item?.from_role ||
        item?.author ||
        ""
      );

      const isBotMessage =
        !role ||
        ["assistant", "model", "bot", "ai", "agent", "system bot"].includes(role);

      if (!isBotMessage) return false;

      const content = historyText(item);
      if (!content) return false;

      const normalizedContent = normalize(content);

      return (
        content === copy ||
        content.startsWith(copy) ||
        content.includes(copy) ||
        (
          copyFingerprint.length >= 40 &&
          normalizedContent.includes(copyFingerprint)
        )
      );
    });
}

function isCatalogCopyHistoryMessage(text: string, parsed: ParsedTraining) {
  const raw = clean(text);
  if (!raw) return false;

  return parsed.products.some((product) => {
    const copy = clean(product.salesCopy || "");
    if (!copy) return false;

    return raw === copy || raw.startsWith(copy + "\n") || raw.includes(copy);
  });
}

function extractExplicitProductInterest(text: string, parsed: ParsedTraining) {
  const raw = clean(text);
  const n = normalize(raw);
  if (!raw) return "";
  if (isConfirmedOrderMessage(raw)) return "";
  if (isGenericBuyReply(raw) || isStrongNewPurchaseReply(raw)) return "";

  const hasInterestWords =
    /\b(me interesa|quiero|precio|cuanto|cuánto|tenes|tenés|tienen|hay|consulta|info|informacion|información|comprar|compro|reservar|agendar)\b/.test(n);

  if (!hasInterestWords) return "";

  const product = detectProduct(raw, parsed, "");
  const productInfo = getProductInfo(product, parsed);
  return productInfo?.canonical || "";
}

function getRecentExplicitProductInterestAfterConfirmed(history: any[], parsed: ParsedTraining): { product: ProductItem; index: number } | null {
  const items = history || [];

  for (let i = items.length - 1; i >= 0; i--) {
    const content = historyText(items[i]);
    if (!content) continue;

    const product = extractExplicitProductInterest(content, parsed);
    const productInfo = getProductInfo(product, parsed);
    if (productInfo) return { product: productInfo, index: i };

    if (isConfirmedOrderMessage(content)) break;
  }

  return null;
}

function getTemplatePricingAfterHistoryIndex(history: any[], parsed: ParsedTraining, startIndex: number): TemplatePricing | null {
  const items = history || [];

  for (let i = items.length - 1; i > startIndex; i--) {
    const content = historyText(items[i]);
    if (!content) continue;
    if (isConfirmedOrderMessage(content)) continue;
    if (isCatalogCopyHistoryMessage(content, parsed)) continue;
    if (!isRealSalesTemplateMessage(content) && !isSafeTemplatePricingMessage(content) && !isStructuredSalesTemplateMessage(content)) continue;

    const pricing = detectTemplatePricingSmart(content, parsed, true);
    if (pricing) return pricing;
  }

  return null;
}

function forceTemplatePricingProduct(templatePricing: TemplatePricing | null, product: ProductItem | string | null): TemplatePricing | null {
  if (!templatePricing || !product) return templatePricing;

  const productItem = typeof product === "string" ? null : product;
  const productName = typeof product === "string" ? product : product.canonical;
  if (!productName) return templatePricing;

  const sourceOffers = templatePricing.offers || [];
  const filteredOffers = productItem
    ? sourceOffers.filter((o) => isPlausibleOfferForProduct(o, productItem))
    : sourceOffers;

  if (productItem && !filteredOffers.length) return null;

  return {
    ...templatePricing,
    product: productName,
    offers: filteredOffers.map((o) => ({
      ...o,
      product: productName,
    })),
    fixed_quantity: filteredOffers.some((o) => o.fixed_quantity),
  };
}

function hasExplicitProductInterestPhrase(text: string) {
  const n = normalize(text);
  if (!n) return false;

  return /\b(me|mi)\s+intere(?:sa|za)|\bquiero(?:\s+comprar|\s+llevar)?|\bprecio|\bcuanto|\bconfirmar|\bagendar|\bcomprar|\bnecesito|\bconsulta|\binfo(?:rmacion)?\b/.test(n);
}

function isStrongNewPurchaseReply(text: string) {
  const n = normalize(text);
  return /^(quiero|lo quiero|quiero ese|quiero eso|quiero confirmar|confirmar|si quiero|sí quiero|comprar|compro|quiero comprar|quiero llevar|llevo|reservar|reservame|agendar|agendame|confirmo)$/.test(n);
}

function isShortAcknowledgement(text: string) {
  return isPoliteClosingOrAcknowledgement(text);
}

function buildDeterministicAcknowledgementResponse(text: string, state: ConversationState) {
  // V116: deshabilitado. Saludos y acuses los redacta Gemini.
  return "";
  /*
  if (!isShortAcknowledgement(text)) return "";

  const n = normalize(text);
  const isThanks = /\b(gracias|muchas gracias|🙏)\b/.test(n) || clean(text) === "🙏";
  const friendlyLead = isThanks
    ? "¡Con mucho gusto! 😊"
    : "¡Perfecto! 😊";

  if (state.step === "pedido_confirmado") {
    return isThanks
      ? "¡Con mucho gusto! 😊 Gracias por tu compra. Tu pedido ya quedó agendado y estaremos coordinando la entrega. 🚚📦"
      : "¡Perfecto! 😊 Tu pedido ya quedó confirmado y agendado. 🚚📦";
  }

  let continuation = "";
  if (!state.order.product) {
    continuation = "¿Qué producto te interesa?";
  } else if (!state.order.city) {
    continuation = "📍 Para continuar, ¿para qué ciudad sería el envío?";
  } else if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) {
    continuation = "¿Cuántas unidades querés llevar?";
  } else if (!state.order.customer_name) {
    continuation = "Para completar el pedido, pasame tu nombre y apellido.";
  } else if (state.coverage !== false && !state.addressOptional && !state.order.address) {
    continuation = "Ahora pasame la dirección exacta o ubicación para la entrega.";
  }

  return `${friendlyLead}${continuation ? `\n\n${continuation}` : ""}`;
  */
}

function isConversationClosing(text: string) {
  const n = normalize(text);
  if (!n) return false;

  return /^(nada mas|nada más|nada|solo eso|solo eso gracias|eso es todo|eso seria|eso sería|eso nomas|eso nomás|no gracias|no nada mas|no nada más|ninguna consulta|ninguna duda|sin consulta|sin dudas|todo bien|ya esta|ya está|gracias nada mas|gracias nada más|gracias eso es todo|ok gracias|dale gracias|listo gracias|perfecto gracias)$/.test(n);
}

function isPostSaleQuestion(text: string) {
  const n = normalize(text);

  return (
    /\?/.test(text) ||
    /\b(factura|boleta|comprobante|recibo|ruc|razon social|razón social|cedula|cédula|ci|datos fiscales|datos bancarios|datos para transferir|datos para pagar|datos de transferencia|numero de cuenta|número de cuenta|cuenta bancaria|cual es el alias|cual es la cuenta|cuando|cuándo|llega|llego|llegaria|llegaría|entrega|delivery|envio|envío|demora|tarda|horario|hora|garantia|garantía|cambio|cambiar|direccion|dirección|telefono|teléfono|pagar|pago|efectivo|transferencia|delivery|seguimiento|estado|cancelar|anular)\b/.test(n)
  );
}

function isCatalogRequest(text: string) {
  const n = normalize(text);
  if (!n) return false;

  return (
    /\b(catalogo|catálogo)\b/.test(n) ||
    /\b(que|qué|cuales|cuáles)\s+otros\s+productos\s+(?:tienen|tenes|tenés|hay|manejan|venden)\b/.test(n) ||
    /\b(otros productos|ver productos|mostrar productos|pasame los productos|pásame los productos|lista de productos)\b/.test(n)
  );
}

function buildCatalogResponse(parsed: ParsedTraining) {
  const products = (parsed.products || []).filter((p) => clean(p.canonical || p.product));

  const productLines = products.slice(0, 20).map((product) => {
    const offers = productOffersText(product);
    return `📦 *${product.canonical || product.product}*${offers ? `\n${offers}` : ""}`;
  });

  const catalogLink = clean(parsed.catalogUrl);
  const header = "😊 ¡Claro! Este es nuestro catálogo disponible:";
  const body = productLines.length
    ? productLines.join("\n\n")
    : "Por el momento no hay productos cargados en el catálogo.";
  const linkBlock = catalogLink ? `\n\n🔗 Catálogo completo: ${catalogLink}` : "";
  const closing = products.length > 20
    ? "\n\nDecime qué producto te interesa y te paso su promoción 😊"
    : "\n\nDecime cuál te interesa y te ayudo con la compra 😊";

  return `${header}\n\n${body}${linkBlock}${closing}`;
}


function deterministicPostSaleResponse(text: string, order: OrderData, parsed: ParsedTraining) {
  // V116: deshabilitado. Postventa visible siempre generada por Gemini.
  return "";
  /*
  const n = normalize(text);

  const hasFiscalData =
    /\b(ruc|razon social|razón social|cedula|cédula|ci)\b/.test(n) && /\d{5,}/.test(text);

  if (hasFiscalData) {
    return `✅ Perfecto, recibimos tus datos para la factura legal 😊\n📎 Los dejamos anotados para emitirla con tu pedido.`;
  }

  if (/\b(factura|boleta|ruc|razon social|razón social|cedula|cédula)\b/.test(n)) {
    return `✅ Sí, contamos con FACTURA LEGAL 😊\n📎 Pasame tu RUC y Razón Social, o tu número de Cédula, y te la emitimos sin problema.`;
  }

  const asksBankDataDirectly =
    /\b(datos bancarios|datos para transferir|datos para pagar|datos de transferencia|numero de cuenta|número de cuenta|cuenta bancaria|pasame los datos|dame los datos|cual es el alias|cual es la cuenta)\b/.test(n);

  if (asksBankDataDirectly) {
    return `💵 ¡Claro! Estos son los datos para transferir:\n\n${bankDataText(parsed)}\n\n📎 Cuando hagas la transferencia, pasame el comprobante así queda todo registrado 😊`;
  }

  const asksFreeDelivery =
    /\b(delivery|deli?very|drlivery|envio|envío)\b[\s\S]{0,25}\b(gratis|grati|gratuito|grayis)\b/.test(n) ||
    /\b(gratis|grati|gratuito|grayis)\b[\s\S]{0,25}\b(delivery|deli?very|drlivery|envio|envío)\b/.test(n);

  if (asksFreeDelivery) {
    if (hasCoverage(order.city || "", parsed)) {
      return `✅ Sí, el envío a ${order.city || "tu ciudad"} es GRATIS y pagás al recibir. 🚚😊`;
    }
    return `🚚 Hasta ${order.city || "tu zona"} enviamos por transportadora; el costo se coordina según la agencia y el destino.`;
  }

  if (/\b(cuando|cuándo|llega|llego|llegaria|llegaría|entrega|delivery|envio|envío|demora|tarda|horario|hora|seguimiento|estado)\b/.test(n)) {
    const product = order.product ? ` de ${order.product}` : "";
    return `🚚 Tu pedido${product} ya quedó confirmado y agendado para la próxima ronda de envíos. El delivery te confirma cuando llegue a tu zona. 😊`;
  }

  if (/\b(pagar|pago|efectivo|transferencia|forma de pago|metodo de pago|método de pago)\b/.test(n)) {
    if (hasCoverage(order.city || "", parsed)) {
      return `💵 Podés pagar en EFECTIVO o por TRANSFERENCIA AL DELIVERY cuando recibas tu producto. Como te quede más cómodo 😊🚚`;
    }

    return `💵 Para tu zona el pago es anticipado por transferencia. Te paso los datos:\n\n${bankDataText(parsed)}`;
  }

  if (/\b(cambiar|cambio|direccion|dirección|ubicacion|ubicación|telefono|teléfono|celular|numero|número)\b/.test(n)) {
    return `✅ Sin problema 😊 Pasame el dato nuevo que querés actualizar: dirección exacta/ubicación o número de celular.`;
  }

  if (/\b(cancelar|anular|cancela|cancele|ya no quiero)\b/.test(n)) {
    return `Entiendo. Para cancelar el pedido, confirmame por favor escribiendo: CANCELAR PEDIDO.`;
  }

  if (/\b(garantia|garantía|cambio|devolucion|devolución|defecto|fallado|falla)\b/.test(n)) {
    return `✅ Contamos con atención postventa 😊 Si el producto llega con algún inconveniente, escribinos con foto/video del producto y revisamos el caso.`;
  }

  return "";
  */
}

function buildPostSaleSystemPrompt(parsed: ParsedTraining, order: OrderData) {
  return `
Sos vendedor/postventa de Mega Todo Store / One Store por WhatsApp.
El pedido del cliente YA ESTÁ CONFIRMADO. No vuelvas a confirmar el pedido salvo que te lo pida.

DATOS DEL PEDIDO CONFIRMADO:
- Producto: ${order.product || "no disponible"}
- Cantidad: ${order.quantity || "no disponible"}
- Ciudad: ${order.city || "no disponible"}
- Dirección: ${order.address || "no disponible"}
- Cliente: ${order.customer_name || "no disponible"}
- Teléfono: ${order.phone || "no disponible"}

REGLAS OBLIGATORIAS:
- Respondé usando PRIMERO y de forma estricta los ENTRENAMIENTOS GENERALES ACTIVOS DEL USUARIO.
- PROHIBIDO usar respuestas genéricas, plantillas universales o frases prearmadas no respaldadas por el entrenamiento.
- Para entrega, demora, fecha, horario, pago, factura, garantía, cambios, catálogo y postventa, extraé la respuesta concreta del entrenamiento y del estado real del pedido.
- Si el entrenamiento indica un plazo (por ejemplo 24 a 48 horas hábiles), respondé exactamente ese plazo.
- Si el entrenamiento no contiene el dato solicitado, decí de forma breve que no está especificado y que el equipo/delivery lo coordinará; no inventes “próxima ronda”, fechas, horas ni políticas.
- El número del cliente YA está disponible en DATOS DEL PEDIDO. Nunca vuelvas a pedir teléfono salvo que el cliente diga expresamente que desea cambiarlo.
- Si quiere cambiar dirección o teléfono, pedile únicamente el dato nuevo correspondiente.
- Si quiere cancelar, seguí la regla específica del entrenamiento; si no existe, pedí confirmación clara.
- No crees un pedido nuevo.
- No repitas el bloque de ✅ PEDIDO CONFIRMADO.
- ÚNICAS excepciones permitidas como texto fijo del backend: cierre confirmado y procesamiento/validación de comprobantes.
- La detección del celular es técnica y automática, pero cualquier frase visible sobre el celular también la redactás vos.
- No copies frases genéricas recurrentes. Variá naturalmente la redacción según el mensaje exacto y el historial.
- Nunca vuelvas a preguntar un dato que ya figura en DATOS DEL PEDIDO.
- Sé natural, directo y coherente con el estilo definido por el entrenamiento.

ENTRENAMIENTOS GENERALES DEL USUARIO:
${parsed.generalTraining || "No hay reglas generales configuradas para este usuario."}

DATOS DE TRANSFERENCIA DEL USUARIO:
${bankDataText(parsed)}

IMPORTANTE:
- Aplicá todos los entrenamientos generales activos del usuario, no solamente el primero.
- El estado técnico del pedido prevalece únicamente para datos calculados y validaciones.
- El estilo, la conversación, la postventa y las reglas comerciales deben salir de los entrenamientos generales del usuario.
`.trim();
}

function isNewTemplateOrProductIntent(text: string, parsed: ParsedTraining, history: any[]) {
  const raw = clean(text);
  const n = normalize(raw);

  const productInMessage = detectProduct(raw, parsed, "");
  const pricingInMessage = detectTemplatePricingSmart(raw, parsed);

  const hasCurrentBuyIntent = isGenericBuyReply(raw) || isBuyIntent(raw) || hasTemplateBuyIntent(raw);
  const pricingFromHistory = hasCurrentBuyIntent ? getTemplatePricingFromHistory(history, parsed) : null;
  const lastTemplateProduct = hasCurrentBuyIntent ? (getProductFromLastPromotion(history, parsed)?.canonical || "") : "";
  const effectivePricing = pricingInMessage || pricingFromHistory;

  const pastedTemplate =
    isPromotionLikeMessage(raw) ||
    !!pricingInMessage;

  const productInterest =
    !!productInMessage &&
    hasExplicitProductInterestPhrase(raw);

  const wantsLastTemplate =
    hasCurrentBuyIntent &&
    !!lastTemplateProduct;

  return {
    isNew: Boolean(pastedTemplate || productInterest || wantsLastTemplate),
    product: effectivePricing?.product || productInMessage || lastTemplateProduct || "",
    pricing: effectivePricing,
  };
}

function isRespondingToPromotion(text: string, history: any[]) {
  if (!isBuyIntent(text) && !isGenericBuyReply(text)) return false;

  const lastBotMessages = (history || [])
    .slice(-4)
    .filter((h: any) => h.role === "assistant" || h.role === "model");

  return lastBotMessages.some((item) => isPromotionLikeMessage(clean(item?.content)));
}

function shouldStartFreshOrder({
  texto,
  context,
  oldOrder,
  productFromMessage,
  lockedProductByContext,
  promoResponse,
  parsed,
}: {
  texto: string;
  context: any;
  oldOrder: OrderData;
  productFromMessage: string;
  lockedProductByContext: ProductItem | null;
  promoResponse: boolean;
  parsed: ParsedTraining;
}) {
  const msg = normalize(texto);
  const explicitInterest =
    hasExplicitProductInterestPhrase(texto);

  const productChanged =
    !!productFromMessage &&
    !!oldOrder.product &&
    normalize(productFromMessage) !== normalize(oldOrder.product);

  const campaignClick =
    explicitInterest &&
    !!productFromMessage;

  const genericWantsPromo =
    (isGenericBuyReply(texto) || isBuyIntent(texto)) &&
    promoResponse &&
    !!lockedProductByContext;

  const contextWasConfirmed = context?.step === "pedido_confirmado";

  const stale = isOrderStale(oldOrder, context?.updated_at || new Date().toISOString());

  const explicitQuantityReply = extractQuantity(texto) > 0;
  const activeIncompleteOrder =
    !!oldOrder.product &&
    context?.step !== "pedido_confirmado" &&
    ["collecting_city", "collecting_quantity", "collecting_name", "collecting_address", "collecting_phone"].includes(context?.step || "");

  if (explicitQuantityReply && activeIncompleteOrder && !productChanged) {
    return false;
  }

  return Boolean(productChanged || campaignClick || genericWantsPromo || contextWasConfirmed || stale);
}

function getLockedProductFromContext(
  context: any,
  oldOrder: OrderData,
  history: any[],
  parsed: ParsedTraining
): ProductItem | null {
  const candidates = [
    context?.current_product,
    context?.last_topic,
    context?.order_data?.product,
    context?.last_ad_product,
    context?.last_ad_offer?.product,
    oldOrder?.product,
    oldOrder?.locked_offer?.product,
    getProductFromLastPromotion(history, parsed)?.canonical,
  ]
    .map(clean)
    .filter(Boolean);

  for (const candidate of candidates) {
    const productInfo = getProductInfo(candidate, parsed);
    if (productInfo) return productInfo;
  }

  return null;
}

function getLockedOfferFromContext(context: any, oldOrder: OrderData, history: any[], parsed: ParsedTraining): OfferItem | null {
  const fromCtx = context?.last_ad_offer || context?.order_data?.locked_offer || oldOrder?.locked_offer;

  if (fromCtx?.product && fromCtx?.quantity && fromCtx?.total) {
    const p = getProductInfo(fromCtx.product, parsed);
    if (p) {
      return {
        product: p.canonical,
        quantity: sanitizeQuantity(fromCtx.quantity),
        total: Number(fromCtx.total),
        label: fromCtx.label || `${fromCtx.quantity} por ${formatGs(fromCtx.total)} Gs`,
        source: fromCtx.source || "context",
      };
    }
  }

  return getOfferFromLastPromotion(history, parsed);
}

function looksLikeSentenceNotCity(text: string) {
  const n = normalize(text);
  return (
    isQuestionLikeMessage(text) ||
    isTemporalDeliveryExpression(n) ||
    /\b(me interesa|te interesa|interesa|quiero|necesito|cuanto|cuánto|cuesta|precio|tienen|tenes|tenés|hay|dame|mandame|reservame|consulta|informacion|información|hola|buenas|gracias|comprar|compro|de donde|donde son|donde estan|como funciona|que trae|garantia|original|datos|pasas|pasame|pásame|paso los|pagos|pago|pagar|cuenta|transferencia|alias|banco|comprobante|factura|numero de cuenta|número de cuenta)\b/.test(n)
  );
}

function hasPaymentProofText(text: string) {
  const n = normalize(text);
  return /\b(comprobante|transferi|transferí|transferencia hecha|ya pague|ya pagué|deposito|depósito|pague|pagué|adjunto|envio comprobante|envío comprobante|recibo)\b/.test(n);
}

function isValidPaymentSenderName(
  value: any,
  recipientName: any,
  bankData: BankData | null,
  city: string,
  parsed: ParsedTraining
) {
  const name = clean(value);
  const normalizedName = normalize(name);
  const words = name.split(/\s+/).filter(Boolean);

  if (!name || words.length < 2 || name.length < 5 || name.length > 100) return false;
  if (/\d/.test(name)) return false;
  if (isInvalidCustomerNameForOrder(name, city, parsed)) return false;

  // Nunca tomar como cliente el beneficiario, el banco ni etiquetas del comprobante.
  const forbiddenValues = [
    recipientName,
    bankData?.titular,
    bankData?.entidad,
    bankData?.banco,
    "titular",
    "beneficiario",
    "destinatario",
    "remitente",
    "cuenta debitada",
    "cuenta acreditada",
  ]
    .map(normalize)
    .filter(Boolean);

  if (forbiddenValues.some((item) => item === normalizedName)) return false;
  if (/\b(banco|bank|financiera|cooperativa|beneficiario|destinatario|titular|cuenta|transferencia)\b/.test(normalizedName)) return false;

  return true;
}

function hasPaymentProof(context: any, text: string, mediaUrl?: string, mediaType?: string) {
  const url = clean(mediaUrl);
  const type = clean(mediaType);

  if (!url) return false;

  const typeLooksLikeProof = /image|document|pdf|application|octet-stream/i.test(type);
  const urlLooksLikeProof = /\.(jpg|jpeg|png|webp|pdf)(?:\?|$)/i.test(url);

  return Boolean(typeLooksLikeProof || urlLooksLikeProof);
}

function isSameOrderForPaymentProof(oldOrder: OrderData, newOrder: OrderData) {
  if (!oldOrder?.payment_proof_received) return false;

  const sameProduct = normalize(oldOrder.product) === normalize(newOrder.product);
  const sameCity = normalize(oldOrder.city) === normalize(newOrder.city);
  const sameQuantity = sanitizeQuantity(oldOrder.quantity) === sanitizeQuantity(newOrder.quantity);
  // El identificador interno puede regenerarse entre mensajes o integraciones.
  // Para conservar un comprobante, la identidad comercial del pedido es
  // producto + ciudad + cantidad. El nombre y la dirección pueden llegar después.
  return Boolean(sameProduct && sameCity && sameQuantity);
}

function preserveVerifiedPaymentForSameOrder(oldOrder: OrderData, newOrder: OrderData) {
  return Boolean(
    oldOrder?.payment_proof_verified &&
    isSameOrderForPaymentProof(oldOrder, newOrder) &&
    Number(oldOrder.payment_amount || 0) > 0 &&
    clean(oldOrder.payment_holder_name)
  );
}


function isAddressOptionalByTraining(
  parsed: ParsedTraining,
  coverage: boolean | null
): boolean {
  // Para transportadora la dirección exacta no forma parte del cierre técnico.
  if (coverage === false) return true;

  const raw = clean(parsed.generalTraining || "");
  const n = normalize(raw);
  if (!n) return false;

  // Una regla explícita de obligatoriedad tiene prioridad cuando no convive
  // con una regla igualmente explícita de opcionalidad.
  const explicitlyRequired =
    /\b(direccion|ubicacion|referencia)\b[\s\S]{0,45}\b(obligatoria|obligatorio|indispensable|requerida|requerido)\b/.test(n) ||
    /\b(no se puede|no debe|no confirmar)\b[\s\S]{0,55}\b(sin direccion|sin ubicacion|sin referencia)\b/.test(n);

  const explicitlyOptional =
    /\b(direccion|ubicacion|referencia|domicilio)\b[\s\S]{0,55}\b(opcional|no obligatoria|no obligatorio|puede faltar|no es necesaria|no es necesario)\b/.test(n) ||
    /\b(opcional|no obligatoria|no obligatorio)\b[\s\S]{0,55}\b(direccion|ubicacion|referencia|domicilio)\b/.test(n) ||
    /\b(puede|podra|podrá|podes|podés)\b[\s\S]{0,80}\b(pasar|enviar|compartir|dar)\b[\s\S]{0,80}\b(direccion|ubicacion|referencia)\b[\s\S]{0,80}\b(despues|más tarde|mas tarde|al delivery|directamente al delivery)\b/.test(n) ||
    /\b(direccion|ubicacion|referencia)\b[\s\S]{0,90}\b(despues|más tarde|mas tarde|al delivery|directamente al delivery)\b/.test(n) ||
    /\b(confirmar|registrar|agendar)\b[\s\S]{0,70}\b(pedido)\b[\s\S]{0,70}\b(sin direccion|sin ubicacion)\b/.test(n);

  if (explicitlyRequired && !explicitlyOptional) return false;
  return explicitlyOptional;
}

function addressPendingMessage(state: ConversationState): string {
  if (!state.addressOptional || clean(state.order.address)) return "";
  return "📍 Ubicación: pendiente; puede enviarla más tarde o pasarla directamente al delivery.";
}

function nextStep(order: OrderData, coverage: boolean | null, addressOptional = false) {
  if (!order.product) return "selling";
  if (!order.city) return "collecting_city";

  if (!order.quantity && order.locked_offer?.fixed_quantity) {
    order.quantity = order.locked_offer.quantity;
  }

  if (!order.quantity) return "collecting_quantity";

  if (coverage === false) {
    if (!order.customer_name) return "collecting_name";
    if (!order.payment_proof_verified) return "waiting_payment_proof";
    return "confirm_order";
  }

  if (!order.customer_name) return "collecting_name";
  if (!addressOptional && !order.address) return "collecting_address";
  return "confirm_order";
}

function getMissing(order: OrderData, coverage: boolean | null, addressOptional = false) {
  const missing: string[] = [];
  if (!order.product) missing.push("producto");
  if (!order.city) missing.push("ciudad");
  if (!order.quantity && !order.locked_offer?.fixed_quantity) missing.push("cantidad");

  if (order.product && order.city && order.quantity) {
    if (!order.customer_name) missing.push("nombre y apellido");
    if (coverage !== false && !addressOptional && !order.address) missing.push("dirección exacta o ubicación");
    if (coverage === false && !order.payment_proof_verified) missing.push("comprobante de transferencia verificado");
  }

  return missing;
}

function bankDataText(parsed: ParsedTraining) {
  const b = parsed.bankData;
  if (!b) return "Datos de transferencia no configurados en entrenamiento.";

  const lines = [
    b.titular ? `Titular: ${b.titular}` : "",
    b.ci ? `CI: ${b.ci}` : "",
    b.entidad ? `Entidad: ${b.entidad}` : "",
    b.banco ? `Banco: ${b.banco}` : "",
    b.cuenta ? `N° de cuenta: ${b.cuenta}` : "",
    b.alias ? `Alias: ${b.alias}` : "",
  ].filter(Boolean);

  if (lines.length > 0) return lines.join("\n");
  return b.raw || "Datos de transferencia no configurados en entrenamiento.";
}

function productPriceText(productInfo: ProductItem | null, lockedOffer?: OfferItem | null, templatePricing?: TemplatePricing | null) {
  if (!productInfo) return "";

  if (productInfo.fixedPackQuantity && productInfo.price1) {
    return `Pack fijo: ${productInfo.fixedPackQuantity} unidades por ${formatGs(productInfo.price1)} Gs. No se vende por unidad.`;
  }

  if (templatePricing && normalize(templatePricing.product) === normalize(productInfo.canonical)) {
    const fixed = getFixedTemplateOffer(templatePricing, productInfo.canonical);
    if (fixed && isPlausibleOfferForProduct(fixed, productInfo)) {
      return `Pack fijo: ${fixed.quantity} unidades por ${formatGs(fixed.total)} Gs. No se vende por unidad.`;
    }

    const lines = templatePricing.offers
      .filter((o) => o.total >= 10000)
      .sort((a, b) => a.quantity - b.quantity)
      .map((o) =>
        o.quantity === 1
          ? `1 unidad: ${formatGs(o.total)} Gs`
          : `${o.quantity} unidades: ${formatGs(o.total)} Gs`
      );

    if (lines.length) return lines.join("\n");
  }

  if (
    lockedOffer &&
    lockedOffer.source === "template" &&
    normalize(lockedOffer.product) === normalize(productInfo.canonical) &&
    lockedOffer.quantity > 0 &&
    lockedOffer.total > 0 &&
    isPlausibleOfferForProduct(lockedOffer, productInfo)
  ) {
    return lockedOffer.fixed_quantity
      ? `Pack fijo: ${lockedOffer.quantity} unidades por ${formatGs(lockedOffer.total)} Gs. No se vende por unidad.`
      : `${lockedOffer.quantity} unidad${lockedOffer.quantity > 1 ? "es" : ""}: ${formatGs(lockedOffer.total)} Gs`;
  }

  if (
    lockedOffer &&
    normalize(lockedOffer.product) === normalize(productInfo.canonical) &&
    lockedOffer.quantity > 0 &&
    lockedOffer.total > 0 &&
    isPlausibleOfferForProduct(lockedOffer, productInfo)
  ) {
    return [
      `1 unidad: ${formatGs(productInfo.price1)} Gs`,
      `Promo ${lockedOffer.quantity} unidades: ${formatGs(lockedOffer.total)} Gs`,
    ].join("\n");
  }

  const lines = [`1 unidad: ${formatGs(productInfo.price1)} Gs`];
  if (productInfo.price2) lines.push(`2 unidades: ${formatGs(productInfo.price2)} Gs`);
  if (productInfo.price3) lines.push(`3 unidades: ${formatGs(productInfo.price3)} Gs`);
  return lines.join("\n");
}

function productsSummary(parsed: ParsedTraining) {
  if (!parsed.products.length) return "No hay productos cargados.";
  return parsed.products
    .map((p) => {
      const promos = [
        `1 unidad ${formatGs(p.price1)} Gs`,
        p.price2 ? `2 unidades ${formatGs(p.price2)} Gs` : "",
        p.price3 ? `3 unidades ${formatGs(p.price3)} Gs` : "",
      ].filter(Boolean).join(" | ");
      return `- ${p.canonical}: ${promos}`;
    })
    .join("\n");
}

function hasTemplateForProduct(templatePricing: TemplatePricing | null | undefined, productName: string) {
  return Boolean(
    templatePricing &&
    productName &&
    normalize(templatePricing.product) === normalize(productName) &&
    Array.isArray(templatePricing.offers) &&
    templatePricing.offers.length > 0
  );
}

function hasActiveTemplatePricing(templatePricing: TemplatePricing | null | undefined, order?: OrderData | null) {
  return Boolean(order?.product && hasTemplateForProduct(templatePricing, order.product));
}

function templatePricingSummary(templatePricing: TemplatePricing | null | undefined) {
  if (!templatePricing?.offers?.length) return "No hay plantilla activa.";

  return templatePricing.offers
    .filter((o) => o.total >= 10000)
    .sort((a, b) => a.quantity - b.quantity)
    .map((o) => {
      const fixed = o.fixed_quantity ? " PACK FIJO" : "";
      return `- ${o.quantity} unidad${o.quantity > 1 ? "es" : ""}: ${formatGs(o.total)} Gs${fixed}`;
    })
    .join("\n");
}

function catalogForPrompt(parsed: ParsedTraining, state: ConversationState, templatePricing?: TemplatePricing | null) {
  if (hasActiveTemplatePricing(templatePricing, state.order)) {
    return `
MODO PLANTILLA ACTIVA:
- Hay una plantilla/promoción activa para este pedido.
- Producto, cantidad, promo y precio salen EXCLUSIVAMENTE de la plantilla.
- NO usar CATALOGO_PRODUCTOS ni precios del entrenamiento para este pedido.
- NO ofrecer unidades, packs ni promos que no aparezcan en la plantilla.
- NO ofrecer 1 unidad si la plantilla solo muestra pack de 2.
- NO recalcular total multiplicando precio de plantilla por cantidad.
- Si la plantilla trae una sola oferta, respetar esa oferta.
- Si la plantilla trae Producto + Cantidad + Precio, respetar exactamente esos datos.

DATOS DE LA PLANTILLA ACTIVA:
Producto: ${templatePricing?.product || state.order.product}
Ofertas detectadas:
${templatePricingSummary(templatePricing)}
`.trim();
  }

  return `
MODO CATÁLOGO / ENTRENAMIENTO:
- No hay plantilla activa.
- Usar la lista de precios del entrenamiento.
- Podés ofrecer productos y promos del catálogo.

CATÁLOGO:
${productsSummary(parsed)}

URL CATÁLOGO:
${parsed.catalogUrl || "No configurado."}
`.trim();
}

function buildHardInstruction(state: ConversationState) {
  const { order, coverage, missing } = state;

  if (!order.product) {
    return "Vender: presentar opciones del catálogo y preguntar qué producto le interesa. No pedir ciudad todavía si no hay producto.";
  }

  if (!order.city) {
    if (order.locked_offer?.fixed_quantity) {
      return `Confirmar que la promo es un pack fijo de ${order.locked_offer.quantity} unidades por ${formatGs(order.locked_offer.total)} Gs, aclarar que no se vende por unidad y preguntar SOLO ciudad de envío. No pedir nombre/dirección/teléfono todavía.`;
    }
    return "Confirmar producto/precio/promo y preguntar SOLO ciudad de envío. No inventar ciudad. No pedir nombre/dirección/teléfono todavía.";
  }

  if (!order.quantity) {
    if (order.locked_offer?.fixed_quantity) {
      return `La cantidad ya está definida por la plantilla: pack fijo de ${order.locked_offer.quantity} unidades por ${formatGs(order.locked_offer.total)} Gs. No preguntar 1 o 2. Avanzar con ciudad o datos faltantes.`;
    }

    const promoText =
      order.locked_offer && order.locked_offer.quantity > 1
        ? ` Preguntar explícitamente si quiere 1 unidad o la promo de ${order.locked_offer.quantity} unidades por ${formatGs(order.locked_offer.total)} Gs.`
        : " Preguntar explícitamente si quiere 1 unidad o más unidades según las promos disponibles.";

    if (coverage === false) {
      return "Informar con tacto que no tiene contra-entrega y que se envía por transportadora con pago anticipado, PERO pedir primero cantidad." + promoText + " No mostrar datos bancarios hasta tener cantidad.";
    }

    return "Confirmar cobertura/envío gratis si aplica y preguntar cantidad antes de pedir datos personales." + promoText + " No pedir nombre, dirección ni teléfono todavía.";
  }

  if (coverage === false && order.quantity > 0) {
    if (missing.length > 0) {
      return "Informar total, explicar envío por transportadora y pago anticipado. Mostrar datos de transferencia porque ya hay cantidad. Pedir SOLO lo faltante: nombre completo, teléfono y/o comprobante de transferencia. Si el cliente pidió fecha/horario/pagar después, aclarar que queda anotado como observación. IMPORTANTE: no confirmar el pedido hasta recibir comprobante.";
    }
    return "Confirmar el pedido por transportadora porque ya se recibió comprobante y datos.";
  }

  if (missing.length > 0) {
    return `Pedir SOLO lo faltante: ${missing.join(", ")}. No repetir lo que ya está completo. Si la ciudad ya está cargada como "${order.city}", NO vuelvas a preguntar ciudad. Usá emojis y tono amable de vendedor.`;
  }

  return "Confirmar pedido completo. No preguntes si está todo correcto. El backend responde con el formato fijo de PEDIDO CONFIRMADO.";
}


function sanitizeProductPrices(parsed: ParsedTraining) {
  for (const product of parsed.products) {
    if (product.price1 > 0 && product.price1 < 10000) {
      console.error("❌ Precio menor a 10.000 descartado", {
        product: product.canonical,
        price1: product.price1,
      });
      product.price1 = 0;
    }

    if (product.price2 && product.price2 < 10000) product.price2 = undefined;
    if (product.price3 && product.price3 < 10000) product.price3 = undefined;
  }
}

function buildState(order: OrderData, parsed: ParsedTraining): ConversationState {
  // V87: el número del WhatsApp se completa desde el contexto antes de calcular faltantes.
  // Nunca se solicita nuevamente al cliente.
  if (!order.phone) {
    order.phone = clean((order as any).from_number || "");
  }

  const productInfo = getProductInfo(order.product, parsed);
  const coverage = order.city ? hasCoverage(order.city, parsed) : null;
  const total = order.product && order.quantity ? calculateTotal(order.product, order.quantity, parsed, order.locked_offer) : 0;
  const addressOptional = isAddressOptionalByTraining(parsed, coverage);
  const missing = getMissing(order, coverage, addressOptional);
  const step = nextStep(order, coverage, addressOptional);

  const state: ConversationState = {
    order,
    step,
    productInfo,
    coverage,
    total,
    missing,
    hardInstruction: "",
    addressOptional,
  };

  state.hardInstruction = buildHardInstruction(state);
  return state;
}

function shouldConfirmOrder(state: ConversationState) {
  const o = state.order;

  if (!o.product || !o.city || !o.quantity || !o.customer_name) {
    return false;
  }

  const confirmationName = normalize(o.customer_name);
  const confirmationCity = normalize(o.city);
  const confirmationWords = clean(o.customer_name).split(/\s+/).filter(Boolean);
  if (
    confirmationWords.length < 2 ||
    /\d/.test(o.customer_name) ||
    !isStrictStandaloneCustomerName(o.customer_name, o.city) ||
    /\b(nombre|apellido|cliente|usuario|contacto|y apellido)\b/.test(confirmationName) ||
    /\b(noo+|nop+|qro|kiero|quiero|voia|voy|poder|solo|solamente|pra|prfavor|porfa|favor|combo|promo|crema|producto|para mi)\b/.test(confirmationName) ||
    /^(yo|no|noo+|nop+|n|qro|kiero|quiero|solo|solamente)\b/.test(confirmationName) ||
    (confirmationCity && confirmationName === confirmationCity)
  ) {
    return false;
  }

  if (state.coverage !== false && !state.addressOptional && !o.address) {
    return false;
  }

  if (state.coverage === false && !o.payment_proof_verified) {
    return false;
  }

  return state.step === "confirm_order";
}

function hasAllRequiredOrderDataForDirectConfirmation(state: ConversationState) {
  const o = state.order;

  const hasBaseData = Boolean(
    clean(o.product) &&
    clean(o.city) &&
    sanitizeQuantity(o.quantity) > 0 &&
    clean(o.customer_name)
  );

  if (!hasBaseData) return false;

  if (!state.productInfo) return false;

  if (state.coverage !== false) {
    return state.addressOptional || Boolean(clean(o.address));
  }

  return Boolean(o.payment_proof_verified);
}

function minutesSince(lastActivity?: string) {
  const last = new Date(lastActivity || "");
  if (!Number.isFinite(last.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - last.getTime()) / (1000 * 60));
}

function isOrderStale(order: OrderData, lastActivity: string) {
  const hasAnyOrderData = Boolean(
    clean(order?.product) ||
    clean(order?.city) ||
    sanitizeQuantity(order?.quantity) > 0 ||
    clean(order?.customer_name) ||
    clean(order?.address)
  );

  if (!hasAnyOrderData) return false;

  // V100: un pedido incompleto no puede quedar pegado indefinidamente.
  // Después de 45 minutos sin actividad se considera una nueva sesión.
  return minutesSince(lastActivity) > 45;
}

function looksLikeNewChatSession(text: string, context: any, history: any[]) {
  const n = normalize(text);
  const ageMinutes = minutesSince(context?.updated_at);
  const historyIsEmpty = !Array.isArray(history) || history.length === 0;
  const greeting = /^(hola+|holi|buenas|buen dia|buen día|buenas tardes|buenas noches|saludos|consulta)$/.test(n);

  // Si el frontend abrió un chat sin historial, no reutilizamos un pedido viejo.
  if (historyIsEmpty && ageMinutes > 5) return true;

  // Un saludo después de una pausa considerable se toma como conversación nueva.
  if (greeting && ageMinutes > 20) return true;

  return ageMinutes > 45;
}

async function safeUpsertOrder(
  userId: string,
  from: string,
  order: OrderData,
  parsed: ParsedTraining,
  confirm = false
): Promise<string | null> {
  if (!userId || !from) return null;

  const productInfo = getProductInfo(order.product, parsed);
  const canonicalProduct = productInfo?.canonical || clean(order.product);

  if (!canonicalProduct || isGenericProductLabel(canonicalProduct)) {
    console.error("❌ Producto inválido para guardar:", order.product);
    return null;
  }

  order.product = canonicalProduct;
  order.quantity = sanitizeQuantity(order.quantity);

  // V113: nunca inventar 1 unidad al persistir. En una confirmación la
  // cantidad debe existir; en borradores puede guardarse 0 hasta que el
  // cliente elija una promoción.
  if (confirm && order.quantity <= 0) {
    console.error("❌ Confirmación rechazada por cantidad inválida:", order.quantity);
    return null;
  }

  if (!order.phone) order.phone = senderPhoneFallback(from);

  const state = buildState(order, parsed);
  const total = Number(state.total || calculateTotal(order.product, order.quantity, parsed, order.locked_offer) || 0);

  const paymentMethod = state.coverage === false
    ? "pago_anticipado"
    : "contra_entrega";

  const basePayload: Record<string, any> = {
    user_id: userId,
    from_number: from,
    phone: order.phone || from,
    product: canonicalProduct,
    customer_name: clean(order.customer_name) || null,
    city: clean(order.city) || null,
    address: clean(order.address) || null,
    quantity: order.quantity,
    total_amount: String(total),
    status: confirm ? "confirmado" : state.step,
  };

  // V132: la tabla orders actual guarda un producto por fila y no requiere
  // una columna JSON `items`. Los pedidos multiproducto se persisten mediante
  // saveMultiProductOrders(), creando una fila hija por producto con el mismo groupId.
  // Esto evita PGRST204 cuando el esquema de Supabase no contiene `items`.
  const extendedPayload: Record<string, any> = {
    ...basePayload,
    metodo_pago: paymentMethod,
    detected_by_ai: true,
    observation: clean(order.observation) || null,
    preferred_delivery_date: clean(order.preferred_delivery_date) || null,
    preferred_delivery_time: clean(order.preferred_delivery_time) || null,
    payment_note: clean(order.payment_note) || null,
  };

  const mediumPayload: Record<string, any> = {
    ...basePayload,
    metodo_pago: paymentMethod,
    detected_by_ai: true,
  };

  const payloadCandidates = [
    extendedPayload,
    mediumPayload,
    basePayload,
  ];

  const confirmedStatusCandidates = confirm
    ? ["confirmado", "confirmed"]
    : [state.step];

  const activeStatuses = [
    "draft",
    "selling",
    "collecting_city",
    "collecting_quantity",
    "collecting_name",
    "collecting_phone",
    "collecting_address",
    "waiting_payment_proof",
    "confirm_pending",
    "pending",
    "pendiente",
  ];

  const isConfirmedStatus = (value: any) => {
    const n = normalize(value);
    return n === "confirmado" || n === "confirmed";
  };

  const tryWrite = async (
    mode: "update" | "insert",
    payload: Record<string, any>,
    rowId?: string
  ): Promise<string | null> => {
    for (const statusValue of confirmedStatusCandidates) {
      const finalPayload = { ...payload, status: statusValue };

      let query: any;
      if (mode === "update" && rowId) {
        query = supabase
          .from("orders")
          .update(finalPayload)
          .eq("id", rowId)
          .eq("user_id", userId);
      } else {
        query = supabase
          .from("orders")
          .insert(finalPayload);
      }

      const { data, error } = await query
        .select("id, status")
        .single();

      if (error) {
        console.error(`❌ orders ${mode} falló con status=${statusValue}:`, error);
        continue;
      }

      if (!data?.id) continue;

      if (confirm && !isConfirmedStatus(data.status)) {
        console.error("❌ El registro no quedó confirmado:", data);
        continue;
      }

      // Verificación final: volver a leer la fila real guardada.
      const { data: verified, error: verifyError } = await supabase
        .from("orders")
        .select("id, status, product, quantity, total_amount, customer_name, city, address")
        .eq("id", data.id)
        .eq("user_id", userId)
        .single();

      if (verifyError || !verified?.id) {
        console.error("❌ No se pudo verificar el pedido guardado:", verifyError);
        continue;
      }

      if (confirm && !isConfirmedStatus(verified.status)) {
        console.error("❌ La verificación final no encontró estado confirmado:", verified);
        continue;
      }

      return verified.id;
    }

    return null;
  };

  let activeOrderId: string | null = null;

  const { data: activeOrder, error: activeError } = await supabase
    .from("orders")
    .select("id")
    .eq("user_id", userId)
    .eq("from_number", from)
    .in("status", activeStatuses)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) {
    console.error("❌ Error buscando pedido activo:", activeError);
  } else {
    activeOrderId = activeOrder?.id || null;
  }

  // Intenta actualizar el pedido activo con payload completo, medio y básico.
  if (activeOrderId) {
    for (const payload of payloadCandidates) {
      const updatedId = await tryWrite("update", payload, activeOrderId);
      if (updatedId) return updatedId;
    }
  }

  // Si no había pedido activo o la actualización falló, crea uno nuevo.
  for (const payload of payloadCandidates) {
    const insertedId = await tryWrite("insert", payload);
    if (insertedId) return insertedId;
  }

  console.error("❌ No se pudo guardar el pedido después de todos los reintentos", {
    userId,
    from,
    product: canonicalProduct,
    quantity: order.quantity,
    total,
    confirm,
  });

  return null;
}

async function fetchMediaAsBase64(url: string) {
  const r = await fetch(url);
  if (!r.ok) return null;

  const mime = r.headers.get("content-type") || "application/octet-stream";
  const buf = Buffer.from(await r.arrayBuffer());

  return {
    data: buf.toString("base64"),
    mime: mime.split(";")[0].trim(),
  };
}

function isGeminiQuotaErrorPayload(data: any) {
  const raw = JSON.stringify(data || {}).toLowerCase();
  return (
    raw.includes("resource_exhausted") ||
    raw.includes("quota") ||
    raw.includes("rate-limits") ||
    raw.includes("429")
  );
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

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    console.error("❌ Gemini:", JSON.stringify(data).slice(0, 800));
    if (r.status === 429 || isGeminiQuotaErrorPayload(data)) return "__GEMINI_QUOTA_EXCEEDED__";
    return "";
  }

  return clean(
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("") || ""
  );
}


type PaymentProofAnalysis = {
  readable: boolean;
  successful: boolean;
  holder_name: string;
  amount: number;
  operation_number: string;
  status_text: string;
  recipient_name: string;
  recipient_document: string;
  recipient_account: string;
  recipient_alias: string;
  recipient_bank: string;
  error: string;
};

function parseJsonObjectFromModel(text: string): any {
  const raw = clean(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {}

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function normalizePaymentProofAnalysis(value: any): PaymentProofAnalysis {
  const amount = Number(String(value?.amount ?? value?.monto ?? 0).replace(/[^\d]/g, "") || 0);
  const holder = clean(value?.holder_name || value?.titular || value?.payer_name || "");
  const operation = clean(value?.operation_number || value?.numero_operacion || value?.operation || "");
  const status = clean(value?.status_text || value?.estado || "");
  const successValue = value?.successful ?? value?.exitosa ?? value?.success;
  const readableValue = value?.readable ?? value?.legible;

  return {
    readable: readableValue === true || normalize(readableValue) === "true",
    successful:
      successValue === true ||
      normalize(successValue) === "true" ||
      /\b(exitosa|exitoso|aprobada|aprobado|completada|completado|realizada|realizado)\b/.test(normalize(status)),
    holder_name: holder,
    amount: Number.isFinite(amount) ? amount : 0,
    operation_number: operation,
    status_text: status,
    recipient_name: clean(value?.recipient_name || value?.beneficiary_name || value?.beneficiario || value?.destinatario || ""),
    recipient_document: clean(value?.recipient_document || value?.beneficiary_document || value?.documento_beneficiario || ""),
    recipient_account: clean(value?.recipient_account || value?.credited_account || value?.cuenta_acreditada || ""),
    recipient_alias: clean(value?.recipient_alias || value?.beneficiary_alias || value?.alias_destino || ""),
    recipient_bank: clean(value?.recipient_bank || value?.beneficiary_bank || value?.entidad_destino || value?.banco_destino || ""),
    error: clean(value?.error || value?.motivo || ""),
  };
}

function onlyComparableDigits(value: any) {
  return clean(value).replace(/\D/g, "");
}

function normalizedBankText(value: any) {
  return normalize(value).replace(/\b(sa|s a|banco|bank|entidad)\b/g, " ").replace(/\s+/g, " ").trim();
}

function namesMatch(a: any, b: any) {
  const left = normalize(a).split(/\s+/).filter((word) => word.length >= 2);
  const right = normalize(b).split(/\s+/).filter((word) => word.length >= 2);
  if (!left.length || !right.length) return false;

  const leftSet = new Set(left);
  const common = right.filter((word) => leftSet.has(word)).length;
  return common >= Math.min(2, Math.min(left.length, right.length));
}

function paymentRecipientMatchesBankData(analysis: PaymentProofAnalysis, bankData: BankData | null) {
  if (!bankData) return false;

  const expectedDocument = onlyComparableDigits(bankData.ci);
  const expectedAccount = onlyComparableDigits(bankData.cuenta);
  const expectedAlias = onlyComparableDigits(bankData.alias);
  const actualDocument = onlyComparableDigits(analysis.recipient_document);
  const actualAccount = onlyComparableDigits(analysis.recipient_account);
  const actualAlias = onlyComparableDigits(analysis.recipient_alias);

  const nameMatch = Boolean(bankData.titular && analysis.recipient_name && namesMatch(bankData.titular, analysis.recipient_name));
  const documentMatch = Boolean(expectedDocument && actualDocument && expectedDocument === actualDocument);
  const accountMatch = Boolean(expectedAccount && actualAccount && expectedAccount === actualAccount);
  const aliasMatch = Boolean(expectedAlias && actualAlias && expectedAlias === actualAlias);

  const expectedBank = normalizedBankText(bankData.entidad || bankData.banco || "");
  const actualBank = normalizedBankText(analysis.recipient_bank);
  const bankMatch = Boolean(
    expectedBank &&
    actualBank &&
    (expectedBank.includes(actualBank) || actualBank.includes(expectedBank))
  );

  // Coincidencia fuerte por identificador exacto, o nombre + banco.
  return Boolean(
    documentMatch ||
    accountMatch ||
    aliasMatch ||
    (nameMatch && (bankMatch || !expectedBank))
  );
}

async function analyzePaymentProofWithGemini({
  apiKey,
  model,
  mediaBase64,
  mime,
  expectedAmount,
  bankData,
}: {
  apiKey: string;
  model: string;
  mediaBase64: string;
  mime: string;
  expectedAmount: number;
  bankData: BankData | null;
}): Promise<PaymentProofAnalysis> {
  const fallback: PaymentProofAnalysis = {
    readable: false,
    successful: false,
    holder_name: "",
    amount: 0,
    operation_number: "",
    status_text: "",
    recipient_name: "",
    recipient_document: "",
    recipient_account: "",
    recipient_alias: "",
    recipient_bank: "",
    error: "No se pudo analizar el comprobante.",
  };

  const expectedRecipient = [
    bankData?.titular ? `Titular esperado: ${bankData.titular}` : "",
    bankData?.ci ? `CI esperada: ${bankData.ci}` : "",
    bankData?.entidad || bankData?.banco ? `Entidad esperada: ${bankData?.entidad || bankData?.banco}` : "",
    bankData?.cuenta ? `Cuenta esperada: ${bankData.cuenta}` : "",
    bankData?.alias ? `Alias esperado: ${bankData.alias}` : "",
  ].filter(Boolean).join("\n");

  const response = await callGemini({
    apiKey,
    model,
    system: `Analizás comprobantes bancarios enviados por clientes.
Extraé solamente datos visibles. No inventes información.
Respondé exclusivamente JSON válido, sin markdown:
{
  "readable": boolean,
  "successful": boolean,
  "holder_name": string,
  "amount": number,
  "operation_number": string,
  "status_text": string,
  "recipient_name": string,
  "recipient_document": string,
  "recipient_account": string,
  "recipient_alias": string,
  "recipient_bank": string,
  "error": string
}

Definiciones:
- holder_name: titular o remitente de la cuenta DEBITADA; es quien hizo el pago.
- recipient_name: beneficiario o destinatario de la transferencia.
- recipient_document: documento/CI del beneficiario.
- recipient_account: cuenta ACREDITADA o cuenta destino.
- recipient_alias: alias del destinatario.
- recipient_bank: banco o entidad receptora.
- amount: monto total transferido como entero, sin puntos.
- successful: true solo si una imagen/captura muestra claramente operación exitosa, aprobada, completada o equivalente.
- En un PDF bancario, successful puede ser false si el documento no trae una frase explícita; igual extraé todos los demás datos.
- readable: true si se leen claramente pagador, monto y al menos un dato del destinatario.
- No confundas al pagador con el beneficiario.

Datos bancarios esperados del vendedor:
${expectedRecipient || "No configurados"}

Total esperado del pedido: ${expectedAmount} Gs.
No alteres los valores leídos para hacerlos coincidir.`,
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: mime, data: mediaBase64 } },
        { text: "Extraé los datos del pagador, destinatario, monto, estado y operación." },
      ],
    }],
    temperature: 0,
    maxTokens: 1000,
  });

  if (!response || response === "__GEMINI_QUOTA_EXCEEDED__") {
    return {
      ...fallback,
      error: response === "__GEMINI_QUOTA_EXCEEDED__"
        ? "No se pudo verificar porque el analizador está sin cuota."
        : fallback.error,
    };
  }

  const parsed = parseJsonObjectFromModel(response);
  return parsed ? normalizePaymentProofAnalysis(parsed) : fallback;
}

function paymentProofVerificationMessage(order: OrderData, expectedAmount: number): string {
  if (!order.payment_proof_received) return "";

  if (order.payment_proof_verified) {
    return `${
      order.payment_manual_review_required
        ? "✅ Comprobante recibido\n⏳ Acreditación pendiente de verificación manual"
        : "✅ Comprobante verificado"
    }

👤 Pagador detectado: ${order.payment_holder_name}
💰 Monto detectado: ${formatGs(order.payment_amount || 0)} Gs
🏦 Destinatario verificado: ${order.payment_recipient_name || "cuenta bancaria configurada"}${order.payment_operation_number ? `
🔢 Operación: ${order.payment_operation_number}` : ""}

El monto cubre el total del pedido de ${formatGs(expectedAmount)} Gs.`;
  }

  const details = [
    order.payment_holder_name ? `👤 Pagador detectado: ${order.payment_holder_name}` : "",
    order.payment_amount ? `💰 Monto detectado: ${formatGs(order.payment_amount)} Gs` : "",
    order.payment_recipient_name ? `🏦 Destinatario detectado: ${order.payment_recipient_name}` : "",
    order.payment_status_text ? `📄 Estado detectado: ${order.payment_status_text}` : "",
  ].filter(Boolean);

  return `⚠️ Recibí el comprobante, pero todavía no puedo confirmar el pedido.

${details.length ? `${details.join("\n")}

` : ""}${order.payment_verification_error || "No pude verificar correctamente el destinatario y el monto."}

Por favor enviame una imagen o PDF donde se vea:
✅ monto
✅ titular de la cuenta debitada
✅ beneficiario o destinatario
✅ cuenta acreditada, CI o alias
✅ número de operación, cuando esté disponible`;
}


async function transcribeAudioWithGemini({
  apiKey,
  model,
  audioBase64,
  mime,
}: any) {
  return callGemini({
    apiKey,
    model,
    system: "Transcribí el audio al español. Devolvé solo texto plano.",
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: mime, data: audioBase64 } },
          { text: "Transcribí este audio." },
        ],
      },
    ],
    temperature: 0.1,
    maxTokens: 1024,
  });
}

async function transcribeAudioWithOpenAI({
  audioBase64,
  mime,
}: {
  audioBase64: string;
  mime: string;
}) {
  const apiKey = clean(process.env.OPENAI_API_KEY || "");
  if (!apiKey) return "";

  try {
    const ext = mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "mp4" : mime.includes("wav") ? "wav" : mime.includes("webm") ? "webm" : "ogg";
    const buffer = Buffer.from(audioBase64, "base64");
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("language", "es");
    form.append("response_format", "json");
    form.append("file", new Blob([buffer], { type: mime || "audio/ogg" }), `audio.${ext}`);

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("❌ OpenAI Whisper:", JSON.stringify(data).slice(0, 800));
      return "";
    }

    return clean(data?.text || "");
  } catch (err) {
    console.error("❌ OpenAI Whisper exception:", err);
    return "";
  }
}

async function transcribeAudioSmart({
  apiKey,
  model,
  audioBase64,
  mime,
}: any) {
  const geminiText = await transcribeAudioWithGemini({ apiKey, model, audioBase64, mime });
  if (geminiText && geminiText !== "__GEMINI_QUOTA_EXCEEDED__") {
    return { text: geminiText, reason: "gemini" };
  }

  const openAiText = await transcribeAudioWithOpenAI({ audioBase64, mime });
  if (openAiText) return { text: openAiText, reason: "openai_whisper" };

  if (geminiText === "__GEMINI_QUOTA_EXCEEDED__") {
    return { text: "", reason: "gemini_quota" };
  }

  return { text: "", reason: "transcription_failed" };
}


function buildDeterministicMissingDataSummary(state: ConversationState) {
  const o = state.order;
  const lines = [
    `📦 Producto: ${clean(o.product) || "—"}`,
    `🔢 Cantidad: ${o.quantity || "—"}`,
    `📍 Ciudad: ${clean(o.city) || "—"}`,
    `📞 Celular: ${clean(o.phone) || "—"}`,
  ];

  const missing: string[] = [];

  if (!clean(o.customer_name)) missing.push("nombre y apellido");
  if (!state.addressOptional && (!clean(o.address) || isOnlyPurchaseWithSize(o.address))) missing.push("calle o dirección exacta");

  // El teléfono nunca se pide: se toma del WhatsApp.
  if (!clean(o.phone)) {
    o.phone = senderPhoneFallback("");
  }

  if (!missing.length) return "";

  return `${lines.join("\n")}

Solo me falta:
${missing.map((item) => `✅ ${item}`).join("\n")}`;
}

function finalConfirmationMessage(state: ConversationState, parsed: ParsedTraining) {
  const o = state.order;

  // V106: protección final contra promociones desfasadas y packs fijos.
  if (
    o.locked_offer &&
    sanitizeQuantity(o.locked_offer.quantity) !== sanitizeQuantity(o.quantity)
  ) {
    o.locked_offer = null;
  }

  const confirmationProduct = getProductInfo(o.product, parsed);
  if (!o.locked_offer && confirmationProduct) {
    const confirmationOffer = getCatalogOffer(confirmationProduct, o.quantity);
    if (confirmationOffer) {
      o.locked_offer = confirmationOffer;
    }
  }

  // Siempre recalcular con la oferta correcta. Para packs fijos, el total es el
  // precio completo del pack y nunca price1 × quantity.
  state.total = calculateTotal(o.product, o.quantity, parsed, o.locked_offer);
  const deliveryLocation = clean(o.address)
    ? [clean(o.city), clean(o.address)].filter(Boolean).join(" — ")
    : `${clean(o.city)} — ubicación pendiente para coordinar con el delivery`;

  // En encomienda/transportadora la ciudad es el destino suficiente para cerrar.
  // No mostrar “ubicación pendiente”, porque no se trata de entrega domiciliaria.
  const transportDestination = clean(o.city);

  if (state.coverage === false) {
    return `✅ PEDIDO CONFIRMADO

📦 Producto: ${o.product}
🔢 Cantidad: ${o.quantity} u.
💰 Total: ${formatGs(state.total)} Gs

👤 Cliente: ${o.customer_name}
📍 Destino: ${transportDestination}
📞 Contacto: ${o.phone}${observationBlock(o)}

🚚 Envío por transportadora
${o.payment_manual_review_required
  ? "💳 Comprobante recibido\n⏳ Acreditación pendiente de verificación manual"
  : "💳 Pago anticipado verificado"}
👤 Pagador: ${o.payment_holder_name}
🏦 Destinatario verificado: ${o.payment_recipient_name || parsed.bankData?.titular || "cuenta configurada"}
💰 Monto recibido: ${formatGs(o.payment_amount || 0)} Gs${o.payment_operation_number ? `
🔢 Operación: ${o.payment_operation_number}` : ""}

Una vez despachado, te enviaremos el comprobante correspondiente. 📦

¡Muchas gracias por tu compra! 💜`;
  }

  return `✅ PEDIDO CONFIRMADO

📦 Producto: ${o.product}
🔢 Cantidad: ${o.quantity} u.
💰 Total: ${formatGs(state.total)} Gs

👤 Cliente: ${o.customer_name}
📍 Ubicación: ${deliveryLocation}
📞 Contacto: ${o.phone}${observationBlock(o)}

🚚 Envío GRATIS
💵 Pagás al recibir en efectivo o por transferencia al delivery.

Nuestro equipo se pondrá en contacto para coordinar la entrega. 📲

¡Muchas gracias por tu compra! 💜`;
}

function deterministicAfterCityCoverageMessage(state: ConversationState) {
  const o = state.order;
  if (!o.product || !o.city) return "";

  // Los packs fijos usan un mensaje más completo en otra función.
  if (o.locked_offer?.fixed_quantity) return "";

  if (state.coverage === false) {
    if (!o.quantity) {
      return `📍 ${o.city} está fuera de nuestra zona de contra-entrega.

😊 Igual podemos enviarte por transportadora 🚚
💳 Para este destino el pago es anticipado.

¿Cuántas unidades querés llevar?`;
    }

    return `📍 ${o.city} está fuera de nuestra zona de contra-entrega.

😊 Igual podemos enviarte por transportadora 🚚
💳 Para este destino el pago es anticipado.

Para continuar, realizá la transferencia y enviame el comprobante.

Si todavía no me pasaste tu nombre completo, enviámelo junto con el comprobante.`;
  }

  if (!o.quantity) {
    const offers = state.productInfo ? productOffersText(state.productInfo) : "";
    return `✅ Tenemos envío GRATIS contra entrega en ${o.city} 🚚

Pagás solamente el producto cuando lo recibís 😊

${offers ? `🔥 Promociones disponibles:
${offers}

` : ""}¿Cuántas unidades querés llevar?`;
  }

  return "";
}

function deterministicAfterCityFixedOfferMessage(state: ConversationState, parsed: ParsedTraining) {
  const o = state.order;
  if (!o.product || !o.city || !o.locked_offer?.fixed_quantity) return "";

  const total = o.locked_offer.total;

  if (state.coverage === false) {
    return `✅ Perfecto 😊

📦 Promo confirmada:
${o.locked_offer.quantity} unidades de ${o.product}
💰 Total: ${formatGs(total)} Gs

📍 ${o.city} no cuenta con contra-entrega, pero hacemos envío por transportadora 🚚

💵 Para avanzar, realizá la transferencia y enviame el comprobante.

📞 Ya tengo tu número de WhatsApp.
👤 Si todavía no me pasaste tu nombre completo, enviámelo también para registrar el pedido.

${bankDataText(parsed)} 📲`;
  }

  const fixedRequiredLines = [
    !clean(o.customer_name) ? "✅ nombre y apellido" : "",
    !state.addressOptional && !clean(o.address) ? "✅ dirección exacta o ubicación" : "",
  ].filter(Boolean);

  const fixedOptionalLocation =
    state.addressOptional && !clean(o.address)
      ? "\n\n📍 La ubicación es opcional; podés enviarla después o pasarla directamente al delivery."
      : "";

  return `✅ Perfecto 😊

📦 Promo confirmada:
${o.locked_offer.quantity} unidades de ${o.product}
💰 Total: ${formatGs(total)} Gs

📍 ${o.city} tiene envío GRATIS y pagás al recibir 🚚${observationBlock(o)}

${fixedRequiredLines.length ? `Ahora solo necesito:
${fixedRequiredLines.join("\n")}` : "Ya tengo los datos obligatorios para registrar el pedido."}${fixedOptionalLocation}
📞 Ya tengo tu número de WhatsApp: ${o.phone || senderPhoneFallback("")}`;
}

function deterministicAfterQuantityMessage(state: ConversationState, parsed: ParsedTraining) {
  const o = state.order;
  if (!o.product || !o.city || !o.quantity) return "";

  if (state.step !== "collecting_name" && state.step !== "collecting_address" && state.step !== "collecting_phone") {
    return "";
  }

  if (state.missing.includes("ciudad")) return "";

  const promoLine =
    o.locked_offer && o.locked_offer.quantity === o.quantity
      ? `🔥 Promo aplicada: ${o.quantity} unidades por ${formatGs(state.total)} Gs`
      : `💰 Total: ${formatGs(state.total)} Gs`;

  if (state.coverage === false) {
    return `🎉 ¡Perfecto! Queda seleccionado:

📦 ${o.product}
🔢 Cantidad: ${o.quantity}
${promoLine}
📍 Ciudad: ${o.city}${observationBlock(o)}

🚚 Para tu zona hacemos envío por transportadora con pago anticipado.

💵 Para avanzar, realizá la transferencia y enviame el comprobante junto con:
✅ nombre completo
📞 Ya tengo tu número de WhatsApp

${bankDataText(parsed)} 📲`;
  }

  const optionalLocationNote =
    state.addressOptional && !clean(o.address)
      ? "\n\n📍 La ubicación es opcional; podés enviarla después o pasarla directamente al delivery."
      : "";

  const requiredLines = [
    !clean(o.customer_name) ? "✅ nombre y apellido" : "",
    !state.addressOptional && !clean(o.address) ? "✅ dirección exacta o ubicación" : "",
  ].filter(Boolean);

  return `🎉 ¡Excelente elección! Queda seleccionado:

📦 ${o.product}
🔢 Cantidad: ${o.quantity}
${promoLine}
📍 ${o.city} tiene envío GRATIS y pagás al recibir 🚚

${requiredLines.length ? `Ahora solo necesito:
${requiredLines.join("\n")}` : "Ya tengo los datos obligatorios para registrar el pedido."}${optionalLocationNote}
📞 Ya tengo tu número de WhatsApp: ${o.phone || senderPhoneFallback("")}`;
}

function deterministicWaitingPaymentProofMessage(state: ConversationState, parsed: ParsedTraining) {
  const o = state.order;
  if (state.coverage !== false) return "";
  if (state.step !== "waiting_payment_proof") return "";
  if (!o.product || !o.city || !o.quantity || !o.phone) return "";

  if (o.payment_proof_received && !o.payment_proof_verified) {
    return paymentProofVerificationMessage(o, state.total);
  }

  return `✅ Perfecto, ya tengo tus datos 😊

📦 Producto: ${o.product}
🔢 Cantidad: ${o.quantity}
💰 Total: ${formatGs(state.total)} Gs
📍 Ciudad: ${o.city}
👤 Cliente: ${o.customer_name || "pendiente"}
📞 Celular: ${o.phone}${observationBlock(o)}

🚚 Para tu zona hacemos envío por transportadora con pago anticipado.

📎 Para CONFIRMAR tu pedido necesito que me envíes la foto/PDF del comprobante de transferencia.

${bankDataText(parsed)} 📲

Cuando me pases el comprobante, validaré el destinatario y el monto. Si todo coincide, el pedido se confirma automáticamente 😊`;
}

function deterministicObservationAckMessage(state: ConversationState, parsed: ParsedTraining, observationPatch?: Partial<OrderData> | null) {
  if (!hasOrderObservation(observationPatch || {})) return "";

  const o = state.order;
  const obs = observationBlock(o);
  const intro = `Perfecto 😊 dejé anotada esa observación para tu pedido.${obs}`;

  if (state.coverage === false && state.step === "waiting_payment_proof") {
    const proofMsg = deterministicWaitingPaymentProofMessage(state, parsed);
    if (proofMsg) return proofMsg;
  }

  if (!o.product) {
    return `${intro}\n\nPara ayudarte bien, decime qué producto te interesa 😊`;
  }

  if (!o.city) {
    return `${intro}\n\n📍 ¿Para qué ciudad sería el envío? 😊`;
  }

  if (!o.quantity) {
    return `${intro}\n\n¿Cuántas unidades querés llevar? 😊`;
  }

  if (state.coverage === false && !o.payment_proof_received) {
    return `${intro}\n\n🚚 Para tu zona hacemos envío por transportadora con pago anticipado.\n\nPara avanzar, enviame por favor:\n✅ nombre completo\n📞 Ya tengo tu número de WhatsApp\n✅ comprobante de transferencia\n\n${bankDataText(parsed)} 📲`;
  }

  if (state.missing.length) {
    const deterministicSummary = buildDeterministicMissingDataSummary(state);
    if (deterministicSummary) return deterministicSummary;
  }

  return `${intro}\n\n✅ Tengo todos los datos del pedido. Nuestro equipo tendrá en cuenta esa observación para coordinar 😊`;
}

function buildSalesSystemPrompt(parsed: ParsedTraining, state: ConversationState, templatePricing?: TemplatePricing | null, copyAlreadySent = false) {
  const o = state.order;

  return `
Sos la IA vendedora de Mega Todo Store / One Store.
Tu trabajo es vender de forma natural, amable y segura por WhatsApp. Cuando hay copy de producto cargado, debés respetarlo completo la PRIMERA vez que se presenta.

REGLA PRINCIPAL:
El backend ya calculó y validó el estado. Vos NO inventás datos. Vos redactás una respuesta fluida siguiendo la INSTRUCCIÓN OBLIGATORIA.

INSTRUCCIÓN OBLIGATORIA:
${state.hardInstruction}

ESTADO DEL PEDIDO:
- Paso actual: ${state.step}
- Producto: ${o.product || "faltante"}
- Cantidad: ${o.quantity || "faltante"}
- Ciudad: ${o.city || "faltante"}
- Tiene cobertura contra-entrega: ${state.coverage === null ? "aún no se sabe" : state.coverage ? "sí" : "no"}
- Nombre: ${o.customer_name || "faltante"}
- Dirección: ${o.address || "faltante"}
- Teléfono: ${o.phone || "faltante"}
- Total calculado: ${state.total ? `${formatGs(state.total)} Gs` : "aún no corresponde"}
- Faltante: ${state.missing.length ? state.missing.join(", ") : "nada"}
- Dirección opcional según entrenamiento: ${state.addressOptional ? "sí" : "no"}
- Promo bloqueada desde plantilla: ${o.locked_offer ? `${o.locked_offer.quantity} unidades por ${formatGs(o.locked_offer.total)} Gs` : "no"}
- Observación del cliente: ${observationLines(o).length ? observationLines(o).join(" | ") : "sin observación"}

FUENTE DE PRODUCTO / CANTIDAD / PRECIO:
${catalogForPrompt(parsed, state, templatePricing)}

PRECIO/PROMO DEL PRODUCTO ACTUAL:
${productPriceText(state.productInfo, o.locked_offer, templatePricing) || "Sin producto actual."}

${
  state.productInfo?.salesCopy
    ? copyAlreadySent
      ? `COPY DE VENTA DE ESTE PRODUCTO (SOLO DE REFERENCIA — YA SE LO ENVIASTE COMPLETO en un mensaje anterior. NO LO REPITAS de nuevo. Respondé breve y avanzá directo hacia el siguiente dato faltante del ESTADO DEL PEDIDO, usando como mucho el nombre del producto y el precio si hace falta mencionarlo):
"""
${state.productInfo.salesCopy}
"""
`
      : `COPY DE VENTA ORIGINAL DE ESTE PRODUCTO (OBLIGATORIO: enviarlo COMPLETO, sin resumir, sin cortar y sin quitar párrafos, porque es la PRIMERA vez que se presenta este producto. El PRECIO final que menciones debe ser EXACTAMENTE el de "PRECIO/PROMO DEL PRODUCTO ACTUAL" de arriba, nunca inventes ni cambies un número):
"""
${state.productInfo.salesCopy}
"""
`
    : ""
}
DATOS DE TRANSFERENCIA:
${bankDataText(parsed)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENTRENAMIENTOS GENERALES ACTIVOS DEL USUARIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${parsed.generalTraining || "No hay reglas generales configuradas para este usuario."}

CÓMO USAR LOS ENTRENAMIENTOS DEL USUARIO:
- Leé y aplicá TODOS los bloques anteriores; el usuario puede tener uno, tres, diez o más entrenamientos activos.
- No ignores un entrenamiento por aparecer después de otro.
- Si varios entrenamientos generales se complementan, aplicalos juntos.
- Si dos reglas comerciales se contradicen, priorizá la regla más específica para la situación actual; si siguen siendo incompatibles, priorizá el entrenamiento cargado más recientemente, porque los registros fueron obtenidos en orden descendente por fecha.
- Los entrenamientos generales deciden tono, conversación, cierres de venta, objeciones, factura, entrega, postventa y forma de pedir datos.
- El backend decide únicamente los datos técnicos: producto detectado, cantidad registrada, ciudad, cobertura, total, datos faltantes y si el pedido puede confirmarse.
- Nunca reemplaces un dato técnico válido por una suposición del entrenamiento.
- No uses la lista completa de cobertura para redactar: usá el valor de cobertura ya calculado en ESTADO DEL PEDIDO.
- Usá solamente los datos bancarios estructurados mostrados en DATOS DE TRANSFERENCIA.

ORDEN DE PRIORIDAD:
1. Datos técnicos ya calculados en ESTADO DEL PEDIDO.
2. INSTRUCCIÓN OBLIGATORIA sobre el siguiente objetivo técnico.
3. TODOS los ENTRENAMIENTOS GENERALES ACTIVOS DEL USUARIO para decidir cómo conversar y vender.
4. Copy, precios y promociones reales del catálogo o plantilla activa.

REGLAS DURAS:
- Respondé en español paraguayo/neutro, estilo WhatsApp.
- Sé vendedor amable, cálido y fluido. Usá emojis comerciales moderados: 😊🔥🚚✅📦💰📍📲.
- Si el COPY DE VENTA ya se envió antes (ver arriba), NO lo repitas: avanzá directo al siguiente paso del pedido con una respuesta breve y natural.
- Si es la primera vez que se presenta el producto (copy NO enviado todavía) y hay COPY DE VENTA ORIGINAL, NO lo resumas, NO lo acortes y NO le quites partes: enviá el copy completo aunque sea largo.
- No digas que sos IA.
- No menciones backend, sistema ni estado interno.
- No inventes productos, precios, bancos, cuentas, enlaces, ciudades ni tiempos.
- PROHIBIDO inventar ciudad. Si Ciudad = faltante, preguntá ciudad.
- Una consulta del cliente (por ejemplo: "¿de dónde son?", "¿cómo funciona?", "¿tiene garantía?", "será, anda", "¿funciona de verdad?") NO es una ciudad ni un dato del pedido.
- "CDE", "Ciudad del Este", "Cdad del Este" y frases como "en Ciudad del Este" deben normalizarse a Ciudad del Este.
- Una frase de ubicación jamás puede convertirse en nombre del cliente.
- Si el cliente pide pagar al recibir y la ciudad no tiene cobertura, explicá amablemente que el pago es anticipado; no arrojes error ni cambies la ciudad.
- Expresiones paraguayas o informales como "será anda", "será que funciona", "anda de verdad" o "da resultado" son consultas sobre el producto: respondé la consulta y retomá el dato faltante.
- Para responder si funciona, usá EXCLUSIVAMENTE el nombre y el COPY DE VENTA del producto activo.
- Mencioná de 1 a 3 beneficios concretos presentes en ese copy. No uses una respuesta genérica si hay información específica del producto.
- No inventes resultados, porcentajes, tiempos ni garantías que no estén escritos en el copy.
- Si el cliente hace una consulta durante la compra: respondé primero la consulta usando SOLO el entrenamiento disponible y después retomá exactamente el siguiente dato faltante del ESTADO DEL PEDIDO.
- Si pregunta cuándo llega, cuándo se entrega, cuánto tarda, qué día se entrega o en qué horario: respondé EXCLUSIVAMENTE con la regla de entrega/tiempo/horario que figure en ENTRENAMIENTO GENERAL. No uses frases genéricas ni un mensaje estándar sobre rutas, disponibilidad o que el delivery llama, salvo que eso esté escrito expresamente en el entrenamiento.
- Una pregunta sobre entrega es solo una consulta: NO la guardes como fecha preferida, NO cambies ciudad, cantidad, nombre ni dirección y NO reinicies el pedido.
- Después de responder la consulta de entrega, pedí solamente el siguiente dato realmente faltante. Si no falta ningún dato, respondé la consulta sin volver a repetir el cierre del pedido.
- Si después de responder la consulta todavía falta ciudad, preguntá ciudad. No menciones transportadora, falta de cobertura ni pago anticipado hasta tener una ciudad real.
- Si Ciudad ya tiene valor en ESTADO DEL PEDIDO, PROHIBIDO volver a preguntar ciudad.
- PROHIBIDO usar ciudad vieja si no aparece en ESTADO DEL PEDIDO.
- Si falta producto, ofrecé catálogo/productos.
- Si falta ciudad, preguntá ciudad (variá la frase, no uses siempre la misma).
- Si falta cantidad, preguntá cantidad.
- Si la plantilla dice Producto + Cantidad + Precio, pack fijo, combo fijo, no se vende por unidad o únicamente por pack: NO preguntes cantidad, respetá cantidad y precio de la plantilla.
- Si hay promo variable de 2 unidades y el cliente no especificó cantidad, NO asumas 1 unidad ni 2 unidades: preguntá si quiere 1 unidad o la promo.
- Si el cliente pide fecha, horario, pagar cuando cobre, llamar antes o coordinar entrega, guardalo como observación y continuá cerrando la venta. No cortes la venta por eso.
- Si hay observación, mencionála de forma natural como “lo dejamos anotado en observación”.
- Si faltan datos, pedí SOLO lo faltante.
- Si no hay cobertura y todavía falta cantidad, NO muestres datos bancarios.
- Si no hay cobertura y ya hay cantidad, podés mostrar datos de transferencia.
- Si hay cobertura, indicar envío gratis contra-entrega cuando corresponda.
- Si el cliente pregunta precio, respondé precio y guiá al siguiente paso.
- Si el cliente pide explícitamente los datos bancarios/de transferencia (aunque haya cobertura), dáselos directamente, no repitas "podés pagar efectivo o transferencia al delivery" sin dar el dato pedido.
- PRIORIDAD DE PRECIOS:
  1) Si hay plantilla activa, usá SOLO producto, cantidad y precio de la plantilla.
  2) Mientras haya plantilla activa, PROHIBIDO usar CATALOGO_PRODUCTOS del entrenamiento para precio/cantidad/producto.
  3) No ofrezcas 1 unidad si la plantilla solo muestra pack de 2.
  4) No ofrezcas packs/promos del entrenamiento si no aparecen en la plantilla.
  5) No recalcules total multiplicando precio de plantilla por cantidad.
  6) Solo usá el catálogo del entrenamiento cuando NO exista plantilla activa.
- Nunca uses números de dirección, teléfono o calle como precio.
- Nunca inventes otro producto. Si llegó plantilla nueva, es venta nueva.
- Después de pedido confirmado, responder postventa si pregunta factura/entrega/pago/garantía.
- Si hay promo bloqueada desde plantilla, respetala y confirmala.
- Si no hay plantilla activa ni promo bloqueada, mostrar precios del catálogo.
- Nunca recalcules diferente al total calculado.
- PROHIBIDO preguntar "¿Está todo correcto?", "¿Confirmamos?", "¿Querés confirmar?" o cualquier reconfirmación.
- Cuando estén producto, cantidad, ciudad, nombre y teléfono, el backend confirma si la dirección es opcional según el entrenamiento.
- Si Dirección opcional = sí, NO bloquees el cierre ni la presentes como faltante. Informá que puede enviarse más tarde o pasarse directamente al delivery.
- Si Dirección opcional = no, la dirección/ubicación sí debe completarse antes de confirmar.
- El backend guarda la venta y responde directamente con el formato fijo ✅ PEDIDO CONFIRMADO.
- PROHIBIDO redactar un cierre libre. El único cierre válido es el generado por finalConfirmationMessage().
- Fuera del cierre confirmado y del flujo técnico de comprobantes, PROHIBIDO responder con textos genéricos fijos: redactá siempre desde los entrenamientos activos y los datos reales del pedido.
- El teléfono se obtiene automáticamente del número de WhatsApp. Si el estado ya contiene teléfono, nunca lo pidas de nuevo. Solo solicitá uno nuevo si el cliente quiere cambiarlo.
- En preguntas sobre demora o fecha, usá el plazo exacto del entrenamiento. Si no existe, indicá que no está especificado y que se coordina, sin inventar “próxima ronda” ni una hora.
- Cuando falte algún dato, mostrale un resumen fijo de lo que ya tenés y pedí solamente lo faltante.
- PROHIBIDO pedir confirmación intermedia. Si ya están todos los datos, confirmá automáticamente.
- Frases como "quiero en calce 42", "talle 40" o "número 39" son VARIANTES, nunca direcciones.
- Guardá el talle/calce en observación. Pedí dirección solamente cuando Dirección opcional = no.
- Nunca uses una frase publicitaria como "Usalas con" como nombre de producto.

- En ciudad sin contra-entrega, el comprobante verificado NO alcanza por sí solo para confirmar: también debe existir un nombre completo escrito explícitamente por el cliente. El pagador del comprobante se guarda como dato técnico, pero nunca reemplaza automáticamente el nombre del cliente. Si falta el nombre, validá el comprobante y pedí solamente el nombre completo. Una ciudad o un producto nunca pueden ser nombre del cliente.
- Si el cliente propone una transportadora específica, registrá la preferencia como observación. No prometas que se enviará por esa empresa ni digas que ya fue coordinado, salvo que ENTRENAMIENTO GENERAL indique expresamente que está disponible o autorizada.
- REGLA ABSOLUTA PARA TRANSPORTADORA/ENCOMIENDA: la ciudad es suficiente como destino. Nunca pidas dirección exacta, calle, barrio, ubicación ni referencia. Si el cliente menciona una agencia (por ejemplo NASA), guardala solo como observación o preferencia de transportadora, pero no bloquees el cierre.
- Cuando ya existen producto, cantidad, ciudad sin contra-entrega, nombre y comprobante verificado, no redactes una confirmación libre: el backend debe emitir inmediatamente el formato fijo de PEDIDO CONFIRMADO.
`.trim();
}

function buildFullProductCopyResponse(state: ConversationState, _templatePricing?: TemplatePricing | null) {
  const copy = clean(state.productInfo?.salesCopy || "");
  if (!copy) return "";

  // V72: el copy comercial se entrega limpio. La pregunta de ciudad se envía
  // como un segundo mensaje desde webhook para que la conversación sea más natural.
  return copy;
}

function buildFriendlyCityQuestion() {
  return "😊 Para confirmar la cobertura y la modalidad de entrega, ¿me indicás por favor de qué ciudad sos? 📍";
}

// ✅ FIX V46: para consultas de precio posteriores al copy, responde solo precios
// y avanza al siguiente dato pendiente, sin repetir el anuncio completo.
function buildPriceOnlyResponse(
  state: ConversationState,
  templatePricing?: TemplatePricing | null
) {
  const productInfo = state.productInfo;
  if (!productInfo) return "";

  const priceText = productPriceText(
    productInfo,
    state.order.locked_offer,
    templatePricing
  );

  if (!priceText) return "";

  let continuation = "";

  if (!state.order.city) {
    continuation = "📍 ¿Para qué ciudad sería el envío? 😊";
  } else if (!state.order.quantity && !state.order.locked_offer?.fixed_quantity) {
    continuation = "¿Cuántas unidades querés llevar? 😊";
  } else if (!state.order.customer_name) {
    continuation = "Para continuar, pasame tu nombre y apellido. 😊";
  } else if (state.coverage !== false && !state.addressOptional && !state.order.address) {
    continuation = "Ahora pasame la dirección exacta o ubicación para la entrega. 😊";
  } else if (!state.order.phone) {
    continuation = "Por último, pasame un número de celular para coordinar la entrega. 😊";
  }

  return `🔥 Precio de hoy:
${priceText}${continuation ? `

${continuation}` : ""}`;
}

function buildFallbackResponse(parsed: ParsedTraining, state: ConversationState, templatePricing?: TemplatePricing | null) {
  const o = state.order;

  if (!o.product) {
    return `😊 Dale, te ayudo.

Tenemos estas opciones disponibles:

${productsSummary(parsed)}

¿Cuál te interesa?`;
  }

  if (!o.city) {
    const copy = state.productInfo?.salesCopy;
    const priceLine = productPriceText(state.productInfo, o.locked_offer, templatePricing);
    return copy
      ? `${copy.trim()}\n\n📍 ¿Para qué ciudad sería el envío? 😊`
      : `¡Excelente elección! 🔥

${state.productInfo?.canonical || o.product}
${priceLine}

📍 ¿Para qué ciudad sería el envío? 😊`;
  }

  const missingSummary = buildDeterministicMissingDataSummary(state);
  if (missingSummary && o.product && o.city && o.quantity) {
    return missingSummary;
  }

  if (!o.quantity) {
    const templateActive = hasActiveTemplatePricing(templatePricing, o);

    const qtyQuestion = templateActive
      ? `¿Cuál de estas opciones de la plantilla querés confirmar?\n${templatePricingSummary(templatePricing)} 😊`
      : o.locked_offer && o.locked_offer.quantity > 1
        ? `¿Querés 1 unidad por ${formatGs(getTemplatePrice1(templatePricing || null, o.product) || state.productInfo?.price1 || 0)} Gs o la promo de ${o.locked_offer.quantity} unidades por ${formatGs(o.locked_offer.total)} Gs? 😊`
        : "¿Cuántas unidades querés llevar? 😊";

    if (state.coverage === false) {
      return `ℹ️ ${o.city} no entra en nuestra zona de contra-entrega, pero sí podemos enviarte por transportadora 🚚

Antes de pasarte el total y los datos de pago, decime: ${qtyQuestion}`;
    }

    return `✅ Perfecto, ${o.city} tiene envío gratis contra-entrega 🚚

${qtyQuestion}`;
  }

  if (state.missing.length) {
    const promoLine =
      o.locked_offer && o.locked_offer.quantity === o.quantity
        ? `🔥 Promo aplicada: ${o.quantity} unidades por ${formatGs(state.total)} Gs\n`
        : "";

    return `🎉 ¡Perfecto! Queda avanzado tu pedido 😊

📦 Producto: ${o.product}
${promoLine}🔢 Cantidad: ${o.quantity}
💰 Total: ${formatGs(state.total)} Gs
📍 Ciudad: ${o.city}${observationBlock(o)}

Para agendarlo, me falta:
✅ ${state.missing.join("\n✅ ")} 📲`;
  }

  return `✅ PEDIDO CONFIRMADO

📦 Producto: ${o.product}
🔢 Cantidad: ${o.quantity}
💰 Total: ${formatGs(state.total)} Gs
👤 Cliente: ${o.customer_name}
📍 Ciudad: ${o.city}
📞 Teléfono: ${o.phone}${o.address ? `\n🏠 Dirección: ${o.address}` : ""}${observationBlock(o)}

¡Gracias por tu compra! 💜`;
}

function postProcessResponse(resp: string) {
  return clean(resp)
    .replace(/\n{4,}/g, "\n\n");
}

function extractIncomingText(body: any) {
  const candidates = [
    body?.message,
    body?.text,
    body?.body,
    body?.caption,
    body?.transcription,
    body?.transcript,
    body?.audio_transcription,
    body?.audioTranscript,
    body?.speech_to_text,
    body?.speechText,
    body?.voice_text,
    body?.voiceText,
    body?.whisper_text,
    body?.whisperText,
    body?.data?.message,
    body?.data?.text,
    body?.data?.body,
    body?.data?.caption,
    body?.data?.transcription,
    body?.data?.transcript,
    body?.message?.text,
    body?.message?.body,
    body?.message?.caption,
    body?.message?.transcription,
    body?.message?.transcript,
    body?.audio?.text,
    body?.audio?.transcription,
    body?.audio?.transcript,
    body?.voice?.text,
    body?.voice?.transcription,
    body?.voice?.transcript,
    body?.data?.audio?.text,
    body?.data?.audio?.transcription,
    body?.data?.audio?.transcript,
    body?.data?.voice?.text,
    body?.data?.voice?.transcription,
    body?.data?.voice?.transcript,
  ];

  for (const c of candidates) {
    const value = clean(c);
    if (value) return value;
  }

  return "";
}

function firstHttpUrl(...values: any[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = firstHttpUrl(...value);
      if (found) return found;
      continue;
    }

    const v = clean(value);
    if (/^https?:\/\//i.test(v)) return v;
  }

  return "";
}

function extractMediaInfo(body: any) {
  const mediaUrl = firstHttpUrl(
    body?.media_url,
    body?.mediaUrl,
    body?.media,
    body?.url,
    body?.file_url,
    body?.fileUrl,
    body?.download_url,
    body?.downloadUrl,
    body?.audio_url,
    body?.audioUrl,
    body?.voice_url,
    body?.voiceUrl,
    body?.ptt_url,
    body?.pttUrl,
    body?.data?.media_url,
    body?.data?.mediaUrl,
    body?.data?.url,
    body?.data?.file_url,
    body?.data?.download_url,
    body?.message?.media_url,
    body?.message?.mediaUrl,
    body?.message?.url,
    body?.message?.file_url,
    body?.message?.download_url,
    body?.audio?.url,
    body?.audio?.media_url,
    body?.audio?.mediaUrl,
    body?.audio?.file_url,
    body?.audio?.download_url,
    body?.voice?.url,
    body?.voice?.media_url,
    body?.voice?.mediaUrl,
    body?.voice?.file_url,
    body?.voice?.download_url,
    body?.data?.audio?.url,
    body?.data?.audio?.media_url,
    body?.data?.audio?.mediaUrl,
    body?.data?.voice?.url,
    body?.data?.voice?.media_url,
    body?.data?.voice?.mediaUrl
  );

  const mediaType = clean(
    body?.media_type ||
      body?.mediaType ||
      body?.message_type ||
      body?.messageType ||
      body?.type ||
      body?.data?.media_type ||
      body?.data?.message_type ||
      body?.data?.type ||
      body?.message?.media_type ||
      body?.message?.type ||
      body?.audio?.type ||
      body?.voice?.type ||
      (body?.audio ? "audio" : "") ||
      (body?.voice ? "voice" : "")
  );

  const mimeType = clean(
    body?.mime_type ||
      body?.mimeType ||
      body?.mimetype ||
      body?.media_mime_type ||
      body?.data?.mime_type ||
      body?.data?.mimeType ||
      body?.message?.mime_type ||
      body?.message?.mimeType ||
      body?.audio?.mime_type ||
      body?.audio?.mimeType ||
      body?.voice?.mime_type ||
      body?.voice?.mimeType ||
      ""
  );

  return { media_url: mediaUrl, media_type: mediaType, mime_type: mimeType };
}

function isAudioLikeMedia({
  media_url,
  media_type,
  mime_type,
}: {
  media_url?: string;
  media_type?: string;
  mime_type?: string;
}) {
  const mt = normalize(media_type || "");
  const mime = clean(mime_type || "").toLowerCase();

  return Boolean(
    clean(media_url) &&
      (
        mt === "audio" ||
        mt === "voice" ||
        mt === "ptt" ||
        mt === "nota de voz" ||
        mt.includes("audio") ||
        mt.includes("voice") ||
        mt.includes("ptt") ||
        mime.startsWith("audio/")
      )
  );
}

export default async function handler(req: any, res: any) {
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
    } = req.body;

    const mediaInfo = extractMediaInfo(req.body);
    const media_url = mediaInfo.media_url;
    const media_type = mediaInfo.media_type;
    const mime_type = mediaInfo.mime_type;

    let texto = extractIncomingText(req.body);
    const fromNumber = clean(from_number);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto && !media_url) return res.status(400).json({ error: "Faltan message o media" });

    const { data: iaConfig } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .maybeSingle();

    if (!iaConfig?.api_key) {
      return res.json({ response: "⚠️ La IA no está configurada o desactivada." });
    }

    const apiKey = iaConfig.api_key;
    const model = iaConfig.model || "gemini-2.5-flash";

    const audioLike = isAudioLikeMedia({ media_url, media_type, mime_type });

    if (audioLike && !texto) {
      const fetched = await fetchMediaAsBase64(clean(media_url));
      let transcriptionReason = "no_media";

      if (fetched) {
        const transcribed = await transcribeAudioSmart({
          apiKey,
          model,
          audioBase64: fetched.data,
          mime: clean(mime_type) || fetched.mime || "audio/ogg",
        });

        texto = clean(transcribed.text);
        transcriptionReason = transcribed.reason;
      }

      if (!texto) {
        const noQuota = transcriptionReason === "gemini_quota";
        return res.json({
          response: noQuota
            ? "🎧 Recibí tu audio, pero el transcriptor está sin cuota en este momento. Escribime por texto, por favor, así sigo con tu pedido 😊"
            : "🎧 Recibí tu audio, pero no pude leerlo automáticamente. ¿Podés escribirme por texto, por favor? 😊",
          context: {
            ...(context || {}),
            audio_pending_text: true,
            audio_transcription_reason: transcriptionReason,
            updated_at: new Date().toISOString(),
          },
        });
      }

      console.log(`🎧 Audio transcripto (${transcriptionReason}): ${texto.slice(0, 160)}`);
    }

    const allTraining = await getAllTrainingData(user_id);

    // Lee TODOS los registros activos del usuario, sin asumir que existen solo 3.
    // Cada registro queda clasificado como reglas generales, cobertura o banco.
    const trainingSections = buildTrainingSections(allTraining);
    const parsed = parseTraining(trainingSections.combined);

    parsed.generalTraining = trainingSections.general;
    parsed.coverageTraining = trainingSections.coverage;
    parsed.bankingTraining = trainingSections.banking;
    parsed.trainingStats = {
      totalItems: trainingSections.totalItems,
      generalItems: trainingSections.generalItems,
      coverageItems: trainingSections.coverageItems,
      bankingItems: trainingSections.bankingItems,
    };

    console.log("🧠 Entrenamientos activos del usuario:", {
      user_id,
      total: parsed.trainingStats.totalItems,
      generales: parsed.trainingStats.generalItems,
      cobertura: parsed.trainingStats.coverageItems,
      bancarios: parsed.trainingStats.bankingItems,
      ciudadesDetectadas: parsed.cities.length,
      bancoDetectado: Boolean(parsed.bankData),
    });

    const visualProducts = productsFromVisualCatalog(allTraining);
    parsed.products = mergeProductsByPriority(visualProducts, parsed.products);

    attachProductImages(parsed.products, allTraining);
    sanitizeProductPrices(parsed);

    // V131: única fábrica de respuestas comerciales normales.
    // El backend entrega hechos y estado; Gemini redacta usando exclusivamente
    // los entrenamientos activos, catálogo y datos técnicos del usuario actual.
    const commercialResponse = async ({
      event,
      order,
      extraFacts,
      copyAlreadySent = false,
    }: {
      event: string;
      order?: OrderData;
      extraFacts?: Record<string, any>;
      copyAlreadySent?: boolean;
    }) => {
      const technicalOrder = sanitizeOldOrder(order || context?.order_data || {}, parsed);
      if (!technicalOrder.phone) technicalOrder.phone = senderPhoneFallback(fromNumber);
      const technicalState = buildState(technicalOrder, parsed);
      technicalState.hardInstruction = event;

      const systemPrompt = buildSalesSystemPrompt(parsed, technicalState, null, copyAlreadySent);
      const aiContents = (history || [])
        .slice(-12)
        .filter((h: any) => clean(h?.content))
        .map((h: any) => ({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: clean(h.content) }],
        }));

      aiContents.push({
        role: "user",
        parts: [{
          text: `Mensaje del cliente:\n${texto || "(mensaje sin texto)"}\n\nEVENTO TÉCNICO ACTUAL:\n${event}\n\nHECHOS ADICIONALES VALIDADOS POR EL BACKEND:\n${JSON.stringify(extraFacts || {}, null, 2)}\n\nRedactá únicamente el mensaje visible para el cliente. No muestres estados, JSON, backend, sistema ni entrenamiento. No generes un cierre definitivo ni un resultado técnico de comprobante.`,
        }],
      });

      const generated = await callGemini({
        apiKey,
        model,
        system: systemPrompt,
        contents: aiContents,
        temperature: iaConfig.temperature ?? 0.55,
        maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
      });

      if (!generated || generated === "__GEMINI_QUOTA_EXCEEDED__") return "";
      return postProcessResponse(generated);
    };

    const requireCommercialResponse = async (args: Parameters<typeof commercialResponse>[0]) => {
      const generated = await commercialResponse(args);
      if (!generated) {
        res.status(503);
        return "";
      }
      return generated;
    };

    // V116: catálogo es intención informativa. No se responde con texto fijo:
    // se conserva el pedido y Gemini redacta usando productos, URL y entrenamiento.
    const catalogRequestedNow =
      isCatalogRequest(texto) ||
      Boolean(context?.pending_catalog_confirmation && isAffirmative(texto));

    const productsMentionedNow = detectProductsMentioned(texto, parsed);
    let activeMultiCart = getMultiCartFromContext(context, parsed);

    // V131: cambio o agregado de producto en mensajes sucesivos.
    // El backend modifica solamente el estado; Gemini redacta la conversación.
    const productActionNorm = normalize(texto);
    const explicitAddProductIntent = /\b(tambien|también|ademas|además|agrega|agregame|agregáme|suma|sumame|sumáme|junto con|los dos|ambos|aparte)\b/.test(productActionNorm);
    const explicitReplaceProductIntent = /\b(mejor|en vez de|cambia|cambiame|cambiáme|reemplaza|reemplazame|saca|sacame|quitame|quita|ya no quiero|prefiero)\b/.test(productActionNorm);
    const pendingProductDecision = clean(context?.pending_product_decision || "");
    const currentSequentialOrder = sanitizeOldOrder(context?.order_data || {}, parsed);

    if (pendingProductDecision && currentSequentialOrder.product) {
      const pendingInfo = getProductInfo(pendingProductDecision, parsed);
      const chooseAdd = explicitAddProductIntent || /^(los dos|ambos|agrega|agregalo|agregálo|tambien|también|si agrega|sí agrega)$/.test(productActionNorm);
      const chooseReplace = explicitReplaceProductIntent || /^(cambia|cambialo|cambiálo|reemplaza|reemplazalo|reemplazálo|solo el nuevo|el nuevo)$/.test(productActionNorm);

      if (pendingInfo && chooseAdd) {
        const currentInfo = getProductInfo(currentSequentialOrder.product, parsed);
        const cart = createMultiCart([currentInfo, pendingInfo].filter(Boolean) as ProductItem[]);
        const currentCartItem = cart.find((item) => normalize(item.product) === normalize(currentSequentialOrder.product));
        if (currentCartItem && currentSequentialOrder.quantity > 0) {
          currentCartItem.quantity = currentSequentialOrder.quantity;
          currentCartItem.total = calculateTotal(currentCartItem.product, currentCartItem.quantity, parsed, currentSequentialOrder.locked_offer || null);
        }
        return res.json({
          response: await requireCommercialResponse({
            event: "Confirmá que el nuevo producto se agregó al mismo pedido y solicitá únicamente las cantidades que todavía faltan.",
            order: currentSequentialOrder,
            extraFacts: { action: "ADD_PRODUCT", added_product: pendingInfo.canonical, multi_product_cart: cart, missing_quantities: multiCartMissingQuantities(cart) },
          }),
          context: { ...(context || {}), pending_product_decision: null, current_product: null, order_data: currentSequentialOrder, multi_product_cart: cart, multi_order_id: clean(context?.multi_order_id) || makeOrderId(fromNumber), step: "collecting_multiple_product_quantities", updated_at: new Date().toISOString() },
          debug: { sequential_product_action: "add" },
        });
      }

      if (pendingInfo && chooseReplace) {
        const replacedOrder = { ...currentSequentialOrder, product: pendingInfo.canonical, quantity: pendingInfo.fixedPackQuantity || 0, locked_offer: null };
        return res.json({
          response: await requireCommercialResponse({
            event: "Confirmá el cambio al nuevo producto. No menciones como activo el producto anterior y continuá solicitando únicamente el siguiente dato faltante.",
            order: replacedOrder,
            extraFacts: { action: "REPLACE_PRODUCT", previous_product: currentSequentialOrder.product, current_product: pendingInfo.canonical },
          }),
          context: { ...(context || {}), pending_product_decision: null, current_product: pendingInfo.canonical, order_data: replacedOrder, multi_product_cart: [], step: buildState(replacedOrder, parsed).step, updated_at: new Date().toISOString() },
          debug: { sequential_product_action: "replace" },
        });
      }
    }

    if (activeMultiCart.length >= 1 && productsMentionedNow.length >= 1) {
      const existingKeys = new Set(activeMultiCart.map((item) => normalize(item.product)));
      const additions = productsMentionedNow.filter((product) => !existingKeys.has(normalize(product.canonical)));
      if (additions.length > 0) {
        activeMultiCart = [...activeMultiCart, ...createMultiCart(additions)];
        const commonOrder = sanitizeOldOrder(context?.order_data || {}, parsed);
        return res.json({
          response: await requireCommercialResponse({
            event: "Confirmá que los productos nuevos se agregaron al pedido y solicitá únicamente sus cantidades faltantes.",
            order: commonOrder,
            extraFacts: { action: "ADD_TO_EXISTING_CART", added_products: additions.map((p) => p.canonical), multi_product_cart: activeMultiCart },
          }),
          context: { ...(context || {}), pending_product_decision: null, current_product: null, order_data: commonOrder, multi_product_cart: activeMultiCart, multi_order_id: clean(context?.multi_order_id) || makeOrderId(fromNumber), step: "collecting_multiple_product_quantities", updated_at: new Date().toISOString() },
          debug: { sequential_product_action: "add_to_cart", added: additions.map((p) => p.canonical) },
        });
      }
    }

    if (activeMultiCart.length === 0 && currentSequentialOrder.product && productsMentionedNow.length === 1) {
      const mentioned = productsMentionedNow[0];
      const differentProduct = normalize(mentioned.canonical) !== normalize(currentSequentialOrder.product);
      if (differentProduct) {
        if (explicitAddProductIntent) {
          const currentInfo = getProductInfo(currentSequentialOrder.product, parsed);
          const cart = createMultiCart([currentInfo, mentioned].filter(Boolean) as ProductItem[]);
          const currentCartItem = cart.find((item) => normalize(item.product) === normalize(currentSequentialOrder.product));
          if (currentCartItem && currentSequentialOrder.quantity > 0) {
            currentCartItem.quantity = currentSequentialOrder.quantity;
            currentCartItem.total = calculateTotal(currentCartItem.product, currentCartItem.quantity, parsed, currentSequentialOrder.locked_offer || null);
          }
          return res.json({
            response: await requireCommercialResponse({
              event: "Confirmá que el nuevo producto se agregó al mismo pedido y solicitá únicamente la cantidad que falta del producto agregado.",
              order: currentSequentialOrder,
              extraFacts: { action: "ADD_PRODUCT", added_product: mentioned.canonical, multi_product_cart: cart },
            }),
            context: { ...(context || {}), current_product: null, order_data: currentSequentialOrder, multi_product_cart: cart, multi_order_id: makeOrderId(fromNumber), step: "collecting_multiple_product_quantities", updated_at: new Date().toISOString() },
            debug: { sequential_product_action: "add" },
          });
        }

        if (explicitReplaceProductIntent) {
          const replacedOrder = { ...currentSequentialOrder, product: mentioned.canonical, quantity: mentioned.fixedPackQuantity || 0, locked_offer: null };
          return res.json({
            response: await requireCommercialResponse({
              event: "Confirmá el reemplazo del producto anterior por el nuevo y continuá con el siguiente dato faltante.",
              order: replacedOrder,
              extraFacts: { action: "REPLACE_PRODUCT", previous_product: currentSequentialOrder.product, current_product: mentioned.canonical },
            }),
            context: { ...(context || {}), current_product: mentioned.canonical, order_data: replacedOrder, multi_product_cart: [], step: buildState(replacedOrder, parsed).step, updated_at: new Date().toISOString() },
            debug: { sequential_product_action: "replace" },
          });
        }

        return res.json({
          response: await requireCommercialResponse({
            event: "Preguntá si el nuevo producto debe agregarse al mismo pedido o reemplazar al producto actual. No modifiques todavía el pedido.",
            order: currentSequentialOrder,
            extraFacts: { action: "ASK_ADD_OR_REPLACE", current_product: currentSequentialOrder.product, mentioned_product: mentioned.canonical },
          }),
          context: { ...(context || {}), pending_product_decision: mentioned.canonical, order_data: currentSequentialOrder, step: context?.step || buildState(currentSequentialOrder, parsed).step, updated_at: new Date().toISOString() },
          debug: { sequential_product_action: "clarify", current_product: currentSequentialOrder.product, mentioned_product: mentioned.canonical },
        });
      }
    }

    // V57: iniciar carrito multiproducto con respuesta breve.
    // Si el cliente ya indicó cantidades (ej. "1 peladora y 1 afilador"),
    // no repetimos información: calculamos el carrito y avanzamos.
    if (productsMentionedNow.length >= 2 && activeMultiCart.length === 0) {
      const existingOrder = sanitizeOldOrder(context?.order_data || {}, parsed);
      const multiOrderId = clean(context?.multi_order_id) || makeOrderId(fromNumber);
      activeMultiCart = applyQuantitiesToMultiCart(texto, createMultiCart(productsMentionedNow), parsed);
      const missingQty = multiCartMissingQuantities(activeMultiCart);
      const hasAnyNamedQuantity = activeMultiCart.some((item) => item.quantity > 0);

      if (missingQty.length === 0) {
        const nextStep = existingOrder.city ? "collecting_multiple_customer_data" : "collecting_multiple_city";
        return res.json({
          response: await requireCommercialResponse({
            event: existingOrder.city
              ? "Confirmá que las cantidades del carrito fueron registradas y solicitá únicamente el siguiente dato faltante."
              : "Confirmá que las cantidades del carrito fueron registradas y solicitá únicamente la ciudad de envío.",
            order: existingOrder,
            extraFacts: { multi_product_cart: activeMultiCart, next_step: nextStep },
          }),
          context: {
            ...(context || {}),
            order_data: existingOrder,
            current_product: null,
            pending_multiple_products: productsMentionedNow.map((p) => p.canonical),
            multi_product_cart: activeMultiCart,
            multi_order_id: multiOrderId,
            step: nextStep,
            updated_at: new Date().toISOString(),
          },
          debug: {
            deterministic_multiple_products: true,
            products: productsMentionedNow.map((p) => p.canonical),
            quantities_received_in_first_message: true,
            preserved_city: existingOrder.city || null,
          },
        });
      }

      if (hasAnyNamedQuantity) {
        return res.json({
          response: await requireCommercialResponse({
            event: "Solicitá únicamente las cantidades faltantes de los productos indicados, sin modificar las cantidades ya registradas.",
            order: existingOrder,
            extraFacts: { multi_product_cart: activeMultiCart, products_missing_quantity: missingQty },
          }),
          context: {
            ...(context || {}),
            order_data: existingOrder,
            current_product: null,
            pending_multiple_products: productsMentionedNow.map((p) => p.canonical),
            multi_product_cart: activeMultiCart,
            multi_order_id: multiOrderId,
            step: "collecting_multiple_product_quantities",
            updated_at: new Date().toISOString(),
          },
          debug: {
            deterministic_multiple_products: true,
            products: productsMentionedNow.map((p) => p.canonical),
            partial_quantities_received: true,
          },
        });
      }

      return res.json({
        response: await requireCommercialResponse({
          event: "Presentá brevemente los productos detectados usando solo sus copys y promociones reales, explicá que pueden agregarse al mismo pedido y solicitá la cantidad de cada uno.",
          order: existingOrder,
          extraFacts: { products: productsMentionedNow.map((p) => ({ product: p.canonical, sales_copy: p.salesCopy, offers: productOffersText(p) })), city: existingOrder.city || null },
        }),
        context: {
          ...(context || {}),
          order_data: existingOrder,
          current_product: null,
          pending_multiple_products: productsMentionedNow.map((p) => p.canonical),
          multi_product_cart: activeMultiCart,
          multi_order_id: multiOrderId,
          step: "collecting_multiple_product_quantities",
          updated_at: new Date().toISOString(),
        },
        debug: {
          deterministic_multiple_products: true,
          products: productsMentionedNow.map((p) => p.canonical),
          compact_promotions_presented: true,
          preserved_city: existingOrder.city || null,
        },
      });
    }

    if (activeMultiCart.length >= 2) {
      let commonOrder = sanitizeOldOrder(context?.order_data || {}, parsed);
      const multiOrderId = clean(context?.multi_order_id) || makeOrderId(fromNumber);
      activeMultiCart = applyQuantitiesToMultiCart(texto, activeMultiCart, parsed);
      const missingQty = multiCartMissingQuantities(activeMultiCart);

      if (context?.step === "collecting_multiple_product_quantities" || missingQty.length > 0) {
        if (missingQty.length > 0) {
          return res.json({
            response: await requireCommercialResponse({
              event: "Solicitá únicamente las cantidades que todavía faltan en el carrito multiproducto.",
              order: commonOrder,
              extraFacts: { multi_product_cart: activeMultiCart, products_missing_quantity: missingQty },
            }),
            context: {
              ...(context || {}),
              order_data: commonOrder,
              multi_product_cart: activeMultiCart,
              multi_order_id: multiOrderId,
              step: "collecting_multiple_product_quantities",
              updated_at: new Date().toISOString(),
            },
          });
        }

        const nextStep = commonOrder.city ? "collecting_multiple_customer_data" : "collecting_multiple_city";
        return res.json({
          response: await requireCommercialResponse({
            event: commonOrder.city
              ? "Confirmá el carrito multiproducto y solicitá únicamente el siguiente dato personal realmente faltante."
              : "Confirmá el carrito multiproducto y solicitá únicamente la ciudad de envío.",
            order: commonOrder,
            extraFacts: { multi_product_cart: activeMultiCart, next_step: nextStep },
          }),
          context: {
            ...(context || {}),
            order_data: commonOrder,
            multi_product_cart: activeMultiCart,
            multi_order_id: multiOrderId,
            step: nextStep,
            updated_at: new Date().toISOString(),
          },
        });
      }

      if (!commonOrder.city) {
        const detectedMultiCity = detectCity(texto, parsed, "");
        if (detectedMultiCity) commonOrder.city = detectedMultiCity;
        if (!commonOrder.city) {
          return res.json({
            response: await requireCommercialResponse({
              event: "Solicitá únicamente la ciudad de envío para continuar con el pedido multiproducto.",
              order: commonOrder,
              extraFacts: { multi_product_cart: activeMultiCart },
            }),
            context: { ...(context || {}), order_data: commonOrder, multi_product_cart: activeMultiCart, multi_order_id: multiOrderId, step: "collecting_multiple_city", updated_at: new Date().toISOString() },
          });
        }
      }

      const phone = extractPhone(texto);
      const name = extractName(texto, commonOrder.city, phone, parsed);
      const address = extractAddress(texto, commonOrder.city, phone, name);
      if (name && !commonOrder.customer_name) commonOrder.customer_name = name;
      if (phone) commonOrder.phone = phone;
      if (!commonOrder.phone) commonOrder.phone = senderPhoneFallback(fromNumber);
      if (address) commonOrder.address = mergeAddressSupplement(commonOrder.address, address);

      const multiObservationPatch = extractOrderObservation(texto);
      Object.assign(commonOrder, mergeOrderObservation(commonOrder, multiObservationPatch));

      const missingData: string[] = [];
      if (!commonOrder.customer_name) missingData.push("nombre y apellido");
      if (!commonOrder.address) missingData.push("dirección exacta o ubicación");

      if (missingData.length > 0) {
        const coverage = hasCoverage(commonOrder.city, parsed);
        return res.json({
          response: await requireCommercialResponse({
            event: "Respondé usando la cobertura validada y solicitá únicamente los datos faltantes del pedido multiproducto.",
            order: commonOrder,
            extraFacts: { multi_product_cart: activeMultiCart, coverage, missing_fields: missingData },
          }),
          context: { ...(context || {}), order_data: commonOrder, multi_product_cart: activeMultiCart, multi_order_id: multiOrderId, step: "collecting_multiple_customer_data", updated_at: new Date().toISOString() },
        });
      }

      await saveMultiProductOrders(user_id, fromNumber, activeMultiCart, commonOrder, parsed, multiOrderId);
      const coverage = hasCoverage(commonOrder.city, parsed);
      return res.json({
        response: `✅ PEDIDO CONFIRMADO\n\n${multiCartSummary(activeMultiCart)}\n\n👤 Cliente: ${commonOrder.customer_name}\n📍 Ciudad: ${commonOrder.city}\n🏠 Dirección: ${commonOrder.address}\n📞 Contacto: ${commonOrder.phone}${observationBlock(commonOrder)}\n\n${coverage ? "🚚 Envío contra entrega. Pagás al recibir." : "🚚 Envío por transportadora con pago anticipado."}\n\n¡Gracias por tu compra! 💜`,
        context: { ...(context || {}), order_data: commonOrder, multi_product_cart: activeMultiCart, multi_order_id: multiOrderId, step: "pedido_confirmado_multiple", updated_at: new Date().toISOString() },
        debug: { multi_product_order_confirmed: true, items: activeMultiCart.length, group_id: multiOrderId },
      });
    }

    const currentTemplatePricing = detectTemplatePricingSmart(texto, parsed);

    const newTemplateSignal = isNewTemplateOrProductIntent(texto, parsed, history);

    const recentExplicitProductInterest = getRecentExplicitProductInterestAfterConfirmed(history, parsed);
    const templateAfterExplicitProductInterest = recentExplicitProductInterest
      ? getTemplatePricingAfterHistoryIndex(history, parsed, recentExplicitProductInterest.index)
      : null;

    let templatePricing =
      currentTemplatePricing ||
      (templateAfterExplicitProductInterest
        ? forceTemplatePricingProduct(templateAfterExplicitProductInterest, recentExplicitProductInterest?.product || null)
        : getTemplatePricingFromHistory(history, parsed));

    let oldOrder = sanitizeOldOrder(context?.order_data || {}, parsed);
    if (!oldOrder.phone) oldOrder.phone = senderPhoneFallback(fromNumber);

    // V100: un chat nuevo o una sesión vencida jamás hereda producto,
    // cantidad, ciudad ni datos de un chat anterior.
    const resetBecauseNewChat =
      context?.step !== "pedido_confirmado" &&
      looksLikeNewChatSession(texto, context, history) &&
      Boolean(oldOrder.product || oldOrder.city || oldOrder.quantity || oldOrder.customer_name || oldOrder.address);

    if (resetBecauseNewChat) {
      oldOrder = emptyOrder(makeOrderId(fromNumber));
      oldOrder.phone = senderPhoneFallback(fromNumber);
    }

    let forceFreshOrderFromConfirmedTemplate = false;

    if (context?.step === "pedido_confirmado") {
      const msgNormClosed = normalize(texto);
      const hasCurrentTemplatePricing = !!currentTemplatePricing;
      const productInClosedMessage = detectProduct(texto, parsed, "");
      const lastRealSalesTemplatePricing =
        templateAfterExplicitProductInterest && recentExplicitProductInterest
          ? forceTemplatePricingProduct(templateAfterExplicitProductInterest, recentExplicitProductInterest.product)
          : getLastRealSalesTemplatePricing(history, parsed);
      const lastRealSalesTemplateProduct = recentExplicitProductInterest?.product || (lastRealSalesTemplatePricing?.product ? getProductInfo(lastRealSalesTemplatePricing.product, parsed) : getLastRealSalesTemplateProduct(history, parsed));

      const explicitNewPurchaseAfterConfirmed =
        hasCurrentTemplatePricing ||
        isNewPastedTemplatePurchase(texto, parsed) ||
        (!!productInClosedMessage && hasExplicitProductInterestPhrase(texto)) ||
        /\b(otro producto|nuevo pedido|hacer otro pedido|catalogo|catálogo|ver catalogo|ver catálogo|quiero comprar otra cosa)\b/.test(msgNormClosed) ||
        ((isStrongNewPurchaseReply(texto) || hasTemplateBuyIntent(texto)) && !!lastRealSalesTemplateProduct && !!lastRealSalesTemplatePricing);

      if (explicitNewPurchaseAfterConfirmed) {
        forceFreshOrderFromConfirmedTemplate = true;
        oldOrder = emptyOrder(makeOrderId(fromNumber));
      } else {
        // V52: después de confirmar, un dato adicional de ubicación (por ejemplo
        // "Barrio San Ramón") complementa la dirección. Nunca debe reemplazar
        // el nombre del cliente ni iniciar otro pedido.
        if (looksLikeAddressSupplement(texto)) {
          oldOrder.address = mergeAddressSupplement(oldOrder.address, texto);
          await safeUpsertOrder(user_id, fromNumber, oldOrder, parsed, true);

          // V118: se guarda el dato, pero NO se repite el cierre ni se usa un acuse fijo.
          // La respuesta visible continúa por Gemini más abajo.
        }

        if (false && isDeliveryTimingQuestion(texto)) {
          return res.json({
            response: buildDeliveryTimingQuestionResponse(texto, oldOrder),
            context: {
              ...(context || {}),
              order_data: oldOrder,
              order_id: oldOrder.order_id || null,
              step: "pedido_confirmado",
              updated_at: new Date().toISOString(),
            },
            debug: { post_confirmation_delivery_timing_question: true },
          });
        }

        const postConfirmationObservation = extractOrderObservation(texto);
        if (
          clean(postConfirmationObservation.observation) ||
          clean(postConfirmationObservation.preferred_delivery_date) ||
          clean(postConfirmationObservation.preferred_delivery_time) ||
          clean(postConfirmationObservation.payment_note)
        ) {
          Object.assign(
            oldOrder,
            mergeOrderObservation(oldOrder, postConfirmationObservation)
          );

          await safeUpsertOrder(user_id, fromNumber, oldOrder, parsed, true);

          // V118: la observación se persiste silenciosamente. Gemini redacta el acuse
          // natural y contextual; aquí no existe ninguna respuesta visible fija.
        }

        const postConfirmationNorm = normalize(texto);
        // Parche 7: Desactivado saludo fijo en postventa - Todo en manos de Gemini
        if (false && /^(hola+|holi|buenas|buen dia|buen día|buenas tardes|buenas noches|saludos)$/.test(postConfirmationNorm)) {
          return res.json({
            response: "¡Buenas! 😊 ¿En qué puedo ayudarte?",
            context: { ...(context || {}), step: "pedido_confirmado", updated_at: new Date().toISOString() },
            debug: { post_confirmation_greeting: true },
          });
        }

        // Parche 7: Desactivado respuesta fija para "quiero/dame/agregame" en postventa - Todo en manos de Gemini
        if (false && /\b(quiero|llevo|dame|agregame|agregáme|cambiar|modificar)\b/.test(postConfirmationNorm) && (extractQuantity(texto) > 0 || /\b2\s*x\s*1\b/.test(postConfirmationNorm))) {
          const reopenedOrder = emptyOrder(makeOrderId(fromNumber));
          reopenedOrder.product = oldOrder.product || "";
          reopenedOrder.quantity = extractQuantity(texto) || (/\b2\s*x\s*1\b/.test(postConfirmationNorm) ? 2 : 0);
          return res.json({
            response: `¡Perfecto! 😊 Tomo una nueva solicitud de ${reopenedOrder.quantity} unidades de ${reopenedOrder.product || "este producto"}.\n\n📍 ¿Para qué ciudad sería el envío?`,
            context: { ...(context || {}), order_data: reopenedOrder, order_id: reopenedOrder.order_id, step: "collecting_city", updated_at: new Date().toISOString() },
            debug: { reopened_after_confirmation: true, quantity: reopenedOrder.quantity },
          });
        }

        // Parche 7: Desactivado acuse corto fijo en postventa - Todo en manos de Gemini
        if (false && (isShortAcknowledgement(texto) || isConversationClosing(texto))) {
          return res.json({
            response: oldOrder.customer_name
              ? `¡Con mucho gusto, ${oldOrder.customer_name.split(/\s+/)[0]}! 😊 Tu pedido ya quedó confirmado y agendado. 🚚📦`
              : `¡Con mucho gusto! 😊 Tu pedido ya quedó confirmado y agendado. 🚚📦`,
            context: {
              ...(context || {}),
              step: "pedido_confirmado",
              updated_at: new Date().toISOString(),
            },
          });
        }

        if (isPostSaleQuestion(texto)) {
          const deterministicPostSale = deterministicPostSaleResponse(texto, oldOrder, parsed);

          // Parche 7: Desactivado deterministicPostSale fijo - Todo en manos de Gemini
          if (false && deterministicPostSale) {
            return res.json({
              response: deterministicPostSale,
              context: {
                ...(context || {}),
                step: "pedido_confirmado",
                updated_at: new Date().toISOString(),
              },
            });
          }

          const postSaleSystem = buildPostSaleSystemPrompt(parsed, oldOrder);

          const postSaleContents = (history || [])
            .slice(-8)
            .filter((h: any) => clean(h?.content))
            .map((h: any) => ({
              role: h.role === "assistant" ? "model" : "user",
              parts: [{ text: clean(h.content) }],
            }));

          postSaleContents.push({
            role: "user",
            parts: [{ text: texto }],
          });

          const postSaleResponse = await callGemini({
            apiKey,
            model,
            system: postSaleSystem,
            contents: postSaleContents,
            temperature: iaConfig.temperature ?? 0.45,
            maxTokens: Math.max(iaConfig.max_tokens ?? 0, 1024),
          });

          return res.json({
            response: postProcessResponse(postSaleResponse || ""),
            context: {
              ...(context || {}),
              step: "pedido_confirmado",
              updated_at: new Date().toISOString(),
            },
          });
        }

        // V115: ninguna consulta normal recibe una respuesta genérica fija.
        // Todo lo que no sea cierre confirmado ni comprobante se redacta con IA
        // usando los entrenamientos activos y el estado real del pedido.
        const dynamicPostSaleSystem = buildPostSaleSystemPrompt(parsed, oldOrder);
        const dynamicPostSaleContents = (history || [])
          .slice(-10)
          .filter((h: any) => clean(h?.content))
          .map((h: any) => ({
            role: h.role === "assistant" ? "model" : "user",
            parts: [{ text: clean(h.content) }],
          }));

        dynamicPostSaleContents.push({
          role: "user",
          parts: [{ text: texto }],
        });

        const dynamicPostSaleResponse = await callGemini({
          apiKey,
          model,
          system: dynamicPostSaleSystem,
          contents: dynamicPostSaleContents,
          temperature: iaConfig.temperature ?? 0.35,
          maxTokens: Math.max(iaConfig.max_tokens ?? 0, 1024),
        });

        return res.json({
          response: postProcessResponse(dynamicPostSaleResponse || ""),
          context: {
            ...(context || {}),
            order_data: oldOrder,
            order_id: oldOrder.order_id || null,
            step: "pedido_confirmado",
            updated_at: new Date().toISOString(),
          },
          debug: { dynamic_post_sale_from_training: true },
        });
      }
    }

    const productFromMessageInitial = detectProduct(texto, parsed, "") || newTemplateSignal.product || "";
    const lockedProductInitial = getLockedProductFromContext(context, oldOrder, history, parsed);
    const promoResponse = isRespondingToPromotion(texto, history);

    let freshOrder = resetBecauseNewChat || shouldStartFreshOrder({
      texto,
      context,
      oldOrder,
      productFromMessage: productFromMessageInitial,
      lockedProductByContext: lockedProductInitial,
      promoResponse,
      parsed,
    });

    if ((newTemplateSignal.isNew || forceFreshOrderFromConfirmedTemplate) && context?.step === "pedido_confirmado") {
      freshOrder = true;
    }

    if (isShortAcknowledgement(texto) && context?.step !== "pedido_confirmado") {
      freshOrder = false;
    }

    // Una cantidad aislada (por ejemplo, "1" o "2 unidades") durante una
    // compra activa NO debe iniciar un pedido nuevo. De lo contrario se pierde
    // la ciudad ya confirmada y el bot vuelve a solicitarla.
    if (
      extractQuantity(texto) > 0 &&
      clean(oldOrder.product) &&
      context?.step !== "pedido_confirmado"
    ) {
      freshOrder = false;
    }

    // Una confirmación de ciudad pendiente también pertenece al pedido activo.
    if (
      clean(context?.pending_city_confirmation || "") &&
      isAffirmative(texto) &&
      context?.step !== "pedido_confirmado"
    ) {
      freshOrder = false;
    }

    if (freshOrder) {
      oldOrder = emptyOrder(makeOrderId(fromNumber));
      oldOrder.phone = senderPhoneFallback(fromNumber);
      // Toda venta nueva debe volver a definir la cantidad.
      // La única excepción es un pack fijo real detectado más adelante.
      oldOrder.quantity = 0;
      oldOrder.locked_offer = null;
    }

    const currentTemplateLockedOfferRaw = templatePricing?.product
      ? (getFixedTemplateOffer(templatePricing, templatePricing.product) || templatePricing.offers[0] || null)
      : null;

    const currentTemplateLockedOfferProductInfo = templatePricing?.product
      ? getProductInfo(templatePricing.product, parsed)
      : null;

    const currentTemplateLockedOffer =
      currentTemplateLockedOfferRaw && currentTemplateLockedOfferProductInfo
        ? (isPlausibleOfferForProduct(currentTemplateLockedOfferRaw, currentTemplateLockedOfferProductInfo)
            ? currentTemplateLockedOfferRaw
            : null)
        : currentTemplateLockedOfferRaw;

    let lockedOfferByContext = freshOrder
      ? (currentTemplateLockedOffer || getOfferFromLastPromotion(history, parsed))
      : getLockedOfferFromContext(context, oldOrder, history, parsed);

    let productToUse =
      currentTemplatePricing?.product ||
      ((isGenericBuyReply(texto) || isStrongNewPurchaseReply(texto) || hasTemplateBuyIntent(texto)) ? recentExplicitProductInterest?.product?.canonical || "" : "") ||
      productFromMessageInitial ||
      newTemplateSignal.product ||
      (!freshOrder ? oldOrder.product || "" : "") ||
      templatePricing?.product ||
      "";

    if (!productToUse && (isGenericBuyReply(texto) || promoResponse || isBuyIntent(texto))) {
      productToUse = templatePricing?.product || getProductFromLastPromotion(history, parsed)?.canonical || lockedProductInitial?.canonical || "";
    }

    if (!productToUse && !freshOrder) {
      productToUse = oldOrder.product || "";
    }

    let product = detectProduct(texto, parsed, productToUse);

    // V100: una intención explícita de compra inicia una venta nueva aunque sea
    // el mismo producto de un chat anterior. La cantidad debe preguntarse otra vez,
    // salvo que la plantilla actual sea un pack fijo.
    const explicitNewSaleNow = Boolean(
      productFromMessageInitial &&
      hasExplicitProductInterestPhrase(texto)
    );

    if (explicitNewSaleNow && !currentTemplateLockedOffer?.fixed_quantity) {
      oldOrder.quantity = 0;
      oldOrder.locked_offer = null;
      lockedOfferByContext = null;
    }

    // V65: nunca permitir que títulos comerciales reemplacen el producto.
    // Se prioriza el producto canónico previamente válido o el detectado en el mensaje.
    const explicitCanonicalProduct = getProductInfo(detectProduct(texto, parsed, ""), parsed)?.canonical || "";
    const previousCanonicalProduct = getProductInfo(oldOrder.product || "", parsed)?.canonical || "";
    const candidateCanonicalProduct = getProductInfo(product || productToUse || "", parsed)?.canonical || "";
    product = explicitCanonicalProduct || previousCanonicalProduct || candidateCanonicalProduct || "";
    if (isGenericProductLabel(product) || /promoci[oó]n especial/i.test(product)) {
      product = previousCanonicalProduct || explicitCanonicalProduct || "";
    }

    if (
      (recentExplicitProductInterest?.product?.canonical || templatePricing?.product) &&
      (isGenericBuyReply(texto) || isStrongNewPurchaseReply(texto) || hasTemplateBuyIntent(texto)) &&
      !detectProduct(texto, parsed, "")
    ) {
      product = recentExplicitProductInterest?.product?.canonical || templatePricing?.product || product;
      if (templatePricing && recentExplicitProductInterest?.product?.canonical && normalize(templatePricing.product) !== normalize(recentExplicitProductInterest.product.canonical)) {
        templatePricing = forceTemplatePricingProduct(templatePricing, recentExplicitProductInterest.product);
      }
    }

    const productInfo = getProductInfo(product, parsed);

    if (product && !oldOrder.order_id) {
      oldOrder.order_id = makeOrderId(fromNumber);
    }

    let explicitQty = extractQuantity(texto);

    if (explicitQty === 0 && productInfo) {
      const qtyFromPrice = extractQuantityFromPriceMention(texto, productInfo, templatePricing);
      if (qtyFromPrice > 0) explicitQty = qtyFromPrice;
    }

    if (
      explicitQty === 0 &&
      isAffirmative(texto) &&
      !isShortAcknowledgement(texto) &&
      context?.step === "collecting_quantity" &&
      productInfo &&
      !oldOrder.locked_offer &&
      !productInfo.price2 &&
      !productInfo.price3
    ) {
      explicitQty = 1;
    }

    let lockedOffer: OfferItem | null = null;

    if (productInfo) {
      const promoFromHistory = getOfferFromLastPromotion(history, parsed);
      const promoMatchesProduct = promoFromHistory && normalize(promoFromHistory.product) === normalize(productInfo.canonical);
      const fixedTemplateOfferRaw = getFixedTemplateOffer(templatePricing, productInfo.canonical);
      const fixedTemplateOffer = isPlausibleOfferForProduct(fixedTemplateOfferRaw, productInfo)
        ? fixedTemplateOfferRaw
        : null;
      const fixedCatalogOffer = getCatalogFixedPackOffer(productInfo);

      if (fixedTemplateOffer) {
        lockedOffer = fixedTemplateOffer;
        explicitQty = fixedTemplateOffer.quantity;
      } else if (fixedCatalogOffer) {
        lockedOffer = fixedCatalogOffer;
        explicitQty = fixedCatalogOffer.quantity;
      } else if (explicitQty > 0) {
        const templateOfferRaw = getTemplateOfferForQuantity(templatePricing, productInfo.canonical, explicitQty);
        const templateOffer = isPlausibleOfferForProduct(templateOfferRaw, productInfo) ? templateOfferRaw : null;
        const templatePrice1 = getTemplatePrice1(templatePricing, productInfo.canonical);
        const catalogOffer = getCatalogOffer(productInfo, explicitQty);

        const templateActiveForProduct = hasTemplateForProduct(templatePricing, productInfo.canonical);

        if (templateOffer) {
          lockedOffer = templateOffer;
        } else if (explicitQty === 1 && templatePrice1 > 0) {
          lockedOffer = {
            product: productInfo.canonical,
            quantity: 1,
            total: templatePrice1,
            label: `1 unidad por ${formatGs(templatePrice1)} Gs`,
            source: "template",
          };
        } else if (!templateActiveForProduct && catalogOffer) {
          lockedOffer = catalogOffer;
        } else if (
          promoMatchesProduct &&
          promoFromHistory.quantity === explicitQty &&
          isPlausibleOfferForProduct(promoFromHistory, productInfo)
        ) {
          lockedOffer = promoFromHistory;
        } else {
          lockedOffer = null;
        }
      } else if ((isGenericBuyReply(texto) || promoResponse || isBuyIntent(texto)) && promoMatchesProduct && isPlausibleOfferForProduct(promoFromHistory, productInfo)) {
        lockedOffer = promoFromHistory;
      } else if (
        lockedOfferByContext &&
        normalize(lockedOfferByContext.product) === normalize(productInfo.canonical) &&
        isPlausibleOfferForProduct(lockedOfferByContext, productInfo)
      ) {
        lockedOffer = lockedOfferByContext;
      }
    }

    const cityStatement = extractCityStatement(texto);
    const prevStep = freshOrder ? "" : context?.step || "";
    const isCityStep = prevStep === "collecting_city";
    const isDataCollectionStep = ["collecting_name", "collecting_address", "collecting_phone", "collecting_quantity"].includes(prevStep);

    // V63: sanea ciudades contaminadas que hayan quedado guardadas por una versión anterior.
    // Ej.: "Asuncion Roberto Lpetti El" se convierte inmediatamente en "Asunción".
    const sanitizedOldCity = canonicalizeStoredCity(oldOrder.city || "", parsed);
    if (sanitizedOldCity && sanitizedOldCity !== oldOrder.city) {
      oldOrder.city = sanitizedOldCity;
    }

    const explicitKnownCityFromMessage = extractExplicitKnownCityFromSentence(texto, parsed);
    const detectedCityRaw = detectCity(texto, parsed, sanitizedOldCity || "");
    const exactCityFromMessage = exactKnownCity(texto, parsed);
    const explicitDifferentCity = Boolean(
      cityStatement &&
      exactKnownCity(cityStatement, parsed) &&
      normalize(exactKnownCity(cityStatement, parsed)) !== normalize(oldOrder.city || "")
    );
    const exactDifferentCity = Boolean(
      exactCityFromMessage &&
      normalize(exactCityFromMessage) !== normalize(oldOrder.city || "")
    );

    // V56: una vez confirmada la ciudad, se conserva en todos los pasos.
    // Solo cambia si el cliente declara expresamente otra ciudad o escribe
    // exactamente otra localidad conocida. Una pregunta, dirección, talle,
    // cantidad o respuesta corta jamás puede reemplazarla.
    const detectedCity = explicitKnownCityFromMessage
      ? explicitKnownCityFromMessage
      : oldOrder.city && !explicitDifferentCity && !exactDifferentCity
        ? canonicalizeStoredCity(oldOrder.city, parsed)
        : explicitDifferentCity
          ? canonicalizeStoredCity(cityStatement, parsed)
          : exactDifferentCity
            ? exactCityFromMessage
            : detectedCityRaw;

    const pendingCityConfirmation = clean(context?.pending_city_confirmation || "");
    let cityConfirmedNow = "";
    let cityConfirmationDeclined = false;

    if (pendingCityConfirmation && !oldOrder.city) {
      const msgNorm = normalize(texto);
      if (/^(si|sí|sii|siii|sip|si asi es|sí asi es|si así es|sí así es|sii asi es|siii asi es|correcto|exacto|esa|ese|esa es|es esa|asi es|así es|dale|ok)$/.test(msgNorm)) {
        cityConfirmedNow = pendingCityConfirmation;
      } else if (/^(no|no es esa|otra|nop|no es)$/.test(msgNorm)) {
        cityConfirmationDeclined = true;
      }
    }

    if (cityConfirmationDeclined) {
      return res.json({
        response: await requireCommercialResponse({
          event: "El cliente rechazó la ciudad sugerida. Pedí únicamente su ciudad correcta, de forma natural y sin asumir ninguna localidad.",
          order: oldOrder,
        }),
        context: {
          ...(context || {}),
          pending_city_confirmation: null,
          updated_at: new Date().toISOString(),
        },
      });
    }

    let effectiveDetectedCity = cityConfirmedNow || detectedCity;
    const cityWasCapturedNow = Boolean(
      cityConfirmedNow ||
      (effectiveDetectedCity && normalize(effectiveDetectedCity) !== normalize(oldOrder.city || ""))
    );

    const cityCandidateRaw = cityStatement || texto;
    const isExactCityMatch =
      !!cityConfirmedNow || (!!detectedCity && !!exactKnownCity(cityCandidateRaw, parsed));

    // V51: cuando el cliente declara claramente su ciudad (por ejemplo,
    // "soy de Arroyo Pora"), la guardamos directamente. Si no figura en la
    // cobertura, el flujo determinístico ofrece transportadora sin hacer una
    // confirmación innecesaria de la localidad. Solo confirmamos ciudades
    // inferidas desde mensajes ambiguos o demasiado breves.
    const hasExplicitCityStatement = Boolean(cityStatement);

    // V72: nunca pedir una segunda confirmación de ciudad. Si el texto es un
    // candidato válido, se guarda y se evalúa inmediatamente la modalidad.
    // Así el cliente recibe en el mismo turno "contra-entrega" o
    // "transportadora con pago anticipado".
    const needsCityConfirmation = false;

    if (false && needsCityConfirmation) {
      // Bloque conservado únicamente como referencia defensiva; no se ejecuta.
      return res.json({
        response: "😊 ¿De qué ciudad sos? Así te confirmo la modalidad de entrega. 📍",
        context: {
          ...(context || {}),
          pending_city_confirmation: null,
          updated_at: new Date().toISOString(),
        },
      });
    }

    // V82: "quiero", "quiero 1", "2x1" y respuestas de cantidad
    // no son ciudades. Si todavía falta ciudad, simplemente se vuelve a pedir.
    const messageIsPurchaseOrQuantity =
      isBuyIntent(texto) ||
      isGenericBuyReply(texto) ||
      explicitQty > 0 ||
      /\b\d+\s*x\s*1\b/i.test(normalize(texto));

    if (isCityStep && !effectiveDetectedCity && messageIsPurchaseOrQuantity) {
      return res.json({
        response: await requireCommercialResponse({
          event: "La ciudad sigue faltando. Respondé al mensaje actual y solicitá únicamente la ciudad de envío, sin interpretar cantidades o intención de compra como ciudad.",
          order: { ...oldOrder, quantity: explicitQty > 0 ? explicitQty : oldOrder.quantity },
        }),
        context: {
          ...(context || {}),
          pending_city_confirmation: null,
          order_data: {
            ...oldOrder,
            quantity: explicitQty > 0 ? explicitQty : oldOrder.quantity,
          },
          order_id: oldOrder.order_id || null,
          step: "collecting_city",
          updated_at: new Date().toISOString(),
        },
        debug: {
          purchase_reply_while_waiting_city: true,
          received_text: texto,
          quantity_detected: explicitQty || null,
        },
      });
    }

    // Un texto que claramente no es ciudad recibe nuevamente la pregunta,
    // pero nunca se marca como "fuera de cobertura".
    if (
      isCityStep &&
      !effectiveDetectedCity &&
      !isQuestionLikeMessage(texto) &&
      !isShortAcknowledgement(texto)
    ) {
      return res.json({
        response: await requireCommercialResponse({
          event: "El mensaje recibido no contiene una ciudad válida. Solicitá únicamente la ciudad de envío sin declarar falta de cobertura.",
          order: oldOrder,
        }),
        context: {
          ...(context || {}),
          pending_city_confirmation: null,
          order_data: oldOrder,
          order_id: oldOrder.order_id || null,
          step: "collecting_city",
          updated_at: new Date().toISOString(),
        },
        debug: { rejected_non_city_text: true, received_text: texto },
      });
    }

    const phone = extractPhone(texto);
    const qty = explicitQty;

    const coordinateLikeMessage =
      /^\s*(?:📍\s*)?(?:ubicacion|ubicación)?\s*:?-?\s*-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/i.test(texto);

    const historyRecoveredCity =
      !oldOrder.city && coordinateLikeMessage
        ? recoverRecentCityFromHistory(history, parsed)
        : "";

    if (!effectiveDetectedCity && historyRecoveredCity) {
      effectiveDetectedCity = historyRecoveredCity;
    }

    // V98: cada extractor está aislado. Un dato difícil de interpretar no debe
    // derribar todo el turno ni devolver “No pude procesar...”.
    let detectedName = "";
    try {
      detectedName = extractName(
        texto,
        effectiveDetectedCity !== oldOrder.city ? effectiveDetectedCity : "",
        phone,
        parsed,
        prevStep === "collecting_name"
      );
    } catch (error) {
      console.error("⚠️ extractName falló; se continúa sin nombre:", error);
    }

    let historyRecoveredName = "";
    try {
      historyRecoveredName =
        !oldOrder.customer_name
          ? recoverRecentValidNameFromHistory(
              history,
              effectiveDetectedCity || oldOrder.city || "",
              phone || oldOrder.phone || "",
              parsed
            )
          : "";
    } catch (error) {
      console.error("⚠️ recoverRecentValidNameFromHistory falló:", error);
    }

    const name = detectedName || historyRecoveredName;

    let address = "";
    try {
      address = extractAddress(
        texto,
        effectiveDetectedCity !== oldOrder.city ? effectiveDetectedCity : "",
        phone,
        name,
        parsed
      );
    } catch (error) {
      console.error("⚠️ extractAddress falló; se continúa sin dirección:", error);
    }

    let observationPatch: Partial<OrderData> = {};
    try {
      observationPatch = extractOrderObservation(texto);
    } catch (error) {
      console.error("⚠️ extractOrderObservation falló:", error);
    }

    // V122: las consultas sobre fecha, demora u horario de entrega NO usan
    // una respuesta fija del backend. Continúan hacia Gemini para que responda
    // exclusivamente con las reglas de entrega cargadas en el entrenamiento
    // y luego retome el siguiente dato faltante sin reiniciar el pedido.
    if (false && isDeliveryTimingQuestion(texto) && oldOrder.product) {
      return res.json({
        response: buildDeliveryTimingQuestionResponse(texto, oldOrder),
        context: {
          ...(context || {}),
          order_data: oldOrder,
          order_id: oldOrder.order_id || null,
          step: nextStep(
            oldOrder,
            oldOrder.city ? hasCoverage(oldOrder.city, parsed) : null,
            isAddressOptionalByTraining(parsed, oldOrder.city ? hasCoverage(oldOrder.city, parsed) : null)
          ),
          updated_at: new Date().toISOString(),
        },
        debug: { delivery_timing_question_without_state_reset: true },
      });
    }

    let orderData = mergeOrderData(
      oldOrder,
      {
        order_id: oldOrder.order_id || makeOrderId(fromNumber),
        quantity: qty,
        city: effectiveDetectedCity && effectiveDetectedCity !== oldOrder.city ? effectiveDetectedCity : "",
        phone,
        name,
        old_name_is_contaminated: isContaminatedCustomerName(clean((context?.order_data || {}).customer_name || ""), parsed),
        address,
        locked_offer: lockedOffer,
        ...observationPatch,
      },
      product
    );

    // V101: "quiero", "me interesa", "sí", "dale" expresan intención,
    // nunca cantidad. La cantidad anterior tampoco se reutiliza para una venta nueva.
    if (isGenericBuyReply(texto) && explicitQty <= 0 && !orderData.locked_offer?.fixed_quantity) {
      orderData.quantity = 0;
    }

    if (!orderData.city && oldOrder.city && qty > 0) {
      orderData.city = oldOrder.city;
    }

    if (!orderData.city && historyRecoveredCity) {
      orderData.city = historyRecoveredCity;
    }

    const protectedHistoryName = recoverRecentValidNameFromHistory(
      history,
      orderData.city || oldOrder.city || "",
      orderData.phone || oldOrder.phone || "",
      parsed
    );

    if (
      protectedHistoryName &&
      (
        !orderData.customer_name ||
        isContaminatedCustomerName(orderData.customer_name, parsed) ||
        /^(fdo|fndo|avda|rca|gral|mcal)\b/i.test(normalize(orderData.customer_name))
      )
    ) {
      orderData.customer_name = protectedHistoryName;
    }

    if (
      orderData.locked_offer &&
      orderData.locked_offer.fixed_quantity &&
      orderData.quantity === 0
    ) {
      orderData.quantity = orderData.locked_offer.quantity;
    }

    // V103: una promoción variable no define cantidad.
    // Reiniciamos la cantidad únicamente cuando:
    // - el cliente recién expresa intención de compra, o
    // - acaba de enviar/confirmar la ciudad,
    // siempre que el mismo mensaje no contenga una cantidad explícita.
    const mustCollectQuantityNow =
      explicitQty <= 0 &&
      sanitizeQuantity(oldOrder.quantity) <= 0 &&
      !orderData.locked_offer?.fixed_quantity &&
      (
        isGenericBuyReply(texto) ||
        cityWasCapturedNow ||
        (isCityStep && Boolean(effectiveDetectedCity))
      );

    if (mustCollectQuantityNow) {
      orderData.quantity = 0;
    }

    if (orderData.locked_offer && explicitQty > 0 && explicitQty !== orderData.locked_offer.quantity) {
      if (orderData.locked_offer.fixed_quantity) {
        orderData.quantity = orderData.locked_offer.quantity;
      } else {
        orderData.locked_offer = null;
        if (productInfo) {
          const templateOfferRaw2 = getTemplateOfferForQuantity(templatePricing, productInfo.canonical, explicitQty);
          const templateOffer2 = isPlausibleOfferForProduct(templateOfferRaw2, productInfo) ? templateOfferRaw2 : null;
          const templateActiveForProduct = hasTemplateForProduct(templatePricing, productInfo.canonical);
          const catalogOffer = templateActiveForProduct ? null : getCatalogOffer(productInfo, explicitQty);
          if (templateOffer2) orderData.locked_offer = templateOffer2;
          else if (catalogOffer) orderData.locked_offer = catalogOffer;
        }
        orderData.quantity = explicitQty;
      }
    }

    // V103: defensa final. Si la ciudad se acaba de capturar y el cliente
    // no indicó cantidad en ese mismo mensaje, el siguiente paso debe ser cantidad.
    if (
      cityWasCapturedNow &&
      explicitQty <= 0 &&
      sanitizeQuantity(oldOrder.quantity) <= 0 &&
      !orderData.locked_offer?.fixed_quantity
    ) {
      orderData.quantity = 0;
    }

    // V104: la cantidad elegida por el cliente es la fuente de verdad.
    // Una oferta vieja de 1 unidad nunca puede reemplazar una cantidad 2.
    if (explicitQty > 0) {
      orderData.quantity = explicitQty;

      if (productInfo) {
        const exactTemplateOfferRaw = getTemplateOfferForQuantity(
          templatePricing,
          productInfo.canonical,
          explicitQty
        );
        const exactTemplateOffer = isPlausibleOfferForProduct(
          exactTemplateOfferRaw,
          productInfo
        )
          ? exactTemplateOfferRaw
          : null;
        const exactCatalogOffer = getCatalogOffer(productInfo, explicitQty);
        const exactFixedCatalogOffer = getCatalogFixedPackOffer(productInfo);

        orderData.locked_offer =
          exactTemplateOffer ||
          (
            exactFixedCatalogOffer &&
            sanitizeQuantity(exactFixedCatalogOffer.quantity) === sanitizeQuantity(explicitQty)
              ? exactFixedCatalogOffer
              : null
          ) ||
          exactCatalogOffer ||
          null;
      }
    }

    // Si la cantidad ya estaba guardada de un turno anterior, la oferta debe
    // coincidir con ella. De lo contrario se descarta y se recalcula.
    if (
      orderData.quantity > 0 &&
      orderData.locked_offer &&
      sanitizeQuantity(orderData.locked_offer.quantity) !== sanitizeQuantity(orderData.quantity)
    ) {
      orderData.locked_offer = null;
    }

    if (
      orderData.quantity > 0 &&
      !orderData.locked_offer &&
      productInfo
    ) {
      const persistedTemplateOfferRaw = getTemplateOfferForQuantity(
        templatePricing,
        productInfo.canonical,
        orderData.quantity
      );
      const persistedTemplateOffer = isPlausibleOfferForProduct(
        persistedTemplateOfferRaw,
        productInfo
      )
        ? persistedTemplateOfferRaw
        : null;
      const persistedCatalogOffer = getCatalogOffer(productInfo, orderData.quantity);

      orderData.locked_offer =
        persistedTemplateOffer ||
        persistedCatalogOffer ||
        null;
    }

    // V110/V126: ninguna ciudad, referencia o frase conversacional
    // puede quedar guardada como nombre.
    if (
      orderData.customer_name &&
      (
        isInvalidCustomerNameForOrder(orderData.customer_name, orderData.city, parsed) ||
        !isStrictStandaloneCustomerName(orderData.customer_name, orderData.city, parsed)
      )
    ) {
      orderData.customer_name = "";
    }

    if (orderData.address && isDeferredLocationMessage(orderData.address)) {
      orderData.address = "";
    }

    const proofReceived = hasPaymentProof(context, texto, media_url, media_type || mime_type);
    const currentCoverageForProof = orderData.city ? hasCoverage(orderData.city, parsed) : null;
    const expectedPaymentAmount =
      orderData.product && orderData.quantity
        ? calculateTotal(orderData.product, orderData.quantity, parsed, orderData.locked_offer)
        : 0;

    if (proofReceived && currentCoverageForProof === false) {
      orderData.payment_proof_received = true;
      orderData.payment_proof_verified = false;
      orderData.payment_holder_name = "";
      orderData.payment_amount = 0;
      orderData.payment_operation_number = "";
      orderData.payment_status_text = "";
      orderData.payment_verification_error = "";
      orderData.payment_recipient_name = "";
      orderData.payment_recipient_document = "";
      orderData.payment_recipient_account = "";
      orderData.payment_recipient_alias = "";
      orderData.payment_recipient_bank = "";
      orderData.payment_recipient_matched = false;
      orderData.payment_proof_mime = "";
      orderData.payment_manual_review_required = false;
      orderData.payment_manual_review_reason = "";

      const fetchedProof = await fetchMediaAsBase64(clean(media_url));

      if (!fetchedProof) {
        orderData.payment_verification_error = "No pude descargar o leer el archivo enviado.";
      } else if (!expectedPaymentAmount) {
        orderData.payment_verification_error =
          "Todavía no se pudo calcular el total del pedido para comparar el comprobante.";
      } else if (!parsed.bankData) {
        orderData.payment_verification_error =
          "No hay datos bancarios configurados para validar el destinatario del pago.";
      } else {
        const resolvedProofMime =
          clean(mime_type) ||
          clean(fetchedProof.mime) ||
          (/\.pdf(?:\?|$)/i.test(clean(media_url)) ? "application/pdf" : "image/jpeg");
        const isPdfProof = resolvedProofMime.toLowerCase().includes("pdf");

        const proofAnalysis = await analyzePaymentProofWithGemini({
          apiKey,
          model,
          mediaBase64: fetchedProof.data,
          mime: resolvedProofMime,
          expectedAmount: expectedPaymentAmount,
          bankData: parsed.bankData,
        });

        orderData.payment_proof_mime = resolvedProofMime;
        orderData.payment_holder_name = proofAnalysis.holder_name;
        orderData.payment_amount = proofAnalysis.amount;
        orderData.payment_operation_number = proofAnalysis.operation_number;
        orderData.payment_status_text = proofAnalysis.status_text;
        orderData.payment_recipient_name = proofAnalysis.recipient_name;
        orderData.payment_recipient_document = proofAnalysis.recipient_document;
        orderData.payment_recipient_account = proofAnalysis.recipient_account;
        orderData.payment_recipient_alias = proofAnalysis.recipient_alias;
        orderData.payment_recipient_bank = proofAnalysis.recipient_bank;

        const hasPayerName = isValidPaymentSenderName(
          proofAnalysis.holder_name,
          proofAnalysis.recipient_name,
          parsed.bankData,
          orderData.city,
          parsed
        );
        const amountCoversOrder = proofAnalysis.amount >= expectedPaymentAmount;
        const recipientMatches = paymentRecipientMatchesBankData(
          proofAnalysis,
          parsed.bankData
        );
        const transferIsPending =
          !isPdfProof &&
          isPendingTransferStatus(proofAnalysis.status_text);

        const statusIsFinal =
          isPdfProof ||
          proofAnalysis.successful;

        const basePaymentDataValid = Boolean(
          proofAnalysis.readable &&
          hasPayerName &&
          proofAnalysis.amount > 0 &&
          amountCoversOrder &&
          recipientMatches
        );

        orderData.payment_manual_review_required = Boolean(
          basePaymentDataValid &&
          transferIsPending
        );

        orderData.payment_manual_review_reason =
          orderData.payment_manual_review_required
            ? "Transferencia pendiente de acreditación. Verificar manualmente."
            : "";

        orderData.payment_recipient_matched = recipientMatches;
        orderData.payment_proof_verified = Boolean(
          basePaymentDataValid &&
          (
            statusIsFinal ||
            orderData.payment_manual_review_required
          )
        );

        // V125: si todavía no existe un nombre real del cliente, usar el nombre
        // del remitente/pagador detectado en el comprobante. Nunca reemplazar un
        // nombre válido que el cliente ya haya escrito explícitamente.
        if (
          orderData.payment_proof_verified &&
          hasPayerName &&
          (
            !orderData.customer_name ||
            isInvalidCustomerNameForOrder(orderData.customer_name, orderData.city, parsed) ||
            isContaminatedCustomerName(orderData.customer_name, parsed)
          )
        ) {
          orderData.customer_name = clean(proofAnalysis.holder_name);
        }

        if (!orderData.payment_proof_verified) {
          const reasons: string[] = [];

          if (!proofAnalysis.readable) {
            reasons.push(
              isPdfProof
                ? "no se pudieron leer claramente los datos obligatorios del PDF"
                : "el comprobante no se ve con suficiente claridad"
            );
          }

          if (
            !isPdfProof &&
            !proofAnalysis.successful &&
            !transferIsPending
          ) {
            reasons.push("la imagen no muestra claramente una transferencia exitosa o aprobada");
          }

          if (!hasPayerName) {
            reasons.push("no se pudo detectar el titular de la cuenta debitada");
          }

          if (!recipientMatches) {
            reasons.push("el destinatario no coincide con los datos bancarios configurados");
          }

          if (!proofAnalysis.amount) {
            reasons.push("no se pudo detectar el monto");
          } else if (!amountCoversOrder) {
            const difference = expectedPaymentAmount - proofAnalysis.amount;
            reasons.push(
              `el monto detectado (${formatGs(proofAnalysis.amount)} Gs) es menor al total del pedido (${formatGs(expectedPaymentAmount)} Gs). Falta completar ${formatGs(difference)} Gs`
            );
          }

          orderData.payment_verification_error =
            reasons.length
              ? `No se pudo verificar porque ${reasons.join(", ")}.`
              : (proofAnalysis.error || "No se pudieron verificar todos los datos obligatorios.");
        } else {
          const overpayment = Math.max(0, proofAnalysis.amount - expectedPaymentAmount);
          const recipientLabel =
            proofAnalysis.recipient_name ||
            parsed.bankData.titular ||
            "destinatario configurado";

          orderData.payment_note = mergeUniqueText(
            orderData.payment_note,
            `${
              orderData.payment_manual_review_required
                ? "Pago anticipado recibido. Requiere verificación manual."
                : "Pago anticipado verificado."
            } Pagador: ${orderData.payment_holder_name}. Destinatario: ${recipientLabel}. Monto: ${formatGs(orderData.payment_amount)} Gs.${overpayment > 0 ? ` Diferencia a favor: ${formatGs(overpayment)} Gs.` : ""}${orderData.payment_operation_number ? ` Operación: ${orderData.payment_operation_number}.` : ""}`
          );
        }
      }
    } else if (preserveVerifiedPaymentForSameOrder(oldOrder, orderData)) {
      orderData.payment_proof_received = true;
      orderData.payment_proof_verified = true;
      orderData.payment_holder_name = clean(oldOrder.payment_holder_name);
      orderData.payment_amount = Number(oldOrder.payment_amount || 0);
      orderData.payment_operation_number = clean(oldOrder.payment_operation_number);
      orderData.payment_status_text = clean(oldOrder.payment_status_text);
      orderData.payment_verification_error = "";
      orderData.payment_recipient_name = clean(oldOrder.payment_recipient_name);
      orderData.payment_recipient_document = clean(oldOrder.payment_recipient_document);
      orderData.payment_recipient_account = clean(oldOrder.payment_recipient_account);
      orderData.payment_recipient_alias = clean(oldOrder.payment_recipient_alias);
      orderData.payment_recipient_bank = clean(oldOrder.payment_recipient_bank);
      orderData.payment_recipient_matched = !!oldOrder.payment_recipient_matched;
      orderData.payment_proof_mime = clean(oldOrder.payment_proof_mime);
      orderData.payment_manual_review_required = !!oldOrder.payment_manual_review_required;
      orderData.payment_manual_review_reason = clean(oldOrder.payment_manual_review_reason);

      // V125: al conservar un comprobante verificado, recuperar también el
      // nombre del pagador cuando todavía no exista un nombre válido del cliente.
      if (
        clean(orderData.payment_holder_name) &&
        (
          !orderData.customer_name ||
          isInvalidCustomerNameForOrder(orderData.customer_name, orderData.city, parsed) ||
          isContaminatedCustomerName(orderData.customer_name, parsed)
        )
      ) {
        orderData.customer_name = clean(orderData.payment_holder_name);
      }
    } else if (isSameOrderForPaymentProof(oldOrder, orderData)) {
      orderData.payment_proof_received = true;
      orderData.payment_proof_verified = false;
      orderData.payment_holder_name = clean(oldOrder.payment_holder_name);
      orderData.payment_amount = Number(oldOrder.payment_amount || 0);
      orderData.payment_operation_number = clean(oldOrder.payment_operation_number);
      orderData.payment_status_text = clean(oldOrder.payment_status_text);
      orderData.payment_verification_error = clean(oldOrder.payment_verification_error);
      orderData.payment_recipient_name = clean(oldOrder.payment_recipient_name);
      orderData.payment_recipient_document = clean(oldOrder.payment_recipient_document);
      orderData.payment_recipient_account = clean(oldOrder.payment_recipient_account);
      orderData.payment_recipient_alias = clean(oldOrder.payment_recipient_alias);
      orderData.payment_recipient_bank = clean(oldOrder.payment_recipient_bank);
      orderData.payment_recipient_matched = !!oldOrder.payment_recipient_matched;
      orderData.payment_proof_mime = clean(oldOrder.payment_proof_mime);
      orderData.payment_manual_review_required = !!oldOrder.payment_manual_review_required;
      orderData.payment_manual_review_reason = clean(oldOrder.payment_manual_review_reason);
    } else {
      orderData.payment_proof_received = false;
      orderData.payment_proof_verified = false;
      orderData.payment_holder_name = "";
      orderData.payment_amount = 0;
      orderData.payment_operation_number = "";
      orderData.payment_status_text = "";
      orderData.payment_verification_error = "";
      orderData.payment_recipient_name = "";
      orderData.payment_recipient_document = "";
      orderData.payment_recipient_account = "";
      orderData.payment_recipient_alias = "";
      orderData.payment_recipient_bank = "";
      orderData.payment_recipient_matched = false;
      orderData.payment_proof_mime = "";
      orderData.payment_manual_review_required = false;
      orderData.payment_manual_review_reason = "";
    }

    // V110: defensa final antes de confirmar.
    if (
      orderData.customer_name &&
      isInvalidCustomerNameForOrder(orderData.customer_name, orderData.city, parsed)
    ) {
      // V125: si el nombre actual es inválido, reemplazarlo por el pagador
      // verificado cuando esté disponible; de lo contrario, limpiarlo.
      const verifiedPayerName = clean(orderData.payment_holder_name);
      orderData.customer_name =
        orderData.payment_proof_verified &&
        verifiedPayerName &&
        isValidPaymentSenderName(
          verifiedPayerName,
          orderData.payment_recipient_name,
          parsed.bankData,
          orderData.city,
          parsed
        )
          ? verifiedPayerName
          : "";
    }

    if (orderData.locked_offer && orderData.locked_offer.total < 10000) {
      orderData.locked_offer = null;
    }

    if (orderData.product && !getProductInfo(orderData.product, parsed)) {
      orderData.product = "";
      orderData.locked_offer = null;
    }

    // V67: el celular es opcional. Si el cliente no escribe uno válido,
    // usamos el mismo número de WhatsApp desde el que está conversando.
    // Un número explícito del cliente siempre tiene prioridad.
    if (!orderData.phone) {
      orderData.phone = senderPhoneFallback(fromNumber);
    }

    // V106: restaurar siempre la oferta del pack fijo antes de calcular el estado.
    const productBeforeState = getProductInfo(orderData.product, parsed);
    if (
      productBeforeState?.fixedPackQuantity &&
      sanitizeQuantity(orderData.quantity) === sanitizeQuantity(productBeforeState.fixedPackQuantity)
    ) {
      const fixedBeforeState = getCatalogFixedPackOffer(productBeforeState);
      if (fixedBeforeState) {
        orderData.locked_offer = fixedBeforeState;
      }
    }

    const state = buildState(orderData, parsed);

    if (state.productInfo && !orderData.locked_offer && orderData.quantity) {
      const templateOfferRaw3 = getTemplateOfferForQuantity(templatePricing, state.productInfo.canonical, orderData.quantity);
      const templateOffer3 = isPlausibleOfferForProduct(templateOfferRaw3, state.productInfo) ? templateOfferRaw3 : null;
      const templateActiveForProduct = hasTemplateForProduct(templatePricing, state.productInfo.canonical);
      const catalogOffer = templateActiveForProduct ? null : getCatalogOffer(state.productInfo, orderData.quantity);

      if (templateOffer3) {
        orderData.locked_offer = templateOffer3;
      } else if (catalogOffer) {
        orderData.locked_offer = catalogOffer;
      } else {
        const templatePrice1 = getTemplatePrice1(templatePricing, state.productInfo.canonical);
        if (orderData.quantity === 1 && templatePrice1 > 0) {
          orderData.locked_offer = {
            product: state.productInfo.canonical,
            quantity: 1,
            total: templatePrice1,
            label: `1 unidad por ${formatGs(templatePrice1)} Gs`,
            source: "template",
          };
        }
      }
    }

    if (isGenericProductLabel(orderData.product) || /^(usalas con|usala con|usalo con)$/i.test(normalize(orderData.product))) {
      const recoveredProduct =
        getProductInfo(context?.current_product || "", parsed)?.canonical ||
        detectProduct(texto, parsed, context?.current_product || "");
      if (recoveredProduct) orderData.product = recoveredProduct;
    }

    const finalState = buildState(orderData, parsed);
    let directConfirm = hasAllRequiredOrderDataForDirectConfirmation(finalState);
    let confirm = shouldConfirmOrder(finalState) || directConfirm;

    if (finalState.total < 10000) {
      directConfirm = false;
      confirm = false;
    }

    if (finalState.coverage === false && !orderData.payment_proof_verified) {
      directConfirm = false;
      confirm = false;
    }

    // V71: al confirmar una ciudad pendiente, informar SIEMPRE la modalidad
    // antes de pedir nombre, dirección o cualquier otro dato.
    if (!confirm && cityConfirmedNow && finalState.coverage === false) {
      const mandatoryOutsideCoverageResponse = deterministicAfterCityCoverageMessage(finalState);
      if (mandatoryOutsideCoverageResponse) {
        if (orderData.product) {
          await safeUpsertOrder(user_id, fromNumber, orderData, parsed, false);
        }

        return res.json({
          response: await requireCommercialResponse({
            event: "Informá la modalidad correspondiente a la ciudad sin cobertura contra entrega, usando únicamente los datos bancarios y logísticos del entrenamiento, y pedí solo el siguiente requisito faltante.",
            order: orderData,
            extraFacts: { coverage: false, city: orderData.city, step: finalState.step, bank_data_available: Boolean(parsed.bankData) },
          }),
          context: {
            ...(context || {}),
            pending_city_confirmation: null,
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            payment_proof_received: false,
            step: finalState.step,
            address_optional: finalState.addressOptional,
            updated_at: new Date().toISOString(),
          },
          debug: {
            mandatory_outside_coverage_after_city_confirmation: true,
            city: orderData.city,
            quantity: orderData.quantity,
            coverage: finalState.coverage,
            step: finalState.step,
          },
        });
      }
    }

    let persistedOrderId: string | null = null;

    if (orderData.product) {
      persistedOrderId = await safeUpsertOrder(user_id, fromNumber, orderData, parsed, confirm);
    }

    // V120: si en este mensaje se recibió un comprobante y el pedido todavía
    // no puede cerrarse, devolver SIEMPRE el resultado técnico de la validación.
    // No permitir que Gemini o una rama conversacional silencien si el
    // destinatario coincide, el monto alcanza o el archivo fue rechazado.
    if (proofReceived && currentCoverageForProof === false && !confirm) {
      const proofResponse = paymentProofVerificationMessage(
        orderData,
        expectedPaymentAmount
      );

      return res.json({
        response: proofResponse,
        context: {
          ...(context || {}),
          current_product: orderData.product || null,
          last_topic: orderData.product || context?.last_topic || null,
          last_ad_offer: orderData.locked_offer || null,
          order_data: orderData,
          order_id: orderData.order_id || null,
          payment_proof_received: orderData.payment_proof_received || false,
          payment_proof_verified: orderData.payment_proof_verified || false,
          payment_holder_name: orderData.payment_holder_name || null,
          payment_amount: orderData.payment_amount || 0,
          payment_operation_number: orderData.payment_operation_number || null,
          payment_recipient_name: orderData.payment_recipient_name || null,
          payment_recipient_document: orderData.payment_recipient_document || null,
          payment_recipient_account: orderData.payment_recipient_account || null,
          payment_recipient_alias: orderData.payment_recipient_alias || null,
          payment_recipient_bank: orderData.payment_recipient_bank || null,
          payment_recipient_matched: orderData.payment_recipient_matched || false,
          payment_proof_mime: orderData.payment_proof_mime || null,
          payment_manual_review_required: orderData.payment_manual_review_required || false,
          payment_manual_review_reason: orderData.payment_manual_review_reason || null,
          step: finalState.step,
          updated_at: new Date().toISOString(),
        },
        debug: {
          mandatory_payment_proof_response: true,
          verified: orderData.payment_proof_verified,
          recipient_matched: orderData.payment_recipient_matched,
          expected_amount: expectedPaymentAmount,
          detected_amount: orderData.payment_amount,
          customer_name_from_payer: orderData.customer_name || null,
          verification_error: orderData.payment_verification_error || null,
        },
      });
    }

    if (confirm) {
      // V84: nunca mostrar PEDIDO CONFIRMADO si primero no se pudo guardar
      // la venta en la tabla orders.
      if (!persistedOrderId) {
        console.error("❌ No se pudo guardar el pedido confirmado en orders", {
          user_id,
          fromNumber,
          order_id: orderData.order_id,
          product: orderData.product,
        });

        return res.status(500).json({
          error: "No se pudo registrar el pedido confirmado",
          response: "⚠️ No pudimos registrar el pedido en el sistema todavía. Tus datos siguen guardados; escribí «CONFIRMAR PEDIDO» para reintentar.",
          context: {
            ...(context || {}),
            current_product: orderData.product || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            step: "confirm_pending",
            updated_at: new Date().toISOString(),
          },
          debug: {
            confirmed_order_persistence_failed: true,
            product: orderData.product,
            quantity: orderData.quantity,
            city: orderData.city,
          },
        });
      }

      const fixedConfirmation = finalConfirmationMessage(finalState, parsed);

      return res.json({
        response: fixedConfirmation,
        context: {
          ...(context || {}),
          current_product: orderData.product || null,
          last_topic: orderData.product || context?.last_topic || null,
          last_ad_offer: orderData.locked_offer || null,
          order_data: orderData,
          order_id: orderData.order_id || null,
          payment_proof_received: orderData.payment_proof_received || false,
            payment_proof_verified: orderData.payment_proof_verified || false,
            payment_holder_name: orderData.payment_holder_name || null,
            payment_amount: orderData.payment_amount || 0,
            payment_operation_number: orderData.payment_operation_number || null,
            payment_recipient_name: orderData.payment_recipient_name || null,
            payment_recipient_document: orderData.payment_recipient_document || null,
            payment_recipient_account: orderData.payment_recipient_account || null,
            payment_recipient_alias: orderData.payment_recipient_alias || null,
            payment_recipient_bank: orderData.payment_recipient_bank || null,
            payment_recipient_matched: orderData.payment_recipient_matched || false,
            payment_proof_mime: orderData.payment_proof_mime || null,
            payment_manual_review_required: orderData.payment_manual_review_required || false,
            payment_manual_review_reason: orderData.payment_manual_review_reason || null,
          step: "pedido_confirmado",
          updated_at: new Date().toISOString(),
        },
        debug: true
          ? {
              fixed_backend_confirmation: true,
              persisted_order_id: persistedOrderId,
              saved_to_orders: true,
              product: orderData.product,
              quantity: orderData.quantity,
              city: orderData.city,
              coverage: finalState.coverage,
              total: finalState.total,
              missing: finalState.missing,
              step: finalState.step,
              confirm,
              direct_confirm: directConfirm,
              locked_offer: orderData.locked_offer,
            }
          : undefined,
      });
    }

    // Parche 1: Desactivado waiting_payment_proof fijo
    if (false && !confirm && finalState.coverage === false && finalState.step === "waiting_payment_proof") {
      const waitProofResponse = deterministicWaitingPaymentProofMessage(finalState, parsed);
      if (waitProofResponse) {
        return res.json({
          response: waitProofResponse,
          context: {
            ...(context || {}),
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            payment_proof_received: false,
            step: "waiting_payment_proof",
            updated_at: new Date().toISOString(),
          },
          debug: true
            ? {
                deterministic_waiting_payment_proof: true,
                product: orderData.product,
                quantity: orderData.quantity,
                city: orderData.city,
                coverage: finalState.coverage,
                total: finalState.total,
                missing: finalState.missing,
                step: finalState.step,
                confirm,
                direct_confirm: directConfirm,
              }
            : undefined,
        });
      }
    }

    // Parche 2: Desactivado after city fixed offer fijo
    if (false && !confirm && prevStep === "collecting_city" && orderData.city && orderData.locked_offer?.fixed_quantity) {
      const fixedCityResponse = deterministicAfterCityFixedOfferMessage(finalState, parsed);
      if (fixedCityResponse) {
        return res.json({
          response: fixedCityResponse,
          context: {
            ...(context || {}),
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            payment_proof_received: orderData.payment_proof_received || false,
            payment_proof_verified: orderData.payment_proof_verified || false,
            payment_holder_name: orderData.payment_holder_name || null,
            payment_amount: orderData.payment_amount || 0,
            payment_operation_number: orderData.payment_operation_number || null,
            payment_recipient_name: orderData.payment_recipient_name || null,
            payment_recipient_document: orderData.payment_recipient_document || null,
            payment_recipient_account: orderData.payment_recipient_account || null,
            payment_recipient_alias: orderData.payment_recipient_alias || null,
            payment_recipient_bank: orderData.payment_recipient_bank || null,
            payment_recipient_matched: orderData.payment_recipient_matched || false,
            payment_proof_mime: orderData.payment_proof_mime || null,
            payment_manual_review_required: orderData.payment_manual_review_required || false,
            payment_manual_review_reason: orderData.payment_manual_review_reason || null,
            step: finalState.step,
            address_optional: finalState.addressOptional,
            updated_at: new Date().toISOString(),
          },
          debug: true
            ? {
                deterministic_fixed_city_response: true,
                product: orderData.product,
                quantity: orderData.quantity,
                city: orderData.city,
                total: finalState.total,
                step: finalState.step,
                locked_offer: orderData.locked_offer,
              }
            : undefined,
        });
      }
    }

    // Parche 3: Desactivado after city coverage fijo (solo el return)
    if (
      !confirm &&
      orderData.city &&
      cityWasCapturedNow &&
      !orderData.locked_offer?.fixed_quantity
    ) {
      // V114: la ciudad recién recibida solo lleva a pedir cantidad cuando
      // todavía no existe una cantidad válida. Si el cliente ya dijo “quiero 2”,
      // se conserva esa selección y el flujo continúa con nombre/dirección.
      const quantityAlreadySelected =
        sanitizeQuantity(orderData.quantity) > 0 ||
        sanitizeQuantity(oldOrder.quantity) > 0 ||
        sanitizeQuantity(lockedOffer?.quantity) > 0;

      if (explicitQty <= 0 && !quantityAlreadySelected) {
        orderData.quantity = 0;
        finalState.order.quantity = 0;
        finalState.step = "collecting_quantity";
        finalState.missing = Array.from(new Set(["cantidad", ...(finalState.missing || []).filter((x) => x !== "cantidad")]));
      }
      const cityCoverageResponse = deterministicAfterCityCoverageMessage(finalState);
      // Parche 3: Solo desactivamos el return, pero conservamos la lógica de estado (quantity reset)
      if (false && cityCoverageResponse) {
        return res.json({
          response: cityCoverageResponse,
          context: {
            ...(context || {}),
            pending_city_confirmation: null,
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            payment_proof_received: orderData.payment_proof_received || false,
            payment_proof_verified: orderData.payment_proof_verified || false,
            payment_holder_name: orderData.payment_holder_name || null,
            payment_amount: orderData.payment_amount || 0,
            payment_operation_number: orderData.payment_operation_number || null,
            payment_recipient_name: orderData.payment_recipient_name || null,
            payment_recipient_document: orderData.payment_recipient_document || null,
            payment_recipient_account: orderData.payment_recipient_account || null,
            payment_recipient_alias: orderData.payment_recipient_alias || null,
            payment_recipient_bank: orderData.payment_recipient_bank || null,
            payment_recipient_matched: orderData.payment_recipient_matched || false,
            payment_proof_mime: orderData.payment_proof_mime || null,
            payment_manual_review_required: orderData.payment_manual_review_required || false,
            payment_manual_review_reason: orderData.payment_manual_review_reason || null,
            step: finalState.step,
            address_optional: finalState.addressOptional,
            updated_at: new Date().toISOString(),
          },
          debug: true
            ? {
                deterministic_city_coverage_response: true,
                product: orderData.product,
                quantity: orderData.quantity,
                city: orderData.city,
                coverage: finalState.coverage,
                total: finalState.total,
                missing: finalState.missing,
                step: finalState.step,
              }
            : undefined,
        });
      }
    }

    // Parche 4: Desactivado after quantity fijo
    if (!confirm && qty > 0 && orderData.city) {
      const deterministicQtyResponse = deterministicAfterQuantityMessage(finalState, parsed);
      if (false && deterministicQtyResponse) {
        return res.json({
          response: deterministicQtyResponse,
          context: {
            ...(context || {}),
            pending_city_confirmation: null,
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            step: finalState.step,
            address_optional: finalState.addressOptional,
            updated_at: new Date().toISOString(),
          },
          debug: true
            ? {
                deterministic_quantity_response: true,
                freshOrder,
                product: orderData.product,
                quantity: orderData.quantity,
                city: orderData.city,
                coverage: finalState.coverage,
                total: finalState.total,
                missing: finalState.missing,
                step: finalState.step,
                locked_offer: orderData.locked_offer,
              }
            : undefined,
        });
      }
    }

    // Parche 5: Desactivado observation ack fijo
    const deterministicObservationResponse =
      !isQuestionLikeMessage(texto)
        ? deterministicObservationAckMessage(finalState, parsed, observationPatch)
        : "";

    if (false && !confirm && deterministicObservationResponse) {
      return res.json({
        response: deterministicObservationResponse,
        context: {
          ...(context || {}),
          current_product: orderData.product || null,
          last_topic: orderData.product || context?.last_topic || null,
          last_ad_offer: orderData.locked_offer || null,
          order_data: orderData,
          order_id: orderData.order_id || null,
          payment_proof_received: orderData.payment_proof_received || false,
            payment_proof_verified: orderData.payment_proof_verified || false,
            payment_holder_name: orderData.payment_holder_name || null,
            payment_amount: orderData.payment_amount || 0,
            payment_operation_number: orderData.payment_operation_number || null,
            payment_recipient_name: orderData.payment_recipient_name || null,
            payment_recipient_document: orderData.payment_recipient_document || null,
            payment_recipient_account: orderData.payment_recipient_account || null,
            payment_recipient_alias: orderData.payment_recipient_alias || null,
            payment_recipient_bank: orderData.payment_recipient_bank || null,
            payment_recipient_matched: orderData.payment_recipient_matched || false,
            payment_proof_mime: orderData.payment_proof_mime || null,
            payment_manual_review_required: orderData.payment_manual_review_required || false,
            payment_manual_review_reason: orderData.payment_manual_review_reason || null,
          step: finalState.step,
          address_optional: finalState.addressOptional,
          updated_at: new Date().toISOString(),
        },
        debug: true
          ? {
              deterministic_observation_response: true,
              product: orderData.product,
              quantity: orderData.quantity,
              city: orderData.city,
              coverage: finalState.coverage,
              total: finalState.total,
              missing: finalState.missing,
              step: finalState.step,
              observation: orderData.observation || null,
              payment_note: orderData.payment_note || null,
              preferred_delivery_date: orderData.preferred_delivery_date || null,
              preferred_delivery_time: orderData.preferred_delivery_time || null,
            }
          : undefined,
      });
    }

    const currentMessageIsQuestionBeforeAI = isQuestionLikeMessage(texto);
    const currentMessageHasQuantityBeforeAI = extractQuantity(texto) > 0;
    const currentMessageIsAcknowledgementBeforeAI = isShortAcknowledgement(texto);
    const explicitProductInterestNow = hasExplicitProductInterestPhrase(texto);
    const productMentionNow = !!detectProduct(texto, parsed, "");

    // ✅ FIX V46: verificar si el copy ya se envió antes en esta conversación
    const copyAlreadySentInConversation = wasCopyAlreadySentInThisConversation(history, finalState.productInfo);

    // Parche 6: Desactivado respuesta fija de precio ("precio solo")
    if (
      false &&
      isPriceQuery(texto) &&
      copyAlreadySentInConversation &&
      finalState.productInfo
    ) {
      const priceOnlyResponse = buildPriceOnlyResponse(finalState, templatePricing);

      if (priceOnlyResponse) {
        return res.json({
          response: priceOnlyResponse,
          context: {
            ...(context || {}),
            current_product: orderData.product || null,
            last_topic: orderData.product || context?.last_topic || null,
            last_ad_offer: orderData.locked_offer || null,
            order_data: orderData,
            order_id: orderData.order_id || null,
            payment_proof_received: orderData.payment_proof_received || false,
            payment_proof_verified: orderData.payment_proof_verified || false,
            payment_holder_name: orderData.payment_holder_name || null,
            payment_amount: orderData.payment_amount || 0,
            payment_operation_number: orderData.payment_operation_number || null,
            payment_recipient_name: orderData.payment_recipient_name || null,
            payment_recipient_document: orderData.payment_recipient_document || null,
            payment_recipient_account: orderData.payment_recipient_account || null,
            payment_recipient_alias: orderData.payment_recipient_alias || null,
            payment_recipient_bank: orderData.payment_recipient_bank || null,
            payment_recipient_matched: orderData.payment_recipient_matched || false,
            payment_proof_mime: orderData.payment_proof_mime || null,
            payment_manual_review_required: orderData.payment_manual_review_required || false,
            payment_manual_review_reason: orderData.payment_manual_review_reason || null,
            step: finalState.step,
            address_optional: finalState.addressOptional,
            updated_at: new Date().toISOString(),
          },
          debug: true
            ? {
                deterministic_price_response: true,
                gemini_skipped: true,
                copy_already_sent: true,
                product: orderData.product,
                city: orderData.city,
                quantity: orderData.quantity,
                step: finalState.step,
              }
            : undefined,
        });
      }
    }

    const shouldPresentExactCatalogCopy = Boolean(
      clean(finalState.productInfo?.salesCopy || "") &&
      !orderData.city &&
      !copyAlreadySentInConversation && // ← NUEVA CONDICIÓN
      (!currentMessageIsQuestionBeforeAI || productMentionNow) &&
      !currentMessageHasQuantityBeforeAI &&
      !currentMessageIsAcknowledgementBeforeAI &&
      (
        freshOrder ||
        newTemplateSignal.isNew ||
        !!currentTemplatePricing ||
        (explicitProductInterestNow && !copyAlreadySentInConversation) ||
        productMentionNow ||
        (!!productMentionNow && !context?.current_product)
      )
    );

    if (false && shouldPresentExactCatalogCopy) {
      const exactCopyResponse = buildFullProductCopyResponse(finalState, templatePricing);
      const exactImages = finalState.productInfo?.images?.length
        ? finalState.productInfo.images.slice(0, 3)
        : undefined;

      return res.json({
        response: exactCopyResponse,
        follow_up_response: buildFriendlyCityQuestion(),
        media_urls: exactImages,
        context: {
          ...(context || {}),
          current_product: orderData.product || null,
          last_topic: orderData.product || context?.last_topic || null,
          last_ad_offer: orderData.locked_offer || null,
          order_data: orderData,
          order_id: orderData.order_id || null,
          payment_proof_received: orderData.payment_proof_received || false,
            payment_proof_verified: orderData.payment_proof_verified || false,
            payment_holder_name: orderData.payment_holder_name || null,
            payment_amount: orderData.payment_amount || 0,
            payment_operation_number: orderData.payment_operation_number || null,
            payment_recipient_name: orderData.payment_recipient_name || null,
            payment_recipient_document: orderData.payment_recipient_document || null,
            payment_recipient_account: orderData.payment_recipient_account || null,
            payment_recipient_alias: orderData.payment_recipient_alias || null,
            payment_recipient_bank: orderData.payment_recipient_bank || null,
            payment_recipient_matched: orderData.payment_recipient_matched || false,
            payment_proof_mime: orderData.payment_proof_mime || null,
            payment_manual_review_required: orderData.payment_manual_review_required || false,
            payment_manual_review_reason: orderData.payment_manual_review_reason || null,
          step: finalState.step,
          address_optional: finalState.addressOptional,
          updated_at: new Date().toISOString(),
        },
        debug: true
          ? {
              exact_catalog_copy_backend: true,
              gemini_skipped: true,
              product: orderData.product,
              city: orderData.city,
              step: finalState.step,
              copy_already_sent: copyAlreadySentInConversation,
            }
          : undefined,
      });
    }

    const copyAlreadySent = wasProductCopyAlreadySent(history, finalState.productInfo);
    const system = buildSalesSystemPrompt(parsed, finalState, templatePricing, copyAlreadySent);

    const contents = (history || [])
      .slice(-12)
      .filter((h: any) => clean(h?.content))
      .map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: clean(h.content) }],
      }));

    const userPayload = `
Mensaje del cliente:
${texto || "(mensaje sin texto)"}

INTENCIÓN TÉCNICA DETECTADA:
- Solicita catálogo: ${catalogRequestedNow ? "sí" : "no"}

Respondé ahora como vendedor. Seguí la instrucción obligatoria. No inventes ciudad ni datos.
Toda la respuesta visible debe ser escrita por vos; no dependas de plantillas del backend.
`.trim();

    contents.push({
      role: "user",
      parts: [{ text: userPayload }],
    });

    let aiResponse = "";
    try {
      aiResponse = await callGemini({
        apiKey,
        model,
        system,
        contents,
        temperature: iaConfig.temperature ?? 0.55,
        maxTokens: Math.max(iaConfig.max_tokens ?? 0, 2048),
      });
    } catch (error) {
      console.error("⚠️ Gemini falló; se usa respuesta determinística:", error);
    }

    if (!aiResponse || aiResponse === "__GEMINI_QUOTA_EXCEEDED__") {
      // V116: jamás enviar una respuesta fija que pueda revelar automatización
      // o provocar loops. El canal debe reintentar la generación con IA.
      return res.status(503).json({
        response: "",
        retryable: true,
        context: {
          ...(context || {}),
          order_data: orderData,
          order_id: orderData.order_id || null,
          step: finalState.step,
          updated_at: new Date().toISOString(),
        },
        debug: { ai_response_required: true },
      });
    }

    // Parche 8: Eliminar pisada de Gemini con respuestas fijas (desactivado con false &&)
    const deterministicBusinessResponse = buildDeterministicBusinessQuestionResponse(texto, finalState);
    if (false && deterministicBusinessResponse) {
      aiResponse = deterministicBusinessResponse;
    }

    const deterministicAcknowledgementResponse = buildDeterministicAcknowledgementResponse(texto, finalState);
    if (false && deterministicAcknowledgementResponse) {
      aiResponse = deterministicAcknowledgementResponse;
    }

    // V97: protege cobertura y evita presentar el total del producto como costo del envío.
    aiResponse = sanitizeCoverageAndShippingResponse(aiResponse, finalState);

    let followUpResponse = "";

    if (
      false &&
      explicitProductInterestNow &&
      !isPriceQuery(texto) &&
      !copyAlreadySentInConversation &&
      clean(finalState.productInfo?.salesCopy || "") &&
      !currentMessageIsQuestionBeforeAI
    ) {
      aiResponse = buildFullProductCopyResponse(finalState, null);
      followUpResponse = !orderData.city ? buildFriendlyCityQuestion() : "";
      templatePricing = null;
    }

    const currentMessageIsQuestion = isQuestionLikeMessage(texto);
    const currentMessageHasQuantity = extractQuantity(texto) > 0;

    let imagesToSend: string[] | undefined = undefined;
    
    const productoPorClave = encontrarProductoPorPalabraClave(texto, parsed.products);
    
    // V76: las imágenes se envían solamente durante una presentación nueva.
    // Respuestas como "QUIERO", "sí", consultas de precio o continuaciones
    // no deben repetir la imagen que ya apareció con el copy.
    if (
      !orderData.city &&
      !copyAlreadySentInConversation &&
      !currentMessageIsAcknowledgementBeforeAI &&
      (!currentMessageIsQuestion || productMentionNow) &&
      !currentMessageHasQuantity
    ) {
      if (productoPorClave && productoPorClave.images?.length) {
        imagesToSend = productoPorClave.images.slice(0, 3);
        console.log(`📸 Enviando ${imagesToSend.length} imagen(es) para "${productoPorClave.palabra_clave || productoPorClave.canonical}"`);
      } else if (finalState.productInfo?.images?.length) {
        imagesToSend = finalState.productInfo.images.slice(0, 3);
        console.log(`📸 Enviando ${imagesToSend.length} imagen(es) para "${finalState.productInfo.canonical}"`);
      }
    }

    return res.json({
      response: postProcessResponse(aiResponse),
      follow_up_response: followUpResponse || undefined,
      media_urls: imagesToSend,
      context: {
        ...(context || {}),
        current_product: orderData.product || null,
        last_topic: orderData.product || context?.last_topic || null,
        last_ad_offer: orderData.locked_offer || null,
        order_data: orderData,
        order_id: orderData.order_id || null,
        payment_proof_received: (orderData as any).payment_proof_received || false,
        step: confirm ? "pedido_confirmado" : finalState.step,
        updated_at: new Date().toISOString(),
      },
      debug: true
        ? {
            freshOrder,
            reset_because_new_chat: resetBecauseNewChat,
            parsed_products: parsed.products.length,
            parsed_cities: parsed.cities.length,
            product: orderData.product,
            quantity: orderData.quantity,
            city: orderData.city,
            coverage: finalState.coverage,
            total: finalState.total,
            missing: finalState.missing,
            step: finalState.step,
            confirm,
            direct_confirm: directConfirm,
            locked_offer: orderData.locked_offer,
            productFromMessageInitial,
            promoResponse,
            images_sent: imagesToSend?.length || 0,
            follow_up_response: followUpResponse || null,
            producto_por_clave: productoPorClave?.palabra_clave || null,
            copy_already_sent_in_conversation: copyAlreadySentInConversation,
          }
        : undefined,
    });
  } catch (error: any) {
    console.error("❌ chat-ia-vendedor-v3:", error);

    const safeContext = req.body?.context || {};
    const safeOrder = safeContext?.order_data || {};
    const safeMessage = clean(req.body?.message || "");

    return res.status(503).json({
      response: "",
      retryable: true,
      context: {
        ...safeContext,
        order_data: safeOrder,
        step: safeContext?.step || "selling",
        updated_at: new Date().toISOString(),
      },
      debug: {
        recovered_from_internal_error: true,
        ai_response_required: true,
        error: error?.message || "Error interno",
      },
    });
  }
}
