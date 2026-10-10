import { createRequire } from "node:module";
import {
  assertLocalGenesis,
  deterministicSeed,
  formatUnits,
  requireDemo,
  toBaseUnits,
} from "./model.mts";

/** Use the repository's Anchor/web3.js/SPL Token dependencies only on execution. */
export async function connect(options: any, idl: any, needsProgram: boolean) {
  const require = createRequire(import.meta.url);
  let anchor: any, token: any;
  try {
    anchor = require("@coral-xyz/anchor");
    token = require("@solana/spl-token");
  } catch {
    throw new Error(
      "JavaScript dependencies unavailable. Install the repository's locked dependencies (yarn install --frozen-lockfile) before --execute; --plan needs only Node 24 and the IDL.",
    );
  }
  const {
    Keypair,
    PublicKey,
    Connection,
    Transaction,
    SystemProgram,
    sendAndConfirmTransaction,
  } = anchor.web3;
  const key = (label: string) =>
    Keypair.fromSeed(deterministicSeed(label, options.offset));
  const payer = key("creator-payer"),
    depositor = key("depositor"),
    admin = key("compliance-admin"),
    mint = key("mock-payment-mint");
  const connection = new Connection(options.rpc, "confirmed");
  let genesis: string;
  try {
    genesis = await connection.getGenesisHash();
  } catch {
    throw new Error(
      `Local validator unavailable at ${options.rpc}; start a local validator before --execute`,
    );
  }
  assertLocalGenesis(genesis);
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    { commitment: "confirmed", preflightCommitment: "confirmed" },
  );
  const program = new anchor.Program(idl, provider);
  if (needsProgram) {
    const info = await connection.getAccountInfo(program.programId);
    requireDemo(
      info?.executable,
      `Program ${program.programId} is not deployed/executable on this local validator`,
    );
  }
  console.log(
    `LOCAL DEMO ONLY rpc=${options.rpc} genesis=${genesis} namespace=${options.offset}`,
  );
  console.log(
    `payer/Creator=${payer.publicKey} depositor=${depositor.publicKey} complianceAdmin=${admin.publicKey} paymentMint=${mint.publicKey}`,
  );
  const send = async (
    label: string,
    instructions: any[],
    signers: any[] = [],
  ) => {
    const signature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(...instructions),
      [payer, ...signers],
      { commitment: "confirmed", preflightCommitment: "confirmed" },
    );
    console.log(`${label} signature=${signature}`);
    return signature;
  };
  const creatorAta = token.getAssociatedTokenAddressSync(
    mint.publicKey,
    payer.publicKey,
  );
  const depositorAta = token.getAssociatedTokenAddressSync(
    mint.publicKey,
    depositor.publicKey,
  );
  return {
    anchor,
    token,
    Keypair,
    PublicKey,
    Transaction,
    SystemProgram,
    connection,
    program,
    payer,
    depositor,
    admin,
    mint,
    key,
    send,
    creatorAta,
    depositorAta,
  };
}

