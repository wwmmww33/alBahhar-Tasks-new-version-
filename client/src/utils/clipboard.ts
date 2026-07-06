export async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(el);
  el.focus();
  el.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(el); }
}

export async function readClipboard(): Promise<string> {
  if (navigator.clipboard && window.isSecureContext) {
    return await navigator.clipboard.readText();
  }
  return window.prompt('الصق الرابط هنا:') ?? '';
}
