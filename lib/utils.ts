import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ensureBoringCache,
  execBoringCache as execBoringCacheCore,
  getWorkspace as getWorkspaceCore,
  getCacheTagPrefix as getCacheTagPrefixCore,
  pathExists,
  startRegistryProxy,
  waitForProxy,
  stopRegistryProxy,
  findAvailablePort,
} from '@boringcache/action-core';

export {
  ensureBoringCache,
  pathExists,
  startRegistryProxy,
  waitForProxy,
  stopRegistryProxy,
  findAvailablePort,
};

const isWindows = process.platform === 'win32';

let lastOutput = '';

export async function execBoringCache(args: string[]): Promise<number> {
  lastOutput = '';
  let output = '';

  const code = await execBoringCacheCore(args, {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      },
      stderr: (data: Buffer) => {
        const text = data.toString();
        output += text;
        process.stderr.write(text);
      }
    }
  });

  lastOutput = output;
  return code;
}

export function wasCacheHit(exitCode: number): boolean {
  if (exitCode !== 0) {
    return false;
  }

  if (!lastOutput) {
    return true;
  }

  const missPatterns = [/Cache miss/i, /No cache entries/i, /Found 0\//i];
  return !missPatterns.some(pattern => pattern.test(lastOutput));
}

export function getWorkspace(inputWorkspace: string): string {
  return getWorkspaceCore(inputWorkspace);
}

export function getCacheTagPrefix(inputCacheTag: string): string {
  return getCacheTagPrefixCore(inputCacheTag, 'java');
}

export function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).trim().toLowerCase() === 'true';
}

export function getMiseBinPath(): string {
  const homedir = os.homedir();
  return isWindows
    ? path.join(homedir, '.local', 'bin', 'mise.exe')
    : path.join(homedir, '.local', 'bin', 'mise');
}

export function getMiseDataDir(): string {
  if (isWindows) {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'mise');
  }
  return path.join(os.homedir(), '.local', 'share', 'mise');
}

export async function installMise(): Promise<void> {
  core.info('Installing mise...');
  if (isWindows) {
    await installMiseWindows();
  } else {
    await exec.exec('sh', ['-c', 'curl https://mise.run | sh']);
  }

  core.addPath(path.dirname(getMiseBinPath()));
  core.addPath(path.join(getMiseDataDir(), 'shims'));
}

async function installMiseWindows(): Promise<void> {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  const miseVersion = process.env.MISE_VERSION || 'v2026.2.8';
  const url = `https://github.com/jdx/mise/releases/download/${miseVersion}/mise-${miseVersion}-windows-${arch}.zip`;

  const binDir = path.dirname(getMiseBinPath());
  await fs.promises.mkdir(binDir, { recursive: true });

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mise-'));
  try {
    const zipPath = path.join(tempDir, 'mise.zip');
    await exec.exec('curl', ['-fsSL', '-o', zipPath, url]);
    await exec.exec('tar', ['-xf', zipPath, '-C', tempDir]);
    await fs.promises.copyFile(
      path.join(tempDir, 'mise', 'bin', 'mise.exe'),
      getMiseBinPath(),
    );
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

export function resolveJavaMiseId(version: string, distribution: string): string {
  const hasPrefix = /^[a-zA-Z]/.test(version) && version.includes('-');
  if (hasPrefix) return version;
  if (distribution) return `${distribution}-${version}`;
  return version;
}

export async function installJava(miseId: string): Promise<void> {
  core.info(`Installing Java ${miseId} via mise...`);
  const misePath = getMiseBinPath();

  await exec.exec(misePath, ['install', `java@${miseId}`]);
  await exec.exec(misePath, ['use', '-g', `java@${miseId}`]);
}

export async function activateJava(miseId: string): Promise<void> {
  core.info(`Activating Java ${miseId}...`);
  const misePath = getMiseBinPath();

  await exec.exec(misePath, ['use', '-g', `java@${miseId}`]);
}

export async function resolveJavaHome(miseId: string): Promise<string> {
  const misePath = getMiseBinPath();

  let envOutput = '';
  await exec.exec(misePath, ['env', '-s', 'bash', `java@${miseId}`], {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => { envOutput += data.toString(); },
    },
    ignoreReturnCode: true,
  });
  const javaHomeMatch = envOutput.match(/export JAVA_HOME="?([^"\n]+)"?/);
  if (javaHomeMatch) {
    const miseJavaHome = javaHomeMatch[1];
    core.info(`mise env JAVA_HOME: ${miseJavaHome}`);
    const validated = findJavaHome(miseJavaHome);
    core.info(`Validated JAVA_HOME: ${validated}`);
    return validated;
  }

  let whereOutput = '';
  await exec.exec(misePath, ['where', `java@${miseId}`], {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => { whereOutput += data.toString(); },
    },
    ignoreReturnCode: true,
  });
  const installDir = whereOutput.trim();
  if (!installDir) return '';

  core.info(`mise where returned: ${installDir}`);
  return findJavaHome(installDir);
}

