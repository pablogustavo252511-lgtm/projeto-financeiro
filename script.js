const normalizeEmail = (value) => value.trim().toLowerCase();
const isGmail = (email) => /^[^@\s]+@gmail\.com$/.test(email);

const setMessage = (element, message, type) => {
    if (!element) {
        return;
    }
    element.textContent = message;
    if (type) {
        element.dataset.type = type;
        return;
    }
    element.removeAttribute("data-type");
};

const requestJson = async (url, options = {}) => {
    const { method = "GET", payload } = options;
    const fetchOptions = {
        method,
        credentials: "same-origin",
        headers: {},
    };

    if (payload !== undefined) {
        fetchOptions.headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(url, fetchOptions);

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return { ok: response.ok, data, status: response.status };
};

const postJson = async (url, payload) => requestJson(url, { method: "POST", payload });
const getJson = async (url) => requestJson(url);

const handleLogin = (form) => {
    const emailInput = form.querySelector('input[name="email"]');
    const passwordInput = form.querySelector('input[name="password"]');
    const message = form.querySelector(".form-message");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = normalizeEmail(emailInput.value);
        const password = passwordInput.value;

        if (!email || !password) {
            setMessage(message, "Preencha email e senha.", "error");
            return;
        }

        if (!isGmail(email)) {
            setMessage(message, "Use um email @gmail.com.", "error");
            return;
        }

        try {
            const result = await postJson("/api/login", { email, password });
            if (!result.ok) {
                setMessage(message, result.data?.message || "Email ou senha invalidos.", "error");
                return;
            }

            setMessage(message, "Login realizado com sucesso!", "success");
            setTimeout(() => {
                window.location.href = "dashboard.html";
            }, 500);
        } catch {
            setMessage(message, "Nao foi possivel conectar ao servidor.", "error");
        }
    });
};

const handleRegister = (form) => {
    const emailInput = form.querySelector('input[name="email"]');
    const passwordInput = form.querySelector('input[name="password"]');
    const message = form.querySelector(".form-message");

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = normalizeEmail(emailInput.value);
        const password = passwordInput.value;

        if (!email || !password) {
            setMessage(message, "Preencha email e senha.", "error");
            return;
        }

        if (!isGmail(email)) {
            setMessage(message, "Use um email @gmail.com.", "error");
            return;
        }

        if (password.length < 6) {
            setMessage(message, "Use uma senha com pelo menos 6 caracteres.", "error");
            return;
        }

        try {
            const result = await postJson("/api/register", { email, password });
            if (!result.ok) {
                setMessage(message, result.data?.message || "Nao foi possivel criar a conta.", "error");
                return;
            }

            setMessage(message, "Conta criada com sucesso! Faca login para entrar.", "success");
            form.reset();

            setTimeout(() => {
                window.location.href = "login.html";
            }, 1000);
        } catch {
            setMessage(message, "Nao foi possivel conectar ao servidor.", "error");
        }
    });
};

const loginForm = document.querySelector('[data-form="login"]');
if (loginForm) {
    handleLogin(loginForm);
}

const registerForm = document.querySelector('[data-form="register"]');
if (registerForm) {
    handleRegister(registerForm);
}

document.querySelectorAll(".sidebar-nav .tab").forEach((link) => {
    if (link.textContent.trim().toLowerCase() === "transacoes") {
        link.setAttribute("href", "/transacoes.html");
    }
    if (link.textContent.trim().toLowerCase() === "relatorios") {
        link.setAttribute("href", "/relatorios.html");
    }
    if (link.textContent.trim().toLowerCase() === "conta") {
        link.setAttribute("href", "/conta.html");
    }
});

const protectedPage = document.querySelector("[data-page]");
if (protectedPage) {
    (async () => {
        const result = await getJson("/api/me");
        if (!result.ok || !result.data?.email) {
            window.location.href = "login.html";
            return;
        }

        const emailTarget = document.querySelector("[data-user-email]");
        if (emailTarget) {
            emailTarget.textContent = result.data.email;
        }
    })();

    const logoutButton = document.querySelector('[data-action="logout"]');
    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            await postJson("/api/logout", {});
            window.location.href = "login.html";
        });
    }
}

const formatCurrency = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return "R$ 0,00";
    }
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(number);
};

const formatDate = (value) => {
    if (!value) {
        return "data indefinida";
    }
    const dateOnly = String(value).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        const [year, month, day] = dateOnly.split("-");
        return `${day}/${month}/${year}`;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return "data invalida";
    }
    return parsed.toLocaleDateString("pt-BR");
};

const getTransactionDirection = (type) => {
    if (["venda", "dividendo", "deposito"].includes(type)) {
        return "income";
    }
    return "expense";
};

const getInvestmentTotal = (item) => {
    const value = Number(item.value) || 0;
    const quantity = Number(item.quantity);
    if (Number.isFinite(quantity) && quantity > 0) {
        return quantity * value;
    }
    return value;
};

const summarizeInvestments = (items) => {
    const summary = {
        patrimony: 0,
        assetsCount: items.length,
        earnings: 0,
        byType: {
            acoes: { count: 0, total: 0 },
            "renda-fixa": { count: 0, total: 0 },
            cripto: { count: 0, total: 0 },
        },
    };

    items.forEach((item) => {
        const total = getInvestmentTotal(item);
        summary.patrimony += total;
        summary.earnings += Number(item.earning) || 0;
        if (summary.byType[item.type]) {
            summary.byType[item.type].count += 1;
            summary.byType[item.type].total += total;
        }
    });

    return summary;
};

