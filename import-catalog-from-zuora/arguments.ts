import dotenv from "dotenv";
import yargs from "yargs";

// Extract --env-file before yargs parses (needed for dotenv to load first)
const envFileArg = process.argv.find((arg) => arg.startsWith("--env-file="));
const envFile = envFileArg ? envFileArg.split("=")[1] : ".env";

dotenv.config({ path: envFile });

const argv = yargs(process.argv.slice(2))
  .option("environmentId", {
    type: "string",
    describe: "Stigg Environment ID",
    demandOption: false,
  })
  .option("zuoraProductIds", {
    type: "string",
    describe: "Zuora Product IDs",
    demandOption: false,
  })
  .option("dryRun", {
    type: "boolean",
    describe: "Dry Run Mode",
    demandOption: false,
  })
  .option("publish", {
    type: "boolean",
    describe: "Publish Mode",
    demandOption: false,
  })
  .option("delete-existing", {
    type: "boolean",
    describe: "Delete Existing",
    demandOption: false,
  })
  .option("update", {
    type: "boolean",
    describe: "Update Mode",
    demandOption: false,
  })
  .parseSync();

const BASE_URL: string = process.env.BASE_URL || "https://api.stigg.io/graphql";
const X_API_KEY = process.env.X_API_KEY || "";
const environmentId = argv.environmentId || process.env.ENVIRONMENT_ID || "";
const zuoraProductIds =
  argv.zuoraProductIds || process.env.ZUORA_PRODUCT_IDS || "";
const isDryRun =
  argv.dryRun !== undefined ? argv.dryRun : process.env.DRY_RUN === "true";

const publishMode =
  argv.publish !== undefined ? argv.publish : process.env.PUBLISH === "true";

const updateMode =
  argv.update !== undefined ? argv.update : process.env.UPDATE === "true";

const deleteExisting =
  argv.deleteExisting !== undefined
    ? argv.deleteExisting
    : process.env.DELETE_EXISTING === "true";

if (!X_API_KEY) {
  throw new Error("X_API_KEY is not defined, please set it in .env file");
}
if (!environmentId) {
  throw new Error(
    "ENVIRONMENT_ID is not defined, please set it in .env file or pass as argument --environmentId"
  );
}
if (!zuoraProductIds) {
  throw new Error(
    "ZUORA_PRODUCT_IDS is not defined, please set it in .env file or pass as argument --zuoraProductIds"
  );
}

export {
  BASE_URL,
  X_API_KEY,
  environmentId,
  zuoraProductIds,
  isDryRun,
  publishMode,
  updateMode,
  deleteExisting,
};
