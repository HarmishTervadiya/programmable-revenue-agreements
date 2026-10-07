import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ProgrammableRevenueAgreement } from "../target/types/programmable_revenue_agreement";
import { SharedCtx } from "./helpers";
import { defineInitializeTests } from "./handlers/initialize-agreement";

describe("programmable-revenue-agreement", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .programmableRevenueAgreement as Program<ProgrammableRevenueAgreement>;

  // Fresh id every run: surfpool persists state across runs.
  const agreementId = new anchor.BN(Math.floor(Math.random() * 1_000_000_000));
  const shareMintKeypair = anchor.web3.Keypair.generate();

  const [config] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("agreement"),
      provider.wallet.publicKey.toBuffer(),
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
    [
      Buffer.from("extra-account-metas"),
      shareMintKeypair.publicKey.toBuffer(),
    ],
    program.programId,
  );
  const tierPdas = [0, 1, 2, 3, 4].map(
    (i) =>
      anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("tier"), config.toBuffer(), Buffer.from([i])],
        program.programId,
      )[0],
  );

  const ctx: SharedCtx = {
    provider,
    program,
    agreementId,
    supply: new anchor.BN(1_000_000_000),
    sharePrice: new anchor.BN(10_000_000),
    shareMintKeypair,
    depositor: anchor.web3.Keypair.generate().publicKey,
    complianceAdmin: anchor.web3.Keypair.generate().publicKey,
    config,
    vault,
    treasury,
    extraMetas,
    tierPdas,
  };

  defineInitializeTests(ctx);
});
