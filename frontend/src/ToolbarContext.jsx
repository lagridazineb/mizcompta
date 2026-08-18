import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToolbarContext = createContext(null);

export function ToolbarProvider({ children }) {
  const [actions, setActions] = useState({});

  const trigger = useCallback(
    (key) => {
      if (typeof actions[key] === 'function') actions[key]();
    },
    [actions]
  );

  const registerActions = useCallback((next) => {
    setActions((prev) => ({ ...prev, ...next }));
  }, []);

  const clearActions = useCallback((keys) => {
    setActions((prev) => {
      const copy = { ...prev };
      keys.forEach((k) => delete copy[k]);
      return copy;
    });
  }, []);

  return (
    <ToolbarContext.Provider value={{ actions, trigger, registerActions, clearActions }}>
      {children}
    </ToolbarContext.Provider>
  );
}

export function useToolbar() {
  return useContext(ToolbarContext);
}


export function useToolbarActions({ onAdd, onSave, addLabel, saveLabel } = {}) {
  const { registerActions, clearActions } = useToolbar();
  const registeredRef = useRef(false);
  const callbacksRef = useRef({ onAdd, onSave });
  callbacksRef.current = { onAdd, onSave };

  React.useEffect(() => {
    registerActions({
      onAdd: onAdd ? () => callbacksRef.current.onAdd && callbacksRef.current.onAdd() : undefined,
      onSave: onSave ? () => callbacksRef.current.onSave && callbacksRef.current.onSave() : undefined,
      addLabel: addLabel || null,
      saveLabel: saveLabel || null,
    });
    registeredRef.current = true;
    return () => {
      if (registeredRef.current) clearActions(['onAdd', 'onSave', 'addLabel', 'saveLabel']);
    };
    // onAdd/onSave sont volontairement remplacés par leur simple présence
    // (booléen) : ce sont de nouvelles fonctions à chaque rendu du composant
    // appelant, donc les garder telles quelles dans les dépendances relance
    // cet effet en boucle infinie (registerActions -> re-rendu -> nouvel
    // effet -> ...). callbacksRef garantit qu'on appelle toujours la version
    // la plus récente sans avoir besoin de les mettre en dépendance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!onAdd, !!onSave, addLabel, saveLabel]);
}
