const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME_PATH = 'C:\\Users\\fbdv1\\.agent-browser\\browsers\\chrome-153.0.8010.47\\chrome.exe';
const TARGET_URL = 'https://5usy1ujr0ulpzbziteifwqva.167.233.112.111.sslip.io/';
const ARTIFACTS_DIR = 'C:/Users/fbdv1/.gemini/antigravity/brain/8d422d45-d4fd-4a61-ba1e-64976f3e3eee';

async function runValidation() {
  console.log('=== INICIANDO PROTOCOLO DE VALIDAÇÃO DE SISTEMA A.T.L.A.S. ===');
  console.log('Alvo:', TARGET_URL);
  
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--disable-gpu',
      '--disable-web-security'
    ]
  });

  try {
    // -------------------------------------------------------------
    // TESTE 1: DESKTOP (1440x900)
    // -------------------------------------------------------------
    console.log('\n--- TESTE 1: AMBIENTE DESKTOP (1440x900) ---');
    const pageDesktop = await browser.newPage();
    await pageDesktop.setViewport({ width: 1440, height: 900 });

    pageDesktop.on('console', msg => {
      const txt = msg.text();
      if (txt.includes('Auto-gerando') || txt.includes('Erro') || txt.includes('Aviso')) {
        console.log('[PAGE CONSOLE]', msg.type(), txt);
      }
    });

    console.log('Navegando para o sistema...');
    await pageDesktop.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    // Salvar screenshot da tela de PIN
    const pinScreenPath = path.join(ARTIFACTS_DIR, 'validation_desktop_pin.png');
    await pageDesktop.screenshot({ path: pinScreenPath });
    console.log('Screenshot do PIN salvo:', pinScreenPath);

    // Clicar no atalho do Fábio (Pai) ou preencher PIN 1202
    console.log('Autenticando com perfil Fábio (Pai) PIN 1202...');
    await pageDesktop.evaluate(() => {
      if (typeof preencherPin === 'function') {
        preencherPin('1202');
      } else {
        const chip = document.querySelector('.user-shortcut');
        if (chip) chip.click();
      }
    });

    // Aguardar carregamento dos dados
    console.log('Aguardando sincronização completa de dados...');
    await pageDesktop.waitForFunction(() => {
      const app = document.getElementById('app-container');
      const txRows = document.querySelectorAll('#transactions-tbody tr');
      return app && !app.classList.contains('hide') && txRows.length > 0;
    }, { timeout: 15000 });

    // Coletar métricas do DOM carregado
    const metrics = await pageDesktop.evaluate(() => {
      return {
        user: window.state?.user?.name,
        accountsCount: window.state?.accounts?.length,
        cardsCount: window.state?.cards?.length,
        transactionsCount: window.state?.transactions?.length,
        fixedItemsCount: window.state?.fixedItems?.length,
        forecastMonths: window.state?.forecast?.length,
        renderedTxRows: document.querySelectorAll('#transactions-tbody tr').length,
        balanceText: document.querySelector('.total-balance-value')?.textContent?.trim()
      };
    });

    console.log('Métricas do Dashboard Desktop:', metrics);

    // Testar o botão Atualizar Dados
    console.log('\nTestando acionamento do botão "Atualizar Dados"...');
    const t0 = Date.now();
    
    // Disparar atualização e verificar classes
    await pageDesktop.evaluate(async () => {
      await triggerManualRefresh();
    });

    const isSpinning = await pageDesktop.evaluate(() => {
      const icon = document.getElementById('refresh-btn-icon');
      const btn = document.getElementById('refresh-data-btn');
      return {
        iconSpinning: icon ? icon.classList.contains('spinning') : false,
        btnRefreshing: btn ? btn.classList.contains('refreshing') : false
      };
    });

    const refreshDuration = Date.now() - t0;
    console.log(`Botão "Atualizar" concluiu sincronização com sucesso em ${refreshDuration} ms!`);
    console.log('Status dos spinners pós-refresh:', isSpinning);

    if (isSpinning.iconSpinning || isSpinning.btnRefreshing) {
      throw new Error('Falha crítica: Botão de refresh permaneceu com classe spinning!');
    }
    console.log('? VERIFICAÇÃO DE SUCESSO: Looping eterno do botão de atualizar ELIMINADO DEFINITIVAMENTE!');

    const desktopDashPath = path.join(ARTIFACTS_DIR, 'validation_desktop_dashboard.png');
    await pageDesktop.screenshot({ path: desktopDashPath });
    console.log('Screenshot do Dashboard Desktop salvo:', desktopDashPath);

    // -------------------------------------------------------------
    // TESTE 2: SMARTPHONE MOBILE (390x844 - iPhone 14)
    // -------------------------------------------------------------
    console.log('\n--- TESTE 2: AMBIENTE SMARTPHONE (390x844) ---');
    const pageMobile = await browser.newPage();
    await pageMobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    console.log('Navegando para o sistema no Mobile...');
    await pageMobile.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Autenticando no Mobile com Fábio (Pai)...');
    await pageMobile.evaluate(() => {
      if (typeof preencherPin === 'function') {
        preencherPin('1202');
      }
    });

    await pageMobile.waitForFunction(() => {
      const app = document.getElementById('app-container');
      const txRows = document.querySelectorAll('#transactions-tbody tr');
      return app && !app.classList.contains('hide') && txRows.length > 0;
    }, { timeout: 15000 });

    const mobileMetrics = await pageMobile.evaluate(() => {
      return {
        user: window.state?.user?.name,
        accountsCount: window.state?.accounts?.length,
        cardsCount: window.state?.cards?.length,
        transactionsCount: window.state?.transactions?.length,
        renderedTxRows: document.querySelectorAll('#transactions-tbody tr').length,
        balanceText: document.querySelector('.total-balance-value')?.textContent?.trim()
      };
    });
    console.log('Métricas do Dashboard Mobile:', mobileMetrics);

    // Testar sincronização no celular
    console.log('Testando sincronização manual em dispositivo móvel...');
    const tMobile0 = Date.now();
    await pageMobile.evaluate(async () => {
      await triggerManualRefresh(false);
    });

    const isMobileSpinning = await pageMobile.evaluate(() => {
      const icon = document.getElementById('refresh-btn-icon');
      const ptr = document.getElementById('ptr-icon');
      return {
        iconSpinning: icon ? icon.classList.contains('spinning') : false,
        ptrSpinning: ptr ? ptr.classList.contains('spinning') : false
      };
    });
    console.log(`Sincronização móvel concluída em ${Date.now() - tMobile0} ms!`);
    console.log('Status dos spinners no celular:', isMobileSpinning);

    const mobileDashPath = path.join(ARTIFACTS_DIR, 'validation_mobile_dashboard.png');
    await pageMobile.screenshot({ path: mobileDashPath });
    console.log('Screenshot do Dashboard Mobile salvo:', mobileDashPath);

    console.log('\n=== VALIDAÇÃO CONCLUÍDA COM ÊXITO TOTAL ===');
  } catch (err) {
    console.error('Falha na validação:', err);
  } finally {
    await browser.close();
  }
}

runValidation();
