# Agent Development Tooling

Analisis de mantenibilidad, calidad y flujo de trabajo para `collectool-backend`.

Este documento cubre solo el backend. El repositorio inspeccionado es un proyecto AWS CDK en JavaScript que define infraestructura y una Lambda HTTP para la API admin/public runtime de Collectool.

## Baseline Inspeccionado

Estado observado:

- Stack: AWS CDK v2 con JavaScript CommonJS.
- Runtime: Lambda Node.js 20 ARM64.
- Infra: API Gateway HTTP API, Cognito user pools/clients/groups, DynamoDB on-demand, CloudWatch Logs.
- API: handler Lambda propio en `src/handler.js`, routing manual por path/method.
- Lógica de negocio separada parcialmente en `src/runtime.js` y seed en `src/seed.js`.
- Package manager: npm, con `package-lock.json`.
- Tests: Jest para CDK template assertions y runtime logic.
- Scripts: `test`, `synth`, `synth:dev`, `synth:prod`, `deploy:dev`, `deploy:prod`, `cdk`.
- Docs existentes: `README.md`, `BACKEND_REIMPLEMENTATION_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/API_CONTRACTS.md`.
- CI/CD: no se encontro `.github/workflows` propio en `collectool-backend`.
- Lint/formato: no hay ESLint, Prettier ni script de formato.
- Typecheck: no hay TypeScript ni `checkJs`/JSDoc typecheck.
- Env docs: documentadas en README/Deployment, pero no existe `.env.example`.
- Deuda visible:
  - `src/handler.js` concentra routing, DynamoDB marshaling, Cognito mapping, metrics, CRUD y runtime endpoint.
  - Hay marshaling DynamoDB manual en vez de `@aws-sdk/lib-dynamodb`.
  - No hay tests unitarios directos del handler ni mocks de AWS SDK.
  - No hay validacion de contratos compartida contra frontend.
  - No hay CI ni branch protection documentada para backend.
  - `find` muestra artefactos locales `cdk.out` y un directorio anidado `collectool-backend/.git`; `cdk.out` esta ignorado, pero el nested repo debe revisarse.

Verificacion ejecutada:

- `npm test`: pasa, 4 tests.
- `npm run synth:dev -- -c corsAllowedOrigins=http://localhost:3000 -c seedInitialData=false`: pasa.

## Implementacion Aplicada

Luego de las decisiones humanas, se implemento el lote de tooling y workflow backend:

- Migracion de fuente backend a TypeScript (`bin`, `lib`, `src`) con build a `dist/`.
- Bundling de Lambda desde `src/handler.ts` con `aws-lambda-nodejs` y `esbuild`.
- `npm run check`, typecheck estricto de TypeScript, ESLint, Prettier y estandarizacion npm/Node 24.
- CI, deploy dev/prod con OIDC, commitlint, changelog, Dependabot, CodeQL, audit y `cdk-nag`.
- `AGENTS.md`, `.env.example`, PR template, documentacion de branch protection y guia final `docs/DEVELOPMENT_WORKFLOW.md`.
- Fixtures JSON, JSON Schema y tests de contrato alineados con `collectool-admin`.
- OpenAPI 3.1 en `docs/openapi.yaml`, validado con Redocly CLI e incluido en `npm run check`.
- `cdk-nag` obligatorio dentro de `npm run check`, con supresiones puntuales documentadas en CDK.
- Handler integration tests con `aws-sdk-client-mock`.
- Reemplazo de marshaling DynamoDB manual por `DynamoDBDocumentClient`.
- Observabilidad base: logs estructurados, access logs HTTP API y alarmas CloudWatch para Lambda errors, throttles y duration.
- Seed policy final: `SEED_INITIAL_DATA=false` para shared dev/prod; `true` solo para local/manual sandbox.
- Scripts reproducibles para GitHub Environments, stack outputs y health checks.

Quedan como trabajo incremental posterior la division profunda de `src/handler.ts` en router/services/repositories y la decision humana de producto/seguridad sobre MFA/Cognito Plus.

## Recomendaciones

### 1. Script Unico `check`

**Estado:** Implemented

**Que es:** Un comando canonico para validar el backend antes de cerrar una tarea o aprobar un PR.

**Estado actual en el proyecto:** `npm run check` existe y es usado por CI/deploy. Ejecuta typecheck, lint, formato, OpenAPI, tests y `cdk-nag` obligatorio.

**Como se implementaria:**

- Mantener en `package.json`:
  - `check`: `npm run typecheck && npm run lint && npm run format:check && npm run openapi:lint && npm test && npm run security:iac`

**Que mejoraria:** Reduce ambiguedad para humanos y agentes. Hace que el backend tenga una definicion clara de "listo".

