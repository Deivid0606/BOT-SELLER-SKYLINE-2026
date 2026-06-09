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
// 🎯 DETECCIÓN DE PRODUCTOS (ORDEN CRÍTICO)
// =======================================================

function detectProduct(text: string): string {
  const n = normalize(text);
  
  // 1. Destapa cañerías (prioridad máxima)
  if (n.includes("destapa") || n.includes("cañeria") || n.includes("cañería") || 
      n.includes("tornado") || n.includes("desague") || n.includes("desagüe") ||
      n.includes("agua tarda") || n.includes("tuberia tapada") || n.includes("cañería tapada")) {
    return "Destapa Cañerías Tornado";
  }
  
  // 2. Raqueta
  if (n.includes("raqueta") || n.includes("electrica") || n.includes("flayes") || n.includes("mosquitos")) {
    return "Raqueta Eléctrica para Insectos";
  }
  
  // 3. Veneno de abeja
  if (n.includes("veneno") || n.includes("abeja") || n.includes("crema de abeja")) {
    return "Veneno de Abeja";
  }
  
  // 4. Plantillas
  if (n.includes("plantilla") || n.includes("ortopiex")) {
    return "PLANTILLAS ORTOPIEX 5D®";
  }
  
  // 5. Peladora
  if (n.includes("pelador") || n.includes("peladora") || n.includes("pelar papas")) {
    return "Peladora Automática";
  }
  
  // 6. Pororo
  if (n.includes("pororo") || n.includes("popcorn") || n.includes("pochoclo")) {
    return "Máquina para hacer Pororo";
  }
  
  // 7. Tabla de mármol
  if (n.includes("tabla") && (n.includes("picar") || n.includes("marmol"))) {
    return "Tabla de Picar de Mármol";
  }
  
  // 8. Afilador
  if (n.includes("afilador") || n.includes("cuchillo")) {
    return "Afilador de Cuchillos";
  }
  
  // 9. Vital Honey
  if (n.includes("vital honey")) {
    return "Vital Honey VIP";
  }
  
  // 10. Perfume Asad
  if (n.includes("perfume asad") || n.includes("asad")) {
    return "Perfume Asad";
  }
  
  // 11. Kit antivibración
  if (n.includes("antivibracion") || n.includes("patitas") || n.includes("lavarropas")) {
    return "Kit Antivibración x4 Patitas Antideslizantes";
  }
  
  return "";
}

// =======================================================
// 💰 EXTRACCIÓN DE PRECIO DEL ENTRENAMIENTO
// =======================================================

function extractPriceFromTraining(productName: string, training: string): number | null {
  if (!productName || !training) return null;
  
  const lines = training.split("\n").map(l => clean(l)).filter(Boolean);
  const normalizedProduct = normalize(productName);
  
  for (const line of lines) {
    const normalizedLine = normalize(line);
    
    if (!normalizedLine.includes(normalizedProduct)) continue;
    
    const priceMatch = line.match(/(\d{1,3}(?:\.\d{3})+|\d{4,})/);
    if (priceMatch) {
      const price = parseInt(priceMatch[1].replace(/\./g, ""));
      if (price > 10000 && price < 1000000) {
        return price;
      }
    }
  }
  
  // Valores por defecto SOLO si no se encuentra en entrenamiento
  const defaultPrices: Record<string, number> = {
    "Destapa Cañerías Tornado": 159900,
    "Raqueta Eléctrica para Insectos": 89000,
    "Veneno de Abeja": 129900,
    "PLANTILLAS ORTOPIEX 5D®": 149900,
    "Peladora Automática": 179900,
    "Máquina para hacer Pororo": 249900,
    "Tabla de Picar de Mármol": 169900,
    "Afilador de Cuchillos": 99900,
    "Vital Honey VIP": 199900,
    "Perfume Asad": 159900,
    "Kit Antivibración x4 Patitas Antideslizantes": 119900,
  };
  
  return defaultPrices[productName] || null;
}

// =======================================================
// 📍 CIUDADES Y COBERTURA
// =======================================================

function extractCity(text: string): string {
  const n = normalize(text);
  
  if (n.includes("asuncion")) return "Asunción";
  if (n.includes("capiata") || n.includes("capiatá")) return "Capiatá";
  if (n.includes("luque")) return "Luque";
  if (n.includes("lambare") || n.includes("lambaré")) return "Lambaré";
  if (n.includes("san lorenzo")) return "San Lorenzo";
  if (n.includes("fernando de la mora") || n.includes("fdm")) return "Fernando de la Mora";
  if (n.includes("ñemby") || n.includes("nemby")) return "Ñemby";
  if (n.includes("ypane") || n.includes("ypané")) return "Ypané";
  if (n.includes("limpio")) return "Limpio";
  if (n.includes("villa elisa")) return "Villa Elisa";
  if (n.includes("ciudad del este") || n.includes("cde")) return "Ciudad del Este";
  
  return "";
}

