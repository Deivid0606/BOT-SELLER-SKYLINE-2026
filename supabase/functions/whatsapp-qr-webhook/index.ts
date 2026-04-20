import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// Public webhook (no JWT). Baileys server POSTs events here.
// URL pattern: /functions/v1/whatsapp-qr-webhook?user_id=<uuid>
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const userId = url.searchParams.get("user_id");
    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing user_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify shared API key from Baileys server
    const apiKey = req.headers.get("X-API-Key");
    const { data: cfg } = await adminClient
      .from("baileys_server_config")
      .select("server_api_key")
      .limit(1)
      .maybeSingle();

    if (!cfg?.server_api_key || apiKey !== cfg.server_api_key) {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = await req.json();
    // payload examples:
    // { type: "connection.update", status: "connected"|"pending_qr"|"disconnected", qr?, phone? }
    // { type: "message", from: "5491122334455@s.whatsapp.net", text: "hola", timestamp: 123 }

    if (payload.type === "connection.update") {
      await adminClient.from("whatsapp_qr_sessions").upsert({
        user_id: userId,
        status: payload.status || "disconnected",
        last_qr: payload.qr || null,
        connected_phone: payload.phone || null,
        connected_at: payload.status === "connected" ? new Date().toISOString() : null,
      }, { onConflict: "user_id" });
    } else if (payload.type === "message") {
      // TODO: feed into bot/inbox flow. For now just log.
      console.log("Inbound QR message:", { userId, from: payload.from, text: payload.text });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("whatsapp-qr-webhook error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
