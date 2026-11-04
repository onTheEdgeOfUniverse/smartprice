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

  // Single unified price formatter (Auto-rounds to nearest whole number)
  function formatPrice(n) {
    return formatINR(smartRound(n));
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

  // ─── Site Specific Scopes & Target Selectors ───────────────────────────────────
  const isGoogle = typeof window !== 'undefined' && (
    window.location.hostname.includes('google.') ||
    window.location.hostname === 'google'
  );

  // Target selectors for product search cards on Google:
  // 1. .pla-unit (PLA / shopping ad card)
  // 2. [jsname="uc35if"] / .wOPJ9c (Google Shopping organic/stream product card)
  const GOOGLE_PRODUCT_CARD_SELECTOR = '[jsname="uc35if"], .pla-unit, [class*="pla-unit"], .wOPJ9c, [data-ssid="pve-STREAM_PIU"]';

  function isAllowedOnThisPage(node) {
    if (!isGoogle) return true;
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(el && el.closest(GOOGLE_PRODUCT_CARD_SELECTOR));
  }

  // ─── Process a container element (composite entry point) ─────────────────────
  const processedEls = new WeakSet();

  function processElement(el) {
    if (processedEls.has(el)) return;
    if (!isAllowedOnThisPage(el)) return;

    const nodes = leafTextNodes(el);
    if (!nodes.length) return;

    const { composite, map } = buildComposite(nodes);

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
      const formatted = formatPrice(original);
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
    }
  }

  // ─── Process one text node (fast path for single-node prices) ────────────────
  const seen = new WeakMap();

  function processNode(node) {
    if (!isAllowedOnThisPage(node)) return;
    const text = node.nodeValue;
    if (!text || !text.trim()) return;
    if (seen.get(node) === text) return;

    // Fast path: ₹ and number are in the SAME text node
    INR_RE.lastIndex = 0;
    if (INR_RE.test(text)) {
      INR_RE.lastIndex = 0;
      let hasChange = false;
      const next = text.replace(INR_RE, (match) => {
        // If it already ends with L, k, M, B, Cr, skip re-rounding it to avoid corrupting it
        if (/(?:\s*)(?:[kKlLmMbB]|Cr)(?:\s*)$/i.test(match)) {
          return match;
        }
        
        const nm = match.match(NUM_RE);
        if (!nm) return match;
        const original = parseINR(nm[1]);
        if (isNaN(original) || original === 0) return match;
        const formatted = formatPrice(original);
        if (formatted === nm[1]) return match;
        hasChange = true;
        return match.replace(nm[1], formatted);
      });
      if (hasChange && next !== text) {
        log(text.trim(), '→', next.trim());
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

  function walkTree(root) {
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
        setTimeout(() => walkTree(root), 0);
        return;
      }
    }
  }

  function walk(root) {
    if (!root) return;
    if (isCheckoutOrCartPage()) return;
    if (isGoogle) {
      if (root === document.body) {
        const cards = document.querySelectorAll(GOOGLE_PRODUCT_CARD_SELECTOR);
        for (const card of cards) {
          walkTree(card);
        }
        return;
      }
      if (root.nodeType === Node.ELEMENT_NODE) {
        if (root.matches && root.matches(GOOGLE_PRODUCT_CARD_SELECTOR)) {
          walkTree(root);
          return;
        }
        if (root.closest && root.closest(GOOGLE_PRODUCT_CARD_SELECTOR)) {
          walkTree(root);
          return;
        }
        if (root.querySelectorAll) {
          const cards = root.querySelectorAll(GOOGLE_PRODUCT_CARD_SELECTOR);
          if (cards.length > 0) {
            for (const card of cards) {
              walkTree(card);
            }
            return;
          }
        }
      }
      return;
    }
    walkTree(root);
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

  // ─── Checkout & Payment Exclusion (Only final payment steps) ─────────────
  function isCheckoutOrCartPage() {
    if (typeof window === 'undefined' || !window.location) return false;
    const url = window.location.href.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();

    // Never disable on Google search results
    if (hostname.includes('google.') && pathname.startsWith('/search')) {
      return false;
    }

    // Exclude only final payment steps, NOT the cart!
    const checkoutPatterns = [
      '/checkout', '/payment', '/billing', '/pay/', 'step=payment', 'action=payment', 'pay.google.com'
    ];
    return checkoutPatterns.some(pattern => url.includes(pattern));
  }

  // ─── Shopping Site & Product Detection Strategy ──────────────────────────────
  let isShoppingSiteVerified = false;

  function isShoppingPage() {
    if (isShoppingSiteVerified) return true;
    if (typeof window === 'undefined' || !window.location) return false;

    const href = window.location.href.toLowerCase();
    const hostname = window.location.hostname.toLowerCase();
    const pathname = window.location.pathname.toLowerCase();

    // 0. Local test harness support (file:// or localhost test_page.html)
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || href.startsWith('file:')) {
      isShoppingSiteVerified = true;
      return true;
    }

    // 1. Google search / shopping with product cards
    if (hostname.includes('google.')) {
      if (document.querySelector(GOOGLE_PRODUCT_CARD_SELECTOR) || pathname.startsWith('/search') || pathname.startsWith('/shopping')) {
        isShoppingSiteVerified = true;
        return true;
      }
      return false;
    }

    // 2. Shopping keywords in URL (e.g. shop, cart, store, buy, product, item, deal, sale, etc.)
    const URL_KEYWORDS = [
      'shop', 'cart', 'store', 'buy', 'product', 'item', 'order',
      'deal', 'sale', 'bazaar', 'mall', 'mart', 'catalog', 'collection', 'goods', 'price'
    ];
    if (URL_KEYWORDS.some(kw => href.includes(kw))) {
      isShoppingSiteVerified = true;
      return true;
    }

    // 3. Known e-commerce & retail marketplaces / brand stores
    const SHOPPING_DOMAINS = [
      'amazon.', 'flipkart.com', 'myntra.com', 'meesho.com', 'ajio.com',
      'nykaa.com', 'tatacliq.com', 'reliancedigital.in', 'croma.com',
      'snapdeal.com', 'ebay.', 'etsy.com', 'aliexpress.com', 'walmart.com',
      'target.com', 'bestbuy.com', 'one8.com', 'puma.com', 'nike.com',
      'adidas.', 'boat-lifestyle.com', 'gonoise.com', 'noise.com',
      'zara.com', 'hm.com', 'bewakoof.com', 'lenskart.com', 'firstcry.com',
      'jiomart.com', 'blinkit.com', 'zeptonow.com', 'bigbasket.com',
      'swiggy.com', 'zomato.com', 'shopify.com', 'myshopify.com'
    ];
    if (SHOPPING_DOMAINS.some(domain => hostname.includes(domain))) {
      isShoppingSiteVerified = true;
      return true;
    }

    // 4. Shopping buttons or elements on the page (cart, buy, bag, order buttons)
    if (document.querySelector(
      '[id*="cart" i], [class*="cart" i], [id*="buy" i], [class*="buy" i], [id*="bag" i], [class*="bag" i], [aria-label*="cart" i], [aria-label*="bag" i], [data-testid*="cart" i], [data-testid*="buy" i]'
    )) {
      isShoppingSiteVerified = true;
      return true;
    }

    // 5. Page content shopping keywords
    const bodyText = (document.body ? document.body.innerText || document.body.textContent || '' : '').slice(0, 20000).toLowerCase();
    const CONTENT_KEYWORDS = [
      'add to cart', 'buy now', 'shopping cart', 'in stock', 'out of stock',
      'add to bag', 'shopping bag', 'free delivery', 'order now', 'm.r.p', 'mrp:'
    ];
    if (CONTENT_KEYWORDS.some(kw => bodyText.includes(kw))) {
      isShoppingSiteVerified = true;
      return true;
    }

    // 6. Meta / Schema tags
    if (document.querySelector('meta[property="og:type"][content*="product"], meta[property="product:price:amount"], meta[itemprop="price"], meta[property="og:price:amount"]')) {
      isShoppingSiteVerified = true;
      return true;
    }

    return false;
  }

  // ─── Execution Runner ────────────────────────────────────────────────────────
  function checkAndWalk() {
    if (isCheckoutOrCartPage()) return;
    if (isShoppingPage()) {
      walk(document.body);
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    log('CleanPrice initialized — Auto-Round Active');
    checkAndWalk();
    observe();

    // Re-check periodically for lazy-loaded content or dynamically rendered shopping elements
    setTimeout(checkAndWalk, 400);
    setTimeout(checkAndWalk, 1200);
    setTimeout(checkAndWalk, 2500);
    setTimeout(checkAndWalk, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── Console test harness: call window.__INRRounder.test() ───────────────────
  function test() {
    const cases = [
      '₹1,234.50',          // ₹1,200
      '₹999',               // ₹1,000
      '₹49',                // ₹50
      '₹7.5',               // ₹8
      'Rs.1,23,456',        // Rs.1,23,000
      '24,999 INR',         // 25,000 INR
      '₹ 1,19,990',         // ₹ 1,20,000
      '₹ 2,899',            // ₹ 2,900
      '₹0.99',              // ₹1
      'version v1.2.3',     // no change
      'park / kr / word',   // no change
    ];

    console.group('[CleanPrice] Auto-Round Tests');
    for (const c of cases) {
      INR_RE.lastIndex = 0;
      const out = c.replace(INR_RE, (match) => {
        const nm = match.match(NUM_RE);
        if (!nm) return match;
        const n = parseINR(nm[1]);
        if (isNaN(n) || n === 0) return match;
        const formatted = formatPrice(n);
        return formatted === nm[1] ? match : match.replace(nm[1], formatted);
      });
      console.log(c === out ? '  (no change)' : `  ✓`, c, '→', out);
    }
    console.groupEnd();
  }

  window.__CleanPrice = {
    test,
    parseINR,
    smartRound,
    formatINR,
    formatPrice,
    isShoppingPage: () => isShoppingSiteVerified
  };
  log('loaded');
})();