**Riesgos o costos:** Si `synth` imprime plantillas enormes, el output de CI puede ser ruidoso. Puede resolverse con `cdk synth --quiet` si aplica o redirigiendo artifacts.

**Prioridad sugerida:** Alta

**Decision recomendada:** Mantenerlo como unica compuerta local/CI.

**Criterios de aceptacion:**

- `npm run check` existe.
- El comando corre localmente sin parametros secretos.
- CI usa el mismo comando o una secuencia equivalente documentada.

## DESICION HUMANA

Implementar

### 2. Typecheck Estricto

**Estado:** Implemented

**Que es:** Verificacion estatica de tipos para infraestructura y Lambda.

**Estado actual en el proyecto:** El backend fue migrado a TypeScript en `bin/`, `lib/` y `src/`. `tsconfig.json` mantiene `strict: true`, `npm run typecheck` valida fuentes y `npm run build` emite `dist/`.

**Como se implementaria:**

- Mantener `tsconfig.json` para validacion y `tsconfig.build.json` para emision.
- Mantener CDK ejecutando `npm run build` antes de iniciar `dist/bin/collectool-backend.js`.
- Mantener Lambda bundling desde `src/handler.ts` con `aws-lambda-nodejs`.

**Que mejoraria:** Detecta contratos rotos antes de deploy. Ayuda mucho a agentes a modificar handler/CDK sin inventar shapes.

**Riesgos o costos:** El build ahora es requerido antes de CDK/Jest. Los tests importan modulos compilados desde `dist/`, por lo que `npm test` ejecuta build primero.

**Prioridad sugerida:** Alta

**Decision recomendada:** Mantener TypeScript y avanzar gradualmente desde tipos amplios hacia contratos mas precisos.

**Criterios de aceptacion:**

- `npm run typecheck` existe.
- `tsconfig.json` incluye `src`, `lib` y `bin`.
- `tsconfig.build.json` emite `dist/`.
- `npm run typecheck` pasa en CI.

## DESICION HUMANA

Implementar

### 3. Linting

**Estado:** Pending

**Que es:** Reglas automaticas para estilo, errores comunes y patrones peligrosos.

**Estado actual en el proyecto:** No hay ESLint config. El backend tiene rutas regex, AWS SDK calls, permisos IAM y marshaling manual que se beneficiarian de reglas basicas.

**Como se implementaria:**

- Agregar ESLint flat config para Node/CommonJS.
- Reglas iniciales conservadoras:
  - `no-unused-vars`
  - `no-undef`
  - `eqeqeq`
  - `curly`
  - `no-console` como warn o permitir `console.warn/error` en Lambda.
- Script `lint`: `eslint . --ignore-pattern cdk.out`.

**Que mejoraria:** Captura imports muertos, variables mal nombradas y errores triviales antes de deploy.

**Riesgos o costos:** Puede generar ruido inicial por estilo CommonJS. Conviene empezar con pocas reglas.

**Prioridad sugerida:** Alta

**Decision recomendada:** Implementar con reglas minimas y subir severidad gradualmente.

**Criterios de aceptacion:**

- `npm run lint` existe.
- `npm run lint` pasa en clean checkout.
- `cdk.out` y `node_modules` quedan ignorados.

## DESICION HUMANA

Implementar

### 4. Formato Automatico

**Estado:** Pending

**Que es:** Prettier para formatear JS/JSON/Markdown.

**Estado actual en el proyecto:** No hay Prettier config. El código actual usa comillas simples y punto y coma, pero no hay enforcement.

**Como se implementaria:**

- Agregar `.prettierrc.json`:
  - `singleQuote: true`
  - `semi: true`
  - `trailingComma: "es5"`
- Agregar `.prettierignore` con `node_modules`, `cdk.out`, `.cdk.staging`, coverage.
- Scripts:
  - `format`
  - `format:check`

**Que mejoraria:** Reduce churn en PRs y evita que agentes produzcan diffs grandes por estilo.

**Riesgos o costos:** Primera corrida puede tocar muchos archivos. Conviene hacerlo en PR separado.

**Prioridad sugerida:** Alta

**Decision recomendada:** Implementar en PR separado y luego exigir en `check`.

**Criterios de aceptacion:**

- `npm run format:check` pasa.
- `cdk.out` no se formatea.
- Docs nuevas se mantienen consistentes.

## DESICION HUMANA

Implementar

### 5. Estandarizacion de Package Manager y Node

**Estado:** Partially implemented

**Que es:** Definir npm y version de Node como contrato de desarrollo.

**Estado actual en el proyecto:** Hay `package-lock.json`, pero no hay `.nvmrc`, `engines` ni AGENTS que prohíba lockfiles alternativos. CDK Lambda usa Node.js 20, mientras el entorno local no esta fijado.

**Como se implementaria:**

