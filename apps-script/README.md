# Survey → Google Sheet + email notification

Every survey submission is appended as a row in a Google Sheet (with a
timestamp) and emailed to **m.dubrovskaya@gmail.com**.

## One-time setup (~10 minutes)

1. **Create the spreadsheet.** Go to [sheets.new](https://sheets.new) and name
   it something like *Harvest at Home — Survey Responses*. The `Responses`,
   `Questions` and `Errors` tabs are created automatically on the first
   submission; you don't need to add them or type any headers.

2. **Open the script editor.** In that spreadsheet: **Extensions → Apps Script**.

3. **Paste the code.** Delete whatever is in `Code.gs` and paste the full
   contents of `apps-script/Code.gs` from this repo. Save (⌘S).

4. **Authorize + smoke test.** In the toolbar's function dropdown pick
   `testSubmission`, click **Run**, and approve the permission prompts
   (Google will warn the app is unverified — choose *Advanced → Go to
   \<project name\> (unsafe)*; it's your own script). A test row should appear in
   the sheet and a test email in your inbox. Delete the test row afterwards.

5. **Deploy as a Web App.** **Deploy → New deployment → ⚙︎ → Web app**:
   - Description: `survey endpoint`
   - Execute as: **Me**
   - Who has access: **Anyone**  ← required; "Anyone with Google account" will
     block visitors who aren't signed in.

   Click **Deploy** and copy the **Web app URL** (ends in `/exec`).

6. **Paste the URL into the site.** Open `js/config.js` and set:

   ```js
   window.HARVEST_CONFIG = {
     surveyEndpoint: 'https://script.google.com/macros/s/AKfy…/exec'
   };
   ```

7. **Test from the site.** Open the site, complete the survey, and confirm a
   new row and a new email arrive.

> **Redeploying after editing the script:** use **Deploy → Manage deployments →
> ✏️ → Version: New version → Deploy**. That keeps the same URL. Creating a
> *new deployment* instead would give you a new URL that you'd have to paste
> into `config.js` again.

## How the sheet handles question changes

**Nothing is ever lost.** The script only ever *appends* columns — it never
renames, reorders or deletes one, so every answer stays in the cell it was
written to.

A column is identified by the pair **(`data-key`, exact question wording)**:

- **Add a question** → a new column appears at the far right. Older rows are
  simply blank there.
- **Edit / reword a question** → a **new column** is created, named
  `key (2)`, then `key (3)`, and so on. The old column and all its historical
  answers stay exactly as they were; new responses land in the new column.
- **Remove a question** → the column and its history stay put; new rows just
  leave it blank.

The `Questions` tab is the legend that ties it together — it lists every
wording ever used and which column holds its answers.

> Because *any* wording change makes a new column, a typo fix will also split
> the data. If you want an edit to keep feeding the original column, restore
> the exact previous wording — or merge the two columns by hand afterwards.

### Tabs the script maintains

| Tab | Contents |
| --- | --- |
| `Responses` | One row per submission: `Timestamp`, `Page URL`, `User Agent`, then one column per question version. |
| `Questions` | `Key`, `Question` wording, the `Column` it writes to, first seen, last seen. |
| `Errors` | Only appears if a submission fails; holds the raw payload so nothing is lost. |

## Editing the survey in `index.html`

Questions live in the `#survey-modal` block. To add one, copy an existing
`.survey-step` block, place it **above** the `data-success` step, and:

1. Give it the next `data-step` number, and renumber the success step so the
   numbering stays consecutive.
2. Put a unique `data-key` on the `.survey-options` group (multiple choice) or
   on the `input`/`textarea` (free text). That key names the sheet column.
3. Add `required` to a text input if it must be filled in. Multiple-choice
   steps are required automatically.

The step counter, progress bar and submit button adjust themselves — no
JavaScript changes needed.

## Changing the notification email

Edit `CONFIG.NOTIFY_EMAIL` at the top of `Code.gs`, then redeploy a new version.
Multiple recipients work as a comma-separated string.

Gmail accounts can send about 100 of these notification emails per day; the row
is written to the sheet before the email is sent, so hitting the cap would cost
you the notification, not the data.
