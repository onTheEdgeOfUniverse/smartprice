// INR Price Rounder — Content Script
// Rounds Indian Rupee prices on shopping sites for easier reading
(function () {
  'use strict';

  const DEBUG = false;
  const log = (...args) => { if (DEBUG) console.log('[INRRounder]', ...args); };

  // ─── Regex ───────────────────────────────────────────────────────────────────
  // Matches: ₹1,234  ₹1,234.50  Rs.1234  Rs 1,234  INR 1,234  1234 INR  1,234.00 INR
  // Does NOT match version strings (1.2.3) or plain numbers with no currency marker.
  const INR_RE = new RegExp(
    '(?:₹\\s*|(?:Rs\\.?|INR)\\s*)' +       // prefix: ₹ / Rs. / Rs / INR
    '(?:(?:[0-9]{1,3}(?:[,][0-9]{2,3})+|[0-9]+)(?:[.][0-9]{1,2})?)' + // number
    '(?:\\s*[kKlLmMbB]+|\\s*Cr)?' + // optional suffix L, k, Cr, etc
    '(?!\\w)' + // not followed by another letter/digit
    '|' +
    '(?:(?:[0-9]{1,3}(?:[,][0-9]{2,3})+|[0-9]+)(?:[.][0-9]{1,2})?)' + // number (suffix form)
    '(?:\\s*(?:INR|Rs\\.?))(?![0-9])',       // suffix: INR / Rs.
    'gi'
  );

  // Extracts the numeric part from a matched price string
  const NUM_RE = /((?:[0-9]{1,3}(?:[,][0-9]{2,3})+|[0-9]+)(?:\.[0-9]{1,2})?)/;

  // ─── Normalise Indian number format ──────────────────────────────────────────
  // Handles: 1,234  1,23,456  1,234.50
  function parseINR(str) {
    // Strip commas (Indian grouping uses commas only, no dots as thousands sep)
    const clean = str.replace(/,/g, '');
    const n = parseFloat(clean);
    return isNaN(n) ? NaN : n;
  }

  // ─── Smart rounding for INR price ranges ─────────────────────────────────────
  // Tuned for typical Indian e-commerce prices
  function smartRound(n) {
    if (isNaN(n) || n <= 0) return n;
    if (n < 10) return Math.round(n);            // ₹7.5  → ₹8
    if (n < 100) return Math.round(n / 5) * 5;    // ₹67   → ₹65
    if (n < 1000) return Math.round(n / 10) * 10;  // ₹349  → ₹350
    if (n < 10000) return Math.round(n / 100) * 100; // ₹1,249 → ₹1,200
    if (n < 1e5) return Math.round(n / 500) * 500; // ₹24,999 → ₹25,000
    return Math.round(n / 1000) * 1000;                // ₹1,19,990 → ₹1,20,000
  }

  // ─── Format back with Indian comma grouping ───────────────────────────────────
  // 120000 → "1,20,000"   12500 → "12,500"
  function formatINR(n) {
    const s = String(Math.round(n));
    if (s.length <= 3) return s;
    // Last 3 digits, then groups of 2
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    const groups = [];
    let i = rest.length;
    while (i > 0) {
      groups.unshift(rest.slice(Math.max(0, i - 2), i));
      i -= 2;
    }
    return [...groups, last3].join(',');
  }

  // ─── Compact formatting for Round++ mode ─────────────────────────────────────
  // 2899 → "2.9k"   24999 → "25k"   119990 → "1.2L"
  function formatCompactINR(n) {
    if (isNaN(n) || n <= 0) return String(n);
    if (n < 995) {
      return formatINR(smartRound(n));
    }
    if (n < 99500) {
      const k = Math.round((n / 1000) * 10) / 10;
      return `${k}k`;
    }
    if (n < 99500000) {
      const l = Math.round((n / 100000) * 100) / 100;
      return `${l}L`;
    }
    const cr = Math.round((n / 10000000) * 100) / 100;
    return `${cr}Cr`;
  }

  // Unified price formatter based on current active mode
  let currentMode = 'round'; // 'round' or 'round_plus'

  function formatPrice(n, mode = currentMode) {
    if (mode === 'round_plus') {
      return formatCompactINR(n);
    }
    return formatINR(smartRound(n));
  }

  // Tracking maps for live reversible mode switching
  const trackedSingleNodes = new Map();     // Node -> { originalText, parentEl }
  const trackedCompositeElements = new Map(); // Element -> Array<{ node, originalValue }>

  // ─── Floating Tooltip for Hover Reveal ────────────────────────────────────────
  let tooltipEl = null;
  let tooltipInitialized = false;

  function getOrCreateTooltip() {
    if (!tooltipEl && document.body) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'price-rounder-tooltip';
      tooltipEl.style.cssText = [
        'position: fixed',
        'z-index: 2147483647',
        'background: #0f172a',
        'color: #f8fafc',
        'padding: 5px 10px',
        'border-radius: 6px',
        'font-size: 12px',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'font-weight: 600',
        'line-height: 1.2',
        'pointer-events: none',
        'box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25)',
        'border: 1px solid rgba(255, 255, 255, 0.15)',
        'transition: opacity 0.12s ease-out, transform 0.12s ease-out',
        'opacity: 0',
        'transform: translateY(4px)',
        'white-space: nowrap',
        'display: none'
      ].join(';');
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }

  function showTooltip(target, text) {
    const tip = getOrCreateTooltip();
    if (!tip) return;
    tip.textContent = text;
    tip.style.display = 'block';

    const rect = target.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();

    let top = rect.top - tipRect.height - 8;
    let left = rect.left + (rect.width - tipRect.width) / 2;

    if (top < 6) {
      top = rect.bottom + 8;
    }

    if (left < 6) left = 6;
    if (left + tipRect.width > window.innerWidth - 6) {
      left = window.innerWidth - tipRect.width - 6;
    }

    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
    requestAnimationFrame(() => {
      tip.style.opacity = '1';
      tip.style.transform = 'translateY(0)';
    });
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.style.opacity = '0';
      tooltipEl.style.transform = 'translateY(4px)';
      setTimeout(() => {
        if (tooltipEl && tooltipEl.style.opacity === '0') {
          tooltipEl.style.display = 'none';
        }
      }, 150);
    }
  }

  function initTooltipEvents() {
    if (tooltipInitialized) return;
    tooltipInitialized = true;

    document.addEventListener('mouseover', (e) => {
      const target = e.target && e.target.closest && e.target.closest('[data-price-rounder-original]');
      if (target) {
        const val = target.getAttribute('data-price-rounder-original');
        if (val) showTooltip(target, val);
      }
    }, true);

    document.addEventListener('mouseout', (e) => {
      const target = e.target && e.target.closest && e.target.closest('[data-price-rounder-original]');
      if (target) {
        if (e.relatedTarget && target.contains(e.relatedTarget)) {
          return;
        }
        hideTooltip();
      }
    }, true);

    window.addEventListener('scroll', hideTooltip, { passive: true });
  }

  function applyMode(newMode) {
    if (!newMode || newMode === currentMode) return;
    log('switching mode from', currentMode, 'to', newMode);
    currentMode = newMode;
    hideTooltip();

    // 1. Revert single nodes to original text
    for (const [node, info] of trackedSingleNodes.entries()) {
      if (!node.isConnected) {
        trackedSingleNodes.delete(node);
        continue;
      }
      node.nodeValue = info.originalText;
      if (info.parentEl) {
        info.parentEl.removeAttribute('data-price-rounder-original');
      }
      seen.delete(node);
    }

    // 2. Revert composite elements to original values
    for (const [el, snapshot] of trackedCompositeElements.entries()) {
      if (!el.isConnected) {
        trackedCompositeElements.delete(el);
        continue;
      }
      for (const item of snapshot) {
        if (item.node.isConnected) {
          item.node.nodeValue = item.originalValue;
          seen.delete(item.node);
        }
      }
      el.removeAttribute('data-price-rounder-original');
      processedEls.delete(el);
    }

    // 3. Re-scan document to apply new formatting
    walk(document.body);
  }


  // ─── Generic composite-span price handling ───────────────────────────────────
  //
  // The core idea:
  //   1. For every element we visit, collect its LEAF text nodes in order.
  //   2. Build a virtual "composite string" by joining their values, keeping a
  //      map of [compositeOffset → textNode + localOffset] for every character.
  //   3. Run INR_RE over the composite string.
  //   4. For each match, find which text node(s) hold the NUMBER part and
  //      rewrite only those nodes — leaving symbol-only nodes untouched.
  //
  // This works for any split across any number of spans, regardless of nesting.
  // e.g. <b>₹</b><span> 1,</span><span>299</span>.00  →  rounds 1299 in-place.

  const SKIP_TAGS = new Set(['script', 'style', 'input', 'textarea', 'noscript', 'svg', 'code', 'pre']);

  // Collect all leaf text nodes under `el` in DOM order, skipping SKIP_TAGS.
  function leafTextNodes(el) {
    const nodes = [];
    const walker = document.createTreeWalker(
      el,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(n) {
          if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
          const tag = n.parentElement?.tagName?.toLowerCase();
          if (!tag || SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  }

  // Build composite string + offset map from a list of text nodes.
  // Returns { composite: string, map: Array<{node, localIndex}> }
  function buildComposite(nodes) {
    let composite = '';
    const map = []; // map[compositeIndex] = { node, localIndex }
    for (const node of nodes) {
      const val = node.nodeValue;
      for (let i = 0; i < val.length; i++) {
        map.push({ node, localIndex: i });
        composite += val[i];
      }
    }
    return { composite, map };
  }

  // Given a match inside composite + its map, rewrite only the NUMBER span.
  // `matchStart` = index of match in composite, `numStr` = the number substring.
  function rewriteNumberInNodes(composite, map, matchStart, numStr, formatted) {
    // Find where numStr starts inside the match (it may be offset by ₹/space)
    const numOffset = composite.indexOf(numStr, matchStart);
    if (numOffset === -1) return false;

    // Group consecutive characters that belong to the same text node
    // for the span [numOffset .. numOffset + numStr.length - 1]
    const segments = new Map(); // node → { node, start, end } in local coords
    for (let i = 0; i < numStr.length; i++) {
      const { node, localIndex } = map[numOffset + i];
      if (!segments.has(node)) {
        segments.set(node, { node, start: localIndex, end: localIndex });
      } else {
        segments.get(node).end = localIndex;
      }
    }

    // We only handle the common case where the number lives in ONE text node.
    // (Multi-node numbers like "1,2" split as "1," + "2" are extremely rare.)
    if (segments.size === 1) {
      const { node, start, end } = [...segments.values()][0];
      const val = node.nodeValue;
      const before = val.slice(0, start);
      const after = val.slice(end + 1);
      node.nodeValue = before + formatted + after;
      log('composite rewrite:', numStr, '→', formatted, 'in node:', JSON.stringify(val));
      return true;
    }

    // Multi-node number: concatenate all pieces into the FIRST node, clear the rest.
    const entries = [...segments.values()];
    const firstEntry = entries[0];
    const firstNode = firstEntry.node;
    const firstVal = firstNode.nodeValue;
    firstNode.nodeValue =
      firstVal.slice(0, firstEntry.start) + formatted + firstVal.slice(firstEntry.end + 1);
    for (let i = 1; i < entries.length; i++) {
      const e = entries[i];
      e.node.nodeValue = e.node.nodeValue.slice(0, e.start) + e.node.nodeValue.slice(e.end + 1);
    }
    log('composite multi-node rewrite:', numStr, '→', formatted);
    return true;
  }

  // ─── Process a container element (composite entry point) ─────────────────────
  const processedEls = new WeakSet();

  function processElement(el) {
    if (processedEls.has(el)) return;

    const nodes = leafTextNodes(el);
    if (!nodes.length) return;

    const { composite, map } = buildComposite(nodes);

    // Snapshot nodes before modifying for potential mode reversal
    const nodeSnapshots = nodes.map((n) => ({ node: n, originalValue: n.nodeValue }));

    INR_RE.lastIndex = 0;
    let anyChange = false;

    // We need to iterate matches on the *original* composite because rewriting
    // nodes changes nodeValue but not our map. Collect all matches first.
    const matches = [];
    let m;
    INR_RE.lastIndex = 0;
    while ((m = INR_RE.exec(composite)) !== null) {
      const nm = m[0].match(NUM_RE);
      if (!nm) continue;
      const numStr = nm[1];
      const original = parseINR(numStr);
      if (isNaN(original) || original === 0) continue;
      const formatted = formatPrice(original, currentMode);
      if (formatted === numStr) continue;
      matches.push({ matchStart: m.index, matchStr: m[0], numStr, formatted });
    }

    // Apply in reverse order so earlier offsets stay valid
    for (let i = matches.length - 1; i >= 0; i--) {
      const { matchStart, numStr, formatted } = matches[i];
      const changed = rewriteNumberInNodes(composite, map, matchStart, numStr, formatted);
      if (changed) anyChange = true;
    }

    if (anyChange) {
      log('processElement done, matches:', matches.length);
      processedEls.add(el);
      if (!trackedCompositeElements.has(el)) {
        trackedCompositeElements.set(el, nodeSnapshots);
      }
      const actualText = matches.map((m) => m.matchStr.trim()).join(', ');
      el.setAttribute('data-price-rounder-original', `Actual: ${actualText}`);
    }
  }

  // ─── Process one text node (fast path for single-node prices) ────────────────
  const seen = new WeakMap();

  function processNode(node) {
    const text = node.nodeValue;
    if (!text || !text.trim()) return;
    if (seen.get(node) === text) return;

    // Fast path: ₹ and number are in the SAME text node
    INR_RE.lastIndex = 0;
    if (INR_RE.test(text)) {
      INR_RE.lastIndex = 0;
      let hasChange = false;
      const originalMatches = [];
      const next = text.replace(INR_RE, (match) => {
        // If it already ends with L, k, M, B, Cr, skip re-rounding it to avoid corrupting it
        if (/(?:\s*)(?:[kKlLmMbB]|Cr)(?:\s*)$/i.test(match)) {
          return match;
        }
        
        const nm = match.match(NUM_RE);
        if (!nm) return match;
        const original = parseINR(nm[1]);
        if (isNaN(original) || original === 0) return match;
        const formatted = formatPrice(original, currentMode);
        if (formatted === nm[1]) return match;
        hasChange = true;
        originalMatches.push(match.trim());
        return match.replace(nm[1], formatted);
      });
      if (hasChange && next !== text) {
        log(text.trim(), '→', next.trim());
        const parentEl = (node.parentElement && node.parentElement !== document.body) ? node.parentElement : null;
        if (parentEl && originalMatches.length > 0) {
          parentEl.setAttribute('data-price-rounder-original', `Actual: ${originalMatches.join(', ')}`);
        }
        if (!trackedSingleNodes.has(node)) {
          trackedSingleNodes.set(node, { originalText: text, parentEl });
        }
        node.nodeValue = next;
        seen.set(node, next);
        return;
      }
    }

    seen.set(node, text);

    // Slow path: hand off to composite element processor
    // Walk up to find the nearest ancestor that could contain the full price
    // (stop at block-level or after 4 levels)
    const INLINE_TAGS = new Set(['span', 'b', 'strong', 'em', 'i', 'sup', 'sub', 'bdi', 'bdo', 's', 'del', 'ins', 'mark', 'small', 'label']);
    let el = node.parentElement;
    let prev = el;
    for (let depth = 0; depth < 4 && el; depth++) {
      const tag = el.tagName?.toLowerCase();
      if (!tag || !INLINE_TAGS.has(tag)) break;
      prev = el;
      el = el.parentElement;
    }
    // `prev` is the outermost inline ancestor — process its parent as the container
    const container = prev?.parentElement || prev;
    if (container) processElement(container);
  }

  // ─── TreeWalker scan with batching ───────────────────────────────────────────

  function walk(root) {
    if (!root) return;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
          const tag = node.parentElement?.tagName?.toLowerCase();
          if (!tag || SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    let count = 0;
    const BATCH = 400;

    while ((node = walker.nextNode())) {
      processNode(node);
      if (++count >= BATCH) {
        setTimeout(() => walk(root), 0);
        return;
      }
    }
  }

  // ─── MutationObserver for dynamic content (SPA / infinite scroll) ─────────────
  function observe() {
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') {
          processNode(m.target);
        } else {
          for (const n of m.addedNodes) {
            if (n.nodeType === Node.TEXT_NODE) processNode(n);
            else if (n.nodeType === Node.ELEMENT_NODE) walk(n);
          }
        }
      }
    });

    mo.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    log('init with mode:', currentMode);
    initTooltipEvents();
    walk(document.body);
    observe();

    // Catch lazy-loaded prices (Flipkart, Amazon lazy sections, etc.)
    setTimeout(() => walk(document.body), 800);
    setTimeout(() => walk(document.body), 2000);
    setTimeout(() => walk(document.body), 5000);
  }

  // Load mode from storage & set up listeners
  function start() {
    const storage = typeof chrome !== 'undefined' && chrome.storage && (chrome.storage.sync || chrome.storage.local);
    if (storage) {
      storage.get({ priceRounderMode: 'round' }, (result) => {
        currentMode = result.priceRounderMode || 'round';
        init();
      });
    } else {
      init();
    }

    // Listen for storage changes across tabs
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes) => {
        if (changes.priceRounderMode) {
          applyMode(changes.priceRounderMode.newValue);
        }
      });
    }

    // Listen for direct messages from popup
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'UPDATE_PRICE_MODE') {
          applyMode(msg.mode);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // ─── Console test harness: call window.__INRRounder.test() ───────────────────
  function test() {
    const cases = [
      '₹1,234.50',          // Round: ₹1,200 | Round++: ₹1.2k
      '₹999',               // Round: ₹1,000 | Round++: ₹1k
      '₹49',                // Round: ₹50    | Round++: ₹50
      '₹7.5',               // Round: ₹8     | Round++: ₹8
      'Rs.1,23,456',        // Round: Rs.1,23,000 | Round++: Rs.1.2L
      '24,999 INR',         // Round: 25,000 INR  | Round++: 25k INR
      '₹ 1,19,990',         // Round: ₹ 1,20,000  | Round++: ₹ 1.2L
      '₹ 2,899',            // Round: ₹ 2,900     | Round++: ₹ 2.9k
      '₹0.99',              // Round: ₹1     | Round++: ₹1
      'version v1.2.3',     // no change
      'park / kr / word',   // no change
    ];

    ['round', 'round_plus'].forEach((m) => {
      console.group(`[INRRounder] Tests (${m} mode)`);
      for (const c of cases) {
        INR_RE.lastIndex = 0;
        const out = c.replace(INR_RE, (match) => {
          const nm = match.match(NUM_RE);
          if (!nm) return match;
          const n = parseINR(nm[1]);
          if (isNaN(n) || n === 0) return match;
          const formatted = formatPrice(n, m);
          return formatted === nm[1] ? match : match.replace(nm[1], formatted);
        });
        console.log(c === out ? '  (no change)' : `  ✓`, c, '→', out);
      }
      console.groupEnd();
    });
  }

  window.__INRRounder = {
    test,
    parseINR,
    smartRound,
    formatINR,
    formatCompactINR,
    formatPrice,
    getMode: () => currentMode,
    setMode: applyMode
  };
  log('loaded');
})();