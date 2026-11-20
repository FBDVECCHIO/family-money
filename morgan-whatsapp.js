/**
 * ============================================================================
 * MORGAN WHATSAPP GATEWAY 24/7 (CONEXÃO DIRETA VIA QR CODE / BAILEYS & META)
 * ============================================================================
 * Conecta o Agente Financeiro Morgan diretamente ao WhatsApp via protocolo
 * WhatsApp Web Multi-Device (@whiskeysockets/baileys) com QR Code ao vivo
 * direto no painel do Family Money — SEM precisar da Meta for Developers!
 *
 * Funcionalidades:
 *  - Geração de QR Code PNG (Base64 Data URL) em tempo real na interface web
 *  - Persistência híbrida da sessão (Disco + Backup automático no PostgreSQL)
 *  - Isolamento estrito de privacidade: 100% silencioso em conversas não pareadas
 *    (permite conectar o próprio WhatsApp pessoal e operar apenas no Grupo da Família)
 *  - Suporte completo a Texto, Áudio de Voz (PTT .ogg) e Fotos de Comprovantes
 *  - Comandos rápidos em português: "desfazer", "confirmar", "cancelar", "briefing", "saldos", "cartoes"
 *  - Pareamento seguro por PIN (/parear 1202)
 */

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');
const db = require('./db');
const engine = require('./morgan-finance-engine');
const agent = require('./morgan-agent');

const AUTH_DIR = path.join(__dirname, 'data', 'wa_auth_info');

let waSocket = null;
let waState = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
let currentQrDataUrl = null;
let waUser = null;
let waLastError = null;
let reconnectTimer = null;
let isStarting = false;
let syncAuthTimer = null;

// Conjunto de IDs de mensagens enviadas pela própria Morgan (evita loop infinito quando fromMe=true)
const sentByMorganIds = new Set();
let lastMorganReplyText = '';
let lastMorganReplyTime = 0;

/**
 * Converte Markdown do Morgan (**negrito**) para formatação nativa do WhatsApp (*negrito*)
 */
function formatMarkdownForWhatsApp(mdText = '', actions = []) {
  let out = String(mdText || '')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .trim();

  // Anexar instruções rápidas de governança (Desfazer / Confirmar / Cancelar)
  for (const act of (actions || [])) {
    if (act.requiresConfirmation && act.actionLogId) {
      out += `\n\n⚠️ _Aguardando autorização (#${act.actionLogId}). Responda_ *confirmar* _ou_ *cancelar*`;
    } else if (act.canUndo && act.actionLogId) {
      out += `\n\n↩️ _Para reverter este lançamento (#${act.actionLogId}), responda:_ *desfazer*`;
    }
  }

  return out;
}

/**
 * Verifica se o texto parece ser uma resposta gerada pela própria Morgan (segurança dupla anti-loop)
 */
function isMorganOwnOutputText(text = '') {
  const t = String(text || '').trim();
  if (!t) return false;
  if (lastMorganReplyText && t === lastMorganReplyText && (Date.now() - lastMorganReplyTime) < 20000) {
    return true;
  }
  const botPrefixes = [
    '🛡️ *Canal WhatsApp',
    '🛡️ *WhatsApp Vinculado',
    '🛡️ *Acesso Autorizado',
    '📊 *Posição de Liquidez',
    '💳 *Matriz Tática',
    '☀️ *Bom dia, Família!',
    '✅ *Lançamento Registrado',
    '✅ *Transferência Concluída',
    '✅ *Operação Confirmada',
    '✅ *Operação Concluída',
    '↩️ *Ação Desfeita',
    '⚠️ *Governança Híbrida',
    '🧮 *Simulação Estratégica',
    '🧠 *Memória Estratégica',
    '👋 *Olá,',
    '❌ *PIN incorreto'
  ];
  return botPrefixes.some(p => t.startsWith(p));
}

/**
 * Salva os arquivos de sessão do Baileys no banco (morgan_settings.whatsapp_session_json)
 * para sobreviver a rebuilds de container no Coolify/Hetzner
 */
