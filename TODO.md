- Figure out a story for how to re-run legacy after a new config change
- Support monorepos with nested config files but single database (perhaps keying by package name with list of enabled rules per-package)
- (Low priority) Update get file list code to take into account eslint ignore setups. You can get this from ConfigArray.
- (Low priority) If we need to convert a non-legacy disable to a legacy that contains a comment, lift the comment to a
  separate line above the legacy disable.
