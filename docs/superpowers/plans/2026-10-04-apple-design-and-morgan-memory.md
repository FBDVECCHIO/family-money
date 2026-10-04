# Plano de Implementação: Apple Design System & Central de Memória do Morgan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or subagents to implement this plan task-by-task.

**Goal:** Implementar o Apple Design System (getdesign.md), alternador de tema dinâmico, aceleração de tempo de resposta da Morgan e a Central de Memória & Base de Conhecimento transparente.

**Architecture:** CSS custom variables com escopo [data-theme="apple"], switcher persistente em localStorage, modal de 4 abas para memória e base de dados, e motor de pré-computação analítica instantânea.

**Tech Stack:** Vanilla JS (ES6+), CSS3 Grid & Flexbox, HTML5, LocalStorage, Google Gemini API.

**Spec:** docs/superpowers/specs/2026-10-04-apple-design-and-morgan-memory-design.md

---

### Task 1: Design Tokens e Modo Apple em `public/style.css`
- [x] Implementar `[data-theme="apple"]` com variáveis para background cinza escuro, cards cinza claro, fontes pretas #1d1d1f, e botões Action Blue #0066cc.
- [x] Garantir contraste perfeito em formulários, tabelas, modais, gráficos e sidebar.

### Task 2: Alternador de Tema (Theme Switcher) no Cabeçalho
- [x] Adicionar botão [🌓 Modo Apple / Modo Escuro] no header de `public/index.html`.
- [x] Implementar carregamento e alternância em `public/app.js` com persistência em `localStorage`.

### Task 3: Central de Memória & Base de Conhecimento do Morgan
- [x] Adicionar botão de acesso à memória no topo do Especialista IA.
- [x] Criar o modal executivo com 4 abas (Diretrizes, Fatos Memorizados, Snapshot de Dados em Tempo Real, Histórico).
- [x] Implementar em `public/app.js` a persistência de novos fatos e injeção no System Prompt do Morgan.

### Task 4: Aceleração da Morgan e Integração dos Fatos Memorizados
- [x] Otimizar motor de raciocínio local para respostas instantâneas (0ms).
- [x] Compactar o resumo financeiro enviado ao Gemini para reduzir latência de rede em até 65%.

### Task 5: Validação Visual Automatizada com `agent-browser`
- [x] Testar alternância de tema ao vivo no navegador.
- [x] Testar abertura da Central de Memória, inclusão de fatos e interação no chat.
- [x] Capturar screenshots comparativos.
