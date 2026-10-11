import * as anchor from "@coral-xyz/anchor";
import { SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createTransferCheckedInstruction,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { SharedCtx, sendWithRetry } from "../helpers";
import {
  buyerShareAta,
  claimPdaFor,
  newFundedBuyer,
  sendPurchaseWithTransfer,
} from "./purchase-share";

const PRECISION = 1_000_000_000_000n;

interface FreshAg {
  config: anchor.web3.PublicKey;
  shareMint: anchor.web3.Keypair;
  vault: anchor.web3.PublicKey;
  treasury: anchor.web3.PublicKey;
  extraMetas: anchor.web3.PublicKey;
  tierPdas: anchor.web3.PublicKey[];
}

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

// Standalone agreement with caller-chosen admin/depositor so claim tests
// don't depend on main-suite state.
async function initFreshAgreement(
  ctx: SharedCtx,
  opts: {
    admin: anchor.web3.PublicKey;
    depositor: anchor.web3.PublicKey;
    expTime?: anchor.BN | null;
    endCap?: anchor.BN | null;
  },
): Promise<FreshAg> {
  const { provider, program } = ctx;
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
          twoTiers(provider) as any,
          null,
          opts.expTime ?? null,
          opts.endCap ?? new anchor.BN(9_999_999_999),
          null,
          opts.depositor,
          opts.admin,
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
    "init-claim-fresh",
  );
  return { config, shareMint, vault, treasury, extraMetas, tierPdas };
}

function freshCtx(ctx: SharedCtx, ag: FreshAg): SharedCtx {
  return {
    ...ctx,
    config: ag.config,
    shareMintKeypair: ag.shareMint,
    treasury: ag.treasury,
    extraMetas: ag.extraMetas,
    tierPdas: ag.tierPdas,
  };
}

