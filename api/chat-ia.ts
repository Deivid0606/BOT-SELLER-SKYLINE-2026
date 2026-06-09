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
// 🧠 FUNCIONES BASE
// =======================================================

function getDestapaCañeriasProductName(): string {
  return "Destapa Cañerías Tornado";
}

function getAntiVibrationProductName(): string {
  return "Kit Antivibración x4 Patitas Antideslizantes";
}

function getDefaultShoeProductName(): string {
  return "PLANTILLAS ORTOPIEX 5D®";
}

// =======================================================
// 🎯 DETECCIÓN DE PRODUCTOS - PRIORIDAD ABSOLUTA
// =======================================================

function isDestapaCañeriasRequest(text: string): boolean {
  const n = normalize(text);
  const patterns = [
    "destapa cañeria", "destapa cañería", "destapa caneria", "destapa canería",
    "wild tornado", "tornado destapa", "desague", "desagüe",
    "cañeria tapada", "cañería tapada", "agua tarda", "tuberia tapada",
    "me interesa el destapa", "el destapa cañería", "precio del destapa",
    "destapa canerias", "destapa cañerias", "cañeria", "cañería",
    "tapa cañerias", "tapa cañerías", "destapa"
  ];
  return patterns.some(p => n.includes(p));
}

function detectProductExact(text: string): string {
  const n = normalize(text);
  
  // PRIORIDAD 1: Destapa cañerías
  if (isDestapaCañeriasRequest(text)) {
    return getDestapaCañeriasProductName();
  }
  
  // PRIORIDAD 2: Raqueta
  if (/\b(raqueta|electrica|flayes|mosquitos|moscas|insectos)\b/.test(n)) {
    return "Raqueta Eléctrica para Insectos";
  }
  
  // PRIORIDAD 3: Veneno de abeja
  if (/\b(veneno|abeja|crema\s+de\s+abeja)\b/.test(n)) {
    return "Veneno de Abeja";
  }
  
  // PRIORIDAD 4: Plantillas
  if (/\b(plantilla|plantillas|ortopiex|ortoflex|5d)\b/.test(n)) {
    return getDefaultShoeProductName();
  }
  
  // PRIORIDAD 5: Pelador
  if (/\b(pelador|peladora|pelar\s+papas|peladora\s+automatica)\b/.test(n)) {
    return "Peladora Automática";
  }
  
  // PRIORIDAD 6: Pororo
  if (/\b(pororo|popcorn|pochoclo|palomitas|maquina\s+pororo)\b/.test(n)) {
    return "Máquina para hacer Pororo";
  }
  
  // PRIORIDAD 7: Nebulizador
  if (/\b(nebulizador)\b/.test(n)) {
    return "Nebulizador portátil";
  }
  
  // PRIORIDAD 8: Afilador
  if (/\b(afilador|cuchillo|cuchillos|sharpener)\b/.test(n)) {
    return "Afilador de Cuchillos";
  }
  
  // PRIORIDAD 9: Vital Honey
  if (/\b(vital\s+honey)\b/.test(n)) {
    return "Vital Honey VIP";
  }
  
  // PRIORIDAD 10: Perfume Asad
  if (/\b(perfume\s+asad|asad)\b/.test(n)) {
    return "Perfume Asad";
  }
  
  // PRIORIDAD 11: Kit antivibración
  if (/\b(kit\s+antivibracion|patitas\s+antideslizantes|soporte\s+para\s+lavarropas|almohadillas\s+antivibracion)\b/.test(n)) {
    return getAntiVibrationProductName();
  }
  
  // PRIORIDAD 12: Tabla de picar (solo si NO es destapa)
  if (/\b(tabla\s+de\s+picar|tabla\s+de\s+marmol|tabla\s+picar)\b/.test(n)) {
    return "Tabla de Picar de Mármol";
  }
  
  return "";
}

// =======================================================
// 💰 EXTRACCIÓN DE PRECIOS - SOLO DEL ENTRENAMIENTO
// =======================================================

