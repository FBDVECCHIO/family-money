/**
 * ============================================================================
 * MORGAN PROACTIVE SCHEDULER 24/7 — BRIEFING MATINAL & VIGILÂNCIA DE CARTÕES
 * ============================================================================
 * Roda no servidor Node.js na Hetzner verificando a cada 60 segundos:
 *  1. Horário do Briefing Diário Matinal (configurável, padrão 08:00 America/Sao_Paulo)
 *  2. Alertas proativos de fechamento de fatura (48h antes) e vencimento no dia
 */

const db = require('./db');
const telegram = require('./morgan-telegram');
const engine = require('./morgan-finance-engine');

let schedulerInterval = null;

function getBrazilDateAndTime() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    timeHHMM: `${map.hour}:${map.minute}`,
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    day: parseInt(map.day, 10)
  };
}

function isTimeReached(currentHHMM, targetHHMM = '08:00') {
  const [cH, cM] = String(currentHHMM).split(':').map(Number);
  const [tH, tM] = String(targetHHMM || '08:00').split(':').map(Number);
  if (isNaN(tH) || isNaN(tM)) return false;

  const currentMins = cH * 60 + cM;
  const targetMins = tH * 60 + tM;
  // Dispara se estiver na janela de até 30 minutos após o horário configurado e ainda não tiver disparado hoje
  return currentMins >= targetMins && currentMins <= (targetMins + 30);
}

async function runProactiveCycle() {
  try {
    const settings = await db.getMorganSettings();
    if (!settings.proactive_enabled) return;

    const tgStatus = telegram.getTelegramStatus();
    const allowedChats = settings.telegram_allowed_chat_ids || [];
    if (!tgStatus.active || allowedChats.length === 0) return;

    const brTime = getBrazilDateAndTime();

    // 1. Verificar Briefing Diário Matinal
    if (
      settings.last_briefing_date !== brTime.dateKey &&
      isTimeReached(brTime.timeHHMM, settings.briefing_time || '08:00')
    ) {
      console.log(`[MORGAN-SCHEDULER] Disparando Briefing Diário Matinal (${brTime.dateKey} às ${brTime.timeHHMM})...`);
      await db.updateMorganSettings({ last_briefing_date: brTime.dateKey });
      await telegram.broadcastTelegramBriefing();
    }

    // 2. Verificar Alerta Vespertino de Fechamento / Vencimento de Cartão (às 14:00)
    if (
      settings.last_card_alert_date !== brTime.dateKey &&
      isTimeReached(brTime.timeHHMM, '14:00')
    ) {
      const ctx = await engine.buildMorganRichContext();
      const urgentCards = ctx.cardAnalysis.filter(c => c.daysUntilClosing === 1 || c.daysUntilClosing === 0);
      const dueTodayBills = ctx.currentBillsByCard.filter(b => Number(b.dueDay) === brTime.day && !b.isPaid && b.currentBillAmount > 0);

      if (urgentCards.length > 0 || dueTodayBills.length > 0) {
        await db.updateMorganSettings({ last_card_alert_date: brTime.dateKey });
        const best = ctx.cardAnalysis[0];
        let alertMsg = `🔔 **Iniciativa Proativa do CFO Morgan — Vigilância de Cartões**\n\n`;

        if (dueTodayBills.length > 0) {
          alertMsg += `🚨 **Faturas Vencendo HOJE (Dia ${brTime.day}):**\n` +
            dueTodayBills.map(b => `• **${b.cardName}**: **${engine.formatBRL(b.currentBillAmount)}** *(Ainda não marcada como paga)*`).join('\n') +
            `\n*Diga "Morgan, paguei a fatura do ${dueTodayBills[0].cardName}" para eu quitar e conciliar no sistema.*\n\n`;
        }

        if (urgentCards.length > 0) {
          alertMsg += `⏳ **Janela de Fechamento de Fatura:**\n` +
            urgentCards.map(c => `• **${c.name}** fecha **${c.daysUntilClosing === 0 ? 'HOJE' : 'AMANHÃ'}** (Dia ${c.closingDay}).`).join('\n') +
            `\n💡 **Recomendação:** Direcione as compras de hoje para o **${best ? best.name : 'cartão de maior float'}** (${best ? best.floatDays + ' dias sem juros' : ''}).`;
        }

        for (const cid of allowedChats) {
          await telegram.sendTelegramMessage(String(cid), alertMsg);
        }
      }
    }
  } catch (err) {
    console.warn('[MORGAN-SCHEDULER] Erro no ciclo proativo:', err.message);
  }
}

function startMorganScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval);
  console.log('[MORGAN-SCHEDULER] Motor Proativo 24/7 iniciado (fuso America/Sao_Paulo).');
  schedulerInterval = setInterval(runProactiveCycle, 60 * 1000);
}

module.exports = {
  startMorganScheduler,
  runProactiveCycle,
  getBrazilDateAndTime
};
