import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { SharedCtx, sendWithRetry } from "../helpers";
import {
  newFundedBuyer,
  purchaseAccountsFor,
} from "./purchase-share";

// Main-agreement tiers (see initialize happy path): tier0 up to 10 USDC 100%
// holders, tier1 uncapped 50/50. Supply 1e9 base units, PRECISION 1e12.
const TIER0_THRESHOLD = 10_000_000_000n;
const FIRST_DEPOSIT = new anchor.BN(4_000_000_000);
const SECOND_DEPOSIT = new anchor.BN(8_000_000_000);
// acc0 after #1: 4e9 * 1e12 / 1e9; after #2: 10e9 * 1e12 / 1e9.
const ACC0_AFTER_FIRST = "4000000000000";
const ACC0_AFTER_SECOND = "10000000000000";
// acc1 after #2: 2e9 * 5000 * 1e12 / (10000 * 1e9).
const ACC1_AFTER_SECOND = "1000000000000";
const CREATOR_OWED_AFTER_SECOND = "1000000000";

export function depositAccountsFor(
  ctx: SharedCtx,
  depositor: anchor.web3.PublicKey,
  depositorUsdc: anchor.web3.PublicKey,
) {
  return {
    depositor,
    agreementConfig: ctx.config,
    paymentMint: ctx.paymentMint!,
    depositorUsdcAccount: depositorUsdc,
    vault: ctx.vault,
    tier0: ctx.tierPdas[0],
    tier1: ctx.tierPdas[1],
    tier2: ctx.tierPdas[2],
    tier3: ctx.tierPdas[3],
    tier4: ctx.tierPdas[4],
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

export function defineDepositTests(ctx: SharedCtx) {
  const { provider, program } = ctx;
  let depositorUsdc: anchor.web3.PublicKey;

  it("Fund designated depositor with mock USDC", async () => {
    const payer = (provider.wallet as anchor.Wallet).payer;
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      ctx.paymentMint!,
      ctx.depositorKeypair.publicKey,
    );
    depositorUsdc = ata.address;
    // Covers both waterfall deposits plus the oversized last-tier deposit.
    await mintTo(
      provider.connection,
      payer,
      ctx.paymentMint!,
      depositorUsdc,
      provider.wallet.publicKey,
      3_000_000_000_000n,
    );
    const bal = await provider.connection.getTokenAccountBalance(depositorUsdc);
    expect(BigInt(bal.value.amount)).to.equal(3_000_000_000_000n);
  });

  it("Deposit #1 fills tier0 partially and sets acc0", async () => {
    const tx = await sendWithRetry(
      provider,
      () =>
        program.methods
          .depositRevenue(FIRST_DEPOSIT)
          .accountsPartial(
            depositAccountsFor(
              ctx,
              ctx.depositorKeypair.publicKey,
              depositorUsdc,
            ),
          )
          .signers([ctx.depositorKeypair])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "deposit-1",
    );
    console.log("\nDeposit #1 tx", tx);

    const cfg = await program.account.agreementConfig.fetch(ctx.config);
    expect(cfg.totalDeposited.toString()).to.equal(FIRST_DEPOSIT.toString());

    const t0 = await program.account.tierState.fetch(ctx.tierPdas[0]);
    expect((t0 as any).filled.toString()).to.equal(FIRST_DEPOSIT.toString());
    expect((t0 as any).accPerToken.toString()).to.equal(ACC0_AFTER_FIRST);

    const t1 = await program.account.tierState.fetch(ctx.tierPdas[1]);
    expect((t1 as any).filled.toString()).to.equal("0");
    expect((t1 as any).accPerToken.toString()).to.equal("0");

    const vaultBal = await provider.connection.getTokenAccountBalance(ctx.vault);
    expect(vaultBal.value.amount).to.equal(FIRST_DEPOSIT.toString());
  });

  it("Deposit #2 completes tier0 and spills into tier1 (creator owed)", async () => {
    const tx = await sendWithRetry(
      provider,
      () =>
        program.methods
          .depositRevenue(SECOND_DEPOSIT)
          .accountsPartial(
            depositAccountsFor(
              ctx,
              ctx.depositorKeypair.publicKey,
              depositorUsdc,
            ),
          )
          .signers([ctx.depositorKeypair])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "deposit-2",
    );
    console.log("\nDeposit #2 tx", tx);

    const total = FIRST_DEPOSIT.add(SECOND_DEPOSIT);
    const cfg = await program.account.agreementConfig.fetch(ctx.config);
    expect(cfg.totalDeposited.toString()).to.equal(total.toString());

    const t0 = await program.account.tierState.fetch(ctx.tierPdas[0]);
    expect((t0 as any).filled.toString()).to.equal(TIER0_THRESHOLD.toString());
    expect((t0 as any).accPerToken.toString()).to.equal(ACC0_AFTER_SECOND);

    const t1 = await program.account.tierState.fetch(ctx.tierPdas[1]);
    // 2e9 spilled into tier1: holders 1e9 (acc1), creator owed 1e9.
    expect((t1 as any).filled.toString()).to.equal("2000000000");
    expect((t1 as any).accPerToken.toString()).to.equal(ACC1_AFTER_SECOND);
    const splits = (t1 as any).splits as Array<any>;
    expect(splits[1].owed.toString()).to.equal(CREATOR_OWED_AFTER_SECOND);
    expect(splits[1].party.wallet.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58(),
    );

    const vaultBal = await provider.connection.getTokenAccountBalance(ctx.vault);
    expect(vaultBal.value.amount).to.equal(total.toString());
  });

  it("Late buyer snapshots current accumulators (earns nothing retroactively)", async () => {
    const amount = new anchor.BN(1_000_000);
    const funded = await newFundedBuyer(
      ctx,
      BigInt(amount.toString()) * BigInt(ctx.sharePrice.toString()) * 2n,
    );
    await sendWithRetry(
      provider,
      () =>
        program.methods
          .purchaseShare(amount)
          .accountsPartial(
            purchaseAccountsFor(ctx, funded.buyer.publicKey, funded.buyerUsdc),
          )
          .signers([funded.buyer])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "late-buy",
    );

    const claim = await program.account.claimRecord.fetch(
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), ctx.config.toBuffer(), funded.buyer.publicKey.toBuffer()],
        program.programId,
      )[0],
    );
    const lastAcc = ((claim as any).lastAcc as anchor.BN[]).map((b) => b.toString());
    expect(lastAcc[0]).to.equal(ACC0_AFTER_SECOND);
    expect(lastAcc[1]).to.equal(ACC1_AFTER_SECOND);
    expect(((claim as any).pending as anchor.BN[]).map((b) => b.toString())).to.deep.equal([
      "0",
      "0",
      "0",
      "0",
      "0",
    ]);
  });

  it("Reject deposit from the wrong signer", async () => {
    const impostor = anchor.web3.Keypair.generate();
    const payer = (provider.wallet as anchor.Wallet).payer;
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      ctx.paymentMint!,
      impostor.publicKey,
    );
    await mintTo(
      provider.connection,
      payer,
      ctx.paymentMint!,
      ata.address,
      provider.wallet.publicKey,
      1_000_000n,
    );
    // Rent for the impostor's signature.
    const fundIx = SystemProgram.transfer({
      fromPubkey: provider.wallet.publicKey,
      toPubkey: impostor.publicKey,
      lamports: 10_000_000,
    });
    await sendWithRetry(
      provider,
      () =>
        provider.sendAndConfirm(new anchor.web3.Transaction().add(fundIx)),
      "fund-impostor",
    );

    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .depositRevenue(new anchor.BN(1_000_000))
            .accountsPartial(
              depositAccountsFor(ctx, impostor.publicKey, ata.address),
            )
            .signers([impostor])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "deposit-impostor",
      );
      throw new Error("Impostor deposit should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "UnauthorizedDepositor"
      ) {
        console.log("\nImpostor deposit failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }
  });

  it("Reject zero-amount deposit", async () => {
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .depositRevenue(new anchor.BN(0))
            .accountsPartial(
              depositAccountsFor(
                ctx,
                ctx.depositorKeypair.publicKey,
                depositorUsdc,
              ),
            )
            .signers([ctx.depositorKeypair])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "deposit-zero",
      );
      throw new Error("Zero deposit should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "InvalidAmount"
      ) {
        console.log("\nZero deposit failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }
  });

  it("Oversized deposit never fails: remainder lands in uncapped last tier", async () => {
    const big = new anchor.BN(1_000_000_000_000);
    const cfgBefore = await program.account.agreementConfig.fetch(ctx.config);
    const t1Before = await program.account.tierState.fetch(ctx.tierPdas[1]);

    await sendWithRetry(
      provider,
      () =>
        program.methods
          .depositRevenue(big)
          .accountsPartial(
            depositAccountsFor(
              ctx,
              ctx.depositorKeypair.publicKey,
              depositorUsdc,
            ),
          )
          .signers([ctx.depositorKeypair])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "deposit-big",
    );

    const cfg = await program.account.agreementConfig.fetch(ctx.config);
    expect(cfg.totalDeposited.toString()).to.equal(
      cfgBefore.totalDeposited.add(big).toString(),
    );

    // Tier0 stays full; everything spilled into tier1.
    const t0 = await program.account.tierState.fetch(ctx.tierPdas[0]);
    expect((t0 as any).filled.toString()).to.equal(TIER0_THRESHOLD.toString());
    const t1 = await program.account.tierState.fetch(ctx.tierPdas[1]);
    expect((t1 as any).filled.toString()).to.equal(
      (t1Before as any).filled.add(big).toString(),
    );
    expect(
      BigInt((t1 as any).accPerToken.toString()) >
        BigInt((t1Before as any).accPerToken.toString()),
    ).to.equal(true);

    const vaultBal = await provider.connection.getTokenAccountBalance(ctx.vault);
    expect(vaultBal.value.amount).to.equal(cfg.totalDeposited.toString());
  });

  it("end_cap crossing is accepted in full (cap only arms expiry)", async () => {
    // Fresh agreement with a tiny cap, provider wallet as depositor.
    const agreementId = new anchor.BN(Math.floor(Math.random() * 1_000_000_000));
    const shareMint = anchor.web3.Keypair.generate();
    const creator = provider.wallet.publicKey;
    const [config] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("agreement"),
        creator.toBuffer(),
        agreementId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );
    const [vault] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), config.toBuffer()],
      program.programId,
    );
    const [treasury] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), config.toBuffer()],
      program.programId,
    );
    const [extraMetas] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), shareMint.publicKey.toBuffer()],
      program.programId,
    );
    const tierPdas = [0, 1, 2, 3, 4].map(
      (i) =>
        anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("tier"), config.toBuffer(), Buffer.from([i])],
          program.programId,
        )[0],
    );
    await sendWithRetry(
      provider,
      () =>
        program.methods
          .initializeAgreement(
            agreementId,
            ctx.supply,
            ctx.sharePrice,
            { open: {} },
            [
              {
                threshold: new anchor.BN(10_000_000_000),
                splits: [{ party: { holders: {} }, bps: 10_000 }],
              },
              {
                threshold: new anchor.BN("18446744073709551615"),
                splits: [{ party: { holders: {} }, bps: 10_000 }],
              },
            ],
            null,
            null,
            new anchor.BN(5_000_000_000),
            null,
            provider.wallet.publicKey,
            ctx.complianceAdmin,
            ctx.paymentDestination!,
          )
          .accountsPartial({
            creator,
            agreementConfig: config,
            shareMint: shareMint.publicKey,
            paymentMint: ctx.paymentMint!,
            paymentDestination: ctx.paymentDestination!,
            vault,
            treasury,
            extraMetas,
            tier0: tierPdas[0],
            tier1: tierPdas[1],
            tier2: tierPdas[2],
            tier3: tierPdas[3],
            tier4: tierPdas[4],
            token2022Program: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([shareMint])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "init-capped",
    );

    const payer = (provider.wallet as anchor.Wallet).payer;
    const depAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      ctx.paymentMint!,
      provider.wallet.publicKey,
    );
    await mintTo(
      provider.connection,
      payer,
      ctx.paymentMint!,
      depAta.address,
      provider.wallet.publicKey,
      20_000_000_000n,
    );

    // 8k > 5k cap: accepted in full, total overshoots the cap.
    const over = new anchor.BN(8_000_000_000);
    await sendWithRetry(
      provider,
      () =>
        program.methods
          .depositRevenue(over)
          .accountsPartial({
            depositor: provider.wallet.publicKey,
            agreementConfig: config,
            paymentMint: ctx.paymentMint!,
            depositorUsdcAccount: depAta.address,
            vault,
            tier0: tierPdas[0],
            tier1: tierPdas[1],
            tier2: tierPdas[2],
            tier3: tierPdas[3],
            tier4: tierPdas[4],
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "deposit-over-cap",
    );

    const cfg = await program.account.agreementConfig.fetch(config);
    expect(cfg.totalDeposited.toString()).to.equal(over.toString());
    expect(cfg.totalDeposited.toNumber()).to.be.greaterThan(5_000_000_000);
  });
}
