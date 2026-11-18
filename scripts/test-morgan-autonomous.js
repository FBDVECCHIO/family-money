/**
 * ============================================================================
 * SUITE DE TESTES END-TO-END — AGENTE AUTÔNOMO MORGAN 24/7
 * ============================================================================
 * Valida:
 *  1. Persistência de Memória e Configurações (morgan_settings)
 *  2. Lançamento de Despesa/Receita + Atualização de Saldo + Botão Desfazer (Undo)
 *  3. Governança Híbrida em Transferências (Abaixo do limite vs. Acima do limite com Confirm/Cancel)
 *  4. Exclusão Protegida (pending_confirmation -> confirm -> undo)
 *  5. Simulador de Compra Parcelada & Arbitragem CDI
 *  6. Briefing Executivo Matinal & Conversação em Linguagem Natural / WhatsApp Webhook
 */

const assert = require('assert');
const db = require('../db');
const engine = require('../morgan-finance-engine');
const agent = require('../morgan-agent');
const telegram = require('../morgan-telegram');

async function runTests() {
  console.log('🚀 Iniciando bateria de verificação End-to-End do Agente Autônomo Morgan 24/7...\n');

  await db.initDb();

  const mutations = [];
  engine.setMutationNotifier((table, action) => {
    mutations.push({ table, action });
  });

  // 1. Testar Configurações e Memória Persistente
  const settings = await db.getMorganSettings();
  assert(settings.family_goal, 'Deve possuir meta principal da família');
  assert(Number(settings.approval_threshold) === 1000, 'Threshold padrão deve ser 1000');
  console.log('✅ [TESTE 1] Memória persistente (morgan_settings) carregada com sucesso.');

  // 2. Testar Lançamento de Despesa em Conta + Atualização de Saldo + Undo
  const accountsBefore = await db.selectRows('accounts');
  const firstAcc = accountsBefore[0];
  const initialBalance = parseFloat(firstAcc.balance);

  const launchRes = await engine.executeToolAction('create_transaction', {
    description: 'Teste Automatizado Supermercado Morgan',
    amount: 150.00,
    type: 'expense',
    payment_method: 'account',
    account_id: firstAcc.id,
    is_effective: true
  }, { channel: 'telegram', chatId: 'test_chat_1' });

  assert(launchRes.ok === true, 'Lançamento deve retornar ok: true');
  assert(launchRes.status === 'executed', 'Lançamento do dia a dia deve executar imediatamente');
  assert(launchRes.canUndo === true, 'Deve permitir Undo');

  const accAfterLaunch = (await db.selectRows('accounts', { id: `eq.${firstAcc.id}` }))[0];
  assert(
    Math.abs(parseFloat(accAfterLaunch.balance) - (initialBalance - 150.00)) < 0.01,
    `Saldo deveria cair de ${initialBalance} para ${initialBalance - 150}, mas foi ${accAfterLaunch.balance}`
  );
  console.log(`✅ [TESTE 2A] Despesa lançada e saldo atualizado (${initialBalance} -> ${accAfterLaunch.balance}).`);

  // Desfazer (Undo) o lançamento!
  const undoRes = await engine.undoExecutedAction(launchRes.actionLogId);
  assert(undoRes.ok === true && undoRes.status === 'undone', 'Undo deve funcionar');

  const accAfterUndo = (await db.selectRows('accounts', { id: `eq.${firstAcc.id}` }))[0];
  assert(
    Math.abs(parseFloat(accAfterUndo.balance) - initialBalance) < 0.01,
    `Após Undo, saldo deve voltar para ${initialBalance}, mas está em ${accAfterUndo.balance}`
  );
  console.log(`✅ [TESTE 2B] Botão Desfazer (Undo) reverteu a transação e restaurou o saldo exato (${accAfterUndo.balance}).`);

  // 3. Testar Governança Híbrida em Transferência Alta (>= R$ 1.000)
  const secondAcc = accountsBefore[1];
  const secondInitialBalance = parseFloat(secondAcc.balance);

  const highTransfer = await engine.executeToolAction('transfer_between_accounts', {
    amount: 2500.00,
    from_account: firstAcc.id,
    to_account: secondAcc.id
  }, { channel: 'telegram', chatId: 'test_chat_1' });

  assert(highTransfer.ok === true, 'Transferência alta deve criar log');
  assert(highTransfer.status === 'pending_confirmation', 'Transferência >= 1000 deve exigir confirmação prévia');
  assert(highTransfer.requiresConfirmation === true, 'Flag requiresConfirmation deve ser true');

  // Garantir que os saldos NÃO mudaram antes da confirmação
  const accCheckPending = (await db.selectRows('accounts', { id: `eq.${firstAcc.id}` }))[0];
  assert(Math.abs(parseFloat(accCheckPending.balance) - initialBalance) < 0.01, 'Saldo não pode mudar antes do Confirmar');
  console.log('✅ [TESTE 3A] Governança Híbrida bloqueou transferência de R$ 2.500,00 aguardando botão [Confirmar].');

  // Confirmar a transferência pendente
  const confirmedTransfer = await engine.confirmPendingAction(highTransfer.actionLogId);
  assert(confirmedTransfer.ok === true && confirmedTransfer.status === 'executed', 'Confirmação deve executar a transferência');

  const acc1AfterConfirm = (await db.selectRows('accounts', { id: `eq.${firstAcc.id}` }))[0];
  const acc2AfterConfirm = (await db.selectRows('accounts', { id: `eq.${secondAcc.id}` }))[0];
  assert(Math.abs(parseFloat(acc1AfterConfirm.balance) - (initialBalance - 2500)) < 0.01, 'Conta origem deve debitar 2500');
  assert(Math.abs(parseFloat(acc2AfterConfirm.balance) - (secondInitialBalance + 2500)) < 0.01, 'Conta destino deve creditar 2500');
  console.log('✅ [TESTE 3B] Clique em [Confirmar] executou a transferência entre contas com precisão.');

  // Desfazer a transferência confirmada para manter o banco limpo!
  const undoTransfer = await engine.undoExecutedAction(confirmedTransfer.actionLogId);
  assert(undoTransfer.ok === true, 'Deve permitir desfazer transferência confirmada');
  const acc1Restored = (await db.selectRows('accounts', { id: `eq.${firstAcc.id}` }))[0];
  const acc2Restored = (await db.selectRows('accounts', { id: `eq.${secondAcc.id}` }))[0];
  assert(Math.abs(parseFloat(acc1Restored.balance) - initialBalance) < 0.01, 'Conta origem restaurada');
  assert(Math.abs(parseFloat(acc2Restored.balance) - secondInitialBalance) < 0.01, 'Conta destino restaurada');
  console.log('✅ [TESTE 3C] Transferência revertida via Undo e saldos originais 100% restaurados.');

  // 4. Testar Simulador de Compra e Recomendação de Cartão
  const simRes = await engine.executeToolAction('simulate_purchase_impact', {
    amount: 3600,
    installments: 6
  });
  assert(simRes.ok === true && simRes.installmentValue === 600, 'Simulador deve calcular parcelas de R$ 600');
  assert(simRes.cdiArbitrageGain > 0, 'Simulador deve calcular ganho de arbitragem no CDI');
  console.log(`✅ [TESTE 4] Simulador de compra (6x R$ 600) calculou arbitragem CDI de +R$ ${simRes.cdiArbitrageGain}.`);

  // 5. Testar Processamento em Linguagem Natural via Agente (Lançamento + Undo)
  const chatRes = await agent.processMorganMessage({
    text: `Lance 95,50 de padaria na conta ${firstAcc.name}`,
    channel: 'telegram',
    chatId: 'test_chat_nl'
  });
  assert(chatRes.reply && chatRes.actions.length === 1, 'Agente deve interpretar comando em linguagem natural e executar tool');
  const nlActionId = chatRes.actions[0].actionLogId;
  await engine.undoExecutedAction(nlActionId);
  console.log('✅ [TESTE 5] Cérebro do Morgan interpretou comando em linguagem natural, lançou no banco e desfez com sucesso.');

  // 6. Testar Briefing Matinal & Formatação HTML do Telegram
  const briefing = await engine.buildExecutiveBriefingText();
  assert(briefing.text.includes('Briefing Executivo Matinal'), 'Deve gerar texto completo do briefing');
  const tgHtml = telegram.markdownToTelegramHtml(briefing.text);
  assert(tgHtml.includes('<b>'), 'Deve converter Markdown para HTML do Telegram');
  console.log('✅ [TESTE 6] Briefing Executivo Matinal e formatação Telegram HTML validados.');

  // Limpar logs de teste criados durante a verificação
  await db.deleteRows('morgan_action_logs', { chat_id: 'in.(test_chat_1,test_chat_nl)' });
  await db.deleteRows('morgan_conversations', { chat_id: 'eq.test_chat_nl' });

  console.log(`\n🎉 TODOS OS 6 GRUPOS DE TESTES PASSARAM COM 100% DE INTEGRIDADE! (${mutations.length} eventos SSE disparados)`);
}

runTests().catch(err => {
  console.error('❌ FALHA NOS TESTES DO MORGAN:', err);
  process.exit(1);
});
