# Controlo N5

Sistema de controlo dos softwares N5: comunidades, pipeline de desenvolvimento, campanhas e funil, utilização e receita. Lê os dados de todos os softwares através do núcleo N5 e mostra-os num só sítio, com alertas.

A especificação completa está no documento "Especificação do Sistema de Controlo N5" (separadores *Módulos em detalhe* e *Contrato de dados do núcleo*). Este repositório é a primeira versão dessa especificação.

## O que já faz

| Módulo | Ecrãs | Entrada de dados |
| --- | --- | --- |
| Painel geral | Totais N5 (MRR, ARR, pagantes, gasto, CAC, margem, alertas) e uma linha por software | Todos os módulos |
| Comunidades | Caixa de feedback com filtros, ficha do feedback (estado, dono, duplicados, item do roadmap, resposta no Slack), membros, changelog, registo manual | Slack (`/feedback`, reações), API `POST /api/v1/feedback` |
| Pipeline | Roadmap por fase, backlog com pontuação, ficha do item com regras de fase e prazo para produção, entregas (DORA), bugs, agentes de código, versões, custos por fornecedor, notificações de prazos (ultrapassados, hoje, a chegar nos próximos 3 dias, em curso sem prazo; também em Alertas) | GitHub (PRs, revisões, deploys, releases), registo manual de custos |
| Chat | Conversa de trabalho por projeto (um canal por software e um Geral): respostas, @menções, códigos do roadmap ligados ao item, marcar decisão ou pendente, fixar, pesquisa em todo o histórico, não lidas. Botões "O que se falou (7 dias)" e "Que temas estão pendentes?", que cruzam a conversa com o pipeline, o roadmap e o backlog. O histórico fica todo guardado; o que tem mais de 90 dias é resumido por mês automaticamente | Escrita no ecrã; resumos por regras ou por IA (Amazon Bedrock na UE) |
| Campanhas e funil | Totais, funil, campanhas com CPM, CTR, CPC, CPL, registos, pagantes e CAC; orçamentos ABO (um criativo por conjunto, repartidos às 08:00 e às 20:00, com o motivo de cada decisão) | Meta Insights (a cada 6 h; às 08:00 e às 20:00 para as regras ABO) ou CSV do Gestor de Anúncios |
| Utilização e receita | MRR mês a mês (novo, expansão, contração, churn), contas com margem e saúde, utilização (ativos, tempo na app, funcionalidades), trials | Stripe (webhooks), eventos e consumo dos softwares |
| Reativação | Há quanto tempo cada utilizador não usa (faixas por software e lista de pessoas), regras automáticas por dias sem usar, modelos de comunicação na app e por e-mail (lembrete, dica, novidade, oferta, feedback, fim de trial, reativação), envios e resultados (vistas, cliques, quem voltou) | Eventos dos softwares, Amazon SES, API `GET /api/v1/messages` |
| Impacto | Prova do retorno para o utilizador: tempo poupado por tarefa e o seu valor, retorno por cada € pago, leads atendidas fora de horas pela IA, tempo de primeira resposta, conversão rápida vs lenta e negócio protegido (estimado), por conta, com os pressupostos editáveis | Eventos `task.completed`, `lead.received`, `lead.first_response`, `visit.scheduled`, `deal.closed`; API `GET /api/v1/impact` |
| Alertas | Centro de alertas com gravidade, dono, silenciar e resolver; críticos e avisos vão para o Slack interno | Regras a cada 15 min, webhooks, API `POST /api/v1/alerts` |
| Definições | Softwares, utilizadores e funções, chaves de API, estado das ligações | |

Acessos: sócios e direção de operações veem tudo (incluindo Reativação); colaboradores veem Comunidades, Pipeline e Chat dos softwares que lhes forem atribuídos, sem o separador Custos.

## Ainda não faz (próximas versões)

- Ligação à plataforma 4Improvements (falta saber a tecnologia da plataforma).
- Servidor MCP para agentes.
- AWS Cost Explorer automático (os custos entram à mão em Pipeline › Custos).
- Uptime e erros em produção (a ferramenta de monitorização envia alertas para `/api/v1/alerts` quando for escolhida).
- Classificação automática do feedback por IA (título, tipo, duplicados).
- Webhooks de saída do núcleo (Standard Webhooks). A assinatura já existe em `src/lib/signatures.ts`.

## Ver online (demonstração)

Demonstração estática dos dashboards no GitHub Pages: https://n5-brand.github.io/n5-controlo/ (dados de exemplo; filtros e formulários não funcionam). Para a atualizar: `python3 scripts/export-demo.py` (instruções no próprio script).

App completa, com login e base de dados, na Netlify: ver `docs/deploy-netlify.md`. Alternativa no Render:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/n5-brand/n5-controlo)

