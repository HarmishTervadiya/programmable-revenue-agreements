# Local demo kit

This kit prepares a **local-only mock depositor** and initializes four example
agreements through the current `initialize_agreement` interface. It does not deposit
revenue: `deposit_revenue` is absent from this checkout. Mock token minting into the
depositor's associated token account (ATA) is setup, not vault funding or accrual.

## Files and prerequisites

- [agreements.json](../scripts/demo/agreements.json): reusable decimal-string seed data.
- [seed-agreements.mts](../scripts/demo/seed-agreements.mts): preview/initialize seeds.
- [mock-depositor.mts](../scripts/demo/mock-depositor.mts): preview/prepare mock funds.
- [model.mts](../scripts/demo/model.mts): exact base-unit conversion, seed validation,
  local-RPC guard, IDL compatibility checks and actual initialization argument order.
- [runtime.mts](../scripts/demo/runtime.mts): existing Anchor/web3.js/SPL Token APIs,
  deterministic demo identities, PDA derivation, setup and account inspection.
- [demo.test.mts](../scripts/demo/demo.test.mts): offline validation tests.

Use Node 24 (tested with 24.10.0). Execution needs the dependencies already declared
in `package.json`, particularly `@coral-xyz/anchor` and `@solana/spl-token`:

```sh
cd /tmp/pra-lifecycle-integration
yarn install --frozen-lockfile
```

No dependency or package-file changes are included in this deliverable. Offline
preview/testing needs no installed npm packages, but does require the current IDL at
`target/idl/programmable_revenue_agreement.json`. Execution also needs a compatible
program deployed on a local validator. IDL preflight checks program ID, exact
initialization argument order (including `claim_window` after `end_cap`), and account
names. It cannot prove that a deployed binary matches the IDL: load the current build.
Build only if the artifact is missing/stale:

```sh
anchor build --ignore-keys
```

For an isolated local validator, in a separate terminal from this repository:

```sh
solana-test-validator \
  --ledger /tmp/pra-demo-ledger \
  --rpc-port 8899 \
  --bpf-program 2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop \
  target/deploy/programmable_revenue_agreement.so
```

Use an unused ledger directory/port. The validator must provide the local SOL faucet,
classic SPL Token, Token-2022 and Associated Token Account programs. A validator
without the necessary programs/accounts fails during setup or initialization; the
scripts never inject synthetic protocol account state. Existing `Anchor.toml` skips
validator startup, so `anchor test` is not a substitute for explicitly starting one.
Do not pass `--reset` or reuse someone else's ledger. Surfpool can also be used if its
local RPC has the current deployed program, compatible token programs and faucet;
it was not exercised for this deliverable.

## Configuration and units

| Variable         | Default                 | Meaning                                                                       |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------- |
| `DEMO_RPC_URL`   | `http://127.0.0.1:8899` | Only plain HTTP loopback URLs accepted.                                       |
| `DEMO_ID_OFFSET` | `0`                     | Unsigned `u64` offset for agreement IDs and deterministic identity namespace. |
| `DEMO_MOCK_USDC` | `1000.000000`           | Target depositor mock payment balance, with at most six decimal places.       |

`ANCHOR_PROVIDER_URL`, `ANCHOR_WALLET` and your normal Solana wallet configuration
are not used. The scripts use deterministic, publicly reproducible **demo-only**
keypairs for Creator/payer, depositor, Compliance Admin, payment mint and entitlement
mints. Never fund these identities on a public cluster. They are generated in memory
from SHA-256 namespace labels; no private wallet files are read or written.

Creator is the transaction payer and mock payment mint authority. Depositor and
Compliance Admin are separate identities, satisfying the initializer's distinct-admin
rule. The payment mint is a new deterministic **classic SPL mock mint with six
decimals**, not actual USDC. Creator's payment destination and depositor's source
are their respective ATAs for that mint. No externally supplied mint is adopted.
Existing deterministic addresses are checked against their expected configuration.
Loopback enforcement and rejection of known mainnet/devnet/testnet genesis hashes
prevent accidental use of normal public endpoints, including a proxy to those clusters.

`1.000001` mock payment units is exactly `1,000,001` base units. Values are converted
using BigInt, never floating-point multiplication. Inputs with more than six decimal
places, negatives, exponent notation and `u64` overflow are rejected. The default
funding target is `1,000,000,000` base units. Mock setup mints only the shortfall into
the depositor ATA; rerunning does not repeatedly mint the full amount.

