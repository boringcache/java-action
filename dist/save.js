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
        const workspace = core.getInput('workspace') || core.getState('workspace');
        const cacheJava = core.getInput('cache-java') !== 'false' && core.getState('cacheJava') !== 'false';
        const verbose = core.getState('verbose') === 'true';
        const exclude = core.getInput('exclude');
        const javaVersion = core.getState('javaVersion');
        const cacheTagPrefix = core.getState('cacheTagPrefix');
        const buildTool = core.getState('buildTool');
        const proxyPid = core.getState('proxyPid');
        if (proxyPid) {
            await (0, utils_1.stopRegistryProxy)(parseInt(proxyPid, 10));
            core.info('Build cache proxy stopped');
        }
        if (!workspace) {
            core.info('No workspace found, skipping save');
            return;
        }
        core.info('Saving to BoringCache...');
        if (cacheJava && javaVersion && cacheTagPrefix) {
            const miseDataDir = (0, utils_1.getMiseDataDir)();
            const javaTag = `${cacheTagPrefix}-java-${javaVersion}`;
            core.info(`Saving Java installation [${javaTag}]...`);
            const args = ['save', workspace, `${javaTag}:${miseDataDir}`];
            if (verbose)
                args.push('--verbose');
            if (exclude)
                args.push('--exclude', exclude);
            await (0, utils_1.execBoringCache)(args);
        }
        if (buildTool === 'maven') {
            const mavenTag = core.getState('mavenTag');
            if (mavenTag) {
                const mavenLocalRepo = (0, utils_1.getMavenLocalRepo)();
                core.info(`Saving Maven dependencies [${mavenTag}]...`);
                const args = ['save', workspace, `${mavenTag}:${mavenLocalRepo}`];
                if (verbose)
                    args.push('--verbose');
                if (exclude)
                    args.push('--exclude', exclude);
                await (0, utils_1.execBoringCache)(args);
            }
        }
        core.info('Save complete');
    }
    catch (error) {
        if (error instanceof Error) {
            core.warning(`Save failed: ${error.message}`);
        }
    }
}
run();
