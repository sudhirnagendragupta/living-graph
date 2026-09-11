import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';
import { GraphNode } from '../types.js';

export interface DiscoveredRoute {
  path: string;
  componentName: string;
  componentFilePath: string | null;
  nodeId: string;
}

/**
 * Scans React Router / Next.js route configurations via AST.
 */
export class RouterScanner {
  private sourceDir: string;

  constructor(sourceDir: string) {
    this.sourceDir = sourceDir;
  }

  /**
   * Find entry router file (App.tsx, main.tsx, routes.tsx, etc.)
   */
  public findRouterFile(): string | null {
    const candidates = [
      path.join(this.sourceDir, 'App.tsx'),
      path.join(this.sourceDir, 'App.jsx'),
      path.join(this.sourceDir, 'routes.tsx'),
      path.join(this.sourceDir, 'main.tsx'),
      path.join(this.sourceDir, 'routes/index.tsx'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Recursive search for files containing <Routes> or <Route
    const files = this.collectSourceFiles(this.sourceDir);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (content.includes('<Route') || content.includes('<Routes')) {
        return file;
      }
    }

    return null;
  }

  /**
   * Scan router file and discover all screen routes.
   */
  public scanRoutes(): DiscoveredRoute[] {
    const routerFile = this.findRouterFile();
    if (!routerFile) {
      return [];
    }

    const sourceText = fs.readFileSync(routerFile, 'utf-8');
    const sourceFile = ts.createSourceFile(
      path.basename(routerFile),
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    // 1. Map import specifiers to local identifiers
    const imports = this.extractImports(sourceFile, path.dirname(routerFile));

    // 2. Extract <Route> JSX tags
    const routes: DiscoveredRoute[] = [];

    const walk = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = node.tagName.getText(sourceFile);
        if (tagName === 'Route') {
          let routePath: string | null = null;
          let elementComponent: string | null = null;

          node.attributes.properties.forEach((prop) => {
            if (ts.isJsxAttribute(prop) && prop.initializer) {
              const attrName = prop.name.getText(sourceFile);
              if (attrName === 'path') {
                routePath = prop.initializer.getText(sourceFile).replace(/['"]/g, '');
              } else if (attrName === 'element') {
                const elemText = prop.initializer.getText(sourceFile);
                // Extract component name from <Component /> or {<Component />}
                const match = elemText.match(/<([A-Z][a-zA-Z0-9_]*)/);
                if (match && match[1] !== 'Navigate') {
                  elementComponent = match[1];
                }
              }
            }
          });

          if (routePath && routePath !== '*' && routePath !== '/') {
            const compName = elementComponent || this.inferComponentNameFromPath(routePath);
            const compFile = imports.get(compName) || this.locateComponentFile(compName);
            const nodeId = this.routePathToNodeId(routePath, compName);

            if (!routes.some((r) => r.path === routePath)) {
              routes.push({
                path: routePath,
                componentName: compName,
                componentFilePath: compFile,
                nodeId,
              });
            }
          }
        }
      }
      ts.forEachChild(node, walk);
    };

    walk(sourceFile);
    return routes;
  }

  /**
   * Convert discovered routes into initial GraphNode objects.
   */
  public routesToNodes(routes: DiscoveredRoute[]): Record<string, GraphNode> {
    const nodes: Record<string, GraphNode> = {};

    for (const r of routes) {
      const isAuthRoute = !r.path.includes('login') && !r.path.includes('sign');
      const cleanTitle = r.componentName
        .replace(/([A-Z])/g, ' $1')
        .trim();

      nodes[r.nodeId] = {
        id: r.nodeId,
        route: r.path,
        title: cleanTitle,
        description: `Screen surface rendered by ${r.componentName} for route ${r.path}.`,
        invariants: {
          urlPattern: `^${r.path.replace(/:[a-zA-Z0-9_]+/g, '[a-zA-Z0-9_-]+')}`,
          requiresAuth: isAuthRoute,
          expectedElements: [],
        },
        interactiveElements: [],
      };
    }

    return nodes;
  }

  private routePathToNodeId(routePath: string, compName?: string): string {
    if (compName) {
      // CamelCase → snake_case, e.g. TicketDetail → node_ticket_detail
      return 'node_' + compName
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '');
    }
    const clean = routePath
      .replace(/^\//, '')
      .replace(/\/:([a-zA-Z0-9_]+)/g, '_detail')
      .replace(/[^a-zA-Z0-9_]/g, '_');
    return `node_${clean || 'root'}`;
  }

  private inferComponentNameFromPath(routePath: string): string {
    return routePath
      .split('/')
      .filter(Boolean)
      .map((seg) => seg.replace(/^:/, ''))
      .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
      .join('');
  }

  private extractImports(sourceFile: ts.SourceFile, baseDir: string): Map<string, string> {
    const map = new Map<string, string>();

    for (const stmt of sourceFile.statements) {
      if (ts.isImportDeclaration(stmt) && stmt.importClause && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const modulePath = stmt.moduleSpecifier.text;
        const resolvedPath = this.resolveModuleFile(baseDir, modulePath);

        if (stmt.importClause.name) {
          map.set(stmt.importClause.name.text, resolvedPath);
        }
        if (stmt.importClause.namedBindings && ts.isNamedImports(stmt.importClause.namedBindings)) {
          for (const spec of stmt.importClause.namedBindings.elements) {
            map.set(spec.name.text, resolvedPath);
          }
        }
      }
    }

    return map;
  }

  private resolveModuleFile(baseDir: string, modulePath: string): string {
    const direct = path.resolve(baseDir, modulePath);
    const exts = ['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts'];
    for (const ext of exts) {
      const candidate = direct + ext;
      if (fs.existsSync(candidate)) return candidate;
    }
    return direct;
  }

  private locateComponentFile(componentName: string): string | null {
    const files = this.collectSourceFiles(this.sourceDir);
    return files.find((f) => path.basename(f, path.extname(f)) === componentName) || null;
  }

  private collectSourceFiles(dir: string): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== 'dist') {
        results = results.concat(this.collectSourceFiles(full));
      } else if (entry.isFile() && /\.(tsx|jsx|ts|js)$/.test(entry.name)) {
        results.push(full);
      }
    }
    return results;
  }
}
