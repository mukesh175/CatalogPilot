export const metadata = {
  title: 'Support',
  description: 'Get help with CatalogPilot.',
};

const FAQ = [
  {
    question: 'Will CatalogPilot delete my products?',
    answer:
      'No. The app only creates and updates. It never deletes a product, a variant or a collection, and it never removes a product from a collection. Anything destructive would have to be done by you in Shopify.',
  },
  {
    question: 'What happens if a cell in my sheet is empty?',
    answer:
      'By default the Shopify value is left as it is — an empty cell means "no information", not "clear this field". If you want blanks to clear values, turn on "Allow blank values to overwrite" on that source.',
  },
  {
    question: 'Do I have to restructure my supplier spreadsheet?',
    answer:
      'No. CatalogPilot recognises the column names suppliers commonly use and proposes a mapping. You correct anything it got wrong, and it remembers your choice.',
  },
  {
    question: 'How does the app know which Shopify product a row belongs to?',
    answer:
      'By SKU. The first time a row is synced, the link between the SKU and the Shopify product is saved, so renaming a product in your sheet later updates the right product instead of creating a duplicate.',
  },
  {
    question: 'Can two syncs run at the same time?',
    answer:
      'Not for the same source. Each job takes a lock, so a scheduled run will not overlap a manual one.',
  },
  {
    question: 'A row failed. What now?',
    answer:
      'Open the error center. Each failure explains what happened and what to do about it. Rows that a retry can fix have a retry button; rows that need a data correction say so instead of looping.',
  },
];

export default function SupportPage() {
  return (
    <article className="cp-stack">
      <h1>Support</h1>
      <p className="cp-subdued">
        Most questions are answered below. If yours is not, email{' '}
        <a href="mailto:support@catalogpilot.app">support@catalogpilot.app</a> with your store domain and,
        where relevant, the SKU involved.
      </p>

      <section className="cp-stack">
        {FAQ.map((item) => (
          <div key={item.question}>
            <h2 className="cp-h3 mb-1">{item.question}</h2>
            <p className="cp-subdued mb-0">{item.answer}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="cp-h2 mb-2">Reporting a problem</h2>
        <p>Including these details gets a faster answer:</p>
        <ul>
          <li>Your myshopify.com domain.</li>
          <li>The name of the source and worksheet.</li>
          <li>The SKU or row number, if it affects specific products.</li>
          <li>Roughly when it happened, so the run can be found in sync history.</li>
        </ul>
      </section>
    </article>
  );
}