function scheduleBackupAuthToDb() {
  if (syncAuthTimer) clearTimeout(syncAuthTimer);
  syncAuthTimer = setTimeout(async () => {
    try {
      if (!fs.existsSync(AUTH_DIR)) return;
      const files = fs.readdirSync(AUTH_DIR);
      if (files.length === 0) return;

      const snapshot = {};
      for (const file of files) {
        // Priorizar creds.json e chaves essenciais (limitando tamanho para eficiência)
        const fullPath = path.join(AUTH_DIR, file);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.size < 120000) {
          snapshot[file] = fs.readFileSync(fullPath, 'utf-8');
        }
      }
      if (snapshot['creds.json']) {
        await db.updateMorganSettings({ whatsapp_session_json: snapshot });
      }
    } catch (err) {
      console.warn('[MORGAN-WHATSAPP] Aviso ao sincronizar sessão no banco:', err.message);
    }
  }, 2000);
}

/**
 * Restaura os arquivos de sessão do banco para o disco caso o container tenha sido recriado
 */
async function restoreAuthFromDbIfNeeded() {
  try {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (fs.existsSync(credsPath)) return true;

    const settings = await db.getMorganSettings();
    let sessionObj = settings.whatsapp_session_json;
    if (typeof sessionObj === 'string') {
      try { sessionObj = JSON.parse(sessionObj); } catch (e) { sessionObj = null; }
    }

    if (sessionObj && typeof sessionObj === 'object' && sessionObj['creds.json']) {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }
      for (const [filename, content] of Object.entries(sessionObj)) {
        if (typeof content === 'string') {
          fs.writeFileSync(path.join(AUTH_DIR, filename), content, 'utf-8');
        }
      }
      console.log('[MORGAN-WHATSAPP] Sessão WhatsApp restaurada automaticamente do banco de dados.');
      return true;
    }
  } catch (err) {
    console.warn('[MORGAN-WHATSAPP] Aviso ao restaurar sessão do banco:', err.message);
  }
  return false;
}

/**
 * Envia mensagem pelo socket Baileys registrando o ID para prevenção anti-loop
 */
