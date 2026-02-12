# Checklist de Despliegue

## Previo al deploy

- [ ] Ejecutar `npx vercel login` y `npx vercel link`
- [ ] Configurar variables de entorno seguras (`.env.production`)
- [ ] Definir `SINGLE_USER_PASSWORD` robusta
- [ ] Definir `SESSION_SECRET` robusto (>=32 chars)
- [ ] Configurar `GEMINI_API_KEY` solo server-side
- [ ] Configurar `DATABASE_URL` (para pruebas rápidas: `file:/tmp/dev.db`; para persistencia real: DB externa)
- [ ] Ajustar costos/tokens por modelo en env
- [ ] Ejecutar `npm run prisma:generate`
- [ ] Ejecutar migraciones en entorno destino
- [ ] Ejecutar `npm run test`
- [ ] Ejecutar `npm run build`

## Infraestructura

- [ ] HTTPS habilitado
- [ ] Persistencia de SQLite respaldada (o migrar a Postgres)
- [ ] Política de backups de DB
- [ ] Logs centralizados con correlación por `requestId`

## Post deploy

- [ ] Validar login/logout
- [ ] Validar generación nueva
- [ ] Validar edición guiada parcial
- [ ] Validar export JSON/Markdown
- [ ] Validar rate limiting (429)
- [ ] Revisar consumo y costo estimado