const summarizeTransactions = (items) => items.reduce((summary, item) => {
    const amount = Number(item.amount) || 0;
    if (getTransactionDirection(item.type) === "income") {
        summary.income += amount;
    } else {
        summary.expense += amount;
    }
    if (item.type === "dividendo") {
        summary.earnings += amount;
    }
    return summary;
}, { income: 0, expense: 0, earnings: 0 });

const loadFinanceData = async () => {
    const [investmentResult, transactionResult] = await Promise.all([
        getJson("/api/investments"),
        getJson("/api/transactions"),
    ]);

    return {
        investments: investmentResult.ok && Array.isArray(investmentResult.data?.items) ? investmentResult.data.items : [],
        transactions: transactionResult.ok && Array.isArray(transactionResult.data?.items) ? transactionResult.data.items : [],
        investmentError: !investmentResult.ok ? investmentResult.data?.message : "",
        transactionError: !transactionResult.ok ? transactionResult.data?.message : "",
    };
};

const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) {
        element.textContent = value;
    }
};

const renderPosition = (type, position) => {
    const countText = position.count === 1 ? "1 ativo" : `${position.count} ativos`;
    return position.count ? `${countText} | ${formatCurrency(position.total)}` : "sem ativos";
};

const normalizeAssetType = (type) => {
    const map = {
        acoes: "acoes",
        "renda-fixa": "renda fixa",
        cripto: "criptomoedas",
        fiis: "fiis",
        etf: "etf",
        outros: "outros",
    };
    return map[type] || type || "outros";
};

const getInvestmentCurrentValue = (item) => getInvestmentTotal(item) + (Number(item.earning) || 0);

const formatPercent = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return "0%";
    }
    return `${number >= 0 ? "+" : ""}${number.toFixed(2).replace(".", ",")}%`;
};

const getDateOnly = (value) => String(value || "").slice(0, 10);

const isDateInRange = (value, start, end) => {
    const date = getDateOnly(value);
    if (!date) {
        return true;
    }
    if (start && date < start) {
        return false;
    }
    if (end && date > end) {
        return false;
    }
    return true;
};

const setTableEmpty = (tbody, colspan, message) => {
    tbody.innerHTML = "";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = colspan;
    cell.textContent = message;
    row.appendChild(cell);
    tbody.appendChild(row);
};

