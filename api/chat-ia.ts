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
// 🎯 DETECCIÓN DE PRODUCTOS
// =======================================================

function detectProduct(text: string): string {
  if (!text) return "";
  
  const n = normalize(text);
  
  // Destapa cañerías
  if (n.includes("destapa") || n.includes("cañeria") || n.includes("cañería") || 
      n.includes("tornado") || n.includes("desague") || n.includes("desagüe") ||
      n.includes("agua tarda") || n.includes("tuberia")) {
    return "Destapa Cañerías Tornado";
  }
  
  // Raqueta
  if (n.includes("raqueta") || n.includes("electrica") || n.includes("flayes") || n.includes("mosquitos")) {
    return "Raqueta Eléctrica para Insectos";
  }
  
  // Veneno de abeja
  if (n.includes("veneno") || n.includes("abeja")) {
    return "Veneno de Abeja";
  }
  
  // Plantillas
  if (n.includes("plantilla") || n.includes("ortopiex")) {
    return "PLANTILLAS ORTOPIEX 5D®";
  }
  
  // Peladora
  if (n.includes("pelador") || n.includes("peladora")) {
    return "Peladora Automática";
  }
  
  // Pororo
  if (n.includes("pororo") || n.includes("popcorn") || n.includes("pochoclo")) {
    return "Máquina para hacer Pororo";
  }
  
  // Tabla
  if (n.includes("tabla") && (n.includes("picar") || n.includes("marmol"))) {
    return "Tabla de Picar de Mármol";
  }
  
  // Afilador
  if (n.includes("afilador") || n.includes("cuchillo")) {
    return "Afilador de Cuchillos";
  }
  
  // Vital Honey
  if (n.includes("vital honey")) {
    return "Vital Honey VIP";
  }
  
  // Perfume Asad
  if (n.includes("perfume asad") || n.includes("asad")) {
    return "Perfume Asad";
  }
  
  // Kit antivibración
  if (n.includes("antivibracion") || n.includes("patitas") || n.includes("lavarropas")) {
    return "Kit Antivibración x4 Patitas Antideslizantes";
  }
  
  return "";
}

// =======================================================
// 💰 PRECIOS (desde el entrenamiento o valores por defecto)
// =======================================================

