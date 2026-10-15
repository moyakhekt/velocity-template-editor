import * as path from "node:path";
import * as vscode from "vscode";
import type {
  TemplateContextGroup,
  TemplateContextInEnvironment,
} from "../shared/types";
import {
  IContextServices,
  isSameTemplatePath,
  resolveTemplatePath,
} from "./contextManagerServices";

/**
 * Manages context groups: sets of templates (typically a default template and
 * its customized copies) that share one template context, so they are all
 * tested against the same scenarios. Driven by the "Template Groups" tab of
 * the Context Manager; template paths in messages are stored (normalized) paths.
 */
export class TemplateGroupService {
  constructor(private readonly deps: IContextServices) {}

  // ---------------------------------------------------------------------------
  // Message handlers
  // ---------------------------------------------------------------------------

  /**
   * Creates a group. With `template`, that template's own scenarios become the
   * shared ones; otherwise the user picks the member templates.
   */
  async handleCreateTemplateGroup(
    message: { name?: string; template?: string },
    currentTemplatePath: string,
  ): Promise<void> {
    if (!this.ensureEnvironmentLoaded()) {
      return;
    }
    const members = message.template
      ? [message.template]
      : await this.pickTemplates(currentTemplatePath, "Select templates for the new group", "Create Group");
    if (!members?.length) {
      return;
    }

    const suggested = message.name?.trim() || path.basename(members[0]).replace(/\.[^.]+$/, "");
    const name = message.name?.trim() && !this.groups()[message.name.trim()]
      ? message.name.trim()
      : await this.promptForGroupName(suggested);
    if (!name) {
      return;
    }

    const inOtherGroups = members.filter((p) => this.deps.findTemplateGroupName(p));
    if (inOtherGroups.length > 0 && !(await this.confirmMove(inOtherGroups.length, name))) {
      return;
    }

    const configSource = await this.pickConfigSource(members);
    if (configSource === null) {
      return; // cancelled
    }
    const sharedConfig = configSource ? this.findTemplateEntry(configSource) : undefined;
    if (!(await this.confirmReplacingOwnEntries(members.filter((p) => p !== configSource), name))) {
      return;
    }

    for (const member of members) {
      this.removeFromGroups(member);
      this.takeTemplateEntry(member);
    }
    this.groups()[name] = {
      templates: members,
      ...(sharedConfig
        ? JSON.parse(JSON.stringify(sharedConfig))
        : { scenarios: { Default: { variables: {} } }, activeScenario: "Default" }),
    };
    await this.commit(currentTemplatePath, `Created context group "${name}"`);
  }

  async handleRenameTemplateGroup(
    message: { oldName: string; newName: string },
    currentTemplatePath: string,
  ): Promise<void> {
    const oldName = message.oldName;
    const newName = message.newName?.trim();
    const groups = this.groups();
    if (!groups[oldName] || !newName || newName === oldName) {
      return;
    }
    if (groups[newName]) {
      vscode.window.showErrorMessage(`A group named "${newName}" already exists`);
      void this.deps.updateWebview(currentTemplatePath);
      return;
    }
    // Rebuild to keep the group's position in the file
    const renamed: Record<string, TemplateContextGroup> = {};
    for (const [name, group] of Object.entries(groups)) {
      renamed[name === oldName ? newName : name] = group;
    }
    this.deps.getEnvironmentContext().templateGroups = renamed;
    await this.commit(currentTemplatePath, `Renamed group "${oldName}" to "${newName}"`);
  }

  /** Deletes a group; each member keeps its own copy of the shared scenarios. */
  async handleDeleteTemplateGroup(
    message: { name: string },
    currentTemplatePath: string,
  ): Promise<void> {
    const group = this.groups()[message.name];
    if (!group) {
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Delete context group "${message.name}"? Each of its ${group.templates.length} template(s) keeps its own copy of the group's scenarios.`,
      { modal: true },
      "Delete Group",
    );
    if (confirm !== "Delete Group") {
      return;
    }
    // removeFromGroups replaces group.templates, so this iterates the original list
    for (const member of group.templates) {
      this.detachWithOwnCopy(member, message.name);
    }
    delete this.groups()[message.name];
    await this.commit(currentTemplatePath, `Deleted context group "${message.name}"`);
  }

