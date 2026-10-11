import type { SimMeta } from './types';

export interface Nav {
  setActive(id: string | null): void;
}

export function createNav(root: HTMLElement, metas: SimMeta[], onSelect: (id: string) => void): Nav {
  const buttons = new Map<string, HTMLButtonElement>();
  root.replaceChildren();

  for (const meta of metas) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    button.addEventListener('mousedown', (event) => event.preventDefault());

    const title = document.createElement('span');
    title.className = 'nav-title';
    title.textContent = meta.title;

    const description = document.createElement('span');
    description.className = 'nav-description';
    description.textContent = meta.description;

    button.append(title, description);
    button.addEventListener('click', () => onSelect(meta.id));
    root.append(button);
    buttons.set(meta.id, button);
  }

  return {
    setActive(id: string | null) {
      for (const [simId, button] of buttons) {
        const active = simId === id;
        button.classList.toggle('is-active', active);
        if (active) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
      }
    },
  };
}
