import * as core from '@actions/core';
import * as execModule from '@actions/exec';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    appendFileSync: jest.fn(),
  };
});

jest.mock('@boringcache/action-core', () => ({
  ensureBoringCache: jest.fn().mockResolvedValue(undefined),
  execBoringCache: jest.fn().mockResolvedValue(0),
  getWorkspace: jest.fn((input: string) => {
    if (!input) throw new Error('Workspace required');
    if (!input.includes('/')) return `default/${input}`;
    return input;
  }),
  getCacheTagPrefix: jest.fn((input: string, fallback: string) => {
    if (input) return input;
    const repo = process.env.GITHUB_REPOSITORY || '';
    if (repo) return repo.split('/')[1] || repo;
    return fallback;
  }),
  pathExists: jest.fn().mockResolvedValue(false),
  startRegistryProxy: jest.fn().mockResolvedValue({ pid: 54321, port: 5000 }),
  waitForProxy: jest.fn().mockResolvedValue(undefined),
  stopRegistryProxy: jest.fn().mockResolvedValue(undefined),
  findAvailablePort: jest.fn().mockResolvedValue(8888),
}));

import {
  ensureBoringCache,
  execBoringCache,
  startRegistryProxy,
  waitForProxy,
  stopRegistryProxy,
  findAvailablePort,
} from '@boringcache/action-core';

