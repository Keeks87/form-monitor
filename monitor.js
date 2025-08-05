const { chromium } = require('playwright');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

/*
 * This script reads a configuration from a Google Sheet and exercises
 * a series of partner registration forms using Playwright.  It has
 * been updated to address issues discovered in earlier runs:
 *
 * - All selector strings are trimmed to avoid stray whitespace.
 * - A unique email address is generated on each run when the base
 *   value contains an `@` character.  This prevents "duplicate
 *   account" validation errors from causing spurious failures.
 * - If no explicit value is provided for the confirm field (often
 *   mis‐used as the full name), the script uses the same value as
 *   the password.  This ensures second password fields are filled
 *   correctly when present.
 * - After submission, the script inspects the page for any inline
 *   error messages and includes them in the logged error text.
 * - When a form does not redirect, the script records the final
 *   URL as part of the error.  This aids troubleshooting.
 * - Screenshots of failures are saved into a `screenshots/` folder.
 * - An end-of-batch marker row is appended to the results sheet with
 *   a date/time stamp in `DD/MM/YYYY HH:MM` format.
 *
 * Note: Forms protected by reCAPTCHA or requiring additional fields
 * not configured in the sheet cannot be automated reliably.  Those
 * entries should be marked as complex and skipped in the config.
 */

// Parse and sanitise the service account JSON from the environment
const cleaned = process.env.GOOGLE_SERVICE_JSON
  .replace(/\r\n/g, '\n')
  .replace(/\\"/g, '"')
  .replace(/^"|"$/g, '');
const credentials = JSON.parse(cleaned);

// Set up Google Sheets API client
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SHEET_ID = process.env.SHEET_ID;
const CONFIG_SHEET = 'config';
const RESULTS_SHEET = 'results';

// Ensure screenshots directory exists
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

    // Trim whitespace from selectors to avoid literal tab/space issues
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

      // Disable cache on all requests to avoid stale resources
      await page.route('**/*', (route) => {
        route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache' } });
      });

      await page.goto(url, { waitUntil: 'domcontentloaded' });

      // Dismiss Cookiebot if present
      const cookieButton = '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll';
      try {
        await page.waitForSelector(cookieButton, { timeout: 5000 });
        console.log('🟣 Cookiebot detected — clicking Accept All');
        await page.click(cookieButton);
        await page.waitForSelector('#CybotCookiebotDialog', { state: 'detached', timeout: 5000 });
        console.log('✅ Cookiebot dismissed');
      } catch {
        console.log('ℹ️ No Cookiebot found or already dismissed');
      }

      // Fill email with a unique value when base value contains '@'
      if (emailSelector) {
        let emailToUse;
        if (emailValue && emailValue.includes('@')) {
          const [user, domain] = emailValue.split('@');
          emailToUse = `${user}+${Date.now()}@${domain}`;
        } else {
          emailToUse = emailValue;
        }
        console.log(`Filling email: ${emailSelector} = ${emailToUse}`);
        await page.fill(emailSelector, emailToUse);
      }

      // Fill password
      if (passwordSelector) {
        console.log(`Filling password: ${passwordSelector}`);
        await page.fill(passwordSelector, passwordValue);
      }

      // Fill confirm (can be second password or full name)
      if (confirmSelector) {
        const confirmData = confirmValue || passwordValue || '';
        console.log(`Filling confirm field: ${confirmSelector} = ${confirmData}`);
        await page.fill(confirmSelector, confirmData);
      }

      // Click checkbox if specified
      if (checkboxSelector) {
        console.log(`Clicking checkbox: ${checkboxSelector}`);
        await page.click(checkboxSelector);
      }

      // Click submit button
      if (submitButtonSelector) {
        console.log(`Clicking submit button: ${submitButtonSelector}`);
        await page.click(submitButtonSelector);
      }

      console.log('Waiting for redirect or page change...');
      // Wait for potential navigation; fallback to timeout
      try {
        await Promise.race([
          page.waitForNavigation({ waitUntil: 'load', timeout: 8000 }),
          page.waitForTimeout(8000),
        ]);
      } catch {
        // ignore; navigation might still happen later
      }

      const finalUrl = page.url();
      console.log(`Final URL: ${finalUrl}`);
      // If still on register page or expected redirect not met, gather inline errors
      if (finalUrl.includes('/register')) {
        // collect validation errors displayed on the page
        const errorMsgs = await page.$$eval(
          '.inline-error-msg, .error, .invalid-feedback, .help-block',
          (els) => els.map((el) => el.textContent.trim()).filter(Boolean),
        );
        if (errorMsgs.length) {
          error = 'Validation errors: ' + errorMsgs.join(' | ');
        } else {
          error = `Form did not redirect — ended on: ${finalUrl}`;
        }
        throw new Error(error);
      }

      // Optionally check if redirectURL is specified and not part of finalUrl
      if (redirectURL && !finalUrl.includes(redirectURL)) {
        error = `Redirect URL mismatch — expected "${redirectURL}", got "${finalUrl}"`;
        throw new Error(error);
      }

      loadTime = Date.now() - start;
      status = '✅';
      console.log(`✅ Success: Load time ${loadTime}ms`);
    } catch (err) {
      // When an error is thrown above, capture details and screenshot
      error = err.message || String(err);
      console.error(`❌ Error during test: ${error}`);
      // Save screenshot on failure
      const safeLabel = (label || 'unknown').replace(/[^\w\d-_]/g, '_');
      const screenshotName = `fail_${safeLabel}_${Date.now()}.png`;
      const screenshotPath = path.join(SCREENSHOT_DIR, screenshotName);
      try {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot saved: ${screenshotPath}`);
      } catch (sErr) {
        console.error('Failed to capture screenshot:', sErr.message || sErr);
      }
    } finally {
      await browser.close();
      await logResult([timestamp, url, loadTime, status, error, label]);
    }
  }

  // Add end-of-batch marker row
  const endTime = new Date();
  const formattedDate = endTime
    .toLocaleString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', '');
  await logResult([`END OF BATCH – ${formattedDate}`, '', '', '', '', '']);
}

run().catch((e) => {
  console.error('Unhandled error:', e);
});
