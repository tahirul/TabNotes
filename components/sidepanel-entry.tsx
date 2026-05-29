import { createRoot } from 'react-dom/client';
import { SidePanelApp } from './SidePanelApp';
import '../styles/global.css';

const root = document.getElementById('app') ?? createRootContainer();
createRoot(root).render(<SidePanelApp />);

function createRootContainer(): HTMLDivElement {
  const element = document.createElement('div');
  element.id = 'app';
  document.body.appendChild(element);
  return element;
}
