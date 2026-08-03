const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, 'public')));

// Fallback para SPA (opcional, para suportar rotas se houver)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FAMILY MONEY rodando localmente na porta ${PORT}`);
});
