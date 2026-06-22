// ==============================
// KaiBan ERP｜app.js
// 資料來源：Google Sheet 商品主檔 + 採購紀錄 CSV
// ==============================

const PRODUCT_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?output=csv";

const PURCHASE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?gid=1520549665&single=true&output=csv";

let products = [];
let purchases = [];

const $ = (id) => document.getElementById(id);

const money = (value) => {
  const number = Number(value || 0);
  return "$" + number.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
};

const norm = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");

document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupSearch();
  loadData();
});

function setupNavigation() {
  document.querySelectorAll(".nav").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));

      button.classList.add("active");

      const viewId = button.dataset.view;
      const view = $(viewId);
      if (view) view.classList.add("active");

      const title = button.textContent.replace(/[📊🔍📦🏪]/g, "").trim();
      if ($("pageTitle")) $("pageTitle").textContent = title;
    });
  });
}

function setupSearch() {
  const input = $("globalSearch");
  if (input) input.addEventListener("input", render);
}

async function loadData() {
  showLoading();

  try {
    const [productText, purchaseText] = await Promise.all([
      fetchCSV(PRODUCT_CSV_URL),
      fetchCSV(PURCHASE_CSV_URL),
    ]);

    products = parseCSV(productText)
      .filter((row) => row["品項"])
      .map(normalizeProduct);

    purchases = parseCSV(purchaseText)
      .filter((row) => row["品項"])
      .map(normalizePurchase);

    render();
  } catch (error) {
    console.error("KaiBan ERP load error:", error);
    showError("資料讀取失敗，請確認 Google Sheet 已發布成 CSV。");
  }
}

async function fetchCSV(url) {
  const response = await fetch(url + "&t=" + Date.now());

  if (!response.ok) {
    throw new Error("CSV 讀取失敗：" + response.status);
  }

  const buffer = await response.arrayBuffer();
  return new TextDecoder("utf-8").decode(buffer);
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  text = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
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
      if (char === "\r" && next === "\n") i++;
    } else {
      cell += char;
    }
  }

  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map((header) =>
    String(header || "")
      .replace(/^\uFEFF/, "")
      .trim()
  );

  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = String(values[index] || "").trim();
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
    price: Number(row["最新單價"] || 0),
    supplier: row["供應商"] || "未填供應商",
    lastDate: row["最近採購日"] || "",
    active: String(row["使用中"] || "TRUE").toUpperCase(),
    note: row["備註"] || "",
  };
}

function normalizePurchase(row) {
  const qty = Number(row["數量"] || 0);
  const price = Number(row["單價"] || 0);
  const amount = Number(row["金額"] || qty * price || 0);

  return {
    date: row["日期"] || "",
    supplier: row["供應商"] || "未填供應商",
    name: row["品項"] || "",
    spec: row["規格"] || "",
    qty,
    unit: row["單位"] || "",
    price,
    amount,
    note: row["備註"] || "",
  };
}

function getFilteredProducts() {
  const keyword = norm($("globalSearch")?.value || "");

  return products.filter((product) => {
    if (product.active === "FALSE") return false;

    const searchText = [
      product.code,
      product.name,
      product.category,
      product.spec,
      product.unit,
      product.price,
      product.supplier,
      product.lastDate,
      product.note,
    ].join(" ");

    return !keyword || norm(searchText).includes(keyword);
  });
}