- Agregar `.nvmrc` con `20` o la version LTS que se decida.
- Agregar `engines.node` en `package.json`.
- Documentar "npm only" en `AGENTS.md`.
- Agregar `.npmrc` opcional con `engine-strict=true` si se quiere enforcement fuerte.

**Que mejoraria:** Evita diferencias entre agentes, CI y Lambda runtime.

**Riesgos o costos:** Si desarrolladores usan otra version local, tendran que cambiarla.

**Prioridad sugerida:** Alta

**Decision recomendada:** Usar Node 20 para alinear con Lambda.

**Criterios de aceptacion:**

- `.nvmrc` existe.
- `package.json` declara engines.
- CI usa la misma version.

## DESICION HUMANA

Implementar para la version 24 momentanemente en caso de ser posible

### 6. Unit Tests

**Estado:** Partially implemented

**Que es:** Tests rapidos sobre lógica pura e infraestructura sintetizada.

**Estado actual en el proyecto:** Jest cubre `src/runtime.js` y algunos assertions CDK. No cubre seed, metrics, auth parsing ni routing del handler.

**Como se implementaria:**

- Mantener tests de runtime.
- Agregar tests para:
  - `isConditionMet` con todos los operadores.
  - `validateFlow` con action target faltante, option entity faltante y duplicate option values.
  - seed data shape.
  - mapping de Cognito users.
- Extraer funciones puras desde `handler.js` para testearlas sin AWS.

**Que mejoraria:** Protege el dominio Collection Builder y reduce regresiones al tocar publish/preview.

**Riesgos o costos:** Hay que hacer pequeñas extracciones desde `handler.js`.

**Prioridad sugerida:** Alta

**Decision recomendada:** Expandir tests puros antes de agregar mas endpoints.

**Criterios de aceptacion:**

- Tests cubren operadores `EQUALS`, `INCLUDES`, `NOT_INCLUDES`, `IS_SET`.
- Tests cubren validaciones principales de flow.
- `npm test` sigue siendo rapido.

### 7. Integration Tests de Handler con AWS Mockeado

**Estado:** Pending

**Que es:** Tests del Lambda handler completo simulando API Gateway y AWS SDK.

**Estado actual en el proyecto:** No se importa `src/handler.js` en tests. Ademas `@aws-sdk/client-dynamodb` y `@aws-sdk/client-cognito-identity-provider` no estan en `package.json`; se asume disponibilidad en Lambda runtime.

**Como se implementaria:**

- Agregar dependencias dev o runtime explicitas para AWS SDK clients.
- Usar `aws-sdk-client-mock` o mocks Jest manuales.
- Crear fixtures de eventos API Gateway HTTP API.
- Cubrir:
  - `/health`
  - `/admin/session`
  - auth group 403
  - category create duplicate
  - flow save validation error
  - public runtime no expone drafts.

**Que mejoraria:** Asegura que el router manual y los responses `{ message }` no se rompan.

**Riesgos o costos:** Mockear SDK v3 puede agregar complejidad. Requiere separar clientes o inyectarlos.

**Prioridad sugerida:** Alta

**Decision recomendada:** Implementar tras extraer router/services o introducir inyeccion de dependencias ligera.

**Criterios de aceptacion:**

- Tests invocan `handler(event)` directamente.
- AWS SDK queda mockeado sin red real.
- Se validan status codes y response JSON.

## DESICION HUMANA

Implementar

### 8. Fixtures de Contrato

**Estado:** Pending

**Que es:** Fixtures JSON compartibles para request/response de endpoints.

**Estado actual en el proyecto:** La spec documenta shapes, pero no hay fixtures versionados en backend. Tests crean flows inline.

**Como se implementaria:**

- Crear `test/fixtures/` con:
  - `admin-session.json`
  - `users-response.json`
  - `collection-category.json`
  - `collection-flow.json`
  - `runtime-response.json`
- Reusar esos fixtures en tests del handler y runtime.
- Coordinar nombres con `collectool-admin` para detectar drift.

**Que mejoraria:** Permite que agentes comparen contrato real vs esperado sin leer toda la UI.

**Riesgos o costos:** Duplicar fixtures con frontend puede generar drift si no se agrega validacion.

**Prioridad sugerida:** Media

**Decision recomendada:** Crear fixtures backend y luego automatizar validacion contract con frontend.

**Criterios de aceptacion:**

- Fixtures viven en `test/fixtures`.
- Tests los importan.
- Docs de API apuntan a esos fixtures.

## DESICION HUMANA

Implementar, revisar el contrato con el admin si es necesario ya que es una de las dos aplicaciones que lo involucra

### 9. Validacion de Contratos Backend/Frontend

**Estado:** Partially implemented

**Que es:** Verificar que backend y admin frontend comparten shapes de API.

**Estado actual en el proyecto:** Hay `docs/API_CONTRACTS.md` y `BACKEND_REIMPLEMENTATION_SPEC.md`, pero no hay schemas ejecutables ni tests de contrato.

