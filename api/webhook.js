import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const supabase = createClient(supabaseUrl, supabaseKey);

const PRODUCTOS = {
  "afilador": { nombre: "Afilador de Cuchillos y Tijeras", precio: 99000, promo2x: 129900 },
  "plumero": { nombre: "Plumero LimpiaFlex", precio: 99000, promo2x: 129900 },
  "veneno": { nombre: "Veneno de Abeja", precio: 145000, promo2x: 249900 },
  "drone": { nombre: "DRONE", precio: 279900 },
  "rodillera": { nombre: "Rodillera de Compresión", precio: 109000, promo2x: 159900 },
  "ortopiex": { nombre: "Plantilla Ortopiex 5D", precio: 159000 },
};

function formatGs(value: number): string {
  return `${value.toLocaleString("es-PY")} Gs`;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { user_id, message, from_number } = req.body;

    // Obtener orden activa para contexto
    const { data: ordenActiva } = await supabase
      .from("orders")
      .select("*")
      .eq("user_id", user_id)
      .eq("from_number", from_number)
      .in("status", ["esperando_nombre", "esperando_ciudad", "esperando_direccion"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Obtener configuración IA
    const { data: config } = await supabase
      .from("chat_ia_gemini")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .single();

    if (!config?.api_key) {
      return res.status(400).json({ error: "IA no configurada" });
    }

    // Construir contexto
    let contexto = "";
    if (ordenActiva) {
      contexto = `
ESTADO DEL PEDIDO:
- Producto: ${ordenActiva.product || "No definido"}
- Cliente: ${ordenActiva.customer_name || "No definido"} 
- Ciudad: ${ordenActiva.city || "No definido"}
- Dirección: ${ordenActiva.address || "No definido"}
- Paso: ${ordenActiva.status}

REGLAS:
- Si ya tienes nombre, NO lo pidas
- Si ya tienes ciudad, NO la pidas  
- Si ya tienes dirección, NO la pidas
- Pide SOLO el siguiente dato
`;
    }

    const systemPrompt = `Eres Araceli, vendedora de Mega Todo Store.

${contexto}

PRECIOS CORRECTOS:
${Object.entries(PRODUCTOS).map(([k, v]: any) => `- ${v.nombre}: ${formatGs(v.precio)}`).join("\n")}

Responde en español, cálido, máximo 2 oraciones.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.api_key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: message }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 200 },
      }),
    });

    const data = await response.json();
    const respuesta = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;

    return res.status(200).json({ response: respuesta });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
