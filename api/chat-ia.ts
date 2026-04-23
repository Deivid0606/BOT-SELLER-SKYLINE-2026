import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseUrl || !supabaseKey) throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================
// HELPERS
// ============================================
function clean(text: any): string {
  return String(text || "").trim();
}

function normalize(text: string): string {
  return clean(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text).split(" ").filter(w => w.length >= 3);
}

function safeArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function sanitizeHistory(history: any[]) {
  return (history || []).slice(-4).map((item: any) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: clean(item.content).slice(0, 180),
  })).filter(x => x.content);
}

function isOrderComplete(order: any): boolean {
  return !!(clean(order?.product) && clean(order?.customer_name) && clean(order?.city) && clean(order?.address) && clean(order?.phone) && Number(order?.quantity || 0) > 0);
}

// ============================================
// TRAINING INTELIGENTE
// ============================================
function scoreTraining(row: any, msg: string, context: any) {
  const text = normalize(msg + " " + (context?.last_topic || ""));
  const words = tokenize(text);
  const intent = normalize(row.intent || "");
  const response = normalize(row.response || "");
  const examples = (row.examples || []).map((e: string) => normalize(e));
  let score = 0;
  for (const w of words) {
    if (intent.includes(w)) score += 5;
    if (response.includes(w)) score += 3;
    if (examples.some(e => e.includes(w))) score += 4;
  }
  return score;
}

function getTrainingContext(rows: any[], msg: string, context: any) {
  if (!rows?.length) return "Sin entrenamiento.";
  const ranked = rows.map((r, i) => ({ row: r, score: scoreTraining(r, msg, context), i })).sort((a, b) => b.score - a.score || a.i - b.i);
  const selected = ranked.filter(r => r.score > 0).slice(0, 4).map(r => r.row) || rows.slice(0, 2);
  return selected.map((r, i) => {
    const intent = clean(r.intent) || `Intent ${i + 1}`;
    const response = clean(r.response) || "Sin respuesta";
    const examples = (r.examples || []).slice(0, 2).join(" | ");
    return `Intent: ${intent}\nEjemplos: ${examples}\nRespuesta ideal: ${response}`;
  }).join("\n\n").slice(0, 1500);
}

// ============================================
// CONTENIDO PARA GEMINI
// ============================================
function buildContents(history: any[], msg: string) {
  const contents: any[] = [];
  for (const h of history) contents.push({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] });
  contents.push({ role: "user", parts: [{ text: clean(msg).slice(0, 250) }] });
  return contents;
}

