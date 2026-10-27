/*
 * Corelain — lead tracking (MKT-01 "measurable performance").
 *
 * 1. Every link to corelain.com gets UTM tags, so enquiries in Corelain's own
 *    analytics show which area and which button they came from:
 *      utm_source=corelain-radar · utm_medium=referral
 *      utm_campaign=<area id or page> · utm_content=<data-cr-cta or "link">
 * 2. Clicks on CTAs (data-cr-cta), corelain.com links and phone links are sent
 *    as a "cta_click" event to whichever analytics is switched on in .env
 *    (Vercel Web Analytics and/or GA4). With neither, nothing is sent.
 * 3. GA4 only: a small consent banner. No analytics cookies until "Accept".
 */
const AUDIENCE = [
  [/^homeowner|^sponsored|^area-page/, 'homeowner'],
  [/^pro-/, 'professional'],
  [/^adjoining/, 'adjoining-owner'],
];
const audienceOf = (placement) => (AUDIENCE.find(([re]) => re.test(placement)) || [, 'general'])[1];

function send(name, data) {
  try { if (typeof window.va === 'function') window.va('event', { name, data }); } catch {}
  try { if (typeof window.gtag === 'function') window.gtag('event', name, data); } catch {}
}

function tagLinks(campaign) {
  document.querySelectorAll('a[href*="corelain.com"]').forEach((a) => {
    try {
      const url = new URL(a.href);
      url.searchParams.set('utm_source', 'corelain-radar');
      url.searchParams.set('utm_medium', 'referral');
      url.searchParams.set('utm_campaign', campaign);
      url.searchParams.set('utm_content', a.dataset.crCta || 'link');
      a.href = url.toString();
    } catch {}
  });
}

function listenClicks(campaign) {
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    const isLead = a.dataset.crCta || /corelain\.com/.test(a.href) || a.href.startsWith('tel:');
    if (!isLead) return;
    const placement = a.dataset.crCta || (a.href.startsWith('tel:') ? 'phone' : 'link');
    send(a.href.startsWith('tel:') ? 'phone_click' : 'cta_click', {
      placement, audience: audienceOf(placement), area: campaign, page: location.pathname,
    });
  });
}

function consentBanner() {
  if (!window.crGaId || typeof window.gtag !== 'function') return;
  let choice = null;
  try { choice = localStorage.getItem('cr:consent'); } catch {}
  if (choice) return;
  const box = document.createElement('div');
  box.className = 'cr-consent';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Cookie consent');
  box.innerHTML = `
    <p>We use analytics cookies to see which pages and areas help people. No advertising cookies.</p>
    <div class="cr-consent__btns">
      <button type="button" class="ax-btn ax-btn--ghost ax-btn--sm" data-v="denied">Decline</button>
      <button type="button" class="ax-btn ax-btn--primary ax-btn--sm" data-v="granted">Accept</button>
    </div>`;
  box.addEventListener('click', (ev) => {
    const v = ev.target.closest('button')?.dataset.v;
    if (!v) return;
    try { localStorage.setItem('cr:consent', v); } catch {}
    window.gtag('consent', 'update', { analytics_storage: v });
    // Clarity is held back until this moment; on a later visit the head loads it.
    if (v === 'granted' && typeof window.crLoadClarity === 'function') window.crLoadClarity();
    box.remove();
  });
  document.body.appendChild(box);
}

export function initTracking(campaign) {
  tagLinks(campaign);
  listenClicks(campaign);
  consentBanner();
}
