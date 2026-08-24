import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { installEnterAsTab } from './utils/enterAsTab';
import './styles.css';

// Entrée = passage au champ suivant, partout dans l'application (voir
// utils/enterAsTab.js pour le détail et les exceptions).
installEnterAsTab();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
