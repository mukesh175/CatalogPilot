import 'bootstrap/dist/css/bootstrap.min.css';
import '../styles/globals.css';
import { AppProviders } from '../components/AppProviders.jsx';

export const metadata = {
  title: {
    default: 'CatalogPilot',
    template: '%s · CatalogPilot',
  },
  description: 'Turn any supplier sheet into a Shopify store.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  const apiKey = process.env.SHOPIFY_API_KEY || '';

  return (
    <html lang="en">
      <head>
        {/*
          App Bridge must be the first script on the page and loaded from
          Shopify's CDN — it is what supplies the session token every API call
          in this app authenticates with.
        */}
        {/*
          App Bridge must load synchronously and before anything else: async
          loading is unsupported by Shopify and leaves window.shopify undefined
          when the first API call tries to fetch a session token.
        */}
        {apiKey ? (
          // eslint-disable-next-line @next/next/no-sync-scripts
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key={apiKey} />
        ) : null}
      </head>
      <body>
        <a className="cp-skip-link" href="#main-content">
          Skip to content
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
