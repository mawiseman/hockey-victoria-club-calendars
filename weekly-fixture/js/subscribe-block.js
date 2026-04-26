// Shared "subscribe instructions" accordion used by both subscribe.html and
// the per-team view on index.html. Loaded as a plain script — exposes its
// builders on `window` so non-module scripts can call them.

(function () {
    /**
     * Build a collapsible <details> block that explains how to subscribe
     * to a Google Calendar via the web link or via iOS Calendar's iCal flow.
     * Visually signalled with a "TAP" hint + animated caret so it doesn't
     * read as a plain link.
     */
    function subscribeBlock(summaryText, googleUrl, icalUrl) {
        const details = document.createElement('details');
        details.className = 'subscribe-details';

        const sum = document.createElement('summary');

        const label = document.createElement('span');
        label.className = 'summary-label';
        label.textContent = `📲 ${summaryText}`;
        sum.appendChild(label);

        const hint = document.createElement('span');
        hint.className = 'summary-hint';
        hint.textContent = 'Tap';
        sum.appendChild(hint);

        const caret = document.createElement('span');
        caret.className = 'summary-caret';
        caret.setAttribute('aria-hidden', 'true');
        caret.textContent = '▾';
        sum.appendChild(caret);

        details.appendChild(sum);

        const body = document.createElement('div');
        body.className = 'subscribe-body';

        if (googleUrl) {
            body.appendChild(instructionBlock('Google Calendar', [
                'Open the ',
                linkInline(googleUrl, 'Google Calendar link'),
                ' and tap ',
                boldInline('+'),
                ' (mobile) or ',
                boldInline('Add to Google Calendar'),
                ' (desktop).',
            ]));
        }

        if (icalUrl) {
            body.appendChild(instructionBlock('iOS Calendar', [
                'Go to ',
                boldInline('Settings > Calendar > Accounts'),
                ', tap ',
                boldInline('Add Account > Other > Add Subscribed Calendar'),
                ', and paste the ',
                linkInline(icalUrl, 'iCal link'),
                '.',
            ]));
        }

        details.appendChild(body);
        return details;
    }

    function instructionBlock(title, parts) {
        const block = document.createElement('div');
        block.className = 'instruction';

        const h = document.createElement('div');
        h.className = 'instruction-title';
        h.textContent = title;
        block.appendChild(h);

        const p = document.createElement('p');
        for (const part of parts) {
            if (typeof part === 'string') p.appendChild(document.createTextNode(part));
            else p.appendChild(part);
        }
        block.appendChild(p);
        return block;
    }

    function linkInline(href, text) {
        const a = document.createElement('a');
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = text;
        return a;
    }

    function boldInline(text) {
        const s = document.createElement('strong');
        s.textContent = text;
        return s;
    }

    window.subscribeBlock = subscribeBlock;
    window.subscribeInstructionBlock = instructionBlock;
    window.subscribeLinkInline = linkInline;
    window.subscribeBoldInline = boldInline;
})();
