# Security and public-source preparation

## Configuration

Keep deployment-specific browser settings in `config.local.js`. It is ignored by Git and deliberately excluded from service-worker storage. Only browser-visible values belong there: the file is downloaded by clients.

The CARTO key is a browser basemap key, not a server secret. Restrict its allowed websites and monitor its usage. Restricting the current production key may prevent it working on localhost; use a separate development key.

Never add backend credentials, database connection strings, private signing keys or personal access tokens to any frontend file, including an ignored frontend settings file.

## Before making a repository public

- Review the actual staged files and **all Git history**, including deleted files and old branches. This cleanup scanned the working source, not the entire repository history.
- Ignoring or moving a file does not remove it from prior commits. If a real secret has been committed, revoke or rotate it before deciding how to clean history.
- The existing tracked old versions must be removed from the next committed snapshot by the owner. Moving them to the ignored local archive does not erase historical copies.
- Keep `.local-archive/` and `config.local.js` out of commits. The archive includes original code and original deployment settings for rollback.
- Review screenshot content and third-party artwork before sharing. The existing desktop-location example was confirmed acceptable by the owner; the screenshots still show the older interface.
- The original code and documentation use the [MIT License](LICENSE). Third-party content retains its own rights; see [third-party notices](THIRD_PARTY_NOTICES.md).

No Git commands, commits, pushes, history rewrites or repository-visibility changes were performed during this review.

## Deployment boundaries

IIS is configured to block `.git` and `.local-archive` URL segments. Apply equivalent rules when using a different server. These are deployment protections; they do not make local archives safe to commit.

The separate radio API needs its own review for authorization, rate limiting, URL validation and protection against proxy requests to private services. Its implementation is outside this repository.

Do not post real credentials or precise personal location data in public issues.

References: [GitHub: ignoring files](https://docs.github.com/en/get-started/git-basics/ignoring-files), [GitHub: removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
