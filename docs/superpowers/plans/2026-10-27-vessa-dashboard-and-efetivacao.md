# Plano de Implementação: Visual Vessa Dashboard, Reestruturação Prioritária e Efetivação Robusta de Pagamentos

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o design system Vessa Dashboard no Family Money, reestruturar a ordem das seções do Dashboard priorizando a projeção de 6 meses, cartões e contas/despesas vigentes, eliminar definitivamente qualquer travamento na efetivação de pagamentos com modais assíncronos não-bloqueantes, adotar tap bar superior no mobile e renovar visualmente a tela de PIN.

**Architecture:** A camada de interface do frontend (`public/app.js`, `public/style.css`, `public/index.html`) será atualizada com design tokens Vessa (fundo Linho `#EEF0EC`, tipografia Urbanist, cards com cantos de 22px, pílulas magnéticas e acentos terracota/teal). A rotina de reconciliação de pagamentos será totalmente desvinculada de `alert()` e `prompt()` nativos através de um componente modular `VessaModal` assíncrono com trava de concorrência, atualização otimista e notificações toast. No mobile, a navegação adotará tap bar superior horizontal ergonômica.

**Tech Stack:** Node.js, Express, HTML5, CSS3 Moderno (Glassmorphism + Vessa tokens), Vanilla JavaScript ES6+, Lucide Icons, Puppeteer / Agent-Browser CLI para testes E2E.

**Spec:** `docs/superpowers/specs/2026-10-27-vessa-dashboard-and-efetivacao-design.md`

## Global Constraints

- Proibido o uso de `alert()` e `prompt()` nativos em qualquer rotina de efetivação ou edição (causa bloqueio de thread no Safari iOS e Android Chrome).
- Preservar todas as regras de negócio de fechamento/vencimento de cartões, cálculo de projeção de 6 meses e persistência no banco de dados.
- O Dashboard deve apresentar prioritariamente: 1º Projeção de 6 meses; 2º Cartões de Crédito; 3º Contas e Lançamentos Vigentes com Efetivação e Edição Rápida.
- No smartphone, o menu deve obrigatoriamente utilizar formato de Tap Bar Superior em pílulas horizontais.
- A tela de autenticação por PIN deve incorporar o novo visual Vessa com harmonia visual completa.
- Todo teste de interface deve ser verificado em resoluções Desktop (1440x900) e Smartphone (390x844).

---

### Task 1: Motor de Efetivação Robusta & Modais Glass Vessa (Substituição de alert/prompt)

**Files:**
- Modify: `public/app.js:2460-2655`
- Modify: `public/style.css`

**Interfaces:**
- Produces: `showVessaActionModal({ title, subtitle, amount, accounts, defaultAccountId, onConfirm, onCancel })`
- Produces: `showVessaEditValueModal({ title, subtitle, currentVal, onConfirm, onCancel })`
- Refactors: `reconcileRecurrence(recurrenceId, year, month)`
- Refactors: `reconcileTransaction(id)`
- Refactors: `payCardBill(cardId, year, month, amount)`
- Refactors: `promptQuickEditFixed(id, currentAmount, desc)`

- [ ] **Step 1: Implementar os componentes VessaModal no CSS e JS**
  Criar a estilização dos modais translúcidos Vessa no `style.css` com backdrop-filter, bordas de 22px, inputs refinados e botões em pílula com indicador de carregamento ("Efetivando...").
  Implementar em `public/app.js` as funções `showVessaActionModal` e `showVessaEditValueModal` com bloqueio contra múltiplos cliques e semáforo global `isReconciling`.

- [ ] **Step 2: Refatorar `reconcileRecurrence`, `reconcileTransaction` e `payCardBill`**
  Substituir a função antiga `promptAccountSelection` e remover chamadas a `alert(...)`.
  Adicionar atualização otimista na memória (`state.accounts` e `state.transactions`) antes de aguardar a rede, com reversão automática caso a requisição falhe.
  Exibir confirmação via `showToast('...', 3000, true)`.

- [ ] **Step 3: Refatorar `promptQuickEditFixed` para usar o VessaEditValueModal**
  Eliminar o uso de `window.prompt` e validar a entrada numérica em modal dedicado estilizado.

- [ ] **Step 4: Verificar integridade e ausência de erros de sintaxe**
  Executar checagem de sintaxe via `node --check public/app.js`.

---

### Task 2: Reestruturação da Ordem de Apresentação do Dashboard Conforme Especificação

**Files:**
- Modify: `public/index.html:260-400`
- Modify: `public/app.js:1800-2100`
- Modify: `public/style.css`

