const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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
    res.status(201).json(inserted);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/db/:table', async (req, res) => {
  try {
    const updated = await db.updateRows(req.params.table, req.body, req.query);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/db/:table', async (req, res) => {
  try {
    const updated = await db.updateRows(req.params.table, req.body, req.query);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/db/:table', async (req, res) => {
  try {
    const result = await db.deleteRows(req.params.table, req.query);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, 'public')));

// Fallback para SPA em todas as outras rotas não-API
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint não encontrado' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicialização com auto-detecção de banco
db.initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`[FAMILY MONEY] Servidor ativo e operando na porta ${PORT}`);
  });
}).catch(err => {
  console.error('[FAMILY MONEY] Erro crítico ao iniciar banco de dados:', err);
  app.listen(PORT, () => {
    console.log(`[FAMILY MONEY] Servidor iniciado com advertências na porta ${PORT}`);
  });
});
