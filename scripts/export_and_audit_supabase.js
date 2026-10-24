const fs = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://bfsliahvbzddlminbpdq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmc2xpYWh2YnpkZGxtaW5icGRxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3ODE3NTcsImV4cCI6MjEwMTM1Nzc1N30.foGxWytjJLG7TJ66moq3EkPrlYsq0fvZeO5z83ber8c';

const TABLES = [
  'accounts',
  'cards',
  'categories',
  'tags',
  'fixed_items',
  'transactions',
  'paid_card_bills',
  'app_users',
  'app_backups'
];

async function fetchTable(table) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    return { error: `HTTP ${response.status}: ${errorText}` };
  }
  const data = await response.json();
  return { data };
}

async function run() {
  console.log('=== INICIANDO AUDITORIA E BACKUP SUPABASE ===');
  console.log(`URL do Supabase: ${SUPABASE_URL}`);
  
  const fullBackup = {
    exported_at: new Date().toISOString(),
    supabase_url: SUPABASE_URL,
    tables: {}
  };

  const auditReport = [];

  for (const table of TABLES) {
    try {
      const res = await fetchTable(table);
      if (res.error) {
        auditReport.push({ table, count: 0, status: 'ERROR', details: res.error });
        fullBackup.tables[table] = { error: res.error, records: [] };
      } else {
        const count = res.data.length;
        auditReport.push({ table, count, status: 'OK', sample: res.data.slice(0, 2) });
        fullBackup.tables[table] = { count, records: res.data };
      }
    } catch (err) {
      auditReport.push({ table, count: 0, status: 'EXCEPTION', details: err.message });
      fullBackup.tables[table] = { error: err.message, records: [] };
    }
  }

  // Salvar backup local imutável
  const backupFile = path.join(__dirname, '..', 'supabase_full_backup_pre_migration.json');
  fs.writeFileSync(backupFile, JSON.stringify(fullBackup, null, 2), 'utf-8');
  console.log(`\n[BACKUP CONCLUÍDO] Arquivo salvo em: ${backupFile}`);

  console.log('\n=== RESUMO DAS TABELAS NO SUPABASE ===');
  for (const item of auditReport) {
    console.log(`- Tabela ${item.table.padEnd(16)}: ${item.count} registros [${item.status}]`);
  }

  // Análise financeira agregada dos dados do Supabase
  if (fullBackup.tables.accounts?.records) {
    const totalBalance = fullBackup.tables.accounts.records.reduce((acc, a) => acc + Number(a.balance || 0), 0);
    console.log(`\nSaldo Total em Contas: R$ ${totalBalance.toFixed(2)}`);
  }

  if (fullBackup.tables.transactions?.records) {
    const totalTx = fullBackup.tables.transactions.records.length;
    const expenseTx = fullBackup.tables.transactions.records.filter(t => t.type === 'expense');
    const incomeTx = fullBackup.tables.transactions.records.filter(t => t.type === 'income');
    console.log(`Total de Transações: ${totalTx} (Despesas: ${expenseTx.length}, Receitas: ${incomeTx.length})`);
  }

  if (fullBackup.tables.fixed_items?.records) {
    console.log(`Itens Fixos: ${fullBackup.tables.fixed_items.records.length}`);
  }
}

run().catch(err => {
  console.error('Falha crítica na auditoria:', err);
  process.exit(1);
});
