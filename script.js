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

            setMessage(message, "Conta criada com sucesso!", "success");
            form.reset();

            setTimeout(() => {
                window.location.href = "dashboard.html";
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
    const quantityField = investForm?.querySelector('[data-quantity-field]');
    const quantityNote = investForm?.querySelector('[data-quantity-note]');
    const investSubmit = investForm?.querySelector('[data-action="confirm-invest"]');

    if (
        !investForm
        || !investType
        || !investName
        || !investQuantity
        || !investValue
        || !investSubmit
    ) {
        return;
    }

    let investments = [];

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
            const total = Number(item.quantity) * Number(item.value);
            meta.textContent = `${item.type} | ${item.quantity} x ${formatCurrency(item.value)} | total ${formatCurrency(total)}`;
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
            investSubmit.textContent = "salvar";
            syncQuantityRequirement();
        }

        investModal.classList.add("is-open");
        document.body.classList.add("modal-open");
    };

    const syncQuantityRequirement = () => {
        const requiresQuantity = investType?.value !== "renda-fixa";
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

        const mode = investForm.dataset.mode || "create";
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
        const totals = items.reduce((accumulator, item) => {
            const amount = Number(item.amount) || 0;
            if (getTransactionDirection(item.type) === "income") {
                accumulator.income += amount;
            } else {
                accumulator.expense += amount;
            }
            return accumulator;
        }, { income: 0, expense: 0 });

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
        renderSummary(items);

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
