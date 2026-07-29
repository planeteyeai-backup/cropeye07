/**
 * Production shield: Google Translate (Kannada) rewrites Manager Farm Dashboard
 * <select>/<option> DOM and fires fake change events.
 *
 * Only lock interactive form controls + Leaflet map panes — NOT labels/cards/text,
 * so Google Translate can still translate "Field Officer", "Plantation Date", etc.
 */

export const MANAGER_FARM_DASH_ATTR = "data-manager-farm-dash";

function markNoTranslate(el: Element): void {
  el.classList.add("notranslate");
  el.setAttribute("translate", "no");
}

/** Unwrap <font> nodes Google injects inside selects (breaks option values). */
function unwrapGoogleFontTags(scope: Element): void {
  scope.querySelectorAll("select font, option font").forEach((font) => {
    const parent = font.parentNode;
    if (!parent) return;
    while (font.firstChild) parent.insertBefore(font.firstChild, font);
    parent.removeChild(font);
  });
}

export function protectManagerFarmDashSubtree(scope: Element): void {
  // Do NOT mark the whole dashboard notranslate — that blocks Kannada for labels.
  scope
    .querySelectorAll(
      "select, option, input, textarea, .leaflet-container, .leaflet-pane, .leaflet-control-container",
    )
    .forEach(markNoTranslate);
  unwrapGoogleFontTags(scope);
}

/** Force DOM select value back to React lock when Translate desyncs it. */
export function syncManagerDashSelectLocks(scope: Element): void {
  scope.querySelectorAll("select[data-gt-lock]").forEach((node) => {
    const sel = node as HTMLSelectElement;
    const expected = sel.getAttribute("data-gt-lock") ?? "";
    if (sel.value !== expected) {
      sel.value = expected;
    }
  });
}

export function protectAllManagerFarmDashRoots(
  doc: ParentNode = document,
): void {
  const roots = doc.querySelectorAll(`[${MANAGER_FARM_DASH_ATTR}]`);
  roots.forEach((root) => {
    protectManagerFarmDashSubtree(root as Element);
    syncManagerDashSelectLocks(root as Element);
  });
}
