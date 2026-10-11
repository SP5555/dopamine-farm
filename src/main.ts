import { createApp } from './harness/app';
import './styles.css';

const root = document.querySelector('#app');
if (!(root instanceof HTMLElement)) {
  throw new Error('Missing #app');
}

const app = createApp(root);

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
