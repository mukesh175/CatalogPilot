'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * App-wide client context: toasts and a confirmation dialog.
 *
 * Both are provided rather than imported ad hoc so every screen gets the same
 * accessible implementation — focus handling, escape-to-close and live-region
 * announcements are solved once here.
 */

const ToastContext = createContext(null);
const ConfirmContext = createContext(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside AppProviders');
  return context;
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error('useConfirm must be used inside AppProviders');
  return context;
}

export function AppProviders({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const resolverRef = useRef(null);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message, { tone = 'default', duration = 5000 } = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((current) => [...current, { id, message, tone }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss]
  );

  const toast = useMemo(
    () => ({
      show,
      success: (message) => show(message, { tone: 'default' }),
      error: (message) => show(message, { tone: 'critical', duration: 8000 }),
      dismiss,
    }),
    [show, dismiss]
  );

  const confirm = useCallback((options) => {
    setConfirmState({
      title: options.title,
      body: options.body,
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      destructive: Boolean(options.destructive),
    });
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value) => {
    setConfirmState(null);
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  useEffect(() => {
    if (!confirmState) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') settle(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmState, settle]);

  return (
    <ToastContext.Provider value={toast}>
      <ConfirmContext.Provider value={confirm}>
        {children}

        <div className="cp-toasts" role="status" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className={`cp-toast${item.tone === 'critical' ? ' cp-toast-critical' : ''}`}>
              <span>{item.message}</span>
              <button
                type="button"
                className="cp-btn cp-btn-plain cp-btn-sm"
                style={{ color: 'inherit' }}
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {confirmState ? (
          <ConfirmDialog state={confirmState} onResolve={settle} />
        ) : null}
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

function ConfirmDialog({ state, onResolve }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className="cp-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onResolve(false);
      }}
    >
      <div className="cp-modal" role="dialog" aria-modal="true" aria-labelledby="cp-confirm-title">
        <div className="cp-card-header">
          <h2 id="cp-confirm-title" className="cp-h2">
            {state.title}
          </h2>
        </div>
        <div className="cp-card-body">
          <p className="mb-0">{state.body}</p>
        </div>
        <div className="cp-card-footer">
          <div className="cp-inline justify-content-end">
            <button type="button" className="cp-btn" onClick={() => onResolve(false)}>
              {state.cancelLabel}
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={`cp-btn ${state.destructive ? 'cp-btn-critical' : 'cp-btn-primary'}`}
              onClick={() => onResolve(true)}
            >
              {state.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
