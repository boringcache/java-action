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

export async function installJava(version: string): Promise<void> {
  core.info(`Installing Java ${version} via mise...`);
  const misePath = getMiseBinPath();

  await exec.exec(misePath, ['install', `java@${version}`]);
  await exec.exec(misePath, ['use', '-g', `java@${version}`]);
}

export async function activateJava(version: string): Promise<void> {
  core.info(`Activating Java ${version}...`);
  const misePath = getMiseBinPath();

  await exec.exec(misePath, ['use', '-g', `java@${version}`]);
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

  return '21';
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