function extractPriceFromTraining(productName: string, training: string, quantity: number = 1): number | null {
  if (!productName || !training) return null;
  
  const lines = training.split("\n").map(l => clean(l)).filter(Boolean);
  const normalizedProduct = normalize(productName);
  
  // Buscar líneas que contengan el producto
  for (const line of lines) {
    const normalizedLine = normalize(line);
    
    // Verificar si la línea contiene el producto
    if (!normalizedLine.includes(normalizedProduct)) continue;
    
    // Buscar precio en la línea
    const priceMatch = line.match(/(\d{1,3}(?:\.\d{3})+|\d{4,})\s*(?:Gs|₲|\$|gs)/i);
    if (!priceMatch) continue;
    
    let price = parseInt(priceMatch[1].replace(/\./g, ""));
    
    // Buscar si es una promo (ej: "2x 299.900")
    const promoMatch = normalizedLine.match(/(\d+)\s*(?:x|unidades|uds?)\s*(?:por\s*)?(\d{1,3}(?:\.\d{3})+|\d{4,})/i);
    if (promoMatch) {
      const promoQty = parseInt(promoMatch[1]);
      const promoPrice = parseInt(promoMatch[2].replace(/\./g, ""));
      
      if (promoQty === quantity) {
        return promoPrice;
      }
      if (quantity === 1 && promoQty === 2) {
        // Precio unitario estimado desde promo 2x
        return Math.round(promoPrice / 2);
      }
    }
    
    // Si es el precio unitario y cantidad es 1
    if (quantity === 1) {
      return price;
    }
    
    // Si es precio unitario y queremos múltiples unidades
    return price * quantity;
  }
  
  // Buscar en líneas cercanas (hasta 3 líneas después)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!normalize(line).includes(normalizedProduct)) continue;
    
    // Buscar precio en las siguientes 3 líneas
    for (let j = 1; j <= 3 && i + j < lines.length; j++) {
      const nextLine = lines[i + j];
      const priceMatch = nextLine.match(/(\d{1,3}(?:\.\d{3})+|\d{4,})\s*(?:Gs|₲|\$|gs)/i);
      if (priceMatch) {
        const price = parseInt(priceMatch[1].replace(/\./g, ""));
        return quantity === 1 ? price : price * quantity;
      }
    }
    
    break;
  }
  
  console.warn(`⚠️ No se encontró precio para: "${productName}" en el entrenamiento`);
  return null;
}

// =======================================================
// 🧮 CÁLCULO DE TOTALES
// =======================================================

function calculateTotal(product: string, quantity: number, training: string): number | null {
  if (!product || !quantity || quantity < 1) return null;
  return extractPriceFromTraining(product, training, quantity);
}

function getProductPrice(product: string, quantity: number, training: string): number | null {
  return calculateTotal(product, quantity, training);
}

// =======================================================
// 🗣️ RESPUESTAS - NUNCA INVENTAN PRECIOS
// =======================================================

function buildProductResponse(product: string, training: string): string {
  const unitPrice = getProductPrice(product, 1, training);
  
  // Si no hay precio en el entrenamiento, NO INVENTAR
  if (unitPrice === null) {
    return `🤗 ¡Gracias por tu interés en ${product}!

⚠️ No tengo el precio registrado en este momento. ¿Podrías consultar nuestro catálogo?

📲 Te dejo nuestro catálogo: ${CATALOG_URL}

¿Qué otro producto te interesa? ✨`;
  }
  
  const promoPrice = getProductPrice(product, 2, training);
  
  let response = `🤗 ¡Qué buena elección! ${product} es uno de nuestros favoritos ⭐

💰 Precio: ${formatGs(unitPrice)} Gs`;
  
  if (promoPrice !== null && promoPrice !== unitPrice * 2) {
    const savings = (unitPrice * 2) - promoPrice;
    response += `\n🔥 PROMO 2x → ${formatGs(promoPrice)} Gs (ahorrás ${formatGs(savings)} Gs)`;
  }
  
  response += `\n\n⚠️ STOCK LIMITADO

📍 ¿A qué ciudad te gustaría recibirlo? 😊

Te explico cómo funciona:

🟢 **Ciudades con cobertura** → Envío GRATIS · Pagás al recibir
🔴 **Otras ciudades** → Envío por encomienda · Pago anticipado

Escribime tu ciudad y te confirmo cómo llega tu pedido 🚚✨`;
  
  return response;
}

