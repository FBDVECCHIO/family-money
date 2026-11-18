/**
 * ============================================================================
 * MORGAN TELEGRAM BOT GATEWAY & WHATSAPP WEBHOOK ADAPTER
 * ============================================================================
 * Conecta o cérebro do Morgan ao Telegram Bot Oficial (Long Polling resiliente)
 * e expõe adaptador para WhatsApp (Evolution API / Cloud API).
 * Suporta:
 *  - Mensagens de Texto em linguagem natural e comandos rápidos (/briefing, /cartoes, /saldos)
 *  - Notas de Voz / Áudio (.ogg) para lançamentos falando
 *  - Fotos de Comprovantes / Notas Fiscais (.jpg/.png)
 *  - Botões Interativos Inline ([✅ Confirmar], [❌ Cancelar], [↩️ Desfazer], [✅ Efetivar])
 *  - Pareamento seguro por PIN (/parear 1202)
 */

const db = require('./db');
const engine = require('./morgan-finance-engine');
const agent = require('./morgan-agent');

let pollingActive = false;
let currentToken = '';
let lastUpdateId = 0;
let pollingTimer = null;
let botProfile = null;
let pollingGeneration = 0;

/**
 * Converte Markdown simples do Morgan para HTML seguro do Telegram
 */
function markdownToTelegramHtml(mdText = '') {
  let html = String(mdText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Negrito **texto**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // Código inline `texto`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Itálico *texto*
  html = html.replace(/(^|\s)\*([^*\n]+)\*/g, '$1<i>$2</i>');

  return html;
}

/**
 * Chamada HTTP genérica para a API do Telegram Bot
 */
async function callTelegramApi(token, method, body = null) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const opts = {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  };
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({ ok: false }));
  return data;
}

/**
 * Baixa um arquivo (voz ou foto) dos servidores do Telegram e retorna Base64
 */
async function downloadTelegramFileAsBase64(token, fileId, defaultMime = 'audio/ogg') {
  const fileInfo = await callTelegramApi(token, 'getFile', { file_id: fileId });
  if (!fileInfo.ok || !fileInfo.result?.file_path) {
    throw new Error('Não foi possível obter o caminho do arquivo no Telegram.');
  }
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Falha ao baixar mídia do Telegram: HTTP ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString('base64');

  let mimeType = defaultMime;
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
  else if (filePath.endsWith('.png')) mimeType = 'image/png';
  else if (filePath.endsWith('.ogg') || filePath.endsWith('.oga')) mimeType = 'audio/ogg';
  else if (filePath.endsWith('.mp3')) mimeType = 'audio/mp3';
  else if (filePath.endsWith('.mp4') || filePath.endsWith('.m4a')) mimeType = 'audio/mp4';

  return { mimeType, base64Data };
}

/**
 * Constrói o teclado inline (botões interativos) para as ações retornadas pelo Morgan
 */
function buildInlineKeyboardForActions(actions = [], extraButtons = []) {
  const keyboard = [];

  for (const act of actions) {
    if (act.requiresConfirmation && act.actionLogId) {
      keyboard.push([
        { text: `✅ Confirmar #${act.actionLogId}`, callback_data: `confirm:${act.actionLogId}` },
        { text: `❌ Cancelar`, callback_data: `cancel:${act.actionLogId}` }
      ]);
    } else if (act.canUndo && act.actionLogId) {
      keyboard.push([
        { text: `↩️ Desfazer Ação #${act.actionLogId}`, callback_data: `undo:${act.actionLogId}` }
      ]);
    }
  }

  for (const row of extraButtons) {
    keyboard.push(row);
  }

  return keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined;
}

/**
 * Envia mensagem formatada para um Chat ID do Telegram
 */
