// =====================================================
// KaiBan ERP 2.0
// 1. Google Sheet CSV 讀取
// 2. data.js 備援資料
// 3. 每月支出分析
// 4. 快速建檔 + Google Apps Script 寫入
// =====================================================

<<<<<<< HEAD
=======
const PRODUCT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?gid=0&single=true&output=csv";
const PURCHASE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?gid=1520549665&single=true&output=csv";

>>>>>>> 5e25244 (更新 CSV 網址)
// 完成 Apps Script 部署後，把 /exec 網址貼在引號內。
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwlZ6wJFevpbijE8V76D-OEVYQZM7fveWRTlySROtMWSYeKEuEr1-WUrdtUJcUA-4Z2/exec";

const STAGED_STORAGE_KEY = "kaiban-erp-staged-v2";
const AUTH_TOKEN_KEY = "kaiban-erp-auth-token";
const API_MESSAGE_SOURCE = "kaiban-erp-api";
const $ = (id) => document.getElementById(id);

let products = [];
let purchases = [];
let stagedRecords = loadStagedRecords();
let selectedMonth = "";
let amountWasEdited = false;
let receiptImagePayload = null;
let receiptAnalysis = null;
let authToken = sessionStorage.getItem(AUTH_TOKEN_KEY) || "";
let authenticationReady = false;

const pageDescriptions = {
  dashboard: "採購、食材、供應商與每月支出集中管理。",
  foods: "搜尋品項並比較歷史價格。",
  purchases: "查看所有採購明細與匯出資料。",
  monthly: "依月份分析總支出、供應商與品項分類。",
  photoEntry: "拍照辨識收據、發票或採購單，確認後快速建檔。",
  quickEntry: "逐筆輸入或批次貼上，快速累積採購資料庫。",
  suppliers: "查看各供應商累計採購金額與品項數。",
};

const money = (value) => {
  const number = toNumber(value);
  return "$" + number.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
};

const toNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[$,，\s]/g, "");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
};

const norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, "");

const escapeHTML = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

document.addEventListener("DOMContentLoaded", () => {
  setupAuthentication();
  setupNavigation();
  setupSearch();
  setupMonthly();
  setupQuickEntry();
  setupPhotoEntry();
  setupExports();
  setDefaultEntryDate();
  updateApiBadge();
  renderStagedRecords();
  restoreAuthentication();
});


function setupAuthentication() {
  $("loginForm").addEventListener("submit", handleLoginSubmit);
  $("logoutButton").addEventListener("click", logoutErp);
}

async function restoreAuthentication() {
  lockErp();
  if (!authToken) return;

  setLoginBusy(true, "正在驗證登入…");
  try {
    await secureApiRequest({ action: "validateSession" }, { includeToken: true, timeoutMs: 30000 });
    unlockErp();
    await loadData();
  } catch (error) {
    clearAuthentication();
    showLoginError("登入已失效，請重新輸入密碼。");
  } finally {
    setLoginBusy(false);
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const password = $("loginPassword").value;
  if (!password) return;

  hideLoginError();
  setLoginBusy(true, "登入驗證中…");

  try {
    const response = await secureApiRequest(
      { action: "login", password: password },
      { includeToken: false, timeoutMs: 30000 }
    );

    authToken = String(response.token || "");
    if (!authToken) throw new Error("伺服器沒有回傳登入憑證");

    sessionStorage.setItem(AUTH_TOKEN_KEY, authToken);
    $("loginPassword").value = "";
    unlockErp();
    await loadData();
  } catch (error) {
    clearAuthentication();
    showLoginError(error.message || "登入失敗");
    $("loginPassword").focus();
  } finally {
    setLoginBusy(false);
  }
}

function unlockErp() {
  authenticationReady = true;
  document.body.classList.remove("authLocked");
  $("authGate").hidden = true;
  updateApiBadge();
}

function lockErp() {
  authenticationReady = false;
  document.body.classList.add("authLocked");
  $("authGate").hidden = false;
  updateApiBadge();
}

function logoutErp() {
  clearAuthentication();
  products = [];
  purchases = [];
  lockErp();
  $("loginPassword").value = "";
  hideNotice();
  setDataStatus("等待登入", "");
  window.scrollTo({ top: 0 });
  setTimeout(() => $("loginPassword").focus(), 50);
}

function clearAuthentication() {
  authToken = "";
  authenticationReady = false;
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

function setLoginBusy(isBusy, text = "登入 ERP") {
  const button = $("loginButton");
  button.disabled = isBusy;
  button.textContent = isBusy ? text : "登入 ERP";
  $("loginPassword").disabled = isBusy;
}

function showLoginError(message) {
  const errorBox = $("loginError");
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideLoginError() {
  $("loginError").hidden = true;
}

function handleAuthenticationFailure(message) {
  clearAuthentication();
  lockErp();
  showLoginError(message || "登入已失效，請重新輸入密碼。");
  setTimeout(() => $("loginPassword").focus(), 50);
}

function secureApiRequest(payload, options = {}) {
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_URL.includes("/exec")) {
    return Promise.reject(new Error("尚未設定 Apps Script 網址"));
  }

  const requestId = `erp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const includeToken = options.includeToken !== false;
  const requestPayload = {
    ...payload,
    requestId,
  };

  if (includeToken) requestPayload.token = authToken;

  return new Promise((resolve, reject) => {
    const iframeName = `kaiban-api-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const iframe = document.createElement("iframe");
    iframe.name = iframeName;
    iframe.hidden = true;

    const form = document.createElement("form");
    form.method = "POST";
    form.action = APPS_SCRIPT_URL;
    form.target = iframeName;
    form.hidden = true;

    const field = document.createElement("input");
    field.type = "hidden";
    field.name = "payload";
    field.value = JSON.stringify(requestPayload);
    form.appendChild(field);

    let finished = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      form.remove();
      iframe.remove();
    };

    const finish = (callback) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      cleanup();
      callback();
    };

    const onMessage = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.source !== API_MESSAGE_SOURCE || data.requestId !== requestId) return;

      finish(() => {
        if (data.ok) {
          resolve(data);
          return;
        }

        if (data.code === "AUTH_REQUIRED") {
          handleAuthenticationFailure(data.error);
        }
        reject(new Error(data.error || "伺服器沒有完成要求"));
      });
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error("連線逾時，請稍後再試")));
    }, options.timeoutMs || 45000);

    iframe.addEventListener("error", () => {
      finish(() => reject(new Error("無法連線到 Apps Script")));
    });

    window.addEventListener("message", onMessage);
    document.body.append(iframe, form);
    form.submit();
  });
}

function setupNavigation() {
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));

      button.classList.add("active");
      const viewId = button.dataset.view;
      const view = $(viewId);
      if (view) view.classList.add("active");

      $("pageTitle").textContent = button.dataset.title || button.textContent.trim();
      $("pageDescription").textContent = pageDescriptions[viewId] || "";
      $("globalSearch").style.display = ["quickEntry", "photoEntry"].includes(viewId) ? "none" : "block";

      if (viewId === "monthly") renderMonthly();
      if (viewId === "quickEntry") renderStagedRecords();
      if (viewId === "photoEntry") renderReceiptAnalysis();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  $("reloadData").addEventListener("click", () => { if (authenticationReady) loadData(); });
}

