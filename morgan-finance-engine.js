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

    // Contabilizar despesas e receitas variáveis em conta deste mês (débito, Pix, compras avulsas não fixas)
    let variableAccountExpenses = 0;
    let variableAccountIncomes = 0;
    let pendingVariableAccountExpenses = 0;

    transactions.forEach(t => {
      const isCard = t.payment_method === 'card' || t.paymentMethod === 'card';
      if (isCard) return; // Cartões de crédito já consolidados em cardBills
      if (t.description && String(t.description).includes('[R:')) return; // Recorrências fixas já em fixedExpenses
      if (t.type === 'transfer') return;

      const txDate = new Date(t.date + 'T12:00:00');
      if (txDate.getFullYear() === m.year && txDate.getMonth() === m.month) {
        const amt = Math.abs(parseFloat(t.amount || 0));
        const isEff = t.is_effective === true || t.isEffective === true;
        if (t.type === 'income') {
          variableAccountIncomes += amt;
        } else {
          variableAccountExpenses += amt;
          if (!isEff) {
            pendingVariableAccountExpenses += amt;
          }
        }
      }
    });

    m.fixedExpensesTotal = totalFixed;
    m.cardsTotal = totalCards;
    m.variableExpenses = variableAccountExpenses;
    m.variableIncomes = variableAccountIncomes;

    m.totalIncomes = totalInc + variableAccountIncomes;
    m.totalExpenses = totalFixed + totalCards + variableAccountExpenses;
    m.netSurplus = m.totalIncomes - m.totalExpenses;

    const pendingFixedExpenses = m.fixedExpenses
      .filter(item => !item.alreadyDeductedFromBalance)
      .reduce((sum, item) => sum + item.amount, 0);

    // No mês corrente (mês 0), saídas efetivadas já reduziram os saldos de partida (currentTotalBalance).
    // Abatemos do fluxo restante apenas saídas pendentes + cartões a quitar.
    const cashImpact = (idx === 0)
      ? (m.totalIncomes - (pendingFixedExpenses + totalCards + pendingVariableAccountExpenses))
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

  // Faturas do mês atual detalhadas por cartão (com próxima data exata de vencimento para ordenação precisa)
  const nowDate = new Date();
  const curY = nowDate.getFullYear();
  const curM = nowDate.getMonth();
  const curD = nowDate.getDate();

  const currentMonthForecast = forecast[0] || { cardBills: [] };
  const currentBillsByCard = cards.map(c => {
    const items = (currentMonthForecast.cardBills || []).filter(b => Number(b.cardId) === Number(c.id));
    const total = items.reduce((s, b) => s + Number(b.amount || 0), 0);
    const isPaid = paidBills.some(pb =>
      Number(pb.card_id) === Number(c.id) &&
      Number(pb.year) === currentMonthForecast.year &&
      Number(pb.month) === (currentMonthForecast.month + 1)
    );
    const dueD = parseInt(c.due_day || 10, 10);
    let nextDueYear = curY;
    let nextDueMonth = curM; // 0-indexed
    if (dueD < curD || isPaid) {
      nextDueMonth += 1;
      if (nextDueMonth > 11) {
        nextDueMonth = 0;
        nextDueYear += 1;
      }
    }
    const nextDueDateISO = `${nextDueYear}-${String(nextDueMonth + 1).padStart(2, '0')}-${String(dueD).padStart(2, '0')}`;
    const targetForecastMonth = forecast.find(fm => fm.year === nextDueYear && fm.month === nextDueMonth) || currentMonthForecast;
    const nextDueItems = (targetForecastMonth.cardBills || []).filter(b => Number(b.cardId) === Number(c.id));
    const nextDueBillAmount = nextDueItems.reduce((s, b) => s + Number(b.amount || 0), 0);
    const daysUntilNextDue = Math.max(0, Math.round((new Date(nextDueYear, nextDueMonth, dueD, 12, 0, 0).getTime() - nowDate.getTime()) / (1000 * 60 * 60 * 24)));

    return {
      cardId: c.id,
      cardName: c.name,
      closingDay: c.closing_day,
      dueDay: c.due_day,
      accountId: c.account_id,
      currentBillAmount: Number(total.toFixed(2)),
      nextDueDateISO,
      nextDueBillAmount: Number(nextDueBillAmount.toFixed(2)),
      daysUntilNextDue,
      itemsCount: items.length,
      isPaid
    };
  }).sort((a, b) => a.nextDueDateISO.localeCompare(b.nextDueDateISO));

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
      ultimosLancamentos: transactions.slice(0, 15).map(t => ({
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
      todosLancamentosPendentesNaoEfetivados: transactions
        .filter(t => t.is_effective === false && t.payment_method !== 'card')
        .slice(0, 15)
        .map(t => ({
          id: t.id,
          data: t.date,
          descricao: t.description,
          valor: Number(t.amount),
          tipo: t.type,
          metodo: t.payment_method,
          account_id: t.account_id
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
    // 1. Tentar por ID numérico exato (apenas se a string inteira for um número)
    const trimmedVal = String(queryVal).trim();
    if (/^\d+$/.test(trimmedVal)) {
      const byId = list.find(item => Number(item.id) === Number(trimmedVal));
      if (byId) return byId;
    }

    const q = normalizeStr(queryVal);
    if (q) {
      // 2. Match exato normalizado
      const exact = list.find(item => normalizeStr(item.name || item.description) === q);
      if (exact) return exact;

      // 3. Aliases semânticos específicos para contas e cartões da família
      const isAccountList = list.some(item => item.balance !== undefined);
      if (isAccountList) {
        if (/\b(pj|empresa|juridic)\b/.test(q)) {
          const pjAcc = list.find(item => normalizeStr(item.name).includes('pj'));
          if (pjAcc) return pjAcc;
        }
        if (/\b(personalite|personnalite|pf|fisica|pessoal)\b/.test(q) || q === 'itau') {
          const pfAcc = list.find(item => normalizeStr(item.name).includes('personalite'));
          if (pfAcc) return pfAcc;
        }
        if (/\b(ml|cofre|mercado\s*livre)\b/.test(q)) {
          const mlAcc = list.find(item => {
            const n = normalizeStr(item.name);
            return n.includes('cofre') || n.includes('ml') || n.includes('mercado');
          });
          if (mlAcc) return mlAcc;
        }
        if (/\bbradesco\b/.test(q)) {
          const bradAcc = list.find(item => normalizeStr(item.name).includes('bradesco'));
          if (bradAcc) return bradAcc;
        }
      } else {
        // Aliases para cartões (ex: "nubank" -> "Nubanck")
        if (/\bnubanc?k\b/.test(q)) {
          const nuCard = list.find(item => normalizeStr(item.name || '').includes('nuban'));
          if (nuCard) return nuCard;
        }
      }

      // 4. Match por inclusão parcial completa
      const partial = list.find(item => {
        const target = normalizeStr(item.name || item.description);
        return target && (target.includes(q) || q.includes(target));
      });
      if (partial) return partial;

      // 5. Match pontuado por múltiplos tokens (prioriza quem acerta mais palavras específicas)
      const tokens = q.split(/[\s/\-_]+/).filter(t => t.length >= 2);
      if (tokens.length > 0) {
        let bestItem = null;
        let bestScore = 0;
        for (const item of list) {
          const target = normalizeStr(item.name || item.description);
          const targetTokens = target.split(/[\s/\-_]+/);
          let score = 0;
          for (const tok of tokens) {
            if (targetTokens.includes(tok)) {
              score += (tok === 'itau' ? 1 : 3); // Tokens específicos (pj, personalite, cofre) valem mais que prefixo compartilhado
            } else if (target.includes(tok)) {
              score += 1;
            }
          }
          if (score > bestScore) {
            bestScore = score;
            bestItem = item;
          }
        }
        if (bestItem && bestScore > 0) return bestItem;
      }
    }
  }
  if (!fallbackFirst) return null;
  // Se for lista de contas, preferir Itaú Personalite ou primeira conta com saldo > 0 em vez de conta zerada
  if (list.some(item => item.balance !== undefined)) {
    const activeAcc = list.find(item => normalizeStr(item.name).includes('personalite'))
      || list.find(item => parseFloat(item.balance || 0) > 0);
    if (activeAcc) return activeAcc;
  }
  return list[0];
}

function inferCategoryFromDescription(categories = [], description = '', explicitCategory = null, txType = 'expense') {
  if (explicitCategory) {
    const matched = resolveEntityByNameOrId(categories, explicitCategory, false);
    if (matched && !(txType === 'expense' && normalizeStr(matched.name) === 'salario')) {
      return matched;
    }
  }
  const d = normalizeStr(`${description || ''} ${explicitCategory || ''}`);

  if (txType === 'income') {
    if (d.includes('reembolso') || d.includes('estorno')) {
      const c = resolveEntityByNameOrId(categories, 'Reembolso', false);
      if (c) return c;
    }
    if (d.includes('extra') || d.includes('freela') || d.includes('bonus')) {
      const c = resolveEntityByNameOrId(categories, 'Trabalho Extra', false);
      if (c) return c;
    }
    const sal = resolveEntityByNameOrId(categories, 'Salário', false);
    if (sal) return sal;
  }

  const keywordMap = [
    { kw: ['mercado', 'supermercado', 'oba', 'swift', 'acougue', 'varejao', 'feira', 'hortifruti', 'atacadao', 'assai', 'pao de acucar', 'carrefour', 'alimentacao'], cat: 'Mercado/ varejão/ açougue' },
    { kw: ['padaria', 'cafe', 'lanche', 'restaurante', 'ifood', 'almoco', 'jantar', 'pizza', 'pizzaria', 'hamburguer', 'burger', 'fast food', 'fest food', 'bolo', 'outback', 'sorvete', 'comida'], cat: 'Café/ fest food' },
    { kw: ['combustivel', 'gasolina', 'etanol', 'posto', 'ipiranga', 'shell', 'estacionamento', 'pedagio', 'guincho', 'oficina', 'pneu', 'ipva', 'seguro auto', 'carro', 'automovel', 'lavagem'], cat: 'Automovel' },
    { kw: ['uber', '99', 'taxi', 'onibus', 'metro', 'passagem', 'transporte'], cat: 'Transporte' },
    { kw: ['aluguel', 'condominio', 'energia', 'luz', 'agua', 'gas', 'iptu', 'reforma', 'manutencao', 'portao', 'limpeza', 'pilha', 'casa', 'moradia'], cat: 'Casa' },
    { kw: ['farmacia', 'remedio', 'drogaria', 'drogasil', 'medico', 'consulta', 'exame', 'hospital', 'dentista', 'dental', 'convenio', 'plano de saude', 'terapia', 'psicologo', 'saude'], cat: 'Saúde' },
    { kw: ['escola', 'colegio', 'faculdade', 'curso', 'livro', 'material escolar', 'mensalidade', 'educacao'], cat: 'Educação' },
    { kw: ['academia', 'pano bianco', 'smartfit', 'treino', 'crossfit', 'pilates', 'natacao'], cat: 'Academia' },
    { kw: ['suplemento', 'whey', 'creatina', 'vitamina'], cat: 'Suplementos' },
    { kw: ['pet', 'racao', 'veterinario', 'banho e tosa', 'cachorro', 'gato'], cat: 'Pet' },
    { kw: ['clube', 'cerveja', 'bar', 'churrasco', 'lazer'], cat: 'Clube/ Lazer' },
    { kw: ['cinema', 'viagem', 'hotel', 'passeio', 'festa', 'show', 'diversao', 'ingresso'], cat: 'Passeio/ diversão' },
    { kw: ['presente', 'aniversario', 'brinquedo', 'lembranca'], cat: 'Presente' },
    { kw: ['roupa', 'vestuario', 'calcado', 'sapato', 'tenis', 'renner', 'riachuelo', 'cea', 'zara', 'pratas', 'acessorio'], cat: 'Vestuario/ acessorios' },
    { kw: ['escova', 'cabelo', 'salao', 'barbearia', 'estetica', 'perfume', 'cosmetico', 'cuidado'], cat: 'Cuidados pessoais' },
    { kw: ['netflix', 'spotify', 'amazon', 'prime', 'globo', 'assinatura', 'icloud', 'google', 'openai', 'chatgpt', 'paddle', 'botconvers', 'melimais', 'vivo', 'internet', 'celular', 'streaming'], cat: 'Assinaturas' },
    { kw: ['das', 'inss', 'imposto', 'taxa', 'anuidade', 'darf', 'tarifa', 'juros', 'iof'], cat: 'Taxas / imposto' },
    { kw: ['emprestimo', 'consorcio', 'financiamento', 'parcela', 'divida'], cat: 'Divida' },
    { kw: ['investimento', 'cdb', 'tesouro', 'reserva', 'aporte', 'acao', 'fundo'], cat: 'Investimento' },
    { kw: ['contadora', 'contador', 'rosana', 'pj', 'empresa', 'fornecedor', 'nota fiscal'], cat: 'Empresa' }
  ];

  for (const rule of keywordMap) {
    if (rule.kw.some(k => d.includes(k))) {
      const found = resolveEntityByNameOrId(categories, rule.cat, false);
      if (found) return found;
    }
  }

  // Fallback seguro para despesa: NUNCA retornar 'Salário' para uma despesa!
  const safeExpenseFallback = resolveEntityByNameOrId(categories, 'Casa', false)
    || resolveEntityByNameOrId(categories, 'Empresa', false)
    || categories.find(c => !['salario', 'trabalho extra', 'reembolso'].includes(normalizeStr(c.name)))
    || categories[0];
  return safeExpenseFallback;
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
    const category = inferCategoryFromDescription(categories, args.description, args.category_name || args.category_id, type);

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
  // 3. CONCILIATE TRANSACTION (Efetivar Lançamento ou Conta Fixa do Mês, com opção de editar valor/conta)
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

    // Se não achou transação no mês mas existe item fixo (recorrência) correspondente, gera e já efetiva a transação do mês!
    if (!targetTx && args.description) {
      const q = normalizeStr(args.description);
      const matchedFixed = fixedItems.find(f => normalizeStr(f.description).includes(q));
      if (matchedFixed) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(Math.min(28, Math.max(1, Number(matchedFixed.day_of_month || 10)))).padStart(2, '0');
        const chosenAcc = args.account_name || args.account_id
          ? resolveEntityByNameOrId(accounts, args.account_name || args.account_id, true)
          : resolveEntityByNameOrId(accounts, matchedFixed.account_id, true);
        const effAmount = (args.amount !== undefined && !isNaN(parseFloat(args.amount)))
          ? Math.abs(parseFloat(args.amount))
          : parseFloat(matchedFixed.amount || 0);

        return await executeToolAction('create_transaction', {
          description: `${matchedFixed.description} [R:${matchedFixed.id}]`,
          amount: effAmount,
          date: args.date || `${y}-${m}-${d}`,
          type: matchedFixed.type || 'expense',
          payment_method: matchedFixed.card_id ? 'card' : 'account',
          account_id: chosenAcc ? chosenAcc.id : matchedFixed.account_id,
          card_id: matchedFixed.card_id || null,
          category_id: matchedFixed.category_id || null,
          is_effective: args.is_effective !== undefined ? Boolean(args.is_effective) : true
        }, options);
      }
    }

    if (!targetTx) {
      return { ok: false, error: 'Lançamento não encontrado para conciliação/efetivação.' };
    }

    const newEffectiveState = args.is_effective !== undefined ? Boolean(args.is_effective) : true;
    const oldEffectiveState = targetTx.is_effective !== false;

    const newAmount = (args.amount !== undefined && !isNaN(parseFloat(args.amount)) && parseFloat(args.amount) > 0)
      ? Math.abs(parseFloat(args.amount))
      : parseFloat(targetTx.amount || 0);
    const oldAmount = parseFloat(targetTx.amount || 0);

    const newAcc = (args.account_name || args.account_id)
      ? resolveEntityByNameOrId(accounts, args.account_name || args.account_id, false)
      : accounts.find(a => Number(a.id) === Number(targetTx.account_id));
    const oldAcc = accounts.find(a => Number(a.id) === Number(targetTx.account_id));
    const targetAcc = newAcc || oldAcc || resolveEntityByNameOrId(accounts, null, true);

    if (newEffectiveState === oldEffectiveState && Math.abs(newAmount - oldAmount) < 0.001 && (!targetAcc || Number(targetAcc.id) === Number(targetTx.account_id))) {
      return {
        ok: true,
        status: 'noop',
        summary: `O lançamento "${targetTx.description}" já estava ${newEffectiveState ? 'efetivado' : 'pendente'} com valor ${formatBRL(newAmount)}.`
      };
    }

    // Estornar impacto anterior se já estava efetivado em conta
    if (oldEffectiveState && targetTx.payment_method === 'account' && oldAcc) {
      const revertedOld = targetTx.type === 'income'
        ? Number((parseFloat(oldAcc.balance || 0) - oldAmount).toFixed(2))
        : Number((parseFloat(oldAcc.balance || 0) + oldAmount).toFixed(2));
      await db.updateRows('accounts', { balance: revertedOld }, { id: `eq.${oldAcc.id}` });
      oldAcc.balance = revertedOld;
      notifyMutation('accounts', 'update', { id: oldAcc.id, balance: revertedOld });
    }

    const txPatch = {
      is_effective: newEffectiveState,
      amount: newAmount
    };
    if (targetAcc && targetTx.payment_method === 'account') {
      txPatch.account_id = targetAcc.id;
    }
    if (args.date) txPatch.date = args.date;
    if (args.new_description) txPatch.description = String(args.new_description).trim();

    await db.updateRows('transactions', txPatch, { id: `eq.${targetTx.id}` });

    let balanceBefore = targetAcc ? parseFloat(targetAcc.balance || 0) : null;
    let balanceAfter = balanceBefore;

    if (targetAcc && targetTx.payment_method === 'account' && newEffectiveState) {
      balanceAfter = targetTx.type === 'income'
        ? Number((balanceBefore + newAmount).toFixed(2))
        : Number((balanceBefore - newAmount).toFixed(2));
      await db.updateRows('accounts', { balance: balanceAfter }, { id: `eq.${targetAcc.id}` });
      targetAcc.balance = balanceAfter;
      notifyMutation('accounts', 'update', { id: targetAcc.id, balance: balanceAfter });
    }

    // Se for item recorrente [R:ID] e o valor mudou, atualizar também o valor base em fixed_items se solicitado
    const rMatch = String(targetTx.description || '').match(/\[R:(\d+)\]/);
    if (rMatch && Math.abs(newAmount - oldAmount) > 0.001) {
      const rId = parseInt(rMatch[1], 10);
      await db.updateRows('fixed_items', { amount: newAmount }, { id: `eq.${rId}` });
      notifyMutation('fixed_items', 'update', { id: rId, amount: newAmount });
    }

    notifyMutation('transactions', 'update', { id: targetTx.id, ...txPatch });

    const summary = `Lançamento "${txPatch.description || targetTx.description}" (${formatBRL(newAmount)}) marcado como ${newEffectiveState ? 'EFETIVADO' : 'PENDENTE'}${targetAcc ? ` — Conta ${targetAcc.name} (Saldo: ${formatBRL(balanceAfter)})` : ''}.`;

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
        previousAmount: oldAmount,
        accountId: targetAcc ? targetAcc.id : null,
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
  // 3B. UPDATE TRANSACTION (Editar Valor, Descrição, Data, Conta, Cartão, Categoria ou Status de Qualquer Lançamento)
  // --------------------------------------------------------------------------
  if (toolName === 'update_transaction') {
    let targetTx = null;
    if (args.transaction_id) {
      targetTx = transactions.find(t => Number(t.id) === Number(args.transaction_id));
    } else if (args.search_description || args.description) {
      const q = normalizeStr(args.search_description || args.description);
      targetTx = transactions.find(t => normalizeStr(t.description).includes(q));
    }

    if (!targetTx) {
      return { ok: false, error: 'Lançamento não localizado para edição.' };
    }

    const previousTxSnapshot = { ...targetTx };
    const oldAcc = accounts.find(a => Number(a.id) === Number(targetTx.account_id));
    const oldDestAcc = accounts.find(a => Number(a.id) === Number(targetTx.destination_account_id));
    const oldBalanceSnapshot = {
      oldAccId: oldAcc ? oldAcc.id : null,
      oldAccBalance: oldAcc ? Number(oldAcc.balance) : null,
      oldDestAccId: oldDestAcc ? oldDestAcc.id : null,
      oldDestAccBalance: oldDestAcc ? Number(oldDestAcc.balance) : null
    };

    // 1. Estornar impacto financeiro anterior nas contas se estava efetivado
    const oldAmount = Math.abs(parseFloat(targetTx.amount || 0));
    const wasEffective = targetTx.is_effective !== false;
    if (wasEffective && targetTx.payment_method === 'account' && oldAcc) {
      const rev = targetTx.type === 'income'
        ? Number((parseFloat(oldAcc.balance) - oldAmount).toFixed(2))
        : Number((parseFloat(oldAcc.balance) + oldAmount).toFixed(2));
      await db.updateRows('accounts', { balance: rev }, { id: `eq.${oldAcc.id}` });
      oldAcc.balance = rev;
    } else if (wasEffective && targetTx.payment_method === 'transfer' && oldAcc && oldDestAcc) {
      const revOrig = Number((parseFloat(oldAcc.balance) + oldAmount).toFixed(2));
      const revDest = Number((parseFloat(oldDestAcc.balance) - oldAmount).toFixed(2));
      await db.updateRows('accounts', { balance: revOrig }, { id: `eq.${oldAcc.id}` });
      await db.updateRows('accounts', { balance: revDest }, { id: `eq.${oldDestAcc.id}` });
      oldAcc.balance = revOrig;
      oldDestAcc.balance = revDest;
    }

    // 2. Preparar novos campos atualizados
    const newAmount = (args.new_amount !== undefined || args.amount !== undefined)
      ? Math.abs(parseFloat(args.new_amount !== undefined ? args.new_amount : args.amount))
      : oldAmount;
    const newType = args.type ? ((args.type === 'income' || normalizeStr(args.type) === 'receita') ? 'income' : (args.type === 'transfer' ? 'transfer' : 'expense')) : targetTx.type;
    let newMethod = args.payment_method || targetTx.payment_method;
    if (args.card_name || args.card_id) newMethod = 'card';
    else if (args.account_name || args.account_id) newMethod = (newType === 'transfer' ? 'transfer' : 'account');

    let newAccId = targetTx.account_id;
    let newCardId = targetTx.card_id;
    if (newMethod === 'card') {
      const c = (args.card_name || args.card_id)
        ? resolveEntityByNameOrId(cards, args.card_name || args.card_id, true)
        : cards.find(x => Number(x.id) === Number(targetTx.card_id));
      newCardId = c ? c.id : targetTx.card_id;
      newAccId = null;
    } else {
      const a = (args.account_name || args.account_id)
        ? resolveEntityByNameOrId(accounts, args.account_name || args.account_id, true)
        : accounts.find(x => Number(x.id) === Number(targetTx.account_id));
      newAccId = a ? a.id : targetTx.account_id;
      newCardId = null;
    }

    const rTagMatch = String(targetTx.description || '').match(/\[R:\d+\]/);
    let newDesc = args.new_description ? String(args.new_description).trim() : targetTx.description;
    if (rTagMatch && !newDesc.includes(rTagMatch[0])) {
      newDesc = `${newDesc} ${rTagMatch[0]}`;
    }

    let newCatId = targetTx.category_id;
    if (args.category_name || args.category_id) {
      const cat = resolveEntityByNameOrId(categories, args.category_name || args.category_id, false);
      if (cat) newCatId = cat.id;
    }

    const newEffective = args.is_effective !== undefined ? Boolean(args.is_effective) : (newMethod === 'card' ? false : wasEffective);
    const newInstallments = args.installments ? Math.max(1, parseInt(args.installments, 10)) : (targetTx.installments || 1);
    const newDate = args.date || targetTx.date;

    const patchPayload = {
      description: newDesc,
      amount: newAmount,
      date: newDate,
      type: newType,
      payment_method: newMethod,
      account_id: newAccId,
      card_id: newCardId,
      category_id: newCatId,
      installments: newInstallments,
      is_effective: newEffective
    };

    await db.updateRows('transactions', patchPayload, { id: `eq.${targetTx.id}` });

    // 3. Aplicar novo impacto financeiro nas contas se efetivado
    const updatedAcc = accounts.find(a => Number(a.id) === Number(newAccId));
    const updatedDestAcc = accounts.find(a => Number(a.id) === Number(targetTx.destination_account_id));
    if (newEffective && newMethod === 'account' && updatedAcc) {
      const newBal = newType === 'income'
        ? Number((parseFloat(updatedAcc.balance) + newAmount).toFixed(2))
        : Number((parseFloat(updatedAcc.balance) - newAmount).toFixed(2));
      await db.updateRows('accounts', { balance: newBal }, { id: `eq.${updatedAcc.id}` });
      updatedAcc.balance = newBal;
      notifyMutation('accounts', 'update', { id: updatedAcc.id, balance: newBal });
    } else if (newEffective && newMethod === 'transfer' && updatedAcc && updatedDestAcc) {
      const newOrig = Number((parseFloat(updatedAcc.balance) - newAmount).toFixed(2));
      const newDest = Number((parseFloat(updatedDestAcc.balance) + newAmount).toFixed(2));
      await db.updateRows('accounts', { balance: newOrig }, { id: `eq.${updatedAcc.id}` });
      await db.updateRows('accounts', { balance: newDest }, { id: `eq.${updatedDestAcc.id}` });
      updatedAcc.balance = newOrig;
      updatedDestAcc.balance = newDest;
      notifyMutation('accounts', 'update', { id: updatedAcc.id });
    }

    notifyMutation('transactions', 'update', { id: targetTx.id, ...patchPayload });

    const summary = `Lançamento #${targetTx.id} atualizado: "${newDesc}" ➔ ${formatBRL(newAmount)} (${newDate}) [${newEffective ? 'Efetivado' : 'Pendente'}]${updatedAcc ? ` — Saldo ${updatedAcc.name}: ${formatBRL(updatedAcc.balance)}` : ''}.`;
    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'update_transaction',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args, txId: targetTx.id, patchPayload },
      undo_snapshot_json: {
        type: 'update_transaction',
        txId: targetTx.id,
        previousTx: previousTxSnapshot,
        ...oldBalanceSnapshot
      },
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary,
      transaction: { ...targetTx, ...patchPayload }
    };
  }

  // --------------------------------------------------------------------------
  // 4. DELETE TRANSACTION (Exclusão Direta com Botão [Desfazer] se < Limite, ou Confirmação se >= Limite)
  // --------------------------------------------------------------------------
  if (toolName === 'delete_transaction') {
    let targetTx = null;
    if (args.transaction_id) {
      targetTx = transactions.find(t => Number(t.id) === Number(args.transaction_id));
    } else if (args.description) {
      const q = normalizeStr(args.description);
      targetTx = transactions.find(t => normalizeStr(t.description).includes(q));
    }

    // Se o usuário pediu para excluir e o item está apenas em fixed_items, redireciona para delete_fixed_item!
    if (!targetTx && args.description) {
      const q = normalizeStr(args.description);
      const matchedFixed = fixedItems.find(f => normalizeStr(f.description).includes(q));
      if (matchedFixed) {
        return await executeToolAction('delete_fixed_item', { fixed_item_id: matchedFixed.id, also_delete_current_month_tx: true }, { ...options, forceExecute: true });
      }
    }

    if (!targetTx) {
      return { ok: false, error: 'Lançamento não localizado para exclusão.' };
    }

    const txAmount = Math.abs(parseFloat(targetTx.amount || 0));
    if (!forceExecute && txAmount >= threshold) {
      const pendingLog = await db.insertRows('morgan_action_logs', {
        action_type: 'delete_transaction',
        status: 'pending_confirmation',
        channel,
        chat_id: String(chatId),
        summary: `[CONFIRMAR EXCLUSÃO] Excluir "${targetTx.description}" (${formatBRL(targetTx.amount)}) de ${targetTx.date}`,
        payload_json: {
          toolName: 'delete_transaction',
          args: { transaction_id: targetTx.id, also_delete_fixed_recurrence: args.also_delete_fixed_recurrence }
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

    // Execução imediata: estornar saldo se aplicável e remover transação (com Undo completo disponível!)
    const amount = parseFloat(targetTx.amount || 0);
    const isEff = targetTx.is_effective !== false;
    const acc = accounts.find(a => Number(a.id) === Number(targetTx.account_id));
    const destAcc = accounts.find(a => Number(a.id) === Number(targetTx.destination_account_id));

    let deletedFixedItem = null;
    let dismissedRecurrence = null;
    const rMatch = String(targetTx.description || '').match(/\[R:(\d+)\]/);
    if (rMatch) {
      const rId = parseInt(rMatch[1], 10);
      if (args.also_delete_fixed_recurrence) {
        deletedFixedItem = fixedItems.find(f => Number(f.id) === rId) || null;
        if (deletedFixedItem) {
          await db.deleteRows('fixed_items', { id: `eq.${rId}` });
          notifyMutation('fixed_items', 'delete', { id: rId });
        }
      } else {
        // Gravar em dismissed_recurrences para não reaparecer no F5 ou auto-geração
        const txDate = new Date((targetTx.date || '') + 'T12:00:00');
        const year = isNaN(txDate.getFullYear()) ? new Date().getFullYear() : txDate.getFullYear();
        const month = isNaN(txDate.getMonth()) ? new Date().getMonth() : txDate.getMonth();
        const ins = await db.insertRows('dismissed_recurrences', {
          fixed_item_id: rId,
          year,
          month
        });
        dismissedRecurrence = ins[0] || null;
        notifyMutation('dismissed_recurrences', 'insert', {});
      }
    }

    const undoSnapshot = {
      type: 'delete_transaction',
      deletedTx: { ...targetTx },
      deletedFixedItem,
      dismissedRecurrence,
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

    const fixedSuffix = deletedFixedItem ? ` (A recorrência fixa "${deletedFixedItem.description}" também foi removida permanentemente)` : '';
    const summary = `Lançamento "${targetTx.description}" (${formatBRL(amount)}) excluído${isEff && acc ? ' e saldo estornado' : ''} com sucesso${fixedSuffix}.`;
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
  // 7B. UPDATE FIXED ITEM (Editar Valor, Dia, Conta, Cartão ou Descrição de Despesa/Receita Fixa)
  // --------------------------------------------------------------------------
  if (toolName === 'update_fixed_item') {
    let targetFixed = null;
    if (args.fixed_item_id) {
      targetFixed = fixedItems.find(f => Number(f.id) === Number(args.fixed_item_id));
    } else if (args.search_description || args.description) {
      const q = normalizeStr(args.search_description || args.description);
      targetFixed = fixedItems.find(f => normalizeStr(f.description).includes(q));
    }

    if (!targetFixed) {
      return { ok: false, error: 'Item fixo recorrente não localizado para edição.' };
    }

    const previousFixedSnapshot = { ...targetFixed };
    const patch = {};
    if (args.new_description) patch.description = String(args.new_description).trim();
    if (args.new_amount !== undefined || args.amount !== undefined) {
      const val = Math.abs(parseFloat(args.new_amount !== undefined ? args.new_amount : args.amount));
      if (val > 0) patch.amount = val;
    }
    if (args.day_of_month !== undefined) {
      patch.day_of_month = Math.min(31, Math.max(1, parseInt(args.day_of_month, 10)));
    }
    if (args.type) {
      patch.type = (args.type === 'income' || normalizeStr(args.type) === 'receita') ? 'income' : 'expense';
    }
    if (args.card_name || args.card_id) {
      const c = resolveEntityByNameOrId(cards, args.card_name || args.card_id, false);
      if (c) {
        patch.card_id = c.id;
        patch.account_id = null;
      }
    } else if (args.account_name || args.account_id) {
      const a = resolveEntityByNameOrId(accounts, args.account_name || args.account_id, false);
      if (a) {
        patch.account_id = a.id;
        patch.card_id = null;
      }
    }
    if (args.category_name || args.category_id) {
      const cat = resolveEntityByNameOrId(categories, args.category_name || args.category_id, false);
      if (cat) patch.category_id = cat.id;
    }

    await db.updateRows('fixed_items', patch, { id: `eq.${targetFixed.id}` });
    notifyMutation('fixed_items', 'update', { id: targetFixed.id, ...patch });

    // Sincronizar eventual transação pendente deste mês com [R:ID]
    const rTag = `[R:${targetFixed.id}]`;
    const pendingLinkedTxs = transactions.filter(t => t.is_effective === false && String(t.description || '').includes(rTag));
    for (const ptx of pendingLinkedTxs) {
      const txSync = {};
      if (patch.amount !== undefined) txSync.amount = patch.amount;
      if (patch.description !== undefined) txSync.description = `${patch.description} ${rTag}`;
      if (Object.keys(txSync).length > 0) {
        await db.updateRows('transactions', txSync, { id: `eq.${ptx.id}` });
        notifyMutation('transactions', 'update', { id: ptx.id, ...txSync });
      }
    }

    const updatedDesc = patch.description || targetFixed.description;
    const updatedAmt = patch.amount !== undefined ? patch.amount : targetFixed.amount;
    const updatedDay = patch.day_of_month !== undefined ? patch.day_of_month : targetFixed.day_of_month;
    const summary = `Despesa/Receita Fixa #${targetFixed.id} atualizada: "${updatedDesc}" ➔ ${formatBRL(updatedAmt)} (Vencimento: todo dia ${updatedDay}).`;

    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'update_fixed_item',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args, fixedItemId: targetFixed.id, patch },
      undo_snapshot_json: {
        type: 'update_fixed_item',
        fixedItemId: targetFixed.id,
        previousFixed: previousFixedSnapshot
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
  // 7C. DELETE FIXED ITEM (Cancelar / Excluir Despesa Fixa ou Assinatura Recorrente, Único ou em Lote)
  // --------------------------------------------------------------------------
  if (toolName === 'delete_fixed_item') {
    let matchedItems = [];
    if (args.fixed_item_id) {
      const found = fixedItems.find(f => Number(f.id) === Number(args.fixed_item_id));
      if (found) matchedItems = [found];
    } else if (args.description || args.search_description) {
      const q = normalizeStr(args.description || args.search_description);
      const allMatches = fixedItems.filter(f => normalizeStr(f.description).includes(q));
      if (args.delete_all_matching) {
        matchedItems = allMatches;
      } else if (args.amount !== undefined) {
        const targetAmt = Math.abs(parseFloat(args.amount));
        const byAmt = allMatches.filter(f => Math.abs(parseFloat(f.amount) - targetAmt) < 0.05);
        matchedItems = byAmt.length > 0 ? [byAmt[0]] : (allMatches.length > 0 ? [allMatches[0]] : []);
      } else if (allMatches.length > 0) {
        matchedItems = [allMatches[0]];
      }
    }

    if (matchedItems.length === 0) {
      return { ok: false, error: 'Nenhuma despesa/receita fixa encontrada com essa descrição ou ID.' };
    }

    const deletedFixedRecords = [];
    const deletedLinkedTxs = [];
    const alsoDeletePendingTx = args.also_delete_current_month_tx !== false;

    for (const item of matchedItems) {
      deletedFixedRecords.push({ ...item });
      await db.deleteRows('fixed_items', { id: `eq.${item.id}` });
      notifyMutation('fixed_items', 'delete', { id: item.id });

      if (alsoDeletePendingTx) {
        const rTag = `[R:${item.id}]`;
        const linkedPending = transactions.filter(t => t.is_effective === false && String(t.description || '').includes(rTag));
        for (const ptx of linkedPending) {
          deletedLinkedTxs.push({ ...ptx });
          await db.deleteRows('transactions', { id: `eq.${ptx.id}` });
          notifyMutation('transactions', 'delete', { id: ptx.id });
        }
      }
    }

    const namesList = deletedFixedRecords.map(f => `"${f.description}" (${formatBRL(f.amount)} - dia ${f.day_of_month})`).join(', ');
    const txRemovedNote = deletedLinkedTxs.length > 0
      ? ` e ${deletedLinkedTxs.length} lançamento(s) pendente(s) vinculado(s) deste mês também removido(s)`
      : '';
    const summary = `Recorrência(s) fixa(s) cancelada(s)/excluída(s) permanentemente: ${namesList}${txRemovedNote}.`;

    const logInserted = await db.insertRows('morgan_action_logs', {
      action_type: 'delete_fixed_item',
      status: 'executed',
      channel,
      chat_id: String(chatId),
      summary,
      payload_json: { toolName, args },
      undo_snapshot_json: {
        type: 'delete_fixed_item',
        deletedFixedRecords,
        deletedLinkedTxs
      },
      executed_at: new Date().toISOString()
    });

    return {
      ok: true,
      status: 'executed',
      actionLogId: logInserted[0]?.id,
      canUndo: true,
      summary,
      deletedCount: deletedFixedRecords.length
    };
  }

  // --------------------------------------------------------------------------
  // 7D. MANAGE ENTITY (Administração Geral de Contas Bancárias, Cartões de Crédito e Categorias)
  // --------------------------------------------------------------------------
  if (toolName === 'manage_entity') {
    const entityType = normalizeStr(args.entity_type || '');
    const op = normalizeStr(args.operation || 'update'); // 'create', 'update', 'delete'

    if (entityType.includes('card') || entityType.includes('cartao')) {
      if (op === 'create') {
        const acc = resolveEntityByNameOrId(accounts, args.account_name || args.account_id, true);
        const inserted = await db.insertRows('cards', {
          name: String(args.name || 'Novo Cartão').trim(),
          closing_day: Math.min(31, Math.max(1, parseInt(args.closing_day || 1, 10))),
          due_day: Math.min(31, Math.max(1, parseInt(args.due_day || 10, 10))),
          account_id: acc ? acc.id : (accounts[0]?.id || 6)
        });
        notifyMutation('cards', 'insert', inserted[0]);
        return {
          ok: true,
          status: 'executed',
          summary: `Cartão de crédito "${inserted[0].name}" (Fechamento dia ${inserted[0].closing_day}, Vencimento dia ${inserted[0].due_day}) cadastrado com sucesso!`
        };
      }
      const targetCard = resolveEntityByNameOrId(cards, args.entity_id || args.name || args.search_name, false);
      if (!targetCard) return { ok: false, error: 'Cartão não localizado.' };
      if (op === 'delete') {
        await db.deleteRows('cards', { id: `eq.${targetCard.id}` });
        notifyMutation('cards', 'delete', { id: targetCard.id });
        return { ok: true, status: 'executed', summary: `Cartão "${targetCard.name}" excluído com sucesso.` };
      }
      const patch = {};
      if (args.new_name) patch.name = String(args.new_name).trim();
      if (args.closing_day) patch.closing_day = Math.min(31, Math.max(1, parseInt(args.closing_day, 10)));
      if (args.due_day) patch.due_day = Math.min(31, Math.max(1, parseInt(args.due_day, 10)));
      if (args.account_name || args.account_id) {
        const acc = resolveEntityByNameOrId(accounts, args.account_name || args.account_id, false);
        if (acc) patch.account_id = acc.id;
      }
      await db.updateRows('cards', patch, { id: `eq.${targetCard.id}` });
      notifyMutation('cards', 'update', { id: targetCard.id, ...patch });
      return {
        ok: true,
        status: 'executed',
        summary: `Cartão "${patch.name || targetCard.name}" atualizado (Fechamento: dia ${patch.closing_day || targetCard.closing_day} | Vencimento: dia ${patch.due_day || targetCard.due_day}).`
      };
    }

    if (entityType.includes('account') || entityType.includes('conta')) {
      if (op === 'create') {
        const inserted = await db.insertRows('accounts', {
          name: String(args.name || 'Nova Conta').trim(),
          balance: Number(parseFloat(args.balance || 0).toFixed(2))
        });
        notifyMutation('accounts', 'insert', inserted[0]);
        return {
          ok: true,
          status: 'executed',
          summary: `Conta bancária "${inserted[0].name}" cadastrada com saldo inicial de ${formatBRL(inserted[0].balance)}.`
        };
      }
      const targetAcc = resolveEntityByNameOrId(accounts, args.entity_id || args.name || args.search_name, false);
      if (!targetAcc) return { ok: false, error: 'Conta bancária não localizada.' };
      if (op === 'delete') {
        await db.deleteRows('accounts', { id: `eq.${targetAcc.id}` });
        notifyMutation('accounts', 'delete', { id: targetAcc.id });
        return { ok: true, status: 'executed', summary: `Conta bancária "${targetAcc.name}" excluída com sucesso.` };
      }
      const patch = {};
      if (args.new_name) patch.name = String(args.new_name).trim();
      if (args.balance !== undefined) patch.balance = Number(parseFloat(args.balance).toFixed(2));
      await db.updateRows('accounts', patch, { id: `eq.${targetAcc.id}` });
      notifyMutation('accounts', 'update', { id: targetAcc.id, ...patch });
      return {
        ok: true,
        status: 'executed',
        summary: `Conta bancária "${patch.name || targetAcc.name}" atualizada com sucesso (Saldo: ${formatBRL(patch.balance !== undefined ? patch.balance : targetAcc.balance)}).`
      };
    }

    if (entityType.includes('categor')) {
      if (op === 'create') {
        const inserted = await db.insertRows('categories', {
          name: String(args.name || 'Nova Categoria').trim(),
          icon: args.icon || 'tag',
          color: args.color || '#8b5cf6'
        });
        notifyMutation('categories', 'insert', inserted[0]);
        return {
          ok: true,
          status: 'executed',
          summary: `Categoria "${inserted[0].name}" criada com sucesso!`
        };
      }
      const targetCat = resolveEntityByNameOrId(categories, args.entity_id || args.name || args.search_name, false);
      if (!targetCat) return { ok: false, error: 'Categoria não localizada.' };
      if (op === 'delete') {
        await db.deleteRows('categories', { id: `eq.${targetCat.id}` });
        notifyMutation('categories', 'delete', { id: targetCat.id });
        return { ok: true, status: 'executed', summary: `Categoria "${targetCat.name}" excluída com sucesso.` };
      }
      const patch = {};
      if (args.new_name) patch.name = String(args.new_name).trim();
      if (args.color) patch.color = args.color;
      if (args.icon) patch.icon = args.icon;
      await db.updateRows('categories', patch, { id: `eq.${targetCat.id}` });
      notifyMutation('categories', 'update', { id: targetCat.id, ...patch });
      return {
        ok: true,
        status: 'executed',
        summary: `Categoria "${patch.name || targetCat.name}" atualizada com sucesso.`
      };
    }

    return { ok: false, error: 'Tipo de entidade inválido para manage_entity (use account, card ou category).' };
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
      const txRestore = { is_effective: snap.previousEffective };
      if (snap.previousAmount !== undefined) txRestore.amount = snap.previousAmount;
      await db.updateRows('transactions', txRestore, { id: `eq.${snap.txId}` });
      notifyMutation('transactions', 'update', { id: snap.txId });
    }
    if (snap.accountId && snap.accountBalanceBefore !== null) {
      await db.updateRows('accounts', { balance: snap.accountBalanceBefore }, { id: `eq.${snap.accountId}` });
      notifyMutation('accounts', 'update', { id: snap.accountId });
    }
  } else if (snap.type === 'update_transaction') {
    if (snap.txId && snap.previousTx) {
      await db.updateRows('transactions', snap.previousTx, { id: `eq.${snap.txId}` });
      notifyMutation('transactions', 'update', { id: snap.txId });
    }
    if (snap.oldAccId && snap.oldAccBalance !== null && snap.oldAccBalance !== undefined) {
      await db.updateRows('accounts', { balance: snap.oldAccBalance }, { id: `eq.${snap.oldAccId}` });
    }
    if (snap.oldDestAccId && snap.oldDestAccBalance !== null && snap.oldDestAccBalance !== undefined) {
      await db.updateRows('accounts', { balance: snap.oldDestAccBalance }, { id: `eq.${snap.oldDestAccId}` });
    }
    notifyMutation('accounts', 'update', {});
  } else if (snap.type === 'delete_transaction') {
    if (snap.dismissedRecurrence && snap.dismissedRecurrence.id) {
      await db.deleteRows('dismissed_recurrences', { id: `eq.${snap.dismissedRecurrence.id}` });
      notifyMutation('dismissed_recurrences', 'delete', { id: snap.dismissedRecurrence.id });
    }
    if (snap.deletedTx) {
      await db.insertRows('transactions', snap.deletedTx);
      notifyMutation('transactions', 'insert', snap.deletedTx);
    }
    if (snap.deletedFixedItem) {
      await db.insertRows('fixed_items', snap.deletedFixedItem);
      notifyMutation('fixed_items', 'insert', snap.deletedFixedItem);
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
  } else if (snap.type === 'update_fixed_item') {
    if (snap.fixedItemId && snap.previousFixed) {
      await db.updateRows('fixed_items', snap.previousFixed, { id: `eq.${snap.fixedItemId}` });
      notifyMutation('fixed_items', 'update', { id: snap.fixedItemId });
    }
  } else if (snap.type === 'delete_fixed_item') {
    if (Array.isArray(snap.deletedFixedRecords)) {
      for (const fRec of snap.deletedFixedRecords) {
        await db.insertRows('fixed_items', fRec);
      }
      notifyMutation('fixed_items', 'insert', {});
    }
    if (Array.isArray(snap.deletedLinkedTxs)) {
      for (const tRec of snap.deletedLinkedTxs) {
        await db.insertRows('transactions', tRec);
      }
      notifyMutation('transactions', 'insert', {});
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

  const curForecast = ctx.raw && ctx.raw.forecast ? ctx.raw.forecast[0] : null;
  const varExpenses = curForecast ? (curForecast.variableExpenses || 0) : 0;
  const breakdownParts = [];
  if (curForecast) {
    if (curForecast.fixedExpensesTotal > 0) breakdownParts.push(`Fixas: ${formatBRL(curForecast.fixedExpensesTotal)}`);
    if (curForecast.cardsTotal > 0) breakdownParts.push(`Cartões: ${formatBRL(curForecast.cardsTotal)}`);
    if (varExpenses > 0) breakdownParts.push(`Débito/Pix no Mês: ${formatBRL(varExpenses)}`);
  }
  const breakdownStr = breakdownParts.length > 0 ? `\n  *(${breakdownParts.join(' | ')})*` : '';

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
• Saídas Consolidadas: ${formatBRL(health.monthlyExpenses)}${breakdownStr}
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
