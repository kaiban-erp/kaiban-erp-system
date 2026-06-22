/**
 * KaiBan ERP 2.0｜網站寫入 + 商品主檔同步
 *
 * 作用：
 * 1. 網站送出資料後，新增到「採購紀錄」
 * 2. 若「商品主檔」已有同品項，更新最新資料
 * 3. 若沒有同品項，自動新增商品主檔
 *
 * 部署前只需修改 SPREADSHEET_ID。
 */

const SPREADSHEET_ID = "1cMuTP02AgFipF7_lS48AAL4v9wwTfaUUFUhpMww_D-8";
const PURCHASE_SHEET_NAME = "採購紀錄";
const PRODUCT_SHEET_NAME = "商品主檔";

const PURCHASE_HEADERS = [
  "日期", "供應商", "品項", "規格", "數量", "單位", "單價", "金額", "備註", "分類", "建立時間"
];

const PRODUCT_HEADERS = [
  "ERP代碼", "品項", "分類", "規格", "單位", "最新單價", "供應商", "最近採購日", "使用中", "備註"
];

function doGet() {
  return jsonOutput({
    ok: true,
    service: "KaiBan ERP Writer",
    syncProductMaster: true,
    time: new Date().toISOString()
  });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let lockAcquired = false;
  let requestAction = "";
  let requestId = "";

  try {
    if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf("請貼上") !== -1) {
      throw new Error("尚未設定 SPREADSHEET_ID");
    }

    const payloadText = e && e.parameter && e.parameter.payload
      ? e.parameter.payload
      : (e && e.postData ? e.postData.contents : "");

    if (!payloadText) throw new Error("沒有收到 payload");

    const payload = JSON.parse(payloadText);
    requestAction = clean(payload.action);
    requestId = clean(payload.requestId);

    if (requestAction === "analyzeReceipt") {
      const result = analyzeReceiptImage(payload);
      return htmlMessageOutput({
        source: "kaiban-receipt-analyzer",
        requestId: requestId,
        ok: true,
        result: result.result
      });
    }

    lock.waitLock(30000);
    lockAcquired = true;

    const records = Array.isArray(payload.records) ? payload.records : [];
    if (!records.length) throw new Error("沒有可寫入的採購資料");

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const timezone = spreadsheet.getSpreadsheetTimeZone() || "Asia/Taipei";

    const purchaseSheet = getOrCreateSheet(spreadsheet, PURCHASE_SHEET_NAME);
    const productSheet = getOrCreateSheet(spreadsheet, PRODUCT_SHEET_NAME);

    const purchaseMap = ensureHeaders(purchaseSheet, PURCHASE_HEADERS);
    const productMap = ensureHeaders(productSheet, PRODUCT_HEADERS);

    const normalizedRecords = records.map(function(record) {
      const qty = toNumber(record.qty);
      const price = toNumber(record.price);
      const amount = toNumber(record.amount) || qty * price;

      if (!record.date || !record.supplier || !record.name) {
        throw new Error("每筆資料都必須有日期、供應商與品項");
      }

      return {
        日期: normalizeDate(record.date, timezone),
        供應商: clean(record.supplier),
        品項: clean(record.name),
        規格: clean(record.spec),
        數量: qty,
        單位: clean(record.unit),
        單價: price,
        金額: amount,
        備註: clean(record.note),
        分類: clean(record.category || "未分類"),
        建立時間: Utilities.formatDate(new Date(), timezone, "yyyy/MM/dd HH:mm:ss")
      };
    });

    appendObjects(purchaseSheet, purchaseMap, normalizedRecords);
    const syncResult = syncProductMaster(productSheet, productMap, normalizedRecords);

    SpreadsheetApp.flush();

    return jsonOutput({
      ok: true,
      insertedPurchases: normalizedRecords.length,
      addedProducts: syncResult.added,
      updatedProducts: syncResult.updated
    });
  } catch (error) {
    console.error(error);
    const message = String(error && error.message ? error.message : error);
    if (requestAction === "analyzeReceipt") {
      return htmlMessageOutput({
        source: "kaiban-receipt-analyzer",
        requestId: requestId,
        ok: false,
        error: message
      });
    }
    return jsonOutput({ ok: false, error: message });
  } finally {
    if (lockAcquired) {
      try { lock.releaseLock(); } catch (ignore) {}
    }
  }
}

