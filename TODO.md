- Now that rules are tracked in the database, we need to have validate --update prune rules from legacy statements that still contain other valid rules
- Figure out a story for how to re-run legacy after a new config change
    - I think only safe story is to say `add --no-compare on PR that changes`, remove it in immediate follow up PR
- Support monorepos with nested config files but single database (perhaps keying by package name with list of enabled rules per-package)

## Low priority
- Update get file list code to take into account eslint ignore setups. You can get this from ConfigArray.
- If we need to convert a non-legacy disable to a legacy that contains a comment, lift the comment to a
  separate line above the legacy disable.
