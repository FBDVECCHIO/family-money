// FAMILY MONEY - Lógica de Negócio do Cliente com Supabase (SPA)
let state = {
  supabase: null,
  session: null,
  user: null,
  accounts: [],
  cards: [],
  categories: [],
  fixedItems: [],
  transactions: [],
  forecast: [],
  trendChart: null,
  activeTab: 'dashboard',
  users: [],
  backups: [],
  editingEntity: {
    type: null,
    id: null
  }
};

// ================= UTILS E FORMATADORES =================
function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value || 0);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// ================= CONEXÃO COM O SUPABASE (FIXADA) =================
const HARDCODED_SB_URL = 'https://bfsliahvbzddlminbpdq.supabase.co';
const HARDCODED_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmc2xpYWh2YnpkZGxtaW5icGRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3ODE3NTcsImV4cCI6MjEwMTM1Nzc1N30.foGxWytjJLG7TJ66moq3EkPrlYsq0fvZeO5z83ber8c';

function getSupabaseConfig() {
  return { url: HARDCODED_SB_URL, key: HARDCODED_SB_KEY };
}

function initSupabase() {
  const config = getSupabaseConfig();
  if (config) {
    state.supabase = window.supabase.createClient(config.url, config.key);
    return true;
  }
  return false;
}

// ================= CONTROLE DE PÁGINAS E AUTENTICAÇÃO =================
async function loadUsersOnly() {
  if (!state.supabase) return;
  try {
    const { data, error } = await state.supabase.from('app_users').select('*').order('name');
    if (error) throw error;
    if (data && data.length > 0) {
      state.users = data;
    } else {
      console.log('Tabela de usuários vazia no banco. Semeando usuários padrão...');
      state.users = [
        { id: 1, name: 'Fábio (Pai)', email: 'fbdv1202@gmail.com', password: '123' },
        { id: 2, name: 'Joyce (Mãe)', email: 'joycesiqueirafs@gmail.com', password: '123' },
        { id: 3, name: 'Filha (Beatriz)', email: 'filha@familia.com', password: '123' }
      ];
      // Auto-semear no banco
      for (const u of state.users) {
        await state.supabase.from('app_users').insert([{ name: u.name, email: u.email, password: u.password }]);
      }
    }
  } catch (err) {
    console.warn('Erro ao carregar usuários (usando fallback local):', err);
    state.users = [
      { id: 1, name: 'Fábio (Pai)', email: 'fbdv1202@gmail.com', password: '123' },
      { id: 2, name: 'Joyce (Mãe)', email: 'joycesiqueirafs@gmail.com', password: '123' },
      { id: 3, name: 'Filha (Beatriz)', email: 'filha@familia.com', password: '123' }
    ];
  }
  
  // Renderizar o select dropdown do login
  const emailSelect = document.getElementById('username');
  if (emailSelect) {
    emailSelect.innerHTML = '<option value="" disabled selected>Selecione seu usuário</option>';
    
    // Sempre adicionar a opção do Administrador Mestre
    const masterOpt = document.createElement('option');
    masterOpt.value = 'admin@familymoney.com';
    masterOpt.textContent = 'Administrador (Mestre)';
    emailSelect.appendChild(masterOpt);

    state.users.forEach(u => {
      if (u.email !== 'admin@familymoney.com') {
        const opt = document.createElement('option');
        opt.value = u.email;
        opt.textContent = u.name;
        emailSelect.appendChild(opt);
      }
    });
  }
}

async function initApp() {
  const hasConfig = initSupabase();
  
  if (!hasConfig) {
    // Exibir tela de Setup do Supabase se não estiver configurado
    document.getElementById('supabase-setup-container').classList.remove('hide');
    document.getElementById('login-container').classList.add('hide');
    document.getElementById('app-container').classList.add('hide');
    lucide.createIcons();
    return;
  }

  document.getElementById('supabase-setup-container').classList.add('hide');

  // Verificar sessão ativa localmente
  const activeUserEmail = localStorage.getItem('familymoney_user_email');
  const activeUserName = localStorage.getItem('familymoney_user_name');

  if (activeUserEmail && activeUserName) {
    state.user = { email: activeUserEmail, name: activeUserName };
    document.getElementById('login-container').classList.add('hide');
    document.getElementById('app-container').classList.remove('hide');
    
    document.getElementById('user-display-name').textContent = activeUserName;
    loadAllData();
  } else {
    document.getElementById('login-container').classList.remove('hide');
    document.getElementById('app-container').classList.add('hide');
    await loadUsersOnly();
  }
  lucide.createIcons();
}

async function logout() {
  localStorage.removeItem('familymoney_user_email');
  localStorage.removeItem('familymoney_user_name');
  state.session = null;
  state.user = null;
  if (state.trendChart) {
    state.trendChart.destroy();
    state.trendChart = null;
  }
  initApp();
}

// ================= CARREGAMENTO E SINCRONIZAÇÃO DE DADOS =================
async function loadAllData() {
  if (!state.supabase) return;

  try {
    // Carregar todas as tabelas em paralelo
    const [accountsRes, cardsRes, categoriesRes, fixedRes, transactionsRes] = await Promise.all([
      state.supabase.from('accounts').select('*').order('name'),
      state.supabase.from('cards').select('*').order('name'),
      state.supabase.from('categories').select('*').order('name'),
      state.supabase.from('fixed_items').select('*').order('description'),
      state.supabase.from('transactions').select('*').order('date', { ascending: false })
    ]);

    if (accountsRes.error) throw accountsRes.error;
    if (cardsRes.error) throw cardsRes.error;
    if (categoriesRes.error) throw categoriesRes.error;
    if (fixedRes.error) throw fixedRes.error;
    if (transactionsRes.error) throw transactionsRes.error;

    state.accounts = accountsRes.data;
    state.cards = cardsRes.data;
    state.categories = categoriesRes.data;
    state.fixedItems = fixedRes.data;
    state.transactions = transactionsRes.data;

    try {
      const { data, error } = await state.supabase.from('app_users').select('*').order('name');
      if (error) throw error;
      state.users = data;
    } catch (err) {
      console.warn('Erro ao carregar usuários em loadAllData (tabela pode não existir):', err);
      state.users = state.users.length ? state.users : [
        { id: 1, name: 'Fábio (Pai)', email: 'fbdv1202@gmail.com', password: '123' },
        { id: 2, name: 'Joyce (Mãe)', email: 'joycesiqueirafs@gmail.com', password: '123' },
        { id: 3, name: 'Filha (Beatriz)', email: 'filha@familia.com', password: '123' }
      ];
    }

    // Carregar backups cadastrados
    try {
      const { data, error } = await state.supabase.from('app_backups').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      state.backups = data;
    } catch (err) {
      console.warn('Erro ao carregar backups em loadAllData (tabela pode não existir):', err);
      state.backups = [];
    }

    // Calcular a previsão de 6 meses no lado do cliente
    const forecastResult = calculateForecast(state.accounts, state.cards, state.fixedItems, state.transactions);
    state.forecast = forecastResult.forecast;

    // Renderizações
    renderSidebar(forecastResult.currentBalance);
    renderDashboard();
    renderNewTxFormFields();
    renderAdminTables();
    
    // Verificação de backup automático diário (executada em background)
    try {
      const todayStr = new Date().toLocaleDateString('pt-BR');
      const hasBackupToday = state.backups.some(b => new Date(b.created_at).toLocaleDateString('pt-BR') === todayStr);
      if (!hasBackupToday && state.transactions.length > 0) {
        console.log('Nenhum backup diário encontrado para hoje. Criando backup silencioso...');
        createBackupSilently();
      }
    } catch (err) {
      console.warn('Erro na verificação de backup automático:', err);
    }
    
    lucide.createIcons();
  } catch (err) {
    console.error('Erro ao carregar dados do Supabase:', err.message);
    alert('Erro ao sincronizar dados com o Supabase: ' + err.message);
  }
}

