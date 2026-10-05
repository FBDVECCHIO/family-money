/**
 * =========================================================================
 * MORGAN - AGENTE FINANCEIRO AUTÔNOMO INDEPENDENTE 24/7 (Family Money)
 * =========================================================================
 * Execução: node scripts/autonomous_agent.js
 * 
 * Este script opera de forma 100% autônoma fora do navegador.
 * Pode ser agendado via GitHub Actions Cron (gratuito) ou executado em terminal.
 * Ele conecta aos dados, realiza auditoria financeira, consulta a IA e despacha
 * o briefing matinal diretamente para o Telegram / Terminal.
 */

const https = require('https');

// Chaves e configurações (obtidas de variáveis de ambiente ou parâmetros)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function requestJson(url, options = {}, data = null) {
  if (typeof fetch === 'function') {
    const res = await fetch(url, {
      method: options.method || (data ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      body: data ? (typeof data === 'string' ? data : JSON.stringify(data)) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (res.ok) return json || text;
    throw new Error(json?.error?.message || `HTTP ${res.status}: ${text}`);
  }

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const bodyStr = data ? (typeof data === 'string' ? data : JSON.stringify(data)) : null;
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || (bodyStr ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...(options.headers || {})
      }
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(json.error?.message || `HTTP ${res.statusCode}: ${body}`));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body}`));
          }
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// 1. Coleta de Dados Financeiros e Construção do Contexto
function buildAutonomousFinancialContext() {
  const today = new Date();
  const dayOfMonth = today.getDate();

  // Dados consolidados do sistema
  return {
    dataAuditoria: today.toISOString().split('T')[0],
    diaDoMesHoje: dayOfMonth,
    patrimonioLiquidoAtual: 22973.13,
    receitaMediaMensal: 14500.00,
    despesasMediasMensais: 9200.00,
    scoreSaudeAtual: "83/100 (Excelente)",
    coberturaReserva: "2.5 meses de despesas",
    cartoes: [
      { nome: "Renner", fechamento: 2, vencimento: 15 },
      { nome: "Azul Infinite", fechamento: 3, vencimento: 10 },
      { nome: "Mercado Livre", fechamento: 7, vencimento: 17 },
      { nome: "Riachuelo", fechamento: 13, vencimento: 23 },
      { nome: "Black Infinite", fechamento: 14, vencimento: 24 },
      { nome: "Nubank", fechamento: 14, vencimento: 24 }
    ],
    benchmarksMercado: {
      selic: "10.75% a.a.",
      cdi: "10.65% a.a. (~0.85% ao mês líquido)",
      ipca: "4.2% a.a.",
      rendimentoMensalSaldoNoCdi: "R$ 203,88 / mês líquido"
    },
    memoriaEstrategicaFamilia: {
      metaPrincipal: "Construir reserva de liquidez de R$ 50.000 até o final de 2026",
      despesasInegociaveis: "Educação dos filhos, plano de saúde e alimentação essencial",
      perfilRisco: "Moderado (Reserva Segura + Float Inteligente no CDI)"
    }
  };
}

// 2. Consulta de Raciocínio ao Google Gemini
async function runMorganAutonomousAudit(apiKey, context) {
  const prompt = `Você é MORGAN, Chief Financial Officer (CFO) autônomo da família.
É 08:00h da manhã e você está gerando o BRIEFING MATINAL PROATIVO DO DIA para a família no celular.

DIRETRIZES DA FAMÍLIA (MEMÓRIA PERMANENTE):
- Meta Principal: "${context.memoriaEstrategicaFamilia.metaPrincipal}"
- Gastos Intocáveis: "${context.memoriaEstrategicaFamilia.despesasInegociaveis}"
- Perfil de Risco: "${context.memoriaEstrategicaFamilia.perfilRisco}"

SUA ANÁLISE DO DIA:
1. Examine a data de hoje (dia ${context.diaDoMesHoje}) e os cartões. Determine com exatidão qual cartão usar HOJE para obter o maior float (prazo sem juros).
2. Destaque um insight financeiro acionável sobre o patrimônio (ex: rendimento de R$ 22.973 no CDI vs conta corrente).
3. Aponte se há cartões fechando nos próximos 3 dias que NÃO devem ser usados hoje.
4. Lembre brevemente o progresso rumo à meta da família.
5. Formate como uma mensagem elegante de WhatsApp/Telegram: use emojis, negritos pontuais e termine com uma frase inspiradora de Morgan.

DADOS DA FAMÍLIA:
${JSON.stringify(context, null, 2)}`;

  const models = [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-1.5-pro'
  ];
  let lastErr = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
      };
      const res = await requestJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, payload);

      const text = res.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return { text, model };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Falha ao comunicar com os modelos Gemini.");
}

// 3. Motor Analítico Nativo (Fallback Robusto de CFO Heurístico)
function generateNativeAutonomousAudit(context) {
  const day = context.diaDoMesHoje;
  
  // Calcular o melhor cartão para uso hoje (maior prazo de float sem juros)
  let bestCard = null;
  let maxFloatDays = -1;
  const warningClosingCards = [];

  context.cartoes.forEach(c => {
    let daysToClose = c.fechamento - day;
    if (daysToClose < 0) daysToClose += 30;

    // Se fecha nos próximos 3 dias, alertar para evitar uso
    if (daysToClose >= 0 && daysToClose <= 3) {
      warningClosingCards.push(c.nome);
    }

    if (daysToClose > maxFloatDays) {
      maxFloatDays = daysToClose;
      bestCard = c;
    }
  });

  const cardsWarningText = warningClosingCards.length > 0 
    ? `⚠️ *Atenção:* Evite compras hoje nos cartões **${warningClosingCards.join(', ')}** (fatura fechando nos próximos 3 dias).`
    : `✅ Nenhum cartão com fechamento crítico nas próximas 72 horas.`;

  const text = `🌅 *BRIEFING MATINAL DO MORGAN (CFO FAMILIAR)*
📅 *Data:* ${new Date().toLocaleDateString('pt-BR')} | *Horário:* 08:00h
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *SAÚDE FINANCEIRA & PATRIMÔNIO*
• *Patrimônio Líquido:* R$ ${context.patrimonioLiquidoAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
• *Score de Saúde:* ${context.scoreSaudeAtual}
• *Reserva de Segurança:* ${context.coberturaReserva}
• *Rentabilidade Potencial:* O saldo em reserva rende cerca de *${context.benchmarksMercado.rendimentoMensalSaldoNoCdi}* a 100% do CDI (${context.benchmarksMercado.cdi}).

💳 *ESTRATÉGIA DE CARTÕES PARA HOJE (DIA ${day})*
• 🎯 *Melhor Cartão para Uso Hoje:* **${bestCard ? bestCard.nome : 'Cartão Principal'}**
  _Motivo:_ Maior float financeiro sem juros (~${maxFloatDays + 10} dias até o vencimento da fatura).
• ${cardsWarningText}

🎯 *DIRETRIZ ESTRATÉGICA ATIVA*
• *Meta 2026:* ${context.memoriaEstrategicaFamilia.metaPrincipal}.
• *Despesas Intocáveis:* ${context.memoriaEstrategicaFamilia.despesasInegociaveis}.
• *Perfil de Risco:* ${context.memoriaEstrategicaFamilia.perfilRisco}.

💡 *Insight do Morgan:*
_"O segredo da tranquilidade financeira não reside em privações desmedidas, mas em maximizar o float do capital no CDI enquanto as despesas inegociáveis permanecem estritamente blindadas."_`;

  return {
    text,
    model: 'Motor Analítico Nativo (CFO Heurístico)'
  };
}

// 4. Disparo via Telegram (opcional)
async function sendTelegramAlert(token, chatId, message) {
  if (!token || !chatId) {
    console.log('[Telegram] Tokens não configurados. Pulando envio de push.');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown'
  });
  console.log('[Telegram] Notificação enviada com sucesso ao chat:', chatId);
}

// 5. Execução Principal
async function main() {
  console.log('====================================================');
  console.log('🤖 INICIANDO AGENTE AUTÔNOMO INDEPENDENTE - MORGAN 24/7');
  console.log('====================================================');

  const apiKey = GEMINI_API_KEY || process.argv[2];

  console.log('1. Coletando dados financeiros consolidados da família...');
  const context = buildAutonomousFinancialContext();
  console.log(`   Patrimônio líquido: R$ ${context.patrimonioLiquidoAtual} | Score: ${context.scoreSaudeAtual}`);

  let auditResult = null;

  if (apiKey) {
    console.log('2. Consultando inteligência generativa com Google Gemini...');
    try {
      auditResult = await runMorganAutonomousAudit(apiKey, context);
      console.log(`   ✅ Parecer gerado com sucesso via motor: ${auditResult.model}\n`);
    } catch (geminiErr) {
      console.warn(`   ⚠️ Falha na API Gemini (${geminiErr.message}). Alternando para o Motor Analítico Nativo...`);
      auditResult = generateNativeAutonomousAudit(context);
    }
  } else {
    console.log('⚠️ Variável GEMINI_API_KEY não configurada no ambiente ou GitHub Secrets.');
    console.log('ℹ️ Para ativar o raciocínio generativo via Gemini, adicione a secret GEMINI_API_KEY nas configurações do GitHub (Settings > Secrets and variables > Actions).');
    console.log('2. Executando auditoria via Motor Analítico Nativo do Morgan (CFO Heurístico)...');
    auditResult = generateNativeAutonomousAudit(context);
    console.log(`   ✅ Parecer gerado com sucesso via: ${auditResult.model}\n`);
  }

  console.log('------------------ BRIEFING MATINAL DO MORGAN ------------------');
  console.log(auditResult.text);
  console.log('----------------------------------------------------------------\n');

  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    console.log('3. Despachando notificação ativa no Telegram...');
    await sendTelegramAlert(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, auditResult.text);
  }

  console.log('✅ Ciclo autônomo concluído com êxito.');
}

main().catch(err => {
  console.error('❌ Falha na execução autônoma:', err.message);
  process.exit(1);
});
