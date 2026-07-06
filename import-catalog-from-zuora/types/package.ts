import { EntityResponse, QueryResponse } from "./abstract";

export const packageFields = `
        displayName
        description
        id
        refId
        status
        productId
        billingId
        additionalMetaData
        draftSummary {
          version
        }
        prices {
          billingCadence
          billingId
          billingModel
          billingPeriod
          id
          price {
            currency
            amount
          }
        }`;

export const packageEntitlementFields = `
        packageEntitlements {
          ... on PackageFeatureEntitlement {
            feature {
              refId
              featureType
            }
            hasUnlimitedUsage
            hasSoftLimit
            usageLimit
            resetPeriod
            isGranted
            order
            behavior
            description
            displayNameOverride
          }
          ... on PackageCreditEntitlement {
            amount
            cadence
            customCurrencyId
            isGranted
            order
            behavior
            description
            displayNameOverride
          }
        }`;

export type PackagePrice = {
  billingCadence: string;
  billingId: string;
  billingModel: string;
  billingPeriod: string;
  id: string;
  price: {
    currency: string;
    amount: number;
  };
};

export type PackageEntitlementBase = {
  isGranted?: boolean;
  order?: number;
  behavior?: string;
  description?: string;
  displayNameOverride?: string;
};

export type PackageFeatureEntitlement = PackageEntitlementBase & {
  feature: {
    refId: string;
    featureType: string;
  };
  hasUnlimitedUsage: boolean;
  hasSoftLimit?: boolean;
  usageLimit: number | null;
  resetPeriod: string | null;
};

export type PackageCreditEntitlement = PackageEntitlementBase & {
  amount: number;
  cadence: string | null;
  customCurrencyId: string | null;
};

export type PackageEntitlement =
  | PackageFeatureEntitlement
  | PackageCreditEntitlement;

export type Package = {
  id: string;
  refId: string;
  displayName: string;
  description: string;
  status?: string;
  type: "Plan" | "Addon";
  productId: string;
  billingId?: string | null;
  additionalMetaData?: Record<string, string>;
  draftSummary?: {
    version: number;
  };
  prices: PackagePrice[];
  draftId?: string;
  packageEntitlements?: PackageEntitlement[];
};

export type SearchPackageResponse<T extends string> = QueryResponse<T, Package>;

export type SearchPlansResponse = SearchPackageResponse<"plans">;
export type SearchAddonsResponse = SearchPackageResponse<"addons">;

export type PackageResponse<T extends string> = EntityResponse<T, Package>;

export type UpdatePlanResponse = PackageResponse<"updateOnePlan">;
export type CreatePlanResponse = PackageResponse<"createOnePlan">;
export type CreateAddonResponse = PackageResponse<"createOneAddon">;
export type UpdateAddonResponse = PackageResponse<"updateOneAddon">;

export type AddCompatibleAddonsToPlanResponse = {
  data: {
    addCompatibleAddonsToPlan: {
      id: string;
      __typename: string;
    };
  };
};

export type PublishResponse = {
  data: {
    publishAddon: {
      taskId: string | null;
      __typename: string;
    };
  };
};

export type DraftResponse = {
  id: string;
  refId: string;
  versionNumber: number;
  __typename: string;
};

export type CreateDraftResponse = {
  data: {
    createPlanDraft?: DraftResponse;
    createAddonDraft?: DraftResponse;
  };
  errors?: unknown;
};

export type PackageType = "Plan" | "Addon";

export type PackageInput = {
  additionalMetaData?: Record<string, string>;
  billingId?: string;
  description: string;
  displayName: string;
  environmentId?: string;
  pricingType?: "PAID" | "FREE" | "CUSTOM";
  productId?: string;
  refId?: string;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
};

export type CreatePackageInput = {
  input: PackageInput;
};

export type UpdatePackageInput = {
  input: Omit<PackageInput, "refId"> & {
    id: string;
  };
};

export type CreatePackageResponse = PackageResponse<
  "createOnePlan" | "createOneAddon"
>;
export type UpdatePackageResponse = PackageResponse<
  "updateOnePlan" | "updateOneAddon"
>;