Seed supply is `1,000,000,000` entitlement base units (1,000 displayed units at six
decimals). `sharePrice=1,000,000` is the raw initialization parameter in payment base
units; this kit makes no claim about missing purchase-handler pricing semantics.
Tiers/caps are payment base units. Claim windows are seconds and timestamps are
Unix seconds. The far-future time `4102444800` is 2100-01-01 UTC and avoids accidental
expiry during a present-day setup demonstration. It is not derived from wall-clock time.

## Preview and execute

Default mode is offline preview; it makes no RPC requests or transactions:

```sh
node scripts/demo/seed-agreements.mts --plan
node scripts/demo/mock-depositor.mts --plan
```

These commands print JSON marked `OFFLINE PLAN ONLY` or `OFFLINE SETUP PLAN ONLY`.
They validate the dataset and current IDL. The mock preview explicitly reports the
missing revenue-deposit instruction. A preview does not initialize an agreement.

Once dependencies and the local validator are ready:

```sh
node scripts/demo/mock-depositor.mts --execute
node scripts/demo/seed-agreements.mts --execute
```

Mock setup requests a local faucet top-up to two SOL for the demo payer if needed,
creates/verifies the mock payment mint, ensures Creator/depositor ATAs, and mints the
requested mock balance to the depositor ATA. It can run before program deployment.
Seed execution requires the deployed program before setup sends any transaction,
then creates/verifies payment setup and calls `initializeAgreement` for each seed.
It supplies all five tier PDAs, the new entitlement mint signer, vault and treasury
PDAs, mint-derived ExtraAccountMetaList, correct token programs and the stored Creator
destination. Initialization arguments use the existing Anchor BN/enum conventions.

| Seed           | ID at offset 0 | Configuration                                                                                  |
| -------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `single-tier`  | 1001           | One uncapped tier, 100% holders, time expiry.                                                  |
| `waterfall`    | 1002           | Thresholds 100 / 500 / uncapped mock payment units; holder/Creator splits 100/0, 70/30, 30/70. |
| `claim-window` | 1003           | Uncapped holder tier, time or 1,000-unit cap expiry, 3,600-second claim window.                |
| `cap-expiry`   | 1004           | Uncapped holder tier, 250-unit cap only, no claim window.                                      |

Execution prints actual payer/Creator, depositor, admin, payment mint and ATA addresses;
setup signatures; successful initialization signatures; config, entitlement mint,
vault, treasury and meta-list addresses; and resulting token/config balances.
After fresh initialization the expected state is Active, `totalDeposited=0`,
`sharesSold=0`, `claimDeadline=None`, full contractual treasury supply and vault zero.
These are expected outputs, **not claims that execution already occurred**.

A blocked deposit request is explicitly rejected before importing RPC dependencies
or sending any setup transaction:

```sh
node scripts/demo/mock-depositor.mts --execute --deposit
```

Expected exit status is 1 with `BLOCKED: deposit_revenue is absent`. No direct
payment transfer to the vault is substituted. Even if a future IDL adds that handler,
this setup-only kit refuses deposits until reviewed against its actual interface.

## Safe reruns and failures

A seed rerun checks existing account bindings, terms, active state, all five tiers,
expected splits, token-account ownership, mint authority and metadata ownership.
Matching existing seeds are reported as verified/skipped, not initialized again.
Different/expired terms or orphaned addresses cause failure without overwriting them.
All existing seeds are inspected before the seed script's first setup transaction.
Setup itself verifies reused payment accounts before funding and reuses its ATAs.

Transactions across multiple seeds are not atomic: if a later seed fails, earlier
successful seeds remain. Preserve the printed signatures, diagnose the failure and
rerun; matching seeds are skipped. RPC errors are surfaced rather than blindly
resubmitting initialization transactions. A confirmed transaction followed by a failed
inspection is reported as failure; do not assume complete success from the signature alone.

To use fresh identities and IDs without deleting or closing any existing work:

```sh
DEMO_ID_OFFSET=10000 node scripts/demo/mock-depositor.mts --execute
DEMO_ID_OFFSET=10000 node scripts/demo/seed-agreements.mts --execute
```