Cria a app e a base de dados em Frankfurt com dados de exemplo (`render.yaml`). Entra com `socio@exemplo.n5` e a palavra-passe que o Render gera em `DEMO_PASSWORD` (Environment). O plano grátis adormece sem uso e a base de dados grátis do Render expira ao fim de 30 dias: serve para ver, não para produção.

## Correr localmente

Precisas de Node 22 e Postgres 16 (ou Docker).

```bash
cp .env.example .env          # preenche SESSION_SECRET com 32+ caracteres
npm install
npm run db:migrate
npm run db:seed               # dados de EXEMPLO; nunca em produção (recusa-se)
npm run dev                   # http://localhost:3000
```

Com o seed, entra com `socio@exemplo.n5` ou `colaborador@exemplo.n5` e a palavra-passe de `DEMO_PASSWORD` no `.env` (sem ela, o seed gera uma e mostra-a no fim). A palavra-passe dos dados de exemplo nunca fica no repositório, e a produção nunca leva dados de exemplo.

Sem seed, cria o primeiro utilizador:

```bash
npm run user:create -- pedro@4improvements.pt "Pedro" socio 'uma-palavra-passe-longa'
```

Com Docker: `docker compose up --build`.

## Testes

```bash
npm run typecheck
npm test        # métricas (MRR, churn, NRR, ACV, CAC, payback, pontuação, tempo na app, saúde) assinaturas de webhooks e regras de reativação
```

## API do núcleo (para os softwares N5)

Autenticação: `Authorization: Bearer <chave>`. As chaves criam-se em Definições › Chaves de API (ou `npm run apikey:create`), têm permissões, podem ficar presas a um software e expiram em 12 meses no máximo.

| Rota | Permissão | Para quê |
| --- | --- | --- |
| `POST /api/v1/events` | `events:write` | Lote de até 100 eventos de produto |
| `POST /api/v1/usage` | `usage:write` | Lote de até 500 registos de consumo |
| `GET /api/v1/entitlements/{org}/{software}` | `entitlements:read` | Incluído, usado e restante; se a conta pode continuar |
| `POST /api/v1/feedback`, `GET /api/v1/feedback` | `feedback:write`, `feedback:read` | Feedback a partir da app |
| `POST /api/v1/alerts` | `alerts:write` | Alertas de sistemas externos |
| `GET /api/v1/messages?person=` | `messages:read` | Mensagens na app por mostrar ao utilizador |
| `POST /api/v1/messages/{id}/events` | `messages:write` | Mensagem vista, clicada ou dispensada |
| `POST /api/v1/persons/{id}/preferences` | `messages:write` | Cancelar e-mails ou mensagens na app |
| `GET /api/v1/impact?organization=&software=&period=` | `impact:read` | Resumo do impacto de uma conta, para mostrar ao utilizador |

Os envios são idempotentes pelo `id`: repetir um evento ou um registo não duplica. Eventos fora da lista padrão têm de estar declarados nos eventos chave do software.

Unidades de consumo que contam para o incluído no plano: `call.forward.minute` (minutos) e `lead.conversation` (uma por conversa com uma lead, com custo 0; os custos reais vão nas unidades de WhatsApp e de tokens).

Exemplo:

```bash
curl -X POST https://controlo.n5.../api/v1/events \
  -H "Authorization: Bearer $N5_KEY" -H "Content-Type: application/json" \
  -d '[{"id":"evt_01","software":"sw_clara","name":"feature.used","feature":"voice.command",
        "occurred_at":"2026-10-24T16:05:12Z","person":"per_1","organization":"org_1"}]'
```

## Ligações externas

Ver `docs/integracoes.md` (Stripe, GitHub, Slack, Meta, comunicações na app e e-mail) e `docs/deploy-aws.md` (alojamento na organização AWS N5).

## Estrutura

```
src/app/(app)/        ecrãs dos módulos (server components + server actions)
src/app/api/v1/       API do núcleo
src/app/api/webhooks/ Stripe, GitHub, Slack
src/app/api/cron/     alertas (15 min), MRR (diário), Meta (6 h), reativação (1 h), arquivo do chat (diário)
src/lib/metrics.ts    cálculos puros, testados
src/lib/core.ts       eventos, consumo, direitos, feedback, regras do roadmap
src/lib/alerts.ts     regras de alerta
src/lib/engagement*.ts inatividade, regras e envio de comunicações
src/lib/impact.ts     agregação do módulo Impacto (cálculos em metrics.ts)
src/lib/chat*.ts      chat: regras puras (pendentes, menções, arquivo) e resumos
src/lib/llm.ts        modelo de IA para resumos (Bedrock), opcional
src/db/schema.ts      modelo de dados (Drizzle, Postgres)
```
