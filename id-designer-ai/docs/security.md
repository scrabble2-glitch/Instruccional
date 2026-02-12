# Seguridad

## Controles implementados

- API key Gemini solo en servidor (`lib/gemini/client.ts`)
- Cookie de sesión `HttpOnly`, `SameSite=Lax`, firmada con `SESSION_SECRET`
- Autenticación requerida en páginas privadas y APIs sensibles
- Rate limiting por IP (`RATE_LIMIT_PER_MINUTE`, default 20/min)
- Límite de tamaño de payload para mitigar abuso
- Validación Zod de inputs y outputs
- Sanitización de strings para reducir entrada malformada
- Safety mode configurable (`normal` / `estricto`)

## Riesgos conocidos del MVP

- Rate limit en memoria (no distribuido entre instancias)
- Single-user auth no sustituye IAM empresarial
- Estimación de costos depende de metadata de proveedor o heurística

## Recomendaciones para producción

- Mover rate limit a Redis o gateway
- Implementar rotación de secretos y vault
- Añadir CSP y hardening de cabeceras en reverse proxy
- Auditoría y retención de logs con trazabilidad por `requestId`
- Incorporar SSO/NextAuth para escenarios multiusuario
