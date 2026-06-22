// ==============================
// KaiBan ERP｜app.js
// 資料來源：Google Sheet 商品主檔 CSV
// ==============================

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?output=csv";

let products = [];

const $ = (id) => document.getElementById(id);

const money = (value) => {
  const number = Number(value || 0);
  return "$" + number.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
};

const norm = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "");

// ==============================
// 初始化
// ==============================

document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupSearch();
  loadProducts();
});

// ==============================
// 導覽切換
// ==============================

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

// ==============================
// 讀取 Google Sheet
// ==============================

async function loadProducts() {
  showLoading();

  try {
    const response = await fetch(SHEET_CSV_URL + "&t=" + Date.now());

    if (!response.ok) {
      throw new Error("Google Sheet 讀取失敗：" + response.status);
    }

    const buffer = await response.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buffer);

    products = parseCSV(text)
      .filter((row) => row["品項"])
      .map(normalizeProduct);

    render();
  } catch (error) {
    console.error("KaiBan ERP load error:", error);
    showError("資料讀取失敗，請確認 Google Sheet 已發布成 CSV。");
  }
}

// ==============================
// CSV 解析
// 支援逗號、換行、雙引號
// ==============================

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

// ==============================
// 統一商品資料格式
// ==============================

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

// ==============================
// 搜尋
// ==============================

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

// ==============================
// 畫面渲染
// ==============================

function render() {
  const list = getFilteredProducts();

  renderDashboard();
  renderProductCards(list);
  renderPurchaseRows(list);
  renderSuppliers();
}

// ==============================
// Dashboard
// ==============================

function renderDashboard() {
  const activeProducts = products.filter((p) => p.active !== "FALSE");
  const suppliers = new Set(activeProducts.map((p) => p.supplier));
  const totalPrice = activeProducts.reduce((sum, p) => sum + p.price, 0);

  if ($("statRows")) $("statRows").textContent = activeProducts.length;
  if ($("statFoods")) $("statFoods").textContent = activeProducts.length;
  if ($("statSuppliers")) $("statSuppliers").textContent = suppliers.size;
  if ($("statTotal")) $("statTotal").textContent = money(totalPrice);

  const recent = [...activeProducts]
    .filter((p) => p.lastDate)
    .sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)))
    .slice(0, 8);

  if ($("recentList")) {
    $("recentList").innerHTML =
      recent
        .map(
          (p) => `
          <div class="item">
            <div>
              <strong>${escapeHTML(p.name)}</strong><br>
              <span class="muted">${escapeHTML(p.lastDate)}｜${escapeHTML(p.supplier)}</span>
            </div>
            <div>
              <strong>${money(p.price)}</strong><br>
              <span class="muted">${escapeHTML(p.unit || "")}</span>
            </div>
          </div>
        `
        )
        .join("") || `<div class="item">尚無資料</div>`;
  }
}

// ==============================
// 食材卡片
// ==============================

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

// ==============================
// 採購紀錄區
// 目前先用商品主檔呈現最新採購資料
// 之後會改讀「採購紀錄」工作表
// ==============================

function renderPurchaseRows(list) {
  const tbody = $("purchaseRows");
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9">尚無資料</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (p) => `
      <tr>
        <td>${escapeHTML(p.lastDate || "")}</td>
        <td>${escapeHTML(p.supplier)}</td>
        <td><strong>${escapeHTML(p.name)}</strong></td>
        <td>${escapeHTML(p.category)}</td>
        <td>${escapeHTML(p.spec || "")}</td>
        <td>—</td>
        <td>${money(p.price)}</td>
        <td>—</td>
        <td>${escapeHTML(p.note || "")}</td>
      </tr>
    `
    )
    .join("");
}

// ==============================
// 供應商統計
// ==============================

function renderSuppliers() {
  const container = $("supplierCards");
  if (!container) return;

  const map = {};

  products
    .filter((p) => p.active !== "FALSE")
    .forEach((p) => {
      if (!map[p.supplier]) {
        map[p.supplier] = {
          name: p.supplier,
          count: 0,
          total: 0,
          categories: new Set(),
        };
      }

      map[p.supplier].count += 1;
      map[p.supplier].total += p.price;
      map[p.supplier].categories.add(p.category);
    });

  const suppliers = Object.values(map).sort((a, b) => b.count - a.count);

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
        <div class="price">${supplier.count} 項</div>
        <div class="meta">
          <div class="label">價格合計</div><div>${money(supplier.total)}</div>
          <div class="label">分類數</div><div>${supplier.categories.size}</div>
        </div>
      </article>
    `
    )
    .join("");
}

// ==============================
// 狀態顯示
// ==============================

function showLoading() {
  if ($("foodCards")) {
    $("foodCards").innerHTML = `<div class="foodCard">資料載入中…</div>`;
  }
}

function showError(message) {
  if ($("foodCards")) {
    $("foodCards").innerHTML = `<div class="foodCard">${escapeHTML(message)}</div>`;
  }

  if ($("recentList")) {
    $("recentList").innerHTML = `<div class="item">${escapeHTML(message)}</div>`;
  }
}

// ==============================
// 安全輸出
// ==============================

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}