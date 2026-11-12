# Job Application Tracker for Notion

A small browser extension that saves job applications to **your own Notion database** in one click.
Open a job posting, click the extension, and the role, company, location and link are already filled in.

Free, no backend, no account. Your Notion token stays in your browser and the extension only talks to
Notion's API (and, if you use the connection check, LinkedIn).

> Not affiliated with or endorsed by Notion or LinkedIn.

## Features

- **One-click capture** from LinkedIn, Greenhouse, Lever, Workday and Indeed, plus any careers page that
  publishes standard `JobPosting` structured data. Falls back to the page title when nothing else matches.
- **Saves to Notion** with status, date applied, location, notes and referral contact.
- **No duplicates:** reopening a job you already saved offers "Update status" instead of creating a second row.
- **Works with your existing database.** Role and Company can each be the title column or a plain text column.
- **Self-healing setup:** "Save and test" checks the database and adds any missing columns for you
  (it only adds; it never deletes or retypes anything).
- **Or create a fresh database** from a blank Notion page with all the columns in place.
- **Connection check (optional):** shows how many 1st- and 2nd-degree LinkedIn connections you have at the
  company, in plain words, with links to each search so you can ask for a referral.

## Install

Chrome, Edge, Brave and other Chromium browsers:

1. Download or clone this repository.
2. Open `chrome://extensions` (or `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Pin the extension and click it, then open **Settings**.

Keep the folder where it is. If you move or delete it, the extension stops working.

## Notion setup

1. Create an internal integration at <https://www.notion.so/profile/integrations>.
   Under **Capabilities**, enable *Read content*, *Update content* and *Insert content*.
2. Paste the integration secret into Settings.
3. Choose one of:
   - **Existing database:** open it in Notion, choose **••• > Connections**, add your integration, paste the
     database URL, and click **Save and test**.
   - **New database:** make an empty page, add your integration to it the same way, paste the page URL,
     and click **Create database**.

### Database columns

| Column | Type |
| --- | --- |
| Role | Title or text |
| Company | Title or text |
| Status | Select (Saved, Applied, Interviewing, Offer, Rejected, Withdrawn) |
| Date Applied | Date |
| URL | URL |
| Location | Text |
| Notes | Text |
| Referral Contact | Text |

Missing columns are added automatically when you click **Save and test**. A column that exists with the wrong
type is reported but never changed; fix it in Notion.

## Using it

1. Open a job posting and click the extension.
2. Check the pre-filled role, company and location, pick a status, and click **Save to Notion**.
3. Optional: click **Check my connections here** to see who you know at the company, then type the name of
   anyone who can refer you into **Referral contact**.

## How the connection check works

The button loads LinkedIn's people search twice (1st-degree, then 2nd-degree) for the company in background
tabs, reads the result count shown on the page, and closes the tabs. It runs only when you click it, uses your
own signed-in LinkedIn session, and reads nothing beyond the count. It does not use LinkedIn's internal API or
your cookies.

Things to know:

- Counts are keyword matches, not exact employees, so common company names include unrelated people.
- If the page shows no total, the extension counts the profile cards on screen and says "at least N".
- Automated use of LinkedIn can conflict with its terms. Keep it to one click per job, not bulk lookups.
- LinkedIn changes its markup often. If counts stop working, the popup shows the reason.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | Read the job details from the page you have open when you click the extension |
| `storage` | Keep your Notion token and database ID in this browser |
| `https://api.notion.com/*` | Save applications to your Notion workspace |
| `https://www.linkedin.com/*` | Connection check only |

Nothing is sent anywhere else. There is no analytics and no server.

## Project layout

```
manifest.json   Manifest V3 definition
popup.html/js   The popup: form, save/update, connection check
options.html/js Settings: token, database, schema check and fix
notion.js       Notion API wrapper and schema logic
extract.js      Job-page extraction (runs inside the page)
linkedin.js     LinkedIn result-count reader and summary text
style.css       Shared styles (light and dark)
icons/          Extension icons
```

## Troubleshooting

- **"Your file couldn't be accessed" (ERR_FILE_NOT_FOUND):** the folder was moved or deleted. Remove the
  extension and load the folder again.
- **Notion can't find the database:** open it in Notion, choose **••• > Connections**, and add your integration.
- **Columns couldn't be added:** enable *Update content* and *Insert content* on the integration.
- **Wrong company or role on a page:** edit the fields in the popup before saving. Extraction depends on
  each site's markup, which can change.

## Security

Your integration secret is stored in the browser's local extension storage and is sent only to
`api.notion.com`. Never commit a token to the repository.

## License

Add a license of your choice (for example MIT) before publishing.
