/**
 * Link an already-created Stigg plan or addon (created via UI or otherwise) to
 * an already-existing Zuora Product + Rate Plan(s) + Prices.
 *
 * Takes a Stigg plan or addon refId, a Zuora Product ID, and one Zuora Rate
 * Plan ID per billing period. Amount, currency, and billing model are derived
 * from Zuora itself (via billingProducts) rather than passed on the CLI, so the
 * only IDs the caller needs are the ones copied out of the Zuora UI.
 *
 * All writes go to the package's draft (created if needed), and --publish
 * publishes that draft.
 *
 * Usage:
 *   tsx import-catalog-from-zuora/link-to-zuora.ts \
 *     --env-file=.env \
 *     --stiggPlanRefId=Intellistack_Streamline_Foundations_monthly_reset \
 *     (or --stiggAddonRefId=<addon refId>) \
 *     --zuoraProductId=8a129041948799c201948fcdc9bd6d23 \
 *     --zuoraRatePlanId=8a12904194dae4850194f17e4cb13642 \
 *     [--zuoraRatePlanId=<another one, e.g. the annual variant>] \
 *     [--relink] [--dryRun] [--publish] [--force]
 */

import dotenv from "dotenv";
import yargs from "yargs";

const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envFile = envFileArg ? envFileArg.split("=")[1] : ".env";
dotenv.config({ path: envFile });

import { ZUORA_SYNC_SKIP_UPDATE_KEY } from "./constants";
import { queryPackageByRefId, queryBillingProducts, queryZuoraIntegration } from "./graphql/queries";
import { updatePackageMutation, publishPackageMutation } from "./graphql/mutations/package";
import { createPriceMutation } from "./graphql/mutations/price";
import { getPackageDraftId } from "./package";
import { getDiscountPercentage } from "./price";
import { Package, PackageType } from "./types/package";
import { PriceModel } from "./types/price";
import { ZuoraPlan } from "./types/integration";

const argv = yargs(process.argv.slice(2))
  .option("environmentId", { type: "string" })
  .option("stiggPlanRefId", { type: "string", conflicts: "stiggAddonRefId" })
  .option("stiggAddonRefId", { type: "string", conflicts: "stiggPlanRefId" })
  .option("zuoraProductId", { type: "string", demandOption: true })
  .option("zuoraRatePlanId", {
    type: "string",
    array: true,
    demandOption: true,
    describe: "Zuora Rate Plan ID, repeatable, one per billing period",
  })
  .option("relink", {
    type: "boolean",
    default: false,
    describe: "Allow replacing an existing, different Zuora Product linkage",
  })
  .option("dryRun", { type: "boolean", default: false })
  .option("publish", { type: "boolean", default: false })
  .option("force", {
    type: "boolean",
    default: false,
    describe: "Proceed even if ZUORA__SYNC_SKIP_UPDATE is not set on the package",
  })
  .check((args) => {
    if (!args.stiggPlanRefId && !args.stiggAddonRefId) {
      throw new Error("One of --stiggPlanRefId or --stiggAddonRefId is required");
    }
    return true;
  })
  .parseSync();

const BASE_URL = process.env.BASE_URL || "https://api.stigg.io/graphql";
const X_API_KEY = process.env.X_API_KEY || "";
const environmentId = argv.environmentId || process.env.ENVIRONMENT_ID || "";
const isDryRun = argv.dryRun;
const shouldPublish = argv.publish;
const force = argv.force;
const relink = argv.relink;
const type: PackageType = argv.stiggAddonRefId ? "Addon" : "Plan";
const refId = (argv.stiggAddonRefId || argv.stiggPlanRefId)!;
const label = type.toLowerCase();

if (!X_API_KEY) throw new Error("X_API_KEY not set");
if (!environmentId) throw new Error("ENVIRONMENT_ID not set (env or --environmentId)");

function hasSyncSkipUpdate(aPackage: Package): boolean {
  const meta = aPackage.additionalMetaData;
  if (!meta) return false;
  return Object.entries(meta).some(
    ([key, value]) =>
      key.toLowerCase() === ZUORA_SYNC_SKIP_UPDATE_KEY.toLowerCase() &&
      `${value}`.toLowerCase() === "true"
  );
}

