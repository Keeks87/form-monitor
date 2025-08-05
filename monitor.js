const { chromium } = require('playwright');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const cleaned = process.env.GOOGLE_SERVICE_JSON
  .replace(/\r\n/g, '\n')
  .replace(/\\"/g, '"')
  .replace(/^"|"$/g, '');

const credentials = JSON.parse(cleaned);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
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
    range: `${CONFIG_SHEET}!A2:L`,
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
    requestBody: { values: [row] },
  });
}

async function run() {
  const configRows = await getConfigRows();
  console.log(`Fetched ${configRows.length} config rows`);

  for (const row of configRows) {
    let [
      url,
      emailSelector,
      emailValue,
      passwordSelector,
      passwordValue,
      confirmSelector,
      confirmValue,
      checkboxSelector,
      submitButtonSelector,
      redirectURL,
      label,
    ] = row;

    // Trim whitespace that would break selectors
    emailSelector = emailSelector?.trim();
    passwordSelector = passwordSelector?.trim();
    confirmSelector = confirmSelector?.trim();
    checkboxSelector = checkboxSelector?.trim();
    submitButtonSelector = submitButtonSelector?.trim();

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });
    const page = await context.newPage();
    const timestamp = new Date().toISOString();
    let loadTime = 'N/A';
    let status = '❌';
    let error = '';

    try {
      console.log(`Navigating to: ${url}`);
      const start = Date.now();

      // Disable cache to avoid stale responses
      await page.route('**/*', (route) => {
        route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache' } });
      });

      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Dismiss Cookiebot if necessary
      const cookieButton = '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll';
      try {
        await page.waitForSelector(cookieButton, { timeout: 5000 });
        await page.click(cookieButton);
        await page.waitForSelector('#CybotCookiebotDialog', {
          state: 'detached',
          timeout: 5000,
        });
      } catch (e) {
        console.log('No Cookiebot found.');
      }

      // Unique email per run to avoid duplicate email errors
      const dynamicEmail =
        emailValue && emailValue.includes('@')
          ? emailValue.replace('@', `+${Date.now()}@`)
          : emailValue;
      if (emailSelector) {
        await page.fill(emailSelector, dynamicEmail);
      }

      // Password and confirm fields
      if (passwordSelector) {
        await page.fill(passwordSelector, passwordValue);
      }
      if (confirmSelector) {
        // If confirmValue is empty, use the same password (for confirm password fields)
        const confirmData = confirmValue || passwordValue;
        await page.fill(confirmSelector, confirmData);
      }

      // Additional required fields can be handled here:
      // E.g., ageSelector, ageValue, experienceSelector, experienceValue

      if (checkboxSelector) {
        await page.click(checkboxSelector);
      }

      if (submitButtonSelector) {
        await page.click(submitButtonSelector);
      }

      // Wait longer and check final URL
      await page.waitForTimeout(5000);
      const finalUrl = page.url();
      if (finalUrl.includes('/register')) {
        throw new Error(`Form did not redirect — ended on: ${finalUrl}`);
      }

      loadTime = Date.now() - start;
      status = '✅';
      console.log(`Success. Load time: ${loadTime} ms.`);
    } catch (err) {
      error = err.message;
      console.error(`Test failed: ${error}`);

      // Save a screenshot on failure
      const safeLabel = (label || 'unknown').replace(/[^\w\d-_]/g, '_');
      const screenshotName = `fail_${safeLabel}_${Date.now()}.png`;
      const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } finally {
      await browser.close();
      await logResult([timestamp, url, loadTime, status, error, label]);
    }
  }

  // Write a batch marker
  const endTime = new Date();
  const formattedDate = endTime.toLocaleString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', '');
  await logResult([`END OF BATCH – ${formattedDate}`, '', '', '', '', '']);
}

run();
