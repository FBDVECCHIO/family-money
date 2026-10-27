# Design Document: Visual Vessa Dashboard, Reestruturação Prioritária e Efetivação Robusta de Pagamentos

**Data**: 27 de Outubro de 2026  
**Status**: Aprovado pelo Usuário  
**Sistema**: Family Money (Full-stack Node.js + Vanilla JS/CSS + PostgreSQL / Local Engine)  
**Autor**: Protocolo A.T.L.A.S.  

---

## 1. Objetivos e Escopo

1. **Correção Definitiva da Efetivação de Despesas e Pagamentos**:
   - Eliminar travamentos, bloqueios de thread e falhas silenciosas na efetivação de despesas fixas recorrentes, transações avulsas e faturas de cartão.
   - Suporte irrepreensível em todas as modalidades: Desktop, Tablet e Smartphone.
   - Substituição total de diálogos síncronos nativos (`alert()`, `prompt()`) por Modais Glass Vessa fluidos com tratamento assíncrono, feedback otimista instantâneo e proteção contra cliques duplos.
   - Garantir que a edição rápida de despesas vigentes do mês e contas funcione sem travamentos.

2. **Design System VESSA ("Warm Luxury Editorial SaaS")**:
   - Tipografia **Urbanist** integrada nativamente com pesos 500, 600, 700 e 800.
   - Cores orgânicas: Fundo Linho/Sage (`#EEF0EC`), Cards em Branco Puro Refinado (`#FCFDFC`) com bordas orgânicas contínuas de **22px** e sombras aeradas (`0 14px 34px -22px rgba(20, 36, 28, 0.28)`).
   - Acentos: Terracota (`#BA4A24`), Verde Floresta/Teal (`#247B7B`), Âmbar (`#D9822B`).
   - Botões magnéticos em formato pílula circular (`border-radius: 999px`) com sombra difusa e foco suave.
   - Command Palette Global com atalho `Ctrl + K` / `⌘K`.

3. **Reorganização Prioritária do Dashboard**:
   - Conforme especificação mandatória do usuário, a apresentação inicial priorizará a seguinte ordem:
     1. **Cards da Projeção dos Próximos 6 Meses** (visão semestral consolidada, saldo projetado e sobra mensal).
     2. **Faturas de Cartões de Crédito** (fechamentos, vencimentos, valores em aberto e botão direto de efetivação).
     3. **Contas Bancárias e Efetivação de Despesas Vigentes do Mês** (saldos atuais, edição rápida de valores e botões de efetivação para despesas do mês).
     4. **Demais Itens**: Mapa de Despesas (% da receita) e Lançamentos Recentes com badges em tempo real.

4. **Navegação Mobile em Tap Bar Superior**:
   - No smartphone e tablet, a navegação principal adota uma **Tap Bar Superior em Pílulas** com rolagem horizontal suave (`context-tabs`), garantindo que o usuário alterne entre abas (Dashboard, Especialista IA, Relatórios, etc.) com um simples toque no topo, sem poluição na base da tela.

5. **Redesign da Tela de Login por PIN**:
   - Aplicação integral do visual Vessa na tela de acesso por PIN: cartão centralizado com curvatura de 26px, slots elegantes em pílula com brilho suave, teclado numérico magnético circular e atalhos de usuários em cápsulas táteis refinadas.

---

## 2. Arquitetura e Engenharia de Componentes

### 2.1. Motor de Efetivação e Reconciliação (Zero-Locking)

#### Problemas Diagnosticados na Rotina Anterior:
1. **Uso de `alert()` e `prompt()` nativos**:
   - No iOS Safari e Android Chrome, `alert()` bloqueia a thread de execução do JavaScript, impedindo a resolução de promessas de renderização e causando congelamento na interface.
   - `prompt()` frequentemente é bloqueado por navegadores móveis, retornando `null` ou travando a captura do teclado virtual.
2. **Ausência de Trava de Concorrência (Double-tap)**:
   - Toques rápidos no botão "Confirmar Efetivação" disparavam o callback múltiplas vezes, gerando transações duplicadas e debitando a conta bancária duas vezes.
3. **Colisão de Eventos SSE vs. `loadAllData()`**:
   - Ao disparar inserção de transação + atualização de saldo de conta, o SSE notificava mutações em paralelo ao `loadAllData()` assíncrono não aguardado, gerando concorrência de leitura e recarregamentos em loop.

#### Solução Arquitetural:
- **`VessaModal` / `showVessaActionModal`**:
  - Modal dinâmico montado sobre a árvore de visualização com backdrop-filter e transições suaves em CSS.
  - Botão de confirmação com estado `disabled` imediato e spinner visual ("Efetivando...").
  - Suporte completo a edição de valor e seleção de conta com validação numérica antes de disparar a requisição.