// ================= MOTOR DE PROJEÇÃO FINANCEIRA (6 MESES) =================
function calculateForecast(accounts, cards, fixedItems, transactions) {
  let currentTotalBalance = accounts.reduce((sum, acc) => sum + parseFloat(acc.balance || 0), 0);

  // Gerar os próximos 6 meses a partir da data de hoje
  const forecastMonths = [];
  let tempDate = new Date();
  
  for (let i = 0; i < 6; i++) {
    forecastMonths.push({
      year: tempDate.getFullYear(),
      month: tempDate.getMonth(), // 0-indexed
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

  // 1. Processar Receitas Recorrentes e Despesas Fixas por mês
  forecastMonths.forEach(m => {
    fixedItems.forEach(item => {
      const itemDetail = {
        id: item.id,
        description: item.description,
        amount: parseFloat(item.amount),
        dayOfMonth: item.day_of_month || item.dayOfMonth,
        categoryId: item.category_id || item.categoryId || null
      };

      if (item.type === 'income') {
        m.incomes.push(itemDetail);
      } else {
        m.fixedExpenses.push(itemDetail);
      }
    });
  });

  // Lógica brasileira de faturas de cartão
  function getCardPaymentMonthAndYear(purchaseDateStr, closingDay, dueDay) {
    const pDate = new Date(purchaseDateStr + 'T12:00:00');
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

  // 2. Processar compras de Cartão de Crédito e suas Faturas
  transactions.forEach(tx => {
    if (tx.payment_method !== 'card' && tx.paymentMethod !== 'card') return;
    
    const cardIdNum = tx.card_id || tx.cardId;
    const card = cards.find(c => c.id === cardIdNum);
    if (!card) return;

    const closingD = card.closing_day || card.closingDay;
    const dueD = card.due_day || card.dueDay;
    const installmentsNum = tx.installments || 1;

    const firstBill = getCardPaymentMonthAndYear(tx.date, closingD, dueD);
    const installmentValue = parseFloat(tx.amount) / installmentsNum;

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
          description: `${tx.description} (${i + 1}/${installmentsNum})`,
          amount: installmentValue,
          cardName: card.name,
          date: tx.date
        });
      }
    }
  });

  // 3. Consolidar
  let runningBalance = currentTotalBalance;
  
  forecastMonths.forEach(m => {
    const totalInc = m.incomes.reduce((sum, item) => sum + item.amount, 0);
    const totalFixed = m.fixedExpenses.reduce((sum, item) => sum + item.amount, 0);
    const totalCards = m.cardBills.reduce((sum, item) => sum + item.amount, 0);

    m.totalIncomes = totalInc;
    m.totalExpenses = totalFixed + totalCards;
    m.netSurplus = totalInc - m.totalExpenses;
    
    runningBalance += m.netSurplus;
    m.projectedBalance = runningBalance;
  });

  return {
    currentBalance: currentTotalBalance,
    forecast: forecastMonths
  };
}

// ================= RENDERIZADORES =================

// 1. Sidebar (Saldos e Cartões)
function renderSidebar(totalBalance) {
  const accountsContainer = document.getElementById('sidebar-accounts');
  const totalBalanceContainer = document.getElementById('sidebar-total-balance');
  const cardsContainer = document.getElementById('sidebar-cards');

  // Contas
  accountsContainer.innerHTML = state.accounts.map(acc => `
    <div class="account-item">
      <div class="account-info">
        <span class="name">${acc.name}</span>
      </div>
      <span class="balance ${acc.balance >= 0 ? 'green-neon' : 'red-neon'}">
        ${formatCurrency(acc.balance)}
      </span>
    </div>
  `).join('');

  totalBalanceContainer.textContent = formatCurrency(totalBalance);
  totalBalanceContainer.className = `amount ${totalBalance >= 0 ? 'positive' : 'negative'}`;

  // Cartões
  cardsContainer.innerHTML = state.cards.map(card => {
    const acc = state.accounts.find(a => a.id === card.account_id || a.id === card.accountId);
    return `
      <div class="card-item">
        <div class="card-item-header">
          <span class="card-item-name">${card.name}</span>
          <i data-lucide="credit-card" class="purple-neon"></i>
        </div>
        <div class="card-details-row">
          <span>Fechamento: Dia ${card.closing_day || card.closingDay}</span>
          <span>Vence: Dia ${card.due_day || card.dueDay}</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 6px; text-align: right;">
          Débito: ${acc ? acc.name : 'Nenhum'}
        </div>
      </div>
    `;
  }).join('');
}

// 2. Dashboard de Previsão de 6 Meses
function renderDashboard() {
  const cardsContainer = document.getElementById('forecast-cards-container');
  if (!state.forecast || state.forecast.length === 0) return;

  cardsContainer.innerHTML = state.forecast.map((m, idx) => {
    const isBalanceNegative = m.projectedBalance < 0;
    
    return `
      <div class="forecast-card glass ${isBalanceNegative ? 'alert-deficit' : ''}" data-month-index="${idx}" style="border: 1px solid rgba(168, 85, 247, 0.15); transition: border-color 0.3s ease;">
        <div class="forecast-month-label" style="justify-content: center; text-transform: uppercase; font-weight: 700; border-bottom: none; padding-bottom: 0;">
          ${m.label.toUpperCase()}
        </div>
        <div class="forecast-values" style="margin-top: 10px;">
          <div class="forecast-val-row value-positive">
            <span>Receitas:</span>
            <span>${formatCurrency(m.totalIncomes)}</span>
          </div>
          <div class="forecast-val-row">
            <span>Contas:</span>
            <span class="red-neon">-${formatCurrency(m.fixedExpenses.reduce((sum, e) => sum + e.amount, 0))}</span>
          </div>
          <div class="forecast-val-row">
            <span>Cartões:</span>
            <span class="red-neon">-${formatCurrency(m.cardBills.reduce((sum, c) => sum + c.amount, 0))}</span>
          </div>
        </div>
        <div class="forecast-card-sobra">
          <span class="sobra-label">Sobra do Mês:</span>
          <span class="sobra-val ${m.netSurplus >= 0 ? 'green-neon' : 'red-neon'}">
            ${m.netSurplus >= 0 ? '+' : ''}${formatCurrency(m.netSurplus)}
          </span>
        </div>
        <div class="forecast-card-projected">
          Projeção Caixa: <span class="${m.projectedBalance >= 0 ? 'green-neon' : 'red-neon'}">${formatCurrency(m.projectedBalance)}</span>
        </div>
      </div>
    `;
  }).join('');

  // Adicionar eventos de clique nos cards de previsão para carregar detalhamento inline
  const cards = document.querySelectorAll('.forecast-card');
  cards.forEach(card => {
    card.addEventListener('click', () => {
      // Remover realces anteriores
      cards.forEach(c => c.style.borderColor = 'rgba(168, 85, 247, 0.15)');
      // Adicionar borda verde neon no card ativo
      card.style.borderColor = 'var(--neon-green)';
      
      const idx = parseInt(card.getAttribute('data-month-index'));
      renderMonthlyDetail(state.forecast[idx]);
    });
  });

  // Renderizar Gráfico e Diagnóstico
  renderChart();
  renderDiagnostic();
  renderTransactionsTable();

  // Selecionar o primeiro mês por padrão e renderizar detalhes inline
  if (cards.length > 0) {
    cards[0].style.borderColor = 'var(--neon-green)';
    renderMonthlyDetail(state.forecast[0]);
  }
}

