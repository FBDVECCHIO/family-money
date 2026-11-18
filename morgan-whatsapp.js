/**
 * ============================================================================
 * MORGAN WHATSAPP CLOUD API GATEWAY (META OFICIAL & EVOLUTION API)
 * ============================================================================
 * Conecta o Agente Financeiro Morgan diretamente à Cloud API Oficial da Meta
 * (WhatsApp for Developers) e também suporta Evolution API.
 * 
 * Funcionalidades:
 *  - Verificação de Webhook GET (hub.challenge) exigida pela Meta
 *  - Recepção assíncrona de mensagens POST (texto, áudio, imagem)
 *  - Resposta via Graph API Oficial (POST /v21.0/{phone_number_id}/messages)
 *  - Botões Interativos (Reply Buttons) para [Confirmar], [Cancelar] e [Desfazer]
 *  - Pareamento seguro por PIN (/parear 1202 ou apenas 1202)
 */

const db = require('./db');
const engine = require('./morgan-finance-engine');
const agent = require('./morgan-agent');

/**
 * Endpoint GET para validação de Webhook da Meta
 */
async function verifyMetaWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const settings = await db.getMorganSettings();
  const expectedToken = settings.whatsapp_verify_token || process.env.WHATSAPP_VERIFY_TOKEN || 'familymoney_morgan_secret';

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('[MORGAN-WHATSAPP] Webhook validado com sucesso pela Meta!');
    return res.status(200).send(challenge);
  }

  console.warn('[MORGAN-WHATSAPP] Falha na validação do webhook Meta: token divergente.');
  return res.sendStatus(403);
}

/**
 * Baixa mídia (áudio ou imagem) da Meta Graph API
 */
async function downloadMetaMediaAsBase64(mediaId, accessToken) {
  try {
    // 1. Obter URL temporária da mídia
    const metaUrl = `https://graph.facebook.com/v21.0/${mediaId}`;
    const metaRes = await fetch(metaUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!metaRes.ok) return null;
    const mediaMeta = await metaRes.json();
    if (!mediaMeta.url) return null;

    // 2. Baixar o arquivo binário
    const fileRes = await fetch(mediaMeta.url, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!fileRes.ok) return null;

    const arrayBuffer = await fileRes.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const mimeType = mediaMeta.mime_type || (mediaMeta.url.includes('ogg') ? 'audio/ogg' : 'image/jpeg');

    return { mimeType, base64Data };
  } catch (err) {
    console.warn('[MORGAN-WHATSAPP] Erro ao baixar mídia da Meta:', err.message);
    return null;
  }
}

/**
 * Envia mensagem de texto ou com botões interativos para a Meta Cloud API
 */