  /** Adds templates chosen in a file picker to a group. */
  async handleAddTemplatesToGroup(
    message: { name: string },
    currentTemplatePath: string,
  ): Promise<void> {
    if (!this.groups()[message.name]) {
      return;
    }
    const picked = await this.pickTemplates(
      currentTemplatePath,
      `Add templates to context group "${message.name}"`,
      "Add to Group",
    );
    if (!picked?.length) {
      return;
    }
    await this.addToGroup(picked, message.name, currentTemplatePath);
  }

  /** Adds one known template (e.g. from the Ungrouped list) to a group. */
  async handleAddTemplateToGroup(
    message: { name: string; template: string },
    currentTemplatePath: string,
  ): Promise<void> {
    if (!this.groups()[message.name] || !message.template) {
      return;
    }
    await this.addToGroup([message.template], message.name, currentTemplatePath);
  }

  /** Removes a template from a group; it keeps its own copy of the scenarios. */
  async handleRemoveTemplateFromGroup(
    message: { name: string; template: string },
    currentTemplatePath: string,
  ): Promise<void> {
    const group = this.groups()[message.name];
    if (!group) {
      return;
    }
    const isLastMember = group.templates.length <= 1;
    const confirm = await vscode.window.showWarningMessage(
      isLastMember
        ? `${path.basename(message.template)} is the only template in "${message.name}". The group will be deleted and its scenarios kept for this template.`
        : `Remove ${path.basename(message.template)} from "${message.name}"? It keeps its own copy of the group's scenarios.`,
      { modal: true },
      "Remove",
    );
    if (confirm !== "Remove") {
      return;
    }
    this.detachWithOwnCopy(message.template, message.name);
    await this.commit(currentTemplatePath, `Removed ${path.basename(message.template)} from "${message.name}"`);
  }