async function sendBaileysMessage(jid, text, actions = [], quotedMsg = null) {
  if (!waSocket || waState !== 'connected') {
    return { ok: false, error: 'WhatsApp não está conectado via QR Code.' };
  }

  try {
    const formattedText = formatMarkdownForWhatsApp(text, actions);
    lastMorganReplyText = formattedText;
    lastMorganReplyTime = Date.now();

    const opts = quotedMsg ? { quoted: quotedMsg } : {};
    const sent = await waSocket.sendMessage(jid, { text: formattedText }, opts);

    if (sent && sent.key && sent.key.id) {
      sentByMorganIds.add(sent.key.id);
      // Limpar IDs antigos após 5 minutos para não crescer memória
      setTimeout(() => sentByMorganIds.delete(sent.key.id), 5 * 60 * 1000);
    }

    return { ok: true, messageId: sent?.key?.id };
  } catch (err) {
    console.error('[MORGAN-WHATSAPP] Erro ao enviar mensagem Baileys:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Extrai o texto de uma mensagem Baileys (suporta texto simples, texto estendido, legenda de foto, etc.)
 */
function extractBaileysMessageText(m) {
  if (!m) return '';
  // Desembrulhar ephemeralMessage / viewOnceMessage se presente
  const content = m.ephemeralMessage?.message
    || m.viewOnceMessage?.message
    || m.viewOnceMessageV2?.message
    || m;

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.imageMessage?.caption ||
    content.videoMessage?.caption ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.templateButtonReplyMessage?.selectedId ||
    ''
  ).trim();
}

/**
 * Desembrulha o objeto de conteúdo interno da mensagem Baileys
 */
function unwrapBaileysContent(m) {
  if (!m) return {};
  return m.ephemeralMessage?.message
    || m.viewOnceMessage?.message
    || m.viewOnceMessageV2?.message
    || m;
}

/**
 * Processa cada mensagem recebida via Baileys
 */
async function handleIncomingBaileysMessage(msg, baileysMod) {
  try {
    if (!msg || !msg.key || !msg.message) return;

    const remoteJid = String(msg.key.remoteJid || '');
    const msgId = String(msg.key.id || '');

    // 1. Ignorar Status, Canais e Mensagens enviadas pela própria Morgan
    if (!remoteJid || remoteJid === 'status@broadcast' || remoteJid.endsWith('@newsletter') || remoteJid.endsWith('@broadcast')) {
      return;
    }
    if (sentByMorganIds.has(msgId)) {
      return;
    }

    const innerContent = unwrapBaileysContent(msg.message);
    const rawText = extractBaileysMessageText(msg.message);
    const hasAudio = Boolean(innerContent.audioMessage);
    const hasImage = Boolean(innerContent.imageMessage);

    if (!rawText && !hasAudio && !hasImage) {
      return;
    }

    // Segurança dupla anti-loop: nunca processar textos que são respostas da própria Morgan
    if (rawText && isMorganOwnOutputText(rawText)) {
      return;
    }

    const isGroup = remoteJid.endsWith('@g.us');
    const senderName = msg.pushName || (msg.key.fromMe ? 'Senhor' : 'Família');

    const settings = await db.getMorganSettings();
    const allowedJids = (settings.whatsapp_allowed_numbers || []).map(String);

    // 2. Comando de Pareamento Seguro por PIN (/parear 1202)
    // Funciona em qualquer Grupo ou Conversa (mesmo que tenha sido enviado pelo próprio celular conectado!)
    const isPairCmd = /^\/parear(?:@\S+)?\b/i.test(rawText);
    if (isPairCmd) {
      const pinArg = rawText.replace(/^\/parear(?:@\S+)?\s*/i, '').trim();
      const user = await db.authenticatePin(pinArg);
      if (user) {
        if (!allowedJids.includes(remoteJid)) {
          allowedJids.push(remoteJid);
          await db.updateMorganSettings({ whatsapp_allowed_numbers: allowedJids });
          engine.notifyMutation('morgan_settings', 'update', { whatsapp_allowed_numbers: allowedJids });
        }
        const channelLabel = isGroup ? 'Este Grupo do WhatsApp' : 'Esta Conversa do WhatsApp';
        const welcome = `🛡️ *Canal WhatsApp Autorizado com Sucesso, ${user.name}!*\n\n${channelLabel} (\`${remoteJid}\`) está oficialmente vinculado ao *CFO Morgan 24/7* no Family Money.\n\n*Como interagir comigo aqui:*\n• 🎙️ *Envie Áudio:* _"Morgan, gastei 120 de mercado no cartão Nubank"_\n• 📸 *Envie Foto de Comprovante:* Eu leio o valor e já lanço na conta\n• 💸 *Comandos Rápidos:* Digite *briefing*, *saldos*, *cartoes* ou *desfazer*\n• 🔒 *Privacidade Blindada:* Eu fico 100% silencioso em todas as suas outras conversas pessoais.`;
        await sendBaileysMessage(remoteJid, welcome, [], msg);
      } else {
        await sendBaileysMessage(remoteJid, `❌ *PIN incorreto.* Para vincular este chat ou grupo ao Family Money, envie:\n*/parear 1202*`, [], msg);
      }
      return;
    }

    // 3. ISOLAMENTO ESTRITO DE PRIVACIDADE:
    // Se este chat/grupo NÃO estiver na lista de pareados, ignorar com 100% de silêncio!
    // Isso garante que se o usuário conectou seu WhatsApp pessoal, a Morgan NUNCA responda a amigos/clientes.
    if (!allowedJids.includes(remoteJid)) {
      return;
    }

    console.log(`[MORGAN-WHATSAPP] Mensagem em canal pareado (${remoteJid}) de ${senderName}: "${rawText || '[Mídia]'}"`);

    const lowerCmd = rawText.toLowerCase().trim().replace(/^\//, '');

    // 4. Comandos Rápidos de Governança: "desfazer", "desfaz", "confirmar", "cancelar"
    if (/^(desfaz(?:er|a)?|deafazer|undo|estorn(?:ar|e)?|revert(?:er|a)?|volta atr[aá]s|cancela isso|desfaz\s+(?:essa|esse|o|a)?\s*(?:despesa|lancamento|operacao)?)(?:\s+#?(\d+))?$/i.test(lowerCmd)) {
      const match = lowerCmd.match(/(\d+)/);
      let targetLogId = match ? parseInt(match[1], 10) : null;
      if (!targetLogId) {
        const recentLogs = await db.selectRows('morgan_action_logs', { order: 'id.desc', limit: '10' });
        const lastExec = (recentLogs || []).find(l => l.status === 'executed');
        if (lastExec) targetLogId = lastExec.id;
      }
      if (!targetLogId) {
        await sendBaileysMessage(remoteJid, '⚠️ Nenhuma ação recente encontrada para desfazer.', [], msg);
        return;
      }
      const res = await engine.undoExecutedAction(targetLogId);
      await sendBaileysMessage(remoteJid, res.ok ? res.summary : `⚠️ ${res.error}`, [], msg);
      return;
    }

    if (/^(confirmar|confirmo)(?:\s+#?(\d+))?$/i.test(lowerCmd)) {
      const match = lowerCmd.match(/(\d+)/);
      let targetLogId = match ? parseInt(match[1], 10) : null;
      if (!targetLogId) {
        const recentLogs = await db.selectRows('morgan_action_logs', { order: 'id.desc', limit: '10' });
        const lastPending = (recentLogs || []).find(l => l.status === 'pending_confirmation');
        if (lastPending) targetLogId = lastPending.id;
      }
      if (!targetLogId) {
        await sendBaileysMessage(remoteJid, '⚠️ Nenhuma operação pendente aguardando confirmação.', [], msg);
        return;
      }
      const res = await engine.confirmPendingAction(targetLogId);
      await sendBaileysMessage(
        remoteJid,
        res.ok ? `✅ *Operação Confirmada e Executada!*\n\n${res.summary}` : `⚠️ ${res.error}`,
        res.canUndo ? [res] : [],
        msg
      );
      return;
    }

    if (/^(cancelar)(?:\s+#?(\d+))?$/i.test(lowerCmd)) {
      const match = lowerCmd.match(/(\d+)/);
      let targetLogId = match ? parseInt(match[1], 10) : null;
      if (!targetLogId) {
        const recentLogs = await db.selectRows('morgan_action_logs', { order: 'id.desc', limit: '10' });
        const lastPending = (recentLogs || []).find(l => l.status === 'pending_confirmation');
        if (lastPending) targetLogId = lastPending.id;
      }
      if (!targetLogId) {
        await sendBaileysMessage(remoteJid, '⚠️ Nenhuma operação pendente para cancelar.', [], msg);
        return;
      }
      const res = await engine.cancelPendingAction(targetLogId);
      await sendBaileysMessage(remoteJid, res.ok ? res.summary : `⚠️ ${res.error}`, [], msg);
      return;
    }

    // 5. Atalhos Executivos Diretos: "briefing", "saldos", "cartoes"
    if (lowerCmd === 'briefing') {
      const briefing = await engine.buildExecutiveBriefingText();
      await sendBaileysMessage(remoteJid, briefing.text, [], msg);
      return;
    }
    if (lowerCmd === 'saldos' || lowerCmd === 'saldo') {
      const out = await agent.runLocalAutonomousParserAndReasoning('Me mostre os saldos e a projeção de 6 meses', { channel: 'whatsapp', chatId: remoteJid, senderName });
      await sendBaileysMessage(remoteJid, out.reply, [], msg);
      return;
    }
    if (lowerCmd === 'cartoes' || lowerCmd === 'cartao' || lowerCmd === 'cartões' || lowerCmd === 'cartão') {
      const out = await agent.runLocalAutonomousParserAndReasoning('Qual o melhor cartão para usar hoje?', { channel: 'whatsapp', chatId: remoteJid, senderName });
      await sendBaileysMessage(remoteJid, out.reply, [], msg);
      return;
    }

    // Indicar "digitando..." no WhatsApp
    try {
      await waSocket.sendPresenceUpdate('composing', remoteJid);
    } catch (e) {}

    // 6. Baixar Mídia (Áudio de Voz ou Foto de Comprovante) se presente
    let media = null;
    if ((hasAudio || hasImage) && baileysMod && baileysMod.downloadMediaMessage) {
      try {
        const buffer = await baileysMod.downloadMediaMessage(
          msg,
          'buffer',
          {},
          {
            logger: pino({ level: 'silent' }),
            reuploadRequest: waSocket.updateMediaMessage
          }
        );
        if (buffer) {
          const base64Data = Buffer.from(buffer).toString('base64');
          const mimeType = hasAudio
            ? (innerContent.audioMessage?.mimetype || 'audio/ogg').split(';')[0]
            : (innerContent.imageMessage?.mimetype || 'image/jpeg').split(';')[0];
          media = { mimeType, base64Data };
        }
      } catch (mediaErr) {
        console.warn('[MORGAN-WHATSAPP] Erro ao baixar mídia do WhatsApp:', mediaErr.message);
      }
    }

    // 7. Processar no Núcleo Cognitivo do Morgan (Gemini Function Calling + Fallback)
    const agentResponse = await agent.processMorganMessage({
      text: rawText,
      media,
      channel: 'whatsapp',
      chatId: remoteJid,
      senderName
    });

    await sendBaileysMessage(remoteJid, agentResponse.reply, agentResponse.actions || [], msg);
  } catch (err) {
    console.error('[MORGAN-WHATSAPP] Erro ao processar mensagem recebida:', err.message);
  }
}

/**
 * Inicia ou reinicia a sessão Baileys do WhatsApp
 */
async function startWhatsAppSession(forceNewQr = false) {
  if (isStarting) {
    return getWhatsAppStatus();
  }
  isStarting = true;

  try {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (forceNewQr) {
      // Fechar socket anterior e limpar sessão se o usuário pediu novo QR Code
      if (waSocket) {
        try { waSocket.end(undefined); } catch (e) {}
        waSocket = null;
      }
      if (fs.existsSync(AUTH_DIR)) {
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
      }
      await db.updateMorganSettings({ whatsapp_session_json: null });
    } else {
      await restoreAuthFromDbIfNeeded();
    }

    // Se não há sessão salva no disco e o usuário não clicou em "Gerar QR Code", manter desconectado até ele solicitar
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (!forceNewQr && !fs.existsSync(credsPath)) {
      waState = 'disconnected';
      isStarting = false;
      return getWhatsAppStatus();
    }

    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version = [2, 3000, 1015901307];
    try {
      const latest = await fetchLatestBaileysVersion();
      if (latest && latest.version) version = latest.version;
    } catch (e) {}

    if (waSocket) {
      try { waSocket.end(undefined); } catch (e) {}
      waSocket = null;
    }

    waState = 'connecting';
    waLastError = null;

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers ? Browsers.macOS('Morgan CFO - Family Money') : ['Family Money', 'Chrome', '120.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false
    });

    waSocket = sock;

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      scheduleBackupAuthToDb();
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQrDataUrl = await QRCode.toDataURL(qr, {
            width: 280,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' }
          });
          waState = 'qr_ready';
          console.log('[MORGAN-WHATSAPP] Novo QR Code gerado e pronto para leitura no painel.');
          engine.notifyMutation('morgan_settings', 'update', { whatsappState: 'qr_ready' });
        } catch (qrErr) {
          console.error('[MORGAN-WHATSAPP] Erro ao renderizar QR Code:', qrErr.message);
        }
      }

      if (connection === 'open') {
        waState = 'connected';
        currentQrDataUrl = null;
        waLastError = null;
        const rawId = sock.user?.id || '';
        const cleanPhone = rawId.split(':')[0].split('@')[0];
        waUser = {
          id: rawId,
          phone: cleanPhone,
          name: sock.user?.name || 'Morgan CFO'
        };
        console.log(`[MORGAN-WHATSAPP] WhatsApp conectado com sucesso! Número: ${cleanPhone} (${waUser.name})`);
        scheduleBackupAuthToDb();
        engine.notifyMutation('morgan_settings', 'update', { whatsappState: 'connected', phone: cleanPhone });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.warn(`[MORGAN-WHATSAPP] Conexão encerrada (código: ${statusCode}). Reconectar: ${shouldReconnect}`);

        if (shouldReconnect) {
          waState = 'connecting';
          reconnectTimer = setTimeout(() => {
            startWhatsAppSession(false).catch(() => {});
          }, 3500);
        } else {
          // Desconectado pelo celular (Logout)
          waState = 'disconnected';
          currentQrDataUrl = null;
          waUser = null;
          if (fs.existsSync(AUTH_DIR)) {
            try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
          }
          await db.updateMorganSettings({ whatsapp_session_json: null });
          engine.notifyMutation('morgan_settings', 'update', { whatsappState: 'disconnected' });
        }
      }
    });

    sock.ev.on('messages.upsert', async (event) => {
      if (event.type !== 'notify') return;
      for (const msg of (event.messages || [])) {
        await handleIncomingBaileysMessage(msg, baileys);
      }
    });

    isStarting = false;
    return getWhatsAppStatus();
  } catch (err) {
    console.error('[MORGAN-WHATSAPP] Falha ao iniciar sessão Baileys:', err.message);
    waState = 'disconnected';
    waLastError = err.message;
    isStarting = false;
    return getWhatsAppStatus();
  }
}

/**
 * Desconecta e limpa a sessão atual do WhatsApp
 */
async function disconnectWhatsAppSession() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (waSocket) {
    try { await waSocket.logout(); } catch (e) {}
    try { waSocket.end(undefined); } catch (e) {}
    waSocket = null;
  }
  waState = 'disconnected';
  currentQrDataUrl = null;
  waUser = null;
  if (fs.existsSync(AUTH_DIR)) {
    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch (e) {}
  }
  await db.updateMorganSettings({ whatsapp_session_json: null });
  engine.notifyMutation('morgan_settings', 'update', { whatsappState: 'disconnected' });
  return getWhatsAppStatus();
}

