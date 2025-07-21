# Dynamic Playwright Form Monitor

This repo uses Playwright and Google Sheets to monitor multiple form journeys with dynamic config.

## Google Sheet Setup

### Sheet 1: `config`
| url | emailSelector | emailValue | passwordSelector | passwordValue | confirmSelector | confirmValue | submitButtonSelector | redirectURL |
|-----|---------------|------------|------------------|----------------|------------------|----------------|----------------------|--------------|

### Sheet 2: `results`
| timestamp | url | load time | status | error |

## GitHub Secrets Required

- `GOOGLE_SERVICE_JSON`: Your Google service account JSON (raw, unescaped)
- `SHEET_ID`: Google Sheet ID from the URL

## How to Use

1. Add rows to the `config` sheet for each form.
2. Push this repo to GitHub.
3. GitHub Actions will test each form and write results to the `results` tab.
4. Run manually under "Actions → Monitor Forms from Sheet → Run Workflow" or wait for the scheduled job (default: daily 7am UTC).

## What Happens

- GitHub Actions runs `monitor.js`
- The script reads from the Google Sheet’s `config` tab
- It launches a headless browser using Playwright
- Navigates to each form URL
- Fills in the email, password, and confirm fields using the given selectors and values
- Clicks the submit button
- Waits for the page to load and checks the final URL against the `redirectURL`
- Measures the total load time
- Logs timestamped results in the `results` tab, including pass/fail and any error messages

## Adding a New Partner Form

1. Visit the form page
2. Use Inspect Element to find CSS selectors for each field and button
3. Paste those into a new row in the `config` sheet
4. Include an expected redirect endpoint (e.g. `/course_registration/xyz`) to verify success

That’s it — the next GitHub Actions run will test it.

## Optional Enhancements

- 📸 Save screenshots on test failure
- 📊 Visualise historical load times
- 📧 Email alerts for failures
- 🧠 AI-based visual diff detection (coming soon)
