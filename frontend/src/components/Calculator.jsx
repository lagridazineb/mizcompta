import React, { useState } from 'react';

export default function Calculator({ onClose }) {
  const [display, setDisplay] = useState('0');
  const [stored, setStored] = useState(null);
  const [pendingOp, setPendingOp] = useState(null);
  const [waitingForNext, setWaitingForNext] = useState(false);

  function inputDigit(d) {
    if (waitingForNext) {
      setDisplay(d);
      setWaitingForNext(false);
    } else {
      setDisplay(display === '0' ? d : display + d);
    }
  }

  function inputDecimal() {
    if (waitingForNext) {
      setDisplay('0.');
      setWaitingForNext(false);
      return;
    }
    if (!display.includes('.')) setDisplay(display + '.');
  }

  function clearAll() {
    setDisplay('0');
    setStored(null);
    setPendingOp(null);
    setWaitingForNext(false);
  }

  function compute(a, b, op) {
    switch (op) {
      case '+':
        return a + b;
      case '-':
        return a - b;
      case '×':
        return a * b;
      case '÷':
        return b === 0 ? NaN : a / b;
      default:
        return b;
    }
  }

  function handleOperator(nextOp) {
    const value = parseFloat(display);
    if (stored == null) {
      setStored(value);
    } else if (pendingOp && !waitingForNext) {
      const result = compute(stored, value, pendingOp);
      setStored(result);
      setDisplay(String(Number.isFinite(result) ? Math.round(result * 1e8) / 1e8 : 'Erreur'));
    }
    setPendingOp(nextOp);
    setWaitingForNext(true);
  }

  function handleEquals() {
    if (pendingOp == null || stored == null) return;
    const value = parseFloat(display);
    const result = compute(stored, value, pendingOp);
    setDisplay(String(Number.isFinite(result) ? Math.round(result * 1e8) / 1e8 : 'Erreur'));
    setStored(null);
    setPendingOp(null);
    setWaitingForNext(true);
  }

  function handleBackspace() {
    if (waitingForNext) return;
    setDisplay(display.length > 1 ? display.slice(0, -1) : '0');
  }

  function handlePercent() {
    setDisplay(String(parseFloat(display) / 100));
  }

  const KEYS = [
    ['C', '⌫', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '+'],
    ['0', '.', '='],
  ];

  function handleKey(k) {
    if (k === 'C') return clearAll();
    if (k === '⌫') return handleBackspace();
    if (k === '%') return handlePercent();
    if (k === '=') return handleEquals();
    if (['+', '-', '×', '÷'].includes(k)) return handleOperator(k);
    if (k === '.') return inputDecimal();
    return inputDigit(k);
  }

  return (
    <div className="calculator-panel">
      <div className="calculator-header">
        <span>Calculatrice</span>
        <button className="calculator-close" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </div>
      <div className="calculator-display">{display}</div>
      <div className="calculator-grid">
        {KEYS.flat().map((k, i) => (
          <button
            key={i}
            className={`calculator-key${['÷', '×', '-', '+', '='].includes(k) ? ' calculator-key-op' : ''}${
              k === '0' ? ' calculator-key-wide' : ''
            }`}
            onClick={() => handleKey(k)}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