**Como se implementaria:**

- Definir JSON Schema o Zod schemas para responses principales.
- Validar responses construidas por tests contra schemas.
- Publicar schemas desde backend o copiarlos con version.
- En frontend, validar fixtures/MSW contra los mismos schemas.

**Que mejoraria:** Evita romper admin al cambiar backend. Da a agentes una fuente de verdad ejecutable.

**Riesgos o costos:** Requiere decidir donde vive el contrato compartido entre repos separados.

**Prioridad sugerida:** Alta

**Decision recomendada:** Empezar con JSON Schema en backend y documentar versionado.

**Criterios de aceptacion:**

- Hay schemas para session, users, metrics, category, entity, flow summary y runtime.
- Tests backend validan fixtures/responses contra schemas.
- Cambios de contrato requieren actualizar schema y docs.

## DESICION HUMANA

Implementar, revisar el contrato con el admin que es una de las dos aplicaciones que lo involucra

### 10. CI con GitHub Actions

**Estado:** Pending

**Que es:** Workflow automatizado para PR/push.

**Estado actual en el proyecto:** No hay `.github/workflows` dentro de `collectool-backend`.

**Como se implementaria:**

- Crear `.github/workflows/ci.yml`:
  - checkout
  - setup-node con Node 20
  - `npm ci`
  - `npm run check`
- Si este repo vive como repo separado, workflow en su raiz.
- Si se consolida monorepo, usar path filters para `collectool-backend/**`.

**Que mejoraria:** Evita merges sin tests/synth. Fundamental para agentes automaticos.

**Riesgos o costos:** CDK synth puede requerir bootstrap version parameter en template, pero synth local actual pasa sin credenciales.

**Prioridad sugerida:** Alta

**Decision recomendada:** Implementar apenas exista `check`.

**Criterios de aceptacion:**

- PRs corren CI.
- CI usa `npm ci`.
- CI falla si tests o synth fallan.

## DESICION HUMANA

Implementar check antes de toods los prs a prod y a dev

### 11. Deploy CI/CD con OIDC

**Estado:** Partially implemented

**Que es:** Pipeline documentado y seguro para desplegar dev/prod.

**Estado actual en el proyecto:** `docs/DEPLOYMENT.md` incluye ejemplos, pero no hay workflow real. La doc recomienda OIDC.

**Como se implementaria:**

- Crear workflows:
  - `deploy-dev.yml` para branch dev o manual.
  - `deploy-prod.yml` para main con environment protection.
- Usar `aws-actions/configure-aws-credentials` con OIDC, no access keys.
- Ejecutar `npm run check` antes de deploy.
- Parametrizar `corsAllowedOrigins` y `seedInitialData` con GitHub vars.

**Que mejoraria:** Hace reproducible el despliegue y reduce secretos de larga vida.

**Riesgos o costos:** Requiere configurar IAM role OIDC y environments en GitHub.

**Prioridad sugerida:** Alta

**Decision recomendada:** Implementar luego de CI base.

**Criterios de aceptacion:**

- No se usan `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`.
- Prod requiere approval de environment.
- Dev/prod usan `-c environment` correcto.

## DESICION HUMANA

Implementar

### 12. Branch Protection

**Estado:** Pending

**Que es:** Reglas del repositorio para evitar merges sin validacion.

**Estado actual en el proyecto:** No hay documentacion ni evidencia de branch protection backend.

**Como se implementaria:**

- Proteger `main`.
- Requerir CI passing.
- Requerir PR review.
- Requerir branch up to date si el equipo lo prefiere.
- Requerir deploy prod solo desde main.

**Que mejoraria:** Reduce riesgo de cambios de infraestructura inseguros.

**Riesgos o costos:** Puede ralentizar hotfixes si no hay proceso de bypass.

**Prioridad sugerida:** Media

**Decision recomendada:** Activar cuando exista CI.

**Criterios de aceptacion:**

- `main` no acepta push directo.
- CI backend es required check.
- Deploy prod esta atado a main/protected environment.

## DESICION HUMANA

Implementar

### 13. Conventional Commits

**Estado:** Pending

**Que es:** Convencion de mensajes para historial, changelogs y automatizacion.

**Estado actual en el proyecto:** No hay commitlint config ni hooks en backend.

**Como se implementaria:**

- Agregar `@commitlint/cli` y `@commitlint/config-conventional`.
- Crear `commitlint.config.cjs`.
- Agregar workflow `commitlint.yml` o hook local si se adopta Husky.

**Que mejoraria:** Hace mas facil entender cambios de infra/API y automatizar releases.

**Riesgos o costos:** Friccion menor para contribuyentes.

**Prioridad sugerida:** Baja/Media

