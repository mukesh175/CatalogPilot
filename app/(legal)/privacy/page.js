export const metadata = {
  title: 'Privacy policy',
  description: 'How CatalogPilot handles merchant and store data.',
};

export default function PrivacyPage() {
  return (
    <article className="cp-stack">
      <h1>Privacy policy</h1>
      <p className="cp-subdued">Last updated 19 September 2026</p>

      <section>
        <h2 className="cp-h2 mb-2">What this app does</h2>
        <p>
          CatalogPilot reads product data from spreadsheets you connect and writes products, variants,
          inventory and collections to your Shopify store on your instruction.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">What we store</h2>
        <ul>
          <li>Your store domain, name, currency and inventory location.</li>
          <li>
            Access tokens for Shopify and Google. These are encrypted with AES-256-GCM before being
            written to the database and are never written to logs.
          </li>
          <li>
            The identifier and worksheet name of each spreadsheet you connect, its column headings, and
            your column mappings and rules.
          </li>
          <li>
            A record of each sync: which rows were created, updated, skipped or failed, and the product
            and variant identifiers involved.
          </li>
          <li>Staged rows from CSV or Excel files you upload, so previews and syncs read the same data.</li>
        </ul>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">What we do not store</h2>
        <ul>
          <li>Customer names, addresses, emails or order data. The app does not request those scopes.</li>
          <li>Payment details. Billing is handled entirely by Shopify.</li>
          <li>The contents of Google Drive files other than the spreadsheets you select.</li>
        </ul>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">Who we share it with</h2>
        <p>
          Data is shared only with the services required to run the app: Shopify (to read and write your
          catalog) and Google (to read your spreadsheets). It is not sold, and it is not used to train
          models.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">Retention and deletion</h2>
        <p>
          Uninstalling the app immediately deletes the stored access tokens and stops all scheduled syncs.
          Shopify then sends a shop redaction request 48 hours later, at which point every record for your
          store is permanently deleted. You can also request deletion at any time through support.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">GDPR and data requests</h2>
        <p>
          The app implements Shopify’s mandatory compliance webhooks. Because CatalogPilot holds no
          customer personal data, a customer data request returns no customer records; shop redaction
          deletes everything held for the store.
        </p>
      </section>

      <section>
        <h2 className="cp-h2 mb-2">Contact</h2>
        <p>
          Questions about this policy can be sent through the <a href="/support">support page</a>.
        </p>
      </section>
    </article>
  );
}
