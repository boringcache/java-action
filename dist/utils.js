"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAvailablePort = exports.stopRegistryProxy = exports.waitForProxy = exports.startRegistryProxy = exports.pathExists = exports.ensureBoringCache = void 0;
exports.execBoringCache = execBoringCache;
exports.wasCacheHit = wasCacheHit;
exports.getWorkspace = getWorkspace;
exports.getCacheTagPrefix = getCacheTagPrefix;
exports.parseBoolean = parseBoolean;
exports.getMiseBinPath = getMiseBinPath;
exports.getMiseDataDir = getMiseDataDir;
exports.installMise = installMise;
exports.installJava = installJava;
exports.activateJava = activateJava;
exports.getJavaVersion = getJavaVersion;
exports.getMavenLocalRepo = getMavenLocalRepo;
exports.detectBuildTool = detectBuildTool;
exports.resolveGradleHome = resolveGradleHome;
exports.writeGradleInitScript = writeGradleInitScript;
exports.enableGradleBuildCache = enableGradleBuildCache;
exports.ensureMavenBuildCacheExtension = ensureMavenBuildCacheExtension;
exports.writeMavenBuildCacheConfig = writeMavenBuildCacheConfig;
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const action_core_1 = require("@boringcache/action-core");
Object.defineProperty(exports, "ensureBoringCache", { enumerable: true, get: function () { return action_core_1.ensureBoringCache; } });
Object.defineProperty(exports, "pathExists", { enumerable: true, get: function () { return action_core_1.pathExists; } });
Object.defineProperty(exports, "startRegistryProxy", { enumerable: true, get: function () { return action_core_1.startRegistryProxy; } });
Object.defineProperty(exports, "waitForProxy", { enumerable: true, get: function () { return action_core_1.waitForProxy; } });
Object.defineProperty(exports, "stopRegistryProxy", { enumerable: true, get: function () { return action_core_1.stopRegistryProxy; } });
Object.defineProperty(exports, "findAvailablePort", { enumerable: true, get: function () { return action_core_1.findAvailablePort; } });
const isWindows = process.platform === 'win32';
let lastOutput = '';
async function execBoringCache(args) {
    lastOutput = '';
    let output = '';
    const code = await (0, action_core_1.execBoringCache)(args, {
        silent: true,
        listeners: {
            stdout: (data) => {
                const text = data.toString();
                output += text;
                process.stdout.write(text);
            },
            stderr: (data) => {
                const text = data.toString();
                output += text;
                process.stderr.write(text);
            }
        }
    });
    lastOutput = output;
    return code;
}
function wasCacheHit(exitCode) {
    if (exitCode !== 0) {
        return false;
    }
    if (!lastOutput) {
        return true;
    }
    const missPatterns = [/Cache miss/i, /No cache entries/i, /Found 0\//i];
    return !missPatterns.some(pattern => pattern.test(lastOutput));
}
function getWorkspace(inputWorkspace) {
    return (0, action_core_1.getWorkspace)(inputWorkspace);
}
function getCacheTagPrefix(inputCacheTag) {
    return (0, action_core_1.getCacheTagPrefix)(inputCacheTag, 'java');
}
function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '')
        return defaultValue;
    return String(value).trim().toLowerCase() === 'true';
}
function getMiseBinPath() {
    const homedir = os.homedir();
    return isWindows
        ? path.join(homedir, '.local', 'bin', 'mise.exe')
        : path.join(homedir, '.local', 'bin', 'mise');
}
function getMiseDataDir() {
    if (isWindows) {
        return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'mise');
    }
    return path.join(os.homedir(), '.local', 'share', 'mise');
}
async function installMise() {
    core.info('Installing mise...');
    if (isWindows) {
        await installMiseWindows();
    }
    else {
        await exec.exec('sh', ['-c', 'curl https://mise.run | sh']);
    }
    core.addPath(path.dirname(getMiseBinPath()));
    core.addPath(path.join(getMiseDataDir(), 'shims'));
}
async function installMiseWindows() {
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
        await fs.promises.copyFile(path.join(tempDir, 'mise', 'bin', 'mise.exe'), getMiseBinPath());
    }
    finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
}
async function installJava(version) {
    core.info(`Installing Java ${version} via mise...`);
    const misePath = getMiseBinPath();
    await exec.exec(misePath, ['install', `java@${version}`]);
    await exec.exec(misePath, ['use', '-g', `java@${version}`]);
}
async function activateJava(version) {
    core.info(`Activating Java ${version}...`);
    const misePath = getMiseBinPath();
    await exec.exec(misePath, ['use', '-g', `java@${version}`]);
}
async function getJavaVersion(inputVersion, workingDir) {
    if (inputVersion) {
        return inputVersion;
    }
    const javaVersionFile = path.join(workingDir, '.java-version');
    try {
        const content = await fs.promises.readFile(javaVersionFile, 'utf-8');
        const version = content.trim();
        if (version)
            return version;
    }
    catch { }
    const toolVersionsFile = path.join(workingDir, '.tool-versions');
    try {
        const content = await fs.promises.readFile(toolVersionsFile, 'utf-8');
        const javaLine = content.split('\n').find(line => line.startsWith('java '));
        if (javaLine) {
            return javaLine.split(/\s+/)[1].trim();
        }
    }
    catch { }
    return '21';
}
function getMavenLocalRepo() {
    if (process.env.MAVEN_REPO_LOCAL) {
        return process.env.MAVEN_REPO_LOCAL;
    }
    return path.join(os.homedir(), '.m2', 'repository');
}
async function detectBuildTool(workingDir) {
    const gradleFiles = ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts'];
    for (const file of gradleFiles) {
        try {
            await fs.promises.access(path.join(workingDir, file));
            return 'gradle';
        }
        catch { }
    }
    try {
        await fs.promises.access(path.join(workingDir, 'pom.xml'));
        return 'maven';
    }
    catch { }
    return 'none';
}
function resolveGradleHome(input) {
    const gradleHome = input || '~/.gradle';
    if (gradleHome.startsWith('~')) {
        return path.join(os.homedir(), gradleHome.slice(1));
    }
    return path.resolve(gradleHome);
}
function writeGradleInitScript(gradleHome, port, readOnly) {
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
function enableGradleBuildCache(gradleHome) {
    fs.mkdirSync(gradleHome, { recursive: true });
    const propsPath = path.join(gradleHome, 'gradle.properties');
    const line = '\norg.gradle.caching=true\n';
    fs.appendFileSync(propsPath, line);
    core.info(`Enabled build cache in ${propsPath}`);
}
const MAVEN_BUILD_CACHE_EXT_GROUP = 'org.apache.maven.extensions';
const MAVEN_BUILD_CACHE_EXT_ARTIFACT = 'maven-build-cache-extension';
const MAVEN_BUILD_CACHE_EXT_VERSION = '1.2.2';
function ensureMavenBuildCacheExtension(workingDir) {
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
    }
    catch {
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
function writeMavenBuildCacheConfig(workingDir, port, readOnly) {
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