// ============================================
// SYSTEM PROMPT PRO (ACTUALIZADO)
// ============================================
function buildSystem(system: string, training: string, context: any, orderState: any = null) {
  const productActive = clean(context?.last_topic);
  let currentStep = "none";
  if (orderState) {
    if (orderState.status === "collecting_name") currentStep = "nombre";
    else if (orderState.status === "collecting_city") currentStep = "ciudad";
    else if (orderState.status === "collecting_address") currentStep = "dirección";
    else if (orderState.status === "waiting_exact_address") currentStep = "dirección exacta";
    else if (orderState.status === "draft" && !isOrderComplete(orderState)) currentStep = "completar datos";
    else if (orderState.status === "draft" && isOrderComplete(orderState)) currentStep = "confirmar pedido";
  }

  return `${clean(system) || "Eres un asistente de ventas profesional y persuasivo."}

╔══════════════════════════════════════════════════════════════╗
║                    REGLAS OBLIGATORIAS                       ║
╠══════════════════════════════════════════════════════════════╣
║ 1. RESPONDE COMO HUMANO: cálido, entusiasta, sin parecer bot║
║ 2. MANTÉN EL FLUJO: sigue conversación, no repreguntes datos║
║ 3. UN SOLO DATO POR VEZ: pide nombre → ciudad → dirección   ║
║ 4. SI EL CLIENTE DA VARIOS DATOS JUNTOS → extráelos y avanza║
║ 5. NUNCA digas "no tengo información" o respuestas genéricas ║
║ 6. CIERRA SIEMPRE con pregunta clara de siguiente paso      ║
╚══════════════════════════════════════════════════════════════╝

📌 CONTEXTO ACTUAL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔹 Producto activo: ${productActive || "ninguno (pregunta qué interesa)"}
🔹 Paso actual: ${currentStep}
🔹 Estado del pedido: ${orderState?.status || "no_order"}

💰 POLÍTICA DE PRECIOS:
- Envío GRATIS a todo Paraguay
- Pago CONTRA ENTREGA (pagás al recibir)
- Todos los precios son finales

🎯 OBJETIVO INMEDIATO:
${currentStep === "nombre" ? "Pregunta amablemente el NOMBRE COMPLETO del cliente." :
  currentStep === "ciudad" ? "Pregunta la CIUDAD (solo ciudades con cobertura)." :
  currentStep === "dirección" ? "Pide DIRECCIÓN EXACTA o ubicación de Google Maps." :
  currentStep === "dirección exacta" ? "El cliente dio dirección vaga. Pide EXPLÍCITAMENTE calle y número." :
  currentStep === "confirmar pedido" ? "El pedido está completo. PREGUNTA: '¿Confirmamos el pedido?' antes de enviar resumen." :
  `Ofrece el producto ${productActive || "del catálogo"} y pregúntale si quiere comprar hoy.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 ENTRENAMIENTO PERSONALIZADO:
${training}

REGLAS DE RESPUESTA:
- Máximo 2 oraciones por mensaje (excepto confirmación)
- Siempre termina con una pregunta que avance la venta
- Usa emojis moderadamente (😊, ✅, 📍, 🚚)

¡VENDES CON SEGUIMIENTO FLUIDO Y NATURAL!`.trim();
}

// ============================================
// GEMINI CALL
// ============================================
async function callGemini({ apiKey, model, system, contents, temperature, maxTokens }: any) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature, maxOutputTokens: maxTokens } }),
  });
  const data = await res.json();
  if (!res.ok) { console.error("Gemini error:", data); throw new Error("Error Gemini"); }
  return clean(data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n"));
}

// ============================================
// OBTENER ESTADO DEL PEDIDO
// ============================================
async function getOpenOrder(userId: string, phone: string) {
  try {
    const { data, error } = await supabase.from("orders").select("*").eq("user_id", userId)
      .in("status", ["draft", "collecting_name", "collecting_city", "collecting_address", "waiting_exact_address"])
      .order("created_at", { ascending: false }).limit(20);
    if (error || !data?.length) return null;
    const exact = data.find(row => clean(row.phone) === clean(phone));
    return exact || data[0] || null;
  } catch { return null; }
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { user_id, message, history, context, from_number } = req.body;
    if (!user_id || !message) return res.status(400).json({ error: "Faltan datos" });

    // CONFIG IA
    const { data: config } = await supabase.from("chat_ia_gemini").select("*").eq("user_id", user_id).single();
    if (!config?.is_active) return res.status(400).json({ error: "IA desactivada" });

    // OBTENER ESTADO DEL PEDIDO
    const openOrder = from_number ? await getOpenOrder(user_id, from_number) : null;

    // TRAINING
    const { data: training } = await supabase.from("training_data").select("intent, examples, response").eq("user_id", user_id).eq("is_active", true);
    const trainingContext = getTrainingContext(training || [], message, context);
    const contents = buildContents(sanitizeHistory(history), message);
    const system = buildSystem(config.system_instruction, trainingContext, context, openOrder);

    const response = await callGemini({
      apiKey: config.api_key,
      model: config.model || "gemini-2.5-flash",
      system,
      contents,
      temperature: config.temperature ?? 0.4,
      maxTokens: config.max_tokens ?? 300,
    });

    return res.status(200).json({ response });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error interno" });
  }
}
