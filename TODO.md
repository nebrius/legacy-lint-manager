- Validate before running add legacying to prevent possible broken states if there are malformed legacy comments
- Prevent non-legacied rules on a line with legacies from being added to the legacies pragma. Maybe id contains hash of rules?
- List all enabled rules in database, and allow new additions if they're new rules (Sidestepping the need for a temporary CI disable)
- Support monorepos with nested config files but single database (perhaps keying by package name with list of enabled rules per-package)
- Init tests
- Update get file list code to take into account eslint ignore setups. You can get this from ConfigArray.
- (Low priority) If we need to convert a non-legacy disable to a legacy that contains a comment, lift the comment to a
  separate line above the legacy disable.
