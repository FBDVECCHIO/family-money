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

  await page.goto(TARGET_URL, { waitUntil: 'networkidle2' });

  console.log('Tapping keypad buttons: 1, 2, 0, 2...');
  const buttons = await page.$$('.key-btn');
  // buttons: 1, 2, 3, 4, 5, 6, 7, 8, 9, Limpar, 0, ?
  // 1 is buttons[0]
  // 2 is buttons[1]
  // 0 is buttons[10]
  await buttons[0].tap();
  await new Promise(r => setTimeout(r, 100));
  await buttons[1].tap();
  await new Promise(r => setTimeout(r, 100));
  await buttons[10].tap();
  await new Promise(r => setTimeout(r, 100));
  await buttons[1].tap();

  await new Promise(r => setTimeout(r, 3000));

  const afterKeypad = await page.evaluate(() => {
    return {
      loginHidden: document.getElementById('login-container')?.classList.contains('hide'),
      appHidden: document.getElementById('app-container')?.classList.contains('hide'),
      user: window.state?.user?.name,
      totalBalance: document.getElementById('sidebar-total-balance')?.textContent
    };
  });
  console.log('State after keypad:', afterKeypad);

  await browser.close();
})();