function getFilteredPurchases() {
  const keyword = norm($("globalSearch")?.value || "");

  return purchases.filter((purchase) => {
    const searchText = [
      purchase.date,
      purchase.supplier,
      purchase.name,
      purchase.spec,
      purchase.qty,
      purchase.unit,
      purchase.price,
      purchase.amount,
      purchase.note,
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
  renderSuppliers();
}

function renderDashboard() {
  const activeProducts = products.filter((p) => p.active !== "FALSE");
  const suppliers = new Set(activeProducts.map((p) => p.supplier));
  const purchaseTotal = purchases.reduce((sum, p) => sum + p.amount, 0);

  if ($("statRows")) $("statRows").textContent = purchases.length;
  if ($("statFoods")) $("statFoods").textContent = activeProducts.length;
  if ($("statSuppliers")) $("statSuppliers").textContent = suppliers.size;
  if ($("statTotal")) $("statTotal").textContent = money(purchaseTotal);

  const recent = [...purchases]
    .filter((p) => p.date)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 8);

  if ($("recentList")) {
    $("recentList").innerHTML =
      recent
        .map(
          (p) => `
          <div class="item">
            <div>
              <strong>${escapeHTML(p.name)}</strong><br>
              <span class="muted">${escapeHTML(p.date)}｜${escapeHTML(p.supplier)}</span>
            </div>
            <div>
              <strong>${money(p.amount)}</strong><br>
              <span class="muted">${p.qty} ${escapeHTML(p.unit || "")} × ${money(p.price)}</span>
            </div>
          </div>
        `
        )
        .join("") || `<div class="item">尚無採購資料</div>`;
  }
}

function renderProductCards(list) {
  const container = $("foodCards");
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="foodCard">找不到商品</div>`;
    return;
  }

  container.innerHTML = list
    .map(
      (p) => `
      <article class="foodCard">
        <span class="tag">${escapeHTML(p.category)}</span>
        <span class="tag">${escapeHTML(p.supplier)}</span>

        <h3>${escapeHTML(p.name)}</h3>

        <div class="price">${money(p.price)} / ${escapeHTML(p.unit || "單位")}</div>

        <div class="meta">
          <div class="label">ERP代碼</div><div>${escapeHTML(p.code || "—")}</div>
          <div class="label">規格</div><div>${escapeHTML(p.spec || "—")}</div>
          <div class="label">最近採購</div><div>${escapeHTML(p.lastDate || "—")}</div>
          <div class="label">備註</div><div>${escapeHTML(p.note || "—")}</div>
        </div>
      </article>
    `
    )
    .join("");
}

function renderPurchaseRows(list) {
  const tbody = $("purchaseRows");
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9">尚無採購資料</td></tr>`;
    return;
  }

  const sorted = [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  tbody.innerHTML = sorted
    .map(
      (p) => `
      <tr>
        <td>${escapeHTML(p.date || "")}</td>
        <td>${escapeHTML(p.supplier)}</td>
        <td><strong>${escapeHTML(p.name)}</strong></td>
        <td></td>
        <td>${escapeHTML(p.spec || "")}</td>
        <td>${p.qty} ${escapeHTML(p.unit || "")}</td>
        <td>${money(p.price)}</td>
        <td>${money(p.amount)}</td>
        <td>${escapeHTML(p.note || "")}</td>
      </tr>
    `
    )
    .join("");
}

function renderSuppliers() {
  const container = $("supplierCards");
  if (!container) return;

  const map = {};

  purchases.forEach((p) => {
    if (!map[p.supplier]) {
      map[p.supplier] = {
        name: p.supplier,
        count: 0,
        total: 0,
        items: new Set(),
      };
    }

    map[p.supplier].count += 1;
    map[p.supplier].total += p.amount;
    map[p.supplier].items.add(p.name);
  });

  const suppliers = Object.values(map).sort((a, b) => b.total - a.total);

  if (!suppliers.length) {
    container.innerHTML = `<div class="foodCard">尚無供應商資料</div>`;
    return;
  }

  container.innerHTML = suppliers
    .map(
      (supplier) => `
      <article class="foodCard">
        <span class="tag">供應商</span>
        <h3>${escapeHTML(supplier.name)}</h3>
        <div class="price">${money(supplier.total)}</div>
        <div class="meta">
          <div class="label">採購筆數</div><div>${supplier.count}</div>
          <div class="label">品項數</div><div>${supplier.items.size}</div>
        </div>
      </article>
    `
    )
    .join("");
}

function showLoading() {
  if ($("foodCards")) $("foodCards").innerHTML = `<div class="foodCard">商品資料載入中…</div>`;
  if ($("recentList")) $("recentList").innerHTML = `<div class="item">採購資料載入中…</div>`;
}

function showError(message) {
  if ($("foodCards")) $("foodCards").innerHTML = `<div class="foodCard">${escapeHTML(message)}</div>`;
  if ($("recentList")) $("recentList").innerHTML = `<div class="item">${escapeHTML(message)}</div>`;
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}