**Decision recomendada:** Implementar si el equipo ya lo usa en frontend o quiere consistencia entre repos.

**Criterios de aceptacion:**

- PR title o commits se validan.
- Docs mencionan ejemplos aceptados.

## DESICION HUMANA

Implementar, ademas en el momento de merging a prod realizar la ejecucion de alguna tool para generar el archivo de changelog

### 14. PR Template

**Estado:** Pending

**Que es:** Checklist de revision para cambios backend/infra.

**Estado actual en el proyecto:** No hay `.github/pull_request_template.md`.

**Como se implementaria:**

- Crear template con secciones:
  - Summary
  - Infra changes
  - API contract changes
  - Data migration / retention impact
  - Validation
  - Rollback notes

**Que mejoraria:** Obliga a pensar en blast radius de CDK y contratos antes de merge.

**Riesgos o costos:** Ninguno relevante.

**Prioridad sugerida:** Media

**Decision recomendada:** Implementar con CI.

**Criterios de aceptacion:**

- PRs muestran checklist backend.
- Incluye `npm run check` y `npm run synth:prod`.

### DESICION HUMANA

implementar, alinear con el proyecto collectool admin

### 15. Documentacion para Agentes (`AGENTS.md`)

**Estado:** Pending

**Que es:** Manual operativo local para agentes y humanos.

**Estado actual en el proyecto:** No existe `AGENTS.md` en backend.

**Como se implementaria:**

- Crear `AGENTS.md` con:
  - npm only.
  - No tocar deploy prod sin instruccion.
  - Ejecutar `npm run check`.
  - Actualizar docs si cambian endpoints/env/infra.
  - No commitear `cdk.out`, credenciales ni outputs locales.
  - Mantener runtime logic en `src/runtime.js` o modulos puros.

**Que mejoraria:** Reduce cambios erraticos de agentes automaticos.

**Riesgos o costos:** Debe mantenerse actualizado.

**Prioridad sugerida:** Alta

**Decision recomendada:** Implementar pronto.

**Criterios de aceptacion:**

- `AGENTS.md` existe.
- Menciona checks, docs, env y deploy safety.
- Las recomendaciones no contradicen README/DEPLOYMENT.

### DESICION HUMANA

implementar, alinear con el proyecto collectool admin

### 16. `.env.example`

**Estado:** Pending

**Que es:** Plantilla de variables/config de deploy local.

**Estado actual en el proyecto:** Variables estan en README/DEPLOYMENT, pero no hay `.env.example`.

**Como se implementaria:**

- Crear `.env.example`:
  - `DEPLOY_ENV=dev`
  - `ALLOWED_ADMIN_GROUPS=admin,collectool-admins`
  - `CORS_ALLOWED_ORIGINS=http://localhost:3000`
  - `SEED_INITIAL_DATA=true`
- Documentar que CDK context tiene prioridad.

**Que mejoraria:** Onboarding mas rapido y menor chance de deploy con defaults incorrectos.

**Riesgos o costos:** Puede confundirse con runtime Lambda env; aclarar que es para CDK/deploy.

**Prioridad sugerida:** Media

**Decision recomendada:** Implementar junto con AGENTS.

**Criterios de aceptacion:**

- `.env.example` existe.
- README lo referencia.
- No contiene secretos.
  \

### DESICION HUMANA

implementar

### 17. Manejo de Errores y Observabilidad

**Estado:** Partially implemented

**Que es:** Errores consistentes, logs utiles y diagnostico operacional.

**Estado actual en el proyecto:** Responses usan `{ message }`, hay `/health`, y errores inesperados loguean `console.error`. No hay request id en responses/logs, no hay structured logging, no hay alarmas ni dashboard.

**Como se implementaria:**

- Incluir `requestId` en logs y opcionalmente responses 500.
- Crear helper de errores con status/message/code.
- Agregar CloudWatch alarms para 5xx y Lambda errors.
- Agregar metric filters para auth/validation errors si aplica.

**Que mejoraria:** Debug en AWS mucho mas rapido.

**Riesgos o costos:** Alarmas pueden generar ruido al principio.

**Prioridad sugerida:** Media

**Decision recomendada:** Implementar request id + structured logs primero; alarmas despues de deploy dev.

**Criterios de aceptacion:**

- Cada request loguea path, method, status y request id.
- 500 no expone stack traces al cliente.
- Alarmas definidas para prod.

### DESICION HUMANA

Implementar. Tambien evaluar si no faltan metricas importantes que podrian ir a cloudwatch.

### 18. Separacion de Lógica de Negocio, Routing y Persistencia

**Estado:** Partially implemented

**Que es:** Dividir `handler.js` en capas testeables.

**Estado actual en el proyecto:** `src/runtime.js` ya es puro, pero `src/handler.js` mezcla routing, AWS SDK, marshalling, Cognito users, metrics, CRUD, publish y public runtime.

