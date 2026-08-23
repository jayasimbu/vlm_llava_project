document.addEventListener('DOMContentLoaded', () => {
    const authShell = document.getElementById('authShell');
    const appShell = document.getElementById('appShell');
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const loginEmail = document.getElementById('loginEmail');
    const loginPassword = document.getElementById('loginPassword');
    const signupName = document.getElementById('signupName');
    const signupEmail = document.getElementById('signupEmail');
    const signupPassword = document.getElementById('signupPassword');
    const userBadgeWrap = document.getElementById('userBadgeWrap');
    const userBadge = document.getElementById('userBadge');
    const btnLogout = document.getElementById('btnLogout');
    const btnRefreshHistory = document.getElementById('btnRefreshHistory');
    const historyList = document.getElementById('historyList');
    const historyEmpty = document.getElementById('historyEmpty');

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const previewArea = document.getElementById('previewArea');
    const imagePreview = document.getElementById('imagePreview');
    const btnRemoveImage = document.getElementById('btnRemoveImage');
    const actionFooter = document.getElementById('actionFooter');
    const btnExtract = document.getElementById('btnExtract');
    const btnText = document.getElementById('btnText');
    const btnSpinner = document.getElementById('btnSpinner');

    const resultsIdle = document.getElementById('resultsIdle');
    const resultsContent = document.getElementById('resultsContent');
    const qaCard = document.getElementById('qaCard');
    const backendStatus = document.getElementById('backendStatus');
    const statusText = document.getElementById('statusText');

    const resVendor = document.getElementById('resVendor');
    const resInvoiceNum = document.getElementById('resInvoiceNum');
    const resDate = document.getElementById('resDate');
    const resTime = document.getElementById('resTime');
    const resSubtotal = document.getElementById('resSubtotal');
    const resDiscount = document.getElementById('resDiscount');
    const resTax = document.getElementById('resTax');
    const resTotal = document.getElementById('resTotal');
    const rawJsonCode = document.getElementById('rawJsonCode');

    const itemsSection = document.getElementById('itemsSection');
    const itemsTableBody = document.getElementById('itemsTableBody');

    const accordionTrigger = document.getElementById('accordionTrigger');
    const accordionContent = document.getElementById('accordionContent');

    const chatInput = document.getElementById('chatInput');
    const btnSendChat = document.getElementById('btnSendChat');
    const chatMessages = document.getElementById('chatMessages');

    const btnExportExcel = document.getElementById('btnExportExcel');
    const toast = document.getElementById('toast');

    const tokenStorageKey = 'vlmAuthToken';
    const userStorageKey = 'vlmAuthUser';

    let authToken = localStorage.getItem(tokenStorageKey) || '';
    let currentUser = loadStoredUser();
    let selectedFile = null;
    let extractedData = null;
    let historyRecords = [];

    updateStatusLabel(null);
    syncAuthUi();

    loginForm.addEventListener('submit', handleLogin);
    signupForm.addEventListener('submit', handleSignup);
    btnLogout.addEventListener('click', logout);
    btnRefreshHistory.addEventListener('click', refreshHistory);

    ['dragenter', 'dragover'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (event) => {
            event.preventDefault();
            dropZone.classList.remove('dragover');
        }, false);
    });

    dropZone.addEventListener('drop', (event) => {
        const files = event.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    fileInput.addEventListener('change', (event) => {
        if (event.target.files.length > 0) {
            handleFileSelect(event.target.files[0]);
        }
    });

    btnRemoveImage.addEventListener('click', resetUploadState);

    btnExtract.addEventListener('click', async () => {
        if (!selectedFile) {
            showToast('Choose an invoice image first.', true);
            return;
        }

        setLoadingState(true);

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            const response = await fetch('/extract', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`HTTP Error! Status: ${response.status}`);
            }

            const result = await response.json();

            if (result.status === 'success') {
                extractedData = result.data;
                populateResults(extractedData, result.history_record || null);
                updateStatusLabel(result.mock_mode);
                showToast(authToken ? 'Invoice saved to history.' : 'Invoice processed successfully!');
                if (authToken) {
                    await refreshHistory();
                }
            } else {
                throw new Error(result.error || 'Unknown extraction error');
            }
        } catch (error) {
            console.error('Extraction error:', error);
            showToast('Failed to extract invoice data. Check console logs.', true);
        } finally {
            setLoadingState(false);
        }
    });

    btnSendChat.addEventListener('click', sendQuestion);
    chatInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            sendQuestion();
        }
    });

    accordionTrigger.addEventListener('click', () => {
        accordionTrigger.classList.toggle('active');
        accordionContent.classList.toggle('hidden');
    });

    document.querySelectorAll('.btn-copy').forEach((button) => {
        button.addEventListener('click', () => {
            const targetId = button.getAttribute('data-target');
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                const valueToCopy = targetElement.textContent;
                if (valueToCopy && valueToCopy !== 'Not extracted') {
                    navigator.clipboard.writeText(valueToCopy).then(() => {
                        showToast('Value copied to clipboard!');
                    }).catch((error) => {
                        console.error('Copy error:', error);
                    });
                } else {
                    showToast('No data available to copy!', true);
                }
            }
        });
    });

    btnExportExcel.addEventListener('click', () => {
        if (!extractedData) {
            return;
        }

        try {
            const rows = [];
            if (extractedData.items && extractedData.items.length > 0) {
                extractedData.items.forEach((item) => {
                    rows.push({
                        'Vendor Name': extractedData.vendor_name || 'N/A',
                        'Invoice Number': extractedData.invoice_number || 'N/A',
                        'Invoice Date': extractedData.invoice_date || 'N/A',
                        'Invoice Time': extractedData.invoice_time || 'N/A',
                        'Item Description': item.name,
                        'Quantity': item.qty,
                        'Item Price': item.price,
                        'Subtotal': extractedData.subtotal || 0.0,
                        'Discount': extractedData.discount || 0.0,
                        'Tax (GST)': extractedData.tax || 0.0,
                        'Total Amount': extractedData.total_amount || 0.0,
                    });
                });
            } else {
                rows.push({
                    'Vendor Name': extractedData.vendor_name || 'N/A',
                    'Invoice Number': extractedData.invoice_number || 'N/A',
                    'Invoice Date': extractedData.invoice_date || 'N/A',
                    'Invoice Time': extractedData.invoice_time || 'N/A',
                    'Item Description': 'N/A',
                    'Quantity': 'N/A',
                    'Item Price': 'N/A',
                    'Subtotal': extractedData.subtotal || 0.0,
                    'Discount': extractedData.discount || 0.0,
                    'Tax (GST)': extractedData.tax || 0.0,
                    'Total Amount': extractedData.total_amount || 0.0,
                });
            }

            const worksheet = XLSX.utils.json_to_sheet(rows);
            worksheet['!cols'] = [
                { wch: 25 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 },
                { wch: 30 },
                { wch: 10 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 },
                { wch: 15 },
            ];

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoice Details');

            const filename = `invoice_extract_${extractedData.invoice_number || 'data'}.xlsx`;
            XLSX.writeFile(workbook, filename);
            showToast('Excel spreadsheet exported successfully!');
        } catch (error) {
            console.error('Export error:', error);
            showToast('Failed to export Excel file.', true);
        }
    });

    bootstrapSession();

    function getAuthHeaders() {
        if (!authToken) {
            return {};
        }
        return {
            'X-Auth-Token': authToken,
        };
    }

    function loadStoredUser() {
        try {
            const stored = localStorage.getItem(userStorageKey);
            return stored ? JSON.parse(stored) : null;
        } catch (error) {
            return null;
        }
    }

    function persistUserSession(user, token) {
        currentUser = user;
        authToken = token;
        localStorage.setItem(tokenStorageKey, token);
        localStorage.setItem(userStorageKey, JSON.stringify(user));
        syncAuthUi();
    }

    function clearUserSession() {
        authToken = '';
        currentUser = null;
        localStorage.removeItem(tokenStorageKey);
        localStorage.removeItem(userStorageKey);
        syncAuthUi();
    }

    function syncAuthUi() {
        const authenticated = Boolean(authToken);
        authShell.classList.toggle('hidden', authenticated);
        appShell.classList.toggle('hidden', !authenticated);
        userBadgeWrap.classList.toggle('hidden', !authenticated);

        if (authenticated && currentUser) {
            userBadge.textContent = `Signed in as ${currentUser.display_name || currentUser.email}`;
        }

        if (!authenticated) {
            resetWorkspaceForLogout();
        }
    }

    async function bootstrapSession() {
        if (!authToken) {
            syncAuthUi();
            return;
        }

        try {
            const response = await fetch('/auth/me', {
                headers: getAuthHeaders(),
            });

            if (!response.ok) {
                throw new Error('Session expired');
            }

            const result = await response.json();
            currentUser = result.user;
            localStorage.setItem(userStorageKey, JSON.stringify(currentUser));
            syncAuthUi();
            await refreshHistory();
        } catch (error) {
            clearUserSession();
            showToast('Session expired. Please login again.', true);
        }
    }

    async function handleLogin(event) {
        event.preventDefault();

        try {
            const response = await fetch('/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: loginEmail.value.trim(),
                    password: loginPassword.value,
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.detail || 'Unable to login');
            }

            persistUserSession(result.user, result.token);
            loginForm.reset();
            await refreshHistory();
            showToast('Login successful.');
        } catch (error) {
            showToast(error.message || 'Login failed.', true);
        }
    }

    async function handleSignup(event) {
        event.preventDefault();

        try {
            const response = await fetch('/auth/signup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: signupEmail.value.trim(),
                    password: signupPassword.value,
                    display_name: signupName.value.trim(),
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.detail || 'Unable to sign up');
            }

            persistUserSession(result.user, result.token);
            signupForm.reset();
            await refreshHistory();
            showToast('Account created.');
        } catch (error) {
            showToast(error.message || 'Signup failed.', true);
        }
    }

    function logout() {
        clearUserSession();
        showToast('Logged out.');
    }

    async function refreshHistory() {
        if (!authToken) {
            renderHistory([]);
            return;
        }

        btnRefreshHistory.disabled = true;
        try {
            const response = await fetch('/history', {
                headers: getAuthHeaders(),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.detail || 'Unable to load saved bills');
            }

            renderHistory(result.history || []);
        } catch (error) {
            renderHistory([]);
            showToast(error.message || 'Unable to load saved bills.', true);
        } finally {
            btnRefreshHistory.disabled = false;
        }
    }

    function renderHistory(records) {
        historyRecords = records;
        historyList.innerHTML = '';

        if (!records.length) {
            historyEmpty.classList.remove('hidden');
            return;
        }

        historyEmpty.classList.add('hidden');

        records.forEach((record) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'history-item';

            const info = document.createElement('div');
            info.className = 'history-info';

            const title = document.createElement('strong');
            title.textContent = record.data?.vendor_name || record.file_name || 'Invoice';

            const subtitle = document.createElement('span');
            subtitle.textContent = `${record.data?.invoice_number || 'No invoice number'} • ${record.data?.invoice_date || 'No date'}`;

            const meta = document.createElement('span');
            meta.className = 'history-meta';
            meta.textContent = `${formatAmount(record.data?.total_amount)} • ${formatDate(record.created_at)}`;

            info.appendChild(title);
            info.appendChild(subtitle);
            info.appendChild(meta);

            const action = document.createElement('span');
            action.className = 'history-action';
            action.textContent = 'Open';

            item.appendChild(info);
            item.appendChild(action);
            item.addEventListener('click', () => loadHistoryRecord(record));

            historyList.appendChild(item);
        });
    }

    function loadHistoryRecord(record) {
        extractedData = record.data || null;
        if (!extractedData) {
            return;
        }

        if (record.stored_file) {
            imagePreview.src = record.stored_file;
            dropZone.classList.add('hidden');
            previewArea.classList.remove('hidden');
            actionFooter.classList.remove('hidden');
        }

        populateResults(extractedData, record);
        showToast('Loaded saved bill.');
    }

    function handleFileSelect(file) {
        if (!file.type.startsWith('image/')) {
            showToast('Error: Selected file is not an image!', true);
            return;
        }

        selectedFile = file;
        extractedData = null;

        const reader = new FileReader();
        reader.onload = (event) => {
            imagePreview.src = event.target.result;
            dropZone.classList.add('hidden');
            previewArea.classList.remove('hidden');
            actionFooter.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }

    function resetUploadState() {
        selectedFile = null;
        extractedData = null;
        fileInput.value = '';
        imagePreview.src = '';
        dropZone.classList.remove('hidden');
        previewArea.classList.add('hidden');
        actionFooter.classList.add('hidden');

        resultsIdle.classList.remove('hidden');
        resultsContent.classList.add('hidden');
        qaCard.classList.add('hidden');
        btnExportExcel.classList.add('disabled');
        btnExportExcel.disabled = true;

        accordionTrigger.classList.remove('active');
        accordionContent.classList.add('hidden');

        resVendor.textContent = 'Not extracted';
        resInvoiceNum.textContent = 'Not extracted';
        resDate.textContent = 'Not extracted';
        resTime.textContent = 'Not extracted';
        resSubtotal.textContent = 'Not extracted';
        resDiscount.textContent = 'Not extracted';
        resTax.textContent = 'Not extracted';
        resTotal.textContent = 'Not extracted';

        itemsTableBody.innerHTML = '';
        itemsSection.classList.add('hidden');

        chatMessages.innerHTML = `
            <div class="chat-message system">
                <p>Extraction complete! Ask me any specific details about this invoice (e.g. GST registration, payment terms, list of items, etc.).</p>
            </div>
        `;
    }

    function resetWorkspaceForLogout() {
        resetUploadState();
        renderHistory([]);
        updateStatusLabel(null);
    }

    function populateResults(data, historyRecord = null) {
        resVendor.textContent = data.vendor_name || 'Not found';
        resInvoiceNum.textContent = data.invoice_number || 'Not found';
        resDate.textContent = data.invoice_date || 'Not found';
        resTime.textContent = data.invoice_time || 'Not found';

        resSubtotal.textContent = formatAmount(data.subtotal);
        resDiscount.textContent = formatAmount(data.discount);
        resTax.textContent = formatAmount(data.tax);
        resTotal.textContent = formatAmount(data.total_amount);

        if (data.items && data.items.length > 0) {
            let html = '';
            data.items.forEach((item) => {
                const priceFormatted = typeof item.price === 'number'
                    ? item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : item.price;

                html += `<tr>
                    <td>${item.name}</td>
                    <td style="text-align: right;">${item.qty}</td>
                    <td style="text-align: right;">${priceFormatted}</td>
                </tr>`;
            });
            itemsTableBody.innerHTML = html;
            itemsSection.classList.remove('hidden');
        } else {
            itemsTableBody.innerHTML = '';
            itemsSection.classList.add('hidden');
        }

        const rawPayload = historyRecord ? historyRecord : data;
        rawJsonCode.textContent = JSON.stringify(rawPayload, null, 2);
        resultsIdle.classList.add('hidden');
        resultsContent.classList.remove('hidden');
        qaCard.classList.remove('hidden');
        btnExportExcel.classList.remove('disabled');
        btnExportExcel.disabled = false;
    }

    async function sendQuestion() {
        const text = chatInput.value.trim();
        if (!text || !extractedData) {
            return;
        }

        appendChatMessage(text, 'user');
        chatInput.value = '';
        const loadingMessageId = appendChatMessage('Analyzing question...', 'assistant', true);

        try {
            const response = await fetch('/ask', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    question: text,
                    invoice_data: extractedData,
                }),
            });

            if (!response.ok) {
                throw new Error('Chat request failed');
            }

            const result = await response.json();
            const loadingMessage = document.getElementById(loadingMessageId);
            if (loadingMessage) {
                loadingMessage.remove();
            }
            appendChatMessage(result.answer, 'assistant');
        } catch (error) {
            console.error(error);
            const loadingMessage = document.getElementById(loadingMessageId);
            if (loadingMessage) {
                loadingMessage.remove();
            }
            appendChatMessage('Sorry, an error occurred while retrieving the answer. Please try again.', 'assistant');
        }
    }

    function appendChatMessage(text, sender, isLoading = false) {
        const messageId = `chat-msg-${Date.now()}`;
        const message = document.createElement('div');
        message.className = `chat-message ${sender}`;
        message.id = messageId;

        message.innerHTML = isLoading
            ? `<p>${text} <i class="fa-solid fa-ellipsis-stroke fa-beat"></i></p>`
            : `<p>${text}</p>`;

        chatMessages.appendChild(message);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return messageId;
    }

    function setLoadingState(loading) {
        if (loading) {
            btnExtract.disabled = true;
            btnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing Image...';
            btnSpinner.classList.remove('hidden');
        } else {
            btnExtract.disabled = false;
            btnText.innerHTML = '<i class="fa-solid fa-microchip"></i> Analyze Invoice';
            btnSpinner.classList.add('hidden');
        }
    }

    function updateStatusLabel(isMockMode) {
        backendStatus.className = 'backend-status-badge';
        if (isMockMode === null) {
            backendStatus.classList.add('hidden');
        } else if (isMockMode) {
            backendStatus.classList.add('mock-mode');
            statusText.textContent = 'Mock Inference Mode';
        } else {
            backendStatus.classList.add('real-mode');
            statusText.textContent = 'HuggingFace LLaVA Mode';
        }
    }

    function formatAmount(value) {
        if (value === null || value === undefined || value === '') {
            return 'Not found';
        }
        const numericValue = Number(value);
        if (Number.isNaN(numericValue)) {
            return String(value);
        }
        return numericValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDate(value) {
        if (!value) {
            return 'Just now';
        }
        const parsedDate = new Date(value);
        if (Number.isNaN(parsedDate.getTime())) {
            return value;
        }
        return parsedDate.toLocaleString();
    }

    function showToast(message, isError = false) {
        toast.textContent = message;
        toast.className = 'toast';
        toast.style.borderColor = isError ? 'var(--color-accent-rose)' : 'var(--color-accent-blue)';
        toast.classList.remove('hidden');

        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }
});
