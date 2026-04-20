/**
 * Shared Puppeteer navigation utilities.
 */

export class HttpError extends Error {
    constructor(status, url) {
        super(`HTTP ${status} for ${url}`);
        this.name = 'HttpError';
        this.status = status;
        this.url = url;
    }
}

/**
 * Navigate to a URL and verify a 2xx response. Throws HttpError on non-2xx.
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {import('puppeteer').WaitForOptions} [options]
 */
export async function safeGoto(page, url, options = {}) {
    const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        ...options
    });

    if (!response) {
        throw new Error(`No response received for ${url}`);
    }

    const status = response.status();
    if (status < 200 || status >= 300) {
        throw new HttpError(status, url);
    }

    return response;
}