export async function setup(
  context: any,
  targetAmount: string,
  fundDepositor: boolean,
) {
  const {
    token,
    connection,
    payer,
    mint,
    creatorAta,
    depositorAta,
    send,
    SystemProgram,
  } = context;
  // Check deterministic addresses before transactions; never adopt an external payment asset.
  const existing = await connection.getAccountInfo(mint.publicKey);
  if (existing) {
    requireDemo(
      existing.owner.equals(token.TOKEN_PROGRAM_ID),
      "Existing demo mint is not owned by classic SPL Token",
    );
    const decoded = await token.getMint(connection, mint.publicKey);
    requireDemo(
      decoded.decimals === 6 &&
        decoded.mintAuthority?.equals(payer.publicKey) &&
        decoded.freezeAuthority === null,
      "Existing demo mint configuration mismatch; choose a fresh DEMO_ID_OFFSET",
    );
  }
  for (const [address, owner] of [
    [creatorAta, payer.publicKey],
    [depositorAta, context.depositor.publicKey],
  ]) {
    if (await connection.getAccountInfo(address)) {
      const ata = await token.getAccount(connection, address);
      requireDemo(
        ata.mint.equals(mint.publicKey) &&
          ata.owner.equals(owner) &&
          !ata.isFrozen,
        "Existing mock token account configuration mismatch",
      );
    }
  }
  const lamports = await connection.getBalance(payer.publicKey);
  if (lamports < 2_000_000_000) {
    const signature = await connection.requestAirdrop(
      payer.publicKey,
      2_000_000_000 - lamports,
    );
    console.log(`local faucet signature=${signature}`);
    // Confirm the actual faucet signature rather than pairing it with a later blockhash.
    const result = await connection.confirmTransaction(signature, "confirmed");
    requireDemo(
      !result.value.err,
      `Local faucet transaction failed: ${JSON.stringify(result.value.err)}`,
    );
  }
  if (!existing) {
    const rent = await connection.getMinimumBalanceForRentExemption(
      token.MINT_SIZE,
    );
    await send(
      "create mock six-decimal payment mint",
      [
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: rent,
          space: token.MINT_SIZE,
          programId: token.TOKEN_PROGRAM_ID,
        }),
        token.createInitializeMint2Instruction(
          mint.publicKey,
          6,
          payer.publicKey,
          null,
        ),
      ],
      [mint],
    );
  }
  await send("ensure Creator/depositor mock payment ATAs", [
    token.createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      creatorAta,
      payer.publicKey,
      mint.publicKey,
    ),
    token.createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      depositorAta,
      context.depositor.publicKey,
      mint.publicKey,
    ),
  ]);
  if (fundDepositor) {
    const target = toBaseUnits(targetAmount);
    const balance = (await token.getAccount(connection, depositorAta)).amount;
    if (balance < target)
      await send(
        "mint mock payment tokens to depositor (NOT revenue deposit)",
        [
          token.createMintToCheckedInstruction(
            mint.publicKey,
            depositorAta,
            payer.publicKey,
            target - balance,
            6,
          ),
        ],
      );
    else
      console.log(
        "Depositor mock balance already meets target; no additional mock tokens minted.",
      );
  }
  console.log(
    `paymentDestination/CreatorATA=${creatorAta} depositorSourceATA=${depositorAta}`,
  );
  for (const [label, address] of [
    ["Creator destination", creatorAta],
    ["Depositor source", depositorAta],
  ]) {
    const amount = (await token.getAccount(connection, address)).amount;
    console.log(
      `${label} balance=${amount} base units (${formatUnits(
        amount,
      )} MOCK payment units)`,
    );
  }
}

