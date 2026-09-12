// Price Rounder - Popup Controller
document.addEventListener('DOMContentLoaded', () => {
  const radios = document.querySelectorAll('input[name="roundingMode"]');
  const statusText = document.getElementById('status-text');

  // Storage helper
  const storage = chrome.storage && (chrome.storage.sync || chrome.storage.local);

  function getMode(callback) {
    if (storage) {
      storage.get({ priceRounderMode: 'round' }, (result) => {
        callback(result.priceRounderMode || 'round');
      });
    } else {
      callback('round');
    }
  }

  function setMode(mode) {
    if (storage) {
      storage.set({ priceRounderMode: mode }, () => {
        showStatus('Saved & applied live');
      });
    }

    // Direct message to active tab for immediate live switch
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'UPDATE_PRICE_MODE',
            mode: mode
          }).catch(() => {
            // Content script may not be loaded on restricted pages (e.g. chrome://)
          });
        }
      });
    }
  }

  function showStatus(msg) {
    if (!statusText) return;
    statusText.textContent = msg;
    statusText.style.color = '#10b981';
    setTimeout(() => {
      statusText.textContent = 'Active & synced across tabs';
      statusText.style.color = '#64748b';
    }, 1800);
  }

  // Initialize selected state
  getMode((currentMode) => {
    const targetRadio = document.querySelector(`input[name="roundingMode"][value="${currentMode}"]`);
    if (targetRadio) {
      targetRadio.checked = true;
    }
  });

  // Handle mode changes
  radios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        setMode(e.target.value);
      }
    });
  });
});
