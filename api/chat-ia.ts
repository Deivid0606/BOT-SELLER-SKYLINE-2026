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
  const n = normalize(text);
  
  // Destapa cañerías (prioridad máxima)
  if (n.includes("destapa") || n.includes("cañeria") || n.includes("cañería") || 
      n.includes("tornado") || n.includes("desague") || n.includes("desagüe") ||
      n.includes("agua tarda") || n.includes("tuberia tapada")) {
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
  if (n.includes("pelador") || n.includes("peladora") || n.includes("pelar papas")) {
    return "Peladora Automática";
  }
  
  // Pororo
  if (n.includes("pororo") || n.includes("popcorn") || n.includes("pochoclo")) {
    return "Máquina para hacer Pororo";
  }
  
  // Tabla de mármol
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
// 💰 EXTRACCIÓN DE PRECIO DEL ENTRENAMIENTO
// =======================================================

function extractPrice(productName: string, training: string): number | null {
  if (!productName || !training) return null;
  
  const lines = training.split("\n").map(l => clean(l)).filter(Boolean);
  const normalizedProduct = normalize(productName);
  
  for (const line of lines) {
    const normalizedLine = normalize(line);
    
    // Buscar línea que contenga el producto
    if (!normalizedLine.includes(normalizedProduct)) continue;
    
    // Buscar precio en el formato 123.456 o 123456
    const priceMatch = line.match(/(\d{1,3}(?:\.\d{3})+|\d{4,})/);
    if (priceMatch) {
      const price = parseInt(priceMatch[1].replace(/\./g, ""));
      if (price > 10000 && price < 1000000) {
        return price;
      }
    }
  }
  
  return null;
}

function calculateTotal(product: string, quantity: number, training: string): number | null {
  const unitPrice = extractPrice(product, training);
  if (!unitPrice) return null;
  return unitPrice * quantity;
}

// =======================================================
// 📍 CIUDADES
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
  const match = text.match(/(09\d{8}|\+595\d{9})/);
  return match ? match[0] : "";
}

