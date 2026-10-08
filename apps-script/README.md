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

4. **Deploy as a Web App.** **Deploy → New deployment → ⚙︎ → Web app**:
   - Description: `survey endpoint`
   - Execute as: **Me**
   - Who has access: **Anyone**  ← required; "Anyone with Google account" will
     block visitors who aren't signed in.

   Click **Deploy**, then approve the authorization prompts. Google will warn
   the app is unverified — it's your own script, so choose *Advanced → Go to
   \<project name\> (unsafe) → Allow*. Copy the **Web app URL** (ends in
   `/exec`).

5. **Paste the URL into the site.** Open `js/config.js` and set:

   ```js
   window.HARVEST_CONFIG = {
     surveyEndpoint: 'https://script.google.com/macros/s/AKfy…/exec'
   };
   ```

6. **Smoke-test the endpoint.** From a terminal:

   ```sh
   curl -sL "<EXEC_URL>"
   # {"ok":true,"service":"harvest-survey","time":"..."}
   ```

   If that returns HTML mentioning "Sign in", the access setting is wrong —
   redeploy with **Anyone**. Then post a fake submission.

   Apps Script answers a POST with a 302 to a one-shot `googleusercontent.com`
   URL. `curl -L` turns that into a GET that Google rejects ("Sorry, unable to
   open the file at this time"), so follow the redirect in two steps — note the
   **script still ran** either way, so a failed-looking `-L` attempt has
   already written its row:

   ```sh
   URL="<EXEC_URL>"
   BODY='{"meta":{"pageUrl":"curl-test"},"answers":[
          {"key":"zip","question":"ZIP?","answer":"78704"},
          {"key":"name","question":"Name","answer":"Curl Test"}]}'
   LOC=$(curl -s -o /dev/null -D - -X POST "$URL" \
           -H 'Content-Type: text/plain;charset=utf-8' -d "$BODY" \
         | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')
   curl -s "$LOC"
   # {"ok":true,"row":2}
   ```

   A row should appear in `Responses` and an email in your inbox. Delete the
   test row afterwards.

   Browsers are unaffected by this: `fetch` follows the redirect correctly, and
   the 302 carries `access-control-allow-origin: *`.

7. **Test from the site.** Open the site, complete the survey, and confirm a
   new row and a new email arrive.

> ⚠️ **After editing `js/config.js`, hard-reload the page (⇧⌘R).** A normal
> reload can keep serving the previously cached `config.js`, and a stale copy
> with an empty `surveyEndpoint` fails *silently* — the success screen still
> appears, but nothing is sent. The console says
> `[Harvest] No surveyEndpoint set in js/config.js` when this happens.
>
> To check which copy the page is actually running, open the console and
> evaluate `window.HARVEST_CONFIG.surveyEndpoint`.
>
> **On the live site** (GitHub Pages, <https://mariayasar.github.io/harvest-at-home/>)
> this self-heals: Pages serves `Cache-Control: max-age=600`, so a stale asset
> is at most 10 minutes old. Pages cannot send custom headers, so the `?v=N`
> query strings on the `<link>`/`<script>` tags in `index.html` are the only
> way to force an immediate refresh — **bump them whenever you edit
> `config.js`, `main.js`, or `styles.css`** and want the change picked up right
> away rather than within 10 minutes.
>
> Locally it does **not** self-heal: `python -m http.server` sends no cache
> headers at all, so a stale copy can persist indefinitely. Hard-reload.

> There is also a `testSubmission()` function at the bottom of `Code.gs` you
> can run from the editor (function dropdown → **Run**) if you'd rather check
> the script before deploying, or to debug later without touching the site.

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
