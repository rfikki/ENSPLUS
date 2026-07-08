# ENSPLUS — Complete Project Archive
Generated: 2026-07-04 (updated: UI expanded — Follow Graph (optional EFP), Guilds (planned preview), Participation Credits panels added

## Layout
- `README.md` — project overview, decisions log D1–D11, roadmap. Start here.
- `docs/` — five design documents (migration, autopilot, threat model, manifest spec, social charter)
- `tools/efp_trustgraph.mjs` — trust-graph prototype (--demo / --live)
- `contracts/` — Hardhat project, slices 1-3(p1):
  - Slice 1 (pure libraries): 23 tests, 10,494 fuzz checks, 0 mismatches — see SLICE1.md
  - Slice 2 (custody core): ENSPLUSVault + RevenueSplitter, invariants I1–I4 executable — see SLICE2.md
  - Total: 38/38 passing. `npm install && npx hardhat test` (offline: npm run build && npm run test:offline)

  - Slice 5 (bloc voice): AttestorRegistry, GovernorAdapter, VaultSteward — 74/74 passing, genesis ceremony rehearsed

  - Slice 6 (NameVault): dual-custody name wrapper, D7 controller retention, D9 per-owner index, Article-X migration slot — 81/81 passing

  - Slice 7 (RenewalPool): CR tier ladder, epoch budgets, banked years, first real charter through the ModuleRegistry — 88/88 passing

  - Slice 8 (Citizen): soulbound identity, CREATE2 token-bound account, runtime charter-gated credits — 95/95 passing
  - PROJECT_CHECKLIST.md — finished vs remaining across all tracks

  - Slice 9 (Sentinel Lock): opt-in per-owner transfer/unwrap timelocks, M-of-N guardians, panic freeze; NameVault sentinel slot — 102/102 passing

  - Slice 10 (Watchtower): expiry escalation, keeper checkpoints, alarms, confusable watchlist, resurrection anchor — 111/111 passing

  - tools/efp_onchain.mjs — reads EFP follows directly from Base contracts (no hosted API); pure decoders verified vs EFP docs vectors (7/7); trust graph from outbound reads only

  - tools/eik_profile.mjs + test — EIK fallback: on-chain ENS+EFP profile resolver and self-contained, injection-safe SVG card renderer (8/8)

  - Slice 12 (TrustOracle): read-only aggregator making LibTrust live against attestor/governor/namevault/renewalpool/citizen; boundRank persisted — 121/121 passing

  - Slice 13 (HumanAttestor + hardening): ownerless zkPassport proof-of-humanity feeding LibTrust; ensplus-utils SDK; gas snapshot; deterministic deploy blueprint; ADOPTED_IMPROVEMENTS.md — 129/129 passing

  - Slice 14 (CitizenResolver): ownerless read-only ENS resolver exposing live civic records; recordVersion clearing; ENSIP-10 + CCIP-read; provenance-safe on transfer — 137/137 passing

  - Pre-audit hardening: SentinelLock stateful invariants + Watchtower property tests (monotonic ladder, watchedCount, lapse-once) + LibTrust/TrustOracle property tests (bounded + monotonic) — 144/144 passing

  - Pre-audit decisions RESOLVED: RenewalPool raffle → block.prevrandao; LibTrust rank tiers reconciled to canonical LibAttestation.rankTier (real drift fixed); Policy A/B + capBps locked as documented policy; docs/DECISIONS_RESOLVED.md + docs/FROZEN_DERIVATION_SPEC.md — 144/144 passing

  - docs/ENSPLUS_AUDIT_SCOPE.md — external-audit boundary: 22 contracts/~3045 SLOC in scope, deferred waves + externals out, invariants I1-I10, accepted findings, 8 focus questions. Pre-audit hardening complete — 144/144 passing

  - app/ensplus_console.html — self-contained single-file front-end UI covering the full stack (16 panels incl. User Guide, Credits, Follow Graph, Guilds); no CDN, no build. See app/README.md. 146/146 tests, 22 contracts.

## Checksums (sha256)
69d0a489fdeaaf95955a2dd001fa4f0b004171add9faf58e95fc225ba3c9cd18  PROJECT_CHECKLIST.md
e350f5fa3ba39a2c9591993850cc6c2e5986eb91e49401b17a354f90633a5eb9  README.md
95026117a6379ff204428695b6188b253f557f4477e674832f7dd1f919614d2c  app/README.md
7e6afbc2f555f0e293af0be39e6ad7afc29faa37fa021cebeecc6aec2865e9a8  app/ensplus_console.html
825fe31b4e8d644078dffac797d3f8b9aef391cff83b27e546deaa750a4a6017  contracts/.gas-snapshot
d7ea9bd941b7b14bce3d41de8ec543dec73637cd4c523135612e11bfb104db32  contracts/SLICE1.md
91ed16a9af900bb0ae1888b909b1ce21bca8988192987413dde59010634c4893  contracts/SLICE10.md
0ba4a37318c996761f116642bfb82c33376bcb001b33028268e87b15d1c25774  contracts/SLICE11.md
06984f6d70025f6f6821380bf3784d7eb7503e0eefaa355cb76d02a55108731a  contracts/SLICE12.md
a3f18a8e86130d42764d7ba042888300eef518e7276b982cbd2d7c2537d83200  contracts/SLICE13.md
2618e5e1ecedccb1b5d34a9df0ea891e6d1ae0f3dd9d273a134f43500e3785f2  contracts/SLICE14.md
4aaa188f0a4988b9e49310920dc1eccc42f657d9a9918a0642a31d0a6ff9d75d  contracts/SLICE15_HARDENING.md
4c3748a3074df51b538e925a40f188cf8fe25dd473e752ef7ed3711b3c735653  contracts/SLICE2.md
94f4eb0f2dc970b9cfdf70433e821c1c87c4f042008bf5c28e6c07ee44f217dd  contracts/SLICE3.md
ba64714d676ff92dccfc2d976bbf0271f3b22a2b2ab4380aafe6e008bcb42c2e  contracts/SLICE4.md
7559459a637636eb413337da1e7e760e97fa9962f780bd654df957f44bd180a5  contracts/SLICE5.md
c9a18cd9916b9c7926744fd7a3bf15d806f7c6b5dd0a7767cc26a9d9a2e54898  contracts/SLICE6.md
5119afbb050327f2ebdb9d9ef91a97c8ed38744f260431af00870064b1323aa6  contracts/SLICE7.md
c47ed371d2771027c7dc24a6a1d1e9810b259bad293832d08f78be423f2f0b75  contracts/SLICE8.md
53960c6f4eee73eb1856a0ff23b417c6fcd9c728316ec9a06922b53a606a7d42  contracts/SLICE9.md
1a1a8d0c3a1d9fd7d4c22d43006fbab4f4a16d2c3bef6a4866b1a28ca825c934  contracts/contracts/core/AttestorRegistry.sol
a3a07b160659377f1161dabe1542b35d54a52512823c5db6e6ff9d120715d498  contracts/contracts/core/Citizen.sol
ddfac02b06c07a5af11e7bd205d5316f5b718d040060a806d6ffb67a18615f53  contracts/contracts/core/CitizenResolver.sol
936391dbb436589b5dca321d0d94428409c8ccecad0f1b6ffd835e3f6d8e0283  contracts/contracts/core/ConstitutionRegistry.sol
94cd7e259631a0878c87008871c4e1a6816a4d4e77fe82071c6d7dda9c61c6f7  contracts/contracts/core/ENSPLUSVault.sol
9560871345ad2fc2e8a70256a7951a31709684f3b321c50bea1b613a3d8d23e4  contracts/contracts/core/GovernorAdapter.sol
9e381e035dcaca33b9d63a5e4ccf88b8e7793b9bf163b346702de926195575d2  contracts/contracts/core/GovernorExecuted.sol
8925953ddf29a71c23fb9aea91be1441600d794556bb1e4e7881933234ada518  contracts/contracts/core/HumanAttestor.sol
f5dd4a3288e2b40b935dc7f63199665ca5dfe79e44c81a446350535533330051  contracts/contracts/core/InternalGovernor.sol
3a41014771473eb22794b090d945a10eb395d0912978ae7694f5cbad79137545  contracts/contracts/core/ModuleRegistry.sol
54b01e44f02c06b6865af4355d193ebdaf726f000262215117fae647444419cf  contracts/contracts/core/NameVault.sol
6987a34831bdbd85984497813b3b0775434fe2567ba10473f52c32bb50126c26  contracts/contracts/core/ParticipationCredits.sol
9775abdd1f041730ed7a01c2c045f3a42c21033ddf250cee9f7873de749e008d  contracts/contracts/core/RenewalPool.sol
5707801e584832daa67dba11e9faa8216d5cb7841dced0c35d2bc8941e9f254a  contracts/contracts/core/RevenueSplitter.sol
48c64a615e05f902f629c38346f1b657d702176416922ae866dde6825e394f5b  contracts/contracts/core/SentinelLock.sol
43fc829148ff7161118a18d8918361323f3e18076a676bcc92f1307de4c6b820  contracts/contracts/core/StandingOrders.sol
6895bd5fa0eb1e0faff7702af7fe58a40ae28b6c932ec41946c11266238287c8  contracts/contracts/core/TrustOracle.sol
f1eb5dbffd7bb61d6d4e376fd3747da6e3804fc45fb5a4e84e64065e87f7dfd6  contracts/contracts/core/Watchtower.sol
7d23ab0c2a2f46536c682a58cf48ac0a55ae36a1cae67102a68426b21ff8c676  contracts/contracts/interfaces/IENSPLUSModule.sol
bc3335fb3f9776e4bbc3c433f9f07bf5c49de0172c2fbf139838aed23f8fdc04  contracts/contracts/libraries/LibAttestation.sol
66fe25b0b7af5657457b0f9033a0db6ba66def7b69cb356849f99326b0c577d9  contracts/contracts/libraries/LibCategory.sol
856f63681a83f3c86f947c02eb2b2fef529b15b2b18f2554cb4b3c6c6bc17eba  contracts/contracts/libraries/LibTrust.sol
6c4a44182532d735acfd75d8dff7665a20bf19e1ef1bb9badfee7baf169d1906  contracts/contracts/libraries/LibWeight.sol
5f9f20816b1a83d2063591462c94aad55197bf075c971cf6bd7ee337c667320d  contracts/contracts/test/Harnesses.sol
294bc692670da318c7aa3da8bd7682fc76d90b6cbcfe85df84cb03d5b49ada76  contracts/contracts/test/LibTrustHarness.sol
4d8cd7ad8b6b276ddd6a808768718135d9150a4dcb0aebe64e9502a927f08851  contracts/contracts/test/MockENS.sol
cbc01a9a3be861368e22f440bc309c428fc9823703744f998f845fec290375e6  contracts/contracts/test/MockModule.sol
4782ec6122971c28971ed88b1f322812be15d2ff51d9308d8606d470287c488b  contracts/contracts/test/MockProvenance.sol
46d649d05135dd97437853b0a929a104d75408c83aaf361af650c2a0cdfdf0e2  contracts/contracts/test/Slice10Mocks.sol
aa9d2a832173b27c3336f5550d812ac4cfccc3c555ed4d19d90021faa83869c1  contracts/contracts/test/Slice13Mocks.sol
44ac88ed94e96249118db0f7e99b982f7eb8651faec2ba18fcaf3895b93ef09f  contracts/contracts/test/Slice14Mocks.sol
b6c80ae7a4375c3b72f1a1a49c61b2594e968e08354814cbbb3fa92c74627d33  contracts/contracts/test/Slice5Mocks.sol
b22d9637f43f1fa93e5d6d6d5b1b457b9144ee0b4b7a52297277c6614e252a7a  contracts/contracts/test/Slice6Mocks.sol
3f636aa64399bd99398c8aa398a210511c1d2701ff2c396d0a1c8261b00451a9  contracts/contracts/test/Slice7Mocks.sol
c128b1cf8c24ed4ea9750cb38db85286172bc73b7285d235dc13fb57b01c94fc  contracts/hardhat.config.js
7b3d087f15f874ea2c12b87c39f1cbc0fd74ccef6e257cd5cdb4bbd587ac2731  contracts/package.json
94f7fddcafb459d1cc24983bcdeab0ed2278c545ac705ed44901b8c93d655b5c  contracts/test/InternalGovernor.test.js
b4e89c81b8074cad9f92fe48fc6460b53266c5aa9c3cc9cc794253f75f06ea53  contracts/test/InternalGovernor2.test.js
668fb608196148881c22688c5b6ce058858457a5fde3adde07c76631585e381b  contracts/test/Invariants.test.js
c06786700c5046782452e81ebd891e8c2aea9fb9b81affbf6b6b840d791c0944  contracts/test/LibAttestation.test.js
7a9b51d1850a3fd963ce45110300c53d06d3715b6b0eb5394b515a2ba02e3320  contracts/test/LibCategory.test.js
2bdc41fb29eefc87230040459499450ad636aa8a5360da61780aa0196e241afe  contracts/test/LibWeight.test.js
446219841dc6508c4acf385106ed87456e3def53fd7ebb78fea6b018d8ebee26  contracts/test/SentinelInvariants.test.js
8406bfab9fb223770407e2b74d6a94a2243b6ab6ca1b70a32ff3d6118a1c5263  contracts/test/Slice10.test.js
cb10bcd63932333c3bdf104ae1decf0d6912c8a24c13fbc22bfb29672d4ccee9  contracts/test/Slice11.test.js
d4f7e982025071b298421f1fb8210f72b89b30079925cc89652565ee9ad5f133  contracts/test/Slice12.test.js
af0b801542da0fc5dbcdace74562c84f71b0c6d3cf50195d5c093d20a0474955  contracts/test/Slice13.test.js
953f56a2ec34e4034a911355ee825eea4c7737817efdc9c984a0d7899ae21c2e  contracts/test/Slice14.test.js
a754f351a4e50d680d0a37f94dce8959928266362cd994b6492e06f520eca41e  contracts/test/Slice4.test.js
aabdb43b04a77e405f5886df7dac0da3652fb45f4a7e74251774d2ecb6e567a5  contracts/test/Slice5.test.js
b42e17fe8c1a0bd389d8c0bd42a68445a6a1562b993b8102ccb8f66daad2ed35  contracts/test/Slice6.test.js
d9a47bc7215b6a7f6a564568423520c03a5963c3c570c50a2e25eaf5c242c916  contracts/test/Slice7.test.js
04570980a0b7a7d066bfcd6a7f59584cbc7202f7e34054a42cc2afd85fd945ce  contracts/test/Slice8.test.js
31734a4f7e6be940343a341ee9496be90eba7b56df5d229b58960ba93bf90a8e  contracts/test/Slice9.test.js
75b2f945085c8fdc6bcd7841033d0ae3dac5aad80ce7863a8d34f348bdda0c14  contracts/test/TrustPropertyInvariants.test.js
200834bab88d6a1c86f084cf9388bf90cb435e051a9824c88eeb89d31326965f  contracts/test/Vault.test.js
e76a8685034275ec7f7db05a51928b0207dc81c9ef59fa9c3f68251217b3af83  contracts/test/WatchtowerInvariants.test.js
fe2aef7c7cda0b1adbdc854d6bd8a9cf98efc4c6f9cecc2d11d16c02a72821c6  contracts/tools/adoption_model.mjs
4b2750174b34b3550cfc0e1ac9a9fdd1beba487b409f6d8620a9731d5d6cc08f  contracts/tools/build.js
9854ab0394559721123ecbd1ffca6cb088bac5a18cafc259c805a453f18a7324  contracts/tools/deploy.js
c3e8435bf771c8405386dec4935a85ac05b08c355e74cac0aba4974025a611ca  contracts/tools/efp_onchain.mjs
491c9fa743abfa0510b7aa6918222ec7a767bad39befbb3f03a4ae13be230e7b  contracts/tools/efp_onchain.test.mjs
6fcf60ee1ef75ae6d54709f5e1a9846ee6fc4b888cd80259a8439233a678dc07  contracts/tools/eik_profile.mjs
dbbed4a58e61ae7b4f11849855cd3cff06c2019394886b6270f314c1136be878  contracts/tools/eik_profile.test.mjs
29368bb5a8f166cbd11417864e4d09ae305a1684a0e5ffe2e609252f67b66446  contracts/tools/ensplus-utils/index.mjs
e839788b67095f76768266f5f379b29e97f403b4c64e0ed20477c7b14938b62f  contracts/tools/ensplus-utils/index.test.mjs
13a3f6702d179dc9894c60e3b780a5f7cf86c40dc81e522bf9c712519e3994a2  contracts/tools/ensplus-utils/package.json
793a8a188ab8db54ed4286e2f3445be95e9a22e89d761e1eeb742f37739910ad  contracts/tools/fuzz.js
c021b0e7da02043c8fa68ba800aa2e433bbf318d56d7563350228037c1332586  contracts/tools/gas_snapshot.js
28139a509d971ad7d9aeadddc9c1af47e221aa1ce8c3d08c6f0ecacabbb24401  contracts/tools/libtrust_mirror.mjs
b02547829d90594dfb26a401480e06663519f4fa910fc8f1d3bd5261a2bb627b  docs/ADOPTED_IMPROVEMENTS.md
b25b8f9c89127efd6e6b75891c9b9875146f81aa57145f7654bfe36dce28dec7  docs/DECISIONS_RESOLVED.md
98707ebfc7deae74268c9a4901b249c8053d060b0a0a8ae48dc2f53f009df2d9  docs/ENSPLUS_AUDIT_SCOPE.md
abd1aef7c758e84bcb13f87225c5ee0ec09e107b9eae663a38c59e8a91780e2d  docs/ENSPLUS_AUTOPILOT_SPEC.md
cd8f6d8bbb2f63f2a4d60ee49fcb03990200b5012f0869b3b86fc4bc8fdace79  docs/ENSPLUS_ENSV2_MIGRATION_SPEC.md
c2a2f28ffe2a3d7b0e8a38eee20e19024cabcd337a883ea1a56dda1ca88f2dca  docs/ENSPLUS_MODULE_MANIFEST_SPEC.md
9e5765f3e047f862e7b258d54f7adaa12278bcee328105d43f5e8c04b8aae4fe  docs/ENSPLUS_OVERVIEW.md
0de8d5e0d3a4d87ea0f6365c220920cf30c0277ea7254f4c0a13a5662f453ade  docs/ENSPLUS_SOCIAL_MODULE_CHARTER.md
a3e086f9a0e6494ff3b3a81c8f0c6fe89419cf9b5262720ea68d05104e21c1fc  docs/ENSPLUS_THREAT_MODEL.md
8d3528a4aa06184fb84688a6c876757254af6289f33b538bb4221a839940d9e7  docs/FROZEN_DERIVATION_SPEC.md
41e10db096a912adb5c6fa50c6179e42427ec76c894cf44e98e21e8c49fe7849  tools/efp_trustgraph.mjs
6fcf60ee1ef75ae6d54709f5e1a9846ee6fc4b888cd80259a8439233a678dc07  tools/eik_profile.mjs
dbbed4a58e61ae7b4f11849855cd3cff06c2019394886b6270f314c1136be878  tools/eik_profile.test.mjs
