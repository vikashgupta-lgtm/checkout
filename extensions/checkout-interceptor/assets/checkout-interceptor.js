/**
 * Checkout Interceptor Script
 * This script intercepts all checkout attempts and redirects customers to
 * our custom checkout page hosted on our Remix app.
 */

(function () {
  'use strict';

  // The URL of your custom checkout. This will be injected by Liquid.
  const CUSTOM_CHECKOUT_URL = window.__customCheckoutUrl || '';

  // Block form submissions that go to Shopify checkout
  function interceptCheckoutForms() {
    document.querySelectorAll('form[action="/checkout"]').forEach(function (form) {
      if (form.dataset.intercepted) return;
      form.dataset.intercepted = 'true';

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        redirectToCustomCheckout();
      });
    });
  }

  // Block anchor links that go directly to /checkout
  function interceptCheckoutLinks() {
    document.querySelectorAll('a[href*="/checkout"]').forEach(function (link) {
      if (link.dataset.intercepted) return;
      link.dataset.intercepted = 'true';

      link.addEventListener('click', function (e) {
        e.preventDefault();
        redirectToCustomCheckout();
      });
    });
  }

  // Block buttons with checkout-related text or attributes
  function interceptCheckoutButtons() {
    const selectors = [
      'button[name="checkout"]',
      'input[name="checkout"]',
      '.cart__checkout-button',
      '.cart-checkout-button',
      '[data-testid="cart-checkout-button"]',
      '.shopify-payment-button',
    ];

    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (btn) {
        if (btn.dataset.intercepted) return;
        btn.dataset.intercepted = 'true';

        btn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          redirectToCustomCheckout();
        });
      });
    });
  }

  async function redirectToCustomCheckout() {
    // Show a brief loading state
    showLoadingOverlay();

    try {
      // Fetch the full cart data from Shopify's AJAX API
      const res = await fetch('/cart.js');
      const cart = await res.json();

      if (!cart || !cart.token) {
        hideLoadingOverlay();
        alert('Unable to read cart. Please try again.');
        return;
      }

      // Encode full cart data as base64 to pass in URL (avoids needing Storefront API)
      const cartDataEncoded = btoa(unescape(encodeURIComponent(JSON.stringify(cart))));
      const shop = encodeURIComponent(window.__shopifyShop || window.location.hostname);

      // Build the custom checkout URL
      const checkoutUrl = CUSTOM_CHECKOUT_URL + '?cartData=' + encodeURIComponent(cartDataEncoded) + '&shop=' + shop;
      window.location.href = checkoutUrl;
    } catch (err) {
      console.error('Checkout interceptor error:', err);
      hideLoadingOverlay();
      // Fallback to native Shopify checkout if our app fails
      window.location.href = '/checkout';
    }
  }

  function showLoadingOverlay() {
    const existing = document.getElementById('custom-checkout-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.id = 'custom-checkout-overlay';
    overlay.innerHTML = `
      <div style="
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); z-index: 9999;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: white; font-family: sans-serif;
      ">
        <div style="
          border: 4px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          width: 48px; height: 48px;
          animation: spin 0.8s linear infinite;
          margin-bottom: 16px;
        "></div>
        <p style="font-size: 18px; font-weight: 500; margin: 0;">Taking you to secure checkout...</p>
        <style>
          @keyframes spin { to { transform: rotate(360deg); } }
        </style>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById('custom-checkout-overlay');
    if (overlay) overlay.remove();
  }

  // Run interceptors and re-run when DOM changes (SPA / dynamic cart drawers)
  function init() {
    interceptCheckoutForms();
    interceptCheckoutLinks();
    interceptCheckoutButtons();
  }

  // Initial run
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-run on DOM mutations (e.g. cart drawer opens dynamically)
  const observer = new MutationObserver(function () {
    init();
  });
  observer.observe(document.body, { childList: true, subtree: true });

})();
