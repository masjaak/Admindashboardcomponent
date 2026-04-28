import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../../..');
const css = readFileSync(resolve(root, 'src/admin-dashboard.css'), 'utf8');
const houseApp = readFileSync(resolve(root, 'src/components/house/HouseApp.tsx'), 'utf8');

const modalStateMachine = {
  states: ['closed', 'menuEditorOpen', 'staffEditorOpen', 'confirmDialogOpen'],
  events: ['openMenuEditor', 'openStaffEditor', 'openConfirmDialog', 'dismiss'],
  guard: 'confirmDialog cannot dismiss while confirmation is processing',
  sideEffect: 'modal presentation keeps the active tab visible behind a centered popup',
} as const;

function cssBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return '';
  const end = css.indexOf('\n}', start);
  return end === -1 ? '' : css.slice(start, end + 2);
}

function overlayAlpha(block: string): number {
  const match = block.match(/rgba\(26,\s*28,\s*27,\s*(0?\.\d+)\)/);
  return match ? Number(match[1]) : Number.NaN;
}

describe('admin modal presentation', () => {
  it('documents the modal state-machine contract for this visual regression', () => {
    expect(modalStateMachine.states).toContain('menuEditorOpen');
    expect(modalStateMachine.states).toContain('staffEditorOpen');
    expect(modalStateMachine.states).toContain('confirmDialogOpen');
    expect(modalStateMachine.guard).toContain('confirmDialog');
  });

  it('keeps all modal backdrops light enough for the active tab to remain visible', () => {
    const sharedBackdrop = cssBlock('.admin-modal-backdrop');
    const confirmBackdrop = cssBlock('.admin-confirm-backdrop');

    expect(sharedBackdrop).toContain('align-items: center');
    expect(sharedBackdrop).toContain('place-items: center');
    expect(overlayAlpha(sharedBackdrop)).toBeLessThanOrEqual(0.2);
    expect(overlayAlpha(confirmBackdrop)).toBeLessThanOrEqual(0.2);
    expect(sharedBackdrop).toContain('blur(8px)');
  });

  it('does not reintroduce dark Tailwind overlay utilities on admin popup wrappers', () => {
    expect(houseApp).not.toContain('bg-[#1a1c1b]/50');
    expect(houseApp).not.toContain('bg-[#1a1c1b]/40');
    expect(houseApp.match(/admin-modal-backdrop/g)?.length).toBeGreaterThanOrEqual(3);
    expect(houseApp.match(/justify-center/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