  async handleOpenTemplate(message: { template: string }): Promise<void> {
    const absolutePath = resolveTemplatePath(message.template);
    try {
      const doc = await vscode.workspace.openTextDocument(absolutePath);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    } catch {
      vscode.window.showErrorMessage(`Template not found: ${absolutePath}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async addToGroup(
    templates: string[],
    groupName: string,
    currentTemplatePath: string,
  ): Promise<void> {
    const toAdd = templates.filter((p) => this.deps.findTemplateGroupName(p) !== groupName);
    if (toAdd.length === 0) {
      vscode.window.showInformationMessage("The selected templates are already in this group.");
      return;
    }
    const inOtherGroups = toAdd.filter((p) => this.deps.findTemplateGroupName(p));
    if (inOtherGroups.length > 0 && !(await this.confirmMove(inOtherGroups.length, groupName))) {
      return;
    }
    if (!(await this.confirmReplacingOwnEntries(toAdd, groupName))) {
      return;
    }
    const group = this.groups()[groupName];
    for (const templatePath of toAdd) {
      this.removeFromGroups(templatePath);
      this.takeTemplateEntry(templatePath);
      group.templates.push(templatePath);
    }
    await this.commit(currentTemplatePath, `Added ${toAdd.length} template(s) to "${groupName}"`);
  }

  /** Takes the template out of the group, giving it its own copy of the shared config. */
  private detachWithOwnCopy(templatePath: string, groupName: string): void {
    const group = this.groups()[groupName];
    if (!group) {
      return;
    }
    const { templates: _members, ...sharedConfig } = group;
    const ownCopy: TemplateContextInEnvironment = JSON.parse(JSON.stringify(sharedConfig));
    this.removeFromGroups(templatePath);
    const environmentContext = this.deps.getEnvironmentContext();
    environmentContext.templates ??= {};
    environmentContext.templates[templatePath] = ownCopy;
  }

  private async commit(currentTemplatePath: string, status: string): Promise<void> {
    await this.deps.saveEnvironmentContext();
    void this.deps.updateWebview(currentTemplatePath);
    this.deps.refreshPreviewIfOpen(currentTemplatePath);
    vscode.window.setStatusBarMessage(`$(check) ${status}`, 3000);
  }

  private ensureEnvironmentLoaded(): boolean {
    if (this.deps.getEnvironmentContext().filePath) {
      return true;
    }
    vscode.window.showWarningMessage("Load an environment context file before managing context groups.");
    return false;
  }

  private async pickTemplates(
    currentTemplatePath: string,
    title: string,
    openLabel: string,
  ): Promise<string[] | undefined> {
    const uris = await vscode.window.showOpenDialog({
      defaultUri: currentTemplatePath ? vscode.Uri.file(path.dirname(currentTemplatePath)) : undefined,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
      title,
      openLabel,
    });
    return uris?.map((uri) => this.deps.normalizeTemplatePath(uri.fsPath));
  }

  /**
   * Which template's own scenarios the new group should share. Returns the
   * template path, undefined for "start empty", or null when cancelled.
   */
  private async pickConfigSource(members: string[]): Promise<string | undefined | null> {
    const withConfig = members.filter((p) => this.findTemplateEntry(p));
    if (withConfig.length === 0) {
      return undefined;
    }
    if (withConfig.length === 1) {
      return withConfig[0];
    }
    const picked = await vscode.window.showQuickPick(
      [
        ...withConfig.map((p) => ({
          label: path.basename(p),
          description: `${Object.keys(this.findTemplateEntry(p)?.scenarios || {}).length} scenario(s)`,
          detail: p,
          value: p as string | undefined,
        })),
        { label: "Start with an empty Default scenario", description: "", detail: undefined, value: undefined },
      ],
      { title: "Which template's scenarios should the group share?", ignoreFocusOut: true },
    );
    return picked ? picked.value : null;
  }

  private groups(): Record<string, TemplateContextGroup> {
    const environmentContext = this.deps.getEnvironmentContext();
    environmentContext.templateGroups ??= {};
    return environmentContext.templateGroups;
  }

  private async promptForGroupName(suggested: string): Promise<string | undefined> {
    const existing = Object.keys(this.groups());
    const name = await vscode.window.showInputBox({
      title: "New context group",
      prompt: "Group name",
      value: suggested,
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return "Group name is required";
        }
        return existing.includes(trimmed) ? `A group named "${trimmed}" already exists` : undefined;
      },
    });
    return name?.trim() || undefined;
  }

  private async confirmMove(count: number, groupName: string): Promise<boolean> {
    const confirm = await vscode.window.showWarningMessage(
      `${count} selected template(s) already belong to another group and will be moved to "${groupName}".`,
      { modal: true },
      "Move",
    );
    return confirm === "Move";
  }

  /**
   * Asks before discarding the per-template entries of templates joining a
   * group. Returns true if there is nothing to discard or the user agreed.
   */
  private async confirmReplacingOwnEntries(
    normalizedPaths: string[],
    groupName: string,
  ): Promise<boolean> {
    const withOwnEntries = normalizedPaths.filter((p) => this.findTemplateEntry(p));
    if (withOwnEntries.length === 0) {
      return true;
    }
    const confirm = await vscode.window.showWarningMessage(
      `${withOwnEntries.map((p) => path.basename(p)).join(", ")} ${withOwnEntries.length === 1 ? "has its" : "have their"} own scenarios, which will be removed and replaced by the scenarios of "${groupName}".`,
      { modal: true },
      "Replace",
    );
    return confirm === "Replace";
  }

  private findTemplateEntry(normalizedPath: string): TemplateContextInEnvironment | undefined {
    const key = this.findTemplateKey(normalizedPath);
    return key === undefined ? undefined : this.deps.getEnvironmentContext().templates?.[key];
  }

  /** Removes and returns the template's own entry in `templates`, if any. */
  private takeTemplateEntry(normalizedPath: string): TemplateContextInEnvironment | undefined {
    const templates = this.deps.getEnvironmentContext().templates;
    const key = this.findTemplateKey(normalizedPath);
    if (!templates || key === undefined) {
      return undefined;
    }
    const entry = templates[key];
    delete templates[key];
    return entry;
  }

  private findTemplateKey(normalizedPath: string): string | undefined {
    const templates = this.deps.getEnvironmentContext().templates || {};
    return Object.keys(templates).find((key) => isSameTemplatePath(key, normalizedPath));
  }

  /** Removes the template from every group, deleting groups left empty. */
  private removeFromGroups(normalizedPath: string): void {
    const groups = this.groups();
    for (const [name, group] of Object.entries(groups)) {
      group.templates = group.templates.filter((member) => !isSameTemplatePath(member, normalizedPath));
      if (group.templates.length === 0) {
        delete groups[name];
      }
    }
  }
}
