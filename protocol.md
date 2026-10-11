# Protocol study guide: Programmable Revenue Agreements

Use this to answer "what, why, how, and what's under the hood." Section 4 has the mechanisms you should be able to draw and calculate. Section 5 is the instruction-by-instruction detail. Section 8 lists what is decided and what is deferred, so you never claim something we haven't settled.

---

## 1. The 30-second answers

**What did you build?** A Solana program where a creator defines a revenue-sharing agreement (supply, price, tiers, end condition). Investors buy Token-2022 "entitlement tokens". As revenue is deposited into a vault, the program computes each holder's share by rule, and holders withdraw it whenever they like.

**Why?** Revenue-sharing deals today (music advances, revenue-based financing, real-estate waterfalls) run on bespoke legal contracts and manual payouts. They are opaque, hard to audit, and can't be traded. Here the payout rules are code, the entitlement is a transferable token, and the money sits in a program-owned vault, so anyone can verify who is owed what.

**What does it do, in one breath?** Create an agreement, sell shares, accept revenue deposits, fill tiers in order, let holders claim, keep claims correct when tokens change hands, let an admin freeze a holder, end the agreement by time or cap, then close, which hands any unclaimed revenue back to the creator after a claim window.

**What it is not:** it doesn't verify that the revenue reported off-chain is real, it isn't a legally binding contract, and it isn't a trading venue.

---

## 2. Cast and money

| Role | Does |
|---|---|
| Creator | Defines the agreement, receives buyers' USDC, closes at the end and receives any unclaimed revenue |
| Buyer / Holder | Buys tokens, claims revenue, can transfer tokens |
| Depositor | The one designated wallet that deposits revenue |
| Compliance Admin | Freezes and unfreezes holders (cannot be the creator) |
| Anyone | Can trigger `expire_agreement` once an end condition is met |
| Config PDA | The program-controlled authority that owns the vault and treasury and signs freeze/thaw/transfers |

**Two tokens, two token programs.** The entitlement token is Token-2022 (needed for the hook and freeze). USDC is a normal SPL Token. Our code uses the token-interface types so both work.

**Three pools of value:**
1. Buyers' USDC goes straight to the creator's `payment_destination`. It never touches the vault.
2. Revenue USDC goes into the vault. This is the only money holders can claim from.
3. Unsold entitlement tokens sit in the treasury.

---

## 3. Accounts (seeds in brackets)

- **AgreementConfig** `["agreement", creator, agreement_id]`: the rulebook (creator, mint, vault, treasury, payment_destination, depositor, compliance_admin, supply, share_price, access_mode, tier_count, optional start_time / exp_time / end_cap / claim_window, claim_deadline (set at expiry), total_deposited, shares_sold, status, bump).
- **TierState** `["tier", config, tier_index]`: threshold, `filled`, `acc_per_token`, and up to 4 splits `{party: Holders | Wallet(pubkey), bps, owed}`.
- **ClaimRecord** `["claim", config, holder]`: per holder, with arrays indexed by tier: `last_acc[t]`, `pending[t]`, plus a `frozen` flag.
- **Vault** `["vault", config]`: USDC token account, authority = config PDA.
- **Treasury** `["treasury", config]`: entitlement token account, authority = config PDA.
- **Entitlement mint**: Token-2022, with Default Account State = Frozen and Transfer Hook = our program.
- **ExtraAccountMetaList** `["extra-account-metas", mint]`: tells Token-2022 which extra accounts to pass our hook.

---

## 4. The three mechanisms you must be able to derive

### 4.1 The tier waterfall
Tiers fill in order by **cumulative deposits**. Tier width = its threshold minus the previous threshold. A tier's splits sum to 10,000 bps. Each split is either `Holders` (shared across all tokens) or `Wallet(x)` (a fixed recipient such as the creator). **The last tier must have no limit** (threshold = `u64::MAX`, enforced as `LastTierMustBeUncapped`), so a deposit can never exceed the room available.

Example (whole USDC, supply 1,000 tokens): Tier 0 up to 10,000, split 100% holders. Tier 1 up to 50,000, split 50% holders / 50% creator.

### 4.2 The accumulator ("revenue earned per token")
We can't loop over holders on each deposit (compute and account limits, and it would cost more as holders grow). Instead each tier stores one number, `acc_per_token`, which only ever increases.