Use the same offset for both scripts. Alternatively stop your own local validator
and start it with a new unused ledger directory; do not reset an existing ledger.
There is no cleanup/reset/close operation in these scripts. Closed seeds cannot be
silently recreated at the same addresses because the retained mint is detected.

## Implemented versus blocked

Implemented: offline previews; exact units and dataset validation; local safety
checks; deterministic identities/PDAs; mock payment setup; real initialization calls;
matching-account reruns and result inspection. Runtime calls require validation on a
suitable local validator before treating this as a successful on-chain demo.

Blocked: revenue deposits, waterfall updates, cap-triggering deposits, purchase and
transfer-hook settlement, named-wallet payout demonstration and holder ClaimRecord
creation/cleanup. A configured cap-based seed cannot reach its cap via this kit while
`deposit_revenue` is missing. No holder claims are fabricated. The known claim
narrowing/rounding discrepancies and post-closure limitations are unchanged; see
[requirement traceability](requirement-traceability.md).

## Validation for this deliverable

```sh
node --test --test-isolation=none scripts/demo/demo.test.mts
npm exec --offline --cache /tmp/pra-lifecycle-integration/target/prettier-cache --yes --package prettier@2.8.8 -- prettier --trailing-comma all --check 'scripts/demo/*' docs/demo-kit.md
git diff --check
```

The demo suite now contains 16 offline tests, including a regression for Anchor's
Wallet tuple encoding. Supported setup was executed successfully on 2026-10-09.

### Executed local verification

Locked dependencies were installed with `yarn install --frozen-lockfile --non-interactive`
(Yarn 1.22.22). Lockfiles were preserved. Installation reported existing peer-dependency
warnings for web3.js/codec dependencies and a Node `url.parse` deprecation warning.
Sandbox registry access and local socket/RPC access required approved escalation.
Anchor CLI 1.1.2 and Solana validator 3.1.10 were available. No wallet credentials were
read. The existing SBF artifact was loaded at the declared program ID; no fresh
Anchor build or CLI deployment transaction was needed.

The successful disposable validator command was:

```sh
solana-test-validator --ledger /tmp/pra-demo-validation-20261009-c \
  --rpc-port 18899 --faucet-port 18999 --dynamic-port-range 19000-19030 \
  --bind-address 127.0.0.1 \
  --bpf-program 2iEFwZ8qPjvEfSAtHqE7G7apQo9tVKFsiLrdAFC5sXop \
  target/deploy/programmable_revenue_agreement.so
```

RPC was `http://127.0.0.1:18899`, WebSocket port 18900, genesis
`HxprsijJ74maFNxbLrdVKWvouubecUPAp7Yi8ak5gHCb`. An earlier faucet/WebSocket
port collision was corrected by using distinct ports and a fresh disposable ledger.

The first namespace-0 run initialized two accounts but exposed a demo enum bug:
Rust `Wallet(Pubkey)` must be encoded as `{ wallet: [creator] }` and decoded from
field `0`. The prior encoding stored the default public key, so rerun validation
correctly refused that mismatching agreement. Only demo encoding/inspection and a
regression test were fixed. Those initial accounts were not reset or overwritten;
the successful run used the fresh namespace 10000.

```sh
DEMO_RPC_URL=http://127.0.0.1:18899 DEMO_ID_OFFSET=10000 node scripts/demo/seed-agreements.mts --execute
DEMO_RPC_URL=http://127.0.0.1:18899 DEMO_ID_OFFSET=10000 node scripts/demo/mock-depositor.mts --execute
```

Both commands were also rerun successfully. All four existing seeds were verified
and skipped; the mock balance remained unchanged with no further token minting.
Idempotent ATA transactions and local SOL faucet top-ups can still occur on reruns.

