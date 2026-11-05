# Migrar o N5 Controlo para outra plataforma

Este pacote tem todo o código do N5 Controlo, igual ao que está em produção a 30/10/2026 (branch `main` do GitHub, com o favicon do N5). Não tem segredos (`.env`), nem `node_modules`, nem os dados da base de dados.

## O que precisa a plataforma de destino

| Peça | Requisito |
| --- | --- |
| Aplicação | Node.js 22 a correr Next.js 15 (servidor, não site estático) |
| Base de dados | Postgres 15 ou 16, de preferência na UE |
| Tarefas agendadas | Algo que faça pedidos HTTPS `POST` com o cabeçalho `Authorization: Bearer <CRON_SECRET>` |
| Domínio | Um registo CNAME ou A para a nova plataforma (hoje `controlo.4improvements.com` → Netlify) |

Funciona em qualquer serviço que corra Node ou Docker: AWS (ECS Fargate, App Runner), Render, Railway, Fly.io, Vercel, um servidor próprio.

## Passos

1. **Base de dados.** Criar um Postgres novo e copiar a `DATABASE_URL`.
   - Para levar os dados atuais (utilizadores, conversas do chat, pipeline…), exportar do Supabase e importar no destino:
     ```
     pg_dump --no-owner --no-acl "<URL do Supabase>" > n5.sql
     psql "<URL nova>" < n5.sql
     ```
   - Para começar do zero, basta o passo 3: as migrações criam as tabelas.
2. **Variáveis de ambiente** (lista completa em `.env.example`). As obrigatórias:
   - `DATABASE_URL`: ligação ao Postgres.
   - `SESSION_SECRET`: texto aleatório com 32+ caracteres. Se for diferente do atual, todos voltam a fazer login.
   - `CRON_SECRET`: texto aleatório longo.
   - `APP_URL`: endereço final, por exemplo `https://controlo.4improvements.com`.
   - As restantes (Stripe, GitHub, Slack, Meta, SES, Bedrock) só quando cada ligação for configurada (`docs/integracoes.md`).
   - `DEMO_DATA=true` só se quiser os dados de exemplo numa base vazia.
3. **Build e arranque.**
   ```
   npm ci
   npm run db:migrate
   npm run build
   npm start
   ```
   Com Docker, usar o `Dockerfile` (as migrações correm à parte com `node scripts/migrate.mjs`).
4. **Tarefas agendadas** (horários em UTC):

   | Endereço | Quando |
   | --- | --- |
   | `/api/cron/alerts` | a cada 15 min |
   | `/api/cron/engagement` | de hora a hora |
   | `/api/cron/meta-sync` | a cada 6 h |
   | `/api/cron/mrr` | às 02:00 |
   | `/api/cron/chat` | uma vez por dia (03:23) |

   Na Netlify estão em `netlify/functions/cron-*.mts`; noutra plataforma recria-se cada uma no agendador dela.
5. **Primeiro utilizador** (se a base for nova): `npm run user:create`, ou entrar com um utilizador migrado.
6. **Domínio.** Na Hostinger, mudar o CNAME `controlo` para o endereço da nova plataforma e ativar o HTTPS lá.
7. **Webhooks externos.** Se já estiverem ligados, atualizar o endereço no Stripe, GitHub e Slack para o domínio novo.
8. **Verificar.** `GET /api/health` responde `ok`; entrar, abrir cada módulo e correr uma tarefa agendada à mão.

## Guias detalhados neste pacote

- `README.md`: o que faz cada módulo, correr localmente, API do núcleo.
- `docs/deploy-aws.md`: AWS (ECS Fargate, RDS, EventBridge).
- `docs/deploy-netlify.md`: Netlify + Supabase (a configuração atual).
- `docs/integracoes.md`: Stripe, GitHub, Slack, Meta, SES, eventos do Impacto, Chat.
- `render.yaml` e `docker-compose.yml`: Render e Docker local.
- `AGENTS.md`: regras para quem programa no projeto (pessoas e agentes).

## Notas

- A pasta `demo/` é a demonstração estática (GitHub Pages); não é precisa para correr a app.
- As contas `socio@exemplo.n5` e `colaborador@exemplo.n5` são de exemplo e a palavra-passe delas está no código. Se migrar os dados, desative-as.
