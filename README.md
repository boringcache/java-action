# boringcache/java-action

**Cache once. Reuse everywhere.**

Setup Java via mise and cache Gradle build cache + Maven dependencies with BoringCache.

## Quick start

### Gradle

```yaml
- uses: boringcache/java-action@v1
  with:
    workspace: my-org/my-project
  env:
    BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}

- run: ./gradlew build
```

### Maven

```yaml
- uses: boringcache/java-action@v1
  with:
    workspace: my-org/my-project
  env:
    BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}

- run: mvn package
```

## How it works

1. **Main step**: Installs Java via mise, detects your build tool (Gradle or Maven), and sets up caching accordingly.
2. **Gradle projects**: Starts a local HTTP build cache proxy and writes a Gradle init script to `~/.gradle/init.d/`. Gradle reads and writes cache entries through the proxy using its native HTTP Build Cache protocol.
3. **Maven projects**: Restores cached `~/.m2/repository` dependencies from BoringCache.
4. **Post step**: Stops the Gradle proxy (if running) and saves caches.

## Build tool detection

The action auto-detects your build tool from the working directory:

| Files detected | Build tool | Caching strategy |
|---------------|-----------|-----------------|
| `settings.gradle`, `build.gradle`, `*.kts` variants | Gradle | HTTP build cache proxy |
| `pom.xml` | Maven | Archive-based dependency cache |
| Neither | None | Java installation only |

Gradle takes priority if both are present.

## Java distribution

Java is installed via [mise](https://mise.jdx.dev/) which uses Eclipse Temurin (Adoptium) by default. Version detection priority:

1. `java-version` input
2. `.java-version` file in working directory
3. `.tool-versions` file (asdf/mise format)
4. Fallback: `21`

## Read-only mode

For pull request builds, use `read-only` to prevent pushing results while still benefiting from cache hits. The recommended pattern auto-detects based on branch:

```yaml
- uses: boringcache/java-action@v1
  with:
    workspace: my-org/my-project
    read-only: ${{ github.ref_name != github.event.repository.default_branch }}
  env:
    BORINGCACHE_API_TOKEN: ${{ secrets.BORINGCACHE_API_TOKEN }}
```

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `cli-version` | `v1.8.0` | BoringCache CLI version. Set to `skip` to disable automatic setup. |
| `workspace` | | BoringCache workspace (e.g., `my-org/my-project`). |
| `cache-tag` | repo name | Cache tag prefix. |
| `java-version` | `21` | Java version to install via mise. Auto-detected from `.java-version` or `.tool-versions`. |
| `working-directory` | `.` | Working directory for build tool detection. |
| `cache-java` | `true` | Cache Java installation from mise. |
| `proxy-port` | `5000` | Port for the Gradle build cache proxy. |
| `read-only` | `false` | Don't push Gradle build results (useful for PRs). |
| `gradle-home` | `~/.gradle` | Gradle user home directory. |
| `enable-build-cache` | `true` | Set `org.gradle.caching=true` in `gradle.properties`. |
| `proxy-no-git` | `false` | Pass `--no-git` to the proxy. |
| `proxy-no-platform` | `false` | Pass `--no-platform` to the proxy. |
| `verbose` | `false` | Enable verbose CLI output. |
| `exclude` | | Glob pattern to exclude files from cache digest. |
| `save-always` | `false` | Save cache even if the job fails. |

## Outputs

| Output | Description |
|--------|-------------|
| `workspace` | Resolved workspace name. |
| `java-version` | Installed Java version. |
| `cache-tag` | Cache tag prefix used. |
| `cache-hit` | Whether any cache was restored. |
| `java-cache-hit` | Whether the Java installation cache was restored. |
| `proxy-port` | Gradle build cache proxy port. |