function syncProductMaster(sheet, headerMap, records) {
  const itemColumn = headerMap["品項"];
  const lastRow = sheet.getLastRow();
  const existingItems = lastRow >= 2
    ? sheet.getRange(2, itemColumn, lastRow - 1, 1).getDisplayValues().flat()
    : [];

  const rowByItem = {};
  existingItems.forEach(function(value, index) {
    const key = normalizeKey(value);
    if (key && !rowByItem[key]) rowByItem[key] = index + 2;
  });

  let nextCodeNumber = getMaxErpCodeNumber(sheet, headerMap) + 1;
  let added = 0;
  let updated = 0;

  records.forEach(function(record) {
    const key = normalizeKey(record.品項);
    if (!key) return;

    const existingRow = rowByItem[key];
    if (existingRow) {
      const updates = {
        "分類": record.分類,
        "規格": record.規格,
        "單位": record.單位,
        "最新單價": record.單價,
        "供應商": record.供應商,
        "最近採購日": record.日期,
        "使用中": true,
        "備註": record.備註
      };
      setObjectValues(sheet, existingRow, headerMap, updates, true);
      updated += 1;
    } else {
      const newRow = Math.max(sheet.getLastRow() + 1, 2);
      const newProduct = {
        "ERP代碼": "ING" + String(nextCodeNumber).padStart(4, "0"),
        "品項": record.品項,
        "分類": record.分類,
        "規格": record.規格,
        "單位": record.單位,
        "最新單價": record.單價,
        "供應商": record.供應商,
        "最近採購日": record.日期,
        "使用中": true,
        "備註": record.備註
      };
      setObjectValues(sheet, newRow, headerMap, newProduct, false);
      rowByItem[key] = newRow;
      nextCodeNumber += 1;
      added += 1;
    }
  });

  return { added: added, updated: updated };
}

function appendObjects(sheet, headerMap, objects) {
  if (!objects.length) return;

  const width = sheet.getLastColumn();
  const startRow = Math.max(sheet.getLastRow() + 1, 2);
  const values = objects.map(function(object) {
    const row = new Array(width).fill("");
    Object.keys(object).forEach(function(header) {
      const column = headerMap[header];
      if (column) row[column - 1] = object[header];
    });
    return row;
  });

  sheet.getRange(startRow, 1, values.length, width).setValues(values);
}

function setObjectValues(sheet, rowNumber, headerMap, object, preserveBlankIncoming) {
  Object.keys(object).forEach(function(header) {
    const column = headerMap[header];
    if (!column) return;

    const value = object[header];
    if (preserveBlankIncoming && (value === "" || value == null)) return;
    sheet.getRange(rowNumber, column).setValue(value);
  });
}

function ensureHeaders(sheet, requiredHeaders) {
  const currentWidth = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, currentWidth).getDisplayValues()[0];
  const map = {};

  current.forEach(function(header, index) {
    const name = clean(header);
    if (name) map[name] = index + 1;
  });

  requiredHeaders.forEach(function(header) {
    if (!map[header]) {
      const column = sheet.getLastColumn() + 1;
      sheet.getRange(1, column).setValue(header);
      map[header] = column;
    }
  });

  sheet.setFrozenRows(1);
  return map;
}

