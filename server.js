// server.js
// Backend dla aplikacji MILK + panel admina pod /33201adm
// Dane są trzymane w pliku db-milk.json w tym samym folderze.

const express = require("express");
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs").promises;
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- ŚCIEŻKI ----------
const ROOT = __dirname;
const DB_FILE = path.join(ROOT, "db-milk.json");

// ---------- Prosta "baza danych" ----------
let db = {
  users: [],      // { id, name, email, phone, points }
  rewards: [],    // { id, title, cost, desc, icon, createdAt }
  orders: [],     // { id, items, total, pickupTime, pickupLocation, notes, status, userId, createdAt, updatedAt }
  prepaid: [],    // { id, code, title, value, bonus, total, balance, userId, createdAt, history: [] }
  pointsOps: []   // { id, userId, amount, points, op, note, createdAt }
};

function genId() {
  try {
    return randomUUID();
  } catch {
    return "id-" + Math.random().toString(36).slice(2, 10);
  }
}

async function loadDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      await saveDb();
      return;
    }
    const raw = await fsPromises.readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    db = { ...db, ...parsed };
    console.log("[DB] Załadowano db-milk.json");
  } catch (err) {
    console.error("[DB] Błąd odczytu, start z pustą bazą:", err.message);
  }
}

async function saveDb() {
  try {
    await fsPromises.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("[DB] Błąd zapisu:", err.message);
  }
}

// wczytanie na starcie
loadDb();

// ---------- Middleware ----------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- ROUTES FRONT (HTML) ----------

// Panel admina pod /33201adm
// ZMIEŃ "admin-milk.html" jeśli plik nazywa się inaczej (np. admin.html)
app.get("/33201adm", (req, res) => {
  res.sendFile(path.join(ROOT, "admin-milk.html"));
});

// statyczne pliki (index.html, css, js, ikony itp.)
app.use(express.static(ROOT));

// Home – aplikacja użytkownika (Milk PWA)
app.get("/", (req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

// ---------- API MILK ----------
// Możesz z nich korzystać w panelu admina

// ===== STATS =====
app.get("/api/milk/stats", (req, res) => {
  try {
    const usersCount = db.users.length;
    const pointsTotal = db.users.reduce((sum, u) => sum + (u.points || 0), 0);
    const redeems = db.pointsOps.filter((o) => o.op === "sub").length;
    const activeOrders = db.orders.filter(
      (o) => String(o.status || "").toLowerCase() !== "wydane"
    ).length;
    const prepaidCount = db.prepaid.length;

    res.json({
      users: usersCount,
      pointsTotal,
      redeems,
      ordersActive: activeOrders,
      prepaid: prepaidCount
    });
  } catch (err) {
    console.error("stats error", err);
    res.status(500).json({ message: "Błąd liczenia statystyk" });
  }
});

// ===== USERS =====

// lista użytkowników
app.get("/api/milk/users", (req, res) => {
  res.json(db.users);
});

// szczegóły użytkownika
app.get("/api/milk/users/:id", (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ message: "Użytkownik nie istnieje" });

  const history = db.pointsOps.filter((op) => op.userId === user.id);
  res.json({ user, history });
});

// ===== POINTS =====

