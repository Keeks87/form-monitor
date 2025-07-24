const { chromium } = require('playwright');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const cleaned = process.env.GOOGLE_SERVICE_JSON
  .replace(/\r\n/g, '\n')
  .replace(/\"/g, '"')
  .replace(/^"|"$/g, '');

const credentials = JSON.parse(cleaned);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const SHEET_ID = process.env.SHEET_ID;
const CONFIG_SHEET = 'config';
const RESULTS_SHEET = 'results';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);

async function getConfigRows() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${CONFIG_SHEET}!A2:L`
  });
  return res.data.values || [];
}

async function logResult(row) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${RESULTS_SHEET}!A:F`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
}

async function run() {
  const configRows = await getConfigRows();
  console.log(`Fetched ${configRows.length} config rows`);

  for (const row of configRows) {
    const [
      url,
      emailSelector, emailValue,
      passwordSelector, passwordValue,
      confirmSelector, confirmValue,
      checkboxSelector,
      submitButtonSelector,
      redirectURL,
      label
    ] = row;

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' // optional
    });
    const page = await context.newPage();
    const timestamp = new Date().toISOString();
    let loadTime = 'N/A';
    let status = '❌';
    let error = '';

    try {
      console.log(`Navigating to: ${url}`);
      const start = Date.now();

      await page.route('**/*', (route) => {
        route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache' } });
      });

      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Handle Cookiebot
      const cookieButton = '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll';
      try {
        await page.waitForSelector(cookieButton, { timeout: 5000 });
        console.log('🟣 Cookiebot detected — clicking Accept All');
        await page.click(cookieButton);
        await page.waitForSelector('#CybotCookiebotDialog', { state: 'detached', timeout: 5000 });
        console.log('✅ Cookiebot dismissed');
      } catch (e) {
        console.log('ℹ️ No Cookiebot found or already dismissed');
      }

      if (emailSelector) {
        const dynamicEmail = emailValue.includes('@') ? emailValue.replace('@', `+${Date.now()}@`) : emailValue;
        console.log(`Filling email: ${emailSelector} = ${dynamicEmail}`);
        await page.fill(emailSelector, dynamicEmail);
      }

      if (passwordSelector) {
        console.log(`Filling password: ${passwordSelector}`);
        await page.fill(passwordSelector, passwordValue);
      }

      if (confirmSelector) {
        console.log(`Filling confirm password: ${confirmSelector}`);
        await page.fill(confirmSelector, confirmValue);
      }

      if (checkboxSelector) {
        console.log(`Clicking checkbox: ${checkboxSelector}`);
        await page.click(checkboxSelector);
      }

      if (submitButtonSelector) {
        console.log(`Clicking submit button: ${submitButtonSelector}`);
        await page.click(submitButtonSelector);
      }

      console.log('Waiting for redirect or page change...');
      await page.waitForTimeout(5000);
      const finalUrl = page.url();

      console.log(`Final URL: ${finalUrl}`);
      if (finalUrl.includes('/register')) {
        throw new Error(`Form did not redirect, still on register page (likely due to validation error). Final URL: ${finalUrl}`);
      }

      loadTime = Date.now() - start;
      status = '✅';
      console.log(`✅ Success: Load time ${loadTime}ms`);
    } catch (err) {
      error = err.message;
      console.error(`❌ Error during test: ${error}`);

      const screenshotPath = path.join(SCREENSHOT_DIR, `fail_${label.replace(/\s+/g, '_')}_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 Screenshot saved: ${screenshotPath}`);
    } finally {
      await browser.close();
      await logResult([timestamp, url, loadTime, status, error, label]);
    }
  }

  // Add end of batch marker
  const endTime = new Date();
  const formattedDate = endTime.toLocaleString('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).replace(',', '');
  await logResult([`END OF BATCH – ${formattedDate}`, '', '', '', '', '']);
}

run();