function findJavaHome(installDir: string): string {
  const javaBin = isWindows ? 'java.exe' : 'java';

  if (fs.existsSync(path.join(installDir, 'bin', javaBin))) {
    return installDir;
  }

  const contentsHome = path.join(installDir, 'Contents', 'Home');
  if (fs.existsSync(path.join(contentsHome, 'bin', javaBin))) {
    return contentsHome;
  }

  try {
    const entries = fs.readdirSync(installDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const nested = path.join(installDir, entry.name);
      if (fs.existsSync(path.join(nested, 'bin', javaBin))) {
        return nested;
      }
      const nestedContents = path.join(nested, 'Contents', 'Home');
      if (fs.existsSync(path.join(nestedContents, 'bin', javaBin))) {
        return nestedContents;
      }
    }
  } catch {}

  return installDir;
}

export async function configureJavaEnv(miseId: string): Promise<void> {
  const javaHome = await resolveJavaHome(miseId);
  if (!javaHome) {
    core.warning('Could not resolve JAVA_HOME from mise');
    return;
  }
  core.exportVariable('JAVA_HOME', javaHome);
  core.addPath(path.join(javaHome, 'bin'));
  core.info(`JAVA_HOME=${javaHome}`);
}

export async function getJavaVersion(inputVersion: string, workingDir: string): Promise<string> {
  if (inputVersion) {
    return inputVersion;
  }

  const javaVersionFile = path.join(workingDir, '.java-version');
  try {
    const content = await fs.promises.readFile(javaVersionFile, 'utf-8');
    const version = content.trim();
    if (version) return version;
  } catch {}

  const toolVersionsFile = path.join(workingDir, '.tool-versions');
  try {
    const content = await fs.promises.readFile(toolVersionsFile, 'utf-8');
    const javaLine = content.split('\n').find(line => line.startsWith('java '));
    if (javaLine) {
      return javaLine.split(/\s+/)[1].trim();
    }
  } catch {}

  const miseVersion = await readMiseTomlVersion(workingDir, 'java');
  if (miseVersion) return miseVersion;

  return '21';
}

