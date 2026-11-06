# RoundFigure: Shopping Price Rounder

A lightweight Google Chrome Extension (Manifest V3) that counters deceptive psychological pricing (.99, 999) on e-commerce shopping websites by automatically rounding and simplifying product prices into cleaner, human-friendly formats.

## Features & Automatic Rounding

RoundFigure automatically rounds prices on e-commerce shopping websites to the nearest readable whole number:
- **Automatic & Instant**: No configuration or mode switching required. Works out of the box.
- **Tiered Smart Rounding**:
  - `₹2,899` → `₹2,900`
  - `₹349` → `₹350`
  - `₹24,999` → `₹25,000`
  - `₹1,19,990` → `₹1,20,000`
  - `₹2,49,990` → `₹2,50,000`

## Built for Safe Shopping

- **Smart E-Commerce Keyword Detection**: Scans for keywords like `shop`, `cart`, `store`, `buy`, `product`, `item`, `deal`, `sale` across URLs, page elements, and content. Non-shopping sites remain completely untouched.
- **Payment & Checkout Protection**: Automatically preserves exact pricing on checkout, billing, and payment screens.

## Installation & Testing

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked** and select this directory.
4. Open [test_page.html](test_page.html) or any e-commerce website (e.g., Amazon.in, Flipkart, Google Shopping).
5. The extension automatically detects shopping sites and rounds prices without any manual setup!