**Como se implementaria:**

- Extraer:
  - `src/http/router.js`
  - `src/http/responses.js`
  - `src/repositories/dynamo.js`
  - `src/repositories/collection-builder-repository.js`
  - `src/services/users-service.js`
  - `src/services/collection-builder-service.js`
  - `src/services/metrics-service.js`
- Mantener `handler.js` como composition root.

**Que mejoraria:** Tests mas faciles, cambios de endpoints mas seguros, menor carga cognitiva para agentes.

**Riesgos o costos:** Refactor grande si se hace de una vez.

**Prioridad sugerida:** Alta

**Decision recomendada:** Hacer incrementalmente: primero responses/router, luego repositories.

**Criterios de aceptacion:**

- `handler.js` baja de tamano y solo coordina.
- Services pueden testearse sin API Gateway event.
- Repositories encapsulan DynamoDB marshalling.

### DESICION HUMANA

Implementar definitivamente. Tambien revisar si los stacks de CDK necesitan alguna clase de division.

### 19. DynamoDB DocumentClient

**Estado:** Pending

**Que es:** Usar `@aws-sdk/lib-dynamodb` para evitar marshalling manual.

**Estado actual en el proyecto:** `src/handler.js` define `toAttr`, `fromAttr`, `marshal`, `unmarshal`. Esto es vulnerable a edge cases de sets, empty strings, undefined nested values y tipos nuevos.

**Como se implementaria:**

- Agregar `@aws-sdk/lib-dynamodb`.
- Crear `DynamoDBDocumentClient`.
- Reemplazar `GetItemCommand`, `PutItemCommand`, `QueryCommand`, `ScanCommand` por comandos Document.

**Que mejoraria:** Menos codigo custom critico y menos bugs de serializacion.

**Riesgos o costos:** Cambia capa de persistencia; requiere tests de repository.

**Prioridad sugerida:** Media

**Decision recomendada:** Implementar durante extraccion de repository.

**Criterios de aceptacion:**

- No existen helpers manuales `toAttr/fromAttr`.
- Tests de CRUD pasan con AWS SDK mockeado.

### DESICION HUMANA

Implementar. Tener en cuenta para el momento del mocking

### 20. Mocking de APIs/AWS

**Estado:** Pending

**Que es:** Estrategia para simular Cognito/DynamoDB/API Gateway en tests.

**Estado actual en el proyecto:** Solo se testea runtime puro y CDK synth. No hay mocks de AWS.

**Como se implementaria:**

- Adoptar `aws-sdk-client-mock` para SDK v3.
- Crear helpers:
  - `makeHttpApiEvent`
  - `mockDynamoItem`
  - `mockCognitoUser`
- Separar fixtures por endpoint.

**Que mejoraria:** Permite integration tests confiables sin AWS real.

**Riesgos o costos:** Mocks pueden divergir de AWS si se abusa. Mantener tests de CDK synth.

**Prioridad sugerida:** Alta

**Decision recomendada:** Implementar con handler integration tests.

**Criterios de aceptacion:**

- Tests no hacen llamadas de red.
- Se cubren paths felices y errores.

### DESICION HUMANA

Implementar y generar tests del proyecto

### 21. E2E Smoke Tests

**Estado:** Not recommended now

**Que es:** Tests contra un stack deployado real.

**Estado actual en el proyecto:** No hay tests E2E backend. El backend todavia esta en etapa de infra/API inicial.

**Como se implementaria eventualmente:**

- Deploy dev ephemeral o shared dev.
- Crear admin Cognito temporal.
- Llamar `/health`, login Cognito, `/admin/session`, bootstrap, preview.
- Limpiar datos temporales.

**Que mejoraria:** Confianza real de deploy.

**Riesgos o costos:** Costo AWS, flakiness, manejo de usuarios temporales y credenciales.

**Prioridad sugerida:** Baja por ahora

**Decision recomendada:** No implementar hasta tener CI/deploy dev estable e integration tests locales.

**Criterios de aceptacion futuros:**

- Corre manualmente o nightly.
- No depende de datos productivos.
- Limpia recursos temporales.

### DESICION HUMANA

No implementar. Ya tenemos los tests de integracion en el admin.

### 22. Storybook o Equivalente UI

**Estado:** Not recommended now

**Que es:** Herramienta para revisar componentes UI aislados.

**Estado actual en el proyecto:** Backend no tiene UI.

**Como se implementaria:** No aplica en backend.

**Que mejoraria:** Nada directo para este proyecto.

**Riesgos o costos:** Agregaria complejidad sin beneficio.

**Prioridad sugerida:** Ninguna

**Decision recomendada:** No implementar en `collectool-backend`.

**Criterios de aceptacion:** Mantener UI tooling fuera de este repo.

### DESICION HUMANA