describe('Java restore/save round-trip', () => {
  const stateStore: Record<string, string> = {};
  const outputs: Record<string, string> = {};
  let tmpDir: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    Object.keys(stateStore).forEach(k => delete stateStore[k]);
    Object.keys(outputs).forEach(k => delete outputs[k]);

    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));

    (ensureBoringCache as jest.Mock).mockResolvedValue(undefined);
    (execBoringCache as jest.Mock).mockResolvedValue(0);
    (startRegistryProxy as jest.Mock).mockResolvedValue({ pid: 54321, port: 5000 });
    (waitForProxy as jest.Mock).mockResolvedValue(undefined);
    (stopRegistryProxy as jest.Mock).mockResolvedValue(undefined);
    (findAvailablePort as jest.Mock).mockResolvedValue(8888);

    const { getWorkspace, getCacheTagPrefix } = require('@boringcache/action-core');
    (getWorkspace as jest.Mock).mockImplementation((input: string) => {
      if (!input) throw new Error('Workspace required');
      if (!input.includes('/')) return `default/${input}`;
      return input;
    });
    (getCacheTagPrefix as jest.Mock).mockImplementation((input: string, fallback: string) => {
      if (input) return input;
      const repo = process.env.GITHUB_REPOSITORY || '';
      if (repo) return repo.split('/')[1] || repo;
      return fallback;
    });

    (core.saveState as jest.Mock).mockImplementation((key: string, value: string) => {
      stateStore[key] = value;
    });
    (core.getState as jest.Mock).mockImplementation((key: string) => {
      return stateStore[key] || '';
    });
    (core.setOutput as jest.Mock).mockImplementation((key: string, value: string) => {
      outputs[key] = value;
    });
    (execModule.exec as jest.Mock).mockResolvedValue(0);

    process.env.BORINGCACHE_API_TOKEN = 'test-token';
    process.env.GITHUB_REPOSITORY = 'myorg/myrepo';
  });

  afterEach(async () => {
    delete process.env.BORINGCACHE_API_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('full Gradle round-trip: installs Java, starts proxy, configures Gradle, saves cache', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'build.gradle'), '');
    const gradleHome = path.join(os.homedir(), '.gradle');

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'cli-version': 'v1.8.0',
        'workspace': 'myorg/myproject',
        'cache-tag': '',
        'java-version': '21',
        'working-directory': tmpDir,
        'cache-java': 'true',
        'proxy-port': '5000',
        'read-only': 'false',
        'gradle-home': '',
        'enable-build-cache': 'true',
        'verbose': 'false',
      };
      return inputs[name] || '';
    });

    jest.isolateModules(() => {
      require('../lib/restore');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(ensureBoringCache).toHaveBeenCalledWith({ version: 'v1.8.0' });

    expect(execBoringCache).toHaveBeenCalledWith(
      expect.arrayContaining(['restore', 'myorg/myproject']),
      expect.anything(),
    );

    expect(execModule.exec).toHaveBeenCalledWith('sh', ['-c', 'curl https://mise.run | sh']);
    expect(execModule.exec).toHaveBeenCalledWith(
      expect.stringContaining('mise'),
      ['use', '-g', 'java@21'],
    );

    expect(startRegistryProxy).toHaveBeenCalledWith(expect.objectContaining({
      command: 'cache-registry',
      workspace: 'myorg/myproject',
      host: '127.0.0.1',
      port: 5000,
    }));
    expect(waitForProxy).toHaveBeenCalledWith(5000, 20000, 54321);

    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(gradleHome, 'init.d'),
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(gradleHome, 'init.d', 'boringcache-cache.gradle'),
      expect.stringContaining('http://127.0.0.1:5000/cache/'),
    );
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      path.join(gradleHome, 'gradle.properties'),
      expect.stringContaining('org.gradle.caching=true'),
    );

    expect(stateStore['proxyPid']).toBe('54321');
    expect(stateStore['buildTool']).toBe('gradle');
    expect(outputs['java-version']).toBe('21');
    expect(outputs['proxy-port']).toBe('5000');

    (execBoringCache as jest.Mock).mockClear();

    jest.isolateModules(() => {
      const coreMock = require('@actions/core');
      coreMock.getState.mockImplementation((key: string) => stateStore[key] || '');
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'workspace') return 'myorg/myproject';
        return '';
      });
      require('../lib/save');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(stopRegistryProxy).toHaveBeenCalledWith(54321);
    expect(execBoringCache).toHaveBeenCalledWith(
      expect.arrayContaining(['save', 'myorg/myproject']),
      expect.anything(),
    );
  });

  it('Maven project: installs Java, restores/saves Maven dependencies', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'pom.xml'), '');

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'cli-version': 'v1.8.0',
        'workspace': 'myorg/myproject',
        'java-version': '17',
        'working-directory': tmpDir,
        'cache-java': 'true',
        'proxy-port': '5000',
      };
      return inputs[name] || '';
    });

    jest.isolateModules(() => {
      require('../lib/restore');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(execModule.exec).toHaveBeenCalledWith(
      expect.stringContaining('mise'),
      ['use', '-g', 'java@17'],
    );

    expect(startRegistryProxy).not.toHaveBeenCalled();

    expect(execBoringCache).toHaveBeenCalledWith(
      expect.arrayContaining(['restore', 'myorg/myproject', expect.stringContaining('maven-deps')]),
      expect.anything(),
    );

    expect(stateStore['buildTool']).toBe('maven');
    expect(stateStore['mavenTag']).toContain('maven-deps');

    (execBoringCache as jest.Mock).mockClear();

    jest.isolateModules(() => {
      const coreMock = require('@actions/core');
      coreMock.getState.mockImplementation((key: string) => stateStore[key] || '');
      coreMock.getInput.mockImplementation((name: string) => {
        if (name === 'workspace') return '';
        return '';
      });
      require('../lib/save');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(stopRegistryProxy).not.toHaveBeenCalled();
    expect(execBoringCache).toHaveBeenCalledWith(
      expect.arrayContaining(['save', 'myorg/myproject', expect.stringContaining('maven-deps')]),
      expect.anything(),
    );
  });

  it('cache-java=false skips Java cache but still installs', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'build.gradle'), '');

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'workspace': 'myorg/myproject',
        'java-version': '17',
        'working-directory': tmpDir,
        'cache-java': 'false',
        'proxy-port': '5000',
      };
      return inputs[name] || '';
    });

    jest.isolateModules(() => {
      require('../lib/restore');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    const boringcacheCalls = (execBoringCache as jest.Mock).mock.calls;
    const restoreCalls = boringcacheCalls.filter((call: any[]) => call[0]?.includes('restore'));
    expect(restoreCalls.length).toBe(0);

    expect(execModule.exec).toHaveBeenCalledWith(
      expect.stringContaining('mise'),
      ['install', 'java@17'],
    );
  });

  it('read-only mode disables push in Gradle init script', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'build.gradle'), '');

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'workspace': 'myorg/myproject',
        'java-version': '21',
        'working-directory': tmpDir,
        'read-only': 'true',
        'proxy-port': '5000',
      };
      return inputs[name] || '';
    });

    jest.isolateModules(() => {
      require('../lib/restore');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('push = false'),
    );
  });

  it('skips CLI install when cli-version is "skip"', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'build.gradle'), '');

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'workspace': 'myorg/myproject',
        'cli-version': 'skip',
        'java-version': '21',
        'working-directory': tmpDir,
        'proxy-port': '5000',
      };
      return inputs[name] || '';
    });

    jest.isolateModules(() => {
      require('../lib/restore');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(ensureBoringCache).not.toHaveBeenCalled();
  });

  it('save is a no-op when workspace is missing', async () => {
    (core.getState as jest.Mock).mockImplementation(() => '');
    (core.getInput as jest.Mock).mockImplementation(() => '');

    jest.isolateModules(() => {
      require('../lib/save');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(stopRegistryProxy).not.toHaveBeenCalled();
    expect(execBoringCache).not.toHaveBeenCalled();
  });

  it('no build tool detected: installs Java only, no proxy or maven cache', async () => {
    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'workspace': 'myorg/myproject',
        'java-version': '21',
        'working-directory': tmpDir,
        'proxy-port': '5000',
      };
      return inputs[name] || '';
    });

    jest.isolateModules(() => {
      require('../lib/restore');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(execModule.exec).toHaveBeenCalledWith(
      expect.stringContaining('mise'),
      ['use', '-g', 'java@21'],
    );

    expect(startRegistryProxy).not.toHaveBeenCalled();

    const boringcacheCalls = (execBoringCache as jest.Mock).mock.calls;
    const mavenCalls = boringcacheCalls.filter((call: any[]) =>
      call[0]?.some?.((arg: string) => arg.includes('maven'))
    );
    expect(mavenCalls.length).toBe(0);

    expect(stateStore['buildTool']).toBe('none');
  });

  it('custom cache-tag propagates to Gradle proxy', async () => {
    await fs.promises.writeFile(path.join(tmpDir, 'build.gradle'), '');

    (core.getInput as jest.Mock).mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'workspace': 'myorg/myproject',
        'java-version': '21',
        'working-directory': tmpDir,
        'cache-tag': 'my-custom-tag',
        'proxy-port': '5000',
      };
      return inputs[name] || '';
    });

    jest.isolateModules(() => {
      require('../lib/restore');
    });
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(execBoringCache).toHaveBeenCalledWith(
      expect.arrayContaining(['restore', 'myorg/myproject', expect.stringContaining('my-custom-tag-java-21')]),
      expect.anything(),
    );

    expect(startRegistryProxy).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'my-custom-tag',
    }));
  });
});