export async function readMiseTomlVersion(workingDir: string, toolName: string): Promise<string | null> {
  const miseToml = path.join(workingDir, 'mise.toml');
  try {
    const content = await fs.promises.readFile(miseToml, 'utf-8');
    const toolsMatch = content.match(/\[tools\]([\s\S]*?)(?:\n\[|$)/);
    if (toolsMatch) {
      const versionMatch = toolsMatch[1].match(
        new RegExp(`^\\s*${toolName}\\s*=\\s*["']([^"']+)["']`, 'm')
      );
      if (versionMatch) return versionMatch[1];
    }
  } catch {}
  return null;
}

export function getMavenLocalRepo(): string {
  if (process.env.MAVEN_REPO_LOCAL) {
    return process.env.MAVEN_REPO_LOCAL;
  }
  return path.join(os.homedir(), '.m2', 'repository');
}

export async function detectBuildTool(workingDir: string): Promise<'gradle' | 'maven' | 'none'> {
  const gradleFiles = ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts'];
  for (const file of gradleFiles) {
    try {
      await fs.promises.access(path.join(workingDir, file));
      return 'gradle';
    } catch {}
  }

  try {
    await fs.promises.access(path.join(workingDir, 'pom.xml'));
    return 'maven';
  } catch {}

  return 'none';
}

export function resolveGradleHome(input: string): string {
  const gradleHome = input || '~/.gradle';
  if (gradleHome.startsWith('~')) {
    return path.join(os.homedir(), gradleHome.slice(1));
  }
  return path.resolve(gradleHome);
}

export function writeGradleInitScript(gradleHome: string, port: number, readOnly: boolean): void {
  const initDir = path.join(gradleHome, 'init.d');
  fs.mkdirSync(initDir, { recursive: true });

  const initScript = `gradle.settingsEvaluated { settings ->
    settings.buildCache {
        remote(HttpBuildCache) {
            url = "http://127.0.0.1:${port}/cache/"
            push = ${!readOnly}
            allowInsecureProtocol = true
        }
    }
}
`;

  const scriptPath = path.join(initDir, 'boringcache-cache.gradle');
  fs.writeFileSync(scriptPath, initScript);
  core.info(`Wrote Gradle init script to ${scriptPath}`);
}

export function enableGradleBuildCache(gradleHome: string): void {
  fs.mkdirSync(gradleHome, { recursive: true });

  const propsPath = path.join(gradleHome, 'gradle.properties');
  const line = '\norg.gradle.caching=true\n';

  fs.appendFileSync(propsPath, line);
  core.info(`Enabled build cache in ${propsPath}`);
}

const MAVEN_BUILD_CACHE_EXT_GROUP = 'org.apache.maven.extensions';
const MAVEN_BUILD_CACHE_EXT_ARTIFACT = 'maven-build-cache-extension';
const MAVEN_BUILD_CACHE_EXT_VERSION = '1.2.2';

export function ensureMavenBuildCacheExtension(workingDir: string): void {
  const mvnDir = path.join(workingDir, '.mvn');
  fs.mkdirSync(mvnDir, { recursive: true });

  const extensionsPath = path.join(mvnDir, 'extensions.xml');

  try {
    const content = fs.readFileSync(extensionsPath, 'utf-8');
    if (content.includes(MAVEN_BUILD_CACHE_EXT_ARTIFACT)) {
      core.info('Maven Build Cache Extension already present in .mvn/extensions.xml');
      return;
    }

    // Inject extension before closing </extensions> tag
    const extensionBlock = `  <extension>
    <groupId>${MAVEN_BUILD_CACHE_EXT_GROUP}</groupId>
    <artifactId>${MAVEN_BUILD_CACHE_EXT_ARTIFACT}</artifactId>
    <version>${MAVEN_BUILD_CACHE_EXT_VERSION}</version>
  </extension>
`;
    const updated = content.replace('</extensions>', extensionBlock + '</extensions>');
    fs.writeFileSync(extensionsPath, updated);
    core.info(`Added Maven Build Cache Extension to existing ${extensionsPath}`);
  } catch {
    // File doesn't exist, create it
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<extensions xmlns="http://maven.apache.org/EXTENSIONS/1.0.0"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
            xsi:schemaLocation="http://maven.apache.org/EXTENSIONS/1.0.0 https://maven.apache.org/xsd/core-extensions-1.0.0.xsd">
  <extension>
    <groupId>${MAVEN_BUILD_CACHE_EXT_GROUP}</groupId>
    <artifactId>${MAVEN_BUILD_CACHE_EXT_ARTIFACT}</artifactId>
    <version>${MAVEN_BUILD_CACHE_EXT_VERSION}</version>
  </extension>
</extensions>
`;
    fs.writeFileSync(extensionsPath, xml);
    core.info(`Created ${extensionsPath} with Maven Build Cache Extension`);
  }
}

export function writeMavenSettings(serverId: string, serverUsername: string, serverPassword: string): void {
  const m2Dir = path.join(os.homedir(), '.m2');
  fs.mkdirSync(m2Dir, { recursive: true });

  if (serverPassword) core.setSecret(serverPassword);
  if (serverUsername) core.setSecret(serverUsername);

  const settingsPath = path.join(m2Dir, 'settings.xml');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">
  <servers>
    <server>
      <id>${serverId}</id>
      <username>\${env.${serverUsername}}</username>
      <password>\${env.${serverPassword}}</password>
    </server>
  </servers>
</settings>
`;
  fs.writeFileSync(settingsPath, xml);
  core.info(`Wrote Maven settings.xml with server '${serverId}'`);
}

export function writeMavenBuildCacheConfig(workingDir: string, port: number, readOnly: boolean): void {
  const mvnDir = path.join(workingDir, '.mvn');
  fs.mkdirSync(mvnDir, { recursive: true });

  const configPath = path.join(mvnDir, 'maven-build-cache-config.xml');
  const saveToRemote = !readOnly;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cache xmlns="http://maven.apache.org/BUILD-CACHE-CONFIG/1.2.0"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://maven.apache.org/BUILD-CACHE-CONFIG/1.2.0 https://maven.apache.org/xsd/build-cache-config-1.2.0.xsd">
  <configuration>
    <remote enabled="true" saveToRemote="${saveToRemote}" transport="resolver" id="boringcache">
      <url>http://127.0.0.1:${port}</url>
    </remote>
  </configuration>
</cache>
`;

  fs.writeFileSync(configPath, xml);
  core.info(`Wrote Maven build cache config to ${configPath}`);
}
