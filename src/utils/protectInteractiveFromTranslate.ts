/**
 * Google Translate (Hindi / Marathi / Kannada) injects <font> into Leaflet
 * panes and <select> options. Lock only those nodes. Buttons and KML modal
 * text must stay translatable.
 */

const INTERACTIVE_SELECTOR = [
  "select",
  "option",
  "input",
  "textarea",
  "[data-no-translate]",
  ".leaflet-container",
  ".leaflet-pane",
  ".leaflet-control-container",
  ".leaflet-draw",
  ".leaflet-draw-toolbar",
].join(",");

function markNoTranslate(el: Element): void {
  el.classList.add("notranslate");
  el.setAttribute("translate", "no");
}

function unwrapGoogleFontTags(root: ParentNode = document): void {
  root
    .querySelectorAll("select font, option font")
    .forEach((font) => {
      if (
        (font as Element).closest?.(
          ".leaflet-container, .plot-boundary-editor-map, .plot-boundary-modal, [data-no-translate]",
        )
      ) {
        return;
      }
      const parent = font.parentNode;
      if (!parent) return;
      while (font.firstChild) parent.insertBefore(font.firstChild, font);
      parent.removeChild(font);
    });
}

export function protectInteractiveFromTranslate(doc: ParentNode = document): void {
  doc.querySelectorAll(INTERACTIVE_SELECTOR).forEach(markNoTranslate);
  unwrapGoogleFontTags(doc);
}

/** Re-scan new DOM (KML modal) after Google Translate already ran on page load. */
export function nudgeGoogleTranslate(): void {
  const combo = document.querySelector(".goog-te-combo") as HTMLSelectElement | null;
  if (!combo) return;
  const lang = (combo.value || "").trim().toLowerCase();
  if (!lang || lang === "en") return;
  combo.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Google Translate mutates the DOM while React still owns those nodes.
 * Swallow only the "wrong parent" removeChild / insertBefore errors.
 */
export function installGoogleTranslateDomPatch(): void {
  if (typeof Node === "undefined" || (Node.prototype as any).__cropeyeGtPatched) {
    return;
  }
  (Node.prototype as any).__cropeyeGtPatched = true;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child: Node): Node {
    if (child.parentNode !== this) return child;
    return originalRemoveChild.call(this, child);
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function (
    newNode: Node,
    referenceNode: Node | null,
  ): Node {
    if (referenceNode && referenceNode.parentNode !== this) return newNode;
    return originalInsertBefore.call(this, newNode, referenceNode);
  };
}
