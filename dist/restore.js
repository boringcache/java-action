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
const core = __importStar(require("@actions/core"));
const utils_1 = require("./utils");
async function run() {
    try {
        const cliVersion = core.getInput('cli-version') || '';
        const workspace = (0, utils_1.getWorkspace)(core.getInput('workspace') || '');
        const cacheTagPrefix = (0, utils_1.getCacheTagPrefix)(core.getInput('cache-tag') || '');
        const inputJavaVersion = core.getInput('java-version');
        const workingDir = core.getInput('working-directory') || process.cwd();
        const cacheJava = core.getInput('cache-java') !== 'false';
        const proxyPort = parseInt(core.getInput('proxy-port') || '0', 10) || await (0, utils_1.findAvailablePort)();
        const readOnly = (0, utils_1.parseBoolean)(core.getInput('read-only'), false);
        const gradleHome = (0, utils_1.resolveGradleHome)(core.getInput('gradle-home') || '');
        const enableBuildCache = (0, utils_1.parseBoolean)(core.getInput('enable-build-cache'), true);
        const proxyNoGit = (0, utils_1.parseBoolean)(core.getInput('proxy-no-git'), false);
        const proxyNoPlatform = (0, utils_1.parseBoolean)(core.getInput('proxy-no-platform'), false);
        const verbose = (0, utils_1.parseBoolean)(core.getInput('verbose'), false);
        const javaVersion = await (0, utils_1.getJavaVersion)(inputJavaVersion, workingDir);
        const buildTool = await (0, utils_1.detectBuildTool)(workingDir);
        core.saveState('workspace', workspace);
        core.saveState('cacheTagPrefix', cacheTagPrefix);
        core.saveState('javaVersion', javaVersion);
        core.saveState('workingDir', workingDir);
        core.saveState('cacheJava', cacheJava.toString());
        core.saveState('buildTool', buildTool);
        core.saveState('verbose', verbose.toString());
        if (cliVersion.toLowerCase() !== 'skip') {
            await (0, utils_1.ensureBoringCache)({ version: cliVersion });
        }
        const miseDataDir = (0, utils_1.getMiseDataDir)();
        const javaTag = `${cacheTagPrefix}-java-${javaVersion}`;
        let javaCacheHit = false;
        if (cacheJava) {
            core.info(`Restoring Java ${javaVersion}...`);
            const args = ['restore', workspace, `${javaTag}:${miseDataDir}`];
            if (verbose)
                args.push('--verbose');
            const result = await (0, utils_1.execBoringCache)(args);
            javaCacheHit = (0, utils_1.wasCacheHit)(result);
            core.setOutput('java-cache-hit', javaCacheHit.toString());
        }
        await (0, utils_1.installMise)();
        if (javaCacheHit) {
            await (0, utils_1.activateJava)(javaVersion);
        }
        else {
            await (0, utils_1.installJava)(javaVersion);
        }
        if (buildTool === 'gradle') {
            const proxy = await (0, utils_1.startRegistryProxy)({
                command: 'cache-registry',
                workspace,
                tag: cacheTagPrefix,
                host: '127.0.0.1',
                port: proxyPort,
                noGit: proxyNoGit,
                noPlatform: proxyNoPlatform,
                verbose,
            });
            await (0, utils_1.waitForProxy)(proxy.port, 20000, proxy.pid);
            core.saveState('proxyPid', String(proxy.pid));
            (0, utils_1.writeGradleInitScript)(gradleHome, proxy.port, readOnly);
            if (enableBuildCache) {
                (0, utils_1.enableGradleBuildCache)(gradleHome);
            }
            core.setOutput('proxy-port', String(proxy.port));
            core.info(`Gradle build cache configured at http://127.0.0.1:${proxy.port}/cache/`);
        }
        if (buildTool === 'maven') {
            // Start proxy for Maven build cache (same as Gradle)
            const proxy = await (0, utils_1.startRegistryProxy)({
                command: 'cache-registry',
                workspace,
                tag: cacheTagPrefix,
                host: '127.0.0.1',
                port: proxyPort,
                noGit: proxyNoGit,
                noPlatform: proxyNoPlatform,
                verbose,
            });
            await (0, utils_1.waitForProxy)(proxy.port, 20000, proxy.pid);
            core.saveState('proxyPid', String(proxy.pid));
            (0, utils_1.ensureMavenBuildCacheExtension)(workingDir);
            (0, utils_1.writeMavenBuildCacheConfig)(workingDir, proxy.port, readOnly);
            core.setOutput('proxy-port', String(proxy.port));
            core.info(`Maven build cache configured at http://127.0.0.1:${proxy.port}/`);
            // Also restore Maven dependency cache (archive-based)
            const mavenLocalRepo = (0, utils_1.getMavenLocalRepo)();
            const mavenTag = `${cacheTagPrefix}-maven-deps`;
            core.info('Restoring Maven dependencies...');
            const args = ['restore', workspace, `${mavenTag}:${mavenLocalRepo}`];
            if (verbose)
                args.push('--verbose');
            const result = await (0, utils_1.execBoringCache)(args);
            const mavenRestored = (0, utils_1.wasCacheHit)(result);
            core.saveState('mavenTag', mavenTag);
            core.saveState('mavenRestored', mavenRestored.toString());
            core.info(mavenRestored ? 'Maven dependencies restored' : 'Maven dependencies not in cache');
        }
        core.setOutput('workspace', workspace);
        core.setOutput('java-version', javaVersion);
        core.setOutput('cache-tag', cacheTagPrefix);
        core.setOutput('cache-hit', javaCacheHit.toString());
        core.info(`Java ${javaVersion} setup complete (build tool: ${buildTool})`);
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
    }
}
run();