async function sendTelegramMessage(chatId, text, replyMarkup = undefined, tokenOverride = null, replyToMessageId = null) {
  const settings = await db.getMorganSettings();
  const token = (tokenOverride || settings.telegram_bot_token || currentToken || '').trim();
  if (!token) {
    return { ok: false, error: 'Token do Bot do Telegram não configurado.' };
  }

  const htmlText = markdownToTelegramHtml(text);
  const payload = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: 'HTML'
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  if (replyToMessageId) {
    payload.reply_to_message_id = replyToMessageId;
    payload.allow_sending_without_reply = true;
  }

  let res = await callTelegramApi(token, 'sendMessage', payload);
  // Fallback para texto puro caso haja algum caractere HTML não fechado
  if (!res.ok) {
    const fallbackPayload = {
      chat_id: chatId,
      text: String(text || ''),
      reply_markup: replyMarkup
    };
    if (replyToMessageId) {
      fallbackPayload.reply_to_message_id = replyToMessageId;
      fallbackPayload.allow_sending_without_reply = true;
    }
    res = await callTelegramApi(token, 'sendMessage', fallbackPayload);
  }
  return res;
}

/**
 * Envia o Briefing Executivo para todos os Chat IDs autorizados no Telegram
 */
async function broadcastTelegramBriefing(customChatId = null) {
  const settings = await db.getMorganSettings();
  const token = (settings.telegram_bot_token || currentToken || '').trim();
  if (!token) {
    return { ok: false, error: 'Token do Telegram não configurado.' };
  }

  const targetChats = customChatId
    ? [String(customChatId)]
    : (settings.telegram_allowed_chat_ids || []).map(String);

  if (targetChats.length === 0) {
    return {
      ok: false,
      error: 'Nenhum Chat ID autorizado ainda. Abra seu bot no Telegram e envie /parear 1202.'
    };
  }

  const briefing = await engine.buildExecutiveBriefingText();
  const extraRows = [];

  // Adicionar botões para efetivar pendências de hoje com 1 clique
  for (const pt of (briefing.pendingTransactions || []).slice(0, 3)) {
    extraRows.push([
      {
        text: `✅ Efetivar: ${pt.description.slice(0, 22)} (${engine.formatBRL(pt.amount)})`,
        callback_data: `conciliate:${pt.id}`
      }
    ]);
  }

  extraRows.push([
    { text: '💳 Melhor Cartão Hoje', callback_data: 'quick:cards' },
    { text: '💰 Saldos & Projeção', callback_data: 'quick:balances' }
  ]);

  const replyMarkup = buildInlineKeyboardForActions([], extraRows);
  const results = [];

  for (const cid of targetChats) {
    const r = await sendTelegramMessage(cid, briefing.text, replyMarkup, token);
    results.push({ chatId: cid, ok: r.ok });
  }

  return { ok: true, sentTo: results, briefingText: briefing.text };
}

/**
 * Processa cliques nos botões inline do Telegram (callback_query)
 */
async function handleTelegramCallbackQuery(token, cbQuery) {
  const chatId = String(cbQuery.message?.chat?.id || cbQuery.from?.id);
  const data = String(cbQuery.data || '');

  await callTelegramApi(token, 'answerCallbackQuery', {
    callback_query_id: cbQuery.id,
    text: 'Processando comando no Family Money...'
  });

  if (data.startsWith('undo:')) {
    const logId = parseInt(data.split(':')[1], 10);
    const res = await engine.undoExecutedAction(logId);
    await sendTelegramMessage(chatId, res.ok ? res.summary : `⚠️ ${res.error}`, undefined, token);
    return;
  }

  if (data.startsWith('confirm:')) {
    const logId = parseInt(data.split(':')[1], 10);
    const res = await engine.confirmPendingAction(logId);
    const markup = res.ok && res.canUndo
      ? buildInlineKeyboardForActions([res])
      : undefined;
    await sendTelegramMessage(
      chatId,
      res.ok ? `✅ **Operação Confirmada e Executada!**\n\n${res.summary}` : `⚠️ ${res.error}`,
      markup,
      token
    );
    return;
  }

  if (data.startsWith('cancel:')) {
    const logId = parseInt(data.split(':')[1], 10);
    const res = await engine.cancelPendingAction(logId);
    await sendTelegramMessage(chatId, res.ok ? res.summary : `⚠️ ${res.error}`, undefined, token);
    return;
  }

  if (data.startsWith('conciliate:')) {
    const txId = parseInt(data.split(':')[1], 10);
    const res = await engine.executeToolAction('conciliate_transaction', {
      transaction_id: txId,
      is_effective: true
    }, { channel: 'telegram', chatId });
    const markup = res.ok && res.canUndo ? buildInlineKeyboardForActions([res]) : undefined;
    await sendTelegramMessage(chatId, res.ok ? `✅ ${res.summary}` : `⚠️ ${res.error}`, markup, token);
    return;
  }

  if (data === 'quick:briefing') {
    await broadcastTelegramBriefing(chatId);
    return;
  }

  if (data === 'quick:cards') {
    const out = await agent.runLocalAutonomousParserAndReasoning('Qual o melhor cartão para usar hoje?', { channel: 'telegram', chatId });
    await sendTelegramMessage(chatId, out.reply, undefined, token);
    return;
  }

  if (data === 'quick:balances') {
    const out = await agent.runLocalAutonomousParserAndReasoning('Me mostre os saldos e a projeção de 6 meses', { channel: 'telegram', chatId });
    await sendTelegramMessage(chatId, out.reply, undefined, token);
    return;
  }
}

