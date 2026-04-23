// ============================================
// PROCESO INTELIGENTE PRO
// ============================================

// 1. GUARDAR MENSAJE
await supabase.from("received_messages").insert({
  user_id: userId,
  platform: "whatsapp",
  from_number: fromNumber,
  message: texto,
  message_type: "in_text",
  created_at: new Date().toISOString(),
});

// 2. CONTEXTO ACTUAL
let contexto = await getContexto(userId, fromNumber) || {};

// ============================================
// 3. DETECTAR DATOS AUTOMÁTICOS (CLAVE 🔥)
// ============================================
function extraerDatosPedido(texto) {
  const nombre = texto.match(/soy\s+([a-zA-Z\s]+)/i);
  const ciudad = texto.match(/(?:de|en)\s+([a-zA-Z\s]+)/i);
  const direccion = texto.match(/direccion\s+(.+)/i);

  return {
    customer_name: nombre ? nombre[1].trim() : null,
    city: ciudad ? ciudad[1].trim() : null,
    address: direccion ? direccion[1].trim() : null,
  };
}

const datos = extraerDatosPedido(texto);

// ============================================
// 4. PEDIDO ACTUAL
// ============================================
let order = await getOpenOrder(userId, fromNumber);

// Crear pedido si hay producto activo
if (!order && contexto?.current_product) {
  const { data: newOrder } = await supabase.from("orders").insert({
    user_id: userId,
    phone: fromNumber,
    product: contexto.current_product,
    status: "draft",
  }).select().single();

  order = newOrder;
}

// Actualizar datos si el cliente envía info
if (order && (datos.customer_name || datos.city || datos.address)) {
  await supabase.from("orders").update({
    ...(datos.customer_name && { customer_name: datos.customer_name }),
    ...(datos.city && { city: datos.city }),
    ...(datos.address && { address: datos.address }),
  }).eq("id", order.id);
}

// ============================================
// 5. SI PEDIDO COMPLETO → CONFIRMAR
// ============================================
function isComplete(o) {
  return o?.product && o?.customer_name && o?.city && o?.address;
}

if (order && isComplete(order)) {
  await enviarMensaje(userId, fromNumber,
`✅ *Pedido listo*

📦 Producto: ${order.product}
👤 Nombre: ${order.customer_name}
📍 Ciudad: ${order.city}
🏠 Dirección: ${order.address}

¿Confirmamos tu pedido? 😊`);

  await supabase.from("orders").update({
    status: "confirm_pending"
  }).eq("id", order.id);

  return;
}

// ============================================
// 6. TRIGGERS (INICIO DE VENTA)
// ============================================
const trigger = await verificarTriggers(userId, fromNumber, texto);

if (trigger) {
  contexto = {
    ...contexto,
    current_product: trigger.name,
    last_topic: trigger.name,
    step: "selling"
  };

  await saveContexto(userId, fromNumber, contexto);
  return;
}

// ============================================
// 7. ENTRENAMIENTO (RESPUESTA EXACTA)
// ============================================
const trainingData = await getTrainingData(userId);

function matchFuerte(msg, ejemplo) {
  const m = normalizeText(msg);
  const e = normalizeText(ejemplo);

  return (
    m === e ||
    m.includes(e) ||
    e.includes(m) ||
    m.split(" ").some(p => e.includes(p))
  );
}

for (const item of trainingData) {
  for (const ejemplo of item.examples || []) {
    if (matchFuerte(texto, ejemplo)) {
      await enviarMensaje(userId, fromNumber, item.response);

      await saveContexto(userId, fromNumber, {
        ...contexto,
        last_topic: item.intent,
        step: "training"
      });

      return;
    }
  }
}

// ============================================
// 8. IA CONTROLADA (GEMINI)
// ============================================
const iaConfig = await getIAConfig(userId);

if (iaConfig?.api_key) {
  const history = await getConversationHistory(userId, fromNumber, 20);

  const respuestaIA = await callGemini(
    iaConfig.api_key,
    iaConfig.model || "gemini-2.0-flash",
    trainingData,
    texto + `\n\nProducto actual: ${contexto?.current_product || "ninguno"}`,
    history
  );

  if (respuestaIA) {
    await enviarMensaje(userId, fromNumber, respuestaIA);

    await saveContexto(userId, fromNumber, {
      ...contexto,
      last_topic: "ia",
      step: "selling"
    });

    return;
  }
}

// ============================================
// 9. RESPUESTA FINAL SEGURA
// ============================================
await enviarMensaje(userId, fromNumber,
`🛍️ *MEGA TODO STORE*

Hola 😊 ¿Qué producto te interesa hoy?

📋 Catálogo:
https://cat-logomegatodo-com.vercel.app/`);
