import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const VERIFY_TOKEN = "miTokenSeguro2026";

// ================= HELPERS =================
const clean = (t) => String(t || "").trim();
const normalize = (t) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

// ================= ENVIAR =================
async function enviarMensaje(userId, to, text) {
  const { data: config } = await supabase
    .from("whatsapp_config")
    .select("phone_number_id, permanent_token")
    .eq("user_id", userId)
    .single();

  if (!config) return console.log("❌ Sin config");

  console.log("📤 Enviando:", text);

  await fetch(
    `https://graph.facebook.com/v22.0/${config.phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.permanent_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );
}

// ================= CONTEXTO =================
async function getContexto(userId, from) {
  const { data } = await supabase
    .from("chat_context")
    .select("*")
    .eq("user_id", userId)
    .eq("from_number", from)
    .single();
  return data || {};
}

async function saveContexto(userId, from, ctx) {
  await supabase.from("chat_context").upsert(
    {
      user_id: userId,
      from_number: from,
      ...ctx,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,from_number" }
  );
}

// ================= PRODUCTOS DINÁMICOS =================
async function detectarProducto(userId, texto) {
  const { data } = await supabase
    .from("product_prices")
    .select("*")
    .eq("user_id", userId);

  const t = normalize(texto);

  for (const p of data || []) {
    if (t.includes(normalize(p.name))) {
      return p;
    }
  }

  return null;
}

// ================= INTENCIÓN =================
function detectarIntencion(texto) {
  const palabras = ["precio", "quiero", "info", "tenes", "costo"];
  let score = 0;
  for (const p of palabras) {
    if (texto.includes(p)) score++;
  }
  return score;
}

// ================= EXTRAER DATOS =================
function extraerDatos(texto) {
  return {
    name: texto.match(/soy\s+([a-zA-Z\s]+)/i)?.[1],
    city: texto.match(/de\s+([a-zA-Z\s]+)/i)?.[1],
    address: texto.match(/direccion\s+(.+)/i)?.[1],
  };
}

// ================= PEDIDOS =================
async function getOrder(userId, phone) {
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", userId)
    .eq("phone", phone)
    .in("status", ["draft", "collecting"])
    .limit(1)
    .single();

  return data;
}

// ================= IA =================
async function callIA(apiKey, message, product) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `
Sos un vendedor.

Producto actual: ${product || "ninguno"}

Mensaje cliente: ${message}

Reglas:
- vender
- cerrar venta
- no cambiar producto
- responder corto
- terminar con pregunta
`,
              },
            ],
          },
        ],
      }),
    }
  );

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text;
}

// ================= MAIN =================
async function procesar(message, userId, from) {
  if (message.type !== "text") return;

  const texto = clean(message.text.body);
  console.log("📩", texto);

  let ctx = await getContexto(userId, from);

  // ================= PRODUCTO =================
  const producto = await detectarProducto(userId, texto);

  if (producto) {
    ctx.current_product = producto.name;

    await enviarMensaje(
      userId,
      from,
      `🔥 ${producto.name}

💰 Precio: ${producto.price}
🚚 Envío GRATIS

¿Querés que te reserve uno?`
    );

    await saveContexto(userId, from, ctx);
    return;
  }

  // ================= INTENCIÓN =================
  const score = detectarIntencion(texto);

  if (ctx.current_product && score >= 1) {
    await enviarMensaje(
      userId,
      from,
      `🔥 El ${ctx.current_product} está disponible

🚚 Envío GRATIS
💸 Pagás al recibir

¿Te reservo uno ahora?`
    );
    return;
  }

  // ================= PEDIDO =================
  let order = await getOrder(userId, from);

  const datos = extraerDatos(texto);

  if (order && (datos.name || datos.city || datos.address)) {
    await supabase.from("orders").update({
      ...(datos.name && { customer_name: datos.name }),
      ...(datos.city && { city: datos.city }),
      ...(datos.address && { address: datos.address }),
    }).eq("id", order.id);
  }

  // ================= CONFIRMAR =================
  if (
    order &&
    order.customer_name &&
    order.city &&
    order.address
  ) {
    await enviarMensaje(
      userId,
      from,
      `✅ Pedido listo

${order.product}
${order.customer_name}
${order.city}
${order.address}

¿Confirmamos?`
    );

    return;
  }

  // ================= IA =================
  const { data: ia } = await supabase
    .from("chat_ia_gemini")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (ia?.api_key) {
    const r = await callIA(ia.api_key, texto, ctx.current_product);
    if (r) {
      await enviarMensaje(userId, from, r);
      return;
    }
  }

  // ================= FALLBACK =================
  await enviarMensaje(
    userId,
    from,
    `👋 Hola!

¿Buscás algún producto?

📋 Catálogo:
https://cat-logomegatodo-com.vercel.app/`
  );
}

// ================= WEBHOOK =================
export default async function handler(req, res) {
  if (req.method === "GET") {
    if (
      req.query["hub.verify_token"] === VERIFY_TOKEN
    ) {
      return res.send(req.query["hub.challenge"]);
    }
    return res.sendStatus(403);
  }

  if (req.method === "POST") {
    const body = req.body;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const phoneId = value?.metadata?.phone_number_id;

        const { data: config } = await supabase
          .from("whatsapp_config")
          .select("user_id")
          .eq("phone_number_id", phoneId)
          .single();

        if (!config) continue;

        for (const msg of value.messages || []) {
          await procesar(msg, config.user_id, msg.from);
        }
      }
    }

    return res.sendStatus(200);
  }
}
