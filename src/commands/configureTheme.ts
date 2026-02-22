import * as vscode from 'vscode';

export async function applyGhostTheme(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const colorCustomizations = config.get<Record<string, unknown>>('workbench.colorCustomizations') || {};

  // Ghost Mode Colors
  // Transparent backgrounds to be subtle
  // Cool Blue-Gray for general identifiers & comments (Type)
  // Muted Purple for functions (Parameter)
  const newColors = {
    ...colorCustomizations,
    "editorInlayHint.typeBackground": "#00000000",
    "editorInlayHint.parameterBackground": "#00000000",
    "editorInlayHint.typeForeground": "#8b949e", // Subtle Blue-Gray (Variables/Comments)
    "editorInlayHint.parameterForeground": "#bfa4d1" // Low-saturation Lavender (Functions)
  };

  await config.update('workbench.colorCustomizations', newColors, vscode.ConfigurationTarget.Global);
  
  void vscode.window.showInformationMessage('已应用“虚影模式”主题颜色 (Applied Ghost Mode Theme)');
}

export async function restoreDefaultTheme(): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const colorCustomizations = config.get<Record<string, unknown>>('workbench.colorCustomizations') || {};

  const newColors = { ...colorCustomizations };
  delete newColors["editorInlayHint.typeBackground"];
  delete newColors["editorInlayHint.parameterBackground"];
  delete newColors["editorInlayHint.typeForeground"];
  delete newColors["editorInlayHint.parameterForeground"];

  await config.update('workbench.colorCustomizations', newColors, vscode.ConfigurationTarget.Global);
  
  void vscode.window.showInformationMessage('已恢复默认主题颜色 (Restored Default Theme)');
}

export function registerThemeCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('codeTranslator.applyGhostTheme', async () => {
      await applyGhostTheme();
    }),
    vscode.commands.registerCommand('codeTranslator.restoreDefaultTheme', async () => {
      await restoreDefaultTheme();
    })
  ];
}
