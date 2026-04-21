# Meta Webhook Package

## Archivos incluidos
- `api/webhook.js`
- `vercel.json`
- `package.partial.json`

## Dónde copiar
Copia `api/` y `vercel.json` en la raíz de tu proyecto, al mismo nivel que tu `package.json`.

## Importante
En tu `package.json` real, verifica:
- `"type": "module"`
- dependencia `@supabase/supabase-js`

## Variables de entorno en Vercel
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## URL del webhook
Usa:
`https://TU-DOMINIO.vercel.app/api/webhook`

## Verify token
El código viene con:
`miTokenSeguro2026`

Ese valor debe coincidir exactamente en Meta.
