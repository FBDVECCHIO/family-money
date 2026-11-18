# Especificação Técnica e Arquitetural — Agente Autônomo Morgan 24/7 (Backend, Tool Calling & Telegram/WhatsApp)

**Data:** 2026-11-18  
**Projeto:** Family Money (`app-financeiro`)  
**Status:** Aprovado para Implementação  

---

## 1. Visão Geral e Objetivo

Transformar o agente **Morgan** (atualmente um assistente analítico restrito ao frontend em `public/app.js` e `localStorage`) em um **Agente Financeiro Autônomo (Ativo e Reativo) 24/7** rodando diretamente no backend Node.js/PostgreSQL hospedado na VPS Hetzner.

O novo Morgan:
1. **Opera 24/7 no Backend (`server.js`)** integrado nativamente ao PostgreSQL e ao motor local (`db.js`) e conectado ao barramento em tempo real (`broadcastDbChange` via Server-Sent Events - SSE).
2. **Atua pelo Telegram Bot Oficial** (com suporte a texto, notas de voz `.ogg`, fotos de comprovantes/recibos e botões interativos inline) e expõe um Webhook Gateway preparado para **WhatsApp (Evolution API)**.
3. **Executa Ações Reais no Sistema Financeiro via Function Calling (Tools)** sob **Governança Híbrida Inteligente**:
   - **Ações Verdes (Execução Imediata + Botão `↩️ Desfazer`):** Lançamentos de despesas/receitas do dia a dia, conciliação (`is_effective`), criação de itens fixos, memorização de diretrizes/fatos, consultas analíticas, simulação de impacto de compra e recomendação de melhor cartão (float).
   - **Ações Vermelhas (Confirmação Prévia via Botões Inline `✅ Confirmar` / `❌ Cancelar`):** Exclusão de transações/recorrências, transferências entre contas acima do limite de segurança configurável (padrão R$ 1.000,00), ajustes diretos de saldo bancário e quitação/pagamento de faturas de cartão de crédito.
4. **Toma Iniciativas Proativas Autônomas (`morgan-scheduler.js`)**:
   - **Briefing Diário Matinal** (horário configurável, padrão `08:00` BRT): Envia resumo de saldos, contas fixas/lançamentos do dia, faturas próximas do fechamento/vencimento e melhor cartão para compras no dia.
   - **Vigilância Contínua de Cartões e Anomalias**: Alerta proativo quando um cartão entra na janela de 48h antes do fechamento ou no dia do vencimento, ou quando uma categoria estoura a média histórica.

---

## 2. Arquitetura de Componentes no Backend

A arquitetura segue o padrão modular integrado ao monolito Node.js/Express para latência zero com o banco e sincronização instantânea SSE:

1. **`db.js` & `schema.sql` (Persistência Expandida):**
   - `morgan_settings`: Armazena configurações globais e memória estratégica persistida no banco (`id`, `family_goal`, `untouchable_expenses`, `risk_profile`, `facts_json`, `gemini_api_key`, `gemini_model`, `telegram_bot_token`, `telegram_allowed_chat_ids`, `briefing_time`, `approval_threshold`, `proactive_enabled`, `last_briefing_date`, `updated_at`).
   - `morgan_conversations`: Histórico multi-turno persistente entre Telegram, WhatsApp e Web App (`id`, `channel`, `chat_id`, `role`, `content`, `tool_calls_json`, `created_at`).
   - `morgan_action_logs`: Ledger transacional de auditoria, ações pendentes de confirmação e snapshots para `Undo` (`id`, `action_type`, `status` [`executed`, `pending_confirmation`, `undone`, `cancelled`], `channel`, `chat_id`, `summary`, `payload_json`, `undo_snapshot_json`, `created_at`, `executed_at`).

2. **`morgan-finance-engine.js` (Motor Analítico e Transacional Compartilhado):**
   - Consolida no backend todos os cálculos de:
     - `getCardPaymentMonthAndYear(purchaseDateStr, closingDay, dueDay)`
     - `calculateForecast(accounts, cards, fixedItems, transactions)` (6 a 12 meses)
     - `calculateFinancialHealthScore(accounts, forecast)`
     - `getCardsFloatAnalysis(cards, referenceDate)`
     - `detectExpenseAnomalies(transactions, categories)`
     - `buildMorganRichContext()` (Snapshot completo em tempo real do banco + cenário macro Selic/CDI/IPCA + memória estratégica).
   - Fornece métodos transacionais seguros com geração automática de `undo_snapshot_json` e disparo do callback `onMutation(table, action, data)` conectado ao `broadcastDbChange` do `server.js`.

