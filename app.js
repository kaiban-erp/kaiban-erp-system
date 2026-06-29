// =====================================================
// KaiBan ERP
// 1. Google Sheet CSV 讀取
// 2. data.js 備援資料
// 3. 每月支出分析
// 4. 快速建檔 + Google Apps Script 寫入
// =====================================================

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
let connectionState = "idle";

const pageDescriptions = {
  dashboard: "選擇今天要完成的工作。",
  record: "拍照或手動輸入採購紀錄。",
  price: "搜尋食材歷史價格與採購明細。",
  reports: "查看每月支出與供應商分析。",
};

const DEFAULT_CATEGORIES = ["蔬菜", "水果", "肉類", "海鮮", "乾貨", "調味料", "飲品", "其他"];

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
  setupImageBackfill();
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
  connectionState = "loading";
  document.body.classList.remove("authLocked");
  $("authGate").hidden = true;
  updateApiBadge();
}

function lockErp() {
  authenticationReady = false;
  connectionState = "idle";
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
  setDataStatus("載入中...", "loading");
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
    return Promise.reject(new Error("系統尚未完成設定"));
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
      finish(() => reject(new Error("系統連線失敗")));
    });

    window.addEventListener("message", onMessage);
    document.body.append(iframe, form);
    form.submit();
  });
}

function setupNavigation() {
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => openErpRoute(button.dataset.view));
  });

  document.querySelectorAll(".sectionTab").forEach((button) => {
    button.addEventListener("click", () => {
      activateSectionTab(button.dataset.tabGroup, button.dataset.tabTarget);
    });
  });

  document.querySelectorAll("[data-route-view]").forEach((button) => {
    button.addEventListener("click", () => {
      openErpRoute(button.dataset.routeView, button.dataset.routeTab || "");
    });
  });

  $("reloadData").addEventListener("click", () => {
    if (authenticationReady) loadData();
  });

  document.querySelectorAll("[data-retry-connection]").forEach((button) => {
    button.addEventListener("click", () => {
      if (authenticationReady) loadData();
    });
  });

  $("globalSearch").style.display = "none";
}

