import Link from 'next/link';

/**
 * Public layout for the pages Shopify requires to be reachable without an
 * install: privacy policy, terms and support.
 */
export default function LegalLayout({ children }) {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px' }}>
      <header className="cp-spread mb-5 flex-wrap gap-3">
        <Link href="/privacy" className="cp-brand text-decoration-none p-0" style={{ color: 'inherit' }}>
          <span className="cp-brand-mark" aria-hidden="true">
            CP
          </span>
          CatalogPilot
        </Link>
        <nav className="cp-inline" aria-label="Legal pages">
          <Link href="/privacy" className="cp-btn cp-btn-sm">
            Privacy
          </Link>
          <Link href="/terms" className="cp-btn cp-btn-sm">
            Terms
          </Link>
          <Link href="/support" className="cp-btn cp-btn-sm">
            Support
          </Link>
        </nav>
      </header>

      <main id="main-content" className="cp-card">
        <div className="cp-card-body">{children}</div>
      </main>

      <footer className="cp-subdued mt-4" style={{ fontSize: 12.5 }}>
        CatalogPilot — Turn any supplier sheet into a Shopify store.
      </footer>
    </div>
  );
}
