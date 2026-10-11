const OPEN_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ']);

export function attachChoiceMenus(container: HTMLElement): () => void {
  let menu: HTMLDivElement | null = null;
  let tip: HTMLDivElement | null = null;
  let anchor: HTMLSelectElement | null = null;

  const close = () => {
    menu?.remove();
    tip?.remove();
    menu = null;
    tip = null;
    anchor = null;
    document.removeEventListener('pointerdown', onDocumentPointerDown, true);
    document.removeEventListener('keydown', onDocumentKeyDown, true);
    window.removeEventListener('resize', close);
    container.removeEventListener('scroll', close);
  };

  const showTip = (row: HTMLElement, text: string) => {
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'choice-tip';
      document.body.append(tip);
    }
    tip.textContent = text;
    const rowBox = row.getBoundingClientRect();
    const tipBox = tip.getBoundingClientRect();
    const menuLeft = menu?.getBoundingClientRect().left ?? rowBox.left;
    const left = menuLeft - tipBox.width - 10;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, rowBox.top + (rowBox.height - tipBox.height) / 2)}px`;
  };

  const hideTip = () => {
    tip?.remove();
    tip = null;
  };

  const open = (select: HTMLSelectElement) => {
    if (anchor === select && menu) {
      close();
      return;
    }
    close();
    anchor = select;
    menu = document.createElement('div');
    menu.className = 'choice-menu';
    menu.setAttribute('role', 'listbox');
    const box = select.getBoundingClientRect();
    menu.style.top = `${box.bottom + 4}px`;
    menu.style.minWidth = `${box.width}px`;

    for (const option of select.options) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'choice-menu-item';
      row.textContent = option.textContent;
      row.setAttribute('role', 'option');
      const detail = option.dataset.detail ?? '';
      const unavailable = option.disabled;
      if (unavailable) {
        row.classList.add('is-disabled');
        row.setAttribute('aria-disabled', 'true');
      }
      if (option.index === select.selectedIndex) {
        row.classList.add('is-current');
        row.setAttribute('aria-selected', 'true');
      }
      row.addEventListener('pointerenter', () => {
        if (detail) showTip(row, detail);
        else hideTip();
      });
      row.addEventListener('pointerleave', hideTip);
      row.addEventListener('focus', () => {
        if (detail) showTip(row, detail);
        else hideTip();
      });
      row.addEventListener('blur', hideTip);
      row.addEventListener('click', () => {
        if (unavailable || !anchor) return;
        const index = option.index;
        close();
        select.selectedIndex = index;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      menu.append(row);
    }

    document.body.append(menu);
    const menuBox = menu.getBoundingClientRect();
    const left = Math.min(box.left, window.innerWidth - 8 - menuBox.width);
    menu.style.left = `${Math.max(8, left)}px`;
    if (menuBox.bottom > window.innerHeight - 8) {
      menu.style.top = `${Math.max(8, box.top - menuBox.height - 4)}px`;
    }
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('resize', close);
    container.addEventListener('scroll', close);
  };

  const onDocumentPointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (menu?.contains(target) || target === anchor) return;
    close();
  };

  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  const onMouseDown = (event: MouseEvent) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select || !container.contains(select)) return;
    event.preventDefault();
    open(select);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const select = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!select || !container.contains(select) || !OPEN_KEYS.has(event.key)) return;
    event.preventDefault();
    open(select);
  };

  container.addEventListener('mousedown', onMouseDown, true);
  container.addEventListener('keydown', onKeyDown, true);

  return () => {
    close();
    container.removeEventListener('mousedown', onMouseDown, true);
    container.removeEventListener('keydown', onKeyDown, true);
  };
}
