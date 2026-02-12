# Arquitectura

## Visión general

`id-designer-ai` usa una arquitectura full-stack en Next.js App Router para mantener frontend y backend en un solo repositorio, con separación clara de responsabilidades:

- `app/*`: UI, navegación y Route Handlers
- `lib/*`: dominio, integración IA, validadores y servicios
- `prisma/*`: modelo de datos y migraciones

## Flujo principal

1. Usuario crea brief en `/projects/new`.
2. Frontend envía `POST /api/generate`.
   - Alternativa en vivo: `POST /api/generate/stream` (SSE).
3. Backend valida/sanitiza payload (Zod + sanitización).
   - Si `DATABASE_URL` es SQLite, se asegura creación de tablas base en runtime.
4. Aplica rate limiting por IP y autentica sesión.
5. Busca cache por hash (`brief + parámetros + baseVersion`).
6. Si no hay cache, llama Gemini con prompts y JSON mode.
7. Valida salida JSON con Zod; si falla, ejecuta un repair pass.
8. Ejecuta validador interno de calidad.
9. Persiste versión en SQLite/Prisma.
10. UI renderiza resultado y versiones en `/projects/[id]`.

## Modelo de datos

- `Project`: brief base y metadatos del proyecto
- `Version`: snapshot por generación (prompt, params, respuesta, costo, tokens)
- `CacheEntry`: respuesta reutilizable para requests equivalentes

## Decisiones clave

- **Auth single-user mode**:
  - reduce complejidad MVP
  - evita dependencia de NextAuth en esta versión
  - mantiene protección mínima de acceso
- **JSON estricto + repair pass**:
  - prioriza robustez para exportación y uso LMS
- **Validador interno de alineación**:
  - permite control de calidad adicional sobre salida de IA
- **Server-side Gemini**:
  - evita exposición de API key

## Extensibilidad

El diseño actual permite agregar:

- Exportación PDF
- Multiusuario con NextAuth
- Integración directa con Moodle (API/import)