function setupSearch() {
  $("globalSearch").addEventListener("input", render);
}

function setupMonthly() {
  $("monthPicker").addEventListener("change", (event) => {
    selectedMonth = event.target.value;
    renderMonthly();
  });
}

function setupQuickEntry() {
  $("quickForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const record = getQuickFormRecord();
    if (!record) return;
    stagedRecords.push(record);
    saveStagedRecords();
    renderStagedRecords();
    resetQuickForm({ keepDate: true, keepSupplier: true });
    showNotice(`已加入「${record.name}」到待送清單。`);
  });

  $("entryQty").addEventListener("input", calculateEntryAmount);
  $("entryPrice").addEventListener("input", calculateEntryAmount);
  $("entryAmount").addEventListener("input", () => { amountWasEdited = true; });
  $("resetQuickForm").addEventListener("click", () => resetQuickForm());
  $("parseBulk").addEventListener("click", parseBulkPaste);
  $("downloadTemplate").addEventListener("click", downloadTemplate);
  $("downloadStaged").addEventListener("click", () => downloadPurchasesCsv(stagedRecords, "開拌_待匯入採購.csv"));
  $("clearStaged").addEventListener("click", clearStagedRecords);
  $("submitStaged").addEventListener("click", submitStagedRecords);

  $("stagedRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-index]");
    if (!button) return;
    const index = Number(button.dataset.removeIndex);
    stagedRecords.splice(index, 1);
    saveStagedRecords();
    renderStagedRecords();
  });
}


function setupPhotoEntry() {
  const fileInput = $("receiptFile");
  const analyzeButton = $("analyzeReceipt");
  const clearButton = $("clearReceipt");
  const reanalyzeButton = $("reanalyzeReceipt");
  const addButton = $("addReceiptToStaged");
  const addItemButton = $("addReceiptItem");

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showNotice("請選擇照片檔案。", "error");
      fileInput.value = "";
      return;
    }

    setReceiptStatus("正在處理照片…");
    analyzeButton.disabled = true;
    clearButton.disabled = true;

    try {
      receiptImagePayload = await compressReceiptImage(file);
      $("receiptPreview").src = receiptImagePayload.dataUrl;
      $("receiptFileName").textContent = file.name || "現場拍照";
      $("receiptFileSize").textContent = formatFileSize(receiptImagePayload.bytes);
      $("receiptPreviewWrap").hidden = false;
      analyzeButton.disabled = false;
      clearButton.disabled = false;
      setReceiptStatus("照片已準備完成，請按「AI 智慧辨識」。", "ready");
    } catch (error) {
      clearReceiptPhoto();
      showNotice(`照片處理失敗：${error.message}`, "error");
    }
  });

  analyzeButton.addEventListener("click", analyzeReceiptPhoto);
  reanalyzeButton.addEventListener("click", analyzeReceiptPhoto);
  clearButton.addEventListener("click", clearReceiptPhoto);
  addButton.addEventListener("click", addReceiptAnalysisToStaged);
  addItemButton.addEventListener("click", addBlankReceiptItem);

  $("receiptDate").addEventListener("input", (event) => {
    if (!receiptAnalysis) return;
    receiptAnalysis.date = event.target.value;
    receiptAnalysis.dateStatus = "confirmed";
    applyReceiptHeaderStatus();
  });

  $("receiptSupplier").addEventListener("input", (event) => {
    if (!receiptAnalysis) return;
    receiptAnalysis.supplier = event.target.value;
    receiptAnalysis.supplierStatus = "confirmed";
    applyReceiptHeaderStatus();
  });

  $("receiptRows").addEventListener("input", handleReceiptRowInput);
  $("receiptRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-receipt-remove]");
    if (!button || !receiptAnalysis) return;
    const index = Number(button.dataset.receiptRemove);
    receiptAnalysis.items.splice(index, 1);
    renderReceiptAnalysis();
  });
}

async function compressReceiptImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
  const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const outputDataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const base64 = outputDataUrl.split(",")[1] || "";
  return {
    dataUrl: outputDataUrl,
    imageBase64: base64,
    mimeType: "image/jpeg",
    bytes: Math.round(base64.length * 0.75),
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("無法讀取照片"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("瀏覽器無法開啟這張照片，請改用 JPG 或 PNG"));
    image.src = src;
  });
}

async function analyzeReceiptPhoto() {
  if (!receiptImagePayload) {
    showNotice("請先拍照或選擇照片。", "warn");
    return;
  }

  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_URL.includes("/exec")) {
    showNotice("尚未設定 Apps Script 寫入網址。", "error");
    return;
  }

  const buttons = [$("analyzeReceipt"), $("reanalyzeReceipt")];
  buttons.forEach((button) => { button.disabled = true; });
  setReceiptStatus("AI 先快速讀取；遇到手寫、模糊或特殊格式時會自動加強辨識…", "loading");

  try {
    const response = await secureApiRequest({
      action: "analyzeReceipt",
      mimeType: receiptImagePayload.mimeType,
      imageBase64: receiptImagePayload.imageBase64,
    }, { timeoutMs: 180000 });

    receiptAnalysis = normalizeReceiptAnalysis(response.result || {});
    renderReceiptAnalysis();
    const modeText = receiptAnalysis.enhancedAnalysis ? "已使用加強辨識" : "快速辨識完成";
    setReceiptStatus(`${modeText}，找到 ${receiptAnalysis.items.length} 個品項。`, "success");
    showNotice("AI 已把可讀內容轉成 ERP 欄位。請優先檢查黃色推算欄位與紅色待確認欄位。");
  } catch (error) {
    setReceiptStatus("辨識失敗，請確認 Apps Script 已重新部署。", "error");
    showNotice(`AI 辨識失敗：${error.message}`, "error");
  } finally {
    buttons.forEach((button) => { button.disabled = !receiptImagePayload; });
  }
}

function normalizeReceiptAnalysis(result) {
  return {
    documentType: String(result.documentType || "單據"),
    documentQuality: normalizeQuality(result.documentQuality),
    isHandwritten: Boolean(result.isHandwritten),
    modelUsed: String(result.modelUsed || ""),
    enhancedAnalysis: Boolean(result.enhancedAnalysis),
    date: dateToInputValue(result.date),
    dateStatus: normalizeFieldStatus(result.dateStatus, result.date ? "read" : "missing"),
    supplier: String(result.supplier || ""),
    supplierStatus: normalizeFieldStatus(result.supplierStatus, result.supplier ? "read" : "missing"),
    invoiceNumber: String(result.invoiceNumber || ""),
    invoiceNumberStatus: normalizeFieldStatus(result.invoiceNumberStatus, result.invoiceNumber ? "read" : "missing"),
    total: toNumber(result.total),
    totalStatus: normalizeFieldStatus(result.totalStatus, toNumber(result.total) > 0 ? "read" : "missing"),
    note: String(result.note || ""),
    rawText: String(result.rawText || ""),
    issues: Array.isArray(result.issues) ? result.issues.map(String).filter(Boolean) : [],
    items: Array.isArray(result.items) ? result.items.map((item) => normalizeReceiptItem(item)) : [],
  };
}

