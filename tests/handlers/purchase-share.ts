import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { SharedCtx, sendWithRetry } from "../helpers";

export function buyerShareAta(
  shareMint: anchor.web3.PublicKey,
  buyer: anchor.web3.PublicKey,
) {
  return getAssociatedTokenAddressSync(
    shareMint,
    buyer,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
}

export function claimPdaFor(
  program: SharedCtx["program"],
  config: anchor.web3.PublicKey,
  holder: anchor.web3.PublicKey,
) {
  return anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), config.toBuffer(), holder.toBuffer()],
    program.programId,
  )[0];
}

export function purchaseAccountsFor(
  ctx: SharedCtx,
  buyer: anchor.web3.PublicKey,
  buyerUsdc: anchor.web3.PublicKey,
) {
  return {
    buyer,
    agreementConfig: ctx.config,
    shareMint: ctx.shareMintKeypair.publicKey,
    paymentMint: ctx.paymentMint!,
    buyerShareAccount: buyerShareAta(
      ctx.shareMintKeypair.publicKey,
      buyer,
    ),
    buyerUsdcAccount: buyerUsdc,
    paymentDestination: ctx.paymentDestination!,
    treasury: ctx.treasury,
    claimRecord: claimPdaFor(ctx.program, ctx.config, buyer),
    tier0: ctx.tierPdas[0],
    tier1: ctx.tierPdas[1],
    tier2: ctx.tierPdas[2],
    tier3: ctx.tierPdas[3],
    tier4: ctx.tierPdas[4],
    tokenProgram: TOKEN_PROGRAM_ID,
    token2022Program: TOKEN_2022_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };
}

/// Fresh buyer: SOL for rent (ClaimRecord + ATA creation) + funded USDC ATA.
export async function newFundedBuyer(
  ctx: SharedCtx,
  usdcAmount: bigint,
): Promise<{
  buyer: anchor.web3.Keypair;
  buyerUsdc: anchor.web3.PublicKey;
}> {
  const { provider } = ctx;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const buyer = anchor.web3.Keypair.generate();
  const fundIx = SystemProgram.transfer({
    fromPubkey: provider.wallet.publicKey,
    toPubkey: buyer.publicKey,
    lamports: 100_000_000,
  });
  const fundTx = new anchor.web3.Transaction().add(fundIx);
  await sendWithRetry(provider, () => provider.sendAndConfirm(fundTx), "fund-buyer");

  const ata = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    ctx.paymentMint!,
    buyer.publicKey,
  );
  await mintTo(
    provider.connection,
    payer,
    ctx.paymentMint!,
    ata.address,
    provider.wallet.publicKey,
    usdcAmount,
  );
  return { buyer, buyerUsdc: ata.address };
}

function freshPdas(
  ctx: SharedCtx,
  agreementId: anchor.BN,
  shareMint: anchor.web3.PublicKey,
) {
  const creator = ctx.provider.wallet.publicKey;
  const [config] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("agreement"),
      creator.toBuffer(),
      agreementId.toArrayLike(Buffer, "le", 8),
    ],
    ctx.program.programId,
  );
  const [treasury] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), config.toBuffer()],
    ctx.program.programId,
  );
  const [extraMetas] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("extra-account-metas"), shareMint.toBuffer()],
    ctx.program.programId,
  );
  const tierPdas = [0, 1, 2, 3, 4].map(
    (i) =>
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("tier"), config.toBuffer(), Buffer.from([i])],
        ctx.program.programId,
      )[0],
  );
  return { config, treasury, extraMetas, tierPdas };
}

async function initFreshAgreement(
  ctx: SharedCtx,
  opts: {
    accessMode: { open: {} } | { allowlist: {} };
    startTime?: anchor.BN | null;
  },
): Promise<{ config: anchor.web3.PublicKey; shareMint: anchor.web3.Keypair }> {
  const { provider, program } = ctx;
  const agreementId = new anchor.BN(Math.floor(Math.random() * 1_000_000_000));
  const shareMint = anchor.web3.Keypair.generate();
  const p = freshPdas(ctx, agreementId, shareMint.publicKey);
  const tiers = [
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
  await sendWithRetry(
    provider,
    () =>
      program.methods
        .initializeAgreement(
          agreementId,
          ctx.supply,
          ctx.sharePrice,
          opts.accessMode as any,
          tiers,
          opts.startTime ?? null,
          new anchor.BN(9_999_999_999),
          null,
          null,
          ctx.depositor,
          ctx.complianceAdmin,
          ctx.paymentDestination!,
        )
        .accountsPartial({
          creator: provider.wallet.publicKey,
          agreementConfig: p.config,
          shareMint: shareMint.publicKey,
          paymentMint: ctx.paymentMint!,
          paymentDestination: ctx.paymentDestination!,
          vault: anchor.web3.PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), p.config.toBuffer()],
            program.programId,
          )[0],
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
        })
        .signers([shareMint])
        .rpc({ commitment: "confirmed", skipPreflight: false }),
    "init-fresh",
  );
  return { config: p.config, shareMint };
}

