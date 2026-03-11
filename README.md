# boringcache/java-action

Set up Java and wire Gradle or Maven cache paths.

## When to use it

Use it when the build is Gradle or Maven and you want the runtime plus cache wiring handled together.

## Quick start

```yaml
- uses: boringcache/java-action@v1
  with:
    workspace: my-org/my-project
    read-only: ${{ github.event_name == 'pull_request' }}
  env:
    BORINGCACHE_RESTORE_TOKEN: ${{ secrets.BORINGCACHE_RESTORE_TOKEN }}
    BORINGCACHE_SAVE_TOKEN: ${{ github.event_name == 'pull_request' && '' || secrets.BORINGCACHE_SAVE_TOKEN }}

- run: ./gradlew build
```

## Trust model

- Use `read-only: true` on pull requests and other low-trust jobs.
- Pair that with `BORINGCACHE_RESTORE_TOKEN` for restore-only access.
- Use `BORINGCACHE_SAVE_TOKEN` only on trusted jobs that should publish Gradle or Maven updates.

## What it handles

- Java from `.java-version` or `.tool-versions` (fallback: `21`).
- The Java installation under mise.
- Gradle build-cache traffic through a local proxy.
- Maven dependencies from `~/.m2/repository`.

## Key inputs

| Input | Description |
|-------|-------------|
| `workspace` | Workspace in `org/repo` form. |
| `java-version` | Override the detected Java version. |
| `read-only` | Disable remote writes on PRs or other low-trust jobs. |
| `proxy-port` | Port for the local Gradle/Maven proxy. |
| `cache-java` | Cache the Java installation from mise. |
| `working-directory` | Project directory to inspect. |
| `save-always` | Save archive-backed caches even if the job fails. |

## Outputs

| Output | Description |
|--------|-------------|
| `java-version` | Installed Java version. |
| `cache-hit` | Whether any cache was restored. |
| `java-cache-hit` | Whether the Java runtime cache was restored. |
| `proxy-port` | Proxy port in use. |
| `workspace` | Resolved workspace name. |

## Learn more

- [Language actions docs](https://boringcache.com/docs#language-actions)
- [GitHub Actions auth and trust model](https://boringcache.com/docs#actions-auth)
