const puppeteer = require('puppeteer-core');
const CHROME_PATH = 'C:\\Users\\fbdv1\\.agent-browser\\browsers\\chrome-153.0.8010.47\\chrome.exe';
const TARGET_URL = 'https://5usy1ujr0ulpzbziteifwqva.167.233.112.111.sslip.io/';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--ignore-certificate-errors']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1');
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

  const logs = [];
  page.on('console', msg => logs.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => logs.push({ type: 'pageerror', text: err.message }));

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

  console.log('Tapping Fábio (Pai) shortcut chip on touch screen...');
  const chip = await page.$('.user-shortcut');
  if (chip) {
    await chip.tap();
  } else {
    console.log('Chip not found!');
  }

  // Wait 3 seconds
  await new Promise(r => setTimeout(r, 3000));

  console.log('Logs after tap:');
  console.log(logs);

  const afterTap = await page.evaluate(() => {
    return {
      loginHidden: document.getElementById('login-container')?.classList.contains('hide'),
      appHidden: document.getElementById('app-container')?.classList.contains('hide'),
      user: window.state?.user?.name,
      transactions: window.state?.transactions?.length,
      accounts: window.state?.accounts?.length,
      cards: window.state?.cards?.length,
      totalBalance: document.getElementById('sidebar-total-balance')?.textContent
    };
  });
  console.log('State after tap:', afterTap);

  await browser.close();
})();
