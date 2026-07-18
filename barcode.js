// barcode.js – Enhanced scanner with beep, visual feedback, and reliable video rendering

// Helper to load script (if not already defined globally)
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
    oscillator.frequency.value = 880; // A5
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.2);
  } catch (e) {
    // Silently fail if audio not supported
  }
}

async function openBarcodeScanner() {
  // 1. Load library if needed
  if (typeof Html5Qrcode === 'undefined') {
    try {
      await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
      console.log('html5-qrcode loaded');
    } catch (e) {
      showToast('Failed to load scanner library', 'error');
      console.error(e);
      return;
    }
  }

  const modalEl = document.getElementById('barcodeModal');
  if (!modalEl) {
    showToast('Modal element missing', 'error');
    return;
  }

  const modal = new bootstrap.Modal(modalEl);
  const readerEl = document.getElementById('barcodeReader');

  // Show modal and wait for it to be fully open
  modal.show();
  await new Promise(resolve => {
    modalEl.addEventListener('shown.bs.modal', resolve, { once: true });
  });

  // Ensure container has a fixed size and black background
  readerEl.style.width = '100%';
  readerEl.style.height = '250px';
  readerEl.style.position = 'relative';
  readerEl.style.overflow = 'hidden';
  readerEl.style.background = '#000';
  readerEl.innerHTML = `
    <div class="text-center p-3 text-light" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:5;">
      <i class="bi bi-camera-reels"></i> Starting camera…
    </div>
  `;

  // Create reader instance
  const reader = new Html5Qrcode('barcodeReader');
  const config = {
    fps: 10,
    qrbox: { width: 200, height: 200 },
    aspectRatio: 1.0,
  };

  // Helper to style the video once it appears
  function styleVideo() {
    const video = readerEl.querySelector('video');
    if (video) {
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      video.style.position = 'absolute';
      video.style.top = '0';
      video.style.left = '0';
      video.style.display = 'block';
      video.style.visibility = 'visible';
      video.style.opacity = '1';
      // Remove the status text
      const status = readerEl.querySelector('.text-center');
      if (status) status.style.display = 'none';
      return true;
    }
    return false;
  }

  // Watch for video element being added
  const observer = new MutationObserver(() => {
    if (styleVideo()) {
      observer.disconnect();
    }
  });
  observer.observe(readerEl, { childList: true, subtree: true });

  // Also try to style after a short delay (in case video appears later)
  setTimeout(styleVideo, 500);

  // Try with environment camera first, fallback to user if fails
  try {
    await reader.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        playBeep();
        const product = state.products.find(p => 
          p.sku && p.sku.toLowerCase() === decodedText.trim().toLowerCase()
        );
        if (product) {
          if (product.stock > 0) {
            addToCart(product.id);
            showToast(`✅ ${product.name} added (${fmtMoney(product.price)})`, 'success');
          } else {
            showToast(`❌ ${product.name} is out of stock`, 'error');
          }
          reader.stop().catch(() => {});
          modal.hide();
        } else {
          const posSearch = document.getElementById('posSearch');
          if (posSearch) {
            posSearch.value = decodedText;
            posSearch.dispatchEvent(new Event('input'));
          }
          reader.stop().catch(() => {});
          modal.hide();
          showToast(`🔍 Scanned: "${decodedText}" – no product found with this SKU`, 'warning');
        }
      },
      (error) => {
        // ignore scanning errors (frequent)
        // console.debug('Scan error:', error);
      }
    );
    console.log('Scanner started (environment)');
    // Add scanning label overlay
    const scanLabel = document.createElement('div');
    scanLabel.className = 'text-center p-2 text-success';
    scanLabel.style.cssText = 'position:absolute;bottom:10px;left:0;right:0;z-index:10;pointer-events:none;background:rgba(0,0,0,0.5);';
    scanLabel.innerHTML = '<i class="bi bi-upc-scan"></i> Scanning…';
    readerEl.appendChild(scanLabel);
    // Try to style video immediately
    styleVideo();
  } catch (err) {
    console.error('Camera start error (environment):', err);
    // Try front camera as fallback
    try {
      await reader.start(
        { facingMode: 'user' },
        config,
        (decodedText) => {
          playBeep();
          const product = state.products.find(p => 
            p.sku && p.sku.toLowerCase() === decodedText.trim().toLowerCase()
          );
          if (product) {
            if (product.stock > 0) {
              addToCart(product.id);
              showToast(`✅ ${product.name} added (${fmtMoney(product.price)})`, 'success');
            } else {
              showToast(`❌ ${product.name} is out of stock`, 'error');
            }
            reader.stop().catch(() => {});
            modal.hide();
          } else {
            const posSearch = document.getElementById('posSearch');
            if (posSearch) {
              posSearch.value = decodedText;
              posSearch.dispatchEvent(new Event('input'));
            }
            reader.stop().catch(() => {});
            modal.hide();
            showToast(`🔍 Scanned: "${decodedText}" – no product found`, 'warning');
          }
        },
        (error) => {}
      );
      console.log('Scanner started (front camera)');
      const scanLabel = document.createElement('div');
      scanLabel.className = 'text-center p-2 text-success';
      scanLabel.style.cssText = 'position:absolute;bottom:10px;left:0;right:0;z-index:10;pointer-events:none;background:rgba(0,0,0,0.5);';
      scanLabel.innerHTML = '<i class="bi bi-upc-scan"></i> Scanning… (front)';
      readerEl.appendChild(scanLabel);
      styleVideo();
    } catch (err2) {
      console.error('Both cameras failed:', err2);
      showToast('❌ Camera not available. Please enter barcode manually.', 'error');
      modal.hide();
      document.getElementById('posSearch')?.focus();
    }
  }

  // Cleanup when modal is closed
  modalEl.addEventListener('hidden.bs.modal', () => {
    observer.disconnect();
    if (reader) {
      try { reader.stop(); } catch(e) {}
      try { reader.clear(); } catch(e) {}
    }
  }, { once: true });
}

// Initialise scanner (called from main.js)
function initBarcodeScanner() {
  const scannerBtn = document.getElementById('barcodeScanBtn');
  if (scannerBtn) {
    scannerBtn.addEventListener('click', openBarcodeScanner);
  }
}