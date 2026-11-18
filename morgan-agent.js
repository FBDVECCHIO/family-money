/**
 * ============================================================================
 * MORGAN COGNITIVE AGENT CORE — GEMINI FUNCTION CALLING, MULTIMODAL & FALLBACK
 * ============================================================================
 * Cérebro unificado do Agente Financeiro Morgan (Telegram, WhatsApp e Web App).
 * Suporta:
 *  - Loop Agêntico Multi-Turn com 12 Tools Operacionais (Gemini Function Calling)
 *  - Multimodalidade Nativa: Áudio/Voz (.ogg/.mp3) e Fotos de Comprovantes (.jpg/.png)
 *  - Parser Transacional Natural-Language + Motor Analítico Nativo (Zero-Downtime Fallback)
 *  - Memória Conversacional Persistente no PostgreSQL / Banco Local
 */

const db = require('./db');
const engine = require('./morgan-finance-engine');

// ============================================================================
// 1. DECLARAÇÃO DAS 12 FERRAMENTAS OPERACIONAIS (GEMINI FUNCTION DECLARATIONS)
// ============================================================================
const MORGAN_TOOLS_DECLARATIONS = [
  {
    name: 'create_transaction',
    description: 'Registra um novo lançamento financeiro (despesa ou receita) em uma conta bancária ou cartão de crédito. Atualiza automaticamente o saldo da conta se for à vista/efetivado.',
    parameters: {
      type: 'OBJECT',
      properties: {
        description: { type: 'STRING', description: 'Descrição clara do lançamento (ex: Supermercado Pão de Açúcar, Combustível, Salário, Pix Restaurante)' },
        amount: { type: 'NUMBER', description: 'Valor em reais (positivo, ex: 185.50)' },
        type: { type: 'STRING', description: 'Tipo: "expense" para despesa/gasto ou "income" para receita/entrada' },
        payment_method: { type: 'STRING', description: '"account" para débito/pix/dinheiro em conta bancária, ou "card" para compra em cartão de crédito' },
        account_name: { type: 'STRING', description: 'Nome ou parte do nome da conta bancária (ex: Itaú, Nubank, XP)' },
        card_name: { type: 'STRING', description: 'Nome ou parte do nome do cartão de crédito (ex: Nubank Roxinho, XP Visa, Itaú Click)' },
        category_name: { type: 'STRING', description: 'Categoria (ex: Alimentação, Transporte, Moradia, Saúde, Educação, Lazer, Assinaturas & Serviços, Outros)' },
        installments: { type: 'INTEGER', description: 'Número de parcelas no cartão de crédito (padrão: 1)' },
        date: { type: 'STRING', description: 'Data no formato YYYY-MM-DD (se omitido, usa a data de hoje)' },
        is_effective: { type: 'BOOLEAN', description: 'true se já foi pago/efetivado, false se for um lançamento agendado/previsto' }
      },
      required: ['description', 'amount', 'type']
    }
  },
  {
    name: 'transfer_between_accounts',
    description: 'Realiza uma transferência de valores entre duas contas bancárias da família (ex: do Itaú para a XP Investimentos). Valores acima do limite de segurança entram em confirmação híbrida.',
    parameters: {
      type: 'OBJECT',
      properties: {
        amount: { type: 'NUMBER', description: 'Valor da transferência em reais' },
        from_account: { type: 'STRING', description: 'Nome ou ID da conta de origem (de onde sai o dinheiro)' },
        to_account: { type: 'STRING', description: 'Nome ou ID da conta de destino (para onde vai o dinheiro)' },
        description: { type: 'STRING', description: 'Descrição opcional da transferência' },
        date: { type: 'STRING', description: 'Data YYYY-MM-DD' }
      },
      required: ['amount', 'from_account', 'to_account']
    }
  },
  {
    name: 'conciliate_transaction',
    description: 'Marca um lançamento pendente como efetivado/pago (is_effective = true) ou reverte para pendente, ajustando o saldo da conta bancária vinculada.',
    parameters: {
      type: 'OBJECT',
      properties: {
        transaction_id: { type: 'INTEGER', description: 'ID numérico do lançamento (se conhecido)' },
        description: { type: 'STRING', description: 'Texto parcial da descrição do lançamento caso o ID não seja informado' },
        is_effective: { type: 'BOOLEAN', description: 'true para efetivar/conciliar, false para marcar como pendente' }
      }
    }
  },
  {
    name: 'delete_transaction',
    description: 'Solicita a exclusão de um lançamento financeiro e o estorno do respectivo saldo. Sempre gera um pedido de confirmação de segurança para o usuário.',
    parameters: {
      type: 'OBJECT',
      properties: {
        transaction_id: { type: 'INTEGER', description: 'ID numérico do lançamento a excluir' },
        description: { type: 'STRING', description: 'Descrição parcial do lançamento caso o ID não seja conhecido' }
      }
    }
  },
  {
    name: 'adjust_account_balance',
    description: 'Ajusta ou corrige diretamente o saldo atual de uma conta bancária para conciliação.',
    parameters: {
      type: 'OBJECT',
      properties: {
        account_name: { type: 'STRING', description: 'Nome ou ID da conta bancária (ex: Itaú Corrente, Nubank Poupança, XP Investimentos)' },
        new_balance: { type: 'NUMBER', description: 'Novo valor exato do saldo em reais' }
      },
      required: ['account_name', 'new_balance']
    }
  },
  {
    name: 'pay_card_bill',
    description: 'Registra o pagamento/quitação da fatura mensal de um cartão de crédito e debita da conta bancária vinculada (com confirmação de segurança).',
    parameters: {
      type: 'OBJECT',
      properties: {
        card_name: { type: 'STRING', description: 'Nome ou ID do cartão de crédito' },
        amount: { type: 'NUMBER', description: 'Valor pago da fatura (se omitido, usa o valor total calculado da fatura atual)' },
        month: { type: 'INTEGER', description: 'Mês da fatura (1 a 12)' },
        year: { type: 'INTEGER', description: 'Ano da fatura (ex: 2026)' },
        account_name: { type: 'STRING', description: 'Conta bancária de onde sairá o pagamento' }
      },
      required: ['card_name']
    }
  },
  {
    name: 'create_fixed_item',
    description: 'Cadastra uma nova despesa fixa mensal (assinatura, aluguel, escola) ou receita recorrente (salário, dividendo).',
    parameters: {
      type: 'OBJECT',
      properties: {
        description: { type: 'STRING', description: 'Nome da despesa fixa ou receita recorrente' },
        amount: { type: 'NUMBER', description: 'Valor mensal em reais' },
        day_of_month: { type: 'INTEGER', description: 'Dia do mês de vencimento ou recebimento (1 a 31)' },
        type: { type: 'STRING', description: '"expense" para despesa fixa ou "income" para receita fixa' },
        account_name: { type: 'STRING', description: 'Nome da conta bancária (se debitado em conta)' },
        card_name: { type: 'STRING', description: 'Nome do cartão de crédito (se for assinatura no cartão)' },
        category_name: { type: 'STRING', description: 'Nome da categoria' }
      },
      required: ['description', 'amount', 'day_of_month', 'type']
    }
  },
  {
    name: 'query_financial_data',
    description: 'Pesquisa lançamentos, gastos por categoria, faturas de cartão de crédito ou saldos de contas com filtros.',
    parameters: {
      type: 'OBJECT',
      properties: {
        search_term: { type: 'STRING', description: 'Termo de busca na descrição' },
        category_name: { type: 'STRING', description: 'Filtrar por nome da categoria' },
        card_name: { type: 'STRING', description: 'Filtrar por cartão de crédito' },
        account_name: { type: 'STRING', description: 'Filtrar por conta bancária' },
        type: { type: 'STRING', description: '"expense", "income" ou "transfer"' },
        month_key: { type: 'STRING', description: 'Filtrar por mês no formato YYYY-MM (ex: 2026-11)' },
        limit: { type: 'INTEGER', description: 'Quantidade máxima de registros (padrão 15)' }
      }
    }
  },
  {
    name: 'recommend_best_card',
    description: 'Analisa a data de fechamento e vencimento de todos os cartões da família hoje e retorna o ranking de float (maior prazo sem juros).',
    parameters: {
      type: 'OBJECT',
      properties: {
        reference_date: { type: 'STRING', description: 'Data YYYY-MM-DD opcional para simular qual cartão usar' }
      }
    }
  },
  {
    name: 'simulate_purchase_impact',
    description: 'Simula o impacto de uma nova compra (à vista ou parcelada) no fluxo de caixa dos próximos 6 meses e calcula o ganho de arbitragem no CDI.',
    parameters: {
      type: 'OBJECT',
      properties: {
        amount: { type: 'NUMBER', description: 'Valor total da compra planejada' },
        installments: { type: 'INTEGER', description: 'Número de parcelas sem juros (padrão 1)' }
      },
      required: ['amount']
    }
  },
  {
    name: 'save_family_memory_fact',
    description: 'Memoriza permanentemente uma nova regra, fato, lembrete ou atualiza a meta financeira principal da família no banco de dados.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fact: { type: 'STRING', description: 'Fato, regra ou preferência a ser memorizada pelo Morgan' },
        family_goal: { type: 'STRING', description: 'Nova meta principal da família (se o usuário pedir para mudar a meta)' },
        untouchable_expenses: { type: 'STRING', description: 'Gastos inegociáveis atualizados' },
        risk_profile: { type: 'STRING', description: 'Perfil de risco atualizado' }
      }
    }
  },
  {
    name: 'generate_executive_briefing',
    description: 'Gera o Briefing Executivo Completo com saldos, faturas abertas, melhor cartão do dia, pendências de hoje e projeção do mês.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  }
];

