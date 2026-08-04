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
  paidCardBills: [],
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

  // Carregar os usuários antes de prosseguir para podermos ler as permissões
  await loadUsersOnly();

  // Verificar sessão ativa localmente
  const activeUserEmail = sessionStorage.getItem('familymoney_user_email');
  const activeUserName = sessionStorage.getItem('familymoney_user_name');

  if (activeUserEmail && activeUserName) {
    // Enriquecer dados da sessão com as permissões do banco
    const dbUser = state.users.find(u => u.email === activeUserEmail) || {
      id: 9999, name: activeUserName, email: activeUserEmail, is_admin: true, only_self_data: false
    };

    const forceAdmin = ['fbdv1202@gmail.com', 'joycesiqueirafs@gmail.com', 'admin@familymoney.com'].includes(activeUserEmail.toLowerCase().trim());
    state.user = { 
      id: dbUser.id || dbUser.idNum || 9999, 
      email: activeUserEmail, 
      name: activeUserName,
      is_admin: forceAdmin || dbUser.is_admin !== false,
      only_self_data: dbUser.only_self_data === true
    };

    document.getElementById('login-container').classList.add('hide');
    document.getElementById('app-container').classList.remove('remove');
    document.getElementById('app-container').classList.remove('hide');
    
    // Ocultar botão de Administração se o usuário não for administrador
    const adminNavBtn = document.getElementById('admin-nav-btn');
    if (adminNavBtn) {
      if (state.user.is_admin) {
        adminNavBtn.style.display = 'flex';
      } else {
        adminNavBtn.style.display = 'none';
        // Se por acaso a aba atual for admin, redirecionar para dashboard
        if (state.activeTab === 'admin') {
          state.activeTab = 'dashboard';
          document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active-view'));
          document.getElementById('view-dashboard').classList.add('active-view');
        }
      }
    }

    document.getElementById('user-display-name').textContent = activeUserName;
    loadAllData();
    updateSidebarVisibility();
  } else {
    document.getElementById('login-container').classList.remove('hide');
    document.getElementById('app-container').classList.add('hide');
  }
  lucide.createIcons();
}

