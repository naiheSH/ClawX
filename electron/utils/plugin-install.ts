/**
 * OpenClaw Plugin Installation Utility
 *
 * Plugins are bundled in the app's resources/plugins/ directory at build time.
 * At runtime, they are copied to ~/.openclaw/extensions/<pluginId>/ so the
 * Gateway can discover them. This avoids needing npm at runtime.
 */
import { app } from 'electron';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { logger } from './logger';

// Mapping of pluginId -> bundled directory name under resources/plugins/
const BUNDLED_PLUGINS: Record<string, string> = {
    'hi-light': 'hi-light',
};

/**
 * Get the path to the bundled plugins directory
 */
function getBundledPluginsDir(): string {
    if (app.isPackaged) {
        return join(process.resourcesPath, 'plugins');
    }
    return join(__dirname, '../../build/plugins');
}

/**
 * Get the extensions directory where OpenClaw discovers plugins
 */
function getExtensionsDir(): string {
    return join(homedir(), '.openclaw', 'extensions');
}

/**
 * Check if a plugin is already installed in ~/.openclaw/extensions/
 */
export function isPluginInstalled(pluginId: string): boolean {
    const pluginDir = join(getExtensionsDir(), pluginId);
    return existsSync(pluginDir) && existsSync(join(pluginDir, 'package.json'));
}

/**
 * Install a bundled plugin by copying it from app resources to ~/.openclaw/extensions/
 */
export function installBundledPlugin(pluginId: string): { success: boolean; error?: string } {
    const bundledDir = join(getBundledPluginsDir(), BUNDLED_PLUGINS[pluginId] || pluginId);
    if (!existsSync(bundledDir)) {
        return { success: false, error: `Bundled plugin not found: ${bundledDir}` };
    }

    const extensionsDir = getExtensionsDir();
    const targetDir = join(extensionsDir, pluginId);

    try {
        mkdirSync(extensionsDir, { recursive: true });
        cpSync(bundledDir, targetDir, { recursive: true, force: true });
        logger.info(`Plugin "${pluginId}" installed to ${targetDir}`);
        return { success: true };
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to install plugin "${pluginId}": ${msg}`);
        return { success: false, error: msg };
    }
}

/**
 * Check if the bundled plugin is newer than the installed one.
 * Compares package.json version fields.
 */
function isBundledNewer(pluginId: string): boolean {
    const bundledDir = join(getBundledPluginsDir(), BUNDLED_PLUGINS[pluginId] || pluginId);
    const installedDir = join(getExtensionsDir(), pluginId);

    try {
        const bundledPkg = JSON.parse(readFileSync(join(bundledDir, 'package.json'), 'utf-8'));
        const installedPkg = JSON.parse(readFileSync(join(installedDir, 'package.json'), 'utf-8'));
        return bundledPkg.version !== installedPkg.version;
    } catch {
        return false;
    }
}

/**
 * Ensure all required plugins are installed based on configured channels in openclaw.json.
 * Call this before Gateway startup to prevent config validation failures.
 *
 * Two-pronged approach:
 * 1. Copy bundled plugin to ~/.openclaw/extensions/<pluginId>/
 * 2. Add the plugin path to plugins.loadPaths in openclaw.json so the Gateway
 *    can discover it even if the normal extensions directory scan fails.
 */
export function ensureRequiredPlugins(): void {
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    const configPath = join(homedir(), '.openclaw', 'openclaw.json');

    let config: Record<string, unknown> = {};
    try {
        if (existsSync(configPath)) {
            config = JSON.parse(readFileSync(configPath, 'utf-8'));
        }
    } catch {
        return;
    }

    const channels = config.channels as Record<string, unknown> | undefined;
    if (!channels) return;

    let configDirty = false;

    // Cleanup: remove invalid plugins.loadPaths from previous versions
    const pluginsCfg = config.plugins as Record<string, unknown> | undefined;
    if (pluginsCfg && 'loadPaths' in pluginsCfg) {
        delete pluginsCfg.loadPaths;
        configDirty = true;
        logger.info('Pre-flight: removed invalid plugins.loadPaths key');
    }

    for (const pluginId of Object.keys(BUNDLED_PLUGINS)) {
        if (!channels[pluginId]) continue;

        // Step 1: Copy plugin files to extensions directory
        if (!isPluginInstalled(pluginId)) {
            logger.info(`Pre-flight: installing bundled plugin "${pluginId}"`);
            const result = installBundledPlugin(pluginId);
            if (!result.success) {
                logger.error(`Pre-flight: plugin "${pluginId}" install failed: ${result.error}`);
                continue;
            }
        } else if (isBundledNewer(pluginId)) {
            logger.info(`Pre-flight: updating plugin "${pluginId}" to newer bundled version`);
            installBundledPlugin(pluginId);
        }

        // Verify the installed plugin files
        const installedDir = join(getExtensionsDir(), pluginId);
        const hasPkg = existsSync(join(installedDir, 'package.json'));
        const hasManifest = existsSync(join(installedDir, 'openclaw.plugin.json'));
        const hasDist = existsSync(join(installedDir, 'dist', 'index.js'));
        logger.info(`Pre-flight: plugin "${pluginId}" verification: pkg=${hasPkg} manifest=${hasManifest} dist=${hasDist}`);

        // Step 2: Ensure plugin path is in plugins.load.paths for guaranteed discovery
        const pluginPath = join(getExtensionsDir(), pluginId);
        if (!config.plugins || typeof config.plugins !== 'object') {
            config.plugins = {};
        }
        const plugins = config.plugins as Record<string, unknown>;
        if (!plugins.load || typeof plugins.load !== 'object') {
            plugins.load = {};
        }
        const load = plugins.load as Record<string, unknown>;
        if (!Array.isArray(load.paths)) {
            load.paths = [];
        }
        const loadPaths = load.paths as string[];
        if (!loadPaths.includes(pluginPath)) {
            loadPaths.push(pluginPath);
            configDirty = true;
            logger.info(`Pre-flight: added "${pluginPath}" to plugins.load.paths`);
        }
    }

    // Write config if we modified loadPaths
    if (configDirty) {
        try {
            writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
            logger.info('Pre-flight: updated openclaw.json with plugin loadPaths');
        } catch (err) {
            logger.error('Pre-flight: failed to update config with loadPaths', err);
        }
    }
}
