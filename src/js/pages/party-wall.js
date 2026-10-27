/*
 * Corelain — Party Wall area pages (party-wall-surveyors/<area>).
 * Static pages; this only adds UTM tags and CTA tracking.
 */
import { initTracking } from './track.js';

const init = () => initTracking('pw-' + (location.pathname.split('/').pop().replace(/\.html$/, '') || 'trafford'));

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
