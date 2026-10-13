import { AnchorProvider, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, type Keypair, type Transaction } from "@solana/web3.js";
import idlJson from "@/lib/program/idl.json";
import { PROGRAM_ID, RPC_ENDPOINT } from "@/lib/config";

export type PRA = Program<Idl>;

export function getConnection(): Connection {
  return new Connection(RPC_ENDPOINT, "confirmed");
}

export function getProvider(
  connection: Connection,
  wallet: Wallet,
): AnchorProvider {
  return new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

/** Program bound to an Anchor provider (live mode). */
export function getProgram(provider: AnchorProvider): PRA {
  return new Program(idlJson as Idl, provider);
}

/** Read-only program (fetching accounts without a wallet). */
export function getReadProgram(connection: Connection): PRA {
  const noopWallet = {
    publicKey: PublicKey.default,
    signTransaction: async (tx: never) => tx,
    signAllTransactions: async (txs: never) => txs,
  } as unknown as Wallet;
  return new Program(idlJson as Idl, getProvider(connection, noopWallet));
}

/** Keypair-as-wallet for Demo Mode live signing (presenter's local key). */
export function keypairWallet(kp: Keypair): Wallet {
  return {
    publicKey: kp.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(kp);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) =>
      txs.map((t) => {
        t.partialSign(kp);
        return t;
      }),
  } as unknown as Wallet;
}

export { PROGRAM_ID };
