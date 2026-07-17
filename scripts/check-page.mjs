import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:5173/login';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(2500);

const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 800) || '');
const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 400) || '');

console.log('URL:', url);
console.log('BODY_TEXT:', JSON.stringify(bodyText));
console.log('ROOT_HTML:', JSON.stringify(rootHtml));
console.log('ERRORS:', JSON.stringify(errors, null, 2));

await browser.close();
