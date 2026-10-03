# Programmable Revenue Agreements

A Solana protocol that lets a creator turn a share of future revenue into tradable Token-2022 entitlement tokens, with tiered, rule-based payouts settled on-chain.

## How it works

1. **Create:** a creator defines an agreement: token supply, share price, revenue tiers, and an end condition. The protocol mints the fixed supply into a treasury.
2. **Purchase:** a buyer pays USDC and receives entitlement tokens. The USDC goes to the creator.
3. **Deposit:** a designated depositor sends revenue to a program-owned vault. The protocol fills the tiers in order and records what each token has earned.
4. **Claim:** holders (and any named wallets in a tier split) withdraw their accrued share from the vault. The total is the same however often they claim.
5. **Transfer:** a transfer hook settles accrued revenue for both sender and receiver on every transfer, so nobody inherits or loses past earnings.
6. **Expire and close:** when the expiry time or the cumulative cap is reached, anyone can end distribution. After claims are settled the creator closes the agreement and reclaims rent.

## Key concepts

- **Entitlement token:** a Token-2022 mint with a fixed supply, frozen-by-default accounts and a transfer hook.
- **Tiers:** a waterfall. Each tier has a cumulative-revenue threshold and a list of splits (token holders, the creator, or any named wallet) summing to 100%.
- **Accumulator:** each tier stores revenue earned per token. A holder's claim is `balance × (accumulator − last_accumulator) + pending`, so claim timing never changes the total.
- **Compliance:** a Compliance Admin can freeze and unfreeze a holder. Buyer terms are accepted on the web platform at purchase.

## Instructions

| Instruction | Signer | Purpose |
|---|---|---|
| `initialize_agreement` | Creator | Create accounts and mint, set terms, mint supply to treasury |
| `purchase_share` | Buyer | Swap USDC for entitlement tokens |
| `deposit_revenue` | Depositor | Fund the vault and fill tiers |
| `claim_tier_share` | Holder | Withdraw accrued revenue |
| `transfer_hook_callback` | Token-2022 | Settle sender and receiver on transfer |
| `freeze_position` / `unfreeze_position` | Compliance Admin | Freeze or restore a holder |
| `expire_agreement` | Anyone | End distribution once an end condition is met |
| `close_agreement` | Creator | Close accounts and return rent |

## Accounts

| Account | Holds |
|---|---|
| `AgreementConfig` | Terms, counters and status |
| `TierState` (one per tier) | Threshold, splits, accumulator |
| `ClaimRecord` (one per holder) | Last accumulator value, pending amount, frozen flag |
| Vault | Deposited USDC revenue |
| Treasury | Unsold entitlement tokens |
| Entitlement mint | Token-2022 mint with Default Account State and Transfer Hook |

## Example agreement

A $100k music advance: 10,000 tokens at $10. Tier 0 pays the first $100k of deposits 100% to holders (recoupment). Tier 1, with no upper limit, splits 30% to holders and 70% to the creator. The agreement expires after 5 years.

## Not in scope

Verifying off-chain revenue, legal enforceability, a trading venue, share sell-back or burn, and time-accruing hurdle rates.

## Stack

Rust, Anchor, Token-2022, TypeScript client.

## Getting started

```bash
anchor build
anchor test
```

## Status

Architecture design is complete. Implementation is starting.