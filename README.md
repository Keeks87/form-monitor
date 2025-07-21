# Dynamic Playwright Form Monitor

This repo uses Playwright and Google Sheets to monitor multiple form journeys with dynamic config.

## Google Sheet Setup

### Sheet 1: `config`
| url | emailSelector | emailValue | passwordSelector | passwordValue | confirmSelector | confirmValue | submitButtonSelector | redirectURL |
|-----|---------------|------------|------------------|----------------|------------------|----------------|----------------------|--------------|

### Sheet 2: `results`
| timestamp | url | load time | status | error |

## GitHub Secrets Required

- `GOOGLE_SERVICE_JSON`: Your Google service account JSON (escaped or raw with `\n` replaced)
- `SHEET_ID`: Google Sheet ID from the URL

## How to Use

1. Add rows to the `config` sheet for each form.
2. Push this repo to GitHub.
3. GitHub Actions will test each form and write results to the `results` tab.
