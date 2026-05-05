import type { ActionDef, ActionSelection } from '@/types/run'

export function buildSelections(
  availableActions: ActionDef[],
  selectionOverrides: Record<string, Partial<ActionSelection>>,
): Record<string, ActionSelection> {
  const selections: Record<string, ActionSelection> = {}

  for (const action of availableActions) {
    const override = selectionOverrides[action.id] ?? {}
    selections[action.id] = {
      actionId: action.id,
      selected: override.selected ?? action.enabled,
      prompt: override.prompt ?? '',
    }
  }

  return selections
}

export function buildActionMap(availableActions: ActionDef[]): Map<string, ActionDef> {
  return new Map(availableActions.map((action) => [action.id, action]))
}

export function getOrderedActions(
  actions: ActionDef[],
  preferredOrder: string[],
  actionMap: Map<string, ActionDef>,
): ActionDef[] {
  const validIds = new Set(actions.map((action) => action.id))
  const keptIds = preferredOrder.filter((id) => validIds.has(id))
  const addedIds = actions.filter((action) => !keptIds.includes(action.id)).map((action) => action.id)

  return [...keptIds, ...addedIds]
    .map((id) => actionMap.get(id))
    .filter((action): action is ActionDef => action !== undefined)
}

export function getSelectedActionIds(
  actions: ActionDef[],
  selections: Record<string, ActionSelection>,
): string[] {
  return actions.filter((action) => action.enabled && selections[action.id]?.selected).map((action) => action.id)
}