/**
 * Processa uma mensagem recebida no Telegram (Texto, Voz, Foto ou Eventos de Grupo)
 */
async function handleTelegramMessage(token, msg) {
  if (!msg || !msg.chat) return;
  const chatId = String(msg.chat.id);
  const senderId = String(msg.from?.id || '');
  const senderName = msg.from?.first_name || 'Família';
  const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';
  const rawOriginal = String(msg.text || msg.caption || '').trim();
  // Limpar menção ao próprio bot (@MorganFM_Bot) para facilitar uso em grupos
  const rawText = rawOriginal.replace(/@\w*morgan\w*bot\b/gi, '').trim();

  const settings = await db.getMorganSettings();
  const allowedIds = (settings.telegram_allowed_chat_ids || []).map(String);

  // Auto-autorizar grupos onde um membro já autorizado (ex: Fábio) esteja presente
  if (isGroup && !allowedIds.includes(chatId) && senderId && allowedIds.includes(senderId)) {
    allowedIds.push(chatId);
    await db.updateMorganSettings({ telegram_allowed_chat_ids: allowedIds });
    console.log(`[MORGAN-TELEGRAM] Grupo ${chatId} autorizado automaticamente via membro pareado ${senderName} (${senderId}).`);
  }

  // Tratar eventos de criação de grupo ou adição do bot ao grupo
  const botWasAdded = Array.isArray(msg.new_chat_members) && msg.new_chat_members.some(m => m.is_bot && (!botProfile || m.id === botProfile.id));
  if (botWasAdded || msg.group_chat_created || msg.supergroup_chat_created) {
    if (allowedIds.includes(chatId)) {
      const groupWelcomeMarkup = buildInlineKeyboardForActions([], [
        [
          { text: '☀️ Briefing do Dia', callback_data: 'quick:briefing' },
          { text: '💳 Melhor Cartão Hoje', callback_data: 'quick:cards' }
        ],
        [
          { text: '💰 Saldos & Projeção 6m', callback_data: 'quick:balances' }
        ]
      ]);
      await sendTelegramMessage(
        chatId,
        `👋 **Olá, família! CFO Morgan ativo neste grupo!**\n\nEstou pronto para registrar despesas, transferências, ler comprovantes e responder dúvidas de todos os membros do grupo.\n\n⚠️ **Configuração Importante de Grupo no Telegram:**\nPor padrão, o Telegram bloqueia bots de lerem mensagens comuns (como *"oi?"* ou *"gastei 50"*) em grupos a menos que o bot seja Administrador.\n👉 **Como liberar em 5 segundos:** Toque no nome deste grupo no topo do Telegram ➔ **Editar / Administradores** ➔ **Adicionar Administrador** ➔ selecione **@MorganFM_Bot**!`,
        groupWelcomeMarkup,
        token
      );
    }
    return;
  }

  // Ignorar mensagens de serviço vazias do Telegram (ex: mensagem fixada, membro saiu, foto do grupo alterada)
  const hasMedia = Boolean(msg.voice || msg.audio || (msg.photo && msg.photo.length > 0));
  if (!rawText && !hasMedia) {
    return;
  }

  console.log(`[MORGAN-TELEGRAM] Mensagem recebida de ${senderName} (chat_id: ${chatId}, group: ${isGroup}): "${rawText || '[Mídia]'}"`);

  // 1. Comando de Pareamento Seguro por PIN (/parear 1202 ou apenas 1202 quando não pareado)
  const isPairCommand = /^\/parear(?:@\S+)?\b/i.test(rawText);
  const isDirectPinTry = !allowedIds.includes(chatId) && /^\d{4,6}$/.test(rawText);

  if (isPairCommand || isDirectPinTry) {
    const pinArg = isPairCommand ? rawText.replace(/^\/parear(?:@\S+)?\s*/i, '').trim() : rawText;
    const user = await db.authenticatePin(pinArg);
    if (user) {
      let updatedList = false;
      if (!allowedIds.includes(chatId)) {
        allowedIds.push(chatId);
        updatedList = true;
      }
      if (senderId && !allowedIds.includes(senderId)) {
        allowedIds.push(senderId);
        updatedList = true;
      }
      if (updatedList) {
        await db.updateMorganSettings({ telegram_allowed_chat_ids: allowedIds });
      }
      const welcomeMarkup = buildInlineKeyboardForActions([], [
        [
          { text: '☀️ Briefing do Dia', callback_data: 'quick:briefing' },
          { text: '💳 Melhor Cartão Hoje', callback_data: 'quick:cards' }
        ],
        [
          { text: '💰 Saldos & Projeção 6m', callback_data: 'quick:balances' }
        ]
      ]);
      const groupAdminNotice = isGroup
        ? `\n\n⚠️ **Dica para este Grupo:** Promova o **@MorganFM_Bot** a **Administrador do grupo** nas configurações do Telegram para que todos possam conversar livremente (ex: *"oi?"*, áudios e textos) sem precisar usar \`/\`!`
        : '';
      await sendTelegramMessage(
        chatId,
        `🛡️ **Acesso Autorizado, ${user.name}!**\n\nEste canal (Chat ID: \`${chatId}\`) está oficialmente vinculado ao **CFO Morgan 24/7** no servidor Family Money.\n\n**O que vocês podem fazer agora:**\n• 🎙️ **Enviar Áudio:** *"Morgan, passei 140 reais de mercado no cartão Nubank"*\n• 📸 **Enviar Foto de Comprovante:** Eu leio o valor e já lanço na conta\n• 💸 **Transferir e Conciliar:** *"Transfira 500 do ML Cofre para o Itaú PJ"*\n• 📊 **Consultar e Simular:** *"Posso comprar um notebook de 4500 em 10x?"*${groupAdminNotice}`,
        welcomeMarkup,
        token,
        msg.message_id
      );
      return;
    } else if (isPairCommand) {
      await sendTelegramMessage(
        chatId,
        `❌ **PIN incorreto.** Para vincular este chat ao Family Money, envie:\n\`/parear 1202\` *(ou apenas digite seu PIN de 4 dígitos)*`,
        undefined,
        token,
        msg.message_id
      );
      return;
    }
  }

  // 2. Comando /start
  if (/^\/start(?:@\S+)?$/i.test(rawText)) {
    const isAllowed = allowedIds.includes(chatId);
    if (!isAllowed) {
      await sendTelegramMessage(
        chatId,
        `👋 Olá, **${senderName}**! Eu sou o **Morgan**, Chief Financial Officer Autônomo do **Family Money**.\n\n🔒 Por segurança bancária, este canal exige autenticação única.\nSeu Chat ID é: \`${chatId}\`\n\nEnvie agora o comando abaixo (ou apenas o seu PIN) para liberar seu acesso:\n👉 \`/parear 1202\``,
        undefined,
        token,
        msg.message_id
      );
      return;
    }
    const greeting = await agent.processMorganMessage({
      text: 'oi',
      channel: 'telegram',
      chatId,
      senderName
    });
    const startMarkup = buildInlineKeyboardForActions([], [
      [
        { text: '☀️ Briefing do Dia', callback_data: 'quick:briefing' },
        { text: '💳 Melhor Cartão Hoje', callback_data: 'quick:cards' }
      ],
      [
        { text: '💰 Saldos & Projeção 6m', callback_data: 'quick:balances' }
      ]
    ]);
    await sendTelegramMessage(chatId, greeting.reply, startMarkup, token, msg.message_id);
    return;
  }

  // 3. Verificação de Whitelist (Segurança)
  if (!allowedIds.includes(chatId)) {
    await sendTelegramMessage(
      chatId,
      `🔒 **Acesso Restrito.** Este Chat ID (\`${chatId}\`) ainda não está pareado.\nEnvie \`/parear 1202\` para autenticar com o Family Money.`,
      undefined,
      token,
      msg.message_id
    );
    return;
  }

  // 4. Atalhos de comandos diretos (/briefing, /cartoes, /saldos ou texto puro "saldos", "briefing", "cartoes")
  const lowerCmd = rawText.toLowerCase().trim().replace(/^@\w*morgan\w*bot\b\s*/i, '');
  const cleanCmd = lowerCmd.replace(/^\//, '');
  if (cleanCmd === 'briefing' || lowerCmd.startsWith('/briefing@')) {
    await broadcastTelegramBriefing(chatId);
    return;
  }
  if (cleanCmd === 'cartoes' || cleanCmd === 'cartao' || lowerCmd.startsWith('/cartoes@')) {
    const out = await agent.runLocalAutonomousParserAndReasoning('Qual o melhor cartão para usar hoje?', { channel: 'telegram', chatId, senderName });
    await sendTelegramMessage(chatId, out.reply, undefined, token, isGroup ? msg.message_id : null);
    return;
  }
  if (cleanCmd === 'saldos' || cleanCmd === 'saldo' || lowerCmd.startsWith('/saldos@')) {
    const out = await agent.runLocalAutonomousParserAndReasoning('Me mostre os saldos e a projeção de 6 meses', { channel: 'telegram', chatId, senderName });
    await sendTelegramMessage(chatId, out.reply, undefined, token, isGroup ? msg.message_id : null);
    return;
  }

  // Indicar "digitando..." imediatamente no Telegram (sem bloquear com await longo)
  callTelegramApi(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  // 5. Verificar se há mídia anexada (Nota de Voz, Áudio ou Foto de Comprovante)
  let media = null;
  try {
    if (msg.voice) {
      media = await downloadTelegramFileAsBase64(token, msg.voice.file_id, msg.voice.mime_type || 'audio/ogg');
    } else if (msg.audio) {
      media = await downloadTelegramFileAsBase64(token, msg.audio.file_id, msg.audio.mime_type || 'audio/mp3');
    } else if (msg.photo && msg.photo.length > 0) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      media = await downloadTelegramFileAsBase64(token, largestPhoto.file_id, 'image/jpeg');
    }
  } catch (mediaErr) {
    console.warn('[MORGAN-TELEGRAM] Erro ao baixar mídia:', mediaErr.message);
  }

  // 6. Enviar para o Núcleo Cognitivo do Morgan (com senderName para respostas personalizadas)
  const agentResponse = await agent.processMorganMessage({
    text: rawText,
    media,
    channel: 'telegram',
    chatId,
    senderName
  });

  const replyMarkup = buildInlineKeyboardForActions(agentResponse.actions || []);
  await sendTelegramMessage(chatId, agentResponse.reply, replyMarkup, token, isGroup ? msg.message_id : null);
}

/**
 * Loop de Long Polling do Telegram Bot (Ultra-Responsivo, sem pausa artificial de 1.2s)
 */
async function pollTelegramUpdates(gen = pollingGeneration) {
  if (!pollingActive || !currentToken || gen !== pollingGeneration) return;

  let nextDelayMs = 80;
  try {
    const res = await callTelegramApi(currentToken, 'getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 15,
      allowed_updates: ['message', 'callback_query', 'my_chat_member']
    });

    if (gen !== pollingGeneration) return;

    if (res && res.ok && Array.isArray(res.result)) {
      for (const update of res.result) {
        if (update.update_id > lastUpdateId) {
          lastUpdateId = update.update_id;
        }
        // Processar update de forma assíncrona para não travar a fila de long-polling
        (async () => {
          try {
            if (update.message) {
              await handleTelegramMessage(currentToken, update.message);
            } else if (update.callback_query) {
              await handleTelegramCallbackQuery(currentToken, update.callback_query);
            }
          } catch (handlerErr) {
            console.error('[MORGAN-TELEGRAM] Erro ao processar update:', handlerErr.message);
          }
        })();
      }
    } else if (res && !res.ok) {
      console.warn('[MORGAN-TELEGRAM] Aviso em getUpdates:', res.description || res);
      nextDelayMs = 1500;
    }
  } catch (err) {
    nextDelayMs = 1500;
  } finally {
    if (pollingActive && gen === pollingGeneration) {
      pollingTimer = setTimeout(() => pollTelegramUpdates(gen), nextDelayMs);
    }
  }
}

