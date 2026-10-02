const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de Cabeçalhos de Segurança (Auditoria de Segurança - Sujeito Programador)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, 'public')));

// Fallback para SPA (opcional, para suportar rotas se houver)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FAMILY MONEY rodando localmente na porta ${PORT}`);
});
