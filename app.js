// =======================================================
// KaiBan ERP 2.0
// 1. Google Sheet CSV 讀取
// 2.data.js 備援資料
// 3. 每月支出分析
// 4. 快速建檔 + Google Apps 腳本寫入
// =======================================================

const PRODUCT_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8_x/1c
const PURCHASE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_ingle/pub?id

// 完成Apps Script部署後，把 /exec 網址貼在括號內。
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwlZ6wJFevpbijE8V76D-OEVYQZM7fveWRTlySROtMWSYeKEuEr1-WUrdtUJcUA-4Z2/exec";

const STAGED_STORAGE_KEY = "kaiban-erp-staged-v2";
const $ = (id) => document.getElementById(id);

let products = [];
let purchases = [];
let stagedRecords = loadStagedRecords();
let selectedMonth = "";
let amountWasEdited = false;

const pageDescriptions = {
  儀表板：「採購、食品、供應商與每月支出集中管理。」,
  foods: "搜尋商品項目並比較歷史價格。",
  採購：「查看所有採購明細與匯出資料。」,
  Monthly: "依月份分析總支出、供應商與項目分類。",
  fastEntry: "逐筆輸入或批次貼上，快速建立採購資料庫。",
  供應商: "查看各供應商累積採購金額與商品項數。",
};

const money = (value) => {
  const number = toNumber(value);
  return "$" + number.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
};

const toNumber = (value) => {
  如果 (typeof value === "number") 回傳 Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[$,，\s]/g, "");
  const number = Number(cleaned);
  返回 Number.isFinite(number) ? number : 0;
};

const norm = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, "");

