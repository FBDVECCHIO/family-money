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
    description: 'Marca um lançamento pendente como efetivado/pago (is_effective = true) ou reverte para pendente, ajustando o saldo da conta bancária vinculada. Permite também alterar o valor pago (amount) ou escolher a conta bancária (account_name) no momento da efetivação. Se for uma conta fixa recorrente que ainda não gerou lançamento no mês, cria e já efetiva automaticamente.',
    parameters: {
      type: 'OBJECT',
      properties: {
        transaction_id: { type: 'INTEGER', description: 'ID numérico do lançamento (se conhecido)' },
        description: { type: 'STRING', description: 'Texto parcial da descrição do lançamento ou da conta fixa caso o ID não seja informado' },
        is_effective: { type: 'BOOLEAN', description: 'true para efetivar/pagar/conciliar, false para voltar a pendente' },
        amount: { type: 'NUMBER', description: 'Valor exato efetivado (opcional, caso o valor pago seja diferente do valor previsto)' },
        account_name: { type: 'STRING', description: 'Nome da conta bancária onde foi pago/debitado (opcional, ex: Itaú Personalite, Itaú PJ, ML - COFRE)' },
        date: { type: 'STRING', description: 'Data da efetivação YYYY-MM-DD (opcional)' }
      }
    }
  },
  {
    name: 'update_transaction',
    description: 'Edita/altera qualquer lançamento existente (muda valor, descrição, data, categoria, conta bancária, cartão de crédito, número de parcelas ou status de efetivação) e recalcula automaticamente os saldos das contas envolvidas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        transaction_id: { type: 'INTEGER', description: 'ID numérico do lançamento a editar (se conhecido)' },
        search_description: { type: 'STRING', description: 'Descrição atual ou parcial do lançamento para localizá-lo caso o ID não seja informado' },
        new_description: { type: 'STRING', description: 'Nova descrição do lançamento (se quiser renomear)' },
        new_amount: { type: 'NUMBER', description: 'Novo valor em reais do lançamento (se quiser alterar o valor)' },
        date: { type: 'STRING', description: 'Nova data YYYY-MM-DD (se quiser alterar a data)' },
        type: { type: 'STRING', description: '"expense", "income" ou "transfer"' },
        payment_method: { type: 'STRING', description: '"account", "card" ou "transfer"' },
        account_name: { type: 'STRING', description: 'Nova conta bancária (ex: Itaú PJ, Itaú Personalite, ML - COFRE, Bradesco)' },
        card_name: { type: 'STRING', description: 'Novo cartão de crédito (ex: Azul Infinite, Black Infinite, Nubanck)' },
        category_name: { type: 'STRING', description: 'Nova categoria do lançamento' },
        installments: { type: 'INTEGER', description: 'Novo número de parcelas' },
        is_effective: { type: 'BOOLEAN', description: 'true se efetivado, false se pendente' }
      }
    }
  },
  {
    name: 'delete_transaction',
    description: 'Exclui um lançamento financeiro do extrato e estorna automaticamente seu impacto no saldo da conta. Se o usuário pedir também para cancelar da recorrência fixa, defina also_delete_fixed_recurrence=true.',
    parameters: {
      type: 'OBJECT',
      properties: {
        transaction_id: { type: 'INTEGER', description: 'ID numérico do lançamento a excluir' },
        description: { type: 'STRING', description: 'Descrição parcial do lançamento caso o ID não seja conhecido' },
        also_delete_fixed_recurrence: { type: 'BOOLEAN', description: 'true se o usuário pediu para remover também das contas fixas/recorrências mensais' }
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
    description: 'Cadastra uma nova despesa fixa mensal (assinatura, aluguel, escola, academia) ou receita recorrente (salário, dividendo) na tabela de itens fixos (fixed_items).',
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
    name: 'update_fixed_item',
    description: 'Edita/altera uma despesa fixa mensal ou receita recorrente cadastrada em fixed_items (altera valor mensal, dia de vencimento, descrição, conta bancária ou cartão de crédito).',
    parameters: {
      type: 'OBJECT',
      properties: {
        fixed_item_id: { type: 'INTEGER', description: 'ID numérico do item fixo em itensFixosRecorrentes (se conhecido)' },
        search_description: { type: 'STRING', description: 'Nome atual da conta fixa/assinatura para localizar (ex: Pano Bianco, Netflix, Vivo, Mesada)' },
        new_description: { type: 'STRING', description: 'Novo nome/descrição da conta fixa' },
        new_amount: { type: 'NUMBER', description: 'Novo valor mensal em reais' },
        day_of_month: { type: 'INTEGER', description: 'Novo dia de vencimento (1 a 31)' },
        account_name: { type: 'STRING', description: 'Nova conta bancária vinculada' },
        card_name: { type: 'STRING', description: 'Novo cartão de crédito vinculado' },
        category_name: { type: 'STRING', description: 'Nova categoria' }
      }
    }
  },
  {
    name: 'delete_fixed_item',
    description: 'Cancela/exclui permanentemente uma ou todas as despesas fixas / assinaturas recorrentes da tabela fixed_items (ex: "cancele a academia nas contas fixas", "remova das recorrências"). Também remove automaticamente os lançamentos pendentes não efetivados deste mês gerados por essa recorrência.',
    parameters: {
      type: 'OBJECT',
      properties: {
        fixed_item_id: { type: 'INTEGER', description: 'ID numérico do item fixo em itensFixosRecorrentes (se conhecido)' },
        description: { type: 'STRING', description: 'Nome ou descrição parcial da conta fixa/recorrência a cancelar (ex: Pano Bianco Academia, Netflix)' },
        amount: { type: 'NUMBER', description: 'Valor específico caso existam duas recorrências com o mesmo nome e queira excluir apenas uma' },
        delete_all_matching: { type: 'BOOLEAN', description: 'true para excluir TODOS os itens fixos que contenham essa descrição (ex: excluir todas as mensalidades da Pano Bianco)' },
        also_delete_current_month_tx: { type: 'BOOLEAN', description: 'true (padrão) para remover também os lançamentos pendentes [R:ID] deste mês' }
      }
    }
  },
  {
    name: 'manage_entity',
    description: 'Administração geral: cria, edita ou exclui Contas Bancárias (account), Cartões de Crédito (card) ou Categorias (category). Permite alterar dia de fechamento/vencimento de cartão, renomear conta ou criar nova categoria.',
    parameters: {
      type: 'OBJECT',
      properties: {
        entity_type: { type: 'STRING', description: '"account" (conta bancária), "card" (cartão de crédito) ou "category" (categoria)' },
        operation: { type: 'STRING', description: '"create" (criar), "update" (editar) ou "delete" (excluir)' },
        entity_id: { type: 'INTEGER', description: 'ID da conta, cartão ou categoria (se conhecido)' },
        name: { type: 'STRING', description: 'Nome da entidade (para criar ou localizar)' },
        new_name: { type: 'STRING', description: 'Novo nome (em caso de edição/update)' },
        balance: { type: 'NUMBER', description: 'Saldo da conta bancária (para account)' },
        closing_day: { type: 'INTEGER', description: 'Dia de fechamento do cartão (1 a 31)' },
        due_day: { type: 'INTEGER', description: 'Dia de vencimento da fatura do cartão (1 a 31)' },
        account_name: { type: 'STRING', description: 'Conta vinculada ao cartão de crédito' }
      },
      required: ['entity_type', 'operation']
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

COMO VOCÊ OPERA (ADMINISTRAÇÃO TOTAL, EFETIVAÇÃO, EDIÇÃO E EXECUÇÃO IMEDIATA):
1. VOCÊ TEM ADMINISTRAÇÃO TOTAL E MÃOS OPERACIONAIS (16 TOOLS):
   - **Lançar gasto/receita:** \`create_transaction\`
   - **Editar/alterar qualquer lançamento (mudar valor, data, conta, cartão, categoria ou descrição):** \`update_transaction\`
   - **Efetivar/pagar um lançamento pendente ou conta fixa do mês (podendo informar em qual conta foi pago ou novo valor):** \`conciliate_transaction\`
   - **Excluir um lançamento do mês:** \`delete_transaction\`
   - **Criar, Editar ou Cancelar/Excluir Contas Fixas e Assinaturas Recorrentes (\`itensFixosRecorrentes\`):** \`create_fixed_item\`, \`update_fixed_item\`, \`delete_fixed_item\`. ATENÇÃO: Quando o usuário pedir para "cancelar das contas fixas", "tirar da recorrência" ou "excluir a assinatura fixa", chame \`delete_fixed_item\` (e se houver mais de uma com o mesmo nome, use \`delete_all_matching: true\` ou chame para cada ID)!
   - **Transferir entre contas:** \`transfer_between_accounts\`
   - **Ajustar saldo de conta:** \`adjust_account_balance\`
   - **Quitar fatura de cartão:** \`pay_card_bill\`
   - **Criar/editar cartões, contas ou categorias:** \`manage_entity\`
2. LIBERDADE DE EXECUÇÃO IMEDIATA (NÃO PEÇA CONFIRMAÇÃO EM TEXTO ANTES DE AGIR):
   - Quando o usuário pedir para lançar, editar, efetivar/pagar ou excluir algo, **EXECUTE A FERRAMENTA IMEDIATAMENTE NA MESMA RESPOSTA**! Não fique perguntando "Você quer que eu faça isso?" sem chamar a tool — o próprio sistema já anexa um botão \`[↩️ Desfazer]\` em todas as ações executadas caso o usuário queira reverter.
3. PRECISÃO DE VALORES, DATAS DE VENCIMENTO E CONTAS:
   - O campo \`amount\` deve ser EXATAMENTE o valor informado pelo usuário.
   - Diferencie com atenção as contas da família: "Itaú PJ" (ID 7), "Itaú Personalite" (ID 6), "ML - COFRE" (ID 9) e "Bradesco" (ID 11).
   - Ao responder sobre **próximo vencimento de cartão de crédito**, olhe o campo \`nextDueDateISO\` e \`daysUntilNextDue\` em \`cartoesCadastrados\` (que já está ordenado do vencimento mais próximo para o mais distante!).
4. ÁUDIO E FOTOS DE COMPROVANTES:
   - Se o usuário enviar um áudio (nota de voz) ou foto de comprovante pedindo qualquer lançamento, edição, efetivação ou exclusão, chame a ferramenta correspondente imediatamente no primeiro turno!
5. SAUDAÇÕES E CONVERSAS DE GRUPO: Se alguém mandar apenas "oi", "oi?", "olá", responda de forma cordial, breve e prestativa.
6. COMUNICAÇÃO: Responda em português do Brasil com elegância executiva, clareza e números precisos baseados exclusivamente no snapshot real abaixo.

[SNAPSHOT FINANCEIRO EM TEMPO REAL DA BASE DE DADOS]
${JSON.stringify(richContext)}`;
}

// ============================================================================
// 4. PARSER NATURAL-LANGUAGE & MOTOR NATIVO (CONTINGÊNCIA / FAST-PATH)
// ============================================================================

/**
 * Extrai valor monetário em PT-BR com precisão cirúrgica, ignorando datas, horas, parcelas (6x) e IDs (#12)
 */
function extractMoneyAmount(str) {
  if (!str) return null;
  let cleaned = String(str)
    .replace(/\[R:\d+\]/gi, ' ')
    .replace(/#\d+\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ') // datas 18/11
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ') // datas ISO
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ') // horas 16:00
    .replace(/\b\d{1,2}\s*h(?:oras?)?\b/gi, ' ') // 16h
    .replace(/\b\d+\s*x\b/gi, ' ') // 6x
    .replace(/\bem\s+\d+\s*parcelas?\b/gi, ' ') // em 6 parcelas
    .replace(/\bdia\s+\d{1,2}\b/gi, ' '); // dia 10

  function parsePtBrNumber(rawStr) {
    let raw = String(rawStr).trim();
    if (raw.includes('.') && raw.includes(',')) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else if (raw.includes(',')) {
      raw = raw.replace(',', '.');
    }
    const val = parseFloat(raw);
    return (!isNaN(val) && val > 0) ? Number(val.toFixed(2)) : null;
  }

  // 1. Prioridade máxima: Valor precedido por R$ ou seguido por "reais"
  const currencyMatch = cleaned.match(/r\$\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)/i)
    || cleaned.match(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)\s*reais\b/i);
  if (currencyMatch) {
    const val = parsePtBrNumber(currencyMatch[1]);
    if (val !== null) return val;
  }

  // 2. Prioridade alta: Número formatado com casas decimais explícitas (ex: 10,00 ou 1.250,50)
  const decimalMatch = cleaned.match(/\b(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{2})\b/);
  if (decimalMatch) {
    const val = parsePtBrNumber(decimalMatch[1]);
    if (val !== null) return val;
  }

  // 3. Prioridade média: Número logo após verbo de lançamento ou preposição de valor ("de 10", "por 10", "lance 10", "transfira 10")
  const contextualMatch = cleaned.match(/\b(?:de|por|valor|lance|lancar|gastei|paguei|comprei|passei|recebi|transfira|transferir)\s+(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d{1,2})?)\b/i);
  if (contextualMatch) {
    const val = parsePtBrNumber(contextualMatch[1]);
    if (val !== null) return val;
  }

  // 4. Fallback: primeiro número positivo restante
  const fallbackMatch = cleaned.match(/\b(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)\b/);
  if (fallbackMatch) {
    return parsePtBrNumber(fallbackMatch[1]);
  }
  return null;
}

/**
 * Formata uma resposta executiva imediata a partir do resultado de uma ferramenta já executada
 */
function formatImmediateToolReply(toolName, toolResult) {
  if (!toolResult) return '';
  if (toolResult.requiresConfirmation) {
    return toolResult.summary;
  }
  if (!toolResult.ok) {
    return `⚠️ **Não foi possível concluir a operação:** ${toolResult.error || 'Verifique os dados informados.'}`;
  }

  if (toolName === 'create_transaction' && toolResult.transaction) {
    const tx = toolResult.transaction;
    const isInc = tx.type === 'income';
    return `✅ **Lançamento Registrado com Sucesso!**\n\n• **Descrição:** ${tx.description}\n• **Valor:** **${engine.formatBRL(tx.amount)}** (${isInc ? 'Receita' : 'Despesa'})\n• **Detalhes:** ${toolResult.summary}\n\n*O painel Family Money já foi atualizado em tempo real.*`;
  }

  if (toolName === 'transfer_between_accounts') {
    return `✅ **Transferência Entre Contas Concluída!**\n\n${toolResult.summary}\n\n*Os saldos de origem e destino já foram atualizados em tempo real.*`;
  }

  if (toolName === 'update_transaction') {
    return `✏️ **Lançamento Editado com Sucesso!**\n\n${toolResult.summary}\n\n*O painel Family Money e os saldos já foram atualizados em tempo real.*`;
  }

  if (toolName === 'conciliate_transaction') {
    return `✅ **Efetivação / Conciliação Concluída!**\n\n${toolResult.summary}\n\n*O saldo da conta já foi atualizado em tempo real.*`;
  }

  if (toolName === 'delete_transaction') {
    return `🗑️ **Lançamento Excluído com Sucesso!**\n\n${toolResult.summary}\n\n*O painel Family Money já foi atualizado em tempo real.*`;
  }

  if (toolName === 'create_fixed_item' || toolName === 'update_fixed_item' || toolName === 'delete_fixed_item') {
    return `📌 **Gestão de Contas Fixas & Recorrências Concluída!**\n\n${toolResult.summary}\n\n*As recorrências e projeções de 6 meses já foram atualizadas.*`;
  }

  if (toolName === 'manage_entity') {
    return `⚙️ **Administração do Sistema Concluída!**\n\n${toolResult.summary}`;
  }

  if (toolName === 'generate_executive_briefing' && toolResult.briefingText) {
    return toolResult.briefingText;
  }

  if (toolName === 'recommend_best_card' && Array.isArray(toolResult.ranking)) {
    const best = toolResult.bestCard;
    const list = toolResult.ranking.map(c =>
      `• **${c.name}**: Fecha dia ${c.closingDay}, vence dia ${c.dueDay} ➔ **${c.floatDays} dias** sem juros (${c.dueDateFormatted})\n  *${c.statusTip}*`
    ).join('\n');
    return `💳 **Matriz Tática de Cartões & Float Hoje — CFO Morgan**\n\n🏆 **Recomendação #1 para Compras Hoje:** **${best ? best.name : 'Nenhum'}** (**${best ? best.floatDays : 0} dias** de prazo sem juros).\n\n${list}`;
  }

  if (toolName === 'simulate_purchase_impact' && Array.isArray(toolResult.monthlyImpact)) {
    const monthsLines = toolResult.monthlyImpact.map(m =>
      `• **${m.mes}**: Superávit atual ${engine.formatBRL(m.superavitAtual)} ➔ Com a compra: **${engine.formatBRL(m.superavitComCompra)}** ${m.comprometeFluxo ? '🔴 *(Atenção: Déficit)*' : '🟢'}`
    ).join('\n');
    return `🧮 **Simulação Estratégica de Compra — CFO Morgan**\n\n• **Valor Simulado:** ${engine.formatBRL(toolResult.purchaseAmount)} em **${toolResult.installments}x de ${engine.formatBRL(toolResult.installmentValue)}**\n• **Melhor Cartão Hoje:** **${toolResult.recommendedCard}**\n• **Ganho de Arbitragem no CDI (100%):** **+${engine.formatBRL(toolResult.cdiArbitrageGain)}** em juros líquidos!\n\n📊 **Impacto no Fluxo de Caixa (Próximos 6 Meses):**\n${monthsLines}`;
  }

  return `✅ **Operação Concluída pelo Morgan!**\n\n${toolResult.summary || 'Atualizado com sucesso.'}`;
}

/**
 * Detecta se a mensagem é uma saudação simples ("oi?", "olá", "tudo bem?", "morgan?")
 */
function isSimpleGreetingMessage(rawText = '') {
  const clean = engine.normalizeStr(rawText)
    .replace(/^@?\w*morgan\w*[,:\s]*/i, '')
    .replace(/[?!.,;]+$/g, '')
    .trim();
  if (!clean) return true;
  return /^(oi+|ola+|opa+|e\s*ai+|hey+|hi+|hello+|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|tudo\s+bom|como\s+vai|ta\s+ai|esta\s+ai|testando|teste|alou+|alo+)$/i.test(clean);
}

function buildQuickGreetingReply(senderName = 'Família') {
  const firstName = String(senderName || 'Família').split(' ')[0];
  return `👋 **Olá, ${firstName}! Tudo ótimo por aqui.**\nEstou online e conectado em tempo real ao **Family Money**.\n\nComo posso ajudar agora?\n• 💸 **Lançar despesa/receita:** *"Lance 35,00 de padaria no Itaú Personalite"*\n• 🔄 **Transferir entre contas:** *"Transfira 200 do ML Cofre para o Itaú PJ"*\n• 💳 **Melhor cartão hoje:** *"Qual cartão usar hoje?"*\n• 📊 **Saldos e resumo:** *"Como estão nossos saldos?"*\n*(Você também pode enviar áudio de voz ou foto de comprovante!)*`;
}

async function runLocalAutonomousParserAndReasoning(userText, options = {}) {
  const { channel = 'web', chatId = 'default', senderName = 'Família' } = options;
  const text = String(userText || '').trim();
  const q = engine.normalizeStr(text);
  const executedActions = [];

  // 0. Saudação simples rápida ("oi?", "olá", "tudo bem?") -> Resposta humana instantânea
  if (isSimpleGreetingMessage(text)) {
    return {
      reply: buildQuickGreetingReply(senderName),
      actions: [],
      engineUsed: 'fast-greeting'
    };
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

  // 2. Comando de Transferência ("transfira 500 do itau pj para o itau personalite", "transferir 1500 do ml cofre pra itau pj")
  if (q.includes('transf')) {
    const amount = extractMoneyAmount(text);
    if (amount) {
      let fromAcc = null;
      let toAcc = null;

      // Extrair trechos explícitos de origem ("de/do/da X") e destino ("para/pra/pro/no/na Y")
      const fromToMatch = q.match(/\b(?:de|do|da)\s+(?:conta\s+)?(?:do\s+|da\s+)?(.+?)\s+\b(?:para|pra|pro|no|na)\s+(?:a\s+|o\s+)?(?:conta\s+)?(?:do\s+|da\s+)?(.+?)(?:$|\s+no\s+valor|\s+de\s+r\$|\s+hoje)/i);
      if (fromToMatch) {
        fromAcc = engine.resolveEntityByNameOrId(accounts, fromToMatch[1].trim(), false);
        toAcc = engine.resolveEntityByNameOrId(accounts, fromToMatch[2].trim(), false);
      }

      if (!fromAcc || !toAcc || fromAcc.id === toAcc.id) {
        // Buscar menções ordenadas pela posição no texto
        const mentions = [];
        for (const acc of accounts) {
          const accNorm = engine.normalizeStr(acc.name);
          const aliases = [accNorm];
          if (accNorm.includes('pj')) aliases.push('itau pj', 'pj');
          if (accNorm.includes('personalite')) aliases.push('itau personalite', 'personalite', 'itau pf', 'pf');
          if (accNorm.includes('cofre')) aliases.push('ml cofre', 'mercado livre', 'cofre', 'ml');
          if (accNorm.includes('bradesco')) aliases.push('bradesco');

          let bestPos = -1;
          for (const al of aliases) {
            const pos = q.indexOf(al);
            if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
              bestPos = pos;
            }
          }
          if (bestPos !== -1) {
            mentions.push({ acc, pos: bestPos });
          }
        }
        mentions.sort((a, b) => a.pos - b.pos);
        if (mentions.length >= 2) {
          fromAcc = fromAcc || mentions[0].acc;
          toAcc = (toAcc && toAcc.id !== fromAcc.id) ? toAcc : mentions[1].acc;
        }
      }

      if (fromAcc && toAcc && Number(fromAcc.id) !== Number(toAcc.id)) {
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

  // 3. Comando de Exclusão (Transação ou Conta Fixa / Recorrência)
  if (q.includes('exclu') || q.includes('apag') || q.includes('delet') || q.includes('remov') || q.includes('cancel')) {
    const isFixedTarget = q.includes('fixa') || q.includes('recorren') || q.includes('assinatura') || q.includes('mensalidade');
    const idMatch = text.match(/#?(\d+)/);
    const cleanTargetDesc = text
      .replace(/morgan|por favor|ainda|esta|constando|nas|minhas|contas|fixas|recorrencias|recorrencia|assinaturas|lancamento|transacao|excluir|exclua|apagar|apague|deletar|delete|remover|remova|cancelar|cancele|la|tb|tambem|tudo|todos|todas/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (isFixedTarget) {
      const args = idMatch
        ? { fixed_item_id: parseInt(idMatch[1], 10), also_delete_current_month_tx: true }
        : { description: cleanTargetDesc, delete_all_matching: true, also_delete_current_month_tx: true };
      const res = await engine.executeToolAction('delete_fixed_item', args, { channel, chatId });
      if (res.ok) {
        executedActions.push({ toolName: 'delete_fixed_item', ...res });
        return {
          reply: `✅ **Recorrência Fixa Cancelada!**\n\n${res.summary}`,
          actions: executedActions,
          engineUsed: 'native-autonomous'
        };
      }
    } else if (q.includes('lancamento') || q.includes('transacao') || idMatch || cleanTargetDesc.length >= 3) {
      const args = idMatch
        ? { transaction_id: parseInt(idMatch[1], 10) }
        : { description: cleanTargetDesc };
      const res = await engine.executeToolAction('delete_transaction', args, { channel, chatId });
      if (res.ok) {
        executedActions.push({ toolName: 'delete_transaction', ...res });
        return {
          reply: `✅ **Exclusão Executada!**\n\n${res.summary}`,
          actions: executedActions,
          engineUsed: 'native-autonomous'
        };
      }
    }
  }

  // 3B. Comando de Edição / Alteração ("altere o valor de X para Y", "edite o lançamento X para Y", "mude X para Y")
  if (q.includes('alter') || q.includes('edit') || q.includes('mudar') || q.includes('mude') || q.includes('corrig') || q.includes('atualiz')) {
    const newAmount = extractMoneyAmount(text);
    const idMatch = text.match(/#(\d+)\b|id\s*(\d+)/i);
    const isFixedTarget = q.includes('fixa') || q.includes('recorren') || q.includes('assinatura');
    const cleanSearch = text
      .replace(/morgan|por favor|alterar|altere|editar|edite|mudar|mude|corrigir|corrija|atualizar|atualize|o valor|valor|lancamento|transacao|despesa|conta fixa|fixa|para|por/gi, ' ')
      .replace(/r\$\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)/gi, ' ')
      .replace(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)\s*(reais)?/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (isFixedTarget && (idMatch || cleanSearch.length >= 2)) {
      const res = await engine.executeToolAction('update_fixed_item', {
        fixed_item_id: idMatch ? parseInt(idMatch[1] || idMatch[2], 10) : undefined,
        search_description: cleanSearch || undefined,
        new_amount: newAmount || undefined
      }, { channel, chatId });
      if (res.ok) {
        executedActions.push({ toolName: 'update_fixed_item', ...res });
        return {
          reply: `✅ **Conta Fixa Atualizada!**\n\n${res.summary}`,
          actions: executedActions,
          engineUsed: 'native-autonomous'
        };
      }
    } else if (idMatch || cleanSearch.length >= 2) {
      const res = await engine.executeToolAction('update_transaction', {
        transaction_id: idMatch ? parseInt(idMatch[1] || idMatch[2], 10) : undefined,
        search_description: cleanSearch || undefined,
        new_amount: newAmount || undefined
      }, { channel, chatId });
      if (res.ok) {
        executedActions.push({ toolName: 'update_transaction', ...res });
        return {
          reply: `✅ **Lançamento Editado com Sucesso!**\n\n${res.summary}`,
          actions: executedActions,
          engineUsed: 'native-autonomous'
        };
      }
    }
  }

  // 4. Comando de Conciliação / Efetivação ("efetivar lançamento 4", "efetive a mesada da Sofia", "dar baixa no convênio")
  if (q.includes('efetiv') || q.includes('concili') || q.includes('dar baixa') || q.includes('marcar como pago') || q.includes('marque como pago')) {
    const idMatch = text.match(/#(\d+)\b|id\s*(\d+)/i);
    const customAmount = extractMoneyAmount(text);
    const accHintMatch = q.match(/\b(?:na\s+conta|no\s+banco|conta|pelo|pela|no|na)\s+(?:do\s+|da\s+)?(itau\s+pj|itau\s+personalite|itau\s+pf|personalite|pj|ml\s*-?\s*cofre|mercado\s+livre|cofre|bradesco|itau)\b/i);
    const cleanTarget = text
      .replace(/morgan|por favor|efetivar|efetive|conciliar|concilie|dar baixa|marcar como pago|marque como pago|lancamento|transacao|despesa|pagamento|da|do|de|na|no|em/gi, ' ')
      .replace(/#\d+/g, ' ')
      .replace(/r\$\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const args = {
      transaction_id: idMatch ? parseInt(idMatch[1] || idMatch[2], 10) : undefined,
      description: !idMatch ? cleanTarget : undefined,
      amount: customAmount || undefined,
      account_name: accHintMatch ? accHintMatch[1] : undefined,
      is_effective: true
    };
    const res = await engine.executeToolAction('conciliate_transaction', args, { channel, chatId });
    if (res.ok) {
      executedActions.push({ toolName: 'conciliate_transaction', ...res });
      return {
        reply: `✅ **Efetivação Realizada com Sucesso!**\n\n${res.summary}`,
        actions: executedActions,
        engineUsed: 'native-autonomous'
      };
    }
  }

  // 5. Comando de Lançamento de Despesa ou Receita
  // Ex: "Lance 150 de supermercado no cartão Nubank", "Lance uma despesa de 10,00 na conta do Itaú PJ"
  const isLaunchIntent = /^(morgan[,\s]*)?(lanc(?:e|ar)|gastei|paguei|comprei|passei|adicione|registra|registre|recebi|entrou|depositaram)\b/i.test(q);
  if (isLaunchIntent) {
    const amount = extractMoneyAmount(text);
    if (amount) {
      const isIncome = /\b(recebi|entrou|receita|depositaram|ganhei|salario)\b/i.test(q);
      const matchedCard = cards.find(c => {
        const cNorm = engine.normalizeStr(c.name);
        if (cNorm.includes('nuban') && /\bnubanc?k\b/.test(q)) return true;
        const tokens = cNorm.split(' ');
        return (q.includes('cartao') || q.includes('credito') || tokens.length > 1) && tokens.some(t => t.length >= 3 && t !== 'infinite' && q.includes(t));
      });

      // Resolver conta bancária com precisão (diferenciando Itaú PJ vs Itaú Personalite vs ML Cofre vs Bradesco)
      const accHintMatch = q.match(/\b(?:na\s+conta|no\s+banco|conta|banco|no|na|pelo|pela)\s+(?:do\s+|da\s+)?(itau\s+pj|itau\s+personalite|itau\s+pf|personalite|pj|ml\s*-?\s*cofre|mercado\s+livre|cofre|bradesco|itau)\b/i);
      const matchedAcc = accHintMatch
        ? engine.resolveEntityByNameOrId(accounts, accHintMatch[1], true)
        : engine.resolveEntityByNameOrId(accounts, q, true);

      const useCard = !isIncome && !q.includes('conta') && (q.includes('cartao') || q.includes('credito') || Boolean(matchedCard));
      const installmentsMatch = q.match(/(\d+)\s*x\b|em\s+(\d+)\s*parcelas?/i);
      const installments = installmentsMatch ? parseInt(installmentsMatch[1] || installmentsMatch[2], 10) : 1;

      // Limpar descrição removendo verbos de comando, valores e menções à conta/cartão
      let cleanDesc = text
        .replace(/^(morgan[,\s]*)?(por favor[,\s]*)?(lanc(?:e|ar)|gastei|paguei|comprei|passei|adicione|registra|registre|recebi|entrou|depositaram)\s*/i, '')
        .replace(/^(uma?\s+)?(despesa|gasto|compra|receita|entrada|lancamento|pagamento|valor)\s+(de\s+)?/i, '')
        .replace(/r\$\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)/gi, '')
        .replace(/(\d{1,3}(?:\.\d{3})+,\d{2}|\d+[.,]\d{1,2}|\d+)\s*(reais)?/i, '')
        .replace(/\b(no\s+cartao|na\s+conta|no\s+credito|em\s+\d+\s*x|\d+\s*x|em\s+\d+\s*parcelas?)\b.*/i, '')
        .replace(/\b(no|na|pelo|pela|do|da)\s+(itau\s*pj|itau\s*personalite|personalite|ml\s*-?\s*cofre|mercado\s*livre|cofre|bradesco|nubanc?k|black\s*infinite|azul\s*infinite|riachuelo|renner)\b.*/i, '')
        .replace(/^(de|em|com|por|para)\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanDesc || cleanDesc.length < 2) {
        cleanDesc = isIncome
          ? `Receita ${matchedAcc ? matchedAcc.name : ''}`.trim()
          : `Despesa ${useCard && matchedCard ? matchedCard.name : (matchedAcc ? matchedAcc.name : '')}`.trim();
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
          reply: formatImmediateToolReply('create_transaction', res),
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

    return {
      reply: formatImmediateToolReply('simulate_purchase_impact', sim),
      actions: [],
      engineUsed: 'native-autonomous'
    };
  }

  // 7. Briefing / Resumo do dia
  if (q.includes('briefing') || q.includes('resumo do dia') || q.includes('auditoria')) {
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

  // 9. Projeção / Futuro / Sobra do mês / Saldos
  if (q.includes('sobr') || q.includes('proje') || q.includes('futuro') || q.includes('mes') || q.includes('saldo') || q.includes('conta')) {
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

  // Fallback cordial e objetivo (em vez de despejar relatório gigante quando a mensagem é curta)
  if (text.length <= 35) {
    return {
      reply: buildQuickGreetingReply(senderName),
      actions: [],
      engineUsed: 'native-autonomous'
    };
  }

  const briefing = await engine.buildExecutiveBriefingText(ctx);
  return {
    reply: briefing.text,
    actions: [],
    engineUsed: 'native-autonomous'
  };
}

// ============================================================================
// 5. LOOP AGÊNTICO PRINCIPAL (GEMINI FUNCTION CALLING + MULTIMODAL ULTRA-RÁPIDO)
// ============================================================================

async function processMorganMessage({
  text = '',
  media = null, // { mimeType: 'audio/ogg' | 'image/jpeg', base64Data: '...' }
  channel = 'web',
  chatId = 'default',
  senderName = 'Família',
  apiKeyOverride = null
}) {
  const cleanInputText = String(text || '').trim();

  // FAST-PATH INSTANTÂNEO (< 20ms): Saudações simples ("oi?", "olá", "tudo bem?", "morgan?")
  if (!media && isSimpleGreetingMessage(cleanInputText)) {
    const fastReply = buildQuickGreetingReply(senderName);
    await appendConversationTurn(channel, chatId, 'user', cleanInputText || 'Olá');
    await appendConversationTurn(channel, chatId, 'model', fastReply, []);
    return {
      reply: fastReply,
      actions: [],
      engineUsed: 'fast-greeting'
    };
  }

  const settings = await db.getMorganSettings();
  const apiKey = (apiKeyOverride || settings.gemini_api_key || process.env.GEMINI_API_KEY || '').trim();

  // Persistir caso apiKeyOverride tenha vindo do cliente web pela primeira vez
  if (apiKeyOverride && !settings.gemini_api_key) {
    await db.updateMorganSettings({ gemini_api_key: apiKeyOverride.trim() });
  }

  const userPromptLabel = cleanInputText || (media
    ? (media.mimeType.startsWith('audio/')
      ? '[Áudio de voz enviado pelo usuário: ouça com atenção e, se for um comando para lançar despesa/receita, editar valor/data/conta, efetivar pagamento pendente, transferir entre contas ou cancelar/excluir lançamento ou conta fixa recorrente, EXECUTE A FERRAMENTA CORRESPONDENTE IMEDIATAMENTE com os valores exatos e responda]'
      : '[Imagem de comprovante/recibo enviada pelo usuário: extraia valor exato, data, estabelecimento e categoria, registre o lançamento via create_transaction imediatamente e responda]')
    : 'Olá Morgan');

  await appendConversationTurn(channel, chatId, 'user', userPromptLabel);

  // Se não houver chave Gemini configurada, usar o Motor Autônomo Local imediatamente
  if (!apiKey) {
    const localResult = await runLocalAutonomousParserAndReasoning(userPromptLabel, { channel, chatId, senderName });
    await appendConversationTurn(channel, chatId, 'model', localResult.reply, localResult.actions);
    return localResult;
  }

  const ctxObj = await engine.buildMorganRichContext();
  const systemInstruction = buildMorganSystemInstruction(ctxObj);
  const recentHistory = await getRecentConversationHistory(channel, chatId, 6);

  const contents = [];
  const historyToInclude = recentHistory.slice(0, -1);
  for (const h of historyToInclude) {
    if (!h.content) continue;
    contents.push({
      role: h.role === 'model' ? 'model' : 'user',
      parts: [{ text: h.content }]
    });
  }

  const currentUserParts = [];
  if (media && media.base64Data && media.mimeType) {
    currentUserParts.push({
      inlineData: {
        mimeType: media.mimeType,
        data: media.base64Data
      }
    });
  }
  currentUserParts.push({ text: `[Remetente: ${senderName}] ${userPromptLabel}` });

  contents.push({
    role: 'user',
    parts: currentUserParts
  });

  // Priorizar modelos Flash de baixa latência (~700ms) com fallback resiliente para todas as versões suportadas
  const candidateModels = [
    settings.gemini_model,
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const executedActions = [];
  let activeModel = candidateModels[0];

  try {
    let workingContents = [...contents];
    let finalReplyText = '';

    for (let step = 0; step < 3; step++) {
      let responseData = null;
      let lastErr = null;

      for (const modelName of candidateModels) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(6500),
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: systemInstruction }]
              },
              contents: workingContents,
              tools: [{ functionDeclarations: MORGAN_TOOLS_DECLARATIONS }],
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 2048
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
      // Filtrar partes de texto ignorando pensamentos internos (p.thought === true)
      const textParts = candidate.parts.filter(p => p.text && !p.thought).map(p => p.text);

      if (textParts.length > 0) {
        finalReplyText = textParts.join('\n').trim();
      }

      if (functionCalls.length === 0) {
        break;
      }

      // Executar todas as Tool Calls solicitadas pelo modelo neste passo
      const functionResponseParts = [];
      let needsSecondTurnForSynthesis = false;
      const immediateReplies = [];

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

        if (name === 'query_financial_data') {
          needsSecondTurnForSynthesis = true;
        } else {
          immediateReplies.push(formatImmediateToolReply(name, toolResult));
        }

        functionResponseParts.push({
          functionResponse: {
            name,
            response: { result: toolResult }
          }
        });
      }

      // FAST-COMMIT: Se todas as ferramentas chamadas forem operacionais (lançamento, transferência, conciliação, briefing, etc.),
      // retornamos a confirmação executiva imediatamente em 0ms sem fazer uma 2ª chamada HTTP ao Gemini!
      if (!needsSecondTurnForSynthesis && immediateReplies.length > 0) {
        finalReplyText = immediateReplies.filter(Boolean).join('\n\n');
        break;
      }

      workingContents.push({
        role: 'user',
        parts: functionResponseParts
      });
    }

    if (!finalReplyText && executedActions.length > 0) {
      finalReplyText = executedActions.map(a => formatImmediateToolReply(a.toolName, a)).join('\n\n');
    }

    if (!finalReplyText) {
      const fallback = await runLocalAutonomousParserAndReasoning(userPromptLabel, { channel, chatId, senderName });
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

    // GUARD ANTI-DUPLICIDADE: Se uma ferramenta operacional JÁ FOI EXECUTADA no passo 1,
    // JAMAIS rodar o parser local de contingência (evita lançar ou transferir em duplicidade)!
    if (executedActions.length > 0) {
      const safeReply = executedActions.map(a => formatImmediateToolReply(a.toolName, a)).join('\n\n');
      await appendConversationTurn(channel, chatId, 'model', safeReply, executedActions);
      return {
        reply: safeReply,
        actions: executedActions,
        engineUsed: `gemini-partial (${activeModel})`
      };
    }

    const fallbackResult = await runLocalAutonomousParserAndReasoning(userPromptLabel, { channel, chatId, senderName });
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
  getRecentConversationHistory,
  extractMoneyAmount,
  isSimpleGreetingMessage
};
