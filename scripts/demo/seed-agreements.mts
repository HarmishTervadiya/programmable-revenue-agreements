import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  initializationArgs,
  loadIdl,
  options,
  validatedSeeds,
} from "./model.mts";
import { addresses, connect, inspectAgreement, setup } from "./runtime.mts";

export async function main(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.log,
) {
  const opts = options(args, ["--plan", "--execute"], env);
  const idl = loadIdl(),
    seeds = validatedSeeds(opts.offset);
  if (!opts.execute) {
    const plan = {
      mode: "OFFLINE PLAN ONLY; no RPC or transactions",
      rpc: opts.rpc,
      namespace: opts.offset,
      paymentDecimals: 6,
      supplyUnit: "entitlement base units (six decimals)",
      sharePriceUnit: "payment base units; purchase pricing is not implemented",
      roles:
        "deterministic Creator/payer, distinct depositor and Compliance Admin",
      seeds,
    };
    log(JSON.stringify(plan, null, 2));
    return plan;
  }
  const ctx = await connect(opts, idl, true);
  // Inspect every existing seed before any funding/initialization transaction.
  for (const seed of seeds) {
    const p = addresses(ctx, seed);
    if (await ctx.connection.getAccountInfo(p.config))
      await inspectAgreement(ctx, seed, p);
    else
      for (const address of [
        p.mint.publicKey,
        p.vault,
        p.treasury,
        p.extraMetas,
        ...p.tiers,
      ]) {
        if (await ctx.connection.getAccountInfo(address))
          throw new Error(
            `Seed ${seed.name} has orphaned/existing account ${address}; choose a fresh DEMO_ID_OFFSET, never overwrite`,
          );
      }
  }
  await setup(ctx, opts.amount, false);
  for (const seed of seeds) {
    const p = addresses(ctx, seed);
    if (await ctx.connection.getAccountInfo(p.config))
      console.log(
        `${seed.name}: existing agreement verified; initialization skipped`,
      );
    else {
      const accounts = {
        creator: ctx.payer.publicKey,
        agreementConfig: p.config,
        shareMint: p.mint.publicKey,
        paymentMint: ctx.mint.publicKey,
        paymentDestination: ctx.creatorAta,
        vault: p.vault,
        treasury: p.treasury,
        extraMetas: p.extraMetas,
        tier0: p.tiers[0],
        tier1: p.tiers[1],
        tier2: p.tiers[2],
        tier3: p.tiers[3],
        tier4: p.tiers[4],
        token2022Program: ctx.token.TOKEN_2022_PROGRAM_ID,
        systemProgram: ctx.SystemProgram.programId,
        tokenProgram: ctx.token.TOKEN_PROGRAM_ID,
      };
      const args = initializationArgs(
        seed,
        (s) => new ctx.anchor.BN(s),
        ctx.payer.publicKey,
        ctx.depositor.publicKey,
        ctx.admin.publicKey,
        ctx.creatorAta,
      );
      const signature = await ctx.program.methods
        .initializeAgreement(...args)
        .accountsStrict(accounts)
        .signers([p.mint])
        .rpc({ commitment: "confirmed" });
      console.log(
        `${seed.name}: initialization confirmed signature=${signature}`,
      );
    }
    await inspectAgreement(ctx, seed, p);
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(`Seed demo failed: ${error.message}`);
    process.exitCode = 1;
  });