// ============================================================================
// 2. GERENCIAMENTO DE HISTÓRICO CONVERSACIONAL NO BANCO
// ============================================================================

async function getRecentConversationHistory(channel = 'web', chatId = 'default', limit = 8) {
  try {
    const rows = await db.selectRows('morgan_conversations', {
      channel: `eq.${channel}`,
      chat_id: `eq.${chatId}`,
      order: 'id.desc',
      limit: String(limit)
    });
    return (rows || []).reverse();
  } catch (e) {
    return [];
  }
}

async function appendConversationTurn(channel, chatId, role, content, toolCalls = null) {
  try {
    await db.insertRows('morgan_conversations', {
      channel,
      chat_id: String(chatId),
      role,
      content: String(content || ''),
      tool_calls_json: toolCalls ? JSON.stringify(toolCalls) : null
    });
  } catch (e) {
    console.warn('[MORGAN-AGENT] Aviso ao gravar histórico:', e.message);
  }
}

// ============================================================================
// 3. SYSTEM INSTRUCTION DO MORGAN (PERSONA CFO + REGRAS DE AÇÃO)
// ============================================================================

function buildMorganSystemInstruction(ctxObj) {
  const { richContext } = ctxObj;
  const mem = richContext.memoriaEstrategicaFamilia;

  return `Você é MORGAN, Chief Financial Officer (CFO) sênior e Agente Autônomo 24/7 da família no sistema Family Money.
Sua máxima: "Receita é vaidade, lucro é sanidade, fluxo de caixa é a realidade."

DIRETRIZES E MEMÓRIA PERMANENTE DA FAMÍLIA:
- Meta Financeira Principal: "${mem.metaPrincipal}"
- Gastos Intocáveis (Jamais cortar): "${mem.gastosInegociaveis}"
- Perfil de Risco: "${mem.perfilRisco}"
- Fatos e Regras Memorizadas:
${(mem.fatosMemorizados && mem.fatosMemorizados.length > 0) ? mem.fatosMemorizados.map(f => `  * ${f}`).join('\n') : '  * (Nenhum fato extra cadastrado)'}

COMO VOCÊ OPERA (CAPACIDADES ATIVAS E REATIVAS):
1. VOCÊ TEM MÃOS OPERACIONAIS (TOOLS): Sempre que o usuário pedir para lançar uma despesa, registrar uma receita, fazer uma transferência entre contas, efetivar/conciliar um lançamento, excluir um item, ajustar saldo, pagar fatura, simular compra ou memorizar um fato, CHAME IMEDIATAMENTE A FERRAMENTA CORRESPONDENTE. Não diga apenas que vai fazer — execute a ferramenta!
2. ÁUDIO E FOTOS DE COMPROVANTES: Se o usuário enviar um áudio (nota de voz) dizendo o que gastou ou enviar a foto de um comprovante PIX/nota fiscal/cupom de cartão, extraia o valor, estabelecimento/descrição, categoria, conta ou cartão e chame \`create_transaction\` (ou \`transfer_between_accounts\`) imediatamente.
3. GOVERNANÇA HÍBRIDA:
   - Quando uma ferramenta retornar \`status: "executed"\`, confirme ao usuário os detalhes exatos gravados (valor, conta/cartão, novo saldo atualizado) e informe que ele pode desfazer com 1 clique no botão abaixo se desejar.
   - Quando uma ferramenta retornar \`status: "pending_confirmation"\`, explique claramente que você preparou a operação e aguarda o clique dele no botão [Confirmar] por segurança.
4. INTELIGÊNCIA DE CARTÕES & CDI:
   - Sempre que relevante, oriente sobre o melhor cartão do dia (maior float sem juros) e o rendimento do caixa a 100% do CDI (${richContext.cenarioMacroBrasil.cdi}).
5. COMUNICAÇÃO: Responda em português do Brasil com elegância executiva, clareza, formatação Markdown limpa (negrito e listas objetivas) e números precisos baseados exclusivamente no snapshot real abaixo.

[SNAPSHOT FINANCEIRO EM TEMPO REAL DA BASE DE DADOS]
${JSON.stringify(richContext, null, 2)}`;
}

