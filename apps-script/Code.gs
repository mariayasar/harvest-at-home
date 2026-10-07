/**
 * Harvest at Home — Survey backend
 *
 * Receives survey submissions from the website, appends them to a Google Sheet,
 * and emails a notification for every response.
 *
 * Schema evolution: columns are keyed by the survey field key (e.g. "zip",
 * "property"). Old columns are never removed or reordered — a new question
 * simply appends a new column at the far right, and older rows keep their
 * blank cells. Rewording a question does NOT create a new column, as long as
 * the field key stays the same.
 *
 * Setup instructions: see README.md in this folder.
 */

const CONFIG = {
  RESPONSES_SHEET: 'Responses',
  QUESTIONS_SHEET: 'Questions',
  NOTIFY_EMAIL: 'm.dubrovskaya@gmail.com',
  // Columns that always come first, in this order.
  BASE_HEADERS: ['Timestamp', 'Page URL', 'User Agent'],
};

/* ---------------------------------------------------------------- entry points */

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Serialize writes so two submissions can't add the same column twice.
    lock.waitLock(30000);

    const payload = parsePayload(e);
    const answers = normalizeAnswers(payload.answers);
    const timestamp = new Date();

    const row = appendResponse(timestamp, payload.meta || {}, answers);
    updateQuestionMap(timestamp, answers);
    sendNotification(timestamp, answers, row);

    return jsonResponse({ ok: true, row: row });
  } catch (err) {
    console.error(err);
    // Don't lose the submission just because the sheet or mail failed.
    logFailure(e, err);
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function doGet() {
  return jsonResponse({ ok: true, service: 'harvest-survey', time: new Date().toISOString() });
}

/* ---------------------------------------------------------------- payload */

function parsePayload(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Empty request body');
  }
  const payload = JSON.parse(e.postData.contents);
  if (!payload || !Array.isArray(payload.answers)) {
    throw new Error('Payload must contain an "answers" array');
  }
  return payload;
}

/**
 * answers: [{ key, question, answer }] — drops entries with no key,
 * de-duplicates repeated keys (last one wins) and preserves field order.
 */
function normalizeAnswers(answers) {
  const seen = {};
  const out = [];
  answers.forEach(function (a) {
    const key = String(a && a.key || '').trim();
    if (!key) return;
    const entry = {
      key: key,
      question: String(a.question || '').trim(),
      answer: a.answer == null ? '' : String(a.answer).trim(),
    };
    if (seen[key] !== undefined) {
      out[seen[key]] = entry;
    } else {
      seen[key] = out.length;
      out.push(entry);
    }
  });
  return out;
}

/* ---------------------------------------------------------------- sheet writes */

function appendResponse(timestamp, meta, answers) {
  const sheet = getSheet(CONFIG.RESPONSES_SHEET);
  let headers = readHeaders(sheet);

  if (!headers.length) {
    headers = CONFIG.BASE_HEADERS.slice();
  }

  // Append a column for any key we haven't seen before. Existing columns keep
  // their position so historical data stays aligned.
  const wanted = CONFIG.BASE_HEADERS.concat(answers.map(function (a) { return a.key; }));
  let headersChanged = false;
  wanted.forEach(function (name) {
    if (headers.indexOf(name) === -1) {
      headers.push(name);
      headersChanged = true;
    }
  });

  if (headersChanged || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const row = new Array(headers.length).fill('');
  row[headers.indexOf('Timestamp')] = timestamp;
  if (headers.indexOf('Page URL') !== -1) row[headers.indexOf('Page URL')] = meta.pageUrl || '';
  if (headers.indexOf('User Agent') !== -1) row[headers.indexOf('User Agent')] = meta.userAgent || '';

  answers.forEach(function (a) {
    const idx = headers.indexOf(a.key);
    if (idx !== -1) row[idx] = a.answer;
  });

  sheet.appendRow(row);
  return sheet.getLastRow();
}

/**
 * Keeps a human-readable map of column key -> current question wording, so the
 * sheet stays legible after questions are edited.
 */
function updateQuestionMap(timestamp, answers) {
  const sheet = getSheet(CONFIG.QUESTIONS_SHEET);
  const headers = ['Key', 'Question', 'First seen', 'Last seen'];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const lastRow = sheet.getLastRow();
  const existing = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
    : [];
  const indexByKey = {};
  existing.forEach(function (r, i) { indexByKey[String(r[0])] = i + 2; });

  answers.forEach(function (a) {
    const rowNum = indexByKey[a.key];
    if (rowNum) {
      sheet.getRange(rowNum, 2).setValue(a.question);
      sheet.getRange(rowNum, 4).setValue(timestamp);
    } else {
      sheet.appendRow([a.key, a.question, timestamp, timestamp]);
      indexByKey[a.key] = sheet.getLastRow();
    }
  });
}

function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function readHeaders(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0]
    .map(function (v) { return String(v).trim(); })
    .filter(function (v) { return v !== ''; });
}

