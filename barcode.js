// barcode.js – HD Scanner with continuous multi‑scan support (stays open)
// Now includes 1.5s cooldown and duplicate‑in‑cart prevention.

// Helper to load script dynamically
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Beep sound using Web Audio
function playBeep() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.2);
  } catch (e) {
    // Silent fail if audio not supported
  }
}

async function openBarcodeScanner() {
    if (typeof Html5Qrcode === 'undefined') {
        try {
            await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
        } catch (e) {
            showToast('Failed to load scanner library', 'error');
            console.error(e);
            return;
        }
    }

    const modalEl = document.getElementById("barcodeModal");
    if (!modalEl) { showToast('Modal element missing', 'error'); return; }
    const modal = new bootstrap.Modal(modalEl);
    const readerEl = document.getElementById("barcodeReader");

    // ─── Add close button to the overlay ───────────────────────────
    readerEl.innerHTML = `
        <div class="scanner-overlay">
            <div class="corner tl"></div>
            <div class="corner tr"></div>
            <div class="corner bl"></div>
            <div class="corner br"></div>
            <div class="scan-line"></div>
            <div class="scanner-flash"></div>
            <button class="scanner-close-btn" data-bs-dismiss="modal" aria-label="Close scanner">
                <i class="bi bi-x-lg"></i>
            </button>
        </div>
        <div class="scanner-status">
            <i class="bi bi-upc-scan"></i> HD Scanning <span class="pulse"></span>
        </div>
    `;

    modal.show();
    await new Promise(resolve => {
        modalEl.addEventListener('shown.bs.modal', resolve, { once: true });
    });

    readerEl.style.minHeight = '280px';
    readerEl.style.position = 'relative';
    readerEl.style.background = '#000';

    const reader = new Html5Qrcode('barcodeReader');

    const config = {
        fps: 10,
        qrbox: { width: 320, height: 320 },
        aspectRatio: 1.0,
        videoConstraints: {
            width: { ideal: 1920, max: 3840 },
            height: { ideal: 1080, max: 2160 },
            facingMode: { exact: 'environment' },
        },
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
        },
    };

    function styleVideo() {
        const video = readerEl.querySelector('video');
        if (video) {
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.display = 'block';
            video.style.position = 'absolute';
            video.style.top = '0';
            video.style.left = '0';
            video.style.zIndex = '1';
            return true;
        }
        return false;
    }

    const observer = new MutationObserver(() => {
        if (styleVideo()) observer.disconnect();
    });
    observer.observe(readerEl, { childList: true, subtree: true });
    setTimeout(styleVideo, 300);

    let beepThrottle = false;
    let isProcessing = false;
    const lastScanned = {};

    const onSuccess = async (decodedText) => {
        if (isProcessing) return;
        isProcessing = true;

        const key = decodedText.trim().toLowerCase();
        const now = Date.now();
        
        // Ignore duplicate rapid scans (same barcode within 500ms)
        if (lastScanned[key] && (now - lastScanned[key] < 500)) {
            isProcessing = false;
            return;
        }
        lastScanned[key] = now;

        if (!beepThrottle) {
            playScanBeep();
            flashScanner(readerEl);
            if (navigator.vibrate) navigator.vibrate(30);
            beepThrottle = true;
            setTimeout(() => { beepThrottle = false; }, 300);
        }

        const product = state.products.find(p =>
            p.sku && p.sku.toLowerCase() === decodedText.trim().toLowerCase()
        );

        if (product) {
            if (product.stock > 0) {
                // ─── Check if already in cart ──────────────────────
                const existing = state.cart.find(c => c.productId === product.id);
                if (existing) {
                    showToast(`⚠️ ${product.name} already in cart`, 'warning');
                } else {
                    addToCart(product.id);
                    showToast(`✅ ${product.name} added (${fmtMoney(product.price)})`, 'success');
                }
                // Scanner stays open – user can scan another product
            } else {
                showToast(`❌ ${product.name} is out of stock`, 'error');
            }
        } else {
            const posSearch = document.getElementById('posSearch');
            if (posSearch) {
                posSearch.value = decodedText;
                posSearch.dispatchEvent(new Event('input'));
            }
            showToast(`🔍 Scanned: "${decodedText}" – no SKU match`, 'warning');
        }

        // ─── Wait 1.5 seconds before allowing the next scan ──────
        setTimeout(() => {
            isProcessing = false;
        }, 1000);
    };

    const onError = (err) => {};

    try {
        await reader.start(
            { facingMode: { exact: 'environment' } },
            config,
            onSuccess,
            onError
        );
        console.log('✅ Scanner started (back camera, exact)');
        styleVideo();
    } catch (err) {
        console.warn('Exact environment failed, trying without exact:', err);
        try {
            const fallbackConfig = {
                ...config,
                videoConstraints: {
                    ...config.videoConstraints,
                    facingMode: 'environment',
                },
            };
            await reader.start(
                { facingMode: 'environment' },
                fallbackConfig,
                onSuccess,
                onError
            );
            console.log('✅ Scanner started (back camera, fallback)');
            styleVideo();
        } catch (err2) {
            console.warn('Back camera failed, trying front:', err2);
            try {
                const frontConfig = {
                    ...config,
                    videoConstraints: {
                        ...config.videoConstraints,
                        facingMode: 'user',
                    },
                };
                await reader.start(
                    { facingMode: 'user' },
                    frontConfig,
                    onSuccess,
                    onError
                );
                console.log('✅ Scanner started (front camera)');
                styleVideo();
            } catch (err3) {
                console.error('All cameras failed:', err3);
                showToast('❌ Camera unavailable. Please enter barcode manually.', 'error');
                modal.hide();
                document.getElementById('posSearch')?.focus();
            }
        }
    }

    // Clean up when modal is closed
    modalEl.addEventListener('hidden.bs.modal', () => {
        observer.disconnect();
        try { reader.stop(); } catch (_) {}
        try { reader.clear(); } catch (_) {}
        readerEl.innerHTML = '';
        readerEl.style.minHeight = '';
        for (let key in lastScanned) delete lastScanned[key];
    }, { once: true });
}


// Flash effect for scanner
function flashScanner(container) {
  const flash = container.querySelector('.scanner-flash');
  if (!flash) return;
  flash.classList.add('active');
  setTimeout(() => flash.classList.remove('active'), 120);
}

// Initialise scanner (called from main.js)
function initBarcodeScanner() {
  const scannerBtn = document.getElementById('barcodeScanBtn');
  if (scannerBtn) {
    scannerBtn.addEventListener('click', openBarcodeScanner);
  }
}