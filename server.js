const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const db = require('./db');
const morganEngine = require('./morgan-finance-engine');
const morganAgent = require('./morgan-agent');
const morganTelegram = require('./morgan-telegram');
const morganScheduler = require('./morgan-scheduler');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = '9.1';
const BUILD_TIME = Date.now();

// Habilitar CORS e Parse de JSON
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Middleware de Cabeçalhos de Segurança
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ================= ROTAS DE API DA BASE DE DADOS =================

// Status da base de dados e infraestrutura
app.get('/api/status', async (req, res) => {
  try {
    const status = await db.getStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Autenticação rápida por PIN (Fábio Pai: 1202)
app.post('/api/auth/pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN não fornecido' });
    const user = await db.authenticatePin(pin);
    if (!user) {
      return res.status(401).json({ error: 'PIN incorreto. Acesso negado.' });
    }
    // Retornar usuário sem expor hash de senha se houver
    const safeUser = { ...user };
    delete safeUser.password;
    res.json({ ok: true, user: safeUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= REAL-TIME SYNC HUB (SERVER-SENT EVENTS - SSE) =================
const sseClients = new Set();

/**
 * Transmite notificações de mutação instantaneamente para todos os dispositivos conectados
 */
function broadcastDbChange(table, action, data = null) {
  const version = db.bumpDbVersion();
  const payload = JSON.stringify({
    type: 'DB_MUTATION',
    table,
    action,
    version,
    timestamp: Date.now()
  });
  console.log(`[REALTIME-SYNC] Mutação em '${table}' (${action}) - Notificando ${sseClients.size} cliente(s) ativo(s)`);
  for (const client of sseClients) {
    try {
      client.res.write(`data: ${payload}\n\n`);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

// Heartbeat a cada 20 segundos para manter conexões móveis ativas através de proxies/NATs
setInterval(() => {
  if (sseClients.size === 0) return;
  const heartbeat = JSON.stringify({ type: 'HEARTBEAT', version: db.getDbVersion(), time: Date.now() });
  for (const client of sseClients) {
    try {
      client.res.write(`data: ${heartbeat}\n\n`);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 20000);

// Endpoint SSE para sincronização contínua em tempo real
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Essencial para Nginx / Coolify Traefik
  if (res.flushHeaders) res.flushHeaders();

  const client = { res, id: Date.now() };
  sseClients.add(client);

  // Boas-vindas com a versão atômica atual
  const welcome = JSON.stringify({ type: 'CONNECTED', version: db.getDbVersion(), timestamp: Date.now() });
  res.write(`data: ${welcome}\n\n`);

  req.on('close', () => {
    sseClients.delete(client);
  });
});

// Endpoint ultraleve de checagem de versão (~50 bytes) para foco e visibilitychange
app.get('/api/db/version', (req, res) => {
  res.json({ ok: true, version: db.getDbVersion() });
});

// API Genérica estilo PostgREST (/api/db/:table)
app.get('/api/db/:table', async (req, res) => {
  try {
    const rows = await db.selectRows(req.params.table, req.query);
    res.json(rows);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/db/:table', async (req, res) => {
  try {
    const inserted = await db.insertRows(req.params.table, req.body);
    broadcastDbChange(req.params.table, 'insert', inserted);
    res.status(201).json(inserted);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/db/:table', async (req, res) => {
  try {
    const updated = await db.updateRows(req.params.table, req.body, req.query);
    broadcastDbChange(req.params.table, 'update', updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/db/:table', async (req, res) => {
  try {
    const updated = await db.updateRows(req.params.table, req.body, req.query);
    broadcastDbChange(req.params.table, 'update', updated);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/db/:table', async (req, res) => {
  try {
    const result = await db.deleteRows(req.params.table, req.query);
    broadcastDbChange(req.params.table, 'delete', result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================= ROTAS DO AGENTE AUTÔNOMO MORGAN 24/7 =================

// Conectar o motor transacional do Morgan ao barramento SSE em tempo real
morganEngine.setMutationNotifier(broadcastDbChange);

// 1. Status e Configurações do Agente Morgan + Bot do Telegram
app.get('/api/morgan/status', async (req, res) => {
  try {
    const settings = await db.getMorganSettings();
    const tgStatus = morganTelegram.getTelegramStatus();
    const logs = await db.selectRows('morgan_action_logs', { order: 'id.desc', limit: '20' });
    res.json({
      ok: true,
      telegram: tgStatus,
      hasGeminiKey: Boolean(settings.gemini_api_key),
      hasTelegramToken: Boolean(settings.telegram_bot_token),
      settings: {
        ...settings,
        gemini_api_key_masked: settings.gemini_api_key ? `${settings.gemini_api_key.slice(0, 6)}...${settings.gemini_api_key.slice(-4)}` : '',
        telegram_bot_token_masked: settings.telegram_bot_token ? `${settings.telegram_bot_token.slice(0, 8)}...` : ''
      },
      recentActions: logs
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/morgan/settings', async (req, res) => {
  try {
    const settings = await db.getMorganSettings();
    res.json({ ok: true, settings });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/morgan/settings', async (req, res) => {
  try {
    const patch = req.body || {};
    const updated = await db.updateMorganSettings(patch);
    broadcastDbChange('morgan_settings', 'update', updated);
    const tgResult = await morganTelegram.startOrReloadTelegramBot(patch.telegram_bot_token || updated.telegram_bot_token);
    res.json({
      ok: true,
      settings: updated,
      telegram: tgResult
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// 2. Endpoint Unificado de Conversação e Execução Agêntica (Texto + Voz + Imagem)
app.post('/api/morgan/chat', async (req, res) => {
  try {
    const { message, text, media, channel, chatId, apiKey } = req.body || {};
    const userText = (message || text || '').trim();
    const result = await morganAgent.processMorganMessage({
      text: userText,
      media: media || null,
      channel: channel || 'web',
      chatId: chatId || 'web_family',
      apiKeyOverride: apiKey || null
    });
    res.json({
      ok: true,
      ...result
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Governança Híbrida: Confirmar, Cancelar ou Desfazer (Undo) qualquer ação do Morgan
app.post('/api/morgan/action/:id/:op', async (req, res) => {
  try {
    const actionId = parseInt(req.params.id, 10);
    const op = String(req.params.op || '').toLowerCase();
    let result;

    if (op === 'confirm') {
      result = await morganEngine.confirmPendingAction(actionId);
    } else if (op === 'cancel') {
      result = await morganEngine.cancelPendingAction(actionId);
    } else if (op === 'undo') {
      result = await morganEngine.undoExecutedAction(actionId);
    } else {
      return res.status(400).json({ ok: false, error: `Operação inválida: ${op}` });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Disparo Manual ou Sob Demanda do Briefing Executivo no Telegram / Web
app.post('/api/morgan/briefing/send', async (req, res) => {
  try {
    const { chatId } = req.body || {};
    const tgStatus = morganTelegram.getTelegramStatus();
    if (tgStatus.active) {
      const sent = await morganTelegram.broadcastTelegramBriefing(chatId || null);
      return res.json(sent);
    }
    const briefing = await morganEngine.buildExecutiveBriefingText();
    res.json({
      ok: true,
      telegramSent: false,
      briefingText: briefing.text
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Histórico de Conversas e Logs de Auditoria de Ações do Morgan
app.get('/api/morgan/logs', async (req, res) => {
  try {
    const [actions, conversations] = await Promise.all([
      db.selectRows('morgan_action_logs', { order: 'id.desc', limit: '30' }),
      db.selectRows('morgan_conversations', { order: 'id.desc', limit: '40' })
    ]);
    res.json({
      ok: true,
      actions,
      conversations: conversations.reverse()
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. Webhook Gateway para WhatsApp (Evolution API / Cloud API)
app.post('/api/morgan/webhook/whatsapp', async (req, res) => {
  try {
    const out = await morganTelegram.handleWhatsAppWebhookPayload(req.body || {});
    res.json(out);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint de telemetria para diagnóstico em tempo real de dispositivos móveis
app.post('/api/telemetry', (req, res) => {
  try {
    const { type, message, source, lineno, colno, stack, screen, user, ua, details } = req.body || {};
    const timestamp = new Date().toISOString();
    console.log(`[CLIENT-TELEMETRY] [${timestamp}] [${type || 'LOG'}] ${message || 'Evento'}`);
    if (user) console.log(`  Usuário: ${user}`);
    if (screen) console.log(`  Resolução: ${screen}`);
    if (source || lineno) console.log(`  Origem: ${source}:${lineno}:${colno}`);
    if (stack) console.log(`  Stack: ${stack}`);
    if (details) console.log(`  Detalhes:`, details);
    if (ua) console.log(`  UA: ${ua}`);
  } catch (err) {
    console.warn('[TELEMETRY] Erro ao processar payload:', err.message);
  }
  res.json({ ok: true });
});

// Função auxiliar para servir index.html com injeção dinâmica anti-cache
function sendDynamicIndex(req, res) {
  try {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    // Injeção de versionamento dinâmico estrito anti-cache
    const cacheBuster = `v=${APP_VERSION}&_b=${BUILD_TIME}`;
    html = html.replace(/href="style\.css(\?[^"]*)?"/g, `href="style.css?${cacheBuster}"`);
    html = html.replace(/src="app\.js(\?[^"]*)?"/g, `src="app.js?${cacheBuster}"`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    return res.send(html);
  } catch (err) {
    console.error('Erro ao renderizar index.html dinâmico:', err);
    return res.status(500).send('Erro ao carregar aplicação');
  }
}

// Rotas prioritárias para servir a página principal dinamicamente
app.get('/', sendDynamicIndex);
app.get('/index.html', sendDynamicIndex);

// Servir arquivos estáticos do frontend com controle de cache para dispositivos móveis
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Fallback para SPA em todas as outras rotas não-API
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint não encontrado' });
  }
  return sendDynamicIndex(req, res);
});

// Middleware global de tratamento de erros Express (captura URIError de bots e requisições malformadas)
app.use((err, req, res, next) => {
  if (err instanceof URIError) {
    return res.status(400).send('Bad Request');
  }
  console.error('[EXPRESS ERROR]', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Inicialização com auto-detecção de banco e ativação do Agente Autônomo Morgan 24/7
db.initDb().then(async () => {
  await morganTelegram.startOrReloadTelegramBot();
  morganScheduler.startMorganScheduler();
  app.listen(PORT, () => {
    console.log(`[FAMILY MONEY] Servidor + Agente Autônomo Morgan 24/7 ativos na porta ${PORT}`);
  });
}).catch(err => {
  console.error('[FAMILY MONEY] Erro crítico ao iniciar banco de dados:', err);
  app.listen(PORT, () => {
    console.log(`[FAMILY MONEY] Servidor iniciado com advertências na porta ${PORT}`);
  });
});
