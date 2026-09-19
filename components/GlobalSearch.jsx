'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/client-api.js';

/**
 * Command-palette search, opened with "/".
 * Queries are debounced and each response is checked against the current
 * input, so a slow earlier request cannot overwrite newer results.
 */

const TYPE_LABELS = {
  product: 'Product',
  variant: 'Variant',
  collection: 'Collection',
  source: 'Source',
  error: 'Error',
};

export function GlobalSearch({ onClose }) {
  const router = useRouter();
  const inputRef = useRef(null);
  const latestQuery = useRef('');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    latestQuery.current = trimmed;

    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get(`/api/search?q=${encodeURIComponent(trimmed)}`);
        if (latestQuery.current !== trimmed) return;
        setResults(data.results || []);
        setActiveIndex(0);
      } catch {
        if (latestQuery.current === trimmed) setResults([]);
      } finally {
        if (latestQuery.current === trimmed) setLoading(false);
      }
    }, 220);

    return () => clearTimeout(timer);
  }, [query]);

  const go = (result) => {
    if (!result) return;
    onClose();
    router.push(result.href);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[activeIndex]);
    }
  };

  return (
    <div
      className="cp-modal-backdrop"
      style={{ alignItems: 'flex-start', paddingTop: '10vh' }}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cp-modal" role="dialog" aria-modal="true" aria-label="Search CatalogPilot">
        <div className="cp-card-header">
          <input
            ref={inputRef}
            className="cp-input"
            type="search"
            value={query}
            placeholder="Search products, SKUs, collections, syncs, errors…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search"
            aria-autocomplete="list"
            aria-controls="cp-search-results"
          />
        </div>

        <div className="cp-card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
          {query.trim().length < 2 ? (
            <p className="cp-subdued mb-0" style={{ fontSize: 13 }}>
              Type at least two characters. Use ↑ ↓ to move and Enter to open.
            </p>
          ) : loading ? (
            <p className="cp-subdued mb-0" style={{ fontSize: 13 }}>
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="cp-subdued mb-0" style={{ fontSize: 13 }}>
              Nothing matched “{query.trim()}”.
            </p>
          ) : (
            <ul id="cp-search-results" role="listbox" className="list-unstyled mb-0">
              {results.map((result, index) => (
                <li key={`${result.type}-${result.id}`} role="option" aria-selected={index === activeIndex}>
                  <button
                    type="button"
                    className="cp-btn cp-btn-plain w-100 justify-content-start text-start"
                    style={{
                      background: index === activeIndex ? 'var(--cp-surface-sunken)' : 'transparent',
                      padding: '8px 10px',
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => go(result)}
                  >
                    <span className="cp-badge" style={{ minWidth: 74, justifyContent: 'center' }}>
                      {TYPE_LABELS[result.type] || result.type}
                    </span>
                    <span className="d-flex flex-column" style={{ minWidth: 0 }}>
                      <span className="cp-truncate" style={{ fontWeight: 550 }}>
                        {result.title}
                      </span>
                      <span className="cp-subdued cp-truncate" style={{ fontSize: 12 }}>
                        {result.subtitle}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
