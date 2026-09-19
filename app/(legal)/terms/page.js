export const metadata = {
  title: 'Terms of service',
  description: 'The terms that apply to using CatalogPilot.',
};

export default function TermsPage() {
  return (
    <article className="cp-stack">
      <h1>Terms of service</h1>
      <p className="cp-subdued">Last updated 19 September 2026</p>

      <section>
        <h2 className="cp-h2 mb-2">Using the app</h2>
        <p>
          Installing CatalogPilot on a Shopify store means accepting these terms. You must be authorised
          to manage the store and to use the spreadsheet data you connect.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">What the app changes</h2>
        <p>
          CatalogPilot creates and updates products, variants, inventory levels and collection membership
          in your store, according to the mappings and rules you configure. It does not delete products,
          variants or collections, and it does not remove products from collections.
        </p>
        <p>
          You are responsible for the mappings and rules you set up and for the accuracy of the supplier
          data you connect. Every sync can be previewed in full before it is applied.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">Billing</h2>
        <p>
          Paid plans are billed monthly through the Shopify Billing API and appear on your Shopify
          invoice. Changing plans takes effect once you approve the charge in Shopify. Cancelling returns
          the store to the Free plan; your configuration is kept.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">Availability</h2>
        <p>
          The app depends on the Shopify Admin API and the Google Sheets API. Outages, rate limits or
          permission changes in those services can delay a sync. Failed rows are recorded and can be
          retried.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">Liability</h2>
        <p>
          The app is provided as is. To the extent permitted by law, liability is limited to the fees paid
          in the three months before a claim. Preview every sync before applying it, particularly when
          changing pricing rules.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">Termination</h2>
        <p>
          You can uninstall at any time from your Shopify admin. Doing so stops all syncs immediately and
          begins the deletion process described in the <a href="/privacy">privacy policy</a>.
        </p>
      </section>
    </article>
  );
}