function normalizeReceiptItem(item = {}) {
  const qty = toNumber(item.qty);
  const price = toNumber(item.price);
  const amount = toNumber(item.amount);
  const source = item.fieldStatus || {};
  return {
    name: String(item.name || ""),
    category: String(item.category || "未分類"),
    spec: String(item.spec || ""),
    qty,
    unit: String(item.unit || ""),
    price,
    amount,
    note: String(item.note || ""),
    originalLine: String(item.originalLine || ""),
    confidence: Math.max(0, Math.min(1, toNumber(item.confidence))),
    reviewReasons: Array.isArray(item.reviewReasons) ? item.reviewReasons.map(String).filter(Boolean) : [],
    fieldStatus: {
      name: normalizeFieldStatus(source.name, item.name ? "read" : "missing"),
      category: normalizeFieldStatus(source.category, item.category ? "inferred" : "missing"),
      spec: normalizeFieldStatus(source.spec, item.spec ? "read" : "missing"),
      qty: normalizeFieldStatus(source.qty, qty > 0 ? "read" : "missing"),
      unit: normalizeFieldStatus(source.unit, item.unit ? "read" : "missing"),
      price: normalizeFieldStatus(source.price, price > 0 ? "read" : "missing"),
      amount: normalizeFieldStatus(source.amount, amount > 0 ? "read" : "missing"),
      note: normalizeFieldStatus(source.note, item.note ? "read" : "missing"),
    },
  };
}

function normalizeFieldStatus(value, fallback = "missing") {
  const status = String(value || "").toLowerCase();
  return ["read", "inferred", "missing", "confirmed"].includes(status) ? status : fallback;
}

function normalizeQuality(value) {
  const quality = String(value || "").toLowerCase();
  return ["clear", "usable", "difficult"].includes(quality) ? quality : "usable";
}

function renderReceiptAnalysis() {
  const empty = $("receiptResultEmpty");
  const result = $("receiptResult");
  if (!receiptAnalysis) {
    empty.hidden = false;
    result.hidden = true;
    $("receiptModelBadge").textContent = "尚未辨識";
    $("receiptQualityBadge").textContent = "品質未判定";
    return;
  }

  empty.hidden = true;
  result.hidden = false;
  $("receiptDate").value = receiptAnalysis.date || "";
  $("receiptSupplier").value = receiptAnalysis.supplier || "";
  $("receiptDocumentType").textContent = receiptAnalysis.documentType || "單據";
  $("receiptInvoiceNumber").textContent = receiptAnalysis.invoiceNumber ? `單號：${receiptAnalysis.invoiceNumber}` : "";
  $("receiptNote").textContent = receiptAnalysis.note || "";
  $("receiptRawText").value = receiptAnalysis.rawText || "";

  $("receiptModelBadge").textContent = receiptAnalysis.enhancedAnalysis ? "加強辨識" : "快速辨識";
  $("receiptModelBadge").className = `analysisBadge ${receiptAnalysis.enhancedAnalysis ? "enhanced" : "fast"}`;
  $("receiptQualityBadge").textContent = qualityLabel(receiptAnalysis.documentQuality);
  $("receiptQualityBadge").className = `analysisBadge quality-${receiptAnalysis.documentQuality}`;
  applyReceiptHeaderStatus();
  renderReceiptIssues();

  const computedTotal = receiptAnalysis.items.reduce((sum, item) => sum + toNumber(item.amount), 0);
  $("receiptTotal").textContent = money(receiptAnalysis.total || computedTotal);

  $("receiptRows").innerHTML = receiptAnalysis.items.length
    ? receiptAnalysis.items.map((item, index) => renderReceiptItemRow(item, index)).join("")
    : '<tr><td colspan="10" class="empty">沒有辨識到品項。可按「新增空白品項」手動補入，或換一張更清楚的照片。</td></tr>';

  $("addReceiptToStaged").disabled = !receiptAnalysis.items.length;
}

function renderReceiptItemRow(item, index) {
  const status = item.fieldStatus || {};
  return `
    <tr data-receipt-index="${index}" class="${item.confidence < 0.55 ? "lowConfidenceRow" : ""}">
      <td><input class="tableInput itemName ${fieldStatusClass(status.name)}" title="${fieldStatusTitle(status.name)}" data-receipt-field="name" value="${escapeHTML(item.name)}" placeholder="品項"></td>
      <td><input class="tableInput ${fieldStatusClass(status.category)}" title="${fieldStatusTitle(status.category)}" data-receipt-field="category" value="${escapeHTML(item.category)}" list="categoryOptions"></td>
      <td><input class="tableInput ${fieldStatusClass(status.spec)}" title="${fieldStatusTitle(status.spec)}" data-receipt-field="spec" value="${escapeHTML(item.spec)}"></td>
      <td><input class="tableInput numberInput ${fieldStatusClass(status.qty)}" title="${fieldStatusTitle(status.qty)}" data-receipt-field="qty" type="number" min="0" step="0.01" value="${displayNumberInput(item.qty)}"></td>
      <td><input class="tableInput unitInput ${fieldStatusClass(status.unit)}" title="${fieldStatusTitle(status.unit)}" data-receipt-field="unit" value="${escapeHTML(item.unit)}" list="unitOptions"></td>
      <td><input class="tableInput numberInput ${fieldStatusClass(status.price)}" title="${fieldStatusTitle(status.price)}" data-receipt-field="price" type="number" min="0" step="0.01" value="${displayNumberInput(item.price)}"></td>
      <td><input class="tableInput numberInput ${fieldStatusClass(status.amount)}" title="${fieldStatusTitle(status.amount)}" data-receipt-field="amount" type="number" min="0" step="0.01" value="${displayNumberInput(item.amount)}"></td>
      <td><span class="confidence ${confidenceClass(item.confidence)}">${Math.round(item.confidence * 100)}%</span></td>
      <td><div class="itemStatusSummary" title="${escapeHTML(item.reviewReasons.join("；") || item.originalLine)}">${renderItemStatusSummary(item)}</div></td>
      <td><button class="removeRow" type="button" data-receipt-remove="${index}">刪除</button></td>
    </tr>`;
}

function displayNumberInput(value) {
  const number = toNumber(value);
  return number > 0 ? number : "";
}

function handleReceiptRowInput(event) {
  const input = event.target.closest("[data-receipt-field]");
  const row = event.target.closest("[data-receipt-index]");
  if (!input || !row || !receiptAnalysis) return;
  const index = Number(row.dataset.receiptIndex);
  const item = receiptAnalysis.items[index];
  if (!item) return;
  const field = input.dataset.receiptField;
  item[field] = ["qty", "price", "amount"].includes(field) ? toNumber(input.value) : input.value;
  item.fieldStatus[field] = "confirmed";
  input.classList.remove("field-read", "field-inferred", "field-missing");
  input.classList.add("field-confirmed");
  input.title = fieldStatusTitle("confirmed");

  if (["qty", "price"].includes(field) && item.qty > 0 && item.price > 0) {
    item.amount = roundMoney(item.qty * item.price);
    item.fieldStatus.amount = "confirmed";
    const amountInput = row.querySelector('[data-receipt-field="amount"]');
    if (amountInput) {
      amountInput.value = item.amount;
      amountInput.classList.remove("field-read", "field-inferred", "field-missing");
      amountInput.classList.add("field-confirmed");
      amountInput.title = fieldStatusTitle("confirmed");
    }
  }

  const summary = row.querySelector(".itemStatusSummary");
  if (summary) summary.innerHTML = renderItemStatusSummary(item);
  const total = receiptAnalysis.items.reduce((sum, current) => sum + toNumber(current.amount), 0);
  $("receiptTotal").textContent = money(total);
}