- **Atualização Otimista com Fallback Seguro**:
  - Ao confirmar a efetivação, o estado local da transação/item fixo e o saldo da conta selecionada são atualizados instantaneamente em memória (`state.accounts` e `state.transactions`), e o DOM é atualizado de forma síncrona.
  - A requisição para o servidor ocorre em segundo plano. Se houver sucesso, o banco é consolidado e uma notificação suave em `Toast` é exibida (`showToast('Despesa efetivada com sucesso!', 3000, true)`). Se houver erro, a reversão otimista restaura os valores originais e um alerta amigável em toast é apresentado.
- **Semáforo Global `isReconciling`**:
  - Bloqueia novas ações de efetivação simultâneas enquanto uma estiver em processamento.

---

### 2.2. Ordem de Apresentação do Dashboard

```
+--------------------------------------------------------------------------------------------------------------------+
| [HEADER VESSA] Logo Family Money | Tap Bar Superior: [Dashboard] [IA 24h] [Relatórios] | [Busca Ctrl+K] [+ Novo] [FP] |
+--------------------------------------------------------------------------------------------------------------------+
| 1. [PROJEÇÃO 6 MESES - CARDS PRINCIPAIS]                                                                           |
|    - Grid com os 6 meses futuros (Out, Nov, Dez, Jan, Fev, Mar) destacando Receita, Despesas e Sobra Prevista      |
|    - Hero Card com Saudação e Previsão Consolidada + KPIs com Sparklines de 30 dias                                |
+--------------------------------------------------------------------------------------------------------------------+
| 2. [CARTÕES DE CRÉDITO & FATURAS]                                                                                  |
|    - Faturas abertas, dias de fechamento e vencimento de cada cartão                                               |
|    - Botão direto "Efetivar Fatura" com abertura do VessaModal                                                     |
+--------------------------------------------------------------------------------------------------------------------+
| 3. [CONTAS BANCÁRIAS & DESPESAS VIGENTES DO MÊS]                                                                   |
|    - Saldos reais de cada conta com edição rápida de saldo                                                         |
|    - Tabela de Despesas Fixas e Recorrentes do Mês com status [Efetivado ✓] ou botão [Efetivar]                   |
|    - Ação rápida de edição de valor da despesa vigente com VessaModal embutido                                     |
+--------------------------------------------------------------------------------------------------------------------+
| 4. [MAPA DE DESPESAS & LANÇAMENTOS RECENTES]                                                                       |
|    - Gráfico/Barras de comprometimento da receita por categoria                                                    |
|    - Extrato recente de lançamentos em tempo real                                                                  |
+--------------------------------------------------------------------------------------------------------------------+
```

---

### 2.3. Tap Bar Superior Mobile

- No mobile (`@media (max-width: 900px)`):
  - O menu principal é posicionado diretamente no topo da tela, abaixo da barra de marca.
  - Formato de pílulas horizontais com rolagem suave `overflow-x: auto` e `scroll-behavior: smooth`.
  - Toque ergonômico com altura mínima de 44px (padrão Apple HIG).
  - Aba ativa com preenchimento escuro `#18201B` e texto branco com micro-sombra.

---

### 2.4. Tela de Login por PIN Vessa

- Superfície com fundo Linho Suave `#EEF0EC`.
- Card de autenticação com cantos arredondados de `26px`, borda sutil `rgba(20, 36, 28, 0.08)` e sombra difusa.
- 4 slots de PIN com animação de preenchimento em Terracota (`#BA4A24`) e feedback visual de pulso.
- Teclado numérico com botões circulares táteis de 64px, efeito hover/active e números em tipografia Urbanist 800.
- Pílulas de acesso rápido com nomes dos familiares e avatares coloridos.

---

## 3. Plano de Testes & Validação (com `agent-browser`)

1. **Teste de Efetivação no Desktop**:
   - Navegar até o Dashboard.
   - Clicar em "Efetivar" numa despesa recorrente.
   - Validar abertura do VessaModal.
   - Confirmar efetivação e validar atualização imediata do saldo e badge "Efetivado ✓".
2. **Teste de Efetivação no Smartphone (390 × 844)**:
   - Emular viewport móvel.
   - Testar clique em "Efetivar" em dispositivo touch.
   - Validar que o modal surge ajustado à tela sem transbordo e fecha sem travar a interface.
3. **Teste de Edição Rápida de Despesa Vigente**:
   - Clicar no botão de edição de valor na tabela do Dashboard.
   - Inserir novo valor no VessaModal e confirmar.
   - Validar sincronização imediata no backend e reflexo na projeção.
4. **Teste da Tela de PIN no Novo Visual**:
   - Deslogar ou acessar página inicial desautenticada.
   - Validar visual Vessa do PIN terminal e testar digitação de PIN.
5. **Teste da Tap Bar Superior**:
   - Alternar entre abas (Dashboard, Especialista IA, Relatórios) usando a Tap Bar superior no mobile.