// ============================================================================
// 4. PARSER NATURAL-LANGUAGE & MOTOR NATIVO (CONTINGÊNCIA / MODO SEM CHAVE)
// ============================================================================

async function runLocalAutonomousParserAndReasoning(userText, options = {}) {
  const { channel = 'web', chatId = 'default' } = options;
  const text = String(userText || '').trim();
  const q = engine.normalizeStr(text);
  const executedActions = [];

  // Helper para extrair valor monetário em PT-BR (ex: "150", "150,50", "R$ 1.200,00", "1200.50")
  function extractMoneyAmount(str) {
    const cleaned = str.replace(/r\$\s*/gi, '');
    const match = cleaned.match(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)/);
    if (!match) return null;
    let raw = match[1];
    if (raw.includes('.') && raw.includes(',')) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (raw.includes(',')) {
      raw = raw.replace(',', '.');
    }
    const val = parseFloat(raw);
    return (!isNaN(val) && val > 0) ? val : null;
  }

  const ctx = await engine.buildMorganRichContext();
  const { accounts, cards } = ctx.raw;

  // 1. Comando de Memorização ("lembre-se que...", "memorize que...", "grave na memória...")
  if (q.startsWith('lembre') || q.startsWith('memoriz') || q.includes('grave na memoria') || q.includes('lembrar que')) {
    const factText = text
      .replace(/^(morgan[,\s]*)?(por favor[,\s]*)?(lembre(?:-se)?(?:\s+que)?|memorize(?:\s+que)?|grave na mem[oó]ria(?:\s+que)?)\s*/i, '')
      .trim();
    if (factText.length > 3) {
      const res = await engine.executeToolAction('save_family_memory_fact', { fact: factText }, { channel, chatId });
      if (res.ok) executedActions.push(res);
      return {
        reply: `🧠 **Memória Estratégica Atualizada!**\n\nRegistrei permanentemente a diretriz:\n> *"${factText}"*\n\nEla já está ativa para todas as minhas análises no Telegram e no painel Web.`,
        actions: executedActions,
        engineUsed: 'native-autonomous'
      };
    }
  }

  // 2. Comando de Transferência ("transfira 500 do itau para a xp", "transferir 1500 de itau pra nubank")
  if (q.includes('transf')) {
    const amount = extractMoneyAmount(text);
    if (amount) {
      let fromAcc = null;
      let toAcc = null;
      for (const acc of accounts) {
        const accNorm = engine.normalizeStr(acc.name);
        const firstWord = accNorm.split(' ')[0];
        const fromRegex = new RegExp(`(?:de|do|da)\\s+${firstWord}`, 'i');
        const toRegex = new RegExp(`(?:para|pra|pro|no|na)\\s+${firstWord}`, 'i');
        if (fromRegex.test(q)) fromAcc = acc;
        if (toRegex.test(q)) toAcc = acc;
      }
      if (!fromAcc || !toAcc) {
        const mentioned = accounts.filter(acc => q.includes(engine.normalizeStr(acc.name).split(' ')[0]));
        if (mentioned.length >= 2) {
          fromAcc = fromAcc || mentioned[0];
          toAcc = toAcc || mentioned[1];
        }
      }
      if (fromAcc && toAcc && fromAcc.id !== toAcc.id) {
        const res = await engine.executeToolAction('transfer_between_accounts', {
          amount,
          from_account: fromAcc.id,
          to_account: toAcc.id
        }, { channel, chatId });
        if (res.ok) executedActions.push(res);
        return {
          reply: res.requiresConfirmation
            ? res.summary
            : `✅ **Transferência Executada pelo Morgan!**\n\n• **Valor:** ${engine.formatBRL(amount)}\n• **Origem:** ${fromAcc.name} *(Novo saldo: ${engine.formatBRL(res.originBalance)})*\n• **Destino:** ${toAcc.name} *(Novo saldo: ${engine.formatBRL(res.destinationBalance)})*`,
          actions: executedActions,
          engineUsed: 'native-autonomous'
        };
      }
    }
  }

  // 3. Comando de Exclusão ("excluir lançamento 15", "apagar transação 12")
  if ((q.includes('exclu') || q.includes('apag') || q.includes('delet') || q.includes('remov')) && (q.includes('lancamento') || q.includes('transacao') || /#?\d+/.test(q))) {
    const idMatch = text.match(/#?(\d+)/);
    const args = idMatch ? { transaction_id: parseInt(idMatch[1], 10) } : { description: text.replace(/excluir|apagar|deletar|lancamento|transacao/gi, '').trim() };
    const res = await engine.executeToolAction('delete_transaction', args, { channel, chatId });
    if (res.ok) {
      executedActions.push(res);
      return {
        reply: res.summary,
        actions: executedActions,
        engineUsed: 'native-autonomous'
      };
    }
  }

  // 4. Comando de Conciliação / Efetivação ("efetivar lançamento 4", "conciliar 4")
  if (q.includes('efetiv') || q.includes('concili')) {
    const idMatch = text.match(/#?(\d+)/);
    const args = idMatch
      ? { transaction_id: parseInt(idMatch[1], 10), is_effective: true }
      : { description: text.replace(/efetivar|conciliar|lancamento/gi, '').trim(), is_effective: true };
    const res = await engine.executeToolAction('conciliate_transaction', args, { channel, chatId });
    if (res.ok) {
      executedActions.push(res);
      return {
        reply: `✅ **Conciliação Realizada!**\n\n${res.summary}`,
        actions: executedActions,
        engineUsed: 'native-autonomous'
      };
    }
  }

  // 5. Comando de Lançamento de Despesa ou Receita
  // Ex: "Lance 150 de supermercado no cartão Nubank", "Gastei 85 de combustível no Itaú", "Recebi 2000 de dividendos na XP"
  const isLaunchIntent = /^(morgan[,\s]*)?(lanc(?:e|ar)|gastei|paguei|comprei|passei|adicione|registra|registre|recebi|entrou|depositaram)\b/i.test(q);
  if (isLaunchIntent) {
    const amount = extractMoneyAmount(text);
    if (amount) {
      const isIncome = /\b(recebi|entrou|receita|depositaram|ganhei|salario)\b/i.test(q);
      const matchedCard = cards.find(c => {
        const tokens = engine.normalizeStr(c.name).split(' ');
        return (q.includes('cartao') || q.includes('credito') || tokens.length > 1) && tokens.some(t => t.length >= 2 && q.includes(t));
      });
      const matchedAcc = accounts.find(a => {
        const first = engine.normalizeStr(a.name).split(' ')[0];
        return q.includes(first);
      });

      const useCard = !isIncome && (q.includes('cartao') || q.includes('credito') || (matchedCard && !q.includes('conta')));
      const installmentsMatch = q.match(/(\d+)\s*x\b|em\s+(\d+)\s*parcelas?/i);
      const installments = installmentsMatch ? parseInt(installmentsMatch[1] || installmentsMatch[2], 10) : 1;

      // Limpar descrição
      let cleanDesc = text
        .replace(/^(morgan[,\s]*)?(lanc(?:e|ar)|gastei|paguei|comprei|passei|adicione|registra|registre|recebi|entrou|depositaram)\s*/i, '')
        .replace(/r\$\s*[\d.,]+|[\d.,]+\s*reais|[\d.,]+/i, '')
        .replace(/\b(no cartao|na conta|no credito|em \d+x|\d+x)\b.*/i, '')
        .replace(/^(de|em|com|por)\s+/i, '')
        .trim();

      if (!cleanDesc || cleanDesc.length < 2) {
        cleanDesc = isIncome ? 'Receita Lançada via Morgan' : 'Despesa Lançada via Morgan';
      }
      cleanDesc = cleanDesc.charAt(0).toUpperCase() + cleanDesc.slice(1);

      const res = await engine.executeToolAction('create_transaction', {
        description: cleanDesc,
        amount,
        type: isIncome ? 'income' : 'expense',
        payment_method: useCard ? 'card' : 'account',
        card_id: useCard && matchedCard ? matchedCard.id : undefined,
        account_id: !useCard && matchedAcc ? matchedAcc.id : undefined,
        installments
      }, { channel, chatId });

      if (res.ok) {
        executedActions.push(res);
        return {
          reply: `✅ **Lançamento Registrado com Sucesso!**\n\n• **Descrição:** ${res.transaction.description}\n• **Valor:** **${engine.formatBRL(amount)}** (${isIncome ? 'Receita' : 'Despesa'})\n• **Meio:** ${res.summary}\n\n*O painel Family Money já foi atualizado em tempo real.*`,
          actions: executedActions,
          engineUsed: 'native-autonomous'
        };
      }
    }
  }

  // 6. Simulação de Compra ("simule uma compra de 3000 em 10x", "posso comprar uma TV de 4000 em 8x?")
  if (q.includes('simul') || (q.includes('posso comprar') && extractMoneyAmount(text))) {
    const amount = extractMoneyAmount(text) || 1500;
    const instMatch = q.match(/(\d+)\s*x|(\d+)\s*parcela/);
    const installments = instMatch ? parseInt(instMatch[1] || instMatch[2], 10) : 6;
    const sim = await engine.executeToolAction('simulate_purchase_impact', { amount, installments }, { channel, chatId });

    const monthsLines = sim.monthlyImpact.map(m =>
      `• **${m.mes}**: Superávit atual ${engine.formatBRL(m.superavitAtual)} ➔ Com a compra: **${engine.formatBRL(m.superavitComCompra)}** ${m.comprometeFluxo ? '🔴 *(Atenção: Déficit)*' : '🟢'}`
    ).join('\n');

    return {
      reply: `🧮 **Simulação Estratégica de Compra — CFO Morgan**\n\n• **Valor Simulado:** ${engine.formatBRL(amount)} em **${installments}x de ${engine.formatBRL(sim.installmentValue)}**\n• **Melhor Cartão Hoje:** **${sim.recommendedCard}**\n• **Ganho de Arbitragem no CDI (100%):** Deixando o valor aplicado enquanto paga as parcelas, você ganha **+${engine.formatBRL(sim.cdiArbitrageGain)}** em juros líquidos!\n\n📊 **Impacto no Fluxo de Caixa (Próximos 6 Meses):**\n${monthsLines}\n\n💡 **Veredito de Morgan:** ${sim.causesDeficitInAnyMonth ? '⚠️ Esta compra gera déficit em pelo menos um mês projetado. Recomendo aumentar o número de parcelas sem juros ou postergar.' : '✅ O fluxo de caixa absorve perfeitamente as parcelas mantendo superávit positivo em todos os meses!'}`,
      actions: [],
      engineUsed: 'native-autonomous'
    };
  }

  // 7. Briefing / Resumo do dia
  if (q.includes('briefing') || q.includes('bom dia') || q.includes('resumo do dia') || q.includes('auditoria')) {
    const briefing = await engine.buildExecutiveBriefingText(ctx);
    return {
      reply: briefing.text,
      actions: [],
      engineUsed: 'native-autonomous'
    };
  }

  // 8. Melhor Cartão / Float
  if (q.includes('cartao') || q.includes('cartoes') || q.includes('float') || q.includes('usar hoje')) {
    const best = ctx.cardAnalysis[0];
    const list = ctx.cardAnalysis.map(c =>
      `• **${c.name}**: Fecha dia ${c.closingDay}, vence dia ${c.dueDay} ➔ **${c.floatDays} dias** sem juros (${c.dueDateFormatted})\n  *${c.statusTip}*`
    ).join('\n');

    return {
      reply: `💳 **Matriz Tática de Cartões & Float Hoje — CFO Morgan**\n\n🏆 **Recomendação #1 para Compras Hoje:** **${best ? best.name : 'Nenhum'}** (**${best ? best.floatDays : 0} dias** de prazo sem juros).\n\n${list}`,
      actions: [],
      engineUsed: 'native-autonomous'
    };
  }

  // 9. Projeção / Futuro / Sobra do mês
  if (q.includes('sobr') || q.includes('proje') || q.includes('futuro') || q.includes('mes') || q.includes('saldo')) {
    const h = ctx.health;
    const accs = ctx.raw.accounts.map(a => `• **${a.name}**: ${engine.formatBRL(a.balance)}`).join('\n');
    const fLines = ctx.raw.forecast.map(f =>
      `• ${f.netSurplus >= 0 ? '🟢' : '🔴'} **${f.label}**: Entradas ${engine.formatBRL(f.totalIncomes)} | Saídas ${engine.formatBRL(f.totalExpenses)} | Sobra: **${engine.formatBRL(f.netSurplus)}** *(Acumulado: ${engine.formatBRL(f.projectedBalance)})*`
    ).join('\n');

    return {
      reply: `📊 **Posição de Liquidez & Projeção de 6 Meses — CFO Morgan**\n\n💰 **Saldos Bancários Atuais (${engine.formatBRL(h.totalLiquid)}):**\n${accs}\n\n🔮 **Evolução Projetada do Caixa:**\n${fLines}\n\n💡 **Parecer de Morgan:** Sua taxa de poupança neste mês está em **${h.savingsRate}%** com cobertura de reserva de **${h.coverageMonths} meses**.`,
      actions: [],
      engineUsed: 'native-autonomous'
    };
  }

  // Fallback geral rico
  const briefing = await engine.buildExecutiveBriefingText(ctx);
  return {
    reply: briefing.text,
    actions: [],
    engineUsed: 'native-autonomous'
  };
}

// ============================================================================
// 5. LOOP AGÊNTICO PRINCIPAL (GEMINI FUNCTION CALLING + MULTIMODAL)
// ============================================================================

async function processMorganMessage({
  text = '',
  media = null, // { mimeType: 'audio/ogg' | 'image/jpeg', base64Data: '...' }
  channel = 'web',
  chatId = 'default',
  apiKeyOverride = null
}) {
  const settings = await db.getMorganSettings();
  const apiKey = (apiKeyOverride || settings.gemini_api_key || process.env.GEMINI_API_KEY || '').trim();

  // Persistir caso apiKeyOverride tenha vindo do cliente web pela primeira vez
  if (apiKeyOverride && !settings.gemini_api_key) {
    await db.updateMorganSettings({ gemini_api_key: apiKeyOverride.trim() });
  }

  const userPromptLabel = text || (media
    ? (media.mimeType.startsWith('audio/')
      ? '[Áudio de voz enviado pelo usuário: transcreva o pedido financeiro, execute a ferramenta de lançamento/consulta apropriada e responda]'
      : '[Imagem de comprovante/recibo enviada pelo usuário: extraia valor, data, estabelecimento e categoria, registre o lançamento via create_transaction e responda]')
    : 'Olá Morgan');

  await appendConversationTurn(channel, chatId, 'user', userPromptLabel);

  // Se não houver chave Gemini configurada, usar o Motor Autônomo Local imediatamente
  if (!apiKey) {
    const localResult = await runLocalAutonomousParserAndReasoning(userPromptLabel, { channel, chatId });
    await appendConversationTurn(channel, chatId, 'model', localResult.reply, localResult.actions);
    return localResult;
  }

  const ctxObj = await engine.buildMorganRichContext();
  const systemInstruction = buildMorganSystemInstruction(ctxObj);
  const recentHistory = await getRecentConversationHistory(channel, chatId, 8);

  const contents = [];
  // Adicionar histórico anterior (excluindo a mensagem atual que acabou de ser inserida)
  const historyToInclude = recentHistory.slice(0, -1);
  for (const h of historyToInclude) {
    if (!h.content) continue;
    contents.push({
      role: h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.content }]
    });
  }

  // Montar a mensagem atual (texto + mídia multimodal se houver)
  const currentUserParts = [];
  if (media && media.base64Data && media.mimeType) {
    currentUserParts.push({
      inlineData: {
        mimeType: media.mimeType,
        data: media.base64Data
      }
    });
  }
  currentUserParts.push({ text: userPromptLabel });

  contents.push({
    role: 'user',
    parts: currentUserParts
  });

  const candidateModels = [
    settings.gemini_model || 'gemini-2.5-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-flash-latest'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const executedActions = [];
  let activeModel = candidateModels[0];

  try {
    let workingContents = [...contents];
    let finalReplyText = '';

    // Loop Agêntico Multi-Step (suporta até 4 encadeamentos de Tool Calls)
    for (let step = 0; step < 4; step++) {
      let responseData = null;
      let lastErr = null;

      for (const modelName of candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemInstruction }]
              },
              contents: workingContents,
              tools: [{ functionDeclarations: MORGAN_TOOLS_DECLARATIONS }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 4096
              }
            })
          });

          if (res.ok) {
            responseData = await res.json();
            activeModel = modelName;
            break;
          } else {
            const errJson = await res.json().catch(() => ({}));
            lastErr = new Error(errJson.error?.message || `HTTP ${res.status}`);
          }
        } catch (fetchErr) {
          lastErr = fetchErr;
        }
      }

      if (!responseData) {
        throw lastErr || new Error('Falha ao comunicar com os modelos Gemini');
      }

      const candidate = responseData.candidates?.[0]?.content;
      if (!candidate || !Array.isArray(candidate.parts)) {
        break;
      }

      workingContents.push(candidate);

      const functionCalls = candidate.parts.filter(p => p.functionCall);
      const textParts = candidate.parts.filter(p => p.text).map(p => p.text);

      if (textParts.length > 0) {
        finalReplyText = textParts.join('\n').trim();
      }

      // Se o modelo não pediu nenhuma Tool Call, encerramos o turno com a resposta final!
      if (functionCalls.length === 0) {
        break;
      }

      // Executar todas as Tool Calls solicitadas pelo modelo neste passo
      const functionResponseParts = [];
      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        console.log(`[MORGAN-AGENT] Executando Tool: ${name}`, JSON.stringify(args));
        const toolResult = await engine.executeToolAction(name, args || {}, { channel, chatId });

        if (toolResult.actionLogId || toolResult.requiresConfirmation || toolResult.canUndo) {
          executedActions.push({
            toolName: name,
            ...toolResult
          });
        }

        functionResponseParts.push({
          functionResponse: {
            name,
            response: { result: toolResult }
          }
        });
      }

      workingContents.push({
        role: 'user',
        parts: functionResponseParts
      });
    }

    if (!finalReplyText && executedActions.length > 0) {
      finalReplyText = executedActions.map(a => `✅ ${a.summary}`).join('\n\n');
    }

    if (!finalReplyText) {
      const fallback = await runLocalAutonomousParserAndReasoning(userPromptLabel, { channel, chatId });
      finalReplyText = fallback.reply;
    }

    await appendConversationTurn(channel, chatId, 'model', finalReplyText, executedActions);

    return {
      reply: finalReplyText,
      actions: executedActions,
      engineUsed: `gemini (${activeModel})`
    };
  } catch (err) {
    console.warn('[MORGAN-AGENT] Contingência ativada (Erro Gemini):', err.message);
    const fallbackResult = await runLocalAutonomousParserAndReasoning(userPromptLabel, { channel, chatId });
    await appendConversationTurn(channel, chatId, 'model', fallbackResult.reply, fallbackResult.actions);
    return {
      ...fallbackResult,
      warning: err.message
    };
  }
}

module.exports = {
  MORGAN_TOOLS_DECLARATIONS,
  processMorganMessage,
  runLocalAutonomousParserAndReasoning,
  getRecentConversationHistory
};
