/**
 * KaiBan ERP 2.0｜Google Apps Script 寫入接口
 *
 * 使用方式：
 * 1. 打開你的 Google Sheet。
 * 2. 擴充功能 → Apps Script。
 * 3. 貼上本檔內容。
 * 4. 把 SPREADSHEET_ID 改成試算表網址 /d/ 與 /edit 之間的字串。
 * 5. 部署 → 新增部署作業 → 網頁應用程式。
 * 6. 執行身分：我；誰可以存取：所有人。
 * 7. 把部署後的 /exec 網址貼到網站 app.js 的 APPS_SCRIPT_URL。
 */

const SPREADSHEET_ID = "請貼上你的 Google Sheet ID";
const PURCHASE_SHEET_NAME = "採購紀錄";
const HEADERS = ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "備註", "建立時間"];

function doGet() {
  return jsonOutput({ ok: true, service: "KaiBan ERP Writer", time: new Date().toISOString() });
}

function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    const payloadText = e && e.parameter && e.parameter.payload
      ? e.parameter.payload
      : (e && e.postData ? e.postData.contents : "");

    if (!payloadText) throw new Error("沒有收到 payload");

    const payload = JSON.parse(payloadText);
    const records = Array.isArray(payload.records) ? payload.records : [];
    if (!records.length) throw new Error("沒有可寫入的採購資料");

    if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf("請貼上") !== -1) {
      throw new Error("尚未設定 SPREADSHEET_ID");
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(PURCHASE_SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(PURCHASE_SHEET_NAME);

    ensureHeaders(sheet);

    const now = new Date();
    const timezone = spreadsheet.getSpreadsheetTimeZone() || "Asia/Taipei";
    const values = records.map(function(record) {
      const qty = toNumber(record.qty);
      const price = toNumber(record.price);
      const amount = toNumber(record.amount) || qty * price;

      if (!record.date || !record.supplier || !record.name) {
        throw new Error("每筆資料都必須有日期、供應商與品項");
      }

      return [
        normalizeDate(record.date, timezone),
        clean(record.supplier),
        clean(record.name),
        clean(record.category || "未分類"),
        clean(record.spec),
        qty,
        clean(record.unit),
        price,
        amount,
        clean(record.note),
        Utilities.formatDate(now, timezone, "yyyy/MM/dd HH:mm:ss"),
      ];
    });

    const startRow = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(startRow, 1, values.length, HEADERS.length).setValues(values);
    SpreadsheetApp.flush();

    return jsonOutput({ ok: true, inserted: values.length });
  } catch (error) {
    console.error(error);
    return jsonOutput({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function ensureHeaders(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  const isEmpty = current.every(function(value) { return !value; });

  if (isEmpty) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    return;
  }

  HEADERS.forEach(function(header, index) {
    if (!current[index]) sheet.getRange(1, index + 1).setValue(header);
  });
}

function normalizeDate(value, timezone) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return match[1] + "/" + String(match[2]).padStart(2, "0") + "/" + String(match[3]).padStart(2, "0");
  }

  const date = new Date(text);
  if (isNaN(date.getTime())) return text;
  return Utilities.formatDate(date, timezone, "yyyy/MM/dd");
}

function toNumber(value) {
  const number = Number(String(value == null ? "" : value).replace(/[$,，\s]/g, ""));
  return isFinite(number) ? number : 0;
}

function clean(value) {
  return String(value == null ? "" : value).trim();
}

function jsonOutput(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
