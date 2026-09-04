/**
 * DOM Distillation — reduce a full page DOM to an LLM-consumable summary.
 *
 * Raw DOM can be 50,000+ nodes / 100K+ tokens. Distillation extracts only
 * interactive elements (buttons, inputs, links, selects) with their semantic
 * attributes (text, ARIA role, label, placeholder), assigning each a numbered
 * ref (@e1, @e2...) for the LLM to reference.
 *
 * This is the key enabler for cross-site generalization: the LLM sees
 * "what's on the page" in semantic terms, not CSS selectors.
 *
 * Inspired by:
 * - Browser-Use DOM distillation
 * - Playwright MCP browser_snapshot
 * - Prune4Web (AAAI 2025)
 *
 * v2: DISTILL_SCRIPT only handles the current document.
 *     Iframe traversal is done by the Provider using frame.evaluate(),
 *     which runs the script in each frame's own JS context.
 *     This bypasses cross-origin restrictions that prevent
 *     contentDocument access from the main frame.
 */

import type { DistilledElement, DistilledPage } from "./types.js";

export type { DistilledElement, DistilledPage };

/**
 * JavaScript code to execute in a browser frame for DOM distillation.
 * This runs via frame.evaluate() — once for the main frame, once for each child frame.
 *
 * When run via frame.evaluate(), the script executes in that frame's JS context,
 * so it can access the frame's document directly — even for cross-origin iframes.
 *
 * Strategy:
 * 1. Walk the DOM of the CURRENT document (no iframe traversal)
 * 2. Skip hidden/disabled elements
 * 3. Extract semantic attributes (text, role, label, placeholder)
 * 4. Generate CSS selector and XPath for each
 * 5. Assign numbered refs (@e1, @e2, ...)
 */
export const DISTILL_SCRIPT = `
(framePrefix) => {
  framePrefix = framePrefix || '';
  const INTERACTIVE_TAGS = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"],[role="tab"],[role="menuitem"],[onclick],[contenteditable="true"]';
  
  function getRole(el) {
    if (el.getAttribute('role')) return el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const roleMap = {
      'a': 'link', 'button': 'button', 'input': 'textbox',
      'select': 'combobox', 'textarea': 'textbox',
    };
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      const typeRoleMap = {
        'submit': 'button', 'button': 'button', 'reset': 'button',
        'checkbox': 'checkbox', 'radio': 'radio', 'email': 'textbox',
        'password': 'textbox', 'search': 'textbox', 'tel': 'textbox',
        'url': 'textbox', 'number': 'spinbutton',
      };
      return typeRoleMap[type] || 'textbox';
    }
    return roleMap[tag] || 'generic';
  }
  
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }
  
  function getSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name && el.tagName) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id) { parts.unshift('#' + CSS.escape(current.id)); break; }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          part += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ');
  }
  
  function getXPath(el) {
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      let index = 1;
      let sibling = current.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.tagName === current.tagName) index++;
        sibling = sibling.previousSibling;
      }
      parts.unshift(current.tagName.toLowerCase() + '[' + index + ']');
      current = current.parentNode;
    }
    return '/' + parts.join('/');
  }
  
  function getText(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      return el.value || el.placeholder || '';
    }
    if (tag === 'select') {
      const selected = el.options[el.selectedIndex];
      return selected ? selected.text : '';
    }
    return (el.textContent || '').trim().slice(0, 100);
  }
  
  const elements = [];
  const allInteractive = document.querySelectorAll(INTERACTIVE_TAGS);
  for (const el of allInteractive) {
    if (!isVisible(el)) continue;
    if (el.disabled || el.readOnly) continue;
    if (el.tagName.toLowerCase() === 'input' && el.type === 'hidden') continue;

    const idx = elements.length + 1;
    const rect = el.getBoundingClientRect();
    const rawSelector = getSelector(el);
    elements.push({
      ref: '@e' + idx,
      index: idx,
      tag: el.tagName.toLowerCase(),
      text: getText(el),
      role: getRole(el),
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.placeholder || '',
      name: el.name || '',
      type: el.type || '',
      id: el.id || '',
      interactive: true,
      selector: framePrefix ? framePrefix + ' >> ' + rawSelector : rawSelector,
      xpath: getXPath(el),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
    });
  }

  const totalForms = document.querySelectorAll('form').length;
  const totalIframes = document.querySelectorAll('iframe').length;
  const hasTables = document.querySelectorAll('table').length > 0;

  // Detect architecture from current frame
  const html = document.documentElement.outerHTML || '';
  const url = location.href;
  let architecture = 'unknown';
  const architectureHints = [];

  if (html.includes('/static/ext3/') || document.querySelector('.x-grid-row') || document.querySelector('.x-btn')) {
    architecture = 'extjs3';
    architectureHints.push('ExtJS 3 detected');
  } else if (html.includes('xtype') || html.includes('Ext.') || document.querySelector('.x-component')) {
    architecture = 'extjs-modern';
    architectureHints.push('ExtJS modern detected');
  } else if (html.includes('Powered By JeeSite') || html.includes('jeesite')) {
    architecture = 'jeesite';
    architectureHints.push('JeeSite platform detected');
  } else if (document.querySelector('[data-reactroot]') || html.includes('__NEXT_DATA__')) {
    architecture = 'react-spa';
    architectureHints.push('React SPA detected');
  } else if (document.querySelector('[data-v-') || html.includes('__NUXT__')) {
    architecture = 'vue-spa';
    architectureHints.push('Vue SPA detected');
  }

  return JSON.stringify({
    url: url,
    title: document.title,
    elements: elements,
    elementCount: elements.length,
    structure: {
      hasForms: totalForms > 0,
      formCount: totalForms,
      hasTables,
      hasIframes: totalIframes > 0,
      iframeCount: totalIframes,
      architecture,
      architectureHints
    }
  });
}
`;

/**
 * Format distilled elements as a human-readable summary for LLM consumption.
 */
export function formatDistilledForLLM(page: DistilledPage): string {
  const lines: string[] = [];
  lines.push(`Page: ${page.title}`);
  lines.push(`URL: ${page.url}`);
  lines.push(`Architecture: ${page.structure.architecture}`);
  if (page.structure.architectureHints.length > 0) {
    lines.push(`Hints: ${page.structure.architectureHints.join(', ')}`);
  }
  lines.push(`Interactive elements: ${page.elementCount}`);
  if (page.structure.hasForms) lines.push(`Forms: ${page.structure.formCount}`);
  if (page.structure.hasIframes) lines.push(`Iframes: ${page.structure.iframeCount}`);
  lines.push('');
  lines.push('Elements:');
  
  for (const el of page.elements) {
    const parts = [el.ref];
    parts.push(`[${el.role}]`);
    if (el.text) parts.push(`"${el.text.slice(0, 50)}"`);
    if (el.ariaLabel) parts.push(`aria="${el.ariaLabel}"`);
    if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
    if (el.name) parts.push(`name="${el.name}"`);
    if (el.id) parts.push(`id="${el.id}"`);
    lines.push('  ' + parts.join(' '));
  }
  
  return lines.join('\n');
}
