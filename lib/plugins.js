/**
 * Plugins across the two hosts: how a bundle installed on Windows installs
 * into a distribution's dsh, and how two plugin-manager listings compare.
 */

/**
 * How a bundle installed on Windows installs into a distribution's dsh: a
 * registry or git spec as recorded; a local `link:`/`file:` folder on a
 * Windows drive through its `/mnt/<drive>` path (the same files, so a linked
 * checkout stays shared); otherwise the package name from the registry.
 */
export function wslInstallSpec(bundle) {
  const source = typeof bundle.source === 'string' ? bundle.source : '';
  const local = /^(link|file):(.*)$/i.exec(source);
  if (local === null) return source || bundle.name;
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(local[2]);
  if (drive === null) return bundle.name;
  return `${local[1].toLowerCase()}:/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`;
}

/** A bundle the user installed (the profile declares it), not one shipped with dsh itself. */
const userBundle = (bundle) => Boolean(bundle.installed) || bundle.availability === 'profile';

/** Plugins never offered for WSL: this plugin is made for the Windows Host only. */
const WINDOWS_ONLY = new Set(['@local/dsh-wsl-remote']);

/**
 * Compare a distribution's `pluginManager/listBundles` with this Host's.
 * @returns {{ plugins: object[], windowsOnly: object[] }} the distribution's
 *   user bundles marked `wsl` (only there), `both` (same version here) or
 *   `both-differ`; and the Windows user bundles it does not have.
 */
export function comparePlugins(wslBundles, windowsBundles) {
  const local = new Map(windowsBundles.map((bundle) => [bundle.name, bundle]));
  const plugins = wslBundles.filter(userBundle).map((bundle) => {
    const here = local.get(bundle.name);
    const windows = here !== undefined && userBundle(here) ? { version: here.version ?? null, enabled: Boolean(here.enabled) } : undefined;
    return {
      name: bundle.name,
      version: bundle.version ?? null,
      description: bundle.description ?? '',
      meta: bundle.meta,
      enabled: Boolean(bundle.enabled),
      removable: Boolean(bundle.removable),
      source: bundle.source,
      error: bundle.error?.message ?? (bundle.error?.code ? String(bundle.error.code) : undefined),
      where: windows === undefined ? 'wsl' : windows.version === (bundle.version ?? null) ? 'both' : 'both-differ',
      ...(windows === undefined ? {} : { windows }),
    };
  });
  const names = new Set(plugins.map((plugin) => plugin.name));
  const windowsOnly = windowsBundles.filter((bundle) => userBundle(bundle) && !names.has(bundle.name) && !WINDOWS_ONLY.has(bundle.name))
    .map((bundle) => ({ name: bundle.name, version: bundle.version ?? null, description: bundle.description ?? '', meta: bundle.meta, source: bundle.source, installSpec: wslInstallSpec(bundle) }));
  return { plugins, windowsOnly };
}