| Seed         | Verified config address                        | Successful initialization signature                                                        |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| single-tier  | `FP8V49EEEjN6VvBtDEKK392eEsVy5WUkVSJumMCn8L7k` | `3pdjtedW5zCUi8ztDD7ArVo99ynb4cb2B92arx5z5TzYkMCGmVH7DqwvYtbHZUrcxF8w5F9z7LzXzJDkDsRQ5n1f` |
| waterfall    | `GjXFgCZmYPrKJuxkWoTp7nqF6Na1E7iSR4YfJb7D3JQY` | `5YqtYisuk5NFFv3XWNtgQoiNjopuRvc237ewz2pLnukhzMAa4GkwzCYcBkNi83Wq4Q6z7j685CYZdjCJcZ2p8vVH` |
| claim-window | `ABNLGeUMmZLphLa6XurJbwvT295buM7zmpe5Ls4QUV4e` | `3MoJNzCxAsBS9hoULmX47KxB8jeYc9vmAe1zBHFqEQdkYuobZC3C8yL16KFBoXSsZGGPeFAEH1RNxZPDeaYoGbTA` |
| cap-expiry   | `61E8VtH1u55nnpi2DGPvEo4i95yjGZCDkFmVbsoHKiQX` | `4XDaJoLuM62AKEu74ondDF7G91xDGWZGHZnXacJy5UKTtfrNJEmW6eRCoTobPPjf2vGsxD8veRfsEGkm4Y1u1B5y` |

Reads confirmed each config Active, `totalDeposited=0`, `sharesSold=0`, deadline None,
actual mint supply and treasury balance `1000000000`, vault balance zero, stored
terms and all five tier slots including named-wallet splits. The claim-window seed
stored 3600 seconds, and the cap-only seed stored cap 250000000 with no expiry time.
Mint authority was None and freeze authority was the config PDA.

Mock payment mint: `2VmfXkw1W2QmK1UmQND95fouCrPke7e8ddg7yNUkmjM2`.
Depositor ATA: `3DX5DfXYs5C8vzvqxVrRzouCdskLdzf35UGYPMT8KPfi`, verified balance
`1000000000` base units (1000.000000 mock units). Creator destination
`Gkw4YKQFwnjLQF1U37AUUwCqNrKSQB3htHECTiNuxNYD` remained zero.
Mock mint-to transaction:
`Rjy8uguEaG2D58Zche9MHg5r1DMuYQy225jyLY5VUQmDcPhXSpQQ4BB3CzT91n3msyKf1f2yfLd12Y3PcC9c2QT`.
No protocol vault received mock funds.

Regression commands executed:

```sh
node --test --test-isolation=none scripts/demo/demo.test.mts tests/reference/calculator.test.mts
NO_DNA=1 cargo test --locked -p programmable-revenue-agreement --test expire_agreement --test close_agreement --test freeze_unfreeze --test reference_claim_vectors
```

Final results: 16 demo + 79 reference Node tests; 15 expiry + 10 closure + 8
freeze/unfreeze + 3 runtime-reference Rust tests. All passed. Prettier and whitespace
checks passed. These are targeted suites, not the full Anchor TypeScript suite.
`--execute --deposit` was also checked: it rejected the missing handler before any
transaction. Full revenue-flow demonstration remains blocked by deposit accounting,
purchase/transfer settlement and holder record creation. The narrowing defect was subsequently corrected with checked conversion and an
SBF rollback regression. Fractional-residue and post-closure issues remain unresolved.

The disposable validator was stopped after verification. Its ledger and transaction
history were retained at `/tmp/pra-demo-validation-20261009-c`; no ledger reset or
account cleanup was performed.

## Final handoff revalidation

A fresh SBF program compilation and the five configured Anchor initialization tests
passed against a new disposable ledger at
`target/handoff-validator`, RPC `http://127.0.0.1:23899`, with a disposable test wallet.
The program was loaded with `solana-test-validator --bpf-program`; no normal wallet
or remote cluster was used. Both commands below executed successfully twice:

```sh
DEMO_RPC_URL=http://127.0.0.1:23899 DEMO_ID_OFFSET=10000 node scripts/demo/seed-agreements.mts --execute
DEMO_RPC_URL=http://127.0.0.1:23899 DEMO_ID_OFFSET=10000 node scripts/demo/mock-depositor.mts --execute
```

All four namespace-10000 configs matched the addresses above. Reads confirmed
Active status, zero deposit/sales counters, zero vault balances, and entitlement
mint/treasury amounts of 1000000000 each. Reruns skipped every initialization and
left the depositor at 1000000000 mock base units without further token minting.
Idempotent ATA transactions and local faucet top-ups still occurred as documented.
An explicit `--execute --deposit` request exited 1 with the missing-handler error
before RPC/setup transactions. This was a successful setup demonstration, not a
revenue-processing demonstration. The validator was stopped without resetting its
ledger. See [requirement-traceability.md](requirement-traceability.md) for fresh
regression counts and remaining protocol gaps.