const initAccountPage = () => {
    const page = document.querySelector('[data-page="conta"]');
    if (!page) {
        return;
    }

    const profileForm = document.querySelector('[data-form="account-profile"]');
    const passwordForm = document.querySelector('[data-form="account-password"]');
    const preferencesForm = document.querySelector('[data-form="account-preferences"]');
    const editButton = document.querySelector('[data-action="edit-account"]');
    const saveButton = document.querySelector('[data-action="save-account"]');
    const cancelButton = document.querySelector('[data-action="cancel-account"]');
    const profileMessage = document.querySelector('[data-message="account-profile"]');
    const passwordMessage = document.querySelector('[data-message="account-password"]');
    const preferencesMessage = document.querySelector('[data-message="account-preferences"]');
    const actionsMessage = document.querySelector('[data-message="account-actions"]');

    if (!profileForm || !passwordForm || !editButton || !saveButton || !cancelButton) {
        return;
    }

    let accountData = null;

    const profileInputs = Array.from(profileForm.querySelectorAll("input"));
    const profileName = profileForm.querySelector('[name="name"]');
    const profileEmail = profileForm.querySelector('[name="email"]');
    const profilePhone = profileForm.querySelector('[name="phone"]');
    const profileCpf = profileForm.querySelector('[name="cpf"]');
    const profileBirthDate = profileForm.querySelector('[name="birthDate"]');
    const prefCurrency = preferencesForm?.querySelector('[name="currency"]');
    const prefTheme = preferencesForm?.querySelector('[name="theme"]');
    const prefEmailNotifications = preferencesForm?.querySelector('[name="emailNotifications"]');
    const prefShowFinancialValues = preferencesForm?.querySelector('[name="showFinancialValues"]');
    const currentPasswordInput = passwordForm.querySelector('[name="currentPassword"]');
    const newPasswordInput = passwordForm.querySelector('[name="newPassword"]');
    const confirmPasswordInput = passwordForm.querySelector('[name="confirmPassword"]');

    const setProfileEnabled = (enabled) => {
        profileInputs.forEach((input) => {
            input.disabled = !enabled;
        });
        editButton.hidden = enabled;
        saveButton.hidden = !enabled;
        cancelButton.hidden = !enabled;
    };

    const fillAccount = (data) => {
        accountData = data;
        const user = data.user || {};
        profileName.value = user.name || "";
        profileEmail.value = user.email || "";
        profilePhone.value = user.phone || "";
        profileCpf.value = user.cpf || "";
        profileBirthDate.value = user.birthDate || "";

        if (preferencesForm) {
            prefCurrency.value = user.currency || "BRL";
            prefTheme.value = user.theme || "dark";
            prefEmailNotifications.checked = user.emailNotifications !== false;
            prefShowFinancialValues.checked = user.showFinancialValues !== false;
        }

        setText('[data-account="name"]', user.name || "sem nome");
        setText('[data-account="email"]', user.email || "-");
        setText('[data-account-summary="created-at"]', formatDate(user.createdAt));
        setText('[data-account-summary="last-access"]', user.lastAccess ? formatDate(user.lastAccess) : "primeiro acesso");
        setText('[data-account-summary="investments-count"]', data.summary?.investmentsCount ?? 0);
        setText('[data-account-summary="transactions-count"]', data.summary?.transactionsCount ?? 0);
        setText('[data-account-summary="patrimony"]', formatCurrency(data.summary?.patrimony || 0));

        const emailTarget = document.querySelector("[data-user-email]");
        if (emailTarget && user.email) {
            emailTarget.textContent = user.email;
        }
    };

    const loadAccount = async () => {
        const result = await getJson("/api/account");
        if (!result.ok) {
            setMessage(profileMessage, result.data?.message || "Nao foi possivel carregar a conta.", "error");
            return;
        }
        fillAccount(result.data);
        setProfileEnabled(false);
    };

    editButton.addEventListener("click", () => {
        setMessage(profileMessage, "");
        setProfileEnabled(true);
    });

    cancelButton.addEventListener("click", () => {
        if (accountData) {
            fillAccount(accountData);
        }
        setMessage(profileMessage, "");
        setProfileEnabled(false);
    });

    profileForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = {
            name: profileName.value.trim(),
            email: normalizeEmail(profileEmail.value),
            phone: profilePhone.value.trim(),
            cpf: profileCpf.value.trim(),
            birthDate: profileBirthDate.value,
        };

        if (!payload.name) {
            setMessage(profileMessage, "Nome obrigatorio.", "error");
            return;
        }
        if (!payload.email) {
            setMessage(profileMessage, "Email obrigatorio.", "error");
            return;
        }

        const result = await requestJson("/api/account", { method: "PUT", payload });
        if (!result.ok) {
            setMessage(profileMessage, result.data?.message || "Nao foi possivel salvar os dados.", "error");
            return;
        }
        setMessage(profileMessage, "Dados atualizados.", "success");
        await loadAccount();
    });

    passwordForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const currentPassword = currentPasswordInput.value;
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (newPassword.length < 6) {
            setMessage(passwordMessage, "Nova senha precisa ter pelo menos 6 caracteres.", "error");
            return;
        }
        if (newPassword !== confirmPassword) {
            setMessage(passwordMessage, "Confirmacao diferente da nova senha.", "error");
            return;
        }

        const result = await requestJson("/api/account/password", {
            method: "PUT",
            payload: { currentPassword, newPassword },
        });
        if (!result.ok) {
            setMessage(passwordMessage, result.data?.message || "Nao foi possivel alterar a senha.", "error");
            return;
        }
        passwordForm.reset();
        setMessage(passwordMessage, "Senha atualizada.", "success");
    });

    preferencesForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const result = await requestJson("/api/account/preferences", {
            method: "PUT",
            payload: {
                emailNotifications: prefEmailNotifications.checked,
                showFinancialValues: prefShowFinancialValues.checked,
            },
        });
        if (!result.ok) {
            setMessage(preferencesMessage, result.data?.message || "Nao foi possivel salvar preferencias.", "error");
            return;
        }
        setMessage(preferencesMessage, "Preferencias atualizadas.", "success");
        await loadAccount();
    });

    document.querySelector('[data-action="account-logout"]')?.addEventListener("click", async () => {
        await postJson("/api/logout", {});
        window.location.href = "login.html";
    });

    document.querySelector('[data-action="export-account"]')?.addEventListener("click", async () => {
        const result = await getJson("/api/account/export");
        if (!result.ok) {
            setMessage(actionsMessage, result.data?.message || "Nao foi possivel exportar dados.", "error");
            return;
        }
        const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "dados-da-conta.json";
        link.click();
        URL.revokeObjectURL(url);
        setMessage(actionsMessage, "Dados exportados.", "success");
    });

    document.querySelector('[data-action="delete-account"]')?.addEventListener("click", async () => {
        const confirmed = window.confirm("Excluir sua conta e todos os dados financeiros?");
        if (!confirmed) {
            return;
        }
        const result = await requestJson("/api/users/me", { method: "DELETE" });
        if (!result.ok) {
            setMessage(actionsMessage, result.data?.message || "Nao foi possivel excluir a conta.", "error");
            return;
        }
        window.location.href = "login.html";
    });

    loadAccount();
};

initAccountPage();

