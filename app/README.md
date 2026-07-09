# ENSPLUS Console — Front-end UI

`ensplus_console.html` is a self-contained, single-file demonstration front-end
for the complete ENSPLUS stack. No build step, no dependencies, no CDN — open it
in any browser.

## Coverage (16 panels)
- **Register:** Overview (bloc-power gauge, protocol pulse, your standing) · **User Guide** (Field Handbook: quick-start, walkthroughs, glossary)
- **Custody:** ENS+ Vault (wrap/unwrap, vesting) · Name Vault (dual custody, per-owner index)
- **Governance:** Internal Governor (quadratic weight, commit-reveal voting) · Constitution (Articles, Standing Orders, Module Registry) · Bloc Voice (directional casting, adoption-model gauge)
- **Name Protection:** Renewal Pool (CR tiers, banked years) · Sentinel Lock (arm/guardians/panic) · Watchtower (expiry ladder)
- **Identity & Trust:** Citizen & Provenance (seal, prove humanity) · Reputation (live LibTrust breakdown) · Participation Credits (balance, ledger, earn/retire) · Civic Resolver (forward + reverse/EIP-181, records, label↔node binding, normalization)
- **Community:** Follow Graph (optional EFP reader — built but NOT load-bearing) · Guilds (planned — deferred wave, not yet built; design preview only)

## Honest status in-app
Each feature is explicitly labelled:
- **Participation Credits** — built, in audit scope (earning is simulated in the demo).
- **Follow Graph** — optional; the on-chain EFP reader ships in `ensplus-utils` and
  survives the ethid.org wind-down (EFP data lives on Base), but the trust signal
  was rebuilt L1-native so no follow graph is required. Live data needs a Base RPC.
- **Guilds** — planned, deferred wave. No contracts exist; preview only.

## Notes
- The demo runs on local JS state (no chain). Reputation uses the real LibTrust
  weights; commit-reveal, the Sentinel state machine, and the Watchtower
  escalation ladder mirror the contracts.
- Not audited or deployed — see `docs/ENSPLUS_AUDIT_SCOPE.md` and the in-app
  "Before you rely on it" note.

Aesthetic: verdigris + gold on ink (civic-monument palette); serif constitutional
headings + monospace on-chain data; provenance seal and bloc gauge as signature
elements.
