const { chromium } = require('playwright');
const { google } = require('googleapis');

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_JSON.replace(/\\n/g, '\n'));
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const SHEET_ID = process.env.SHEET_ID;
const CONFIG_SHEET = 'config';
const RESULTS_SHEET = 'results';

async function getConfigRows() {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${CONFIG_SHEET}!A2:I`
  });
  return res.data.values || [];
}

async function logResult(row) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${RESULTS_SHEET}!A:E`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  });
}

async function run() {
  const configRows = await getConfigRows();

  for (const row of configRows) {
    const [
      url,
      emailSelector, emailValue,
      passwordSelector, passwordValue,
      confirmSelector, confirmValue,
      submitButtonSelector,
      redirectURL
    ] = row;

    const browser = await chromium.launch();
    const page = await browser.newPage();
    const timestamp = new Date().toISOString();
    let loadTime = 'N/A';
    let status = '❌';
    let error = '';

    try {
      const start = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      if (emailSelector) await page.fill(emailSelector, emailValue);
      if (passwordSelector) await page.fill(passwordSelector, passwordValue);
      if (confirmSelector) await page.fill(confirmSelector, confirmValue);
      if (submitButtonSelector) await page.click(submitButtonSelector);

      await page.waitForNavigation({ waitUntil: 'load' });

      if (redirectURL && !page.url().includes(redirectURL)) {
        throw new Error('Redirect URL mismatch');
      }

      loadTime = Date.now() - start;
      status = '✅';
    } catch (err) {
      error = err.message;
    } finally {
      await browser.close();
      await logResult([timestamp, url, loadTime, status, error]);
    }
  }
}

run();
