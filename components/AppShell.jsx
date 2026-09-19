'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GlobalSearch } from './GlobalSearch.jsx';
import { api } from '../lib/client-api.js';

/**
 * The persistent frame: sidebar navigation, top bar, global search.
 * Collapses to an off-canvas drawer below 768px so the embedded app is usable
 * on the Shopify mobile admin.
 */

const NAV = [
  { label: null, items: [{ href: '/', text: 'Dashboard' }] },
  {
    label: 'Catalog',
    items: [
      { href: '/catalog/products', text: 'Products' },
      { href: '/catalog/variants', text: 'Variants' },
      { href: '/catalog/collections', text: 'Collections' },
    ],
  },
  {
    label: 'Sources',
    items: [
      { href: '/sources', text: 'Google Sheets' },
      { href: '/sources/files', text: 'CSV / Excel' },
    ],
  },
  {
    label: 'Automation',
    items: [
      { href: '/automation/price', text: 'Price rules' },
      { href: '/automation/inventory', text: 'Inventory rules' },
      { href: '/automation/collections', text: 'Collection rules' },
      { href: '/automation/tags', text: 'Tag rules' },
    ],
  },
  {
    label: 'Sync center',
    items: [
      { href: '/sync/preview', text: 'Preview' },
      { href: '/sync/history', text: 'History' },
      { href: '/sync/errors', text: 'Errors', badge: 'errors' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings/connections', text: 'Connections' },
      { href: '/settings/billing', text: 'Billing' },
      { href: '/settings/notifications', text: 'Notifications' },
    ],
  },
];

export function AppShell({ children }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [errorCount, setErrorCount] = useState(0);

  // Close the drawer whenever navigation happens, or the merchant is left with
  // an overlay covering the page they just opened.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/errors?pageSize=1')
      .then((data) => {
        if (!cancelled) setErrorCount(data?.pagination?.total ?? 0);
      })
      .catch(() => {
        // The badge is informational; a failure here must not break the frame.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if (event.key === '/' && !typing) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const isCurrent = (href) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="cp-app">
      {menuOpen ? (
        <div className="cp-sidebar-backdrop d-md-none" onClick={() => setMenuOpen(false)} role="presentation" />
      ) : null}

      <nav className={`cp-sidebar${menuOpen ? ' cp-sidebar-open' : ''}`} aria-label="Main navigation">
        <div className="cp-brand">
          <span className="cp-brand-mark" aria-hidden="true">
            CP
          </span>
          CatalogPilot
        </div>

        <div className="cp-nav">
          {NAV.map((section, index) => (
            <div key={section.label || index} className="cp-nav-section">
              {section.label ? <div className="cp-nav-label">{section.label}</div> : null}
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="cp-nav-link"
                  aria-current={isCurrent(item.href) ? 'page' : undefined}
                >
                  <span>{item.text}</span>
                  {item.badge === 'errors' && errorCount > 0 ? (
                    <span className="cp-nav-count">{errorCount > 99 ? '99+' : errorCount}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </nav>

      <div className="cp-main">
        <header className="cp-topbar">
          <button
            type="button"
            className="cp-btn cp-btn-plain cp-menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Toggle navigation menu"
          >
            ☰
          </button>

          <button
            type="button"
            className="cp-btn cp-btn-sm flex-grow-1 justify-content-start"
            style={{ maxWidth: 420, color: 'var(--cp-text-secondary)' }}
            onClick={() => setSearchOpen(true)}
          >
            Search products, SKUs, syncs…
            <kbd
              className="cp-badge ms-auto"
              style={{ fontSize: 11 }}
              aria-label="Press slash to search"
            >
              /
            </kbd>
          </button>
        </header>

        <main id="main-content" className="cp-content">
          {children}
        </main>
      </div>

      {searchOpen ? <GlobalSearch onClose={() => setSearchOpen(false)} /> : null}
    </div>
  );
}