function getMaxErpCodeNumber(sheet, headerMap) {
  const column = headerMap["ERP代碼"];
  const lastRow = sheet.getLastRow();
  if (!column || lastRow < 2) return 0;

  return sheet.getRange(2, column, lastRow - 1, 1)
    .getDisplayValues()
    .flat()
    .reduce(function(max, code) {
      const match = String(code || "").match(/(\d+)/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
}

function getOrCreateSheet(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function normalizeKey(value) {
  return clean(value).toLowerCase().replace(/\s+/g, "");
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

function htmlMessageOutput(data) {
  const safeJson = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<script>window.parent.postMessage(' + safeJson + ', "*");<\/script>' +
    '</body></html>'
  );
}

function testGeminiKey() {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    throw new Error("找不到 GEMINI_API_KEY");
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    "gemini-2.5-flash:generateContent";

  const payload = {
    contents: [
      {
        parts: [
          {
            text: "請只回覆：連線成功"
          }
        ]
      }
    ]
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-goog-api-key": apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  console.log("狀態碼：" + statusCode);
  console.log(responseText);

  if (statusCode >= 300) {
    throw new Error(responseText);
  }
}
function analyzeReceiptImage(payload) {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    throw new Error("找不到 GEMINI_API_KEY");
  }

  const mimeType = clean(payload.mimeType || "image/jpeg");
  const imageBase64 = clean(payload.imageBase64)
    .replace(/^data:[^;]+;base64,/, "");

  if (!imageBase64) {
    throw new Error("沒有收到照片資料");
  }

  const prompt = `
你是開拌餐飲採購建檔助手。

請分析照片中的收據、發票、採購單或手寫單據，
並擷取可用於採購建檔的資料。

規則：
1. 使用繁體中文。
2. 不要猜測照片中看不到的內容。
3. 民國年份請換算成西元年份。
4. 日期格式統一為 YYYY/MM/DD。
5. 一張單據若有多個商品，請拆成多筆 items。
6. 不要把統一編號、稅額、付款方式或找零當成商品。
7. 數量、單價、金額只能回傳數字。
8. 看不清楚的文字填空字串，數字填 0。
9. 分類請從以下類別選擇：
   肉品、蔬菜、水果、海鮮、蛋類、乳品、調味料、
   飲品、乾貨、冷凍食品、包材、清潔用品、其他、未分類。
10. confidence 為 0 到 1，代表該品項辨識信心。
`;

  const responseSchema = {
    type: "object",
    properties: {
      documentType: {
        type: "string",
        description: "收據、發票、採購單、手寫單據或其他"
      },
      date: {
        type: "string",
        description: "單據日期，格式 YYYY/MM/DD"
      },
      supplier: {
        type: "string",
        description: "供應商或店家名稱"
      },
      invoiceNumber: {
        type: "string",
        description: "發票號碼或單據號碼"
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "商品或食材名稱"
            },
            category: {
              type: "string",
              description: "商品分類"
            },
            spec: {
              type: "string",
              description: "重量、容量、包裝或規格"
            },
            qty: {
              type: "number",
              description: "購買數量"
            },
            unit: {
              type: "string",
              description: "包、瓶、箱、公斤、台斤等單位"
            },
            price: {
              type: "number",
              description: "單價"
            },
            amount: {
              type: "number",
              description: "該品項總金額"
            },
            note: {
              type: "string",
              description: "折扣或其他補充資訊"
            },
            confidence: {
              type: "number",
              description: "辨識信心，0 到 1"
            }
          },
          required: [
            "name",
            "category",
            "spec",
            "qty",
            "unit",
            "price",
            "amount",
            "note",
            "confidence"
          ]
        }
      },
      total: {
        type: "number",
        description: "整張單據總金額"
      },
      note: {
        type: "string",
        description: "單據層級備註或辨識警告"
      }
    },
    required: [
      "documentType",
      "date",
      "supplier",
      "invoiceNumber",
      "items",
      "total",
      "note"
    ]
  };

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    "gemini-2.5-flash:generateContent";

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
      responseSchema: responseSchema
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-goog-api-key": apiKey
    },
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  });

  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode >= 300) {
    throw new Error(
      "Gemini 辨識失敗，狀態碼 " +
      statusCode +
      "：" +
      responseText
    );
  }

  const geminiResponse = JSON.parse(responseText);
  const candidates = geminiResponse.candidates || [];

  if (!candidates.length) {
    throw new Error("Gemini 沒有回傳辨識結果");
  }

  const parts =
    candidates[0].content &&
    candidates[0].content.parts
      ? candidates[0].content.parts
      : [];

  const jsonText = parts
    .map(function(part) {
      return part.text || "";
    })
    .join("")
    .trim();

  if (!jsonText) {
    throw new Error("Gemini 回傳內容為空");
  }

  const result = JSON.parse(jsonText);

  result.items = Array.isArray(result.items)
    ? result.items.map(function(item) {
        return {
          name: clean(item.name),
          category: clean(item.category || "未分類"),
          spec: clean(item.spec),
          qty: toNumber(item.qty),
          unit: clean(item.unit),
          price: toNumber(item.price),
          amount: toNumber(item.amount),
          note: clean(item.note),
          confidence: Math.max(
            0,
            Math.min(1, toNumber(item.confidence))
          )
        };
      })
    : [];

  return {
    ok: true,
    result: {
      documentType: clean(result.documentType),
      date: clean(result.date),
      supplier: clean(result.supplier),
      invoiceNumber: clean(result.invoiceNumber),
      items: result.items,
      total: toNumber(result.total),
      note: clean(result.note)
    }
  };
}