async function getIntegrationId(): Promise<string> {
  const integration = await queryZuoraIntegration(environmentId);
  if (integration.errors) {
    throw new Error(`Error fetching Zuora integration: ${JSON.stringify(integration.errors)}`);
  }
  const integrationId = integration.data?.integrations.edges[0]?.node.id;
  if (!integrationId) {
    throw new Error("No Zuora integration found for the given environment ID");
  }
  return integrationId;
}

async function fetchRatePlans(zuoraProductId: string, integrationId: string): Promise<ZuoraPlan[]> {
  const response = await queryBillingProducts(zuoraProductId, integrationId);
  const products = response.data?.billingProducts?.products ?? [];
  const product = products.find((p) => p.id === zuoraProductId);
  if (!product) {
    throw new Error(`Zuora product not found: ${zuoraProductId}`);
  }
  return product.plans ?? [];
}

function toPriceModel(ratePlan: ZuoraPlan): PriceModel {
  const discountPercentage = getDiscountPercentage(ratePlan);
  const charge = ratePlan.prices.find(
    (price) => `${price.chargeModel}`.toLowerCase() !== "discount_percentage"
  );
  if (!charge) {
    throw new Error(
      `Zuora rate plan ${ratePlan.id} (${ratePlan.name}) has no non-discount charge to link.`
    );
  }
  const chargeModel = charge.chargeModel.toLowerCase();
  const billingModel = chargeModel === "flat_fee" || chargeModel === "per_unit" ? "FLAT_FEE" : null;
  if (!billingModel) {
    throw new Error(
      `Zuora rate plan ${ratePlan.id} (${ratePlan.name}) has unsupported charge model: ${charge.chargeModel}`
    );
  }
  const amount = (charge.amount || 0) * (1 - discountPercentage / 100);

  return {
    billingCadence: "RECURRING",
    billingModel,
    pricePeriods: [
      {
        billingId: charge.id,
        priceGroupPackageBillingId: ratePlan.id,
        billingPeriod: charge.billingPeriod,
        price: { amount, currency: "USD" },
      },
    ],
  };
}

function groupPriceModels(priceModels: PriceModel[]): PriceModel[] {
  const grouped: PriceModel[] = [];
  for (const pm of priceModels) {
    const existing = grouped.find(
      (g) => g.billingModel === pm.billingModel && g.billingCadence === pm.billingCadence
    );
    if (existing) {
      existing.pricePeriods.push(...pm.pricePeriods);
    } else {
      grouped.push(pm);
    }
  }
  return grouped;
}

function pricesAlreadyMatch(aPackage: Package, priceModels: PriceModel[]): boolean {
  const wantedPeriods = priceModels.flatMap((pm) => pm.pricePeriods);
  if (aPackage.prices.length !== wantedPeriods.length) return false;
  return wantedPeriods.every((wanted) =>
    aPackage.prices.some(
      (existing) =>
        existing.billingId === wanted.billingId &&
        existing.billingPeriod === wanted.billingPeriod &&
        existing.price.amount === wanted.price.amount &&
        existing.price.currency === wanted.price.currency
    )
  );
}

