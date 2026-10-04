# Especificação Técnica: Apple Design System & Central de Memória e Aceleração do Morgan

## 1. Visão Geral e Objetivos
Esta especificação define a reformulação visual e arquitetural da plataforma FAMILY MONEY de acordo com o design system da **Apple** (baseado em [getdesign.md/apple/design-md](https://getdesign.md/apple/design-md)), a introdução de um alternador dinâmico de temas (**Modo Apple vs. Modo Escuro Clássico**), e a criação da **Central de Memória & Base de Conhecimento do Morgan**, permitindo transparência total de dados e aceleração de tempo de resposta.

---

## 2. Pilares Arquiteturais

### 2.1. Apple Design System (getdesign.md/apple/design-md)
- **Background Geral:** Cinza executivo mais escuro (`#e5e5ea` / `#ebebf0`).
- **Cards e Painéis:** Cinza claro / branco pérola refinado (`#ffffff` / `#f7f7f9`), com borda sutil de 1px (`rgba(0, 0, 0, 0.08)` / `#d2d2d7`) e sombras suaves (`0 4px 20px rgba(0,0,0,0.05)`).
- **Tipografia:** `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif`.
- **Cor do Texto Principal:** Preto Apple Ink (`#1d1d1f`).
- **Texto Secundário e Metadados:** Cinza escuro suave (`#6e6e73` e `#86868b`).
- **Ações e Interações:**
  - Cor de Ação Primária: **Action Blue** (`#0066cc`, hover `#0071e3`), seguindo o padrão oficial da Apple.
  - Border Radius: Cards com `16px` a `18px`, botões primários com estilo pílula (`rounded.pill` ou `10px`).
- **Semântica Financeira:**
  - Positivos (Entradas/Saldos/Sobra): Verde Apple (`#34c759` / `#28a745`).
  - Negativos (Saídas/Faturas/Déficit): Vermelho Apple (`#ff3b30` / `#dc3545`).
  - Alertas/Avisos: Âmbar Apple (`#ff9500`).

### 2.2. Alternador de Temas (Theme Switcher Persistente)
- Permitir que o usuário transite instantaneamente entre:
  1. **Modo Apple (Padrão):** Cards cinza claro, background cinza escuro, texto preto Apple Ink, botões Action Blue.
  2. **Modo Escuro Clássico:** Tema escuro atual (`#09090b`, vidro escuro, neon verde esmeralda).
- Botão seletor na barra superior (ao lado do crachá do usuário): `[🌓 Modo Apple / Modo Escuro]`.
- Persistência automática em `localStorage.getItem('familymoney_theme')`.

### 2.3. Aceleração do Tempo de Resposta da Morgan
1. **Pré-computação Local Instantânea (0ms):**
   - Cálculos de sobra orçamentária, matriz de float e anomalias de faturas executados localmente.
   - Respostas determinísticas imediatas para consultas financeiras diretas.
2. **Otimização de Contexto e Tokens para a API Gemini:**
   - Pre-digestão do JSON financeiro em um resumo sintetizado de alta densidade no System Prompt.
   - Priorização de modelos rápidos (`gemini-2.5-flash`, `gemini-1.5-flash-latest`).
3. **Feedback Visual Imediato:**
   - Digitação progressiva de resposta para sensação de resposta instantânea.

### 2.4. Central de Memória & Base de Conhecimento da Morgan
Um modal executivo acessível diretamente pelo menu do Especialista IA (`[🧠 Base de Dados & Memória]`):
- **Aba 1: Diretrizes Estratégicas:** Edição da Meta Financeira, Gastos Intocáveis e Perfil de Risco.
- **Aba 2: Caderno de Fatos Memorizados:** Lista interativa de regras aprendidas pela Morgan com botão para adicionar novo fato ou excluir fatos antigos.
- **Aba 3: Base de Dados em Tempo Real (Snapshot):** Inspeção visual transparente de todas as contas, cartões e faturas.
- **Aba 4: Histórico de Conversas:** Visualização e limpeza do histórico de diálogos.
