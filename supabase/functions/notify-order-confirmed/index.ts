import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Public-ish (called by DB trigger). Validates payload shape.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { order_id, user_id } = await req.json();
    if (!order_id || !user_id) {
      return new Response(JSON.stringify({ error: "Missing order_id or user_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Cargar orden
    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("*")
      .eq("id", order_id)
      .maybeSingle();

    if (orderErr || !order) {
      console.error("Order not found", orderErr);
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Cargar config del vendedor
    const { data: cfg } = await admin
      .from("whatsapp_config")
      .select("notify_enabled, notify_channel, notify_phones, phone_number_id, permanent_token")
      .eq("user_id", user_id)
      .maybeSingle();

    if (!cfg?.notify_enabled || !cfg?.notify_phones?.length) {
      return new Response(JSON.stringify({ ok: true, skipped: "notifications_disabled_or_no_phones" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Armar mensaje fijo
    const msg = [
      "🎉 *Nuevo pedido confirmado*",
      "",
      `👤 Cliente: ${order.nombre || "—"}`,
      `📱 Tel: ${order.telefono || "—"}`,
      `📦 Producto: ${order.producto || "—"}${order.cantidad ? ` (x${order.cantidad})` : ""}`,
      `💰 Monto: ${order.monto || "—"}`,
      `📍 Dirección: ${order.calle || "—"}${order.ciudad ? `, ${order.ciudad}` : ""}`,
      `💳 Pago: ${order.payment_type || "—"}`,
      order.fecha ? `📅 Fecha: ${order.fecha}` : null,
      order.referencia ? `🔖 Ref: ${order.referencia}` : null,
      order.location_url ? `🗺️ ${order.location_url}` : null,
    ].filter(Boolean).join("\n");

    const phones = (cfg.notify_phones as string[]).filter(p => p && p.trim().length > 0).slice(0, 3);
    const results: any[] = [];

    // 4. Enviar por canal elegido
    if (cfg.notify_channel === "qr") {
      // Vía Baileys
      const { data: serverCfg } = await admin
        .from("baileys_server_config")
        .select("server_url, server_api_key")
        .limit(1)
        .maybeSingle();

      if (!serverCfg?.server_url || !serverCfg?.server_api_key) {
        return new Response(JSON.stringify({ error: "baileys_not_configured" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const phone of phones) {
        try {
          const r = await fetch(`${serverCfg.server_url}/sessions/${user_id}/send`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": serverCfg.server_api_key,
            },
            body: JSON.stringify({ phone: phone.replace(/\D/g, ""), message: msg }),
          });
          results.push({ phone, ok: r.ok, status: r.status });
        } catch (e) {
          results.push({ phone, ok: false, error: (e as Error).message });
        }
      }
    } else {
      // Vía API Meta
      if (!cfg.phone_number_id || !cfg.permanent_token) {
        return new Response(JSON.stringify({ error: "meta_api_not_configured" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const phone of phones) {
        try {
          const r = await fetch(`https://graph.facebook.com/v20.0/${cfg.phone_number_id}/messages`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${cfg.permanent_token}`,
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phone.replace(/\D/g, ""),
              type: "text",
              text: { body: msg },
            }),
          });
          const body = await r.json().catch(() => ({}));
          results.push({ phone, ok: r.ok, status: r.status, body });
        } catch (e) {
          results.push({ phone, ok: false, error: (e as Error).message });
        }
      }
    }

    console.log("notify-order-confirmed results:", { order_id, results });

    return new Response(JSON.stringify({ ok: true, sent: results.length, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("notify-order-confirmed error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