function addBlankReceiptItem() {
  if (!receiptAnalysis) {
    receiptAnalysis = normalizeReceiptAnalysis({});
  }
  receiptAnalysis.items.push(normalizeReceiptItem({
    category: "未分類",
    confidence: 0,
    fieldStatus: {
      name: "missing", category: "missing", spec: "missing", qty: "missing",
      unit: "missing", price: "missing", amount: "missing", note: "missing",
    },
    reviewReasons: ["人工新增，請確認所有欄位"],
  }));
  renderReceiptAnalysis();
}

function applyReceiptHeaderStatus() {
  if (!receiptAnalysis) return;
  applyStatusToInput($("receiptDate"), receiptAnalysis.dateStatus);
  applyStatusToInput($("receiptSupplier"), receiptAnalysis.supplierStatus);
  $("receiptDateHint").textContent = fieldStatusTitle(receiptAnalysis.dateStatus);
  $("receiptSupplierHint").textContent = fieldStatusTitle(receiptAnalysis.supplierStatus);
}

function applyStatusToInput(input, status) {
  if (!input) return;
  input.classList.remove("field-read", "field-inferred", "field-missing", "field-confirmed");
  input.classList.add(fieldStatusClass(status));
  input.title = fieldStatusTitle(status);
}

function renderReceiptIssues() {
  const box = $("receiptIssues");
  if (!receiptAnalysis || !receiptAnalysis.issues.length) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  box.hidden = false;
  box.innerHTML = `<strong>需要留意</strong><ul>${receiptAnalysis.issues.map((issue) => `<li>${escapeHTML(issue)}</li>`).join("")}</ul>`;
}

function renderItemStatusSummary(item) {
  const values = Object.values(item.fieldStatus || {});
  const counts = values.reduce((result, value) => {
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
  const chips = [];
  if (counts.read) chips.push(`<span class="miniStatus read">原文 ${counts.read}</span>`);
  if (counts.inferred) chips.push(`<span class="miniStatus inferred">推算 ${counts.inferred}</span>`);
  if (counts.missing) chips.push(`<span class="miniStatus missing">待確認 ${counts.missing}</span>`);
  if (counts.confirmed) chips.push(`<span class="miniStatus confirmed">已確認 ${counts.confirmed}</span>`);
  return chips.join("");
}

function fieldStatusClass(status) {
  return `field-${normalizeFieldStatus(status)}`;
}

function fieldStatusTitle(status) {
  return {
    read: "原文辨識：照片上直接看得到",
    inferred: "AI 推算：由其他可讀資料計算或分類",
    missing: "待確認：照片沒有或無法判讀",
    confirmed: "已修改確認",
  }[normalizeFieldStatus(status)] || "待確認";
}

function qualityLabel(quality) {
  return { clear: "照片清楚", usable: "可用但需確認", difficult: "辨識困難" }[normalizeQuality(quality)];
}

function addReceiptAnalysisToStaged() {
  if (!receiptAnalysis || !receiptAnalysis.items.length) return;
  const date = $("receiptDate").value;
  const supplier = $("receiptSupplier").value.trim();
  if (!date || !supplier) {
    showNotice("日期與供應商是建檔必要欄位；紅色欄位請先補齊。", "warn");
    return;
  }

  const validItems = receiptAnalysis.items.filter((item) => item.name.trim());
  if (!validItems.length) {
    showNotice("至少要有一個品項名稱。", "warn");
    return;
  }

  const noAmountItems = validItems.filter((item) => toNumber(item.amount) <= 0 && !(toNumber(item.qty) > 0 && toNumber(item.price) > 0));
  if (noAmountItems.length) {
    showNotice(`有 ${noAmountItems.length} 個品項沒有可用金額，請先填寫金額，或同時填寫數量與單價。`, "warn");
    return;
  }

  const records = validItems.map((item) => {
    const computedAmount = toNumber(item.amount) || roundMoney(toNumber(item.qty) * toNumber(item.price));
    const aiNote = buildAiAuditNote(item);
    return {
      date: normalizeDate(date),
      supplier,
      name: item.name.trim(),
      category: item.category.trim() || "未分類",
      spec: item.spec.trim(),
      qty: toNumber(item.qty),
      unit: item.unit.trim(),
      price: toNumber(item.price),
      amount: computedAmount,
      note: [
        item.note,
        receiptAnalysis.invoiceNumber ? `單號：${receiptAnalysis.invoiceNumber}` : "",
        aiNote,
      ].filter(Boolean).join("；"),
    };
  });

  stagedRecords.push(...records);
  saveStagedRecords();
  renderStagedRecords();
  showNotice(`已把 ${records.length} 筆 AI 轉換資料加入待送清單。`);

  const quickNav = document.querySelector('[data-view="quickEntry"]');
  if (quickNav) quickNav.click();
}

function buildAiAuditNote(item) {
  const labels = { name: "品項", category: "分類", spec: "規格", qty: "數量", unit: "單位", price: "單價", amount: "金額" };
  const inferred = [];
  const missing = [];
  Object.entries(item.fieldStatus || {}).forEach(([field, status]) => {
    if (!labels[field]) return;
    if (status === "inferred") inferred.push(labels[field]);
    if (status === "missing") missing.push(labels[field]);
  });
  const parts = [];
  if (inferred.length) parts.push(`AI推算：${inferred.join("、")}`);
  if (missing.length) parts.push(`原單缺漏：${missing.join("、")}`);
  if (item.originalLine) parts.push(`原文：${item.originalLine}`);
  return parts.join("；");
}

function clearReceiptPhoto() {
  receiptImagePayload = null;
  receiptAnalysis = null;
  $("receiptFile").value = "";
  $("receiptPreview").removeAttribute("src");
  $("receiptPreviewWrap").hidden = true;
  $("analyzeReceipt").disabled = true;
  $("clearReceipt").disabled = true;
  setReceiptStatus("尚未選擇照片");
  renderReceiptAnalysis();
}

function dateToInputValue(value) {
  const match = String(value || "").match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function confidenceClass(value) {
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
}

function setReceiptStatus(message, type = "") {
  const status = $("receiptAnalyzeStatus");
  status.textContent = message;
  status.className = `photoStatus muted ${type}`.trim();
}

function setupExports() {
  $("exportAllCsv").addEventListener("click", () => downloadPurchasesCsv(getFilteredPurchases(), "開拌_全部採購紀錄.csv"));
  $("exportMonthCsv").addEventListener("click", () => {
    const list = purchases.filter((purchase) => monthKey(purchase.date) === selectedMonth);
    downloadPurchasesCsv(list, `開拌_${selectedMonth || "月份"}_採購紀錄.csv`);
  });
}

async function loadData() {
  if (!authenticationReady || !authToken) return;

  setDataStatus("私人資料讀取中", "");
  showLoading();

  try {
    const response = await secureApiRequest({ action: "readData" }, { timeoutMs: 60000 });
    const result = response.result || {};
    const productRows = Array.isArray(result.products) ? result.products : [];
    const purchaseRows = Array.isArray(result.purchases) ? result.purchases : [];

    purchases = purchaseRows
      .filter((row) => row && (row["品項"] || row.name))
      .map((row, index) => normalizePurchase(row, index));

    products = productRows.length
      ? productRows.filter((row) => row && row["品項"]).map(normalizeProduct)
      : deriveProductsFromPurchases(purchases);

    setInitialMonth(true);
    render();
    populateDataLists();
    setDataStatus("私人 Google Sheet 已同步", "ok");
    hideNotice();
  } catch (error) {
    if (!authenticationReady) return;
    products = [];
    purchases = [];
    render();
    setDataStatus("資料讀取失敗", "error");
    showNotice(`私人資料讀取失敗：${error.message}`, "error");
  }
}

async function fetchCSV(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const separator = url.includes("?") ? "&" : "?";

  try {
    const response = await fetch(`${url}${separator}t=${Date.now()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CSV 讀取失敗：${response.status}`);
    const buffer = await response.arrayBuffer();
    return new TextDecoder("utf-8").decode(buffer);
  } finally {
    clearTimeout(timeout);
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  const input = String(text ?? "").replace(/^\uFEFF/, "");

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (cell !== "" || row.length) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      }
      if (char === "\r" && next === "\n") index += 1;
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((header) => String(header ?? "").replace(/^\uFEFF/, "").trim());

  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = String(values[index] ?? "").trim();
    });
    return item;
  });
}

