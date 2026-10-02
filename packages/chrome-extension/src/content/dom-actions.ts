import type { DomAction, DomActionParams } from "../shared/types";

/* ---- Visual highlight for MCP actions ---- */

let styleInjected = false;

function injectHighlightStyles(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @property --genie-angle {
      syntax: "<angle>";
      initial-value: 0deg;
      inherits: false;
    }
    @keyframes genie-border-spin {
      to { --genie-angle: 360deg; }
    }
    @keyframes genie-fade-out {
      to { opacity: 0; }
    }
    .genie-highlight {
      position: relative !important;
      isolation: isolate;
    }
    .genie-highlight::before {
      content: "";
      position: absolute;
      inset: -2px;
      border-radius: inherit;
      padding: 2px;
      background: conic-gradient(
        from var(--genie-angle),
        transparent 35%,
        #cba6f7 48%,
        #89b4fa 55%,
        transparent 65%
      );
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask-composite: exclude;
      -webkit-mask-composite: xor;
      animation: genie-border-spin 1.5s linear infinite;
      pointer-events: none;
      z-index: 2147483647;
    }
    .genie-snapshot {
      position: relative !important;
      isolation: isolate;
    }
    .genie-snapshot::before {
      content: "";
      position: absolute;
      inset: -2px;
      border-radius: inherit;
      padding: 2px;
      background: conic-gradient(
        from var(--genie-angle),
        transparent 35%,
        #cba6f7 48%,
        #89b4fa 55%,
        transparent 65%
      );
      mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
      mask-composite: exclude;
      -webkit-mask-composite: xor;
      animation: genie-border-spin 1.5s linear infinite, genie-fade-out 0.8s 0.4s ease-out forwards;
      pointer-events: none;
      z-index: 2147483647;
    }
  `;
  document.head.appendChild(style);
}

function highlight(el: Element, type: "action" | "snapshot" = "action"): void {
  injectHighlightStyles();
  const cls = type === "snapshot" ? "genie-snapshot" : "genie-highlight";
  el.classList.add(cls);
  const duration = type === "snapshot" ? 800 : 1200;
  setTimeout(() => el.classList.remove(cls), duration);
}

// Parse Playwright-style :has-text("...") into { cssSelector, textMatch }
function parseTextSelector(selector: string): { css: string; text: string } | null {
  const match = selector.match(/^(.+?):has-text\(["'](.+?)["']\)$/);
  if (!match) return null;
  return { css: match[1].trim(), text: match[2] };
}

function queryEl(selector: string): Element | null {
  // Handle :has-text() pseudo-selector (Playwright-style, not valid CSS)
  const textSel = parseTextSelector(selector);
  if (textSel) {
    const candidates = document.querySelectorAll(textSel.css);
    for (const el of candidates) {
      const content = el.textContent?.trim() || "";
      if (content === textSel.text || content.includes(textSel.text)) return el;
    }
    // Search shadow DOMs too
    function searchShadowText(root: ParentNode): Element | null {
      const els = root.querySelectorAll("*");
      for (const el of els) {
        if (el.shadowRoot) {
          const matches = el.shadowRoot.querySelectorAll(textSel!.css);
          for (const m of matches) {
            const content = m.textContent?.trim() || "";
            if (content === textSel!.text || content.includes(textSel!.text)) return m;
          }
          const deep = searchShadowText(el.shadowRoot);
          if (deep) return deep;
        }
      }
      return null;
    }
    return searchShadowText(document);
  }

  // Standard CSS selector — search light DOM first
  try {
    const found = document.querySelector(selector);
    if (found) return found;
  } catch {
    // Invalid selector — try text-based fallback
    // e.g. if Claude sends something non-standard, search by text content
    return null;
  }

  // Search inside shadow DOMs
  function searchShadow(root: ParentNode): Element | null {
    const els = root.querySelectorAll("*");
    for (const el of els) {
      if (el.shadowRoot) {
        try {
          const match = el.shadowRoot.querySelector(selector);
          if (match) return match;
        } catch { /* invalid selector */ }
        const deep = searchShadow(el.shadowRoot);
        if (deep) return deep;
      }
    }
    return null;
  }
  return searchShadow(document);
}

function getSnapshot(): string {
  // Return a cleaned text representation of the visible DOM, including shadow DOM

  const SKIP_TAGS = new Set(["script", "style", "noscript", "svg", "link"]);
  const STRUCTURAL_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "nav", "main", "header", "footer", "section", "article", "form"]);
  const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "form"]);

  function extractText(el: HTMLElement, depth = 0): string {
    const lines: string[] = [];
    const tag = el.tagName?.toLowerCase();

    if (SKIP_TAGS.has(tag)) return "";

    // Skip hidden elements (only works on live DOM, not clones)
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return "";
    } catch {}

    const interactiveAttrs: string[] = [];
    if (el.id) interactiveAttrs.push(`id="${el.id}"`);
    if (el.className && typeof el.className === "string") {
      const cls = el.className.trim().slice(0, 60);
      if (cls) interactiveAttrs.push(`class="${cls}"`);
    }

    const isInteractive = INTERACTIVE_TAGS.has(tag);
    if (isInteractive) {
      const href = el.getAttribute("href");
      const type = el.getAttribute("type");
      const name = el.getAttribute("name");
      const placeholder = el.getAttribute("placeholder");
      const value = (el as HTMLInputElement).value;
      if (href) interactiveAttrs.push(`href="${href}"`);
      if (type) interactiveAttrs.push(`type="${type}"`);
      if (name) interactiveAttrs.push(`name="${name}"`);
      if (placeholder) interactiveAttrs.push(`placeholder="${placeholder}"`);
      if (value) interactiveAttrs.push(`value="${value}"`);
    }

    const prefix = "  ".repeat(Math.min(depth, 6));

    // Collect children: shadow DOM first, then light DOM
    const children: HTMLElement[] = [];
    if (el.shadowRoot) {
      for (const child of el.shadowRoot.children) {
        children.push(child as HTMLElement);
      }
    }
    for (const child of el.children) {
      children.push(child as HTMLElement);
    }

    if (children.length === 0) {
      const text = el.textContent?.trim();
      if (text) {
        if (isInteractive || interactiveAttrs.length > 0) {
          lines.push(`${prefix}<${tag} ${interactiveAttrs.join(" ")}>${text}</${tag}>`);
        } else {
          lines.push(`${prefix}${text}`);
        }
      }
    } else {
      const showTag = isInteractive || STRUCTURAL_TAGS.has(tag);
      if (showTag) {
        lines.push(`${prefix}<${tag} ${interactiveAttrs.join(" ")}>`);
      }
      for (const child of children) {
        const childText = extractText(child, depth + 1);
        if (childText) lines.push(childText);
      }
      if (showTag) {
        lines.push(`${prefix}</${tag}>`);
      }
    }

    return lines.join("\n");
  }

  // Walk the live DOM (not a clone) so we can access shadowRoot
  const text = extractText(document.body);
  // Truncate to reasonable size
  return text.slice(0, 12000);
}

async function waitForElement(selector: string, timeout = 5000): Promise<Element | null> {
  const existing = queryEl(selector);
  if (existing) return existing;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);

    const observer = new MutationObserver(() => {
      const el = queryEl(selector);
      if (el) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

export async function executeDomAction(
  action: DomAction,
  params: DomActionParams,
): Promise<{ success: boolean; result: string }> {
  switch (action) {
    case "get_snapshot": {
      highlight(document.body, "snapshot");
      return { success: true, result: getSnapshot() };
    }

    case "click": {
      if (!params.selector) return { success: false, result: "selector required" };
      const el = queryEl(params.selector) as HTMLElement | null;
      if (!el) return { success: false, result: `Element not found: ${params.selector}` };
      highlight(el);
      el.click();
      // Return surrounding context
      const text = el.textContent?.trim().slice(0, 200) || "";
      return { success: true, result: `Clicked element. Text: "${text}"` };
    }

    case "type": {
      if (!params.selector) return { success: false, result: "selector required" };
      if (params.value === undefined) return { success: false, result: "value required" };
      const el = queryEl(params.selector) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return { success: false, result: `Element not found: ${params.selector}` };
      highlight(el);
      el.focus();
      el.value = params.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, result: `Typed "${params.value}" into ${params.selector}` };
    }

    case "select": {
      if (!params.selector) return { success: false, result: "selector required" };
      if (!params.value) return { success: false, result: "value required" };
      const el = queryEl(params.selector) as HTMLSelectElement | null;
      if (!el) return { success: false, result: `Element not found: ${params.selector}` };
      highlight(el);
      el.value = params.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, result: `Selected "${params.value}" in ${params.selector}` };
    }

    case "scroll": {
      const direction = params.direction || "down";
      const amount = params.amount || 500;
      const el = params.selector ? queryEl(params.selector) as HTMLElement : window as any;
      if (params.selector && !el) return { success: false, result: `Element not found: ${params.selector}` };
      if (params.selector && el) highlight(el);
      const target = params.selector ? el! : window;
      target.scrollBy({ top: direction === "down" ? amount : -amount, behavior: "smooth" });
      return { success: true, result: `Scrolled ${direction} by ${amount}px` };
    }

    case "read_text": {
      if (!params.selector) return { success: false, result: "selector required" };
      const el = queryEl(params.selector);
      if (!el) return { success: false, result: `Element not found: ${params.selector}` };
      highlight(el);
      const text = el.textContent?.trim().slice(0, 2000) || "";
      return { success: true, result: text };
    }

    case "read_attr": {
      if (!params.selector) return { success: false, result: "selector required" };
      if (!params.attribute) return { success: false, result: "attribute required" };
      const el = queryEl(params.selector);
      if (!el) return { success: false, result: `Element not found: ${params.selector}` };
      highlight(el);
      const val = el.getAttribute(params.attribute);
      return { success: true, result: val ?? "(null)" };
    }

    case "navigate": {
      if (!params.url) return { success: false, result: "url required" };
      window.location.href = params.url;
      return { success: true, result: `Navigating to ${params.url}` };
    }

    case "wait_for": {
      if (!params.selector) return { success: false, result: "selector required" };
      const timeout = params.timeout || 5000;
      const el = await waitForElement(params.selector, timeout);
      if (!el) return { success: false, result: `Timeout waiting for ${params.selector}` };
      highlight(el);
      const text = el.textContent?.trim().slice(0, 200) || "";
      return { success: true, result: `Element appeared. Text: "${text}"` };
    }

    default:
      return { success: false, result: `Unknown action: ${action}` };
  }
}