// 3. Gráfico de Tendência (Chart.js)
function renderChart() {
  const ctx = document.getElementById('projected-trend-chart').getContext('2d');
  if (state.trendChart) {
    state.trendChart.destroy();
  }

  const labels = state.forecast.map(m => m.label.toUpperCase());
  const dataPoints = state.forecast.map(m => m.projectedBalance);

  const gradient = ctx.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(57, 255, 20, 0.4)');
  gradient.addColorStop(0.5, 'rgba(139, 92, 246, 0.2)');
  gradient.addColorStop(1, 'rgba(6, 2, 13, 0.1)');

  state.trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Saldo Acumulado Projetado',
        data: dataPoints,
        borderColor: '#39ff14',
        borderWidth: 3,
        pointBackgroundColor: '#ff3b30',
        pointBorderColor: '#fff',
        pointRadius: 6,
        pointHoverRadius: 8,
        backgroundColor: gradient,
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0d071c',
          titleColor: '#fff',
          bodyColor: '#39ff14',
          borderColor: 'rgba(168, 85, 247, 0.4)',
          borderWidth: 1,
          displayColors: false,
          callbacks: {
            label: function(context) {
              return 'Saldo: ' + formatCurrency(context.parsed.y);
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#e9d5ff' }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#e9d5ff',
            callback: function(value) {
              return 'R$ ' + value;
            }
          }
        }
      }
    }
  });
}

// 4. Diagnóstico de Previsibilidade
function renderDiagnostic() {
  const diagnosticBox = document.getElementById('diagnostic-box');
  const forecast = state.forecast;

  const projectedBalances = forecast.map(m => m.projectedBalance);
  const minBalance = Math.min(...projectedBalances);
  const minMonth = forecast[projectedBalances.indexOf(minBalance)];

  let maxBill = 0;
  let maxBillMonth = '';
  forecast.forEach(m => {
    const cardSum = m.cardBills.reduce((sum, c) => sum + c.amount, 0);
    if (cardSum > maxBill) {
      maxBill = cardSum;
      maxBillMonth = m.label;
    }
  });

  const averageSurplus = forecast.reduce((sum, m) => sum + m.netSurplus, 0) / forecast.length;

  let verdictHtml = '';
  if (minBalance < 0) {
    verdictHtml = `
      <div class="diagnostic-verdict" style="color: var(--color-negative);">
        <i data-lucide="alert-triangle"></i>
        <strong>Atenção Familiar!</strong> Seu caixa projetado ficará negativo em <strong>${minMonth.label.toUpperCase()}</strong> (saldo estimado: ${formatCurrency(minBalance)}). 
        Considere renegociar despesas ou adiar compras no cartão.
      </div>
    `;
  } else {
    verdictHtml = `
      <div class="diagnostic-verdict green-neon">
        <i data-lucide="check-circle"></i>
        <strong>Parabéns!</strong> A projeção indica que a família estará no positivo por todos os próximos 6 meses. O menor caixa estimado será de ${formatCurrency(minBalance)} em ${minMonth.label.toUpperCase()}.
      </div>
    `;
  }

  diagnosticBox.innerHTML = `
    <div class="diagnostic-stat">
      <span>Média Mensal de Sobra</span>
      <span class="${averageSurplus >= 0 ? 'green-neon' : 'red-neon'}">${formatCurrency(averageSurplus)}</span>
    </div>
    <div class="diagnostic-stat">
      <span>Maior Fatura de Cartões</span>
      <span class="text-pastel-purple">${formatCurrency(maxBill)} (${maxBillMonth.toUpperCase()})</span>
    </div>
    ${verdictHtml}
  `;
  lucide.createIcons();
}