function normalizeProduct(row) {
  return {
    code: row["ERP代碼"] || "",
    name: row["品項"] || "",
    category: row["分類"] || "未分類",
    spec: row["規格"] || "",
    unit: row["單位"] || "",
    price: toNumber(row["最新單價"]),
    supplier: row["供應商"] || "未填供應商",
    lastDate: normalizeDate(row["最近採購日"]),
    active: String(row["使用中"] || "TRUE").toUpperCase(),
    note: row["備註"] || "",
    minPrice: toNumber(row["最低價"]),
    maxPrice: toNumber(row["最高價"]),
    avgPrice: toNumber(row["平均價"]),
  };
}

function normalizePurchase(row, sourceIndex = 0) {
  const qty = toNumber(row["數量"] ?? row.qty);
  const price = toNumber(row["單價"] ?? row.unitPrice ?? row.price);
  const amount = toNumber(row["金額"] ?? row["小計"] ?? row.total ?? row.amount) || qty * price;

  return {
    date: normalizeDate(row["日期"] ?? row.date),
    supplier: row["供應商"] ?? row.supplier ?? "未填供應商",
    name: row["品項"] ?? row.name ?? "",
    category: row["分類"] ?? row.category ?? "未分類",
    spec: row["規格"] ?? row.spec ?? "",
    qty,
    unit: row["單位"] ?? row.unit ?? "",
    price,
    amount,
    note: row["備註"] ?? row.note ?? "",
    sourceIndex,
  };
}

function getFallbackPurchases() {
  const source = Array.isArray(window.KAIBAN_PURCHASES) ? window.KAIBAN_PURCHASES : [];
  return source.filter((row) => row && (row.name || row["品項"])).map((row, index) => normalizePurchase(row, index));
}

function deriveProductsFromPurchases(list) {
  const groups = new Map();

  list.forEach((purchase) => {
    const key = norm(`${purchase.name}|${purchase.spec}|${purchase.unit}`);
    if (!groups.has(key)) {
      groups.set(key, {
        code: "",
        name: purchase.name,
        category: purchase.category || "未分類",
        spec: purchase.spec,
        unit: purchase.unit,
        supplier: purchase.supplier,
        lastDate: purchase.date,
        note: purchase.note,
        active: "TRUE",
        prices: [],
      });
    }

    const group = groups.get(key);
    if (purchase.price > 0) group.prices.push(purchase.price);
    if (compareDate(purchase.date, group.lastDate) > 0) {
      group.lastDate = purchase.date;
      group.price = purchase.price;
      group.supplier = purchase.supplier;
      group.category = purchase.category || group.category;
      group.note = purchase.note || group.note;
    }
  });

  return [...groups.values()].map((group) => {
    const prices = group.prices.length ? group.prices : [0];
    const total = prices.reduce((sum, value) => sum + value, 0);
    return {
      ...group,
      price: group.price ?? prices.at(-1) ?? 0,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      avgPrice: total / prices.length,
    };
  });
}

function getFilteredProducts() {
  const keyword = norm($("globalSearch").value);
  return products.filter((product) => {
    if (product.active === "FALSE") return false;
    const searchText = [
      product.code, product.name, product.category, product.spec, product.unit,
      product.price, product.supplier, product.lastDate, product.note,
    ].join(" ");
    return !keyword || norm(searchText).includes(keyword);
  });
}

function getFilteredPurchases() {
  const keyword = norm($("globalSearch").value);
  return purchases.filter((purchase) => {
    const searchText = [
      purchase.date, purchase.supplier, purchase.name, purchase.category,
      purchase.spec, purchase.qty, purchase.unit, purchase.price,
      purchase.amount, purchase.note,
    ].join(" ");
    return !keyword || norm(searchText).includes(keyword);
  });
}

function render() {
  const productList = getFilteredProducts();
  const purchaseList = getFilteredPurchases();
  renderDashboard();
  renderProductCards(productList);
  renderPurchaseRows(purchaseList);
  renderMonthly();
  renderSuppliers();
}

function renderDashboard() {
  const activeProducts = products.filter((product) => product.active !== "FALSE");
  const suppliers = new Set(purchases.map((purchase) => purchase.supplier).filter(Boolean));
  const purchaseTotal = purchases.reduce((sum, purchase) => sum + purchase.amount, 0);
  const dashboardMonth = currentMonthKey();
  const monthList = purchases.filter((purchase) => monthKey(purchase.date) === dashboardMonth);
  const monthTotal = monthList.reduce((sum, purchase) => sum + purchase.amount, 0);

  $("statRows").textContent = purchases.length.toLocaleString("zh-TW");
  $("statFoods").textContent = activeProducts.length.toLocaleString("zh-TW");
  $("statSuppliers").textContent = suppliers.size.toLocaleString("zh-TW");
  $("statTotal").textContent = money(purchaseTotal);
  $("statMonth").textContent = money(monthTotal);
  $("statMonthLabel").textContent = `${dashboardMonth.replace("-", "/")} 支出`;

  const recent = [...purchases]
    .filter((purchase) => purchase.date)
    .sort((a, b) => compareDate(b.date, a.date))
    .slice(0, 8);

  $("recentList").innerHTML = recent.length
    ? recent.map((purchase) => `
      <div class="item">
        <div class="itemMain">
          <strong>${escapeHTML(purchase.name)}</strong>
          <small>${escapeHTML(purchase.date)}｜${escapeHTML(purchase.supplier)}</small>
        </div>
        <div class="itemAmount">
          <strong>${money(purchase.amount)}</strong>
          <small>${formatNumber(purchase.qty)} ${escapeHTML(purchase.unit)} × ${money(purchase.price)}</small>
        </div>
      </div>
    `).join("")
    : '<div class="empty">尚無採購資料</div>';

  renderBars($("dashboardSupplierBars"), groupTotals(monthList, "supplier"), 6);
}

