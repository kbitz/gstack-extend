### [review:files=bin/update-run|setup|skills/gstack-extend-upgrade.md] Base issue: Claude skill links can follow the pre-upgrade branch
- **ID:** wi-b3f04c
- **Base issue:** present at merge base `8367bcd`; filed under `blocking=shown`
- **Description:** The updater can succeed and restore a feature branch. Claude skill links resolve into that checkout, so they can pick up the restored branch’s source instead of the upgraded main branch’s.
- **Evidence:** The same isolated real-setup branch fixture reported success and restored the branch at base `8367bcd` and candidate `52590e9`. The linked skill returned the old text on both.
- **Upstream severity:** CRITICAL
- **Found in:** `skills/gstack-extend-upgrade.md:127`
- **Context:** Track 105A documents this behavior. Revisit as part of Track 106A qualification or when checkout-backed installation changes.
- **Effort:** ?