No implementar. Es backend y no tiene elementos UI.

### 23. Auditoria de Dependencias

**Estado:** Pending

**Que es:** Revision automatica de vulnerabilidades y actualizaciones.

**Estado actual en el proyecto:** No hay Dependabot ni workflow de `npm audit`. Dependencias CDK/Jest son pocas pero criticas.

**Como se implementaria:**

- Agregar `.github/dependabot.yml` para npm y GitHub Actions.
- Agregar `npm audit --audit-level=high` como job informativo o required segun tolerancia.
- Revisar CDK updates con `cdk diff` antes de merge.

**Que mejoraria:** Mantiene CDK y Jest actualizados, reduce CVEs.

**Riesgos o costos:** Dependabot puede generar ruido; agrupar updates.

**Prioridad sugerida:** Media

**Decision recomendada:** Implementar Dependabot con limite de PRs.

**Criterios de aceptacion:**

- Dependabot abre PRs semanales.
- Security updates no quedan invisibles.

### DESICION HUMANA

Implementar.

### 24. Secret Scanning e IaC Security

**Estado:** Partially implemented

**Que es:** Deteccion de secretos y configuraciones inseguras de infraestructura.

**Estado actual en el proyecto:** `cdk-nag` esta instalado, `npm run security:iac` existe y forma parte de `npm run check`. Secret scanning depende de settings de GitHub y queda documentado para habilitacion humana.

**Como se implementaria:**

- Habilitar GitHub secret scanning si el repo/plan lo soporta.
- Mantener `cdk-nag` obligatorio en `npm run check`.
- Revisar suppressions explicitas para casos aceptados.

**Que mejoraria:** Reduce riesgo de credenciales en commits y permisos excesivos.

**Riesgos o costos:** `cdk-nag` puede producir hallazgos iniciales que requieren triage, especialmente en Cognito/API Gateway/Lambda logs.

**Prioridad sugerida:** Media/Alta

**Decision recomendada:** Mantener `cdk-nag` obligatorio y habilitar secret scanning/push protection desde GitHub settings.

**Criterios de aceptacion:**

- Secret scanning habilitado o documentado.
- `cdk-nag` corre y suppressions estan justificadas.

### DESICION HUMANA

Implementar y configurar

### 25. Scripts de Diagnostico

**Estado:** Implemented

**Que es:** Comandos seguros para inspeccionar deploys.

**Estado actual en el proyecto:** Existen `diff:dev`, `diff:prod`, `outputs:dev`, `outputs:prod` y `health`.

**Como se implementaria:**

- Mantener `scripts/stack-outputs.sh` para CloudFormation outputs.
- Mantener `scripts/health-check.sh` para `/health`.
- Usar `AWS_PROFILE=castor` localmente cuando corresponda.

**Que mejoraria:** Facilita soporte por humanos/agentes sin entrar a consola AWS.

**Riesgos o costos:** Scripts con AWS CLI requieren credenciales locales.

**Prioridad sugerida:** Media

**Decision recomendada:** Mantener scripts pequenos y seguros en vez de un script diagnostico grande.

**Criterios de aceptacion:**

- `npm run diff:dev`, `npm run diff:prod`, `npm run outputs:dev`, `npm run outputs:prod` y `npm run health -- <ApiUrl>` existen.
- Docs explican precondiciones de AWS CLI y URL.

### DESICION HUMANA

Implementar.

### 26. Convenciones para Agregar Features

**Estado:** Pending

**Que es:** Guia de estructura para nuevos endpoints, tablas, permisos y tests.

**Estado actual en el proyecto:** Hay spec y docs, pero no una receta operativa para extender backend.

**Como se implementaria:**

- Agregar seccion en `AGENTS.md` o `docs/DEVELOPMENT_GUIDE.md`:
  - Definir contrato primero.
  - Agregar schema/fixture.
  - Agregar service/repository.
  - Agregar route.
  - Agregar IAM minimo.
  - Agregar tests unit/integration.
  - Actualizar docs/API_CONTRACTS.

**Que mejoraria:** Evita que nuevos features aumenten el tamaño de `handler.js` y rompan patrones.

**Riesgos o costos:** Requiere disciplina de mantenimiento.

**Prioridad sugerida:** Alta

**Decision recomendada:** Implementar junto con refactor de capas.

**Criterios de aceptacion:**

- Guia existe.
- Nuevo endpoint de ejemplo sigue la guia.

### DESICION HUMANA

Implementar.

### 27. Limpieza de Artefactos y Nested Repo

**Estado:** Pending

**Que es:** Higiene del repo para evitar archivos generados o repos anidados.

**Estado actual en el proyecto:** `.gitignore` ignora `cdk.out`, pero el directorio existe localmente. `find` muestra `collectool-backend/.git` dentro del repo backend, y `git status --short` muestra `?? collectool-backend/`.

