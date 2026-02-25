import * as core from '@actions/core';
import { execBoringCache, getMiseDataDir, getMavenLocalRepo, stopRegistryProxy } from './utils';

async function run(): Promise<void> {
  try {
    const workspace = core.getInput('workspace') || core.getState('workspace');
    const cacheJava = core.getInput('cache-java') !== 'false' && core.getState('cacheJava') !== 'false';
    const verbose = core.getState('verbose') === 'true';
    const exclude = core.getInput('exclude');
    const javaVersion = core.getState('javaVersion');
    const cacheTagPrefix = core.getState('cacheTagPrefix');
    const buildTool = core.getState('buildTool');

    const proxyPid = core.getState('proxyPid');
    if (proxyPid) {
      await stopRegistryProxy(parseInt(proxyPid, 10));
      core.info('Gradle build cache proxy stopped');
    }

    if (!workspace) {
      core.info('No workspace found, skipping save');
      return;
    }

    core.info('Saving to BoringCache...');

    if (cacheJava && javaVersion && cacheTagPrefix) {
      const miseDataDir = getMiseDataDir();
      const javaTag = `${cacheTagPrefix}-java-${javaVersion}`;
      core.info(`Saving Java installation [${javaTag}]...`);
      const args = ['save', workspace, `${javaTag}:${miseDataDir}`];
      if (verbose) args.push('--verbose');
      if (exclude) args.push('--exclude', exclude);
      await execBoringCache(args);
    }

    if (buildTool === 'maven') {
      const mavenTag = core.getState('mavenTag');
      if (mavenTag) {
        const mavenLocalRepo = getMavenLocalRepo();
        core.info(`Saving Maven dependencies [${mavenTag}]...`);
        const args = ['save', workspace, `${mavenTag}:${mavenLocalRepo}`];
        if (verbose) args.push('--verbose');
        if (exclude) args.push('--exclude', exclude);
        await execBoringCache(args);
      }
    }

    core.info('Save complete');
  } catch (error) {
    if (error instanceof Error) {
      core.warning(`Save failed: ${error.message}`);
    }
  }
}

run();
