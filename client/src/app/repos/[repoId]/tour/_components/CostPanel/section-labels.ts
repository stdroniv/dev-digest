import type { TourSectionKind } from "@devdigest/shared";

/** Maps a wire `TourSectionKind` to the `tour.sections.<key>.title` message
   key segment (the contract is snake_case; message keys are camelCase). */
export const SECTION_MESSAGE_KEY: Record<TourSectionKind, string> = {
  architecture: "architecture",
  critical_paths: "criticalPaths",
  how_to_run: "howToRun",
  reading_path: "readingPath",
  first_tasks: "firstTasks",
};