function tieneCobertura(city: string): boolean {
  const ciudadesConCobertura = [
    "Asunción", "Capiatá", "Luque", "Lambaré", "San Lorenzo", 
    "Fernando de la Mora", "Ñemby", "Ypané", "Limpio", "Villa Elisa"
  ];
  return ciudadesConCobertura.includes(city);
}

// =======================================================
// 🔧 UTILIDADES
// =======================================================

function formatGs(amount: number): string {
  return amount.toLocaleString("de-DE");
}

function extractPhone(text: string): string {
  const match = text.match(/(09\d{8}|\+595\d{9}|0\d{9})/);
  return match ? match[0] : "";
}

function extractName(text: string): string {
  // Evitar palabras que no son nombres
  const skipWords = ["quiero", "precio", "destapa", "cañeria", "raqueta", "plantilla", "pelador", "tabla", "pororo", "afilador", "veneno", "abeja", "perfume", "asad", "vital", "honey"];
  
  let cleanText = text.replace(/[0-9]/g, "").trim();
  
  for (const word of skipWords) {
    if (normalize(cleanText).includes(normalize(word))) {
      return "";
    }
  }
  
  if (cleanText.length >= 3 && cleanText.length <= 50 && !cleanText.includes("@") && !cleanText.includes("http")) {
    return cleanText;
  }
  return "";
}

// =======================================================
// 📝 RESPUESTAS
// =======================================================

function buildProductResponse(product: string, price: number): string {
  return `🤗 ¡Qué buena elección! ${product} es uno de nuestros favoritos ⭐

💰 Precio: ${formatGs(price)} Gs

⚠️ STOCK LIMITADO

📍 ¿A qué ciudad te gustaría recibirlo? 😊

Te explico cómo funciona:

🟢 **Ciudades con cobertura** → Envío GRATIS · Pagás al recibir
🔴 **Otras ciudades** → Envío por encomienda · Pago anticipado

Escribime tu ciudad y te confirmo cómo llega tu pedido 🚚✨`;
}