// POST /api/milk/points/add
// body: { userId, amount, points, op, note }
app.post("/api/milk/points/add", async (req, res) => {
  try {
    const { userId, amount, points, op, note } = req.body || {};
    if (!userId) return res.status(400).json({ message: "Brak userId" });

    let pts = parseInt(points, 10);
    const amt = parseFloat(amount || 0);

    if (!pts || pts <= 0) {
      // 10 zł = 1 pkt
      pts = Math.floor(amt / 10);
    }
    if (!pts || pts <= 0) {
      return res
        .status(400)
        .json({ message: "Liczba punktów musi być większa niż 0" });
    }

    const operation = op === "sub" ? "sub" : "add";
    const delta = operation === "sub" ? -pts : pts;

    let user = db.users.find((u) => u.id === userId);
    if (!user) {
      // jeśli nie istnieje – tworzymy pusty z tym ID
      user = {
        id: userId,
        name: null,
        email: null,
        phone: null,
        points: 0
      };
      db.users.push(user);
    }

    user.points = Math.max(0, (user.points || 0) + delta);

    const opObj = {
      id: genId(),
      userId,
      amount: isNaN(amt) ? 0 : amt,
      points: pts,
      op: operation,
      note: note || "",
      createdAt: new Date().toISOString()
    };
    db.pointsOps.unshift(opObj);

    await saveDb();
    res.json({ ok: true, user, op: opObj });
  } catch (err) {
    console.error("points/add error", err);
    res.status(500).json({ message: "Błąd zapisu punktów" });
  }
});

// historia operacji punktów
app.get("/api/milk/points/ops", (req, res) => {
  res.json(db.pointsOps);
});

// ===== REWARDS =====

// lista nagród
app.get("/api/milk/rewards", (req, res) => {
  res.json(db.rewards);
});

// dodaj nagrodę
app.post("/api/milk/rewards", async (req, res) => {
  try {
    const { title, cost, desc, icon } = req.body || {};
    if (!title || !cost) {
      return res
        .status(400)
        .json({ message: "Wymagane jest 'title' i 'cost'" });
    }

    const reward = {
      id: genId(),
      title: String(title),
      cost: parseInt(cost, 10),
      desc: desc ? String(desc) : "",
      icon: icon ? String(icon) : "",
      createdAt: new Date().toISOString()
    };
    db.rewards.push(reward);
    await saveDb();
    res.status(201).json(reward);
  } catch (err) {
    console.error("rewards POST error", err);
    res.status(500).json({ message: "Błąd dodawania nagrody" });
  }
});

// edycja nagrody (opcjonalnie)
app.put("/api/milk/rewards/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const reward = db.rewards.find((r) => r.id === id);
    if (!reward) return res.status(404).json({ message: "Nagroda nie istnieje" });

    const { title, cost, desc, icon } = req.body || {};
    if (title !== undefined) reward.title = String(title);
    if (cost !== undefined) reward.cost = parseInt(cost, 10) || reward.cost;
    if (desc !== undefined) reward.desc = String(desc);
    if (icon !== undefined) reward.icon = String(icon);

    await saveDb();
    res.json(reward);
  } catch (err) {
    console.error("rewards PUT error", err);
    res.status(500).json({ message: "Błąd edycji nagrody" });
  }
});

// usuń nagrodę
app.delete("/api/milk/rewards/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const idx = db.rewards.findIndex((r) => r.id === id);
    if (idx === -1) {
      return res.status(404).json({ message: "Nagroda nie istnieje" });
    }
    db.rewards.splice(idx, 1);
    await saveDb();
    res.json({ ok: true });
  } catch (err) {
    console.error("rewards DELETE error", err);
    res.status(500).json({ message: "Błąd usuwania nagrody" });
  }
});

// ===== ORDERS (Zamów i odbierz) =====

// (opcjonalnie) endpoint, jeśli chcesz wysyłać zamówienia z frontu do backendu
// body: { items:[{title, qty, price}], total, pickupTime, pickupLocation, notes, userId }
app.post("/api/milk/orders", async (req, res) => {
  try {
    const {
      items = [],
      total = 0,
      pickupTime,
      pickupLocation,
      notes,
      userId
    } = req.body || {};

    if (!items.length) {
      return res.status(400).json({ message: "Brak pozycji w zamówieniu" });
    }

    const order = {
      id: genId(),
      items,
      total: Number(total) || 0,
      pickupTime: pickupTime || null,
      pickupLocation: pickupLocation || null,
      notes: notes || "",
      status: "Przyjęte",
      userId: userId || null,
      createdAt: new Date().toISOString(),
      updatedAt: null
    };

    db.orders.unshift(order);
    await saveDb();
    res.status(201).json(order);
  } catch (err) {
    console.error("orders POST error", err);
    res.status(500).json({ message: "Błąd tworzenia zamówienia" });
  }
});

