const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "";
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const INVESTMENTS_FILE = path.join(DATA_DIR, "investments.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

const sessions = new Map();
let pool = null;

if (DATABASE_URL) {
    const { Pool } = require("pg");
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    });
}

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

const INVESTMENT_TYPES = new Set(["renda-fixa", "acoes", "cripto"]);
const TRANSACTION_TYPES = new Set(["compra", "venda", "dividendo", "deposito", "saque"]);

const ensureDataDir = () => {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
};

const readUsers = () => {
    ensureDataDir();
    if (!fs.existsSync(USERS_FILE)) {
        return [];
    }
    try {
        const raw = fs.readFileSync(USERS_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeUsers = (users) => {
    ensureDataDir();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
};

const readStore = (filePath) => {
    ensureDataDir();
    if (!fs.existsSync(filePath)) {
        return {};
    }
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

const writeStore = (filePath, store) => {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
};

const loadSessions = async () => {
    if (pool) {
        const result = await pool.query("SELECT token, email, created_at, expires_at FROM sessions WHERE expires_at > NOW()");
        result.rows.forEach((row) => {
            sessions.set(row.token, {
                email: row.email,
                createdAt: toCamelDate(row.created_at),
                expiresAt: toCamelDate(row.expires_at),
            });
        });
        await pool.query("DELETE FROM sessions WHERE expires_at <= NOW()");
        return;
    }

    ensureDataDir();
    if (!fs.existsSync(SESSIONS_FILE)) {
        return;
    }
    try {
        const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return;
        }
        Object.entries(parsed).forEach(([token, session]) => {
            if (!session?.email || !session?.expiresAt) {
                return;
            }
            if (Date.parse(session.expiresAt) <= Date.now()) {
                return;
            }
            sessions.set(token, session);
        });
    } catch {
        sessions.clear();
    }
};

const writeSessions = () => {
    if (pool) {
        return;
    }
    ensureDataDir();
    const activeSessions = {};
    sessions.forEach((session, token) => {
        if (Date.parse(session.expiresAt) > Date.now()) {
            activeSessions[token] = session;
        }
    });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(activeSessions, null, 2), "utf8");
};

const toCamelDate = (value) => value instanceof Date ? value.toISOString() : value;

const mapUser = (row) => row ? {
    email: row.email,
    salt: row.salt,
    hash: row.hash,
    createdAt: toCamelDate(row.created_at),
} : null;

const mapInvestment = (row) => row ? {
    id: row.id,
    type: row.type,
    name: row.name,
    quantity: row.quantity === null ? null : Number(row.quantity),
    value: row.value === null ? null : Number(row.value),
    createdAt: toCamelDate(row.created_at),
    updatedAt: toCamelDate(row.updated_at),
} : null;

const mapTransaction = (row) => row ? {
    id: row.id,
    type: row.type,
    description: row.description,
    amount: Number(row.amount),
    date: toCamelDate(row.date),
    createdAt: toCamelDate(row.created_at),
    updatedAt: toCamelDate(row.updated_at),
} : null;

const initDatabase = async () => {
    if (!pool) {
        return;
    }

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            salt TEXT NOT NULL,
            hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL
        );

        CREATE TABLE IF NOT EXISTS investments (
            id TEXT PRIMARY KEY,
            user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            quantity NUMERIC,
            value NUMERIC,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
            type TEXT NOT NULL,
            description TEXT NOT NULL,
            amount NUMERIC NOT NULL,
            date TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        );
    `);
};

const fileStorage = {
    findUser: async (email) => readUsers().find((user) => user.email === email) || null,
    createUser: async (user) => {
        const users = readUsers();
        users.push(user);
        writeUsers(users);
    },
    updateUserPassword: async (email, salt, hash) => {
        const users = readUsers();
        const index = users.findIndex((user) => user.email === email);
        if (index === -1) {
            return false;
        }
        users[index] = { ...users[index], salt, hash };
        writeUsers(users);
        return true;
    },
    deleteUser: async (email) => {
        const users = readUsers();
        const filtered = users.filter((user) => user.email !== email);
        if (filtered.length === users.length) {
            return false;
        }
        writeUsers(filtered);
        removeUserItems(INVESTMENTS_FILE, email);
        removeUserItems(TRANSACTIONS_FILE, email);
        return true;
    },
    saveSession: async (token, session) => {
        sessions.set(token, session);
        writeSessions();
    },
    deleteSession: async (token) => {
        sessions.delete(token);
        writeSessions();
    },
    listInvestments: async (email) => sortByCreatedAtDesc(getUserItems(readStore(INVESTMENTS_FILE), email)),
    getInvestment: async (email, id) => getUserItems(readStore(INVESTMENTS_FILE), email).find((item) => item.id === id) || null,
    createInvestment: async (email, item) => {
        const store = readStore(INVESTMENTS_FILE);
        const items = getUserItems(store, email);
        items.push(item);
        store[email] = items;
        writeStore(INVESTMENTS_FILE, store);
        return item;
    },
    updateInvestment: async (email, id, updates) => {
        const store = readStore(INVESTMENTS_FILE);
        const items = getUserItems(store, email);
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) {
            return null;
        }
        const updated = { ...items[index], ...updates, updatedAt: new Date().toISOString() };
        items[index] = updated;
        store[email] = items;
        writeStore(INVESTMENTS_FILE, store);
        return updated;
    },
    deleteInvestment: async (email, id) => {
        const store = readStore(INVESTMENTS_FILE);
        const items = getUserItems(store, email);
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) {
            return false;
        }
        items.splice(index, 1);
        store[email] = items;
        writeStore(INVESTMENTS_FILE, store);
        return true;
    },
    listTransactions: async (email) => sortByCreatedAtDesc(getUserItems(readStore(TRANSACTIONS_FILE), email)),
    getTransaction: async (email, id) => getUserItems(readStore(TRANSACTIONS_FILE), email).find((item) => item.id === id) || null,
    createTransaction: async (email, item) => {
        const store = readStore(TRANSACTIONS_FILE);
        const items = getUserItems(store, email);
        items.push(item);
        store[email] = items;
        writeStore(TRANSACTIONS_FILE, store);
        return item;
    },
    updateTransaction: async (email, id, updates) => {
        const store = readStore(TRANSACTIONS_FILE);
        const items = getUserItems(store, email);
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) {
            return null;
        }
        const updated = { ...items[index], ...updates, updatedAt: new Date().toISOString() };
        items[index] = updated;
        store[email] = items;
        writeStore(TRANSACTIONS_FILE, store);
        return updated;
    },
    deleteTransaction: async (email, id) => {
        const store = readStore(TRANSACTIONS_FILE);
        const items = getUserItems(store, email);
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) {
            return false;
        }
        items.splice(index, 1);
        store[email] = items;
        writeStore(TRANSACTIONS_FILE, store);
        return true;
    },
};

const databaseStorage = {
    findUser: async (email) => {
        const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        return mapUser(result.rows[0]);
    },
    createUser: async (user) => {
        await pool.query(
            "INSERT INTO users (email, salt, hash, created_at) VALUES ($1, $2, $3, $4)",
            [user.email, user.salt, user.hash, user.createdAt]
        );
    },
    updateUserPassword: async (email, salt, hash) => {
        const result = await pool.query("UPDATE users SET salt = $2, hash = $3 WHERE email = $1", [email, salt, hash]);
        return result.rowCount > 0;
    },
    deleteUser: async (email) => {
        const result = await pool.query("DELETE FROM users WHERE email = $1", [email]);
        return result.rowCount > 0;
    },
    saveSession: async (token, session) => {
        sessions.set(token, session);
        await pool.query(
            `INSERT INTO sessions (token, email, created_at, expires_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (token) DO UPDATE SET email = EXCLUDED.email, expires_at = EXCLUDED.expires_at`,
            [token, session.email, session.createdAt, session.expiresAt]
        );
    },
    deleteSession: async (token) => {
        sessions.delete(token);
        await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
    },
    listInvestments: async (email) => {
        const result = await pool.query("SELECT * FROM investments WHERE user_email = $1 ORDER BY created_at DESC", [email]);
        return result.rows.map(mapInvestment);
    },
    getInvestment: async (email, id) => {
        const result = await pool.query("SELECT * FROM investments WHERE user_email = $1 AND id = $2", [email, id]);
        return mapInvestment(result.rows[0]);
    },
    createInvestment: async (email, item) => {
        const result = await pool.query(
            `INSERT INTO investments (id, user_email, type, name, quantity, value, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [item.id, email, item.type, item.name, item.quantity, item.value, item.createdAt]
        );
        return mapInvestment(result.rows[0]);
    },
    updateInvestment: async (email, id, updates) => {
        const current = await databaseStorage.getInvestment(email, id);
        if (!current) {
            return null;
        }
        const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
        const result = await pool.query(
            `UPDATE investments
             SET type = $3, name = $4, quantity = $5, value = $6, updated_at = $7
             WHERE user_email = $1 AND id = $2
             RETURNING *`,
            [email, id, next.type, next.name, next.quantity, next.value, next.updatedAt]
        );
        return mapInvestment(result.rows[0]);
    },
    deleteInvestment: async (email, id) => {
        const result = await pool.query("DELETE FROM investments WHERE user_email = $1 AND id = $2", [email, id]);
        return result.rowCount > 0;
    },
    listTransactions: async (email) => {
        const result = await pool.query("SELECT * FROM transactions WHERE user_email = $1 ORDER BY created_at DESC", [email]);
        return result.rows.map(mapTransaction);
    },
    getTransaction: async (email, id) => {
        const result = await pool.query("SELECT * FROM transactions WHERE user_email = $1 AND id = $2", [email, id]);
        return mapTransaction(result.rows[0]);
    },
    createTransaction: async (email, item) => {
        const result = await pool.query(
            `INSERT INTO transactions (id, user_email, type, description, amount, date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [item.id, email, item.type, item.description, item.amount, item.date, item.createdAt]
        );
        return mapTransaction(result.rows[0]);
    },
    updateTransaction: async (email, id, updates) => {
        const current = await databaseStorage.getTransaction(email, id);
        if (!current) {
            return null;
        }
        const next = { ...current, ...updates, updatedAt: new Date().toISOString() };
        const result = await pool.query(
            `UPDATE transactions
             SET type = $3, description = $4, amount = $5, date = $6, updated_at = $7
             WHERE user_email = $1 AND id = $2
             RETURNING *`,
            [email, id, next.type, next.description, next.amount, next.date, next.updatedAt]
        );
        return mapTransaction(result.rows[0]);
    },
    deleteTransaction: async (email, id) => {
        const result = await pool.query("DELETE FROM transactions WHERE user_email = $1 AND id = $2", [email, id]);
        return result.rowCount > 0;
    },
};

const storage = pool ? databaseStorage : fileStorage;

const getUserItems = (store, email) => {
    const items = store[email];
    return Array.isArray(items) ? items : [];
};

const saveUserItems = (filePath, email, items) => {
    const store = readStore(filePath);
    store[email] = items;
    writeStore(filePath, store);
};

const removeUserItems = (filePath, email) => {
    const store = readStore(filePath);
    if (store[email]) {
        delete store[email];
        writeStore(filePath, store);
    }
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const isGmail = (email) => /^[^@\s]+@gmail\.com$/.test(email);
const isValidPassword = (password) => typeof password === "string" && password.length >= 6;
const createId = () => crypto.randomBytes(8).toString("hex");

const parseNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const parseDate = (value) => {
    if (!value) {
        return new Date().toISOString();
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString();
};

const sortByCreatedAtDesc = (items) => items.slice().sort((a, b) => {
    const dateA = a?.createdAt ? Date.parse(a.createdAt) : 0;
    const dateB = b?.createdAt ? Date.parse(b.createdAt) : 0;
    return dateB - dateA;
});

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return { salt, hash };
};

const verifyPassword = (password, salt, hash) => {
    const derived = crypto.scryptSync(password, salt, 64).toString("hex");
    const hashBuffer = Buffer.from(hash, "hex");
    const derivedBuffer = Buffer.from(derived, "hex");
    if (hashBuffer.length !== derivedBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(hashBuffer, derivedBuffer);
};

const parseCookies = (req) => {
    const header = req.headers.cookie;
    if (!header) {
        return {};
    }
    return header.split(";").reduce((acc, part) => {
        const [key, ...rest] = part.trim().split("=");
        acc[key] = decodeURIComponent(rest.join("="));
        return acc;
    }, {});
};

const getSessionEmail = async (req) => {
    const cookies = parseCookies(req);
    const token = cookies.session;
    if (!token) {
        return "";
    }
    const session = sessions.get(token);
    if (!session) {
        return "";
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
        sessions.delete(token);
        await storage.deleteSession(token);
        return "";
    }
    return session.email;
};

const requireAuth = async (req, res) => {
    const email = await getSessionEmail(req);
    if (!email) {
        sendJson(res, 401, { message: "Nao autorizado." });
        return "";
    }
    return email;
};

const createSession = async (res, email) => {
    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS).toISOString();
    await storage.saveSession(token, { email, createdAt: new Date().toISOString(), expiresAt });
    res.setHeader("Set-Cookie", `session=${token}; Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}; HttpOnly; SameSite=Lax; Path=/`);
};

const clearSession = async (req, res) => {
    const cookies = parseCookies(req);
    const token = cookies.session;
    if (token) {
        await storage.deleteSession(token);
    }
    res.setHeader("Set-Cookie", "session=; Max-Age=0; Path=/; SameSite=Lax; HttpOnly");
};

const sendJson = (res, status, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(body);
};

const parseJsonBody = (req) => new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
        data += chunk;
        if (data.length > 1_000_000) {
            req.destroy();
            reject(new Error("Payload too large"));
        }
    });
    req.on("end", () => {
        if (!data) {
            resolve({});
            return;
        }
        try {
            resolve(JSON.parse(data));
        } catch (error) {
            reject(error);
        }
    });
    req.on("error", reject);
});

const redirect = (res, location) => {
    res.writeHead(302, { Location: location });
    res.end();
};

const serveFile = (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const file = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(file);
};

const isProtectedPath = (pathname) => ["/dashboard.html", "/carteira.html", "/transacoes.html"].includes(pathname);
const isAuthPath = (pathname) => ["/login.html", "/register.html"].includes(pathname);

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === "/api/register" && req.method === "POST") {
        try {
            const { email, password } = await parseJsonBody(req);
            const normalizedEmail = normalizeEmail(email);

            if (!normalizedEmail || !password) {
                sendJson(res, 400, { message: "Preencha email e senha." });
                return;
            }

            if (!isGmail(normalizedEmail)) {
                sendJson(res, 400, { message: "Use um email @gmail.com." });
                return;
            }

            if (!isValidPassword(password)) {
                sendJson(res, 400, { message: "Senha precisa ter pelo menos 6 caracteres." });
                return;
            }

            const existingUser = await storage.findUser(normalizedEmail);
            if (existingUser) {
                sendJson(res, 409, { message: "Email ja cadastrado. Faca login." });
                return;
            }

            const { salt, hash } = hashPassword(password);
            await storage.createUser({
                email: normalizedEmail,
                salt,
                hash,
                createdAt: new Date().toISOString(),
            });
            sendJson(res, 201, { email: normalizedEmail, message: "Conta criada com sucesso! Faca login para entrar." });
        } catch {
            sendJson(res, 400, { message: "Dados invalidos." });
        }
        return;
    }

    if (pathname === "/api/login" && req.method === "POST") {
        try {
            const { email, password } = await parseJsonBody(req);
            const normalizedEmail = normalizeEmail(email);

            if (!normalizedEmail || !password) {
                sendJson(res, 400, { message: "Preencha email e senha." });
                return;
            }

            if (!isGmail(normalizedEmail)) {
                sendJson(res, 400, { message: "Use um email @gmail.com." });
                return;
            }

            const user = await storage.findUser(normalizedEmail);
            if (!user) {
                sendJson(res, 401, { message: "Conta nao encontrada. Cadastre-se." });
                return;
            }

            const valid = verifyPassword(password, user.salt, user.hash);
            if (!valid) {
                sendJson(res, 401, { message: "Senha incorreta." });
                return;
            }

            await createSession(res, normalizedEmail);
            sendJson(res, 200, { email: normalizedEmail });
        } catch {
            sendJson(res, 400, { message: "Dados invalidos." });
        }
        return;
    }

    if (pathname === "/api/logout" && req.method === "POST") {
        await clearSession(req, res);
        sendJson(res, 200, { message: "Logout realizado." });
        return;
    }

    if (pathname === "/api/me" && req.method === "GET") {
        const email = await getSessionEmail(req);
        if (!email) {
            sendJson(res, 401, { message: "Nao autorizado." });
            return;
        }
        sendJson(res, 200, { email });
        return;
    }

    if (pathname === "/api/users/me" && req.method === "GET") {
        const email = await requireAuth(req, res);
        if (!email) {
            return;
        }
        const user = await storage.findUser(email);
        if (!user) {
            sendJson(res, 404, { message: "Usuario nao encontrado." });
            return;
        }
        sendJson(res, 200, { email: user.email, createdAt: user.createdAt || null });
        return;
    }

    if (pathname === "/api/users/me" && req.method === "PUT") {
        const email = await requireAuth(req, res);
        if (!email) {
            return;
        }
        try {
            const { password } = await parseJsonBody(req);
            if (!password) {
                sendJson(res, 400, { message: "Informe a nova senha." });
                return;
            }
            if (!isValidPassword(password)) {
                sendJson(res, 400, { message: "Senha precisa ter pelo menos 6 caracteres." });
                return;
            }
            const { salt, hash } = hashPassword(password);
            const updated = await storage.updateUserPassword(email, salt, hash);
            if (!updated) {
                sendJson(res, 404, { message: "Usuario nao encontrado." });
                return;
            }
            sendJson(res, 200, { message: "Senha atualizada." });
        } catch {
            sendJson(res, 400, { message: "Dados invalidos." });
        }
        return;
    }

    if (pathname === "/api/users/me" && req.method === "DELETE") {
        const email = await requireAuth(req, res);
        if (!email) {
            return;
        }
        const deleted = await storage.deleteUser(email);
        if (!deleted) {
            sendJson(res, 404, { message: "Usuario nao encontrado." });
            return;
        }
        await clearSession(req, res);
        sendJson(res, 200, { message: "Conta removida." });
        return;
    }

    const investmentMatch = pathname.match(/^\/api\/investments(?:\/([^/]+))?\/?$/);
    if (investmentMatch) {
        const email = await requireAuth(req, res);
        if (!email) {
            return;
        }
        const id = investmentMatch[1];

        if (!id && req.method === "GET") {
            const items = await storage.listInvestments(email);
            sendJson(res, 200, { items });
            return;
        }

        if (!id && req.method === "POST") {
            try {
                const { type, name, quantity, value } = await parseJsonBody(req);
                if (!INVESTMENT_TYPES.has(type)) {
                    sendJson(res, 400, { message: "Tipo de investimento invalido." });
                    return;
                }
                if (!name || typeof name !== "string") {
                    sendJson(res, 400, { message: "Informe o nome do ativo." });
                    return;
                }
                let parsedQuantity = null;
                const requiresQuantity = type !== "renda-fixa";
                const quantityProvided = quantity !== undefined;
                // Optional quantities should be ignored when invalid; only validate strictly when needed.
                if (quantityProvided) {
                    const candidate = parseNumber(quantity);
                    if (candidate === null || candidate <= 0) {
                        if (requiresQuantity) {
                            sendJson(res, 400, { message: "Quantidade invalida." });
                            return;
                        }
                    } else {
                        parsedQuantity = candidate;
                    }
                }
                if (requiresQuantity && !quantityProvided) {
                    sendJson(res, 400, { message: "Informe a quantidade." });
                    return;
                }
                let parsedValue = null;
                if (value !== undefined) {
                    parsedValue = parseNumber(value);
                    if (parsedValue === null || parsedValue < 0) {
                        sendJson(res, 400, { message: "Valor invalido." });
                        return;
                    }
                }

                const item = {
                    id: createId(),
                    type,
                    name: name.trim(),
                    quantity: parsedQuantity,
                    value: parsedValue,
                    createdAt: new Date().toISOString(),
                };
                const created = await storage.createInvestment(email, item);
                sendJson(res, 201, { item: created });
            } catch {
                sendJson(res, 400, { message: "Dados invalidos." });
            }
            return;
        }

        if (!id) {
            sendJson(res, 405, { message: "Metodo nao permitido." });
            return;
        }

        const item = await storage.getInvestment(email, id);
        if (!item) {
            sendJson(res, 404, { message: "Investimento nao encontrado." });
            return;
        }

        if (req.method === "GET") {
            sendJson(res, 200, { item });
            return;
        }

        if (req.method === "PUT") {
            try {
                const payload = await parseJsonBody(req);
                const updates = {};

                if (payload.type !== undefined) {
                    if (!INVESTMENT_TYPES.has(payload.type)) {
                        sendJson(res, 400, { message: "Tipo de investimento invalido." });
                        return;
                    }
                    updates.type = payload.type;
                }

                if (payload.name !== undefined) {
                    if (!payload.name || typeof payload.name !== "string") {
                        sendJson(res, 400, { message: "Informe o nome do ativo." });
                        return;
                    }
                    updates.name = payload.name.trim();
                }

                if (payload.quantity !== undefined) {
                    const parsedQuantity = parseNumber(payload.quantity);
                    if (parsedQuantity === null || parsedQuantity <= 0) {
                        sendJson(res, 400, { message: "Quantidade invalida." });
                        return;
                    }
                    updates.quantity = parsedQuantity;
                }

                if (payload.value !== undefined) {
                    const parsedValue = parseNumber(payload.value);
                    if (parsedValue === null || parsedValue < 0) {
                        sendJson(res, 400, { message: "Valor invalido." });
                        return;
                    }
                    updates.value = parsedValue;
                }

                if (!Object.keys(updates).length) {
                    sendJson(res, 400, { message: "Nenhuma alteracao informada." });
                    return;
                }

                const updated = await storage.updateInvestment(email, id, updates);
                sendJson(res, 200, { item: updated });
            } catch {
                sendJson(res, 400, { message: "Dados invalidos." });
            }
            return;
        }

        if (req.method === "DELETE") {
            await storage.deleteInvestment(email, id);
            sendJson(res, 200, { message: "Investimento removido." });
            return;
        }

        sendJson(res, 405, { message: "Metodo nao permitido." });
        return;
    }

    const transactionMatch = pathname.match(/^\/api\/transactions(?:\/([^/]+))?\/?$/);
    if (transactionMatch) {
        const email = await requireAuth(req, res);
        if (!email) {
            return;
        }
        const id = transactionMatch[1];

        if (!id && req.method === "GET") {
            const items = await storage.listTransactions(email);
            sendJson(res, 200, { items });
            return;
        }

        if (!id && req.method === "POST") {
            try {
                const { type, description, amount, date } = await parseJsonBody(req);
                if (!TRANSACTION_TYPES.has(type)) {
                    sendJson(res, 400, { message: "Tipo de transacao invalido." });
                    return;
                }
                if (!description || typeof description !== "string") {
                    sendJson(res, 400, { message: "Informe a descricao." });
                    return;
                }
                const parsedAmount = parseNumber(amount);
                if (parsedAmount === null || parsedAmount <= 0) {
                    sendJson(res, 400, { message: "Valor invalido." });
                    return;
                }
                const parsedDate = parseDate(date);
                if (!parsedDate) {
                    sendJson(res, 400, { message: "Data invalida." });
                    return;
                }

                const item = {
                    id: createId(),
                    type,
                    description: description.trim(),
                    amount: parsedAmount,
                    date: parsedDate,
                    createdAt: new Date().toISOString(),
                };
                const created = await storage.createTransaction(email, item);
                sendJson(res, 201, { item: created });
            } catch {
                sendJson(res, 400, { message: "Dados invalidos." });
            }
            return;
        }

        if (!id) {
            sendJson(res, 405, { message: "Metodo nao permitido." });
            return;
        }

        const item = await storage.getTransaction(email, id);
        if (!item) {
            sendJson(res, 404, { message: "Transacao nao encontrada." });
            return;
        }

        if (req.method === "GET") {
            sendJson(res, 200, { item });
            return;
        }

        if (req.method === "PUT") {
            try {
                const payload = await parseJsonBody(req);
                const updates = {};

                if (payload.type !== undefined) {
                    if (!TRANSACTION_TYPES.has(payload.type)) {
                        sendJson(res, 400, { message: "Tipo de transacao invalido." });
                        return;
                    }
                    updates.type = payload.type;
                }

                if (payload.description !== undefined) {
                    if (!payload.description || typeof payload.description !== "string") {
                        sendJson(res, 400, { message: "Informe a descricao." });
                        return;
                    }
                    updates.description = payload.description.trim();
                }

                if (payload.amount !== undefined) {
                    const parsedAmount = parseNumber(payload.amount);
                    if (parsedAmount === null || parsedAmount <= 0) {
                        sendJson(res, 400, { message: "Valor invalido." });
                        return;
                    }
                    updates.amount = parsedAmount;
                }

                if (payload.date !== undefined) {
                    const parsedDate = parseDate(payload.date);
                    if (!parsedDate) {
                        sendJson(res, 400, { message: "Data invalida." });
                        return;
                    }
                    updates.date = parsedDate;
                }

                if (!Object.keys(updates).length) {
                    sendJson(res, 400, { message: "Nenhuma alteracao informada." });
                    return;
                }

                const updated = await storage.updateTransaction(email, id, updates);
                sendJson(res, 200, { item: updated });
            } catch {
                sendJson(res, 400, { message: "Dados invalidos." });
            }
            return;
        }

        if (req.method === "DELETE") {
            await storage.deleteTransaction(email, id);
            sendJson(res, 200, { message: "Transacao removida." });
            return;
        }

        sendJson(res, 405, { message: "Metodo nao permitido." });
        return;
    }

    if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { message: "Rota nao encontrada." });
        return;
    }

    if (pathname === "/") {
        redirect(res, "/login.html");
        return;
    }

    if (pathname === "/transacoes") {
        redirect(res, "/transacoes.html");
        return;
    }

    if (pathname === "/login") {
        redirect(res, "/login.html");
        return;
    }

    if (pathname === "/register") {
        redirect(res, "/register.html");
        return;
    }

    const currentEmail = await getSessionEmail(req);

    if (isProtectedPath(pathname) && !currentEmail) {
        redirect(res, "/login.html");
        return;
    }

    const safePath = pathname.replace(/^\/+/, "");
    const normalizedSafePath = safePath.replace(/\\/g, "/").toLowerCase();
    if (
        normalizedSafePath === "server.js"
        || normalizedSafePath === "package.json"
        || normalizedSafePath === "package-lock.json"
        || normalizedSafePath.startsWith("data/")
    ) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    const filePath = path.resolve(ROOT_DIR, safePath);
    if (!filePath.startsWith(ROOT_DIR)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404);
        res.end("Not Found");
        return;
    }

    try {
        serveFile(res, filePath);
    } catch {
        res.writeHead(500);
        res.end("Server Error");
    }
});

const startServer = async () => {
    await initDatabase();
    await loadSessions();
    server.listen(PORT, () => {
        console.log(`Servidor rodando em http://localhost:${PORT}`);
    });
};

startServer().catch((error) => {
    console.error("Nao foi possivel iniciar o servidor.", error);
    process.exit(1);
});