On deposit, for each tier it touches, with `take` the amount going into that tier:
`acc += take × holders_bps × PRECISION / (10,000 × supply)` (PRECISION = 1e12, so small deposits don't round to zero). Wallet parties get `owed += take × bps / 10,000`.

A holder's claim: `balance × (acc − last_acc) / PRECISION + pending`, then `last_acc = acc` and `pending = 0`.

**Worked example.** Alice holds 100 of 1,000 tokens, with `last_acc = (0, 0)`.
- Deposit 12,000. Tier 0 takes 10,000, so `acc0 = 10`. Tier 1 takes 2,000, holders get 1,000, so `acc1 = 1`, and the creator is owed 1,000.
- Alice's claimable: `100×10 + 100×1 = 1,100`. That is 10% of the 11,000 the holders earned. ✓
- **Timing doesn't matter.** She claims 1,100 now (`last_acc = (10, 1)`). A second deposit of 8,000 all lands in tier 1, since tier 0 is full: `acc1 = 5`, the creator is owed 4,000 more. Her second claim is `100×(5−1) = 400`. Total 1,500. Waiting and claiming once gives `100×10 + 100×5 = 1,500`. ✓
- **Vault check.** Deposits 20,000 = holders 15,000 + creator 5,000. ✓

Rounding always floors, so tiny dust stays in the vault. The vault can never owe more than it received.

### 4.3 Transfers and the hook
If Alice sells tokens, the new holder must not get her past earnings, and she must keep them. So on every transfer the hook settles both sides into `pending` and resets `last_acc` to the current value.

**Timing detail (important):** Token-2022 calls the hook after the transfer logic, so the token accounts the hook sees already show the *end* state. The hook therefore reconstructs balances before the transfer: sender before = current balance + amount, receiver before = current balance − amount.

Continue the example after deposit 1 (`acc = (10, 1)`): Alice sends 40 tokens to Bob without claiming.
- Alice: before = 60 + 40 = 100, so `pending += 100×10 + 100×1 = 1,100`, and `last_acc = (10, 1)`.
- Bob: before = 40 − 40 = 0, so `pending += 0`, and `last_acc = (10, 1)`.
- Deposit 2 (8,000) makes `acc1 = 5`. Alice claims `60×(5−1) + 1,100 = 1,340`. Bob claims `40×4 = 160`. Total 1,500, the same as before. ✓

**Why Token-2022?** It is the only way to run our code on every transfer at the protocol level (a plain SPL token can't), and it gives freeze authority and default-frozen accounts. **Honest tradeoff:** secondary trading only works on venues that support transfer-hook tokens.

### 4.4 Worked example: three deposits, then the edge cases
Setup (whole USDC, supply 1,000 tokens): Tier 0 up to 10,000, holders 100%. Tier 1 up to 30,000, holders 70% / creator 30%. Tier 2 unbounded, holders 40% / creator 60%. Holders: A 100, B 300, C 600 (all sold). `end_cap` = 60,000.

| Deposit | What fills | `acc` after (T0, T1, T2) | Creator owed |
|---|---|---|---|
| 4,000 | T0 +4,000 | 4, 0, 0 | 0 |
| 20,000 | T0 +6,000 (now full), T1 +14,000 (holders 9,800, creator 4,200) | 10, 9.8, 0 | 4,200 |
| 25,000 | T1 +6,000 (full; holders 4,200, creator 1,800), T2 +19,000 (holders 7,600, creator 11,400) | 10, 14, 7.6 | 17,400 |

Total deposited 49,000. Holders earn 31,600 (A 3,160, B 9,480, C 18,960) and the creator 17,400. Together that is exactly 49,000. Alice gets the same 3,160 whether she claims after each deposit (400 + 1,580 + 1,180) or once at the end.

**Edge cases and failures:**
- **Unsold tokens.** Suppose only A and B (400 tokens) are sold and 4,000 is deposited into tier 0. A and B can claim 1,600. The other 2,400 is the share of the 600 unsold tokens. Nobody can claim it, so it sits in the vault until the creator closes the agreement after the claim deadline.
- **Late buyer.** Someone who buys after a deposit starts with `last_acc` at the current value, so they earn nothing from earlier deposits.
- **Deposit crossing `end_cap`.** A fourth deposit of 15,000 takes the total to 64,000, over the 60,000 cap. It is accepted in full, because the cap never trims a deposit. It only makes `expire_agreement` callable.
- **A very large deposit.** It never fails for size. Whatever is left after the earlier tiers lands in the last tier, which has no limit.
- **Rejected calls.** Wrong depositor signer, zero amount, a deposit or purchase after expiry, a claim when nothing is owed, a claim by a frozen holder, and a claim after the agreement is closed.
- **Rounding.** 100 base units over 3 equal holders: the accumulator floors to 33,333,333, each holder claims 33, and 1 unit stays in the vault as dust.

---

## 5. Each instruction under the hood

### initialize_agreement (Creator)
**Inputs:** agreement_id, supply, share_price, access_mode, tier list (thresholds and splits), optional start/exp/cap, depositor, compliance_admin, payment_destination (a USDC token account), optional claim_window.

**Validations first:** 1 to 5 tiers with at most 4 splits each; thresholds strictly increasing and the last threshold equal to `u64::MAX`; each tier's splits sum to 10,000; at least one of exp_time / end_cap; supply and price above zero; compliance_admin is not the creator; if a claim window is given, it is above zero.

**Then, in one transaction:**
1. Create the AgreementConfig PDA and the TierState PDAs and store the terms.
2. Create the mint account with space for two extensions. **Extensions must be initialized before the mint itself:** Default Account State = Frozen, then Transfer Hook (program = ours, authority = none so it can never be repointed). Then initialize the mint (6 decimals, hardcoded in `init_share_mint` through `initialize_mint2`, matching USDC) with mint authority and freeze authority both = config PDA.
3. Create the treasury token account. It is **frozen on creation** (default state), so the config PDA signs a thaw before it can receive tokens.
4. Create the vault (USDC token account, authority = config PDA).
5. Create ExtraAccountMetaList with the accounts the hook needs.
6. Mint the entire supply to the treasury, then **set mint authority to none**. Supply is now fixed forever.
7. `status = Active`.

**Say:** "It creates the agreement's state and a fixed-supply Token-2022 mint whose accounts start frozen, whose only freeze authority is the program, and whose minting is permanently disabled. Everything happens in one transaction, so a failure leaves nothing half-built."

### purchase_share (Buyer)
**Checks:** status Active; start_time reached; the buyer's `ClaimRecord.frozen` is false; access is Open, or an allowlist entry exists; treasury holds at least `amount`.

**Does:**
1. Create the buyer's token account if needed (it starts frozen) and the ClaimRecord if new (`last_acc` = current accumulator).
2. Config PDA thaws the buyer's token account.
3. Transfer `amount × share_price` USDC buyer → `payment_destination`.
4. Config PDA signs a Token-2022 transfer treasury → buyer. This triggers the hook. **Gotcha:** the CPI must pass the hook's extra accounts too.
5. `shares_sold += amount`.

**Say:** "It swaps USDC for entitlement tokens atomically. The program thaws the buyer's account because the token starts frozen, which is how we control who can hold it."

### deposit_revenue (Depositor)
**Checks:** signer is the designated depositor; status Active; amount > 0.

**Does:** transfers USDC depositor → vault, then runs the waterfall: for each tier in order, `room = width − filled`, `take = min(remaining, room)`, `filled += take`, update `acc_per_token` and Wallet-party `owed` per section 4.2. Finally `total_deposited += amount`. The work is proportional to the number of tiers, not the number of holders.

A deposit never fails for being too large. Whatever is left after the earlier tiers lands in the last tier, which has no limit. `end_cap` never trims a deposit. It only makes `expire_agreement` callable once `total_deposited` reaches it, even if the last deposit overshoots.

**Say:** "It's pure arithmetic. The depositor doesn't choose who gets paid. The tiers decide."

### claim_tier_share (Holder)
**Checks:** the holder's ClaimRecord isn't frozen; the token account belongs to the signer. It works after expiry because it doesn't check status. The tier accounts are **read-only** here.

**Does:** for each tier, `earned = balance × (acc − last_acc) / PRECISION`, adds `pending`, sums the payout. Updates `last_acc` and zeroes `pending` **before** the transfer. Requires `0 < payout ≤ vault balance`, then the config PDA transfers USDC vault → holder.

**Say:** "It pays whatever the holder has earned since their last sync. Claiming often or rarely gives the same total."

### claim_party_share (a Wallet party, for example the creator)
**Status: decided, not yet written, and the name is tentative.** This is the separate path for fixed-wallet recipients.

**Does:** the signer must match a `Wallet` split. For each tier it adds up that party's `owed`, zeroes it, and the config PDA transfers the total from the vault. This is the only claim path that writes to the tiers. It is separate because it needs different accounts and different signer checks from a holder claim.

### transfer_hook_callback (called by Token-2022)
**First check:** the source account's "transferring" flag is set. This flag is only true during a real Token-2022 transfer, so nobody can call the hook directly to tamper with ClaimRecords.

**Does:** settles sender and receiver as in section 4.3. If the source is the treasury, the sender settlement is skipped (the treasury has no ClaimRecord). It fails if the receiver has no ClaimRecord or is frozen. The sender and receiver ClaimRecord addresses are derived from the owner field inside the token accounts, so Token-2022 can resolve them with no help from the caller. The hook cannot CPI back into Token-2022.

**Say:** "Every transfer pays nobody and costs nothing extra, but it keeps each person's accrued revenue correct by snapshotting them into `pending` at the moment of transfer."

### freeze_position / unfreeze_position (Compliance Admin)
**Checks:** signer is the compliance admin; the holder's ClaimRecord exists.

**Does:** the config PDA freezes (or thaws) the holder's token account, and sets `ClaimRecord.frozen` to match. **Why the extra flag:** a default-frozen account and an admin-frozen account look identical on-chain, so without our own flag a frozen holder could re-thaw themselves by buying more. A frozen holder can't transfer or claim, but nothing is seized, and their accrued revenue stays.

### expire_agreement (Anyone)
**Checks:** status Active, and `now ≥ exp_time` **or** `total_deposited ≥ end_cap`.

**Does:**
1. Sets `status = Expired`. If a claim window was set, sets `claim_deadline = now + claim_window`.
2. The config PDA burns the entire treasury balance (skipped if it is already zero). A burn is not a transfer, so the hook doesn't run and nobody can block expiry. Effective supply is now exactly `shares_sold`, and the treasury sits at zero so it can be closed later. We burn instead of sending the tokens to the creator because a transfer would let the creator claim holder revenue after expiry.

After expiry, deposits and purchases are rejected. Claims still work until the agreement is closed. Anyone can call it, so it doesn't rely on the creator or an oracle.

**Say:** "It ends the agreement, starts the claim clock, and burns the unsold tokens so the supply is fixed at what was actually sold."

### close_agreement (Creator)
**Checks:** signer is the creator; status Expired; and either the vault is at or below `DUST_ALLOWANCE` (1,000 base units, so everything was claimed) or `now ≥ claim_deadline`.

**Does:**
1. Sends the entire remaining vault balance to the creator's `payment_destination`. This is the unclaimed revenue: holders' unclaimed shares, other wallets' unclaimed `owed`, the share attributed to unsold tokens, and rounding dust.
2. Closes the vault and treasury (the token program requires a zero balance), then TierState, config and the metadata list, and returns the rent to the creator.
3. The entitlement mint stays on-chain.

**After close:** holders' tokens linger in their wallets and are worthless. The accounts the hook needs are gone, so transfers are expected to fail. Holders can still burn their own tokens (an optional self-burn can be added later). Claims are no longer possible, which is why the claim window is disclosed before anyone buys.

**Say:** "It ends the agreement. Once the claim window has passed, or everything has been claimed, the creator closes it, gets any leftover revenue, and recovers the rent."

---

## 6. Design decisions and why

| Decision | Alternative | Why we chose it |
|---|---|---|
| Accumulator ("per token") | Loop over holders on deposit | Constant work per deposit; looping hits compute and account limits |
| Token-2022 + transfer hook | Plain SPL token with staking | Settlement on every transfer, enforced by the token program, so holders stay freely transferable |
| Frozen-by-default, program thaws | Open accounts | Only the program decides who can hold; compliance without a custodian |
| Config PDA holds all authorities | Creator keys | No human can move the vault; mint authority is revoked and the hook can't be repointed |
| Fixed supply and price | Bonding curve | Simple, predictable raise; no price oracle |
| Tiers by cumulative deposits | Time-based tiers | Deterministic and oracle-free |
| Expiry by time or cap, callable by anyone | Price-based liquidation | Needs no oracle, and can't be blocked by one party |
| Buyer USDC to creator, not the vault | Everything into the vault | The vault holds revenue only, so claims can't be paid out of other buyers' principal |
| One ClaimRecord per holder | One per tier | Fewer accounts per transfer and claim |
| Pull-based claims | Push payouts | Constant deposit cost; holders pay their own claim fee |
| Buyer compliance on the web (terms acceptance), optional on-chain allowlist | Mandatory on-chain whitelist | If the program thaws anyone who pays, an on-chain gate adds little; real compliance belongs off-chain |
| Creator may hold a split in tiers | Holders-only tiers | Expresses recoupment, then profit split |
| Claim window; creator takes the remainder at close | Hold unclaimed money forever, or burn it | Unclaimed USDC has to end up with someone. The creator is the counterparty in the splits, and the window is disclosed before anyone buys |
| Burn unsold tokens at expiry | Transfer them to the creator | A transfer would fire the hook and let the creator claim holder revenue after expiry. A burn fixes supply at `shares_sold` |
| Last tier must be uncapped | Allow a bounded last tier | A deposit can never overflow, so there is no reject-or-credit branch to design or test |
| Holder claims and party claims are separate instructions | One instruction with two paths | Holder claims keep the tiers read-only. Only the party path writes `owed`, and the two need different accounts and signer checks |
| 6 decimals, at most 5 tiers and 4 splits, all fixed | Configurable sizes | 6 decimals matches USDC. Fixed sizes keep account sizes and the hook's account list fixed |
| Holder sell-back / burn out of scope | Buyback | Keeps the MVP focused |

---

## 7. Hard questions you may get

**What stops the depositor from lying or never depositing?** Nothing on-chain. Revenue verification is out of scope, so there is a trust assumption on the depositor (backed by the off-chain legal wrapper). What the protocol guarantees is that deposited money is divided exactly by the rules.

**Can the vault ever owe more than it holds?** No. Claims are computed only from deposits, and we floor on rounding.

**Can the admin steal funds?** No. Freeze only blocks movement and claims. The admin has no authority to move tokens or USDC. The risk is censorship (a freeze with no end), which we disclose as a centralization tradeoff.

**Can the creator rug?** Minting is disabled, the vault is PDA-controlled, and terms can't be edited. But the creator receives the raise directly and could stop depositing revenue. That is the same off-chain trust issue as above. The creator also receives unclaimed revenue at close, but only after the claim window that was disclosed before buying.

**Why not just use a token-streaming protocol?** Streaming pays on a fixed schedule. Here, payouts follow actual revenue, with tiers that change the split as cumulative revenue crosses thresholds.

**What if a holder never claims?** After the claim window (set before anyone buys), the creator can close and take what is left, so one holder can't block closing. The tradeoff is that a holder who misses the window loses their unclaimed revenue.

**Why Solana?** Cheap claims and transfers for small amounts, plus Token-2022's built-in freeze and transfer-hook features.

**What happens to holders' tokens after close?** They stay in wallets and have no value. Transfers are expected to fail because the hook's accounts are gone, but holders can burn them.

**What can't it express?** Time-accruing hurdles (for example 8% a year), different terms per holder, and changing terms after launch.

---

## 8. Decided, and what is deferred

**Decided for the MVP:**
- `end_cap` crossing is accepted in full. The cap only triggers expiry and never trims a deposit.
- The last tier must be uncapped (`u64::MAX`), so a deposit can't overflow.
- Unsold treasury tokens are burned at expiry.
- Unclaimed vault revenue goes to the creator at close, and `DUST_ALLOWANCE` is 1,000 base units.
- Holders' tokens linger after close, with an optional self-burn later.
- Party claims are a separate instruction (not yet written). `claim_tier_share` is holder-only with read-only tiers.
- 6 decimals, 5 tiers, 4 splits, with five fixed tier accounts.
- `payment_destination` is just a USDC account of `payment_mint`, with no extra constraints.

**Deferred past the MVP (say "known limitation, planned"):**
1. Secondary buyers (for example on a DEX) need a `ClaimRecord` before tokens arrive, because the hook can't create accounts. Direct purchases handle it.
2. Nothing creates an allowlist entry yet, so the MVP effectively runs in Open mode, with buyer compliance handled on the web platform.
3. No minimum `claim_window` is enforced.
4. A holder self-burn instruction.