function renderProductCards(list) {
  if (!list.length) {
    $("foodCards").innerHTML = '<div class="empty">找不到商品</div>';
    return;
  }

  $("foodCards").innerHTML = list.map((product) => {
    const priceStats = getProductPriceStats(product);
    const change = priceStats.change;
    const changeClass = change.direction === "up"
      ? "priceUp"
      : change.direction === "down"
        ? "priceDown"
        : "priceFlat";

    const changeText = change.hasPrevious
      ? `${change.direction === "up" ? "↑" : change.direction === "down" ? "↓" : "—"} 較上次 ${signedMoney(change.amount)}（${signedPercent(change.percent)}）`
      : "首次價格紀錄";

    const supplierRows = priceStats.suppliers.map((supplier, index) => `
      <div class="supplierPriceRow ${index === 0 ? "isCheapest" : ""}">
        <div>
          <strong>${escapeHTML(supplier.name)}</strong>
          <small>最近 ${escapeHTML(supplier.latestDate || "—")}｜歷史最低 ${money(supplier.minPrice)}</small>
        </div>
        <div class="supplierPriceValue">
          <strong>${money(supplier.latestPrice)}</strong>
          <small>/ ${escapeHTML(product.unit || "單位")}</small>
        </div>
      </div>
    `).join("");

    return `
      <article class="foodCard priceCompareCard">
        <div class="cardTags">
          <span class="tag">${escapeHTML(product.category || "未分類")}</span>
          <span class="tag">最新：${escapeHTML(priceStats.latestSupplier || product.supplier || "未填供應商")}</span>
        </div>
        <h3>${escapeHTML(product.name)}</h3>
        <div class="price">${money(priceStats.latest)} <small>/ ${escapeHTML(product.unit || "單位")}</small></div>
        <div class="priceChange ${changeClass}">${changeText}</div>

        <div class="bestBuyBox">
          <span>歷史最便宜購買地</span>
          <strong>${escapeHTML(priceStats.cheapestSupplier || "尚無資料")} · ${money(priceStats.min)} / ${escapeHTML(product.unit || "單位")}</strong>
          <small>${escapeHTML(priceStats.cheapestDate || "—")}</small>
        </div>

        <div class="meta compactMeta">
          <span class="label">目前較便宜</span><span>${escapeHTML(priceStats.currentCheapestSupplier || "—")} · ${money(priceStats.currentCheapestPrice)}</span>
          <span class="label">上次價格</span><span>${change.hasPrevious ? money(change.previous) : "—"}</span>
          <span class="label">平均價格</span><span>${money(priceStats.average)}</span>
          <span class="label">最近採購</span><span>${escapeHTML(priceStats.latestDate || product.lastDate || "—")}</span>
          <span class="label">規格</span><span>${escapeHTML(product.spec || "—")}</span>
          <span class="label">ERP 代碼</span><span>${escapeHTML(product.code || "—")}</span>
        </div>

        ${priceStats.suppliers.length ? `
          <details class="supplierCompare">
            <summary>查看供應商價格比較（${priceStats.suppliers.length}）</summary>
            <div class="supplierCompareList">${supplierRows}</div>
          </details>
        ` : ""}

        ${priceStats.mixedFormat ? '<p class="compareWarning">部分紀錄的規格或單位不同，請確認後再比較。</p>' : ""}
      </article>
    `;
  }).join("");
}

function getProductPriceStats(product) {
  const sameName = purchases.filter((purchase) =>
    norm(purchase.name) === norm(product.name) && purchase.price > 0
  );

  const productSpec = norm(product.spec);
  const productUnit = norm(product.unit);
  const exactMatching = sameName.filter((purchase) => {
    const purchaseSpec = norm(purchase.spec);
    const purchaseUnit = norm(purchase.unit);
    const specMatches = !productSpec || !purchaseSpec || productSpec === purchaseSpec;
    const unitMatches = !productUnit || !purchaseUnit || productUnit === purchaseUnit;
    return specMatches && unitMatches;
  });

  const matching = exactMatching.length ? exactMatching : sameName;
  const sorted = [...matching].sort(comparePurchaseNewestFirst);
  const latestPurchase = sorted[0];
  const previousPurchase = sorted[1];
  const prices = matching.map((purchase) => purchase.price);

  if (!prices.length) {
    const latest = product.price || 0;
    return {
      latest,
      latestSupplier: product.supplier || "",
      latestDate: product.lastDate || "",
      min: product.minPrice || latest,
      max: product.maxPrice || latest,
      average: product.avgPrice || latest,
      cheapestSupplier: product.supplier || "",
      cheapestDate: product.lastDate || "",
      currentCheapestSupplier: product.supplier || "",
      currentCheapestPrice: latest,
      suppliers: [],
      mixedFormat: false,
      change: {
        hasPrevious: false,
        previous: 0,
        amount: 0,
        percent: 0,
        direction: "flat",
      },
    };
  }

  const cheapestPurchase = [...matching].sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    return comparePurchaseNewestFirst(a, b);
  })[0];

  const supplierMap = new Map();
  matching.forEach((purchase) => {
    const supplierName = purchase.supplier || "未填供應商";
    if (!supplierMap.has(supplierName)) supplierMap.set(supplierName, []);
    supplierMap.get(supplierName).push(purchase);
  });

  const suppliers = [...supplierMap.entries()].map(([name, supplierPurchases]) => {
    const supplierSorted = [...supplierPurchases].sort(comparePurchaseNewestFirst);
    const supplierPrices = supplierPurchases.map((purchase) => purchase.price);
    return {
      name,
      latestPrice: supplierSorted[0]?.price || 0,
      latestDate: supplierSorted[0]?.date || "",
      minPrice: Math.min(...supplierPrices),
      averagePrice: supplierPrices.reduce((sum, price) => sum + price, 0) / supplierPrices.length,
      count: supplierPurchases.length,
    };
  }).sort((a, b) => {
    if (a.latestPrice !== b.latestPrice) return a.latestPrice - b.latestPrice;
    return compareDate(b.latestDate, a.latestDate);
  });

  const latest = latestPurchase?.price || product.price || 0;
  const previous = previousPurchase?.price || 0;
  const changeAmount = previousPurchase ? latest - previous : 0;
  const changePercent = previousPurchase && previous > 0 ? (changeAmount / previous) * 100 : 0;

  const formatKeys = new Set(matching.map((purchase) => `${norm(purchase.spec)}|${norm(purchase.unit)}`));

  return {
    latest,
    latestSupplier: latestPurchase?.supplier || product.supplier || "",
    latestDate: latestPurchase?.date || product.lastDate || "",
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
    cheapestSupplier: cheapestPurchase?.supplier || "",
    cheapestDate: cheapestPurchase?.date || "",
    currentCheapestSupplier: suppliers[0]?.name || "",
    currentCheapestPrice: suppliers[0]?.latestPrice || 0,
    suppliers,
    mixedFormat: formatKeys.size > 1,
    change: {
      hasPrevious: Boolean(previousPurchase),
      previous,
      amount: changeAmount,
      percent: changePercent,
      direction: changeAmount > 0 ? "up" : changeAmount < 0 ? "down" : "flat",
    },
  };
}

function comparePurchaseNewestFirst(a, b) {
  const dateCompare = compareDate(b.date, a.date);
  if (dateCompare !== 0) return dateCompare;
  return (b.sourceIndex || 0) - (a.sourceIndex || 0);
}

