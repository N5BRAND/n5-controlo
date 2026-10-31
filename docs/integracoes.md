# Ligações externas

Todas as ligações verificam a assinatura de cada pedido e guardam o pedido em bruto 30 dias (`webhook_inbox`), para poder reprocessar se algo falhar. Pedidos repetidos são ignorados.

## Stripe

- Endpoint: `https://<domínio>/api/webhooks/stripe`
- Eventos: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `invoice.payment_failed`.
- Segredo: `STRIPE_WEBHOOK_SECRET`.
- Convenções obrigatórias:
  - Cada subscrição leva `metadata.n5_software` (ex.: `sw_clara`). Opcionalmente leva `metadata.n5_org_name`.
  - Cada preço leva `metadata.included_minutes` e `metadata.included_leads`: é o incluído no plano.
  - Preços de consumo (`usage_type: metered`) ficam fora do MRR.
- A fatura certificada AT é emitida pelo faturador (Moloni ou InvoiceXpress) a partir do mesmo evento `invoice.paid`. Essa ligação ainda não está neste repositório.

## GitHub

- Criar uma GitHub App só de leitura (Pull requests, Deployments, Contents: read).
- Instalar a app nos repositórios dos softwares.
- Webhook: `https://<domínio>/api/webhooks/github`, com o segredo em `GITHUB_WEBHOOK_SECRET`.
- Eventos: Pull request, Pull request review, Deployment status, Release.
- Em Definições › Softwares, preencher os repositórios de cada software (`org/repo`).
- Para um PR se ligar a um item do roadmap, o código do item (ex.: `CLA-12`) tem de estar no título do PR ou no nome do branch.
- Um PR conta como de agente quando o autor é um bot do GitHub ou o PR tem a etiqueta `agente`.
- O que acontece automaticamente:
  - Merge na branch principal passa o item a Testes.
  - Deploy com sucesso em staging passa o item a Staging; em produção, passa a Produção.
  - Se faltarem dono, critérios de aceitação ou eventos de produto, o item não avança e é criado um alerta.
  - Deploy de produção falhado gera um alerta crítico.

## Slack (workspace da comunidade N5)

- Criar uma app Slack com:
  - Slash command `/feedback`, com o URL `https://<domínio>/api/webhooks/slack`.
  - Event Subscriptions no mesmo URL, com o evento de bot `reaction_added`.
  - Bot token scopes: `chat:write`, `commands`, `reactions:read`, `channels:history`, `channels:read`.
- Variáveis:
  - `SLACK_SIGNING_SECRET` e `SLACK_BOT_TOKEN`.
  - `SLACK_ALERTS_CHANNEL`, o canal interno de alertas (por omissão `n5-alertas`).
  - `SLACK_FEEDBACK_REACTION` (por omissão `bulb`).
- Canais com o prefixo de cada software: `clara-feedback`, `clara-novidades`, `clara-ajuda`. O prefixo define-se em Definições › Softwares.
- Como se usa:
  - `/feedback bug: o calendário não abre` regista o feedback e responde só a quem escreveu.
  - A reação `:bulb:` numa mensagem transforma-a em feedback.
  - `:+1:` numa mensagem que já é feedback conta como voto.
  - Publicar uma versão no Pipeline envia o changelog para `#<prefixo>-novidades`.
  - Mudanças de estado (planeado, lançado, recusado) respondem na conversa original.

## Meta (anúncios)

- Token de utilizador de sistema do Business Portfolio N5, com `ads_read`, em `META_ACCESS_TOKEN`.
- Em Definições › Softwares, preencher a conta de anúncios de cada software (`act_…`).
- Ao abrir Campanhas e funil, a página lê da Meta hoje e ontem antes de mostrar os números (no máximo uma leitura a cada 30 segundos; se a Meta demorar mais de 5 segundos, mostra a última leitura e diz porquê). A hora da leitura aparece ao lado do botão.
- `/api/cron/meta-sync` recalcula os últimos 28 dias ao nível do anúncio, por dia, a cada 6 horas (a Meta ainda corrige esses dias). O botão "Recalcular 28 dias da Meta" faz o mesmo na hora.
- As linhas gravam-se em lote: as funções da Netlify correm longe da base, e gravar linha a linha levava cerca de 20 segundos.
- Alternativa sem token: importar o CSV exportado do Gestor de Anúncios em Campanhas e funil.
- Atribuição: as UTMs chegam com o evento `account.signed_up` (propriedades `utm_campaign`, `fbclid`, …). O nome da campanha tem de ser igual a `utm_campaign`.
- A sincronização guarda também os IDs do conjunto e do anúncio, as visitas à página (`landing_page_view`) e as compras do píxel.

### Orçamentos ABO

Regra da N5: até 1000 € por mês, cada campanha tem orçamento em cada conjunto de anúncios (ABO), com um criativo por conjunto. Acima disso passa a CBO. As regras estão em `src/lib/abo.ts` (funções puras, com testes em `tests/abo.test.ts`) e correm a partir de `src/lib/meta-abo.ts`.

