import type { CardOptions, WorldCard } from './types';

export function createWorldCard(parent: HTMLElement, options: CardOptions = {}): WorldCard {
  const frame = document.createElement('aside');
  frame.className = `shell-card is-${options.corner ?? 'bottom-right'}`;
  const caption = document.createElement('p');
  caption.className = 'shell-card-caption';
  const body = document.createElement('div');
  body.className = 'shell-card-body';
  frame.append(caption, body);
  parent.append(frame);
  applyCaption(caption, options.caption ?? '');

  return {
    body,
    setCaption(text) {
      applyCaption(caption, text);
    },
    dispose() {
      frame.remove();
    },
  };
}

function applyCaption(caption: HTMLElement, text: string): void {
  caption.textContent = text;
  caption.hidden = text.length === 0;
}
