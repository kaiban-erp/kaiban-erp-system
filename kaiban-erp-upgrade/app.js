// =====================================================
// KaiBan ERP 2.0
// 1. Google Sheet CSV 讀取
// 2. data.js 備援資料
// 3. 每月支出分析
// 4. 快速建檔 + Google Apps Script 寫入
// =====================================================

const PRODUCT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?output=csv";
const PURCHASE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?gid=1520549665&single=true&output=csv";

// 完成 Apps Script 部署後，把 /exec 網址貼在引號內。
const APPS_SCRIPT_URL = "";

const STAGED_STORAGE_KEY = "kaiban-erp-staged-v2";
const $ = (id) => document.getElementById(id);

let products = [];
let purchases = [];
let stagedRecords = loadStagedRecords();
let selectedMonth = "";
let amountWasEdited = false;

const pageDescriptions = {
  dashboard: "採購、食材、供應商與每月支出集中管理。",
  foods: "搜尋品項並比較歷史價格。",
  purchases: "查看所有採購明細與匯出資料。",
  monthly: "依月份分析總支出、供應商與品項分類。",
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
  setupNavigation();
  setupSearch();
  setupMonthly();
  setupQuickEntry();
  setupExports();
  setDefaultEntryDate();
  updateApiBadge();
  renderStagedRecords();
  loadData();
});

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
      $("globalSearch").style.display = viewId === "quickEntry" ? "none" : "block";

      if (viewId === "monthly") renderMonthly();
      if (viewId === "quickEntry") renderStagedRecords();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  $("reloadData").addEventListener("click", loadData);
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

function setupExports() {
  $("exportAllCsv").addEventListener("click", () => downloadPurchasesCsv(getFilteredPurchases(), "開拌_全部採購紀錄.csv"));
  $("exportMonthCsv").addEventListener("click", () => {
    const list = purchases.filter((purchase) => monthKey(purchase.date) === selectedMonth);
    downloadPurchasesCsv(list, `開拌_${selectedMonth || "月份"}_採購紀錄.csv`);
  });
}

async function loadData() {
  setDataStatus("資料讀取中", "");
  showLoading();

  const [productResult, purchaseResult] = await Promise.allSettled([
    fetchCSV(PRODUCT_CSV_URL),
    fetchCSV(PURCHASE_CSV_URL),
  ]);

  let productRows = [];
  let purchaseRows = [];
  let usedFallback = false;

  if (productResult.status === "fulfilled") {
    productRows = parseCSV(productResult.value).filter((row) => row["品項"]);
  }

  if (purchaseResult.status === "fulfilled") {
    purchaseRows = parseCSV(purchaseResult.value).filter((row) => row["品項"]);
  }

  if (purchaseRows.length) {
    purchases = purchaseRows.map(normalizePurchase);
  } else {
    purchases = getFallbackPurchases();
    usedFallback = purchases.length > 0;
  }

  if (productRows.length) {
    products = productRows.map(normalizeProduct);
  } else {
    products = deriveProductsFromPurchases(purchases);
  }

  setInitialMonth();
  render();
  populateDataLists();

  if (purchases.length) {
    setDataStatus(usedFallback ? "備援資料已載入" : "Google Sheet 已同步", "ok");
    if (usedFallback) {
      showNotice("Google Sheet CSV 暫時無法讀取，目前先使用 data.js 備援資料。", "warn");
    } else {
      hideNotice();
    }
  } else {
    setDataStatus("尚無採購資料", "error");
    showNotice("目前沒有讀到採購資料，請確認 Google Sheet 已發布為 CSV，或保留原本的 data.js。", "error");
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

function normalizePurchase(row) {
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
  };
}

function getFallbackPurchases() {
  const source = Array.isArray(window.KAIBAN_PURCHASES) ? window.KAIBAN_PURCHASES : [];
  return source.filter((row) => row && (row.name || row["品項"])).map(normalizePurchase);
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
    return `
      <article class="foodCard">
        <span class="tag">${escapeHTML(product.category || "未分類")}</span>
        <span class="tag">${escapeHTML(product.supplier || "未填供應商")}</span>
        <h3>${escapeHTML(product.name)}</h3>
        <div class="price">${money(priceStats.latest)} <small>/ ${escapeHTML(product.unit || "單位")}</small></div>
        <div class="meta">
          <span class="label">ERP 代碼</span><span>${escapeHTML(product.code || "—")}</span>
          <span class="label">規格</span><span>${escapeHTML(product.spec || "—")}</span>
          <span class="label">最低價</span><span>${money(priceStats.min)}</span>
          <span class="label">最高價</span><span>${money(priceStats.max)}</span>
          <span class="label">平均價</span><span>${money(priceStats.average)}</span>
          <span class="label">最近採購</span><span>${escapeHTML(product.lastDate || "—")}</span>
          <span class="label">備註</span><span>${escapeHTML(product.note || "—")}</span>
        </div>
      </article>
    `;
  }).join("");
}

