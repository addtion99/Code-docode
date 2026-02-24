import * as vscode from 'vscode';

export async function buildProjectContextSummary(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  const summaries: string[] = [];

  const readRootFile = async (fileName: string): Promise<string | undefined> => {
    try {
      const uri = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
      const data = await vscode.workspace.fs.readFile(uri);
      return decoder.decode(data);
    } catch {
      return undefined;
    }
  };

  const readmeText = await readRootFile('README.md');
  if (readmeText) {
    const headingMatches = [...readmeText.matchAll(/^#{1,3}\s+(.+)$/gm)]
      .slice(0, 6)
      .map((item) => item[1].trim());
    const codeSpans = [...readmeText.matchAll(/`([^`]{2,40})`/g)]
      .slice(0, 20)
      .map((item) => item[1].trim().toLowerCase())
      .filter(Boolean);
    const compactCodeSpans = Array.from(new Set(codeSpans)).slice(0, 12);
    if (headingMatches.length > 0) {
      summaries.push(`readme_headings:${headingMatches.join('|')}`);
    }
    if (compactCodeSpans.length > 0) {
      summaries.push(`readme_terms:${compactCodeSpans.join(',')}`);
    }
  }

  const packageText = await readRootFile('package.json');
  if (packageText) {
    try {
      const parsed = JSON.parse(packageText) as {
        name?: string;
        displayName?: string;
        description?: string;
      };
      const pkgBits = [
        parsed.name?.trim(),
        parsed.displayName?.trim(),
        parsed.description?.trim(),
      ].filter(Boolean);
      if (pkgBits.length > 0) {
        summaries.push(`package:${pkgBits.join(' | ')}`);
      }
    } catch {
      // Ignore invalid package json parsing.
    }
  }

  const joined = summaries.join(' ; ').replace(/\s+/g, ' ').trim();
  return joined.slice(0, 700);
}