**Como se implementaria:**

- Confirmar si `collectool-backend/collectool-backend` es accidental.
- Si es accidental, removerlo del workspace y agregar regla preventiva si hace falta.
- Limpiar `cdk.out` local cuando no se necesite.
- Agregar nota en `AGENTS.md`: no commitear artefactos CDK ni repos anidados.

**Que mejoraria:** Reduce confusion de agentes y riesgo de commits basura.

**Riesgos o costos:** Borrar directorios debe hacerse con cuidado porque puede contener trabajo local no commiteado.

**Prioridad sugerida:** Alta

**Decision recomendada:** Humano debe confirmar antes de borrar el nested repo.

**Criterios de aceptacion:**

- `git status --short` no muestra `?? collectool-backend/`.
- `cdk.out` no aparece en status.
- Docs advierten sobre artefactos generados.

## Resumen

### Archivos creados/modificados

- Creado: `docs/AGENT_DEVELOPMENT_TOOLING.md`

### Hallazgos principales

- El backend ya tiene una base AWS serverless razonable y tests iniciales que pasan.
- Falta un baseline de calidad: no hay `check`, typecheck, lint ni formato automatico.
- No hay CI/CD real en el repo backend, solo scripts y documentacion.
- La Lambda handler concentra demasiadas responsabilidades; `runtime.js` es el mejor ejemplo actual de separacion testeable.
- Falta validacion ejecutable de contratos con frontend.
- Hay posible higiene pendiente: repo anidado `collectool-backend/` y artefactos `cdk.out` locales.

### Top 5 prioridades recomendadas

1. Agregar `AGENTS.md`, `.nvmrc`, `.env.example` y regla npm/Node 20.
2. Agregar Prettier + ESLint + `npm run check`.
3. Agregar CI de PR con `npm ci`, lint, format, tests y synth.
4. Separar `handler.js` en router/services/repositories y agregar handler integration tests con AWS SDK mockeado.
5. Crear schemas/fixtures de contrato y validarlos en tests.

### Riesgos mas importantes

- Cambios de API pueden romper `collectool-admin` porque el contrato no es ejecutable.
- Cambios de infra pueden llegar a prod sin CI ni branch protection.
- Handler monolitico aumenta el riesgo de regresiones al agregar endpoints.
- Marshaling DynamoDB manual puede fallar con edge cases de datos.
- Nested repo/artefactos locales pueden confundir a agentes o terminar en commits accidentales.

### Decisiones humanas antes de implementar

- Confirmar si el backend debe seguir en JavaScript con `checkJs` o migrar gradualmente a TypeScript.
- Confirmar si `collectool-backend/collectool-backend` es basura local y puede eliminarse.
- Definir si CI/CD vive dentro de este repo backend separado o en un repositorio padre/monorepo.
- Definir nivel requerido de IaC security (`cdk-nag` obligatorio o informativo).
- Definir donde viviran los contratos compartidos backend/frontend: backend como fuente, paquete compartido o schemas copiados con version.

## DESICION HUMANA

Con respecto a estos ultimos puntos "Decisiones humanas antes de implementar" te respondo con la siguiente lista (cada una corresponde a una respuesta a cada punto en orden):

- Habria que migrar a typescript. Como recien esta escrito el proyecto, podriamos migrarlo y hacerlo andar

- Es basura y ya la elimine, no deberia existir

- El CI/CD vivira dentro del proyecto

- cdk-nag OBLIGATORIO

- Si solo tuviesen que vivir en un solo lado deberian vivir entonces en le backend, en ese caso, solo para esto, tambien modificar collectool-admin.

TODO el flujo final de desarrollo despues de todas estas implementaciones, asi como las herramientas instaladas y todo, tiene que quedar documentado para que tanto humanos como agentes puedan utilizarlo. Dividi la documentacion como se te sea mas sencillo.

## Estado Final Tras Esta Decision

- TypeScript queda como lenguaje fuente del backend (`bin`, `lib`, `src`) y `dist/` queda como artefacto generado no versionado.
- CDK vive dentro del proyecto y ejecuta build antes de iniciar `dist/bin/collectool-backend.js`.
- Lambda se bundlea desde `src/handler.ts` con `aws-lambda-nodejs` y `esbuild`.
- `cdk-nag` es obligatorio: `npm run security:iac` forma parte de `npm run check` y de CI/deploy.
- El backend es la fuente canonica de contratos: `docs/openapi.yaml`, `schemas/api-contracts.schema.json` y `test/fixtures/*.json`.
- `collectool-admin` solo debe sincronizar expectativas frontend desde los contratos backend.
- El flujo final para humanos/agentes vive en `docs/DEVELOPMENT_WORKFLOW.md` y las reglas operativas cortas viven en `AGENTS.md`.
