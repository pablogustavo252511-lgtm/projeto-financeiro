const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const INVESTMENTS_FILE = path.join(DATA_DIR, "investments.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");

const sessions = new Map();

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

const getSessionEmail = (req) => {
    const cookies = parseCookies(req);
    const token = cookies.session;
    if (!token) {
        return "";
    }
    const session = sessions.get(token);
    return session ? session.email : "";
};

const requireAuth = (req, res) => {
    const email = getSessionEmail(req);
    if (!email) {
        sendJson(res, 401, { message: "Nao autorizado." });
        return "";
    }
    return email;
};

const createSession = (res, email) => {
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { email, createdAt: Date.now() });
    res.setHeader("Set-Cookie", `session=${token}; HttpOnly; SameSite=Lax; Path=/`);
};

const clearSession = (req, res) => {
    const cookies = parseCookies(req);
    const token = cookies.session;
    if (token) {
        sessions.delete(token);
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

            const users = readUsers();
            const exists = users.some((user) => user.email === normalizedEmail);
            if (exists) {
                sendJson(res, 409, { message: "Email ja cadastrado. Faca login." });
                return;
            }

            const { salt, hash } = hashPassword(password);
            users.push({
                email: normalizedEmail,
                salt,
                hash,
                createdAt: new Date().toISOString(),
            });
            writeUsers(users);
            sendJson(res, 201, { message: "Conta criada com sucesso!" });
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

            const users = readUsers();
            const user = users.find((item) => item.email === normalizedEmail);
            if (!user) {
                sendJson(res, 401, { message: "Conta nao encontrada. Cadastre-se." });
                return;
            }

            const valid = verifyPassword(password, user.salt, user.hash);
            if (!valid) {
                sendJson(res, 401, { message: "Senha incorreta." });
                return;
            }

            createSession(res, normalizedEmail);
            sendJson(res, 200, { email: normalizedEmail });
        } catch {
            sendJson(res, 400, { message: "Dados invalidos." });
        }
        return;
    }

    if (pathname === "/api/logout" && req.method === "POST") {
        clearSession(req, res);
        sendJson(res, 200, { message: "Logout realizado." });
        return;
    }

    if (pathname === "/api/me" && req.method === "GET") {
        const email = getSessionEmail(req);
        if (!email) {
            sendJson(res, 401, { message: "Nao autorizado." });
            return;
        }
        sendJson(res, 200, { email });
        return;
    }

    if (pathname === "/api/users/me" && req.method === "GET") {
        const email = requireAuth(req, res);
        if (!email) {
            return;
        }
        const users = readUsers();
        const user = users.find((item) => item.email === email);
        if (!user) {
            sendJson(res, 404, { message: "Usuario nao encontrado." });
            return;
        }
        sendJson(res, 200, { email: user.email, createdAt: user.createdAt || null });
        return;
    }

    if (pathname === "/api/users/me" && req.method === "PUT") {
        const email = requireAuth(req, res);
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
            const users = readUsers();
            const index = users.findIndex((user) => user.email === email);
            if (index === -1) {
                sendJson(res, 404, { message: "Usuario nao encontrado." });
                return;
            }
            const { salt, hash } = hashPassword(password);
            users[index] = { ...users[index], salt, hash };
            writeUsers(users);
            sendJson(res, 200, { message: "Senha atualizada." });
        } catch {
            sendJson(res, 400, { message: "Dados invalidos." });
        }
        return;
    }

    if (pathname === "/api/users/me" && req.method === "DELETE") {
        const email = requireAuth(req, res);
        if (!email) {
            return;
        }
        const users = readUsers();
        const filtered = users.filter((user) => user.email !== email);
        if (filtered.length === users.length) {
            sendJson(res, 404, { message: "Usuario nao encontrado." });
            return;
        }
        writeUsers(filtered);
        removeUserItems(INVESTMENTS_FILE, email);
        removeUserItems(TRANSACTIONS_FILE, email);
        clearSession(req, res);
        sendJson(res, 200, { message: "Conta removida." });
        return;
    }

    const investmentMatch = pathname.match(/^\/api\/investments(?:\/([^/]+))?\/?$/);
    if (investmentMatch) {
        const email = requireAuth(req, res);
        if (!email) {
            return;
        }
        const id = investmentMatch[1];

        if (!id && req.method === "GET") {
            const store = readStore(INVESTMENTS_FILE);
            const items = getUserItems(store, email);
            sendJson(res, 200, { items: sortByCreatedAtDesc(items) });
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

                const store = readStore(INVESTMENTS_FILE);
                const items = getUserItems(store, email);
                const item = {
                    id: createId(),
                    type,
                    name: name.trim(),
                    quantity: parsedQuantity,
                    value: parsedValue,
                    createdAt: new Date().toISOString(),
                };
                items.push(item);
                store[email] = items;
                writeStore(INVESTMENTS_FILE, store);
                sendJson(res, 201, { item });
            } catch {
                sendJson(res, 400, { message: "Dados invalidos." });
            }
            return;
        }

        if (!id) {
            sendJson(res, 405, { message: "Metodo nao permitido." });
            return;
        }

        const store = readStore(INVESTMENTS_FILE);
        const items = getUserItems(store, email);
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) {
            sendJson(res, 404, { message: "Investimento nao encontrado." });
            return;
        }

        if (req.method === "GET") {
            sendJson(res, 200, { item: items[index] });
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

                const updated = {
                    ...items[index],
                    ...updates,
                    updatedAt: new Date().toISOString(),
                };
                items[index] = updated;
                store[email] = items;
                writeStore(INVESTMENTS_FILE, store);
                sendJson(res, 200, { item: updated });
            } catch {
                sendJson(res, 400, { message: "Dados invalidos." });
            }
            return;
        }

        if (req.method === "DELETE") {
            items.splice(index, 1);
            store[email] = items;
            writeStore(INVESTMENTS_FILE, store);
            sendJson(res, 200, { message: "Investimento removido." });
            return;
        }

        sendJson(res, 405, { message: "Metodo nao permitido." });
        return;
    }

    const transactionMatch = pathname.match(/^\/api\/transactions(?:\/([^/]+))?\/?$/);
    if (transactionMatch) {
        const email = requireAuth(req, res);
        if (!email) {
            return;
        }
        const id = transactionMatch[1];

        if (!id && req.method === "GET") {
            const store = readStore(TRANSACTIONS_FILE);
            const items = getUserItems(store, email);
            sendJson(res, 200, { items: sortByCreatedAtDesc(items) });
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

                const store = readStore(TRANSACTIONS_FILE);
                const items = getUserItems(store, email);
                const item = {
                    id: createId(),
                    type,
                    description: description.trim(),
                    amount: parsedAmount,
                    date: parsedDate,
                    createdAt: new Date().toISOString(),
                };
                items.push(item);
                store[email] = items;
                writeStore(TRANSACTIONS_FILE, store);
                sendJson(res, 201, { item });
            } catch {
                sendJson(res, 400, { message: "Dados invalidos." });
            }
            return;
        }

        if (!id) {
            sendJson(res, 405, { message: "Metodo nao permitido." });
            return;
        }

        const store = readStore(TRANSACTIONS_FILE);
        const items = getUserItems(store, email);
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) {
            sendJson(res, 404, { message: "Transacao nao encontrada." });
            return;
        }

        if (req.method === "GET") {
            sendJson(res, 200, { item: items[index] });
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

                const updated = {
                    ...items[index],
                    ...updates,
                    updatedAt: new Date().toISOString(),
                };
                items[index] = updated;
                store[email] = items;
                writeStore(TRANSACTIONS_FILE, store);
                sendJson(res, 200, { item: updated });
            } catch {
                sendJson(res, 400, { message: "Dados invalidos." });
            }
            return;
        }

        if (req.method === "DELETE") {
            items.splice(index, 1);
            store[email] = items;
            writeStore(TRANSACTIONS_FILE, store);
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
        const email = getSessionEmail(req);
        redirect(res, email ? "/dashboard.html" : "/login.html");
        return;
    }

    if (pathname === "/transacoes") {
        redirect(res, "/transacoes.html");
        return;
    }

    if (isProtectedPath(pathname) && !getSessionEmail(req)) {
        redirect(res, "/login.html");
        return;
    }

    if (isAuthPath(pathname) && getSessionEmail(req)) {
        redirect(res, "/dashboard.html");
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

server.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});
