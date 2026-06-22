const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?output=csv";

let products = [];

const $ = (id) => document.getElementById(id);
const money = (n) => "$" + Number(n || 0).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

document.querySelectorAll(".nav").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));

    btn.classList.add("active");
    const view = btn.dataset.view;
    $(view)?.classList.add("active");

    if ($("pageTitle")) {
      $("pageTitle").textContent = btn.textContent.replace(/[📊🔍📦🏪]/g, "").trim();
    }
  });
});

$("globalSearch")?.addEventListener("input", render);

async function loadProducts() {
  try {
    const res = await fetch(SHEET_CSV_URL + "&t=" + Date.now());
    const text = await res.text();

    products = parseCSV(text)
      .filter((p) => p["品項"])
      .map(normalizeProduct);

    render();
  } catch (error) {
    console.error(error);
    if ($("foodCards")) {
      $("foodCards").innerHTML = `<div class="foodCard">資料讀取失敗，請確認 Google Sheet 已發布成 CSV。</div>`;
    }
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

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
      if (cell || row.length) {
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

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows[0].map((h) => h.trim());

  return rows.slice(1).map((r) => {
    const item = {};
    headers.forEach((h, i) => {
      item[h] = (r[i] || "").trim();
    });
    return item;
  });
}

function normalizeProduct(p) {
  return {
    code: p["ERP代碼"] || "",
    name: p["品項"] || "",
    category: p["分類"] || "未分類",
    spec: p["規格"] || "",
    unit: p["單位"] || "",
    price: Number(p["最新單價"] || 0),
    supplier: p["供應商"] || "未填供應商",
    lastDate: p["最近採購日"] || "",
    active: String(p["使用中"] || "TRUE").toUpperCase(),
    note: p["備註"] || "",
  };
}

function filteredProducts() {
  const q = norm($("globalSearch")?.value || "");

  return products.filter((p) => {
    if (p.active === "FALSE") return false;

    const searchText = [
      p.code,
      p.name,
      p.category,
      p.spec,
      p.unit,
      p.price,
      p.supplier,
      p.lastDate,
      p.note,
    ].join(" ");

    return !q || norm(searchText).includes(q);
  });
}

function render() {
  const list = filteredProducts();

  renderDashboard();
  renderFoodCards(list);
  renderPurchaseRows(list);
  renderSuppliers();
}

function renderDashboard() {
  if ($("statRows")) $("statRows").textContent = products.length;
  if ($("statFoods")) $("statFoods").textContent = products.filter((p) => p.active !== "FALSE").length;
  if ($("statSuppliers")) $("statSuppliers").textContent = new Set(products.map((p) => p.supplier)).size;
  if ($("statTotal")) $("statTotal").textContent = money(products.reduce((sum, p) => sum + p.price, 0));

  const recent = [...products]
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
              <strong>${p.name}</strong><br>
              <span class="muted">${p.lastDate}｜${p.supplier}</span>
            </div>
            <div>
              <strong>${money(p.price)}</strong><br>
              <span class="muted">${p.unit || ""}</span>
            </div>
          </div>
        `
        )
        .join("") || `<div class="item">尚無資料</div>`;
  }
}

function renderFoodCards(list) {
  if (!$("foodCards")) return;

  if (!list.length) {
    $("foodCards").innerHTML = `<div class="foodCard">找不到商品</div>`;
    return;
  }

  $("foodCards").innerHTML = list
    .map(
      (p) => `
      <article class="foodCard">
        <span class="tag">${p.category}</span>
        <span class="tag">${p.supplier}</span>
        <h3>${p.name}</h3>
        <div class="price">${money(p.price)} / ${p.unit || "單位"}</div>
        <div class="meta">
          <div class="label">ERP代碼</div><div>${p.code || "—"}</div>
          <div class="label">規格</div><div>${p.spec || "—"}</div>
          <div class="label">最近採購</div><div>${p.lastDate || "—"}</div>
          <div class="label">備註</div><div>${p.note || "—"}</div>
        </div>
      </article>
    `
    )
    .join("");
}

function renderPurchaseRows(list) {
  if (!$("purchaseRows")) return;

  $("purchaseRows").innerHTML =
    list
      .map(
        (p) => `
        <tr>
          <td>${p.lastDate || ""}</td>
          <td>${p.supplier}</td>
          <td><strong>${p.name}</strong></td>
          <td>${p.category}</td>
          <td>${p.spec || ""}</td>
          <td>—</td>
          <td>${money(p.price)}</td>
          <td>—</td>
          <td>${p.note || ""}</td>
        </tr>
      `
      )
      .join("") || `<tr><td colspan="9">尚無資料</td></tr>`;
}

function renderSuppliers() {
  if (!$("supplierCards")) return;

  const map = {};

  products.forEach((p) => {
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

  $("supplierCards").innerHTML =
    suppliers
      .map(
        (s) => `
        <article class="foodCard">
          <span class="tag">供應商</span>
          <h3>${s.name}</h3>
          <div class="price">${s.count} 項</div>
          <div class="meta">
            <div class="label">價格合計</div><div>${money(s.total)}</div>
            <div class="label">分類數</div><div>${s.categories.size}</div>
          </div>
        </article>
      `
      )
      .join("") || `<div class="foodCard">尚無供應商資料</div>`;
}

loadProducts();
