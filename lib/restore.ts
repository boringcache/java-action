import * as core from '@actions/core';
import {
  parseBoolean,
  getWorkspace,
  getCacheTagPrefix,
  ensureBoringCache,
  execBoringCache,
  wasCacheHit,
  getMiseDataDir,
  installMise,
  installJava,
  activateJava,
  getJavaVersion,
  detectBuildTool,
  getMavenLocalRepo,
  startRegistryProxy,
  waitForProxy,
  findAvailablePort,
  resolveGradleHome,
  writeGradleInitScript,
  enableGradleBuildCache,
  ensureMavenBuildCacheExtension,
  writeMavenBuildCacheConfig,
} from './utils';

async function run(): Promise<void> {
  try {
    const cliVersion = core.getInput('cli-version') || '';
    const workspace = getWorkspace(core.getInput('workspace') || '');
    const cacheTagPrefix = getCacheTagPrefix(core.getInput('cache-tag') || '');
    const inputJavaVersion = core.getInput('java-version');
    const workingDir = core.getInput('working-directory') || process.cwd();
    const cacheJava = core.getInput('cache-java') !== 'false';
    const proxyPort = parseInt(core.getInput('proxy-port') || '0', 10) || await findAvailablePort();
    const readOnly = parseBoolean(core.getInput('read-only'), false);
    const gradleHome = resolveGradleHome(core.getInput('gradle-home') || '');
    const enableBuildCache = parseBoolean(core.getInput('enable-build-cache'), true);
    const proxyNoGit = parseBoolean(core.getInput('proxy-no-git'), false);
    const proxyNoPlatform = parseBoolean(core.getInput('proxy-no-platform'), false);
    const verbose = parseBoolean(core.getInput('verbose'), false);

    const javaVersion = await getJavaVersion(inputJavaVersion, workingDir);
    const buildTool = await detectBuildTool(workingDir);

    core.saveState('workspace', workspace);
    core.saveState('cacheTagPrefix', cacheTagPrefix);
    core.saveState('javaVersion', javaVersion);
    core.saveState('workingDir', workingDir);
    core.saveState('cacheJava', cacheJava.toString());
    core.saveState('buildTool', buildTool);
    core.saveState('verbose', verbose.toString());

    if (cliVersion.toLowerCase() !== 'skip') {
      await ensureBoringCache({ version: cliVersion });
    }

    const miseDataDir = getMiseDataDir();
    const javaTag = `${cacheTagPrefix}-java-${javaVersion}`;

    let javaCacheHit = false;
    if (cacheJava) {
      core.info(`Restoring Java ${javaVersion}...`);
      const args = ['restore', workspace, `${javaTag}:${miseDataDir}`];
      if (verbose) args.push('--verbose');
      const result = await execBoringCache(args);
      javaCacheHit = wasCacheHit(result);
      core.setOutput('java-cache-hit', javaCacheHit.toString());
    }

    await installMise();

    if (javaCacheHit) {
      await activateJava(javaVersion);
    } else {
      await installJava(javaVersion);
    }

    if (buildTool === 'gradle') {
      const proxy = await startRegistryProxy({
        command: 'cache-registry',
        workspace,
        tag: cacheTagPrefix,
        host: '127.0.0.1',
        port: proxyPort,
        noGit: proxyNoGit,
        noPlatform: proxyNoPlatform,
        verbose,
      });
      await waitForProxy(proxy.port, 20000, proxy.pid);
      core.saveState('proxyPid', String(proxy.pid));

      writeGradleInitScript(gradleHome, proxy.port, readOnly);

      if (enableBuildCache) {
        enableGradleBuildCache(gradleHome);
      }

      core.setOutput('proxy-port', String(proxy.port));
      core.info(`Gradle build cache configured at http://127.0.0.1:${proxy.port}/cache/`);
    }

    if (buildTool === 'maven') {
      // Start proxy for Maven build cache (same as Gradle)
      const proxy = await startRegistryProxy({
        command: 'cache-registry',
        workspace,
        tag: cacheTagPrefix,
        host: '127.0.0.1',
        port: proxyPort,
        noGit: proxyNoGit,
        noPlatform: proxyNoPlatform,
        verbose,
      });
      await waitForProxy(proxy.port, 20000, proxy.pid);
      core.saveState('proxyPid', String(proxy.pid));

      ensureMavenBuildCacheExtension(workingDir);
      writeMavenBuildCacheConfig(workingDir, proxy.port, readOnly);

      core.setOutput('proxy-port', String(proxy.port));
      core.info(`Maven build cache configured at http://127.0.0.1:${proxy.port}/`);

      // Also restore Maven dependency cache (archive-based)
      const mavenLocalRepo = getMavenLocalRepo();
      const mavenTag = `${cacheTagPrefix}-maven-deps`;

      core.info('Restoring Maven dependencies...');
      const args = ['restore', workspace, `${mavenTag}:${mavenLocalRepo}`];
      if (verbose) args.push('--verbose');
      const result = await execBoringCache(args);
      const mavenRestored = wasCacheHit(result);

      core.saveState('mavenTag', mavenTag);
      core.saveState('mavenRestored', mavenRestored.toString());
      core.info(mavenRestored ? 'Maven dependencies restored' : 'Maven dependencies not in cache');
    }

    core.setOutput('workspace', workspace);
    core.setOutput('java-version', javaVersion);
    core.setOutput('cache-tag', cacheTagPrefix);
    core.setOutput('cache-hit', javaCacheHit.toString());

    core.info(`Java ${javaVersion} setup complete (build tool: ${buildTool})`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
