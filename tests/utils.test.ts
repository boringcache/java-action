import { parseBoolean, resolveGradleHome, getWorkspace, getCacheTagPrefix, getJavaVersion, getMiseBinPath, getMiseDataDir, getMavenLocalRepo, detectBuildTool } from '../lib/utils';
import * as core from '@actions/core';
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

describe('Java Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BORINGCACHE_DEFAULT_WORKSPACE;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.MAVEN_REPO_LOCAL;
  });

  describe('parseBoolean', () => {
    it('should parse boolean strings correctly', () => {
      expect(parseBoolean('true')).toBe(true);
      expect(parseBoolean('TRUE')).toBe(true);
      expect(parseBoolean('True')).toBe(true);
      expect(parseBoolean('false')).toBe(false);
      expect(parseBoolean('')).toBe(false);
      expect(parseBoolean(undefined)).toBe(false);
    });

    it('should use default value when empty or undefined', () => {
      expect(parseBoolean(undefined, true)).toBe(true);
      expect(parseBoolean('', true)).toBe(true);
    });
  });

  describe('getWorkspace', () => {
    it('should return input workspace when provided', () => {
      expect(getWorkspace('my-org/my-project')).toBe('my-org/my-project');
    });

    it('should use BORINGCACHE_DEFAULT_WORKSPACE as fallback', () => {
      process.env.BORINGCACHE_DEFAULT_WORKSPACE = 'default-org/default-project';
      expect(getWorkspace('')).toBe('default-org/default-project');
    });

    it('should add default/ prefix when no slash present', () => {
      expect(getWorkspace('my-project')).toBe('default/my-project');
    });

    it('should fail when no workspace available', () => {
      expect(() => getWorkspace('')).toThrow('Workspace required');
      expect(core.setFailed).toHaveBeenCalled();
    });
  });

  describe('getCacheTagPrefix', () => {
    it('should return input cache tag when provided', () => {
      expect(getCacheTagPrefix('my-cache')).toBe('my-cache');
    });

    it('should use repository name as default', () => {
      process.env.GITHUB_REPOSITORY = 'owner/my-repo';
      expect(getCacheTagPrefix('')).toBe('my-repo');
    });

    it('should return java as final fallback', () => {
      expect(getCacheTagPrefix('')).toBe('java');
    });
  });

  describe('getJavaVersion', () => {
    it('should return input version when provided', async () => {
      expect(await getJavaVersion('17', '/tmp')).toBe('17');
    });

    it('should read from .java-version file', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));
      try {
        await fs.promises.writeFile(path.join(tmpDir, '.java-version'), '17\n');
        expect(await getJavaVersion('', tmpDir)).toBe('17');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('should read from .tool-versions file', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));
      try {
        await fs.promises.writeFile(path.join(tmpDir, '.tool-versions'), 'java 21\nnode 22\n');
        expect(await getJavaVersion('', tmpDir)).toBe('21');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('should fall back to 21', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));
      try {
        expect(await getJavaVersion('', tmpDir)).toBe('21');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('detectBuildTool', () => {
    it('should detect Gradle from build.gradle', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));
      try {
        await fs.promises.writeFile(path.join(tmpDir, 'build.gradle'), '');
        expect(await detectBuildTool(tmpDir)).toBe('gradle');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('should detect Gradle from settings.gradle.kts', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));
      try {
        await fs.promises.writeFile(path.join(tmpDir, 'settings.gradle.kts'), '');
        expect(await detectBuildTool(tmpDir)).toBe('gradle');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('should detect Maven from pom.xml', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));
      try {
        await fs.promises.writeFile(path.join(tmpDir, 'pom.xml'), '');
        expect(await detectBuildTool(tmpDir)).toBe('maven');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('should return none when no build tool found', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));
      try {
        expect(await detectBuildTool(tmpDir)).toBe('none');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it('should prefer Gradle over Maven when both exist', async () => {
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'java-test-'));
      try {
        await fs.promises.writeFile(path.join(tmpDir, 'build.gradle'), '');
        await fs.promises.writeFile(path.join(tmpDir, 'pom.xml'), '');
        expect(await detectBuildTool(tmpDir)).toBe('gradle');
      } finally {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('getMavenLocalRepo', () => {
    it('should use MAVEN_REPO_LOCAL if set', () => {
      process.env.MAVEN_REPO_LOCAL = '/custom/m2/repo';
      expect(getMavenLocalRepo()).toBe('/custom/m2/repo');
    });

    it('should default to ~/.m2/repository', () => {
      expect(getMavenLocalRepo()).toBe(path.join(os.homedir(), '.m2', 'repository'));
    });
  });

  describe('resolveGradleHome', () => {
    it('should expand ~ to home directory', () => {
      expect(resolveGradleHome('~/.gradle')).toBe(path.join(os.homedir(), '.gradle'));
    });

    it('should default to ~/.gradle when empty', () => {
      expect(resolveGradleHome('')).toBe(path.join(os.homedir(), '.gradle'));
    });

    it('should resolve absolute paths as-is', () => {
      expect(resolveGradleHome('/opt/gradle')).toBe('/opt/gradle');
    });
  });

  describe('writeGradleInitScript', () => {
    let writeGradleInitScript: typeof import('../lib/utils').writeGradleInitScript;

    beforeAll(() => {
      writeGradleInitScript = require('../lib/utils').writeGradleInitScript;
    });

    it('should create init.d directory and write init script', () => {
      const gradleHome = '/home/runner/.gradle';

      writeGradleInitScript(gradleHome, 5000, false);

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(gradleHome, 'init.d'),
        { recursive: true }
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(gradleHome, 'init.d', 'boringcache-cache.gradle'),
        expect.stringContaining('http://127.0.0.1:5000/cache/')
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('push = true')
      );
    });

    it('should disable push in read-only mode', () => {
      writeGradleInitScript('/home/runner/.gradle', 5000, true);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('push = false')
      );
    });
  });

  describe('enableGradleBuildCache', () => {
    let enableGradleBuildCache: typeof import('../lib/utils').enableGradleBuildCache;

    beforeAll(() => {
      enableGradleBuildCache = require('../lib/utils').enableGradleBuildCache;
    });

    it('should create gradle home and append to gradle.properties', () => {
      const gradleHome = '/home/runner/.gradle';

      enableGradleBuildCache(gradleHome);

      expect(fs.mkdirSync).toHaveBeenCalledWith(gradleHome, { recursive: true });
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        path.join(gradleHome, 'gradle.properties'),
        expect.stringContaining('org.gradle.caching=true')
      );
    });
  });

  describe('getMiseBinPath', () => {
    it('should return mise binary path', () => {
      const result = getMiseBinPath();
      expect(result).toContain('mise');
      expect(result).toContain('.local');
    });
  });

  describe('getMiseDataDir', () => {
    it('should return mise data directory', () => {
      const result = getMiseDataDir();
      expect(result).toContain('mise');
    });
  });
});
