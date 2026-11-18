/**
 * ============================================================================
 * MORGAN FINANCE ENGINE — MOTOR ANALÍTICO, TRANSACIONAL E GOVERNANÇA HÍBRIDA
 * ============================================================================
 * Compartilhado entre o Cérebro do Agente (Gemini / Nativo), Bot do Telegram,
 * Agendador Proativo 24/7 e Chat Web do Family Money.
 */

const db = require('./db');

let mutationNotifier = null;

/**
 * Registra callback para disparo em tempo real no barramento SSE (broadcastDbChange)
 */
function setMutationNotifier(fn) {
  mutationNotifier = fn;
}

function notifyMutation(table, action, data = null) {
  if (typeof mutationNotifier === 'function') {
    try {
      mutationNotifier(table, action, data);
    } catch (err) {
      console.warn('[MORGAN-ENGINE] Erro ao notificar SSE:', err.message);
    }
  }
}

function formatBRL(val) {
  const num = Number(val || 0);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeStr(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Calcula mês e ano de vencimento da fatura para uma compra no cartão
 */
function getCardPaymentMonthAndYear(purchaseDateStr, closingDay, dueDay) {
  const pDate = new Date((purchaseDateStr || getTodayStr()) + 'T12:00:00');
  let year = pDate.getFullYear();
  let closingMonth = pDate.getMonth();
  const day = pDate.getDate();

  if (day > closingDay) {
    closingMonth += 1;
    if (closingMonth > 11) {
      closingMonth = 0;
      year += 1;
    }
  }

  let dueMonth = closingMonth;
  let dueYear = year;
  if (dueDay < closingDay) {
    dueMonth += 1;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear += 1;
    }
  }

  return { year: dueYear, month: dueMonth };
}

/**
 * Motor de Projeção Financeira (6 a 12 meses) idêntico ao frontend
 */
function calculateForecast(accounts = [], cards = [], fixedItems = [], transactions = [], monthsCount = 6) {
  const currentTotalBalance = accounts.reduce((sum, acc) => sum + parseFloat(acc.balance || 0), 0);

  const forecastMonths = [];
  const tempDate = new Date();
  tempDate.setDate(1);

  for (let i = 0; i < monthsCount; i++) {
    forecastMonths.push({
      year: tempDate.getFullYear(),
      month: tempDate.getMonth(),
      label: tempDate.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', ''),
      key: `${tempDate.getFullYear()}-${String(tempDate.getMonth() + 1).padStart(2, '0')}`,
      incomes: [],
      fixedExpenses: [],
      cardBills: [],
      totalIncomes: 0,
      totalExpenses: 0,
      netSurplus: 0,
      projectedBalance: 0
    });
    tempDate.setMonth(tempDate.getMonth() + 1);
  }

  forecastMonths.forEach((m, monthIdx) => {
    fixedItems.forEach(item => {
      const cardIdNum = item.card_id || item.cardId;
      const amount = parseFloat(item.amount || 0);
      const itemDetail = {
        id: item.id,
        description: item.description,
        amount,
        dayOfMonth: item.day_of_month || item.dayOfMonth,
        category_id: item.category_id || item.categoryId || null
      };

      if (item.type === 'income') {
        m.incomes.push(itemDetail);
      } else if (cardIdNum) {
        const card = cards.find(c => Number(c.id) === Number(cardIdNum));
        if (card) {
          const recurrenceTag = `[R:${item.id}]`;
          const hasRealTx = transactions.some(t => {
            const isCard = t.payment_method === 'card' || t.paymentMethod === 'card';
            if (!isCard) return false;
            if (Number(t.card_id || t.cardId) !== Number(cardIdNum)) return false;
            if (!String(t.description || '').includes(recurrenceTag)) return false;
            const txDate = new Date(t.date + 'T12:00:00');
            return txDate.getFullYear() === m.year && txDate.getMonth() === m.month;
          });

          if (!hasRealTx) {
            const day = Math.min(parseInt(item.day_of_month || item.dayOfMonth || 10, 10), 28);
            const dateStr = `${m.year}-${String(m.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const closingD = Number(card.closing_day || card.closingDay);
            const dueD = Number(card.due_day || card.dueDay);
            const billTarget = getCardPaymentMonthAndYear(dateStr, closingD, dueD);
            const targetMonthObj = forecastMonths.find(fm => fm.year === billTarget.year && fm.month === billTarget.month);
            if (targetMonthObj) {
              targetMonthObj.cardBills.push({
                txId: null,
                cardId: Number(cardIdNum),
                description: `${item.description} (Assinatura Recorrente)`,
                amount,
                cardName: card.name,
                date: dateStr
              });
            }
          }
        }
      } else {
        const recurrenceTag = `[R:${item.id}]`;
        const matchingTx = transactions.find(t => {
          const isAccount = t.payment_method === 'account' || t.paymentMethod === 'account';
          if (!isAccount) return false;
          if (!t.description || !t.description.includes(recurrenceTag)) return false;
          const txDate = new Date(t.date + 'T12:00:00');
          return txDate.getFullYear() === m.year && txDate.getMonth() === m.month;
        });

        const isEffective = matchingTx ? (matchingTx.is_effective === true || matchingTx.isEffective === true) : false;
        const realAmount = matchingTx ? parseFloat(matchingTx.amount) : amount;

        m.fixedExpenses.push({
          ...itemDetail,
          amount: realAmount,
          isEffective,
          txId: matchingTx ? matchingTx.id : null,
          alreadyDeductedFromBalance: (monthIdx === 0 && isEffective)
        });
      }
    });
  });

  transactions.forEach(tx => {
    if (tx.payment_method !== 'card' && tx.paymentMethod !== 'card') return;
    const cardIdNum = tx.card_id || tx.cardId;
    const card = cards.find(c => Number(c.id) === Number(cardIdNum));
    if (!card) return;

    const closingD = Number(card.closing_day || card.closingDay);
    const dueD = Number(card.due_day || card.dueDay);
    const installmentsNum = Math.max(1, parseInt(tx.installments || 1, 10));

    const firstBill = getCardPaymentMonthAndYear(tx.date, closingD, dueD);
    const installmentValue = parseFloat(tx.amount || 0) / installmentsNum;

    for (let i = 0; i < installmentsNum; i++) {
      let billMonth = firstBill.month + i;
      let billYear = firstBill.year;
      if (billMonth > 11) {
        billYear += Math.floor(billMonth / 12);
        billMonth = billMonth % 12;
      }

      const matchingMonth = forecastMonths.find(m => m.year === billYear && m.month === billMonth);
      if (matchingMonth) {
        matchingMonth.cardBills.push({
          txId: tx.id,
          cardId: Number(card.id),
          description: `${tx.description} (${i + 1}/${installmentsNum})`,
          amount: installmentValue,
          cardName: card.name,
          date: tx.date
        });
      }
    }
  });

  let runningBalance = currentTotalBalance;
  forecastMonths.forEach((m, idx) => {
    const totalInc = m.incomes.reduce((sum, item) => sum + item.amount, 0);
    const totalFixed = m.fixedExpenses.reduce((sum, item) => sum + item.amount, 0);
    const totalCards = m.cardBills.reduce((sum, item) => sum + item.amount, 0);

    m.totalIncomes = totalInc;
    m.totalExpenses = totalFixed + totalCards;
    m.netSurplus = totalInc - m.totalExpenses;

    const pendingFixedExpenses = m.fixedExpenses
      .filter(item => !item.alreadyDeductedFromBalance)
      .reduce((sum, item) => sum + item.amount, 0);

    const cashImpact = (idx === 0)
      ? (totalInc - (pendingFixedExpenses + totalCards))
      : m.netSurplus;

    runningBalance += cashImpact;
    m.projectedBalance = runningBalance;
  });

  return {
    currentBalance: currentTotalBalance,
    forecast: forecastMonths
  };
}

/**
 * Score de Saúde Financeira Familiar (0 a 100)
 */
function calculateFinancialHealthScore(accounts = [], forecast = []) {
  const totalLiquid = accounts.reduce((acc, a) => acc + parseFloat(a.balance || 0), 0);
  const currentMonthForecast = forecast[0] || { totalIncomes: 0, totalExpenses: 0, cardBills: [] };
  const monthlyIncome = parseFloat(currentMonthForecast.totalIncomes || 0);
  const monthlyExpenses = parseFloat(currentMonthForecast.totalExpenses || 0);

  const netSurplus = monthlyIncome - monthlyExpenses;
  const savingsRate = monthlyIncome > 0 ? (netSurplus / monthlyIncome) : 0;

  const monthlyBurn = monthlyExpenses > 0 ? monthlyExpenses : 1;
  const coverageMonths = totalLiquid > 0 ? (totalLiquid / monthlyBurn) : 0;

  const totalCardBills = (currentMonthForecast.cardBills || []).reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
  const cardDebtRatio = monthlyIncome > 0 ? (totalCardBills / monthlyIncome) : 0;

  let savingsPts = 0;
  if (savingsRate >= 0.25) savingsPts = 35;
  else if (savingsRate >= 0.15) savingsPts = 28;
  else if (savingsRate >= 0.05) savingsPts = 20;
  else if (savingsRate > 0) savingsPts = 12;

  let liquidityPts = 0;
  if (coverageMonths >= 6) liquidityPts = 35;
  else if (coverageMonths >= 3) liquidityPts = 28;
  else if (coverageMonths >= 1) liquidityPts = 18;
  else if (coverageMonths >= 0.5) liquidityPts = 10;
  else liquidityPts = 4;

  let debtPts = 0;
  if (cardDebtRatio <= 0.30) debtPts = 30;
  else if (cardDebtRatio <= 0.50) debtPts = 22;
  else if (cardDebtRatio <= 0.70) debtPts = 14;
  else if (cardDebtRatio <= 0.90) debtPts = 6;

  const totalScore = Math.min(100, Math.max(5, savingsPts + liquidityPts + debtPts));

  let badge = 'Excelente';
  let desc = 'Ótimo controle orçamentário e ampla reserva de segurança.';
  if (totalScore < 50) {
    badge = 'Crítico';
    desc = 'Risco de liquidez. Recomenda-se corte urgente em supérfluos.';
  } else if (totalScore < 65) {
    badge = 'Atenção';
    desc = 'Despesas e cartões estão consumindo grande parte da receita.';
  } else if (totalScore < 80) {
    badge = 'Saudável';
    desc = 'Orçamento equilibrado com boa margem operacional.';
  }

  return {
    score: totalScore,
    badge,
    desc,
    totalLiquid,
    monthlyIncome,
    monthlyExpenses,
    netSurplus,
    savingsRate: (savingsRate * 100).toFixed(1),
    coverageMonths: coverageMonths.toFixed(1),
    totalCardBills,
    cardDebtRatio: (cardDebtRatio * 100).toFixed(1)
  };
}

/**
 * Ranking de Float e Decisão Tática de Cartões
 */
function getCardsFloatAnalysis(cards = [], refDate = new Date()) {
  if (!cards.length) return [];

  const currentDay = refDate.getDate();
  const currentYear = refDate.getFullYear();
  const currentMonth = refDate.getMonth();
  const todayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;

  const analysis = cards.map(card => {
    const closingDay = parseInt(card.closing_day || card.closingDay || 1, 10);
    const dueDay = parseInt(card.due_day || card.dueDay || 10, 10);

    const billTarget = getCardPaymentMonthAndYear(todayStr, closingDay, dueDay);
    const dueDate = new Date(billTarget.year, billTarget.month, dueDay, 12, 0, 0);

    const diffTime = dueDate.getTime() - refDate.getTime();
    const floatDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)));

    let daysUntilClosing = 0;
    if (currentDay <= closingDay) {
      daysUntilClosing = closingDay - currentDay;
    } else {
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      daysUntilClosing = (daysInMonth - currentDay) + closingDay;
    }

    let statusTip = '';
    let recommendationLevel = 'neutral';
    if (currentDay === closingDay) {
      statusTip = 'Fatura fecha HOJE! Evite compras hoje para não vencer já no ciclo curto.';
      recommendationLevel = 'warning';
    } else if (currentDay === closingDay + 1 || currentDay === closingDay + 2) {
      statusTip = '🔥 Fatura recém-fechada! Máximo prazo sem juros (melhor janela de float).';
      recommendationLevel = 'recommended';
    } else if (daysUntilClosing <= 3) {
      statusTip = `Fatura fecha em ${daysUntilClosing} dia(s). Aguarde o fechamento se puder.`;
      recommendationLevel = 'warning';
    } else {
      statusTip = `Prazo de ${floatDays} dias até o vencimento da fatura.`;
    }

    return {
      id: card.id,
      name: card.name,
      accountId: card.account_id,
      closingDay,
      dueDay,
      floatDays,
      daysUntilClosing,
      dueDateFormatted: dueDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
      billMonth: billTarget.month + 1,
      billYear: billTarget.year,
      statusTip,
      recommendationLevel
    };
  });

  analysis.sort((a, b) => b.floatDays - a.floatDays);
  return analysis;
}

/**
 * Detecção de Anomalias e Gastos Supérfluos
 */
function detectExpenseAnomalies(transactions = [], categories = []) {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const discretionaryKeywords = [
    'lazer', 'delivery', 'restaurante', 'alimentacao fora', 'fast food',
    'ifood', 'streaming', 'netflix', 'assinatura', 'viagem', 'shopping',
    'roupas', 'jogos', 'games', 'bar', 'cafe', 'eletronicos', 'outros'
  ];

  const currentMonthByCat = {};
  const pastMonthsByCat = {};

  transactions.forEach(t => {
    if (t.type === 'income' || t.type === 'transfer') return;
    const amount = Math.abs(parseFloat(t.amount || 0));
    if (amount <= 0) return;

    const tDate = t.date ? String(t.date).substring(0, 7) : '';
    const catId = t.category_id || t.categoryId;
    const catObj = categories.find(c => Number(c.id) === Number(catId));
    const catName = catObj ? catObj.name : 'Outros';

    if (tDate === currentMonthKey) {
      currentMonthByCat[catName] = (currentMonthByCat[catName] || 0) + amount;
    } else if (tDate) {
      pastMonthsByCat[catName] = pastMonthsByCat[catName] || {};
      pastMonthsByCat[catName][tDate] = (pastMonthsByCat[catName][tDate] || 0) + amount;
    }
  });

  const anomalies = [];
  let totalSuperfluous = 0;

  Object.entries(currentMonthByCat).forEach(([catName, spent]) => {
    const normCat = normalizeStr(catName);
    const isDiscretionary = discretionaryKeywords.some(kw => normCat.includes(kw));
    const pastMonthValues = Object.values(pastMonthsByCat[catName] || {});
    const pastAvg = pastMonthValues.length
      ? (pastMonthValues.reduce((a, b) => a + b, 0) / pastMonthValues.length)
      : spent;

    const growthPct = pastAvg > 0 ? (((spent - pastAvg) / pastAvg) * 100) : 0;

    if (isDiscretionary) {
      totalSuperfluous += spent;
    }

    if (isDiscretionary || growthPct >= 20 || spent > 500) {
      anomalies.push({
        category: catName,
        spent,
        pastAvg,
        growthPct: Math.round(growthPct),
        potentialSaving: spent * 0.20,
        isDiscretionary
      });
    }
  });

  anomalies.sort((a, b) => b.spent - a.spent);
  return {
    anomalies,
    totalSuperfluous,
    currentMonthByCat
  };
}

/**
 * Busca contas fixas e transações pendentes de efetivação para o dia de hoje
 */
function getPendingItemsForDate(fixedItems = [], transactions = [], targetDate = new Date()) {
  const day = targetDate.getDate();
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // 1. Transações marcadas como não efetivadas até hoje
  const pendingTransactions = transactions.filter(t => {
    if (t.is_effective !== false) return false;
    return String(t.date) <= dateStr;
  });

  // 2. Itens fixos que vencem hoje e ainda não possuem transação efetivada neste mês
  const dueFixedItems = fixedItems.filter(item => {
    const itemDay = Number(item.day_of_month || 1);
    if (itemDay !== day) return false;
    const tag = `[R:${item.id}]`;
    const alreadyLaunched = transactions.some(t => {
      if (!String(t.description || '').includes(tag)) return false;
      const txD = new Date(t.date + 'T12:00:00');
      return txD.getFullYear() === year && txD.getMonth() === month;
    });
    return !alreadyLaunched;
  });

  return {
    dateStr,
    pendingTransactions,
    dueFixedItems
  };
}

/**
 * Carrega todas as entidades e monta o Snapshot Cognitivo Completo do Morgan
 */
async function buildMorganRichContext() {
  const [accounts, cards, categories, tags, fixedItems, transactions, paidBills, users, settings] = await Promise.all([
    db.selectRows('accounts'),
    db.selectRows('cards'),
    db.selectRows('categories'),
    db.selectRows('tags'),
    db.selectRows('fixed_items'),
    db.selectRows('transactions', { order: 'date.desc' }),
    db.selectRows('paid_card_bills'),
    db.selectRows('app_users'),
    db.getMorganSettings()
  ]);

  const forecastResult = calculateForecast(accounts, cards, fixedItems, transactions, 6);
  const forecast = forecastResult.forecast;
  const health = calculateFinancialHealthScore(accounts, forecast);
  const cardAnalysis = getCardsFloatAnalysis(cards);
  const anomalyData = detectExpenseAnomalies(transactions, categories);
  const todayPending = getPendingItemsForDate(fixedItems, transactions);

  const selicRate = 10.75;
  const cdiAnnual = 10.65;
  const monthlyLiquidCdi = (health.totalLiquid * (cdiAnnual / 100)) / 12;

  // Faturas do mês atual detalhadas por cartão
  const currentMonthForecast = forecast[0] || { cardBills: [] };
  const currentBillsByCard = cards.map(c => {
    const items = (currentMonthForecast.cardBills || []).filter(b => Number(b.cardId) === Number(c.id));
    const total = items.reduce((s, b) => s + Number(b.amount || 0), 0);
    const isPaid = paidBills.some(pb =>
      Number(pb.card_id) === Number(c.id) &&
      Number(pb.year) === currentMonthForecast.year &&
      Number(pb.month) === (currentMonthForecast.month + 1)
    );
    return {
      cardId: c.id,
      cardName: c.name,
      closingDay: c.closing_day,
      dueDay: c.due_day,
      accountId: c.account_id,
      currentBillAmount: Number(total.toFixed(2)),
      itemsCount: items.length,
      isPaid
    };
  });

  return {
    raw: { accounts, cards, categories, tags, fixedItems, transactions, paidBills, users, settings, forecast },
    health,
    cardAnalysis,
    anomalyData,
    todayPending,
    currentBillsByCard,
    richContext: {
      dataHoje: getTodayStr(),
      patrimonioLiquidoTotal: health.totalLiquid,
      contasBancarias: accounts.map(a => ({ id: a.id, nome: a.name, saldo: Number(a.balance) })),
      cartoesCadastrados: currentBillsByCard,
      categoriasDisponiveis: categories.map(c => ({ id: c.id, nome: c.name })),
      itensFixosRecorrentes: fixedItems.map(f => ({
        id: f.id,
        descricao: f.description,
        valor: Number(f.amount),
        diaVencimento: f.day_of_month,
        tipo: f.type,
        account_id: f.account_id,
        card_id: f.card_id
      })),
      ultimosLancamentos: transactions.slice(0, 25).map(t => ({
        id: t.id,
        data: t.date,
        descricao: t.description,
        valor: Number(t.amount),
        tipo: t.type,
        metodo: t.payment_method,
        efetivado: t.is_effective !== false,
        account_id: t.account_id,
        card_id: t.card_id,
        parcelas: t.installments || 1
      })),
      pendenciasDeHoje: {
        lancamentosNaoEfetivados: todayPending.pendingTransactions.map(t => ({
          id: t.id,
          descricao: t.description,
          valor: Number(t.amount),
          data: t.date
        })),
        contasFixasVencendoHoje: todayPending.dueFixedItems.map(f => ({
          id: f.id,
          descricao: f.description,
          valor: Number(f.amount),
          tipo: f.type
        }))
      },
      indicadoresSaude: {
        score: `${health.score}/100 (${health.badge})`,
        receitaPrevistaMes: health.monthlyIncome,
        despesaPrevistaMes: health.monthlyExpenses,
        resultadoLiquidoPrevistoMes: health.netSurplus,
        taxaPoupanca: `${health.savingsRate}%`,
        coberturaReservaEmergencia: `${health.coverageMonths} meses`
      },
      analiseFloatCartoesHoje: cardAnalysis.map(c => ({
        id: c.id,
        cartao: c.name,
        diaFechamento: c.closingDay,
        diaVencimento: c.dueDay,
        diasSemJurosSeComprarHoje: c.floatDays,
        diasAteFechar: c.daysUntilClosing,
        dicaTatica: c.statusTip
      })),
      despesasMesAtualPorCategoria: anomalyData.currentMonthByCat,
      alertasSuperfluos: anomalyData.anomalies,
      projecaoFluxoCaixa6Meses: forecast.map(f => ({
        mes: f.label,
        receitas: Number(f.totalIncomes.toFixed(2)),
        despesas: Number(f.totalExpenses.toFixed(2)),
        superavitOuDeficit: Number(f.netSurplus.toFixed(2)),
        saldoAcumuladoProjetado: Number(f.projectedBalance.toFixed(2))
      })),
      memoriaEstrategicaFamilia: {
        metaPrincipal: settings.family_goal,
        gastosInegociaveis: settings.untouchable_expenses,
        perfilRisco: settings.risk_profile,
        fatosMemorizados: settings.facts_json || []
      },
      cenarioMacroBrasil: {
        selic: `${selicRate}% a.a.`,
        cdi: `${cdiAnnual}% a.a.`,
        ipca: '4.2% a.a.',
        rendimentoMensalLiquidoNoCDI: Number(monthlyLiquidCdi.toFixed(2))
      }
    }
  };
}

// ============================================================================
// RESOLUTORES INTELIGENTES DE ENTIDADES (FUZZY MATCHING POR NOME OU ID)
// ============================================================================

function resolveEntityByNameOrId(list = [], queryVal, fallbackFirst = true) {
  if (!list.length) return null;
  if (queryVal !== undefined && queryVal !== null && queryVal !== '') {
    // 1. Tentar por ID numérico exato
    if (!isNaN(Number(queryVal))) {
      const byId = list.find(item => Number(item.id) === Number(queryVal));
      if (byId) return byId;
    }
    const q = normalizeStr(queryVal);
    // 2. Match exato normalizado
    const exact = list.find(item => normalizeStr(item.name || item.description) === q);
    if (exact) return exact;
    // 3. Match por inclusão parcial
    const partial = list.find(item => {
      const target = normalizeStr(item.name || item.description);
      return target.includes(q) || q.includes(target);
    });
    if (partial) return partial;
    // 4. Match por primeira palavra-chave (ex: "Itaú" -> "Itaú Corrente", "Nubank" -> "Nubank Roxinho")
    const tokens = q.split(/\s+/).filter(t => t.length >= 2);
    for (const tok of tokens) {
      const tokenMatch = list.find(item => normalizeStr(item.name || item.description).includes(tok));
      if (tokenMatch) return tokenMatch;
    }
  }
  return fallbackFirst ? list[0] : null;
}

function inferCategoryFromDescription(categories = [], description = '', explicitCategory = null) {
  if (explicitCategory) {
    const matched = resolveEntityByNameOrId(categories, explicitCategory, false);
    if (matched) return matched;
  }
  const d = normalizeStr(description);
  const keywordMap = [
    { kw: ['mercado', 'supermercado', 'padaria', 'restaurante', 'ifood', 'lanche', 'almoco', 'jantar', 'cafe', 'pizza', 'acougue', 'feira', 'comida', 'alimentacao'], cat: 'Alimentação' },
    { kw: ['uber', '99', 'combustivel', 'gasolina', 'etanol', 'posto', 'estacionamento', 'pedagio', 'ipva', 'seguro auto', 'oficina', 'carro', 'transporte'], cat: 'Transporte' },
    { kw: ['aluguel', 'condominio', 'energia', 'luz', 'agua', 'gas', 'internet', 'iptu', 'reforma', 'casa', 'moradia'], cat: 'Moradia' },
    { kw: ['farmacia', 'remedio', 'medico', 'consulta', 'exame', 'hospital', 'dentista', 'plano de saude', 'terapia', 'saude'], cat: 'Saúde' },
    { kw: ['escola', 'faculdade', 'curso', 'livro', 'material escolar', 'mensalidade', 'educacao'], cat: 'Educação' },
    { kw: ['cinema', 'viagem', 'hotel', 'passeio', 'bar', 'festa', 'show', ' brinquedo', 'jogo', 'lazer'], cat: 'Lazer' },
    { kw: ['netflix', 'spotify', 'amazon', 'prime', 'assinatura', 'icloud', 'google', 'chatgpt', 'streaming', 'servico'], cat: 'Assinaturas' }
  ];

  for (const rule of keywordMap) {
    if (rule.kw.some(k => d.includes(k))) {
      const found = resolveEntityByNameOrId(categories, rule.cat, false);
      if (found) return found;
    }
  }
  return resolveEntityByNameOrId(categories, 'Outros', true);
}

// ============================================================================
// EXECUTOR TRANSACIONAL DE FERRAMENTAS COM GOVERNANÇA HÍBRIDA & UNDO LEDGER
// ============================================================================

/**
 * Executa uma ferramenta do Morgan respeitando a Governança Híbrida:
 * - Ações Verdes: executam imediatamente e geram snapshot para botão [Desfazer]
 * - Ações Vermelhas / Acima do Limite: geram registro pending_confirmation para botão [Confirmar]
 */
async function executeToolAction(toolName, args = {}, options = {}) {
  const { channel = 'web', chatId = 'default', forceExecute = false } = options;
  const ctx = await buildMorganRichContext();
  const { accounts, cards, categories, fixedItems, transactions, paidBills, settings } = ctx.raw;
  const threshold = Number(settings.approval_threshold || 1000);

  // --------------------------------------------------------------------------
  // 1. CREATE TRANSACTION (Despesa ou Receita em Conta ou Cartão)
  // --------------------------------------------------------------------------
  if (toolName === 'create_transaction') {
    const amount = Math.abs(parseFloat(args.amount || 0));
    if (!amount || isNaN(amount) || amount <= 0) {
      return { ok: false, error: 'Valor do lançamento inválido ou ausente.' };
    }

    const type = (args.type === 'income' || normalizeStr(args.type) === 'receita') ? 'income' : 'expense';
    let paymentMethod = args.payment_method || (args.card_name || args.card_id ? 'card' : 'account');
    if (type === 'income') paymentMethod = 'account';

    const date = args.date || getTodayStr();
    const isEffective = args.is_effective !== undefined ? Boolean(args.is_effective) : true;
    const installments = paymentMethod === 'card' ? Math.max(1, parseInt(args.installments || 1, 10)) : 1;
    const category = inferCategoryFromDescription(categories, args.description, args.category_name || args.category_id);

    let targetAccount = null;
    let targetCard = null;

    if (paymentMethod === 'card') {
      targetCard = resolveEntityByNameOrId(cards, args.card_name || args.card_id, true);
      if (!targetCard) {
        return { ok: false, error: 'Nenhum cartão de crédito encontrado para o lançamento.' };
      }
    } else {
      targetAccount = resolveEntityByNameOrId(accounts, args.account_name || args.account_id, true);
      if (!targetAccount) {
        return { ok: false, error: 'Nenhuma conta bancária encontrada para o lançamento.' };
      }
    }

    const description = String(args.description || (type === 'income' ? 'Receita' : 'Despesa')).trim();
    const undoSnapshot = {
      type: 'create_transaction',
      createdTxId: null,
      accountBalanceBefore: targetAccount ? Number(targetAccount.balance) : null,
      accountId: targetAccount ? targetAccount.id : null
    };

    const newTxPayload = {
      description,
      amount,
      date,
      category_id: category ? category.id : null,
      payment_method: paymentMethod,
      type,
      is_effective: isEffective,
      card_id: targetCard ? targetCard.id : null,
      installments,
      account_id: targetAccount ? targetAccount.id : null,
      destination_account_id: null,
      user_id: 1,
      tag_id: null,
      receipt_url: args.receipt_url || null
    };

    const insertedRows = await db.insertRows('transactions', newTxPayload);
    const createdTx = insertedRows[0];
    undoSnapshot.createdTxId = createdTx.id;

    let newBalance = null;
    if (paymentMethod === 'account' && targetAccount && isEffective) {
      const oldBal = parseFloat(targetAccount.balance || 0);
      newBalance = type === 'income' ? (oldBal + amount) : (oldBal - amount);
      await db.updateRows('accounts', { balance: Number(newBalance.toFixed(2)) }, { id: `eq.${targetAccount.id}` });
      notifyMutation('accounts', 'update', { id: targetAccount.id, balance: newBalance });
    }

    notifyMutation('transactions', 'insert', createdTx);

    const targetLabel = paymentMethod === 'card'
      ? `Cartão ${targetCard.name} (${installments}x)`
      : `Conta ${targetAccount.name}${isEffective ? ` (Novo saldo: ${formatBRL(newBalance)})` : ' (Pendente de efetivação)'}`;

    const summary = `${type === 'income' ? 'Receita' : 'Despesa'} "${description}" de ${formatBRL(amount)} lançada em ${targetLabel} [${category ? category.name : 'Geral'}].`;

    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'create_transaction',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args, createdTx },
      undo_snapshot_json: undoSnapshot,
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary,
      transaction: createdTx,
      newAccountBalance: newBalance
    };
  }

  // --------------------------------------------------------------------------
  // 2. TRANSFER BETWEEN ACCOUNTS (Governança Híbrida por Limite de Valor)
  // --------------------------------------------------------------------------
  if (toolName === 'transfer_between_accounts') {
    const amount = Math.abs(parseFloat(args.amount || 0));
    if (!amount || amount <= 0) {
      return { ok: false, error: 'Valor da transferência inválido.' };
    }

    const originAcc = resolveEntityByNameOrId(accounts, args.from_account || args.origin_account, false);
    const destAcc = resolveEntityByNameOrId(accounts, args.to_account || args.destination_account, false);

    if (!originAcc || !destAcc) {
      return {
        ok: false,
        error: `Contas não identificadas. Contas disponíveis: ${accounts.map(a => a.name).join(', ')}.`
      };
    }
    if (Number(originAcc.id) === Number(destAcc.id)) {
      return { ok: false, error: 'A conta de origem e de destino devem ser diferentes.' };
    }

    const summary = `Transferência de ${formatBRL(amount)} de ${originAcc.name} para ${destAcc.name}`;

    // Governança Híbrida: Se valor >= approval_threshold e não foi confirmado ainda, exige aprovação
    if (!forceExecute && amount >= threshold) {
      const pendingLog = await db.insertRows('morgan_action_logs', {
        action_type: 'transfer_between_accounts',
        status: 'pending_confirmation',
        channel,
        chat_id: String(chatId),
        summary: `[CONFIRMAÇÃO NECESSÁRIA] ${summary}`,
        payload_json: {
          toolName: 'transfer_between_accounts',
          args: {
            amount,
            from_account: originAcc.id,
            to_account: destAcc.id,
            description: args.description || `Transferência ${originAcc.name} -> ${destAcc.name}`,
            date: args.date || getTodayStr()
          }
        },
        undo_snapshot_json: null
      });

      return {
        ok: true,
        status: 'pending_confirmation',
        requiresConfirmation: true,
        actionLogId: pendingLog[0]?.id,
        summary: `🔒 **Confirmação de Governança Híbrida:** A transferência de **${formatBRL(amount)}** de **${originAcc.name}** para **${destAcc.name}** atinge o limite de proteção (${formatBRL(threshold)}). Confirme no botão abaixo para efetivar.`
      };
    }

    const originBefore = parseFloat(originAcc.balance || 0);
    const destBefore = parseFloat(destAcc.balance || 0);
    const originAfter = Number((originBefore - amount).toFixed(2));
    const destAfter = Number((destBefore + amount).toFixed(2));

    const txRows = await db.insertRows('transactions', {
      description: args.description || `Transferência: ${originAcc.name} -> ${destAcc.name}`,
      amount,
      date: args.date || getTodayStr(),
      category_id: null,
      payment_method: 'transfer',
      type: 'transfer',
      is_effective: true,
      card_id: null,
      installments: 1,
      account_id: originAcc.id,
      destination_account_id: destAcc.id,
      user_id: 1
    });

    await db.updateRows('accounts', { balance: originAfter }, { id: `eq.${originAcc.id}` });
    await db.updateRows('accounts', { balance: destAfter }, { id: `eq.${destAcc.id}` });

    notifyMutation('transactions', 'insert', txRows[0]);
    notifyMutation('accounts', 'update', { originId: originAcc.id, destId: destAcc.id });

    const undoSnapshot = {
      type: 'transfer_between_accounts',
      createdTxId: txRows[0]?.id,
      originAccountId: originAcc.id,
      originBalanceBefore: originBefore,
      destAccountId: destAcc.id,
      destBalanceBefore: destBefore
    };

    const execSummary = `Transferência concluída: ${formatBRL(amount)} de ${originAcc.name} (Saldo: ${formatBRL(originAfter)}) para ${destAcc.name} (Saldo: ${formatBRL(destAfter)}).`;

    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'transfer_between_accounts',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary: execSummary,
      payload_json: { toolName, args, tx: txRows[0] },
      undo_snapshot_json: undoSnapshot,
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary: execSummary,
      originBalance: originAfter,
      destinationBalance: destAfter
    };
  }

  // --------------------------------------------------------------------------
  // 3. CONCILIATE TRANSACTION (Efetivar Lançamento ou Conta Fixa do Mês)
  // --------------------------------------------------------------------------
  if (toolName === 'conciliate_transaction') {
    let targetTx = null;
    if (args.transaction_id) {
      targetTx = transactions.find(t => Number(t.id) === Number(args.transaction_id));
    } else if (args.description) {
      const q = normalizeStr(args.description);
      targetTx = transactions.find(t => t.is_effective === false && normalizeStr(t.description).includes(q))
        || transactions.find(t => normalizeStr(t.description).includes(q));
    }

    if (!targetTx) {
      return { ok: false, error: 'Lançamento não encontrado para conciliação/efetivação.' };
    }

    const newEffectiveState = args.is_effective !== undefined ? Boolean(args.is_effective) : true;
    const oldEffectiveState = targetTx.is_effective !== false;

    if (newEffectiveState === oldEffectiveState) {
      return {
        ok: true,
        status: 'noop',
        summary: `O lançamento "${targetTx.description}" já estava ${newEffectiveState ? 'efetivado' : 'pendente'}.`
      };
    }

    const acc = accounts.find(a => Number(a.id) === Number(targetTx.account_id));
    const amount = parseFloat(targetTx.amount || 0);
    let balanceBefore = acc ? parseFloat(acc.balance || 0) : null;
    let balanceAfter = balanceBefore;

    await db.updateRows('transactions', { is_effective: newEffectiveState }, { id: `eq.${targetTx.id}` });

    if (acc && targetTx.payment_method === 'account') {
      if (newEffectiveState && !oldEffectiveState) {
        balanceAfter = targetTx.type === 'income' ? (balanceBefore + amount) : (balanceBefore - amount);
      } else if (!newEffectiveState && oldEffectiveState) {
        balanceAfter = targetTx.type === 'income' ? (balanceBefore - amount) : (balanceBefore + amount);
      }
      balanceAfter = Number(balanceAfter.toFixed(2));
      await db.updateRows('accounts', { balance: balanceAfter }, { id: `eq.${acc.id}` });
      notifyMutation('accounts', 'update', { id: acc.id, balance: balanceAfter });
    }

    notifyMutation('transactions', 'update', { id: targetTx.id, is_effective: newEffectiveState });

    const summary = `Lançamento "${targetTx.description}" (${formatBRL(amount)}) marcado como ${newEffectiveState ? 'EFETIVADO' : 'PENDENTE'}${acc ? ` — Saldo ${acc.name}: ${formatBRL(balanceAfter)}` : ''}.`;

    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'conciliate_transaction',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args, txId: targetTx.id },
      undo_snapshot_json: {
        type: 'conciliate_transaction',
        txId: targetTx.id,
        previousEffective: oldEffectiveState,
        accountId: acc ? acc.id : null,
        accountBalanceBefore: balanceBefore
      },
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary
    };
  }

  // --------------------------------------------------------------------------
  // 4. DELETE TRANSACTION (Governança Vermelha: Sempre Pede Confirmação Prévia)
  // --------------------------------------------------------------------------
  if (toolName === 'delete_transaction') {
    let targetTx = null;
    if (args.transaction_id) {
      targetTx = transactions.find(t => Number(t.id) === Number(args.transaction_id));
    } else if (args.description) {
      const q = normalizeStr(args.description);
      targetTx = transactions.find(t => normalizeStr(t.description).includes(q));
    }

    if (!targetTx) {
      return { ok: false, error: 'Lançamento não localizado para exclusão.' };
    }

    if (!forceExecute) {
      const pendingLog = await db.insertRows('morgan_action_logs', {
        action_type: 'delete_transaction',
        status: 'pending_confirmation',
        channel,
        chat_id: String(chatId),
        summary: `[CONFIRMAR EXCLUSÃO] Excluir "${targetTx.description}" (${formatBRL(targetTx.amount)}) de ${targetTx.date}`,
        payload_json: {
          toolName: 'delete_transaction',
          args: { transaction_id: targetTx.id }
        }
      });

      return {
        ok: true,
        status: 'pending_confirmation',
        requiresConfirmation: true,
        actionLogId: pendingLog[0]?.id,
        summary: `🔒 **Confirmação de Exclusão:** Deseja realmente excluir o lançamento **"${targetTx.description}"** no valor de **${formatBRL(targetTx.amount)}** (${targetTx.date}) e estornar seu impacto no saldo?`
      };
    }

    // Execução confirmada: estornar saldo se aplicável e remover transação
    const amount = parseFloat(targetTx.amount || 0);
    const isEff = targetTx.is_effective !== false;
    const acc = accounts.find(a => Number(a.id) === Number(targetTx.account_id));
    const destAcc = accounts.find(a => Number(a.id) === Number(targetTx.destination_account_id));

    const undoSnapshot = {
      type: 'delete_transaction',
      deletedTx: { ...targetTx },
      accountId: acc ? acc.id : null,
      accountBalanceBefore: acc ? Number(acc.balance) : null,
      destAccountId: destAcc ? destAcc.id : null,
      destBalanceBefore: destAcc ? Number(destAcc.balance) : null
    };

    if (isEff && targetTx.payment_method === 'account' && acc) {
      const revertedBalance = targetTx.type === 'income'
        ? Number((parseFloat(acc.balance) - amount).toFixed(2))
        : Number((parseFloat(acc.balance) + amount).toFixed(2));
      await db.updateRows('accounts', { balance: revertedBalance }, { id: `eq.${acc.id}` });
      notifyMutation('accounts', 'update', { id: acc.id, balance: revertedBalance });
    } else if (isEff && targetTx.payment_method === 'transfer' && acc && destAcc) {
      const revOrigin = Number((parseFloat(acc.balance) + amount).toFixed(2));
      const revDest = Number((parseFloat(destAcc.balance) - amount).toFixed(2));
      await db.updateRows('accounts', { balance: revOrigin }, { id: `eq.${acc.id}` });
      await db.updateRows('accounts', { balance: revDest }, { id: `eq.${destAcc.id}` });
      notifyMutation('accounts', 'update', { id: acc.id });
    }

    await db.deleteRows('transactions', { id: `eq.${targetTx.id}` });
    notifyMutation('transactions', 'delete', { id: targetTx.id });

    const summary = `Lançamento "${targetTx.description}" (${formatBRL(amount)}) excluído e saldo estornado com sucesso.`;
    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'delete_transaction',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args },
      undo_snapshot_json: undoSnapshot,
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary
    };
  }

  // --------------------------------------------------------------------------
  // 5. ADJUST ACCOUNT BALANCE (Ajuste / Conciliação Direta de Saldo Bancário)
  // --------------------------------------------------------------------------
  if (toolName === 'adjust_account_balance') {
    const acc = resolveEntityByNameOrId(accounts, args.account_name || args.account_id, false);
    if (!acc) {
      return { ok: false, error: `Conta não encontrada. Contas disponíveis: ${accounts.map(a => a.name).join(', ')}` };
    }
    const newBalance = parseFloat(args.new_balance);
    if (isNaN(newBalance)) {
      return { ok: false, error: 'Novo saldo informado é inválido.' };
    }

    const oldBalance = parseFloat(acc.balance || 0);
    const diff = Math.abs(newBalance - oldBalance);

    if (!forceExecute && diff >= threshold) {
      const pendingLog = await db.insertRows('morgan_action_logs', {
        action_type: 'adjust_account_balance',
        status: 'pending_confirmation',
        channel,
        chat_id: String(chatId),
        summary: `[CONFIRMAR AJUSTE DE SALDO] ${acc.name}: de ${formatBRL(oldBalance)} para ${formatBRL(newBalance)}`,
        payload_json: {
          toolName: 'adjust_account_balance',
          args: { account_id: acc.id, new_balance: newBalance }
        }
      });

      return {
        ok: true,
        status: 'pending_confirmation',
        requiresConfirmation: true,
        actionLogId: pendingLog[0]?.id,
        summary: `🔒 **Confirmação de Ajuste de Saldo:** A diferença de saldo na conta **${acc.name}** é de **${formatBRL(diff)}** (de ${formatBRL(oldBalance)} para **${formatBRL(newBalance)}**). Confirme no botão abaixo para aplicar.`
      };
    }

    await db.updateRows('accounts', { balance: Number(newBalance.toFixed(2)) }, { id: `eq.${acc.id}` });
    notifyMutation('accounts', 'update', { id: acc.id, balance: newBalance });

    const summary = `Saldo da conta ${acc.name} atualizado de ${formatBRL(oldBalance)} para ${formatBRL(newBalance)}.`;
    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'adjust_account_balance',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args },
      undo_snapshot_json: {
        type: 'adjust_account_balance',
        accountId: acc.id,
        accountBalanceBefore: oldBalance
      },
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary
    };
  }

  // --------------------------------------------------------------------------
  // 6. PAY CARD BILL (Pagamento / Quitação de Fatura de Cartão de Crédito)
  // --------------------------------------------------------------------------
  if (toolName === 'pay_card_bill') {
    const card = resolveEntityByNameOrId(cards, args.card_name || args.card_id, false);
    if (!card) {
      return { ok: false, error: `Cartão não encontrado. Cartões disponíveis: ${cards.map(c => c.name).join(', ')}` };
    }

    const now = new Date();
    const year = parseInt(args.year || now.getFullYear(), 10);
    const month = parseInt(args.month || (now.getMonth() + 1), 10);

    const cardBillInfo = ctx.currentBillsByCard.find(b => Number(b.cardId) === Number(card.id));
    const amount = args.amount !== undefined
      ? Math.abs(parseFloat(args.amount))
      : (cardBillInfo ? cardBillInfo.currentBillAmount : 0);

    const payAccount = resolveEntityByNameOrId(accounts, args.account_name || card.account_id, true);

    if (!forceExecute) {
      const pendingLog = await db.insertRows('morgan_action_logs', {
        action_type: 'pay_card_bill',
        status: 'pending_confirmation',
        channel,
        chat_id: String(chatId),
        summary: `[CONFIRMAR PAGAMENTO DE FATURA] ${card.name} (${month}/${year}) - ${formatBRL(amount)} via ${payAccount ? payAccount.name : 'Conta padrão'}`,
        payload_json: {
          toolName: 'pay_card_bill',
          args: {
            card_id: card.id,
            year,
            month,
            amount,
            account_id: payAccount ? payAccount.id : card.account_id
          }
        }
      });

      return {
        ok: true,
        status: 'pending_confirmation',
        requiresConfirmation: true,
        actionLogId: pendingLog[0]?.id,
        summary: `🔒 **Confirmação de Quitação de Fatura:** Confirmar o pagamento da fatura do cartão **${card.name}** referente a **${String(month).padStart(2, '0')}/${year}** no valor de **${formatBRL(amount)}**, debitando da conta **${payAccount ? payAccount.name : 'Vinculada'}**?`
      };
    }

    const accBefore = payAccount ? parseFloat(payAccount.balance || 0) : null;
    const accAfter = payAccount ? Number((accBefore - amount).toFixed(2)) : null;

    const insertedBill = await db.insertRows('paid_card_bills', {
      card_id: card.id,
      year,
      month,
      amount
    });

    if (payAccount) {
      await db.updateRows('accounts', { balance: accAfter }, { id: `eq.${payAccount.id}` });
      notifyMutation('accounts', 'update', { id: payAccount.id, balance: accAfter });
    }
    notifyMutation('paid_card_bills', 'insert', insertedBill[0]);

    const summary = `Fatura do cartão ${card.name} (${String(month).padStart(2, '0')}/${year}) no valor de ${formatBRL(amount)} quitada com sucesso${payAccount ? ` via ${payAccount.name} (Novo saldo: ${formatBRL(accAfter)})` : ''}.`;

    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'pay_card_bill',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args },
      undo_snapshot_json: {
        type: 'pay_card_bill',
        paidBillId: insertedBill[0]?.id,
        accountId: payAccount ? payAccount.id : null,
        accountBalanceBefore: accBefore
      },
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary
    };
  }

  // --------------------------------------------------------------------------
  // 7. CREATE FIXED ITEM (Cadastrar Despesa Fixa ou Receita Recorrente)
  // --------------------------------------------------------------------------
  if (toolName === 'create_fixed_item') {
    const amount = Math.abs(parseFloat(args.amount || 0));
    if (!amount || amount <= 0) {
      return { ok: false, error: 'Valor do item fixo recorrente inválido.' };
    }
    const dayOfMonth = Math.min(31, Math.max(1, parseInt(args.day_of_month || 10, 10)));
    const type = (args.type === 'income' || normalizeStr(args.type) === 'receita') ? 'income' : 'expense';
    const category = inferCategoryFromDescription(categories, args.description, args.category_name);

    let targetCard = null;
    let targetAcc = null;
    if (args.card_name || args.card_id) {
      targetCard = resolveEntityByNameOrId(cards, args.card_name || args.card_id, false);
    }
    if (!targetCard) {
      targetAcc = resolveEntityByNameOrId(accounts, args.account_name || args.account_id, true);
    }

    const inserted = await db.insertRows('fixed_items', {
      description: String(args.description || 'Recorrência').trim(),
      amount,
      day_of_month: dayOfMonth,
      type,
      account_id: targetAcc ? targetAcc.id : null,
      card_id: targetCard ? targetCard.id : null,
      category_id: category ? category.id : null
    });

    notifyMutation('fixed_items', 'insert', inserted[0]);

    const summary = `Item recorrente "${inserted[0].description}" (${formatBRL(amount)} todo dia ${dayOfMonth}) cadastrado em ${targetCard ? `Cartão ${targetCard.name}` : `Conta ${targetAcc?.name || 'Padrão'}`}.`;
    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'create_fixed_item',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args, fixedItem: inserted[0] },
      undo_snapshot_json: {
        type: 'create_fixed_item',
        fixedItemId: inserted[0]?.id
      },
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary,
      fixedItem: inserted[0]
    };
  }

  // --------------------------------------------------------------------------
  // 8. QUERY FINANCIAL DATA (Busca Inteligente de Transações, Faturas e Contas)
  // --------------------------------------------------------------------------
  if (toolName === 'query_financial_data') {
    const search = normalizeStr(args.search_term || '');
    const limit = Math.min(50, Math.max(1, parseInt(args.limit || 15, 10)));
    let filtered = [...transactions];

    if (args.type) {
      filtered = filtered.filter(t => t.type === args.type);
    }
    if (args.payment_method) {
      filtered = filtered.filter(t => t.payment_method === args.payment_method);
    }
    if (args.card_name) {
      const c = resolveEntityByNameOrId(cards, args.card_name, false);
      if (c) filtered = filtered.filter(t => Number(t.card_id) === Number(c.id));
    }
    if (args.account_name) {
      const a = resolveEntityByNameOrId(accounts, args.account_name, false);
      if (a) filtered = filtered.filter(t => Number(t.account_id) === Number(a.id));
    }
    if (args.category_name) {
      const cat = resolveEntityByNameOrId(categories, args.category_name, false);
      if (cat) filtered = filtered.filter(t => Number(t.category_id) === Number(cat.id));
    }
    if (args.month_key) {
      filtered = filtered.filter(t => String(t.date || '').startsWith(args.month_key));
    }
    if (search) {
      filtered = filtered.filter(t => normalizeStr(t.description).includes(search));
    }

    const totalSum = filtered.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    return {
      ok: true,
      status: 'queried',
      totalMatched: filtered.length,
      totalAmount: Number(totalSum.toFixed(2)),
      results: filtered.slice(0, limit).map(t => ({
        id: t.id,
        date: t.date,
        description: t.description,
        amount: Number(t.amount),
        type: t.type,
        payment_method: t.payment_method,
        is_effective: t.is_effective !== false,
        installments: t.installments || 1
      })),
      currentBillsByCard: ctx.currentBillsByCard,
      accounts: accounts.map(a => ({ id: a.id, name: a.name, balance: Number(a.balance) }))
    };
  }

  // --------------------------------------------------------------------------
  // 9. RECOMMEND BEST CARD (Engenharia de Float e Melhor Cartão do Dia)
  // --------------------------------------------------------------------------
  if (toolName === 'recommend_best_card') {
    const refDate = args.reference_date ? new Date(args.reference_date + 'T12:00:00') : new Date();
    const ranking = getCardsFloatAnalysis(cards, refDate);
    return {
      ok: true,
      status: 'analyzed',
      bestCard: ranking[0] || null,
      ranking
    };
  }

  // --------------------------------------------------------------------------
  // 10. SIMULATE PURCHASE IMPACT (Simulador de Compra à Vista vs. Parcelado)
  // --------------------------------------------------------------------------
  if (toolName === 'simulate_purchase_impact') {
    const amount = Math.abs(parseFloat(args.amount || 0));
    const installments = Math.max(1, parseInt(args.installments || 1, 10));
    const installmentVal = amount / installments;
    const bestCard = ctx.cardAnalysis[0] || null;

    // Rendimento se parcelar sem juros e deixar o capital no CDI (10.65% a.a. ~ 0.85% a.m.)
    const monthlyCdiRate = 0.0085;
    let cdiGainFromInstallments = 0;
    let remainingPrincipal = amount;
    for (let m = 1; m <= installments; m++) {
      cdiGainFromInstallments += remainingPrincipal * monthlyCdiRate;
      remainingPrincipal -= installmentVal;
    }

    const simulatedMonths = ctx.raw.forecast.map((f, idx) => {
      const addedExpense = idx < installments ? installmentVal : 0;
      const newSurplus = f.netSurplus - addedExpense;
      return {
        mes: f.label,
        superavitAtual: Number(f.netSurplus.toFixed(2)),
        superavitComCompra: Number(newSurplus.toFixed(2)),
        comprometeFluxo: newSurplus < 0
      };
    });

    return {
      ok: true,
      status: 'simulated',
      purchaseAmount: amount,
      installments,
      installmentValue: Number(installmentVal.toFixed(2)),
      recommendedCard: bestCard ? `${bestCard.name} (${bestCard.floatDays} dias de float)` : 'N/A',
      cdiArbitrageGain: Number(cdiGainFromInstallments.toFixed(2)),
      causesDeficitInAnyMonth: simulatedMonths.some(m => m.comprometeFluxo),
      monthlyImpact: simulatedMonths
    };
  }

  // --------------------------------------------------------------------------
  // 11. SAVE FAMILY MEMORY FACT (Gravar Fato ou Diretriz na Memória Permanente)
  // --------------------------------------------------------------------------
  if (toolName === 'save_family_memory_fact') {
    const previousSettings = { ...settings };
    const patch = {};
    const currentFacts = Array.isArray(settings.facts_json) ? [...settings.facts_json] : [];

    if (args.fact) {
      const cleanFact = String(args.fact).trim();
      if (cleanFact && !currentFacts.includes(cleanFact)) {
        currentFacts.unshift(cleanFact);
        patch.facts_json = currentFacts;
      }
    }
    if (args.family_goal) patch.family_goal = String(args.family_goal).trim();
    if (args.untouchable_expenses) patch.untouchable_expenses = String(args.untouchable_expenses).trim();
    if (args.risk_profile) patch.risk_profile = String(args.risk_profile).trim();

    const updated = await db.updateMorganSettings(patch);
    notifyMutation('morgan_settings', 'update', updated);

    const summary = args.fact
      ? `Nova diretriz memorizada permanentemente pelo Morgan: "${args.fact}".`
      : `Diretrizes estratégicas da família atualizadas na memória permanente.`;

    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'save_family_memory_fact',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args },
      undo_snapshot_json: {
        type: 'save_family_memory_fact',
        previousFacts: previousSettings.facts_json,
        previousGoal: previousSettings.family_goal
      },
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary,
      updatedSettings: updated
    };
  }

  // --------------------------------------------------------------------------
  // 12. GENERATE EXECUTIVE BRIEFING (Relatório Executivo Matinal / Sob Demanda)
  // --------------------------------------------------------------------------
  if (toolName === 'generate_executive_briefing') {
    const briefing = await buildExecutiveBriefingText(ctx);
    return {
      ok: true,
      status: 'generated',
      briefingText: briefing.text,
      pendingTransactions: ctx.todayPending.pendingTransactions,
      dueFixedItems: ctx.todayPending.dueFixedItems
    };
  }

  return { ok: false, error: `Ferramenta desconhecida: ${toolName}` };
}

/**
 * Confirma e executa uma ação que estava em pending_confirmation
 */
async function confirmPendingAction(actionLogId) {
  const logs = await db.selectRows('morgan_action_logs', { id: `eq.${actionLogId}` });
  const log = logs[0];
  if (!log) return { ok: false, error: 'Registro de ação não encontrado.' };
  if (log.status !== 'pending_confirmation') {
    return { ok: false, error: `Esta ação já foi processada (status atual: ${log.status}).` };
  }

  const payload = typeof log.payload_json === 'string' ? JSON.parse(log.payload_json) : log.payload_json;
  const result = await executeToolAction(payload.toolName, payload.args, {
    channel: log.channel,
    chatId: log.chat_id,
    forceExecute: true
  });

  await db.updateRows('morgan_action_logs', {
    status: 'confirmed',
    executed_at: new Date().toISOString()
  }, { id: `eq.${actionLogId}` });

  return result;
}

/**
 * Cancela uma ação que estava em pending_confirmation
 */
async function cancelPendingAction(actionLogId) {
  const logs = await db.selectRows('morgan_action_logs', { id: `eq.${actionLogId}` });
  const log = logs[0];
  if (!log) return { ok: false, error: 'Registro de ação não encontrado.' };
  if (log.status !== 'pending_confirmation') {
    return { ok: false, error: `Esta ação não está mais pendente (status: ${log.status}).` };
  }

  await db.updateRows('morgan_action_logs', {
    status: 'cancelled',
    executed_at: new Date().toISOString()
  }, { id: `eq.${actionLogId}` });

  return {
    ok: true,
    status: 'cancelled',
    summary: `❌ Operação cancelada pelo usuário: ${log.summary}`
  };
}

/**
 * Desfaz (Undo) uma ação já executada restaurando o snapshot original no banco
 */
async function undoExecutedAction(actionLogId) {
  const logs = await db.selectRows('morgan_action_logs', { id: `eq.${actionLogId}` });
  const log = logs[0];
  if (!log) return { ok: false, error: 'Registro de ação não localizado para estorno.' };
  if (log.status === 'undone') {
    return { ok: false, error: 'Esta ação já foi desfeita anteriormente.' };
  }

  const snap = typeof log.undo_snapshot_json === 'string'
    ? JSON.parse(log.undo_snapshot_json || 'null')
    : log.undo_snapshot_json;

  if (!snap) {
    return { ok: false, error: 'Esta ação não possui snapshot de reversão.' };
  }

  if (snap.type === 'create_transaction') {
    if (snap.createdTxId) {
      await db.deleteRows('transactions', { id: `eq.${snap.createdTxId}` });
      notifyMutation('transactions', 'delete', { id: snap.createdTxId });
    }
    if (snap.accountId && snap.accountBalanceBefore !== null && snap.accountBalanceBefore !== undefined) {
      await db.updateRows('accounts', { balance: snap.accountBalanceBefore }, { id: `eq.${snap.accountId}` });
      notifyMutation('accounts', 'update', { id: snap.accountId, balance: snap.accountBalanceBefore });
    }
  } else if (snap.type === 'transfer_between_accounts') {
    if (snap.createdTxId) {
      await db.deleteRows('transactions', { id: `eq.${snap.createdTxId}` });
      notifyMutation('transactions', 'delete', { id: snap.createdTxId });
    }
    if (snap.originAccountId) {
      await db.updateRows('accounts', { balance: snap.originBalanceBefore }, { id: `eq.${snap.originAccountId}` });
    }
    if (snap.destAccountId) {
      await db.updateRows('accounts', { balance: snap.destBalanceBefore }, { id: `eq.${snap.destAccountId}` });
    }
    notifyMutation('accounts', 'update', {});
  } else if (snap.type === 'conciliate_transaction') {
    if (snap.txId) {
      await db.updateRows('transactions', { is_effective: snap.previousEffective }, { id: `eq.${snap.txId}` });
      notifyMutation('transactions', 'update', { id: snap.txId });
    }
    if (snap.accountId && snap.accountBalanceBefore !== null) {
      await db.updateRows('accounts', { balance: snap.accountBalanceBefore }, { id: `eq.${snap.accountId}` });
      notifyMutation('accounts', 'update', { id: snap.accountId });
    }
  } else if (snap.type === 'delete_transaction') {
    if (snap.deletedTx) {
      await db.insertRows('transactions', snap.deletedTx);
      notifyMutation('transactions', 'insert', snap.deletedTx);
    }
    if (snap.accountId && snap.accountBalanceBefore !== null) {
      await db.updateRows('accounts', { balance: snap.accountBalanceBefore }, { id: `eq.${snap.accountId}` });
    }
    if (snap.destAccountId && snap.destBalanceBefore !== null) {
      await db.updateRows('accounts', { balance: snap.destBalanceBefore }, { id: `eq.${snap.destAccountId}` });
    }
    notifyMutation('accounts', 'update', {});
  } else if (snap.type === 'adjust_account_balance') {
    if (snap.accountId && snap.accountBalanceBefore !== null) {
      await db.updateRows('accounts', { balance: snap.accountBalanceBefore }, { id: `eq.${snap.accountId}` });
      notifyMutation('accounts', 'update', { id: snap.accountId });
    }
  } else if (snap.type === 'pay_card_bill') {
    if (snap.paidBillId) {
      await db.deleteRows('paid_card_bills', { id: `eq.${snap.paidBillId}` });
      notifyMutation('paid_card_bills', 'delete', { id: snap.paidBillId });
    }
    if (snap.accountId && snap.accountBalanceBefore !== null) {
      await db.updateRows('accounts', { balance: snap.accountBalanceBefore }, { id: `eq.${snap.accountId}` });
      notifyMutation('accounts', 'update', { id: snap.accountId });
    }
  } else if (snap.type === 'create_fixed_item') {
    if (snap.fixedItemId) {
      await db.deleteRows('fixed_items', { id: `eq.${snap.fixedItemId}` });
      notifyMutation('fixed_items', 'delete', { id: snap.fixedItemId });
    }
  } else if (snap.type === 'save_family_memory_fact') {
    await db.updateMorganSettings({
      facts_json: snap.previousFacts || [],
      family_goal: snap.previousGoal
    });
    notifyMutation('morgan_settings', 'update', {});
  }

  await db.updateRows('morgan_action_logs', { status: 'undone' }, { id: `eq.${actionLogId}` });

  return {
    ok: true,
    status: 'undone',
    summary: `↩️ **Ação Desfeita com Sucesso:** O lançamento/operação (${log.summary}) foi revertido e os saldos originais restaurados.`
  };
}

/**
 * Monta o texto executivo do Briefing Diário Matinal & Alertas de Cartão
 */
async function buildExecutiveBriefingText(preloadedCtx = null) {
  const ctx = preloadedCtx || await buildMorganRichContext();
  const { health, cardAnalysis, todayPending, currentBillsByCard, raw } = ctx;
  const bestCard = cardAnalysis[0];
  const closingSoon = cardAnalysis.filter(c => c.daysUntilClosing <= 2);

  const accountsLines = raw.accounts
    .map(a => `• **${a.name}**: ${formatBRL(a.balance)}`)
    .join('\n');

  const billsLines = currentBillsByCard
    .map(b => `• **${b.cardName}**: ${formatBRL(b.currentBillAmount)} (Fecha dia ${b.closingDay} | Vence dia ${b.dueDay}) ${b.isPaid ? '✅ *Paga*' : ''}`)
    .join('\n');

  let pendingSection = '✅ *Nenhuma conta fixa ou lançamento pendente para hoje.*';
  const pendingItemsList = [];

  if (todayPending.dueFixedItems.length > 0 || todayPending.pendingTransactions.length > 0) {
    const lines = [];
    todayPending.dueFixedItems.forEach(f => {
      lines.push(`• 📌 [Fixo Hoje] **${f.description}**: ${formatBRL(f.amount)}`);
    });
    todayPending.pendingTransactions.slice(0, 5).forEach(t => {
      lines.push(`• ⏳ [Pendente #${t.id}] **${t.description}**: ${formatBRL(t.amount)} (${t.date})`);
      pendingItemsList.push(t);
    });
    pendingSection = lines.join('\n');
  }

  let cardAlertSection = '';
  if (closingSoon.length > 0) {
    cardAlertSection = `\n⚠️ **Alerta de Fechamento de Cartão:**\n` +
      closingSoon.map(c => `• **${c.name}** fecha em **${c.daysUntilClosing === 0 ? 'HOJE' : c.daysUntilClosing + ' dia(s)'}**! Evite compras nele agora; priorize o **${bestCard ? bestCard.name : 'cartão de maior float'}**.`).join('\n') + '\n';
  }

  const cdiYieldMonth = (health.totalLiquid * 0.1065) / 12;

  const text = `☀️ **Bom dia, senhor! Briefing Executivo Matinal — CFO Morgan**
📅 *${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}*

💰 **Liquidez Consolidada:** **${formatBRL(health.totalLiquid)}** *(Score: ${health.score}/100 — ${health.badge})*
${accountsLines}

💳 **Faturas do Ciclo Atual & Estratégia de Float:**
${billsLines}
🏆 **Melhor Cartão para Compras Hoje:** **${bestCard ? bestCard.name : 'N/A'}** (**${bestCard ? bestCard.floatDays : 0} dias** sem juros até pagar)
${cardAlertSection}
📋 **Obrigações & Conciliação de Hoje:**
${pendingSection}

📈 **Balanço Projetado do Mês:**
• Receitas Previstas: ${formatBRL(health.monthlyIncome)}
• Saídas Previstas (Fixas + Cartões): ${formatBRL(health.monthlyExpenses)}
• Resultado Estimado: **${health.netSurplus >= 0 ? '🟢 +' + formatBRL(health.netSurplus) : '🔴 -' + formatBRL(Math.abs(health.netSurplus))}**
• Rendimento Potencial em 100% CDI: **+${formatBRL(cdiYieldMonth)}/mês**

*Envie um áudio, foto de comprovante ou texto a qualquer momento para lançar despesas, transferir valores ou simular decisões.*`;

  return {
    text,
    pendingTransactions: pendingItemsList,
    dueFixedItems: todayPending.dueFixedItems,
    closingSoonCards: closingSoon,
    bestCard
  };
}

module.exports = {
  setMutationNotifier,
  notifyMutation,
  formatBRL,
  getTodayStr,
  normalizeStr,
  getCardPaymentMonthAndYear,
  calculateForecast,
  calculateFinancialHealthScore,
  getCardsFloatAnalysis,
  detectExpenseAnomalies,
  getPendingItemsForDate,
  buildMorganRichContext,
  executeToolAction,
  confirmPendingAction,
  cancelPendingAction,
  undoExecutedAction,
  buildExecutiveBriefingText
};