function claimAccountsFor(
  ctx: SharedCtx,
  ag: FreshAg,
  holder: anchor.web3.PublicKey,
  holderUsdc: anchor.web3.PublicKey,
) {
  return {
    holder,
    agreementConfig: ag.config,
    shareMint: ag.shareMint.publicKey,
    paymentMint: ctx.paymentMint!,
    holderShareAta: buyerShareAta(ag.shareMint.publicKey, holder),
    holderUsdcAta: holderUsdc,
    vault: ag.vault,
    claimRecord: claimPdaFor(ctx.program, ag.config, holder),
    tier0: ag.tierPdas[0],
    tier1: ag.tierPdas[1],
    tier2: ag.tierPdas[2],
    tier3: ag.tierPdas[3],
    tier4: ag.tierPdas[4],
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

// What the chain should pay: balance * (acc - last) / PRECISION + pending.
function expectedPayout(
  balance: bigint,
  lastAcc: anchor.BN[],
  pending: anchor.BN[],
  accs: anchor.BN[],
  count: number,
): bigint {
  let total = 0n;
  for (let i = 0; i < count; i++) {
    const delta = BigInt(accs[i].toString()) - BigInt(lastAcc[i].toString());
    total += (balance * delta) / PRECISION + BigInt(pending[i].toString());
  }
  return total;
}

async function tierAccs(ctx: SharedCtx, ag: FreshAg): Promise<anchor.BN[]> {
  const accs: anchor.BN[] = [];
  for (const pda of ag.tierPdas) {
    const t = await ctx.program.account.tierState.fetch(pda);
    accs.push((t as any).accPerToken);
  }
  return accs;
}

async function topUpProviderUsdc(ctx: SharedCtx, amount: bigint) {
  const payer = (ctx.provider.wallet as anchor.Wallet).payer;
  const ata = await getOrCreateAssociatedTokenAccount(
    ctx.provider.connection,
    payer,
    ctx.paymentMint!,
    ctx.provider.wallet.publicKey,
  );
  await mintTo(
    ctx.provider.connection,
    payer,
    ctx.paymentMint!,
    ata.address,
    ctx.provider.wallet.publicKey,
    amount,
  );
  return ata.address;
}

async function depositAs(
  ctx: SharedCtx,
  ag: FreshAg,
  depositor: anchor.web3.Keypair | null,
  depositorUsdc: anchor.web3.PublicKey,
  amount: anchor.BN,
  label: string,
) {
  const signer = depositor ?? (ctx.provider.wallet as anchor.Wallet).payer;
  const signerPubkey = depositor
    ? depositor.publicKey
    : ctx.provider.wallet.publicKey;
  await sendWithRetry(
    ctx.provider,
    () =>
      ctx.program.methods
        .depositRevenue(amount)
        .accountsPartial({
          depositor: signerPubkey,
          agreementConfig: ag.config,
          paymentMint: ctx.paymentMint!,
          depositorUsdcAccount: depositorUsdc,
          vault: ag.vault,
          tier0: ag.tierPdas[0],
          tier1: ag.tierPdas[1],
          tier2: ag.tierPdas[2],
          tier3: ag.tierPdas[3],
          tier4: ag.tierPdas[4],
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers(depositor ? [depositor] : [])
        .rpc({ commitment: "confirmed", skipPreflight: false }),
    label,
  );
}

// Peer transfer with hook extras (owner moves own tokens, no approval).
function peerTransferIx(
  ctx: SharedCtx,
  ag: FreshAg,
  from: anchor.web3.PublicKey,
  to: anchor.web3.PublicKey,
  amount: anchor.BN,
) {
  const ix = createTransferCheckedInstruction(
    buyerShareAta(ag.shareMint.publicKey, from),
    ag.shareMint.publicKey,
    buyerShareAta(ag.shareMint.publicKey, to),
    from,
    BigInt(amount.toString()),
    6,
    [],
    TOKEN_2022_PROGRAM_ID,
  );
  ix.keys.push(
    { pubkey: ag.extraMetas, isSigner: false, isWritable: false },
    { pubkey: ag.config, isSigner: false, isWritable: false },
    {
      pubkey: claimPdaFor(ctx.program, ag.config, from),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: claimPdaFor(ctx.program, ag.config, to),
      isSigner: false,
      isWritable: true,
    },
    ...ag.tierPdas.map((pda) => ({
      pubkey: pda,
      isSigner: false,
      isWritable: false,
    })),
    { pubkey: ctx.program.programId, isSigner: false, isWritable: false },
  );
  return ix;
}

export function defineClaimTests(ctx: SharedCtx) {
  const { provider, program } = ctx;
  const costOf = (amount: anchor.BN) =>
    BigInt(amount.toString()) * BigInt(ctx.sharePrice.toString());

  it("Holder claims accrued revenue, record syncs", async () => {
    const me = provider.wallet.publicKey;
    const ag = await initFreshAgreement(ctx, {
      admin: anchor.web3.Keypair.generate().publicKey,
      depositor: me,
    });
    const fctx = freshCtx(ctx, ag);
    const amount = new anchor.BN(5_000_000);
    const funded = await newFundedBuyer(ctx, costOf(amount) * 2n);
    await sendPurchaseWithTransfer(fctx, funded.buyer, funded.buyerUsdc, amount, "claim-buy");
    const depUsdc = await topUpProviderUsdc(ctx, 20_000_000_000n);
    await depositAs(ctx, ag, null, depUsdc, new anchor.BN(4_000_000_000), "claim-dep1");
    await depositAs(ctx, ag, null, depUsdc, new anchor.BN(8_000_000_000), "claim-dep2");

    const balBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(funded.buyerUsdc)).value.amount,
    );
    const vaultBefore = BigInt(
      (await provider.connection.getTokenAccountBalance(ag.vault)).value.amount,
    );
    const record = await program.account.claimRecord.fetch(
      claimPdaFor(program, ag.config, funded.buyer.publicKey),
    );
    const accs = await tierAccs(ctx, ag);
    const cfg = await program.account.agreementConfig.fetch(ag.config);
    const shareBal = BigInt(
      (
        await provider.connection.getTokenAccountBalance(
          buyerShareAta(ag.shareMint.publicKey, funded.buyer.publicKey),
        )
      ).value.amount,
    );
    const expected = expectedPayout(
      shareBal,
      (record as any).lastAcc,
      (record as any).pending,
      accs,
      (cfg as any).tierCount,
    );
    expect(expected > 0n).to.equal(true);

    const tx = await sendWithRetry(
      provider,
      () =>
        program.methods
          .claimTierShare()
          .accountsPartial(claimAccountsFor(ctx, ag, funded.buyer.publicKey, funded.buyerUsdc))
          .signers([funded.buyer])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "claim",
    );
    console.log("\nClaim tx", tx);

    const balAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(funded.buyerUsdc)).value.amount,
    );
    const vaultAfter = BigInt(
      (await provider.connection.getTokenAccountBalance(ag.vault)).value.amount,
    );
    expect(balAfter - balBefore).to.equal(expected);
    expect(vaultBefore - vaultAfter).to.equal(expected);

    const synced = await program.account.claimRecord.fetch(
      claimPdaFor(program, ag.config, funded.buyer.publicKey),
    );
    const syncedAccs = ((synced as any).lastAcc as anchor.BN[]).map((b) => b.toString());
    expect(syncedAccs.slice(0, (cfg as any).tierCount)).to.deep.equal(
      accs.slice(0, (cfg as any).tierCount).map((b) => b.toString()),
    );
    expect(
      ((synced as any).pending as anchor.BN[]).map((b) => b.toString()),
    ).to.deep.equal(["0", "0", "0", "0", "0"]);
  });

  it("Second claim with nothing accrued rejects", async () => {
    const me = provider.wallet.publicKey;
    const ag = await initFreshAgreement(ctx, {
      admin: anchor.web3.Keypair.generate().publicKey,
      depositor: me,
    });
    const fctx = freshCtx(ctx, ag);
    const amount = new anchor.BN(1_000_000);
    const funded = await newFundedBuyer(ctx, costOf(amount) * 2n);
    await sendPurchaseWithTransfer(fctx, funded.buyer, funded.buyerUsdc, amount, "claim-buy2");
    const depUsdc = await topUpProviderUsdc(ctx, 10_000_000_000n);
    await depositAs(ctx, ag, null, depUsdc, new anchor.BN(2_000_000_000), "claim-dep3");
    await sendWithRetry(
      provider,
      () =>
        program.methods
          .claimTierShare()
          .accountsPartial(claimAccountsFor(ctx, ag, funded.buyer.publicKey, funded.buyerUsdc))
          .signers([funded.buyer])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "claim-first",
    );
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .claimTierShare()
            .accountsPartial(claimAccountsFor(ctx, ag, funded.buyer.publicKey, funded.buyerUsdc))
            .signers([funded.buyer])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "claim-empty",
      );
      throw new Error("Empty claim should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "NothingToClaim"
      ) {
        console.log("\nEmpty claim failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }
  });

  it("Frozen holder cannot claim, can after unfreeze", async () => {
    const me = provider.wallet.publicKey;
    const admin = anchor.web3.Keypair.generate();
    const ag = await initFreshAgreement(ctx, {
      admin: admin.publicKey,
      depositor: me,
    });
    const fctx = freshCtx(ctx, ag);
    const amount = new anchor.BN(2_000_000);
    const funded = await newFundedBuyer(ctx, costOf(amount) * 2n);
    await sendPurchaseWithTransfer(fctx, funded.buyer, funded.buyerUsdc, amount, "claim-buy3");
    const depUsdc = await topUpProviderUsdc(ctx, 10_000_000_000n);
    await depositAs(ctx, ag, null, depUsdc, new anchor.BN(3_000_000_000), "claim-dep4");

    const holderAta = buyerShareAta(ag.shareMint.publicKey, funded.buyer.publicKey);
    const recordPda = claimPdaFor(program, ag.config, funded.buyer.publicKey);
    await sendWithRetry(
      provider,
      () =>
        program.methods
          .freezePosition()
          .accountsPartial({
            complianceAdmin: admin.publicKey,
            agreementConfig: ag.config,
            shareMint: ag.shareMint.publicKey,
            holderShareAta: holderAta,
            claimRecord: recordPda,
            token2022Program: TOKEN_2022_PROGRAM_ID,
          })
          .signers([admin])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "freeze",
    );

    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .claimTierShare()
            .accountsPartial(claimAccountsFor(ctx, ag, funded.buyer.publicKey, funded.buyerUsdc))
            .signers([funded.buyer])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "claim-frozen",
      );
      throw new Error("Frozen claim should have failed but succeeded");
    } catch (err) {
      if (
        err instanceof anchor.AnchorError &&
        err.error.errorCode.code === "FrozenPosition"
      ) {
        console.log("\nFrozen claim failed as expected:", err.error.errorMessage);
      } else {
        throw err;
      }
    }

    await sendWithRetry(
      provider,
      () =>
        program.methods
          .unfreezePosition()
          .accountsPartial({
            complianceAdmin: admin.publicKey,
            agreementConfig: ag.config,
            shareMint: ag.shareMint.publicKey,
            holderShareAta: holderAta,
            claimRecord: recordPda,
            token2022Program: TOKEN_2022_PROGRAM_ID,
          })
          .signers([admin])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "unfreeze",
    );
    const tx = await sendWithRetry(
      provider,
      () =>
        program.methods
          .claimTierShare()
          .accountsPartial(claimAccountsFor(ctx, ag, funded.buyer.publicKey, funded.buyerUsdc))
          .signers([funded.buyer])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "claim-after-unfreeze",
    );
    console.log("\nPost-unfreeze claim tx", tx);
  });

  it("Reject claim without a ClaimRecord", async () => {
    const me = provider.wallet.publicKey;
    const ag = await initFreshAgreement(ctx, {
      admin: anchor.web3.Keypair.generate().publicKey,
      depositor: me,
    });
    const stranger = anchor.web3.Keypair.generate();
    const fundIx = SystemProgram.transfer({
      fromPubkey: me,
      toPubkey: stranger.publicKey,
      lamports: 10_000_000,
    });
    await sendWithRetry(
      provider,
      () => provider.sendAndConfirm(new anchor.web3.Transaction().add(fundIx)),
      "fund-stranger",
    );
    const payer = (provider.wallet as anchor.Wallet).payer;
    const usdcAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      ctx.paymentMint!,
      stranger.publicKey,
    );
    try {
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .claimTierShare()
            .accountsPartial(
              claimAccountsFor(ctx, ag, stranger.publicKey, usdcAta.address),
            )
            .signers([stranger])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "claim-stranger",
      );
      throw new Error("Stranger claim should have failed but succeeded");
    } catch (err) {
      const msg = String((err as any)?.message ?? err);
      if (msg.includes("AccountNotInitialized")) {
        console.log("\nStranger claim failed as expected: AccountNotInitialized");
      } else {
        throw err;
      }
    }
  });

  it("Transfer settles pending, both sides claim correctly", async () => {
    const me = provider.wallet.publicKey;
    const ag = await initFreshAgreement(ctx, {
      admin: anchor.web3.Keypair.generate().publicKey,
      depositor: me,
    });
    const fctx = freshCtx(ctx, ag);
    const buyA = new anchor.BN(5_000_000);
    const buyB = new anchor.BN(1_000_000);
    const fundedA = await newFundedBuyer(ctx, costOf(buyA) * 2n);
    const fundedB = await newFundedBuyer(ctx, costOf(buyB) * 2n);
    await sendPurchaseWithTransfer(fctx, fundedA.buyer, fundedA.buyerUsdc, buyA, "xfer-buyA");
    await sendPurchaseWithTransfer(fctx, fundedB.buyer, fundedB.buyerUsdc, buyB, "xfer-buyB");
    const depUsdc = await topUpProviderUsdc(ctx, 30_000_000_000n);
    await depositAs(ctx, ag, null, depUsdc, new anchor.BN(4_000_000_000), "xfer-dep1");

    // A sends 2M shares to B. Hook banks A's earnings into pending.
    const move = new anchor.BN(2_000_000);
    const payer = (provider.wallet as anchor.Wallet).payer;
    await sendWithRetry(
      provider,
      async () => {
        const { blockhash, lastValidBlockHeight } =
          await provider.connection.getLatestBlockhash("confirmed");
        const tx = new anchor.web3.Transaction({
          feePayer: me,
          blockhash,
          lastValidBlockHeight,
        });
        tx.add(peerTransferIx(fctx, ag, fundedA.buyer.publicKey, fundedB.buyer.publicKey, move));
        return anchor.web3.sendAndConfirmTransaction(
          provider.connection,
          tx,
          [payer, fundedA.buyer],
          { commitment: "confirmed", skipPreflight: false },
        );
      },
      "xfer-move",
    );

    const recordA = await program.account.claimRecord.fetch(
      claimPdaFor(program, ag.config, fundedA.buyer.publicKey),
    );
    const pending0 = BigInt(
      ((recordA as any).pending as anchor.BN[]).map((b) => b.toString())[0],
    );
    expect(pending0 > 0n).to.equal(true);

    await depositAs(ctx, ag, null, depUsdc, new anchor.BN(8_000_000_000), "xfer-dep2");

    for (const funded of [fundedA, fundedB]) {
      const rec = await program.account.claimRecord.fetch(
        claimPdaFor(program, ag.config, funded.buyer.publicKey),
      );
      const accs = await tierAccs(ctx, ag);
      const cfg = await program.account.agreementConfig.fetch(ag.config);
      const bal = BigInt(
        (
          await provider.connection.getTokenAccountBalance(
            buyerShareAta(ag.shareMint.publicKey, funded.buyer.publicKey),
          )
        ).value.amount,
      );
      const expected = expectedPayout(
        bal,
        (rec as any).lastAcc,
        (rec as any).pending,
        accs,
        (cfg as any).tierCount,
      );
      expect(expected > 0n).to.equal(true);
      const before = BigInt(
        (await provider.connection.getTokenAccountBalance(funded.buyerUsdc)).value.amount,
      );
      await sendWithRetry(
        provider,
        () =>
          program.methods
            .claimTierShare()
            .accountsPartial(claimAccountsFor(ctx, ag, funded.buyer.publicKey, funded.buyerUsdc))
            .signers([funded.buyer])
            .rpc({ commitment: "confirmed", skipPreflight: false }),
        "xfer-claim",
      );
      const after = BigInt(
        (await provider.connection.getTokenAccountBalance(funded.buyerUsdc)).value.amount,
      );
      expect(after - before).to.equal(expected);
    }
  });

  it("Claim still works after expiry", async () => {
    const me = provider.wallet.publicKey;
    const ag = await initFreshAgreement(ctx, {
      admin: anchor.web3.Keypair.generate().publicKey,
      depositor: me,
      expTime: new anchor.BN(1),
    });
    const fctx = freshCtx(ctx, ag);
    const amount = new anchor.BN(2_000_000);
    const funded = await newFundedBuyer(ctx, costOf(amount) * 2n);
    await sendPurchaseWithTransfer(fctx, funded.buyer, funded.buyerUsdc, amount, "exp-buy");
    const depUsdc = await topUpProviderUsdc(ctx, 10_000_000_000n);
    await depositAs(ctx, ag, null, depUsdc, new anchor.BN(2_000_000_000), "exp-dep");

    await sendWithRetry(
      provider,
      () =>
        program.methods
          .expireAgreement()
          .accountsPartial({
            agreementConfig: ag.config,
            shareMint: ag.shareMint.publicKey,
            treasury: ag.treasury,
            token2022Program: TOKEN_2022_PROGRAM_ID,
          })
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "exp-expire",
    );
    const cfg = await program.account.agreementConfig.fetch(ag.config);
    expect((cfg as any).status).to.have.property("expired");

    const before = BigInt(
      (await provider.connection.getTokenAccountBalance(funded.buyerUsdc)).value.amount,
    );
    const tx = await sendWithRetry(
      provider,
      () =>
        program.methods
          .claimTierShare()
          .accountsPartial(claimAccountsFor(ctx, ag, funded.buyer.publicKey, funded.buyerUsdc))
          .signers([funded.buyer])
          .rpc({ commitment: "confirmed", skipPreflight: false }),
      "exp-claim",
    );
    console.log("\nPost-expiry claim tx", tx);
    const after = BigInt(
      (await provider.connection.getTokenAccountBalance(funded.buyerUsdc)).value.amount,
    );
    expect(after - before > 0n).to.equal(true);
  });
}
