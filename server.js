// server.js
// Prosty backend dla aplikacji MILK + panel admina pod /33201adm
// Dane trzymane w pliku JSON (db-milk.json) w tym samym folderze.

const express = require("express");
const path = require("path");
const fs = require("fs");
const fsPromises = require("fs").promises;
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const __dirnameResolved = __dirname; // dla przejrzystości

// ---------------------- DB (plik JSON) ----------------------
const DB_FILE = path.join(__dirnameResolved, "db-milk.json");

// Domyślna struktura bazy
let db = {
  users: [],      // {id, name, email, phone, points}
  rewards: [],    // {id, title, cost, desc, icon, createdAt}
  orders: [],     // {id, items, total, pickupTime, pickupLocation, notes, status, userId, createdAt}
  prepaid: [],    // {id, code, title, value, bonus, total, balance, userId, createdAt, history:[]}
  pointsOps: []   // {id, userId, amount, points, op, note, createdAt}
};

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
  } catch (e) {
    console.error("[DB] Błąd odczytu, startuję z pustą bazą:", e.message);
  }
}

async function saveDb() {
  try {
    await fsPromises.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("[DB] Błąd zapisu:", e.message);
  }
}

function genId() {
  try {
    return randomUUID();
  } catch {
    return "id-" + Math.random().toString(36).slice(2, 10);
  }
}

// Na start wczytaj bazę
loadDb();

// ---------------------- Middleware ----------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serwuj wszystkie pliki z tego samego folderu (index.html, admin-milk.html itd.)
app.use(express.static(__dirnameResolved));

// ---------------------- ROUTES FRONT ----------------------

// Strona główna aplikacji (PWA)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirnameResolved, "index.html"));
});

// Panel admina dostępny tylko pod /33201adm
app.get("/33201adm", (req, res) => {
  res.sendFile(path.join(__dirnameResolved, "admin-milk.html"));
});

// ---------------------- API MILK ----------------------
// Zgodnie z API_CONFIG z admin-milk.html

// ===== STATS =====
app.get("/api/milk/stats", (req, res) => {
  try {
    const usersCount = db.users.length;
    const pointsTotal = db.users.reduce((s, u) => s + (u.points || 0), 0);
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
  } catch (e) {
    res.status(500).json({ message: "Błąd liczenia statystyk" });
  }
});

// ===== USERS =====

// Lista wszystkich użytkowników
app.get("/api/milk/users", (req, res) => {
  res.json(db.users);
});

// Szczegóły użytkownika
app.get("/api/milk/users/:id", (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user) {
    return res.status(404).json({ message: "Użytkownik nie istnieje" });
  }
  res.json(user);
});

// ===== POINTS =====

// POST /api/milk/points/add
// body: { userId, amount, points, op, note }
app.post("/api/milk/points/add", async (req, res) => {
  try {
    const { userId, amount, points, op, note } = req.body || {};
    if (!userId) {
      return res.status(400).json({ message: "Brak userId" });
    }

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
      // jeśli nie istnieje – utwórz pustego z tym ID
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
      amount: amt || 0,
      points: pts,
      op: operation,
      note: note || "",
      createdAt: new Date().toISOString()
    };
    db.pointsOps.unshift(opObj); // ostatnie na górze

    await saveDb();
    res.json({ ok: true, user, op: opObj });
  } catch (e) {
    console.error("points/add error", e);
    res.status(500).json({ message: "Błąd zapisu punktów" });
  }
});

// Historia operacji punktów
app.get("/api/milk/points/ops", (req, res) => {
  res.json(db.pointsOps);
});

// ===== REWARDS =====

// Lista nagród
app.get("/api/milk/rewards", (req, res) => {
  res.json(db.rewards);
});