function extractName(text: string): string {
  const cleanText = text.replace(/[0-9]/g, "").trim();
  if (cleanText.length >= 3 && cleanText.length <= 50 && !cleanText.includes("quiero") && !cleanText.includes("precio")) {
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

function buildSummaryResponse(order: any, total: number): string {
  const tieneCob = tieneCobertura(order.city);
  
  if (tieneCob) {
    return `🔥 ¡Perfecto! Tu pedido quedó así 🤗

📦 ${order.product} x${order.quantity}
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

📦 ${order.product} x${order.quantity}
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

function buildConfirmResponse(order: any, total: number): string {
  const tieneCob = tieneCobertura(order.city);
  
  if (tieneCob) {
    return `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${order.product}
✅ Cliente: ${order.customer_name}
✅ Ubicación: ${order.city} — ${order.address}
✅ Contacto: ${order.phone}
✅ Cantidad: ${order.quantity} u.
💰 Total: ${formatGs(total)} Gs

🚚 **ENVÍO GRATIS** · **Pagás al recibir**

📦 Tu pedido queda agendado. El delivery se comunicará contigo.

⏰ Oferta válida hoy

¡Gracias por elegir Mega Todo Store! 💜✨

Te dejo nuestro catálogo completo 👇

👉 ${CATALOG_URL}`;
  } else {
    return `✅ **PEDIDO CONFIRMADO** ✅

✅ Producto: ${order.product}
✅ Cliente: ${order.customer_name}
✅ Ciudad: ${order.city}
✅ Contacto: ${order.phone}
✅ Cantidad: ${order.quantity} u.
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
  console.log("🔥 BOT SIMPLIFICADO - VERSION FINAL");

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

    if (!fullTraining) {
      return res.json({ 
        response: `🤗 ¡Hola! Bienvenido a Mega Todo Store.

Te comparto nuestro catálogo: ${CATALOG_URL}

Escribime qué producto te interesa y te ayudo con el precio ✨`,
        context: { step: "selling", order_data: {} }
      });
    }

    // ========== RECUPERAR O CREAR CONTEXTO ==========
    let step = context?.step || "selling";
    let orderData = context?.order_data || {
      product: "",
      quantity: 0,
      city: "",
      customer_name: "",
      phone: "",
      address: ""
    };

    // ========== DETECTAR PRODUCTO EN EL MENSAJE ==========
    const detectedProduct = detectProduct(texto);
    
    // Si el cliente pide un producto nuevo, reiniciar el pedido
    if (detectedProduct && orderData.product && detectedProduct !== orderData.product) {
      console.log(`🔄 Cliente cambió de ${orderData.product} a ${detectedProduct} - Reiniciando`);
      orderData = {
        product: "",
        quantity: 0,
        city: "",
        customer_name: "",
        phone: "",
        address: ""
      };
      step = "selling";
    }
    
    // Si no hay producto en el pedido pero se detectó uno, usarlo
    if (!orderData.product && detectedProduct) {
      orderData.product = detectedProduct;
      step = "awaiting_city";
    }

    // ========== EXTRAER DATOS DEL MENSAJE ==========
    const extractedCity = extractCity(texto);
    const extractedQuantity = texto.match(/^\s*(\d+)\s*$/) ? parseInt(texto) : 
                              texto.match(/(\d+)\s*(unidad|unidades|u)/) ? parseInt(texto.match(/(\d+)\s*(unidad|unidades|u)/)![1]) : 0;
    const extractedPhone = extractPhone(texto);
    const extractedName = extractName(texto);
    
    // Actualizar orderData con datos extraídos
    if (extractedCity && !orderData.city) orderData.city = extractedCity;
    if (extractedQuantity > 0 && orderData.quantity === 0) orderData.quantity = extractedQuantity;
    if (extractedPhone && !orderData.phone) orderData.phone = extractedPhone;
    if (extractedName && !orderData.customer_name) orderData.customer_name = extractedName;
    
    // Dirección (texto libre después de palabras clave)
    if (texto.match(/(dirección|dir|ubicacion|ubicación|domicilio)\s*[:-]?\s*(.+)/i)) {
      const addrMatch = texto.match(/(dirección|dir|ubicacion|ubicación|domicilio)\s*[:-]?\s*(.+)/i);
      if (addrMatch && !orderData.address) {
        orderData.address = clean(addrMatch[2]);
      }
    }

    // ========== FLUJO DE VENTAS ==========
    
    // Paso 1: Sin producto
    if (step === "selling" && !orderData.product) {
      return res.json({
        response: `🤗 ¡Hola! ¿Qué producto te interesa?

Te comparto nuestro catálogo: ${CATALOG_URL}

Escribime el nombre del producto y te digo el precio ✨`,
        context: { step: "selling", order_data: orderData }
      });
    }
    
    // Paso 2: Tiene producto, esperando ciudad
    if (step === "awaiting_city" && orderData.product && !orderData.city) {
      const price = extractPrice(orderData.product, fullTraining);
      
      if (!price) {
        return res.json({
          response: `⚠️ No encontré el precio para ${orderData.product} en el sistema.

Por favor, revisá nuestro catálogo: ${CATALOG_URL}

¿Qué otro producto te interesa? ✨`,
          context: { step: "selling", order_data: {} }
        });
      }
      
      return res.json({
        response: buildProductResponse(orderData.product, price),
        context: { step: "awaiting_city", order_data: orderData }
      });
    }
    
    // Paso 3: Tiene producto y ciudad, esperando cantidad
    if (step === "awaiting_city" && orderData.product && orderData.city && orderData.quantity === 0) {
      const price = extractPrice(orderData.product, fullTraining);
      
      if (!price) {
        return res.json({
          response: `⚠️ No encontré el precio para ${orderData.product}.

Revisá nuestro catálogo: ${CATALOG_URL}

¿Qué otro producto te interesa? ✨`,
          context: { step: "selling", order_data: {} }
        });
      }
      
      return res.json({
        response: buildQuantityResponse(orderData.product, orderData.city, price),
        context: { step: "awaiting_quantity", order_data: orderData }
      });
    }
    
    // Paso 4: Tiene producto, ciudad y cantidad, esperando nombre
    if (step === "awaiting_quantity" && orderData.product && orderData.city && orderData.quantity > 0 && !orderData.customer_name) {
      const price = extractPrice(orderData.product, fullTraining);
      const total = price ? price * orderData.quantity : 0;
      
      if (!price) {
        return res.json({
          response: `⚠️ Error: No encontré el precio para ${orderData.product}.

Revisá nuestro catálogo: ${CATALOG_URL}`,
          context: { step: "selling", order_data: {} }
        });
      }
      
      return res.json({
        response: buildSummaryResponse(orderData, total),
        context: { step: "awaiting_name", order_data: { ...orderData, total_amount: total } }
      });
    }
    
    // Paso 5: Esperando teléfono
    if (step === "awaiting_name" && orderData.customer_name && !orderData.phone) {
      return res.json({
        response: `✅ Gracias ${orderData.customer_name.split(" ")[0]}!

📦 Producto: ${orderData.product} x${orderData.quantity}
💰 Total: ${formatGs(orderData.total_amount)} Gs

📎 Ahora solo me falta tu **número de celular** 📲

✅ Escribime tu número (ej: 0981xxxxxx)`,
        context: { step: "awaiting_phone", order_data: orderData }
      });
    }
    
    // Paso 6: Esperando dirección (solo para cobertura)
    if (step === "awaiting_phone" && orderData.phone) {
      const tieneCob = tieneCobertura(orderData.city);
      
      if (tieneCob && !orderData.address) {
        return res.json({
          response: `✅ Gracias! Tu número es ${orderData.phone}

📦 Producto: ${orderData.product} x${orderData.quantity}
📍 Ciudad: ${orderData.city}
💰 Total: ${formatGs(orderData.total_amount)} Gs

📎 Ahora solo me falta tu **dirección exacta** 🏠

✅ Escribime tu dirección (calle, número, barrio)`,
          context: { step: "awaiting_address", order_data: orderData }
        });
      }
      
      // Si no requiere dirección (envío por encomienda) o ya la tiene, confirmar
      step = "confirming";
    }
    
    // Paso 7: Esperando dirección
    if (step === "awaiting_address" && orderData.address) {
      step = "confirming";
    }
    
    // Paso 8: Confirmar pedido
    if (step === "confirming" || (step === "awaiting_phone" && orderData.phone && !tieneCobertura(orderData.city))) {
      const total = orderData.total_amount || (extractPrice(orderData.product, fullTraining) * orderData.quantity);
      
      // Guardar en BD
      try {
        await supabase.from("orders").insert({
          user_id,
          from_number: fromNumber,
          product: orderData.product,
          customer_name: orderData.customer_name,
          city: orderData.city,
          address: orderData.address || "",
          phone: orderData.phone,
          quantity: orderData.quantity,
          total_amount: total,
          status: "confirmed",
          fecha: new Date().toISOString(),
        });
      } catch (dbError) {
        console.error("Error guardando:", dbError);
      }
      
      return res.json({
        response: buildConfirmResponse(orderData, total),
        context: { step: "confirmed", order_data: { ...orderData, status: "confirmed" } }
      });
    }
    
    // ========== RESPUESTA POR DEFECTO ==========
    return res.json({
      response: `🤗 ¿En qué puedo ayudarte?

Te comparto nuestro catálogo: ${CATALOG_URL}

Escribime qué producto te interesa ✨`,
      context: { step: "selling", order_data: {} }
    });

  } catch (error: any) {
    console.error("❌ Error:", error);
    // En caso de error, responder amablemente sin mostrar el error al cliente
    return res.json({
      response: `🤗 ¡Hola! Por favor, escribime qué producto te interesa y te ayudo con el precio.

Te comparto nuestro catálogo: ${CATALOG_URL}`,
      context: { step: "selling", order_data: {} }
    });
  }
}