async function sendMetaWhatsAppMessage(to, text, actions = [], settingsOverride = null) {
  const settings = settingsOverride || await db.getMorganSettings();
  const accessToken = (settings.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = (settings.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();

  if (!accessToken || !phoneNumberId) {
    console.warn('[MORGAN-WHATSAPP] WhatsApp Access Token ou Phone Number ID não configurados.');
    return { ok: false, error: 'Credenciais WhatsApp Meta não configuradas' };
  }

  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  // Montar botões interativos se houver ações (até 3 botões são permitidos pela Meta)
  const buttons = [];
  for (const act of actions) {
    if (act.requiresConfirmation && act.actionLogId && buttons.length < 3) {
      buttons.push({
        type: 'reply',
        reply: { id: `confirm:${act.actionLogId}`, title: `Confirmar #${act.actionLogId}`.slice(0, 20) }
      });
      if (buttons.length < 3) {
        buttons.push({
          type: 'reply',
          reply: { id: `cancel:${act.actionLogId}`, title: 'Cancelar'.slice(0, 20) }
        });
      }
    } else if (act.canUndo && act.actionLogId && buttons.length < 3) {
      buttons.push({
        type: 'reply',
        reply: { id: `undo:${act.actionLogId}`, title: `Desfazer #${act.actionLogId}`.slice(0, 20) }
      });
    }
  }

  let payload;
  if (buttons.length > 0) {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: text.slice(0, 1024) },
        action: { buttons }
      }
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text.slice(0, 4096)
      }
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn('[MORGAN-WHATSAPP] Falha no envio Meta:', data.error?.message || res.status);
      return { ok: false, error: data.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    console.error('[MORGAN-WHATSAPP] Erro de rede ao enviar Meta:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Processador principal de Webhook da Meta
 */
async function handleMetaWhatsAppWebhook(body) {
  if (!body || body.object !== 'whatsapp_business_account') {
    return false;
  }

  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const val = change.value || {};
      const messages = val.messages || [];

      for (const msg of messages) {
        const from = msg.from; // Número no formato E.164 (ex: 5511999999999)
        const msgId = msg.id;
        const msgType = msg.type;
        const senderName = val.contacts?.[0]?.profile?.name || 'Senhor';

        let userText = '';
        let interactiveBtnId = null;

        if (msgType === 'text') {
          userText = (msg.text?.body || '').trim();
        } else if (msgType === 'interactive') {
          interactiveBtnId = msg.interactive?.button_reply?.id;
          userText = msg.interactive?.button_reply?.title || '';
        } else if (msgType === 'audio' || msgType === 'voice') {
          userText = '';
        } else if (msgType === 'image') {
          userText = msg.image?.caption || '';
        }

        const settings = await db.getMorganSettings();
        const allowedNumbers = (settings.whatsapp_allowed_numbers || []).map(String);

        // 1. Tratamento de clique em botão interativo (confirm, cancel, undo)
        if (interactiveBtnId) {
          if (interactiveBtnId.startsWith('undo:')) {
            const logId = parseInt(interactiveBtnId.split(':')[1], 10);
            const res = await engine.undoExecutedAction(logId);
            await sendMetaWhatsAppMessage(from, res.ok ? res.summary : `⚠️ ${res.error}`, [], settings);
            continue;
          }
          if (interactiveBtnId.startsWith('confirm:')) {
            const logId = parseInt(interactiveBtnId.split(':')[1], 10);
            const res = await engine.confirmPendingAction(logId);
            await sendMetaWhatsAppMessage(from, res.ok ? `✅ *Operação Confirmada!*\n\n${res.summary}` : `⚠️ ${res.error}`, res.canUndo ? [res] : [], settings);
            continue;
          }
          if (interactiveBtnId.startsWith('cancel:')) {
            const logId = parseInt(interactiveBtnId.split(':')[1], 10);
            const res = await engine.cancelPendingAction(logId);
            await sendMetaWhatsAppMessage(from, res.ok ? res.summary : `⚠️ ${res.error}`, [], settings);
            continue;
          }
        }

        // 2. Pareamento seguro por PIN (/parear 1202 ou apenas 1202)
        const isPairCmd = /^\/parear\b/i.test(userText);
        const isDirectPin = !allowedNumbers.includes(from) && /^\d{4,6}$/.test(userText);

        if (isPairCmd || isDirectPin) {
          const pinArg = isPairCmd ? userText.replace(/^\/parear\s*/i, '').trim() : userText;
          const user = await db.authenticatePin(pinArg);
          if (user) {
            if (!allowedNumbers.includes(from)) {
              allowedNumbers.push(from);
              await db.updateMorganSettings({ whatsapp_allowed_numbers: allowedNumbers });
            }
            const welcome = `🛡️ *WhatsApp Vinculado com Sucesso, ${user.name}!*\n\nEu sou o *Morgan*, seu CFO Autônomo 24/7 no Family Money.\n\nAgora você pode conversar comigo aqui por texto, áudios de voz ou enviando fotos de comprovantes!`;
            await sendMetaWhatsAppMessage(from, welcome, [], settings);
            continue;
          } else {
            await sendMetaWhatsAppMessage(from, `❌ *PIN incorreto.* Para autenticar seu WhatsApp, envie:\n/parear 1202`, [], settings);
            continue;
          }
        }

        // 3. Verificação de segurança (número não autorizado)
        if (!allowedNumbers.includes(from)) {
          const pairPrompt = `👋 Olá, *${senderName}*! Eu sou o *Morgan*, CFO Autônomo do *Family Money*.\n\n🔒 Por segurança bancária, este canal exige pareamento.\nEnvie o comando abaixo com o seu PIN:\n👉 */parear 1202*`;
          await sendMetaWhatsAppMessage(from, pairPrompt, [], settings);
          continue;
        }

        // 4. Download de Mídia se houver (Áudio ou Foto)
        let media = null;
        const accessToken = settings.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
        if (accessToken) {
          if ((msgType === 'audio' || msgType === 'voice') && msg[msgType]?.id) {
            media = await downloadMetaMediaAsBase64(msg[msgType].id, accessToken);
          } else if (msgType === 'image' && msg.image?.id) {
            media = await downloadMetaMediaAsBase64(msg.image.id, accessToken);
          }
        }

        // 5. Enviar ao Cérebro Cognitivo do Morgan
        const response = await agent.processMorganMessage({
          text: userText,
          media,
          channel: 'whatsapp',
          chatId: String(from)
        });

        await sendMetaWhatsAppMessage(from, response.reply, response.actions || [], settings);
      }
    }
  }

  return true;
}

module.exports = {
  verifyMetaWebhook,
  handleMetaWhatsAppWebhook,
  sendMetaWhatsAppMessage
};