**Ligar uma campanha.** Em Campanhas e funil › Ligar campanha às regras ABO, indica o ID da campanha, o total do dia e o dia em que passou a ABO. Os números contam a partir desse dia. O software tem de ter a conta de anúncios nas Definições.

**Quando corre.** `/api/cron/meta-budget?momento=manha` às 08:00 e `?momento=noite` às 20:00, pelas tarefas `netlify/functions/cron-meta-budget-*.mts` (em UTC). Cada corrida sincroniza os últimos 3 dias e depois decide.

De manhã:
- O anúncio que a Meta reprovou, ou que gastou 15 € sem inscrições e com visitas a 2× a média, dá lugar ao seguinte da fila. A fila são os anúncios pausados da campanha, com os do mesmo nível de consciência primeiro.
- Entre os que já gastaram 8 €, 20% do orçamento do pior passa para o melhor.
- O total do dia volta ao da campanha, com 3 a 10 € por conjunto.

À noite:
- Só se corta 20% a quem gastou 4 € no dia sem visitas.
- Os anúncios reprovados são trocados.

**Como se compara.** O custo compara-se pelo passo mais avançado com dados: pré-reservas pagas (3 ou mais), inscrições (5 ou mais), visitas (5 ou mais) ou, por fim, cliques.

**Tokens.** Os conjuntos e os anúncios leem-se em direto com `META_ACCESS_TOKEN`. As mudanças só se fazem com `META_ADS_TOKEN_GESTAO`, um token de sistema com `ads_management`, depois de confirmar essa permissão. Sem ele, as decisões ficam só propostas. O token vai sempre no cabeçalho, nunca no endereço.

**O que fica registado.**
- Cada decisão fica em `meta_budget_decisions`, com o motivo, e aparece em Campanhas e funil.
- Geram alertas: falhas ao aplicar, análises que falham e um token de gestão sem a permissão. As trocas de criativo ficam como informação.
- O botão «Desligar regras» faz as regras deixarem de mexer nessa campanha.

## Meta (API de Conversões)

Envia à Meta, pelo servidor, as inscrições e as compras dos sites N5, para os anúncios otimizarem com dados que não dependem do navegador. Só para quem aceitou os cookies de marketing no site.

- `META_CAPI_TOKEN`: token gerado no Gestor de Eventos (conjunto de dados Nº5 › Definições › API de Conversões › Gerar token de acesso). Não é o mesmo que `META_ACCESS_TOKEN`.
- `META_PIXEL_ID`: conjunto de dados; sem variável, usa o Nº5 (`2268439390668297`).
- `META_CAPI_TEST_CODE`: código do separador «Testar eventos», só enquanto se testa.
- `META_CAPI_PAYMENT_LINKS`: Payment Links da Stripe que contam como compra, `plink_…:sw_…` separados por vírgulas. A pré-reserva da N5 Clara já vem predefinida.

**Inscrição (Lead).** O site envia `POST /api/v1/conversions` com uma chave `events:write` ligada ao software, em todas as inscrições:

```json
{ "event": "Lead", "event_id": "o mesmo eventID do píxel", "email": "…", "source_url": "https://clara.numerocinco.pt/leads/",
  "ad": "cla_n2_leads", "consent": true,
  "phone": "…", "name": "…", "fbp": "_fbp", "fbc": "_fbc", "client_ip": "…", "user_agent": "…" }
```

- Sempre: o Controlo guarda em `signup_attributions` o email cifrado, a página e o anúncio (`ad`, o utm_content com que a pessoa chegou). Fica só no Controlo e serve para ligar as compras da Stripe aos anúncios.
- Com `consent: true` (cookies de marketing aceites): guarda também o consentimento em `meta_consents` (email cifrado, identificadores do anúncio, 90 dias) e envia o Lead à Meta. A Meta junta-o ao evento do píxel pelo `event_id`, sem contar duas vezes. Com `consent: false`, o site não envia telefone, nome, IP, navegador nem `_fbp`/`_fbc`, e o Controlo responde 202 sem enviar nada à Meta.

**Compra (Purchase).** Quando a Stripe confirma o pagamento de um Payment Link ligado (`checkout.session.completed` pago, ou `checkout.session.async_payment_succeeded` no Multibanco), o webhook guarda a compra em `stripe_purchases` (sessão, email cifrado, valor). Se a pessoa tiver consentimento, envia também o Purchase à Meta com o valor pago; o `event_id` é a sessão de checkout. O site deixa de enviar o Purchase pelo píxel, para não contar duas vezes.

**Compras Stripe por anúncio.** Em Campanhas e funil, a coluna «Compras Stripe» junta cada compra à inscrição com o mesmo email e conta-a no anúncio cujo utm_content (lido da ligação do anúncio na Meta, ou do nome `CLA · N2 · LEADS · /leads/` quando a ligação não o tem) é o da inscrição. Contam as compras desde o primeiro dia da campanha. Compras sem inscrição ligada aparecem no total e na nota da tabela, não num anúncio.

## Comunicações na app e por e-mail (módulo Reativação)