export function definePurchaseTests(ctx: SharedCtx) {
  const { provider, program } = ctx;
  // 5 whole tokens (6dp) — keeps mock-USDC funding modest.
  const firstBuy = new anchor.BN(5_000_000);
  const secondBuy = new anchor.BN(2_000_000);
  let buyerA: anchor.web3.Keypair;
  let buyerAUsdc: anchor.web3.PublicKey;

  const costOf = (amount: anchor.BN) =>
    BigInt(amount.toString()) * BigInt(ctx.sharePrice.toString());

  it("Purchase happy path: USDC -> creator, shares -> buyer", async () => {
    const funded = await newFundedBuyer(ctx, costOf(firstBuy) * 2n);
    buyerA = funded.buyer;
    buyerAUsdc = funded.buyerUsdc;

    const destBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(ctx.paymentDestination!))
        .value.amount,
    );
    const cfgBefore = await program.account.agreementConfig.fetch(ctx.config);

    const tx = await sendWithRetry(
      provider,
      () =>
        program.methods
          .purchaseShare(firstBuy)
          .accountsPartial(purchaseAccountsFor(ctx, buyerA.publicKey, buyerAUsdc))
          .signers([buyerA])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "purchase",
    );
    console.log("\nPurchase tx", tx);

    const shareBal = await provider.connection.getTokenAccountBalance(
      buyerShareAta(ctx.shareMintKeypair.publicKey, buyerA.publicKey),
    );
    expect(shareBal.value.amount).to.equal(firstBuy.toString());

    const treasuryBal = await provider.connection.getTokenAccountBalance(
      ctx.treasury,
    );
    expect(BigInt(treasuryBal.value.amount)).to.equal(
      BigInt(ctx.supply.toString()) - BigInt(firstBuy.toString()),
    );

    const cfg = await program.account.agreementConfig.fetch(ctx.config);
    expect(cfg.sharesSold.toString()).to.equal(
      cfgBefore.sharesSold.add(firstBuy).toString(),
    );

    // First buyer snapshots zero accumulators (no deposits yet at this point
    // in the suite — purchase tests run before deposit tests).
    const claim = await program.account.claimRecord.fetch(
      claimPdaFor(ctx.program, ctx.config, buyerA.publicKey),
    );
    expect((claim as any).holder.toBase58()).to.equal(buyerA.publicKey.toBase58());
    expect((claim as any).frozen).to.equal(false);

    const destAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(ctx.paymentDestination!))
        .value.amount,
    );
    expect(destAfter - destBefore).to.equal(costOf(firstBuy));
  });

  it("Repeat buyer keeps ClaimRecord and buys more (thaw-skip path)", async () => {
    const claimBefore = await program.account.claimRecord.fetch(
      claimPdaFor(ctx.program, ctx.config, buyerA.publicKey),
    );
    const cfgBefore = await program.account.agreementConfig.fetch(ctx.config);

    // Top up USDC for the second buy.
    await mintTo(
      provider.connection,
      (provider.wallet as anchor.Wallet).payer,
      ctx.paymentMint!,
      buyerAUsdc,
      provider.wallet.publicKey,
      costOf(secondBuy),
    );

    await sendWithRetry(
      provider,
      () =>
        program.methods
          .purchaseShare(secondBuy)
          .accountsPartial(purchaseAccountsFor(ctx, buyerA.publicKey, buyerAUsdc))
          .signers([buyerA])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "purchase-again",
    );

    const shareBal = await provider.connection.getTokenAccountBalance(
      buyerShareAta(ctx.shareMintKeypair.publicKey, buyerA.publicKey),
    );
    expect(shareBal.value.amount).to.equal(
      firstBuy.add(secondBuy).toString(),
    );

    const claimAfter = await program.account.claimRecord.fetch(
      claimPdaFor(ctx.program, ctx.config, buyerA.publicKey),
    );
    // Existing holder: last_acc untouched by the purchase itself.
    expect(
      ((claimAfter as any).lastAcc as anchor.BN[]).map((b) => b.toString()),
    ).to.deep.equal(
      ((claimBefore as any).lastAcc as anchor.BN[]).map((b) => b.toString()),
    );

    const cfg = await program.account.agreementConfig.fetch(ctx.config);
    expect(cfg.sharesSold.toString()).to.equal(
      cfgBefore.sharesSold.add(secondBuy).toString(),
    );
  });

  it("Reject zero-amount purchase", async () => {
    const funded = await newFundedBuyer(ctx, 1_000_000n);
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .purchaseShare(new anchor.BN(0))
            .accountsPartial(
              purchaseAccountsFor(ctx, funded.buyer.publicKey, funded.buyerUsdc),
            )
            .signers([funded.buyer])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "purchase-zero",
      );
      throw new Error("Zero purchase should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "InvalidAmount"
      ) {
        console.log("\nZero purchase failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }
  });

  it("Reject purchase beyond treasury balance", async () => {
    const funded = await newFundedBuyer(ctx, costOf(ctx.supply) * 2n);
    const tooMuch = ctx.supply.addn(1);
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .purchaseShare(tooMuch)
            .accountsPartial(
              purchaseAccountsFor(ctx, funded.buyer.publicKey, funded.buyerUsdc),
            )
            .signers([funded.buyer])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "purchase-oversell",
      );
      throw new Error("Oversell should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "InsufficientTreasuryShares"
      ) {
        console.log("\nOversell failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }
  });

  it("Reject purchase on allowlist-gated agreement (MVP: Open only)", async () => {
    const fresh = await initFreshAgreement(ctx, {
      accessMode: { allowlist: {} },
    });
    // Re-derive treasury for the fresh config directly.
    const [treasury] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), fresh.config.toBuffer()],
      program.programId,
    );
    const tierPdas = [0, 1, 2, 3, 4].map(
      (i) =>
        anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("tier"), fresh.config.toBuffer(), Buffer.from([i])],
          program.programId,
        )[0],
    );
    const freshCtx: SharedCtx = {
      ...ctx,
      config: fresh.config,
      shareMintKeypair: fresh.shareMint,
      treasury,
      tierPdas,
    };

    const funded = await newFundedBuyer(ctx, costOf(firstBuy) * 2n);
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .purchaseShare(firstBuy)
            .accountsPartial(purchaseAccountsFor(freshCtx, funded.buyer.publicKey, funded.buyerUsdc))
            .signers([funded.buyer])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "purchase-allowlist",
      );
      throw new Error("Allowlist purchase should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "AccessDenied"
      ) {
        console.log("\nAllowlist purchase failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }
  });

  it("Reject purchase before start_time", async () => {
    const clock = await provider.connection.getBlockTime(
      await provider.connection.getSlot(),
    );
    const startTime = new anchor.BN((clock ?? Math.floor(Date.now() / 1000)) + 10_000);
    const fresh = await initFreshAgreement(ctx, {
      accessMode: { open: {} },
      startTime,
    });
    const [treasury] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), fresh.config.toBuffer()],
      program.programId,
    );
    const tierPdas = [0, 1, 2, 3, 4].map(
      (i) =>
        anchor.web3.PublicKey.findProgramAddressSync(
          [Buffer.from("tier"), fresh.config.toBuffer(), Buffer.from([i])],
          program.programId,
        )[0],
    );
    const freshCtx: SharedCtx = {
      ...ctx,
      config: fresh.config,
      shareMintKeypair: fresh.shareMint,
      treasury,
      tierPdas,
    };
    const funded = await newFundedBuyer(ctx, costOf(firstBuy) * 2n);
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .purchaseShare(firstBuy)
            .accountsPartial(purchaseAccountsFor(freshCtx, funded.buyer.publicKey, funded.buyerUsdc))
            .signers([funded.buyer])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "purchase-early",
      );
      throw new Error("Early purchase should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "SaleNotStarted"
      ) {
        console.log("\nEarly purchase failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }
  });
}