/**
 * Retorna o status em tempo real do conector WhatsApp
 */
function getWhatsAppStatus() {
  return {
    active: waState === 'connected',
    state: waState, // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    qrDataUrl: currentQrDataUrl,
    user: waUser,
    lastError: waLastError
  };
}

/**
 * Envia o Briefing Executivo Matinal para todos os chats/grupos pareados no WhatsApp
 */
async function broadcastWhatsAppBriefing(customJid = null) {
  if (!waSocket || waState !== 'connected') {
    return { ok: false, error: 'WhatsApp não está conectado.' };
  }
  const settings = await db.getMorganSettings();
  const allowedJids = (settings.whatsapp_allowed_numbers || []).map(String);
  const recipients = customJid ? [String(customJid)] : allowedJids;

  if (recipients.length === 0) {
    return { ok: false, error: 'Nenhum chat ou grupo pareado no WhatsApp. Envie /parear 1202 no WhatsApp.' };
  }

  const briefing = await engine.buildExecutiveBriefingText();
  const results = [];
  for (const jid of recipients) {
    const res = await sendBaileysMessage(jid, briefing.text, []);
    results.push({ jid, ok: res.ok });
  }
  return { ok: true, sentTo: results };
}

// ============================================================================
// COMPATIBILIDADE LEGADA: META CLOUD API WEBHOOKS
// ============================================================================

async function verifyMetaWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const settings = await db.getMorganSettings();
  const expectedToken = settings.whatsapp_verify_token || process.env.WHATSAPP_VERIFY_TOKEN || 'familymoney_morgan_secret';
  if (mode === 'subscribe' && token === expectedToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
}

async function sendMetaWhatsAppMessage(to, text, actions = [], settingsOverride = null) {
  // Se o Baileys estiver conectado, priorizar o envio direto via Baileys!
  if (waSocket && waState === 'connected') {
    const jid = String(to).includes('@') ? String(to) : `${String(to).replace(/\D/g, '')}@s.whatsapp.net`;
    return sendBaileysMessage(jid, text, actions);
  }
  return { ok: false, error: 'WhatsApp não conectado.' };
}

async function handleMetaWhatsAppWebhook() {
  return true;
}

module.exports = {
  startWhatsAppSession,
  disconnectWhatsAppSession,
  getWhatsAppStatus,
  sendBaileysMessage,
  broadcastWhatsAppBriefing,
  verifyMetaWebhook,
  handleMetaWhatsAppWebhook,
  sendMetaWhatsAppMessage
};