3. **`morgan-agent.js` (Cérebro Cognitivo Multi-Turn & Tool Calling + Multimodal):**
   - Integração nativa com a API Google Gemini (`generateContent` com `tools: [{ functionDeclarations }]` e suporte a `inlineData` para áudio `.ogg`/`.mp3` e imagens `.jpg`/`.png` de comprovantes).
   - Loop Agêntico (até 5 passos de raciocínio/ferramentas por turno) + Motor Heurístico Nativo de contingência (caso a API externa esteja indisponível ou sem chave, permitindo que comandos diretos continuem funcionando).
   - Conjunto de **12 Function Declarations (Tools)**:
     1. `create_transaction` (lançar despesa ou receita em conta ou cartão, à vista, parcelada ou recorrente)
     2. `transfer_between_accounts` (transferência entre contas bancárias, sujeita ao limiar de aprovação híbrida)
     3. `conciliate_transaction` (efetivar `is_effective = true/false` um lançamento existente ou recorrência do dia, atualizando o saldo da conta)
     4. `delete_transaction` (sempre solicita confirmação prévia antes de excluir e estornar saldo)
     5. `adjust_account_balance` (ajuste/conciliação direta do saldo de uma conta bancária, com confirmação ou undo)
     6. `pay_card_bill` (registrar pagamento de fatura de cartão em `paid_card_bills` e debitar da conta vinculada, com confirmação prévia)
     7. `create_fixed_item` (criar despesa fixa ou receita recorrente mensal)
     8. `query_financial_data` (buscar lançamentos, faturas detalhadas de um cartão por mês/ano, saldos ou itens fixos com filtros)
     9. `recommend_best_card` (ranking de float de todos os cartões na data atual)
     10. `simulate_purchase_impact` (simular compra à vista vs. parcelada no fluxo de caixa de 6 meses)
     11. `save_family_memory_fact` (adicionar nova regra/lembrete à memória permanente da família ou atualizar meta principal)
     12. `generate_executive_briefing` (gerar o relatório executivo diário / auditoria completa sob demanda)

4. **`morgan-telegram.js` (Gateway Telegram Bot Oficial & Adaptador WhatsApp):**
   - Operação via Long Polling resiliente (`getUpdates` com offset controlado, sem exigir certificado SSL externo ou exposição de porta adicional na Hetzner, funcionando inclusive atrás de NAT/Coolify imediatamente após colar o token).
   - Suporte a Whitelist de `chat_id` + comando `/parear <PIN>` (usa o mesmo PIN do usuário no Family Money, ex: `1202`, para autenticar e vincular o Telegram do dono com segurança total!).
   - Download automático de mensagens de voz (`voice` / `audio`) e fotos (`photo`) diretamente da API do Telegram, convertendo para Base64 e enviando ao núcleo multimodal do Gemini.
   - Renderização automática de teclados inline (`inline_keyboard`):
     - Quando uma ação verde é executada: botão `[↩️ Desfazer Lançamento #ID]`
     - Quando uma ação vermelha requer confirmação: botões `[✅ Confirmar #ID]` e `[❌ Cancelar #ID]`
     - No Briefing Matinal: botões rápidos `[💳 Melhor Cartão Hoje]`, `[📊 Projeção 6 Meses]`, `[✅ Efetivar Pendentes de Hoje]`.

5. **`morgan-scheduler.js` (Motor Proativo Autônomo 24/7):**
   - Loop de verificação a cada 60 segundos no fuso `America/Sao_Paulo`.
   - Dispara o **Briefing Diário Matinal** no horário configurado (uma vez por dia, persistindo `last_briefing_date` no banco).
   - Verifica alertas críticos de fechamento de fatura (2 dias antes e no dia do fechamento) e vencimento de fatura não paga (`paid_card_bills`).

---

## 3. Fluxo de Governança Híbrida e Reversão (`Undo`)

- **Execução com Snapshot (`executed`):**
  1. Ao executar `create_transaction` (ex: Despesa R$ 85,00 em Alimentação na conta Itaú Corrente, `is_effective: true`), o motor grava a transação, abate R$ 85,00 do saldo da conta Itaú, cria um registro em `morgan_action_logs` contendo `{ txId, accountBalanceBefore: 5500, accountId: 1 }` e chama `broadcastDbChange()`.
  2. O Telegram exibe a resposta do Morgan com o botão inline `callback_data: "undo:<actionLogId>"`.
  3. Se o usuário clicar em `↩️ Desfazer`, o backend restaura `accounts.balance = 5500`, remove a transação `txId`, marca o log como `undone`, dispara `broadcastDbChange()` e atualiza a mensagem no Telegram confirmando o estorno.

- **Aprovação Prévia (`pending_confirmation`):**
  1. Para `delete_transaction`, `pay_card_bill` ou `transfer_between_accounts` acima de `approval_threshold` (padrão R$ 1.000), a tool não altera as tabelas principais imediatamente: ela grava a intenção em `morgan_action_logs` com `status = 'pending_confirmation'` e retorna ao Morgan o resumo da operação pendente.
  2. O usuário recebe no Telegram (ou no Web App) o cartão da operação com botões `[✅ Confirmar]` (`confirm:<actionLogId>`) e `[❌ Cancelar]` (`cancel:<actionLogId>`).
  3. Ao clicar em `[✅ Confirmar]`, o motor executa a mutação no banco, dispara `broadcastDbChange()` e ainda oferece o botão `[↩️ Desfazer]`.

---

## 4. Integração e Sincronização com o Frontend (`public/index.html` e `public/app.js`)

1. **Unificação do Chat Web com o Backend (`/api/morgan/chat`):**
   - O chat do Morgan dentro da aba "Especialista IA" no Web App passa a enviar as mensagens para `POST /api/morgan/chat`, usufruindo das mesmas 12 ferramentas operacionais, memória persistente no PostgreSQL e botões de confirmação/desfazer direto na interface web.
2. **Painel de Configuração Telegram & Autonomia (`#ai-settings-modal`):**
   - Adição dos campos de configuração do Bot do Telegram (`Token do Bot @BotFather`, `Chat IDs Autorizados / Pareamento via PIN`, `Horário do Briefing Matinal`, `Limite para Confirmação Híbrida (R$)`) e botão **"📲 Enviar Briefing de Teste no Telegram"**.
3. **Sincronização da Memória (`#ai-memory-modal`):**
   - Diretrizes estratégicas e fatos memorizados passam a sincronizar bidirecionalmente com `/api/morgan/memory` no PostgreSQL.
