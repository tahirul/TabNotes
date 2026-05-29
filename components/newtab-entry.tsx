import { createRoot } from 'react-dom/client';
import { DashboardApp } from './DashboardApp';
import '../styles/global.css';

const root = document.getElementById('app') ?? createRootContainer();
createRoot(root).render(<DashboardApp />);

function createRootContainer(): HTMLDivElement {
  const element = document.createElement('div');
  element.id = 'app';
  document.body.appendChild(element);
  return element;
}
