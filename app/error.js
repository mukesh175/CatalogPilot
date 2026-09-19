'use client';

import { useEffect } from 'react';

/**
 * Root error boundary. Shows recovery options rather than a stack trace —
 * the detail is already in the server logs.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('CatalogPilot render error:', error?.message);
  }, [error]);

  return (
    <div style={{ maxWidth: 520, margin: '15vh auto', padding: 24 }}>
      <div className="cp-card">
        <div className="cp-card-body text-center">
          <div className="cp-empty-icon" aria-hidden="true">
            !
          </div>
          <h1 className="cp-h2 mb-2">Something went wrong</h1>
          <p className="cp-subdued">
            This page could not be displayed. The problem has been logged. Trying again usually works.
          </p>
          <div className="cp-inline justify-content-center mt-4">
            <button type="button" className="cp-btn cp-btn-primary" onClick={reset}>
              Try again
            </button>
            {/*
              A full page load rather than a client navigation: the error
              boundary is recovering from a broken React tree, so discarding
              the current one is the point.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="cp-btn">
              Back to dashboard
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