/**
 * Last-resort log so a submission is never silently lost if the main write or
 * the email throws.
 */
function logFailure(e, err) {
  try {
    const sheet = getSheet('Errors');
    if (sheet.getLastRow() === 0) sheet.appendRow(['Timestamp', 'Error', 'Raw body']);
    sheet.appendRow([
      new Date(),
      String(err && err.stack || err),
      e && e.postData ? String(e.postData.contents).slice(0, 40000) : '',
    ]);
  } catch (ignored) {}
}

/* ---------------------------------------------------------------- email */

function sendNotification(timestamp, answers, rowNumber) {
  const byKey = {};
  answers.forEach(function (a) { byKey[a.key] = a.answer; });

  const name = byKey.name || 'New response';
  const zip = byKey.zip ? ' — ' + byKey.zip : '';
  const subject = 'Garden assessment: ' + name + zip;

  const rows = answers.map(function (a) {
    return '<tr>' +
      '<td style="padding:6px 14px 6px 0;vertical-align:top;color:#555;">' +
        escapeHtml(a.question || a.key) +
      '</td>' +
      '<td style="padding:6px 0;vertical-align:top;"><strong>' +
        escapeHtml(a.answer || '—') +
      '</strong></td>' +
    '</tr>';
  }).join('');

  const sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
  const tz = Session.getScriptTimeZone();

  const html =
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222;">' +
      '<h2 style="margin:0 0 4px;">New garden assessment</h2>' +
      '<p style="margin:0 0 16px;color:#777;">' +
        Utilities.formatDate(timestamp, tz, 'EEEE, MMMM d, yyyy · h:mm a') +
        ' · row ' + rowNumber +
      '</p>' +
      '<table style="border-collapse:collapse;">' + rows + '</table>' +
      '<p style="margin:20px 0 0;"><a href="' + sheetUrl + '">Open the responses sheet →</a></p>' +
    '</div>';

  const plain = answers.map(function (a) {
    return (a.question || a.key) + '\n  ' + (a.answer || '—');
  }).join('\n\n') + '\n\n' + sheetUrl;

  MailApp.sendEmail({
    to: CONFIG.NOTIFY_EMAIL,
    subject: subject,
    body: plain,
    htmlBody: html,
    replyTo: byKey.email || undefined,
    name: 'Harvest at Home',
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------------------------------------------------------- test helper */

/** Run this once from the editor to grant permissions and verify end to end. */
function testSubmission() {
  const res = doPost({
    postData: {
      contents: JSON.stringify({
        meta: { pageUrl: 'https://example.com/', userAgent: 'Apps Script test' },
        answers: [
          { key: 'zip', question: "What's your ZIP code?", answer: '78704' },
          { key: 'property', question: 'What best describes your property?', answer: 'House with a yard' },
          { key: 'name', question: 'Where can we send your results?', answer: 'Test Person' },
          { key: 'email', question: 'Email', answer: 'test@example.com' },
        ],
      }),
    },
  });
  console.log(res.getContent());
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
