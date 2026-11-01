export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const node = h('button', cls, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function toast(message: string, kind: 'info' | 'warn' | 'error' = 'info', ms = 3200): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = h('div', `toast toast-${kind}`, message);
  host.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('is-out');
    window.setTimeout(() => node.remove(), 260);
  }, ms);
}

export function formatDb(value: number): string {
  if (value <= 0.001) return '−∞';
  return `${(20 * Math.log10(value)).toFixed(1)} dB`;
}

export function formatSeconds(value: number): string {
  if (value < 1) return `${Math.round(value * 1000)} ms`;
  return `${value.toFixed(2)} s`;
}