**Interfaces:**
- Reorganiza a hierarquia do Dashboard no DOM para:
  1. Topo: Hero Greeting Card Vessa + Indicadores de Saldo/Sobra + Cards da Projeção dos Próximos 6 Meses (`#forecast-cards-container` / `#forecast-six-months`).
  2. Meio 1: Seção de Cartões de Crédito (`#inline-cards-overview`) com fechamento, vencimento e botão de efetivação.
  3. Meio 2: Seção de Contas Bancárias (`#inline-accounts-overview`) com saldos atuais e opção de edição, seguida imediatamente pela tabela de Efetivação e Edição de Despesas Vigentes do Mês (`#inline-fixed-tbody`).
  4. Base: Mapa de Despesas (% da receita) e Lançamentos Recentes com sincronização ativa.

- [ ] **Step 1: Atualizar a estrutura HTML do Dashboard em `public/index.html`**
  Posicionar os cards da Projeção de 6 Meses no topo da visualização após o Hero Card.
  Posicionar o bloco de Cartões de Crédito e Faturas imediatamente abaixo.
  Posicionar o bloco de Contas Bancárias e a Tabela de Despesas Vigentes do Mês com os botões de ação e edição.

- [ ] **Step 2: Adaptar as rotinas de renderização em `public/app.js`**
  Ajustar `renderDashboard()` para preencher os dados respeitando a nova ordem visual.

- [ ] **Step 3: Ajustar estilos dos cards no `public/style.css`**
  Aplicar o visual Vessa: `border-radius: 22px`, fundo `#FCFDFC`, sombras aeradas e espaçamentos harmônicos.

---

### Task 3: Tap Bar Superior no Mobile & Responsividade Smartphone / Tablet

**Files:**
- Modify: `public/index.html:195-240`
- Modify: `public/style.css`
- Modify: `public/app.js:100-150`

**Interfaces:**
- Produces: `.mobile-top-tapbar` (Navegação em pílulas horizontais no topo com scroll suave)
- Responsividade: Breakpoint de 900px para empilhamento limpo sem cortes laterais

- [ ] **Step 1: Criar a Tap Bar Superior em `public/index.html` e `style.css`**
  Implementar o menu de abas em formato pílula horizontal no topo da tela em dispositivos móveis (`display: flex; overflow-x: auto; -webkit-overflow-scrolling: touch; gap: 8px; padding: 10px 14px;`).
  Garantir que a aba ativa receba o destaque Vessa (`background: #18201B; color: #FFF; border-radius: 999px`).

- [ ] **Step 2: Ajustar estilos de responsividade em `public/style.css`**
  Garantir que cards, tabelas e gráficos colapsem fluidamente em telas de 390px (smartphones) e 768px (tablets).

---

### Task 4: Redesign Vessa da Tela de Login por PIN

**Files:**
- Modify: `public/index.html:138-192`
- Modify: `public/style.css`

**Interfaces:**
- Aplica o tema Vessa ao `#login-container`, `.pin-terminal-card`, `.pin-slot`, `.key-btn` e `.user-shortcut`.

- [ ] **Step 1: Aplicar tokens Vessa ao Terminal de PIN no `style.css`**
  Superfície Linho/Sage de fundo (`#EEF0EC`), card em branco refinado com curvatura de 26px e sombra difusa.
  Slots de PIN estilizados em pílulas translúcidas com acento terracota ao preencher.
  Teclado numérico com botões magnéticos circulares táteis e tipografia Urbanist 800.
  Pílulas de atalho de usuários em cápsulas elegantes (`border-radius: 999px`).

- [ ] **Step 2: Testar interatividade do PIN**
  Garantir que a digitação de 4 dígitos, limpeza e seleção de atalhos permaneçam instantâneas e sem atrasos.

---

### Task 5: Validação Automatizada de Ponta a Ponta com `agent-browser` & Deploy na VPS

**Files:**
- Create: `scratch/test_vessa_suite.js`
- Deploy: Repositório Git e Container Coolify na VPS (`167.233.112.111`)

- [ ] **Step 1: Executar bateria de testes automatizados via Puppeteer / Agent-Browser**
  Validar a tela de PIN (visual Vessa).
  Efetuar login com PIN 1202.
  Validar a ordem do Dashboard (Projeção de 6 Meses -> Cartões -> Contas e Despesas Vigentes).
  Testar o clique de "Efetivar" e verificar a abertura do `VessaModal`.
  Confirmar a efetivação e validar atualização de saldo sem travamentos e com Toast.
  Testar a edição de despesa via `VessaEditValueModal`.
  Capturar screenshots em Desktop (1440x900) e Mobile (390x844).

- [ ] **Step 2: Commit das alterações e Deploy na VPS Coolify**
  Realizar commit no repositório git local.
  Enviar para a VPS via Git / SSH e acionar rebuild e reinicialização do container Docker no Coolify.
  Verificar logs do container para confirmar operação estável.