// lista zamówień (dla panelu)
app.get("/api/milk/orders", (req, res) => {
  res.json(db.orders);
});

// zmiana statusu zamówienia
app.put("/api/milk/orders/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body || {};
    const order = db.orders.find((o) => o.id === id);
    if (!order) return res.status(404).json({ message: "Zamówienie nie istnieje" });

    if (status) order.status = String(status);
    order.updatedAt = new Date().toISOString();
    await saveDb();
    res.json(order);
  } catch (err) {
    console.error("orders PUT error", err);
    res.status(500).json({ message: "Błąd zmiany statusu zamówienia" });
  }
});

// ===== PREPAID =====

// zakup nowej karty (np. jeśli kiedyś podłączysz to z aplikacją)
app.post("/api/milk/prepaid/purchase", async (req, res) => {
  try {
    const { title, value, bonus = 0, userId } = req.body || {};
    const val = Number(value || 0);
    const bon = Number(bonus || 0);
    if (!val) return res.status(400).json({ message: "Wartość karty musi być > 0" });

    const code = String(Math.floor(100000 + Math.random() * 900000));

    const card = {
      id: genId(),
      code,
      title: title || `Karta ${val} zł`,
      value: val,
      bonus: bon,
      total: val + bon,
      balance: val + bon,
      userId: userId || null,
      createdAt: new Date().toISOString(),
      history: [
        {
          delta: val + bon,
          note: "Zakup karty",
          date: new Date().toISOString()
        }
      ]
    };

    db.prepaid.unshift(card);
    await saveDb();
    res.status(201).json(card);
  } catch (err) {
    console.error("prepaid purchase error", err);
    res.status(500).json({ message: "Błąd zakupu karty" });
  }
});

// lista wszystkich kart (dla panelu)
app.get("/api/milk/prepaid", (req, res) => {
  res.json(db.prepaid);
});

// pobranie karty po kodzie
app.get("/api/milk/prepaid/:code", (req, res) => {
  const code = String(req.params.code);
  const card = db.prepaid.find((p) => String(p.code) === code);
  if (!card) return res.status(404).json({ message: "Karta nie istnieje" });
  res.json(card);
});

// doładowanie / odjęcie z karty
// body: { delta, note }
app.post("/api/milk/prepaid/:code/adjust", async (req, res) => {
  try {
    const code = String(req.params.code);
    const { delta, note } = req.body || {};
    const d = Number(delta || 0);
    if (!d) return res.status(400).json({ message: "delta musi być różne od 0" });

    const card = db.prepaid.find((p) => String(p.code) === code);
    if (!card) return res.status(404).json({ message: "Karta nie istnieje" });

    const prev = card.balance ?? card.total ?? card.value ?? 0;
    const next = prev + d;
    if (next < 0) {
      return res.status(400).json({ message: "Saldo nie może być ujemne" });
    }

    card.balance = next;
    if (!Array.isArray(card.history)) card.history = [];
    card.history.unshift({
      delta: d,
      note: note || (d > 0 ? "Doładowanie (admin)" : "Korekta / odjęcie (admin)"),
      date: new Date().toISOString()
    });

    await saveDb();
    res.json(card);
  } catch (err) {
    console.error("prepaid adjust error", err);
    res.status(500).json({ message: "Błąd zmiany salda karty" });
  }
});

// ---------- Fallback 404 dla /api ----------

app.use("/api", (req, res) => {
  res.status(404).json({ message: "Nieznany endpoint API" });
});

// ---------- START SERWERA ----------

app.listen(PORT, () => {
  console.log(`\nMilk server działa 🚀`);
  console.log(`Aplikacja:    http://localhost:${PORT}/`);
  console.log(`Admin panel:  http://localhost:${PORT}/33201adm\n`);
});