function openErpRoute(viewId, tabId = "") {
  document.querySelectorAll(".nav").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === viewId);
  });

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });

  const navButton = document.querySelector(`.nav[data-view="${viewId}"]`);
  $("pageTitle").textContent = navButton?.dataset.title || navButton?.textContent.trim() || "開拌 ERP";
  $("pageDescription").textContent = pageDescriptions[viewId] || "";
  $("globalSearch").style.display = viewId === "price" ? "block" : "none";

  if (tabId) activateSectionTab(viewId, tabId);

  if (viewId === "record") {
    const activeModule = $("record").querySelector(".modulePanel.active")?.id;
    if (activeModule === "quickEntry") renderStagedRecords();
    if (activeModule === "photoEntry") renderReceiptAnalysis();
  }

  if (viewId === "reports") {
    const activeModule = $("reports").querySelector(".modulePanel.active")?.id;
    if (activeModule === "monthly") renderMonthly();
    if (activeModule === "suppliers") renderSuppliers();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function activateSectionTab(groupId, tabId) {
  const group = $(groupId);
  if (!group) return;

  group.querySelectorAll(".sectionTab").forEach((button) => {
    const active = button.dataset.tabTarget === tabId;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  group.querySelectorAll(".modulePanel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });

  if (tabId === "monthly") renderMonthly();
  if (tabId === "suppliers") renderSuppliers();
  if (tabId === "quickEntry") renderStagedRecords();
  if (tabId === "photoEntry") renderReceiptAnalysis();
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
  $("quickForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const record = getQuickFormRecord();
    if (!record) return;

    const saved = await writePurchaseRecords(
      [record],
      $("quickSubmit"),
      `已儲存「${record.name}」的採購紀錄。`
    );

    if (saved) resetQuickForm({ keepDate: true, keepSupplier: true });
  });

  $("entryQty").addEventListener("input", calculateEntryAmount);
  $("entryPrice").addEventListener("input", calculateEntryAmount);
  $("entryAmount").addEventListener("input", () => { amountWasEdited = true; });
  $("resetQuickForm").addEventListener("click", () => resetQuickForm());

  const searchImagesButton = $("searchImagesButton");
  const closeImageSearch = $("closeImageSearch");

  if (searchImagesButton) searchImagesButton.addEventListener("click", searchQuickEntryImages);
  if (closeImageSearch) closeImageSearch.addEventListener("click", closeQuickEntryImageSearch);

  $("parseBulk").addEventListener("click", parseBulkPaste);
  $("downloadTemplate").addEventListener("click", downloadTemplate);
  $("downloadStaged").addEventListener("click", () => downloadPurchasesCsv(stagedRecords, "開拌_批次採購備份.csv"));
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


async function searchQuickEntryImages() {
  const query = $("entryName").value.trim();
  const button = $("searchImagesButton");
  const panel = $("imageSearchPanel");
  const status = $("imageSearchStatus");
  const results = $("imageSearchResults");

  if (!query) {
    showNotice("請先輸入品項名稱，再使用 AI 找圖。", "warn");
    $("entryName").focus();
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "搜尋中…";
  panel.hidden = false;
  status.className = "imageSearchStatus";
  status.textContent = `正在搜尋「${query}」的圖片…`;
  results.replaceChildren();

  try {
    const response = await secureApiRequest(
      { action: "searchImages", query },
      { timeoutMs: 45000 }
    );

    const images = response?.result && Array.isArray(response.result.images)
      ? response.result.images
      : [];

    renderImageSearchResults(images, query);
  } catch (error) {
    status.className = "imageSearchStatus error";
    status.textContent = `找圖失敗：${error?.message || "未知錯誤"}`;
    results.replaceChildren();
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderImageSearchResults(images, query) {
  const panel = $("imageSearchPanel");
  const status = $("imageSearchStatus");
  const results = $("imageSearchResults");

  panel.hidden = false;
  results.replaceChildren();

  const validImages = images
    .map((item) => ({
      title: String(item?.title || query),
      link: getSafeHttpUrl(item?.link),
      thumbnailLink: getSafeHttpUrl(item?.thumbnailLink || item?.link),
    }))
    .filter((item) => item.link && item.thumbnailLink)
    .slice(0, 3);

  if (!validImages.length) {
    status.className = "imageSearchStatus";
    status.textContent = `找不到「${query}」可使用的圖片。`;
    return;
  }

  status.className = "imageSearchStatus";
  status.textContent = "請點擊一張圖片作為品項圖片。";

  validImages.forEach((item, index) => {
    const choice = document.createElement("button");
    choice.type = "button";
    choice.className = "imageSearchChoice";
    choice.title = item.title || `圖片 ${index + 1}`;

    const image = document.createElement("img");
    image.src = item.thumbnailLink;
    image.alt = item.title || `${query} 圖片 ${index + 1}`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";

    image.addEventListener("error", () => {
      choice.remove();
      if (!results.children.length) {
        status.textContent = "圖片來源無法載入，請重新搜尋。";
      }
    });

    choice.appendChild(image);
    choice.addEventListener("click", () => {
      $("entryImageUrl").value = item.link;
      panel.hidden = true;
      showNotice(`已為「${query}」選擇圖片。`);
    });

    results.appendChild(choice);
  });
}

function closeQuickEntryImageSearch() {
  const panel = $("imageSearchPanel");
  const results = $("imageSearchResults");
  const status = $("imageSearchStatus");
  if (panel) panel.hidden = true;
  if (results) results.replaceChildren();
  if (status) status.textContent = "";
}

function renderTableImage(value, altText) {
  const imageUrl = getSafeHttpUrl(value);
  if (!imageUrl) return '<span class="tableImageEmpty">—</span>';

  return `<img class="tableImageThumb" src="${escapeHTML(imageUrl)}" alt="${escapeHTML(altText || "品項圖片")}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('—'))">`;
}

function getSafeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
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

    setReceiptStatus("辨識中...", "loading");
    analyzeButton.disabled = true;
    clearButton.disabled = true;

    try {
      receiptImagePayload = await compressReceiptImage(file);
      $("receiptPreview").src = receiptImagePayload.dataUrl;
      $("receiptFileName").textContent = file.name || "現場拍照";
      $("receiptFileSize").textContent = formatFileSize(receiptImagePayload.bytes);
      $("receiptPreviewWrap").hidden = false;
      clearButton.disabled = false;
      await analyzeReceiptPhoto();
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

  if (!authenticationReady || !authToken) {
    handleAuthenticationFailure("請先登入後再使用拍照辨識。");
    return;
  }

  const buttons = [$("analyzeReceipt"), $("reanalyzeReceipt")];
  buttons.forEach((button) => { if (button) button.disabled = true; });
  setReceiptStatus("辨識中...", "loading");

  try {
    const response = await secureApiRequest({
      action: "analyzeReceipt",
      mimeType: receiptImagePayload.mimeType,
      imageBase64: receiptImagePayload.imageBase64,
    }, { timeoutMs: 180000 });

    receiptAnalysis = normalizeReceiptAnalysis(response.result || {});
    renderReceiptAnalysis();
    const modeText = receiptAnalysis.enhancedAnalysis ? "已完成加強辨識" : "辨識完成";
    setReceiptStatus(`${modeText}，找到 ${receiptAnalysis.items.length} 個品項。`, "success");
    showNotice("辨識完成，請確認黃色推算欄位與紅色待確認欄位。");
  } catch (error) {
    connectionState = "error";
    updateApiBadge();
    setDataStatus("連線失敗", "error");
    setReceiptStatus("辨識失敗，請稍候再試。", "error");
    showNotice("系統連線中，請稍候再試。", "error");
  } finally {
    buttons.forEach((button) => { if (button) button.disabled = !receiptImagePayload; });
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

async function addReceiptAnalysisToStaged() {
  if (!receiptAnalysis || !receiptAnalysis.items.length) return;
  const date = $("receiptDate").value;
  const supplier = $("receiptSupplier").value.trim();
  if (!date || !supplier) {
    showNotice("日期與供應商是必要欄位，請先補齊。", "warn");
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

  const saved = await writePurchaseRecords(
    records,
    $("addReceiptToStaged"),
    `已儲存 ${records.length} 筆拍照辨識紀錄。`
  );

  if (saved) clearReceiptPhoto();
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

function setupImageBackfill() {
  const button = $("backfillProductImages");
  if (!button) return;
  button.addEventListener("click", backfillProductImages);
}

async function backfillProductImages() {
  const button = $("backfillProductImages");
  const missingCount = products.filter((product) => !getSafeHttpUrl(product.imageUrl)).length;

  if (!missingCount) {
    showNotice("目前所有食材都已有圖片。");
    return;
  }

  const confirmed = window.confirm(
    `目前有 ${missingCount} 個食材缺少圖片。\n系統每次最多自動補 20 個，會使用 SerpApi 搜尋額度。\n\n確定開始嗎？`
  );
  if (!confirmed) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "自動補圖中…";

  try {
    const response = await secureApiRequest(
      { action: "backfillProductImages", limit: 20 },
      { timeoutMs: 180000 }
    );
    const result = response.result || {};
    await loadData();

    const remainingText = Number(result.remaining) > 0
      ? `，尚有 ${Number(result.remaining).toLocaleString("zh-TW")} 個可再次補圖`
      : "，目前已無缺圖食材";

    showNotice(
      `已補上 ${Number(result.updatedProducts || 0).toLocaleString("zh-TW")} 個食材圖片，` +
      `同步更新 ${Number(result.updatedPurchases || 0).toLocaleString("zh-TW")} 筆採購紀錄${remainingText}。`
    );
  } catch (error) {
    if (authenticationReady) showNotice(`自動補圖失敗：${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
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

  connectionState = "loading";
  updateApiBadge();
  setDataStatus("載入中...", "loading");
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
      ? mergeProductImagesFromPurchases(
          productRows.filter((row) => row && row["品項"]).map(normalizeProduct),
          purchases
        )
      : deriveProductsFromPurchases(purchases);

    setInitialMonth(true);
    render();
    populateDataLists();
    connectionState = "connected";
    setDataStatus("✓ 已連線", "ok");
    updateApiBadge();
    hideNotice();
  } catch (error) {
    if (!authenticationReady) return;
    products = [];
    purchases = [];
    render();
    connectionState = "error";
    setDataStatus("連線失敗", "error");
    updateApiBadge();
    showNotice("系統連線中，請稍候再試。", "error");
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
    imageUrl: row["圖片網址"] ?? row.imageUrl ?? "",
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
    imageUrl: row["圖片網址"] ?? row.imageUrl ?? "",
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
        imageUrl: purchase.imageUrl || "",
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
      group.imageUrl = purchase.imageUrl || group.imageUrl;
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

function mergeProductImagesFromPurchases(productList, purchaseList) {
  const imageByName = new Map();

  [...purchaseList]
    .sort((a, b) => compareDate(b.date, a.date))
    .forEach((purchase) => {
      const key = norm(purchase.name);
      const imageUrl = getSafeHttpUrl(purchase.imageUrl);
      if (key && imageUrl && !imageByName.has(key)) imageByName.set(key, imageUrl);
    });

  return productList.map((product) => ({
    ...product,
    imageUrl: getSafeHttpUrl(product.imageUrl) || imageByName.get(norm(product.name)) || "",
  }));
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
      purchase.amount, purchase.imageUrl, purchase.note,
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
  // 首頁為任務啟動器，不顯示統計或圖表。
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

    const imageUrl = getSafeHttpUrl(product.imageUrl);

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
        <div class="foodCardMedia ${imageUrl ? "hasImage" : ""}">
          ${imageUrl ? `<img class="foodCardImage" src="${escapeHTML(imageUrl)}" alt="${escapeHTML(product.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.classList.add('imageFailed')">` : ""}
          <div class="foodCardImagePlaceholder" aria-hidden="true">
            <span>🥗</span>
            <small>尚未設定圖片</small>
          </div>
        </div>
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
        <td class="tableImageCell">${renderTableImage(purchase.imageUrl, purchase.name)}</td>
        <td>${escapeHTML(purchase.category)}</td>
        <td>${escapeHTML(purchase.spec)}</td>
        <td>${formatNumber(purchase.qty)}</td>
        <td>${escapeHTML(purchase.unit)}</td>
        <td>${money(purchase.price)}</td>
        <td><strong>${money(purchase.amount)}</strong></td>
        <td>${escapeHTML(purchase.note)}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="11" class="empty">尚無採購資料</td></tr>';
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
    imageUrl: $("entryImageUrl").value.trim(),
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
  closeQuickEntryImageSearch();
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
  const headers = hasHeader ? first : ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "圖片網址", "備註"];
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
    : "尚無批次資料";

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
        <td class="tableImageCell">${renderTableImage(record.imageUrl, record.name)}</td>
        <td>${escapeHTML(record.category)}</td>
        <td>${formatNumber(record.qty)}</td>
        <td>${escapeHTML(record.unit)}</td>
        <td>${money(record.price)}</td>
        <td><strong>${money(record.amount)}</strong></td>
        <td><button class="removeRow" type="button" data-remove-index="${index}">刪除</button></td>
      </tr>
    `).join("")
    : '<tr><td colspan="11" class="empty">尚無批次資料</td></tr>';
}

async function writePurchaseRecords(records, button, successMessage) {
  if (!Array.isArray(records) || !records.length) return false;
  if (!authenticationReady || !authToken) {
    handleAuthenticationFailure("請先登入後再儲存紀錄。");
    return false;
  }

  const originalText = button?.textContent || "確認入帳";
  if (button) {
    button.disabled = true;
    button.textContent = "儲存中...";
  }

  try {
    await secureApiRequest({
      action: "writePurchases",
      records,
    }, { timeoutMs: 180000 });

    await loadData();
    showNotice(successMessage || `已儲存 ${records.length} 筆紀錄。`);
    return true;
  } catch (error) {
    if (authenticationReady) {
      connectionState = "error";
      setDataStatus("連線失敗", "error");
      updateApiBadge();
      showNotice("系統連線中，請稍候再試。", "error");
    }
    return false;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function submitStagedRecords() {
  if (!stagedRecords.length) return;

  const records = [...stagedRecords];
  const saved = await writePurchaseRecords(
    records,
    $("submitStaged"),
    `已儲存 ${records.length} 筆批次紀錄。`
  );

  if (!saved) return;
  stagedRecords = [];
  saveStagedRecords();
  renderStagedRecords();
}

function clearStagedRecords() {
  if (!stagedRecords.length) return;
  const shouldClear = window.confirm(`確定清除批次清單中的 ${stagedRecords.length} 筆資料？`);
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
  const headers = ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "圖片網址", "備註"];
  downloadText(`${headers.join(",")}\n`, "開拌_採購匯入範本.csv", "text/csv;charset=utf-8");
}

function downloadPurchasesCsv(list, filename) {
  if (!list.length) {
    showNotice("目前沒有可匯出的資料。", "warn");
    return;
  }

  const headers = ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "圖片網址", "備註"];
  const lines = [headers.join(",")];
  list.forEach((purchase) => {
    lines.push([
      purchase.date, purchase.supplier, purchase.name, purchase.category,
      purchase.spec, purchase.qty, purchase.unit, purchase.price,
      purchase.amount, purchase.imageUrl, purchase.note,
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

  const customCategories = uniqueSorted(
    purchases
      .map((purchase) => purchase.category)
      .filter((category) => category && !DEFAULT_CATEGORIES.includes(category))
  );
  fillDatalist("categoryOptions", [...DEFAULT_CATEGORIES, ...customCategories]);
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
  const showError = authenticationReady && connectionState === "error";
  [$("apiBadge"), $("photoApiBadge")].forEach((badge) => {
    if (!badge) return;
    badge.hidden = !showError;
  });
}

function setDataStatus(text, type) {
  const status = $("dataStatus");
  const retry = $("reloadData");
  status.textContent = text;
  status.className = `statusDot ${type || ""}`.trim();
  retry.hidden = type !== "error";
}

function showLoading() {
  if ($("foodCards")) $("foodCards").innerHTML = '<div class="empty loadingText">載入中...</div>';
  if ($("purchaseRows")) $("purchaseRows").innerHTML = '<tr><td colspan="11" class="empty loadingText">載入中...</td></tr>';
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