const DEFAULT_PRICES: Record<string, number> = {
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

function getProductPrice(product: string, training?: string): number {
  // Primero intentar extraer del entrenamiento
  if (training) {
    const lines = training.split("\n");
    for (const line of lines) {
      const normalizedLine = normalize(line);
      const normalizedProduct = normalize(product);
      if (normalizedLine.includes(normalizedProduct)) {
        const priceMatch = line.match(/(\d{1,3}(?:\.\d{3})+|\d{4,})/);
        if (priceMatch) {
          const price = parseInt(priceMatch[1].replace(/\./g, ""));
          if (price > 10000 && price < 1000000) {
            return price;
          }
        }
      }
    }
  }
  
  // Si no, usar valor por defecto
  return DEFAULT_PRICES[product] || 0;
}

// =======================================================
// 📍 CIUDADES
// =======================================================

function extractCity(text: string): string {
  if (!text) return "";
  
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

function hasFreeDelivery(city: string): boolean {
  const cities = ["Asunción", "Capiatá", "Luque", "Lambaré", "San Lorenzo", "Fernando de la Mora", "Ñemby", "Ypané", "Limpio", "Villa Elisa"];
  return cities.includes(city);
}

// =======================================================
// 🔧 UTILIDADES
// =======================================================

function formatGs(amount: number): string {
  return amount.toLocaleString("de-DE");
}

function extractQuantity(text: string): number {
  if (!text) return 0;
  
  const n = normalize(text);
  
  // Solo número
  const justNumber = n.match(/^\s*(\d+)\s*$/);
  if (justNumber) {
    return parseInt(justNumber[1]);
  }
  
  // "quiero 1", "llevo 2"
  const withAction = n.match(/(quiero|llevo|dame|mandame|compro)\s*(\d+)/i);
  if (withAction) {
    return parseInt(withAction[2]);
  }
  
  // "quiero1" pegado
  const attached = n.match(/(quiero|llevo|dame)\s*(\d+)/i);
  if (attached) {
    return parseInt(attached[2]);
  }
  
  return 0;
}

function extractPhone(text: string): string {
  const match = text.match(/(09\d{8}|\+595\d{9}|0\d{9})/);
  return match ? match[0] : "";
}

function extractName(text: string): string {
  if (!text) return "";
  
  const skipWords = ["quiero", "precio", "destapa", "cañeria", "raqueta", "plantilla", "pelador", "tabla", "pororo", "afilador", "veneno", "abeja", "perfume", "asad", "vital", "honey", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
  
  let cleanText = text.replace(/[0-9]/g, "").trim();
  
  for (const word of skipWords) {
    if (normalize(cleanText).includes(normalize(word))) {
      return "";
    }
  }
  
  if (cleanText.length >= 3 && cleanText.length <= 50) {
    return cleanText;
  }
  return "";
}

function extractAddress(text: string): string {
  if (!text) return "";
  
  // Si tiene palabras clave de dirección
  if (text.match(/(dirección|dir|ubicacion|ubicación|domicilio|calle|avenida|barrio|manzana)/i)) {
    const match = text.match(/(dirección|dir|ubicacion|ubicación|domicilio)\s*[:-]?\s*(.+)/i);
    if (match) {
      return match[2].trim();
    }
    return text;
  }
  
  // Si parece una dirección (tiene números y letras, y es largo)
  if (text.length > 10 && /\d/.test(text) && /[a-zA-Z]/.test(text)) {
    return text;
  }
  
  return "";
}

// =======================================================
// 📝 RESPUESTAS
// =======================================================

function askProduct(): string {
  return `🤗 ¡Hola! ¿Qué producto te interesa?

Te comparto nuestro catálogo: ${CATALOG_URL}

Escribime el nombre del producto y te digo el precio ✨`;
}

function showPrice(product: string, price: number): string {
  return `🤗 ¡Qué buena elección! ${product} es uno de nuestros favoritos ⭐

💰 Precio: ${formatGs(price)} Gs

⚠️ STOCK LIMITADO

📍 ¿A qué ciudad te gustaría recibirlo? 😊

Te explico cómo funciona:

🟢 **Ciudades con cobertura** → Envío GRATIS · Pagás al recibir
🔴 **Otras ciudades** → Envío por encomienda · Pago anticipado

Escribime tu ciudad y te confirmo cómo llega tu pedido 🚚✨`;
}

function askQuantity(product: string, city: string, price: number): string {
  const hasDelivery = hasFreeDelivery(city);
  
  if (hasDelivery) {
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

function askCustomerData(product: string, quantity: number, city: string, total: number): string {
  const hasDelivery = hasFreeDelivery(city);
  
  if (hasDelivery) {
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

function askPhone(name: string, product: string, quantity: number, total: number): string {
  return `✅ Gracias ${name.split(" ")[0]}!

📦 Producto: ${product} x${quantity}
💰 Total: ${formatGs(total)} Gs

📎 Ahora solo me falta tu **número de celular** 📲

✅ Escribime tu número (ej: 0981xxxxxx)`;
}

function askAddress(phone: string, product: string, quantity: number, city: string, total: number): string {
  return `✅ Gracias! Tu número es ${phone}

📦 Producto: ${product} x${quantity}
📍 Ciudad: ${city}
💰 Total: ${formatGs(total)} Gs

📎 Ahora solo me falta tu **dirección exacta** 🏠

✅ Escribime tu dirección (calle, número, barrio)`;
}

function confirmOrder(product: string, quantity: number, city: string, address: string, name: string, phone: string, total: number): string {
  const hasDelivery = hasFreeDelivery(city);
  
  if (hasDelivery) {
    return `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${product}
✅ Cliente: ${name}
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
✅ Cliente: ${name}
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
  console.log("🔥 BOT - VERSION DEFINITIVA");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { user_id, message, from_number, context, history } = req.body;

    let texto = clean(message);
    const fromNumber = clean(from_number);

    if (!user_id) return res.status(400).json({ error: "Falta user_id" });
    if (!fromNumber) return res.status(400).json({ error: "Falta from_number" });
    
    // Si no hay texto, responder preguntando
    if (!texto) {
      return res.json({
        response: askProduct(),
        context: { step: "selling", product: "", quantity: 0, city: "", name: "", phone: "", address: "" }
      });
    }

    // ========== OBTENER ENTRENAMIENTO ==========
    const { data: trainingRow } = await supabase
      .from("training_data")
      .select("response")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const training = trainingRow?.response || "";

    // ========== RECUPERAR CONTEXTO ==========
    let step = context?.step || "selling";
    let product = context?.product || "";
    let quantity = context?.quantity || 0;
    let city = context?.city || "";
    let name = context?.name || "";
    let phone = context?.phone || "";
    let address = context?.address || "";
    let total = context?.total || 0;

    console.log(`📌 Estado: step=${step}, product=${product}, city=${city}, qty=${quantity}`);

    // ========== DETECTAR PRODUCTO EN EL MENSAJE ==========
    const detectedProduct = detectProduct(texto);
    
    if (detectedProduct) {
      // Si es un producto diferente, reiniciar todo
      if (product && detectedProduct !== product) {
        console.log(`🔄 Producto cambiado: ${product} → ${detectedProduct}`);
        product = detectedProduct;
        quantity = 0;
        city = "";
        name = "";
        phone = "";
        address = "";
        total = 0;
        step = "awaiting_city";
      } 
      // Si no había producto, establecerlo
      else if (!product) {
        product = detectedProduct;
        step = "awaiting_city";
        console.log(`🆕 Nuevo producto: ${product}`);
      }
    }

    // ========== EXTRAER DATOS DEL MENSAJE ==========
    const extractedCity = extractCity(texto);
    const extractedQuantity = extractQuantity(texto);
    const extractedPhone = extractPhone(texto);
    const extractedName = extractName(texto);
    const extractedAddress = extractAddress(texto);
    
    // Actualizar con datos extraídos
    if (extractedCity && !city) city = extractedCity;
    if (extractedQuantity > 0 && quantity === 0) quantity = extractedQuantity;
    if (extractedPhone && !phone) phone = extractedPhone;
    if (extractedName && !name) name = extractedName;
    if (extractedAddress && !address) address = extractedAddress;
    
    // Calcular total si tenemos producto y cantidad
    if (product && quantity > 0 && total === 0) {
      const price = getProductPrice(product, training);
      total = price * quantity;
    }

    // ========== FLUJO DE VENTAS ==========
    
    // Paso 1: Sin producto
    if (!product) {
      return res.json({
        response: askProduct(),
        context: { step: "selling", product: "", quantity: 0, city: "", name: "", phone: "", address: "", total: 0 }
      });
    }
    
    // Paso 2: Tiene producto, esperando ciudad
    if (product && !city) {
      const price = getProductPrice(product, training);
      return res.json({
        response: showPrice(product, price),
        context: { step: "awaiting_city", product: product, quantity: 0, city: "", name: "", phone: "", address: "", total: 0 }
      });
    }
    
    // Paso 3: Tiene producto y ciudad, esperando cantidad
    if (product && city && quantity === 0) {
      const price = getProductPrice(product, training);
      return res.json({
        response: askQuantity(product, city, price),
        context: { step: "awaiting_quantity", product: product, quantity: 0, city: city, name: "", phone: "", address: "", total: 0 }
      });
    }
    
    // Paso 4: Tiene producto, ciudad y cantidad, esperando nombre
    if (product && city && quantity > 0 && !name) {
      return res.json({
        response: askCustomerData(product, quantity, city, total),
        context: { step: "awaiting_name", product: product, quantity: quantity, city: city, name: "", phone: "", address: "", total: total }
      });
    }
    
    // Paso 5: Tiene nombre, esperando teléfono
    if (name && !phone) {
      return res.json({
        response: askPhone(name, product, quantity, total),
        context: { step: "awaiting_phone", product: product, quantity: quantity, city: city, name: name, phone: "", address: "", total: total }
      });
    }
    
    // Paso 6: Tiene teléfono, esperando dirección (solo si tiene delivery)
    if (phone && !address && hasFreeDelivery(city)) {
      return res.json({
        response: askAddress(phone, product, quantity, city, total),
        context: { step: "awaiting_address", product: product, quantity: quantity, city: city, name: name, phone: phone, address: "", total: total }
      });
    }
    
    // Paso 7: Confirmar pedido
    if (phone && (address || !hasFreeDelivery(city))) {
      const finalAddress = address || "Envío por encomienda";
      
      // Guardar en BD
      try {
        await supabase.from("orders").insert({
          user_id,
          from_number: fromNumber,
          product: product,
          customer_name: name,
          city: city,
          address: finalAddress,
          phone: phone,
          quantity: quantity,
          total_amount: total,
          status: "confirmed",
          fecha: new Date().toISOString(),
        });
        console.log("✅ Pedido guardado");
      } catch (err) {
        console.error("Error guardando:", err);
      }
      
      return res.json({
        response: confirmOrder(product, quantity, city, finalAddress, name, phone, total),
        context: { step: "confirmed", product: product, quantity: quantity, city: city, name: name, phone: phone, address: finalAddress, total: total }
      });
    }
    
    // ========== RESPUESTA POR DEFECTO ==========
    return res.json({
      response: askProduct(),
      context: { step: "selling", product: "", quantity: 0, city: "", name: "", phone: "", address: "", total: 0 }
    });

  } catch (error: any) {
    console.error("❌ Error:", error);
    return res.json({
      response: askProduct(),
      context: { step: "selling", product: "", quantity: 0, city: "", name: "", phone: "", address: "", total: 0 }
    });
  }
}
