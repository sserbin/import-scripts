# Zuora Catalog Import Script

Imports product catalog data from **Zuora** into **Stigg** by converting Zuora products, rate plans, and charges into Stigg products, plans, add-ons, and prices via the Stigg GraphQL API.

---

## Features

- Imports Zuora products, plans, add-ons, and flat-rate prices into Stigg
- Automatically detects add-ons (`add-on` / `addon` in name)
- Supports **create**, **update**, and **publish** workflows
- **Grandfathered plan forking** — mark plans/add-ons as grandfathered, and the next import creates a new copy with entitlements preserved
- Dry-run mode to preview changes without modifying Stigg

---

## How It Works

- The **first Zuora product** becomes the main product in Stigg
- All plans and add-ons from additional products are assigned to it
- Rate plans are split into **plans** and **add-ons**
- **Flat-rate** and **per-unit** (imported as flat-fee) pricing is supported
- Packages are grouped by Billing Period and created as **draft** by default

---

## Unarchiving Existing Products and Plans

If a product or packages with the same `refId` already exists in the Stigg database and is archived, it will be automatically unarchived during import.

---

## Requirements

- Node.js
- Yarn or NPM

---

## Setup

Use the provided `.env.example` file as a template:

```bash
cp .env.example .env
```

Update the values in `.env`:

```bash
X_API_KEY=your-stigg-api-server-key
ENVIRONMENT_ID=your-stigg-environment-id
ZUORA_PRODUCT_IDS=zuoraProductId1,zuoraProductId2
```

---

## Install

```bash
yarn install
```

---

## Usage

### Default import

```bash
yarn run zuora-import
```

- Creates **new entities only**
- All entities are created as **draft**

---

### Update mode

```bash
yarn run zuora-import --update
```

- Creates **new entities** if they don’t exist
- Updates **existing entities**
- Does **not** publish

---

### Delete Existing mode (NOT RECOMMENDED FOR PRODUCTION)

```bash
yarn run zuora-import --delete-existing
```

- Deletes existing product before import by ref Id
- Creates **new entities** if they don’t exist
- Does **not** publish

---

### Publish mode

```bash
yarn run zuora-import --publish
```

- Creates **new entities** if they don’t exist
- Publishes **all unpublished entities**
- Does **not** update existing published entities

---

### Update + Publish

```bash
yarn run zuora-import --update --publish
```

- Creates **new entities**
- Updates **existing entities**
- Publishes **all unpublished entities**

---

### Dry-run mode (combinable with any flags)

```bash
yarn run zuora-import --dry-run
yarn run zuora-import --update --dry-run
yarn run zuora-import --publish --dry-run
yarn run zuora-import --update --publish --dry-run
```

- **No changes are applied to Stigg**
- All actions are **previewed in the console only**

---

## Grandfathered Plan Forking

Allows you to "freeze" a plan or add-on in Stigg so it is preserved as-is, while the next import creates a new copy with the latest Zuora data and entitlements carried over.

### Step 1: Fork (mark as grandfathered)

```bash
yarn run zuora-import:fork <plan-or-addon-refId>
```

- Looks up the plan/add-on by `refId` in Stigg
- Sets `GRANDFATHERED: true` in its metadata
- Handles draft/publish lifecycle automatically

### Step 2: Re-run import

```bash
yarn run zuora-import --publish
```

On the next import, the script detects the grandfathered entity and:

1. Creates a **new** plan/add-on with a `-copy-1` suffix (e.g. `Pro_Plan-copy-1`)
2. Copies all **entitlements** from the grandfathered version to the new one
3. Leaves the grandfathered entity untouched

### Chaining

You can fork the copy and re-import again — suffixes increment automatically:

- `Pro_Plan` (grandfathered) → `Pro_Plan-copy-1`
- `Pro_Plan-copy-1` (grandfathered) → `Pro_Plan-copy-2`
- `Pro_Plan-copy-2` (not grandfathered) → updated in place

---

## Linking an Existing Plan to an Existing Zuora Rate Plan

For plans created directly in the Stigg UI that should reuse Zuora billing artifacts already owned by another plan — e.g. a monthly-reset sibling of an annual-reset plan, or a grandfathering cohort split. This only wires up the Zuora linkage (`billingId` + prices); it does not create the plan, copy entitlements, or touch Zuora.

### Step 1: Create the plan in Stigg UI

- Correct product, display name, description, refId
- Set `additionalMetaData.ZUORA__SYNC_SKIP_UPDATE: "true"` at create time, before publish — this stops Stigg's Zuora sync from mutating the shared rate plan/prices
- Configure entitlements
- Keep as **DRAFT**

### Step 2: Look up the Zuora IDs

In Zuora UI, find the Zuora Product ID and the Rate Plan ID(s) for the billing periods this plan should reuse (e.g. one for monthly, one for annual).

### Step 3: Run the CLI

```bash
npm run link-plan-to-zuora:dry-run -- \
  --env-file=.env \
  --stiggPlanRefId=<stigg-plan-refId> \
  --zuoraProductId=<zuora-product-id> \
  --zuoraRatePlanId=<zuora-rate-plan-id> \
  [--zuoraRatePlanId=<another-rate-plan-id-for-a-different-billing-period>]
```

- Amount, currency, and billing model are looked up from Zuora automatically — you only need the Zuora IDs, not the price details
- Warns (doesn't fail) if `ZUORA__SYNC_SKIP_UPDATE` isn't set on the plan; pass `--force` to proceed anyway
- Fails if the plan already has a different `billingId` set — won't silently overwrite an existing linkage
- Drop `:dry-run` (or add `--publish`) to actually write, once the dry-run payload looks right

The Zuora linkage lives at three levels: the Stigg plan's `billingId` points at the Zuora **Product**, each price model's `priceGroupPackageBillingId` at a Zuora **Rate Plan**, and each price's `billingId` at a Zuora **Rate Plan Charge**. The rate-plan link therefore rides on the price, so linking always goes through `setPackagePricing`.

**`setPackagePricing` replaces the plan's entire pricing.** It sets exactly the one charge per rate plan derived from Zuora and drops everything else. On a plan with a single charge that's what you want.

This breaks **custom plans that use the per-entitlement charge workaround** — where the plan carries one extra $0 per-unit charge per custom entitlement (e.g. `feature-api-requests`, `feature-data-connections`) alongside the real base charge, purely to express those entitlements in Stigg. Linking such a plan keeps only the derived base charge and drops all the per-entitlement charges (and can drop the entitlements with them). The dry-run prints `WARNING: Plan ... already has N price(s) that differ ... will replace them` — if you see it on one of these plans, either rebuild the per-entitlement charges by hand afterward, or set the linkage in the UI instead.

### Step 4: Verify and publish

Check Zuora UI that the shared rate plan/prices weren't modified. For a multi-charge plan, also confirm in Stigg that the other charges and their entitlements are intact (rebuild any that were replaced). Then publish the plan (via UI or `--publish` on the CLI).