const initReportsPage = () => {
    const page = document.querySelector('[data-page="relatorios"]');
    if (!page) {
        return;
    }

    const reportFilterForm = document.querySelector('[data-form="report-filters"]');
    const movementFilterForm = document.querySelector('[data-form="movement-filters"]');
    const rentabilityTable = document.querySelector('[data-report="rentability-table"]');
    const movementTable = document.querySelector('[data-report="movement-table"]');
    const sortSelect = document.querySelector('[data-report="rentability-sort"]');
    const pieChart = document.querySelector('[data-report="pie-chart"]');
    const distributionLegend = document.querySelector('[data-report="distribution-legend"]');
    const insights = document.querySelector('[data-report="insights"]');
    const lineChart = document.querySelector('[data-report="line-chart"]');
    const lineArea = document.querySelector('[data-report="line-area"]');

    if (!reportFilterForm || !movementFilterForm || !rentabilityTable || !movementTable || !sortSelect) {
        return;
    }

    let investments = [];
    let transactions = [];
    const colors = ["#6fd3ff", "#76ffc9", "#f7d774", "#ff9f7a", "#c4a5ff", "#f5f7ff"];

    const getReportFilters = () => ({
        start: reportFilterForm.querySelector("#report-start")?.value || "",
        end: reportFilterForm.querySelector("#report-end")?.value || "",
        assetType: reportFilterForm.querySelector("#report-asset-type")?.value || "",
    });

    const getMovementFilters = () => ({
        type: movementFilterForm.querySelector("#movement-type")?.value || "",
        date: movementFilterForm.querySelector("#movement-date")?.value || "",
        min: movementFilterForm.querySelector("#movement-min")?.value || "",
        max: movementFilterForm.querySelector("#movement-max")?.value || "",
    });

    const getFilteredInvestments = () => {
        const filters = getReportFilters();
        return investments.filter((item) => {
            const matchesType = !filters.assetType || item.type === filters.assetType;
            const matchesDate = isDateInRange(item.createdAt, filters.start, filters.end);
            return matchesType && matchesDate;
        });
    };

    const getFilteredMovements = () => {
        const filters = getMovementFilters();
        return transactions.filter((item) => {
            const amount = Number(item.amount) || 0;
            const matchesType = !filters.type || item.type === filters.type;
            const matchesDate = !filters.date || getDateOnly(item.date) === filters.date;
            const matchesMin = filters.min === "" || amount >= Number(filters.min);
            const matchesMax = filters.max === "" || amount <= Number(filters.max);
            return matchesType && matchesDate && matchesMin && matchesMax;
        });
    };

    const renderReportCards = (items) => {
        const invested = items.reduce((total, item) => total + getInvestmentTotal(item), 0);
        const current = items.reduce((total, item) => total + getInvestmentCurrentValue(item), 0);
        const netProfit = current - invested;
        const profit = Math.max(netProfit, 0);
        const loss = Math.max(-netProfit, 0);
        const profitPercent = invested > 0 ? (profit / invested) * 100 : 0;
        const lossPercent = invested > 0 ? (loss / invested) * 100 : 0;
        const dividends = transactions
            .filter((item) => item.type === "dividendo" && isDateInRange(item.date, getReportFilters().start, getReportFilters().end))
            .reduce((total, item) => total + (Number(item.amount) || 0), 0);

        setText('[data-report="patrimony"]', formatCurrency(current));
        setText('[data-report="profit"]', formatCurrency(profit));
        setText('[data-report="profit-percent"]', formatPercent(profitPercent));
        setText('[data-report="loss"]', formatCurrency(loss));
        setText('[data-report="loss-percent"]', loss > 0 ? `-${lossPercent.toFixed(2).replace(".", ",")}%` : "0%");
        setText('[data-report="invested"]', formatCurrency(invested));
        setText('[data-report="dividends"]', formatCurrency(dividends));
    };

    const renderLineChart = (items) => {
        const current = items.reduce((total, item) => total + getInvestmentCurrentValue(item), 0);
        const values = Array.from({ length: 12 }, (_, index) => {
            const factor = items.length ? 0.64 + (index * 0.036) : 0;
            return Math.max(0, current * factor);
        });
        const max = Math.max(...values, 1);
        const points = values.map((value, index) => {
            const x = 24 + index * (592 / 11);
            const y = 206 - ((value / max) * 160);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });

        if (lineChart) {
            lineChart.setAttribute("points", points.join(" "));
        }
        if (lineArea) {
            lineArea.setAttribute("d", `M24,206 L${points.join(" L")} L616,206 Z`);
        }

        const first = values[0] || 0;
        const last = values[values.length - 1] || 0;
        const monthly = values[values.length - 2] ? ((last - values[values.length - 2]) / values[values.length - 2]) * 100 : 0;
        const yearly = first ? ((last - first) / first) * 100 : 0;
        setText('[data-report="monthly-growth"]', formatPercent(monthly));
        setText('[data-report="yearly-growth"]', formatPercent(yearly));
    };

    const renderDistribution = (items) => {
        const totals = {};
        items.forEach((item) => {
            const label = normalizeAssetType(item.type);
            totals[label] = (totals[label] || 0) + getInvestmentCurrentValue(item);
        });

        const entries = Object.entries(totals).filter(([, value]) => value > 0);
        const total = entries.reduce((sum, [, value]) => sum + value, 0);

        if (pieChart) {
            if (!entries.length) {
                pieChart.style.background = "conic-gradient(rgba(255,255,255,0.12) 0 100%)";
            } else {
                let cursor = 0;
                const gradient = entries.map(([label, value], index) => {
                    const start = cursor;
                    const percent = (value / total) * 100;
                    cursor += percent;
                    return `${colors[index % colors.length]} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
                }).join(", ");
                pieChart.style.background = `conic-gradient(${gradient})`;
            }
        }

        if (distributionLegend) {
            distributionLegend.innerHTML = "";
            if (!entries.length) {
                const item = document.createElement("div");
                item.className = "legend-item";
                item.textContent = "sem ativos cadastrados";
                distributionLegend.appendChild(item);
                return;
            }
            entries.forEach(([label, value], index) => {
                const item = document.createElement("div");
                item.className = "legend-item";
                const swatch = document.createElement("span");
                swatch.className = "legend-swatch";
                swatch.style.background = colors[index % colors.length];
                const text = document.createElement("span");
                text.textContent = `${label} ${((value / total) * 100).toFixed(0)}%`;
                item.append(swatch, text);
                distributionLegend.appendChild(item);
            });
        }
    };

    const renderRentabilityTable = (items) => {
        const rows = items.map((item) => {
            const invested = getInvestmentTotal(item);
            const current = getInvestmentCurrentValue(item);
            const profit = current - invested;
            const rentability = invested > 0 ? (profit / invested) * 100 : 0;
            return { item, invested, current, profit, rentability };
        });

        const sortBy = sortSelect.value;
        rows.sort((a, b) => {
            if (sortBy === "profit") {
                return b.profit - a.profit;
            }
            if (sortBy === "invested") {
                return b.invested - a.invested;
            }
            return b.rentability - a.rentability;
        });

        if (!rows.length) {
            setTableEmpty(rentabilityTable, 5, "Nenhum ativo encontrado.");
            return;
        }

        rentabilityTable.innerHTML = "";
        rows.forEach((row) => {
            const tr = document.createElement("tr");
            const profitClass = row.profit >= 0 ? "positive-value" : "negative-value";
            tr.innerHTML = `
                <td>${row.item.name}</td>
                <td>${formatCurrency(row.invested)}</td>
                <td>${formatCurrency(row.current)}</td>
                <td class="${profitClass}">${formatCurrency(row.profit)}</td>
                <td class="${profitClass}">${formatPercent(row.rentability)}</td>
            `;
            rentabilityTable.appendChild(tr);
        });
    };

    const renderMovementTable = (items) => {
        if (!items.length) {
            setTableEmpty(movementTable, 4, "Nenhuma movimentacao encontrada.");
            return;
        }

        movementTable.innerHTML = "";
        items.forEach((item) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${item.type}</td>
                <td>${item.description}</td>
                <td>${formatCurrency(item.amount)}</td>
                <td>${formatDate(item.date)}</td>
            `;
            movementTable.appendChild(tr);
        });
    };

    const renderInsights = (items) => {
        if (!insights) {
            return;
        }

        const invested = items.reduce((total, item) => total + getInvestmentTotal(item), 0);
        const current = items.reduce((total, item) => total + getInvestmentCurrentValue(item), 0);
        const profit = current - invested;
        const growth = invested > 0 ? (profit / invested) * 100 : 0;
        const dividends = transactions.filter((item) => item.type === "dividendo").reduce((total, item) => total + (Number(item.amount) || 0), 0);
        const largest = items.reduce((max, item) => Math.max(max, getInvestmentCurrentValue(item)), 0);
        const largestPercent = current > 0 ? (largest / current) * 100 : 0;
        const typeTotals = {};
        items.forEach((item) => {
            const label = normalizeAssetType(item.type);
            typeTotals[label] = (typeTotals[label] || 0) + getInvestmentCurrentValue(item);
        });
        const dominant = Object.entries(typeTotals).sort((a, b) => b[1] - a[1])[0]?.[0] || "ativos";

        const messages = [
            `Sua carteira cresceu ${formatPercent(growth)} no periodo selecionado.`,
            `Voce recebeu ${formatCurrency(dividends)} em dividendos.`,
            `Seu maior ativo representa ${largestPercent.toFixed(0)}% da carteira.`,
            `Sua carteira esta concentrada em ${dominant}.`,
        ];

        insights.innerHTML = "";
        messages.forEach((message) => {
            const item = document.createElement("div");
            item.className = "insight-item";
            item.textContent = message;
            insights.appendChild(item);
        });
    };

    const renderReports = () => {
        const filteredInvestments = getFilteredInvestments();
        renderReportCards(filteredInvestments);
        renderLineChart(filteredInvestments);
        renderDistribution(filteredInvestments);
        renderRentabilityTable(filteredInvestments);
        renderMovementTable(getFilteredMovements());
        renderInsights(filteredInvestments);
    };

    reportFilterForm.addEventListener("submit", (event) => {
        event.preventDefault();
        renderReports();
    });

    movementFilterForm.addEventListener("submit", (event) => {
        event.preventDefault();
        renderMovementTable(getFilteredMovements());
    });

    sortSelect.addEventListener("change", () => {
        renderRentabilityTable(getFilteredInvestments());
    });

    document.querySelector('[data-action="clear-report-filters"]')?.addEventListener("click", () => {
        reportFilterForm.reset();
        renderReports();
    });

    document.querySelector('[data-action="clear-movement-filters"]')?.addEventListener("click", () => {
        movementFilterForm.reset();
        renderMovementTable(getFilteredMovements());
    });

    document.querySelector('[data-action="export-report-pdf"]')?.addEventListener("click", () => {
        window.print();
    });

    (async () => {
        const data = await loadFinanceData();
        investments = data.investments;
        transactions = data.transactions;
        renderReports();
    })();
};

initReportsPage();

const initDashboardSummary = () => {
    const page = document.querySelector('[data-page="dashboard"]');
    if (!page) {
        return;
    }

    const recentMovements = document.querySelector('[data-dashboard="recent-movements"]');

    const renderRecentMovements = (transactions) => {
        if (!recentMovements) {
            return;
        }
        recentMovements.innerHTML = "";

        const recent = transactions.slice(0, 3);
        if (!recent.length) {
            const empty = document.createElement("div");
            empty.className = "panel-item";
            empty.innerHTML = '<p class="panel-title">sem movimentos</p><p class="panel-detail">adicione uma transacao</p>';
            recentMovements.appendChild(empty);
            return;
        }

        const fragment = document.createDocumentFragment();
        recent.forEach((item) => {
            const movement = document.createElement("div");
            movement.className = "panel-item";
            const title = document.createElement("p");
            title.className = "panel-title";
            title.textContent = item.type;
            const detail = document.createElement("p");
            detail.className = "panel-detail";
            detail.textContent = `${formatCurrency(item.amount)} | ${formatDate(item.date)}`;
            movement.append(title, detail);
            fragment.appendChild(movement);
        });
        recentMovements.appendChild(fragment);
    };

    (async () => {
        const { investments, transactions } = await loadFinanceData();
        const investmentSummary = summarizeInvestments(investments);
        const transactionSummary = summarizeTransactions(transactions);
        const cashBalance = transactionSummary.income - transactionSummary.expense;

        setText('[data-dashboard="total-balance"]', formatCurrency(investmentSummary.patrimony));
        setText('[data-dashboard="assets-count"]', investmentSummary.assetsCount);
        setText(
            '[data-dashboard="assets-detail"]',
            investmentSummary.assetsCount ? "investimentos cadastrados" : "carteira zerada"
        );
        setText('[data-dashboard="cash-balance"]', formatCurrency(cashBalance));
        renderRecentMovements(transactions);
    })();
};

const initPortfolioCrud = () => {
    const page = document.querySelector('[data-page="carteira"]');
    if (!page) {
        return;
    }

    const investModal = document.querySelector('[data-modal="invest"]');
    const openInvestButton = document.querySelector('[data-action="open-invest"]');
    const investmentList = document.querySelector('[data-list="investments"]');

    if (!investModal || !openInvestButton || !investmentList) {
        return;
    }

    const investForm = investModal.querySelector('[data-form="investment"]');
    const investMessage = investForm?.querySelector('[data-message="investment"]');
    const investType = investForm?.querySelector("#invest-type");
    const investName = investForm?.querySelector("#invest-name");
    const investQuantity = investForm?.querySelector("#invest-quantity");
    const investValue = investForm?.querySelector("#invest-value");
    const investValueLabel = investForm?.querySelector("[data-invest-value-label]");
    const investEarning = investForm?.querySelector("#invest-earning");
    const quantityField = investForm?.querySelector('[data-quantity-field]');
    const quantityNote = investForm?.querySelector('[data-quantity-note]');
    const investSubmit = investForm?.querySelector('[data-action="confirm-invest"]');

    if (
        !investForm
        || !investType
        || !investName
        || !investQuantity
        || !investValue
        || !investValueLabel
        || !investEarning
        || !investSubmit
    ) {
        return;
    }

    let investments = [];

    const renderPortfolioSummary = async () => {
        const investmentSummary = summarizeInvestments(investments);

        setText('[data-portfolio="patrimony"]', formatCurrency(investmentSummary.patrimony));
        setText('[data-portfolio="assets-count"]', investmentSummary.assetsCount);
        setText(
            '[data-portfolio="assets-detail"]',
            investmentSummary.assetsCount ? "investimentos cadastrados" : "carteira zerada"
        );
        setText('[data-portfolio="earnings"]', formatCurrency(investmentSummary.earnings));
        setText('[data-position="acoes"]', renderPosition("acoes", investmentSummary.byType.acoes));
        setText('[data-position="renda-fixa"]', renderPosition("renda-fixa", investmentSummary.byType["renda-fixa"]));
        setText('[data-position="cripto"]', renderPosition("cripto", investmentSummary.byType.cripto));
    };

    const renderEmpty = (container, message) => {
        container.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "crud-empty";
        empty.textContent = message;
        container.appendChild(empty);
    };

    const renderInvestments = (items) => {
        if (!items.length) {
            renderEmpty(investmentList, "Nenhum investimento cadastrado.");
            return;
        }

        investmentList.innerHTML = "";
        const fragment = document.createDocumentFragment();

        items.forEach((item) => {
            const wrapper = document.createElement("div");
            wrapper.className = "crud-item";
            wrapper.dataset.id = item.id;

            const info = document.createElement("div");
            const title = document.createElement("p");
            title.className = "crud-title";
            title.textContent = item.name;
            const meta = document.createElement("p");
            meta.className = "crud-meta";
            const total = getInvestmentTotal(item);
            const quantityText = item.quantity ? `${item.quantity} x ${formatCurrency(item.value)}` : formatCurrency(item.value);
            const earningText = item.earning ? ` | rendimento ${formatCurrency(item.earning)}` : "";
            meta.textContent = `${item.type} | ${quantityText} | total ${formatCurrency(total)}${earningText}`;
            info.append(title, meta);

            const actions = document.createElement("div");
            actions.className = "crud-actions";
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "crud-button";
            editButton.dataset.action = "edit-investment";
            editButton.textContent = "editar";
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "crud-button danger";
            deleteButton.dataset.action = "delete-investment";
            deleteButton.textContent = "excluir";
            actions.append(editButton, deleteButton);

            wrapper.append(info, actions);
            fragment.appendChild(wrapper);
        });

        investmentList.appendChild(fragment);
    };

    const loadInvestments = async () => {
        const result = await getJson("/api/investments");
        if (!result.ok) {
            setMessage(investMessage, result.data?.message || "Nao foi possivel carregar investimentos.", "error");
            renderEmpty(investmentList, "Nao foi possivel carregar investimentos.");
            return;
        }

        investments = Array.isArray(result.data?.items) ? result.data.items : [];
        renderInvestments(investments);
        await renderPortfolioSummary();
    };

    const resetInvestForm = () => {
        investForm.reset();
        investForm.dataset.mode = "create";
        investForm.removeAttribute("data-id");
        investSubmit.textContent = "adicionar";
        setMessage(investMessage, "");
    };

    const closeInvestModal = () => {
        investModal.classList.remove("is-open");
        document.body.classList.remove("modal-open");
        resetInvestForm();
    };

    const openInvestModal = (mode, item) => {
        resetInvestForm();
        syncQuantityRequirement();
        investForm.dataset.mode = mode;

        if (mode === "edit" && item) {
            investForm.dataset.id = item.id;
            investType.value = item.type;
            investName.value = item.name;
            investQuantity.value = item.quantity;
            investValue.value = item.value;
            investEarning.value = item.earning || "";
            investSubmit.textContent = "salvar";
            syncQuantityRequirement();
        }

        investModal.classList.add("is-open");
        document.body.classList.add("modal-open");
    };

    const syncQuantityRequirement = () => {
        const requiresQuantity = investType?.value !== "renda-fixa";
        investValueLabel.textContent = requiresQuantity ? "valor" : "valor de deposito";
        if (quantityNote) {
            quantityNote.hidden = !requiresQuantity;
        }
        if (quantityField) {
            if (requiresQuantity) {
                quantityField.hidden = false;
            } else {
                quantityField.hidden = true;
                if (investQuantity) {
                    investQuantity.value = "";
                    investQuantity.disabled = true;
                }
            }
        }
        if (requiresQuantity && investQuantity) {
            investQuantity.disabled = false;
        }
        if (investMessage) {
            setMessage(investMessage, "");
        }
        return requiresQuantity;
    };

    investType?.addEventListener("change", () => {
        syncQuantityRequirement();
    });

    syncQuantityRequirement();

    openInvestButton.addEventListener("click", () => {
        syncQuantityRequirement();
        openInvestModal("create");
    });

    investModal.addEventListener("click", (event) => {
        if (event.target === investModal) {
            closeInvestModal();
        }
    });

    const closeButtons = investModal.querySelectorAll('[data-action="close-invest"]');
    closeButtons.forEach((button) => {
        button.addEventListener("click", closeInvestModal);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && investModal.classList.contains("is-open")) {
            closeInvestModal();
        }
    });

    investForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const name = investName.value.trim();
        setMessage(investMessage, "");
        const rawQuantity = investQuantity.value.trim();
        const quantity = rawQuantity === "" ? undefined : Number(rawQuantity);
        const rawValue = investValue.value.trim();
        const value = rawValue === "" ? undefined : Number(rawValue);
        const rawEarning = investEarning.value.trim();
        const earning = rawEarning === "" ? undefined : Number(rawEarning);
        const mode = investForm.dataset.mode || "create";

        if (!name) {
            setMessage(investMessage, "Informe o nome do ativo.", "error");
            return;
        }
        const requiresQuantity = investType?.value !== "renda-fixa";
        if (requiresQuantity) {
            if (rawQuantity === "") {
                setMessage(investMessage, "Informe a quantidade.", "error");
                return;
            }
            if (!Number.isFinite(quantity) || quantity <= 0) {
                setMessage(investMessage, "Quantidade invalida.", "error");
                return;
            }
        } else if (rawQuantity !== "" && (!Number.isFinite(quantity) || quantity <= 0)) {
            // guard against accidental values when the field is shown manually
            setMessage(investMessage, "Quantidade invalida.", "error");
            return;
        }
        if (rawValue !== "" && (!Number.isFinite(value) || value < 0)) {
            setMessage(investMessage, "Valor invalido.", "error");
            return;
        }
        if (rawEarning !== "" && (!Number.isFinite(earning) || earning < 0)) {
            setMessage(investMessage, "Rendimento invalido.", "error");
            return;
        }

        const payload = {
            type: investType.value,
            name,
        };

        if (quantity !== undefined) {
            payload.quantity = quantity;
        }
        if (value !== undefined) {
            payload.value = value;
        }
        if (earning !== undefined || mode === "edit") {
            payload.earning = earning;
        }

        const endpoint = mode === "edit" ? `/api/investments/${investForm.dataset.id}` : "/api/investments";
        const method = mode === "edit" ? "PUT" : "POST";

        const result = await requestJson(endpoint, { method, payload });
        if (!result.ok) {
            setMessage(investMessage, result.data?.message || "Nao foi possivel salvar investimento.", "error");
            return;
        }

        closeInvestModal();
        await loadInvestments();
    });

    investmentList.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button || !button.dataset.action) {
            return;
        }
        const itemElement = event.target.closest(".crud-item");
        const id = itemElement?.dataset.id;
        if (!id) {
            return;
        }
        const item = investments.find((entry) => entry.id === id);
        if (!item) {
            return;
        }

        if (button.dataset.action === "edit-investment") {
            openInvestModal("edit", item);
            return;
        }

        if (button.dataset.action === "delete-investment") {
            const confirmed = window.confirm("Remover investimento?");
            if (!confirmed) {
                return;
            }
            const result = await requestJson(`/api/investments/${id}`, { method: "DELETE" });
            if (!result.ok) {
                setMessage(investMessage, result.data?.message || "Nao foi possivel remover investimento.", "error");
                return;
            }
            await loadInvestments();
        }
    });

    resetInvestForm();
    loadInvestments();
};

