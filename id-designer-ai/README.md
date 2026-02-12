# id-designer-ai

Aplicación web profesional para generar diseño instruccional con IA (Gemini API), orientada a producción de cursos, módulos y OVAs con enfoque ADDIE + alineación constructiva.

## Stack

- Frontend: Next.js (App Router) + TypeScript + Tailwind CSS
- Backend: Route Handlers en Next.js (`/app/api/*`)
- Persistencia: SQLite + Prisma
- Autenticación: **single-user mode** (password en `.env`) con cookie HttpOnly firmada
- Pruebas mínimas: Vitest

## Funcionalidades implementadas

- Nuevo proyecto instruccional desde brief completo
- Generación IA en JSON estricto con validación Zod
- Repair pass automático (1 intento) si la IA responde JSON inválido
- Vista de resultados con:
  - mapa instruccional
  - outcomes por Bloom
  - secuencia de contenidos
  - actividades y evaluación con rúbricas
  - matriz de alineación
  - notas de producción para LMS
- Panel de calidad interno (alineación + coherencia + carga cognitiva)
- Versionado persistente de cada generación (prompt, parámetros, respuesta, timestamp)
- Edición guiada por instrucción para regenerar secciones específicas
- Exportación JSON y Markdown
- Rate limiting por IP (default 20 req/min)
- Caching por hash de brief+parámetros
- Estimación de tokens/costo por request
- Safety mode `normal` / `estricto`
- Logging con `requestId`
- Progreso en vivo de generación con streaming SSE

## Estructura

```txt
id-designer-ai/
  app/
    api/
      generate/route.ts
      generate/stream/route.ts
      login/route.ts
      logout/route.ts
      versions/[id]/export/route.ts
    login/page.tsx
    projects/new/page.tsx
    projects/[id]/page.tsx
    components/*
  lib/
    auth/
    cache/
    gemini/
    prompts/
    services/
    utils/
    validators/
  prisma/
    schema.prisma
    migrations/
  docs/
    architecture.md
    security.md
    deployment-checklist.md
  tests/
    *.test.ts
```

## Requisitos

- Node.js 20+
- npm 10+

## Configuración local

1. Instala dependencias:

```bash
npm install
```

2. Crea `.env` desde ejemplo:

```bash
cp .env.example .env
```

3. Configura variables obligatorias:

- `SINGLE_USER_PASSWORD`: clave de acceso de la app
- `SESSION_SECRET`: secreto para firmar cookie
- `GEMINI_API_KEY`: API key de Gemini
- `GEMINI_MODEL`: por defecto `gemini-2.5-flash`

4. Prepara base de datos:

```bash
npm run prisma:generate
npm run prisma:migrate
```

5. Ejecuta en desarrollo:

```bash
npm run dev
```

Abrir: [http://localhost:3000](http://localhost:3000)

## Variables de entorno

Referencia completa en `.env.example`.

- `DATABASE_URL`: SQLite local (`file:./dev.db`)
- `APP_URL`: URL base de la app
- `SINGLE_USER_PASSWORD`: autenticación single-user
- `SESSION_SECRET`: firma de cookie
- `GEMINI_API_KEY`: credencial privada (solo server)
- `GEMINI_MODEL`: modelo por defecto
- `DEFAULT_SAFETY_MODE`: `normal` o `estricto`
- `CACHE_TTL_MINUTES`: TTL del cache
- `RATE_LIMIT_PER_MINUTE`: límite por IP
- `INPUT_TOKEN_COST_PER_MILLION` / `OUTPUT_TOKEN_COST_PER_MILLION`: costos aproximados

## Comandos

```bash
npm run dev
npm run build
npm run start
npm run test
npm run test:watch
npm run prisma:generate
npm run prisma:migrate
npm run prisma:studio
```

## Despliegue en Vercel (pruebas funcionales)

1. Login:

```bash
npx vercel login
```

2. Link del proyecto:

```bash
npx vercel link
```

3. Variables recomendadas en Vercel (Preview/Production):

- `NODE_ENV=production`
- `APP_URL` con la URL del deployment
- `DATABASE_URL=file:/tmp/dev.db` (pruebas rápidas, efímero) o DB externa para persistencia real
- `SINGLE_USER_PASSWORD`
- `SESSION_SECRET`
- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-2.5-flash`
- `DEFAULT_SAFETY_MODE=normal`
- `CACHE_TTL_MINUTES=1440`
- `RATE_LIMIT_PER_MINUTE=20`

4. Deploy:

```bash
npx vercel --prod
```

El proyecto incluye `vercel.json` con build command:

```bash
npm run prisma:generate && npm run build
```

## Integración Gemini (server-side)

- Endpoint usado:
  - `POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent`
- Headers:
  - `x-goog-api-key`
  - `Content-Type: application/json`
- Implementación:
  - archivo: `lib/gemini/client.ts`
  - ejecución desde backend (`/api/generate` y `/api/generate/stream`) para no exponer clave
  - `responseMimeType: application/json`
  - schema JSON solicitado + validación Zod
  - reparación automática si la salida no valida

## Seguridad

Resumen (detalle en `docs/security.md`):

- API key nunca expuesta en cliente
- Autenticación por cookie HttpOnly firmada
- Rate limiting por IP
- Sanitización de campos y validación Zod
- Control de tamaño de payload
- Safety settings configurables
- Mensajes de error claros sin filtrar secretos

## Pruebas

Incluye pruebas mínimas:

- `tests/schema-validation.test.ts`: valida schema de salida
- `tests/generate-endpoint.test.ts`: endpoint `/api/generate` con mocks
- `tests/generate-stream-endpoint.test.ts`: endpoint `/api/generate/stream` con mocks
- `tests/versioning-db.test.ts`: versionado en DB (incremento secuencial)

## Documentación adicional

- Arquitectura: `docs/architecture.md`
- Seguridad: `docs/security.md`
- Despliegue: `docs/deployment-checklist.md`

## Definition of Done

- [x] Flujo completo Nuevo Proyecto → Generación → Resultado
- [x] Esquema JSON de salida implementado y validado con Zod
- [x] Prompt de sistema y template de usuario implementados
- [x] Integración Gemini server-side con API key privada
- [x] Repair pass automático para JSON inválido
- [x] Versionado en SQLite/Prisma con prompt+parámetros+respuesta
- [x] Panel de calidad con chequeo de alineación y coherencia
- [x] Rate limit por IP y anti-abuso básico
- [x] Caching por brief+parámetros
- [x] Estimación de tokens y costo por request
- [x] Exportación JSON + Markdown
- [x] Edición guiada para regeneración parcial
- [x] Streaming SSE para ver progreso en vivo
- [x] Pruebas mínimas incluidas
- [x] Documentación técnica y checklist de despliegue