// Dodaj nagrodę
app.post("/api/milk/rewards", async (req, res) => {
  try {
    const { title, cost, desc, icon } = req.body || {};
    if (!title || !cost) {
      return res
        .status(400)
        .json({ message: "Wymagane jest title i cost" });
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
  } catch (e) {
    console.error("rewards POST error", e);
    res.status(500).json({ message: "Błąd dodawania nagrody" });
  }
});

// Edycja nagrody
app.put("/api/milk/rewards/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const reward = db.rewards.find((r) => r.id === id);
    if (!reward) {
      return res.status(404).json({ message: "Nagroda nie istnieje" });
    }

    const { title, cost, desc, icon } = req.body || {};
    if (title !== undefined) reward.title = String(title);
    if (cost !== undefined) reward.cost = parseInt(cost, 10) || reward.cost;
    if (desc !== undefined) reward.desc = String(desc);
    if (icon !== undefined) reward.icon = String(icon);

    await saveDb();
    res.json(reward);
  } catch (e) {
    console.error("rewards PUT error", e);
    res.status(500).json({ message: "Błąd edycji nagrody" });
  }
});

// Usunięcie nagrody
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
  } catch (e) {
    console.error("rewards DELETE error", e);
    res.status(500).json({ message: "Błąd usuwania nagrody" });
  }
});

// ===== ORDERS =====

// (opcjonalnie) POST – żeby aplikacja mogła wysłać zamówienie do backendu
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
      createdAt: new Date().toISOString()
    };
    db.orders.unshift(order);
    await saveDb();
    res.status(201).json(order);
  } catch (e) {
    console.error("orders POST error", e);
    res.status(500).json({ message: "Błąd tworzenia zamówienia" });
  }
});

// GET lista zamówień
app.get("/api/milk/orders", (req, res) => {
  res.json(db.orders);
});

// Zmiana statusu zamówienia
app.put("/api/milk/orders/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body || {};
    const order = db.orders.find((o) => o.id === id);
    if (!order) {
      return res.status(404).json({ message: "Zamówienie nie istnieje" });
    }
    if (status) {
      order.status = String(status);
    }
    order.updatedAt = new Date().toISOString();
    await saveDb();
    res.json(order);
  } catch (e) {
    console.error("orders PUT error", e);
    res.status(500).json({ message: "Błąd zmiany statusu zamówienia" });
  }
});

// ===== PREPAID =====

// (opcjonalnie) zakup nowej karty z aplikacji
// body: { title, value, bonus, userId }
app.post("/api/milk/prepaid/purchase", async (req, res) => {
  try {
    const { title, value, bonus = 0, userId } = req.body || {};
    const val = Number(value || 0);
    const bon = Number(bonus || 0);
    if (!val) {
      return res.status(400).json({ message: "Wartość karty musi być > 0" });
    }
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
  } catch (e) {
    console.error("prepaid purchase error", e);
    res.status(500).json({ message: "Błąd zakupu karty" });
  }
});

// Lista wszystkich kart (dla panelu)
app.get("/api/milk/prepaid", (req, res) => {
  res.json(db.prepaid);
});

// Pobierz kartę po kodzie
app.get("/api/milk/prepaid/:code", (req, res) => {
  const code = String(req.params.code);
  const card = db.prepaid.find((p) => String(p.code) === code);
  if (!card) {
    return res.status(404).json({ message: "Karta nie istnieje" });
  }
  res.json(card);
});

// Doładowanie / odjęcie z karty
// body: { delta, note }
app.post("/api/milk/prepaid/:code/adjust", async (req, res) => {
  try {
    const code = String(req.params.code);
    const { delta, note } = req.body || {};
    const d = Number(delta || 0);
    if (!d) {
      return res.status(400).json({ message: "delta musi być różne od 0" });
    }
    const card = db.prepaid.find((p) => String(p.code) === code);
    if (!card) {
      return res.status(404).json({ message: "Karta nie istnieje" });
    }

    const prev = card.balance ?? card.total ?? card.value ?? 0;
    const next = prev + d;
    if (next < 0) {
      return res
        .status(400)
        .json({ message: "Saldo nie może być ujemne" });
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
  } catch (e) {
    console.error("prepaid adjust error", e);
    res.status(500).json({ message: "Błąd zmiany salda karty" });
  }
});

// ---------------------- Fallback 404 for API ----------------------
app.use("/api", (req, res) => {
  res.status(404).json({ message: "Nieznany endpoint API" });
});

// ---------------------- Start serwera ----------------------
app.listen(PORT, () => {
  console.log(`Milk server działa na http://localhost:${PORT}`);
  console.log(`Aplikacja:       http://localhost:${PORT}/`);
  console.log(`Panel admina:    http://localhost:${PORT}/33201adm`);
});
