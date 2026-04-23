// Google Analytics (GA4) — shared across all pages so the tracking ID only
// lives in one place. Include on a page with:
//   <script src="/js/analytics.js" defer></script>

(function () {
    const GA_ID = 'G-98P3JQLSNF';

    // Load gtag.js asynchronously so it doesn't block rendering.
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('js', new Date());
    gtag('config', GA_ID);
})();
