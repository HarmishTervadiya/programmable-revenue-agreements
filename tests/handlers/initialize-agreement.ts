import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { SharedCtx, sendWithRetry } from "../helpers";

function twoTiers(provider: anchor.AnchorProvider) {
  return [
    {
      threshold: new anchor.BN(10_000_000_000),
      splits: [{ party: { holders: {} }, bps: 10_000 }],
    },
    {
      threshold: new anchor.BN("18446744073709551615"),
      splits: [
        { party: { holders: {} }, bps: 5_000 },
        { party: { wallet: provider.wallet.publicKey }, bps: 5_000 },
      ],
    },
  ];
}

function pdasFor(
  program: SharedCtx["program"],
  creator: anchor.web3.PublicKey,
  agreementId: anchor.BN,
  shareMint: anchor.web3.PublicKey,
) {
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
    [Buffer.from("extra-account-metas"), shareMint.toBuffer()],
    program.programId,
  );
  const tierPdas = [0, 1, 2, 3, 4].map(
    (i) =>
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("tier"), config.toBuffer(), Buffer.from([i])],
        program.programId,
      )[0],
  );
  return { config, vault, treasury, extraMetas, tierPdas };
}

function initAccountsFor(
  ctx: SharedCtx,
  agreementId: anchor.BN,
  shareMint: anchor.web3.PublicKey,
) {
  const p = pdasFor(
    ctx.program,
    ctx.provider.wallet.publicKey,
    agreementId,
    shareMint,
  );
  return {
    creator: ctx.provider.wallet.publicKey,
    agreementConfig: p.config,
    shareMint,
    paymentMint: ctx.paymentMint!,
    paymentDestination: ctx.paymentDestination!,
    vault: p.vault,
    treasury: p.treasury,
    extraMetas: p.extraMetas,
    tier0: p.tierPdas[0],
    tier1: p.tierPdas[1],
    tier2: p.tierPdas[2],
    tier3: p.tierPdas[3],
    tier4: p.tierPdas[4],
    token2022Program: TOKEN_2022_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

export function defineInitializeTests(ctx: SharedCtx) {
  const { provider, program } = ctx;

  it("Create mock USDC mint + creator ATA", async () => {
    ctx.paymentMint = await createMint(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      provider.wallet.publicKey,
      provider.wallet.publicKey,
      6,
    );
    const ata = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      ctx.paymentMint,
      provider.wallet.publicKey,
    );
    ctx.paymentDestination = ata.address;
    console.log("\nUSDC mint", ctx.paymentMint.toBase58());
    console.log("Creator ATA", ctx.paymentDestination.toBase58());
  });

  it("Initialize agreement happy path", async () => {
    const tx = await sendWithRetry(
      provider,
      () =>
        program.methods
          .initializeAgreement( 
            ctx.agreementId,
            ctx.supply, 
            ctx.sharePrice,
            { open: {} }, 
            twoTiers(provider),
            null,
            new anchor.BN(9_999_999_999),
            null,
            ctx.depositor,
            ctx.complianceAdmin,
            ctx.paymentDestination!,
          )
          .accountsPartial(
            initAccountsFor(
              ctx,
              ctx.agreementId,
              ctx.shareMintKeypair.publicKey,
            ),
          )
          .signers([ctx.shareMintKeypair])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "initialize",
    );
    console.log("\nYour transaction signature", tx);
    console.log("Config", ctx.config.toBase58());

    const cfg = await program.account.agreementConfig.fetch(ctx.config);
    expect(cfg.supply.toNumber()).to.equal(ctx.supply.toNumber());
    expect(cfg.tierCount).to.equal(2);
    expect(cfg.totalDeposited.toNumber()).to.equal(0);
    expect(cfg.sharesSold.toNumber()).to.equal(0);

    const t0 = await program.account.tierState.fetch(ctx.tierPdas[0]);
    expect(t0.threshold.toNumber()).to.equal(10_000_000_000);
    expect(t0.splitCount).to.equal(1);
    expect(t0.filled.toNumber()).to.equal(0);

    const t1 = await program.account.tierState.fetch(ctx.tierPdas[1]);
    expect(t1.splitCount).to.equal(2);

    const tBal = await provider.connection.getTokenAccountBalance(ctx.treasury);
    expect(tBal.value.amount).to.equal(ctx.supply.toString());

    const mintInfo = await provider.connection.getAccountInfo(
      ctx.shareMintKeypair.publicKey,
      "confirmed",
    );
    expect(mintInfo?.owner.toBase58()).to.equal(
      TOKEN_2022_PROGRAM_ID.toBase58(),
    );
    expect(
      await provider.connection.getAccountInfo(ctx.extraMetas, "confirmed"),
    ).to.not.be.null;
  });

  it("Reject empty tiers", async () => {
    const badId = ctx.agreementId.addn(1);
    const badMint = anchor.web3.Keypair.generate();
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .initializeAgreement(
              badId,
              ctx.supply,
              ctx.sharePrice,
              { open: {} },
              [],
              null,
              new anchor.BN(9_999_999_999),
              null,
              ctx.depositor,
              ctx.complianceAdmin,
              ctx.paymentDestination!,
            )
            .accountsPartial(
              initAccountsFor(ctx, badId, badMint.publicKey),
            )
            .signers([badMint])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "init-empty-tiers",
      );
      throw new Error("Empty tiers should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "InvalidTierCount"
      ) {
        console.log("\nEmpty tiers failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }
  });

  it("Reject bounded last tier", async () => {
    const badId = ctx.agreementId.addn(2);
    const badMint = anchor.web3.Keypair.generate();
    const bad = [
      {
        threshold: new anchor.BN(10_000),
        splits: [{ party: { holders: {} }, bps: 10_000 }],
      },
    ];
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .initializeAgreement(
              badId,
              ctx.supply,
              ctx.sharePrice,
              { open: {} },
              bad,
              null,
              new anchor.BN(9_999_999_999),
              null,
              ctx.depositor,
              ctx.complianceAdmin,
              ctx.paymentDestination!,
            )
            .accountsPartial(
              initAccountsFor(ctx, badId, badMint.publicKey),
            )
            .signers([badMint])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "init-bounded-tier",
      );
      throw new Error("Bounded last tier should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "LastTierMustBeUncapped"
      ) {
        console.log(
          "\nBounded last tier failed as expected:",
          err.error.errorMessage,
        );
      } else {
        throw err;
      }
    }
  });
}
