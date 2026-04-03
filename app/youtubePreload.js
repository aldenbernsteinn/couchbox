// YouTube TV preload — cursor hide + keyboard overlay for controller

// Auto-hide cursor after 3 seconds
let cursorTimer = null;
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    .cursor-hidden, .cursor-hidden * { cursor: none !important; }
  `;
  document.head.appendChild(style);

  const resetCursor = () => {
    document.body.classList.remove('cursor-hidden');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), 3000);
  };
  document.addEventListener('mousemove', resetCursor);
  resetCursor();
});
