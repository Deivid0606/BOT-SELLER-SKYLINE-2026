import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// ================= HELPERS =================
const clean = (t: any) => String(t || "").trim();

const normalize = (t: string) =>
  clean(t)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function match(msg: string, ex: string) {
  const m = normalize(msg);
  const e = normalize(ex);
  return m === e || m.includes(e) || e.includes(m);
}

// ================= PEDIDO =================
async function getOpenOrder(user_id: string, phone: string) {
  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("user_id", user_id)
    .eq("from_number", phone)
    .in("status", [
      "draft",
      "collecting_name",
      "collecting_city",
      "collecting_address",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return data;
}

function extractData(msg: string) {
  return {
    name: msg.match(/soy\s+([a-zA-Z\s]+)/i)?.[1],
    city: msg.match(/de\s+([a-zA-Z\s]+)/i)?.[1],
    address: msg.match(/direccion\s+(.+)/i)?.[1],
  };
}

function isComplete(o: any) {
  return o?.product && o?.customer_name && o?.city && o?.address;
}

// ================= IA =================
async function callGemini({
  apiKey,
  model,
  system,
  contents,
  temperature,
  maxTokens,
}: any) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens,
        },
      }),
    }
  );

  const data = await res.json();
  return clean(
    data?.candidates?.[0]?.content?.parts?.[0]?.text || ""
  );
}

// ================= MAIN =================
export default async function handler(req: any, res: any) {
  try {
    const { user_id, message, from_number, context, history } =
      req.body;

    const texto = clean(message);

    // ================= 1. TRIGGERS =================
    const { data: triggers } = await supabase
      .from("triggers")
      .select("*")
      .eq("user_id", user_id)
      .eq("active", true);

    for (const t of triggers || []) {
      if (normalize(texto).includes(normalize(t.condition))) {
        return res.json({
          response: t.response,
          context: {
            ...context,
            last_trigger: t.name,
            last_topic: t.product || null,
          },
        });
      }
    }

    // ================= 2. ENTRENAMIENTO =================
    const { data: training } = await supabase
      .from("training_data")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true);

    for (const t of training || []) {
      for (const e of t.examples || []) {
        if (match(texto, e)) {
          return res.json({
            response: t.response,
            context: {
              ...context,
              last_topic: t.intent,
            },
          });
        }
      }
    }

    // ================= 3. PEDIDOS =================
    let order = await getOpenOrder(user_id, from_number);
    const data = extractData(texto);

    if (order && (data.name || data.city || data.address)) {
      await supabase
        .from("orders")
        .update({
          ...(data.name && { customer_name: data.name }),
          ...(data.city && { city: data.city }),
          ...(data.address && { address: data.address }),
        })
        .eq("id", order.id);
    }

    if (order && isComplete(order)) {
      return res.json({
        response: `✅ Pedido listo

📦 ${order.product}
👤 ${order.customer_name}
📍 ${order.city}
🏠 ${order.address}

¿Confirmamos?`,
      });
    }

    // ================= 4. IA =================
    const { data: ia } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .single();

    if (ia?.api_key && ia?.is_active) {
      const system = `
Eres un vendedor profesional.

Producto activo: ${context?.last_topic || "ninguno"}

Reglas:
- responde corto
- vende
- no cambies producto
- termina con pregunta
`;

      const contents = (history || []).map((h: any) => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      }));

      contents.push({
        role: "user",
        parts: [{ text: texto }],
      });

      const r = await callGemini({
        apiKey: ia.api_key,
        model: ia.model || "gemini-2.5-flash",
        system,
        contents,
        temperature: ia.temperature ?? 0.4,
        maxTokens: ia.max_tokens ?? 250,
      });

      if (r) {
        return res.json({ response: r });
      }
    }

    // ================= FALLBACK =================
    return res.json({
      response: "👋 Hola! ¿Qué producto te interesa?",
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: "error interno" });
  }
}
