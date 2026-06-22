const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS6DeEloMgCjxhelHhJ53nBuz6ROEX13csDEZubiVkiz0Migol87Av33UT--i7r7ovTG8pxCkFVw_vo/pub?gid=0&single=true&output=csv";

let products = [];

const money = n => "$" + Number(n || 0).toLocaleString("zh-TW");
const norm = s => String(s || "").toLowerCase().trim();

async function loadProducts() {
  const res = await fetch(SHEET_CSV_URL + "&t=" + Date.now());
  const text = await res.text();
  products = parseCSV(text);
  render();
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = line.split(",");
    const item = {};
    headers.forEach((h, i) => item[h] = values[i]?.trim() || "");
    return item;
  }).filter(x => x["品項"]);
}

function render() {
  const q = norm(document.getElementById("globalSearch")?.value || "");
  const list = products.filter(p => {
    return !q || Object.values(p).some(v => norm(v).includes(q));
  });

  renderStats(list);
  renderProductCards(list);
}

function renderStats(list) {
  const statRows = document.getElementById("statRows");
  const statFoods = document.getElementById("statFoods");
  const statSuppliers = document.getElementById("statSuppliers");
  const statTotal = document.getElementById("statTotal");

  if (statRows) statRows.textContent = products.length;
  if (statFoods) statFoods.textContent = products.length;
  if (statSuppliers) {
    statSuppliers.textContent = new Set(products.map(x => x["供應商"])).size;
  }
  if (statTotal) {
    statTotal.textContent = money(
      products.reduce((sum, x) => sum + Number(x["最新單價"] || 0), 0)
    );
  }
}

function renderProductCards(list) {
  const foodCards = document.getElementById("foodCards");
  if (!foodCards) return;

  if (!list.length) {
    foodCards.innerHTML = `<div class="foodCard">找不到商品</div>`;
    return;
  }

  foodCards.innerHTML = list.map(p => `
    <article class="foodCard">
      <span class="tag">${p["分類"] || "未分類"}</span>
      <span class="tag">${p["供應商"] || "未填供應商"}</span>
      <h3>${p["品項"]}</h3>
      <div class="price">${money(p["最新單價"])} / ${p["單位"] || ""}</div>
      <div class="meta">
        <div class="label">規格</div><div>${p["規格"] || "—"}</div>
        <div class="label">最近採購</div><div>${p["最近採購日"] || "—"}</div>
        <div class="label">備註</div><div>${p["備註"] || "—"}</div>
      </div>
    </article>
  `).join("");
}

document.getElementById("globalSearch")?.addEventListener("input", render);

loadProducts();