O sistema calcula há quantos dias cada pessoa não usa o software a partir dos eventos recebidos em `POST /api/v1/events`: cada evento atualiza a última utilização. As regras correm de hora a hora (`/api/cron/engagement`).

**Na app.** Cada software mostra as mensagens pendentes ao utilizador e informa o que aconteceu:

| Rota | Permissão | Para quê |
| --- | --- | --- |
| `GET /api/v1/messages?person={id}` | `messages:read` | Mensagens na app por mostrar (ficam marcadas como entregues) |
| `POST /api/v1/messages/{id}/events` | `messages:write` | `{"type":"seen"}`, `"clicked"` ou `"dismissed"` |
| `POST /api/v1/persons/{id}/preferences` | `messages:write` | `{"email_opt_out":true}` e/ou `{"inapp_opt_out":true}` |

**E-mail.** Amazon SES (ver `docs/deploy-aws.md`). Só sai entre as 09:00 e as 20:00 de Lisboa, de segunda a sábado; fora disso fica pendente para a hora seguinte. O botão passa por `/api/r/{id}` para registar o clique; o link de cancelamento abre uma confirmação.

**Limites.** No máximo 1 e-mail a cada 3 dias e 3 comunicações por semana por pessoa. Cada regra dispara uma vez por período de inatividade. Quem cancelou não recebe nada desse canal, nem em envios manuais.

## Impacto: eventos que provam o retorno

O módulo Impacto só mostra o que os softwares registam. Cada software envia, em `POST /api/v1/events`:

| Evento | Quando | `properties` |
| --- | --- | --- |
| `task.completed` | A IA fez, ajudou a fazer ou a pessoa fez uma tarefa do catálogo | `task` (código do catálogo, ex. `lead.first_reply`), `by` (`ai`, `assisted` ou `human`), `human_seconds` (opcional: tempo que a pessoa ainda gastou) |
| `lead.received` | Chega uma lead | `lead` (id da lead no software), `after_hours` (`true` fora do horário do utilizador), `channel` |
| `lead.first_response` | Primeira resposta à lead | `lead`, `seconds` (desde que chegou), `by` (`ai` ou `human`) |
| `visit.scheduled` | Visita marcada | `lead`, `by` |
| `deal.closed` | Negócio fechado com essa lead | `lead`, `commission_eur` (comissão do utilizador, sem IVA) |
| `account.profile_updated` | No onboarding e sempre que o utilizador atualiza o perfil | `avg_monthly_revenue_eur` (faturação média mensal) ou `annual_revenue_eur`, `weekly_hours` (horas de trabalho por semana) |

Pressupostos automáticos:

- **Valor da hora de cada conta** = faturação média mensal ÷ (horas por semana × 52 ÷ 12), a partir de `account.profile_updated`. Contas sem perfil usam o valor de reserva do software.
- **Tempo à mão de cada tarefa** = mediana de `human_seconds` das execuções com `by: "human"`, a partir da amostra mínima (30 por omissão). Por isso, quando a pessoa faz a tarefa à mão no software, envia `task.completed` com `by: "human"` e o tempo que gastou. Até haver amostra usa-se a estimativa do catálogo.

Regras:

- O código `task` tem de existir no catálogo do software (Impacto › Pressupostos), com o tempo de referência à mão e o que fica para a pessoa. Códigos desconhecidos aparecem como "fora do catálogo" e não contam.
- `after_hours` é decidido pelo software com o horário do utilizador (por omissão: fins de semana e antes das 09:00 ou depois das 20:00).
- `deal.closed` pode chegar semanas depois; liga-se à lead pelo `lead`.

Para mostrar ao utilizador ("este mês poupou 12 horas"), o software chama `GET /api/v1/impact?organization=org_...&software=sw_clara&period=30d` com uma chave com a permissão `impact:read`.

## Chat: resumos e pendentes

O Chat não precisa de ligação externa. Os botões "O que se falou (7 dias)" e "Que temas estão pendentes?" cruzam a conversa do canal com o pipeline do software (no canal Geral, com todos os softwares a que a pessoa tem acesso):

- prazos ultrapassados, de hoje ou a chegar (campo "Prazo para produção" do item);
- mensagens marcadas como pendente e ainda não resolvidas;
- perguntas sem resposta há mais de 24 h (últimos 14 dias);
- itens do roadmap falados no chat (pelo código, por exemplo CLA-12, ou por duas palavras do título) que ainda não chegaram a produção;
- itens do backlog (ideia, descoberta) falados no chat.

Sem modelo de IA, o resumo faz-se por regras (temas, decisões, pendentes). Com `LLM_PROVIDER=bedrock` e `BEDROCK_MODEL_ID`, o mesmo material vai para o modelo no Amazon Bedrock da UE, que escreve o texto corrido; se o pedido falhar, volta às regras.

Arquivo: `/api/cron/chat` corre uma vez por dia e resume por mês as conversas com mais de 90 dias. As mensagens originais não se apagam: ficam acessíveis em "Ver mensagens originais" e na pesquisa.