const escapeHTML = (value) => String(value ?? "")
  .replaceAll("&", "&")
  .replaceAll("<", "<")
  .replaceAll(">", ">")
  .replaceAll('"', """)
  .replaceAll("'", "'");

const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

document.addEventListener("DOMContentLoaded", () => {
  設定導航();
  setupSearch();
  setupMonthly();
  setupQuickEntry();
  setupExports();
  設定預設入口日期();
  updateApiBadge();
  renderStagedRecords();
  載入資料();
});

function setupNavigation() {
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll("view").forEach((view) => view.classList.remove("active"));

      button.classList.add("active");
      const viewId = button.dataset.view;
      const view = $(viewId);
      如果 (view) view.classList.add("active");

      $("pageTitle").textContent = button.dataset.title || button.textContent.trim();
      $("pageDescription").textContent = pageDescriptions[viewId] || “”；
      $("globalSearch").style.display = viewId === "quickEntry" ? "none" : "block";

      如果 (viewId === "monthly") renderMonthly();
      如果 (viewId === "quickEntry") renderStagedRecords();
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
    如果 (!record) 返回；
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
  $("parseBulk").addEventListener("點擊", parseBulkPaste);
  $("downloadTemplate").addEventListener("click", downloadTemplate);
  $("downloadStged").addEventListener("click", () => downloadPurchasesCsv(stagedRecords, "開拌_待匯入採購.csv"));
  $("clearStaged").addEventListener("click", clearStagedRecords);
  $("submitStaged").addEventListener("click", submitStagedRecords);

  $("stagedRows").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-index]");
    如果（!button）返回；
    const index = Number(button.dataset.removeIndex);
    stagedRecords.splice(index, 1);
    saveStagedRecords();
    renderStagedRecords();
  });
}

function setupExports() {
  $("exportAllCsv").addEventListener("click", () => downloadPurchasesCsv(getFilteredPurchases(), "開拌_全部購買記錄.csv"));
  $("exportMonthCsv").addEventListener("click", () => {
    const list = purchases.filter((purchase) => monthKey(purchase.date) === selectedMonth);
    downloadPurchasesCsv(list, `開拌_${selectedMonth || "月份"}_採購記錄.csv`);
  });
}

非同步函數 loadData() {
  setDataStatus("資料讀取中", "");
  顯示載入中();

  const [productResult, purchaseResult] = await Promise.allSettled([
    fetchCSV(PRODUCT_CSV_URL),
    fetchCSV(PURCHASE_CSV_URL),
  ]);

  let productRows = [];
  let purchaseRows = [];
  let usedFallback = false;

  如果 (productResult.status === "fulfilled") {
    productRows = parseCSV(productResult.value).filter((row) => row["商品"]);
  }

  如果 (purchaseResult.status === "fulfilled") {
    purchaseRows = parseCSV(purchaseResult.value).filter((row) => row["商品"]);
  }

  如果 (purchaseRows.length) {
    purchases = purchaseRows.map(normalizePurchase);
  } 別的 {
    purchases = getFallbackPurchases();
    usedFallback = purchases.length > 0;
  }

  如果 (productRows.length) {
    products = productRows.map(normalizeProduct);
  } 別的 {
    products = derivedProductsFromPurchases(purchases);
  }

  設定初始月份();
  使成為（）;
  populateDataLists();

  如果 (purchases.length) {
    setDataStatus(usedFallback ? "備用資料已載入" : "Google Sheet 已同步", "ok");
    如果 (使用回退) {
      showNotice("Google Sheet CSV 暫時無法讀取，目前先使用 data.js 備援資料。", "warn");
    } 別的 {
      隱藏通知();
    }
  } 別的 {
    setDataStatus("尚無採購資料", "錯誤");
    showNotice("目前沒有讀取到採購數據，請確認Google Sheet已發佈為CSV，或不清楚的data.js。", "錯誤");
  }
}

非同步函數 fetchCSV(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const separator = url.includes("?") ? "&" : "?";

  嘗試 {
    const response = await fetch(`${url}${separator}t=${Date.now()}`, {
      快取："不儲存",
      訊號：控制器訊號
    });
    if (!response.ok) throw new Error(`CSV 讀取失敗：${response.status}`);
    const buffer = await response.arrayBuffer();
    return new TextDecoder("utf-8").decode(buffer);
  } 最後 {
    清除超時(超時);
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

    如果 (char === '"' && inQuotes && next === '"') {
      單元格 += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      單元格 = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      如果 (單元格 !== "" || 行長度) {
        row.push(cell);
        rows.push(row);
        行 = [];
        單元格 = "";
      }
      如果（字元 === "\r" 且下一個字元 === "\n") 索引 += 1;
    } 別的 {
      cell += char;
    }
  }

  如果 (單元格 !== "" || 行長度) {
    row.push(cell);
    rows.push(row);
  }

  如果 (!rows.length) 回傳 [];
  const headers = rows[0].map((header) => String(header ?? "").replace(/^\uFEFF/, "").trim());

  回傳 rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = String(values[index] ?? "").trim();
    });
    退貨；
  });
}

function normalizeProduct(row) {
  返回 {
    代碼：行[“ERP代碼”] || "",
    name: row["項目"] || "",
    類別: 行["分類"] || "未分類",
    規格：行[“規格”] || "",
    單位: 行["單位"] || "",
    價格: toNumber(row["最新單價"]),
    供應商: row["供應商"] || "未填供應商",
    lastDate: normalizeDate(row["近期購買日"]),
    active: String(row["使用中"] || "TRUE").toUpperCase(),
    註：行[“備註”] || "",
    minPrice: toNumber(row["最低價"]),
    maxPrice: toNumber(row["最高價"]),
    avgPrice: toNumber(row["平均價"]),
  };
}

function normalizePurchase(row) {
  const qty = toNumber(row["數量"] ?? row.qty);
  const Price = toNumber(row["單價"] ?? row.unitPrice ?? row.price);
  const amount = toNumber(row["金額"] ?? row["小計"] ?? row.total ?? row.amount) ||數量*價格；

  返回 {
    日期：normalizeDate(row["日期"] ?? row.date),
    供應商：行[「供應商」] ??行.供應商 ?? "未填供應商",
    name: row["品項"] ??行.名稱 ?? "",
    類別：行[“分類”] ??行.類別 ?? "未分類",
    規格：行[“規格”] ??行規格 ?? "",
    數量，
    單位：行[“單位”] ??行.單位 ?? "",
    價格，
    數量，
    注意：行[「備註」] ??行.註?? "",
  };
}

function getFallbackPurchases() {
  const source = Array.isArray(window.KAIBAN_PUR​​CHASES) ? window.KAIBAN_PUR​​CHASES : [];
  return source.filter((row) => row && (row.name || row["商品"])).map(normalizePurchase);
}

function derivedProductsFromPurchases(list) {
  const groups = new Map();

  list.forEach((purchase) => {
    const key = norm(`${purchase.name}|${purchase.spec}|${purchase.unit}`);
    如果 (!groups.has(key)) {
      groups.set(key, {
        代碼： ””，
        名稱：購買名稱，
        類別: 購買.類別 || "未分類",
        spec: purchase.spec，
        單位：購買單位，
        供應商：採購供應商
        lastDate: purchase.date,
        註：購買備註，
        活動狀態:“TRUE”，
        價格：[]
      });
    }

    const group = groups.get(key);
    如果 (purchase.price > 0) group.prices.push(purchase.price);
    如果 (compareDate(purchase.date, group.lastDate) > 0) {
      group.lastDate = purchase.date;
      group.price = purchase.price;
      group.supplier = purchase.supplier;
      group.category = purchase.category || group.category;
      group.note = purchase.note || group.note;
    }
  });

  回傳 [...groups.values()].map((group) => {
    const prices = group.prices.length ? group.prices : [0];
    const total = prices.reduce((sum, value) => sum + value, 0);
    返回 {
      ...團體，
      價格：group.price ?? prices.at(-1) ?? 0,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      平均價格：總價 / 價格.長度，
    };
  });
}

function getFilteredProducts() {
  const keyword = norm($("globalSearch").value);
  返回 products.filter((product) => {
    如果 (product.active === "FALSE") 回傳 false；
    const searchText = [
      產品代碼、產品名稱、產品類別、產品規格、產品單位
      產品價格、產品供應商、產品最後更新日期、產品備註
    ]。加入（” ”）;
    返回 !keyword || norm(searchText).includes(keyword)；
  });
}

function getFilteredPurchases() {
  const keyword = norm($("globalSearch").value);
  返回 purchases.filter((purchase) => {
    const searchText = [
      購買日期、購買供應商、購買名稱、購買類別
      採購規格、採購數量、採購單位、採購價格
      購買金額、購買備註
    ]。加入（” ”）;
    返回 !keyword || norm(searchText).includes(keyword)；
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
  $("statMonth").textContent = 錢(monthTotal);
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
          ${money(purchase.amount)}</strong>
          <small>${formatNumber(purchase.qty)} ${escapeHTML(purchase.unit)} × ${money(purchase.price)}</small>
        </div>
      </div>
    `).join("")
    : '<div class="empty">尚無採購資料</div>';

  renderBars($("dashboardSupplierBars"), groupTotals(monthList, "supplier"), 6);
}

function renderProductCards(list) {
  如果 (!list.length) {
    $("foodCards").innerHTML = '<div class="empty">缺商品</div>';
    返回;
  }

  $("foodCards").innerHTML = list.map((product) => {
    const priceStats = getProductPriceStats(product);
    回傳`
      <article class="foodCard">
        <span class="tag">${escapeHTML(product.category || "未分類")}</span>
        <span class="tag">${escapeHTML(product.supplier || "未填供應商")}</span>
        <h3>${escapeHTML(product.name)}</h3>
        <div class="price">${money(priceStats.latest)} <small>/ ${escapeHTML(product.unit || "位元")}</small></div>
        <div class="meta">
          <span class="label">ERP程式碼</span><span>${escapeHTML(product.code || "—")}</span>
          <span class="label">規格</span><span>${escapeHTML(product.spec || "—")}</span>
          <span class="label">最低價</span><span>${money(priceStats.min)}</span>
          <span class="label">最高價</span><span>${money(priceStats.max)}</span>
          <span class="label">平均價格</span><span>${money(priceStats.average)}</span>
          <span class="label">最近採購</span><span>${escapeHTML(product.lastDate || "—")}</span>
          <span class="label">備註</span><span>${escapeHTML(product.note || "—")}</span>
        </div>
      </article>
    `;
  }）。加入（””）;
}

function getProductPriceStats(product) {
  const matching = purchases.filter((purchase) => norm(purchase.name) === norm(product.name) && purchase.price > 0);
  const prices = matching.map((purchase) => purchase.price);
  const latestPurchase = [...matching].sort((a, b) => compareDate(b.date, a.date))[0];

  如果 (!prices.length) {
    const latest = product.price || 0;
    返回 {
      最新的，
      min: product.minPrice || latest,
      最高價：產品最高價 || 最新價，
      平均值：product.avgPrice || 最新，
    };
  }

  返回 {
    最新：最新購買價格 || 產品價格 || 0，
    min: Math.min(...prices),
    max: Math.max(...prices),
    平均值：prices.reduce((sum, price) => sum + price, 0) / prices.length,
  };
}

function renderPurchaseRows(list) {
  const sorted = [...list].sort((a, b) => compareDate(b.date, a.date));
  $("purchaseCountText").textContent = `共 ${sorted.length.toLocaleString("zh-TW")} 筆`;

  $("purchaseRows").innerHTML = sorted.length
    sorted.map((purchase) => `
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
  如果 (!selectedMonth) 設定初始月份();
  $("monthPicker").value = selectedMonth;

  const list = purchases
    .filter((purchase) => monthKey(purchase.date) === selectedMonth)
    .sort((a, b) => compareDate(b.date, a.date));

  const total = list.reduce((sum, purchase) => sum + purchase.amount, 0);
  const supplierCount = new Set(list.map((purchase) => purchase.supplier).filter(Boolean)).size;

  $("monthTotal").textContent = 錢(總計);
  $("monthCount").textContent = list.length.toLocaleString("zh-TW");
  $("monthSupplierCount").textContent = supplierCount.toLocaleString("zh-TW");
  $("monthAverage").textContent = money(list.length ? total / list.length : 0);
  $("monthDetailText").textContent = `${selectedMonth.replace("-", "/")}｜共 ${list.length.toLocaleString("zh-TW")} 筆`;

  renderBars($("monthSupplierBars"), groupTotals(list, "supplier"));
  renderBars($("monthCategoryBars"), groupTotals(list, "category"));

  $("monthRows").innerHTML = list.length
    list.map((purchase) => `
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
    : '<tr><td colspan="8" class="empty">本月份尚無採購資料</td></tr>';
}

函數 groupTotals(list, field) {
  const totals = new Map();
  list.forEach((purchase) => {
    const label = 購買[字段] || "未分類";
    totals.set(label, (totals.get(label) || 0) + purchase.amount);
  });
  返回 [...totals.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}

function renderBars(container, rows, limit = 10) {
  如果（!容器）返回；
  const list = rows.slice(0, limit);
  如果 (!list.length) {
    container.innerHTML = '<div class="empty">尚無資料</div>';
    返回;
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
    如果 (!map.has(purchase.supplier)) {
      map.set(purchase.supplier, {
        名稱：採購供應商
        計數：0
        總計：0
        items: new Set(),
        lastDate: purchase.date,
      });
    }

    const supplier = map.get(purchase.supplier);
    供應商數量 += 1;
    供應商總額 += 採購金額；
    供應商.items.add(採購名稱);
    如果 (compareDate(purchase.date, supplier.lastDate) > 0) supplier.lastDate = purchase.date;
  });

  const suppliers = [...map.values()].sort((a, b) => b.total - a.total);
  $("supplierCards").innerHTML = suppliers.length
    ? suppliers.map((supplier) => `
      <article class="foodCard">
        <span class="tag">供應商</span>
        <h3>${escapeHTML(供應商名稱)}</h3>
        <div class="price">${money(supplier.total)}</div>
        <div class="meta">
          <span class="label">購買筆數</span><span>${supplier.count.toLocaleString("zh-TW")}</span>
          <span class="label">商品項數</span><span>${supplier.items.size.toLocaleString("zh-TW")}</span>
          <span class="label">最近採購</span><span>${escapeHTML(supplier.lastDate || "—")}</span>
        </div>
      </article>
    `).join("")
    : '<div class="empty">尚無供應商資料</div>';
}

function getQuickFormRecord() {
  const record = normalizePurchase({
    日期：$("entryDate").value，
    供應商：$("entrySupplier").value.trim(),
    名稱: $("entryName").value.trim(),
    類別：$("entryCategory").value.trim() || "未分類",
    spec: $("entrySpec").value.trim(),
    數量：$("entryQty").value，
    單位：$("entryUnit").value.trim(),
    價格：$("entryPrice").value，
    金額：$("entryAmount").value，
    注意：$("entryNote").value.trim(),
  });

  如果 (!record.date || !record.supplier || !record.name) {
    showNotice("日期、供應商與項目為必填欄位。", "錯誤");
    返回空值；
  }

  如果 (record.qty <= 0 || record.price < 0 || record.amount < 0) {
    showNotice("數量必須大於0，單價與金額不得小於0。", "error");
    返回空值；
  }

  返回記錄；
}

函數 calculateEntryAmount() {
  如果（金額已編輯）返回；
  const qty = toNumber($("entryQty").value);
  const price = toNumber($("entryPrice").value);
  $("entryAmount").value = roundMoney(qty * price);
}

function resetQuickForm(options = {}) {
  const date = options.keepDate ? $("entryDate").value : todayInputValue();
  const supplier = options.keepSupplier ? $("entrySupplier").value : "";
  $("quickForm").reset();
  $("entryDate").value = date;
  $("entrySupplier").value = 供應商;
  $("entryQty").value = 1;
  $("entryAmount").value = "";
  amountWasEdited = false;
}

function parseBulkPaste() {
  const text = $("bulkPaste").value.trim();
  如果 (!text) {
    showNotice("請先貼上購買資料。", "警告");
    返回;
  }

  嘗試 {
    const rows = parsePastedRows(text);
    const valid = rows.filter((record) => record.date && record.supplier && record.name);
    if (!valid.length) throw new Error("沒有可犯的資料列");

    stagedRecords.push(...valid);
    saveStagedRecords();
    renderStagedRecords();
    $("bulkPaste").value = "";
    showNotice(`已解析並加入${valid.length}筆資料。`);
  } catch (error) {
    showNotice(`批次資料解析失敗：${error.message}`, "error");
  }
}

function parsePastedRows(text) {
  const rawLines = String(text).replace(/\r/g, "").split("\n").filter((line) => line.trim());
  如果 (!rawLines.length) 回傳 [];

  const delimiter = rawLines.some((line) => line.includes("\t")) ? "\t" : ",";
  const matrix = delimiter === ","
    ? parseCsvMatrix(rawLines.join("\n"))
    rawLines.map((line) => line.split("\t"));

  const first = matrix[0].map((cell) => String(cell).trim());
  const hasHeader = first.some((cell) => ["日期", "供應商", "品項", "分類", "數量", "單價", "金額"].includes(cell));
  常量標頭 = hasHeader ？ first : ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "備註"];
  const body = hasHeader ? matrix.slice(1) : matrix;

  傳回 body.map((values) => {
    const row = {};
    headers.forEach((header, index) => { row[header] = String(values[index] ?? "").trim(); });
    返回 normalizePurchase(row);
  });
}

函數 parseCsvMatrix(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    如果 (char === '"' && inQuotes && next === '"') {
      單元格 += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      單元格 = "";
    } else if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      行 = [];
      單元格 = "";
    } 別的 {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  返回行；
}

function renderStagedRecords() {
  const total = stagedRecords.reduce((sum, record) => sum + record.amount, 0);
  $("stagedSummary").textContent = stagedRecords.length
    ？ `${stagedRecords.length.toLocaleString("zh-TW")} 筆｜總計${money(total)}`
    : "尚未加入資料";

  $("submitStaged").disabled = !stagedRecords.length;
  $("downloadStaged").disabled = !stagedRecords.length;
  $("clearStaged").disabled = !stagedRecords.length;

  $("stagedRows").innerHTML = stagedRecords.length
    stagedRecords.map((record, index) => `
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

非同步函數 submitStagedRecords() {
  如果 (!stagedRecords.length) 返回；

  如果 (!APPS_SCRIPT_URL || !APPS_SCRIPT_URL.includes("/exec")) {
    downloadPurchasesCsv(stagedRecords, "開拌_待匯入採購.csv");
    showNotice("尚未設定Apps腳本網址因此，先下載備份CSV。請依照Code.gs步驟部署後，把/exec網址貼進app.js。", "warn");
    返回;
  }

  const button = $("submitStaged");
  const OriginalText = 按鈕.textContent;
  按鈕已禁用 = true;
  button.textContent = "寫入...";

  嘗試 {
    await postToAppsScript({ records: stagedRecords });
    const submitted = [...stagedRecords];
    stagedRecords = [];
    saveStagedRecords();
    renderStagedRecords();

    // 讓畫面立即查看得到新資料；正式資料仍以 Google Sheet 為準。
    purchases.push(...已提交);
    products = derivedProductsFromPurchases(purchases);
    設定初始月份(true);
    使成為（）;
    populateDataLists();
    showNotice(`已發送${subscribed.length}筆到Google Sheet。CSV更新可能稍有延遲，可稍後按「重新讀取資料」。`);
  } catch (error) {
    showNotice(`寫入失敗：${error.message}`, "error");
  } 最後 {
    button.disabled = !stagedRecords.length;
    按鈕.textContent = 原始文字;
  }
}

function postToAppsScript(payload) {
  const body = new URLSearchParams();
  body.set("有效載荷", JSON.stringify(有效載荷));

  返回 fetch(APPS_SCRIPT_URL, {
    方法：“POST”，
    模式：“no-cors”，
    標題：{
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: body.toString(),
  });
}

function clearStagedRecords() {
  如果 (!stagedRecords.length) 返回；
  const shouldClear = window.confirm(`確定清除待送清單中的${stagedRecords.length}筆資料？`);
  如果 (!shouldClear) 返回；
  stagedRecords = [];
  saveStagedRecords();
  renderStagedRecords();
}

function loadStagedRecords() {
  嘗試 {
    const parsed = JSON.parse(localStorage.getItem(STAGED_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizePurchase) : [];
  } 抓住 {
    返回 [];
  }
}

function saveStagedRecords() {
  localStorage.setItem(STAGED_STORAGE_KEY, JSON.stringify(stagedRecords));
}

function downloadTemplate() {
  const headers = ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "備註"];
  downloadText(`${headers.join(",")}\n`, "開配_採購匯入範本.csv", "text/csv;charset=utf-8");
}

function downloadPurchasesCsv(list, filename) {
  如果 (!list.length) {
    showNotice("目前沒有可匯出的資料。", "warn");
    返回;
  }

  const headers = ["日期", "供應商", "品項", "分類", "規格", "數量", "單位", "單價", "金額", "備註"];
  const lines = [headers.join(",")];
  list.forEach((purchase) => {
    lines.push([
      購買日期、購買供應商、購買名稱、購買類別
      採購規格、採購數量、採購單位、採購價格
      購買金額、購買備註
    ].map(csvCell).join(","));
  });
  downloadText(`\uFEFF${lines.join("\r\n")}`, filename, "text/csv;charset=utf-8");
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  連結.下載 = 檔名;
  document.body.appendChild(link);
  連結.點擊();
  連結.移除();
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
  如果（選取月份且未強制執行）則傳回；
  const months = purchases.map((purchase) => monthKey(purchase.date)).filter(Boolean).sort().reverse();
  const current = currentMonthKey();
  selectedMonth = months.includes(current) ? current : (months[0] || current);
}

function currentMonthKey() {
  const date = new Date();
  返回 `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthKey(value) {
  const date = normalizeDate(value);
  const match = date.match(/^(\d{4})\/(\d{2})/);
  返回匹配項？ `${match[1]}-${match[2]}` : "";
}

function normalizeDate(value) {
  const text = String(value ?? "").trim();
  如果 (!text) 返回 "";

  const direct = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  如果（直接）{
    返回 `${direct[1]}/${String(direct[2]).padStart(2, "0")}/${String(direct[3]).padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  如果 (!Number.isNaN(parsed.getTime())) {
    返回 `${parsed.getFullYear()}/${String(parsed.getMonth() + 1).padStart(2, "0")}/${String(parsed.getDate()).padStart(2, "0")}`;
  }

  返回文字；
}

函數 compareDate(a, b) {
  返回 sortableDate(a).localeCompare(sortableDate(b));
}

function sortableDate(value) {
  const normalized = normalizeDate(value);
  const match = normalized.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  返回匹配項？ `${match[1]}-${match[2]}-${match[3]}`：已歸一化；
}

function formatNumber(value) {
  return toNumber(value).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

function roundMoney(value) {
  返回 Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
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
  $("apiBadge").textContent = 已連線？ "Google Sheet 讀取已連線" : "尚未連線讀取介面";
  $("apiBadge").classList.toggle("已連線", connected);
}

function setDataStatus(text, type) {
  $("dataStatus").textContent = 文字;
  $("dataStatus").className = `statusDot ${type || ""}`.trim();
}

function showLoading() {
  $("foodCards").innerHTML = '<div class="empty">商品資料載入中…</div>';
  $("recentList").innerHTML = '<div class="empty">採購資料載入中...</div>';
}

function showNotice(message, type = "") {
  const notice = $("notice");
  notice.textContent = 訊息;
  notice.className = `notice ${type}`.trim();
  notice.hidden = false;
}

function hideNotice() {
  $("notice").hidden = true;
}