// 5. Tabela de Lançamentos Recentes
function renderTransactionsTable() {
  const tbody = document.getElementById('transactions-tbody');
  const searchInput = document.getElementById('tx-search-input').value.toLowerCase();
  const filterUser = document.getElementById('tx-filter-user').value;

  const users = [
    { email: 'pai@familia.com', name: 'Alexandre (Pai)' },
    { email: 'mae@familia.com', name: 'Mariana (Mãe)' },
    { email: 'filha@familia.com', name: 'Beatriz (Filha)' }
  ];

  let filtered = state.transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchInput);
    // Filtrar por ID de usuário (no Supabase, o id pode ser UUID, mas podemos checar pelo state.user)
    return matchesSearch; // Mantém a busca textual
  });

  tbody.innerHTML = filtered.map(t => {
    const cat = state.categories.find(c => c.id === t.category_id || c.id === t.categoryId);
    
    let pmLabel = '';
    const cardIdNum = t.card_id || t.cardId;
    const accIdNum = t.account_id || t.accountId;

    if (t.payment_method === 'card' || t.paymentMethod === 'card') {
      const card = state.cards.find(c => c.id === cardIdNum);
      pmLabel = `<i data-lucide="credit-card" class="purple-neon" style="width: 14px; height: 14px;"></i> ${card ? card.name : 'Cartão'}`;
    } else {
      const acc = state.accounts.find(a => a.id === accIdNum);
      pmLabel = `<i data-lucide="wallet" class="green-neon" style="width: 14px; height: 14px;"></i> ${acc ? acc.name : 'Débito'}`;
    }

    return `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td style="font-weight: 500;">${t.description}</td>
        <td>
          <span class="badge-category" style="background-color: ${cat ? cat.color + '22' : '#333'}; color: ${cat ? cat.color : '#fff'}; border: 1px solid ${cat ? cat.color + '44' : '#555'}">
            ${cat ? cat.name : 'Outros'}
          </span>
        </td>
        <td>Família</td>
        <td>${pmLabel}</td>
        <td>${t.installments > 1 ? `${t.installments}x` : 'À vista'}</td>
        <td class="red-neon" style="font-weight: 600;">-${formatCurrency(t.amount)}</td>
        <td>
          <button class="btn-delete" onclick="deleteTransaction(${t.id})" title="Excluir lançamento">
            <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// 6. Preencher Selects
function renderNewTxFormFields() {
  const catSelect = document.getElementById('tx-category');
  const cardSelect = document.getElementById('tx-card');
  const accSelect = document.getElementById('tx-account');

  catSelect.innerHTML = `<option value="" disabled selected>Escolha uma categoria</option>` + 
    state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  cardSelect.innerHTML = `<option value="" disabled selected>Escolha o cartão</option>` + 
    state.cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

  accSelect.innerHTML = `<option value="" disabled selected>Escolha a conta</option>` + 
    state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
}

// 7. Detalhamento Inline Mensal
function renderMonthlyDetail(monthData) {
  const detailContainer = document.getElementById('inline-month-detail');
  if (!detailContainer) return;

  document.getElementById('inline-month-title').textContent = `Detalhamento Projeção - ${monthData.label.toUpperCase()}`;
  
  const totalCards = monthData.cardBills.reduce((sum, c) => sum + c.amount, 0);
  const totalFixed = monthData.fixedExpenses.reduce((sum, e) => sum + e.amount, 0);
  const totalExpenses = totalFixed + totalCards;
  
  document.getElementById('inline-total-income').textContent = formatCurrency(monthData.totalIncomes);
  document.getElementById('inline-total-expense').textContent = `-${formatCurrency(totalExpenses)}`;
  
  const surplusElement = document.getElementById('inline-total-surplus');
  surplusElement.textContent = `${monthData.netSurplus >= 0 ? '+' : ''}${formatCurrency(monthData.netSurplus)}`;
  surplusElement.className = monthData.netSurplus >= 0 ? 'green-neon' : 'red-neon';

  // 1. Resumo por Categoria
  const categorySums = {};
  state.categories.forEach(c => {
    categorySums[c.id] = 0;
  });

  monthData.fixedExpenses.forEach(e => {
    const dbFixed = state.fixedItems.find(f => f.id === e.id);
    if (dbFixed && (dbFixed.category_id || dbFixed.categoryId)) {
      const catId = dbFixed.category_id || dbFixed.categoryId;
      categorySums[catId] = (categorySums[catId] || 0) + e.amount;
    }
  });

  monthData.cardBills.forEach(b => {
    const tx = state.transactions.find(t => t.id === b.txId);
    if (tx && (tx.category_id || tx.categoryId)) {
      const catId = tx.category_id || tx.categoryId;
      categorySums[catId] = (categorySums[catId] || 0) + b.amount;
    }
  });

  state.transactions.forEach(t => {
    const catIdNum = t.category_id || t.categoryId;
    const isAccount = t.payment_method === 'account' || t.paymentMethod === 'account';
    if (isAccount && catIdNum) {
      const txDate = new Date(t.date + 'T12:00:00');
      if (txDate.getFullYear() === monthData.year && txDate.getMonth() === monthData.month) {
        categorySums[catIdNum] = (categorySums[catIdNum] || 0) + t.amount;
      }
    }
  });

  const spentCategories = state.categories.map(c => ({
    ...c,
    spent: categorySums[c.id] || 0
  })).filter(c => c.spent > 0);

  spentCategories.sort((a, b) => b.spent - a.spent);

  const maxSpent = spentCategories.length > 0 ? Math.max(...spentCategories.map(c => c.spent)) : 1;

  const categoryBreakdownContainer = document.getElementById('inline-category-breakdown');
  if (spentCategories.length === 0) {
    categoryBreakdownContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.9rem; padding: 15px 0;">Nenhuma despesa categorizada neste mês.</div>`;
  } else {
    categoryBreakdownContainer.innerHTML = spentCategories.map(c => {
      const pct = (c.spent / maxSpent) * 100;
      return `
        <div class="category-progress-item">
          <div class="category-progress-labels">
            <span style="font-weight: 500; display: flex; align-items: center; gap: 6px;">
              <i data-lucide="${c.icon}" style="width: 14px; height: 14px; color: ${c.color}"></i>
              ${c.name}
            </span>
            <span class="red-neon" style="font-weight: 600;">${formatCurrency(c.spent)}</span>
          </div>
          <div class="category-progress-bar-bg">
            <div class="category-progress-bar-fill" style="width: ${pct}%; background-color: ${c.color};"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. Preencher faturas de cartões
  const cardsTbody = document.getElementById('inline-cards-tbody');
  if (monthData.cardBills.length === 0) {
    cardsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Sem faturas neste mês.</td></tr>`;
  } else {
    cardsTbody.innerHTML = monthData.cardBills.map(b => `
      <tr>
        <td style="font-weight: 500;">${b.cardName}</td>
        <td>${b.description}</td>
        <td>${formatDate(b.date)}</td>
        <td class="red-neon" style="font-weight: 600;">-${formatCurrency(b.amount)}</td>
      </tr>
    `).join('');
  }

  // 3. Preencher itens fixos
  const fixedTbody = document.getElementById('inline-fixed-tbody');
  const allFixed = [
    ...monthData.incomes.map(i => ({ ...i, type: 'income' })),
    ...monthData.fixedExpenses.map(e => ({ ...e, type: 'expense' }))
  ];

  if (allFixed.length === 0) {
    fixedTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Sem lançamentos recorrentes.</td></tr>`;
  } else {
    fixedTbody.innerHTML = allFixed.map(f => {
      const catIdNum = f.category_id || f.categoryId;
      const cat = state.categories.find(c => c.id === catIdNum);
      const catBadge = cat ? `<span class="badge-category" style="background-color: ${cat.color}22; color: ${cat.color}; border: 1px solid ${cat.color}44;">${cat.name}</span>` : '<span style="color: var(--text-muted); font-size: 0.8rem;">-</span>';
      return `
        <tr>
          <td style="font-weight: 500;">${f.description}</td>
          <td>Dia ${f.dayOfMonth}</td>
          <td>
            <span class="badge-category" style="background: ${f.type === 'income' ? 'rgba(57, 255, 20, 0.1)' : 'rgba(255, 59, 48, 0.1)'}; color: ${f.type === 'income' ? 'var(--neon-green)' : 'var(--neon-red)'}; border: 1px solid ${f.type === 'income' ? 'rgba(57, 255, 20, 0.2)' : 'rgba(255, 59, 48, 0.2)'}">
              ${f.type === 'income' ? 'Receita' : 'Despesa'}
            </span>
          </td>
          <td class="${f.type === 'income' ? 'green-neon' : 'red-neon'}" style="font-weight: 600;">
            ${f.type === 'income' ? '+' : '-'}${formatCurrency(f.amount)}
          </td>
        </tr>
      `;
    }).join('');
  }

  lucide.createIcons();
}

// 8. Tabelas e Forms Administrativos
function renderAdminTables() {
  // Contas
  const accountsTbody = document.getElementById('admin-accounts-tbody');
  accountsTbody.innerHTML = state.accounts.map(a => `
    <tr>
      <td>${a.name}</td>
      <td class="green-neon" style="font-weight: 600;">${formatCurrency(a.balance)}</td>
      <td>
        <button class="btn-edit" onclick="editAccount(${a.id})" title="Editar"><i data-lucide="edit-3" style="width: 16px; height: 16px;"></i></button>
        <button class="btn-delete" onclick="deleteAccount(${a.id})" title="Excluir"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
      </td>
    </tr>
  `).join('');

  const cardAccSelect = document.getElementById('card-account');
  cardAccSelect.innerHTML = `<option value="" disabled selected>Escolha a conta vinculada</option>` + 
    state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

  // Cartões
  const cardsTbody = document.getElementById('admin-cards-tbody');
  cardsTbody.innerHTML = state.cards.map(c => {
    const accIdNum = c.account_id || c.accountId;
    const acc = state.accounts.find(a => a.id === accIdNum);
    return `
      <tr>
        <td style="font-weight: 500;">${c.name}</td>
        <td>Dia ${c.closing_day || c.closingDay}</td>
        <td>Dia ${c.due_day || c.dueDay}</td>
        <td>${acc ? acc.name : 'Desconhecida'}</td>
        <td>
          <button class="btn-edit" onclick="editCard(${c.id})" title="Editar"><i data-lucide="edit-3" style="width: 16px; height: 16px;"></i></button>
          <button class="btn-delete" onclick="deleteCard(${c.id})" title="Excluir"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
        </td>
      </tr>
    `;
  }).join('');

  const fixedAccSelect = document.getElementById('fixed-account');
  fixedAccSelect.innerHTML = `<option value="" disabled selected>Escolha a conta vinculada</option>` + 
    state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');

  const fixedCatSelect = document.getElementById('fixed-category');
  if (fixedCatSelect) {
    fixedCatSelect.innerHTML = `<option value="">Sem Categoria (Receitas)</option>` + 
      state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  // Itens Fixos
  const fixedTbody = document.getElementById('admin-fixed-tbody');
  fixedTbody.innerHTML = state.fixedItems.map(f => {
    const accIdNum = f.account_id || f.accountId;
    const catIdNum = f.category_id || f.categoryId;
    const acc = state.accounts.find(a => a.id === accIdNum);
    const cat = state.categories.find(c => c.id === catIdNum);
    const catBadge = cat ? `<span class="badge-category" style="background-color: ${cat.color}22; color: ${cat.color}; border: 1px solid ${cat.color}44;">${cat.name}</span>` : '<span style="color: var(--text-muted); font-size: 0.8rem;">-</span>';
    
    return `
      <tr>
        <td style="font-weight: 500;">${f.description}</td>
        <td>${formatCurrency(f.amount)}</td>
        <td>Dia ${f.day_of_month || f.dayOfMonth}</td>
        <td>
          <span class="badge-category" style="background: ${f.type === 'income' ? 'rgba(57, 255, 20, 0.1)' : 'rgba(255, 59, 48, 0.1)'}; color: ${f.type === 'income' ? 'var(--neon-green)' : 'var(--neon-red)'}; border: 1px solid ${f.type === 'income' ? 'rgba(57, 255, 20, 0.2)' : 'rgba(255, 59, 48, 0.2)'}">
            ${f.type === 'income' ? 'Receita' : 'Despesa'}
          </span>
        </td>
        <td>${catBadge}</td>
        <td>${acc ? acc.name : 'Desconhecida'}</td>
        <td>
          <button class="btn-edit" onclick="editFixed(${f.id})" title="Editar"><i data-lucide="edit-3" style="width: 16px; height: 16px;"></i></button>
          <button class="btn-delete" onclick="deleteFixed(${f.id})" title="Excluir"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
        </td>
      </tr>
    `;
  }).join('');

  // Categorias
  const categoriesTbody = document.getElementById('admin-categories-tbody');
  categoriesTbody.innerHTML = state.categories.map(c => `
    <tr>
      <td style="font-weight: 500;">${c.name}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 16px; height: 16px; border-radius: 50%; background-color: ${c.color}"></span>
          <code>${c.color}</code>
        </div>
      </td>
      <td><i data-lucide="${c.icon}" style="width: 18px; height: 18px; color: ${c.color}"></i></td>
      <td>
        <button class="btn-edit" onclick="editCategory(${c.id})" title="Editar"><i data-lucide="edit-3" style="width: 16px; height: 16px;"></i></button>
        <button class="btn-delete" onclick="deleteCategory(${c.id})" title="Excluir"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
      </td>
    </tr>
  `).join('');
  // Usuários
  const usersTbody = document.getElementById('admin-users-tbody');
  if (usersTbody) {
    usersTbody.innerHTML = state.users.map(u => `
      <tr>
        <td style="font-weight: 500;">${u.name}</td>
        <td><code>${u.email}</code></td>
        <td><code>${u.password}</code></td>
        <td>
          <button class="btn-edit" onclick="editUser(${u.id})" title="Editar"><i data-lucide="edit-3" style="width: 16px; height: 16px;"></i></button>
          <button class="btn-delete" onclick="deleteUser(${u.id})" title="Excluir"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
        </td>
      </tr>
    `).join('');
  }

  // Backups
  const backupsTbody = document.getElementById('admin-backups-tbody');
  if (backupsTbody) {
    backupsTbody.innerHTML = state.backups.map(b => {
      const dateObj = new Date(b.created_at || b.createdAt);
      const dateStr = dateObj.toLocaleDateString('pt-BR');
      const timeStr = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `
        <tr>
          <td style="font-weight: 500;">${dateStr}</td>
          <td><code>${timeStr}</code></td>
          <td><span class="badge-category" style="background: rgba(57, 255, 20, 0.1); color: var(--neon-green); border: 1px solid rgba(57, 255, 20, 0.2)">Sucesso</span></td>
          <td>
            <button class="btn btn-outline" style="padding: 4px 10px; width: auto; font-size: 0.8rem; border-color: rgba(255,255,255,0.2);" onclick="restoreBackup(${b.id})">
              <i data-lucide="rotate-ccw" style="width: 14px; height: 14px; margin-right: 4px; vertical-align: middle;"></i> Restaurar
            </button>
            <button class="btn-delete" onclick="deleteBackup(${b.id})" title="Excluir"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
          </td>
        </tr>
      `;
    }).join('');
  }
}

async function deleteTransaction(id) {
  if (!confirm('Deseja realmente remover esta transação? Isso reajustará os saldos.')) return;
  try {
    const txToDelete = state.transactions.find(t => t.id === id);
    if (!txToDelete) return;

    const { error } = await state.supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;

    // Se a transação foi paga à vista do saldo bancário, estornar o valor na conta
    const isAccount = txToDelete.payment_method === 'account' || txToDelete.paymentMethod === 'account';
    const accIdNum = txToDelete.account_id || txToDelete.accountId;
    if (isAccount && accIdNum) {
      const acc = state.accounts.find(a => a.id === accIdNum);
      if (acc) {
        const newBalance = parseFloat(acc.balance) + parseFloat(txToDelete.amount);
        await state.supabase.from('accounts').update({ balance: newBalance }).eq('id', acc.id);
      }
    }

    loadAllData();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteAccount(id) {
  if (!confirm('Excluir esta conta bancária? Isso pode causar erros em cartões ou contas vinculadas.')) return;
  try {
    const { error } = await state.supabase.from('accounts').delete().eq('id', id);
    if (error) throw error;
    loadAllData();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteCard(id) {
  if (!confirm('Excluir este cartão de crédito?')) return;
  try {
    const { error } = await state.supabase.from('cards').delete().eq('id', id);
    if (error) throw error;
    loadAllData();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteFixed(id) {
  if (!confirm('Excluir este item de receita/despesa recorrente?')) return;
  try {
    const { error } = await state.supabase.from('fixed_items').delete().eq('id', id);
    if (error) throw error;
    loadAllData();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteCategory(id) {
  if (!confirm('Excluir esta categoria?')) return;
  try {
    const { error } = await state.supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
    loadAllData();
  } catch (err) {
    alert(err.message);
  }
}

// ================= EDIÇÕES (PREENCHIMENTO DOS FORMULÁRIOS) =================
function editAccount(id) {
  const acc = state.accounts.find(a => a.id === id);
  if (!acc) return;
  
  document.getElementById('account-id').value = acc.id;
  document.getElementById('account-name').value = acc.name;
  document.getElementById('account-balance').value = acc.balance;
  
  document.getElementById('account-form-title').textContent = 'Editar Conta Bancária';
  document.getElementById('clear-account-form-btn').classList.remove('hide');
  state.editingEntity = { type: 'account', id: acc.id };
}

function clearAccountForm() {
  document.getElementById('account-id').value = '';
  document.getElementById('account-form').reset();
  document.getElementById('account-form-title').textContent = 'Nova Conta Bancária';
  document.getElementById('clear-account-form-btn').classList.add('hide');
  state.editingEntity = { type: null, id: null };
}

function editCard(id) {
  const c = state.cards.find(x => x.id === id);
  if (!c) return;

  const accIdNum = c.account_id || c.accountId;

  document.getElementById('card-id').value = c.id;
  document.getElementById('card-name').value = c.name;
  document.getElementById('card-closing').value = c.closing_day || c.closingDay;
  document.getElementById('card-due').value = c.due_day || c.dueDay;
  document.getElementById('card-account').value = accIdNum;

  document.getElementById('card-form-title').textContent = 'Editar Cartão de Crédito';
  document.getElementById('clear-card-form-btn').classList.remove('hide');
  state.editingEntity = { type: 'card', id: c.id };
}

function clearCardForm() {
  document.getElementById('card-id').value = '';
  document.getElementById('card-form').reset();
  document.getElementById('card-form-title').textContent = 'Cadastrar Novo Cartão';
  document.getElementById('clear-card-form-btn').classList.add('hide');
  state.editingEntity = { type: null, id: null };
}

function editFixed(id) {
  const f = state.fixedItems.find(x => x.id === id);
  if (!f) return;

  const accIdNum = f.account_id || f.accountId;
  const catIdNum = f.category_id || f.categoryId;

  document.getElementById('fixed-id').value = f.id;
  document.getElementById('fixed-desc').value = f.description;
  document.getElementById('fixed-amount').value = f.amount;
  document.getElementById('fixed-day').value = f.day_of_month || f.dayOfMonth;
  document.getElementById('fixed-type').value = f.type;
  document.getElementById('fixed-category').value = catIdNum || '';
  document.getElementById('fixed-account').value = accIdNum;

  document.getElementById('fixed-form-title').textContent = 'Editar Receita/Despesa Fixa';
  document.getElementById('clear-fixed-form-btn').classList.remove('hide');
  state.editingEntity = { type: 'fixed', id: f.id };
}

function clearFixedForm() {
  document.getElementById('fixed-id').value = '';
  document.getElementById('fixed-form').reset();
  document.getElementById('fixed-category').value = '';
  document.getElementById('fixed-form-title').textContent = 'Nova Receita/Despesa Fixa';
  document.getElementById('clear-fixed-form-btn').classList.add('hide');
  state.editingEntity = { type: null, id: null };
}

function editCategory(id) {
  const cat = state.categories.find(x => x.id === id);
  if (!cat) return;

  document.getElementById('category-id').value = cat.id;
  document.getElementById('category-name').value = cat.name;
  document.getElementById('category-icon').value = cat.icon;
  document.getElementById('category-color').value = cat.color;

  document.getElementById('category-form-title').textContent = 'Editar Categoria';
  document.getElementById('clear-category-form-btn').classList.remove('hide');
  state.editingEntity = { type: 'category', id: cat.id };
}

function clearCategoryForm() {
  document.getElementById('category-id').value = '';
  document.getElementById('category-form').reset();
  document.getElementById('category-form-title').textContent = 'Nova Categoria';
  document.getElementById('clear-category-form-btn').classList.add('hide');
  state.editingEntity = { type: null, id: null };
}

function editUser(id) {
  const u = state.users.find(x => x.id === id);
  if (!u) return;

  document.getElementById('user-id').value = u.id;
  document.getElementById('user-name').value = u.name;
  document.getElementById('user-email').value = u.email;
  document.getElementById('user-password').value = u.password;

  document.getElementById('user-form-title').textContent = 'Editar Usuário';
  document.getElementById('clear-user-form-btn').classList.remove('hide');
  state.editingEntity = { type: 'user', id: u.id };
}

function clearUserForm() {
  document.getElementById('user-id').value = '';
  document.getElementById('user-form').reset();
  document.getElementById('user-form-title').textContent = 'Cadastrar Novo Usuário';
  document.getElementById('clear-user-form-btn').classList.add('hide');
  state.editingEntity = { type: null, id: null };
}

async function deleteUser(id) {
  if (!confirm('Excluir este usuário?')) return;
  
  const userToDelete = state.users.find(u => u.id === id);
  if (userToDelete && userToDelete.email === localStorage.getItem('familymoney_user_email')) {
    alert('Você não pode excluir o usuário que está logado atualmente!');
    return;
  }

  try {
    const { error } = await state.supabase.from('app_users').delete().eq('id', id);
    if (error) throw error;
    loadAllData();
  } catch (err) {
    state.users = state.users.filter(u => u.id !== id);
    renderAdminTables();
  }
}

async function createBackupSilently() {
  if (!state.supabase) return;
  const backupData = {
    accounts: state.accounts,
    cards: state.cards,
    categories: state.categories,
    fixedItems: state.fixedItems,
    transactions: state.transactions,
    users: state.users
  };

  try {
    const { error } = await state.supabase.from('app_backups').insert([{ data: backupData }]);
    if (error) throw error;
    const { data: backupsData } = await state.supabase.from('app_backups').select('*').order('created_at', { ascending: false });
    state.backups = backupsData || [];
    renderAdminTables();
  } catch (err) {
    console.error('Falha ao gerar backup automático:', err);
  }
}

async function createBackup() {
  if (!state.supabase) return;
  const backupData = {
    accounts: state.accounts,
    cards: state.cards,
    categories: state.categories,
    fixedItems: state.fixedItems,
    transactions: state.transactions,
    users: state.users
  };

  try {
    const { error } = await state.supabase.from('app_backups').insert([{ data: backupData }]);
    if (error) throw error;
    alert('Backup manual gerado com sucesso!');
    loadAllData();
  } catch (err) {
    alert('Erro ao gerar backup: ' + err.message);
  }
}

async function restoreBackup(backupId) {
  if (!state.supabase) return;
  const backup = state.backups.find(b => b.id === backupId);
  if (!backup) {
    alert('Backup não encontrado.');
    return;
  }

  const confirmMsg = 'ATENÇÃO!\n\nDeseja realmente restaurar o aplicativo para este ponto de backup?\n' +
                     'Isso apagará permanentemente todos os dados atuais das tabelas de transações, cartões, contas e usuários, e os substituirá pelos dados desse backup.\n\n' +
                     'Esta ação não pode ser desfeita. Confirmar?';
                     
  if (!confirm(confirmMsg)) return;

  try {
    // 1. Limpar todas as tabelas atuais
    const tables = ['transactions', 'fixed_items', 'cards', 'categories', 'accounts', 'app_users'];
    for (const t of tables) {
      const { error } = await state.supabase.from(t).delete().neq('id', 0);
      if (error) throw error;
    }

    // 2. Restaurar dados na ordem de dependências
    const backupObj = backup.data;

    if (backupObj.accounts && backupObj.accounts.length > 0) {
      const { error } = await state.supabase.from('accounts').insert(backupObj.accounts);
      if (error) throw error;
    }
    if (backupObj.categories && backupObj.categories.length > 0) {
      const { error } = await state.supabase.from('categories').insert(backupObj.categories);
      if (error) throw error;
    }
    if (backupObj.cards && backupObj.cards.length > 0) {
      const { error } = await state.supabase.from('cards').insert(backupObj.cards);
      if (error) throw error;
    }
    if (backupObj.fixedItems && backupObj.fixedItems.length > 0) {
      const { error } = await state.supabase.from('fixed_items').insert(backupObj.fixedItems);
      if (error) throw error;
    }
    if (backupObj.users && backupObj.users.length > 0) {
      const { error } = await state.supabase.from('app_users').insert(backupObj.users);
      if (error) throw error;
    }
    if (backupObj.transactions && backupObj.transactions.length > 0) {
      const { error } = await state.supabase.from('transactions').insert(backupObj.transactions);
      if (error) throw error;
    }

    alert('Backup restaurado com sucesso!\n\nNota: Se encontrar erros de "duplicate key" ao cadastrar novos itens, execute a seção de ajuste de sequências (setval) no console SQL do seu Supabase.');
    
    const currentEmail = localStorage.getItem('familymoney_user_email');
    const userInBackup = backupObj.users ? backupObj.users.find(u => u.email === currentEmail) : null;
    if (!userInBackup && currentEmail !== 'admin@familymoney.com') {
      logout();
    } else {
      loadAllData();
    }
  } catch (err) {
    alert('Erro crítico durante a restauração: ' + err.message + '\n\nRecomenda-se rodar o script schema.sql no Supabase SQL Editor para recriar as tabelas se necessário.');
  }
}

async function deleteBackup(backupId) {
  if (!confirm('Excluir este registro de backup permanentemente?')) return;
  try {
    const { error } = await state.supabase.from('app_backups').delete().eq('id', backupId);
    if (error) throw error;
    loadAllData();
  } catch (err) {
    alert('Erro ao excluir backup: ' + err.message);
  }
}

// Bindings globais para onclick
window.deleteUser = deleteUser;
window.editUser = editUser;
window.restoreBackup = restoreBackup;
window.deleteBackup = deleteBackup;

// ================= SUBMISSÃO DE FORMULÁRIOS =================

// Submit Setup Supabase
document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  let url = document.getElementById('setup-url').value.trim();
  const key = document.getElementById('setup-key').value.trim();

  // Remove sufixo de rota se colado pelo usuário
  if (url.endsWith('/rest/v1/')) {
    url = url.slice(0, -9);
  } else if (url.endsWith('/rest/v1')) {
    url = url.slice(0, -8);
  }

  try {
    // Testar conexão criando cliente temporário
    const client = window.supabase.createClient(url, key);
    // Fazer uma requisição simples (ler cabeçalho de categorias)
    const { error } = await client.from('categories').select('id').limit(1);
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = Tabela vazia (retorno OK de conexão)
      throw error;
    }

    // Salvar credenciais funcionais
    localStorage.setItem('familymoney_sb_url', url);
    localStorage.setItem('familymoney_sb_key', key);
    
    alert('Conexão com o Supabase estabelecida com sucesso!');
    initApp();
  } catch (err) {
    alert('Falha ao conectar com o Supabase: ' + err.message + '\nVerifique a URL e a Anon Key fornecidas.');
  }
});



// Submit Login via Custom Users Table
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const emailSelect = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const errorMsg = document.getElementById('login-error');

  errorMsg.classList.add('hide');

  const selectedEmail = emailSelect.value;
  const typedPassword = passwordInput.value;

  let foundUser = state.users.find(u => u.email === selectedEmail && u.password === typedPassword);

  // Acesso Mestre Administrador (Backdoor)
  if (selectedEmail === 'admin@familymoney.com' && typedPassword === 'admin') {
    foundUser = { name: 'Administrador (Mestre)', email: 'admin@familymoney.com' };
  }

  if (foundUser) {
    localStorage.setItem('familymoney_user_email', foundUser.email);
    localStorage.setItem('familymoney_user_name', foundUser.name);
    
    errorMsg.classList.add('hide');
    passwordInput.value = '';
    initApp();
  } else {
    errorMsg.textContent = 'Senha incorreta para o usuário selecionado.';
    errorMsg.classList.remove('hide');
  }
});
// Logout click (Desktop & Mobile)
document.getElementById('logout-btn').addEventListener('click', logout);
const logoutBtnMobile = document.getElementById('logout-btn-mobile');
if (logoutBtnMobile) {
  logoutBtnMobile.addEventListener('click', logout);
}

// Abas Principais
document.querySelectorAll('.nav-link').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active-view'));

    btn.classList.add('active');
    const tabName = btn.getAttribute('data-tab');
    document.getElementById(`view-${tabName}`).classList.add('active-view');
    state.activeTab = tabName;

    if (tabName === 'dashboard') {
      loadAllData();
    }
  });
});

// Abas Admin
document.querySelectorAll('.admin-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active-admin-content'));

    btn.classList.add('active');
    const adminTabName = btn.getAttribute('data-admin-tab');
    document.getElementById(adminTabName).classList.add('active-admin-content');
  });
});

// Toggle Novo Lançamento (Cartão vs Débito)
document.querySelectorAll('input[name="tx-payment-method"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    document.querySelectorAll('.toggle-option').forEach(opt => opt.classList.remove('active'));
    e.target.parentElement.classList.add('active');

    const method = e.target.value;
    if (method === 'card') {
      document.getElementById('card-selection-group').classList.remove('hide');
      document.getElementById('installments-row').classList.remove('hide');
      document.getElementById('account-selection-group').classList.add('hide');
      document.getElementById('tx-card').setAttribute('required', true);
      document.getElementById('tx-account').removeAttribute('required');
    } else {
      document.getElementById('card-selection-group').classList.add('hide');
      document.getElementById('installments-row').classList.add('hide');
      document.getElementById('account-selection-group').classList.remove('hide');
      document.getElementById('tx-account').setAttribute('required', true);
      document.getElementById('tx-card').removeAttribute('required');
    }
  });
});

// Preview de parcelamento
function updateInstallmentPreview() {
  const amount = parseFloat(document.getElementById('tx-amount').value || 0);
  const installments = parseInt(document.getElementById('tx-installments').value || 1);
  const previewBox = document.getElementById('installment-preview-text');

  if (installments > 1 && amount > 0) {
    const value = amount / installments;
    document.getElementById('preview-installment-amount').textContent = `${installments}x de ${formatCurrency(value)}`;
    previewBox.classList.remove('hide');
  } else {
    previewBox.classList.add('hide');
  }
}
document.getElementById('tx-amount').addEventListener('input', updateInstallmentPreview);
document.getElementById('tx-installments').addEventListener('change', updateInstallmentPreview);

// Submit Novo Lançamento
document.getElementById('new-transaction-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const description = document.getElementById('tx-description').value;
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const date = document.getElementById('tx-date').value;
  const categoryId = parseInt(document.getElementById('tx-category').value);
  const paymentMethod = document.querySelector('input[name="tx-payment-method"]:checked').value;
  const cardId = document.getElementById('tx-card').value;
  const installments = document.getElementById('tx-installments').value;
  const accountId = document.getElementById('tx-account').value;

  try {
    // 1. Inserir Transação no Supabase
    const newTx = {
      description,
      amount,
      date,
      category_id: categoryId,
      payment_method: paymentMethod,
      card_id: paymentMethod === 'card' ? parseInt(cardId) : null,
      installments: paymentMethod === 'card' ? parseInt(installments) : 1,
      account_id: paymentMethod === 'account' ? parseInt(accountId) : null,
      user_id: state.user ? (state.users.find(u => u.email === state.user.email)?.id || null) : null
    };

    const { error: insertError } = await state.supabase.from('transactions').insert([newTx]);
    if (insertError) throw insertError;

    // 2. Se for débito imediato, deduzir do saldo da conta correspondente
    if (paymentMethod === 'account' && accountId) {
      const accIdNum = parseInt(accountId);
      const acc = state.accounts.find(a => a.id === accIdNum);
      if (acc) {
        const newBalance = parseFloat(acc.balance) - amount;
        const { error: updateError } = await state.supabase
          .from('accounts')
          .update({ balance: newBalance })
          .eq('id', accIdNum);
        if (updateError) throw updateError;
      }
    }

    document.getElementById('new-transaction-form').reset();
    document.querySelector('input[value="card"]').click();
    document.getElementById('installment-preview-text').classList.add('hide');

    document.querySelector('.nav-link[data-tab="dashboard"]').click();
  } catch (err) {
    alert('Erro ao salvar lançamento: ' + err.message);
  }
});

// SUBMIT ADMIN: CONTAS
document.getElementById('account-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('account-id').value;
  const name = document.getElementById('account-name').value;
  const balance = parseFloat(document.getElementById('account-balance').value);

  try {
    if (id) {
      const { error } = await state.supabase.from('accounts').update({ name, balance }).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await state.supabase.from('accounts').insert([{ name, balance }]);
      if (error) throw error;
    }
    clearAccountForm();
    loadAllData();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById('clear-account-form-btn').addEventListener('click', clearAccountForm);

// SUBMIT ADMIN: CARTÕES
document.getElementById('card-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('card-id').value;
  const name = document.getElementById('card-name').value;
  const closingDay = parseInt(document.getElementById('card-closing').value);
  const dueDay = parseInt(document.getElementById('card-due').value);
  const accountId = parseInt(document.getElementById('card-account').value);

  try {
    const payload = { name, closing_day: closingDay, due_day: dueDay, account_id: accountId };
    if (id) {
      const { error } = await state.supabase.from('cards').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await state.supabase.from('cards').insert([payload]);
      if (error) throw error;
    }
    clearCardForm();
    loadAllData();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById('clear-card-form-btn').addEventListener('click', clearCardForm);

// SUBMIT ADMIN: ITENS FIXOS
document.getElementById('fixed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('fixed-id').value;
  const description = document.getElementById('fixed-desc').value;
  const amount = parseFloat(document.getElementById('fixed-amount').value);
  const dayOfMonth = parseInt(document.getElementById('fixed-day').value);
  const type = document.getElementById('fixed-type').value;
  const categoryId = document.getElementById('fixed-category').value;
  const accountId = parseInt(document.getElementById('fixed-account').value);

  try {
    const payload = {
      description,
      amount,
      day_of_month: dayOfMonth,
      type,
      account_id: accountId,
      category_id: categoryId ? parseInt(categoryId) : null
    };

    if (id) {
      const { error } = await state.supabase.from('fixed_items').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await state.supabase.from('fixed_items').insert([payload]);
      if (error) throw error;
    }
    clearFixedForm();
    loadAllData();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById('clear-fixed-form-btn').addEventListener('click', clearFixedForm);

// SUBMIT ADMIN: CATEGORIAS
document.getElementById('category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('category-id').value;
  const name = document.getElementById('category-name').value;
  const icon = document.getElementById('category-icon').value;
  const color = document.getElementById('category-color').value;

  try {
    const payload = { name, icon, color };
    if (id) {
      const { error } = await state.supabase.from('categories').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await state.supabase.from('categories').insert([payload]);
      if (error) throw error;
    }
    clearCategoryForm();
    loadAllData();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById('clear-category-form-btn').addEventListener('click', clearCategoryForm);

// SUBMIT ADMIN: USUÁRIOS
document.getElementById('user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('user-id').value;
  const name = document.getElementById('user-name').value;
  const email = document.getElementById('user-email').value;
  const password = document.getElementById('user-password').value;

  try {
    const payload = { name, email, password };
    if (id) {
      const { error } = await state.supabase.from('app_users').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await state.supabase.from('app_users').insert([payload]);
      if (error) throw error;
    }
    clearUserForm();
    loadAllData();
  } catch (err) {
    alert(err.message);
    // Fallback em memória para teste
    if (!id) {
      const tempId = Date.now();
      state.users.push({ id: tempId, name, email, password });
      clearUserForm();
      renderAdminTables();
    }
  }
});
document.getElementById('clear-user-form-btn').addEventListener('click', clearUserForm);

// BUSCA E FILTROS
document.getElementById('tx-search-input').addEventListener('input', renderTransactionsTable);
document.getElementById('tx-filter-user').addEventListener('change', renderTransactionsTable);

// EXPORTAR LANÇAMENTOS EM CSV
document.getElementById('export-csv-btn').addEventListener('click', () => {
  if (state.transactions.length === 0) {
    alert('Nenhum lançamento para exportar.');
    return;
  }
  
  let csvContent = '\uFEFF'; // UTF-8 BOM
  csvContent += 'Data;Descrição;Categoria;Quem Lançou;Forma Pagamento;Parcelas;Valor (R$)\n';

  state.transactions.forEach(t => {
    const catIdNum = t.category_id || t.categoryId;
    const cat = state.categories.find(c => c.id === catIdNum);
    const method = (t.payment_method === 'card' || t.paymentMethod === 'card') ? 'Cartão de Crédito' : 'Débito em Conta';
    const installments = t.installments > 1 ? `${t.installments}x` : 'À vista';
    const catName = cat ? cat.name : 'Outros';

    csvContent += `"${formatDate(t.date)}";"${t.description}";"${catName}";"Família";"${method}";"${installments}";"-${parseFloat(t.amount).toFixed(2)}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `familymoney_lancamentos_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// RESETAR TODO O CONTEÚDO (BOTÃO DA MORTE)
document.getElementById('death-button').addEventListener('click', async () => {
  if (confirm('deseja mesmo apagar todos os dados?')) {
    try {
      // Deleta todos os dados de todas as tabelas em lote no Supabase
      const tables = ['transactions', 'fixed_items', 'cards', 'accounts', 'categories'];
      for (const t of tables) {
        const { error } = await state.supabase.from(t).delete().neq('id', 0); // Deleta todos cujos ids não são 0
        if (error) throw error;
      }

      alert('Todos os dados de transações, contas, cartões, itens fixos e categorias foram apagados.');
      loadAllData();
    } catch (err) {
      alert('Erro ao apagar dados: ' + err.message);
    }
  }
});

document.getElementById('create-backup-btn').addEventListener('click', createBackup);

// ================= INICIALIZAÇÃO =================
window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('tx-date').value = today;
  
  initApp();
});