function buildQuantityResponse(product: string, city: string, price: number): string {
  const tieneCob = tieneCobertura(city);
  
  if (tieneCob) {
    return `✅ ¡Perfecto! **${city}** tiene cobertura 🟢

📦 ${product}
💰 ${formatGs(price)} Gs c/u

🚚 **Envío GRATIS** a tu domicilio
💵 **Pagás al recibir**

🔥 ¿Cuántas unidades querés llevar?

Respondé con el número (1, 2, 3...) ✨`;
  } else {
    return `ℹ️ **${city}** no tiene cobertura de delivery 🔴

📦 ${product}
💰 ${formatGs(price)} Gs c/u

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

function buildSummaryResponse(product: string, quantity: number, city: string, total: number): string {
  const tieneCob = tieneCobertura(city);
  
  if (tieneCob) {
    return `🔥 ¡Perfecto! Tu pedido quedó así 🤗

📦 ${product} x${quantity}
💰 Total: ${formatGs(total)} Gs

🚚 **ENVÍO GRATIS** a ${city}
💵 **Pagás al recibir**

📎 Ahora solo me falta tu información:

✅ Nombre y apellido
✅ Dirección exacta
✅ Número de celular

📲 En cuanto reciba tus datos, agendamos tu entrega ✨`;
  } else {
    return `🔥 ¡Perfecto! Tu pedido quedó así 🤗

📦 ${product} x${quantity}
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

function buildConfirmResponse(product: string, quantity: number, city: string, address: string, customerName: string, phone: string, total: number): string {
  const tieneCob = tieneCobertura(city);
  
  if (tieneCob) {
    return `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${product}
✅ Cliente: ${customerName}
✅ Ubicación: ${city} — ${address}
✅ Contacto: ${phone}
✅ Cantidad: ${quantity} u.
💰 Total: ${formatGs(total)} Gs

🚚 **ENVÍO GRATIS** · **Pagás al recibir**

📦 Tu pedido queda agendado. El delivery se comunicará contigo.

⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

Te dejo nuestro catálogo completo 👇

👉 ${CATALOG_URL}`;
  } else {
    return `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${product}
✅ Cliente: ${customerName}
✅ Ciudad: ${city}
✅ Contacto: ${phone}
✅ Cantidad: ${quantity} u.
💰 Total: ${formatGs(total)} Gs

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
}

// =======================================================
// 🚀 HANDLER PRINCIPAL
// =======================================================

export default async function handler(req: any, res: any) {
  console.log("🔥 BOT - MANTIENE PRODUCTO EN TODO MOMENTO");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { user_id, message, from_number, context } = req.body;

    const texto = clean(message);
    const fromNumber = clean(from_number);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    if (!texto) return res.status(400).json({ error: "Falta message" });

    // ========== OBTENER ENTRENAMIENTO ==========
    const { data: trainingRow } = await supabase
      .from("training_data")
      .select("response")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fullTraining = clean(trainingRow?.response);

    // ========== RECUPERAR CONTEXTO ==========
    let step = context?.step || "selling";
    let currentProduct = context?.current_product || "";
    let quantity = context?.quantity || 0;
    let city = context?.city || "";
    let customerName = context?.customer_name || "";
    let phone = context?.phone || "";
    let address = context?.address || "";

    // ========== DETECTAR PRODUCTO EN EL MENSAJE ==========
    const detectedProduct = detectProduct(texto);
    
    // REGLA DE ORO: Si el cliente menciona un producto, ESE es el producto (ignorar cualquier otro)
    if (detectedProduct) {
      // Si es un producto diferente al actual, reiniciar todo
      if (currentProduct && detectedProduct !== currentProduct) {
        console.log(`🔄 Producto cambiado: "${currentProduct}" → "${detectedProduct}"`);
        currentProduct = detectedProduct;
        quantity = 0;
        city = "";
        customerName = "";
        phone = "";
        address = "";
        step = "awaiting_city";
      } 
      // Si no había producto, establecerlo
      else if (!currentProduct) {
        currentProduct = detectedProduct;
        step = "awaiting_city";
      }
    }

    // ========== EXTRAER DATOS DEL MENSAJE ==========
    const extractedCity = extractCity(texto);
    const extractedPhone = extractPhone(texto);
    const extractedName = extractName(texto);
    
    // Extraer cantidad (solo números simples)
    let extractedQuantity = 0;
    const numberMatch = texto.match(/^\s*(\d{1,2})\s*$/);
    if (numberMatch) {
      extractedQuantity = parseInt(numberMatch[1]);
    } else {
      const qMatch = texto.match(/(\d{1,2})\s*(unidad|unidades|u)/i);
      if (qMatch) extractedQuantity = parseInt(qMatch[1]);
    }
    
    // Extraer dirección
    let extractedAddress = "";
    const addrMatch = texto.match(/(dirección|dir|ubicacion|ubicación|domicilio)\s*[:-]?\s*(.+)/i);
    if (addrMatch) {
      extractedAddress = clean(addrMatch[2]);
    } else if (texto.length > 10 && !detectedProduct && !extractedCity && !extractedPhone && texto.match(/[0-9]/) && texto.match(/[a-zA-Z]/)) {
      // Si parece una dirección (tiene números y letras)
      extractedAddress = texto;
    }

    // ========== ACTUALIZAR CONTEXTO CON DATOS EXTRAÍDOS ==========
    if (extractedCity && !city) city = extractedCity;
    if (extractedQuantity > 0 && quantity === 0) quantity = extractedQuantity;
    if (extractedPhone && !phone) phone = extractedPhone;
    if (extractedName && !customerName) customerName = extractedName;
    if (extractedAddress && !address) address = extractedAddress;

    // ========== FLUJO DE VENTAS ==========
    
    // Paso 1: Sin producto seleccionado
    if (!currentProduct) {
      return res.json({
        response: `🤗 ¡Hola! ¿Qué producto te interesa?

Te comparto nuestro catálogo: ${CATALOG_URL}

Escribime el nombre del producto y te digo el precio ✨`,
        context: { step: "selling", current_product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "" }
      });
    }
    
    // Paso 2: Tiene producto, esperando ciudad
    if (currentProduct && !city) {
      const price = extractPriceFromTraining(currentProduct, fullTraining);
      
      if (!price) {
        return res.json({
          response: `⚠️ No encontré el precio para ${currentProduct} en el sistema.

Por favor, revisá nuestro catálogo: ${CATALOG_URL}

¿Qué otro producto te interesa? ✨`,
          context: { step: "selling", current_product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "" }
        });
      }
      
      return res.json({
        response: buildProductResponse(currentProduct, price),
        context: { step: "awaiting_city", current_product: currentProduct, quantity: 0, city: "", customer_name: "", phone: "", address: "" }
      });
    }
    
    // Paso 3: Tiene producto y ciudad, esperando cantidad
    if (currentProduct && city && quantity === 0) {
      const price = extractPriceFromTraining(currentProduct, fullTraining);
      
      if (!price) {
        return res.json({
          response: `⚠️ No encontré el precio para ${currentProduct}.

Revisá nuestro catálogo: ${CATALOG_URL}

¿Qué otro producto te interesa? ✨`,
          context: { step: "selling", current_product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "" }
        });
      }
      
      return res.json({
        response: buildQuantityResponse(currentProduct, city, price),
        context: { step: "awaiting_quantity", current_product: currentProduct, quantity: 0, city: city, customer_name: "", phone: "", address: "" }
      });
    }
    
    // Paso 4: Tiene producto, ciudad y cantidad, esperando nombre
    if (currentProduct && city && quantity > 0 && !customerName) {
      const price = extractPriceFromTraining(currentProduct, fullTraining);
      const total = price ? price * quantity : 0;
      
      if (!price) {
        return res.json({
          response: `⚠️ Error: No encontré el precio para ${currentProduct}.

Revisá nuestro catálogo: ${CATALOG_URL}`,
          context: { step: "selling", current_product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "" }
        });
      }
      
      return res.json({
        response: buildSummaryResponse(currentProduct, quantity, city, total),
        context: { step: "awaiting_name", current_product: currentProduct, quantity: quantity, city: city, customer_name: "", phone: "", address: "", total_amount: total }
      });
    }
    
    // Paso 5: Esperando teléfono
    if (customerName && !phone) {
      const total = context?.total_amount || (extractPriceFromTraining(currentProduct, fullTraining) * quantity);
      
      return res.json({
        response: `✅ Gracias ${customerName.split(" ")[0]}!

📦 Producto: ${currentProduct} x${quantity}
💰 Total: ${formatGs(total)} Gs

📎 Ahora solo me falta tu **número de celular** 📲

✅ Escribime tu número (ej: 0981xxxxxx)`,
        context: { step: "awaiting_phone", current_product: currentProduct, quantity: quantity, city: city, customer_name: customerName, phone: "", address: "", total_amount: total }
      });
    }
    
    // Paso 6: Esperando dirección (solo para ciudades con cobertura)
    if (phone && !address && tieneCobertura(city)) {
      const total = context?.total_amount || (extractPriceFromTraining(currentProduct, fullTraining) * quantity);
      
      return res.json({
        response: `✅ Gracias! Tu número es ${phone}

📦 Producto: ${currentProduct} x${quantity}
📍 Ciudad: ${city}
💰 Total: ${formatGs(total)} Gs

📎 Ahora solo me falta tu **dirección exacta** 🏠

✅ Escribime tu dirección (calle, número, barrio)`,
        context: { step: "awaiting_address", current_product: currentProduct, quantity: quantity, city: city, customer_name: customerName, phone: phone, address: "", total_amount: total }
      });
    }
    
    // Paso 7: Confirmar pedido
    if (phone && (address || !tieneCobertura(city))) {
      const total = context?.total_amount || (extractPriceFromTraining(currentProduct, fullTraining) * quantity);
      const finalAddress = address || "Envío por encomienda";
      
      // Guardar en BD
      try {
        await supabase.from("orders").insert({
          user_id,
          from_number: fromNumber,
          product: currentProduct,
          customer_name: customerName,
          city: city,
          address: finalAddress,
          phone: phone,
          quantity: quantity,
          total_amount: total,
          status: "confirmed",
          fecha: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error("Error guardando:", dbError);
      }
      
      return res.json({
        response: buildConfirmResponse(currentProduct, quantity, city, finalAddress, customerName, phone, total),
        context: { step: "confirmed", current_product: currentProduct, quantity: quantity, city: city, customer_name: customerName, phone: phone, address: finalAddress, total_amount: total }
      });
    }
    
    // ========== RESPUESTA POR DEFECTO ==========
    // Si llegamos aquí, algo está mal, reiniciamos
    return res.json({
      response: `🤗 ¿En qué puedo ayudarte?

Te comparto nuestro catálogo: ${CATALOG_URL}

Escribime qué producto te interesa ✨`,
      context: { step: "selling", current_product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "" }
    });

  } catch (error: any) {
    console.error("❌ Error:", error);
    return res.json({
      response: `🤗 ¡Hola! Por favor, escribime qué producto te interesa y te ayudo con el precio.

Te comparto nuestro catálogo: ${CATALOG_URL}`,
      context: { step: "selling", current_product: "", quantity: 0, city: "", customer_name: "", phone: "", address: "" }
    });
  }
}