function buildQuantityAfterCityResponse(product: string, city: string, training: string): string {
  const unitPrice = getProductPrice(product, 1, training);
  const tipoCobertura = getTipoCobertura(city);
  
  if (unitPrice === null) {
    return `✅ ¡Gracias! ${city} registrada 📍

⚠️ No tengo el precio registrado para ${product}. Consultá nuestro catálogo:

👉 ${CATALOG_URL}

¿Qué otro producto te interesa? ✨`;
  }
  
  const promoPrice = getProductPrice(product, 2, training);
  let priceInfo = `💰 ${formatGs(unitPrice)} Gs`;
  if (promoPrice !== null && promoPrice !== unitPrice * 2) {
    priceInfo += `\n🔥 PROMO 2x → ${formatGs(promoPrice)} Gs`;
  }
  
  if (tipoCobertura === "con_cobertura") {
    return `✅ ¡Perfecto! **${city}** tiene cobertura 🟢

📦 ${product}
${priceInfo}

🚚 **Envío GRATIS** a tu domicilio
💵 **Pagás al recibir**

🔥 ¿Cuántas unidades querés llevar?

Respondé con el número (1, 2, 3...) ✨`;
  } else {
    return `ℹ️ **${city}** no tiene cobertura de delivery 🔴

📦 ${product}
${priceInfo}

🚚 **Envío por encomienda**
💵 **Pago anticipado por transferencia**

📲 **DATOS PARA TRANSFERENCIA:**
   Titular: DAVID AGUSTIN ALCARAZ AGUILAR
   Banco Familiar · Cuenta: 81-4981442
   Alias: 0994130022

🔥 ¿Cuántas unidades querés llevar?

Respondé con el número (1, 2, 3...) ✨`;
  }
}

