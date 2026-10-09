import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  instruction,
  loadIdl,
  options,
  toBaseUnits,
  validatedSeeds,
} from "./model.mts";
import { addresses, connect, inspectAgreement, setup } from "./runtime.mts";

export async function main(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.log,
) {
  const opts = options(args, ["--plan", "--execute", "--deposit"], env);
  const idl = loadIdl();
  const blocked = !instruction(idl, "deposit_revenue");
  // Deliberately no speculative deposit client, even if a future IDL adds the handler.
  if (opts.deposit)
    throw new Error(
      blocked
        ? "BLOCKED: deposit_revenue is absent. No revenue deposit or setup transaction submitted."
        : "Deposit handler now exists, but this setup-only kit needs review against its actual interface before depositing. No transaction submitted.",
    );
  if (!opts.execute) {
    const plan = {
      mode: "OFFLINE SETUP PLAN ONLY; no RPC or transactions",
      rpc: opts.rpc,
      namespace: opts.offset,
      mockAmount: opts.amount,
      targetDepositorBalanceBaseUnits: toBaseUnits(opts.amount).toString(),
      paymentDecimals: 6,
      payer: "deterministic demo Creator/payer",
      paymentMint: "deterministic local classic SPL mock mint",
      source: "designated depositor payment ATA",
      destination:
        "depositor ATA for mock minting; Creator ATA for agreement payments",
      agreements: validatedSeeds(opts.offset).map((s) => ({
        name: s.name,
        agreementId: s.agreementId,
      })),
      revenueDeposit: blocked
        ? "BLOCKED: deposit_revenue absent; vault remains untouched"
        : "Not implemented in this setup-only kit",
    };
    log(JSON.stringify(plan, null, 2));
    return plan;
  }
  const ctx = await connect(opts, idl, false);
  // Existing agreement mismatches are rejected before setup sends any transaction.
  for (const seed of validatedSeeds(opts.offset)) {
    const p = addresses(ctx, seed);
    if (await ctx.connection.getAccountInfo(p.config))
      await inspectAgreement(ctx, seed, p);
    else
      console.log(
        `${seed.name}: agreement=${p.config} vault=${p.vault} NOT INITIALIZED (run seed-agreements)`,
      );
  }
  await setup(ctx, opts.amount, true);
  console.log(
    "Mock depositor setup completed. NO REVENUE DEPOSIT performed; no vault transfer, counter update, waterfall allocation or claim accrual attempted.",
  );
  if (blocked)
    console.log(
      "BLOCKED: deposit_revenue instruction is absent from this checkout.",
    );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(`Mock depositor failed: ${error.message}`);
    process.exitCode = 1;
  });