function signedMoney(value) {
  const number = toNumber(value);
  if (number === 0) return "$0";
  return `${number > 0 ? "+" : "−"}${money(Math.abs(number))}`;
}

function signedPercent(value) {
  const number = Number(value) || 0;
  if (number === 0) return "0%";
  return `${number > 0 ? "+" : "−"}${Math.abs(number).toLocaleString("zh-TW", { maximumFractionDigits: 1 })}%`;
}

function renderPurchaseRows(list) {
  const sorted = [...list].sort((a, b) => compareDate(b.date, a.date));
  $("purchaseCountText").textContent = `共 ${sorted.length.toLocaleString("zh-TW")} 筆`;

  $("purchaseRows").innerHTML = sorted.length
    ? sorted.map((purchase) => `
      <tr>
        <td>${escapeHTML(purchase.date)}</td>
        <td>${escapeHTML(purchase.supplier)}</td>
        <td>${escapeHTML(purchase.name)}</td>
        <td>${escapeHTML(purchase.category)}</td>
        <td>${escapeHTML(purchase.spec)}</td>
        <td>${formatNumber(purchase.qty)}</td>
        <td>${escapeHTML(purchase.unit)}</td>
        <td>${money(purchase.price)}</td>
        <td><strong>${money(purchase.amount)}</strong></td>
        <td>${escapeHTML(purchase.note)}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="10" class="empty">尚無採購資料</td></tr>';
}

function renderMonthly() {
  if (!selectedMonth) setInitialMonth();
  $("monthPicker").value = selectedMonth;

  const list = purchases
    .filter((purchase) => monthKey(purchase.date) === selectedMonth)
    .sort((a, b) => compareDate(b.date, a.date));

  const total = list.reduce((sum, purchase) => sum + purchase.amount, 0);
  const supplierCount = new Set(list.map((purchase) => purchase.supplier).filter(Boolean)).size;

  $("monthTotal").textContent = money(total);
  $("monthCount").textContent = list.length.toLocaleString("zh-TW");
  $("monthSupplierCount").textContent = supplierCount.toLocaleString("zh-TW");
  $("monthAverage").textContent = money(list.length ? total / list.length : 0);
  $("monthDetailText").textContent = `${selectedMonth.replace("-", "/")}｜共 ${list.length.toLocaleString("zh-TW")} 筆`;

  renderBars($("monthSupplierBars"), groupTotals(list, "supplier"));
  renderBars($("monthCategoryBars"), groupTotals(list, "category"));

  $("monthRows").innerHTML = list.length
    ? list.map((purchase) => `
      <tr>
        <td>${escapeHTML(purchase.date)}</td>
        <td>${escapeHTML(purchase.supplier)}</td>
        <td>${escapeHTML(purchase.name)}</td>
        <td>${escapeHTML(purchase.category)}</td>
        <td>${formatNumber(purchase.qty)}</td>
        <td>${escapeHTML(purchase.unit)}</td>
        <td>${money(purchase.price)}</td>
        <td><strong>${money(purchase.amount)}</strong></td>
      </tr>
    `).join("")
    : '<tr><td colspan="8" class="empty">這個月份尚無採購資料</td></tr>';
}

function groupTotals(list, field) {
  const totals = new Map();
  list.forEach((purchase) => {
    const label = purchase[field] || "未分類";
    totals.set(label, (totals.get(label) || 0) + purchase.amount);
  });
  return [...totals.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function renderBars(container, rows, limit = 10) {
  if (!container) return;
  const list = rows.slice(0, limit);
  if (!list.length) {
    container.innerHTML = '<div class="empty">尚無資料</div>';
    return;
  }

  const max = Math.max(...list.map((row) => row.total), 1);
  container.innerHTML = list.map((row) => `
    <div class="barItem">
      <div class="barHead">
        <span>${escapeHTML(row.label)}</span>
        <span>${money(row.total)}</span>
      </div>
      <div class="barTrack"><div class="barFill" style="width:${Math.max(3, (row.total / max) * 100)}%"></div></div>
    </div>
  `).join("");
}

function renderSuppliers() {
  const map = new Map();

  purchases.forEach((purchase) => {
    if (!map.has(purchase.supplier)) {
      map.set(purchase.supplier, {
        name: purchase.supplier,
        count: 0,
        total: 0,
        items: new Set(),
        lastDate: purchase.date,
      });
    }

    const supplier = map.get(purchase.supplier);
    supplier.count += 1;
    supplier.total += purchase.amount;
    supplier.items.add(purchase.name);
    if (compareDate(purchase.date, supplier.lastDate) > 0) supplier.lastDate = purchase.date;
  });

  const suppliers = [...map.values()].sort((a, b) => b.total - a.total);
  $("supplierCards").innerHTML = suppliers.length
    ? suppliers.map((supplier) => `
      <article class="foodCard">
        <span class="tag">供應商</span>
        <h3>${escapeHTML(supplier.name)}</h3>
        <div class="price">${money(supplier.total)}</div>
        <div class="meta">
          <span class="label">採購筆數</span><span>${supplier.count.toLocaleString("zh-TW")}</span>
          <span class="label">品項數</span><span>${supplier.items.size.toLocaleString("zh-TW")}</span>
          <span class="label">最近採購</span><span>${escapeHTML(supplier.lastDate || "—")}</span>
        </div>
      </article>
    `).join("")
    : '<div class="empty">尚無供應商資料</div>';
}

function getQuickFormRecord() {
  const record = normalizePurchase({
    date: $("entryDate").value,
    supplier: $("entrySupplier").value.trim(),
    name: $("entryName").value.trim(),
    category: $("entryCategory").value.trim() || "未分類",
    spec: $("entrySpec").value.trim(),
    qty: $("entryQty").value,
    unit: $("entryUnit").value.trim(),
    price: $("entryPrice").value,
    amount: $("entryAmount").value,
    note: $("entryNote").value.trim(),
  });

  if (!record.date || !record.supplier || !record.name) {
    showNotice("日期、供應商與品項為必填欄位。", "error");
    return null;
  }

  if (record.qty <= 0 || record.price < 0 || record.amount < 0) {
    showNotice("數量必須大於 0，單價與金額不可小於 0。", "error");
    return null;
  }

  return record;
}

function calculateEntryAmount() {
  if (amountWasEdited) return;
  const qty = toNumber($("entryQty").value);
  const price = toNumber($("entryPrice").value);
  $("entryAmount").value = roundMoney(qty * price);
}

function resetQuickForm(options = {}) {
  const date = options.keepDate ? $("entryDate").value : todayInputValue();
  const supplier = options.keepSupplier ? $("entrySupplier").value : "";
  $("quickForm").reset();
  $("entryDate").value = date;
  $("entrySupplier").value = supplier;
  $("entryQty").value = 1;
  $("entryAmount").value = "";
  amountWasEdited = false;
}

function parseBulkPaste() {
  const text = $("bulkPaste").value.trim();
  if (!text) {
    showNotice("請先貼上採購資料。", "warn");
    return;
  }

  try {
    const rows = parsePastedRows(text);
    const valid = rows.filter((record) => record.date && record.supplier && record.name);
    if (!valid.length) throw new Error("沒有可辨識的資料列");

    stagedRecords.push(...valid);
    saveStagedRecords();
    renderStagedRecords();
    $("bulkPaste").value = "";
    showNotice(`已解析並加入 ${valid.length} 筆資料。`);
  } catch (error) {
    showNotice(`批次資料解析失敗：${error.message}`, "error");
  }
}

function parsePastedRows(text) {
  const rawLines = String(text).replace(/\r/g, "").split("\n").filter((line) => line.trim());
  if (!rawLines.length) return [];

  const delimiter = rawLines.some((line) => line.includes("\t")) ? "\t" : ",";
  const matrix = delimiter === ","
    ? parseCsvMatrix(rawLines.join("\n"))
    : rawLines.map((line) => line.split("\t"));

  const first = matrix[0].map((cell) => String(cell).trim());
  const hasHeader = first.some((cell) => ["日期", "供應商", "品項", "分類", "數量", "單價", "金額"].includes(cell));
  const headers = hasHeader ? first : ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "備註"];
  const body = hasHeader ? matrix.slice(1) : matrix;

  return body.map((values) => {
    const row = {};
    headers.forEach((header, index) => { row[header] = String(values[index] ?? "").trim(); });
    return normalizePurchase(row);
  });
}

function parseCsvMatrix(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function renderStagedRecords() {
  const total = stagedRecords.reduce((sum, record) => sum + record.amount, 0);
  $("stagedSummary").textContent = stagedRecords.length
    ? `${stagedRecords.length.toLocaleString("zh-TW")} 筆｜合計 ${money(total)}`
    : "尚未加入資料";

  $("submitStaged").disabled = !stagedRecords.length;
  $("downloadStaged").disabled = !stagedRecords.length;
  $("clearStaged").disabled = !stagedRecords.length;

  $("stagedRows").innerHTML = stagedRecords.length
    ? stagedRecords.map((record, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHTML(record.date)}</td>
        <td>${escapeHTML(record.supplier)}</td>
        <td>${escapeHTML(record.name)}</td>
        <td>${escapeHTML(record.category)}</td>
        <td>${formatNumber(record.qty)}</td>
        <td>${escapeHTML(record.unit)}</td>
        <td>${money(record.price)}</td>
        <td><strong>${money(record.amount)}</strong></td>
        <td><button class="removeRow" type="button" data-remove-index="${index}">刪除</button></td>
      </tr>
    `).join("")
    : '<tr><td colspan="10" class="empty">尚未加入資料</td></tr>';
}

