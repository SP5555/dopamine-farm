import { createBar } from './bar';
import type { SimStatus } from './types';

export interface StatusBar {
  sync(status: SimStatus, stepped: boolean): void;
  setEnabled(enabled: boolean): void;
  hint(): string;
  handleKey(event: KeyboardEvent): boolean;
  clear(): void;
  showBanner(title: string, elapsedMs: number): void;
  clearBanner(): void;
}

export function statusHasBody(status: SimStatus): boolean {
  return (status.row?.length ?? 0) > 0 || (status.aside?.length ?? 0) > 0 || Boolean(status.note);
}

export function createStatusBar(root: HTMLElement, banner: HTMLElement): StatusBar {
  root.replaceChildren();

  const rowHost = document.createElement('div');
  rowHost.className = 'bar-row';
  const rowPieces = document.createElement('div');
  rowPieces.className = 'bar-pieces';
  const asidePieces = document.createElement('div');
  asidePieces.className = 'bar-aside';
  const note = document.createElement('p');
  note.className = 'bar-note';
  rowHost.append(rowPieces, asidePieces);
  root.append(rowHost, note);

  const row = createBar(rowPieces);
  const aside = createBar(asidePieces);

  return {
    sync(status, stepped) {
      const rowItems = status.row ?? [];
      const asideItems = status.aside ?? [];
      row.sync(rowItems, stepped);
      aside.sync(asideItems, stepped);
      asidePieces.hidden = asideItems.length === 0;
      note.textContent = status.note ?? '';
    },
    setEnabled(enabled) {
      row.setEnabled(enabled);
      aside.setEnabled(enabled);
    },
    hint() {
      return [row.hint(), aside.hint()].filter((hint) => hint.length > 0).join(' · ');
    },
    handleKey(event) {
      return row.handleKey(event) || aside.handleKey(event);
    },
    clear() {
      row.clear();
      aside.clear();
      note.textContent = '';
      banner.hidden = true;
      banner.classList.remove('show');
    },
    showBanner(title, elapsedMs) {
      banner.replaceChildren();
      const heading = document.createElement('strong');
      heading.textContent = `✓ ${title}`;
      const time = document.createElement('span');
      time.textContent = formatElapsed(elapsedMs);
      banner.append(heading, time);
      banner.hidden = false;
      banner.classList.remove('show');
      void banner.offsetWidth;
      banner.classList.add('show');
    },
    clearBanner() {
      banner.hidden = true;
      banner.classList.remove('show');
    },
  };
}

function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 10 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds)}s`;
}
