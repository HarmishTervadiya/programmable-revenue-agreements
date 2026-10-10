# TypeScript validation

Run from `/tmp/pra-lifecycle-integration` after installing the existing locked
JavaScript dependencies. Anchor tests also need the generated
`target/types/programmable_revenue_agreement.ts` from the current program build.
No dependency or lockfile changes are required.

```sh
node_modules/.bin/tsc --noEmit -p tsconfig.json
node_modules/.bin/tsc -p tsconfig.tooling.json
node --test --test-isolation=none tests/reference/calculator.test.mts scripts/demo/demo.test.mts
```

`tsconfig.json` retains the existing Anchor tests' ES6/CommonJS options and now
explicitly includes the `.ts` tests and generated Anchor types. Native `.mts` tooling
is checked separately by `tsconfig.tooling.json`: ES2022, NodeNext module resolution,
Node types, strict checking, explicit TypeScript-extension imports, and `noEmit`.
Library checking is not disabled. Use Node 24 for native TypeScript runtime tests.
Calling `tsc` directly avoids Yarn's argument-forwarding ambiguity; neither command
above emits JavaScript alongside source files.

The reference dispatcher uses runtime shape assertions to narrow calculator result
unions before checking conservation. Invalid-operation names are validated before
dispatch. Sequence outcomes use a payout-or-error union. Existing exact-result,
conservation, rounding, failure and input-immutability assertions remain intact.
Demo preview tests require a returned plan before checking its fields. No demo
on-chain behavior or calculator arithmetic was changed.

Initialization fixtures derive `TierInput` from the generated program types. Rust
`Party::Wallet(Pubkey)` is a tuple variant: encode `{ wallet: [recipient] }` and read
stored recipient at `party.wallet[0]`. Tests verify each intended recipient together
with its bps and initial owed amount; holder variants are checked too. This avoids
accepting initialization success while silently storing a default recipient.

To run the configured initialization suite, use a disposable local validator loaded
with `target/deploy/programmable_revenue_agreement.so` and a funded disposable wallet:

```sh
ANCHOR_PROVIDER_URL=http://127.0.0.1:21899 \
ANCHOR_WALLET=/tmp/pra-lifecycle-integration/target/ts-tooling-wallet.json \
anchor test --skip-build --skip-deploy --skip-local-validator \
  --provider.cluster http://127.0.0.1:21899 \
  --provider.wallet /tmp/pra-lifecycle-integration/target/ts-tooling-wallet.json
```

The wallet path and port are examples from this verification, not a request to use
normal wallet credentials. See [demo-kit.md](demo-kit.md) for safe local-validator
setup. Separate faucet, RPC and WebSocket ports. A fresh ledger or fresh identities
avoid collisions without resetting existing work. These commands do not exercise
the missing revenue-deposit instruction or settle the remaining fractional-claim
accounting policy.