async function main() {
  console.log(`Fetching Stigg ${label}: ${refId}`);
  const aPackage = await queryPackageByRefId(type, refId, false, environmentId);
  if (!aPackage) {
    throw new Error(`${type} not found: refId=${refId}`);
  }
  console.log(
    `Found ${label}: id=${aPackage.id} refId=${aPackage.refId} status=${aPackage.status} ` +
      `billingId=${aPackage.billingId ?? "(none)"}`
  );

  const isProductChange = !!aPackage.billingId && aPackage.billingId !== argv.zuoraProductId;
  if (isProductChange) {
    if (!relink) {
      throw new Error(
        `${type} ${aPackage.refId} already has billingId=${aPackage.billingId}, which differs from ` +
          `--zuoraProductId=${argv.zuoraProductId}. Refusing to overwrite an existing Zuora linkage. ` +
          `Re-run with --relink to replace it.`
      );
    }
    console.warn(
      `WARNING: relinking ${label} ${aPackage.refId} from Zuora product ${aPackage.billingId} ` +
        `to ${argv.zuoraProductId}.`
    );
  }

  if (!hasSyncSkipUpdate(aPackage)) {
    const message =
      `${type} ${aPackage.refId} does not have ${ZUORA_SYNC_SKIP_UPDATE_KEY}=true set. ` +
      `Without it, Stigg's Zuora sync may mutate the shared Zuora rate plan/prices this ` +
      `${label} is about to link to.`;
    if (!force) {
      throw new Error(`${message} Re-run with --force to proceed anyway.`);
    }
    console.warn(`WARNING: ${message} Proceeding because --force was passed.`);
  }

  console.log(`Looking up Zuora rate plan(s) on product ${argv.zuoraProductId}...`);
  const integrationId = await getIntegrationId();
  const ratePlans = await fetchRatePlans(argv.zuoraProductId!, integrationId);

  const priceModels: PriceModel[] = [];
  for (const ratePlanId of argv.zuoraRatePlanId as string[]) {
    const ratePlan = ratePlans.find((p) => p.id === ratePlanId);
    if (!ratePlan) {
      throw new Error(
        `Zuora rate plan ${ratePlanId} not found on product ${argv.zuoraProductId}.`
      );
    }
    if (!ratePlan.active) {
      console.warn(`WARNING: Zuora rate plan ${ratePlanId} (${ratePlan.name}) is inactive.`);
    }
    const priceModel = toPriceModel(ratePlan);
    const period = priceModel.pricePeriods[0];
    console.log(
      `  - ${ratePlan.name} (${ratePlanId}): ${period.billingPeriod} ${priceModel.billingModel} ` +
        `${period.price.amount} ${period.price.currency} (zuoraPriceId=${period.billingId})`
    );
    priceModels.push(priceModel);
  }
  const groupedPriceModels = groupPriceModels(priceModels);

  const needsBillingIdUpdate = !aPackage.billingId || isProductChange;
  const needsPricingUpdate =
    aPackage.prices.length === 0 || !pricesAlreadyMatch(aPackage, groupedPriceModels);

  if (!needsBillingIdUpdate && !needsPricingUpdate) {
    console.log(`${type} is already linked to the requested Zuora product and prices. Nothing to do.`);
    return;
  }

  // Dry run never creates a draft, so the published id stands in for it in the printed payloads.
  const draftId = isDryRun ? aPackage.id : await getPackageDraftId(aPackage);
  if (!isDryRun && draftId !== aPackage.id) {
    console.log(`Writing to ${label} draft ${draftId}.`);
  }

  if (needsBillingIdUpdate) {
    const updateVariables = {
      input: {
        id: draftId,
        billingId: argv.zuoraProductId,
        displayName: aPackage.displayName,
        description: aPackage.description,
      },
    };
    if (isDryRun) {
      console.log(`[Dry Run] updateOne${type} input:\n`, JSON.stringify(updateVariables, null, 2));
    } else {
      console.log(`Setting billingId=${argv.zuoraProductId} on ${label} draft ${draftId}...`);
      await updatePackageMutation(type, updateVariables);
    }
  } else {
    console.log(`${type} already has billingId=${aPackage.billingId}, skipping updateOne${type}.`);
  }

  if (!needsPricingUpdate) {
    console.log(`${type} prices already match the requested prices, skipping setPackagePricing.`);
  } else {
    if (aPackage.prices.length > 0) {
      console.warn(
        `WARNING: ${type} ${aPackage.refId} already has ${aPackage.prices.length} price(s) that differ ` +
          `from the ones being set. setPackagePricing will replace them.`
      );
    }
    const pricingVariables = {
      input: {
        environmentId,
        packageId: draftId,
        pricingType: "PAID" as const,
        pricingModels: groupedPriceModels,
      },
    };
    if (isDryRun) {
      console.log("[Dry Run] setPackagePricing input:\n", JSON.stringify(pricingVariables, null, 2));
    } else {
      console.log(`Setting pricing on ${label} draft ${draftId}...`);
      const response = await createPriceMutation(pricingVariables);
      if (response.errors) {
        throw new Error(
          `Error setting pricing for ${label} ${aPackage.refId}: ${JSON.stringify(response.errors)}`
        );
      }
      console.log(`Pricing set.`);
    }
  }

  if (shouldPublish) {
    if (isDryRun) {
      console.log(`[Dry Run] would publish ${label} ${aPackage.refId}`);
    } else {
      console.log(`Publishing ${label} draft ${draftId}...`);
      const response = await publishPackageMutation(type, draftId, aPackage.refId!);
      if (response.errors) {
        throw new Error(
          `Error publishing ${label} ${aPackage.refId}: ${JSON.stringify(response.errors)}`
        );
      }
      console.log(`Published.`);
    }
  } else {
    console.log(`Skipping publish (use --publish to publish).`);
  }

  console.log(`\nDone. Verify in Zuora UI that the shared rate plan/prices were NOT modified.`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
