# Alojamento numa VPS própria (Easypanel)

A app corre na VPS a partir da imagem do `Dockerfile` (Next.js em modo standalone), gerida pelo Easypanel. A base de dados é um serviço Postgres também no Easypanel, na mesma rede interna — sem Supabase nem outro Postgres externo.

## Base de dados

1. No Easypanel, cria um novo serviço a partir do template **Postgres** (versão 16), no mesmo projeto da app.
2. Não expõe a porta do Postgres à Internet: a app liga-se pelo nome interno do serviço (rede Docker do Easypanel), nunca por um endereço público.
3. A `DATABASE_URL` fica algo como `postgres://<utilizador>:<password>@<nome-do-serviço-postgres>:5432/<base>`, com os valores que o Easypanel gerou para esse serviço.

## A app

1. No Easypanel, cria um serviço **App** a partir deste repositório (GitHub), com **Dockerfile** como forma de build — usa o `Dockerfile` existente, não precisa de configuração extra de build.
2. Porta do serviço: `3000` (a que o `Dockerfile` expõe). Health check: `/api/health`.
3. Variáveis de ambiente do serviço (Environment):

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | Ligação ao serviço Postgres do Easypanel (ver acima) |
| `SESSION_SECRET` | String aleatória com 32+ caracteres |
| `CRON_SECRET` | String aleatória longa |
| `APP_URL` | Endereço público da app, por exemplo `https://plataforma.4improvements.com` |

As restantes (Stripe, GitHub, Slack, Meta, SES, Bedrock para os resumos do Chat) acrescentam-se quando cada ligação for configurada (`docs/integracoes.md`).

4. **Migrações, antes do primeiro arranque e antes de cada deploy com migração nova.** O `Dockerfile` não as corre sozinho (fica deliberadamente fora do arranque normal, para não aplicar uma migração a cada reinício). Corre-as como tarefa única, com a mesma imagem e a mesma `DATABASE_URL` do serviço:
   ```bash
   node scripts/migrate.mjs
   ```
   No Easypanel isto faz-se abrindo a consola ("Console"/"Terminal") do serviço já criado e correndo o comando, ou criando um serviço App temporário com o mesmo `DATABASE_URL`, comando `node scripts/migrate.mjs`, que se apaga depois de correr uma vez.
5. **Domínio e SSL**: no separador **Domains** do serviço, adiciona o domínio público (ex.: `plataforma.4improvements.com`) com o DNS já a apontar para o IP da VPS. O Easypanel emite o certificado Let's Encrypt automaticamente assim que detecta o domínio.
6. **Primeiro utilizador**: a produção não leva dados de exemplo (o seed recusa-se a correr com `NODE_ENV=production`). Cria o primeiro utilizador pela consola do serviço:
   ```bash
   node_modules/.bin/tsx scripts/create-user.ts <email> "<nome>" socio '<palavra-passe com 12+ caracteres>'
   ```
   (ou corre `npm run user:create -- ...` a partir de um computador com a `DATABASE_URL` de produção no ambiente, por um túnel SSH até ao serviço Postgres).

## Deploys seguintes

Cada merge em `main` passa a CI (`.github/workflows/ci.yml`). No Easypanel, ativa o deploy automático do serviço App a cada push em `main` (ou faz "Redeploy" manual). Antes de um deploy com migração nova, corre `node scripts/migrate.mjs` (passo 4) antes de o novo código começar a servir pedidos.

## Tarefas agendadas (UTC)

O Easypanel não corre *scheduled functions* como a Netlify: as tarefas agendadas fazem-se com **Cron Jobs** do Easypanel (um por rota), cada um a chamar a app pelo domínio público com o `CRON_SECRET`:

```bash
curl -fsS -X POST "$APP_URL/api/cron/<rota>" -H "Authorization: Bearer $CRON_SECRET"
```

| Cron Job | Horário (cron, UTC) | Rota |
| --- | --- | --- |
| Alertas | `*/15 * * * *` | `/api/cron/alerts` |
| Reativação (engagement) | `7 * * * *` | `/api/cron/engagement` |
| Chat (arquivo mensal) | `23 3 * * *` | `/api/cron/chat` |
| Meta: sincronização 28 dias | `13 */6 * * *` | `/api/cron/meta-sync` |
| MRR (snapshot diário) | `0 2 * * *` | `/api/cron/mrr` |
| Meta: orçamentos ABO, manhã | `0 8 * * *` | `/api/cron/meta-budget?momento=manha` |
| Meta: orçamentos ABO, noite | `0 20 * * *` | `/api/cron/meta-budget?momento=noite` |

Cada Cron Job pode usar uma imagem simples com `curl` (ex. `curlimages/curl`), com o comando acima e `APP_URL`/`CRON_SECRET` nas suas variáveis de ambiente.

## Custos e capacidade

Para uma equipa pequena, a app e o Postgres cabem folgados numa VPS com 2 vCPU / 4 GB. Acompanha o uso de CPU/memória no próprio Easypanel; sobe o plano da VPS antes de ficar no limite, não depois.

## E-mail (módulo Reativação)

Igual ao descrito em `docs/deploy-aws.md`: Amazon SES, com `SES_FROM_ADDRESS` e `SES_REGION` nas variáveis do serviço App. Sem `SES_FROM_ADDRESS`, os envios ficam registados como simulados.