export function addresses(context: any, seed: any) {
  const { PublicKey, payer, program, anchor } = context;
  const mint = context.key(`share-mint:${seed.name}:${seed.agreementId}`);
  const pda = (seeds: Uint8Array[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const config = pda([
    Buffer.from("agreement"),
    payer.publicKey.toBuffer(),
    new anchor.BN(seed.agreementId).toArrayLike(Buffer, "le", 8),
  ]);
  const vault = pda([Buffer.from("vault"), config.toBuffer()]);
  const treasury = pda([Buffer.from("treasury"), config.toBuffer()]);
  const extraMetas = pda([
    Buffer.from("extra-account-metas"),
    mint.publicKey.toBuffer(),
  ]);
  const tiers = [0, 1, 2, 3, 4].map((i) =>
    pda([Buffer.from("tier"), config.toBuffer(), Buffer.from([i])]),
  );
  return { mint, config, vault, treasury, extraMetas, tiers };
}

export async function inspectAgreement(context: any, seed: any, p: any) {
  const { program, token, connection, payer, depositor, admin } = context;
  const cfg = await program.account.agreementConfig.fetch(p.config);
  requireDemo(
    cfg.creator.equals(payer.publicKey) &&
      cfg.depositor.equals(depositor.publicKey) &&
      cfg.complianceAdmin.equals(admin.publicKey) &&
      cfg.shareMint.equals(p.mint.publicKey) &&
      cfg.paymentMint.equals(context.mint.publicKey) &&
      cfg.paymentDestination.equals(context.creatorAta) &&
      cfg.vault.equals(p.vault) &&
      cfg.treasury.equals(p.treasury),
    "Existing agreement account bindings differ from seed; no overwrite attempted",
  );
  for (const [field, expected] of [
    ["agreementId", seed.agreementId],
    ["supply", seed.supply],
    ["sharePrice", seed.sharePrice],
    ["startTime", seed.startTime],
    ["expTime", seed.expTime],
    ["endCap", seed.endCap],
    ["claimWindow", seed.claimWindow],
  ]) {
    requireDemo(
      (cfg[field] === null ? null : cfg[field].toString()) === expected,
      `Agreement ${field} differs from seed; choose a fresh DEMO_ID_OFFSET`,
    );
  }
  requireDemo(
    cfg.tierCount === seed.tiers.length &&
      cfg.accessMode.open !== undefined &&
      cfg.status.active !== undefined,
    "Seed agreement has different mode/tier count or is no longer Active; no overwrite attempted",
  );
  for (let i = 0; i < 5; i++) {
    const tier = await program.account.tierState.fetch(p.tiers[i]);
    const expected = seed.tiers[i];
    requireDemo(
      tier.agreement.equals(p.config) &&
        tier.tierIndex === i &&
        tier.threshold.toString() === (expected?.threshold ?? "0") &&
        tier.splitCount === (expected?.splits.length ?? 0),
      `Tier ${i} differs from seed`,
    );
    if (expected)
      for (let j = 0; j < expected.splits.length; j++) {
        const split = expected.splits[j],
          actual = tier.splits[j];
        requireDemo(
          actual.bps === split.bps &&
            (split.party === "holders"
              ? actual.party.holders !== undefined
              : actual.party.wallet?.[0]?.equals(payer.publicKey)),
          `Tier ${i} split ${j} differs from seed`,
        );
      }
  }
  const mint = await token.getMint(
    connection,
    p.mint.publicKey,
    "confirmed",
    token.TOKEN_2022_PROGRAM_ID,
  );
  requireDemo(
    mint.decimals === 6 &&
      mint.mintAuthority === null &&
      mint.freezeAuthority?.equals(p.config),
    "Entitlement mint authority/decimals differ from initialization design",
  );
  const treasury = await token.getAccount(
    connection,
    p.treasury,
    "confirmed",
    token.TOKEN_2022_PROGRAM_ID,
  );
  const vault = await token.getAccount(connection, p.vault);
  requireDemo(
    treasury.owner.equals(p.config) &&
      treasury.mint.equals(p.mint.publicKey) &&
      vault.owner.equals(p.config) &&
      vault.mint.equals(context.mint.publicKey),
    "Treasury/vault bindings differ from agreement",
  );
  requireDemo(
    (await connection.getAccountInfo(p.extraMetas))?.owner.equals(
      program.programId,
    ),
    "Required ExtraAccountMetaList is absent or has wrong owner",
  );
  console.log(
    `${seed.name} agreement=${p.config} shareMint=${p.mint.publicKey} vault=${p.vault} treasury=${p.treasury} extraMetas=${p.extraMetas}`,
  );
  console.log(
    `status=Active totalDeposited=${cfg.totalDeposited} sharesSold=${
      cfg.sharesSold
    } claimDeadline=${cfg.claimDeadline ?? "None"} treasuryBalance=${
      treasury.amount
    } actualMintSupply=${mint.supply} vaultBalance=${vault.amount}`,
  );
  return cfg;
}
