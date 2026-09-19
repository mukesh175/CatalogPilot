/** Shopify Billing API documents. */

export const CREATE_SUBSCRIPTION = `
  mutation CreateSubscription(
    $name: String!
    $returnUrl: URL!
    $test: Boolean
    $trialDays: Int
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: $lineItems
    ) {
      appSubscription { id name status test }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

export const CANCEL_SUBSCRIPTION = `
  mutation CancelSubscription($id: ID!) {
    appSubscriptionCancel(id: $id) {
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

export const CURRENT_SUBSCRIPTIONS = `
  query CurrentSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        currentPeriodEnd
        trialDays
        lineItems {
          plan {
            pricingDetails {
              ... on AppRecurringPricing {
                price { amount currencyCode }
                interval
              }
            }
          }
        }
      }
    }
  }
`;
