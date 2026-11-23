import type { ResolveHookSync } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const lib = resolve(dirname(fileURLToPath(import.meta.url)), '../lib');

/**
 * Makes a module resolve hook for Node tests that import app source.
 * The hook sends each specifier in `mocks` to its mock URL. It resolves `@/lib/...` imports and
 * relative imports from `.ts` files to `.ts` file URLs. Node does not apply the app path alias
 * and does not add the `.ts` extension.
 */
export function resolveSource(mocks: Record<string, string> = {}): ResolveHookSync {
  return (specifier, context, nextResolve) => {
    if (Object.hasOwn(mocks, specifier)) return { url: mocks[specifier], shortCircuit: true };
    let path: string | null = null;
    if (specifier.startsWith('@/lib/')) path = resolve(lib, specifier.slice(6));
    else if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts'))
      path = resolve(dirname(fileURLToPath(context.parentURL)), specifier);
    if (path)
      return nextResolve(pathToFileURL(path.endsWith('.ts') ? path : `${path}.ts`).href, context);
    return nextResolve(specifier, context);
  };
}
