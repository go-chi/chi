/**
 * Shared TypeScript Program construction for repository gates that need real
 * cross-file symbols and types instead of isolated syntax trees.
 */

import { relative, resolve } from 'node:path'
import ts from 'typescript'

interface ProjectGraph {
  rootNames: string[]
  options: ts.CompilerOptions
}

/**
 * A compiler face: the two aggregates a repository-wide program may seed from.
 * The root solution is never one of them.
 */
export type CompilerFace = 'host' | 'client'

/** TypeScript config host shared by repository scripts. */
export const repositoryConfigHost: ts.ParseConfigFileHost = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  readDirectory: (...args) => ts.sys.readDirectory(...args),
  fileExists: fileName => ts.sys.fileExists(fileName),
  readFile: fileName => ts.sys.readFile(fileName),
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  onUnRecoverableConfigFileDiagnostic(diagnostic) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
  },
}

/**
 * Parse one face aggregate tsconfig and flatten all referenced projects into one
 * semantic graph. Never seed the root solution: flattening host+client into one
 * program collides the cordis Context merges.
 */
function loadProjectGraph(projectRoot: string, face: CompilerFace): ProjectGraph {
  const rootConfigPath = resolve(projectRoot, `tsconfig.${face}.json`)
  const rootConfig = parseConfig(rootConfigPath)
  const rootNames = new Set<string>()
  const visited = new Set<string>()

  const collect = (configPath: string, parsed: ts.ParsedCommandLine): void => {
    if (visited.has(configPath)) return
    visited.add(configPath)
    for (const fileName of parsed.fileNames) rootNames.add(fileName)
    for (const reference of parsed.projectReferences ?? []) {
      const referencePath = ts.resolveProjectReferencePath(reference)
      collect(referencePath, parseConfig(referencePath))
    }
  }
  collect(rootConfigPath, rootConfig)

  return {
    rootNames: [...rootNames],
    options: rootConfig.options,
  }
}

/** Parse one config file and fail loud on any config diagnostic. */
function parseConfig(configPath: string): ts.ParsedCommandLine {
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, repositoryConfigHost)
  if (!parsed) throw new Error(`cannot parse TypeScript config ${configPath}`)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  return parsed
}

/** Disable emit-only options after loading the root solution config. */
function semanticCompilerOptions(options: ts.CompilerOptions): ts.CompilerOptions {
  return {
    ...options,
    noEmit: true,
    composite: false,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
    incremental: false,
  }
}

/** A repository-scoped TypeScript Program and its shared TypeChecker. */
export class TypeScriptProject {
  /** The bound cross-file TypeScript program. */
  readonly program: ts.Program
  /** The checker shared by every semantic query in this project. */
  readonly checker: ts.TypeChecker

  /**
   * @param projectRoot - repository root the program is seeded and reported from.
   * @param face - which compiler face aggregate to flatten.
   */
  constructor(readonly projectRoot: string, face: CompilerFace = 'host') {
    const graph = loadProjectGraph(projectRoot, face)
    this.program = ts.createProgram(graph.rootNames, semanticCompilerOptions(graph.options))
    this.checker = this.program.getTypeChecker()
  }

  /**
   * Return every source file loaded into the flattened root project graph.
   * @returns program source files, including libraries and external dependencies.
   */
  sourceFiles(): readonly ts.SourceFile[] {
    return this.program.getSourceFiles()
  }

  /**
   * Render a loaded source file relative to the project root.
   * @param sourceFile - a source file from this project.
   * @returns a slash-separated repository-relative path.
   */
  relativePath(sourceFile: ts.SourceFile): string {
    return relative(this.projectRoot, sourceFile.fileName).replaceAll('\\', '/')
  }

  /**
   * Return one program source file by repository-relative path.
   * @param relativePath - path relative to the project root.
   * @returns the source file bound into this project.
   * @throws if a requested root or imported source was not loaded.
   */
  sourceFile(relativePath: string): ts.SourceFile {
    const sourceFile = this.program.getSourceFile(resolve(this.projectRoot, relativePath))
    if (!sourceFile) throw new Error(`TypeScript project did not load ${relativePath}`)
    return sourceFile
  }
}