async function submitStagedRecords() {
  if (!stagedRecords.length) return;
  if (!authenticationReady || !authToken) {
    handleAuthenticationFailure("請先登入後再寫入資料。");
    return;
  }

  const button = $("submitStaged");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "安全寫入中…";

  try {
    const submittedCount = stagedRecords.length;
    await secureApiRequest({
      action: "writePurchases",
      records: stagedRecords,
    }, { timeoutMs: 60000 });

    stagedRecords = [];
    saveStagedRecords();
    renderStagedRecords();
    await loadData();
    showNotice(`已安全寫入 ${submittedCount} 筆到私人 Google Sheet。`);
  } catch (error) {
    if (authenticationReady) showNotice(`寫入失敗：${error.message}`, "error");
  } finally {
    button.disabled = !stagedRecords.length;
    button.textContent = originalText;
  }
}

function clearStagedRecords() {
  if (!stagedRecords.length) return;
  const shouldClear = window.confirm(`確定清除待送清單中的 ${stagedRecords.length} 筆資料？`);
  if (!shouldClear) return;
  stagedRecords = [];
  saveStagedRecords();
  renderStagedRecords();
}

function loadStagedRecords() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STAGED_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizePurchase) : [];
  } catch {
    return [];
  }
}

function saveStagedRecords() {
  localStorage.setItem(STAGED_STORAGE_KEY, JSON.stringify(stagedRecords));
}

function downloadTemplate() {
  const headers = ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "備註"];
  downloadText(`${headers.join(",")}\n`, "開拌_採購匯入範本.csv", "text/csv;charset=utf-8");
}

function downloadPurchasesCsv(list, filename) {
  if (!list.length) {
    showNotice("目前沒有可匯出的資料。", "warn");
    return;
  }

  const headers = ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "備註"];
  const lines = [headers.join(",")];
  list.forEach((purchase) => {
    lines.push([
      purchase.date, purchase.supplier, purchase.name, purchase.category,
      purchase.spec, purchase.qty, purchase.unit, purchase.price,
      purchase.amount, purchase.note,
    ].map(csvCell).join(","));
  });
  downloadText(`\uFEFF${lines.join("\r\n")}`, filename, "text/csv;charset=utf-8");
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function populateDataLists() {
  fillDatalist("supplierOptions", uniqueSorted(purchases.map((purchase) => purchase.supplier)));
  fillDatalist("itemOptions", uniqueSorted(purchases.map((purchase) => purchase.name)));
  fillDatalist("categoryOptions", uniqueSorted(purchases.map((purchase) => purchase.category)));
}

function fillDatalist(id, values) {
  $(id).innerHTML = values.map((value) => `<option value="${escapeHTML(value)}"></option>`).join("");
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "zh-Hant"));
}

function setInitialMonth(force = false) {
  if (selectedMonth && !force) return;
  const months = purchases.map((purchase) => monthKey(purchase.date)).filter(Boolean).sort().reverse();
  const current = currentMonthKey();
  selectedMonth = months.includes(current) ? current : (months[0] || current);
}

function currentMonthKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthKey(value) {
  const date = normalizeDate(value);
  const match = date.match(/^(\d{4})\/(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function normalizeDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  const direct = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (direct) {
    return `${direct[1]}/${String(direct[2]).padStart(2, "0")}/${String(direct[3]).padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}`;
  }

  return text;
}

function compareDate(a, b) {
  return sortableDate(a).localeCompare(sortableDate(b));
}

function sortableDate(value) {
  const normalized = normalizeDate(value);
  const match = normalized.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : normalized;
}

function formatNumber(value) {
  return toNumber(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function roundMoney(value) {
  return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function todayInputValue() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function setDefaultEntryDate() {
  $("entryDate").value = todayInputValue();
}

function updateApiBadge() {
  const configured = Boolean(APPS_SCRIPT_URL && APPS_SCRIPT_URL.includes("/exec"));
  const connected = configured && authenticationReady && Boolean(authToken);
  $("apiBadge").textContent = connected ? "私人 Google Sheet 已連接" : "登入後連接私人資料";
  $("apiBadge").classList.toggle("connected", connected);
  if ($("photoApiBadge")) {
    $("photoApiBadge").textContent = connected ? "Gemini AI 安全連接" : "登入後啟用 AI 辨識";
    $("photoApiBadge").classList.toggle("connected", connected);
  }
}

function setDataStatus(text, type) {
  $("dataStatus").textContent = text;
  $("dataStatus").className = `statusDot ${type || ""}`.trim();
}

function showLoading() {
  $("foodCards").innerHTML = '<div class="empty">商品資料載入中…</div>';
  $("recentList").innerHTML = '<div class="empty">採購資料載入中…</div>';
}

function showNotice(message, type = "") {
  const notice = $("notice");
  notice.textContent = message;
  notice.className = `notice ${type}`.trim();
  notice.hidden = false;
}

function hideNotice() {
  $("notice").hidden = true;
}
