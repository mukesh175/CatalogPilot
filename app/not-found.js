import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ maxWidth: 520, margin: '15vh auto', padding: 24 }}>
      <div className="cp-card">
        <div className="cp-card-body text-center">
          <div className="cp-empty-icon" aria-hidden="true">
            ◇
          </div>
          <h1 className="cp-h2 mb-2">Page not found</h1>
          <p className="cp-subdued">That page does not exist, or it may have moved.</p>
          <Link href="/" className="cp-btn cp-btn-primary mt-3">
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
