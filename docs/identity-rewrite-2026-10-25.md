# Commit identity correction — 2026-10-25

The owner explicitly authorized correcting future commits and rewriting the incorrectly attributed history. No browser or computer UI was used for this correction.

- Verified GitHub account: `carlwelen`, numeric ID `72322644`.
- Correct global email: `72322644+carlwelen@users.noreply.github.com`.
- Removed the repository email override; all worktrees inherit the correct global address.
- `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` and `EMAIL` were unset in the command environment.
- The incorrect numeric ID `12345678` maps to `shubh2294`; the existing SSH credential authenticates as `carlwelen`.
- Applied an exact email mailmap in an isolated mirror clone, preserving messages, dates, trees and topology. No commits were pruned.
- Verified all **395 commit objects**: the only permitted differences were author/committer email and parent hashes required by that change. Every file tree remained identical.
- Twelve commits had the wrong email; their correction changed fifteen commit hashes including descendants.
- Updated four remote branches in one atomic push, with an explicit expected old SHA for every `--force-with-lease`. Verified every remote branch afterward; all other branch tips were unchanged.
- Published main `09d7776` is the corrected complete green F37/documentation checkpoint. Later B25 foundation work remains local until its reviewed correction passes.

## Recovery and review provenance

Local recovery bundle: `/tmp/bostadspriser-identity-20261025/before.bundle` (verified with `git bundle verify`). Original affected tips are also retained under local `refs/identity-backup/20261025/`; these backup refs were not pushed. Full manifests and remote verification are in the same temporary directory.

Existing review reports refer to immutable original IDs. The table below maps them to content-identical corrected commits; code review evidence remains applicable. Active backlog/handoff references and the integration queue use corrected IDs.

| Original commit | Corrected commit |
|---|---|
| `00647b00a32c9d12fa841da00302f49bd3712dfa` | `9c440762f9af9b84666e8bc4fa41a65e39eac754` |
| `0ff2699344124022808e9fef300f8f6e956c513c` | `9faafd8a9b8df17c6af61d7af01369dd46718084` |
| `164e985b03f2d2b48a795618924faac4f9ee6416` | `09d77766d008444b3eddb4917f1d698be22c6fd7` |
| `1b3c70e2b9eeb07c9cf9d3592c5f8fb863b11e3f` | `c0848c42f215b8524ee58da3fcae8c716a9bb0ae` |
| `27bf79fbde3d391ebba8527ab2bfd8da75b13c7e` | `bce4500ca4d04312e95c91f660956d047469fb5f` |
| `305c83b05ae1e6ee1b651dddf02ffcb5f7cf20d1` | `675e0c9c1a61b1af74eb689c5ddf77fc9922271f` |
| `473caf7fb3507ea10a3a92e06c5356835b204eb4` | `38ba06b591c1ea0c6c86be391359fba8b8f090a1` |
| `5fe60835a7d85291705eebf829bdae6a6dcbdaa8` | `3d740207515c759de62614251a8591aca9dcbfa8` |
| `60e547d2800a24e43c16560f6f01a18a9313c6e7` | `b8cd12d3640a101374d9051c110c5e7afd500930` |
| `772492083228165a5626c952b42bbf27b750dcb7` | `456bd76399e8c8cef0169e69053eae4318edb52b` |
| `7ead977d6c3ffa79b297cb2b676c28ae40368b6c` | `ae7be06ac438d0f69db4b21549aec05aa72a89b7` |
| `8106ac473a0b00a1d1a91fb322b259fb02f30b20` | `320dc0bf52434cacee731b5c24e7e48640c055f2` |
| `84f144ff825aabe5e8589b0d5fe7e1b09b190424` | `6d5809dbcbbe217c0b855a2b1b362d2297a15b48` |
| `94b17b8b385a069214929af8cd2ad8a4dac248ac` | `cc84261f02050508cf109cca6c3e38a62666e0c3` |
| `9c3e844022bc5481ba3d6c11d56330da5685cf49` | `f2da434ff94f360fd27c556034642131b6990d2c` |