function getProductPriceStats(product) {
  const matching = purchases.filter((purchase) => norm(purchase.name) === norm(product.name) && purchase.price > 0);
  const prices = matching.map((purchase) => purchase.price);
  const latestPurchase = [...matching].sort((a, b) => compareDate(b.date, a.date))[0];

  if (!prices.length) {
    const latest = product.price || 0;
    return {
      latest,
      min: product.minPrice || latest,
      max: product.maxPrice || latest,
      average: product.avgPrice || latest,
    };
  }

  return {
    latest: latestPurchase?.price || product.price || 0,
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((sum, price) => sum + price, 0) / prices.length,
  };
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

  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_URL.includes("/exec")) {
    downloadPurchasesCsv(stagedRecords, "開拌_待匯入採購.csv");
    showNotice("尚未設定 Apps Script 網址，因此先下載備份 CSV。請依 Code.gs 步驟部署後，把 /exec 網址貼進 app.js。", "warn");
    return;
  }

  const button = $("submitStaged");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "寫入中…";

  try {
    await postToAppsScript({ records: stagedRecords });
    const submitted = [...stagedRecords];
    stagedRecords = [];
    saveStagedRecords();
    renderStagedRecords();

    // 讓畫面立刻看得到新資料；正式資料仍以 Google Sheet 為準。
    purchases.push(...submitted);
    products = deriveProductsFromPurchases(purchases);
    setInitialMonth(true);
    render();
    populateDataLists();
    showNotice(`已送出 ${submitted.length} 筆到 Google Sheet。CSV 更新可能稍有延遲，可稍後按「重新讀取資料」。`);
  } catch (error) {
    showNotice(`寫入失敗：${error.message}`, "error");
  } finally {
    button.disabled = !stagedRecords.length;
    button.textContent = originalText;
  }
}

function postToAppsScript(payload) {
  return new Promise((resolve, reject) => {
    const iframeName = `kaiban-submit-${Date.now()}`;
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
    field.value = JSON.stringify(payload);
    form.appendChild(field);

    let submitted = false;
    const cleanup = () => {
      setTimeout(() => {
        form.remove();
        iframe.remove();
      }, 500);
    };

    iframe.addEventListener("load", () => {
      if (!submitted) return;
      cleanup();
      resolve();
    });

    iframe.addEventListener("error", () => {
      cleanup();
      reject(new Error("無法連線到 Apps Script"));
    });

    document.body.append(iframe, form);
    submitted = true;
    form.submit();

    setTimeout(() => {
      if (document.body.contains(iframe)) {
        cleanup();
        resolve();
      }
    }, 8000);
  });
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
  const connected = Boolean(APPS_SCRIPT_URL && APPS_SCRIPT_URL.includes("/exec"));
  $("apiBadge").textContent = connected ? "Google Sheet 寫入已連接" : "尚未連接寫入接口";
  $("apiBadge").classList.toggle("connected", connected);
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
