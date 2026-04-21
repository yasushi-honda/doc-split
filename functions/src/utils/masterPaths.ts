export const MASTER_PATHS = {
  documents: 'masters/documents/items',
  customers: 'masters/customers/items',
  offices: 'masters/offices/items',
} as const;

export type MasterType = keyof typeof MASTER_PATHS;