/**
 * Inicializa ou reinicia o Bot do Telegram com o token configurado no banco
 */
async function startOrReloadTelegramBot(explicitToken = null) {
  const settings = await db.getMorganSettings();
  const token = (explicitToken || settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '').trim();

  if (!token) {
    pollingActive = false;
    currentToken = '';
    botProfile = null;
    pollingGeneration++;
    if (pollingTimer) clearTimeout(pollingTimer);
    return { active: false, reason: 'Token não configurado' };
  }

  if (pollingActive && currentToken === token && botProfile) {
    return { active: true, bot: botProfile };
  }

  // Testar o token com getMe
  try {
    const me = await callTelegramApi(token, 'getMe');
    if (!me.ok) {
      pollingActive = false;
      botProfile = null;
      return { active: false, error: me.description || 'Token inválido no Telegram' };
    }

    // Remover eventual webhook antigo (mas mantendo pending_update_count para responder mensagens que já foram enviadas!)
    await callTelegramApi(token, 'deleteWebhook', { drop_pending_updates: false });

    // Registrar comandos no menu do Telegram (aparece ao tocar em "/" no grupo ou chat privado)
    callTelegramApi(token, 'setMyCommands', {
      commands: [
        { command: 'briefing', description: 'Resumo executivo do dia e pendências' },
        { command: 'saldos', description: 'Saldos bancários e projeção de 6 meses' },
        { command: 'cartoes', description: 'Melhor cartão para usar hoje (ranking de float)' },
        { command: 'parear', description: 'Parear chat ou grupo com PIN (ex: /parear 1202)' }
      ]
    }).catch(() => {});

    currentToken = token;
    botProfile = me.result;
    pollingActive = true;
    pollingGeneration++;
    const myGen = pollingGeneration;
    if (pollingTimer) clearTimeout(pollingTimer);
    console.log(`[MORGAN-TELEGRAM] Bot ativo e conectado como @${botProfile.username} (${botProfile.first_name}) [can_read_all_group_messages=${botProfile.can_read_all_group_messages}]`);
    pollTelegramUpdates(myGen);

    return { active: true, bot: botProfile };
  } catch (err) {
    console.error('[MORGAN-TELEGRAM] Falha ao iniciar bot:', err.message);
    return { active: false, error: err.message };
  }
}

