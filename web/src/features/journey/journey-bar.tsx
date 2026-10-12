import { Stepper, RoleSwitcher, type StepId } from "./stepper";

/**
 * Deck-style journey bar: dark rounded rail carrying the stepper and the
 * role switcher, so it reads on either world.
 */
export function JourneyBar({
  active,
  progress,
}: {
  active: StepId;
  progress?: number;
}) {
  return (
    <div className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-full bg-ink-950 px-5 py-2.5 md:justify-between">
      <Stepper active={active} progress={progress} />
      <RoleSwitcher />
    </div>
  );
}
