# CleanPrice: Shopping Price Rounder

A lightweight Google Chrome Extension (Manifest V3) that counters deceptive psychological pricing (.99, 999) on e-commerce shopping websites by automatically rounding and simplifying product prices into cleaner, human-friendly formats.

## Features & Modes

Click the CleanPrice extension icon in your Chrome toolbar to open the settings popup and switch between:

1. **Round (Standard)**:
   - Rounds prices to the nearest readable whole number using tiered thresholds.
   - Example: `₹2,899` → `₹2,900`, `₹349` → `₹350`, `₹24,999` → `₹25,000`.

2. **Round++ (Compact)**:
   - Formats prices using compact human-readable notation (`k`, `L`, `Cr`).
   - Example: `₹2,899` → `₹2.9k`, `₹24,999` → `₹25k`, `₹1,19,990` → `₹1.2L`.

Changes take effect live across all open tabs without requiring a page refresh!

## Built for Safe Shopping

- **Smart E-Commerce Detection**: Only activates on shopping sites (Amazon, Flipkart, Myntra, Google Shopping, etc.) and product searches. Keeps non-shopping sites completely untouched.
- **Checkout & Cart Protection**: Automatically bypasses rounding on checkout, billing, and cart pages to guarantee you always see the exact payment amount.

## Installation & Testing

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** using the toggle in the top-right corner.
3. Click **Load unpacked** and select this directory.
4. Open [test_page.html](test_page.html) or any e-commerce website (e.g., Amazon.in, Flipkart, Google Shopping).
5. Click the CleanPrice extension icon in the toolbar to toggle between **Round** and **Round++**!
