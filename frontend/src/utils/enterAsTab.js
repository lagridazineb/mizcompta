
function isEligible(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return false;
  if (tag === 'BUTTON' || tag === 'A') return false;
  if (el.dataset && el.dataset.enterSubmit === 'true') return false;
  if (el.getAttribute && el.getAttribute('aria-expanded') === 'true') return false;
  if (tag === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (['submit', 'button', 'checkbox', 'radio', 'file'].includes(type)) return false;
  }
  return tag === 'INPUT' || tag === 'SELECT';
}

function focusableFields(root) {
  const selector = [
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'button:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');
  return Array.from(root.querySelectorAll(selector)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  );
}

function focusNextField(current) {
  // On cherche parmi tous les champs visibles de la page (pas seulement dans
  // le <form> le plus proche, car beaucoup de pages de saisie n'utilisent pas
  // de balise <form> autour du tableau de saisie).
  const container = current.closest('form') || document.body;
  const fields = focusableFields(container);
  const index = fields.indexOf(current);
  if (index === -1) return false;
  for (let i = index + 1; i < fields.length; i += 1) {
    const next = fields[i];
    next.focus();
    if (typeof next.select === 'function' && next.tagName === 'INPUT') {
      next.select();
    }
    return true;
  }
  return false;
}

export function installEnterAsTab() {
  const handler = (event) => {
    if (event.key !== 'Enter') return;
    const el = event.target;
    if (!isEligible(el)) return;
    // Ctrl/Cmd/Shift+Entrée : on laisse le comportement natif (ex. validation
    // explicite d'un formulaire).
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    focusNextField(el);
  };
  document.addEventListener('keydown', handler, true);
  return () => document.removeEventListener('keydown', handler, true);
}