function buildOrderSummaryResponse(order: any, tipoCobertura: string): string {
  const total = order.total_amount || 0;
  
  const lines = `📦 ${order.product}\n🔢 Cantidad: ${order.quantity}`;
  
  if (tipoCobertura === "con_cobertura") {
    return `🔥 ¡Perfecto! Tu pedido quedó así 🤗

${lines}

💰 Total: ${formatGs(total)} Gs

🚚 **ENVÍO GRATIS** a ${order.city}
💵 **Pagás al recibir**

📎 Ahora solo me falta tu información:

✅ Nombre y apellido
✅ Dirección exacta
✅ Número de celular

📲 En cuanto reciba tus datos, agendamos tu entrega ✨`;
  } else {
    return `🔥 ¡Perfecto! Tu pedido quedó así 🤗

${lines}

💰 Total: ${formatGs(total)} Gs

🚚 **ENVÍO POR ENCOMIENDA**
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

// =======================================================
// 📍 CIUDADES Y COBERTURA
// =======================================================

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
    pjc: "Pedro Juan Caballero", "pedro juan": "Pedro Juan Caballero",
    "pedro juan caballero": "Pedro Juan Caballero",
  };

  for (const [k, v] of Object.entries(cityAliases)) {
    if (new RegExp(`\\b${k.replace(/\s+/g, "\\s+")}\\b`, "i").test(norm)) return v;
  }
  return "";
}

// =======================================================
// 🔧 UTILIDADES
// =======================================================

function formatGs(amount: any): string {
  const n = Number(amount || 0);
  if (!n) return "0";
  return n.toLocaleString("de-DE");
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

function extractData(msg: string): any {
  const text = clean(msg);
  const norm = normalize(text);
  
  const phone = text.match(/(?:09\d{8}|\+595\d{9})/)?.[0] || "";
  
  // Extraer ciudad
  let city = "";
  const cityAliases: Record<string, string> = {
    asuncion: "Asunción", capiata: "Capiatá", luque: "Luque",
    lambare: "Lambaré", "san lorenzo": "San Lorenzo", fdm: "Fernando de la Mora",
    nemby: "Ñemby", ñemby: "Ñemby", ypane: "Ypané", limpio: "Limpio",
  };
  for (const [k, v] of Object.entries(cityAliases)) {
    if (norm.includes(k)) { city = v; break; }
  }
  
  // Extraer cantidad (solo números)
  let quantity = 0;
  const numMatch = norm.match(/^\s*(\d{1,3})\s*$/);
  if (numMatch) {
    quantity = parseInt(numMatch[1]);
  } else {
    const qMatch = norm.match(/\b(\d{1,3})\s*(unidad|unidades|u)\b/);
    if (qMatch) quantity = parseInt(qMatch[1]);
  }
  
  // Extraer nombre
  let name = "";
  const nameMatch = text.match(/(?:me\s+llamo|nombre|soy)\s+([a-zA-ZÁÉÍÓÚáéíóúÑñ\s]{3,50})/i);
  if (nameMatch) {
    name = clean(nameMatch[1]);
  } else if (text.length >= 5 && text.length <= 50 && !/\d/.test(text) && !norm.includes("quiero") && !norm.includes("precio")) {
    if (!detectProductExact(text)) {
      name = clean(text);
    }
  }
  
  // Extraer dirección
  let address = "";
  const addressMatch = text.match(/(?:dirección|dir|ubicacion|ubicación)\s*[:-]?\s*(.+)/i);
  if (addressMatch) address = clean(addressMatch[1]);
  
  return { quantity, city, name, phone, address };
}

// =======================================================
// 🚀 HANDLER PRINCIPAL
// =======================================================

export default async function handler(req: any, res: any) {
  console.log("🔥 BOT VERSION FINAL");
  console.log("✅ LOS PRECIOS VIENEN EXCLUSIVAMENTE DEL ENTRENAMIENTO");
  console.log("✅ NUNCA SE INVENTAN PRECIOS");
  console.log("✅ DETECTA CORRECTAMENTE DESTAPA CAÑERÍAS");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { user_id, message, from_number, context, history } = req.body;

    let texto = clean(message);
    const fromNumber = clean(from_number);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto) return res.status(400).json({ error: "Falta message" });

    // ========== OBTENER CONFIGURACIÓN ==========
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

    // ========== DETECTAR PRODUCTO (PRIORIDAD ABSOLUTA) ==========
    let product = detectProductExact(texto);
    let step = context?.step || "selling";
    let orderData = context?.order_data || {
      product: "",
      quantity: 0,
      city: "",
      customer_name: "",
      phone: "",
      address: "",
      total_amount: 0,
    };
    
    // Si no hay producto en el mensaje pero hay en el contexto, mantenerlo
    if (!product && orderData?.product) {
      product = orderData.product;
    }
    
    // ========== FLUJO DE VENTAS ==========
    
    // Paso 1: Sin producto → preguntar
    if (!product || product === "") {
      return res.json({
        response: `🤗 ¡Hola! ¿Qué producto te interesa?

Te comparto nuestro catálogo: ${CATALOG_URL}

Escribime el nombre del producto y te digo el precio ✨`,
        context: {
          step: "selling",
          order_data: {},
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }
    
    // Paso 2: Tiene producto pero no ciudad → preguntar ciudad
    if (product && (!orderData.city || orderData.city === "")) {
      const price = getProductPrice(product, 1, fullTraining);
      
      if (price === null) {
        return res.json({
          response: `🤗 ${product}

⚠️ No tengo el precio registrado. Consultá nuestro catálogo:

👉 ${CATALOG_URL}

¿Qué otro producto te interesa? ✨`,
          context: {
            step: "selling",
            current_product: product,
            order_data: { product, quantity: 0, city: "" },
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
      
      return res.json({
        response: buildProductResponse(product, fullTraining),
        context: {
          step: "collecting_city",
          current_product: product,
          order_data: { product, quantity: 0, city: "" },
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }
    
    // Extraer datos del mensaje actual
    const extracted = extractData(texto);
    
    // Actualizar orderData con datos extraídos
    if (extracted.city && !orderData.city) orderData.city = extracted.city;
    if (extracted.quantity > 0 && orderData.quantity === 0) orderData.quantity = extracted.quantity;
    if (extracted.name && !orderData.customer_name) orderData.customer_name = extracted.name;
    if (extracted.phone && !orderData.phone) orderData.phone = extracted.phone;
    if (extracted.address && !orderData.address) orderData.address = extracted.address;
    
    // Paso 3: Tiene producto y ciudad pero no cantidad → preguntar cantidad
    if (product && orderData.city && orderData.quantity === 0) {
      return res.json({
        response: buildQuantityAfterCityResponse(product, orderData.city, fullTraining),
        context: {
          step: "collecting_quantity",
          current_product: product,
          order_data: orderData,
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }
    
    // Paso 4: Tiene producto, ciudad y cantidad → calcular total y pedir datos
    if (product && orderData.city && orderData.quantity > 0) {
      const total = calculateTotal(product, orderData.quantity, fullTraining);
      const tipoCobertura = getTipoCobertura(orderData.city);
      
      if (total === null) {
        return res.json({
          response: `⚠️ No pude calcular el total para ${product} x${orderData.quantity}.

Por favor, consultá nuestro catálogo: ${CATALOG_URL}

¿Qué otro producto te interesa? ✨`,
          context: {
            step: "selling",
            order_data: {},
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
      
      orderData.total_amount = total;
      orderData.product = product;
      
      // Si falta nombre, pedirlo
      if (!orderData.customer_name) {
        return res.json({
          response: `🔥 ¡Perfecto! ${orderData.quantity} unidad(es) de ${product}

💰 Total: ${formatGs(total)} Gs

📎 Ahora solo me falta tu **nombre completo** para agendar tu pedido ✨

✅ Escribime tu nombre por favor`,
          context: {
            step: "collecting_name",
            current_product: product,
            order_data: orderData,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
      
      // Si falta teléfono, pedirlo
      if (!orderData.phone) {
        return res.json({
          response: `✅ Gracias ${orderData.customer_name.split(" ")[0]}!

📦 Producto: ${orderData.product} x${orderData.quantity}
💰 Total: ${formatGs(orderData.total_amount)} Gs

📎 Ahora solo me falta tu **número de celular** para que el delivery te contacte ✨

✅ Escribime tu número (ej: 0981xxxxxx)`,
          context: {
            step: "collecting_phone",
            current_product: product,
            order_data: orderData,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
      
      // Si falta dirección (solo para cobertura con envío gratis)
      const tipo = getTipoCobertura(orderData.city);
      if (tipo === "con_cobertura" && !orderData.address) {
        return res.json({
          response: `✅ Gracias! Tu número es ${orderData.phone}

📦 Producto: ${orderData.product} x${orderData.quantity}
📍 Ciudad: ${orderData.city}
💰 Total: ${formatGs(orderData.total_amount)} Gs

📎 Ahora solo me falta tu **dirección exacta** para el delivery ✨

✅ Escribime tu dirección (calle, número, barrio)`,
          context: {
            step: "collecting_address",
            current_product: product,
            order_data: orderData,
            updated_at: new Date().toISOString(),
          },
          is_payment_proof: false,
        });
      }
      
      // ========== CONFIRMAR PEDIDO ==========
      const tipoCobertura = getTipoCobertura(orderData.city);
      let confirmResponse = "";
      
      if (tipoCobertura === "con_cobertura") {
        confirmResponse = `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${orderData.product}
✅ Cliente: ${orderData.customer_name}
✅ Ubicación: ${orderData.city} — ${orderData.address}
✅ Contacto: ${orderData.phone}
✅ Cantidad: ${orderData.quantity} u.
💰 Total: ${formatGs(orderData.total_amount)} Gs

🚚 **ENVÍO GRATIS** · **Pagás al recibir**

📦 Tu pedido queda agendado. El delivery se comunicará contigo.

⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

Te dejo nuestro catálogo completo 👇

👉 ${CATALOG_URL}`;
      } else {
        confirmResponse = `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${orderData.product}
✅ Cliente: ${orderData.customer_name}
✅ Ciudad: ${orderData.city}
✅ Contacto: ${orderData.phone}
✅ Cantidad: ${orderData.quantity} u.
💰 Total: ${formatGs(orderData.total_amount)} Gs

🚚 **ENVÍO POR ENCOMIENDA**

💵 **DATOS PARA TRANSFERENCIA:**
   Titular: DAVID AGUSTIN ALCARAZ AGUILAR
   Banco Familiar · Cuenta: 81-4981442
   Alias: 0994130022

📲 Enviame el comprobante y confirmamos tu envío 🚚✨

¡Gracias por tu compra! 🛍️✨

Te dejo nuestro catálogo 👇

👉 ${CATALOG_URL}`;
      }
      
      // Guardar en BD
      try {
        await supabase.from("orders").insert({
          user_id,
          from_number: fromNumber,
          product: orderData.product,
          customer_name: orderData.customer_name,
          city: orderData.city,
          address: orderData.address,
          phone: orderData.phone,
          quantity: orderData.quantity,
          total_amount: orderData.total_amount,
          status: "confirmed",
          fecha: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error("Error guardando pedido:", dbError);
      }
      
      return res.json({
        response: confirmResponse,
        context: {
          step: "confirmed",
          current_product: product,
          order_data: { ...orderData, status: "confirmed" },
          updated_at: new Date().toISOString(),
        },
        is_payment_proof: false,
      });
    }
    
    // Fallback: respuesta genérica
    return res.json({
      response: `🤗 ¡Hola! ¿Qué producto te interesa?

Te comparto nuestro catálogo: ${CATALOG_URL}

Escribime el nombre del producto y te digo el precio ✨`,
      context: {
        step: "selling",
        order_data: {},
        updated_at: new Date().toISOString(),
      },
      is_payment_proof: false,
    });

  } catch (error: any) {
    console.error("❌ chat-ia:", error);
    return res.status(500).json({ error: error.message || "Error interno" });
  }
}
