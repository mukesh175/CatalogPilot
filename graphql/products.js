/**
 * Admin GraphQL documents for catalog operations.
 *
 * Kept as plain strings in one place so the API surface the app depends on is
 * auditable — when Shopify deprecates a field, this is the only file to change.
 */

const PRODUCT_FIELDS = `
  id
  handle
  title
  descriptionHtml
  vendor
  productType
  status
  tags
  updatedAt
  seo { title description }
  media(first: 10) {
    nodes { id ... on MediaImage { image { url } } }
  }
`;

const VARIANT_FIELDS = `
  id
  title
  sku
  barcode
  price
  compareAtPrice
  selectedOptions { name value }
  inventoryQuantity
  inventoryItem {
    id
    unitCost { amount }
    measurement { weight { value unit } }
  }
`;

/** Looks a product up by the SKU of one of its variants. */
export const FIND_VARIANT_BY_SKU = `
  query FindVariantBySku($query: String!) {
    productVariants(first: 5, query: $query) {
      nodes {
        ${VARIANT_FIELDS}
        product {
          ${PRODUCT_FIELDS}
          variants(first: 100) { nodes { id sku } }
        }
      }
    }
  }
`;

export const GET_PRODUCT = `
  query GetProduct($id: ID!) {
    product(id: $id) {
      ${PRODUCT_FIELDS}
      variants(first: 100) { nodes { ${VARIANT_FIELDS} } }
      collections(first: 50) { nodes { id title } }
    }
  }
`;

export const LIST_PRODUCTS = `
  query ListProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        handle
        title
        status
        vendor
        productType
        totalInventory
        featuredMedia { ... on MediaImage { image { url } } }
        variants(first: 1) { nodes { id sku price } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const CREATE_PRODUCT = `
  mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        handle
        title
        variants(first: 1) { nodes { id sku inventoryItem { id } } }
      }
      userErrors { field message }
    }
  }
`;

export const UPDATE_PRODUCT = `
  mutation UpdateProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id handle title status updatedAt }
      userErrors { field message }
    }
  }
`;

export const CREATE_PRODUCT_MEDIA = `
  mutation CreateProductMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id status }
      mediaUserErrors { field message code }
    }
  }
`;

export const BULK_CREATE_VARIANTS = `
  mutation BulkCreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
      productVariants { id sku inventoryItem { id } }
      userErrors { field message }
    }
  }
`;

export const BULK_UPDATE_VARIANTS = `
  mutation BulkUpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id sku price compareAtPrice barcode inventoryItem { id } }
      userErrors { field message }
    }
  }
`;

export const SET_INVENTORY = `
  mutation SetInventory($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { createdAt reason }
      userErrors { field message code }
    }
  }
`;

export const ACTIVATE_INVENTORY = `
  mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
    inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
      inventoryLevel { id quantities(names: ["available"]) { name quantity } }
      userErrors { field message }
    }
  }
`;

export const FIND_COLLECTION = `
  query FindCollection($query: String!) {
    collections(first: 10, query: $query) {
      nodes { id title handle }
    }
  }
`;

export const CREATE_COLLECTION = `
  mutation CreateCollection($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection { id title handle }
      userErrors { field message }
    }
  }
`;

export const ADD_PRODUCTS_TO_COLLECTION = `
  mutation AddProductsToCollection($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection { id title }
      userErrors { field message }
    }
  }
`;

export const LIST_COLLECTIONS = `
  query ListCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
      nodes { id title handle productsCount { count } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const GET_SHOP = `
  query GetShop {
    shop {
      id
      name
      email
      myshopifyDomain
      currencyCode
      billingAddress { countryCodeV2 }
    }
    locations(first: 1, query: "status:active") {
      nodes { id name }
    }
  }
`;

export const GET_PRODUCT_COUNT = `
  query ProductCount {
    productsCount { count }
  }
`;
