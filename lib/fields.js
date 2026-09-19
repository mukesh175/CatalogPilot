/**
 * The catalog of Shopify target fields a supplier column can map to.
 *
 * `aliases` drives deterministic matching in the mapping engine. `risk` marks
 * fields where a wrong mapping is expensive (status can unpublish a catalog,
 * price can mis-charge customers) — those are never auto-confirmed on a fuzzy
 * match alone.
 */

export const TARGET_FIELDS = [
  {
    key: 'product.title',
    label: 'Title',
    group: 'Product',
    type: 'string',
    required: true,
    risk: 'low',
    aliases: ['title', 'product name', 'name', 'product title', 'item name', 'product'],
  },
  {
    key: 'product.descriptionHtml',
    label: 'Description',
    group: 'Product',
    type: 'html',
    risk: 'low',
    aliases: ['description', 'body', 'body html', 'product description', 'details', 'long description'],
  },
  {
    key: 'product.vendor',
    label: 'Vendor',
    group: 'Product',
    type: 'string',
    risk: 'low',
    aliases: ['vendor', 'brand', 'manufacturer', 'supplier', 'brand name'],
  },
  {
    key: 'product.productType',
    label: 'Product type',
    group: 'Product',
    type: 'string',
    risk: 'low',
    aliases: ['product type', 'type', 'category', 'product category', 'item type'],
  },
  {
    key: 'product.tags',
    label: 'Tags',
    group: 'Product',
    type: 'list',
    risk: 'low',
    aliases: ['tags', 'tag', 'keywords', 'labels'],
  },
  {
    key: 'product.status',
    label: 'Status',
    group: 'Product',
    type: 'enum',
    risk: 'high',
    aliases: ['status', 'product status', 'active', 'published'],
  },
  {
    key: 'product.handle',
    label: 'Handle',
    group: 'Product',
    type: 'string',
    risk: 'medium',
    aliases: ['handle', 'slug', 'url handle', 'permalink'],
  },
  {
    key: 'product.seoTitle',
    label: 'SEO title',
    group: 'Product',
    type: 'string',
    risk: 'low',
    aliases: ['seo title', 'meta title', 'page title'],
  },
  {
    key: 'product.seoDescription',
    label: 'SEO description',
    group: 'Product',
    type: 'string',
    risk: 'low',
    aliases: ['seo description', 'meta description'],
  },
  {
    key: 'product.collection',
    label: 'Collection',
    group: 'Product',
    type: 'list',
    risk: 'low',
    aliases: ['collection', 'collections', 'category', 'department'],
  },

  {
    key: 'variant.sku',
    label: 'SKU',
    group: 'Variant',
    type: 'string',
    required: true,
    risk: 'high',
    aliases: ['sku', 'variant sku', 'item code', 'product code', 'article number', 'style code'],
  },
  {
    key: 'variant.barcode',
    label: 'Barcode',
    group: 'Variant',
    type: 'string',
    risk: 'medium',
    aliases: ['barcode', 'ean', 'upc', 'gtin', 'isbn'],
  },
  {
    key: 'variant.price',
    label: 'Price',
    group: 'Variant',
    type: 'money',
    risk: 'high',
    aliases: ['price', 'selling price', 'sale price', 'retail price', 'rate', 'mrp'],
  },
  {
    key: 'variant.compareAtPrice',
    label: 'Compare-at price',
    group: 'Variant',
    type: 'money',
    risk: 'high',
    aliases: ['compare price', 'compare at price', 'compare-at price', 'list price', 'was price', 'original price'],
  },
  {
    key: 'variant.cost',
    label: 'Cost per item',
    group: 'Variant',
    type: 'money',
    risk: 'medium',
    aliases: ['cost', 'cost price', 'purchase price', 'buying price', 'wholesale price', 'unit cost'],
  },
  {
    key: 'variant.inventoryQuantity',
    label: 'Inventory quantity',
    group: 'Variant',
    type: 'integer',
    risk: 'high',
    aliases: ['inventory', 'stock', 'quantity', 'qty', 'available', 'stock quantity', 'on hand'],
  },
  {
    key: 'variant.weight',
    label: 'Weight',
    group: 'Variant',
    type: 'number',
    risk: 'low',
    aliases: ['weight', 'item weight', 'shipping weight', 'gross weight'],
  },
  {
    key: 'variant.weightUnit',
    label: 'Weight unit',
    group: 'Variant',
    type: 'enum',
    risk: 'low',
    aliases: ['weight unit', 'unit of weight', 'weight uom'],
  },
  {
    key: 'variant.option1Name',
    label: 'Option 1 name',
    group: 'Options',
    type: 'string',
    risk: 'medium',
    aliases: ['option 1 name', 'option1 name', 'option name 1'],
  },
  {
    key: 'variant.option1Value',
    label: 'Option 1 value',
    group: 'Options',
    type: 'string',
    risk: 'medium',
    aliases: ['option 1', 'option1', 'option 1 value', 'size', 'colour', 'color'],
  },
  {
    key: 'variant.option2Name',
    label: 'Option 2 name',
    group: 'Options',
    type: 'string',
    risk: 'medium',
    aliases: ['option 2 name', 'option2 name', 'option name 2'],
  },
  {
    key: 'variant.option2Value',
    label: 'Option 2 value',
    group: 'Options',
    type: 'string',
    risk: 'medium',
    aliases: ['option 2', 'option2', 'option 2 value'],
  },
  {
    key: 'variant.option3Name',
    label: 'Option 3 name',
    group: 'Options',
    type: 'string',
    risk: 'medium',
    aliases: ['option 3 name', 'option3 name', 'option name 3'],
  },
  {
    key: 'variant.option3Value',
    label: 'Option 3 value',
    group: 'Options',
    type: 'string',
    risk: 'medium',
    aliases: ['option 3', 'option3', 'option 3 value'],
  },

  {
    key: 'media.image1',
    label: 'Image 1',
    group: 'Media',
    type: 'url',
    risk: 'low',
    aliases: ['image', 'image url', 'image 1', 'image1', 'photo', 'picture', 'main image', 'featured image'],
  },
  {
    key: 'media.image2',
    label: 'Image 2',
    group: 'Media',
    type: 'url',
    risk: 'low',
    aliases: ['image 2', 'image2', 'image url 2', 'additional image 1'],
  },
  {
    key: 'media.image3',
    label: 'Image 3',
    group: 'Media',
    type: 'url',
    risk: 'low',
    aliases: ['image 3', 'image3', 'image url 3', 'additional image 2'],
  },
  {
    key: 'media.image4',
    label: 'Image 4',
    group: 'Media',
    type: 'url',
    risk: 'low',
    aliases: ['image 4', 'image4', 'image url 4'],
  },
];

export const TARGET_FIELD_MAP = new Map(TARGET_FIELDS.map((f) => [f.key, f]));

export const FIELD_GROUPS = ['Product', 'Variant', 'Options', 'Media'];

/** Fields the sync cannot run without. */
export const REQUIRED_FIELDS = TARGET_FIELDS.filter((f) => f.required).map((f) => f.key);

/** Fields whose mapping must be confirmed by the merchant before first sync. */
export const HIGH_RISK_FIELDS = new Set(
  TARGET_FIELDS.filter((f) => f.risk === 'high').map((f) => f.key)
);

export function fieldLabel(key) {
  return TARGET_FIELD_MAP.get(key)?.label || key;
}

/** Fields that can be referenced on the left side of a rule condition. */
export const RULE_CONDITION_FIELDS = TARGET_FIELDS.filter((f) =>
  ['product.productType', 'product.vendor', 'product.tags', 'product.collection', 'variant.sku', 'variant.cost', 'variant.price', 'variant.inventoryQuantity'].includes(f.key)
);