initDashboardSummary();
initPortfolioCrud();

const initTransactionsPage = () => {
    const page = document.querySelector('[data-page="transacoes"]');
    if (!page) {
        return;
    }

    const transactionList = document.querySelector('[data-list="transactions"]');
    const transactionForm = document.querySelector('[data-form="transaction"]');
    const filterForm = document.querySelector('[data-form="transaction-filters"]');
    const incomeSummary = document.querySelector('[data-summary="income"]');
    const expenseSummary = document.querySelector('[data-summary="expense"]');
    const balanceSummary = document.querySelector('[data-summary="balance"]');

    if (!transactionList || !transactionForm || !filterForm) {
        return;
    }

    const transactionMessage = transactionForm.querySelector('[data-message="transaction"]');
    const transactionType = transactionForm.querySelector("#transaction-type");
    const transactionDescription = transactionForm.querySelector("#transaction-description");
    const transactionAmount = transactionForm.querySelector("#transaction-amount");
    const transactionDate = transactionForm.querySelector("#transaction-date");
    const transactionCancel = transactionForm.querySelector('[data-action="cancel-transaction"]');
    const transactionSubmit = transactionForm.querySelector('[data-action="submit-transaction"]');
    const filterType = filterForm.querySelector("#filter-type");
    const filterDate = filterForm.querySelector("#filter-date");
    const clearFiltersButton = filterForm.querySelector('[data-action="clear-transaction-filters"]');

    if (
        !transactionType
        || !transactionDescription
        || !transactionAmount
        || !transactionDate
        || !transactionCancel
        || !transactionSubmit
        || !filterType
        || !filterDate
        || !clearFiltersButton
    ) {
        return;
    }

    let transactions = [];

    const renderEmpty = (message) => {
        transactionList.innerHTML = "";
        const empty = document.createElement("div");
        empty.className = "crud-empty";
        empty.textContent = message;
        transactionList.appendChild(empty);
    };

    const getFilteredTransactions = () => {
        const typeValue = filterType.value;
        const dateValue = filterDate.value;

        return transactions.filter((item) => {
            const matchesType = !typeValue || item.type === typeValue;
            const itemDate = item.date ? item.date.slice(0, 10) : "";
            const matchesDate = !dateValue || itemDate === dateValue;
            return matchesType && matchesDate;
        });
    };

    const renderSummary = (items) => {
        const totals = summarizeTransactions(items);

        if (incomeSummary) {
            incomeSummary.textContent = formatCurrency(totals.income);
        }
        if (expenseSummary) {
            expenseSummary.textContent = formatCurrency(totals.expense);
        }
        if (balanceSummary) {
            balanceSummary.textContent = formatCurrency(totals.income - totals.expense);
        }
    };

    const renderTransactions = () => {
        const items = getFilteredTransactions();
        renderSummary(transactions);

        if (!items.length) {
            renderEmpty("Nenhuma transacao encontrada.");
            return;
        }

        transactionList.innerHTML = "";
        const fragment = document.createDocumentFragment();

        items.forEach((item) => {
            const wrapper = document.createElement("div");
            wrapper.className = "crud-item";
            wrapper.dataset.id = item.id;

            const info = document.createElement("div");
            const title = document.createElement("p");
            title.className = "crud-title";
            title.textContent = item.description;
            const meta = document.createElement("p");
            meta.className = "crud-meta";
            meta.textContent = `${item.type} | ${formatCurrency(item.amount)} | ${formatDate(item.date)}`;
            info.append(title, meta);

            const actions = document.createElement("div");
            actions.className = "crud-actions";
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "crud-button";
            editButton.dataset.action = "edit-transaction";
            editButton.textContent = "editar";
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "crud-button danger";
            deleteButton.dataset.action = "delete-transaction";
            deleteButton.textContent = "excluir";
            actions.append(editButton, deleteButton);

            wrapper.append(info, actions);
            fragment.appendChild(wrapper);
        });

        transactionList.appendChild(fragment);
    };

    const loadTransactions = async () => {
        const result = await getJson("/api/transactions");
        if (!result.ok) {
            setMessage(transactionMessage, result.data?.message || "Nao foi possivel carregar transacoes.", "error");
            renderSummary([]);
            renderEmpty("Nao foi possivel carregar transacoes.");
            return;
        }

        transactions = Array.isArray(result.data?.items) ? result.data.items : [];
        renderTransactions();
    };

    const resetTransactionForm = () => {
        transactionForm.reset();
        transactionForm.dataset.mode = "create";
        transactionForm.removeAttribute("data-id");
        transactionSubmit.textContent = "adicionar";
        transactionCancel.hidden = true;
        setMessage(transactionMessage, "");
    };

    const fillTransactionForm = (item) => {
        transactionForm.dataset.mode = "edit";
        transactionForm.dataset.id = item.id;
        transactionType.value = item.type;
        transactionDescription.value = item.description;
        transactionAmount.value = item.amount;
        transactionDate.value = item.date ? item.date.slice(0, 10) : "";
        transactionSubmit.textContent = "salvar";
        transactionCancel.hidden = false;
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    transactionForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const description = transactionDescription.value.trim();
        const amount = Number(transactionAmount.value);
        const dateValue = transactionDate.value;

        if (!description) {
            setMessage(transactionMessage, "Informe a descricao.", "error");
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0) {
            setMessage(transactionMessage, "Valor invalido.", "error");
            return;
        }

        const payload = {
            type: transactionType.value,
            description,
            amount,
        };
        if (dateValue) {
            payload.date = dateValue;
        }

        const mode = transactionForm.dataset.mode || "create";
        const endpoint = mode === "edit" ? `/api/transactions/${transactionForm.dataset.id}` : "/api/transactions";
        const method = mode === "edit" ? "PUT" : "POST";

        const result = await requestJson(endpoint, { method, payload });
        if (!result.ok) {
            setMessage(transactionMessage, result.data?.message || "Nao foi possivel salvar transacao.", "error");
            return;
        }

        resetTransactionForm();
        await loadTransactions();
    });

    transactionCancel.addEventListener("click", () => {
        resetTransactionForm();
    });

    transactionList.addEventListener("click", async (event) => {
        const button = event.target.closest("button");
        if (!button || !button.dataset.action) {
            return;
        }
        const itemElement = event.target.closest(".crud-item");
        const id = itemElement?.dataset.id;
        if (!id) {
            return;
        }
        const item = transactions.find((entry) => entry.id === id);
        if (!item) {
            return;
        }

        if (button.dataset.action === "edit-transaction") {
            fillTransactionForm(item);
            return;
        }

        if (button.dataset.action === "delete-transaction") {
            const confirmed = window.confirm("Remover transacao?");
            if (!confirmed) {
                return;
            }
            const result = await requestJson(`/api/transactions/${id}`, { method: "DELETE" });
            if (!result.ok) {
                setMessage(transactionMessage, result.data?.message || "Nao foi possivel remover transacao.", "error");
                return;
            }
            await loadTransactions();
        }
    });

    filterType.addEventListener("change", renderTransactions);
    filterDate.addEventListener("change", renderTransactions);
    clearFiltersButton.addEventListener("click", () => {
        filterForm.reset();
        renderTransactions();
    });

    resetTransactionForm();
    loadTransactions();
};

initTransactionsPage();