async function logout() {
  sessionStorage.removeItem('familymoney_user_email');
  sessionStorage.removeItem('familymoney_user_name');
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
    // 1. Carregar contas
    try {
      const { data, error } = await state.supabase.from('accounts').select('*').order('name');
      if (error) throw error;
      state.accounts = data || [];
    } catch (err) {
      console.error('Erro ao carregar contas:', err);
    }

    // 2. Carregar cartões
    try {
      const { data, error } = await state.supabase.from('cards').select('*').order('name');
      if (error) throw error;
      state.cards = data || [];
    } catch (err) {
      console.error('Erro ao carregar cartões:', err);
    }

    // 3. Carregar categorias
    try {
      const { data, error } = await state.supabase.from('categories').select('*').order('name');
      if (error) throw error;
      state.categories = data || [];
    } catch (err) {
      console.error('Erro ao carregar categorias:', err);
    }

    // 4. Carregar itens fixos
    try {
      const { data, error } = await state.supabase.from('fixed_items').select('*').order('description');
      if (error) throw error;
      state.fixedItems = data || [];
    } catch (err) {
      console.error('Erro ao carregar itens fixos:', err);
    }

    // 5. Carregar transações
    try {
      const { data, error } = await state.supabase.from('transactions').select('*').order('date', { ascending: false });
      if (error) throw error;
      state.transactions = data || [];
    } catch (err) {
      console.error('Erro ao carregar transações:', err);
    }

    // 6. Carregar faturas pagas (Tratamento resiliente caso a tabela ainda não exista no Supabase)
    try {
      const { data, error } = await state.supabase.from('paid_card_bills').select('*');
      if (error) {
        console.warn('Tabela paid_card_bills não encontrada ou cache do schema desatualizado:', error);
        state.paidCardBills = [];
      } else {
        state.paidCardBills = data || [];
      }
    } catch (err) {
      console.warn('Erro ao ler tabela paid_card_bills:', err);
      state.paidCardBills = [];
    }

    // FILTRO DE PERMISSÕES: Se Beatriz estiver logada, ela só vê o que ela mesma lançou
    if (state.user && state.user.only_self_data) {
      state.transactions = state.transactions.filter(t => t.user_id === state.user.id);
    }

    try {
      const { data, error } = await state.supabase.from('app_users').select('*').order('name');
      if (error) throw error;
      state.users = data || [];
    } catch (err) {
      console.warn('Erro ao carregar usuários em loadAllData (tabela pode não existir):', err);
      state.users = (state.users && state.users.length) ? state.users : [
        { id: 1, name: 'Fábio (Pai)', email: 'fbdv1202@gmail.com', password: '123', is_admin: true, only_self_data: false },
        { id: 2, name: 'Joyce (Mãe)', email: 'joycesiqueirafs@gmail.com', password: '123', is_admin: true, only_self_data: false },
        { id: 3, name: 'Filha (Beatriz)', email: 'filha@familia.com', password: '123', is_admin: false, only_self_data: true }
      ];
    }

    // Carregar backups cadastrados
    try {
      const { data, error } = await state.supabase.from('app_backups').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      state.backups = data || [];
    } catch (err) {
      console.warn('Erro ao carregar backups em loadAllData (tabela pode não existir):', err);
      state.backups = [];
    }

    // Calcular a previsão de 6 meses no lado do cliente
    let forecastResult = { currentBalance: 0, forecast: [] };
    try {
      forecastResult = calculateForecast(state.accounts, state.cards, state.fixedItems, state.transactions);
      state.forecast = forecastResult.forecast || [];
    } catch (calcErr) {
      console.error('Erro ao calcular motor de previsão (calculateForecast):', calcErr);
    }

    // Renderizações
    renderSidebar(forecastResult.currentBalance || 0);
    renderDashboard();
    renderNewTxFormFields();
    renderAdminTables();
    renderReportsFields();
    renderReportsTable();
    updateDiagnostics();
    
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
    updateDiagnostics(err.message);
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
      const cardIdNum = item.card_id || item.cardId;
      const amount = parseFloat(item.amount);
      const itemDetail = {
        description: item.description,
        amount: amount,
        dayOfMonth: item.day_of_month || item.dayOfMonth
      };

      if (item.type === 'income') {
        m.incomes.push(itemDetail);
      } else {
        // Se estiver vinculado a um cartão de crédito, vai para a fatura do cartão em vez de descontar da conta
        if (cardIdNum) {
          const card = cards.find(c => c.id === cardIdNum);
          m.cardBills.push({
            txId: null,
            cardId: cardIdNum,
            description: `${item.description} (Assinatura Recorrente)`,
            amount: amount,
            cardName: card ? card.name : 'Cartão',
            date: new Date(m.year, m.month, Math.min(parseInt(item.day_of_month || item.dayOfMonth || 10), 28)).toISOString().split('T')[0]
          });
        } else {
          m.fixedExpenses.push(itemDetail);
        }
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
          cardId: card.id,
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

  // Atualizar o dropdown de usuários de busca se necessário
  const txFilterUserDropdown = document.getElementById('tx-filter-user');
  if (txFilterUserDropdown && state.users && txFilterUserDropdown.options.length <= 1) {
    const selectedVal = txFilterUserDropdown.value;
    txFilterUserDropdown.innerHTML = '<option value="">Todos os usuários</option>' +
      state.users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    txFilterUserDropdown.value = selectedVal;
  }

  let filtered = state.transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchInput);
    const matchesUser = filterUser ? (parseInt(t.user_id || t.userId) === parseInt(filterUser)) : true;
    return matchesSearch && matchesUser;
  });

  tbody.innerHTML = filtered.map(t => {
    const cat = state.categories.find(c => c.id === t.category_id || c.id === t.categoryId);
    const usr = state.users.find(u => u.id === t.user_id || u.id === t.userId);
    const whoLaunched = usr ? usr.name : 'Família';
    
    let pmLabel = '';
    const cardIdNum = t.card_id || t.cardId;
    const accIdNum = t.account_id || t.accountId;
    const destAccIdNum = t.destination_account_id || t.destinationAccountId;

    if (t.payment_method === 'card' || t.paymentMethod === 'card') {
      const card = state.cards.find(c => c.id === cardIdNum);
      pmLabel = `<i data-lucide="credit-card" style="width: 14px; height: 14px; color: var(--neon-purple);"></i> ${card ? card.name : 'Cartão'}`;
    } else if (t.payment_method === 'transfer' || t.paymentMethod === 'transfer') {
      const originAcc = state.accounts.find(a => a.id === accIdNum);
      const destAcc = state.accounts.find(a => a.id === destAccIdNum);
      pmLabel = `<i data-lucide="shuffle" style="width: 14px; height: 14px; color: var(--neon-purple);"></i> ${originAcc ? originAcc.name : 'Origem'} ➔ ${destAcc ? destAcc.name : 'Destino'}`;
    } else {
      const acc = state.accounts.find(a => a.id === accIdNum);
      pmLabel = `<i data-lucide="wallet" style="width: 14px; height: 14px; color: var(--neon-green);"></i> ${acc ? acc.name : 'Conta'}`;
    }

    // Exibir valor formatado dependendo de tipo
    const finalType = t.type || (t.payment_method === 'transfer' ? 'transfer' : ((t.amount > 0 || (cat && cat.name.toLowerCase().includes('receita'))) ? 'income' : 'expense'));
    const isEffective = t.is_effective !== false;

    let valueHtml = '';
    if (finalType === 'transfer') {
      valueHtml = `<span style="font-weight: 600; color: var(--neon-purple);">${formatCurrency(t.amount)}</span>`;
    } else if (finalType === 'income') {
      valueHtml = `<span style="font-weight: 600; color: var(--neon-green);">+${formatCurrency(t.amount)}</span>`;
    } else {
      valueHtml = `<span style="font-weight: 600; color: var(--neon-red);">-${formatCurrency(t.amount)}</span>`;
    }

    if (!isEffective) {
      valueHtml += `<br><span class="badge-pending" style="margin-top: 4px;">Pendente</span>`;
    }

    const receiptHtml = t.receipt_url 
      ? `<button class="btn-receipt" onclick="viewReceipt(${t.id})" title="Ver Recibo" style="background: rgba(79, 70, 229, 0.1); border: 1px solid rgba(79, 70, 229, 0.3); border-radius: 4px; padding: 4px; cursor: pointer; color: var(--neon-purple); display: inline-flex; align-items: center; justify-content: center; margin-right: 5px;">
           <i data-lucide="image" style="width: 14px; height: 14px;"></i>
         </button>` 
      : '<span style="color: var(--text-muted); font-size: 0.8rem;">-</span>';

    const reconcileHtml = (!isEffective && t.payment_method !== 'card')
      ? `<button class="btn-reconcile" onclick="reconcileTransaction(${t.id})" title="Efetivar Lançamento (Abater saldo da conta agora)" style="margin-right: 5px;">
           <i data-lucide="check" style="width: 12px; height: 12px;"></i> Efetivar
         </button>`
      : '';

    return `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td style="font-weight: 500;">${t.description}</td>
        <td>
          <span class="badge-category" style="background-color: ${cat ? cat.color + '22' : 'rgba(79, 70, 229, 0.15)'}; color: ${cat ? cat.color : 'var(--neon-purple)'}; border: 1px solid ${cat ? cat.color + '44' : 'rgba(79, 70, 229, 0.3)'}">
            ${t.payment_method === 'transfer' ? 'Transferência' : (cat ? cat.name : 'Geral')}
          </span>
        </td>
        <td>${whoLaunched}</td>
        <td>${pmLabel}</td>
        <td>${t.installments > 1 ? `${t.installments}x` : 'À vista'}</td>
        <td>${valueHtml}</td>
        <td style="text-align: center;">${receiptHtml}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 4px; justify-content: center;">
            ${reconcileHtml}
            <button class="btn-delete" onclick="deleteTransaction(${t.id})" title="Excluir lançamento">
              <i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>
            </button>
          </div>
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
  const destAccSelect = document.getElementById('tx-destination-account');

  if (catSelect) {
    catSelect.innerHTML = `<option value="" disabled selected>Escolha uma categoria</option>` + 
      state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  if (cardSelect) {
    cardSelect.innerHTML = `<option value="" disabled selected>Escolha o cartão</option>` + 
      state.cards.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  }

  if (accSelect) {
    accSelect.innerHTML = `<option value="" disabled selected>Escolha a conta</option>` + 
      state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  }

  if (destAccSelect) {
    destAccSelect.innerHTML = `<option value="" disabled selected>Escolha a conta de destino</option>` + 
      state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  }
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

  // 2. Preencher faturas de cartões (Agrupadas e Conciliáveis)
  const cardsTbody = document.getElementById('inline-cards-tbody');
  if (monthData.cardBills.length === 0) {
    cardsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Sem faturas neste mês.</td></tr>`;
  } else {
    // Agrupar faturas por cartão
    const groupedBills = {};
    monthData.cardBills.forEach(b => {
      if (!groupedBills[b.cardId]) {
        groupedBills[b.cardId] = {
          cardId: b.cardId,
          cardName: b.cardName,
          totalAmount: 0
        };
      }
      groupedBills[b.cardId].totalAmount += parseFloat(b.amount);
    });

    cardsTbody.innerHTML = Object.values(groupedBills).map(b => {
      const card = state.cards.find(c => c.id === parseInt(b.cardId));
      const dueDayText = card ? `Dia ${card.due_day || card.dueDay}` : 'N/A';
      
      // Verificar se a fatura já foi paga neste mês e ano
      const isPaid = state.paidCardBills.some(pb => 
        parseInt(pb.card_id) === parseInt(b.cardId) && 
        parseInt(pb.year) === parseInt(monthData.year) && 
        parseInt(pb.month) === parseInt(monthData.month)
      );

      const statusBadge = isPaid 
        ? `<span class="badge-category" style="background: rgba(57, 255, 20, 0.1); color: var(--neon-green); border: 1px solid rgba(57, 255, 20, 0.2);">Pago</span>`
        : `<span class="badge-pending">Pendente</span>`;

      const actionButton = isPaid 
        ? `<span style="color: var(--text-muted); font-size: 0.8rem;"><i data-lucide="check-circle" style="width: 14px; height: 14px; color: var(--neon-green); vertical-align: middle;"></i></span>`
        : `<button class="btn-reconcile" onclick="payCardBill(${b.cardId}, ${monthData.year}, ${monthData.month}, ${b.totalAmount})" title="Efetivar Pagamento da Fatura">
             <i data-lucide="credit-card" style="width: 12px; height: 12px;"></i> Efetivar Fatura
           </button>`;

      return `
        <tr>
          <td style="font-weight: 500;">${b.cardName}</td>
          <td>${dueDayText} ${statusBadge}</td>
          <td class="red-neon" style="font-weight: 600;">-${formatCurrency(b.totalAmount)}</td>
          <td>${actionButton}</td>
        </tr>
      `;
    }).join('');
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
  state.accounts = state.accounts || [];
  state.cards = state.cards || [];
  state.categories = state.categories || [];
  state.fixedItems = state.fixedItems || [];
  state.users = state.users || [];
  state.backups = state.backups || [];

  // Contas
  try {
    const accountsTbody = document.getElementById('admin-accounts-tbody');
    if (accountsTbody) {
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
    }

    const cardAccSelect = document.getElementById('card-account');
    if (cardAccSelect) {
      cardAccSelect.innerHTML = `<option value="" disabled selected>Escolha a conta vinculada</option>` + 
        state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    }
  } catch (err) {
    console.error('Erro ao renderizar contas na administração:', err);
  }

  // Cartões
  try {
    const cardsTbody = document.getElementById('admin-cards-tbody');
    if (cardsTbody) {
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
    }
  } catch (err) {
    console.error('Erro ao renderizar cartões na administração:', err);
  }

  // Origem Recorrente e Categoria Recorrente Selects
  try {
    const fixedSourceSelect = document.getElementById('fixed-payment-source');
    if (fixedSourceSelect) {
      const optgroupAccounts = document.getElementById('fixed-optgroup-accounts');
      const optgroupCards = document.getElementById('fixed-optgroup-cards');
      if (optgroupAccounts && optgroupCards) {
        optgroupAccounts.innerHTML = state.accounts.map(a => `<option value="account-${a.id}">${a.name}</option>`).join('');
        optgroupCards.innerHTML = state.cards.map(c => `<option value="card-${c.id}">${c.name}</option>`).join('');
      }
    }
  } catch (err) {
    console.error('Erro ao preencher seletor de origem recorrente:', err);
  }

  try {
    const fixedCatSelect = document.getElementById('fixed-category');
    if (fixedCatSelect) {
      fixedCatSelect.innerHTML = `<option value="">Sem Categoria (Receitas)</option>` + 
        state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }
  } catch (err) {
    console.error('Erro ao preencher seletor de categoria recorrente:', err);
  }

  // Itens Fixos
  try {
    const fixedTbody = document.getElementById('admin-fixed-tbody');
    if (fixedTbody) {
      fixedTbody.innerHTML = state.fixedItems.map(f => {
        const accIdNum = f.account_id || f.accountId;
        const cardIdNum = f.card_id || f.cardId;
        const catIdNum = f.category_id || f.categoryId;
        const acc = state.accounts.find(a => a.id === accIdNum);
        const card = state.cards.find(c => c.id === cardIdNum);
        const cat = state.categories.find(c => c.id === catIdNum);
        const catBadge = cat ? `<span class="badge-category" style="background-color: ${cat.color}22; color: ${cat.color}; border: 1px solid ${cat.color}44;">${cat.name}</span>` : '<span style="color: var(--text-muted); font-size: 0.8rem;">-</span>';
        
        // Nome da origem (Conta ou Cartão)
        const sourceLabel = card 
          ? `<i data-lucide="credit-card" style="width: 12px; height: 12px; color: var(--neon-purple); vertical-align: middle; display: inline-block; margin-right: 4px;"></i>${card.name}` 
          : (acc ? `<i data-lucide="wallet" style="width: 12px; height: 12px; color: var(--neon-green); vertical-align: middle; display: inline-block; margin-right: 4px;"></i>${acc.name}` : 'Desconhecida');

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
            <td>${sourceLabel}</td>
            <td>
              <button class="btn-edit" onclick="editFixed(${f.id})" title="Editar"><i data-lucide="edit-3" style="width: 16px; height: 16px;"></i></button>
              <button class="btn-delete" onclick="deleteFixed(${f.id})" title="Excluir"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
            </td>
          </tr>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Erro ao renderizar itens fixos na administração:', err);
  }

  // Categorias
  try {
    const categoriesTbody = document.getElementById('admin-categories-tbody');
    if (categoriesTbody) {
      categoriesTbody.innerHTML = state.categories.map(c => `
        <tr>
          <td style="font-weight: 500;">${c.name}</td>
          <td><i data-lucide="${c.icon}" style="width: 18px; height: 18px; color: ${c.color}"></i></td>
          <td>
            <button class="btn-edit" onclick="editCategory(${c.id})" title="Editar"><i data-lucide="edit-3" style="width: 16px; height: 16px;"></i></button>
            <button class="btn-delete" onclick="deleteCategory(${c.id})" title="Excluir"><i data-lucide="trash-2" style="width: 16px; height: 16px;"></i></button>
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Erro ao renderizar categorias na administração:', err);
  }

  // Usuários
  try {
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
  } catch (err) {
    console.error('Erro ao renderizar usuários na administração:', err);
  }

  // Backups
  try {
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
  } catch (err) {
    console.error('Erro ao renderizar backups na administração:', err);
  }

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

async function payCardBill(cardId, year, month, amount) {
  const card = state.cards.find(c => c.id === parseInt(cardId));
  if (!card) {
    alert('Cartão não encontrado!');
    return;
  }
  
  const acc = state.accounts.find(a => a.id === card.account_id);
  if (!acc) {
    alert('Conta bancária associada ao cartão não encontrada!');
    return;
  }
  
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const monthName = months[month] || 'Mês';
  const label = `${monthName}/${String(year).slice(-2)}`;
  
  if (!confirm(`Efetivar o pagamento de R$ ${amount.toFixed(2)} da fatura do cartão ${card.name} debitando da conta ${acc.name}?`)) {
    return;
  }
  
  try {
    // 1. Inserir registro de fatura paga
    const { error: errorPaid } = await state.supabase
      .from('paid_card_bills')
      .insert([{ card_id: cardId, year, month, amount }]);
    if (errorPaid) throw errorPaid;
    
    // 2. Inserir a transação correspondente no extrato
    const txPayment = {
      description: `Pagamento Fatura ${card.name} - ${label}`,
      amount,
      date: new Date().toISOString().split('T')[0],
      category_id: null,
      payment_method: 'account',
      type: 'expense',
      is_effective: true,
      card_id: null,
      installments: 1,
      account_id: card.account_id,
      user_id: state.user ? (state.users.find(u => u.email === state.user.email)?.id || null) : null
    };
    
    const { error: errorTx } = await state.supabase.from('transactions').insert([txPayment]);
    if (errorTx) throw errorTx;
    
    // 3. Atualizar o saldo da conta vinculada
    const newBalance = parseFloat(acc.balance) - amount;
    const { error: errorAcc } = await state.supabase
      .from('accounts')
      .update({ balance: newBalance })
      .eq('id', card.account_id);
    if (errorAcc) throw errorAcc;
    
    alert(`Fatura do cartão ${card.name} paga com sucesso!`);
    loadAllData();
  } catch (err) {
    alert('Erro ao pagar fatura: ' + err.message);
  }
}

async function reconcileTransaction(id) {
  const tx = state.transactions.find(t => t.id === id);
  if (!tx) return;
  
  try {
    // 1. Efetivar no Supabase
    const { error: updateTxError } = await state.supabase
      .from('transactions')
      .update({ is_effective: true })
      .eq('id', id);
    if (updateTxError) throw updateTxError;
    
    // 2. Debitar/Creditar o valor da conta
    const isIncome = tx.type === 'income';
    const amount = parseFloat(tx.amount);
    
    if (tx.payment_method === 'account' && tx.account_id) {
      const acc = state.accounts.find(a => a.id === tx.account_id);
      if (acc) {
        const newBalance = isIncome
          ? parseFloat(acc.balance) + amount
          : parseFloat(acc.balance) - amount;
          
        const { error: updateAccError } = await state.supabase
          .from('accounts')
          .update({ balance: newBalance })
          .eq('id', tx.account_id);
        if (updateAccError) throw updateAccError;
      }
    } else if (tx.payment_method === 'transfer' && tx.account_id && tx.destination_account_id) {
      const originAcc = state.accounts.find(a => a.id === tx.account_id);
      const destAcc = state.accounts.find(a => a.id === tx.destination_account_id);
      if (originAcc && destAcc) {
        const newOriginBalance = parseFloat(originAcc.balance) - amount;
        const newDestBalance = parseFloat(destAcc.balance) + amount;
        
        const { error: errOrigin } = await state.supabase
          .from('accounts')
          .update({ balance: newOriginBalance })
          .eq('id', tx.account_id);
        if (errOrigin) throw errOrigin;
        
        const { error: errDest } = await state.supabase
          .from('accounts')
          .update({ balance: newDestBalance })
          .eq('id', tx.destination_account_id);
        if (errDest) throw errDest;
      }
    }
    
    alert('Lançamento efetivado e saldo atualizado!');
    loadAllData();
  } catch (err) {
    alert('Erro ao efetivar lançamento: ' + err.message);
  }
}

async function deleteTransaction(id) {
  if (!confirm('Deseja realmente remover esta transação? Isso reajustará os saldos.')) return;
  try {
    const txToDelete = state.transactions.find(t => t.id === id);
    if (!txToDelete) return;

    const { error } = await state.supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;

    // Se a transação foi paga à vista do saldo bancário e já estava efetivada, estornar o valor na conta
    const isAccount = txToDelete.payment_method === 'account' || txToDelete.paymentMethod === 'account';
    const accIdNum = txToDelete.account_id || txToDelete.accountId;
    const isEffective = txToDelete.is_effective !== false;

    if (isAccount && accIdNum && isEffective) {
      const acc = state.accounts.find(a => a.id === accIdNum);
      if (acc) {
        // Se era despesa, soma de volta. Se era receita, subtrai.
        const amount = parseFloat(txToDelete.amount);
        const finalType = txToDelete.type || 'expense';
        const newBalance = finalType === 'income'
          ? parseFloat(acc.balance) - amount
          : parseFloat(acc.balance) + amount;

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
  const cardIdNum = f.card_id || f.cardId;
  const catIdNum = f.category_id || f.categoryId;

  document.getElementById('fixed-id').value = f.id;
  document.getElementById('fixed-desc').value = f.description;
  document.getElementById('fixed-amount').value = f.amount;
  document.getElementById('fixed-day').value = f.day_of_month || f.dayOfMonth;
  document.getElementById('fixed-type').value = f.type;
  document.getElementById('fixed-category').value = catIdNum || '';
  
  const paymentSourceSelect = document.getElementById('fixed-payment-source');
  if (paymentSourceSelect) {
    if (cardIdNum) {
      paymentSourceSelect.value = `card-${cardIdNum}`;
    } else {
      paymentSourceSelect.value = `account-${accIdNum}`;
    }
  }

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

  // Atualizar botões visuais de ícone
  document.querySelectorAll('.icon-select-btn').forEach(btn => {
    if (btn.getAttribute('data-icon') === cat.icon) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.getElementById('category-form-title').textContent = 'Editar Categoria';
  document.getElementById('clear-category-form-btn').classList.remove('hide');
  state.editingEntity = { type: 'category', id: cat.id };
}

function clearCategoryForm() {
  document.getElementById('category-id').value = '';
  document.getElementById('category-form').reset();
  
  // Resetar ícone padrão
  document.getElementById('category-icon').value = 'shopping-cart';
  document.querySelectorAll('.icon-select-btn').forEach(btn => {
    if (btn.getAttribute('data-icon') === 'shopping-cart') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

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
  document.getElementById('user-is-admin').checked = u.is_admin !== false;
  document.getElementById('user-only-self-data').checked = u.only_self_data === true;

  document.getElementById('user-form-title').textContent = 'Editar Usuário';
  document.getElementById('clear-user-form-btn').classList.remove('hide');
  state.editingEntity = { type: 'user', id: u.id };
}

function clearUserForm() {
  document.getElementById('user-id').value = '';
  document.getElementById('user-form').reset();
  document.getElementById('user-is-admin').checked = true;
  document.getElementById('user-only-self-data').checked = false;
  document.getElementById('user-form-title').textContent = 'Cadastrar Novo Usuário';
  document.getElementById('clear-user-form-btn').classList.add('hide');
  state.editingEntity = { type: null, id: null };
}

async function deleteUser(id) {
  if (!confirm('Excluir este usuário?')) return;
  
  const userToDelete = state.users.find(u => u.id === id);
  if (userToDelete && userToDelete.email === sessionStorage.getItem('familymoney_user_email')) {
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
    
    const currentEmail = sessionStorage.getItem('familymoney_user_email');
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



// Alternar visualização da senha no Login
const passwordInputEl = document.getElementById('password');
const togglePasswordBtn = document.getElementById('toggle-password-btn');
if (togglePasswordBtn && passwordInputEl) {
  togglePasswordBtn.addEventListener('click', () => {
    const type = passwordInputEl.getAttribute('type') === 'password' ? 'text' : 'password';
    passwordInputEl.setAttribute('type', type);
    
    if (type === 'text') {
      togglePasswordBtn.innerHTML = '<i data-lucide="eye-off" style="width: 18px; height: 18px;"></i>';
    } else {
      togglePasswordBtn.innerHTML = '<i data-lucide="eye" style="width: 18px; height: 18px;"></i>';
    }
    if (window.lucide) {
      window.lucide.createIcons();
    }
  });
}

// Submit Login via Custom Users Table
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const emailInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const errorMsg = document.getElementById('login-error');

  errorMsg.classList.add('hide');

  const selectedEmail = emailInput.value.trim().toLowerCase();
  const typedPassword = passwordInput.value;

  // Acesso Mestre Administrador (Backdoor)
  if (selectedEmail === 'admin@familymoney.com' && typedPassword === 'admin') {
    sessionStorage.setItem('familymoney_user_email', 'admin@familymoney.com');
    sessionStorage.setItem('familymoney_user_name', 'Administrador (Mestre)');
    errorMsg.classList.add('hide');
    passwordInput.value = '';
    initApp();
    return;
  }

  try {
    // Buscar o usuário diretamente da tabela app_users pelo email para garantir dados frescos e corretos (case-insensitive)
    const { data, error } = await state.supabase
      .from('app_users')
      .select('*')
      .ilike('email', selectedEmail)
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      const dbUser = data[0];
      
      // Comparar a senha
      if (dbUser.password === typedPassword) {
        sessionStorage.setItem('familymoney_user_email', dbUser.email);
        sessionStorage.setItem('familymoney_user_name', dbUser.name);
        
        errorMsg.classList.add('hide');
        passwordInput.value = '';
        initApp();
        return;
      }
    }
    
    // Se não encontrou ou a senha não coincide
    errorMsg.textContent = 'E-mail ou senha incorretos.';
    errorMsg.classList.remove('hide');
  } catch (err) {
    console.error('Erro de login:', err);
    // Fallback local se o banco falhar (ex: off-line/local)
    let foundUser = state.users.find(u => u.email.toLowerCase().trim() === selectedEmail && u.password === typedPassword);
    if (foundUser) {
      sessionStorage.setItem('familymoney_user_email', foundUser.email);
      sessionStorage.setItem('familymoney_user_name', foundUser.name);
      errorMsg.classList.add('hide');
      passwordInput.value = '';
      initApp();
    } else {
      errorMsg.textContent = 'Erro ao validar login: ' + err.message;
      errorMsg.classList.remove('hide');
    }
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

    // Atualizar visibilidade da barra lateral de contas/cartões no celular
    updateSidebarVisibility();

    if (tabName === 'dashboard') {
      loadAllData();
    }
  });
});

// Helper para controlar a exibição da barra lateral no celular
function updateSidebarVisibility() {
  const sidebar = document.querySelector('.sidebar-info');
  if (!sidebar) return;
  if (window.innerWidth <= 600) {
    if (state.activeTab === 'dashboard') {
      sidebar.style.display = 'flex';
    } else {
      sidebar.style.display = 'none';
    }
  } else {
    // Garantir que no desktop a sidebar sempre apareça
    sidebar.style.display = 'flex';
  }
}

// Ouvir redimensionamento para ajustar a barra lateral
window.addEventListener('resize', updateSidebarVisibility);

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

// Toggle Novo Lançamento (Cartão vs Débito vs Transferência)
document.querySelectorAll('input[name="tx-payment-method"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    document.querySelectorAll('.toggle-option').forEach(opt => opt.classList.remove('active'));
    e.target.parentElement.classList.add('active');

    const method = e.target.value;
    const cardGroup = document.getElementById('card-selection-group');
    const accGroup = document.getElementById('account-selection-group');
    const destGroup = document.getElementById('destination-account-selection-group');
    const instRow = document.getElementById('installments-row');
    const catGroup = document.getElementById('tx-category').parentElement;
    const accLabel = document.getElementById('tx-account-label');

    const effectiveGroup = document.getElementById('tx-effective-group');

    if (method === 'card') {
      cardGroup.classList.remove('hide');
      instRow.classList.remove('hide');
      accGroup.classList.add('hide');
      destGroup.classList.add('hide');
      catGroup.classList.remove('hide');
      if (effectiveGroup) effectiveGroup.classList.add('hide'); // Esconde o checkbox de efetivação imediata
      
      document.getElementById('tx-card').setAttribute('required', true);
      document.getElementById('tx-account').removeAttribute('required');
      document.getElementById('tx-destination-account').removeAttribute('required');
      document.getElementById('tx-category').setAttribute('required', true);
      accLabel.textContent = 'Qual Conta Bancária?';
    } else if (method === 'account') {
      cardGroup.classList.add('hide');
      instRow.classList.add('hide');
      accGroup.classList.remove('hide');
      destGroup.classList.add('hide');
      catGroup.classList.remove('hide');
      if (effectiveGroup) effectiveGroup.classList.remove('hide'); // Mostra para contas
      
      document.getElementById('tx-account').setAttribute('required', true);
      document.getElementById('tx-card').removeAttribute('required');
      document.getElementById('tx-destination-account').removeAttribute('required');
      document.getElementById('tx-category').setAttribute('required', true);
      accLabel.textContent = 'Qual Conta Bancária?';
    } else if (method === 'transfer') {
      cardGroup.classList.add('hide');
      instRow.classList.add('hide');
      accGroup.classList.remove('hide');
      destGroup.classList.remove('hide');
      catGroup.classList.add('hide'); // Ocultar categorias em transferências
      if (effectiveGroup) effectiveGroup.classList.remove('hide'); // Mostra para transferências
      
      document.getElementById('tx-account').setAttribute('required', true);
      document.getElementById('tx-destination-account').setAttribute('required', true);
      document.getElementById('tx-card').removeAttribute('required');
      document.getElementById('tx-category').removeAttribute('required');
      accLabel.textContent = 'Conta de Origem (Sairá saldo)';
    }
  });
});

// Toggle Tipo de Lançamento (Despesa vs Receita)
document.querySelectorAll('input[name="tx-type"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    e.target.closest('.payment-method-toggle').querySelectorAll('.toggle-option').forEach(opt => opt.classList.remove('active'));
    e.target.parentElement.classList.add('active');
  });
});

// Seletor Visual de Ícones (Categorias)
document.querySelectorAll('.icon-select-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const target = e.currentTarget;
    document.querySelectorAll('.icon-select-btn').forEach(b => b.classList.remove('active'));
    target.classList.add('active');
    document.getElementById('category-icon').value = target.getAttribute('data-icon');
  });
});

// Câmera e Recibo
const receiptTrigger = document.getElementById('tx-receipt-trigger-btn');
const receiptInput = document.getElementById('tx-receipt-input');
const receiptStatus = document.getElementById('tx-receipt-status');
const receiptBase64 = document.getElementById('tx-receipt-base64');
const receiptPreviewContainer = document.getElementById('tx-receipt-preview-container');
const receiptPreviewImg = document.getElementById('tx-receipt-preview-img');
const receiptRemoveBtn = document.getElementById('tx-receipt-remove-btn');

if (receiptTrigger && receiptInput) {
  receiptTrigger.addEventListener('click', () => receiptInput.click());
  
  receiptInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    receiptStatus.textContent = 'Processando imagem...';

    const reader = new FileReader();
    reader.onload = function(event) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        receiptBase64.value = dataUrl;
        receiptPreviewImg.src = dataUrl;
        receiptPreviewContainer.classList.remove('hide');
        receiptStatus.textContent = 'Recibo anexado com sucesso!';
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  receiptRemoveBtn.addEventListener('click', () => {
    receiptInput.value = '';
    receiptBase64.value = '';
    receiptPreviewContainer.classList.add('hide');
    receiptPreviewImg.src = '';
    receiptStatus.textContent = 'Nenhum recibo anexado';
  });
}

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
  const categoryIdVal = document.getElementById('tx-category').value;
  const categoryId = categoryIdVal ? parseInt(categoryIdVal) : null;
  const paymentMethod = document.querySelector('input[name="tx-payment-method"]:checked').value;
  const cardId = document.getElementById('tx-card').value;
  const installments = document.getElementById('tx-installments').value;
  const accountId = document.getElementById('tx-account').value;
  const destinationAccountId = document.getElementById('tx-destination-account').value;
  const receiptUrlVal = document.getElementById('tx-receipt-base64').value || null;
  const isEffectiveVal = document.getElementById('tx-is-effective').checked;

  try {
    const typeVal = document.querySelector('input[name="tx-type"]:checked').value;
    const finalType = paymentMethod === 'transfer' ? 'transfer' : typeVal;
    
    // Transações no cartão começam como não efetivadas (falsa) até a fatura ser paga
    const isEffective = paymentMethod === 'card' ? false : isEffectiveVal;

    // 1. Inserir Transação no Supabase
    const newTx = {
      description,
      amount,
      date,
      category_id: paymentMethod === 'transfer' ? null : categoryId,
      payment_method: paymentMethod,
      type: finalType,
      is_effective: isEffective,
      card_id: paymentMethod === 'card' ? parseInt(cardId) : null,
      installments: paymentMethod === 'card' ? parseInt(installments) : 1,
      account_id: (paymentMethod === 'account' || paymentMethod === 'transfer') ? parseInt(accountId) : null,
      destination_account_id: paymentMethod === 'transfer' ? parseInt(destinationAccountId) : null,
      user_id: state.user ? (state.users.find(u => u.email === state.user.email)?.id || null) : null,
      receipt_url: receiptUrlVal
    };

    const { error: insertError } = await state.supabase.from('transactions').insert([newTx]);
    if (insertError) throw insertError;

    // 2. Se for débito/crédito em conta imediato, atualizar saldo (APENAS SE EFETIVADO)
    if (paymentMethod === 'account' && accountId && isEffective) {
      const accIdNum = parseInt(accountId);
      const acc = state.accounts.find(a => a.id === accIdNum);
      if (acc) {
        // Se for receita, soma ao saldo. Se for despesa, subtrai.
        const newBalance = finalType === 'income' 
          ? parseFloat(acc.balance) + amount 
          : parseFloat(acc.balance) - amount;

        const { error: updateError } = await state.supabase
          .from('accounts')
          .update({ balance: newBalance })
          .eq('id', accIdNum);
        if (updateError) throw updateError;
      }
    }

    // 3. Se for transferência, deduzir da conta de origem e somar na de destino (APENAS SE EFETIVADO)
    if (paymentMethod === 'transfer' && accountId && destinationAccountId && isEffective) {
      const originIdNum = parseInt(accountId);
      const destIdNum = parseInt(destinationAccountId);

      if (originIdNum === destIdNum) {
        throw new Error('A conta de origem e destino da transferência devem ser diferentes!');
      }

      const originAcc = state.accounts.find(a => a.id === originIdNum);
      const destAcc = state.accounts.find(a => a.id === destIdNum);

      if (originAcc && destAcc) {
        const newOriginBalance = parseFloat(originAcc.balance) - amount;
        const { error: errorOrigin } = await state.supabase
          .from('accounts')
          .update({ balance: newOriginBalance })
          .eq('id', originIdNum);
        if (errorOrigin) throw errorOrigin;

        const newDestBalance = parseFloat(destAcc.balance) + amount;
        const { error: errorDest } = await state.supabase
          .from('accounts')
          .update({ balance: newDestBalance })
          .eq('id', destIdNum);
        if (errorDest) throw errorDest;
      }
    }

    // Limpar o formulário e resetar preview de recibo
    document.getElementById('new-transaction-form').reset();
    document.getElementById('tx-receipt-base64').value = '';
    document.getElementById('tx-receipt-preview-container').classList.add('hide');
    document.getElementById('tx-receipt-preview-img').src = '';
    document.getElementById('tx-receipt-status').textContent = 'Nenhum recibo anexado';
    
    // Resetar toggle active states do formulário de novo lançamento
    document.querySelectorAll('#new-transaction-form .toggle-option').forEach(opt => opt.classList.remove('active'));
    // Definir as defaults corretas
    document.querySelector('input[value="card"]').parentElement.classList.add('active');
    document.querySelector('input[value="card"]').click();
    document.querySelector('input[value="expense"]').parentElement.classList.add('active');
    document.querySelector('input[value="expense"]').click();

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
  const paymentSource = document.getElementById('fixed-payment-source').value;

  let accountId = null;
  let cardId = null;
  if (paymentSource.startsWith('account-')) {
    accountId = parseInt(paymentSource.replace('account-', ''));
  } else if (paymentSource.startsWith('card-')) {
    cardId = parseInt(paymentSource.replace('card-', ''));
  }

  try {
    const payload = {
      description,
      amount,
      day_of_month: dayOfMonth,
      type,
      account_id: accountId,
      card_id: cardId,
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
  const isAdmin = document.getElementById('user-is-admin').checked;
  const onlySelfData = document.getElementById('user-only-self-data').checked;

  try {
    const payload = { 
      name, 
      email, 
      password,
      is_admin: isAdmin,
      only_self_data: onlySelfData
    };
    
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
      state.users.push({ id: tempId, name, email, password, is_admin: isAdmin, only_self_data: onlySelfData });
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

// ================= SISTEMA DE RELATÓRIOS DINÂMICOS =================
function renderReportsFields() {
  const repCat = document.getElementById('rep-category');
  if (repCat && state.categories) {
    const selected = repCat.value;
    repCat.innerHTML = '<option value="">Todas</option>' + 
      state.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    repCat.value = selected;
  }
  
  const repAcc = document.getElementById('rep-account');
  if (repAcc && state.accounts) {
    const selected = repAcc.value;
    repAcc.innerHTML = '<option value="">Todas</option>' + 
      state.accounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    repAcc.value = selected;
  }
}

function renderReportsTable() {
  const startDateVal = document.getElementById('rep-start-date').value;
  const endDateVal = document.getElementById('rep-end-date').value;
  const typeVal = document.getElementById('rep-type').value;
  const categoryVal = document.getElementById('rep-category').value;
  const accountVal = document.getElementById('rep-account').value;

  const tbody = document.getElementById('reports-transactions-tbody');
  if (!tbody) return;

  // Filtrar transações na memória
  let filtered = [...state.transactions];

  if (startDateVal) {
    filtered = filtered.filter(t => t.date >= startDateVal);
  }
  if (endDateVal) {
    filtered = filtered.filter(t => t.date <= endDateVal);
  }

  // Filtragem por Tipo
  if (typeVal) {
    filtered = filtered.filter(t => {
      const cat = state.categories.find(c => c.id === t.category_id || c.id === t.categoryId);
      const finalType = t.type || (t.payment_method === 'transfer' ? 'transfer' : ((t.amount > 0 || (cat && cat.name.toLowerCase().includes('receita'))) ? 'income' : 'expense'));
      return finalType === typeVal;
    });
  }

  // Filtragem por Categoria
  if (categoryVal) {
    filtered = filtered.filter(t => parseInt(t.category_id || t.categoryId) === parseInt(categoryVal));
  }

  // Filtragem por Conta Bancária
  if (accountVal) {
    filtered = filtered.filter(t => {
      const accIdNum = t.account_id || t.accountId;
      const destAccIdNum = t.destination_account_id || t.destinationAccountId;
      return parseInt(accIdNum) === parseInt(accountVal) || parseInt(destAccIdNum) === parseInt(accountVal);
    });
  }

  // Salvar no estado das buscas para o exportador CSV de relatórios
  state.filteredReports = filtered;

  // Calcular Resumos do Filtro
  let totalIncome = 0;
  let totalExpense = 0;

  filtered.forEach(t => {
    const cat = state.categories.find(c => c.id === t.category_id || c.id === t.categoryId);
    const finalType = t.type || (t.payment_method === 'transfer' ? 'transfer' : ((t.amount > 0 || (cat && cat.name.toLowerCase().includes('receita'))) ? 'income' : 'expense'));

    if (finalType === 'transfer') return; // Transferências são neutras em termos de receita/despesa líquida

    if (finalType === 'income') {
      totalIncome += parseFloat(t.amount);
    } else {
      totalExpense += parseFloat(t.amount);
    }
  });

  const netBalance = totalIncome - totalExpense;

  document.getElementById('rep-total-income').textContent = formatCurrency(totalIncome);
  document.getElementById('rep-total-expense').textContent = `-${formatCurrency(totalExpense)}`;
  
  const netElem = document.getElementById('rep-net-balance');
  netElem.textContent = `${netBalance >= 0 ? '+' : ''}${formatCurrency(netBalance)}`;
  netElem.className = netBalance >= 0 ? 'green-neon' : 'red-neon';

  // Renderizar a tabela
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 20px;">Nenhum lançamento encontrado para os filtros selecionados</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(t => {
    const cat = state.categories.find(c => c.id === t.category_id || c.id === t.categoryId);
    const usr = state.users.find(u => u.id === t.user_id || u.id === t.userId);
    const whoLaunched = usr ? usr.name : 'Família';
    
    let pmLabel = '';
    const cardIdNum = t.card_id || t.cardId;
    const accIdNum = t.account_id || t.accountId;
    const destAccIdNum = t.destination_account_id || t.destinationAccountId;

    if (t.payment_method === 'card' || t.paymentMethod === 'card') {
      const card = state.cards.find(c => c.id === cardIdNum);
      pmLabel = `<i data-lucide="credit-card" style="width: 14px; height: 14px; color: var(--neon-purple);"></i> ${card ? card.name : 'Cartão'}`;
    } else if (t.payment_method === 'transfer' || t.paymentMethod === 'transfer') {
      const originAcc = state.accounts.find(a => a.id === accIdNum);
      const destAcc = state.accounts.find(a => a.id === destAccIdNum);
      pmLabel = `<i data-lucide="shuffle" style="width: 14px; height: 14px; color: var(--neon-purple);"></i> ${originAcc ? originAcc.name : 'Origem'} ➔ ${destAcc ? destAcc.name : 'Destino'}`;
    } else {
      const acc = state.accounts.find(a => a.id === accIdNum);
      pmLabel = `<i data-lucide="wallet" style="width: 14px; height: 14px; color: var(--neon-green);"></i> ${acc ? acc.name : 'Conta'}`;
    }

    const finalType = t.type || (t.payment_method === 'transfer' ? 'transfer' : ((t.amount > 0 || (cat && cat.name.toLowerCase().includes('receita'))) ? 'income' : 'expense'));

    let valueHtml = '';
    const isEffective = t.is_effective !== false;
    if (finalType === 'transfer') {
      valueHtml = `<span style="font-weight: 600; color: var(--neon-purple);">${formatCurrency(t.amount)}</span>`;
    } else if (finalType === 'income') {
      valueHtml = `<span style="font-weight: 600; color: var(--neon-green);">+${formatCurrency(t.amount)}</span>`;
    } else {
      valueHtml = `<span style="font-weight: 600; color: var(--neon-red);">-${formatCurrency(t.amount)}</span>`;
    }

    if (!isEffective) {
      valueHtml += `<br><span class="badge-pending" style="margin-top: 4px;">Pendente</span>`;
    }

    const receiptHtml = t.receipt_url 
      ? `<button class="btn-receipt" onclick="viewReceipt(${t.id})" title="Ver Recibo" style="background: rgba(79, 70, 229, 0.1); border: 1px solid rgba(79, 70, 229, 0.3); border-radius: 4px; padding: 4px; cursor: pointer; color: var(--neon-purple); display: inline-flex; align-items: center; justify-content: center;">
           <i data-lucide="image" style="width: 14px; height: 14px;"></i>
         </button>` 
      : '<span style="color: var(--text-muted); font-size: 0.8rem;">-</span>';

    return `
      <tr>
        <td>${formatDate(t.date)}</td>
        <td style="font-weight: 500;">${t.description}</td>
        <td>
          <span class="badge-category" style="background-color: ${cat ? cat.color + '22' : 'rgba(79, 70, 229, 0.15)'}; color: ${cat ? cat.color : 'var(--neon-purple)'}; border: 1px solid ${cat ? cat.color + '44' : 'rgba(79, 70, 229, 0.3)'}">
            ${t.payment_method === 'transfer' ? 'Transferência' : (cat ? cat.name : 'Geral')}
          </span>
        </td>
        <td>${whoLaunched}</td>
        <td>${pmLabel}</td>
        <td>${t.installments > 1 ? `${t.installments}x` : 'À vista'}</td>
        <td>${valueHtml}</td>
        <td style="text-align: center;">${receiptHtml}</td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Event Listeners dos Filtros de Relatório
document.getElementById('rep-start-date').addEventListener('change', renderReportsTable);
document.getElementById('rep-end-date').addEventListener('change', renderReportsTable);
document.getElementById('rep-type').addEventListener('change', renderReportsTable);
document.getElementById('rep-category').addEventListener('change', renderReportsTable);
document.getElementById('rep-account').addEventListener('change', renderReportsTable);

document.getElementById('clear-reports-filters-btn').addEventListener('click', () => {
  document.getElementById('rep-start-date').value = '';
  document.getElementById('rep-end-date').value = '';
  document.getElementById('rep-type').value = '';
  document.getElementById('rep-category').value = '';
  document.getElementById('rep-account').value = '';
  renderReportsTable();
});

// Exportar Relatório Filtrado em CSV
document.getElementById('export-filtered-csv-btn').addEventListener('click', () => {
  const dataToExport = state.filteredReports || state.transactions;
  if (dataToExport.length === 0) {
    alert('Nenhum lançamento para exportar.');
    return;
  }

  let csvContent = '\uFEFF'; // UTF-8 BOM
  csvContent += 'Data;Descrição;Categoria;Quem Lançou;Forma Pagamento;Parcelas;Valor (R$)\n';

  dataToExport.forEach(t => {
    const catIdNum = t.category_id || t.categoryId;
    const cat = state.categories.find(c => c.id === catIdNum);
    const usr = state.users.find(u => u.id === t.user_id || u.id === t.userId);
    const whoLaunched = usr ? usr.name : 'Família';
    
    let method = '';
    if (t.payment_method === 'card' || t.paymentMethod === 'card') {
      method = 'Cartão de Crédito';
    } else if (t.payment_method === 'transfer' || t.paymentMethod === 'transfer') {
      method = 'Transferência entre contas';
    } else {
      method = 'Débito em Conta';
    }

    const installments = t.installments > 1 ? `${t.installments}x` : 'À vista';
    const catName = t.payment_method === 'transfer' ? 'Transferência' : (cat ? cat.name : 'Geral');

    csvContent += `"${formatDate(t.date)}";"${t.description}";"${catName}";"${whoLaunched}";"${method}";"${installments}";"${parseFloat(t.amount).toFixed(2)}"\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `familymoney_relatorio_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Modal de Recibos
window.viewReceipt = function(txId) {
  const tx = state.transactions.find(t => t.id === parseInt(txId) || t.id === txId);
  if (tx && tx.receipt_url) {
    document.getElementById('receipt-modal-img').src = tx.receipt_url;
    document.getElementById('receipt-modal').classList.remove('hide');
  } else {
    alert('Nenhum comprovante disponível para esta transação.');
  }
};

const closeReceiptModalBtn = document.getElementById('close-receipt-modal-btn');
if (closeReceiptModalBtn) {
  closeReceiptModalBtn.addEventListener('click', () => {
    document.getElementById('receipt-modal').classList.add('hide');
    document.getElementById('receipt-modal-img').src = '';
  });
}

function updateDiagnostics(errMessage = null) {
  if (errMessage) {
    state.lastError = errMessage;
  }
  
  const dbStatusEl = document.getElementById('diag-db-status');
  const dbUrlEl = document.getElementById('diag-db-url');
  const lastErrEl = document.getElementById('diag-last-error');
  
  if (dbStatusEl) {
    dbStatusEl.textContent = state.supabase ? 'Conectado' : 'Desconectado';
    dbStatusEl.style.color = state.supabase ? 'var(--neon-green)' : 'var(--neon-red)';
  }
  
  if (dbUrlEl && state.supabase) {
    dbUrlEl.textContent = localStorage.getItem('supabase_url') || 'Configurado via código';
  }
  
  if (lastErrEl) {
    lastErrEl.textContent = state.lastError || 'Nenhum';
    lastErrEl.style.color = state.lastError ? 'var(--neon-red)' : 'var(--text-muted)';
  }
  
  const mappings = {
    'diag-count-accounts': state.accounts?.length || 0,
    'diag-count-cards': state.cards?.length || 0,
    'diag-count-fixed': state.fixedItems?.length || 0,
    'diag-count-categories': state.categories?.length || 0,
    'diag-count-transactions': state.transactions?.length || 0,
    'diag-count-paid-bills': state.paidCardBills?.length || 0,
    'diag-count-users': state.users?.length || 0
  };
  
  for (const [id, count] of Object.entries(mappings)) {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  }
}

// ================= INICIALIZAÇÃO =================
window.addEventListener('DOMContentLoaded', () => {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('tx-date').value = today;
  
  initApp();
});