function getTelegramStatus() {
  return {
    active: pollingActive && !!botProfile,
    botUsername: botProfile ? botProfile.username : null,
    botName: botProfile ? botProfile.first_name : null,
    canReadAllGroupMessages: botProfile ? Boolean(botProfile.can_read_all_group_messages) : false
  };
}

/**
 * Adaptador Webhook para WhatsApp (Evolution API / Cloud API)
 */
async function handleWhatsAppWebhookPayload(payload = {}) {
  // Compatível com Evolution API (messages.upsert) ou payload simplificado { from, text }
  const data = payload.data || payload;
  const from = data.key?.remoteJid || payload.from || 'whatsapp_user';
  const text = data.message?.conversation
    || data.message?.extendedTextMessage?.text
    || payload.text
    || '';

  if (!text) {
    return { ok: false, ignored: true, reason: 'Mensagem sem texto' };
  }

  const response = await agent.processMorganMessage({
    text,
    channel: 'whatsapp',
    chatId: String(from)
  });

  return {
    ok: true,
    channel: 'whatsapp',
    to: from,
    reply: response.reply,
    actions: response.actions
  };
}

module.exports = {
  startOrReloadTelegramBot,
  getTelegramStatus,
  sendTelegramMessage,
  broadcastTelegramBriefing,
  handleWhatsAppWebhookPayload,
  markdownToTelegramHtml
};
