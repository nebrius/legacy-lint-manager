- Detect lint config changes compared to base branch and allow new legacy additions (Sidestepping the need for a temporary CI disable). Should be an object compare, not a hash compare, but have to be careful w/ ESLint due to dep changes changing injected values.
- Support monorepos with nested config files but single database (perhaps keying by package name with list of enabled rules per-package)
- (Low priority) Update get file list code to take into account eslint ignore setups. You can get this from ConfigArray.
- (Low priority) If we need to convert a non-legacy disable to a legacy that contains a comment, lift the comment to a
  separate line above the legacy disable.
